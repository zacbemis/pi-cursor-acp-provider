import { describe, expect, it } from "vitest";
import { cursorAcpArgs } from "../src/acp/process.js";

describe("Cursor process arguments", () => {
	it("puts permission flags before acp", () => {
		expect(cursorAcpArgs("prompt")).toEqual(["acp"]);
		expect(cursorAcpArgs("auto-review")).toEqual(["--auto-review", "acp"]);
		expect(cursorAcpArgs("full-access")).toEqual(["--force", "acp"]);
	});
});
