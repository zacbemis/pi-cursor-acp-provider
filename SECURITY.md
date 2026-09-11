# Security policy

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability. Use GitHub's **Security → Report a vulnerability** flow for this repository:

https://github.com/zacbemis/pi-cursor-acp-provider/security/advisories/new

Include the affected version, platform, Cursor CLI version, reproduction steps, impact, and any suggested mitigation. Do not include real credentials, private prompts, or repository contents.

## Supported versions

Security fixes are provided for the latest published version. This project is pre-1.0 and its compatibility surface may change between minor releases.

## Security boundary

Pi packages execute with the permissions of the Pi process. This provider also starts the locally installed Cursor Agent CLI in the active workspace. Cursor-native shell, filesystem, web, rules, plugins, and configured MCP operations are governed by Cursor—not Pi—and do not pass through Pi's tool hooks.

The provider:

- defaults to full-access/YOLO (`--force`) starting in 0.1.1, allowing commands and edits without confirmation subject to Cursor deny rules; explicitly saved policies are preserved, and `/cursor-acp permissions prompt` restores prompting;
- does not enable `--trust` or `--approve-mcps`;
- advertises no ACP client filesystem or terminal callbacks;
- frames ACP over bounded newline-delimited JSON-RPC;
- binds its Pi-tool MCP bridge only to loopback;
- authenticates MCP requests with a random per-process bearer token and validates Host/Origin;
- validates Pi tool arguments against their original schemas;
- stores model/session metadata, not Cursor credentials, in private local files;
- treats Cursor CLI login and environment credentials as externally managed;
- bounds stderr, model cache, session cache, extension forms, MCP bodies, schemas, and tool counts;
- cancels pending permissions/questions/plans and tool calls during shutdown;
- suppresses stderr from conversation output and redacts recognized credential forms in diagnostics.

Users remain responsible for Cursor permission configuration, deny rules, sandboxing, workspace trust, environment exposure, plugins, and operating-system/container isolation.
