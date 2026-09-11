import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { hasCursorLogin } from "../src/acp/auth.js";
import { cursorVersion, resolveCursorCommand } from "../src/acp/process.js";
import { planDecision, questionAnswered, questionCancelled } from "../src/acp/cursor-extension.js";
import { isCursorMode, isPermissionMode, loadConfig, saveConfig, type CursorAcpConfig } from "../src/config.js";
import {
	INTERACTION_RESULT_KIND,
	PACKAGE_VERSION,
	PERMISSION_TOOL_NAME,
	PLAN_TOOL_NAME,
	QUESTION_TOOL_NAME,
} from "../src/constants.js";
import { createCursorProvider } from "../src/provider.js";
import { CursorRuntime, type InteractionToolResult, type InteractionView } from "../src/runtime.js";

export default async function cursorAcpExtension(pi: ExtensionAPI): Promise<void> {
	let config = loadConfig();
	const runtime = new CursorRuntime(config);
	let initialModels;
	if (process.env.PI_OFFLINE !== "1") {
		try { initialModels = (await runtime.discoverModels()).map((item) => item.model); }
		catch { /* auth/CLI problems remain visible through doctor and first use */ }
	}
	const { provider } = createCursorProvider(runtime, initialModels);
	pi.registerProvider(provider);

	pi.registerTool({
		name: PERMISSION_TOOL_NAME,
		label: "Cursor ACP Permission",
		description: "Presents a pending Cursor ACP permission request. Only call IDs emitted by the provider are valid.",
		parameters: requestParameters(),
		executionMode: "sequential",
		async execute(_id, params, _signal, _update, ctx) {
			const view = requireView(runtime.getInteraction(params.requestId), "permission");
			const labels = view.options.map((item, index) => `${index + 1}. ${item.label} [${item.kind.replaceAll("_", " ")}]`);
			let selected: string | undefined;
			try { selected = await ctx.ui.select(view.title, labels); } catch { /* headless denies */ }
			const index = selected === undefined ? -1 : labels.indexOf(selected);
			const option = index >= 0 ? view.options[index] : undefined;
			const response = option ? { outcome: { outcome: "selected", optionId: option.id } } : { outcome: { outcome: "cancelled" } };
			return result(params.requestId, response, option ? `Permission decision recorded: ${option.label}` : "Permission denied.");
		},
	});

	pi.registerTool({
		name: QUESTION_TOOL_NAME,
		label: "Cursor ACP Question",
		description: "Answers a pending structured question from Cursor. Only call IDs emitted by the provider are valid.",
		parameters: requestParameters(),
		executionMode: "sequential",
		async execute(_id, params, _signal, _update, ctx) {
			const view = requireView(runtime.getInteraction(params.requestId), "question");
			const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = [];
			try {
				for (const question of view.questions) {
					if (!question.allowMultiple) {
						const labels = question.options.map((item) => item.label);
						const selected = await ctx.ui.select(`${view.title}\n\n${question.prompt}`, labels);
						const index = selected === undefined ? -1 : labels.indexOf(selected);
						if (index < 0) return result(params.requestId, questionCancelled("Question skipped in Pi"), "Question skipped.");
						answers.push({ questionId: question.id, selectedOptionIds: [question.options[index]!.id] });
						continue;
					}
					const remaining = [...question.options];
					const selectedIds: string[] = [];
					while (remaining.length) {
						const done = selectedIds.length ? "Done selecting" : "Skip this question";
						const labels = [...remaining.map((item) => item.label), done];
						const selected = await ctx.ui.select(`${view.title}\n\n${question.prompt} (choose all that apply)`, labels);
						if (!selected || selected === done) break;
						const index = remaining.findIndex((item) => item.label === selected);
						if (index >= 0) selectedIds.push(remaining.splice(index, 1)[0]!.id);
					}
					answers.push({ questionId: question.id, selectedOptionIds: selectedIds });
				}
			} catch { return result(params.requestId, questionCancelled("No interactive UI available"), "Question cancelled."); }
			return result(params.requestId, questionAnswered(answers), "Cursor questions answered.");
		},
	});

	pi.registerTool({
		name: PLAN_TOOL_NAME,
		label: "Cursor ACP Plan Approval",
		description: "Reviews a pending Cursor plan. Plans are never accepted without an explicit selection.",
		parameters: requestParameters(),
		executionMode: "sequential",
		async execute(_id, params, _signal, _update, ctx) {
			const view = requireView(runtime.getInteraction(params.requestId), "plan");
			let selected: string | undefined;
			try { selected = await ctx.ui.select(`${view.title}${view.overview ? `\n\n${view.overview}` : ""}\n\n${view.plan.slice(0, 16_000)}`, ["Accept plan", "Reject plan"]); }
			catch { /* headless cancels */ }
			const response = selected === "Accept plan" ? planDecision(true) : selected === "Reject plan" ? planDecision(false, "Rejected in Pi") : planDecision(false);
			return result(params.requestId, response, selected ?? "Plan cancelled.");
		},
	});

	pi.registerCommand("cursor-acp", {
		description: "Inspect or configure the Cursor ACP provider",
		handler: async (args, ctx) => {
			const [command = "doctor", value] = args.trim().split(/\s+/u);
			if (command === "mode") {
				if (!isCursorMode(value)) return usage(ctx, "Usage: /cursor-acp mode [agent|plan|ask]");
				config = { ...config, mode: value }; await update(config); ctx.ui.notify(`Cursor mode: ${value}`, "info"); return;
			}
			if (command === "permissions") {
				if (!isPermissionMode(value)) return usage(ctx, "Usage: /cursor-acp permissions [prompt|auto-review|full-access]");
				config = { ...config, permissions: value }; await update(config);
				ctx.ui.notify(`Cursor permissions: ${value}`, value === "full-access" ? "warning" : "info"); return;
			}
			if (command === "pi-tools") {
				if (value !== "on" && value !== "off") return usage(ctx, "Usage: /cursor-acp pi-tools [on|off]");
				config = { ...config, piTools: value === "on" }; await update(config); ctx.ui.notify(`Cursor Pi MCP tools: ${value}`, "info"); return;
			}
			if (command === "sessions" && value === "clear") { runtime.clearSessions(); ctx.ui.notify("Saved Cursor ACP session bindings cleared.", "info"); return; }
			if (command !== "doctor" && command !== "status" && command !== "doctor-verbose") return usage(ctx, "Usage: /cursor-acp [doctor|status|mode|permissions|pi-tools|sessions clear]");
			let binary = "not found"; let version: string | undefined; let authenticated = false;
			try { binary = resolveCursorCommand(); version = cursorVersion(binary); authenticated = await hasCursorLogin(binary); } catch { /* shown below */ }
			const snapshot = await runtime.snapshot(command === "doctor-verbose");
			ctx.ui.notify([
				`Cursor ACP provider ${PACKAGE_VERSION}`,
				`CLI: ${binary} (${version ?? "unknown version"})`,
				`CLI login: ${authenticated ? "authenticated" : "not detected"}`,
				`Mode: ${snapshot.config.mode}; permissions: ${snapshot.config.permissions}; Pi MCP tools: ${snapshot.config.piTools ? "on" : "off"}`,
				`Models: ${snapshot.models}; active bindings: ${snapshot.bindings}`,
				...snapshot.processes.map((item) => `• pid=${item.pid ?? "?"} session=${item.sessionId} model=${item.modelId} alive=${item.alive} restored=${item.restored} waiting=${item.waitingFor ?? "no"} tools=${item.waitingForTools} agent=${item.agentVersion ?? "?"} mcpHttp=${item.mcpHttp}`),
			].join("\n"), authenticated ? "info" : "warning");
		},
	});

	pi.on("session_shutdown", async () => { await runtime.close(); });

	async function update(next: CursorAcpConfig): Promise<void> { saveConfig(next); await runtime.updateConfig(next); }
}

function requestParameters() { return Type.Object({ requestId: Type.String({ minLength: 1, maxLength: 128 }) }); }
function requireView<K extends InteractionView["kind"]>(view: InteractionView | undefined, kind: K): Extract<InteractionView, { kind: K }> {
	if (!view || view.kind !== kind) throw new Error("This Cursor interaction is missing, expired, or already used");
	return view as Extract<InteractionView, { kind: K }>;
}
function result(requestId: string, response: Record<string, unknown>, text: string) {
	const details: InteractionToolResult = { kind: INTERACTION_RESULT_KIND, requestId, response };
	return { content: [{ type: "text" as const, text }], details };
}
function usage(ctx: ExtensionCommandContext, message: string): void { ctx.ui.notify(message, "warning"); }
