import { Hono } from "hono";
import { db } from "@superset/db/client";
import { v2Workspaces, v2Projects, organizations } from "@superset/db/schema";
import * as schemas from "@superset/db/schema";

export const electricRouter = new Hono();
import { IS_VERBOSE } from "./server";

const previousState: Record<string, any[]> = {};

electricRouter.get("/shape", async (c) => {
	const table = c.req.query("table");
	const offset = c.req.query("offset");

	const isInitialSync = !offset || offset === "-1";

	// If this is a subsequent poll, wait a short duration before querying
	// the database again. 1000ms + jitter makes the UI feel responsive while
	// preventing a thundering herd of 23 concurrent queries against the local Neon proxy.
	if (!isInitialSync) {
		const jitter = Math.floor(Math.random() * 500);
		await new Promise((r) => setTimeout(r, 1000 + jitter));
	}

	// Initial sync: return all rows for the table
	const toSnakeCase = (obj: any) => {
		const result: any = {};
		for (const [key, value] of Object.entries(obj)) {
			const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
			if (value instanceof Date) {
				// ElectricSQL usually expects Postgres timestamps as ISO strings
				result[snakeKey] = value.toISOString();
			} else {
				result[snakeKey] = value;
			}
		}
		return result;
	};

	const tableMap: Record<string, any> = {
		v2_workspaces: schemas.v2Workspaces,
		v2_projects: schemas.v2Projects,
		"auth.organizations": schemas.organizations,
		v2_hosts: schemas.v2Hosts,
		v2_clients: schemas.v2Clients,
		v2_users_hosts: schemas.v2UsersHosts,
		tasks: schemas.tasks,
		task_statuses: schemas.taskStatuses,
		workspaces: schemas.workspaces,
		"auth.members": schemas.members,
		"auth.users": schemas.users,
		"auth.invitations": schemas.invitations,
		"auth.teams": schemas.teams,
		"auth.team_members": schemas.teamMembers,
		agent_commands: schemas.agentCommands,
		integration_connections: schemas.integrationConnections,
		subscriptions: schemas.subscriptions,
		"auth.apikeys": schemas.apikeys,
		chat_sessions: schemas.chatSessions,
		github_repositories: schemas.githubRepositories,
		github_pull_requests: schemas.githubPullRequests,
		automations: schemas.automations,
		automation_runs: schemas.automationRuns,
	};

	const messages = [];
	const schemaTable = tableMap[table as string];

	// Artificial delays to prevent local SQLite foreign key constraint races
	// ONLY on initial sync.
	if (isInitialSync) {
		const level1 = [
			"v2_projects", "v2_hosts", "projects", "tasks", "task_statuses",
			"auth.members", "auth.invitations", "auth.teams", "auth.team_members"
		];
		const level2 = ["v2_workspaces", "v2_users_hosts", "v2_clients", "workspaces"];
		
		if (level2.includes(table as string)) {
			await new Promise(r => setTimeout(r, 2000));
		} else if (level1.includes(table as string)) {
			await new Promise(r => setTimeout(r, 1000));
		}
	}

	const currentLsn = Date.now();
	
	if (schemaTable) {
		try {
			const all = await db.select().from(schemaTable);
			
			if (IS_VERBOSE) {
				console.log(`Mock ElectricSQL streaming ${all.length} ${table}...`);
			}
			
			// Ensure previousState array exists for this table
			if (!previousState[table as string]) {
				previousState[table as string] = [];
			}
			const prev = previousState[table as string];
			const currentIds = new Set();
			
			// To ensure the client processes updates/deletes during long polling,
			// we must use a monotonically increasing LSN.
			
			for (const row of all) {
				const primaryKeyId = row.id ?? row.machineId ?? row.userId ?? "1";
				currentIds.add(String(primaryKeyId));
				
				const mapped = toSnakeCase(row);
				if (IS_VERBOSE && table === "v2_workspaces") {
					console.log(`Workspace shape row:`, mapped);
				}
				messages.push({
					headers: { operation: "insert", txid: currentLsn.toString(), lsn: currentLsn.toString(), relation: ["public", table as string] },
					key: `"${primaryKeyId}"`,
					value: mapped,
				});
			}
			
			// Find rows that were deleted
			for (const row of prev) {
				const primaryKeyId = row.id ?? row.machineId ?? row.userId ?? "1";
				if (!currentIds.has(String(primaryKeyId))) {
					messages.push({
						headers: { operation: "delete", txid: currentLsn.toString(), lsn: currentLsn.toString(), relation: ["public", table as string] },
						key: `"${primaryKeyId}"`,
						value: toSnakeCase(row),
					});
				}
			}
			
			// Update previous state
			previousState[table as string] = all;
		} catch (err: any) {
			console.error(`[Mock ElectricSQL] Database error streaming ${table}: ${err.message}`);
			// Return a 500 error so the client knows it failed and will retry
			return c.json({ error: "Database query failed" }, 500);
		}
	}

	messages.push({
		headers: { control: "up-to-date", global_last_seen_lsn: currentLsn },
	});

	c.header("electric-handle", `mock-handle-${table}`);
	c.header("electric-schema", "{}");
	c.header("electric-cursor", currentLsn.toString());
	c.header("electric-offset", `${currentLsn}_0`);
	return c.json(messages);
});
