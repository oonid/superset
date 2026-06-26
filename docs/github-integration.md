# GitHub Integration — Architecture & Local Setup Guide

> Reference doc for the `cli-wrapper` GitHub integration.
> Date: 2026-06-25. Based on upstream base `4cab5cfad`.

## Overview

The Superset GitHub integration serves **two independent purposes**:

> **Note**: As of PR #3152, the GitHub integration is available to all users on the free plan. It is no longer gated by the `GITHUB_INTEGRATION_ACCESS` feature flag or the desktop paywall modal.

### A. Organization-level GitHub App (Server-side)

This is the **GitHub App install flow** that connects a Superset organization to GitHub:

- **Syncs repositories** accessible to the installed GitHub App into the database
- **Syncs pull requests** (last 30 days) with CI check status and review decisions
- **Real-time webhooks** keep everything updated (PR events, check runs, repo changes)
- **Links GitHub repos to Superset projects** via `githubRepositoryId` FK on the `projects` and `v2_projects` tables

### B. Desktop `gh` CLI Status (Client-side)

Completely independent of the GitHub App. The desktop app uses the user's local `gh` CLI to:

- Show per-workspace PR status for the current branch
- Fetch and display PR review comments
- Resolve/unresolve review threads
- Polls every 10s on active surfaces

**No changes needed for (B)** — it works out of the box with local `gh` auth.

---

## Upstream Install Flow (apps/api)

```
Desktop "Manage" button
  → opens browser at apps/web /integrations/github
    → "Install" button hits apps/api /api/github/install?organizationId=...
      → API verifies session + org membership
      → Creates signed state (HMAC-SHA256 via BETTER_AUTH_SECRET, 10min TTL)
      → Redirects to github.com/apps/superset-app/installations/new?state=...
        → User installs app on GitHub
        → GitHub redirects to /api/github/callback
          → Verifies signed state, re-checks org membership
          → Uses githubApp.getInstallationOctokit() to verify with GitHub
          → Upserts github_installations row
          → Queues initial sync job via QStash
            → Syncs all repos + PRs (last 30 days) + check statuses
          → Redirects to web app success page
```

## Our Local Flow (cli-wrapper)

```
Desktop "Manage" button
  → opens browser at localhost:3000/integrations/github (web shim)
    → web.ts resolves org server-side (most recent active session)
    → 302 → /api/github/install?organization_id=...
      → Creates signed state (HS256 JWT via JWT_SECRET, 15min TTL)
      → Redirects to github.com/apps/${GITHUB_APP_NAME}/installations/new?state=...
        → User installs app on GitHub
        → GitHub redirects to localhost:3001/api/github/callback
          → Verifies JWT state
          → Fetches installation details from GitHub API
          → Inserts github_installations row
          → Redirects to superset://app/settings/integrations?success=true
```

### Differences from Upstream

| Aspect | Upstream (`apps/api`) | Local (`cli-wrapper`) |
|---|---|---|
| GitHub App name | `superset-app` (hardcoded) | `GITHUB_APP_NAME` env (default: `superset-sh-dev`) |
| State signing | HMAC-SHA256 via `BETTER_AUTH_SECRET` | HS256 JWT via `JWT_SECRET` |
| Callback URL | `api.superset.sh/api/github/callback` | `localhost:3001/api/github/callback` |
| Post-install sync | QStash job → syncs repos + PRs | ❌ **Not implemented** |
| Webhooks | Full webhook processing (8 event types) | ❌ **Not implemented** |
| Installation verify | `githubApp.getInstallationOctokit()` | Direct `octokit.rest.apps.getInstallation()` |

---

## Environment Variables

### Required for GitHub App

| Env Var | Default | Purpose |
|---|---|---|
| `GH_APP_ID` | `000000` | GitHub App ID |
| `GH_APP_PRIVATE_KEY` | `fake-github-app-private-key` | GitHub App private key (PEM format) |
| `GH_WEBHOOK_SECRET` | `fake-github-webhook-secret` | Webhook signature verification |
| `GITHUB_APP_NAME` | `superset-sh-dev` | GitHub App slug (used in install redirect URL) |

### For OAuth sign-in (separate from App integration)

| Env Var | Purpose |
|---|---|
| `GH_CLIENT_ID` | GitHub OAuth Client ID (for "Sign in with GitHub") |
| `GH_CLIENT_SECRET` | GitHub OAuth Client Secret |

---

## Setting Up Your Own GitHub App

1. Go to **GitHub → Settings → Developer Settings → GitHub Apps → New GitHub App**

2. Configure:
   - **Name**: e.g. `superset-yourname-local-dev` (must be globally unique on GitHub)
   - **Homepage URL**: `http://localhost:3000`
   - **Callback URL**: `http://localhost:3001/api/github/callback`
   - **Setup URL** (optional): `http://localhost:3001/api/github/callback`
   - **Webhook**: Disable for now, OR use [smee.io](https://smee.io) / ngrok to forward to `localhost:3001/api/github/webhook`
   - **Permissions**:
     - Repository: Contents (Read), Metadata (Read)
     - Pull requests: Read
     - Checks: Read
     - Issues: Read

3. After creation:
   - Note the **App ID** (numeric, shown on app settings page)
   - Click **Generate a private key** → downloads a `.pem` file
   - Set a **Webhook secret** (any random string)

4. Run the backend with your app credentials:
   ```bash
   DATABASE_URL="postgres://postgres:postgres@db.localtest.me:4444/main" \
   GH_APP_ID=<your-app-id> \
   GH_APP_PRIVATE_KEY="$(cat path/to/your-app.pem)" \
   GITHUB_APP_NAME=<your-app-slug> \
   GH_WEBHOOK_SECRET=<your-secret> \
   /opt/superset-dev/resources/resources/bin/superset-dev serve
   ```

---

## Database Schema

Three tables in `packages/db/src/schema/github.ts`:

### `github_installations`
| Column | Type | Notes |
|---|---|---|
| `organizationId` | text | Unique per org |
| `connectedByUserId` | text | Who initiated the install |
| `installationId` | text | GitHub's numeric ID (unique) |
| `accountLogin` | text | GitHub account name |
| `accountType` | text | `User` or `Organization` |
| `permissions` | jsonb | App permissions granted |
| `suspended` | boolean | |
| `lastSyncedAt` | timestamp | |

### `github_repositories`
| Column | Type | Notes |
|---|---|---|
| `installationId` | text | FK to installations |
| `organizationId` | text | Denormalized for Electric SQL |
| `repoId` | text | GitHub repo ID (unique) |
| `owner` | text | |
| `name` | text | |
| `fullName` | text | e.g. `owner/repo` |
| `defaultBranch` | text | |
| `isPrivate` | boolean | |

### `github_pull_requests`
| Column | Type | Notes |
|---|---|---|
| `repositoryId` | text | FK to repositories |
| `organizationId` | text | Denormalized |
| `prNumber` | int | |
| `headBranch` | text | |
| `title` | text | |
| `state` | text | open/closed/merged |
| `reviewDecision` | text | APPROVED/CHANGES_REQUESTED |
| `checksStatus` | text | pending/success/failure |
| `checks` | jsonb | Array of individual check results |

---

## tRPC Endpoints

Located at `packages/trpc/src/router/integration/github/github.ts`:

| Endpoint | Type | Purpose |
|---|---|---|
| `integration.github.getInstallation` | query | Get installation for org |
| `integration.github.disconnect` | mutation | Delete installation |
| `integration.github.triggerSync` | mutation | Queue a re-sync job |
| `integration.github.listRepositories` | query | List repos for org's installation |
| `integration.github.listPullRequests` | query | List PRs (filterable by repo, state) |
| `integration.github.getStats` | query | Counts (repos, open PRs, pending/failed checks) |

---

## Key Files

### Upstream (apps/api)
| File | Purpose |
|---|---|
| `apps/api/src/app/api/github/install/route.ts` | Install initiation (redirect to GitHub) |
| `apps/api/src/app/api/github/callback/route.ts` | Callback handler (save, queue sync) |
| `apps/api/src/app/api/github/webhook/webhooks.ts` | All webhook event handlers |
| `apps/api/src/app/api/github/octokit.ts` | GitHub App + Octokit instance |
| `apps/api/src/app/api/github/sync/route.ts` | Dev-only manual sync |
| `apps/api/src/app/api/github/jobs/initial-sync/route.ts` | QStash-triggered initial sync |
| `apps/api/src/lib/oauth-state.ts` | Signed state token utils |

### Our local backend (cli-wrapper)
| File | Purpose |
|---|---|
| `packages/cli-wrapper/src/api/github.ts` | Install + callback (simplified) |
| `packages/cli-wrapper/src/api/web.ts` | Web shim (port 3000, `/integrations/github`) |
| `packages/cli-wrapper/src/api/jwt.ts` | State signing + session JWT |
| `packages/cli-wrapper/src/api/octokit.ts` | Octokit helper |

### Desktop
| File | Purpose |
|---|---|
| `apps/desktop/.../IntegrationsSettings/` | Desktop settings UI ("Manage" button) |

### Web
| File | Purpose |
|---|---|
| `apps/web/.../integrations/github/page.tsx` | Web UI for managing integration |
| `apps/web/.../integrations/github/components/ConnectionControls/` | Connect/disconnect buttons |

---

## TODO — Missing Features for Full Local Parity

- [ ] **Post-install repo sync** — after callback, sync repos accessible to the installation into `github_repositories`
- [ ] **Post-install PR sync** — fetch recent PRs for each repo into `github_pull_requests`
- [ ] **Webhook handler** — process real-time GitHub events (or implement polling as alternative)
- [ ] **tRPC integration router** — our trpc.ts currently stubs most endpoints; need `listRepositories`, `listPullRequests`, `getStats`
- [ ] **Manual sync endpoint** — trigger re-sync from the desktop UI
