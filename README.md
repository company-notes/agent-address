# Agent Address

Agent Address 是一個刻意很薄的 hierarchical identity registry。

它只回答：

> **這個 org 裡有哪些 address？這個 address 是誰？誰有權代表它？**

它不處理 message、task、artifact、workflow、presence 或 release orchestration。

預計使用的正式網域：`https://address.company-notes.com`（尚需另外設定 Cloudflare DNS 與 Worker custom domain）。

---

## Identity model

Agent Address 分成穩定的 host/environment namespace 與具體 work identity 兩層，讓同一台機器上的多個 Claude/Codex 可以同時被精確指定：

```text
Organization: example-org
│
├── @mypc                         stable host/environment namespace
│   ├── @mypc/build-release      Codex doing release work
│   ├── @mypc/debug-payment      Claude debugging payment
│   └── @mypc/investigate-devpi  another agent/workstream
│
├── @vps1
│   └── @vps1/test-linux-build
│
└── @mac
    └── @mac/sign-release
```

Canonical address 包含 org：

```text
example-org/mypc/build-release
```

同一 org 內人類/agent 常用 shorthand：

```text
@mypc/build-release
```

### Root address

`@mypc` 是穩定的 host/environment namespace，不代表某一個正在工作的 agent，也不應被當成具體 work target。它在機器上保存一個低權限 `addr_...` credential，主要用途是建立自己的 child work addresses。

### Work address

每個 Claude/Codex MCP runtime 可以為自己的當前工作 claim 一個 child address：

```text
@mypc/build-release
```

work credential 只存在該 MCP process 記憶體，不寫入 host identity file。因此同一台機器可以同時跑很多互不混淆的 agent workstreams。

已 release/revoke 的 work address 不再佔用名稱，因此之後的新 workstream 可以重新使用相同名稱。

Agent 可以：

- 使用使用者指定的 work name；
- 若使用者沒指定，根據當前工作自己產生簡短 kebab-case 名稱；
- rename 當前 work address；
- 工作結束時 release address。

---

## Architecture

```text
Claude / Codex process A
  MCP runtime
  @mypc/build-release
          │
          │ HTTPS
          ▼
address.company-notes.com
          │
          ▼
Cloudflare Worker
          │
          ▼
          D1

Claude / Codex process B
  MCP runtime
  @mypc/debug-payment
```

每台機器不需要自己的 DB。host credential（例如 `@mypc`）與 work credential 由呼叫端自行保存；Worker 只認 bearer token，不假設它存在哪個檔案。

---

## Cloud API quick start

### 1. Create organization

Runtime API JSON 使用 camelCase：

```bash
curl -X POST https://address.company-notes.com/v1/orgs \
  -H 'X-Registration-Key: ...' \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "example-org",
    "displayName": "Example Organization"
  }'
```

Response 會回傳一次性的 `orgToken`。

### 2. Create stable host address

```bash
curl -X POST https://address.company-notes.com/v1/orgs/example-org/addresses \
  -H 'Authorization: Bearer org_...' \
  -H 'Content-Type: application/json' \
  -d '{
    "handle": "mypc",
    "displayName": "Main development PC"
  }'
```

這會建立：

```text
@mypc
canonical: example-org/mypc
```

並回傳一次性的 host `addressToken`。

### 3. Create work address under host

Host credential 可以建立 child：

```bash
curl -X POST https://address.company-notes.com/v1/addresses/HOST_ADDRESS_ID/children \
  -H 'Authorization: Bearer addr_HOST...' \
  -H 'Content-Type: application/json' \
  -d '{
    "handle": "build-release",
    "displayName": "Build Release 0.18.3"
  }'
```

得到：

```text
@mypc/build-release
canonical: example-org/mypc/build-release
```

### 4. Resolve exact address

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

---

## D1 schema upgrade

已部署 `0001_init.sql` 的環境要再套：

```text
migrations/0002_hierarchical_addresses.sql
```

它會：

- 加入 `parent_address_id`
- 加入 hierarchical `path`
- 把既有 root address 的 `path` 設成原本 `handle`
- 將唯一性從 `(org_id, handle)` 改成 `(org_id, path)`

所以不同 host 可以同時有同名 work address：

```text
@mypc/build
@vps1/build
```

---

## Remote MCP (`/mcp`)

Worker 同時提供需要 OAuth 的 Streamable HTTP MCP endpoint：

```text
https://address.company-notes.com/mcp
```

典型流程：

1. MCP client 連上 `/mcp`，被導向 `/authorize`：用 email/password 登入或建立帳號（建立帳號需要 registration key；也可貼上既有 org token 來綁定既有 organization）。
2. 一個 account 對應一個 organization。對 agent 說「my org is example-org, please call this session build-release」會註冊 organization（若 account 還沒有）、建立 machine（例如 `@mypc`）並 claim session address：`example-org/@mypc/build-release`。已有 organization 的 account 不需要再提 org。
3. 「give this session a name」不指定名稱時會自動配發 `session-xxxxxx`。
4. `agentAddressInstallLocal` 會建立一次性 enrollment code（15 分鐘、只能用一次）；當本機需要自己的 host credential 時（例如未來的 local companion），呼叫 `POST /v1/enrollments/redeem` 換成 `addr_HOST...` token。

Tools：`agentAddressGetStatus`、`agentAddressClaimWork`、`agentAddressRenameWork`、`agentAddressReleaseWork`、`agentAddressResolve`、`agentAddressInstallLocal`。

實作：OAuth 由 `@cloudflare/workers-oauth-provider` 處理（KV binding `OAUTH_KV`），每個 MCP session 是一個 Durable Object（`AddressMCP`），session 的名稱記在 DO storage。登入頁沒有 rate limit，密碼以 PBKDF2-SHA256 存放在 D1 `accounts`。每個 tool 只是薄包裝，實際呼叫的是下面的 Account API——MCP 不是另一套實作。

---

## Account API（`/v1/account/*`，不需要 MCP）

給其他產品（例如其他 Agent 服務，）直接用 HTTP 呼叫 Agent Address，不必連上我們的 MCP server。認證方式與 `/mcp` 相同：OAuth access token 當 `Authorization: Bearer`。

```text
GET    /v1/account/status[?work_address_id=...]
POST   /v1/account/work                 {organization?, organizationDisplayName?, host?, handle?, displayName?}
PATCH  /v1/account/work/{addressId}     {handle}
DELETE /v1/account/work/{addressId}
GET    /v1/account/resolve?address=@mypc/build-release
POST   /v1/account/local-install        {host}
```

行為與 `/mcp` 的 tools 完全一致（同一個 `AccountController`）：一個 account 對應一個 organization；`work` 需要指定 `host` 除非帳號只有一台機器；`local-install` 回傳的 `enrollmentCode` 用 `POST /v1/enrollments/redeem` 換成 host credential。完整 schema 見 `docs/openapi.yaml`。

---

## Cloudflare configuration

`wrangler.jsonc` contains **placeholder** KV and D1 resource IDs; no live credentials are in source control. Before deployment:

1. Create or select an OAuth KV namespace and a D1 database in the destination Cloudflare account.
2. Replace the all-zero `OAUTH_KV.id` and `DB.database_id` placeholders with the real IDs.
3. Store `REGISTRATION_KEY` using `npx wrangler secret put REGISTRATION_KEY`; never commit it.
4. Apply D1 migrations and deploy the Worker. Configure `address.company-notes.com` as a custom domain after verifying ownership/routing.
5. For local development, use `.dev.vars` for secrets (ignored by Git).

The previous `releasebot-agent-address` deployment is **not** automatically migrated by this repository; existing Cloudflare resources and data must be migrated or intentionally reused before cutover.

## Development

Worker type check：

```bash
npm install
npm run check
npm test        # vitest in the Workers runtime (REST, OAuth, remote MCP)
```

D1 local migrations：

```bash
npm run db:migrate:local
```

Deploy：

```bash
npm run db:migrate:remote
npm run deploy
```

第一次部署會套用 `wrangler.jsonc` 的 `migrations`（建立 `AddressMCP` Durable Object，SQLite-backed）。

---

## Security model

```text
org_...
  └─ manages root addresses in an organization

addr_HOST...
  └─ proves ownership of @mypc
     └─ may create child work addresses

addr_WORK...
  └─ proves ownership of @mypc/build-release
     ├─ may rename itself
     └─ may revoke itself
```

Org token 不應放入 LLM context。任何直接呼叫 REST API 的 host-setup 流程只應持久化 host `addr_...` token，不持久化 org token。

---

## Design boundary

Agent Address 刻意只做 identity/resolution。

未來即使改用 A2A、DID 或其他 agent identity standard，也應只替換這層，不讓 上層 Agent 協作邏輯 綁死在目前 registry 實作。
