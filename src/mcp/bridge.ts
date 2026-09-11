import type { McpServer as AcpMcpServer } from "@agentclientprotocol/sdk";
import type { Tool } from "@earendil-works/pi-ai";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Value } from "typebox/value";

import { CursorAcpError } from "../acp/errors.js";
import { PACKAGE_VERSION, PERMISSION_TOOL_NAME, PLAN_TOOL_NAME, QUESTION_TOOL_NAME } from "../constants.js";

const BODY_LIMIT = 1024 * 1024;
const SCHEMA_LIMIT = 64 * 1024;
const MAX_TOOLS = 64;

interface BridgeTool {
	mcpName: string;
	piName: string;
	description: string;
	inputSchema: Record<string, unknown>;
	originalSchema: Tool["parameters"];
}

export interface PiToolInvocation {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface PiMcpBridgeOptions {
	tools: readonly Tool[];
	onCall: (invocation: PiToolInvocation) => Promise<CallToolResult>;
}

export function piToolFingerprint(tools: readonly Tool[]): string {
	const projected = projectTools(tools, []);
	return JSON.stringify(projected.map((tool) => [tool.mcpName, tool.inputSchema]));
}

export class PiMcpBridge {
	readonly fingerprint: string;
	readonly omissions: string[] = [];
	private readonly token = crypto.randomUUID().replaceAll("-", "");
	private readonly tools: BridgeTool[];
	private server: ReturnType<typeof createServer> | undefined;
	private url: string | undefined;

	constructor(private readonly options: PiMcpBridgeOptions) {
		this.tools = projectTools(options.tools, this.omissions);
		this.fingerprint = JSON.stringify(this.tools.map((tool) => [tool.mcpName, tool.inputSchema]));
	}

	get empty(): boolean {
		return this.tools.length === 0;
	}

	async start(): Promise<AcpMcpServer | undefined> {
		if (this.empty) return undefined;
		if (this.server && this.url) return this.descriptor();
		this.server = createServer((request, response) => {
			void this.handle(request, response).catch(() => {
				if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
				response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "MCP bridge error" } }));
			});
		});
		this.server.maxConnections = 8;
		await new Promise<void>((resolve, reject) => {
			this.server?.once("error", reject);
			this.server?.listen(0, "127.0.0.1", resolve);
		});
		const address = this.server.address();
		if (!address || typeof address === "string") throw new CursorAcpError("spawn", "MCP bridge failed to bind");
		this.url = `http://127.0.0.1:${address.port}/mcp`;
		return this.descriptor();
	}

	async close(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.url = undefined;
		if (!server) return;
		const closed = new Promise<void>((resolve) => server.close(() => resolve()));
		server.closeAllConnections?.();
		await closed;
	}

	private descriptor(): AcpMcpServer {
		if (!this.url) throw new CursorAcpError("spawn", "MCP bridge is not listening");
		return {
			type: "http",
			name: "pi-bridge",
			url: this.url,
			headers: [{ name: "Authorization", value: `Bearer ${this.token}` }],
		};
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (request.url !== "/mcp" || request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		if (!this.validRequestOrigin(request)) {
			response.writeHead(403).end();
			return;
		}
		if (!validBearerToken(request.headers.authorization, this.token)) {
			response.writeHead(401).end();
			return;
		}
		const body = await readJson(request);
		const protocol = new Server(
			{ name: "pi-cursor-acp-tools", version: PACKAGE_VERSION },
			{ capabilities: { tools: {} } },
		);
		protocol.setRequestHandler(ListToolsRequestSchema, () => ({
			tools: this.tools.map((tool) => ({
				name: tool.mcpName,
				description: tool.description,
				inputSchema: tool.inputSchema as { type: "object"; properties?: Record<string, object> },
			})),
		}));
		protocol.setRequestHandler(CallToolRequestSchema, async (call) => {
			const tool = this.tools.find((candidate) => candidate.mcpName === call.params.name);
			if (!tool) return toolError("Unknown or inactive Pi tool");
			const args = call.params.arguments ?? {};
			try {
				if (!Value.Check(tool.originalSchema, args)) {
					return toolError("Arguments failed the original Pi tool schema");
				}
			} catch {
				return toolError("The original Pi tool schema could not validate these arguments");
			}
			return this.options.onCall({ id: crypto.randomUUID(), name: tool.piName, arguments: args });
		});
		const transport = new StreamableHTTPServerTransport(
			{ sessionIdGenerator: undefined } as unknown as ConstructorParameters<
				typeof StreamableHTTPServerTransport
			>[0],
		);
		try {
			await protocol.connect(transport as Parameters<typeof protocol.connect>[0]);
			await transport.handleRequest(request, response, body);
		} finally {
			await transport.close();
			await protocol.close();
		}
	}

	private validRequestOrigin(request: IncomingMessage): boolean {
		if (!this.url) return false;
		const endpoint = new URL(this.url);
		if (request.headers.host !== endpoint.host) return false;
		const origin = request.headers.origin;
		if (origin === undefined) return true;
		if (Array.isArray(origin)) return false;
		try { return new URL(origin).origin === endpoint.origin; }
		catch { return false; }
	}
}

function projectTools(tools: readonly Tool[], omissions: string[]): BridgeTool[] {
	const output: BridgeTool[] = [];
	const names = new Set<string>();
	for (const tool of tools) {
		if (output.length >= MAX_TOOLS) {
			omissions.push(`Tool limit ${MAX_TOOLS} reached`);
			break;
		}
		if ([PERMISSION_TOOL_NAME, QUESTION_TOOL_NAME, PLAN_TOOL_NAME].includes(tool.name)) continue;
		const mcpName = `pi_${tool.name}`.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 64);
		if (!mcpName || names.has(mcpName)) {
			omissions.push(`${tool.name}: duplicate or invalid projected name`);
			continue;
		}
		const inputSchema = sanitizeSchema(tool.parameters);
		if (
			!inputSchema ||
			inputSchema.type !== "object" ||
			JSON.stringify(inputSchema).length > SCHEMA_LIMIT
		) {
			omissions.push(`${tool.name}: schema must be a supported, bounded object`);
			continue;
		}
		names.add(mcpName);
		output.push({
			mcpName,
			piName: tool.name,
			description: tool.description.slice(0, 8_000),
			inputSchema,
			originalSchema: tool.parameters,
		});
	}
	return output;
}

function sanitizeSchema(value: unknown, depth = 0): Record<string, unknown> | undefined {
	if (depth > 16 || !value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const source = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};
	const scalarKeys = [
		"type",
		"title",
		"description",
		"format",
		"pattern",
		"minimum",
		"maximum",
		"minLength",
		"maxLength",
		"minItems",
		"maxItems",
	];
	for (const key of scalarKeys) {
		const candidate = source[key];
		if (["string", "number", "boolean"].includes(typeof candidate)) output[key] = candidate;
	}
	if (Array.isArray(source.required)) {
		output.required = source.required.filter((item): item is string => typeof item === "string");
	}
	if (Array.isArray(source.enum)) output.enum = source.enum.filter(jsonScalar);
	if (jsonValue(source.default)) output.default = source.default;
	if (typeof source.additionalProperties === "boolean") {
		output.additionalProperties = source.additionalProperties;
	} else if (source.additionalProperties && typeof source.additionalProperties === "object") {
		const additional = sanitizeSchema(source.additionalProperties, depth + 1);
		if (additional) output.additionalProperties = additional;
	}
	if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
		const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const [name, schema] of Object.entries(source.properties as Record<string, unknown>)) {
			const sanitized = sanitizeSchema(schema, depth + 1);
			if (sanitized) properties[name] = sanitized;
		}
		output.properties = properties;
	}
	if (source.items) {
		const items = sanitizeSchema(source.items, depth + 1);
		if (items) output.items = items;
	}
	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		if (!Array.isArray(source[key])) continue;
		const variants = source[key].map((item) => sanitizeSchema(item, depth + 1)).filter((item) => item !== undefined);
		if (variants.length) output[key] = variants;
	}
	if (output.type === undefined && output.properties !== undefined) output.type = "object";
	if (output.type === undefined && output.items !== undefined) output.type = "array";
	return Object.keys(output).length > 0 ? output : undefined;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
		size += bytes.length;
		if (size > BODY_LIMIT) throw new CursorAcpError("invalid_input", "MCP request body is too large");
		chunks.push(bytes);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validBearerToken(header: string | undefined, token: string): boolean {
	const actual = Buffer.from(header ?? "");
	const expected = Buffer.from(`Bearer ${token}`);
	return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function toolError(text: string): CallToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

function jsonScalar(value: unknown): value is null | string | number | boolean {
	return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function jsonValue(value: unknown): boolean {
	if (jsonScalar(value)) return true;
	if (Array.isArray(value)) return value.every(jsonValue);
	return Boolean(
		value &&
			typeof value === "object" &&
			Object.values(value as Record<string, unknown>).every(jsonValue),
	);
}
