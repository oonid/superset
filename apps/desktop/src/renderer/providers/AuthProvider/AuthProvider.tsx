import { type ReactNode, useEffect, useState } from "react";
import { env } from "renderer/env.renderer";
import { authClient, getAuthToken, setAuthToken, setJwt } from "renderer/lib/auth-client";
import { SupersetLogo } from "renderer/routes/sign-in/components/SupersetLogo/SupersetLogo";
import { electronTrpc } from "../../lib/electron-trpc";

export function AuthProvider({ children }: { children: ReactNode }) {
	const [isHydrated, setIsHydrated] = useState(false);
	const { refetch: refetchSession } = authClient.useSession();

	const { data: storedToken, isSuccess } =
		electronTrpc.auth.getStoredToken.useQuery(undefined, {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		});

	useEffect(() => {
		if (!isSuccess || isHydrated) return;

		let cancelled = false;

		async function hydrate() {
			if (storedToken?.token && storedToken?.expiresAt) {
				const isExpired = new Date(storedToken.expiresAt) < new Date();
				if (!isExpired) {
					setAuthToken(storedToken.token);
					try {
						await refetchSession();
					} catch (err) {
						console.warn(
							"[AuthProvider] session refetch failed during hydration",
							err,
						);
					}
					try {
						const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/auth/token`, {
							headers: {
								Authorization: `Bearer ${storedToken.token}`
							}
						}).then(r => r.json());
						
						if (res?.token) {
							setJwt(res.token);
						}
					} catch (err) {
						console.warn(
							"[AuthProvider] JWT fetch failed during hydration",
							err,
						);
					}
				}
			}
			if (!cancelled) {
				setIsHydrated(true);
			}
		}

		hydrate();
		return () => {
			cancelled = true;
		};
	}, [storedToken, isSuccess, isHydrated, refetchSession]);

	electronTrpc.auth.onTokenChanged.useSubscription(undefined, {
		onData: async (data) => {
			if (data?.token && data?.expiresAt) {
				setAuthToken(null);
				await authClient.signOut({ fetchOptions: { throw: false } });
				setAuthToken(data.token);
				try {
					await refetchSession();
				} catch (err) {
					console.warn(
						"[AuthProvider] session refetch failed after token change",
						err,
					);
				}
				setIsHydrated(true);
			} else if (data === null) {
				setAuthToken(null);
				setJwt(null);
				try {
					await refetchSession();
				} catch (err) {
					console.warn(
						"[AuthProvider] session refetch failed after token cleared",
						err,
					);
				}
			}
		},
	});

	useEffect(() => {
		if (!isHydrated) return;

		const refreshJwt = () => {
			const token = getAuthToken();
			if (!token) return Promise.resolve();
			
			return fetch(`${env.NEXT_PUBLIC_API_URL}/api/auth/token`, {
				headers: {
					Authorization: `Bearer ${token}`
				}
			})
				.then((res) => res.json())
				.then((res) => {
					if (res?.token) {
						setJwt(res.token);
					}
				})
				.catch((err: unknown) => {
					console.warn("[AuthProvider] JWT refresh failed", err);
				});
		};

		refreshJwt();
		const interval = setInterval(refreshJwt, 50 * 60 * 1000);
		return () => clearInterval(interval);
	}, [isHydrated]);

	if (!isHydrated) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-background">
				<SupersetLogo className="h-8 w-auto" gradient />
			</div>
		);
	}

	return <>{children}</>;
}
