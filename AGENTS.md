# Agent Address contributor guidelines

Read [README.md](README.md), [docs/identity-architecture.md](docs/identity-architecture.md), and [TESTING.md](TESTING.md) before changing the identity model.

Follow [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md), including OO, DRY, separation of concerns, fail-fast error handling and Rule 20 semantic vertical spacing.

Current identity is Organization → Agent → Session. Canonical addresses always have three segments. Runtime leases are separate capabilities. The HTTP API is the single adapter for domain services; MCP invokes the same controller and never duplicates core rules. Do not reintroduce V1, Host/Work or old compatibility aliases.

For bugs, test the real user scenario red before fixing it, then green. Prefer the actual OAuth Worker, D1, MCP client and Chrome browser to internal API mocks. Maintain true cross-Organization isolation and one active Runtime per Session.

The clean schema targets a **new D1 database**. Never deploy to production, merge the Draft PR, delete the old database, or apply the new baseline to the legacy database without explicit approval.
