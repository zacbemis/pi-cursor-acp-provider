import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AcpSessionStore } from "../src/acp/session-store.js";

describe("session store", () => {
	it("persists and removes validated records", () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-sessions-")), "sessions.json");
		const store = new AcpSessionStore(file);
		store.save({ piSessionId: "pi", acpSessionId: "cursor", acpModelId: "model", cwd: "/tmp", messageCount: 2, historyFingerprint: "hash", lastActive: Date.now() });
		expect(store.get("pi")?.acpSessionId).toBe("cursor");
		store.remove("pi");
		expect(store.get("pi")).toBeUndefined();
	});
});
