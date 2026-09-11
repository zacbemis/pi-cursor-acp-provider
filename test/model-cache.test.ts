import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelCache, saveModelCache } from "../src/acp/model-cache.js";
import { parseModelExtension } from "../src/models.js";

describe("model cache", () => {
	it("loads matching fresh Cursor versions", () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-models-")), "models.json");
		const definitions = parseModelExtension({ models: [{ value: "model", name: "Model", configOptions: [] }] });
		saveModelCache(definitions, "cursor-v1", file);
		expect(loadModelCache("cursor-v1", file)?.map((item) => item.id)).toEqual(["model"]);
		expect(loadModelCache("cursor-v2", file)).toBeUndefined();
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	});

	it("rejects expired entries", () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-models-")), "models.json");
		const definitions = parseModelExtension({ models: [{ value: "model", name: "Model" }] });
		saveModelCache(definitions, "v", file);
		expect(loadModelCache("v", file, -1)).toBeUndefined();
	});
});
