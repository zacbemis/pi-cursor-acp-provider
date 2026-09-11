import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PermissionMode = "prompt" | "auto-review" | "full-access";
export type CursorMode = "agent" | "plan" | "ask";

export interface CursorAcpConfig {
	permissions: PermissionMode;
	mode: CursorMode;
	piTools: boolean;
	fast?: boolean;
	context?: string;
}

const CONFIG_ROOT = path.join(os.homedir(), ".pi", "agent", "cursor-acp-provider");
export const CONFIG_PATH = path.join(CONFIG_ROOT, "config.json");

const DEFAULT_CONFIG: CursorAcpConfig = {
	permissions: "full-access",
	mode: "agent",
	piTools: true,
};

export function loadConfig(file = CONFIG_PATH): CursorAcpConfig {
	try {
		if (fs.statSync(file).size > 64 * 1024) return { ...DEFAULT_CONFIG };
		const value = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
		return {
			permissions: isPermissionMode(value.permissions) ? value.permissions : DEFAULT_CONFIG.permissions,
			mode: isCursorMode(value.mode) ? value.mode : DEFAULT_CONFIG.mode,
			piTools: typeof value.piTools === "boolean" ? value.piTools : DEFAULT_CONFIG.piTools,
			...(typeof value.fast === "boolean" ? { fast: value.fast } : {}),
			...(typeof value.context === "string" ? { context: value.context } : {}),
		};
	} catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(config: CursorAcpConfig, file = CONFIG_PATH): void {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(temporary, file);
}

export function isPermissionMode(value: unknown): value is PermissionMode {
	return value === "prompt" || value === "auto-review" || value === "full-access";
}
export function isCursorMode(value: unknown): value is CursorMode {
	return value === "agent" || value === "plan" || value === "ask";
}
