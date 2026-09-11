# Local Cursor ACP qualification

## Environment

Probe date: **2026-09-11**

```text
cursor-agent path: /home/zacb/.local/bin/cursor-agent
agent path:        /home/zacb/.local/bin/agent
version:           2026.09.02-c22c1a3
auth:              logged in (identity intentionally omitted)
transport:         cursor-agent acp over stdio
cwd:               isolated research directory under /tmp
```

The probes used newline-delimited JSON-RPC directly, advertised no filesystem/terminal client callbacks, answered any unexpected blocking request with cancellation, and terminated the child after each sequence. One minimal Ask-mode prompt was sent: `Reply with exactly ACP_OK and nothing else.`

These results apply to this exact CLI build and account. They are not protocol guarantees.

## Initialization

Request used protocol v1 and disabled client filesystem/terminal capabilities. Cursor returned:

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "mcpCapabilities": { "http": true, "sse": true },
    "promptCapabilities": {
      "audio": false,
      "embeddedContext": false,
      "image": true
    },
    "sessionCapabilities": { "list": {} }
  },
  "authMethods": [
    {
      "id": "cursor_login",
      "name": "Cursor Login"
    }
  ]
}
```

Not advertised:

- session resume
- session fork
- session close
- audio
- embedded context

Implications:

- use `session/load`, not draft `session/resume`, on this build;
- rebuild a fresh Cursor session from Pi context for Pi branch/fork divergence;
- image content is supported;
- do not claim fork support;
- MCP behavior must be qualified behaviorally rather than inferred from this capability (the implementation canary described below now passes on this build).

## Session setup

A normal `session/new` returned:

- modes: `agent`, `plan`, `ask`
- 38 parameterized model entries
- `configOptions` for mode and model
- a UUID session id

The default at probe time was `grok-4.6[effort=high,fast=true]`. Research temporarily selected GPT-5.4 to test config changes, then restored the observed Grok/high/fast defaults.

## Parameterized model discovery

With client metadata:

```json
{
  "_meta": {
    "parameterizedModelPicker": true
  }
}
```

`cursor/list_available_models` returned **38 base models**. Each model included config controls relevant to that model. Examples:

- `grok-4.6`: effort and fast
- `composer-2.5`: fast
- `gpt-5.4`: context, reasoning, and fast
- Claude families: thinking/context/effort/fast combinations depending on model

### Account catalog snapshot

This is an observed, account-specific snapshot—not a list to hard-code. Option values are shown exactly as returned.

| Value/id | Display name | Config options |
|---|---|---|
| `default` | Auto | — |
| `grok-4.6` | Cursor Grok 4.6 | `effort` (low/medium/high/xhigh); `fast` (false/true) |
| `composer-2.5` | Composer 2.5 | `fast` (false/true) |
| `claude-opus-5` | Claude Opus 5 | `thinking` (false/true); `context` (300k/1m); `effort` (low/medium/high/xhigh/max); `fast` (false/true) |
| `claude-opus-4-8` | Claude Opus 4.8 | `thinking` (false/true); `context` (300k/1m); `effort` (low/medium/high/xhigh/max); `fast` (false/true) |
| `gpt-5.6-sol` | GPT-5.6 Sol | `context` (272k/1m); `reasoning` (none/low/medium/high/xhigh/max); `fast` (false/true) |
| `gpt-5.5` | GPT-5.5 | `context` (272k/1m); `reasoning` (none/low/medium/high/extra-high); `fast` (false/true) |
| `claude-fable-5-1` | Claude Fable 5.1 | `thinking` (false/true); `context` (300k/1m); `effort` (low/medium/high/xhigh/max) |
| `claude-fable-5` | Claude Fable 5 | `thinking` (false/true); `context` (300k/1m); `effort` (low/medium/high/xhigh/max) |
| `grok-4.5` | Cursor Grok 4.5 | `effort` (low/medium/high); `fast` (false/true) |
| `gemini-3.8-flash` | Gemini 3.8 Flash | `reasoning_effort` (low/medium/high) |
| `gemini-3.7-flash` | Gemini 3.7 Flash | `effort` (low/medium/high) |
| `muse-spark-1.3` | Muse Spark 1.3 | `context` (300k/1m); `effort` (minimal/low/medium/high/xhigh/max) |
| `gpt-5.6-terra` | GPT-5.6 Terra | `context` (272k/1m); `reasoning` (none/low/medium/high/xhigh/max); `fast` (false/true) |
| `claude-sonnet-5` | Claude Sonnet 5 | `thinking` (false/true); `context` (300k/1m); `effort` (low/medium/high/xhigh/max) |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | `thinking` (false/true); `context` (200k/1m); `effort` (low/medium/high/max) |
| `gpt-5.3-codex` | Codex 5.3 | `reasoning` (low/medium/high/extra-high); `fast` (false/true) |
| `claude-opus-4-7` | Claude Opus 4.7 | `thinking` (false/true); `context` (300k/1m); `effort` (low/medium/high/xhigh/max); `fast` (false/true) |
| `gpt-5.4` | GPT-5.4 | `context` (272k/1m); `reasoning` (none/low/medium/high/extra-high); `fast` (false/true) |
| `claude-opus-4-6` | Claude Opus 4.6 | `thinking` (false/true); `context` (200k/1m); `effort` (low/medium/high/max) |
| `claude-opus-4-5` | Claude Opus 4.5 | `thinking` (false/true) |
| `gpt-5.2` | GPT-5.2 | `reasoning` (low/medium/high/extra-high); `fast` (false/true) |
| `gpt-5.6-luna` | GPT-5.6 Luna | `context` (272k/1m); `reasoning` (none/low/medium/high/xhigh/max); `fast` (false/true) |
| `gemini-3.6-flash` | Gemini 3.6 Flash | `effort` (minimal/low/medium/high) |
| `gemini-3.1-pro` | Gemini 3.1 Pro | — |
| `gpt-5.4-mini` | GPT-5.4 Mini | `reasoning` (none/low/medium/high/xhigh) |
| `gpt-5.4-nano` | GPT-5.4 Nano | `reasoning` (none/low/medium/high/xhigh) |
| `claude-haiku-4-5` | Claude Haiku 4.5 | `thinking` (false/true) |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 | `thinking` (false/true) |
| `gpt-5.1` | GPT-5.1 | `reasoning` (low/medium/high) |
| `gemini-3-flash` | Gemini 3 Flash | — |
| `gemini-3.5-flash` | Gemini 3.5 Flash | — |
| `claude-sonnet-4` | Claude Sonnet 4 | `thinking` (false/true) |
| `gpt-5-mini` | GPT-5 Mini | — |
| `gemini-2.5-flash` | Gemini 2.5 Flash | — |
| `kimi-k3` | Kimi K3 | `reasoning` (low/high/max) |
| `kimi-k2.7-code` | Kimi K2.7 Code | — |
| `glm-5.2` | GLM 5.2 | `reasoning` (high/max) |

`session/set_config_option` with model `gpt-5.4` succeeded and returned:

```text
context:   272k | 1m
reasoning: none | low | medium | high | extra-high
fast:      false | true
```

Setting the returned `reasoning` option to `low` succeeded and the next full config snapshot reported `currentValue: "low"`.

### Important behavior

Without `parameterizedModelPicker`, setup returned fully parameterized model ids. With it, base ids and dependent config controls were available. The provider should use the metadata but remain compatible with the legacy parameterized list.

`cursor/list_available_models` is current observed behavior and is used by T3 Code; it is not documented on Cursor's public ACP page. Treat it as an optional extension.

## Mode change and streaming

Changing mode through:

```json
{
  "sessionId": "…",
  "configId": "mode",
  "value": "ask"
}
```

succeeded, returned the complete config list, and emitted:

```json
{
  "sessionUpdate": "current_mode_update",
  "currentModeId": "ask"
}
```

The minimal prompt produced:

1. `available_commands_update`
2. `session_info_update` with a generated title
3. two `agent_thought_chunk` updates
4. three `agent_message_chunk` updates (`ACP`, `_`, `OK`)
5. prompt response `{ "stopReason": "end_turn" }`

No usage/cost/cache fields were observed. The provider must support metadata notifications arriving before answer content and must not assume one chunk per content block.

## Session persistence and replay

Two separate cases were tested.

### Empty session

A session created and closed before any prompt could not be loaded by a fresh ACP process:

```json
{
  "code": -32602,
  "message": "Invalid params",
  "data": {
    "message": "Session \"…\" not found"
  }
}
```

Interpretation: do not persist/restore an ACP id until at least one turn has completed. A failed load must fall back to `session/new`.

### Completed session

The Ask-mode session that completed the `ACP_OK` prompt loaded successfully in a fresh process. Before the `session/load` response, Cursor replayed:

- `user_message_chunk`
- `agent_thought_chunk`
- `agent_message_chunk`

The load response then returned modes, models, and config options.

Implications:

- load support is functional for a completed session on this build;
- all load-time replay must be gated out of Pi's visible assistant stream;
- a load implementation should wait for the RPC response and drain/reconcile queued replay before accepting a new prompt;
- configuration must be reapplied after load rather than assumed.

This behavior matches the replay sequence described in historical T3 issue #3149. Current T3 code contains explicit replay suppression and an idle-gap gate.

## Fable account-policy gate

A later live diagnostic selected `claude-fable-5-1` successfully through ACP, but its prompt emitted only an assistant chunk containing `Check your settings to continue` and returned `end_turn`. Running the same model through Cursor CLI exposed the real error: `ActionRequiredError: Review Data Policy`.

Cursor lists Fable as available before its separate 30-day Anthropic retention policy is accepted. The provider now recognizes this opaque ACP response, suppresses it as normal assistant content, and returns an actionable error directing the user to Cursor's Models/Model Access policy review. Acceptance remains an account/team decision outside the provider.

## CLI flags observed locally

The root help currently includes:

```text
--api-key / CURSOR_API_KEY
--endpoint / CURSOR_API_ENDPOINT
--mode plan|ask
--model <parameterized model>
--force / --yolo
--auto-review
--sandbox enabled|disabled
--approve-mcps
--trust
--add-dir
```

`cursor-agent acp --help` itself only displays generic help; root flags must appear before `acp`, for example:

```text
cursor-agent --auto-review acp
cursor-agent --force acp
```

This ordering matches current T3 Code.

## Implementation canaries

After implementation, additional live tests through the actual TypeScript runtime and Pi extension verified:

- runtime model discovery returned 38 base models;
- `pi -p` invoked `cursor-acp/default` and returned the requested exact response;
- Pi selected `cursor-acp/gpt-5.4` with low reasoning and received the requested exact response;
- in an isolated temporary workspace, Cursor discovered the authenticated HTTP MCP bridge, invoked `pi_echo` with the canary payload, paused as a Pi tool call, received the simulated Pi tool result, and completed the same ACP prompt;
- all test processes and temporary workspace resources were closed afterward.

No destructive or workspace-modifying live prompt was used.

## Qualification still required

Before a release is considered broadly qualified, add isolated live tests for:

- standard permission request, each allow/reject/cancel path;
- `cursor/ask_question` response round trip;
- `cursor/create_plan` accept/reject/cancel round trip;
- todo/task/generated-image notification shapes;
- image prompt input;
- cancel during model setup, generation, permission wait, and tool execution;
- injected HTTP MCP server discovery and tool invocation on every supported Cursor version/OS;
- `--auto-review` and `--force` semantics in ACP mode;
- load after multiple turns and after CLI restart/update;
- auth expiry and re-login;
- session/list behavior;
- protocol output/noise limits and process-tree cleanup on Linux, macOS, Windows, and WSL.
