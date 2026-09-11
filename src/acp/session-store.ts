import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SavedSessionRecord {
	piSessionId: string;
	acpSessionId: string;
	acpModelId: string;
	cwd: string;
	messageCount: number;
	historyFingerprint: string;
	expectedAssistantFingerprint?: string;
	lastActive: number;
}

const DEFAULT_PATH = path.join(os.homedir(), ".pi", "agent", "cursor-acp-provider", "sessions.json");
const MAX_RECORDS = 256;
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export class AcpSessionStore {
	constructor(private readonly file = DEFAULT_PATH) {}
	get(piSessionId: string): SavedSessionRecord | undefined { return this.read().filter((item) => Date.now() - item.lastActive <= MAX_AGE_MS).find((item) => item.piSessionId === piSessionId); }
	save(record: SavedSessionRecord): void {
		const records = this.read().filter((item) => item.piSessionId !== record.piSessionId);
		records.push(record);
		records.sort((a, b) => b.lastActive - a.lastActive);
		this.write(records.slice(0, MAX_RECORDS));
	}
	remove(piSessionId: string): void { this.write(this.read().filter((item) => item.piSessionId !== piSessionId)); }
	clear(): void { fs.rmSync(this.file, { force: true }); }
	private read(): SavedSessionRecord[] {
		try {
			if (fs.statSync(this.file).size > 1024 * 1024) return [];
			const parsed: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
			return Array.isArray(parsed) ? parsed.slice(0, MAX_RECORDS).filter(validRecord) : [];
		}
		catch { return []; }
	}
	private write(records: SavedSessionRecord[]): void {
		if (!records.length) { fs.rmSync(this.file, { force: true }); return; }
		fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
		const temp = `${this.file}.${process.pid}.tmp`;
		fs.writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temp, this.file);
	}
}

function validRecord(value: unknown): value is SavedSessionRecord {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<SavedSessionRecord>;
	return typeof item.piSessionId === "string" && typeof item.acpSessionId === "string" && typeof item.acpModelId === "string" && typeof item.cwd === "string" && Number.isSafeInteger(item.messageCount) && (item.messageCount ?? -1) >= 0 && typeof item.historyFingerprint === "string" && (item.expectedAssistantFingerprint === undefined || typeof item.expectedAssistantFingerprint === "string") && typeof item.lastActive === "number";
}
