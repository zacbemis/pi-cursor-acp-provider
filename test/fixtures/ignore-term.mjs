process.on("SIGTERM", () => {});
process.stdin.resume();
process.stdout.write("ready\n");
setInterval(() => {}, 1_000);
