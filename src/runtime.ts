import type {
	ContentBlock,
	InitializeResponse,
	NewSessionResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import type { Context, Model, SimpleStreamOptions, ThinkingLevel, ToolResultMessage } from "@earendil-works/pi-ai";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";

import { CursorAcpConnection, type CursorConnectionOptions } from "./acp/connection.js";
import {
	describeExtensionNotification,
	parseExtensionInteraction,
	planDecision,
	questionCancelled,
	type CursorAskQuestion,
	type CursorCreatePlan,
} from "./acp/cursor-extension.js";
import { abortError, CursorAcpError } from "./acp/errors.js";
import { cursorActionRequired, mapSessionUpdate } from "./acp/events.js";
import { AcpSessionStore } from "./acp/session-store.js";
import type { CursorAcpConfig, CursorMode, PermissionMode } from "./config.js";
import {
	INTERACTION_RESULT_KIND,
	MANAGED_AUTH_MARKER,
	PERMISSION_TOOL_NAME,
	PLAN_TOOL_NAME,
	QUESTION_TOOL_NAME,
} from "./constants.js";
import { PiMcpBridge, piToolFingerprint, type PiToolInvocation } from "./mcp/bridge.js";
import {
	FALLBACK_DEFINITIONS,
	dedupeDefinitions,
	hasOptionValue,
	parseModelExtension,
	parseSessionModels,
	resolveReasoningConfig,
	type CursorModelDefinition,
} from "./models.js";
import { buildPromptParts, type PromptParts } from "./stream/context.js";
import { PiEventWriter } from "./stream/pi-events.js";
import { usageFromPrompt } from "./stream/usage.js";

const INTERACTION_TIMEOUT_MS = 5 * 60_000;
const TOOL_TIMEOUT_MS = 120_000;
const TOOL_BATCH_MS = 100;

type CursorModel = Model<"cursor-acp">;
type InteractionKind = "permission" | "question" | "plan";

export type InteractionView =
	| { id: string; kind: "permission"; title: string; options: Array<{ id: string; label: string; kind: string }> }
	| { id: string; kind: "question"; title: string; questions: CursorAskQuestion["questions"] }
	| { id: string; kind: "plan"; title: string; plan: string; overview?: string };

export interface InteractionToolResult {
	kind: typeof INTERACTION_RESULT_KIND;
	requestId: string;
	response: Record<string, unknown>;
}

interface PendingInteraction {
	id: string;
	kind: InteractionKind;
	toolName: string;
	view: InteractionView;
	resolve: (response: never) => void;
	cancelResponse: Record<string, unknown>;
	timer: ReturnType<typeof setTimeout>;
}

interface PendingPiTool {
	invocation: PiToolInvocation;
	resolve: (result: CallToolResult) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface Binding {
	key: string;
	cwd: string;
	connection: CursorAcpConnection;
	initialize: InitializeResponse;
	session: NewSessionResponse;
	configOptions: SessionConfigOption[];
	modelId: string;
	messageCount: number;
	historyFingerprint: string;
	expectedAssistantFingerprint: string | undefined;
	pendingContextCount: number;
	pendingContextFingerprint: string;
	queue: Promise<void>;
	writer: PiEventWriter | undefined;
	interaction: PendingInteraction | undefined;
	pendingTools: Map<string, PendingPiTool>;
	toolBatchTimer: ReturnType<typeof setTimeout> | undefined;
	bridge: PiMcpBridge | undefined;
	toolFingerprint: string;
	turnCompletion: Promise<void> | undefined;
	abortRequested: boolean;
	piSessionId: string | undefined;
	restored: boolean;
	completedTurns: number;
	actionRequired: string | undefined;
}

export interface RuntimeSnapshot {
	bindings: number;
	config: CursorAcpConfig;
	models: number;
	processes: Array<{
		pid?: number;
		generation: number;
		sessionId: string;
		modelId: string;
		alive: boolean;
		restored: boolean;
		waitingFor?: InteractionKind;
		waitingForTools: number;
		agentVersion?: string;
		mcpHttp: boolean;
		ignoredStdoutNoiseLines: number;
		stderrTail?: string;
	}>;
}

export type CursorConnectionFactory = (options: CursorConnectionOptions) => CursorAcpConnection;

export class CursorRuntime {
	private readonly bindings = new Map<string, Promise<Binding>>();
	private readonly resolvedBindings = new Set<Binding>();
	private readonly sessionStore: AcpSessionStore;
	private readonly connectionFactory: CursorConnectionFactory;
	private definitions = new Map(FALLBACK_DEFINITIONS.map((item) => [item.id, item]));
	private disposed = false;
	private config: CursorAcpConfig;

	constructor(config: CursorAcpConfig, connectionFactory?: CursorConnectionFactory, sessionStore = new AcpSessionStore()) {
		this.config = { ...config };
		this.connectionFactory = connectionFactory ?? ((options) => new CursorAcpConnection(options));
		this.sessionStore = sessionStore;
	}

	stream(model: CursorModel, context: Context, options: SimpleStreamOptions = {}): PiEventWriter {
		const writer = new PiEventWriter(model);
		void this.runQueued(model, context, options, writer).catch((error: unknown) => writer.fail(error, options.signal?.aborted === true || isAbort(error)));
		return writer;
	}

	async discoverModels(apiKey?: string, signal?: AbortSignal): Promise<CursorModelDefinition[]> {
		this.assertActive();
		const connection = this.connectionFactory({
			cwd: process.cwd(),
			permissionMode: "prompt",
			...(apiKey && apiKey !== MANAGED_AUTH_MARKER ? { env: { ...process.env, CURSOR_API_KEY: apiKey } } : {}),
		});
		try {
			const initialize = await connection.initialize();
			await authenticateCursor(connection, initialize, signal);
			const session = await connection.newSession(process.cwd(), signal);
			let definitions: CursorModelDefinition[] = [];
			try { definitions = parseModelExtension(await connection.listAvailableModels(session.sessionId, signal)); }
			catch { /* private extension is optional */ }
			if (!definitions.length) definitions = parseSessionModels(session);
			definitions = dedupeDefinitions(definitions);
			if (definitions.length) this.definitions = new Map(definitions.map((item) => [item.id, item]));
			return definitions.length ? definitions : FALLBACK_DEFINITIONS;
		} finally { await connection.close(); }
	}

	setDefinitions(definitions: readonly CursorModelDefinition[]): void {
		if (definitions.length) this.definitions = new Map(definitions.map((item) => [item.id, item]));
	}

	getInteraction(id: string): InteractionView | undefined {
		for (const binding of this.resolvedBindings) if (binding.interaction?.id === id) return binding.interaction.view;
		return undefined;
	}

	async updateConfig(config: CursorAcpConfig): Promise<void> {
		const rotate = config.permissions !== this.config.permissions || config.piTools !== this.config.piTools;
		this.config = { ...config };
		if (rotate) await this.closeBindings();
		else await Promise.allSettled([...this.resolvedBindings].map((binding) => this.applyConfiguration(binding, binding.modelId)));
	}

	clearSessions(): void { this.sessionStore.clear(); }

	async snapshot(verbose = false): Promise<RuntimeSnapshot> {
		const processes = await Promise.all([...this.bindings.values()].map(async (pending) => {
			const binding = await pending;
			return {
				...(binding.connection.process.pid === undefined ? {} : { pid: binding.connection.process.pid }),
				generation: binding.connection.process.generation,
				sessionId: binding.session.sessionId,
				modelId: binding.modelId,
				alive: binding.connection.process.alive,
				restored: binding.restored,
				...(binding.interaction ? { waitingFor: binding.interaction.kind } : {}),
				waitingForTools: binding.pendingTools.size,
				...(binding.initialize.agentInfo?.version ? { agentVersion: binding.initialize.agentInfo.version } : {}),
				mcpHttp: binding.initialize.agentCapabilities?.mcpCapabilities?.http === true,
				ignoredStdoutNoiseLines: binding.connection.process.ignoredStdoutNoiseLines,
				...(verbose && binding.connection.process.stderrTail ? { stderrTail: binding.connection.process.stderrTail } : {}),
			};
		}));
		return { bindings: this.bindings.size, config: { ...this.config }, models: this.definitions.size, processes };
	}

	async close(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.closeBindings();
	}

	private async closeBindings(): Promise<void> {
		const pending = [...this.bindings.values()];
		this.bindings.clear();
		for (const binding of this.resolvedBindings) {
			cancelInteraction(binding);
			cancelPiTools(binding, "Cursor session closed before Pi returned the tool result");
		}
		this.resolvedBindings.clear();
		await Promise.allSettled(pending.map(async (item) => {
			const binding = await item;
			await Promise.allSettled([binding.connection.close(), binding.bridge?.close() ?? Promise.resolve()]);
		}));
	}

	private async runQueued(model: CursorModel, context: Context, options: SimpleStreamOptions, writer: PiEventWriter): Promise<void> {
		this.assertActive();
		const persistent = Boolean(options.sessionId);
		const key = options.sessionId ? `sid:${options.sessionId}` : this.findContinuationKey(context) ?? `ephemeral:${crypto.randomUUID()}`;
		const tools = context.tools ?? [];
		let binding = await this.getBinding(key, model.id, options.apiKey, writer, tools, options.signal);

		if (binding.interaction) {
			const pending = binding.interaction;
			const result = findInteractionResult(context, pending.id, pending.toolName);
			if (!result) {
				cancelInteraction(binding);
				await this.dropBinding(key, binding);
				binding = await this.getBinding(key, model.id, options.apiKey, writer, tools, options.signal);
			} else {
				binding.writer = writer;
				binding.pendingContextCount = context.messages.length;
				binding.pendingContextFingerprint = messagesFingerprint(context.messages);
				binding.interaction = undefined;
				clearTimeout(pending.timer);
				pending.resolve(validateInteractionResponse(pending, result.response) as never);
				await this.awaitContinuation(binding, options.signal);
				return;
			}
		}

		if (binding.pendingTools.size) {
			const results = [...binding.pendingTools.values()].map((pending) => ({ pending, message: findToolResult(context, pending.invocation.id, pending.invocation.name) }));
			if (results.some((item) => !item.message)) {
				cancelPiTools(binding, "Pi continued without returning every requested tool result");
				await this.dropBinding(key, binding);
				binding = await this.getBinding(key, model.id, options.apiKey, writer, tools, options.signal);
			} else {
				binding.writer = writer;
				binding.pendingContextCount = context.messages.length;
				binding.pendingContextFingerprint = messagesFingerprint(context.messages);
				for (const { pending, message } of results) {
					clearTimeout(pending.timer);
					binding.pendingTools.delete(pending.invocation.id);
					pending.resolve(toMcpToolResult(message as ToolResultMessage));
				}
				await this.awaitContinuation(binding, options.signal);
				return;
			}
		}

		if (binding.toolFingerprint !== piToolFingerprint(tools)) {
			await this.dropBinding(key, binding);
			binding = await this.getBinding(key, model.id, options.apiKey, writer, tools, options.signal);
		}

		const previous = binding.queue;
		let release!: () => void;
		binding.queue = new Promise((resolve) => { release = resolve; });
		await previous;
		let completeTurn: (() => void) | undefined;
		try {
			if (context.messages.length < binding.messageCount || messagesFingerprint(context.messages.slice(0, binding.messageCount)) !== binding.historyFingerprint) {
				if (binding.piSessionId) this.sessionStore.remove(binding.piSessionId);
				await this.dropBinding(key, binding);
				binding = await this.getBinding(key, model.id, options.apiKey, writer, tools, options.signal);
			}
			binding.writer = writer;
			await this.applyConfiguration(binding, model.id, options.reasoning, options.signal);
			const fresh = binding.messageCount === 0;
			let unseenStart = binding.messageCount;
			const expected = context.messages[unseenStart];
			if (!fresh && expected?.role === "assistant" && binding.expectedAssistantFingerprint === messageFingerprint(expected)) unseenStart += 1;
			const parts = adaptPromptToCapabilities(buildPromptParts(context, fresh, unseenStart), binding.initialize);
			binding.pendingContextCount = context.messages.length;
			binding.pendingContextFingerprint = messagesFingerprint(context.messages);
			binding.actionRequired = undefined;
			binding.turnCompletion = new Promise((resolve) => { completeTurn = resolve; });
			const response = await binding.connection.prompt({ sessionId: binding.session.sessionId, prompt: parts.prompt }, options.signal);
			const activeWriter = binding.writer ?? writer;
			if (binding.abortRequested) throw abortError();
			if (binding.actionRequired) throw new CursorAcpError("action_required", binding.actionRequired);
			activeWriter.message.usage = usageFromPrompt(response);
			activeWriter.message.rawStopReason = response.stopReason;
			binding.messageCount = binding.pendingContextCount || parts.messageCount;
			binding.historyFingerprint = binding.pendingContextFingerprint;
			binding.expectedAssistantFingerprint = messageFingerprint(activeWriter.message);
			binding.completedTurns += 1;
			this.persistBinding(binding);
			if (response.stopReason === "cancelled") throw abortError();
			activeWriter.done(response.stopReason === "max_tokens" || response.stopReason === "max_turn_requests" ? "length" : "stop");
		} catch (error) {
			binding.writer?.fail(error, isAbort(error));
			if (!binding.connection.process.alive || (error instanceof CursorAcpError && error.code === "action_required")) await this.dropBinding(key, binding);
			throw error;
		} finally {
			completeTurn?.();
			binding.turnCompletion = undefined;
			binding.abortRequested = false;
			binding.writer = undefined;
			release();
			if (!persistent) await this.dropBinding(key, binding);
		}
	}

	private async getBinding(key: string, modelId: string, apiKey: string | undefined, writer: PiEventWriter, tools: NonNullable<Context["tools"]>, signal?: AbortSignal): Promise<Binding> {
		const existing = this.bindings.get(key);
		if (existing) return existing;
		const created = this.createBinding(key, modelId, apiKey, writer, tools, signal).catch((error) => { this.bindings.delete(key); throw error; });
		this.bindings.set(key, created);
		return created;
	}

	private async createBinding(key: string, modelId: string, apiKey: string | undefined, writer: PiEventWriter, tools: NonNullable<Context["tools"]>, signal?: AbortSignal): Promise<Binding> {
		const cwd = process.cwd();
		let binding: Binding | undefined;
		let bridge: PiMcpBridge | undefined;
		const connection = this.connectionFactory({
			cwd,
			permissionMode: this.config.permissions,
			...(apiKey && apiKey !== MANAGED_AUTH_MARKER ? { env: { ...process.env, CURSOR_API_KEY: apiKey } } : {}),
			handlers: {
				onUpdate: (notification) => this.consumeUpdate(binding, notification),
				onPermission: (request) => this.requestPermission(binding, request),
				onExtensionRequest: (method, params) => this.requestExtension(binding, method, params),
				onExtensionNotification: (method, params) => this.consumeExtension(binding, method, params),
			},
		});
		try {
			const initialize = await connection.initialize();
			await authenticateCursor(connection, initialize, signal);
			if (this.config.piTools && tools.length && initialize.agentCapabilities?.mcpCapabilities?.http === true) {
				bridge = new PiMcpBridge({ tools, onCall: (invocation) => this.requestPiTool(binding, invocation) });
				await bridge.start();
			}
			const descriptor = bridge ? await bridge.start() : undefined;
			const mcpServers = descriptor ? [descriptor] : [];
			const piSessionId = key.startsWith("sid:") ? key.slice(4) : undefined;
			const saved = piSessionId ? this.sessionStore.get(piSessionId) : undefined;
			let session: NewSessionResponse | undefined;
			let restored = false;
			if (saved?.cwd === cwd && initialize.agentCapabilities?.loadSession === true) {
				try {
					const loaded = await connection.loadSession(saved.acpSessionId, cwd, mcpServers, signal);
					session = { sessionId: saved.acpSessionId, ...loaded };
					restored = true;
				} catch { this.sessionStore.remove(saved.piSessionId); }
			}
			session ??= await connection.newSession(cwd, signal, mcpServers);
			const created: Binding = {
				key, cwd, connection, initialize, session,
				configOptions: session.configOptions ?? [],
				modelId,
				messageCount: restored && saved ? saved.messageCount : 0,
				historyFingerprint: restored && saved ? saved.historyFingerprint : messagesFingerprint([]),
				expectedAssistantFingerprint: restored ? saved?.expectedAssistantFingerprint : undefined,
				pendingContextCount: 0,
				pendingContextFingerprint: messagesFingerprint([]),
				queue: Promise.resolve(), writer,
				interaction: undefined,
				pendingTools: new Map(), toolBatchTimer: undefined, bridge,
				toolFingerprint: piToolFingerprint(tools), turnCompletion: undefined,
				abortRequested: false, piSessionId, restored,
				completedTurns: restored ? 1 : 0, actionRequired: undefined,
			};
			binding = created;
			await this.applyConfiguration(created, modelId, undefined, signal);
			this.resolvedBindings.add(created);
			void connection.process.exited.then(() => {
				this.resolvedBindings.delete(created);
				void bridge?.close();
				const current = this.bindings.get(key);
				if (current) void current.then((value) => value === created && this.bindings.delete(key));
			});
			return created;
		} catch (error) {
			await Promise.allSettled([connection.close(), bridge?.close() ?? Promise.resolve()]);
			throw error;
		}
	}

	private async applyConfiguration(binding: Binding, modelId: string, reasoning?: ThinkingLevel, signal?: AbortSignal): Promise<void> {
		let options = binding.configOptions;
		const modelOption = findOption(options, "model");
		if (modelOption && hasOptionValue(modelOption, modelId) && currentValue(modelOption) !== modelId) options = await binding.connection.setConfig(binding.session.sessionId, modelOption.id, modelId, signal);
		else if (!modelOption && binding.session.models?.currentModelId !== modelId) await binding.connection.setModel(binding.session.sessionId, modelId, signal);
		binding.modelId = modelId;

		const modeOption = findOption(options, "mode");
		if (modeOption && hasOptionValue(modeOption, this.config.mode) && currentValue(modeOption) !== this.config.mode) options = await binding.connection.setConfig(binding.session.sessionId, modeOption.id, this.config.mode, signal);
		else if (!modeOption && binding.session.modes?.availableModes.some((mode) => mode.id === this.config.mode) && binding.session.modes.currentModeId !== this.config.mode) await binding.connection.setMode(binding.session.sessionId, this.config.mode, signal);

		for (const desired of [
			...resolveReasoningConfig(options, reasoning),
			...(this.config.context ? [{ id: "context", value: this.config.context }] : []),
			...(this.config.fast === undefined ? [] : [{ id: "fast", value: this.config.fast }]),
		]) {
			const option = options.find((item) => item.id === desired.id);
			if (option && hasOptionValue(option, desired.value) && currentValue(option) !== desired.value) options = await binding.connection.setConfig(binding.session.sessionId, option.id, desired.value, signal);
		}
		binding.configOptions = options;
	}

	private requestPermission(binding: Binding | undefined, request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		if (!binding?.writer || binding.interaction || request.sessionId !== binding.session.sessionId) return Promise.resolve({ outcome: { outcome: "cancelled" } });
		if (this.config.permissions === "full-access") {
			const option = request.options.find((item) => item.kind === "allow_always") ?? request.options.find((item) => item.kind === "allow_once");
			if (option) return Promise.resolve({ outcome: { outcome: "selected", optionId: option.optionId } });
		}
		const call = request.toolCall;
		return this.beginInteraction(binding, "permission", PERMISSION_TOOL_NAME, {
			id: "", kind: "permission",
			title: `${call.title ?? "Cursor requests permission"}\n\n${JSON.stringify({ kind: call.kind, locations: call.locations, content: call.content, rawInput: call.rawInput }, null, 2).slice(0, 8_000)}`,
			options: request.options.map((item) => ({ id: item.optionId, label: item.name, kind: item.kind })),
		}, { outcome: { outcome: "cancelled" } });
	}

	private requestExtension(binding: Binding | undefined, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const interaction = parseExtensionInteraction(method, params);
		if (!binding?.writer || binding.interaction) return Promise.resolve(interaction.kind === "question" ? questionCancelled() : planDecision(false));
		if (interaction.kind === "question") {
			return this.beginInteraction(binding, "question", QUESTION_TOOL_NAME, {
				id: "", kind: "question", title: interaction.request.title ?? "Cursor asks a question", questions: interaction.request.questions,
			}, questionCancelled());
		}
		return this.beginInteraction(binding, "plan", PLAN_TOOL_NAME, {
			id: "", kind: "plan", title: interaction.request.name ?? "Cursor plan approval", plan: interaction.request.plan,
			...(interaction.request.overview ? { overview: interaction.request.overview } : {}),
		}, planDecision(false));
	}

	private beginInteraction<T>(binding: Binding, kind: InteractionKind, toolName: string, view: InteractionView, cancelResponse: Record<string, unknown>): Promise<T> {
		const id = crypto.randomUUID();
		return new Promise<T>((resolve) => {
			const timer = setTimeout(() => {
				if (binding.interaction?.id !== id) return;
				binding.interaction = undefined;
				resolve(cancelResponse as T);
			}, INTERACTION_TIMEOUT_MS);
			timer.unref();
			binding.interaction = { id, kind, toolName, view: { ...view, id } as InteractionView, resolve: resolve as (response: never) => void, cancelResponse, timer };
			binding.writer?.toolCall(id, toolName, { requestId: id });
			binding.writer?.done("toolUse");
		});
	}

	private consumeExtension(binding: Binding | undefined, method: string, params: Record<string, unknown>): void {
		const text = describeExtensionNotification(method, params);
		if (text && binding?.writer && !binding.writer.finished) binding.writer.thinking(text);
	}

	private requestPiTool(binding: Binding | undefined, invocation: PiToolInvocation): Promise<CallToolResult> {
		if (!binding?.writer || binding.writer.finished || binding.interaction) return Promise.resolve({ content: [{ type: "text", text: "Pi cannot accept this tool call in the current turn" }], isError: true });
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (!binding.pendingTools.delete(invocation.id)) return;
				resolve({ content: [{ type: "text", text: "Pi tool call timed out" }], isError: true });
			}, TOOL_TIMEOUT_MS);
			timer.unref();
			binding.pendingTools.set(invocation.id, { invocation, resolve, timer });
			binding.writer?.toolCall(invocation.id, invocation.name, invocation.arguments);
			if (binding.toolBatchTimer) clearTimeout(binding.toolBatchTimer);
			binding.toolBatchTimer = setTimeout(() => { binding.toolBatchTimer = undefined; binding.writer?.done("toolUse"); }, TOOL_BATCH_MS);
			binding.toolBatchTimer.unref();
		});
	}

	private consumeUpdate(binding: Binding | undefined, notification: SessionNotification): void {
		if (!binding || notification.sessionId !== binding.session.sessionId || !binding.writer) return;
		for (const activity of mapSessionUpdate(notification)) {
			if (activity.type === "text") {
				const required = cursorActionRequired(binding.modelId, activity.delta);
				if (required) binding.actionRequired = required;
				else binding.writer.text(activity.delta);
			}
			else if (activity.type === "thought") binding.writer.thinking(activity.delta);
			else if (activity.type === "tool" || activity.type === "plan" || activity.type === "status") binding.writer.thinking(activity.text);
		}
	}

	private async awaitContinuation(binding: Binding, signal?: AbortSignal): Promise<void> {
		const completion = binding.turnCompletion ?? Promise.resolve();
		if (!signal) { await completion; return; }
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const abort = () => {
			if (binding.abortRequested) return;
			binding.abortRequested = true;
			void binding.connection.cancel(binding.session.sessionId).catch(() => undefined);
			killTimer = setTimeout(() => void binding.connection.close(), 1_500);
		};
		if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
		try { await completion; } finally { signal.removeEventListener("abort", abort); if (killTimer) clearTimeout(killTimer); }
	}

	private findContinuationKey(context: Context): string | undefined {
		for (const binding of this.resolvedBindings) {
			if (binding.interaction && findInteractionResult(context, binding.interaction.id, binding.interaction.toolName)) return binding.key;
			if (binding.pendingTools.size && [...binding.pendingTools.values()].every((pending) => findToolResult(context, pending.invocation.id, pending.invocation.name))) return binding.key;
		}
		return undefined;
	}

	private persistBinding(binding: Binding): void {
		if (!binding.piSessionId || binding.completedTurns < 1) return;
		this.sessionStore.save({
			piSessionId: binding.piSessionId, acpSessionId: binding.session.sessionId, acpModelId: binding.modelId, cwd: binding.cwd,
			messageCount: binding.messageCount, historyFingerprint: binding.historyFingerprint,
			...(binding.expectedAssistantFingerprint ? { expectedAssistantFingerprint: binding.expectedAssistantFingerprint } : {}), lastActive: Date.now(),
		});
	}

	private async dropBinding(key: string, binding: Binding): Promise<void> {
		const current = this.bindings.get(key);
		if (current && await current === binding) this.bindings.delete(key);
		this.resolvedBindings.delete(binding);
		cancelInteraction(binding);
		cancelPiTools(binding, "Cursor session closed before Pi returned the tool result");
		await Promise.allSettled([binding.connection.close(), binding.bridge?.close() ?? Promise.resolve()]);
	}

	private assertActive(): void { if (this.disposed) throw new CursorAcpError("process_exit", "Cursor ACP runtime is closed"); }
}

async function authenticateCursor(connection: CursorAcpConnection, initialize: InitializeResponse, signal?: AbortSignal): Promise<void> {
	const method = initialize.authMethods?.find((item) => item.id === "cursor_login") ?? initialize.authMethods?.find((item) => /cursor|login/iu.test(`${item.id} ${item.name}`));
	if (!method) return;
	await connection.authenticate({ methodId: method.id }, signal);
}

function adaptPromptToCapabilities(parts: PromptParts, initialize: InitializeResponse): PromptParts {
	const capabilities = initialize.agentCapabilities?.promptCapabilities;
	const output: ContentBlock[] = [];
	for (const block of parts.prompt) {
		if (block.type === "image" && capabilities?.image !== true) throw new CursorAcpError("invalid_input", "This Cursor ACP runtime did not advertise image input");
		if (block.type === "resource" && capabilities?.embeddedContext !== true) {
			if ("text" in block.resource) output.push({ type: "text", text: block.resource.text });
			continue;
		}
		output.push(block);
	}
	return { ...parts, prompt: output };
}

function findOption(options: readonly SessionConfigOption[], category: string): SessionConfigOption | undefined { return options.find((item) => item.category === category || item.id === category); }
function currentValue(option: SessionConfigOption): string | boolean { return option.currentValue; }

function findInteractionResult(context: Context, id: string, toolName: string): InteractionToolResult | undefined {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (message?.role !== "toolResult" || message.toolName !== toolName || message.toolCallId !== id) continue;
		const details = message.details as Partial<InteractionToolResult> | undefined;
		if (details?.kind === INTERACTION_RESULT_KIND && details.requestId === id && details.response && typeof details.response === "object") return details as InteractionToolResult;
		return { kind: INTERACTION_RESULT_KIND, requestId: id, response: fallbackResponse(toolName) };
	}
	return undefined;
}

function fallbackResponse(toolName: string): Record<string, unknown> {
	if (toolName === PERMISSION_TOOL_NAME) return { outcome: { outcome: "cancelled" } };
	if (toolName === QUESTION_TOOL_NAME) return questionCancelled();
	return planDecision(false);
}

function validateInteractionResponse(pending: PendingInteraction, response: Record<string, unknown>): Record<string, unknown> {
	const outcome = asRecord(response.outcome);
	if (!outcome || typeof outcome.outcome !== "string") return pending.cancelResponse;
	if (pending.kind === "permission" && pending.view.kind === "permission") {
		if (outcome.outcome === "cancelled") return { outcome: { outcome: "cancelled" } };
		if (outcome.outcome === "selected" && typeof outcome.optionId === "string" && pending.view.options.some((option) => option.id === outcome.optionId)) {
			return { outcome: { outcome: "selected", optionId: outcome.optionId } };
		}
		return pending.cancelResponse;
	}
	if (pending.kind === "plan") {
		if (outcome.outcome === "accepted") return { outcome: { outcome: "accepted" } };
		if (outcome.outcome === "cancelled") return { outcome: { outcome: "cancelled" } };
		if (outcome.outcome === "rejected") return { outcome: { outcome: "rejected", ...(typeof outcome.reason === "string" ? { reason: outcome.reason.slice(0, 2_000) } : {}) } };
		return pending.cancelResponse;
	}
	if (pending.kind === "question" && pending.view.kind === "question") {
		if (outcome.outcome === "cancelled") return { outcome: { outcome: "cancelled" } };
		if (outcome.outcome === "skipped") return { outcome: { outcome: "skipped", ...(typeof outcome.reason === "string" ? { reason: outcome.reason.slice(0, 2_000) } : {}) } };
		if (outcome.outcome !== "answered" || !Array.isArray(outcome.answers)) return pending.cancelResponse;
		const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = [];
		const seen = new Set<string>();
		for (const value of outcome.answers) {
			const answer = asRecord(value);
			if (!answer || typeof answer.questionId !== "string" || !Array.isArray(answer.selectedOptionIds) || seen.has(answer.questionId)) return pending.cancelResponse;
			const question = pending.view.questions.find((item) => item.id === answer.questionId);
			if (!question) return pending.cancelResponse;
			const selected = answer.selectedOptionIds.filter((item): item is string => typeof item === "string");
			if (selected.length !== answer.selectedOptionIds.length || new Set(selected).size !== selected.length || selected.some((id) => !question.options.some((option) => option.id === id)) || (!question.allowMultiple && selected.length !== 1)) return pending.cancelResponse;
			seen.add(answer.questionId);
			answers.push({ questionId: answer.questionId, selectedOptionIds: selected });
		}
		if (answers.length !== pending.view.questions.length) return pending.cancelResponse;
		return { outcome: { outcome: "answered", answers } };
	}
	return pending.cancelResponse;
}

function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

function messagesFingerprint(messages: Context["messages"]): string { return createHash("sha256").update(messages.map(messageFingerprint).join("\n")).digest("hex"); }
function messageFingerprint(message: Context["messages"][number]): string {
	const value = message.role === "user" ? { role: message.role, content: message.content } : message.role === "assistant" ? { role: message.role, provider: message.provider, model: message.model, content: message.content } : { role: message.role, toolCallId: message.toolCallId, toolName: message.toolName, content: message.content, isError: message.isError };
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
function findToolResult(context: Context, id: string, name: string): ToolResultMessage | undefined {
	for (let index = context.messages.length - 1; index >= 0; index--) { const message = context.messages[index]; if (message?.role === "toolResult" && message.toolCallId === id && message.toolName === name) return message; }
	return undefined;
}
function toMcpToolResult(message: ToolResultMessage): CallToolResult { return { content: message.content.map((block) => block.type === "text" ? { type: "text" as const, text: block.text } : { type: "image" as const, data: block.data, mimeType: block.mimeType }), isError: message.isError }; }
function cancelInteraction(binding: Binding): void {
	const pending = binding.interaction;
	if (!pending) return;
	clearTimeout(pending.timer);
	pending.resolve(pending.cancelResponse as never);
	binding.interaction = undefined;
}
function cancelPiTools(binding: Binding, reason: string): void {
	if (binding.toolBatchTimer) clearTimeout(binding.toolBatchTimer);
	binding.toolBatchTimer = undefined;
	for (const pending of binding.pendingTools.values()) { clearTimeout(pending.timer); pending.resolve({ content: [{ type: "text", text: reason }], isError: true }); }
	binding.pendingTools.clear();
}
function isAbort(error: unknown): boolean { return error instanceof CursorAcpError ? error.code === "aborted" : error instanceof DOMException && error.name === "AbortError"; }
