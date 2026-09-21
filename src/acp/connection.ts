import {
	ClientSideConnection,
	PROTOCOL_VERSION,
	RequestError,
	type AuthenticateRequest,
	type InitializeResponse,
	type LoadSessionResponse,
	type McpServer,
	type NewSessionResponse,
	type PromptRequest,
	type PromptResponse,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionConfigOption,
	type SessionNotification,
} from "@agentclientprotocol/sdk";

import { PACKAGE_VERSION } from "../constants.js";
import { boundedNdjsonStream } from "./bounded-stream.js";
import { abortError, CursorAcpError, redact } from "./errors.js";
import { CursorProcess, type CursorProcessOptions } from "./process.js";

const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;

export interface CursorConnectionHandlers {
	onUpdate?: (notification: SessionNotification) => void | Promise<void>;
	onPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
	onExtensionRequest?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
	onExtensionNotification?: (method: string, params: Record<string, unknown>) => void | Promise<void>;
}

export interface CursorConnectionOptions extends CursorProcessOptions {
	handlers?: CursorConnectionHandlers;
	initializeTimeoutMs?: number;
	operationTimeoutMs?: number;
	maxFrameBytes?: number;
}

export class CursorAcpConnection {
	readonly process: CursorProcess;
	readonly initialized: Promise<InitializeResponse>;
	private readonly connection: ClientSideConnection;
	private readonly operationTimeoutMs: number;
	private readonly protocolFailure: Promise<never>;
	private readonly processFailure: Promise<never>;
	private handlers: CursorConnectionHandlers;
	private closePromise?: Promise<void>;

	constructor(options: CursorConnectionOptions) {
		this.handlers = options.handlers ?? {};
		this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
		this.process = new CursorProcess(options);
		let rejectProtocol!: (error: Error) => void;
		this.protocolFailure = new Promise<never>((_resolve, reject) => { rejectProtocol = reject; });
		void this.protocolFailure.catch(() => undefined);
		this.processFailure = this.process.exited.then(({ code, signal }) => {
			throw new CursorAcpError("process_exit", `Cursor ACP exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}. Stderr was withheld from conversation output.`);
		});
		void this.processFailure.catch(() => undefined);
		const stream = boundedNdjsonStream(this.process.output, this.process.input, {
			...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
			onCompatibilityNoise: () => this.process.recordCompatibilityNoise(),
			onProtocolError: (error) => { rejectProtocol(error); void this.process.close(); },
			closeOnProtocolError: true,
		});
		this.connection = new ClientSideConnection(
			() => ({
				requestPermission: async (request) => this.handlers.onPermission?.(request) ?? { outcome: { outcome: "cancelled" } },
				sessionUpdate: async (notification) => { await this.handlers.onUpdate?.(notification); },
				extMethod: async (method, params) => {
					if (!this.handlers.onExtensionRequest) throw RequestError.methodNotFound(method);
					return this.handlers.onExtensionRequest(method, params);
				},
				extNotification: async (method, params) => { await this.handlers.onExtensionNotification?.(method, params); },
			}),
			stream,
		);
		this.initialized = this.withDeadline(this.connection.initialize({
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
				_meta: { parameterizedModelPicker: true },
			},
			clientInfo: { name: "pi-cursor-acp-provider", title: "Pi Cursor ACP Provider", version: PACKAGE_VERSION },
		}), options.initializeTimeoutMs ?? 30_000, "initialize");
		// Initialization can outlive a cancelled catalog refresh.
		void this.initialized.catch(() => undefined);
	}

	setHandlers(handlers: CursorConnectionHandlers): void { this.handlers = handlers; }

	async initialize(signal?: AbortSignal): Promise<InitializeResponse> {
		const response = await this.withAbort(this.initialized, signal);
		if (response.protocolVersion !== PROTOCOL_VERSION) {
			await this.close();
			throw new CursorAcpError("protocol", `Unsupported ACP protocol version ${String(response.protocolVersion)}`);
		}
		return response;
	}

	async authenticate(request: AuthenticateRequest, signal?: AbortSignal, timeoutMs = 180_000): Promise<void> {
		await this.initialize();
		await this.withAbort(this.withDeadline(this.connection.authenticate(request), timeoutMs, "authenticate"), signal);
	}

	async newSession(cwd: string, signal?: AbortSignal, mcpServers: McpServer[] = []): Promise<NewSessionResponse> {
		await this.initialize();
		return this.withAbort(this.withDeadline(this.connection.newSession({ cwd, mcpServers }), this.operationTimeoutMs, "session/new"), signal);
	}

	async loadSession(sessionId: string, cwd: string, mcpServers: McpServer[] = [], signal?: AbortSignal): Promise<LoadSessionResponse> {
		await this.initialize();
		return this.withAbort(this.withDeadline(this.connection.loadSession({ sessionId, cwd, mcpServers }), this.operationTimeoutMs, "session/load"), signal);
	}

	async setModel(sessionId: string, modelId: string, signal?: AbortSignal): Promise<void> {
		await this.withAbort(this.withDeadline(this.connection.unstable_setSessionModel({ sessionId, modelId }), this.operationTimeoutMs, "session/set_model"), signal);
	}

	async setMode(sessionId: string, modeId: string, signal?: AbortSignal): Promise<void> {
		await this.withAbort(this.withDeadline(this.connection.setSessionMode({ sessionId, modeId }), this.operationTimeoutMs, "session/set_mode"), signal);
	}

	async setConfig(sessionId: string, configId: string, value: string | boolean, signal?: AbortSignal): Promise<SessionConfigOption[]> {
		const request = typeof value === "boolean" ? { sessionId, configId, type: "boolean" as const, value } : { sessionId, configId, value };
		const response = await this.withAbort(this.withDeadline(this.connection.setSessionConfigOption(request), this.operationTimeoutMs, "session/set_config_option"), signal);
		return response.configOptions;
	}

	async listAvailableModels(sessionId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
		return this.withAbort(this.withDeadline(this.connection.extMethod("cursor/list_available_models", { sessionId }), this.operationTimeoutMs, "cursor/list_available_models"), signal);
	}

	async prompt(request: PromptRequest, signal?: AbortSignal): Promise<PromptResponse> {
		if (signal?.aborted) throw abortError();
		const pending = this.withDeadline(this.connection.prompt(request), 10 * 60_000, "session/prompt");
		if (!signal) return pending;
		return new Promise((resolve, reject) => {
			let settled = false;
			let killTimer: ReturnType<typeof setTimeout> | undefined;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				if (killTimer) clearTimeout(killTimer);
				signal.removeEventListener("abort", abort);
				fn();
			};
			const abort = () => {
				void this.cancel(request.sessionId).catch(() => undefined);
				killTimer = setTimeout(() => void this.close().finally(() => finish(() => reject(abortError()))), 1_500);
			};
			signal.addEventListener("abort", abort, { once: true });
			pending.then((value) => finish(() => signal.aborted ? reject(abortError()) : resolve(value)), (error) => finish(() => reject(signal.aborted ? abortError() : error)));
		});
	}

	async cancel(sessionId: string): Promise<void> { await this.connection.cancel({ sessionId }); }
	async close(): Promise<void> { this.closePromise ??= this.process.close(); await this.closePromise; }

	private async withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
		// The operation has already started. Observe it before any cancellation
		// branch closes the transport, even when we will not await its result.
		void promise.catch(() => undefined);
		if (!signal) return promise;
		if (signal.aborted) { await this.close(); throw abortError(); }
		return new Promise((resolve, reject) => {
			const abort = () => { void this.close(); reject(abortError()); };
			signal.addEventListener("abort", abort, { once: true });
			promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(classifyError(error)); });
		});
	}

	private async withDeadline<T>(promise: Promise<T>, timeoutMs: number, phase: string): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise.catch((error: unknown) => { throw classifyError(error); }),
				this.protocolFailure,
				this.processFailure,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => { void this.close(); reject(new CursorAcpError("timeout", `Cursor ACP ${phase} timed out after ${timeoutMs}ms`)); }, timeoutMs);
					timer.unref?.();
				}),
			]);
		} finally { if (timer) clearTimeout(timer); }
	}
}

function classifyError(error: unknown): Error {
	if (error instanceof CursorAcpError) return error;
	const structured = error instanceof RequestError ? error : error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number" && typeof (error as { message?: unknown }).message === "string" ? error as { code: number; message: string; data?: unknown } : undefined;
	if (structured) {
		const detail = structuredDetail(structured.data);
		const message = detail ? `${structured.message}: ${detail}` : structured.message;
		if (structured.code === -32000) return new CursorAcpError("auth", `Cursor authentication required: ${message}`, { cause: error });
		return new CursorAcpError("protocol", `Cursor ACP error ${structured.code}: ${message}`, { cause: error });
	}
	return error instanceof Error ? error : new Error(String(error));
}

function structuredDetail(data: unknown): string | undefined {
	if (!data || typeof data !== "object") return undefined;
	const record = data as Record<string, unknown>;
	for (const value of [record.details, record.message]) if (typeof value === "string" && value.trim()) return redact(value.trim());
	return undefined;
}
