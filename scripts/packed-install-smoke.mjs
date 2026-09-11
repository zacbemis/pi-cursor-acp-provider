import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cursor-acp-pack-"));
let tarball;

try {
	const output = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: root, encoding: "utf8" }));
	const packed = Array.isArray(output) ? output[0] : output;
	if (!packed?.filename) throw new Error(`Unexpected npm pack result: ${JSON.stringify(output)}`);
	tarball = path.join(root, packed.filename);
	fs.writeFileSync(path.join(temporary, "package.json"), '{"private":true}\n');
	execFileSync("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", tarball], { cwd: temporary, stdio: "inherit" });
	const installed = path.join(temporary, "node_modules", "pi-cursor-acp-provider");
	for (const required of ["extensions/index.ts", "src/acp/connection.ts", "src/mcp/bridge.ts", "README.md", "SECURITY.md"]) {
		if (!fs.existsSync(path.join(installed, required))) throw new Error(`Packed file is missing: ${required}`);
	}
	for (const dependency of ["@agentclientprotocol/sdk", "@modelcontextprotocol/sdk"]) {
		if (!fs.existsSync(path.join(temporary, "node_modules", dependency, "package.json"))) throw new Error(`Runtime dependency is missing: ${dependency}`);
	}
	const models = execFileSync("pi", ["--no-extensions", "--no-skills", "--no-prompt-templates", "--offline", "-e", path.join(installed, "extensions/index.ts"), "--list-models", "cursor-acp"], {
		encoding: "utf8",
		env: { ...process.env, PI_OFFLINE: "1", CURSOR_API_KEY: "packed-smoke-placeholder", PI_CURSOR_ACP_COMMAND: path.join(temporary, "missing-cursor-agent") },
	});
	if (!models.includes("cursor-acp") || !models.includes("default")) throw new Error(`Packed extension did not register the offline Cursor model: ${models}`);
	process.stdout.write("Packed install passed with runtime dependencies and offline provider registration.\n");
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
	if (tarball) fs.rmSync(tarball, { force: true });
}
