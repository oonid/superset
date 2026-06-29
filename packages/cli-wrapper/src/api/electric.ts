import { Hono } from "hono";
import { db } from "@superset/db/client";
import { v2Workspaces, v2Projects, organizations } from "@superset/db/schema";
import * as schemas from "@superset/db/schema";

export const electricRouter = new Hono();

electricRouter.get("/shape", async (c) => {
	const table = c.req.query("table");
	const offset = c.req.query("offset");

	// If this is a subsequent poll (offset != -1), simulate a long-polling
	// stream by holding the connection open for 30s before returning empty.
	// This prevents the Electric client from spinning CPU in an infinite fetch loop.
	if (offset && offset !== "-1") {
		await new Promise((r) => setTimeout(r, 30000));
		const msg = JSON.stringify({ headers: { control: "up-to-date", txid: 1, lsn: 1 } }) + "\n";
		return new Response(msg, {
			headers: {
				"Content-Type": "application/x-ndjson",
				"Access-Control-Allow-Origin": "*",
				"electric-handle": `${table}-handle`,
				"electric-cursor": "1",
				"electric-offset": "1_0",
			},
		});
	}

	// Initial sync (offset == -1 or omitted): return all rows for the table
	const toSnakeCase = (obj: any) => {
		const result: any = {};
		for (const [key, value] of Object.entries(obj)) {
			const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
			if (value instanceof Date) {
				// ElectricSQL usually expects Postgres timestamps as 'YYYY-MM-DD HH:mm:ss.SSS' or similar, without 'T' and 'Z'
				result[snakeKey] = value.toISOString().replace("T", " ").replace("Z", "");
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
	if (table === "v2_workspaces") {
		await new Promise(r => setTimeout(r, 2000)); // depends on orgs, projects, hosts
	} else if (table === "v2_projects" || table === "v2_users_hosts") {
		await new Promise(r => setTimeout(r, 1000)); // depends on orgs / hosts
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
				headers: { operation: "insert", txid: "1", lsn: "1" },
				key: `"${primaryKeyId}"`,
				value: mapped,
			});
		}
	}

	messages.push({
		headers: { control: "up-to-date", global_last_seen_lsn: 1 },
	});

	const ndjson = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
	return new Response(ndjson, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Expose-Headers": "electric-handle, electric-cursor, electric-offset",
			"electric-handle": `mock-handle-${table}`,
			"electric-cursor": "1",
			"electric-offset": "1_0",
		}
	});
});
