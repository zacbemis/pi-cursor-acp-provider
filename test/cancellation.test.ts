import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorAcpConnection as Connection } from "../src/acp/connection.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-cursor-agent.mjs", import.meta.url));

describe("catalog refresh cancellation", () => {
	it("observes an already-started request when cancellation precedes withAbort", async () => {
		const unhandled: unknown[] = [];
		const listener = (error: unknown) => { unhandled.push(error); };
		process.on("unhandledRejection", listener);
		try {
			let reject!: (error: Error) => void;
			const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
			const helper = Connection.prototype as unknown as {
				withAbort: (promise: Promise<unknown>, signal: AbortSignal) => Promise<unknown>;
			};
			const closing = { close: async () => { reject(new Error("ACP connection closed")); } };
			await expect(helper.withAbort.call(closing, pending, AbortSignal.abort())).rejects.toThrow(/cancel|abort/i);
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(unhandled).toEqual([]);
		} finally { process.off("unhandledRejection", listener); }
	});

	it.each([true, false])("closes discovery initialization on cancellation (already aborted: %s)", async (alreadyAborted) => {
		const connection = new Connection({ cwd: path.dirname(fixture), command: process.execPath, args: [fixture, "initialize-timeout"], initializeTimeoutMs: 5_000 });
		const controller = new AbortController();
		if (alreadyAborted) controller.abort();
		try {
			const pending = connection.initialize(controller.signal);
			const assertion = expect(pending).rejects.toThrow(/cancel|abort/i);
			if (!alreadyAborted) controller.abort();
			await assertion;
			await connection.close();
			expect(connection.process.alive).toBe(false);
			await new Promise((resolve) => setTimeout(resolve, 25));
		} finally { await connection.close(); }
	});
});
