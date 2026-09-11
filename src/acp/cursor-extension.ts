import { RequestError } from "@agentclientprotocol/sdk";

export interface CursorQuestionOption { id: string; label: string; }
export interface CursorQuestion { id: string; prompt: string; options: CursorQuestionOption[]; allowMultiple: boolean; }
export interface CursorAskQuestion { toolCallId: string; title?: string; questions: CursorQuestion[]; }
export interface CursorCreatePlan { toolCallId: string; name?: string; overview?: string; plan: string; todos: Array<Record<string, unknown>>; phases: Array<Record<string, unknown>>; }

export type CursorExtensionInteraction =
	| { kind: "question"; request: CursorAskQuestion }
	| { kind: "plan"; request: CursorCreatePlan };

export function parseExtensionInteraction(method: string, params: Record<string, unknown>): CursorExtensionInteraction {
	if (method === "cursor/ask_question") return { kind: "question", request: parseQuestion(params) };
	if (method === "cursor/create_plan") return { kind: "plan", request: parsePlan(params) };
	throw RequestError.methodNotFound(method);
}

export function describeExtensionNotification(method: string, params: Record<string, unknown>): string | undefined {
	if (method === "cursor/update_todos") {
		const todos = Array.isArray(params.todos) ? params.todos : [];
		const lines = todos.slice(0, 20).map((todo) => {
			const item = record(todo);
			return `- [${text(item?.status, "unknown")}] ${text(item?.content, "todo")}`;
		});
		return lines.length ? `\n[Cursor todos]\n${lines.join("\n")}\n` : undefined;
	}
	if (method === "cursor/task") return `\n[Cursor subagent: ${text(params.description, "task completed")}]\n`;
	if (method === "cursor/generate_image") return `\n[Cursor generated image: ${text(params.filePath, text(params.description, "image"))}]\n`;
	return undefined;
}

export function questionAnswered(answers: Array<{ questionId: string; selectedOptionIds: string[] }>): Record<string, unknown> {
	return { outcome: { outcome: "answered", answers } };
}
export function questionCancelled(reason?: string): Record<string, unknown> {
	return { outcome: { outcome: reason ? "skipped" : "cancelled", ...(reason ? { reason } : {}) } };
}
export function planDecision(accepted: boolean, reason?: string): Record<string, unknown> {
	return { outcome: accepted ? { outcome: "accepted" } : { outcome: reason ? "rejected" : "cancelled", ...(reason ? { reason } : {}) } };
}

function parseQuestion(params: Record<string, unknown>): CursorAskQuestion {
	if (typeof params.toolCallId !== "string" || !Array.isArray(params.questions)) throw RequestError.invalidParams(params, "Cursor question is malformed");
	const questions = params.questions.map((value) => {
		const item = record(value);
		if (!item || typeof item.id !== "string" || typeof item.prompt !== "string" || !Array.isArray(item.options)) throw RequestError.invalidParams(value, "Cursor question is malformed");
		const options = item.options.map((option) => {
			const candidate = record(option);
			if (!candidate || typeof candidate.id !== "string" || typeof candidate.label !== "string") throw RequestError.invalidParams(option, "Cursor question option is malformed");
			return { id: candidate.id, label: candidate.label };
		});
		return { id: item.id, prompt: item.prompt, options, allowMultiple: item.allowMultiple === true };
	});
	return { toolCallId: params.toolCallId, ...(typeof params.title === "string" ? { title: params.title } : {}), questions };
}

function parsePlan(params: Record<string, unknown>): CursorCreatePlan {
	if (typeof params.toolCallId !== "string" || typeof params.plan !== "string") throw RequestError.invalidParams(params, "Cursor plan is malformed");
	return {
		toolCallId: params.toolCallId,
		...(typeof params.name === "string" ? { name: params.name } : {}),
		...(typeof params.overview === "string" ? { overview: params.overview } : {}),
		plan: params.plan,
		todos: Array.isArray(params.todos) ? params.todos.filter((item): item is Record<string, unknown> => record(item) !== undefined) : [],
		phases: Array.isArray(params.phases) ? params.phases.filter((item): item is Record<string, unknown> => record(item) !== undefined) : [],
	};
}

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" ? value as Record<string, unknown> : undefined; }
function text(value: unknown, fallback: string): string { return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 2_000) : fallback; }
