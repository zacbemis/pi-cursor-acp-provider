# pi-cursor-acp-provider

Research and design workspace for a first-class [Pi](https://github.com/earendil-works/pi) provider backed by Cursor's official `cursor-agent acp` server.

No provider implementation has been started yet. The current deliverable is the research package under [`docs/`](docs/README.md).

## Current conclusion

The project is feasible and should reuse the provider/runtime structure from [`pi-antigravity-acp-provider`](https://github.com/zacbemis/pi-antigravity-acp-provider), while replacing Antigravity-specific setup, authentication, model mapping, and permission behavior with Cursor-specific implementations. Cursor's official ACP transport is a substantially better long-term boundary than the reverse-engineered Connect/protobuf transport used by the currently installed `@rahularya01/pi-cursor` extension.

The most important caveats are Cursor's blocking extension methods, load-time history replay, dynamic model config options, incomplete usage metadata, native-tool security boundary, and capability claims that must be qualified against each CLI release.

Start with the [documentation map](docs/README.md) and [executive summary](docs/EXECUTIVE-SUMMARY.md).
