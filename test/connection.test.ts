import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorAcpConnection } from "../src/acp/connection.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-cursor-agent.mjs", import.meta.url));
const make = (scenario = "normal") => new CursorAcpConnection({ cwd: path.dirname(fixture), command: process.execPath, args: [fixture, scenario], operationTimeoutMs: 2_000, initializeTimeoutMs: 2_000 });

describe("Cursor ACP connection", () => {
	it("initializes, authenticates, discovers and configures", async () => {
		const connection = make();
		try {
			const initialized = await connection.initialize();
			expect(initialized.authMethods?.[0]?.id).toBe("cursor_login");
			await connection.authenticate({ methodId: "cursor_login" });
			const session = await connection.newSession(process.cwd());
			const listed = await connection.listAvailableModels(session.sessionId);
			expect(listed.models).toHaveLength(2);
			const options = await connection.setConfig(session.sessionId, "model", "test-model");
			expect(options.find((item) => item.id === "model")?.currentValue).toBe("test-model");
		} finally { await connection.close(); }
	});

	it("fails bounded malformed output", async () => {
		const connection = make("malformed");
		await expect(connection.initialize()).rejects.toThrow(/malformed JSON/iu);
		await connection.close();
	});
});
