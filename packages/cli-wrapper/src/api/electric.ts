import { Hono } from "hono";
import { db } from "@superset/db/client";
import { v2Workspaces, v2Projects, organizations } from "@superset/db/schema";

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
			}
		});
	}

	// Initial sync (offset == -1 or omitted): return all rows for the table
	const messages = [];

	if (table === "v2_workspaces") {
		const all = db.select().from(v2Workspaces).all();
		for (const row of all) {
			messages.push({
				headers: { operation: "insert", txid: 1, lsn: 1 },
				value: row,
			});
		}
	} else if (table === "v2_projects") {
		const all = db.select().from(v2Projects).all();
		for (const row of all) {
			messages.push({
				headers: { operation: "insert", txid: 1, lsn: 1 },
				value: row,
			});
		}
	} else if (table === "auth.organizations") {
		const all = db.select().from(organizations).all();
		for (const row of all) {
			messages.push({
				headers: { operation: "insert", txid: 1, lsn: 1 },
				value: row,
			});
		}
	}

	messages.push({
		headers: { control: "up-to-date", txid: 1, lsn: 1 },
	});

	const ndjson = messages.map(m => JSON.stringify(m)).join("\n");
	return new Response(ndjson, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Access-Control-Allow-Origin": "*",
		}
	});
});
