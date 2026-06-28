import { db } from "@superset/db/client";
import {
	invitations,
	members,
	organizations,
	sessions,
	teams,
	users,
} from "@superset/db/schema/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { signSessionJwt } from "./jwt";

export const authRouter = new Hono();

// Resolve the authenticated session + user from a Bearer session token.
// Returns null when the header is missing or the token/user no longer exists.
async function resolveSession(authHeader: string | undefined) {
	const token = authHeader?.replace("Bearer ", "");
	if (!token) {
		return null;
	}

	const session = await db.query.sessions.findFirst({
		where: eq(sessions.token, token),
	});
	if (!session) {
		return null;
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, session.userId),
	});
	if (!user) {
		return null;
	}

	return { session, user };
}

// POST /api/auth/sign-in/email
authRouter.post("/sign-in/email", async (c) => {
	const body = await c.req.json();
	const email = body.email;

	// Fetch the user from the real DB
	const user = await db.query.users.findFirst({
		where: eq(users.email, email),
	});

	if (!user) {
		return c.json({ error: "INVALID_EMAIL_OR_PASSWORD" }, 400);
	}

	// Since this is local dev companion app, skip password check and just create a session
	const token = uuidv4();
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

	const activeOrganizationId = user.organizationIds?.[0] ?? null;

	const [session] = await db
		.insert(sessions)
		.values({
			expiresAt,
			token,
			userId: user.id,
			activeOrganizationId,
			updatedAt: new Date(),
		})
		.returning();

	return c.json({
		token,
		user,
		session,
	});
});

// POST /api/auth/sign-up/email
authRouter.post("/sign-up/email", async (c) => {
	const body = await c.req.json();
	const email = body.email;

	const existing = await db.query.users.findFirst({
		where: eq(users.email, email),
	});

	if (existing) {
		return c.json({ error: "USER_ALREADY_EXISTS" }, 400);
	}

	const userName = email.split("@")[0] || "Local Admin";

	const [user] = await db
		.insert(users)
		.values({
			name: userName,
			email,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	const token = uuidv4();
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

	const [session] = await db
		.insert(sessions)
		.values({
			expiresAt,
			token,
			userId: user.id,
			updatedAt: new Date(),
		})
		.returning();

	return c.json({
		token,
		user,
		session,
	});
});

// GET /api/auth/get-session
authRouter.get("/get-session", async (c) => {
	const result = await resolveSession(c.req.header("authorization"));
	if (!result) {
		return c.json({ message: "Unauthorized" }, 401);
	}

	return c.json({
		session: result.session,
		user: result.user,
	});
});

// POST /api/auth/sign-out
authRouter.post("/sign-out", async (c) => {
	const result = await resolveSession(c.req.header("authorization"));
	if (result) {
		await db.delete(sessions).where(eq(sessions.token, result.session.token));
	}
	return c.json({ success: true });
});

// GET /api/auth/token
// Mirrors the better-auth `jwt()` plugin: exchange the current session for a
// short-lived JWT (used by the SDK / host-service / relay paths). Only Bearer
// session tokens are accepted locally (the cloud apiKey `x-api-key` flow is not
// ported into the local companion).
authRouter.get("/token", async (c) => {
	const result = await resolveSession(c.req.header("authorization"));
	if (!result) {
		return c.json({ message: "Unauthorized" }, 401);
	}

	const token = signSessionJwt({
		id: result.user.id,
		email: result.user.email,
		organizationIds: result.user.organizationIds ?? [],
	});

	// Provide token in both body and header to satisfy the client interceptor
	c.header("set-auth-jwt", token);
	return c.json({ token, jwt: token });
});

// Alias for better-auth default jwt endpoint
authRouter.get("/jwt", async (c) => {
	const result = await resolveSession(c.req.header("authorization"));
	if (!result) {
		return c.json({ message: "Unauthorized" }, 401);
	}

	const token = signSessionJwt({
		id: result.user.id,
		email: result.user.email,
		organizationIds: result.user.organizationIds ?? [],
	});

	c.header("set-auth-jwt", token);
	return c.json({ token, jwt: token });
});

// GET /api/auth/organization/get-full-organization
// Mirrors the better-auth organization plugin: return the active organization
// (or `?organizationId=`) with its members (incl. user), teams, and invitations.
authRouter.get("/organization/get-full-organization", async (c) => {
	const result = await resolveSession(c.req.header("authorization"));
	if (!result) {
		return c.json({ message: "Unauthorized" }, 401);
	}

	const organizationId =
		c.req.query("organizationId") ?? result.session.activeOrganizationId;
	if (!organizationId) {
		return c.json(null);
	}

	const organization = await db.query.organizations.findFirst({
		where: eq(organizations.id, organizationId),
	});
	if (!organization) {
		return c.json(null);
	}

	const memberRows = await db
		.select({
			id: members.id,
			organizationId: members.organizationId,
			userId: members.userId,
			role: members.role,
			createdAt: members.createdAt,
			userName: users.name,
			userEmail: users.email,
			userImage: users.image,
		})
		.from(members)
		.innerJoin(users, eq(members.userId, users.id))
		.where(eq(members.organizationId, organizationId));

	const [orgTeams, orgInvitations] = await Promise.all([
		db.query.teams.findMany({
			where: eq(teams.organizationId, organizationId),
		}),
		db.query.invitations.findMany({
			where: eq(invitations.organizationId, organizationId),
		}),
	]);

	return c.json({
		...organization,
		members: memberRows.map((m) => ({
			id: m.id,
			organizationId: m.organizationId,
			userId: m.userId,
			role: m.role,
			createdAt: m.createdAt,
			user: {
				id: m.userId,
				name: m.userName,
				email: m.userEmail,
				image: m.userImage,
			},
		})),
		teams: orgTeams,
		invitations: orgInvitations,
	});
});
