import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { PermissionMode } from "../config.js";
import { CursorAcpError, redact } from "./errors.js";

const STDERR_LIMIT = 16 * 1024;
const KILL_GRACE_MS = 1_500;
let nextGeneration = 1;
let discoveredCursorCommand: string | undefined;

export interface CursorProcessOptions {
	cwd: string;
	command?: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	permissionMode?: PermissionMode;
}

export interface ProcessExit {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderrTail: string;
}

export function resolveSupervisorEntry(): string {
	return fileURLToPath(new URL("./supervisor.mjs", import.meta.url));
}

export function resolveCursorCommand(): string {
	const configured = process.env.PI_CURSOR_ACP_COMMAND?.trim();
	if (configured) return configured;
	if (discoveredCursorCommand) return discoveredCursorCommand;
	for (const command of ["cursor-agent", "agent"]) {
		const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
		if (!result.error && result.status === 0) return (discoveredCursorCommand = command);
	}
	throw new CursorAcpError(
		"spawn",
		"Cursor Agent CLI was not found. Install it from https://cursor.com/docs/cli/installation and run cursor-agent login.",
	);
}

export function cursorAcpArgs(mode: PermissionMode): string[] {
	if (mode === "auto-review") return ["--auto-review", "acp"];
	if (mode === "full-access") return ["--force", "acp"];
	return ["acp"];
}

export function cursorVersion(command = resolveCursorCommand()): string | undefined {
	const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
	return result.status === 0 ? result.stdout.trim() || result.stderr.trim() || undefined : undefined;
}

export class CursorProcess {
	readonly generation = nextGeneration++;
	readonly child: ChildProcessWithoutNullStreams;
	readonly input: ReadableStream<Uint8Array>;
	readonly output: WritableStream<Uint8Array>;
	readonly exited: Promise<ProcessExit>;
	readonly command: string;
	readonly args: string[];
	private stderr = "";
	private ignoredStdoutNoise = 0;
	private settled = false;
	private closing?: Promise<void>;

	constructor(options: CursorProcessOptions) {
		this.command = options.command ?? resolveCursorCommand();
		this.args = options.args ?? cursorAcpArgs(options.permissionMode ?? "prompt");
		let resolveExit!: (exit: ProcessExit) => void;
		this.exited = new Promise((resolve) => { resolveExit = resolve; });

		const child = spawn(this.command, this.args, {
			cwd: path.resolve(options.cwd),
			env: options.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		this.child = child;
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			this.stderr = redact((this.stderr + chunk).slice(-STDERR_LIMIT));
		});
		child.once("error", (cause) => this.finish(resolveExit, null, null, `spawn failed: ${cause.message}`));
		child.once("exit", (code, signal) => this.finish(resolveExit, code, signal, this.stderr));
		this.input = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
		this.output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
	}

	get pid(): number | undefined { return this.child.pid; }
	get stderrTail(): string { return this.stderr; }
	get ignoredStdoutNoiseLines(): number { return this.ignoredStdoutNoise; }
	recordCompatibilityNoise(): void { this.ignoredStdoutNoise += 1; }
	get alive(): boolean { return !this.settled && this.child.exitCode === null; }

	async close(): Promise<void> {
		this.closing ??= this.closeOnce();
		return this.closing;
	}

	private async closeOnce(): Promise<void> {
		if (!this.alive) return;
		this.signal("SIGTERM");
		const exited = await Promise.race([this.exited.then(() => true), delay(KILL_GRACE_MS).then(() => false)]);
		if (!exited && this.alive) {
			this.signal("SIGKILL");
			await Promise.race([this.exited, delay(KILL_GRACE_MS)]);
		}
	}

	private signal(signal: NodeJS.Signals): void {
		try {
			if (process.platform === "win32" && this.child.pid) {
				const args = ["/PID", String(this.child.pid), "/T"];
				if (signal === "SIGKILL") args.push("/F");
				spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
				return;
			}
			if (this.child.pid) process.kill(-this.child.pid, signal);
			else this.child.kill(signal);
		} catch { /* already exited */ }
	}

	private finish(resolve: (exit: ProcessExit) => void, code: number | null, signal: NodeJS.Signals | null, stderr: string): void {
		if (this.settled) return;
		this.settled = true;
		resolve({ code, signal, stderrTail: redact(stderr) });
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
}
