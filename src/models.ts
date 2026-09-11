import type { NewSessionResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Model, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { API_ID, PROVIDER_ID } from "./constants.js";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const MAX_MODELS = 256;
const MAX_CONFIG_OPTIONS = 32;

export interface CursorModelDefinition {
	id: string;
	name: string;
	configOptions: SessionConfigOption[];
	model: Model<typeof API_ID>;
}

export const FALLBACK_DEFINITIONS: CursorModelDefinition[] = [definition("default", "Auto", [])];
export const FALLBACK_MODELS = FALLBACK_DEFINITIONS.map((item) => item.model);

export function parseModelExtension(response: Record<string, unknown>): CursorModelDefinition[] {
	const values = Array.isArray(response.models) ? response.models.slice(0, MAX_MODELS) : [];
	return values.flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const record = value as Record<string, unknown>;
		const id = typeof record.value === "string" ? record.value : typeof record.modelId === "string" ? record.modelId : undefined;
		if (!id || !validId(id)) return [];
		const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;
		const configOptions = Array.isArray(record.configOptions) ? record.configOptions.slice(0, MAX_CONFIG_OPTIONS) as SessionConfigOption[] : [];
		return [definition(id, name, configOptions)];
	});
}

export function parseSessionModels(session: Pick<NewSessionResponse, "models" | "configOptions">): CursorModelDefinition[] {
	const modelOption = session.configOptions?.find((option) => option.category === "model" || option.id === "model");
	if (modelOption?.type === "select") {
		return flattenOptions(modelOption.options).flatMap((option) => validId(option.value) ? [definition(option.value, option.name || option.value, [])] : []);
	}
	return (session.models?.availableModels ?? []).flatMap((item) => validId(item.modelId) ? [definition(item.modelId, item.name || item.modelId, [])] : []);
}

export function dedupeDefinitions(definitions: CursorModelDefinition[]): CursorModelDefinition[] {
	const seen = new Set<string>();
	return definitions.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

export function resolveReasoningConfig(
	options: readonly SessionConfigOption[],
	level: ThinkingLevel | undefined,
): { id: string; value: string | boolean }[] {
	const thought = options.find((option) => option.category === "thought_level" || /effort|reasoning/iu.test(`${option.id} ${option.name}`));
	const thinking = options.find((option) => /thinking/iu.test(`${option.id} ${option.name}`) && option.category !== "thought_level");
	const output: { id: string; value: string | boolean }[] = [];
	if (thinking) {
		const enabled = level !== undefined;
		if (thinking.type === "boolean") output.push({ id: thinking.id, value: enabled });
		else {
			const allowed = flattenOptions(thinking.options).map((item) => item.value);
			const value = enabled ? allowed.find((item) => item === "true") : allowed.find((item) => item === "false");
			if (value !== undefined) output.push({ id: thinking.id, value });
		}
	}
	if (thought?.type === "select") {
		const allowed = flattenOptions(thought.options).map((item) => item.value);
		const value = level === undefined
			? allowed.find((candidate) => candidate === "none" || candidate === "off")
			: closestReasoning(level, allowed);
		if (value) output.push({ id: thought.id, value });
	}
	return output;
}

export function hasOptionValue(option: SessionConfigOption, value: string | boolean): boolean {
	if (option.type === "boolean") return typeof value === "boolean";
	return typeof value === "string" && flattenOptions(option.options).some((item) => item.value === value);
}

function definition(id: string, name: string, configOptions: SessionConfigOption[]): CursorModelDefinition {
	const levels = availableReasoningLevels(configOptions);
	const reasoning = levels.length > 0;
	const map: ThinkingLevelMap = {
		off: configOptions.some((option) => /thinking/iu.test(option.id)) || levels.includes("none") ? "off" : null,
		minimal: levels.some((value) => value === "minimal" || value === "none") ? "minimal" : null,
		low: levels.includes("low") ? "low" : null,
		medium: levels.includes("medium") ? "medium" : null,
		high: levels.includes("high") ? "high" : null,
		xhigh: levels.some((value) => /xhigh|extra.?high/iu.test(value)) ? "xhigh" : null,
		max: levels.includes("max") ? "max" : null,
	};
	return {
		id,
		name,
		configOptions,
		model: {
			id,
			name,
			api: API_ID,
			provider: PROVIDER_ID,
			baseUrl: "",
			reasoning,
			...(reasoning ? { thinkingLevelMap: map } : {}),
			input: ["text", "image"],
			cost: ZERO_COST,
			contextWindow: contextWindow(configOptions),
			maxTokens: 65_536,
		},
	};
}

function availableReasoningLevels(options: readonly SessionConfigOption[]): string[] {
	const thought = options.find((option) => option.category === "thought_level" || /effort|reasoning/iu.test(`${option.id} ${option.name}`));
	const values = thought?.type === "select" ? flattenOptions(thought.options).map((item) => item.value) : [];
	if (options.some((option) => /thinking/iu.test(`${option.id} ${option.name}`))) values.push("off", "high");
	return values;
}

function contextWindow(options: readonly SessionConfigOption[]): number {
	const option = options.find((item) => /context/iu.test(`${item.id} ${item.name}`));
	if (option?.type !== "select") return 200_000;
	const values = flattenOptions(option.options).map((item) => parseSize(item.value)).filter((value): value is number => value !== undefined);
	return values.length ? Math.max(...values) : 200_000;
}

function parseSize(value: string): number | undefined {
	const match = value.toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/u);
	if (!match) return undefined;
	const amount = Number(match[1]);
	return Math.round(amount * (match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1));
}

function closestReasoning(level: ThinkingLevel, allowed: string[]): string | undefined {
	const preferences: Record<ThinkingLevel, string[]> = {
		minimal: ["minimal", "none", "low", "medium"],
		low: ["low", "minimal", "none", "medium"],
		medium: ["medium", "high", "low"],
		high: ["high", "xhigh", "extra-high", "extra high", "medium"],
		xhigh: ["xhigh", "extra-high", "extra high", "max", "high"],
		max: ["max", "xhigh", "extra-high", "extra high", "high"],
	};
	return preferences[level].find((candidate) => allowed.includes(candidate));
}

function flattenOptions(options: SessionConfigOption extends infer _ ? unknown : never): Array<{ value: string; name: string }> {
	if (!Array.isArray(options)) return [];
	const output: Array<{ value: string; name: string }> = [];
	for (const item of options) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		if (typeof record.value === "string") output.push({ value: record.value, name: typeof record.name === "string" ? record.name : record.value });
		else if (Array.isArray(record.options)) output.push(...flattenOptions(record.options));
	}
	return output;
}

function validId(id: string): boolean { return id.length > 0 && id.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(id); }
