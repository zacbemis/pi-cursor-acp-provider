# Research documentation

Research was performed on **2026-09-11** and the initial provider implementation followed the same day. Documents distinguish observations from proposals because Cursor CLI and ACP are moving quickly. For current installation and feature status, see the project [README](../README.md).

## Status vocabulary

- **Observed** — verified in source, official documentation, a cited issue, or a local live probe.
- **Inferred** — a conclusion drawn from observed behavior that still needs a focused test.
- **Proposed** — recommended design at research time; check the implementation-status notes and root README for what has since landed.
- **Qualification gate** — behavior that must pass against the supported Cursor CLI build before release.

## Documents

| Document | Purpose |
|---|---|
| [EXECUTIVE-SUMMARY.md](EXECUTIVE-SUMMARY.md) | Feasibility, recommendation, scope, and decisive tradeoffs |
| [CURSOR-ACP-PROTOCOL.md](CURSOR-ACP-PROTOCOL.md) | Official Cursor ACP surface and required response schemas |
| [LIVE-QUALIFICATION.md](LIVE-QUALIFICATION.md) | Results from probing the locally installed Cursor CLI |
| [T3-CODE-TEARDOWN.md](T3-CODE-TEARDOWN.md) | How T3 Code integrates Cursor and what to adopt or avoid |
| [PI-INTEGRATIONS-COMPARISON.md](PI-INTEGRATIONS-COMPARISON.md) | Existing Pi/Cursor projects and adjacent adapters |
| [PROPOSED-ARCHITECTURE.md](PROPOSED-ARCHITECTURE.md) | First-class Pi provider design and Antigravity reuse map |
| [IMPLEMENTATION-AND-TEST-PLAN.md](IMPLEMENTATION-AND-TEST-PLAN.md) | Phases, acceptance criteria, compatibility matrix, and release gates |
| [RISKS-AND-OPEN-QUESTIONS.md](RISKS-AND-OPEN-QUESTIONS.md) | Risk register and unresolved decisions |
| [SECURITY-REVIEW.md](SECURITY-REVIEW.md) | Final 0.1.0 security audit, fixes, and accepted boundaries |
| [SOURCES.md](SOURCES.md) | Versioned source inventory and links |

## Recommended reading order

1. [Executive Summary](EXECUTIVE-SUMMARY.md)
2. [Live Qualification](LIVE-QUALIFICATION.md)
3. [T3 Code Teardown](T3-CODE-TEARDOWN.md)
4. [Pi Integrations Comparison](PI-INTEGRATIONS-COMPARISON.md)
5. [Proposed Architecture](PROPOSED-ARCHITECTURE.md)
6. [Implementation and Test Plan](IMPLEMENTATION-AND-TEST-PLAN.md)
7. [Risks and Open Questions](RISKS-AND-OPEN-QUESTIONS.md)
