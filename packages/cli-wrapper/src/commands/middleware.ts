import { middleware } from "@superset/cli-framework";
import { trackCommandInvoked } from "@superset/cli/src/lib/analytics";
import { resolveAuth } from "@superset/cli/src/lib/resolve-auth";

export default middleware(async (opts) => {
	if (opts.commandPath.length > 0 && ["serve", "start"].includes(opts.commandPath[0])) {
		return opts.next({
			ctx: { api: null as any, config: null as any, bearer: "", authSource: "none" as any },
		});
	}

	const options = opts.options as { apiKey?: string };
	const { config, api, bearer, authSource } = await resolveAuth(options.apiKey);

	trackCommandInvoked({
		api,
		commandPath: opts.commandPath,
		flags: Object.keys(opts.options).filter(
			(k) => opts.options[k] !== undefined,
		),
	});

	return opts.next({
		ctx: { api, config, bearer, authSource },
	});
});
