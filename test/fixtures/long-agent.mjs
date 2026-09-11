import { spawn } from "node:child_process";
import fs from "node:fs";

const file = process.argv[2];
process.on("SIGTERM", () => {});
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
	stdio: "ignore",
	detached: false,
});
fs.writeFileSync(file, JSON.stringify({ agent: process.pid, grandchild: grandchild.pid }));
setInterval(() => {}, 1_000);
