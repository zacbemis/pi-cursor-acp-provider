import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../src/config.js";

describe("config", () => {
	it("defaults to full-access for new installs", () => {
		const file = path.join(os.tmpdir(), crypto.randomUUID(), "missing.json");
		expect(loadConfig(file)).toEqual({ permissions: "full-access", mode: "agent", piTools: true });
	});
	it("preserves an explicitly saved prompting policy", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-acp-policy-"));
		try {
			const file = path.join(root, "config.json");
			saveConfig({ permissions: "prompt", mode: "agent", piTools: true }, file);
			expect(loadConfig(file).permissions).toBe("prompt");
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});
	it("round trips with private permissions", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-acp-config-"));
		const file = path.join(root, "config.json");
		saveConfig({ permissions: "auto-review", mode: "ask", piTools: false, fast: true, context: "1m" }, file);
		expect(loadConfig(file)).toMatchObject({ permissions: "auto-review", mode: "ask", piTools: false, fast: true, context: "1m" });
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	});
});
