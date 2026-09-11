# Executive summary

## Recommendation

**Build it.** Cursor now ships an official ACP v1 server through `cursor-agent acp` (also installed as `agent acp`). A first-class Pi provider can use the same broad architecture as `pi-antigravity-acp-provider` without depending on Cursor's private Connect/protobuf wire protocol.

Recommended product shape:

- Provider id: `cursor-acp`
- One Cursor ACP process/session binding per active Pi session
- Cursor models in Pi's `/model` picker
- Pi Shift+Tab reasoning mapped to Cursor's dynamic `thought_level` config option
- Cursor modes and permission policy exposed separately
- Streaming text/thought mapping, cancellation, images, session persistence, and load-replay suppression
- Synthetic Pi tools for blocking permission, question, and plan-approval round trips
- Optional Pi-tool exposure through the existing authenticated loopback MCP bridge, gated by a live compatibility test

Do **not** begin from the small `0xKobold/pi-cursor` extension. It is a delegation tool rather than a model provider and has protocol/lifecycle flaws. The closest small provider reference is `sathish316/pi-omniagent-extensions/cursor-acp.ts`, but its security defaults and incomplete Cursor extension handling are not suitable for a polished provider. The strongest references are:

1. `pi-antigravity-acp-provider` for Pi provider integration, streaming, pending-interaction brokering, MCP, lifecycle, and testing.
2. T3 Code's Cursor adapter for Cursor-specific startup flags, parameterized model discovery, dynamic config options, and ACP runtime hardening.
3. Cursor's official ACP documentation for extension request schemas. This must override conflicting third-party code.

## Why this should be more reliable than the installed Cursor extension

The installed `@rahularya01/pi-cursor` v1.4.33 is sophisticated, but it talks directly to Cursor's private HTTP/2 Connect/protobuf backend. Its own documentation calls the wire protocol reverse-engineered and includes schema regeneration, drift diagnostics, checkpoint recovery, and client-version pinning. Current open issue #29 reports a model family failing because of an unhandled `interaction_update:stepCompleted` wire case. This is exactly the maintenance class that an official ACP boundary should remove.

ACP does not eliminate all bugs. It replaces private wire-format churn with a public protocol plus a much smaller Cursor-specific extension surface. The provider will still need capability probes, strict process lifecycle management, and release qualification.

## Feasibility findings

### Confirmed locally

Against `cursor-agent 2026.09.02-c22c1a3`:

- ACP v1 initializes successfully over newline-delimited JSON-RPC 2.0 on stdio.
- `cursor_login` authentication succeeds with existing CLI credentials.
- Session creation advertises `agent`, `plan`, and `ask` modes.
- The agent advertises image prompts, session loading, HTTP/SSE MCP, and session listing.
- Cursor's private `cursor/list_available_models` extension returned 38 account models with per-model config controls.
- `_meta.parameterizedModelPicker: true` produces base model ids and model-dependent controls such as context, reasoning, thinking, effort, and fast mode.
- `session/set_config_option` successfully changed model, mode, and reasoning level.
- A live Ask-mode prompt streamed thought and answer chunks and ended with `stopReason: "end_turn"`.
- A completed session loaded in a fresh ACP process and replayed its user, thought, and assistant history before the load response.
- An empty session did not survive process restart (`Session ... not found`). Persist only sessions with completed work and always fall back to a fresh session.
- The prompt response contained no token/cache/cost usage metadata.

### Feasible with care

- Pi's custom `streamSimple` provider surface can represent Cursor's text, thinking, stop reasons, cancellation, models, and images.
- The official ACP TypeScript SDK supports generic `extMethod` and `extNotification` callbacks, so Cursor-specific methods can be handled without replacing the transport.
- The Antigravity provider's pending-permission mechanism can be generalized for Cursor's standard permission request plus `cursor/ask_question` and `cursor/create_plan`.
- Pi tool routing can probably reuse the Antigravity MCP bridge because Cursor advertises HTTP/SSE MCP. Historical reports say some Cursor builds ignored `session/new.mcpServers`, so this remains a qualification gate rather than an assumption.

## Non-negotiable correctness requirements

1. **Use the official nested extension response envelopes.** For example, plan approval is `{ outcome: { outcome: "accepted" } }`, not `{ accepted: true }` and not `{ outcome: "accepted" }`.
2. **Answer every blocking request.** Unanswered `session/request_permission`, `cursor/ask_question`, or `cursor/create_plan` calls can hang the turn.
3. **Drop load-time replay from Pi's visible stream.** Pi already owns the displayed transcript.
4. **Treat capabilities as runtime claims, not guarantees.** Probe actual behavior per supported Cursor release.
5. **Keep Cursor-native tools in the security model.** Disabling ACP client filesystem/terminal callbacks does not sandbox the Cursor process.
6. **Separate Cursor mode from permission mode.** `agent`/`plan`/`ask` controls agent behavior; `allowlist`/Auto-review/Run Everything controls approvals.
7. **Reapply model/config after load.** Current live behavior showed session configuration can reflect current CLI state; do not assume a loaded session retained the Pi-selected model.
8. **Never invent usage precision.** Report zero/unknown or clearly marked estimates until Cursor exposes authoritative usage fields.

## Suggested MVP boundary

Include:

- CLI detection and auth health
- Dynamic model discovery with cached fallback
- One provider entry per base Cursor model
- Reasoning mapping
- Agent/Plan/Ask mode command
- Default prompting, Auto-review, and Run Everything permission policies
- Text/thinking streaming
- Images
- cancellation and deterministic process shutdown
- persistent session id mapping with load fallback and replay suppression
- standard permission UI
- Cursor ask-question and plan-approval UI
- diagnostics and protocol logging with redaction

Defer unless qualification is clean:

- Pi tools over injected MCP
- full todo/subagent/image-notification UI
- session list/import UX
- usage/cache dashboard
- cross-process steering during an already active prompt

## Bottom line

The proposal is technically sound and likely to be less buggy than the current private-protocol extension. Reusing the mature Antigravity runtime is valuable, but this is not a search-and-replace port: Cursor's dynamic model configuration, native execution model, extension requests, CLI-managed auth, and load semantics require dedicated code and tests.
