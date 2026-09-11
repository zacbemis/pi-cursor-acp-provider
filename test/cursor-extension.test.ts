import { describe, expect, it } from "vitest";
import { parseExtensionInteraction, planDecision, questionAnswered } from "../src/acp/cursor-extension.js";

describe("Cursor extension schemas", () => {
	it("retains question and option ids", () => {
		const parsed = parseExtensionInteraction("cursor/ask_question", { toolCallId: "t", questions: [{ id: "q", prompt: "Pick", options: [{ id: "a", label: "A" }], allowMultiple: true }] });
		expect(parsed).toMatchObject({ kind: "question", request: { questions: [{ id: "q", options: [{ id: "a" }], allowMultiple: true }] } });
	});
	it("rejects oversized interactive forms", () => {
		expect(() => parseExtensionInteraction("cursor/ask_question", { toolCallId: "t", questions: Array.from({ length: 17 }, (_, index) => ({ id: String(index), prompt: "Pick", options: [{ id: "a", label: "A" }] })) })).toThrow(/too large/iu);
		expect(() => parseExtensionInteraction("cursor/create_plan", { toolCallId: "t", plan: "x".repeat(256_001) })).toThrow(/too large/iu);
	});
	it("uses nested documented outcomes", () => {
		expect(questionAnswered([{ questionId: "q", selectedOptionIds: ["a"] }])).toEqual({ outcome: { outcome: "answered", answers: [{ questionId: "q", selectedOptionIds: ["a"] }] } });
		expect(planDecision(true)).toEqual({ outcome: { outcome: "accepted" } });
		expect(planDecision(false, "no")).toEqual({ outcome: { outcome: "rejected", reason: "no" } });
	});
});
