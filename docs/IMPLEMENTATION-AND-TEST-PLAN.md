# Implementation and test plan

## Initial implementation status (2026-09-11)

| Phase | Status |
|---|---|
| Transport/process | implemented and mock/live tested |
| Provider/model discovery | implemented; version-keyed 24-hour disk cache, explicit refresh, and safe fallback |
| Streaming/context/images | implemented; text/thought live tested, image unit path tested |
| Persistence/replay/branches | implemented and mock tested |
| Permissions/questions/plans | implemented with nested outcomes and mock tests; live interactive matrix remains |
| Modes/policies/notifications | core implemented; notifications are text status, fast/context commands deferred |
| Pi MCP bridge | implemented, mock tested, and live canary passed on the qualified Cursor build |

The remaining qualification and portability work below is intentionally retained as the release checklist.

## Phase 0 — Freeze protocol fixtures

Before feature code:

- capture sanitized initialize/new/load/config/prompt fixtures from the supported Cursor build;
- encode official Cursor extension request/response examples as fixtures;
- create a deterministic mock ACP agent modeled after T3's test script;
- document supported OS and minimum Cursor CLI version policy;
- choose whether package versioning pins a tested Cursor release range or uses “best effort + doctor warning.”

Deliverable: fixture-only tests can distinguish notification, request, response, malformed line, oversized frame, stderr noise, and EOF.

## Phase 1 — Transport and process

Port/generalize from Antigravity:

- bounded NDJSON stream;
- process wrapper and process-tree termination;
- ACP SDK connection;
- initialization and authentication;
- new/load/cancel/prompt/config methods;
- Cursor `extMethod`/`extNotification` dispatcher;
- typed redacted errors;
- `/cursor-acp doctor` data collection.

Acceptance criteria:

- no process on extension discovery;
- initialize/auth/new work in a fixture test and a live smoke test;
- malformed/oversized stdout closes the process with an actionable error;
- stderr cannot grow memory without bound;
- close is idempotent at every partial-startup stage;
- a print-mode Pi process exits without leaked listeners, servers, timers, or children.

## Phase 2 — Provider and model catalog

Implement:

- Pi provider registration;
- Cursor-owned auth marker/check flow;
- short-lived discovery;
- standard config fallback;
- versioned disk cache;
- model projection and reasoning maps;
- refreshModels;
- conservative fallback model.

Acceptance criteria:

- Cursor base models appear under provider `cursor-acp`;
- changing Pi model applies base model first, then valid dependent options;
- unsupported reasoning levels are not sent;
- extension method-not-found still yields a usable catalog;
- stale/invalid cache cannot crash Pi startup;
- no token/cost precision is fabricated.

## Phase 3 — Session and basic streaming

Implement:

- lazy binding per Pi session;
- first-turn system/history bootstrap;
- incremental subsequent prompts;
- images;
- text/thought accumulator;
- metadata filtering;
- stop-reason mapping;
- cancellation and terminal-event invariant.

Acceptance criteria:

- multi-turn continuity works without resending visible history;
- consecutive user/custom messages are all retained;
- Pi system prompt, project instructions, extension context, and tool results reach Cursor;
- image-capable model receives an image;
- text and thinking satisfy Pi event grammar;
- a no-text successful turn still produces a valid assistant message;
- preparation, generation, and post-response failures each produce exactly one terminal event;
- abort does not leak lock or process state.

## Phase 4 — Session persistence and branches

Implement:

- completed-turn binding persistence;
- load replay gate and idle/drain barrier;
- model/mode reapplication;
- context fingerprints;
- load fallback;
- new session on branch divergence.

Acceptance criteria:

- fresh-process load does not duplicate any old user/thought/assistant text;
- loading an empty/missing/old session starts fresh;
- loaded session continues coherently;
- model selected in Pi wins after load;
- Pi branch switch does not continue the wrong hidden Cursor history;
- replay/tool ids cannot collide with a later response.

## Phase 5 — Permissions and Cursor interactions

Generalize the synthetic interaction broker for:

- standard ACP permission;
- `cursor/ask_question`;
- `cursor/create_plan`;
- residual requests under auto-review/full-access.

Acceptance criteria:

- every request resolves on allow/reject/cancel/timeout/abort/shutdown;
- returned option ids are exactly those advertised by Cursor;
- ask answers retain question and option ids, including multi-select;
- plan responses have nested `outcome.outcome` envelopes;
- plan approval is explicit in prompt mode;
- headless mode fails closed and never hangs;
- malformed extension params receive an immediate protocol error;
- no assistant text falsely claims an action was approved.

### Wire-shape golden tests

```json
{
  "outcome": {
    "outcome": "selected",
    "optionId": "<advertised id>"
  }
}
```

```json
{
  "outcome": {
    "outcome": "answered",
    "answers": [
      {
        "questionId": "q1",
        "selectedOptionIds": ["a1"]
      }
    ]
  }
}
```

```json
{
  "outcome": {
    "outcome": "accepted"
  }
}
```

Tests should inspect raw JSON-RPC output, not only TypeScript return values.

## Phase 6 — Modes, policy, and notifications

Implement:

- `/cursor-acp mode agent|plan|ask`;
- `/cursor-acp permissions prompt|auto-review|full-access`;
- optional fast/context controls;
- todo/task/generated-image state;
- diagnostics/status.

Acceptance criteria:

- mode changes use advertised config ids;
- policy changes rotate process when flags change;
- Ask/Plan remain read-only according to live canary tests;
- generated image paths/data are size/type/root validated;
- unknown extension notification is harmless;
- unknown extension request receives method-not-found.

## Phase 7 — Pi MCP bridge (optional release gate)

Port the Antigravity bridge, namespace tools, and pass the HTTP descriptor in session setup.

Acceptance criteria:

- live Cursor connects to a loopback canary server;
- Cursor lists and invokes a canary Pi tool;
- authorization token is required and redacted;
- only loopback is bound;
- denied Pi tool call returns a structured result without deadlock;
- tool result reaches the same active Cursor prompt;
- duplicate Cursor-native/Pi tool names are prevented;
- bridge closes on session shutdown and print-mode exit;
- dynamic tool-set change either refreshes safely or rotates the binding.

If the current supported Cursor build advertises but ignores the server, ship the provider with bridge disabled and explain the limitation.

## Test layers

### Unit

- NDJSON framing and maximum size
- error redaction
- model/config normalization
- reasoning alias mapping
- option selection by kind/id
- nested extension outcomes
- context folding/fingerprints
- event accumulator grammar
- id generation
- stop mapping
- state transitions and idempotent close

### Mock ACP integration

Script scenarios:

- clean streaming turn;
- thought→text and alternating segments;
- metadata before/after content;
- tool progress and duplicate updates;
- prompt response before final queued notification;
- permission/question/plan requests;
- no-content turn;
- malformed extension request;
- cancel during initialize/auth/new/config/prompt/interaction;
- process exit at every lifecycle phase;
- load with replay before response;
- load error;
- stale update from previous generation;
- reused Cursor content ids;
- concurrent/steering request during preparation.

### Pi integration

Use Pi's provider APIs and a fake Cursor command to verify:

- package discovery has no side effects;
- provider/model registration;
- auth visibility;
- `/model` and Shift+Tab selection;
- interactive permission tool;
- JSON/RPC/headless behavior;
- session save/load/fork;
- print-mode exit;
- extension-injected custom messages;
- tools and images.

### Live smoke

Run only with explicit opt-in and an isolated temporary git repository:

1. initialize/auth/new;
2. list/select model and reasoning;
3. Ask-mode exact-response prompt;
4. Agent read-only tool call;
5. permission reject, allow-once, allow-always;
6. Plan create/accept/reject;
7. question answer/skip;
8. image prompt;
9. cancel long operation;
10. load completed session in fresh process;
11. MCP canary;
12. process cleanup.

Never run destructive live tests in a user's real repository.

## Regression checklist from ecosystem issues

| Failure class | Regression source |
|---|---|
| private wire schema drift | `Rahularya01/pi-cursor#29` |
| missing cache fields interpreted as miss | `Rahularya01/pi-cursor#30` |
| dropped first/consecutive user prompt | `ndraiman/pi-cursor-provider#10` |
| write after stream end | `ndraiman/pi-cursor-provider#9` |
| process does not exit | `ndraiman/pi-cursor-provider#6` |
| parameterized/MAX model failure | `ndraiman/pi-cursor-provider#5` |
| Pi system/skill context omitted | `ndraiman/pi-cursor-provider#4` |
| image omitted | `ndraiman/pi-cursor-provider#3` |
| persisted blob/session disappears | `ndraiman/pi-cursor-provider#1` |
| resumed history duplicated | `pingdotgg/t3code#3149` |
| assistant id collision hides output | `pingdotgg/t3code#2426` |
| consumer dies after startup | `pingdotgg/t3code#5781` |
| prepare-time cancellation/lock race | `pingdotgg/t3code#9047` |
| repeated permission prompts | `pingdotgg/t3code#6533` |
| stale auth emitted as assistant content | `pingdotgg/t3code#2237` |
| wrong nested plan outcome | `tiann/hapi#1044` |
| advertised MCP ignored | `repoprompt/repoprompt-ce#158` |

## Compatibility matrix

Test and record:

- Cursor CLI exact version/build;
- ACP initialize protocol/capabilities;
- auth methods;
- new/load/list behavior;
- parameterized-picker support;
- model discovery extension availability;
- option categories and boolean/select encoding;
- extension method schemas;
- permissions under each root flag;
- injected MCP behavior;
- usage metadata;
- OS/process-tree behavior.

At minimum test Linux plus one of macOS/Windows before a broad release. WSL deserves a specific path/process test if supported.

## Release gates

### Must pass for MVP

- auth/new/prompt/cancel;
- model selection and reasoning;
- valid Pi streaming;
- exact blocking-request envelopes;
- no replay duplication;
- branch-safe session behavior;
- deterministic shutdown;
- safe default permissions;
- image support claim matches a live test;
- diagnostics identify unsupported Cursor versions clearly.

### May ship disabled/experimental

- Pi MCP tools;
- todo/task/image-rich rendering;
- session import/list UX;
- fast/context commands;
- token/cache usage.

### Must not ship

- default auto-allow;
- unrestricted ACP filesystem/terminal callbacks;
- unbounded stdout/stderr/body/image buffering;
- auto-accepted plans in prompt mode;
- a model catalog dependent only on an undocumented extension;
- session load without replay suppression;
- token/cost values presented as authoritative without a source.
