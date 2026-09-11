import { describe, expect, it } from "vitest";
import { cursorActionRequired } from "../src/acp/events.js";

describe("Cursor action-required diagnostics", () => {
	it("explains Fable's policy gate", () => {
		const message = cursorActionRequired("claude-fable-5-1", "\n\nCheck your settings to continue");
		expect(message).toContain("data-retention policy");
		expect(message).toContain("cannot accept this policy on your behalf");
		expect(message).toContain("claude-fable-5");
	});
	it("does not rewrite normal model output", () => {
		expect(cursorActionRequired("grok-4.6", "Normal answer")).toBeUndefined();
	});
});
