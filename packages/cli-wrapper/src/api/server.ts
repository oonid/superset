import { serve } from "@hono/node-server";
import { db } from "@superset/db/client";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRouter } from "./auth";
import { chatRouter } from "./chat";
import { githubRouter } from "./github";
import { trpcRouter } from "./trpc";
import { webRouter } from "./web";

export interface ServerConfig {
	apiPort: number;
	webPort: number;
	dbUrl: string;
	verbose?: boolean;
}

export let IS_VERBOSE = false;

// Hostname that routes the Neon serverless driver at the local neon-http proxy
// (see packages/db/src/local-proxy.ts).
const LOCAL_PROXY_HOST = "db.localtest.me";

// Human-readable description of the database target from its connection URL.
function describeDatabase(dbUrl: string): string {
	try {
		const url = new URL(dbUrl);
		const where = `${url.hostname}:${url.port || "5432"}`;
		return url.hostname === LOCAL_PROXY_HOST
			? `PostgreSQL via local Neon HTTP proxy (${where})`
			: `Neon serverless Postgres (${where})`;
	} catch {
		return "database (unparseable connection URL)";
	}
}

export const app = new Hono();

// Request logging via Hono's built-in logger, controlled by the `LOG_LEVEL` env var.
// Set LOG_LEVEL=silent (or off/none) to disable request logs; any other value enables them.
const logLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
if (!["silent", "off", "none"].includes(logLevel)) {
	app.use(
		"*",
		logger((str, ...rest) => {
			if (!IS_VERBOSE && str.includes("/v1/shape")) return;
			console.log(str, ...rest);
		}),
	);
}
app.use(
	"*",
	cors({
		exposeHeaders: ["set-auth-jwt", "electric-handle", "electric-cursor", "electric-offset", "electric-schema", "electric-up-to-date"],
	}),
);

app.get("/", (c) => c.text("Superset TS Backend is running!"));
app.get("/api/health", (c) => c.text("OK"));

import { electricRouter } from "./electric";

app.route("/api/auth", authRouter);
app.route("/api/github", githubRouter);
app.route("/api/chat", chatRouter);
app.route("/api/trpc", trpcRouter);
app.route("/v1", electricRouter);
// Web/integrations shim — stands in for upstream apps/web, which is not bundled
// in the Linux installer. Served on the web port alongside the API.
app.route("/integrations", webRouter);

export async function startServer(config: ServerConfig): Promise<void> {
	if (config.verbose) {
		IS_VERBOSE = true;
	}

	// Bind the same app to both upstream-convention ports in one process:
	// apps/api (default 3001) for the API, apps/web (default 3000) for the
	// browser-launched integrations shim. Both ports serve the full app, so the
	// shim's relative redirect into /api/github/install stays on whatever port
	// the browser used.
	serve({ fetch: app.fetch, port: config.apiPort, hostname: "::" }, (info) => {
		console.log(`Listening on http://localhost:${info.port} (api)`);
	});

	if (config.webPort !== config.apiPort) {
		try {
			serve({ fetch: app.fetch, port: config.webPort, hostname: "::" }, (info) => {
				console.log(`Listening on http://localhost:${info.port} (web)`);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(
				`Web shim: failed to bind port ${config.webPort} — ${message}`,
			);
		}
	}

	// Also bind to the default ElectricSQL port (8787) so the UI's baked-in 
	// NEXT_PUBLIC_ELECTRIC_URL hits our mock /v1/shape endpoint without needing rebuild overrides.
	try {
		serve({ fetch: app.fetch, port: 8787, hostname: "::" }, (info) => {
			console.log(`Listening on http://localhost:${info.port} (mock ElectricSQL)`);
		});
	} catch (error) {
		console.warn(`Mock ElectricSQL: failed to bind port 8787 — ${error}`);
	}

	// Verify database connectivity at startup and report the target so operators
	// know whether the server reached PostgreSQL / the local Neon proxy.
	const target = describeDatabase(config.dbUrl);
	try {
		await db.execute(sql`select 1`);
		console.log(`Database: connected to ${target}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Database: connection failed to ${target} — ${message}`);
	}

	// Verify GitHub App credentials at startup
	const ghAppId = process.env.GH_APP_ID || process.env.GITHUB_APP_ID;
	const ghPrivateKey = process.env.GH_APP_PRIVATE_KEY || process.env.GITHUB_APP_PRIVATE_KEY;
	if (ghAppId && ghPrivateKey) {
		console.log(`GitHub App: Loaded credentials for App ID ${ghAppId}`);
	} else {
		console.warn(`GitHub App: Warning — Missing GH_APP_ID or GH_APP_PRIVATE_KEY. The GitHub integration will not work properly.`);
	}
}
