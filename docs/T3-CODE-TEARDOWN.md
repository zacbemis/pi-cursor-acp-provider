# T3 Code Cursor integration teardown

## Snapshot reviewed

Repository: `pingdotgg/t3code`

Commit: `05d404210058d714cfef902517fc20ad66b82339` (2026-09-11)

Primary files:

- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/acp/CursorAcpSupport.ts`
- `apps/server/src/provider/acp/CursorAcpExtension.ts`
- `apps/server/src/provider/acp/AcpSessionRuntime.ts`
- `apps/server/src/provider/Layers/CursorProvider.ts`
- associated tests and `apps/server/scripts/acp-mock-agent.ts`

## High-level design

T3 treats Cursor as a first-class provider adapter, not a delegated tool.

```text
T3 thread
  → CursorAdapter
    → shared AcpSessionRuntime
      → cursor-agent [permission flag] acp
        ↔ ACP JSON-RPC over stdio
```

Each T3 thread has a scoped Cursor ACP runtime containing:

- thread/provider session metadata;
- ACP process and session id;
- pending approval and user-input deferreds;
- notification-consumer fiber;
- turn state and generated event ids;
- current model/mode config state;
- assistant segment tracking;
- cancellation and shutdown state.

The adapter translates ACP updates into provider-neutral T3 events rather than exposing raw JSON-RPC to the UI.

## Startup sequence

T3's shared runtime:

1. resolves/spawns the CLI;
2. starts bounded stderr and protocol handling;
3. sends `initialize`;
4. sends `authenticate { methodId: "cursor_login" }`;
5. loads or creates a session;
6. captures modes/config options;
7. starts an event consumer in the session scope;
8. applies requested model and mode.

Cursor spawn arguments are:

```ts
[
  ...(apiEndpoint ? ["-e", apiEndpoint] : []),
  ...(runtimeMode === "auto" ? ["--auto-review"] : []),
  ...(runtimeMode === "full-access" ? ["--force"] : []),
  "acp",
]
```

T3 also auto-selects `allow_always`, then `allow_once`, if a permission request still arrives in Full Access mode.

### Adopt

- Root options before `acp`.
- Explicit `cursor_login` authenticate step.
- Bounded startup, load, cancel, and prompt operations.
- A process/session scope independent of the request-handler fiber.
- Defense-in-depth permission response after launch flags.
- Idempotent teardown that settles every pending deferred.

## Client capabilities

T3 sends Cursor-specific metadata:

```json
{
  "_meta": {
    "parameterizedModelPicker": true
  }
}
```

Its shared runtime defaults ACP filesystem read/write and terminal callbacks to false. This leaves execution with Cursor's own agent tools instead of giving the ACP server another client-side shell/filesystem surface.

### Adopt

Use the same minimal capabilities. Add Pi tools through a named authenticated MCP bridge only after live qualification, not by advertising unrestricted ACP client filesystem/terminal callbacks.

## Model discovery and options

T3 uses a short-lived ACP runtime to call:

```text
cursor/list_available_models
```

It caches successful discovery for 30 minutes and keys invalidation to Cursor version/auth state. It initializes with `parameterizedModelPicker` so each discovered base model includes config options.

For each model, T3 derives capabilities dynamically:

- reasoning/effort from option id/name/category;
- context size from model-config options;
- fast mode from boolean-like options;
- thinking toggle from boolean-like options.

When selecting a model, T3:

1. strips any bracket suffix to a base model id;
2. sends `session/set_config_option` for model;
3. reads the returned config option list;
4. sends currently valid effort/context/fast/thinking values.

It supports both actual ACP boolean options and select options containing string values `true`/`false`.

### Adopt

- Optional Cursor extension discovery with session-response fallback.
- Cache outside Pi's startup critical path.
- Dynamic option parsing rather than hard-coded model suffix tables.
- Set base model first, then dependent options.
- Replace local config state after every set response.
- Normalize `xhigh`, `extra-high`, and `extra high`.

### Adapt for Pi

Pi has first-class thinking levels but not T3's arbitrary per-model option descriptors. The provider should expose one base model plus `thinkingLevelMap`, then choose a documented policy for context and fast controls (config defaults, commands, or explicit model variants). Avoid a combinatorial model list.

## Modes

T3 finds modes by aliases rather than fixed array position. It applies mode through session configuration.

### Adopt

Resolve advertised ids by exact id/name first, then conservative aliases. Keep the last known mode snapshot and consume `current_mode_update` notifications.

### Do not copy blindly

T3's internal runtime mode mapping is product-specific. In the reviewed source, an approval-required runtime can prefer the ACP `ask` mode. For this project, Cursor execution mode and approval policy should be independent user settings.

## Streaming and event ordering

T3's shared runtime:

- parses text, thought, plan, and tool updates;
- merges partial tool-call state;
- suppresses duplicate/no-progress updates;
- segments assistant messages around tool activity;
- generates ids containing session plus runtime generation/segment index;
- drains an event barrier after prompt completion;
- captures startup metadata notifications separately;
- rejects updates from child/foreign session ids.

Historical issue #2426 reported disappearing responses when assistant ids collided. Current code generates ids with a runtime nonce and segment index. Historical issue #5781 found that a notification consumer forked as a child of the startup request died when startup returned; current code uses `Effect.forkIn(ctx.scope)`.

### Adopt

- Namespace every item id with runtime generation and Pi turn.
- Treat update handling as ordered state, not independent callbacks.
- Drain queued updates before declaring a turn complete.
- Scope event consumers to the session, never the initiating request.
- Filter foreign child-session updates unless explicit lineage support exists.

## Load and replay

T3 stores Cursor's ACP session id as a resume cursor. The shared runtime supports `session/load` and contains:

- a load gate;
- replay detection;
- a load timeout;
- a configurable replay idle gap;
- suppression of replayed updates before normal live event processing begins.

This addresses issue #3149, where prior user/assistant/tool history was appended again during resume.

### Adopt

The behavior was reproduced locally. Pi already owns its transcript, so suppress all load replay. Persist both Pi-history fingerprints and the ACP session id; start fresh when history diverges or load fails.

## Cancellation and lifecycle

T3 serializes prompts, tracks the active prompt fiber, sends native cancel, waits/drains when configured, and kills a process after bounded cancellation failure. Teardown resolves pending approvals/questions as cancellation before closing scope.

### Adopt

- One prompt queue per session binding.
- Abort listener registered before dispatch.
- Native `session/cancel`, then bounded process termination.
- Cancellation-safe pending permission/question/plan deferreds.
- Exactly one terminal Pi stream event.

### Known remaining T3 issue

Open issue #9047 identifies four CursorAdapter risks in the reviewed source:

1. `activeTurnId` is assigned after effectful configuration, allowing concurrent steering misattribution.
2. A started turn can fail without an adapter-side terminal event.
3. cancellation during pre-prompt preparation can be ignored;
4. the thread-lock map can retain entries forever.

These should become regression tests before implementation, not inherited bugs.

## Permissions

T3 parses each request into a neutral approval event, waits on a deferred, and maps the user's decision back to the exact ACP option. It cancels outstanding requests during interruption or teardown.

Historical issue #6533 documented excessive prompts. Current T3 code responds by passing `--auto-review`/`--force` and retaining request-level fallback handling.

### Adopt

Generalize the Antigravity provider's synthetic Pi permission tool using T3's option-selection logic. A model provider stream does not have a safe direct TUI handle, so a pending ACP request should surface as a Pi tool call and resume after its tool result.

## Cursor extension methods

The reviewed adapter registers:

- blocking `cursor/ask_question`;
- blocking `cursor/create_plan`;
- notification `cursor/update_todos`.

It does not register `cursor/task` or `cursor/generate_image` in the reviewed file.

### Important divergence from current Cursor docs

T3's current handlers return:

```ts
// ask_question
{ answers: resolved }

// create_plan
{ accepted: true }
```

Cursor's current public documentation requires nested outcomes:

```ts
{ outcome: { outcome: "answered", answers: [...] } }
{ outcome: { outcome: "accepted" } }
```

T3 also maps question options to labels without retaining the original option ids in its neutral question type, and its create-plan path auto-accepts rather than requesting explicit user approval.

**Do not copy these response shapes or semantics.** Use Cursor's public schemas and add wire-level regression tests. `tiann/hapi#1044` confirms that a wrong outcome envelope can make an approved plan look cancelled to Cursor.

## MCP

T3 may pass a per-thread authenticated HTTP MCP endpoint in `session/new`. This is architecturally similar to the Antigravity provider's Pi MCP bridge.

### Adopt conditionally

Use the existing bridge, but gate it on a live test where Cursor actually connects and calls a canary tool. Issue `repoprompt/repoprompt-ce#158` reports that a June 2026 Cursor build advertised HTTP/SSE MCP but ignored injected servers. The issue remains open; current behavior was not qualified in this research.

## Overall assessment

T3 is the best Cursor-specific implementation reference found. Its process/runtime, model configuration, replay handling, and permission launch policy are mature and directly useful. It is not a drop-in blueprint: its product abstractions differ from Pi, its open lifecycle race should be avoided, and its current Cursor extension response handling conflicts with official schemas.
