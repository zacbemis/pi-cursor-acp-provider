import type {
	Api,
	ApiStreamOptions,
	AssistantMessageEventStream,
	Context,
	Model,
	Provider,
	RefreshModelsContext,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { hasCursorLogin, loginCursor } from "./acp/auth.js";
import { MANAGED_AUTH_MARKER } from "./constants.js";
import { loadConfig } from "./config.js";
import { FALLBACK_MODELS } from "./models.js";
import { CursorRuntime } from "./runtime.js";

export interface CursorProviderBundle { provider: Provider<"cursor-acp">; runtime: CursorRuntime; }

export function createCursorProvider(runtime = new CursorRuntime(loadConfig())): CursorProviderBundle {
	let models = [...FALLBACK_MODELS];
	const provider: Provider<"cursor-acp"> = {
		id: "cursor-acp",
		name: "Cursor (ACP)",
		auth: {
			oauth: {
				name: "Cursor Agent CLI",
				loginLabel: "Sign in with Cursor",
				async login(interaction) {
					interaction.notify({ type: "progress", message: "Checking Cursor Agent CLI authentication…" });
					await loginCursor(interaction.signal, (message) => interaction.notify({ type: "info", message }));
					return { type: "oauth", refresh: MANAGED_AUTH_MARKER, access: MANAGED_AUTH_MARKER, expires: Number.MAX_SAFE_INTEGER };
				},
				async refresh(credential) { return credential; },
				async toAuth() { return { apiKey: MANAGED_AUTH_MARKER }; },
			},
			apiKey: {
				name: "Cursor API key",
				async login(interaction) {
					const key = await interaction.prompt({ type: "secret", message: "Cursor API key", placeholder: "key_…" });
					if (!key.trim()) throw new Error("Cursor API key is required");
					return { type: "api_key", key: key.trim() };
				},
				async check({ ctx, credential }) {
					if (credential?.key) return { type: "api_key", source: "Pi auth store" };
					if (await ctx.env("CURSOR_API_KEY")) return { type: "api_key", source: "CURSOR_API_KEY" };
					if (await ctx.env("CURSOR_AUTH_TOKEN")) return { type: "api_key", source: "CURSOR_AUTH_TOKEN" };
					if (await hasCursorLogin()) return { type: "api_key", source: "Cursor Agent CLI login" };
					return undefined;
				},
				async resolve({ ctx, credential }) {
					const key = credential?.key ?? await ctx.env("CURSOR_API_KEY");
					if (key) return { auth: { apiKey: key }, source: credential?.key ? "Pi auth store" : "CURSOR_API_KEY" };
					if (await ctx.env("CURSOR_AUTH_TOKEN")) return { auth: { apiKey: MANAGED_AUTH_MARKER }, source: "CURSOR_AUTH_TOKEN" };
					if (await hasCursorLogin()) return { auth: { apiKey: MANAGED_AUTH_MARKER }, source: "Cursor Agent CLI login" };
					return undefined;
				},
			},
		},
		getModels: () => models,
		async refreshModels(context: RefreshModelsContext) {
			if (!context.allowNetwork) return;
			try {
				const definitions = await runtime.discoverModels(context.signal);
				const discovered = definitions.map((item) => item.model);
				if (!discovered.length) return;
				await context.publish({ update: () => { models = discovered; } });
			} catch { /* retain offline fallback */ }
		},
		stream(model, context, options) { return stream(runtime, model, context, options); },
		streamSimple(model, context, options) { return stream(runtime, model, context, options); },
	};
	return { provider, runtime };
}

function stream(runtime: CursorRuntime, model: Model<"cursor-acp">, context: Context, options: ApiStreamOptions<"cursor-acp"> | SimpleStreamOptions | undefined): AssistantMessageEventStream {
	return runtime.stream(model, context, options as SimpleStreamOptions | undefined).stream;
}

export const CURSOR_ACP_API = "cursor-acp" satisfies Api;
