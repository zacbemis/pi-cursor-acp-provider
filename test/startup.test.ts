import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasCursorLogin, loginCursor } from "../src/acp/auth.js";
import { createCursorProvider } from "../src/provider.js";

vi.mock("../src/acp/auth.js", () => ({ hasCursorLogin: vi.fn(), loginCursor: vi.fn() }));

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("startup CLI checks", () => {
	it("discovers the Cursor command once per process, but still checks its version", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-startup-"));
		const oldPath = process.env.PATH;
		const oldCommand = process.env.PI_CURSOR_ACP_COMMAND;
		try {
			const calls = path.join(root, "calls");
			const binary = path.join(root, "cursor-agent");
			fs.writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${calls}'\nif [ "$1" = '--version' ]; then echo v1; else echo 'Logged in'; fi\n`);
			fs.chmodSync(binary, 0o700);
			process.env.PATH = root;
			delete process.env.PI_CURSOR_ACP_COMMAND;
			vi.resetModules();
			const { resolveCursorCommand, cursorVersion } = await import("../src/acp/process.js");
			expect(resolveCursorCommand()).toBe("cursor-agent");
			expect(resolveCursorCommand()).toBe("cursor-agent");
			expect(cursorVersion()).toBe("v1");
			expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toEqual(["--version", "--version"]);
		} finally {
			if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
			if (oldCommand === undefined) delete process.env.PI_CURSOR_ACP_COMMAND; else process.env.PI_CURSOR_ACP_COMMAND = oldCommand;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("shares login checks across model auth probes, and rechecks after expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		vi.mocked(hasCursorLogin).mockResolvedValue(true);
		const { provider } = createCursorProvider();
		const check = provider.auth?.apiKey?.check;
		expect(check).toBeDefined();
		const input = { ctx: { env: async () => undefined }, credential: undefined } as never;
		const results = await Promise.all(Array.from({ length: 8 }, () => check!(input)));
		expect(results.every((result) => result?.source === "Cursor Agent CLI login")).toBe(true);
		expect(hasCursorLogin).toHaveBeenCalledTimes(1);
		await check!(input);
		expect(hasCursorLogin).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(30_000);
		await check!(input);
		expect(hasCursorLogin).toHaveBeenCalledTimes(2);
	});

	it("invalidates the cached login state after an interactive login", async () => {
		vi.mocked(hasCursorLogin).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const { provider } = createCursorProvider();
		const input = { ctx: { env: async () => undefined }, credential: undefined } as never;
		expect(await provider.auth?.apiKey?.check?.(input)).toBeUndefined();
		await provider.auth?.oauth?.login({ notify: () => {}, signal: new AbortController().signal } as never);
		expect(loginCursor).toHaveBeenCalledTimes(1);
		expect((await provider.auth?.apiKey?.check?.(input))?.source).toBe("Cursor Agent CLI login");
		expect(hasCursorLogin).toHaveBeenCalledTimes(2);
	});
});
