# Agent Address

Agent Address is a deliberately small, hierarchical identity registry for AI agents.

It answers three questions: **Which addresses exist within an organization? Who does each address represent? Who is authorized to act on its behalf?**

It does **not** implement messaging, tasks, artifacts, workflows, presence, or release orchestration. Those capabilities belong in other services, such as Nuwa Agent Relay.

Planned production URL: `https://address.company-notes.com` (requires a Cloudflare Custom Domain and a successful Worker deployment).

## Identity model

An address has two levels: a stable host/environment namespace and a concrete work identity. Multiple Claude Code or Codex sessions can therefore have separate, unambiguous identities on the same machine.

```text
Organization: example-org
├── @mypc                         stable host/environment namespace
│   ├── @mypc/build-release      Codex working on a release
│   ├── @mypc/debug-payment      Claude debugging payments
│   └── @mypc/investigate-devpi  another workstream
├── @vps1
│   └── @vps1/test-linux-build
└── @mac
    └── @mac/sign-release
```

The canonical address includes the organization: `example-org/mypc/build-release`. Within an organization, agents and users commonly use the shorthand `@mypc/build-release`.

### Root (host) address

`@mypc` identifies a long-lived host or environment. It is not a specific running agent or work target. The host holds a lower-privilege `addr_...` credential whose main purpose is to create child work addresses.

### Work address

Each Claude Code or Codex MCP runtime can claim a child address, such as `@mypc/build-release`, for its current task. Its work credential is kept in MCP process memory rather than in the host identity file. This allows multiple concurrent and isolated workstreams on one machine.

After a work address is released or revoked, its name can be reused. Agents can use a user-specified name, generate a short kebab-case name, rename their current work address, and release it at the end of the task.

## Architecture

```text
Claude / Codex session A          Claude / Codex session B
          |                                  |
          +-------------- HTTPS -------------+
                             |
                 address.company-notes.com
                             |
                     Cloudflare Worker
                             |
                            D1
```

Each machine does not need a local database. Callers are responsible for storing their host credentials; work credentials are managed by the caller's runtime. The Worker only validates bearer tokens and does not assume where they are stored.

## REST API quick start

JSON field names use camelCase. The examples below assume the intended production Custom Domain is deployed.

### 1. Create an organization

```bash
curl -X POST https://address.company-notes.com/v1/orgs \
  -H 'X-Registration-Key: YOUR_REGISTRATION_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"slug":"example-org","displayName":"Example Organization"}'
```

The response returns a one-time `orgToken`.

### 2. Create a stable host address

```bash
curl -X POST https://address.company-notes.com/v1/orgs/example-org/addresses \
  -H 'Authorization: Bearer org_...' \
  -H 'Content-Type: application/json' \
  -d '{"handle":"mypc","displayName":"Main development PC"}'
```

This creates `@mypc` (canonical: `example-org/mypc`) and returns a one-time host `addressToken`.

### 3. Create a child work address

```bash
curl -X POST https://address.company-notes.com/v1/addresses/HOST_ADDRESS_ID/children \
  -H 'Authorization: Bearer addr_HOST...' \
  -H 'Content-Type: application/json' \
  -d '{"handle":"build-release","displayName":"Build Release 0.18.3"}'
```

Result: `@mypc/build-release` (canonical: `example-org/mypc/build-release`).

### 4. Resolve an exact address

```bash
curl https://address.company-notes.com/v1/resolve/example-org/mypc/build-release
```

### 5. Rename a work address

```bash
curl -X PATCH https://address.company-notes.com/v1/addresses/WORK_ADDRESS_ID \
  -H 'Authorization: Bearer addr_WORK...' \
  -H 'Content-Type: application/json' \
  -d '{"handle":"release-0183"}'
```

### 6. Release a work address

```bash
curl -X DELETE https://address.company-notes.com/v1/addresses/WORK_ADDRESS_ID \
  -H 'Authorization: Bearer addr_WORK...'
```

## Remote MCP

The Worker exposes an OAuth-protected Streamable HTTP MCP endpoint:

```text
https://address.company-notes.com/mcp
```

Typical flow:

1. The MCP client connects to `/mcp` and is redirected to `/authorize`. Sign in with email/password or register an account (registration requires the registration key). An existing organization token can be supplied during organization association.
2. An account belongs to one organization. An agent can be asked to claim a named session, for example `example-org/@mypc/build-release`. If necessary, the server creates the organization and host before claiming the work address.
3. Unnamed sessions receive a generated name such as `session-xxxxxx`.
4. `agentAddressInstallLocal` issues a single-use enrollment code valid for 15 minutes. A local companion can redeem it through `POST /v1/enrollments/redeem` to obtain an `addr_HOST...` token.

MCP tools: `agentAddressGetStatus`, `agentAddressClaimWork`, `agentAddressRenameWork`, `agentAddressReleaseWork`, `agentAddressResolve`, and `agentAddressInstallLocal`.

Implementation: `@cloudflare/workers-oauth-provider` handles OAuth via `OAUTH_KV`. Each MCP session runs in an `AddressMCP` Durable Object with session data in DO storage. Account passwords are stored in D1 using PBKDF2-SHA256. **The current login page has no dedicated rate limiter; do not treat this deployment as hardened for untrusted public signups without adding abuse protection.** MCP tools delegate to the same Account API rather than implementing a separate identity model.

## Account API (without MCP)

Other services can call `/v1/account/*` directly using an OAuth access token in the `Authorization: Bearer` header:

```text
GET    /v1/account/status[?work_address_id=...]
POST   /v1/account/work                 {organization?, organizationDisplayName?, host?, handle?, displayName?}
PATCH  /v1/account/work/{addressId}     {handle}
DELETE /v1/account/work/{addressId}
GET    /v1/account/resolve?address=@mypc/build-release
POST   /v1/account/local-install        {host}
```

These endpoints share `AccountController` with MCP. Each account belongs to one organization. A `host` is required when the account has multiple hosts. The `local-install` response's `enrollmentCode` can be exchanged for a host credential at `POST /v1/enrollments/redeem`. The complete API schema is in [docs/openapi.yaml](docs/openapi.yaml).

## Development

Requires Node.js 22 or later.

```bash
npm ci
npm run check
npm test
npm run db:migrate:local
npm run dev
```

`npm test` runs Vitest using the Cloudflare Workers runtime (REST, OAuth, and remote MCP tests). For local secrets, copy `.dev.vars.example` to `.dev.vars`; never commit local secrets.

## Automated deployment (GitHub Actions)

The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs **type checks and tests on pull requests and pushes**. A push to `main` (or a manual `workflow_dispatch`) proceeds to D1 migrations and Worker deployment **only if the checks pass**. Deployment configuration is prepared at runtime so Cloudflare resource identifiers are not embedded in source control.

### One-time GitHub configuration

At **Settings → Secrets and variables → Actions**, add:

| Type | Name | Purpose |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | A scoped Cloudflare API token with Workers deploy, D1, KV and route permissions as needed |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| Variable | `CLOUDFLARE_D1_DATABASE_ID` | Existing D1 database UUID |
| Variable | `CLOUDFLARE_OAUTH_KV_ID` | Existing OAuth KV namespace ID |
| Variable (optional) | `CLOUDFLARE_D1_DATABASE_NAME` | D1 database name if different from `agent-address` |
| Variable (optional) | `CLOUDFLARE_WORKER_NAME` | Existing Worker name if different from `agent-address` |
| Variable (optional) | `CLOUDFLARE_CUSTOM_DOMAIN` | Custom Domain hostname, e.g. `address.company-notes.com` |

If `CLOUDFLARE_CUSTOM_DOMAIN` is unset, the workflow deploys the Worker without configuring a new custom domain. Once you own and manage the relevant zone in Cloudflare, set the variable to `address.company-notes.com` to manage that hostname through Wrangler. Ensure that no conflicting DNS CNAME record exists.

Create or reuse the D1 database and KV namespace **before** setting their IDs. If migrating an existing live installation, reuse its actual Worker/D1/KV resources or plan an explicit data migration. A new database will not contain old accounts, organizations, or sessions.

### One-time Cloudflare Worker secret

Set `REGISTRATION_KEY` on the target Worker using Cloudflare's dashboard or `npx wrangler secret put REGISTRATION_KEY --name YOUR_WORKER_NAME`. Keep it out of git and GitHub logs. Do this before enabling account registration.

### Deployment order

1. `npm ci` → `npm run check` → `npm test`.
2. Verify that required Cloudflare secrets and repository variables exist.
3. Generate an ignored `.wrangler.deploy.jsonc` with the actual D1/KV IDs, optional Worker name, and optional custom domain.
4. Apply pending remote D1 migrations using the configured D1 binding.
5. Deploy the Worker using that same generated Wrangler config.

**D1 migrations affect real remote data.** Review new migration SQL before merging into `main`. Wrangler performs backups during migration application, but you should still keep a recovery plan.

If the GitHub credentials or resource IDs have not been configured, the deployment step fails without attempting a partial deployment. This repository does not itself create Cloudflare resources or upload production secrets.

## Local and manual deployment

The tracked `wrangler.jsonc` intentionally contains placeholder D1 and KV IDs. To deploy manually, create your own environment-specific configuration or set the documented environment variables and run:

```bash
node scripts/prepare-deploy.mjs
npx wrangler d1 migrations apply DB --remote --config .wrangler.deploy.jsonc
npx wrangler deploy --config .wrangler.deploy.jsonc
```

Ensure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are available to Wrangler. The Worker config also defines a SQLite-backed `AddressMCP` Durable Object.

## Security and identity boundaries

```text
org_...
  └── administers an organization's root addresses
addr_HOST...
  └── identifies a host and can create its child work addresses
addr_WORK...
  └── identifies an individual work address; can rename/revoke itself
```

Never put organization tokens into LLM context. Direct REST-based host initialization should persist only the host `addr_...` token, not the organization token. Keep production registration credentials out of source control. Authorization, abuse protection, and account recovery should be reviewed before opening registration to untrusted users.

Agent Address intentionally implements **identity and resolution only**. If the future identity layer uses A2A, DID, or another standard, replace the identity boundary without coupling higher-level messaging or workflow logic to this registry.
