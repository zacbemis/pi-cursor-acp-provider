# Proposed first-class provider architecture

## Design goals

1. Cursor models behave like native Pi models, not a nested agent tool.
2. Cursor owns its private backend protocol, credentials, and native agent tools.
3. Pi owns transcript display, provider/model selection, reasoning UX, session tree, cancellation UX, and optional extension tools.
4. The process boundary is explicit, bounded, observable, and cleanly terminated.
5. Safe behavior is the default; auto-approval is opt-in.
6. Compatibility failures degrade to a fresh session or fallback catalog, not corrupt state or hang Pi.

## Proposed package shape

```text
src/
  index.ts                         package entrypoint
  provider.ts                      Provider<"cursor-acp"> registration
  runtime.ts                       provider/session lifecycle coordinator
  models.ts                        catalog projection and reasoning maps
  config.ts                        user settings and permission/mode policy
  constants.ts
  acp/
    connection.ts                  ACP SDK wrapper + Cursor ext handlers
    process.ts                     locate/spawn/terminate cursor-agent
    bounded-stream.ts              NDJSON limits/noise policy
    errors.ts                      typed/redacted errors
    cursor-extension.ts            schemas and strict response builders
    discovery.ts                   short-lived model/capability probe
    session-store.ts               Pi ↔ Cursor binding metadata
  stream/
    accumulator.ts                 ordered update → Pi event state machine
    context.ts                     first-turn bootstrap/incremental delta
    interactions.ts                permission/question/plan broker
  mcp/
    bridge.ts                      reused authenticated loopback Pi MCP bridge
    translator.ts                  Pi tools ↔ MCP schema/results
    image-store.ts                 bounded temporary image resources
  commands/
    mode.ts                        Agent/Plan/Ask
    permissions.ts                 Prompt/Auto-review/Run Everything
    config.ts                      context/fast diagnostics
    doctor.ts                      CLI/auth/capability checks
  tools/
    permission.ts                  synthetic Pi interaction tools
    question.ts
    plan.ts
```

Names are illustrative. Preserve module boundaries, not necessarily this exact tree.

## Provider registration

Register a complete Pi `Provider` rather than `pi.registerTool` delegation.

```ts
const provider: Provider<"cursor-acp"> = {
  id: "cursor-acp",
  name: "Cursor (ACP)",
  auth: cursorCliAuth,
  models,
  streamSimple: (model, context, options) =>
    runtime.stream(model, context, options),
  refreshModels: (ctx) => runtime.refreshModels(ctx),
};
```

### Pi package lifecycle

Pi extension factories run during discovery and must not leak resources. Therefore:

- construct the runtime lazily;
- do not spawn Cursor in the extension factory;
- use a short-lived discovery process only in `refreshModels` or an explicitly bounded first-use path;
- close session bindings on `session_shutdown`;
- allow Node to exit in print/JSON mode;
- return cleanup from the extension entrypoint if supported by the current Pi package API.

This directly prevents the local-proxy hang reported in `ndraiman/pi-cursor-provider#6`.

## Process manager

### Binary selection

Order:

1. explicit `PI_CURSOR_ACP_COMMAND` or provider config;
2. `cursor-agent` on `PATH`;
3. `agent` on `PATH`.

Validate with a short, bounded version command and include the resolved path/version in `/cursor-acp doctor`. Do not download or auto-update Cursor; tell the user to use Cursor's supported install/update flow.

### Arguments

```text
Prompt/allowlist: cursor-agent acp
Auto-review:       cursor-agent --auto-review acp
Run Everything:    cursor-agent --force acp
```

Optional endpoint/auth flags come before `acp`. Never log token values. Consider `--trust` and `--approve-mcps` separate explicit settings; do not silently enable them.

### Process lifetime

- One process connection per active Pi-session binding.
- One ACP session id per binding.
- Serialize `session/prompt` calls per binding.
- A model switch can reconfigure the current ACP session; if configuration becomes inconsistent, rotate the binding.
- Permission-policy flag changes require process rotation.
- Mode changes usually require only `session/set_config_option`.
- MCP tool-set changes can require binding rotation because servers are supplied at `session/new`/`load`.

Capture stderr in a bounded ring. Redact bearer/API tokens, auth URLs, local secrets, prompt content in default logs, and absolute home paths where practical.

### Termination

1. settle pending interactions as cancelled;
2. send `session/cancel` if a prompt is active;
3. close JSON-RPC input/connection;
4. send graceful process termination;
5. wait a short bounded interval;
6. kill the process tree;
7. await exit and remove listeners.

`close()` must be idempotent and safe after partial startup.

## ACP connection

Reuse the official `@agentclientprotocol/sdk` and Antigravity's hardened connection wrapper. Extend its client callback factory:

```ts
() => ({
  requestPermission,
  sessionUpdate,
  extMethod: async (method, params) => { /* strict Cursor handlers */ },
  extNotification: async (method, params) => { /* todos/tasks/images */ },
})
```

Initialization should send:

```json
{
  "protocolVersion": 1,
  "clientCapabilities": {
    "fs": { "readTextFile": false, "writeTextFile": false },
    "terminal": false,
    "_meta": { "parameterizedModelPicker": true }
  },
  "clientInfo": {
    "name": "pi-cursor-acp-provider",
    "title": "Pi Cursor ACP Provider",
    "version": "<package version>"
  }
}
```

The official SDK's normal transport dispatches standard methods; its generic extension hooks support Cursor's namespaced methods. Keep Cursor schemas local and validate unknown/malformed input at runtime.

## Authentication

Cursor should remain credential owner.

### CLI login

Proposed flow:

- `auth.check` runs a bounded `cursor-agent status`/`whoami` and detects an authenticated session without retaining identity.
- login launches `cursor-agent login` through Pi's auth interaction/progress surface.
- Pi stores only a durable non-secret marker so the provider remains selected/visible.
- stream startup still calls ACP `authenticate { methodId: "cursor_login" }`; a stale marker cannot bypass real authentication.

### Environment/API token

If `CURSOR_API_KEY` or `CURSOR_AUTH_TOKEN` is present, pass it through the child environment and report only the source. An optional Pi secret login can be added later, but storing a duplicate token should not be the default.

### Failure hygiene

Authentication progress belongs in UI/status events, never assistant text. This prevents the stale-auth-content class described by T3 issue #2237.

## Model catalog

### Discovery

Use a short-lived, authenticated ACP session with `parameterizedModelPicker`. Cache normalized catalog data under Pi state with:

- Cursor binary version;
- provider schema version;
- auth/account fingerprint that is not personally identifying;
- fetched timestamp;
- model ids, labels, and config descriptors.

Try `cursor/list_available_models`, then standard setup config. Cache lifetime should be moderate (T3 uses 30 minutes); stale cache is acceptable if first use revalidates configuration.

### Pi projection

Expose one Pi model for each Cursor base model:

```ts
{
  id: "gpt-5.4",
  name: "GPT-5.4",
  api: "cursor-acp",
  provider: "cursor-acp",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: bestKnownContext,
  maxTokens: conservativeUnknownOutput,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  thinkingLevelMap: dynamicMap
}
```

Do not pretend Cursor subscription usage is per-token API cost. Use zero cost and label usage unavailable.

### Reasoning and other controls

- Pi reasoning → currently advertised thought-level option.
- Context → model default initially; optional `/cursor-acp context` command later.
- Fast → model default initially; optional `/cursor-acp fast` command later.
- Thinking boolean → derive from Pi `off` versus non-off if the model exposes only a boolean.

If a model has both a thinking toggle and effort, set toggle first, then effort, validating the returned config after each operation.

Avoid generating every `[context=…,effort=…,fast=…]` combination as a Pi model. It creates a noisy picker and stale assumptions.

## Session identity, restore, and Pi branches

Persist a binding record in Pi session provider metadata or runtime state:

```ts
interface CursorBindingRecord {
  cursorSessionId: string;
  cwd: string;
  completedTurns: number;
  piContextFingerprint: string;
  modelId: string;
  config: Record<string, string | boolean>;
  cursorVersion: string;
}
```

### New session

- Create ACP session with cwd and MCP descriptors.
- Set mode/model/options.
- On first prompt, bootstrap Cursor with Pi's system prompt and active conversation context.
- Persist the ACP id only after a successful completed turn.

### Load

- Establish a replay gate **before** calling `session/load`.
- Consume but do not emit historical updates.
- Wait for the load response and a small bounded idle/drain barrier.
- Reapply mode/model/options.
- Compare the active Pi context fingerprint.
- If mismatched, close/rotate and create a fresh Cursor session.

### Branch/fork

The current agent does not advertise ACP fork. Pi can branch its own history, so detect divergence and bootstrap a fresh Cursor session from the selected branch. Never continue the old Cursor session with a contradictory hidden history.

## Prompt/context translation

The first Cursor turn needs enough Pi context to preserve Pi behavior:

- Pi system prompt and extension instructions;
- relevant prior user/assistant messages;
- completed Pi tool calls/results;
- the active user message;
- image content as ACP image blocks.

Subsequent turns should send only unseen user/context deltas because Cursor already holds its own conversation.

Requirements:

- merge consecutive user/custom messages; do not keep only the last one (`ndraiman#10`);
- include injected extension context and `AGENTS.md` content from Pi's `Context` (`ndraiman#4`);
- preserve tool-result association and errors;
- bound bootstrap size and report truncation;
- fingerprint sent history to detect edits, branch switches, compaction, or session rewind;
- if uncertain, rotate and bootstrap rather than duplicate messages into an existing Cursor session.

Cursor should receive a short runtime instruction explaining:

- it is running behind Pi;
- Cursor-native tools execute directly;
- named MCP tools, if present, are Pi-provided;
- blocking plan/question interactions must await client responses;
- no claim should be made that unavailable Pi tools were executed.

## Streaming state machine

Use a turn accumulator, not direct update-to-event callbacks.

State should include:

- text/thinking block open/closed status;
- current Cursor tool-call snapshots;
- unique Pi item ids;
- raw stop reason;
- pending interactions;
- replay/startup/live phase;
- terminal-event-emitted flag.

Rules:

1. Open a Pi text/thinking block before emitting a delta.
2. Close a thinking block before text if required by Pi event grammar.
3. Ignore duplicate/no-progress tool updates.
4. Show Cursor-native tool status as thinking/status, not a Pi tool call, because Cursor—not Pi—executes it.
5. Show Pi MCP-mediated tool activity through the MCP broker's synthetic Pi tool call path.
6. Drain notifications queued before the prompt response.
7. Emit exactly one terminal event on success, cancellation, transport error, and preparation failure.
8. Ignore late updates from cancelled/retired runtime generations.

## Blocking interaction broker

A provider stream cannot safely invoke Pi TUI APIs directly and must work in interactive, print, RPC, and JSON modes. Generalize Antigravity's pending-permission bridge:

```text
Cursor request blocks
  → runtime stores pending request/deferred
  → current Pi stream emits a synthetic tool call and stops with toolUse
  → registered Pi tool asks the user through ctx.ui (or follows headless policy)
  → tool result/details contain structured ids and decision
  → next stream call resolves pending Cursor request
  → original session/prompt continues
```

Three tools:

- `cursor_acp_permission`
- `cursor_acp_question`
- `cursor_acp_plan`

Tool parameters should contain an opaque interaction id, not user-editable decision fields. Results return structured data in `details`; do not parse human text.

### Headless policy

- Prompt mode: reject/cancel if no UI is available, never hang.
- Auto-review: rely on `--auto-review`, then handle residual permission according to advertised safe option.
- Run Everything: rely on `--force`, then choose advertised allow-always/allow-once fallback.
- Questions: skip or cancel with explicit reason when no response channel exists.
- Plans: reject/cancel, not auto-accept, unless user explicitly configured that policy.

All paths have timeouts and resolve their ACP request before teardown.

## Cursor extension notifications

- Todo updates: maintain a per-session todo snapshot and optionally render as status.
- Task completion: display bounded subagent status; do not treat untrusted nested text as protocol.
- Generated images: validate path/data, size, MIME, and workspace boundary before attaching to Pi output.
- Unknown notifications: bounded debug log.
- Unknown requests: respond method-not-found immediately.

## Pi tools over MCP

The Antigravity authenticated loopback MCP bridge is the best reuse candidate:

- random bearer token;
- loopback bind only;
- per-session opaque URL;
- strict Origin/Host/path validation;
- bounded JSON/body/image handling;
- Pi tool schema translation;
- synthetic Pi tool-call round trip;
- cleanup on session close.

However, Cursor also has native tools. Avoid duplicate names and ambiguous authority:

- prefix bridged tools, for example `pi__<name>`;
- document that Cursor-native edits/shell bypass Pi tool hooks;
- provide an opt-out;
- do not use `--approve-mcps` by default;
- qualify canary discovery/invocation against every supported Cursor build.

If Cursor ignores injected MCP, disable the bridge with a diagnostic rather than misleading the model.

## Security boundary

Disabling ACP client `fs` and `terminal` capabilities prevents Cursor from asking the provider to perform arbitrary callbacks. It does **not** prevent the spawned Cursor agent from using its own filesystem, terminal, web, plugins, rules, or configured MCP tools.

Provider documentation and UI must make this explicit. Security controls are:

- Cursor mode (`plan`/`ask` for read-only behavior);
- Cursor CLI permission configuration and sandbox;
- launch permission policy;
- workspace/cwd;
- process environment;
- user-maintained Cursor deny rules;
- optional isolation outside this provider.

Never market default ACP mode as a sandbox.

## Antigravity reuse map

Source snapshot: `/home/zacb/projects/pi-gemini-acp-provider`, commit `ff3c13c33ba8c378393382e958d32cb2e4bd6e78`, MIT licensed.

| Existing area | Reuse | Cursor change |
|---|---|---|
| `src/provider.ts` | high | provider id/name, Cursor auth, dynamic models |
| `src/runtime.ts` | high conceptually | remove runtime download/Google setup; add Cursor flags/modes/extensions |
| `src/acp/connection.ts` | very high | `_meta`, ext handlers, Cursor auth helper, session list/config helpers |
| `src/acp/process.ts` | high | discover system CLI; no bundled runtime |
| `src/acp/bounded-stream.ts` | direct | possibly preserve Cursor compatibility-noise metrics |
| `src/acp/errors.ts` | high | Cursor-specific error taxonomy/redaction |
| `src/acp/session.ts` | high | replay gate, dynamic config, fresh-on-divergence |
| `src/stream/*` | high | Cursor update variants and native-tool representation |
| `src/permissions/*` | very high | generalize to three interaction kinds and exact option ids |
| `src/mcp/*` | conditional/high | Cursor server declaration and namespacing; live qualification |
| `src/models.ts` | structural only | fully dynamic Cursor model/config projection |
| auth/runtime distribution | do not reuse | Cursor CLI owns install/login/update |
| Google API-key/model probing | do not reuse | Cursor CLI/ACP discovery only |

T3 is MIT licensed as well, but prefer learning the patterns and implementing against public ACP/Cursor schemas rather than copying its Effect-specific code or incorrect extension envelopes.
