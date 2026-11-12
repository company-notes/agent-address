# New Agent Address database cutover

This is an operational safety procedure, **not authorization to deploy or delete production data**.

## Why a new database is required

Agent Address now stores **Organization → Agent → Session**. The former proof-of-concept stored Host/Work rows, enrollment tokens and credentials in different tables. The new `migrations/0001_identity.sql` is an initial schema for a **new, isolated D1 database**; it does not transform existing Host/Work records, and no old API compatibility path exists in the code.

**Never point this migration at the old D1 database.** Its migration history and schema do not match. Git history retains the previous implementation; it is not needed in the current code.

## Verify before the production switch

1. Review this plan with the owner of the existing data. Decide whether to export historical records, discard the proof-of-concept dataset with explicit approval, or convert selected records offline. Do not silently reinterpret an old address as a new Agent.
2. Create **separate staging** Worker, D1 and OAuth KV resources with new identifiers. Do not reuse production D1 or OAuth KV for tests. Keep staging hostname and Cloudflare Access Admin policy isolated.
3. Set staging deployment identifiers and secrets through protected CI settings; never commit Cloudflare credentials or IDs. Build the SPA and Worker and apply the clean migration **only to staging D1**.
4. Run the full Worker/OAuth/D1 test suite and real Chromium Portal flow against the isolated environment. Also test the Cloudflare Access OTP login on staging to confirm both `/admin/*` and `/admin/api/*` protection. Check unauthenticated `/v2/account/*` and `/mcp` access is denied.
5. Test a real Agent lifecycle across two independent clients: claim; refuse concurrent Resume; release; Resume by full address and private capability; heartbeat; rename; rotate capability; archive; confirm old credentials cannot be reused. Ensure no relay client still targets the old Host/Work model.
6. Keep the original production D1 and the OAuth KV backup/snapshot. Obtain explicit approval for the new schema, any data conversion and routing/domain cutover.
7. Switch production Worker configuration to the **verified new D1 and intended OAuth KV**, then run the migration and deploy. The workflow invokes the read-only schema guard before any remote migration.
8. Complete protected real-browser Admin verification and external relay/MCP client interoperability. Retain the old database read-only until the agreed retention period ends; deletion requires its own approval.

## Automated D1 guard

Before applying migrations, `scripts/check-d1-cutover.mjs --remote` issues a **read-only D1 schema query** through Wrangler. It accepts an empty database or a database whose product tables are exactly the current identity schema. It rejects any legacy, partial or mixed schema, including `addresses` and `enrollments`.

```bash
# These are examples, not commands to run against the old database.
node scripts/prepare-deploy.mjs
node scripts/check-d1-cutover.mjs --local

# Only after verifying your configured isolated remote D1 ID and receiving approval:
node scripts/check-d1-cutover.mjs --remote
npx wrangler d1 migrations apply DB --remote --config .wrangler.deploy.jsonc
```

The guard does not delete records or verify data conversion. If it rejects a database, **stop** and select a new D1 rather than weakening the guard.

## Scope boundaries

Agent Address registers and resolves identities; it is not the messaging relay. Sender–recipient conversation binding and actual message/file delivery belong to the Relay integration and must be tested using the new three-part address in the backend which consumes it.

The Organization Portal is protected by the account's OAuth grant, not Cloudflare Access. The **internal Admin Console** requires a separate Cloudflare Access policy and verified JWT. Never copy Admin privileges to the Portal.
