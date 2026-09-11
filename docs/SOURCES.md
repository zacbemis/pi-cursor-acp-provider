# Sources

Research date: **2026-09-11**. Repository commits are recorded because several projects and Cursor's ACP surface are changing rapidly.

## Primary product/protocol documentation

### Cursor

- [Cursor CLI — ACP](https://cursor.com/docs/cli/acp)  
  Transport, launch command, authentication flow, capabilities, permission handling, and Cursor extension schemas.
- [Cursor CLI — Installation](https://cursor.com/docs/cli/installation)
- [Cursor CLI — Authentication](https://cursor.com/docs/cli/reference/authentication)
- [Cursor CLI — Parameters](https://cursor.com/docs/cli/reference/parameters)
- [Cursor CLI — Permissions](https://cursor.com/docs/cli/reference/permissions)
- [Cursor Agent — Run modes/security](https://cursor.com/docs/agent/security/run-modes)
- Local `cursor-agent --help`, `cursor-agent acp --help`, `cursor-agent status`, and live ACP probes against `2026.09.02-c22c1a3`.

### Agent Client Protocol

- [agentclientprotocol/agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol), commit `f1293d8e43d09a6745ff8fe717f9acd8299591b7`
- [ACP v1 protocol](https://agentclientprotocol.com/protocol/overview)
- [ACP TypeScript SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk)

The upstream spec now also contains v2 work where `session/resume` replaces v1 `session/load`. The locally tested Cursor build negotiated **protocol v1** and advertised `loadSession`; this design targets negotiated behavior rather than assuming upstream main and Cursor are synchronized.

### Pi

Installed Pi documentation reviewed completely for the relevant interfaces:

- `docs/custom-provider.md`
- `docs/extensions.md`
- `docs/models.md`
- `docs/packages.md`

Installed under:

```text
/home/zacb/.nvm/versions/node/v24.19.0/lib/node_modules/
  @earendil-works/pi-coding-agent/
```

Key conclusions from Pi docs:

- a complete custom provider defines `auth`, `models`, `streamSimple`, and optional `refreshModels`;
- provider APIs and model ids must match;
- package discovery can execute extension modules in a temporary runtime, so factories must not start persistent resources;
- extension tools/commands and provider registration can coexist in one package;
- model aliases/overrides are user-configurable, so provider defaults should remain conservative.

## Main implementation references

### Antigravity provider

- Repository: [zacbemis/pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider)
- Local source directory: `/home/zacb/projects/pi-gemini-acp-provider`
- Commit: `ff3c13c33ba8c378393382e958d32cb2e4bd6e78`
- License: MIT

Reviewed package/provider/runtime and the relevant source under:

- `src/acp/`
- `src/mcp/`
- `src/permissions/`
- `src/stream/`
- tests and `docs/`

This is the primary Pi architecture/reuse base.

### T3 Code

- Repository: [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- Commit: `05d404210058d714cfef902517fc20ad66b82339`
- License: MIT

Primary reviewed files:

- [`CursorAdapter.ts`](https://github.com/pingdotgg/t3code/blob/05d404210058d714cfef902517fc20ad66b82339/apps/server/src/provider/Layers/CursorAdapter.ts)
- [`CursorProvider.ts`](https://github.com/pingdotgg/t3code/blob/05d404210058d714cfef902517fc20ad66b82339/apps/server/src/provider/Layers/CursorProvider.ts)
- [`AcpSessionRuntime.ts`](https://github.com/pingdotgg/t3code/blob/05d404210058d714cfef902517fc20ad66b82339/apps/server/src/provider/acp/AcpSessionRuntime.ts)
- [`CursorAcpSupport.ts`](https://github.com/pingdotgg/t3code/blob/05d404210058d714cfef902517fc20ad66b82339/apps/server/src/provider/acp/CursorAcpSupport.ts)
- [`CursorAcpExtension.ts`](https://github.com/pingdotgg/t3code/blob/05d404210058d714cfef902517fc20ad66b82339/apps/server/src/provider/acp/CursorAcpExtension.ts)
- adapter/runtime tests and mock ACP agent

Relevant issues:

- [#9047 CursorAdapter lifecycle/concurrency review](https://github.com/pingdotgg/t3code/issues/9047)
- [#6533 repeated permissions / auto-review and force](https://github.com/pingdotgg/t3code/issues/6533)
- [#5781 notification consumer scope race](https://github.com/pingdotgg/t3code/issues/5781)
- [#3149 load replay duplication](https://github.com/pingdotgg/t3code/issues/3149)
- [#2426 assistant message-id collisions](https://github.com/pingdotgg/t3code/issues/2426)
- [#2237 stale authentication emitted as assistant content](https://github.com/pingdotgg/t3code/issues/2237)

## Pi/Cursor projects reviewed

### Rahularya01/pi-cursor

- Repository: [Rahularya01/pi-cursor](https://github.com/Rahularya01/pi-cursor)
- Commit: `324d2061cac068110b2ac9c783ef419b1fdf0501`
- Locally installed npm package: `@rahularya01/pi-cursor@1.4.33`
- [#29 Fable model fails on protobuf wire drift](https://github.com/Rahularya01/pi-cursor/issues/29)
- [#30 missing cache usage breakdown](https://github.com/Rahularya01/pi-cursor/issues/30)

### ndraiman/pi-cursor-provider

- Repository: [ndraiman/pi-cursor-provider](https://github.com/ndraiman/pi-cursor-provider)
- Commit: `82fc4e73f9ae820d87b34ac36713b18989910a36`
- Issues: [#1](https://github.com/ndraiman/pi-cursor-provider/issues/1), [#3](https://github.com/ndraiman/pi-cursor-provider/issues/3), [#4](https://github.com/ndraiman/pi-cursor-provider/issues/4), [#5](https://github.com/ndraiman/pi-cursor-provider/issues/5), [#6](https://github.com/ndraiman/pi-cursor-provider/issues/6), [#9](https://github.com/ndraiman/pi-cursor-provider/issues/9), [#10](https://github.com/ndraiman/pi-cursor-provider/issues/10)

### sathish316/pi-omniagent-extensions

- Repository: [sathish316/pi-omniagent-extensions](https://github.com/sathish316/pi-omniagent-extensions)
- Commit: `5d16d0435bcac6a7713fa001c9280611c1d6d91a`
- Reviewed: `cursor-acp.ts`, README, helper utilities, and tests

### 0xKobold/pi-cursor

- Repository: [0xKobold/pi-cursor](https://github.com/0xKobold/pi-cursor)
- Commit: `ee84320c41cbddb38a9fb41ea27a1703dbb7cbff`
- Reviewed: `extensions/cursor-acp.ts`, README, package metadata

### luongnv89/pi-extensions

- Repository: [luongnv89/pi-extensions](https://github.com/luongnv89/pi-extensions)
- Commit: `ca99973d1e9d3e030657adac9519fe2a80bf0699`
- Reviewed: `extensions/cursor-pi/`

## Adjacent Cursor/ACP projects

- [raphaelluethy/cursor-acp](https://github.com/raphaelluethy/cursor-acp), commit `95ddbf3188e55dbc620a56cf08725dac9bd39e8f`
- [oxiglade/cursor-acp](https://github.com/oxiglade/cursor-acp), commit `872017b49f5a6f9453cfc9e72a235a7e00405f90`

These projects expose Cursor *as* an ACP server through a wrapper, rather than consuming Cursor's built-in ACP server from Pi.

## Cross-project issue evidence

- [tiann/hapi#1044](https://github.com/tiann/hapi/issues/1044) — wrong Cursor extension outcome envelope caused an apparently approved plan to be interpreted as cancellation.
- [repoprompt/repoprompt-ce#158](https://github.com/repoprompt/repoprompt-ce/issues/158) — Cursor ACP advertised MCP capability but ignored `mcpServers` in a June 2026 build.

## Research artifacts

Local throwaway probe scripts were created under:

```text
/tmp/cursor-acp-research/
  live_probe.py
  live_model_probe.py
  live_prompt_probe.py
```

They are intentionally not copied into this project because they contain ad-hoc test mechanics rather than production-quality code. Results are summarized in [LIVE-QUALIFICATION.md](LIVE-QUALIFICATION.md), with identity/secrets omitted.
