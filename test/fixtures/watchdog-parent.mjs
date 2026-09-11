import { spawn } from "node:child_process";
import fs from "node:fs";

const [, , supervisorEntry, agentEntry, pidFile] = process.argv;
const supervisor = spawn(process.execPath, [supervisorEntry, agentEntry, pidFile], {
	stdio: ["pipe", "pipe", "pipe"],
	detached: process.platform !== "win32",
});

const deadline = Date.now() + 5_000;
const timer = setInterval(() => {
	if (!fs.existsSync(pidFile)) {
		if (Date.now() > deadline) process.exit(2);
		return;
	}
	clearInterval(timer);
	const childPids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
	process.stdout.write(`${JSON.stringify({ supervisor: supervisor.pid, ...childPids })}\n`);
}, 10);
