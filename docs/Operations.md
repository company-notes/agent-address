# Agent Address — 維運與部署

## 系統目的

Agent Address 是 Nuwa Agent Relay 的**身分與地址服務**，回答三個問題：「哪個 Agent／Session 存在？屬於哪個 Organization？目前哪個 Runtime 被授權執行？」本服務不傳訊、不寄信、不執行 AI。Nuwa Relay 負責訊息與工作 Handoff；MailTrigger 是 Relay 使用的外部 SMTP、信箱與收件回執服務，不是 Agent Address 的資料庫或身分模型。

- **Organization**：帳號擁有、用來管理旗下 Agent 的身分範圍。
- **Agent**：獨立的 AI 代理身分，不等於模型、程式或機器。
- **Session**：Agent 旗下可單獨授權的工作／對話身分，例如 `nuwa/bear/main`。
- **Runtime Lease**：允許目前一個執行端使用該 Session 的限時獨占權；Resume 需要私密能力憑證。
- **OAuth**：使用者登入並授權 MCP／Portal 的標準流程，不是 Agent Runtime Lease 的替代品。
- **KV**：Cloudflare 的 key-value 儲存空間，保存 OAuth 授權相關狀態。
- **D1**：Cloudflare SQLite 關聯式資料庫，保存帳號與 Agent／Session 身分。
- **Durable Object**：保留特定 MCP 連線的私密 Session／Resume 狀態。
- **Worker**：承載上述 API、OAuth、MCP、Organization Portal 和 Admin 的 Cloudflare 執行服務。

## 唯一正式服務與資源

- 正式網站：<https://address.company-notes.com/>（首頁前往 Organization Portal）
- 組織管理：<https://address.company-notes.com/portal/>
- 管理員介面：<https://address.company-notes.com/admin/>（Cloudflare Access 保護）
- MCP：<https://address.company-notes.com/mcp>，登入後呼叫 `agentAddressEnsureIdentity` 自動建立或恢復身分
- Worker：`agent-address`，綁定 `MCP_OBJECT`、`DB`、`OAUTH_KV`、`ASSETS`
- D1 資源名稱：`company-notes-agent-address`（由舊 V1 同名資料庫清空後重新建立全新 schema）
- OAuth KV 資源名稱：`OAUTH_KV`
- D1 `DB` schema 是 Organization／Agent／Session。沒有 Host／Work 相容資料表。
- OAuth 註冊表單要求輸入密碼兩次，後端驗證一致；這是確認密碼，**不是** TOTP／通行金鑰的第二因素認證。

## 唯一部署來源：GitHub main

部署由 `.github/workflows/deploy.yml` 負責：
1. 每次推送 GitHub `main`，Actions 先跑 TypeScript、CODE_PRINCIPLES 風格、相依套件安全檢查、Worker/D1/OAuth 情境測試，並使用 Chromium 跑真正的 Portal／OAuth 註冊與 Agent 管理流程。
2. 正式部署從 GitHub Secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_ACCESS_TEAM_NAME`、`ADMIN_ALLOWED_EMAILS`、`ADMIN_ACCESS_AUDIENCE` 及 GitHub Variables `CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_OAUTH_KV_ID`、`CLOUDFLARE_D1_DATABASE_NAME`、`CLOUDFLARE_WORKER_NAME`、`CLOUDFLARE_CUSTOM_DOMAIN` 讀取設定。公開 Repository 前，將三個 `ADMIN_*` 值從原 Variables 原樣複製到同名 Repository Secrets；`ADMIN_ALLOWED_EMAILS` 維持原本逗號分隔的格式。驗證 Job 永遠使用 CI 假值；正式部署僅允許 `main`，缺少必要設定時停止，並在 Wrangler 執行前額外遮蔽每個管理員 Email。確認新 Workflow 進入 `main` 後，再移除舊的三個 Variables。
3. 因為從前的資源被乾淨取代，歷史 GitHub ID Variable 可能是**已刪除的舊 ID**。部署作業的 `scripts/resolve-cloudflare-ids.mjs` 一律從同一 Cloudflare 帳號以唯一原始名稱 `company-notes-agent-address`／`OAUTH_KV` 解析真實 ID，再以 `GITHUB_ENV` 更新本次 Job。此機制不會更改 Repository Variable 的儲存值，避免誤用舊 ID。
4. `scripts/prepare-deploy.mjs` 生成當次 Wrangler config；Deployment Guard 檢查正確 Cloudflare 帳號、Worker、路由、D1、KV 與 schema，拒絕混合 V1/Session 資料表；只對正確 D1 執行 migration。
5. Wrangler 更新既有 `agent-address` Worker，再從正式網址及 workers.dev 執行**只讀 Smoke**（OAuth/MCP Discovery、匿名權限、Portal、Admin 保護、靜態資產、V1 路由消失）。

不另使用 Preview Worker、專用 V2 發布 Workflow 或手動將 Cloudflare API 當成部署管線。GitHub Actions 的部署結果是下次維護與回溯的第一個檢查點。

## 還需要人工驗證

正式 HTTP Smoke 不會代替使用者登入。應在正式 Portal 註冊／登入，建立 Organization 和 Agent，確認 canonical 地址、Session 管理、回覆收據不屬於本服務，再以 GrokBot 或 OpenMausBot 進行 MCP OAuth，驗證同一 Client 重連地址不變及不同 Client 身分隔離。完整 Relay／MailTrigger／Gateway 跨平台通訊需等各自 PR 整合後測試。

## 不可破壞的規則與踩過的坑

- 不允許只憑 OAuth Account、地址字串或模型人設擅自接管別人的 Runtime；Session 必須使用自己的有效獨占 Lease／私密 Resume。
- Runtime Token、Resume Token 和 OAuth 機密不得出現在模型可見的 MCP 輸入／輸出、聊天或日誌。
- 不能對 Host／Work 舊 schema 原地執行新 migration；不能只看 CI 單獨通過就宣稱跨 Repo Gateway 已整合。
- `main` 的單一自動部署 Workflow 才是正式部署來源；改 Worker 的綁定前要確認「實際的資源 ID」而不是單憑 GitHub Variable 名稱。
- 更動正式 D1 schema 後，Cloudflare 的 Worker Code rollback 不會自動回滾資料庫。
- `releasebot-agent-address` 及其相關 D1／OAuth KV 是**另一個舊專案**，不得因清理 Agent Address 就順便刪。其候選清單：Worker `releasebot-agent-address`、D1 `releasebot-agent-address`、共享的舊 KV 現命名為 `RELEASEBOT_LEGACY_OAUTH`。維護者可在另一次獨立作業核對全部綁定與資料後刪除。

## 程式碼原則

遵守 `CODE_PRINCIPLES.md` 的 OO、DRY、Separation of Concern；`TESTING.md` 以使用情境而非單元測試替身為主。最後才做 Rule 20 純排版檢查，排版不可改動邏輯。日常修改直接 commit/push 到 `main` 將自動跑 CI 與部署，不必管理第二條發行分支。
