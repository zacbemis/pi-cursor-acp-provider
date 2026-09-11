import { describe, expect, it } from "vitest";
import { parseModelExtension, resolveReasoningConfig } from "../src/models.js";

describe("Cursor model projection", () => {
	it("projects base models and dynamic reasoning/context", () => {
		const definitions = parseModelExtension({ models: [{ value: "gpt-test", name: "GPT Test", configOptions: [
			{ id: "context", name: "Context", category: "model_config", type: "select", currentValue: "200k", options: [{ value: "200k", name: "200k" }, { value: "1m", name: "1m" }] },
			{ id: "reasoning", name: "Reasoning", category: "thought_level", type: "select", currentValue: "medium", options: ["none", "low", "medium", "high", "extra-high"].map((value) => ({ value, name: value })) },
		] }] });
		expect(definitions).toHaveLength(1);
		expect(definitions[0]!.model).toMatchObject({ id: "gpt-test", reasoning: true, contextWindow: 1_000_000 });
		expect(definitions[0]!.model.thinkingLevelMap?.xhigh).toBe("xhigh");
		expect(resolveReasoningConfig(definitions[0]!.configOptions, "xhigh")).toEqual([{ id: "reasoning", value: "extra-high" }]);
	});

	it("accepts modelId compatibility fields and rejects malformed ids", () => {
		expect(parseModelExtension({ models: [{ modelId: "ok", name: "OK" }, { value: "bad\n", name: "bad" }] }).map((item) => item.id)).toEqual(["ok"]);
	});
});
