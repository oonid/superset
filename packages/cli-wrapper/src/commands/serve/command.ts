import { createCommand, number, string } from "@superset/cli-framework";
import { startServer } from "../../api/server";

export default createCommand()({
	description: "Start the Superset Cloud API backend",
	options: {
		apiPort: number()
			.desc("Port for the API (matches upstream apps/api)")
			.default(3001),
		webPort: number()
			.desc("Port for the web/integrations shim (matches upstream apps/web)")
			.default(3000),
		dbUrl: string().desc("PostgreSQL Database URL").env("DATABASE_URL"),
	},
	run: async ({ options }) => {
		if (!options.dbUrl) {
			throw new Error(
				"Missing required configuration: Database URL must be provided via --db-url or DATABASE_URL environment variable.",
			);
		}
		console.log(`Starting Superset Cloud API on port ${options.apiPort}...`);
		await startServer({
			apiPort: options.apiPort,
			webPort: options.webPort,
			dbUrl: options.dbUrl,
		});
	},
});
