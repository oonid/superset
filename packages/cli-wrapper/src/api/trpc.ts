import { Hono } from "hono";
import { db } from "@superset/db/client";
import { sessions, users } from "@superset/db/schema/auth";
import { githubInstallations } from "@superset/db/schema";
import { eq, and } from "drizzle-orm";

export const trpcRouter = new Hono();

// GET and POST /api/trpc/*
trpcRouter.all("/*", async (c) => {
	const path = c.req.path.replace("/api/trpc/", "");
	const isBatch = c.req.query("batch") === "1";
	const paths = path.split(",");
	
	let payload: any = null;
	if (c.req.method === "POST") {
		try {
			payload = await c.req.json();
		} catch (e) {
			payload = {};
		}
	}

	const authHeader = c.req.header("authorization");
	const token = authHeader?.replace("Bearer ", "");

	let currentUser = null;
	let currentSession = null;

	if (token) {
		const session = await db.query.sessions.findFirst({
			where: eq(sessions.token, token),
		});

		if (session) {
			currentSession = session;
			const user = await db.query.users.findFirst({
				where: eq(users.id, session.userId),
			});

			if (user) {
				currentUser = user;
			}
		}
	}

	const results = [];

	for (let i = 0; i < paths.length; i++) {
		const p = paths[i];
		const inputData = payload ? (isBatch ? payload[i.toString()] : payload) : null;

		let res: any = { result: { data: null } };

		if (p === "user.me") {
			res = { result: { data: { json: currentUser } } };
		} else if (p === "organization.list") {
			res = { result: { data: { json: [] } } };
		} else if (p === "chat.getModels") {
			res = {
				result: {
					data: {
						json: {
							models: [
								{ id: "anthropic/claude-opus-4-8", name: "Opus 4.8", provider: "Anthropic" },
								{ id: "anthropic/claude-opus-4-7", name: "Opus 4.7", provider: "Anthropic" },
								{ id: "anthropic/claude-fable-5", name: "Fable 5", provider: "Anthropic" },
								{ id: "anthropic/claude-sonnet-4-6", name: "Sonnet 4.6", provider: "Anthropic" },
								{ id: "anthropic/claude-haiku-4-5", name: "Haiku 4.5", provider: "Anthropic" },
								{ id: "openai/gpt-5.5", name: "GPT-5.5", provider: "OpenAI" },
								{ id: "openai/gpt-5.4", name: "GPT-5.4", provider: "OpenAI" },
								{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "OpenAI" },
							],
						}
					},
				},
			};
		} else if (p === "integration.github.getInstallation") {
			let installationData = null;
			let inputStr = c.req.query("input");
			if (inputStr) {
				try {
					const parsed = JSON.parse(inputStr);
					const orgId = parsed?.[0]?.json?.organizationId || parsed?.json?.organizationId;
					
					if (orgId) {
						const installation = await db.query.githubInstallations.findFirst({
							where: eq(githubInstallations.organizationId, orgId),
						});
						
						if (installation) {
							installationData = {
								id: installation.id,
								accountLogin: installation.accountLogin,
								accountType: installation.accountType,
								suspended: installation.suspended,
								lastSyncedAt: installation.lastSyncedAt,
								createdAt: installation.createdAt,
							};
						}
					}
				} catch (e) {}
			}
			res = { result: { data: { json: installationData } } };
		} else if (p === "device.registerDevice") {
			if (currentSession?.activeOrganizationId) {
				const deviceId = inputData?.deviceId || "unknown";
				// Skip DB insertion for device presence since it's just a mock
				res = { result: { data: { json: { device: { deviceId }, timestamp: new Date() } } } };
			} else {
				res = { error: { message: "No active organization" } };
			}
		} else if (p === "user.completeOnboarding") {
			if (currentSession) {
				const [updatedUser] = await db.update(users)
					.set({ onboardedAt: new Date() })
					.where(eq(users.id, currentSession.userId))
					.returning();
				
				if (updatedUser) {
					res = { result: { data: { json: updatedUser } } };
				} else {
					res = { error: { message: "Failed to update user" } };
				}
			} else {
				res = { error: { message: "Unauthorized" } };
			}
		} else {
			console.warn(`Unimplemented tRPC query/mutation: ${p}`);
		}

		results.push(res);
	}

	if (isBatch) {
		return c.json(results);
	} else {
		return c.json(results[0] || {});
	}
});
