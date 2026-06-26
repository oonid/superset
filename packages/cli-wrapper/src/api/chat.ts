import { Hono } from "hono";
import { db } from "@superset/db/client";
import { chatSessions } from "@superset/db/schema";
import { sessions, users } from "@superset/db/schema/auth";
import { eq } from "drizzle-orm";

export const chatRouter = new Hono();

// PUT /api/chat/:sessionId
chatRouter.put("/:sessionId", async (c) => {
	const sessionId = c.req.param("sessionId");
	const body = await c.req.json();
	const { organization_id, workspace_id } = body;

	console.log(`Received PUT /api/chat/${sessionId} with org ${organization_id} workspace ${workspace_id}`);

	const authHeader = c.req.header("authorization");
	const token = authHeader?.replace("Bearer ", "");

	let userId = "00000000-0000-0000-0000-000000000000";

	if (token) {
		const session = await db.query.sessions.findFirst({
			where: eq(sessions.token, token),
		});

		if (session) {
			const user = await db.query.users.findFirst({
				where: eq(users.id, session.userId),
			});

			if (user) {
				userId = user.id;
			}
		}
	}

	try {
		await db.insert(chatSessions)
			.values({
				id: sessionId,
				organizationId: organization_id,
				createdBy: userId,
				v2WorkspaceId: workspace_id,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoNothing();

		console.log(`Successfully created chat session ${sessionId}`);
		return c.text("Session created", 200);
	} catch (e) {
		console.error("Failed to create chat session:", e);
		return c.text("Failed to create session", 500);
	}
});
