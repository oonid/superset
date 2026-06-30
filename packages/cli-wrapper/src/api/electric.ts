import { Hono } from "hono";
import { db } from "@superset/db/client";
import { v2Workspaces, v2Projects, organizations } from "@superset/db/schema";
import * as schemas from "@superset/db/schema";

export const electricRouter = new Hono();

electricRouter.get("/shape", async (c) => {
	const table = c.req.query("table");
	const offset = c.req.query("offset");

	// If this is a subsequent poll (offset != -1), wait 3 seconds before querying
	// the database again. This simulates long-polling while allowing the mock
	// to "push" newly created workspaces (like when created via TRPC).
	if (offset && offset !== "-1") {
		await new Promise((r) => setTimeout(r, 3000));
	}

	// Initial sync (offset == -1 or omitted): return all rows for the table
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

	// Artificial delays to prevent local SQLite foreign key constraint races.
	// Since all shape streams start concurrently, tables with dependencies
	// must arrive AFTER their parent tables.
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

	if (schemaTable) {
		const all = await db.select().from(schemaTable);
		console.log(`Mock ElectricSQL streaming ${all.length} ${table}...`);
		for (const row of all) {
			const mapped = toSnakeCase(row);
			if (table === "v2_workspaces") {
				console.log(`Workspace shape row:`, mapped);
			}
			
			// Extract id if available (for auth tables it might not exist or be different)
			const primaryKeyId = row.id ?? row.machineId ?? row.userId ?? "1";
			messages.push({
				headers: { operation: "insert", txid: "1", lsn: "1", relation: ["public", table as string] },
				key: `"${primaryKeyId}"`,
				value: mapped,
			});
		}
	}

	messages.push({
		headers: { control: "up-to-date", global_last_seen_lsn: 1 },
	});

	const ndjson = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
	c.header("Content-Type", "application/x-ndjson");
	c.header("electric-handle", `mock-handle-${table}`);
	c.header("electric-schema", "{}");
	c.header("electric-cursor", "1");
	c.header("electric-offset", "1_0");
	return c.body(ndjson);
});
