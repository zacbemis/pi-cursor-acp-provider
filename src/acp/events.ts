import type { SessionNotification } from "@agentclientprotocol/sdk";

export type AcpActivity =
	| { type: "text"; delta: string }
	| { type: "thought"; delta: string }
	| { type: "tool" | "plan" | "status"; text: string }
	| { type: "unknown"; updateType: string };

export function mapSessionUpdate(notification: SessionNotification): AcpActivity[] {
	const update = notification.update;
	switch (update.sessionUpdate) {
		case "agent_message_chunk": return update.content.type === "text" ? [{ type: "text", delta: update.content.text }] : [];
		case "agent_thought_chunk": return update.content.type === "text" ? [{ type: "thought", delta: update.content.text }] : [];
		case "tool_call": return [{ type: "tool", text: `\n[Cursor tool: ${clean(update.title)}${update.status ? ` — ${update.status}` : ""}]\n` }];
		case "tool_call_update": {
			const label = update.title ? clean(update.title) : clean(update.toolCallId);
			const details = toolContentText(update.content);
			return [{ type: "tool", text: `\n[Cursor tool update: ${label}${update.status ? ` — ${update.status}` : ""}]${details ? `\n${details}\n` : "\n"}` }];
		}
		case "plan": {
			const lines = update.entries.map((entry) => `- [${entry.status}] ${clean(entry.content)}`);
			return lines.length ? [{ type: "plan", text: `\n[Cursor plan]\n${lines.join("\n")}\n` }] : [];
		}
		case "current_mode_update": return [{ type: "status", text: `\n[Cursor mode: ${clean(update.currentModeId)}]\n` }];
		default: return [{ type: "unknown", updateType: update.sessionUpdate }];
	}
}

function toolContentText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const output: string[] = [];
	for (const item of content.slice(0, 8)) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		if (record.type === "diff") output.push(`[diff: ${typeof record.path === "string" ? clean(record.path) : "file"}]`);
		else if (record.type === "content") {
			const block = record.content as Record<string, unknown> | undefined;
			if (block?.type === "text" && typeof block.text === "string") output.push(clean(block.text).slice(0, 2_000));
		}
	}
	return output.join("\n").slice(0, 4_000);
}

function clean(value: string): string { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(0, 2_000); }
