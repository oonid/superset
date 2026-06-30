import { expect, test, describe, mock } from "bun:test";
import { trpcRouter } from "./trpc";

describe("TRPC Mock Backend", () => {
	const orgId = "8d6b5d7b-0075-4545-9b8f-53a55c2401f9";
	const projectId = "9584e52c-9f0f-4544-acde-4d8933a26138";
	const hostId = "fbc993198c459a5c98aa88d07f4d5094";

	async function runBatchRequest(paths: string, batchBody: any) {
		const req = new Request(`http://localhost/api/trpc/${paths}?batch=1`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(batchBody)
		});
		const res = await trpcRouter.fetch(req);
		return res;
	}

	test("should return 200 and handle host.ensure successfully", async () => {
		const res = await runBatchRequest("host.ensure", {
			"0": {
				json: { organizationId: orgId, machineId: hostId, name: "test-host" }
			}
		});
		expect(res.status).toBe(200);
		const json: any = await res.json();
		expect(json[0].result.data.json.machineId).toBe(hostId);
	});

	test("should return 200 and handle v2Workspace.create with type=main existing successfully without crash", async () => {
		const res = await runBatchRequest("v2Workspace.create", {
			"0": {
				json: {
					organizationId: orgId,
					projectId,
					hostId,
					name: "master",
					branch: "master",
					type: "main"
				}
			}
		});
		expect(res.status).toBe(200);
		const json: any = await res.json();
		expect(json[0].result).toBeDefined();
		expect(json[0].error).toBeUndefined();
	});

	test("should return 200 and handle v2Workspace.create with random id without crash", async () => {
		const res = await runBatchRequest("v2Workspace.create", {
			"0": {
				json: {
					organizationId: orgId,
					projectId,
					hostId,
					name: "test-new",
					branch: "test-new",
					type: "worktree"
				}
			}
		});
		expect(res.status).toBe(200);
		const json: any = await res.json();
		expect(json[0].result).toBeDefined();
		expect(json[0].error).toBeUndefined();
	});
});
