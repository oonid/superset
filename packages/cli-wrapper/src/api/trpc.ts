import { Hono } from "hono";
import { db } from "@superset/db/client";
import { sessions, users } from "@superset/db/schema/auth";
import { githubInstallations, v2Projects, v2Hosts, v2Workspaces } from "@superset/db/schema";
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
	} else if (c.req.method === "GET") {
		const inputStr = c.req.query("input");
		if (inputStr) {
			try {
				payload = JSON.parse(inputStr);
			} catch (e) {
				payload = {};
			}
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
		const rawInput = payload ? (isBatch ? payload[i.toString()] : payload) : null;
		const inputData = rawInput?.json !== undefined ? rawInput.json : rawInput;

		let res: any = { result: { data: null } };

		function superjsonSerialize(obj: any) {
			const values: any = {};
			function traverse(o: any, path: string) {
				if (!o || typeof o !== "object") return;
				if (o instanceof Date) return; // handled by parent
				for (const [k, v] of Object.entries(o)) {
					const p = path ? `${path}.${k}` : k;
					if (v instanceof Date) {
						values[p] = ["Date"];
					} else if (typeof v === "object") {
						traverse(v, p);
					}
				}
			}
			traverse(obj, "");
			return {
				json: obj,
				...(Object.keys(values).length > 0 ? { meta: { values } } : {})
			};
		}

		if (p === "user.me") {
			res = { result: { data: superjsonSerialize(currentUser) } };
		} else if (p === "organization.list") {
			res = { result: { data: superjsonSerialize([]) } };
		} else if (p === "chat.getModels") {
			res = {
				result: {
					data: superjsonSerialize({
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
					})
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
			res = { result: { data: superjsonSerialize(installationData) } };
		} else if (p === "device.registerDevice") {
			if (currentSession?.activeOrganizationId) {
				const deviceId = inputData?.deviceId || "unknown";
				res = { result: { data: superjsonSerialize({ device: { deviceId }, timestamp: new Date() }) } };
			} else {
				res = { error: { message: "No active organization", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } };
			}
		} else if (p === "user.completeOnboarding") {
			if (currentSession) {
				const [updatedUser] = await db.update(users)
					.set({ onboardedAt: new Date() })
					.where(eq(users.id, currentSession.userId))
					.returning();
				
				if (updatedUser) {
					res = { result: { data: superjsonSerialize(updatedUser) } };
				} else {
					res = { error: { message: "Failed to update user", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } };
				}
			} else {
				res = { error: { message: "Unauthorized", code: -32603, data: { code: "UNAUTHORIZED", httpStatus: 401 } } };
			}
		} else if (p === "v2Project.findByGitHubRemote") {
			const orgId = inputData?.organizationId;
			const repoCloneUrl = inputData?.repoCloneUrl;
			if (orgId && repoCloneUrl) {
				const candidates = await db.query.v2Projects.findMany({
					where: and(
						eq(v2Projects.organizationId, orgId),
						eq(v2Projects.repoCloneUrl, repoCloneUrl)
					),
				});
				res = { result: { data: superjsonSerialize({ candidates }) } };
			} else {
				res = { result: { data: superjsonSerialize({ candidates: [] }) } };
			}
		} else if (p === "v2Project.get") {
			const orgId = inputData?.organizationId;
			const id = inputData?.id;
			if (orgId && id) {
				const project = await db.query.v2Projects.findFirst({
					where: and(
						eq(v2Projects.organizationId, orgId),
						eq(v2Projects.id, id)
					),
				});
				if (project) {
					res = { result: { data: superjsonSerialize(project) } };
				} else {
					res = { error: { message: "NOT_FOUND", code: -32603, data: { code: "NOT_FOUND", httpStatus: 404 } } };
				}
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Project.linkRepoCloneUrl") {
			if (inputData?.id) {
				await db.update(v2Projects)
					.set({ repoCloneUrl: inputData.repoCloneUrl })
					.where(eq(v2Projects.id, inputData.id));
				res = { result: { data: superjsonSerialize({ success: true }) } };
			} else {
				res = { error: { message: "Missing id", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Project.create") {
			try {
				const [newProj] = await db.insert(v2Projects).values({
					id: inputData?.id,
					organizationId: inputData?.organizationId,
					name: inputData?.name,
					slug: inputData?.slug,
					repoCloneUrl: inputData?.repoCloneUrl,
				}).returning();
				res = { result: { data: superjsonSerialize(newProj) } };
			} catch (err: any) {
				// Handle unique constraint violation on slug
				if (err.message?.includes("v2_projects_org_slug_unique")) {
					res = { error: { message: "Project slug already exists", code: -32603, data: { code: "CONFLICT", httpStatus: 409 } } };
				} else {
					console.error(err); res = { error: { message: err.message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } };
				}
			}
		} else if (p === "v2Project.delete") {
			if (inputData?.id) {
				await db.delete(v2Projects).where(eq(v2Projects.id, inputData.id));
				res = { result: { data: superjsonSerialize({ success: true }) } };
			} else {
				res = { error: { message: "Missing id", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "host.ensure") {
			const orgId = inputData?.organizationId;
			const machineId = inputData?.machineId;
			const name = inputData?.name;
			if (orgId && machineId && name) {
				let host = await db.query.v2Hosts.findFirst({
					where: and(
						eq(v2Hosts.organizationId, orgId),
						eq(v2Hosts.machineId, machineId)
					)
				});
				if (!host) {
					const [newHost] = await db.insert(v2Hosts).values({
						organizationId: orgId,
						machineId: machineId,
						name: name,
						isOnline: true,
					}).returning();
					host = newHost;
				}
				
				if (currentSession?.userId) {
					// Ensure user is linked to host
					const { v2UsersHosts } = await import("@superset/db/schema");
					const existingLink = await db.query.v2UsersHosts.findFirst({
						where: and(
							eq(v2UsersHosts.organizationId, orgId),
							eq(v2UsersHosts.hostId, machineId),
							eq(v2UsersHosts.userId, currentSession.userId)
						)
					});
					if (!existingLink) {
						await db.insert(v2UsersHosts).values({
							organizationId: orgId,
							hostId: machineId,
							userId: currentSession.userId,
							role: "owner"
						});
					}
				}
				
				res = { result: { data: superjsonSerialize(host) } };
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Workspace.getFromHost") {
			const orgId = inputData?.organizationId;
			const id = inputData?.id;
			if (orgId && id) {
				const ws = await db.query.v2Workspaces.findFirst({
					where: and(
						eq(v2Workspaces.organizationId, orgId),
						eq(v2Workspaces.id, id)
					)
				});
				if (ws) {
					res = { result: { data: superjsonSerialize(ws) } };
				} else {
					res = { error: { message: "NOT_FOUND", code: -32603, data: { code: "NOT_FOUND", httpStatus: 404 } } };
				}
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Workspace.update") {
			const id = inputData?.id;
			const name = inputData?.name;
			const branch = inputData?.branch;
			const hostId = inputData?.hostId;
			const taskId = inputData?.taskId;
			
			if (id) {
				const patch: any = {};
				if (name !== undefined) patch.name = name;
				if (branch !== undefined) patch.branch = branch;
				if (hostId !== undefined) patch.hostId = hostId;
				if (taskId !== undefined) patch.taskId = taskId;
				
				if (Object.keys(patch).length > 0) {
					const [updated] = await db.update(v2Workspaces)
						.set(patch)
						.where(eq(v2Workspaces.id, id))
						.returning();
					if (updated) {
						res = { result: { data: superjsonSerialize(updated) } };
					} else {
						res = { error: { message: "NOT_FOUND", code: -32603, data: { code: "NOT_FOUND", httpStatus: 404 } } };
					}
				} else {
					res = { error: { message: "No fields to update", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
				}
			} else {
				res = { error: { message: "Missing id", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Workspace.create") {
			const orgId = inputData?.organizationId;
			const projectId = inputData?.projectId;
			const hostId = inputData?.hostId;
			const name = inputData?.name;
			const branch = inputData?.branch;
			const type = inputData?.type;
			if (orgId && projectId && hostId && name && branch) {
				try {
					if (inputData?.id) {
						const existing = await db.query.v2Workspaces.findFirst({
							where: and(
								eq(v2Workspaces.organizationId, orgId),
								eq(v2Workspaces.id, inputData.id)
							)
						});
						if (existing) {
							res = { result: { data: superjsonSerialize(existing) } };
							results.push(res);
							continue;
						}
					}

					// Also check for existing main workspace for this host/project to avoid unique constraint violations
					if (type === "main") {
						const existingMain = await db.query.v2Workspaces.findFirst({
							where: and(
								eq(v2Workspaces.projectId, projectId),
								eq(v2Workspaces.hostId, hostId),
								eq(v2Workspaces.type, "main")
							)
						});
						if (existingMain) {
							res = { result: { data: superjsonSerialize(existingMain) } };
							results.push(res);
							continue;
						}
					}

					const [newWs] = await db.insert(v2Workspaces).values({
						...(inputData?.id ? { id: inputData.id } : {}),
						organizationId: orgId,
						projectId: projectId,
						hostId: hostId,
						name: name,
						branch: branch,
						type: type || "worktree",
					}).returning();
					res = { result: { data: superjsonSerialize(newWs) } };
				} catch (err: any) {
					console.error(err); res = { error: { message: err.message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } };
				}
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Project.list") {
			const orgId = inputData?.organizationId;
			if (orgId) {
				const rows = await db.query.v2Projects.findMany({
					where: eq(v2Projects.organizationId, orgId),
				});
				res = { result: { data: superjsonSerialize(rows) } };
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Project.update") {
			const id = inputData?.id;
			if (id) {
				const patch: any = {};
				if (inputData?.name !== undefined) patch.name = inputData.name;
				if (inputData?.slug !== undefined) patch.slug = inputData.slug;
				if (inputData?.repoCloneUrl !== undefined) patch.repoCloneUrl = inputData.repoCloneUrl;
				
				if (Object.keys(patch).length > 0) {
					const [updated] = await db.update(v2Projects).set(patch).where(eq(v2Projects.id, id)).returning();
					if (updated) {
						res = { result: { data: superjsonSerialize(updated) } };
					} else {
						res = { error: { message: "NOT_FOUND", code: -32603, data: { code: "NOT_FOUND", httpStatus: 404 } } };
					}
				} else {
					res = { error: { message: "No fields to update", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
				}
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Workspace.list") {
			const orgId = inputData?.organizationId;
			if (orgId) {
				const conditions = [eq(v2Workspaces.organizationId, orgId)];
				if (inputData.projectId) conditions.push(eq(v2Workspaces.projectId, inputData.projectId));
				if (inputData.hostId) conditions.push(eq(v2Workspaces.hostId, inputData.hostId));
				const rows = await db.query.v2Workspaces.findMany({
					where: and(...conditions)
				});
				res = { result: { data: superjsonSerialize(rows) } };
			} else {
				res = { error: { message: "Missing input", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
			}
		} else if (p === "v2Workspace.delete" || p === "v2Workspace.deleteMainForHost") {
			const id = inputData?.id;
			if (id) {
				await db.delete(v2Workspaces).where(eq(v2Workspaces.id, id));
				res = { result: { data: superjsonSerialize({ success: true, alreadyGone: false }) } };
			} else {
				res = { error: { message: "Missing id", code: -32603, data: { code: "BAD_REQUEST", httpStatus: 400 } } };
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
