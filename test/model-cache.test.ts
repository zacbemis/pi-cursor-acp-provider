import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelCache, saveModelCache, MODEL_CACHE_MAX_AGE_MS } from "../src/acp/model-cache.js";
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

	it("accepts last-known catalogs for up to 30 days while honoring a shorter requested age", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-models-"));
		try {
			const file = path.join(root, "models.json");
			const definitions = parseModelExtension({ models: [{ value: "model", name: "Model" }] });
			saveModelCache(definitions, "v", file);
			const data = JSON.parse(fs.readFileSync(file, "utf8"));
			data.fetchedAt = Date.now() - 3 * 24 * 60 * 60_000;
			fs.writeFileSync(file, JSON.stringify(data));
			expect(loadModelCache("v", file, 24 * 60 * 60_000)).toBeUndefined();
			expect(loadModelCache("v", file)?.map((item) => item.id)).toEqual(["model"]);
			expect(loadModelCache("other-version", file)).toBeUndefined();
			data.fetchedAt = Date.now() - MODEL_CACHE_MAX_AGE_MS - 60_000;
			fs.writeFileSync(file, JSON.stringify(data));
			expect(loadModelCache("v", file)).toBeUndefined();
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});
});
