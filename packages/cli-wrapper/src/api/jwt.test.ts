import { describe, expect, it } from "bun:test";
import { generateSignedState, verifySignedState } from "./jwt";

describe("JWT Auth State Helpers", () => {
	it("should correctly sign and verify an OAuth state", () => {
		const orgId = "11111111-1111-1111-1111-111111111111";
		const userId = "22222222-2222-2222-2222-222222222222";

		const token = generateSignedState(orgId, userId);
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);

		const verified = verifySignedState(token);
		expect(verified.organizationId).toBe(orgId);
		expect(verified.userId).toBe(userId);
	});

	it("should throw an error for invalid tokens", () => {
		expect(() => verifySignedState("invalid.token.string")).toThrow();
	});
});
