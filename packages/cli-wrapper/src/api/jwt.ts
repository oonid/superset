import jwt from "jsonwebtoken";

export interface OAuthState {
	organizationId: string;
	userId: string;
}

function getJwtSecret() {
	return process.env.JWT_SECRET || "super_secret_local_dev_key";
}

export interface SessionJwtUser {
	id: string;
	email: string;
	organizationIds: string[];
}

// Mint a session JWT mirroring the better-auth `jwt()` plugin payload
// ({ sub, email, organizationIds }, 1h, issuer/audience = API URL). The cloud
// backend signs RS256 against a JWKS; the local companion signs HS256 with the
// shared dev secret since it exposes no JWKS endpoint and relay verification is
// bypassed for local installs.
export function signSessionJwt(user: SessionJwtUser): string {
	const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
	return jwt.sign(
		{
			sub: user.id,
			email: user.email,
			organizationIds: user.organizationIds,
		},
		getJwtSecret(),
		{ expiresIn: "1h", issuer: apiUrl, audience: apiUrl },
	);
}

export function generateSignedState(
	organizationId: string,
	userId: string,
): string {
	const claims = {
		organizationId,
		userId,
	};

	// Expires in 15 minutes
	return jwt.sign(claims, getJwtSecret(), { expiresIn: "15m" });
}

export function verifySignedState(token: string): OAuthState {
	const decoded = jwt.verify(token, getJwtSecret()) as any;
	return {
		organizationId: decoded.organizationId,
		userId: decoded.userId,
	};
}
