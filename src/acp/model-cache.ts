import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CursorModelDefinition } from "../models.js";
import { parseModelExtension } from "../models.js";

const DEFAULT_PATH = path.join(os.homedir(), ".pi", "agent", "cursor-acp-provider", "models.json");
export const MODEL_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;

interface ModelCacheFile {
	version: 1;
	cursorVersion: string;
	fetchedAt: number;
	models: Array<{ value: string; name: string; configOptions: CursorModelDefinition["configOptions"] }>;
}

export function loadModelCache(
	cursorVersion: string | undefined,
	file = DEFAULT_PATH,
	maxAgeMs = MODEL_CACHE_MAX_AGE_MS,
): CursorModelDefinition[] | undefined {
	if (!cursorVersion) return undefined;
	try {
		if (fs.statSync(file).size > MAX_CACHE_BYTES) return undefined;
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ModelCacheFile>;
		if (
			parsed.version !== 1 ||
			parsed.cursorVersion !== cursorVersion ||
			typeof parsed.fetchedAt !== "number" ||
			parsed.fetchedAt > Date.now() + 5 * 60_000 ||
			Date.now() - parsed.fetchedAt > maxAgeMs ||
			!Array.isArray(parsed.models)
		) return undefined;
		const definitions = parseModelExtension({ models: parsed.models });
		return definitions.length ? definitions : undefined;
	} catch { return undefined; }
}

export function saveModelCache(
	definitions: readonly CursorModelDefinition[],
	cursorVersion: string | undefined,
	file = DEFAULT_PATH,
): void {
	if (!cursorVersion || !definitions.length) return;
	const data: ModelCacheFile = {
		version: 1,
		cursorVersion,
		fetchedAt: Date.now(),
		models: definitions.map((item) => ({ value: item.id, name: item.name, configOptions: item.configOptions })),
	};
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
	fs.renameSync(temporary, file);
}

export function clearModelCache(file = DEFAULT_PATH): void { fs.rmSync(file, { force: true }); }
