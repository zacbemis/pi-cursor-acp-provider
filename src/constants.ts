import packageJson from "../package.json" with { type: "json" };

export const PACKAGE_VERSION = packageJson.version;
export const PROVIDER_ID = "cursor-acp";
export const API_ID = "cursor-acp";
export const MANAGED_AUTH_MARKER = "cursor-cli-managed";

export const PERMISSION_TOOL_NAME = "cursor_acp_permission";
export const QUESTION_TOOL_NAME = "cursor_acp_question";
export const PLAN_TOOL_NAME = "cursor_acp_plan";
export const INTERACTION_RESULT_KIND = "cursor-acp-interaction-result-v1";
