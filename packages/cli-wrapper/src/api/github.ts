import { db } from "@superset/db/client";
import { githubInstallations } from "@superset/db/schema";
import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { generateSignedState, verifySignedState } from "./jwt";
import { getInstallation } from "./octokit";

export const githubRouter = new Hono();

// GET /api/github/install
githubRouter.get("/install", async (c) => {
	// Accept both casings: the upstream web app sends `organizationId`, while the
	// local web shim and CLI use `organization_id`.
	const organizationId =
		c.req.query("organizationId") ?? c.req.query("organization_id");
	const userId = c.req.query("userId") ?? c.req.query("user_id") ?? uuidv4();

	if (!organizationId) {
		return c.redirect(
			"superset://settings/integrations?error=invalid_org_id",
		);
	}

	try {
		const state = generateSignedState(organizationId, userId);
		const githubAppName = process.env.GITHUB_APP_NAME || "superset-sh-dev";

		const redirectUrl = `https://github.com/apps/${githubAppName}/installations/new?state=${state}`;
		return c.redirect(redirectUrl);
	} catch (e) {
		return c.redirect(
			"superset://settings/integrations?error=state_generation_failed",
		);
	}
});

// GET /api/github/callback
githubRouter.get("/callback", async (c) => {
	const state = c.req.query("state");
	const installationId = c.req.query("installation_id");
	const setupAction = c.req.query("setup_action");

	if (setupAction === "cancel") {
		return c.redirect(
			"superset://settings/integrations?error=installation_cancelled",
		);
	}

	if (!installationId || !state) {
		return c.redirect(
			"superset://settings/integrations?error=missing_installation_id",
		);
	}

	let stateData;
	try {
		stateData = verifySignedState(state);
	} catch (e) {
		console.error("State verification failed:", e);
		return c.redirect(
			"superset://settings/integrations?error=invalid_state",
		);
	}

	let installation;
	try {
		installation = await getInstallation(installationId);
	} catch (e) {
		console.error("Failed to fetch installation from GitHub:", e);
		return c.redirect(
			"superset://settings/integrations?error=installation_fetch_failed",
		);
	}

	const accountLogin = installation.account?.login || "";
	const accountType = installation.account?.type || "";

	try {
		await db
			.insert(githubInstallations)
			.values({
				organizationId: stateData.organizationId,
				connectedByUserId: stateData.userId,
				installationId: installation.id.toString(),
				accountLogin,
				accountType,
				permissions: installation.permissions,
				suspended: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [githubInstallations.organizationId],
				set: {
					installationId: installation.id.toString(),
					accountLogin,
					permissions: installation.permissions,
					updatedAt: new Date(),
				},
			});
	} catch (e) {
		console.error("Failed to save installation to database:", e);
		return c.redirect(
			"superset://settings/integrations?error=db_insert_failed",
		);
	}

	console.log(
		`Successfully saved GitHub installation ${installation.id} to DB!`,
	);
	return c.redirect("superset://settings/integrations?success=true");
});
