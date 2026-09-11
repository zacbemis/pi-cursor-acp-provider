# Changelog

## 0.1.0 — 2026-09-11

Initial public release.

- First-class `cursor-acp` Pi provider using Cursor's native ACP v1 server.
- Dynamic, version-keyed Cursor model discovery with a 24-hour startup cache.
- Per-model reasoning/effort mapping, images, text/thought streaming, and mode configuration.
- Prompt, Auto-review, and Full-access permission policies with a safe prompting default.
- Structured permission, question, and plan approval round trips.
- Persistent Cursor sessions with load-replay suppression and Pi branch-divergence protection.
- Authenticated loopback MCP bridge exposing namespaced Pi tools to Cursor.
- Cursor CLI login, API-key, auth-token, diagnostics, cancellation, and process-tree cleanup.
- Actionable handling for Cursor's Fable data-policy gate.
- Security hardening for bounded protocol/cache/form inputs, MCP Host/Origin validation, fail-closed interaction outcomes, credential redaction, and deterministic shutdown.
