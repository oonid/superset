import jwt from "jsonwebtoken";

export interface GitHubAccount {
	login?: string;
	name?: string;
	type?: string;
}

export interface GitHubInstallation {
	id: number;
	account?: GitHubAccount;
	permissions?: any;
}

export async function getInstallation(installationId: string): Promise<GitHubInstallation> {
	const appId = process.env.GITHUB_APP_ID || "123456";
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY || "dummy_key";

	const now = Math.floor(Date.now() / 1000);
	const iat = now - 60;
	const exp = now + 10 * 60;

	const token = jwt.sign(
		{
			iss: appId,
			iat,
			exp,
		},
		privateKey,
		{ algorithm: "RS256" }
	);

	const url = `https://api.github.com/app/installations/${installationId}`;
	
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "superset-dev",
		},
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch installation from GitHub: ${res.status}`);
	}

	return await res.json() as GitHubInstallation;
}
