import { spawn } from "node:child_process";
import http from "node:http";
import readline from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const scenario = process.argv[2];
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let model = "auto";
let mode = "default";
let permissionPromptId;
let hangingPromptId;
let bridgePromptId;
let mcpServer;

for await (const line of rl) {
	if (!line.trim()) continue;
	const message = JSON.parse(line);
	if (!("id" in message)) {
		if (message.method === "session/cancel" && hangingPromptId !== undefined) {
			send({ jsonrpc: "2.0", id: hangingPromptId, result: { stopReason: "cancelled" } });
			hangingPromptId = undefined;
		}
		if (message.method === "session/cancel" && bridgePromptId !== undefined) {
			send({ jsonrpc: "2.0", id: bridgePromptId, result: { stopReason: "cancelled" } });
			bridgePromptId = undefined;
		}
		continue;
	}
	const { id, method, params } = message;
	if (id === "permission-1" && method === undefined && permissionPromptId !== undefined) {
		const decision = message.result?.outcome?.outcome ?? "cancelled";
		send({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "fake-session",
				update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Decision: ${decision}` } },
			},
		});
		send({ jsonrpc: "2.0", id: permissionPromptId, result: { stopReason: "end_turn" } });
		permissionPromptId = undefined;
	} else if (method === "initialize") {
		if (scenario === "malformed-output") {
			process.stdout.write("not-json\n");
			continue;
		}
		if (scenario === "browser-noise") {
			process.stdout.write("Opening in existing browser session.\n");
		}
		send({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: 1,
				agentInfo: { name: "fake-gemini", version: "1.0.0" },
				authMethods: [
					{ id: "oauth-personal", name: "Log in with Google" },
					{ id: "api", name: "Gemini API key", _meta: { "api-key": { provider: "google" } } },
				],
				agentCapabilities: {
					loadSession: true,
					promptCapabilities: { image: true, embeddedContext: true },
					mcpCapabilities: { http: true },
					sessionCapabilities: { resume: {} },
				},
			},
		});
		if (scenario === "exit-after-initialize") {
			setTimeout(() => process.exit(0), 10);
		}
	} else if (method === "authenticate") {
		if (scenario === "headless-auth") {
			const state = "fake-oauth-state";
			const server = http.createServer((request, response) => {
				const callback = new URL(request.url ?? "/", "http://127.0.0.1");
				if (callback.searchParams.get("state") !== state || !callback.searchParams.get("code")) {
					response.writeHead(400).end("Invalid callback");
					return;
				}
				response.writeHead(200).end("Authenticated");
				server.close();
				send({ jsonrpc: "2.0", id, result: {} });
			});
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("missing fake OAuth address");
				const redirect = `http://127.0.0.1:${address.port}/`;
				const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
				authorization.searchParams.set("redirect_uri", redirect);
				authorization.searchParams.set("state", state);
				const browser = process.env.BROWSER;
				if (!browser) throw new Error("missing BROWSER capture command");
				const child = spawn(browser, [authorization.toString()], { env: process.env, stdio: "ignore" });
				child.once("error", (error) => {
					server.close();
					send({ jsonrpc: "2.0", id, error: { code: -32603, message: error.message } });
				});
			});
			continue;
		}
		send({ jsonrpc: "2.0", id, result: {} });
	} else if (method === "session/new") {
		if (scenario === "session-timeout") continue;
		if (scenario === "internal-error") {
			send({
				jsonrpc: "2.0",
				id,
				error: {
					code: -32603,
					message: "Internal error",
					data: { details: "Permission denied: localharness_external; api_key=AIza1234567890abcdefghijkl" },
				},
			});
			continue;
		}
		mcpServer = params.mcpServers?.find((server) => server.type === "http");
		send({
			jsonrpc: "2.0",
			id,
			result: {
				sessionId: "fake-session",
				modes: {
					currentModeId: mode,
					availableModes: [
						{ id: "default", name: "Default" },
						{ id: "auto_edit", name: "Auto Edit" },
						{ id: "yolo", name: "YOLO" },
					],
				},
				models: {
					currentModelId: model,
					availableModels: [
						{ modelId: "auto", name: "Auto" },
						{ modelId: "gemini-test", name: "Gemini Test" },
					],
				},
			},
		});
	} else if (method === "session/resume" || method === "session/load") {
		send({
			jsonrpc: "2.0",
			id,
			result: {
				modes: {
					currentModeId: mode,
					availableModes: [
						{ id: "default", name: "Default" },
						{ id: "auto_edit", name: "Auto Edit" },
						{ id: "yolo", name: "YOLO" },
					],
				},
				models: { currentModelId: model, availableModels: [] },
			},
		});
	} else if (method === "session/set_model") {
		model = params.modelId;
		send({ jsonrpc: "2.0", id, result: {} });
	} else if (method === "session/set_mode") {
		mode = params.modeId;
		send({ jsonrpc: "2.0", id, result: {} });
	} else if (method === "session/prompt") {
		const text = params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text.includes("bridge") && mcpServer) {
			bridgePromptId = id;
			const invocation = text.includes("parallel")
				? Promise.all([
						invokeMcpTool(mcpServer, "first"),
						new Promise((resolve) => setTimeout(resolve, 50)).then(() => invokeMcpTool(mcpServer, "second")),
					]).then((results) => results.join(","))
				: invokeMcpTool(mcpServer, "from gemini");
			void invocation.then(async (result) => {
				if (text.includes("bridge delayed")) await new Promise((resolve) => setTimeout(resolve, 500));
				if (bridgePromptId !== id) return;
				bridgePromptId = undefined;
				send({
					jsonrpc: "2.0",
					method: "session/update",
					params: {
						sessionId: params.sessionId,
						update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: result } },
					},
				});
				send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
			});
			continue;
		}
		if (text.includes("hang")) {
			hangingPromptId = id;
			continue;
		}
		if (text.includes("permission")) {
			permissionPromptId = id;
			send({
				jsonrpc: "2.0",
				id: "permission-1",
				method: "session/request_permission",
				params: {
					sessionId: params.sessionId,
					toolCall: { toolCallId: "native-tool-1", title: "Run native command", kind: "execute" },
					options: [
						{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
						{ optionId: "reject-once", name: "Reject", kind: "reject_once" },
					],
				},
			});
			continue;
		}
		send({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: params.sessionId,
				update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking" } },
			},
		});
		send({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: params.sessionId,
				update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
			},
		});
		send({
			jsonrpc: "2.0",
			id,
			result: {
				stopReason: "end_turn",
				_meta: { quota: { token_count: { input_tokens: 7, output_tokens: 3 }, model_usage: [] } },
			},
		});
	} else {
		send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
	}
}

async function invokeMcpTool(server, text) {
	const headers = Object.fromEntries(server.headers.map((header) => [header.name, header.value]));
	const client = new Client({ name: "fake-gemini", version: "1" }, { capabilities: {} });
	const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } });
	try {
		await client.connect(transport);
		const result = await client.callTool({ name: "pi_echo", arguments: { text } });
		return result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
	} finally {
		await client.close();
	}
}
