import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UPSTREAM_DIR = "../cli/src/commands";
const TARGET_DIR = "./src/commands";

function scanAndProxy(dir: string, currentPath: string) {
	const entries = readdirSync(dir);
	mkdirSync(join(TARGET_DIR, currentPath), { recursive: true });

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		
		if (stat.isDirectory()) {
			scanAndProxy(fullPath, join(currentPath, entry));
		} else if (entry === "command.ts" || entry === "group.ts" || entry === "middleware.ts") {
			// Write proxy export
			const proxyPath = join(TARGET_DIR, currentPath, entry);
			const importPath = `@superset/cli/src/commands/${currentPath ? currentPath + '/' : ''}${entry.replace('.ts', '')}`;
			writeFileSync(proxyPath, `export { default } from "${importPath}";\n`);
		}
	}
}

console.log("Generating proxy commands...");
scanAndProxy(UPSTREAM_DIR, "");
console.log("Done!");
