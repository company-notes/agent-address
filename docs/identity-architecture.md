# Agent Address：Agent／Session 身分與定址架構

> **文件定位：領域架構與實作規則。** 本文定義資料模型、API（程式對外提供的操作介面）、MCP（Model Context Protocol，讓 AI 應用呼叫工具的協定）及組織管理介面的共同語意。現有實作介面與操作方式請見 [README](../README.md) 及 [OpenAPI](openapi.yaml)。

## 1. Agent Address 要解決什麼問題？

Agent Address 是 AI Agent 的**身分登記與地址解析服務**：讓同一個組織內不同的 Agent 和對話工作階段，取得可辨識、可查詢、可再次使用的地址；也讓呼叫者知道自己是否有權使用某個身分。

例如，一個人正在 Windows 的 Codex 中做 FFL 開發，想把進度與檔案交給 Mac 上另一個 Codex。只要雙方有明確地址，就可以用地址指明收件對象，而不用依賴「Windows 那台」「Mac 那台」這類容易變動的描述。

這個需求不只適用於跨機器的 Codex。某個 Bot 程式也可能同時承載十個不同的 Agent，每個 Agent 都需要獨立地址；另一些 Agent 則會長期存在、開啟多個 Session。

**Agent Address 管理的是身分、名稱、歸屬、解析與授權，不負責真正傳送訊息、交換檔案、執行任務或保存對話全文。** 例如 Nuwa Agent Relay 是可能使用這些地址的訊息傳輸服務；它不是 Agent Address 的一部分。下文提到「發送訊息」，是為了說明地址如何被其他服務使用。

## 2. 核心模型：永遠是三層地址

```text
Organization（組織）
└── Agent（獨立 Agent 身分）
    ├── Session（預設對話／工作階段）
    ├── Session（另一段對話）
    └── Session（其他對話）
```

完整、正式的地址（Canonical Address）固定是：

```text
organization/agent/session
nuwa/codex-win-a7k2/ffl-dev
nuwa/xiaoming/main
nuwa/researcher/quantum-research
```

**三層是地址結構，不是要求使用者每次都手動輸入三個名稱。** 使用者可以只宣告 Agent、只宣告 Session，或完全不命名；系統補齊其餘部分，最後仍回傳完整三層地址。

### 名詞先說清楚

| 名詞 | 意義 | 不代表什麼 |
| --- | --- | --- |
| **Organization（組織）** | 身分與權限的所屬範圍，例如 `nuwa`；帳號登入後才能確認自己能管理哪個組織 | 不是某台電腦 |
| **Account（使用者帳號）** | 以 Email 等登入方式驗證的人類使用者身分，透過授權關係管理組織 | 不等於 Agent，也不是共用的「組織帳密」 |
| **Agent** | 可獨立註冊、辨認、恢復或結束使用的 Agent 身分；可以短暫，也可以長期存在 | 不等於 AI 模型、某個 Bot 程式或機器 |
| **Session** | 屬於一個 Agent 的一次持續對話／工作上下文；一個 Agent 可以有一個或多個 | 不必等於整個 Agent；不必等於一台機器 |
| **Default Session（預設 Session）** | 只指定 Agent、沒有明確指定 Session 時，用來解析地址的預設工作階段 | 不一定要叫 `main` |
| **Runtime（執行實例）** | 實際執行 Agent／Session 的進程或環境，例如某次 Codex 啟動、某個 Bot 服務進程 | 不在三層地址中；不等於 Agent 身分 |
| **Agent 程式／類型** | Codex、GrokBot、OpenMausBot 等承載 Agent 的應用程式或軟體類型 | 同一套程式不代表只有一個 Agent |
| **Display Name（顯示名稱）** | 給人閱讀的名稱，例如「FFL 開發」 | 不必與可用於 URL 的地址識別字相同 |
| **Address Handle（地址識別字）** | 地址某一層實際採用的穩定識別字，例如 `ffl-dev` | 不應因程式、模型或執行機器改變而任意變動 |
| **Claim（登記／宣告）** | 建立新身分，或以合法授權取得某身分的使用權；兩種動作必須在 API 語意上可區分 | 知道別人的地址就能冒用它 |
| **Resume（恢復）** | 經過身分核對，重新連回既有的 Agent／Session，保持原身分與地址 | 建立一個同名的新 Agent |
| **Conversation Binding（對話綁定）** | 記錄某個發送者和接收者之間，後續訊息應延續哪一段對話的對應關係 | 不等於兩個 Agent 共用同一個 Session |

## 3. 必須成立的領域規則

1. **一個 Organization 底下可有多個 Agent；一個 Agent 底下可有多個 Session。** 只有一個 Session 也是合法、常見的情況。
2. **Agent 是獨立實體，不由模型或程式名稱推定。** 兩次全新啟動同一個 Codex，預設是兩個不同 Agent；只有經過明確 Resume，才延續原本身分。
3. **一個程式可以承載多個 Agent。** GrokBot 程式裡的十個助理，應是十個不同 Agent 地址，不是「一個 GrokBot Agent」。
4. **每個 Agent 都有一個 Default Session。** 初次登記時需要能建立或指定它；往後不指定 Session 時，必須能解析到實際的完整地址。
5. **完整地址永遠為 Organization／Agent／Session。** Agent 層的簡寫只是一種輸入與解析方式，不是新增一種兩層正式地址。
6. **名稱與不可變身分應分離。** 每個 Agent、Session 應有內部識別身分；顯示名稱、地址識別字與 Runtime 資訊不能混為一談。
7. **一個 Session 預設同時只能由一個 Runtime 主動持有。** 不因來源機器不同就憑空建立另一套身分，也不讓另一個 Runtime 默默接管。
8. **知道地址不等於有權宣告地址。** Organization 登入確認組織歸屬，但建立、恢復、改名、撤銷與接管仍要經授權檢查。
9. **地址是識別資料，不是傳輸拓樸。** Windows、Mac、VPS、機器名稱與實際連線位置可以保留為 Runtime 資訊，但不能再決定核心地址階層。

## 4. 不同產品如何對應同一模型？

以下是使用方式的例子，**不是要求核心程式寫死各產品的特殊判斷**。

| 情境 | Agent 如何形成 | Session 如何形成 |
| --- | --- | --- |
| **Codex：新的工作** | 新開一次 Codex，通常建立一個新的 Agent | 這次工作對應一個 Session；使用者自然會想取「FFL 開發」之類的工作名稱 |
| **Codex：Resume** | 經核對後恢復原 Agent，不因程式重啟而自動改成新身分 | 恢復原來的 Session 與完整地址 |
| **GrokBot** | 一個 GrokBot 程式內可以建立許多有各自人設的 Agent | 每個 Agent 可以只維持一個主 Session；通常只需要命名 Agent |
| **OpenMausBot** | 一個程式內可建立多個 Agent，彼此可使用不同模型 | 一個 Agent 可以有主 Session，也可以另開多個 Session |

例如，GrokBot 程式內有「小明」「小美」兩個助理，應該是：

```text
nuwa/xiaoming/main
nuwa/xiaomei/main
```

這不是同一個 Agent 的兩個 Session。反過來，OpenMausBot 的「研究助理」可以是同一個 Agent 的多個 Session：

```text
nuwa/researcher/main
nuwa/researcher/quantum-research
nuwa/researcher/weekly-report
```

## 5. 登入後如何取得自己的地址？

### 5.1 先確定 Organization，再確定 Agent／Session

1. 使用者透過 MCP 所支援的登入流程，以自己的 Email 帳號完成身分驗證；現行服務以 OAuth（登入與授權協定）處理這項流程。
2. 系統根據帳號與組織的授權關係，確定可操作的 Organization；不讓 Agent 自行宣稱屬於任意組織。
3. 這次啟動若沒有既有合法身分，就**建立新 Agent 及其 Session**；若有恢復資訊，就走**Resume**，兩者不能混淆。
4. 成功後一律回傳可複製、可再次查詢的**完整三層地址**，並顯示 Agent／Session 各是哪個名稱。

MCP 是 Agent 與 Agent Address 互動的一種介面；其他整合也可使用同一組領域操作的 HTTP API。登入、地址建立及解析規則應由共用核心實作，不分別寫在各個 MCP 工具或 UI 裡。

### 5.2 名稱可部分省略，不讓使用者被三層結構綁住

登記介面在語意上要分開接受 `agentName` 與 `sessionName`（以下同時是現行 API 的明確欄位名稱）：

| 提供的資料 | 目標行為 |
| --- | --- |
| 都沒提供 | 系統為新的 Agent 和 Session 自動產生名稱 |
| 只有 `agentName` | 使用指定 Agent 名稱，建立其 Default Session |
| 只有 `sessionName` | 自動建立 Agent，使用指定 Session 名稱，並設為 Default Session |
| 兩者都有 | 依指定名稱建立完整地址 |

例如使用者在 Windows 的 Codex 說「我正在做 FFL 開發，把這段工作叫 FFL 開發」：

```text
顯示名稱：FFL 開發
Agent handle：codex-win-a7k2    （系統產生，僅為示例）
Session handle：ffl-dev         （依工作名稱指定）
完整地址：nuwa/codex-win-a7k2/ffl-dev
```

在 GrokBot 裡，使用者可能說「這位 Agent 就叫小明」：

```text
Agent handle：xiaoming
Session handle：main            （自動建立的 Default Session）
完整地址：nuwa/xiaoming/main
```

只有 `agentName` 而沒有 `sessionName` 時，系統建立名為 `main` 的 Default Session；只指定 `sessionName` 則自動產生 Agent Handle。**不得單憑「這是 Codex 還是 GrokBot」就決定一個模糊名稱必然屬於 Agent 或 Session。** 應優先依使用者表達的意圖或明確參數判斷；真正歧義時才詢問。應用程式名稱、模型、作業系統與 Runtime 可以輔助產生友善的預設名字，但不能自動定義身分。

人類可使用「FFL 開發」等顯示名稱；地址使用適合解析的識別字。**系統不得只回傳簡稱，讓使用者不知道自動產生的 Agent 名稱。**

### 5.3 同名、恢復與新建是不同操作

- 要建立新身分卻遇到已占用的名稱：不能悄悄把新進程掛到原 Agent／Session；應明確回報衝突，提供另一個名稱。
- 要 Resume 舊身分：須有可驗證的恢復依據及相應權限；不能只憑「我知道它的地址」就取得使用權。
- 既有 Session 正由別的 Runtime 使用時：**拒絕同時接管，不強制移交、不自動踢掉原 Runtime**。使用者可另外建立新地址繼續工作。

例如 Windows 上的 `nuwa/codex-win-a7k2/ffl-dev` 還在執行，Mac 上另一個 Codex 不可直接冒用它。使用者可以把新的工作取名為「FFL Dev Mac」，產生另一個完整地址，例如：

```text
nuwa/codex-mac-b8k4/ffl-dev-mac
```

新名字在哪一層，仍由登記時的 Agent／Session 命名意圖決定；不必因為換機器就更動原地址。

## 6. Session 預設解析與跨 Agent 對話

### 6.1 沒指定 Session，最後仍須得到一個 Session

在其他服務或使用者只輸入 `nuwa/xiaoming` 時，這是**指向 Agent 的簡寫**。系統可依該 Agent 的 `defaultSessionId` 解析成實際地址，例如 `nuwa/xiaoming/main`。

Default Session 是一個**指定的 Session 身分**，名稱不必永遠叫 `main`：只有 `ffl-dev` 的 Codex Agent，也可以把它設為 Default Session。

### 6.2 Agent 與 Agent 之間的固定對話不能混進所有人的 main

假設 Agent A 經常傳訊給 Agent B，而每次都只指定 B 的 Agent 名稱。期望的行為是**延續 A 與 B 已建立的固定對話**，而非每次開新 Session，也不是把所有發送者的內容混進 B 的同一個主 Session。

對話綁定（Conversation Binding）可記錄「A 對 B 的這段對話」實際使用 B 的哪個 Session；A 與 B 各自的 Session 是不同身分，不需共用單一 Session 記錄。

目標解析優先順序：

1. 明確提供完整 Session 地址：直接解析該 Session。
2. 只提供 Agent 且已有該發送者的對話綁定：延續對應 Session。
3. 發送者首次與此 Agent 建立獨立對話：建立並記住新的會話對應。
4. 不涉及特定發送者對話、也沒有綁定的普通入口：使用 Agent 的 Default Session。

**邊界：Agent Address 提供身分與地址解析，並不因此承擔訊息內容或傳輸。** 對話綁定由傳訊層保存，或透過獨立服務與 Agent Address 協作，其實際 API 與擁有者仍須在實作前定義，不能把這份概念描述當成既有功能。

## 7. Runtime 與 Session 使用權

Runtime 是執行位置和進程資訊，不應出現在 Canonical Address。它可以是 Windows 的 Codex、Mac 的 Codex，也可以是同一個 Bot 程式裡同時執行多個 Agent 的環境。

首版採取簡單且清楚的原則：**同一 Session 只有一位目前的執行持有者**。

- 新建 Session 後，可由建立它的 Runtime 使用。
- 合法 Resume 時，若沒有其他有效持有者，可以重新使用原 Agent／Session 與原地址。
- 若已有另一位有效持有者，拒絕第二次接管；請求端可以另建新 Agent／Session 地址。
- 不設計隱式的「奪取」「踢除其他 Runtime」行為。
- 未來若要允許一個 Session 的多 Runtime 協作，應另外定義執行協調與一致性規則，**不改變三層地址**。

「如何確認原 Runtime 已失去使用權」「恢復憑證如何安全保存」屬實作時必須確定的機制，不應僅靠進程宣稱自己離線、名稱相同或知道舊地址來判定。

## 8. Organization 自助管理：管理自己的 Agent 與 Session

Organization Portal 是組織的管理介面：使用者以**自己的帳號**登入後，只能查看和操作授權所及組織內的 Agent、Session 與相關 Runtime 資訊。

Portal 應從組織整體往下呈現：Organization → Agent 清單 → Agent 的 Session 清單／Default Session → 可用狀態和管理操作。應能清楚區分顯示名稱、完整地址、身分狀態與執行狀態。

**登入組織 ≠ 取得每一個執行中的 Agent Session 的執行權。** 管理員對名稱、停用、撤銷的管理權與 Runtime 的 Session 使用權，必須在授權模型中區分。

現行資料庫的 `accounts.org_id` 有 `UNIQUE` 限制，一個組織最多綁定一個帳號；這只是**目前實作的限制**，不是新架構永久的產品規則。未來若允許多位組織成員，需以明確的成員／角色授權模型擴充，不能用一組共享組織密碼代替。

## 9. 專案結構與實作邊界

同一個 Cloudflare Worker 同時部署 OAuth、MCP、HTTP API 和兩個網頁介面，但**一起部署不代表寫在一起**：

- **Organization／Identity／Runtime 領域服務**只負責實體、身分、Session 與使用權；不能依賴 HTTP、MCP、React 或特定 Bot 產品。
- **HTTP API Controller**負責輸入、授權與輸出資料格式；所有客戶端使用同一套領域操作。
- **MCP Tools**僅提供 AI Agent 容易使用的工具名稱與輸入說明，透過共同 API Controller 呼叫領域服務，不重新實作資料邏輯。
- **Organization Portal**透過相同 OAuth 身分和 HTTP API 讓組織管理者檢視、登記 Agent／Session，登記本身**不佔用 Runtime**。
- **Runtime Claim**是獨立的動作：MCP 或執行者建立身分並取得執行權；Resume 以合法恢復憑證取得當前尚未被佔用的 Session。
- **Admin Console**用 Cloudflare Access 保護，與一般 Organization Portal 的授權邊界分離。

資料庫採 D1（Cloudflare 的 SQL 資料庫）儲存 Organization、Account、Agent、Session 和 Runtime Lease。新的 D1 結構用 migration（一次性的資料結構變更檔）管理；在切換已存在的正式資料庫前，必須先驗證獨立資料庫，**不得把清理程式碼誤當成刪除正式資料的授權**。

實作與測試遵循 [CODE_PRINCIPLES.md](../CODE_PRINCIPLES.md) 和專案 Testing Guide：保持 OO、DRY、職責分離、例外不吞掉、沒有無意義的相容分支，並在邏輯驗證後檢查 Rule 20 的語意垂直留白。

## 10. 必須通過的行為驗收

1. **Codex 新啟動：** 同一組織登入兩次，兩次都沒有 Resume 資訊，建立兩個不同 Agent／Session 身分；即使模型、程式與電腦相同也不能合併。
2. **Codex Resume：** 提供合法恢復依據且沒有活躍衝突，回到原 Agent、Session 與完整地址，不另建同名身分。
3. **GrokBot 多 Agent：** 同一個程式中的十個 Agent 分別擁有地址，每個可只有自己的 Default Session。
4. **OpenMausBot 多 Session：** 同一 Agent 可同時有多個不同 Session；未指明時可解析到既定的 Default Session。
5. **部分命名：** 只給 Agent 名、只給 Session 名、兩個都給或都不給，最終一律取得完整三層地址；模糊的自然語言命名不猜產品類型。
6. **重複接管：** Windows 持有的 Session 尚有效時，Mac 請求使用同一個地址必須被拒絕；另建「FFL Dev Mac」地址後可以正常使用，原身分不變。
7. **跨組織隔離：** 一個組織的帳號不得管理或恢復其他組織的 Agent／Session，知道地址也不能繞過驗證。
8. **組織自助管理：** 組織管理者可以用相同 OAuth 帳號在 Portal 登入、建立 Agent／Session，但登記不會自動取得 Runtime 執行權。
9. **對話連續性：** A 反覆以 B 的 Agent 名稱傳送訊息時，在既有對話綁定下能維持原來的接收 Session，且不混入其他發送者的上下文。

## 11. 目前已確定的實作與整合邊界

- **身份持久化：** D1 保存 Organization、Account、Agent、Session。Canonical Address 使用可變更的 Handle，內部 ID 不隨改名改變。改名後舊地址立即失效，不保留 alias。
- **Default Session：** Agent 初次建立就有 Default Session；不指定 Session Handle 時使用 `main`。組織管理者可改指定其他 Session；不可直接停用仍是 Default 的 Session。
- **恢復權限：** 建立／註冊發出只顯示一次的 Resume Token；一般 Resume 仍驗證其合法性。同 Organization 的授權擁有者亦可明確指定已存在、目前沒有有效 Runtime Lease 的 Session，透過 `PUT /v2/account/sessions/{sessionID}/owner-runtime-lease` 直接恢復原身分；此操作重新簽發 Resume Token，舊 Token 隨即失效。這是同組織擁有者的自助恢復，不是同事透過訊息內文冒用其他身分。
- **Runtime 排他：** D1 單列 Lease、原子取得、續期與釋放；已被其他 Runtime 持有時拒絕接管。Agent／Session 停用會撤銷相應 Lease，失效 Session 無法繼續使用。
- **管理權與執行權分離：** Organization Portal 登記身分不取得 Runtime Lease；只有 Claim 或合法 Resume 取得使用權。
- **跨產品邊界：** Conversation Binding（A 與 B 的固定訊息 Session 對應）由訊息傳送層或獨立服務持有。Agent Address 提供身份查詢與解析，不保存訊息或私下建立 Relay 對話。
- **資料庫切換：** 新建隔離 D1 並驗證後才能切換 Worker，絕不在已部署 Host／Work D1 上直接套用新版初始 Migration。詳見 [Database cutover runbook](deployment-cutover.md)。
- **後續獨立功能：** 若組織要有多個人類帳號／角色，需額外定義成員授權模型；不可用本版本一帳號一組織的限制假裝已有成員管理。

**架構驗收的標準，是不同類型的 Agent 都能安全取得、命名、恢復與撤銷固定的三層地址，且不把模型、Bot 程式或 Runtime 混成身分。**
