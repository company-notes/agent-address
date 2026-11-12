# Agent Address V2 — Production operating guide

## What this service does

Agent Address issues, resolves, and authorizes stable Agent identities for Nuwa Agent Relay. Each identity belongs to an **Organization**, each Organization owns **Agents**, and each Agent owns one or more **Sessions**. A Session is a separately authorized execution identity with one active Runtime lease. The Relay service handles messages and Handoffs; this service never sends email itself.

**Organization Portal** is the authenticated, self-service web UI for managing Organization display name, Agent identities, Session names, Default Session, and private Resume capability rotation. **System Administration** is a separate, Cloudflare Access-protected interface for account operators.

## Live V2 destinations

- Official Agent Address: https://address.company-notes.com/
- Organization Portal: https://address.company-notes.com/portal/
- System Administration: https://address.company-notes.com/admin/
- Remote MCP: https://address.company-notes.com/mcp
- OAuth discovery: https://address.company-notes.com/.well-known/oauth-authorization-server
- Workers.dev origin: https://agent-address.nuwainfo.workers.dev

The homepage redirects to the Organization Portal. The Portal requires the user's own OAuth login; System Administration requires Cloudflare Access and an allowed administrator email. Organization Portal supports Organization display-name management and Agent/Session management; it is not a multi-member invitation/roles console.

## Cloudflare resources (Devops account)

| Binding | Name | Identifier | Meaning |
| --- | --- | --- | --- |
| Worker | `agent-address` | Production Worker script | OAuth, API, MCP and web UI |
| D1 `DB` | `company-notes-agent-address-v2` | `15cad3f5-3670-4f66-8951-2bb5d4881406` | V2 Account, Organization, Agent, Session and Runtime lease tables |
| KV `OAUTH_KV` | `AGENT_ADDRESS_V2_OAUTH` | `a0d03e78550740789fe48711faec489a` | V2 OAuth grants and client state |
| Durable Object `MCP_OBJECT` | `AddressMCP` | Bound by Wrangler migration `v1` | Private MCP connection-scoped Session and Resume state |
| Assets `ASSETS` | `web/dist` | Built by GitHub Actions | Organization Portal and Admin frontend |

The old V1 D1 (`company-notes-agent-address`, ID `2d811328-d89f-445b-87db-56690caed9df`) and OAuth KV (ID `0c1a8c89dc2a4e7ca81d4a5d3c7affa7`) are **not bound to V2**. They are retained for recovery/inspection; never apply the V2 migration to the V1 D1. The previous OAuth logins and credentials do not automatically migrate to V2.

The unused, empty Preview Worker, D1 and KV were retired after the official release succeeded. Do not use a Preview endpoint for ordinary testing of this production service.

## Release workflow

The production source is the reviewed `feat/agent-session-identity-v2-20261112` branch until a deliberate merge, with the deployment workflow `.github/workflows/production-v2.yml`.

1. The release is triggered by an explicit change to `deploy/production-release.txt` or to `production-v2.yml` on that branch, not by every feature commit. The legacy `main` branch still holds V1 code, but its `.github/workflows/deploy.yml` **deploy** job is disabled to prevent accidentally overwriting the live V2 Worker. Never re-enable it until `main` is deliberately migrated to a V2-only release workflow.
2. GitHub Actions runs backend typecheck, CODE_PRINCIPLES style check, Worker/D1 scenario tests, browser E2E against local OAuth and D1, and Admin UI build.
3. It checks the exact Cloudflare account, Worker name, D1 ID, KV ID, and custom domain. Wrong bindings fail closed.
4. It runs a production D1 schema guard, then applies V2 migration to `company-notes-agent-address-v2` only.
5. It deploys to the existing `agent-address` Worker with the existing official custom domain.
6. It runs an anonymous, read-only HTTP smoke against both the official custom domain and workers.dev: OAuth metadata, MCP discovery, anonymous denial, Organization Portal page/assets, protected Admin, and absence of V1 Account API.

GitHub Actions requires `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` Secrets and `ADMIN_ACCESS_TEAM_NAME`, `ADMIN_ALLOWED_EMAILS`, `ADMIN_ACCESS_AUDIENCE` Variables. Do not commit their values, print secrets, or infer them from the D1.

## User tests after release

1. Open the official Organization Portal and register/login with a V2 account. Because V2 uses an independent D1/KV, legacy V1 users must register again.
2. Register an Organization and modify its display name.
3. Create an Agent and Default Session; confirm the canonical `organization/agent/session` address.
4. Create a second Session, change the default, edit display names, and inspect non-secret lease status. Rotate the Resume Token only if explicitly requested.
5. Connect an OAuth-capable Agent Address MCP client; use `agentAddressEnsureIdentity` once, verify repeated calls preserve the same Session and do not show Runtime/Resume tokens. A new independent MCP connection should get a separate Agent.
6. Check authenticated and unauthenticated API behavior, expired Runtime refusal, explicit Resume, and no cross-Organization access.

The automated production smoke does **not** create user accounts or prove a full interactive OAuth login; local browser E2E covers the workflow under a real local Worker/D1. A human production acceptance check still matters before considering complete Nuwa Relay integration.

## Critical operational rules

- V2 intentionally removes Host/Work models, V1 identity API routes and backward aliases. Treat the cutover as breaking for old OAuth clients.
- An OAuth Account alone cannot impersonate an existing Session: only the exclusive Runtime capability or authorized private Resume can execute it.
- OAuth capability and Resume secrets must never be returned to the model or stored in a chat transcript. One address is not proof of ownership.
- Preserve MailTrigger unchanged: it is Relay's external SMTP/webhook transport, not part of Agent Address identity.
- If rollback is necessary, **code rollback alone will not revert D1/KV bindings or schema**. Explicitly select the old Worker code, old D1 and old OAuth KV together, and audit identity tokens before restoring service.
- Do not merge Relay API/MCP/Gateway drafts solely because Agent Address V2 is live: each requires isolated contract and end-to-end tests.

## Verified November 12, 2026 deployment

The official Worker was published by [production Actions run 43204806808](https://github.com/company-notes/agent-address/actions/runs/43204806808), version `ae60c6ad-aff4-4124-8664-50b9759fcc5f`. Both the official custom domain and workers.dev origin passed the read-only V2 smoke: OAuth authorization-server and MCP resource metadata 200; anonymous Account and Agent APIs 401; homepage redirect to the Organization Portal; Portal and assets 200; Cloudflare Access-protected Admin on the custom domain; old V1 Account route 404. Cloudflare API independently verified the official Worker binds the new production V2 D1 and OAuth KV. The V2 D1 was initially empty, so existing V1 users must register new V2 credentials. The real-world, user-driven OAuth sign-up and MCP continuity after reconnect/refresh remain to be tested and should not be overstated.
