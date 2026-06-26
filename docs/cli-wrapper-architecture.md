# CLI Wrapper Architecture

The `cli-wrapper` package is a lightweight, local backend daemon built with [Hono](https://hono.dev/) and TypeScript. It replaces the legacy Rust-based local daemon, acting as an essential proxy and mock server for the Superset Desktop App (`superset-dev`).

## Core Responsibilities

1. **Local API Gateway & CORS Proxy**
   The wrapper intercepts network requests from the Desktop App. Because Electron apps run on custom protocols (e.g., `superset://app`), they often face strict CORS restrictions when communicating with external or local APIs. The `cli-wrapper` seamlessly overrides these headers and proxies valid requests to the upstream cloud without triggering security blocks.

2. **tRPC Endpoint Mocking**
   Certain features of the Desktop App expect to communicate with the live Superset cloud. The `cli-wrapper` intercepts these tRPC calls and serves mocked responses directly from the local SQLite database. This ensures the Desktop App remains fully functional in offline or completely localized development environments.

3. **Offline GitHub OAuth Integration**
   The wrapper completely implements the GitHub App installation flow locally. Instead of relying on a centralized cloud callback, the `cli-wrapper` receives the OAuth callback, fetches the `installation_id`, securely extracts metadata from GitHub, and atomically saves the installation directly to the local database using Drizzle ORM.

4. **CLI Command Orchestration**
   The wrapper exposes a robust command-line interface (e.g., `start`, `stop`, `serve`) using `mastracode` and Commander. This allows developers to spin up the local proxy, handle environment validation, and manage backend daemon lifecycles directly from their terminal.

## File Structure

- `/src/api/*`: The Hono router definitions (`server.ts`, `auth.ts`, `github.ts`, `trpc.ts`).
- `/src/commands/*`: The CLI command definitions (e.g., `serve/command.ts`).
- `/scripts/proxy.ts`: An isolated network proxy script.
- `/cli.config.ts`: Instructions for the build system to bundle the CLI into a standalone binary.

## Bundling

During the Desktop App compilation (`apps/desktop`), the `cli-wrapper` is bundled into a self-contained executable binary (`superset-dev` or `superset`) via `build-bundled-cli.ts`. This binary is placed inside the Desktop App's resource folder so that it can be transparently spawned as a background daemon whenever the Desktop App launches.
