# Risks and open questions

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cursor changes undocumented extension methods | high | medium/high | isolate schemas; method fallback; live matrix; versioned fixtures |
| ACP capability is advertised but not functional | medium | high | behavioral canaries for load/MCP/images, not capability-only checks |
| Blocking request is unanswered | medium | critical | total dispatcher; timeout; cancel-on-teardown; raw-envelope tests |
| Load replays duplicate history | high without gate | high | pre-load replay phase; drain barrier; completed-turn persistence only |
| Pi branch diverges from Cursor hidden history | medium | high | context fingerprint; rotate and bootstrap fresh session |
| Cursor native tools bypass Pi hooks | certain | high | clear security disclosure; Cursor policies/sandbox; read-only modes |
| `--force` grants more than user expects | medium | high | explicit opt-in; visible status; safe default prompting |
| Auto-review semantics differ by version/config | medium | high | per-version live test; residual permission handler; doctor warning |
| Missing token/cache usage causes misleading Pi UX | high | medium | represent unknown; no invented cost; investigate Pi warning suppression |
| Dynamic model options exceed Pi's model UX | high | medium | base models + reasoning; commands for context/fast; avoid combinations |
| Cursor session persistence is delayed/evicted | medium | medium | persist after completed turn; load fallback; bootstrap full Pi context |
| Model/config state is global or not restored | medium | medium | reapply all settings after new/load and verify returned snapshots |
| Process/session resources leak | medium | high | scoped registry; idempotent close; exit tests; bounded timers |
| Cancellation races with setup or pending UI | medium | high | register abort first; terminal-event invariant; settle all deferreds |
| MCP tools are ignored | medium | medium/high | live canary; feature flag; explicit diagnostics |
| MCP creates duplicate/ambiguous tools | medium | high | namespace Pi tools; never override Cursor-native names |
| Generated image/path notification is unsafe | medium | high | type/size/path validation; temporary storage; no arbitrary file read |
| Cursor CLI absent/outdated | high | low/medium | friendly doctor; supported install/update instructions; no auto-download |
| Credentials expire while Pi marker remains | medium | medium | authenticate every connection; marker never treated as proof |
| Multiple Pi providers conflict on provider id | low | medium | unique `cursor-acp` id; document migration from `cursor` provider |

## Open product decisions

### 1. Provider id and model ids

Recommended provider id is `cursor-acp`, not `cursor`. This permits coexistence/migration from existing Cursor packages and makes session provenance explicit.

Open: should displayed model ids be raw Cursor base ids (`gpt-5.4`) or prefixed internally? Pi already scopes by provider, so raw ids are simplest.

### 2. CLI login inside Pi

Possible options:

- Require `cursor-agent login` before Pi and offer only an auth check.
- Launch `cursor-agent login` from Pi's auth flow and store a marker.
- Add API-key entry into Pi's secret store.

Recommendation: support the first two; add stored API keys only on user demand. Browser/device-login behavior must be tested in headless SSH.

### 3. Fast/context controls

Options:

1. Use Cursor defaults only for MVP.
2. Add `/cursor-acp fast` and `/cursor-acp context` commands.
3. Generate model variants.
4. Add a Pi extension settings UI.

Recommendation: 1 for first vertical slice, then 2. Avoid variants unless users strongly prefer them.

### 4. Cursor mode UX

Recommendation: command plus visible status, persisted per Pi session. Do not map Pi thinking level to mode and do not map “approval required” to Ask mode.

Open: should new Pi sessions inherit a global last mode or always start in Agent? Safe behavior argues for remembered explicit setting or Ask/Plan; expected coding behavior argues for Agent.

### 5. Permission-policy names

Cursor uses evolving names: allowlist/default, Auto-review, unrestricted/force/Run Everything. The local binary labels `--force` as Run Everything.

Recommendation: UI labels:

- Prompt (safe default)
- Auto-review
- Run Everything (`--force`, dangerous)

Show the exact underlying flags in diagnostics.

### 6. Plan handling

Cursor's current docs require explicit plan approval. T3 currently auto-accepts.

Recommendation: surface a Pi plan-approval interaction. Headless default is cancellation/rejection. Optional auto-accept should be a separate dangerous policy, not coupled to Auto-review.

### 7. Pi tools through MCP

Open until live canary. Questions:

- Does current Cursor ACP actually connect to an injected HTTP/SSE MCP server?
- Does it request approval for that server or each tool?
- Does `--approve-mcps` suppress only server approval or tool permissions too?
- How are same-name native and MCP tools presented?
- Can server configuration be refreshed without a new ACP session?
- Do MCP calls emit enough tool-call updates to maintain a good Pi transcript?

Recommendation: architect for the bridge but keep it behind a qualification feature flag.

### 8. Native Cursor tools versus Pi tools

Cursor-native shell/edit/search operations happen inside the child and cannot naturally become Pi tool calls with Pi extension hooks. Attempting to fake them as Pi tools after execution would be misleading.

Recommendation: display them as Cursor activity/status and make the security distinction explicit. Reserve Pi tool calls for operations Pi actually brokers.

### 9. Context ownership

Cursor sessions have hidden history; Pi sessions can branch, compact, edit, and inject messages.

Open: what exact fingerprint inputs indicate safe continuation? Candidate inputs:

- ordered stable ids and content hashes of all messages before active prompt;
- cwd/workspace roots;
- system prompt/instruction hash;
- tool schema fingerprint;
- provider model/mode/config.

Recommendation: require transcript-prefix equality. Configuration changes can be reapplied; system/context/tool-set changes should rotate unless proven safe.

### 10. Bootstrap representation

A first turn may need to communicate prior Pi transcript. Options include:

- one labeled text prompt;
- multiple ACP content blocks;
- temporary resource/document references;
- fresh session with only summary.

Current Cursor ACP prompt schema only gives role implicitly as user content, so a labeled structured bootstrap is practical. Test prompt-injection boundaries and keep the active user message clearly delimited.

### 11. Usage

The current live ACP response omitted usage. Open possibilities:

- future standard ACP usage fields;
- a documented Cursor usage API;
- session/update metadata;
- local estimates only.

Recommendation: leave usage unknown/zero for MVP. Do not call Cursor's private usage endpoints merely to make the UI look complete, because that recreates the private-protocol maintenance problem.

### 12. Supported Cursor versions

Options:

- exact tested version only;
- minimum version plus best effort;
- rolling latest only.

Recommendation: define a minimum ACP-capable version, record tested builds, and warn—not hard fail—on newer builds unless a known incompatibility exists. Hard-fail older builds missing required protocol behavior.

### 13. License and attribution

Both Antigravity provider and T3 Code snapshots reviewed are MIT licensed. Preserve license notices for copied code. Prefer original implementation around public interfaces and explicit attribution in source comments for substantial adaptations.

## Questions for a pre-implementation spike

1. Does the current Pi provider event schema offer a clean “unknown usage” representation that avoids false cache-miss warnings?
2. Where should provider-specific session binding metadata be stored so Pi branch/session compaction events can invalidate it?
3. Can an auth provider safely launch and monitor `cursor-agent login` across TUI, RPC, and SSH workflows?
4. Does current Cursor ACP honor injected MCP HTTP/SSE servers and call a canary Pi tool?
5. What exact events are emitted for standard permission, Ask Question, Create Plan, todo, task, and generated image on the supported build?
6. Does `session/load` replay end before the RPC response on every tested version, or is an idle-gap heuristic required?
7. Is the selected model/config session-local, CLI-global, or partially persisted? Live behavior justifies always reapplying but deserves isolation.
8. How should Pi extension tools with changing schemas invalidate/restart a Cursor binding?
9. Can Cursor's native tool permission details be represented without exposing secrets in Pi session JSON?
10. What Windows process-tree and executable-resolution behavior is required?
