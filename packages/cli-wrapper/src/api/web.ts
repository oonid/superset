import { db } from "@superset/db/client";
import { organizations, sessions } from "@superset/db/schema/auth";
import { desc, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

export const webRouter = new Hono();

// Resolve the organization for the locally signed-in user. The integrations
// flow is launched in the system browser, which carries no Superset session, so
// we cannot read it from a request. Instead resolve server-side from the most
// recent session that has an active organization (i.e. whoever is signed into
// the desktop), falling back to the first organization on record.
async function resolveActiveSessionData(): Promise<{ organizationId: string; userId: string } | null> {
	const session = await db.query.sessions.findFirst({
		where: isNotNull(sessions.activeOrganizationId),
		orderBy: desc(sessions.createdAt),
	});
	if (session?.activeOrganizationId && session.userId) {
		return { organizationId: session.activeOrganizationId, userId: session.userId };
	}

	return null;
}

// GET /integrations/github
// Stand-in for the upstream `apps/web` integrations page, which is not bundled
// in the Linux installer. The desktop opens this URL in the browser; we resolve
// the org and silently redirect into the backend GitHub App install flow. The
// redirect is relative, so it stays on whichever port served this request.
webRouter.get("/github", async (c) => {
	const sessionData = await resolveActiveSessionData();
	if (!sessionData) {
		return c.redirect(
			"superset://settings/integrations?error=no_organization",
		);
	}

	return c.redirect(`/api/github/install?organization_id=${sessionData.organizationId}&user_id=${sessionData.userId}`);
});
