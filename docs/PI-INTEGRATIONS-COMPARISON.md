# Existing Pi/Cursor integrations

## Comparison table

| Project | Boundary | Pi model picker | Persistent agent session | Pi tools | Main value | Main limitation |
|---|---|---:|---:|---:|---|---|
| `@rahularya01/pi-cursor` | private Cursor Connect/protobuf | yes | yes | direct translation | feature-rich current provider | reverse-engineered wire drift |
| `ndraiman/pi-cursor-provider` | private Cursor protocol via local proxy | yes | partial | translated | earlier full-provider pattern | context, image, lifecycle, blob failures |
| `sathish316/pi-omniagent-extensions` | native Cursor ACP | yes | yes | advertised ACP client callbacks | closest compact ACP provider | permissive callbacks; incomplete extensions/recovery |
| `0xKobold/pi-cursor` | native ACP delegation tool | no | no | Cursor-native | tiny prototype | not a provider; weak protocol/lifecycle handling |
| `luongnv89/pi-extensions/cursor-pi` | Cursor CLI print mode | no | per invocation | prompt-tag bridge | simple and decoupled | no ACP/session/provider semantics |
| T3 Code | native Cursor ACP | n/a | yes | HTTP MCP | strongest runtime reference | non-Pi architecture; extension response caveats |
| `raphaelluethy/cursor-acp` | ACP server wrapping Cursor Agent SDK | n/a | yes | Cursor SDK | opposite-direction adapter ideas | does not consume Cursor's built-in ACP |
| `oxiglade/cursor-acp` | ACP server wrapping CLI stream JSON | n/a | limited | Cursor-native | historical opposite-direction prototype | archived; superseded approach |

## `@rahularya01/pi-cursor` (installed extension)

Reviewed version: npm `1.4.33`, repository commit `324d2061cac068110b2ac9c783ef419b1fdf0501`.

### What it does well

- Registers Cursor as a real Pi provider.
- Discovers a broad model catalog and parameterized variants.
- Maps Pi messages/tools into Cursor's agent protocol.
- Streams text, thinking, tool calls, images, and usage-related data.
- Handles checkpoints, session continuation, command approval, auth, quota, diagnostics, and client-version spoofing.
- Has extensive compatibility code and tests.

### Why it is brittle

It does **not** use Cursor's ACP server. It reconstructs Cursor's private Connect/protobuf protocol. Its own `AGENTS.md` describes:

- generated schema under `src/proto`;
- pinned Cursor client version;
- unknown-field wire-drift reporting;
- checkpoint blob recovery;
- response-tracking invariants;
- special handling for Cursor's internal interaction updates.

Open issue #29 reports `claude-fable-5`/`5-1` failing on a new `interaction_update:stepCompleted` case despite a recent schema regeneration. The request reaches Cursor, receives an unknown step update, and ends with `failed_precondition`. This failure should disappear when using Cursor's supported ACP translation layer because Cursor owns both sides of that private evolution.

Open issue #30 shows a separate provider-boundary problem: Cursor's dashboard reports cache hits, but the private stream does not expose the breakdown expected by Pi, so Pi warns about false cache misses. Native ACP also omitted usage in the local probe, so the new provider must represent “unknown” honestly rather than claiming ACP automatically solves usage.

### What to borrow

- Model naming UX and compatibility aliases where they map cleanly to live ACP config.
- Diagnostic discipline, redaction, bounded buffers, and lifecycle logging.
- Clear error messages for auth/version/quota.
- Tests for image ordering and tool-call completion.

### What not to borrow

- Connect/protobuf schemas or client-version impersonation.
- Cursor checkpoint/blob formats.
- Private account/auth API calls.
- Assumptions that private model parameter strings are the provider contract.

## `ndraiman/pi-cursor-provider`

Reviewed commit: `82fc4e73f9ae820d87b34ac36713b18989910a36`.

This provider launches an HTTP proxy and adapts Pi's OpenAI-compatible request shape to a private Cursor backend. It demonstrates demand for a first-class provider but has several open bug reports that are useful as acceptance tests:

- #1: `Blob not found` / stuck task execution
- #3: image-capable models cannot read images
- #4: Pi `AGENTS.md`, skills, and extension context not reaching Cursor
- #5: MAX models fail
- #6: proxy server remains open, so print/JSON Pi processes hang
- #9: `ERR_STREAM_WRITE_AFTER_END` race crashes Pi
- #10: consecutive user messages cause the first real prompt to be dropped

The new provider should explicitly test all seven classes: persistence fallback, images, system context, parameterized models, shutdown, write-after-close, and consecutive-user message folding.

## `sathish316/pi-omniagent-extensions/cursor-acp.ts`

Reviewed commit: `5d16d0435bcac6a7713fa001c9280611c1d6d91a`.

This is the closest public compact proof that Cursor ACP can appear in Pi's model picker. It:

- registers a custom provider;
- maintains a `cursor-agent acp` process per Pi session;
- discovers models and modes from `session/new`;
- sends a bootstrap containing Pi system/history followed by new prompt deltas;
- maps text/thought/tool updates;
- forwards images;
- attempts cancellation;
- advertises ACP filesystem and terminal callbacks.

Important shortcomings:

- Standard permission handling defaults to auto-allow.
- Filesystem callbacks permit arbitrary paths; terminal callbacks run arbitrary commands in `cwd` without Pi permission mediation or root validation.
- It does not perform the advertised `authenticate` step explicitly.
- It does not handle `cursor/ask_question`, `cursor/create_plan`, todo/task/image extensions.
- It stores only in-memory ACP sessions and lacks `session/load` replay handling.
- Model parsing is tied to current option conventions.
- Lifecycle/cancellation behavior is comparatively light.
- Empty-text completion can produce fragile Pi event indexing.

Use it as feasibility evidence and a test oracle for simple update mapping, not as the implementation base.

## `0xKobold/pi-cursor`

Reviewed commit: `ee84320c41cbddb38a9fb41ea27a1703dbb7cbff`.

This registers a `cursor_agent` **tool**, not a provider. Each invocation launches a fresh ACP process, initializes a fresh session, sends one prompt, and returns accumulated text.

Consequences:

- no Cursor models in Pi's model picker;
- no Pi conversation continuity;
- no native Pi streaming/cost/thinking integration;
- no persistent Cursor session;
- no image or dynamic config support;
- no reliable permission/extension UX.

The source also contains signs of prototype-level handling: duplicate request fields, ad-hoc JSON-RPC response/request discrimination, leaked timeout paths, and kill-without-await cleanup. Reusing this code would cost more than starting from the Antigravity runtime.

## `luongnv89/pi-extensions/cursor-pi`

Reviewed commit: `ca99973d1e9d3e030657adac9519fe2a80bf0699`.

This delegation tool runs Cursor CLI `--print` and instructs Cursor to emit pseudo-XML markers when it wants a Pi tool. It then executes matching Pi tools and sends results back in another CLI invocation.

Advantages:

- uses a supported human CLI surface;
- small implementation;
- explicit Pi tool allowlist.

Limitations:

- tool protocol is prompt convention rather than structured ACP/MCP;
- no model-provider experience;
- no token streaming;
- process/session continuity is weak;
- tool recursion and serialization are custom.

It is a useful fallback architecture if Cursor ACP is unavailable, not the desired first-class integration.

## Adjacent ACP adapters

### `raphaelluethy/cursor-acp`

Reviewed commit: `95ddbf3188e55dbc620a56cf08725dac9bd39e8f`.

This runs an ACP server that wraps Cursor's Agent SDK for clients such as Zed—the opposite direction from this project. Useful ideas include transcript persistence, graceful read-only fallback when auto-review support differs, workspace validation, and config-option presentation. It introduces another translation layer and separate API-key setup, so it should not replace Cursor's built-in ACP in Pi.

### `oxiglade/cursor-acp`

Reviewed commit: `872017b49f5a6f9453cfc9e72a235a7e00405f90`.

An older, archived opposite-direction adapter that translated Cursor CLI stream JSON into ACP. It predates Cursor's built-in ACP command and is primarily historical evidence.

## Overall conclusion

There are three architecture families:

1. **Private protocol provider** — richest Pi integration but highest maintenance burden.
2. **Delegation tool** — easy to build but not first-class and weak on continuity.
3. **Native ACP provider** — now the best tradeoff, provided the provider handles Cursor extensions and lifecycle rigorously.

The new project should choose family 3 and combine the mature Pi plumbing of Antigravity with the Cursor-specific runtime lessons from T3.
