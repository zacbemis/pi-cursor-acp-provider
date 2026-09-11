import { describe, expect, it } from "vitest";
import { buildPromptParts } from "../src/stream/context.js";

describe("Pi context translation", () => {
	it("preserves system prompt and consecutive user context", () => {
		const parts = buildPromptParts({ systemPrompt: "SYSTEM", tools: [], messages: [
			{ role: "user", content: "FIRST", timestamp: 1 },
			{ role: "user", content: "SECOND", timestamp: 2 },
		] }, true);
		const text = JSON.stringify(parts.prompt);
		expect(text).toContain("SYSTEM");
		expect(text).toContain("FIRST");
		expect(text).toContain("SECOND");
	});
	it("forwards image blocks", () => {
		const parts = buildPromptParts({ systemPrompt: "", tools: [], messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: "AA==", mimeType: "image/png" }], timestamp: 1 }] }, true);
		expect(parts.prompt.some((block) => block.type === "image")).toBe(true);
	});
});
