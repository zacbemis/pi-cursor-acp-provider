import { describe, expect, it } from "vitest";
import { parseExtensionInteraction, planDecision, questionAnswered } from "../src/acp/cursor-extension.js";

describe("Cursor extension schemas", () => {
	it("retains question and option ids", () => {
		const parsed = parseExtensionInteraction("cursor/ask_question", { toolCallId: "t", questions: [{ id: "q", prompt: "Pick", options: [{ id: "a", label: "A" }], allowMultiple: true }] });
		expect(parsed).toMatchObject({ kind: "question", request: { questions: [{ id: "q", options: [{ id: "a" }], allowMultiple: true }] } });
	});
	it("uses nested documented outcomes", () => {
		expect(questionAnswered([{ questionId: "q", selectedOptionIds: ["a"] }])).toEqual({ outcome: { outcome: "answered", answers: [{ questionId: "q", selectedOptionIds: ["a"] }] } });
		expect(planDecision(true)).toEqual({ outcome: { outcome: "accepted" } });
		expect(planDecision(false, "no")).toEqual({ outcome: { outcome: "rejected", reason: "no" } });
	});
});
