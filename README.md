# pi-cursor-acp-provider

First-class [Pi](https://github.com/earendil-works/pi) model provider backed by Cursor's official `cursor-agent acp` server.

Cursor models appear in Pi's model picker and support dynamic model discovery, reasoning controls, streaming thought/text, images, persistent sessions, Cursor permissions/questions/plans, and Pi tools over an authenticated loopback MCP bridge.

## Requirements

- Node.js 20+
- Pi
- Cursor Agent CLI with `cursor-agent acp`
- A Cursor account or API key

```bash
cursor-agent --version
cursor-agent login
```

Qualified locally against Cursor Agent `2026.09.02-c22c1a3` and ACP v1.

## Install

Until an npm release is published:

```bash
pi install git:github.com/zacbemis/pi-cursor-acp-provider
```

For development:

```bash
git clone https://github.com/zacbemis/pi-cursor-acp-provider
cd pi-cursor-acp-provider
npm install
pi --no-extensions -e ./extensions/index.ts
```

Pi can use an existing Cursor CLI login, `CURSOR_API_KEY`, `CURSOR_AUTH_TOKEN`, or a Cursor API key stored through `/login`.

## Use

```bash
pi --model cursor-acp/default
pi --model cursor-acp/gpt-5.4 --thinking high
pi --list-models cursor-acp
```

The extension discovers the account's current base model catalog during online startup. `PI_OFFLINE=1` skips discovery and retains the conservative `default` model.

## Commands

```text
/cursor-acp doctor
/cursor-acp doctor-verbose
/cursor-acp mode agent|plan|ask
/cursor-acp permissions prompt|auto-review|full-access
/cursor-acp pi-tools on|off
/cursor-acp sessions clear
```

Defaults:

- mode: `agent`
- permission policy: `prompt`
- Pi MCP tools: enabled

Permission policies map to Cursor startup as follows:

| Policy | Cursor command |
|---|---|
| `prompt` | `cursor-agent acp` |
| `auto-review` | `cursor-agent --auto-review acp` |
| `full-access` | `cursor-agent --force acp` |

`full-access` is dangerous and must be explicitly selected.

## Integration behavior

- Uses newline-delimited JSON-RPC through the official ACP SDK.
- Advertises no ACP client filesystem or terminal callbacks.
- Uses base model ids and Cursor's dynamic session config options.
- Maps Pi thinking levels to each model's available reasoning/effort values.
- Reapplies model and mode after session creation/loading.
- Persists completed Cursor session ids for persistent Pi sessions.
- Suppresses history replay emitted by Cursor during `session/load`.
- Detects Pi transcript divergence and starts a clean Cursor session.
- Maps blocking permission, `cursor/ask_question`, and `cursor/create_plan` requests into synthetic Pi interactions with documented nested response envelopes.
- Exposes enabled Pi tools to Cursor as `pi_<tool>` over a bearer-authenticated loopback MCP server; Pi remains the executor.
- Cancels active prompts and force-terminates unresponsive process trees after a bounded grace period.

## Security boundary

Cursor's native shell, edit, search, web, rules, plugins, and configured MCP tools execute inside the Cursor Agent process. They do **not** pass through Pi's tool hooks. Disabling ACP filesystem/terminal callbacks does not sandbox Cursor.

Use Cursor's Plan/Ask modes, permission configuration, sandbox, deny rules, and workspace isolation as appropriate. The provider never enables `--force`, `--trust`, or `--approve-mcps` by default.

Pi-provided MCP tools are namespaced and brokered back into real Pi tool calls. Disable them with:

```text
/cursor-acp pi-tools off
```

## Current limitations

- Cursor ACP did not provide authoritative token, cache, or cost usage in qualification; the provider reports zero rather than inventing precision.
- Todo/subagent/generated-image extension notifications currently render as bounded status/thinking text rather than rich widgets.
- ACP upstream is developing v2, while the qualified Cursor build negotiates v1.
- Dynamic model discovery adds one short-lived Cursor process during online Pi startup.
- Session import/list UI and arbitrary fast/context controls are not exposed yet; current Cursor/model defaults are retained.

## Development

```bash
npm run check
npm run pack:check
```

Live smoke tests performed during implementation verified:

- discovery of 38 account models;
- Pi provider invocation with `cursor-acp/default`;
- dynamic selection of `cursor-acp/gpt-5.4` with low reasoning;
- Pi MCP canary discovery, invocation, tool-result continuation, and cleanup in an isolated temporary workspace.

Detailed research, architecture, risks, and source references are under [`docs/`](docs/README.md).
