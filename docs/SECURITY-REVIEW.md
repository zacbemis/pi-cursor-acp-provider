# Final security review

Review date: **2026-09-11**  
Target release: **0.1.0**

## Scope

Reviewed the package manifest, ACP process/transport, authentication, session/model caches, Cursor extension methods, Pi interaction broker, MCP bridge, context translation, lifecycle handling, package contents, dependencies, tests, and public documentation.

## Automated checks

- TypeScript typecheck: passed
- Unit/mock integration suite: 25 tests passed across 11 files
- Production dependency audit: 0 known vulnerabilities
- npm registry signatures: 397 dependencies verified
- npm attestations: 113 dependencies verified
- Repository secret-pattern scan: no credentials/private keys found
- Packed-tarball installation and offline Pi registration: passed
- `npm pack`/publish contents: restricted by the `files` allowlist

The ACP SDK remains pinned to the exact v1-compatible version qualified by this project. A newer major SDK targets a moving ACP surface and should not be adopted without protocol regression and live Cursor qualification.

## Findings fixed before release

1. **Forged interaction outcomes** — tool-result details are now revalidated against the pending permission/question/plan. Unknown permission option ids and malformed question answers fail closed.
2. **Unbounded Cursor extension forms** — question count/options/text and plan size are bounded before entering Pi UI state.
3. **MCP request origin** — the loopback bridge now validates Host and Origin in addition to its random bearer token.
4. **MCP shutdown** — active HTTP connections are closed during bridge teardown.
5. **Local metadata parsing** — config, model-cache, session-cache, model-count, and config-option sizes are bounded.
6. **Credential diagnostics** — sensitive URL query values are redacted, and Cursor stderr is withheld from conversation error output.
7. **Model-output false positive** — Fable's action-required detector now matches Cursor's exact opaque message rather than arbitrary containing text.
8. **Repository hygiene** — unused fixtures, including fake credential-like test data, were removed.

## Security properties

- Safe default permission mode (`cursor-agent acp`), with no implicit `--force`, `--trust`, or `--approve-mcps`.
- ACP client filesystem and terminal callbacks are disabled.
- ACP input/output frames are bounded and malformed protocol output fails closed.
- Cursor process stderr is held in a bounded, redacted ring.
- Pi MCP listens on `127.0.0.1` only and uses an unguessable per-process bearer token.
- MCP tools are namespaced, count/schema/body bounded, and arguments are checked against original Pi TypeBox schemas.
- Synthetic interaction tools are excluded from MCP projection.
- Session/model metadata files use private directory/file modes and contain no Cursor credentials.
- Blocking requests and Pi tool calls are cancelled on timeout, abort, process exit, and provider shutdown.
- Session restoration suppresses replay and checks Pi transcript fingerprints before continuing hidden Cursor history.
- Stored or environment Cursor API keys are passed only through the child environment and are not written to provider caches.

## Accepted boundaries and residual risks

### Cursor has host-level agent access

The provider starts the user's trusted Cursor Agent CLI in the active workspace. Cursor-native filesystem, shell, web, plugin, rule, and configured MCP behavior is outside Pi's tool hooks. Cursor receives the child process environment, like a direct `cursor-agent` invocation. Users requiring isolation must use Cursor policies/sandbox and operating-system/container controls.

### Third-party executable and account service

The provider does not download or verify Cursor itself. It resolves `PI_CURSOR_ACP_COMMAND`, `cursor-agent`, or `agent` and trusts the user-installed executable. Cursor authentication, model execution, retention policies, and backend service behavior remain Cursor's responsibility.

### Loopback MCP token is visible to Cursor

Cursor must receive the MCP bearer token to call Pi tools; this is intentional. Other local/web callers must know the random token and pass Host/Origin validation. A compromised Cursor process already has the authority granted to Cursor and the enabled Pi tools.

### Local same-user attackers

Private cache modes reduce accidental disclosure but are not a boundary against another process already running as the same OS user. Pi extensions themselves execute with that user's full permissions.

### Unknown future protocol behavior

Cursor ACP and ACP upstream evolve quickly. Unknown extension requests receive method-not-found, malformed interactions fail closed, capabilities are checked, and supported Cursor versions require live qualification. These controls reduce but cannot eliminate semantic drift.

## Release conclusion

No known critical, high, moderate, or low dependency vulnerability remains. No credential was found in tracked or packed content. The package is suitable for an initial public **0.1.0** release with the security boundary prominently disclosed in the README and `SECURITY.md`.
