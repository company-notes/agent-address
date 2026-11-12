# Testing Agent Address

This is the project-specific application of Nuwa's testing guide. Follow [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md) in **test code as well as production code**: OO, DRY, separation of concerns, no empty catch handlers and Rule 20 semantic spacing.

## What a passing test must prove

A test describes a **real user or Agent scenario** and observes the externally visible result **and persisted D1 state when important**. Test the complete sequence: OAuth sign in → Organization → Agent/Session registration → address resolution → Runtime ownership → release/Resume → revocation.

Use the narrowest useful test level, without redundant method-by-method tests:

- **Integration:** Vitest with `@cloudflare/vitest-plugin` runs the actual Worker, OAuth route, MCP transport and isolated real D1. See `test/CoreFlow.test.ts`, `test/IdentityController.test.ts`, `test/IdentityManagement.test.ts`, `test/MCP.test.ts` and `test/AdminService.test.ts`.
- **Organization Portal acceptance:** `web/e2e/portal-browser.mjs` drives real Chromium against a real local Wrangler Worker, OAuth sign-up and local D1. **Never mock the Account API in this flow.**
- **Admin browser acceptance:** `web/e2e/admin-browser.mjs` drives Chromium and uses an isolated mocked Admin API because production Cloudflare Access identities are not available in CI. Its real Admin service, D1 and authorization fail-closed rules are tested separately. This browser test alone does not prove a real Access OTP sign-in.
- **Deployment safety:** verify an empty/current D1 passes `scripts/check-d1-cutover.mjs`, and a legacy `addresses` table is rejected before migration.

MCP tests must use a real `@modelcontextprotocol/sdk` client; tool schema snapshots alone are insufficient. Core integration tests must not mock D1 or the Worker's own business API. External email, third-party relays, or Cloudflare Access may be substituted only where an isolated configured test account does not exist. Never point tests at production D1.

## Essential behavior scenarios

1. Two independent Codex starts result in different Agent IDs; Resume restores the original Agent and Session.
2. Ten assistants in a single Bot application register ten independent Agents, each with a Default Session.
3. A long-lived Agent can have several Sessions; an Agent-only address resolves to the currently selected Default Session.
4. Only an authorized Organization can rename, rotate, revoke, resolve or Resume its identity.
5. A second Runtime cannot take over an unexpired Session lease. Heartbeat extends the current owner's lease; release enables authorized Resume.
6. Portal registration must not acquire a Runtime lease. Archiving an Agent or Session revokes it and prevents stale credentials from working.
7. Address Handle rename preserves immutable IDs but removes the old canonical name; no compatibility alias.
8. OAuth account password reset invalidates old grants; Admin mutations are restricted to the verified Access identity.
9. A real Chromium user can sign up, register an Organization, register/edit/archive Agent and Sessions, change Default Session and rotate a Resume Token.
10. Legacy Host/Work schema must fail the D1 cutover guard without changing stored data.

## Commands

```bash
npm ci
npm run check
npm run style:check
npm test
npm --prefix web ci
npm --prefix web run build
```

CI additionally installs pinned Playwright and runs both browser scripts. The Portal script builds an isolated local Wrangler configuration and applies only local D1 migrations.

## Red → green for regressions

For every bug found:

1. Add the smallest scenario asserting the **correct** outcome, then run it and confirm a meaningful assertion failure (**red**, not a missing import or malformed fixture).
2. Repair the core cause without changing the expected outcome.
3. Run the same test and verify it passes (**green**).
4. Re-run its neighboring integration tests and both browser acceptance flows.
5. Keep the regression test, and report both outcomes. Do not count a mock-only pass as evidence that real D1, OAuth or Browser behavior works.

When refactoring without behavior changes, run affected tests and then the full suite. After all logic is green, make the Rule 20 spacing pass separately and rerun validation.

### Safety

Never run destructive migrations or browser tests against production. A passing Wrangler dry-run proves packaging, not Access OTP login or isolated remote D1 connectivity. Report these missing validations explicitly until real staging tests verify them.
