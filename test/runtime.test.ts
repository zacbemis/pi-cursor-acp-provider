import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CursorAcpConnection } from "../src/acp/connection.js";
import { AcpSessionStore } from "../src/acp/session-store.js";
import { INTERACTION_RESULT_KIND, PERMISSION_TOOL_NAME, PLAN_TOOL_NAME, QUESTION_TOOL_NAME } from "../src/constants.js";
import { CursorRuntime } from "../src/runtime.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-cursor-agent.mjs", import.meta.url));
const model: Model<"cursor-acp"> = { id: "test-model", name: "Test", api: "cursor-acp", provider: "cursor-acp", baseUrl: "", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 65_536 };
const user = (text: string, timestamp = Date.now()) => ({ role: "user" as const, content: text, timestamp });

function make(store = new AcpSessionStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-runtime-")), "sessions.json"))) {
	return new CursorRuntime({ permissions: "prompt", mode: "ask", piTools: false }, (options) => new CursorAcpConnection({ ...options, command: process.execPath, args: [fixture], operationTimeoutMs: 3_000, initializeTimeoutMs: 3_000 }), store);
}
async function finish(runtime: CursorRuntime, context: Context, sessionId?: string, selectedModel = model) {
	const writer = runtime.stream(selectedModel, context, { ...(sessionId ? { sessionId } : {}), reasoning: "low" });
	for await (const _event of writer.stream) { /* drain */ }
	return writer.message;
}
function visible(message: { content: Array<{ type: string; text?: string }> }): string { return message.content.filter((item) => item.type === "text").map((item) => item.text).join(""); }

describe("Cursor runtime", () => {
	it("streams thought and text with dynamic configuration", async () => {
		const runtime = make();
		try {
			const message = await finish(runtime, { systemPrompt: "system", messages: [user("hello")], tools: [] });
			expect(visible(message)).toBe("Hello");
			expect(message.content.some((item) => item.type === "thinking")).toBe(true);
			expect(message.stopReason).toBe("stop");
		} finally { await runtime.close(); }
	});

	it("turns Cursor's opaque Fable settings response into an actionable error", async () => {
		const runtime = make();
		const fable = { ...model, id: "claude-fable-5-1", name: "Claude Fable 5.1" };
		try {
			const message = await finish(runtime, { systemPrompt: "", messages: [user("hello")], tools: [] }, undefined, fable);
			expect(message.stopReason).toBe("error");
			expect(message.errorMessage).toContain("data-retention policy");
			expect(visible(message)).not.toContain("Check your settings");
		} finally { await runtime.close(); }
	});

	it("brokers a standard permission through a synthetic Pi tool", async () => {
		const runtime = make();
		try {
			const firstContext: Context = { systemPrompt: "", messages: [user("permission")], tools: [] };
			const first = await finish(runtime, firstContext, "permission-session");
			const call = first.content.find((item) => item.type === "toolCall");
			expect(call).toMatchObject({ type: "toolCall", name: PERMISSION_TOOL_NAME });
			if (!call || call.type !== "toolCall") throw new Error("missing call");
			const view = runtime.getInteraction(call.id);
			expect(view?.kind).toBe("permission");
			const context: Context = { systemPrompt: "", tools: [], messages: [
				...firstContext.messages, first,
				{ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "allowed" }], isError: false, timestamp: Date.now(), details: { kind: INTERACTION_RESULT_KIND, requestId: call.id, response: { outcome: { outcome: "selected", optionId: "allow-once" } } } },
			] };
			const second = await finish(runtime, context, "permission-session");
			expect(visible(second)).toContain('"optionId":"allow-once"');
		} finally { await runtime.close(); }
	});

	it("returns nested Cursor question outcomes", async () => {
		const runtime = make();
		try {
			const base: Context = { systemPrompt: "", messages: [user("question")], tools: [] };
			const first = await finish(runtime, base, "question-session");
			const call = first.content.find((item) => item.type === "toolCall");
			if (!call || call.type !== "toolCall") throw new Error("missing call");
			expect(call.name).toBe(QUESTION_TOOL_NAME);
			const context: Context = { systemPrompt: "", tools: [], messages: [...base.messages, first, { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "answered" }], isError: false, timestamp: Date.now(), details: { kind: INTERACTION_RESULT_KIND, requestId: call.id, response: { outcome: { outcome: "answered", answers: [{ questionId: "q1", selectedOptionIds: ["a1"] }] } } } }] };
			const second = await finish(runtime, context, "question-session");
			expect(visible(second)).toContain('"outcome":"answered"');
		} finally { await runtime.close(); }
	});

	it("returns nested Cursor plan approval", async () => {
		const runtime = make();
		try {
			const base: Context = { systemPrompt: "", messages: [user("plan")], tools: [] };
			const first = await finish(runtime, base, "plan-session");
			const call = first.content.find((item) => item.type === "toolCall");
			if (!call || call.type !== "toolCall") throw new Error("missing call");
			expect(call.name).toBe(PLAN_TOOL_NAME);
			const context: Context = { systemPrompt: "", tools: [], messages: [...base.messages, first, { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "accepted" }], isError: false, timestamp: Date.now(), details: { kind: INTERACTION_RESULT_KIND, requestId: call.id, response: { outcome: { outcome: "accepted" } } } }] };
			const second = await finish(runtime, context, "plan-session");
			expect(visible(second)).toContain('{"outcome":{"outcome":"accepted"}}');
		} finally { await runtime.close(); }
	});

	it("suppresses replay when loading a completed session", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-replay-"));
		const store = new AcpSessionStore(path.join(root, "sessions.json"));
		const firstRuntime = make(store);
		const firstContext: Context = { systemPrompt: "", messages: [user("first", 1)], tools: [] };
		const first = await finish(firstRuntime, firstContext, "saved-session");
		await firstRuntime.close();
		const secondRuntime = make(store);
		try {
			const second = await finish(secondRuntime, { systemPrompt: "", tools: [], messages: [...firstContext.messages, first, user("second", 2)] }, "saved-session");
			expect(visible(second)).toBe("Hello");
			expect(visible(second)).not.toContain("REPLAY_MUST_NOT_APPEAR");
		} finally { await secondRuntime.close(); }
	});
});
