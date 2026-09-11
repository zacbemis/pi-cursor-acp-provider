# Cursor ACP protocol research

## Official transport and lifecycle

Cursor's official documentation defines:

- Command: `agent acp` or `cursor-agent acp`
- Transport: child-process stdin/stdout
- Envelope: JSON-RPC 2.0
- Framing: one JSON value per line
- Logs: stderr
- Typical flow: `initialize` → `authenticate` (`cursor_login`) → `session/new` or `session/load` → `session/prompt`
- Streaming: `session/update`
- Permission callback: `session/request_permission`
- Cancellation: `session/cancel` notification

Authentication can be prepared with `agent login`, `CURSOR_API_KEY`/`--api-key`, or `CURSOR_AUTH_TOKEN`/`--auth-token`. The provider should prefer Cursor-owned credentials and avoid copying tokens into Pi when a non-secret configured marker is sufficient.

## Protocol-version boundary

ACP upstream is actively developing v2, where session resume/close semantics differ from v1 and `session/resume` replaces v1's replaying `session/load` model. The locally tested Cursor build negotiated **v1** and advertised `loadSession`; it did not advertise resume or close.

The provider should:

- request/negotiate only versions supported by its installed SDK;
- branch on the negotiated version and advertised capabilities;
- implement v1 load/replay correctly for the MVP;
- keep session persistence behind an adapter so v2 resume can be added without changing Pi-facing state;
- never send draft/current-upstream methods solely because they exist on ACP main.

## Standard ACP surface needed by the provider

| Method | Direction | Provider behavior |
|---|---|---|
| `initialize` | Pi → Cursor | Send protocol v1, exact client capabilities, client identity, and Cursor parameterized-picker metadata |
| `authenticate` | Pi → Cursor | Use advertised `cursor_login`; report actionable auth errors |
| `session/new` | Pi → Cursor | Create binding with cwd and qualified MCP server list |
| `session/load` | Pi → Cursor | Restore a completed Cursor session; suppress replay notifications |
| `session/set_config_option` | Pi → Cursor | Set `mode`, model, and model-dependent options |
| `session/prompt` | Pi → Cursor | Send text/images; wait while consuming updates and blocking callbacks |
| `session/cancel` | Pi → Cursor | Cancel an active prompt; force-kill after a bounded grace period |
| `session/update` | Cursor → Pi | Map text, thought, plan, tool, mode/config, command, and session metadata |
| `session/request_permission` | Cursor → Pi | Always answer with an advertised option or cancellation |

The current agent advertised `sessionCapabilities.list`, but not `resume`, `fork`, or `close`. Code must branch on capabilities rather than infer support from the ACP version.

## Modes

Cursor documents three core session modes:

- `agent` — full coding-agent tools
- `plan` — read-only planning/design
- `ask` — read-only Q&A

Set the mode using the advertised `mode` session config option. Do not put a non-standard `mode` field on `session/prompt`; some small integrations do this, but current ACP configuration belongs in `session/set_config_option`.

Mode and approval policy are independent:

- Mode controls which operations the Cursor agent should attempt.
- Approval policy controls which attempted operations run automatically.

A provider command such as `/cursor-acp mode agent|plan|ask` is clearer than overloading Pi's model or thinking controls.

## Permissions

Cursor's docs warn that tool execution can block if the client does not answer `session/request_permission`. The response uses the standard ACP nested outcome:

```json
{
  "outcome": {
    "outcome": "selected",
    "optionId": "allow-once"
  }
}
```

or:

```json
{
  "outcome": {
    "outcome": "cancelled"
  }
}
```

Do not hard-code option ids as the only source of truth. Match the exact `optionId` values advertised on the request, preferring option `kind` (`allow_always`, `allow_once`, reject) and preserving unknown future ids.

Current CLI root flags include:

- `--auto-review` — classifier reviews non-allowlisted operations
- `--force` / `--yolo` — allow unless explicitly denied
- `--sandbox enabled|disabled`
- `--approve-mcps`
- `--trust`

T3 Code maps its Auto mode to `--auto-review` and Full Access to `--force`, then still auto-answers a permission request if Cursor emits one. That defense-in-depth pattern is worth adopting. The safe default should remain prompting/allowlist rather than force.

## Cursor extension methods

These are namespaced JSON-RPC extensions, not generic ACP methods.

### Blocking: `cursor/ask_question`

Request:

```ts
interface CursorAskQuestionRequest {
  toolCallId: string;
  title?: string;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    allowMultiple?: boolean;
  }>;
}
```

Required response shape:

```ts
interface CursorAskQuestionResponse {
  outcome:
    | {
        outcome: "answered";
        answers: Array<{
          questionId: string;
          selectedOptionIds: string[];
        }>;
      }
    | { outcome: "skipped"; reason?: string }
    | { outcome: "cancelled" };
}
```

Single-choice answers still use `selectedOptionIds: string[]`. Preserve ids; labels are display text only.

### Blocking: `cursor/create_plan`

Request includes `toolCallId`, optional `name`/`overview`, markdown `plan`, todos, optional project flag, and optional phases.

Required response shape:

```ts
interface CursorCreatePlanResponse {
  outcome:
    | { outcome: "accepted"; planUri?: string }
    | { outcome: "rejected"; reason?: string }
    | { outcome: "cancelled" };
}
```

This is explicit user approval. Do not silently accept every plan.

Issue `tiann/hapi#1044` documents a real failure caused by returning a flat outcome: the UI showed approval while Cursor interpreted it as cancellation. Regression tests must assert the complete JSON-RPC result shape.

### Notifications

Cursor documents these as fire-and-forget:

- `cursor/update_todos` — todo replacement/merge
- `cursor/task` — subagent task completion metadata
- `cursor/generate_image` — generated image path/data metadata

Although the docs show response interfaces, they classify these messages as notifications. A defensive dispatcher should process both forms:

- No JSON-RPC `id`: consume without response.
- Has an `id`: treat as a request and return a documented nested outcome, because protocol drift or older builds may send request-shaped messages.

Unknown extension notifications should be logged at debug level and ignored. Unknown extension requests must receive a bounded `-32601` response rather than hang.

## Model discovery and configuration

### Standard/session path

`session/new` and `session/load` return:

- legacy `models.currentModelId` / `models.availableModels`
- current `configOptions`, including a `category: "model"` selector

Without Cursor-specific metadata, the local agent returned parameterized ids such as:

```text
gpt-5.4[context=272k,reasoning=medium,fast=false]
```

### Cursor parameterized model picker

T3 Code initializes with:

```json
{
  "clientCapabilities": {
    "_meta": {
      "parameterizedModelPicker": true
    }
  }
}
```

With that capability, Cursor accepts base ids and returns model-dependent config options. The private extension:

```text
cursor/list_available_models
```

returned base model entries plus each model's config options in the current live probe. This method is used by current T3 Code but is not listed in Cursor's public ACP page, so it must have a fallback:

1. Try `cursor/list_available_models`.
2. If method-not-found, derive models from session setup's model config option or `models.availableModels`.
3. If probing fails, retain a cached catalog plus a conservative `default`/Auto model.

After changing the model, replace the local config snapshot with the **entire** `session/set_config_option` response. Model selection can add/remove valid options.

### Pi reasoning mapping

Inspect categories and names dynamically:

- `thought_level`: `effort`, `reasoning`, or equivalent
- `model_config`: `thinking`, `fast`, `context`, or future options

Normalize only known aliases:

- Cursor `none` → Pi `off` or `minimal`, depending on model semantics
- `low` → `low`
- `medium` → `medium`
- `high` → `high`
- `xhigh` / `extra-high` / `extra high` → `xhigh`
- `max` → `max`

Use each model's `thinkingLevelMap` to hide unsupported levels. Never send a value not present in the current session config response.

## Session update mapping

At minimum:

| Cursor update | Pi mapping |
|---|---|
| `agent_message_chunk` text | text stream |
| `agent_thought_chunk` text | thinking stream |
| `tool_call` / `tool_call_update` | compact thinking/status or custom diagnostics; not a Pi tool call for Cursor-native execution |
| plan update | thinking/status or plan widget |
| `current_mode_update` | binding state/status |
| `config_option_update` | replace config snapshot |
| `available_commands_update` | optional command metadata |
| `session_info_update` | optional Pi session name suggestion, never silently overwrite a user-set name |
| replay updates during `session/load` | consume for protocol progress, do not emit into Pi transcript |

Assistant segment ids must include at least Cursor session id, provider-runtime generation, and Pi turn/segment index. Historical T3 issue #2426 showed that using reusable Cursor segment ids as globally unique message ids can make later responses disappear.

## Stop reasons and usage

Proposed stop mapping:

- `end_turn` → `stop`
- `max_tokens`, `max_turn_requests` → `length`
- `cancelled` → `aborted`
- transport/protocol errors → `error`
- unknown successful terminal reason → `stop` while retaining `rawStopReason`

The current live prompt returned only `{ "stopReason": "end_turn" }`; no usage totals were present in prompt response or updates. Until a supported build exposes usage:

- keep cost at zero;
- report unknown/estimated counts clearly;
- do not report estimated cache read/write as fact;
- prevent Pi cache-miss warnings from interpreting absent fields as definitive zero if Pi exposes an unknown mechanism.
