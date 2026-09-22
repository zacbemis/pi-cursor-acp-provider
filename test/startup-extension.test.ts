import type { Provider } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadModelCache, saveModelCache } from "../src/acp/model-cache.js";
import { cursorVersion } from "../src/acp/process.js";
import { parseModelExtension } from "../src/models.js";
import { CursorRuntime } from "../src/runtime.js";
import cursorAcpExtension from "../extensions/index.js";

vi.mock("../src/acp/model-cache.js", async (importOriginal) => ({
	...await importOriginal<typeof import("../src/acp/model-cache.js")>(),
	loadModelCache: vi.fn(), saveModelCache: vi.fn(),
}));
vi.mock("../src/acp/process.js", async (importOriginal) => ({
	...await importOriginal<typeof import("../src/acp/process.js")>(),
	cursorVersion: vi.fn(() => "v1"),
}));

beforeEach(() => { vi.clearAllMocks(); });

function register() {
	let provider: Provider<"cursor-acp"> | undefined;
	cursorAcpExtension({
		registerProvider(value: Provider<"cursor-acp">) { provider = value; },
		registerTool() {}, registerCommand() {}, on() {},
	} as never);
	if (!provider) throw new Error("Cursor provider not registered");
	return provider;
}

describe("startup model catalog", () => {
	it("registers the default model without spawning discovery on a cache miss", () => {
		const discover = vi.spyOn(CursorRuntime.prototype, "discoverModels");
		const provider = register();
		expect(loadModelCache).toHaveBeenCalledWith("v1");
		expect(provider.getModels().map((model) => model.id)).toEqual(["default"]);
		expect(discover).not.toHaveBeenCalled();
		discover.mockRestore();
	});

	it("registers cached models immediately and discovers only on a requested refresh", async () => {
		const definitions = parseModelExtension({ models: [{ value: "cached", name: "Cached" }] });
		const refreshed = parseModelExtension({ models: [{ value: "refreshed", name: "Refreshed" }] });
		vi.mocked(loadModelCache).mockReturnValue(definitions);
		const discover = vi.spyOn(CursorRuntime.prototype, "discoverModels").mockResolvedValue(refreshed);
		try {
			const provider = register();
			expect(provider.getModels().map((model) => model.id)).toEqual(["cached"]);
			expect(discover).not.toHaveBeenCalled();
			const publication = vi.fn(async ({ update }: { update?: () => void }) => { update?.(); return true; });
			await provider.refreshModels?.({ allowNetwork: false, publish: publication } as never);
			expect(discover).not.toHaveBeenCalled();
			await provider.refreshModels?.({ allowNetwork: true, signal: new AbortController().signal, publish: publication } as never);
			expect(discover).toHaveBeenCalledTimes(1);
			expect(saveModelCache).toHaveBeenCalledWith(refreshed, "v1");
			expect(cursorVersion).toHaveBeenCalledTimes(2);
			expect(provider.getModels().map((model) => model.id)).toEqual(["refreshed"]);
		} finally { discover.mockRestore(); }
	});
});
