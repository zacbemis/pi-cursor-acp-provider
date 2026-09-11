import { spawn } from "node:child_process";
import { CursorAcpError, redact } from "./errors.js";
import { resolveCursorCommand } from "./process.js";

export async function hasCursorLogin(command = resolveCursorCommand()): Promise<boolean> {
	try {
		const { code, output } = await run(command, ["status"], undefined, 10_000);
		return code === 0 && !/not\s+(?:logged|authenticated)|logged\s+out/iu.test(output);
	} catch { return false; }
}

export async function loginCursor(signal?: AbortSignal, onProgress?: (message: string) => void, command = resolveCursorCommand()): Promise<void> {
	if (await hasCursorLogin(command)) { onProgress?.("Cursor Agent CLI is already authenticated."); return; }
	const result = await run(command, ["login"], signal, 5 * 60_000, onProgress);
	if (result.code !== 0 || !(await hasCursorLogin(command))) throw new CursorAcpError("auth", `Cursor login failed${result.output ? `: ${redact(result.output)}` : ""}`);
}

async function run(command: string, args: string[], signal?: AbortSignal, timeoutMs = 30_000, onProgress?: (line: string) => void): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: process.env });
		let output = "";
		let settled = false;
		const consume = (chunk: Buffer | string) => {
			output = (output + chunk.toString()).slice(-16_384);
			for (const line of chunk.toString().split(/\r?\n/u).filter(Boolean)) onProgress?.(redact(line));
		};
		child.stdout.on("data", consume);
		child.stderr.on("data", consume);
		const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); callback(); };
		const abort = () => { child.kill("SIGTERM"); finish(() => reject(new CursorAcpError("aborted", "Cursor login was cancelled"))); };
		const timer = setTimeout(() => { child.kill("SIGTERM"); finish(() => reject(new CursorAcpError("timeout", "Cursor login timed out"))); }, timeoutMs);
		timer.unref?.();
		if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
		child.once("error", (error) => finish(() => reject(new CursorAcpError("spawn", `Failed to launch Cursor CLI: ${error.message}`))));
		child.once("exit", (code) => finish(() => resolve({ code, output: output.trim() })));
	});
}
