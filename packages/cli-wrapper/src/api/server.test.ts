import { describe, expect, it, mock } from "bun:test";

// Mock the DB client before importing the app
mock.module("@superset/db/client", () => ({
	db: {
		query: {
			users: {
				findFirst: mock(async () => null),
			},
			sessions: {
				findFirst: mock(async () => null),
			},
			organizations: {
				findFirst: mock(async () => null),
			},
			githubInstallations: {
				findFirst: mock(async () => null),
			},
		},
		insert: mock(() => ({
			values: mock(() => ({
				returning: mock(async () => [{ id: "mock-id", token: "mock-token" }]),
				onConflictDoNothing: mock(async () => {}),
				onConflictDoUpdate: mock(async () => {}),
			})),
		})),
		update: mock(() => ({
			set: mock(() => ({
				where: mock(() => ({
					returning: mock(async () => [{ id: "mock-id" }]),
				})),
			})),
		})),
	},
}));

import { app } from "./server";

describe("TS API Backend", () => {
	it("GET /api/health should return OK", async () => {
		const res = await app.request("/api/health");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("OK");
	});

	it("POST /api/auth/sign-in/email should return 400 for invalid user", async () => {
		const res = await app.request("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "test@example.com" }),
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json).toHaveProperty("error", "INVALID_EMAIL_OR_PASSWORD");
	});

	it("POST /api/auth/sign-up/email should create a user successfully", async () => {
		const res = await app.request("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "new@example.com" }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json).toHaveProperty("token");
		expect(json.user.id).toBe("mock-id");
	});

	it("GET /api/auth/token should require auth (not 404)", async () => {
		const res = await app.request("/api/auth/token");
		expect(res.status).toBe(401);
	});

	it("GET /api/auth/organization/get-full-organization should require auth (not 404)", async () => {
		const res = await app.request(
			"/api/auth/organization/get-full-organization",
		);
		expect(res.status).toBe(401);
	});

	it("GET /integrations/github web shim should redirect (not 404)", async () => {
		const res = await app.request("/integrations/github");
		expect(res.status).toBe(302);
		// No org resolvable in the mock → falls back to the desktop deep link.
		expect(res.headers.get("location")).toContain(
			"superset://app/settings/integrations",
		);
	});

	it("GET /api/github/install should redirect with state", async () => {
		const res = await app.request(
			"/api/github/install?organization_id=11111111-1111-1111-1111-111111111111",
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toContain("state=");
	});

	it("PUT /api/chat/:sessionId should create session", async () => {
		const res = await app.request("/api/chat/my-session-id", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ organization_id: "org", workspace_id: "ws" }),
		});
		expect(res.status).toBe(200);
	});

	it("GET /api/trpc/chat.getModels should return static models", async () => {
		const res = await app.request("/api/trpc/chat.getModels");
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json.result.data.models.length).toBeGreaterThan(0);
	});
});
