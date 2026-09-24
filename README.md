# w-dispatch-ai
A tool for dispatch ai.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-dispatch-ai.svg?style=flat)](https://npmjs.org/package/w-dispatch-ai) 
[![license](https://img.shields.io/npm/l/w-dispatch-ai.svg?style=flat)](https://npmjs.org/package/w-dispatch-ai) 
[![npm download](https://img.shields.io/npm/dt/w-dispatch-ai.svg)](https://npmjs.org/package/w-dispatch-ai) 
[![npm download](https://img.shields.io/npm/dm/w-dispatch-ai.svg)](https://npmjs.org/package/w-dispatch-ai) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-dispatch-ai.svg)](https://www.jsdelivr.com/package/npm/w-dispatch-ai)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-dispatch-ai/global.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-dispatch-ai
```

Note:
- `dispatchClaude` needs [Claude Code CLI](https://claude.com/claude-code) (`claude`) in system PATH, and uses its existing login state.
- `dispatchCodex` needs [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) in system PATH, and uses its existing login state.
- `dispatchOpencode` needs [opencode CLI](https://opencode.ai/) (`opencode`) in system PATH. Unlike the other two, it accepts a per-call `key`+`provider`, injected through `OPENCODE_AUTH_CONTENT`, so multiple api keys can be rotated without rewriting `auth.json`.
- `dispatchAntigravity` needs [Google Antigravity CLI](https://antigravity.google/) (`agy`, not `antigravity`) in system PATH, and uses its existing OAuth login state (first login requires an interactive desktop session). Unlike the other three, agy takes the prompt via the `--print` flag instead of stdin, so the prompt is capped at 30000 chars (Windows command line limit); longer prompts return an error result.
- `dispatchApiOpenaiCompat` needs **no cli and no login**: it calls any OpenAI-compatible endpoint directly by fetch. Known-working gateways (verified 2026-08-11): [OpenCode Zen](https://opencode.ai/docs/zen) `https://opencode.ai/zen/v1` (same `sk-...` keys as opencode cli, model names without the `opencode/` prefix, e.g. `kimi-k2.7-code`; **most of its free models reject REST since 2026-09-17 with 403 FreeTierError and must go through the opencode cli instead** (the gate is applied per model: `jev-1.13-free` on `/systemone` and `space-bunny-free` were verified to still accept REST)) and Agnes `https://apihub.agnes-ai.com/v1` (model `agnes-3.0-flash`). Note claude/codex use subscription login state, not api keys, so they cannot be called this way.
- Each cli adapter also accepts an `exe` option to pin the executable path, useful when the CLI is not in PATH (e.g. Windows Task Scheduler environments).
- For the other three adapters the prompt is always passed through stdin, never as a positional argument, so a prompt of tens of thousands of characters will not cause `ENAMETOOLONG`.
- All functions never reject. Success or failure is reported by the `ok` and `error` fields of the result object.
- **Security**: `dispatchClaude` passes `--dangerously-skip-permissions` by default, so the non-interactive `-p` mode will not hang on permission prompts. If the prompt embeds untrusted content (e.g. a web page to summarize), instructions inside that content would also run without the permission gate. Pass `skipPermissions: false` to keep the CLI permission gate.

#### Functions:
| function | description |
| --- | --- |
| `dispatchAi(kind, prompt, opt)` | dispatch to the adapter of `kind`, one of `'opencode'`、`'claude'`、`'codex'`、`'antigravity'`、`'api-openai-compat'`、`'api-openai-responses'`、`'api-typesafe-systemone'` |
| `dispatchAiFallback(prompt, opt)` | call ai with an ordered provider list, auto rotating keys within a group and falling back to the next group |
| `dispatchAiWkf(opt)` | workflow factory: inject a named provider table once, returns bound `callAi`／`runFanout`／`runRolePipeline`／`runFanoutPipeline` |
| `dispatchOpencode(prompt, opt)` | call an ai model by opencode cli, supports per-call api key and provider config |
| `dispatchClaude(prompt, opt)` | call a claude model by claude code cli |
| `dispatchCodex(prompt, opt)` | call a gpt model by openai codex cli |
| `dispatchAntigravity(prompt, opt)` | call an ai model by google antigravity cli (`agy`), a multi-model gateway (gemini, claude, gpt-oss) |
| `dispatchApiOpenaiCompat(prompt, opt)` | call an ai model by direct fetch to any OpenAI-compatible API (`baseURL`+`key`+`model`), no cli and no login required |
| `dispatchApiOpenaiResponses(prompt, opt)` | same, but for the OpenAI **Responses API** (`/responses`) — required by model families that are not served on `/chat/completions` (e.g. OpenCode Zen's muse-spark and GPT families) |
| `dispatchApiTypesafeSystemone(prompt, opt)` | call TypeSafe's **jev** decision model (`POST /v1/systemone`): not text generation — the prompt is the state to evaluate and `opt.questions` defines typed yes/no, choice and score questions; returns typed `answers` with probabilities (API only, TypeSafe has no cli) |
| `providers` | curated provider entries verified by real tests (cli and rest paths), pick or use all via `resolveProviders` |
| `resolveProviders(providers, opt)` | expand `envVar` → `keys` from env (comma-separated, missing vars auto-skipped), supports `pick` subset by id, `exes` per-kind exe injection and `patch` per-id field override; unknown picked ids are reported in `missing` with fuzzy spelling `hints` |
| `readEnvFile(file)` | read a `.env` file into a plain object for `resolveProviders`'s `opt.env`, without polluting `process.env` |
| `budgetFor(providers)` | derive the time budget to walk a whole fallback chain (sum of per-entry `timeoutMs`, defaults applied) |
| `createFileStore(opt)` | file-persisted `store` for `dispatchAiFallback` (cursors and cooling survive across processes), exclusion-style passthrough |
| `createUsageCounter(opt)` | per-day per-key usage counter fed by `onEvent` (observation only, never throttles) |
| `salvageTruncatedArray(text)` | salvage the complete leading elements of a truncated JSON array (opt-in, not part of default parsing) |
| `NO_SIDE_EFFECT` | the no-side-effect prompt prefix (single source), auto-applied by workflow `callAi`, prepend manually for direct `dispatchAiFallback` calls |
| `getQuotaClaude(email, opt)` | read the current subscription quota windows (5h / 7d / per-model 7d) of the locally logged-in Claude Code account via Anthropic's OAuth usage API; `email` is compared against the local account, not used to look one up |
| `getQuotaCodex(email, opt)` | same for the Codex CLI account: primary path `codex app-server` JSON-RPC (auth handled by codex), fallback to chatgpt.com's usage endpoint |
| `getQuotaAntigravity(email, opt)` | same for the Antigravity CLI (`agy`) account via its headless `-p "/usage" --output-format json` (agy ≥ 1.1.11, version-gated) |
| `KINDS` | array of available kinds, `['opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat', 'api-openai-responses', 'api-typesafe-systemone']` |

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-dispatch-ai/blob/master/g.mjs)]
```alias
import wdi from 'w-dispatch-ai'


//由.env載入金鑰, AGNES_KEYS等以逗號分隔多把; opencode自家免費模型免金鑰(以useStoredAuth:false匿名存取)
try {
    process.loadEnvFile('./.env')
}
catch {}
let agnesKeys = (process.env.AGNES_KEYS || '').split(',').filter(Boolean)


//agnes-ai為opencode未內建之第三方provider, 須另給其provider定義
let configAgnes = {
    provider: {
        'agnes-ai': {
            npm: '@ai-sdk/openai-compatible',
            name: 'Agnes',
            options: { baseURL: 'https://apihub.agnes-ai.com/v1' },
            models: { 'agnes-2.0-flash': { name: 'Agnes 2.0 Flash' } },
        },
    },
}


let test = async () => {

    //可用之AI供應商種類
    console.log('KINDS:', wdi.KINDS)
    // => KINDS: [ 'opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat', 'api-openai-responses', 'api-typesafe-systemone' ]

    let prompt = '請只回覆兩個字：完成，不要有任何其他文字'

    //以Claude Code CLI呼叫, 沿用CLI既有登入狀態
    let r1 = await wdi.dispatchClaude(prompt, { model: 'sonnet' })
    console.log('claude:', r1.ok, r1.stdout.trim())
    // => claude: true 完成

    //以Codex CLI呼叫, 可指定沙箱模式
    let r2 = await wdi.dispatchCodex(prompt, { model: 'gpt-5.6-luna', sandbox: 'read-only' })
    console.log('codex:', r2.ok, r2.stdout.trim())
    // => codex: true 完成

    //以opencode CLI呼叫, 未給key與provider即沿用CLI既有登入狀態(auth.json);
    //opencode自家免費模型另建議帶useStoredAuth:false以匿名存取, 免得結果隨本機登入帳號之工作區設定而異
    let r3 = await wdi.dispatchOpencode(prompt, { model: 'opencode/muse-spark-1.3-contributor-free', useStoredAuth: false, timeoutMs: 180000 })
    console.log('opencode:', r3.ok, r3.stdout.trim())
    // => opencode: true 完成

    //以antigravity CLI(agy)呼叫, prompt走--print旗標(長度上限30000字元), model須為`agy models`第一欄slug
    let r3b = await wdi.dispatchAntigravity(prompt, { model: 'gemini-3.6-flash-low' })
    console.log('antigravity:', r3b.ok, r3b.stdout.trim())
    // => antigravity: true 完成

    //以OpenAI相容API直呼(免CLI免登入), 給baseURL+key+model即可; Zen端點即opencode CLI之自家閘道
    let r3c = await wdi.dispatchApiOpenaiCompat(prompt, {
        baseURL: 'https://apihub.agnes-ai.com/v1',
        key: agnesKeys[0],
        model: 'agnes-2.0-flash',
    })
    console.log('api-openai-compat:', r3c.ok, r3c.code, r3c.stdout.trim())
    // => api-openai-compat: true 200 完成

    //以供應商條目輪替, 一個條目即一組(kind, model, 可選的key與provider與config), 輪到誰就用誰的CLI與模型
    //opencode支援逐次注入金鑰, 故同一provider之多把金鑰可各成一個條目
    let items = [
        { kind: 'claude', model: 'sonnet' },
        { kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
        { kind: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', useStoredAuth: false, timeoutMs: 180000 },
        { kind: 'opencode', model: 'opencode/big-pickle', useStoredAuth: false, timeoutMs: 180000 },
        { kind: 'opencode', model: 'agnes-ai/agnes-2.0-flash', provider: 'agnes-ai', key: agnesKeys[0], config: configAgnes, timeoutMs: 180000 },
        { kind: 'antigravity', model: 'gemini-3.6-flash-low' },
    ]
    for (let item of items) {
        let r = await wdi.dispatchAi(item.kind, prompt, item)
        console.log('dispatchAi ' + item.model + ':', r.ok, r.stdout.trim())
        // => dispatchAi sonnet: true 完成
        // => dispatchAi gpt-5.6-luna: true 完成
        // => dispatchAi opencode/muse-spark-1.3-contributor-free: true 完成
        // => dispatchAi opencode/big-pickle: true 完成
        // => dispatchAi agnes-ai/agnes-2.0-flash: true 完成
        // => dispatchAi gemini-3.6-flash-low: true 完成
    }

    //未知供應商回傳error結果物件, 不會reject
    let r4 = await wdi.dispatchAi('gemini', prompt)
    console.log('invalid kind:', r4.ok, r4.error)
    // => invalid kind: false unknown ai kind: "gemini" (available: opencode, claude, codex, antigravity, api-openai-compat, api-openai-responses, api-typesafe-systemone)

    //prompt非有效字串亦回傳error結果物件
    let r5 = await wdi.dispatchClaude('')
    console.log('invalid prompt:', r5.ok, r5.error)
    // => invalid prompt: false prompt must be a non-empty string

    //執行失敗時, 由ok、code、error與stderr判斷原因
    //REST路徑之錯誤依HTTP狀態碼分流(401金鑰無效、429限流、5xx服務端), 判別比CLI之stderr字串可靠
    let r6 = await wdi.dispatchApiOpenaiCompat(prompt, {
        baseURL: 'https://apihub.agnes-ai.com/v1',
        model: 'agnes-2.0-flash',
        key: 'sk-invalid-key',
    })
    console.log('invalid key:', r6.ok, r6.code, r6.error, r6.stderr.includes('无效的令牌'))
    // => invalid key: false 401 HTTP 401 true

    //多供應商自動遞補: providers順序即優先序, 組內keys以游標輪替
    //此例第1把金鑰無效 → 自動換組內下一把成功; 若整組用盡會遞補下一組, 依序往下
    //
    //【id命名】id為游標鍵與日誌標籤, 須區分到「模型」而非只到「廠商」——
    //  取'claude'則日後無法同時掛sonnet與opus, 且日誌看不出實際用了哪個模型;
    //  同一模型經不同路徑(REST／CLI／不同閘道)取得時額度池與故障域各自獨立,
    //  屬不同供應商, 故id須帶上路徑前綴加以區分
    let r7 = await wdi.dispatchAiFallback(prompt, {
        providers: [
            //REST版排前面: 免CLI、快3~5倍, 純文字任務優先走此路
            {
                id: 'agnes:agnes-2.0-flash',
                kind: 'api-openai-compat',
                baseURL: 'https://apihub.agnes-ai.com/v1',
                model: 'agnes-2.0-flash',
                keys: ['sk-invalid-key-demo', agnesKeys[0]], //第1把無效, 示範組內輪替
            },
            //同一個agnes模型之CLI版: 有工具能力但較慢, 額度池亦不同, 屬另一個供應商
            {
                id: 'oc:agnes-ai/agnes-2.0-flash',
                kind: 'opencode',
                model: 'agnes-ai/agnes-2.0-flash',
                provider: 'agnes-ai',
                keys: agnesKeys,
                config: configAgnes, //第三方provider須另給定義
                timeoutMs: 180000,
            },
            { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
            { id: 'codex:gpt-5.6-luna', kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
            { id: 'agy:gemini-3.6-flash-low', kind: 'antigravity', model: 'gemini-3.6-flash-low' },
        ],
        budgetMs: 600000,
        onEvent: (ev) => console.log('  event:', ev.type, ev.keyId, ev.error || ''),
    })
    console.log('fallback:', r7.ok, r7.providerId, r7.keyIndex, r7.stdout.trim())
    console.log('tried:', r7.tried.map((x) => `${x.keyId}:${x.outcome}`).join(', '))
    // =>   event: try agnes:agnes-2.0-flash#0
    // =>   event: next-key agnes:agnes-2.0-flash#0 HTTP 401
    // =>   event: try agnes:agnes-2.0-flash#1
    // =>   event: ok agnes:agnes-2.0-flash#1
    // => fallback: true agnes:agnes-2.0-flash 1 完成
    // => tried: agnes:agnes-2.0-flash#0:next-key, agnes:agnes-2.0-flash#1:ok

}
await test()
    .catch((err) => {
        console.log(err)
    })
```

#### 行為變更紀錄（依賴方升版前請檢查）:
**1.0.37 起**（皆為安裝方驗收時需逐一檢查之既有呼叫結果變化）：
1. **REST 文字類截斷預設失敗**：`finish_reason`為`length`／`content_filter`（Responses API 為`status: 'incomplete'`）時，於`validate`之前回`errorType: 'incomplete'`；此前會回`ok`或交`validate`判斷（不過時為`validation`）。**直接呼叫`dispatchAiFallback`或轉接器、且`validate`內含搶救策略者，須自行給`acceptTruncated: true`**；工作流`callAi`有自訂`parse`者自動同意、不必改。
2. 截斷與`tool-unsupported`改為**整組跳過**（此前逐把換金鑰）；截斷不重試。
3. `validate`（及工作流之`parse`／`check`）拋錯改回驗證失敗（`validation`），不再令整條鏈 reject。
4. 工作流層：條目自帶`validate`與工作流`validate`取交集（兩者皆過才算過）。
5. 三個 REST 轉接器預設帶`Accept-Encoding: identity`。
6. 依`errorType`做健康計數或監控者：截斷且驗證不過者由`validation`改為`incomplete`，須一併納入；結果另帶`finishReason`與`truncated`。

**1.0.37 之後**：
7. HTTP 200 但本體非 JSON，另報`INVALID_RESPONSE: body is not JSON (<位元組數>, first bytes <前16位元組hex>, content-encoding=…, content-type=…)`（此前與「JSON 缺欄位」同一句），並改為**整組跳過**；`errorType`仍為`invalid-response`，「JSON 缺欄位」維持換金鑰。依`errorType`計數者若要把此類整組失敗計入，須納入`invalid-response`。

#### Options shared by all dispatch functions:
| key | type | default | description |
| --- | --- | --- | --- |
| `exe` | String | 各CLI名稱 | 執行檔名稱或絕對路徑，給予名稱時由系統`PATH`解析 |
| `model` | String | `''` | 模型ID，未給予則不帶模型旗標，由CLI自行決定 |
| `extraArgs` | Array | `[]` | 額外命令列旗標字串陣列，接於固定旗標之後 |
| `timeoutMs` | Integer | `300000` | 逾時毫秒，逾時將強制關閉子進程及其子孫程序；**全套件統一預設**(所有轉接器與各層一致，單一來源`dfTimeoutMs.mjs`)，由opt傳入即可覆寫 |
| `cwd` | String | `process.cwd()` | 子進程工作目錄。**`dispatchOpencode` 另會把其絕對路徑同步注入環境變數 `PWD`**（覆寫呼叫端 `env` 內之同名變數）：opencode 以**繼承之 `PWD`** 優先於子進程真實 cwd 決定 session 目錄（原始碼 `run.ts`：`process.env.PWD ?? process.cwd()`），而 Git Bash 與 Linux/macOS 的 shell 都會設 `PWD`；2026-09-23 實測未同步時 opencode 會在父程序目錄讀寫（讀相對路徑回 NOTFOUND 且 `ok: true`，允許寫檔時檔案落在父程序目錄）。claude／codex 同組探針遵循 cwd，不受影響 |
| `validate` | String\|Function | `undefined` | `stdout`驗證規則，可用`'nonempty'`、`'json'`、`'min:100'`，多規則以逗號串接，亦可給予`(stdout)=>Boolean` |
| `maxRetries` | Integer | `0` | 失敗後最大重試次數，遇`ENOENT`或exit code 2視為不可重試而立即中止 |

其餘設定會原樣轉傳給`wsemi`之`execCli`，例如`retryDelayMs`、`maxBuffer`、`onStdout`、`onStderr`、`env`。

#### Options only for dispatchOpencode:
| key | type | default | description |
| --- | --- | --- | --- |
| `key` | String | `''` | 該provider之API key，須與`provider`同時給予才會以`OPENCODE_AUTH_CONTENT`注入 |
| `provider` | String | `''` | `key`所屬provider名稱，須與`model`為同一組 |
| `useStoredAuth` | Boolean | `true` | 未注入金鑰時是否沿用本機`auth.json`之登入。`false`代表以空憑證（`OPENCODE_AUTH_CONTENT='{}'`）匿名存取，用於opencode免費模型，避免結果隨本機登入帳號而異（登入帳號之工作區未開該模型時會回`Model is disabled`）；已同時給`key`與`provider`時不作用 |
| `config` | Object\|String | `null` | opencode設定內容，將以`OPENCODE_CONFIG_CONTENT`注入，供補上第三方provider之定義 |
| `agent` | String | `'build'` | opencode代理名稱 |

#### Options only for dispatchClaude:
| key | type | default | description |
| --- | --- | --- | --- |
| `skipPermissions` | Boolean | `true` | 是否帶`--dangerously-skip-permissions`旗標，`false`代表保留CLI權限閘門（見上方Security說明）。`extraArgs` **勿帶 `--bare`**：bare 模式不讀 OAuth 登入會直接認證失敗，且官方預告 `--bare` 將成為 `-p` 之預設（屆時訂閱條目會一併失效，見 `dispatchClaude.mjs` 檔頭）；帶 `--restricted` 時本欄須為 `false`（restricted 拒絕 bypassPermissions，2026-09-23 實測同時帶即報錯） |

#### Options only for dispatchCodex:
| key | type | default | description |
| --- | --- | --- | --- |
| `sandbox` | String | `'workspace-write'` | 沙箱模式，可用`'read-only'`、`'workspace-write'`、`'danger-full-access'` |

**Windows 診斷：Codex 回報所有命令 `blocked by policy`（Codex ≥0.149）**

Codex 0.149 起 Windows 預設走 elevated 沙箱（專用使用者 `CodexSandboxOffline`/`CodexSandboxOnline`＋WFP 網路過濾＋家目錄 read ACL），**需一次性管理員設定**；設定未完成時 execpolicy 會在 spawn 前拒絕**所有** shell 命令（含 `Get-Content`、`rg` 等唯讀命令），錯誤形如 `CreateProcess { message: "Rejected(\"... blocked by policy\")" }`——Codex 讀檔即是執行 shell，等同完全不能讀檔。

- **判別**：`~/.codex/.sandbox/setup_marker.json` 不存在、且 `~/.codex/.sandbox/sandbox.<日期>.log` 只有 `START` 沒有 `SUCCESS` ＝ 設定未完成。
- **正解**：以互動模式跑一次 `codex` 完成設定（會要求 UAC 提權），完成後 `setup_marker.json` 出現，`read-only`／`workspace-write` 皆可正常執行命令（2026-08-26 於 Codex 0.149.0＋Windows 11 26200 實測：設定完成前全擋、完成後五種設定全通）。2026-09-23 補：`windows.sandbox` 於 0.156.1 之官方 config reference 仍為 `unelevated | elevated`；新版 Windows sandbox 文件另載明 elevated 設定失敗時 Codex 會改用 unelevated（「Codex switched me to the unelevated sandbox」），「全擋」為 0.149 之觀察、未於未設定之機器以新版重測。
- **臨時繞道**：`extraArgs: ['--config', 'windows.sandbox="unelevated"']`——跳過管理員設定即可執行，但**隔離較弱**（無專用使用者與網路過濾）；本套件**刻意不**將此設為 Windows 預設，避免在已完成設定的機器上默默降級沙箱。
- **靜默失敗警語**：被擋時 Codex 常回「請貼上檔案內容」之合法字串，會通過 `validate: 'nonempty'` 被當成功。凡需 Codex 讀檔的任務，`validate`／工作流 `check` 應要求回覆**引用指定行原文**，不要只驗非空；派長任務前先以「讀一個檔並引用第 N 行」做最小探測。

#### Options only for dispatchAntigravity:
| key | type | default | description |
| --- | --- | --- | --- |
| `model` | String | `''` | 須為`agy models`**第一欄之slug**（如`gemini-3.6-flash-low`）；agy錯誤訊息列出的是顯示名稱而非slug，勿照抄 |
| `effort` | String | `''` | `'low'`、`'medium'`、`'high'`，需agy>=1.1.11；建議搭配不帶檔位之基礎slug（如`gemini-3.1-pro`），與帶檔位slug併用且檔位不一致時agy回conflicts錯誤 |
| `skipPermissions` | Boolean | `true` | 是否帶`--dangerously-skip-permissions`旗標 |
| `printTimeout` | String | 由`timeoutMs`推導 | agy自身等待上限（如`'10m'`、`'570s'`），預設`timeoutMs`扣30秒緩衝（下限30秒），令CLI先於外層逾時而回報自身錯誤訊息 |
| `addDirs` | Array | 自動納入cwd | 加入workspace之目錄字串陣列，逐項展開為`--add-dir`。agy以自身scratch目錄為工作區而**不採子進程cwd**，故未給時自動納入有效cwd令檔案可視範圍與其他CLI一致；明示給陣列(含`[]`代表不揭露任何目錄)則完全尊重呼叫端 |
| `timeoutMs` | Integer | `300000` | 全套件統一預設(恰對齊agy自身print-timeout之5m0s) |

注意：agy之prompt走`--print`旗標而非stdin（agy介面如此），故prompt長度上限30000字元，超過回傳錯誤結果物件（不reject）。

#### Choosing CLI or API (判準):
選 `kind` 的唯一判準是**這一步需不需要「工具」**：

| 這次呼叫要做的事 | 選用 | 理由 |
| --- | --- | --- |
| 讀本機檔案、grep、執行指令、抓網頁、寫檔 | **CLI類**：`opencode`／`claude`／`codex`／`antigravity` | CLI本身是agentic harness，自帶完整工具迴圈，呼叫端什麼都不必做 |
| 摘要、分析、改寫、翻譯、產出JSON（素材皆已在prompt內） | **API類**：`api-openai-compat` | 免安裝免登入，且實測較快（Agnes：API 1~2.5s vs CLI 4~6s） |

**API類不支援工具，且不會自建工具迴圈**——實測（2026-08-11）閘道端零內建工具：Zen與Agnes對 `tools:[{type:'web_search'}]` 皆回400並要求 `function.parameters`，即只接受「呼叫端自行定義且自行執行」的function工具。協定層雖支援function calling（Zen之 `nemotron-3-ultra-free` 與Agnes皆實測回 `finish_reason:'tool_calls'`），但工具的定義、執行、錯誤處理與安全邊界全須自行實作維護，等同重造CLI已提供的harness。故模型回 `tool_calls` 時本套件一律以 `TOOL_CALLS_UNSUPPORTED` 回報失敗，不假裝成功。

另注意 `tool_calls` 有**會話束縛**（`tool_call_id` 須於同一條messages串內回填），無法暫停後跨行程外傳給上層agent代跑；工作流各名額（如 `runFanout` 的agents）也只是同行程的async函數呼叫而非獨立agent，故「讓外殼agent提供工具給工作流內的模型使用」在本架構下不成立——**需要工具就選CLI類kind**。

**混用才是常態**：同一條 `dispatchAiFallback` 鏈可逐條目混搭kind，工作流各階段亦然——產生候選與整合收斂等純文字階段走API，需要翻閱專案檔案的階段換CLI。

**先選對端點型別，再選kind**：同一個閘道的不同模型可能走不同端點，打錯端點會得到 **HTTP 500 而非 404**，極易被誤判為「模型故障」而反覆重試。以 OpenCode Zen 為例（[官方端點對照表](https://opencode.ai/docs/zh-tw/zen/)，2026-09-03 查證）：

| 端點 | 對應kind | 該端點之模型（Zen） |
| --- | --- | --- |
| `/v1/chat/completions` | `api-openai-compat` | deepseek／glm／kimi／minimax／nemotron／ling／mimo 等 |
| `/v1/responses` | `api-openai-responses` | muse-spark 系、GPT 系、Grok 系 |
| `/v1/systemone` | `api-typesafe-systemone` | jev 系（TypeSafe System One 決策模型，須給 `questions`） |
| `/v1/messages` | 本套件無（改用 `opencode` CLI kind） | Claude 系、Qwen 系 |
| `/v1/models/<id>` | 本套件無（改用 `opencode` CLI kind） | Gemini 系 |

實測佐證：`muse-spark-1.2/1.3` 走 `/chat/completions` 連續 10 次 500，同金鑰同模型改打 `/responses` 立即 200；且 1.2 於 2026-08-21 曾以 `/chat/completions` 成功——**閘道會事後改路由，「以前能用」不構成「現在該能用」**。完整診斷流程見 [src/providers.mjs](https://github.com/yuda-lyu/w-dispatch-ai/blob/master/src/providers.mjs) 檔頭。

#### Options only for dispatchApiOpenaiCompat:
| key | type | default | description |
| --- | --- | --- | --- |
| `baseURL` | String | 必填 | API基底網址，將於尾端接上`/chat/completions` |
| `model` | String | 必填 | 模型ID（Zen之模型名不帶`opencode/`前綴） |
| `key` | String | `''` | API key，以`Bearer`置於`Authorization`標頭，省略代表不帶認證 |
| `system` | String | `''` | system提示詞，置於messages首位 |
| `body` | Object | `{}` | 額外請求本體（`temperature`、`max_tokens`、`response_format`等），同名鍵覆寫預設 |
| `headers` | Object | `{}` | 額外請求標頭，同名鍵覆寫預設。**預設帶 `Accept-Encoding: identity`**：伺服器若壓縮了回應卻漏標 `Content-Encoding`，Node 內建 fetch 不會解壓，本轉接器只拿到亂碼而回 `INVALID_RESPONSE`（三個 REST 轉接器同步）。重現條件：安裝方 2026-09-24 於 Zen 長回應（約 35 秒）實測，fetch 所見標頭為 0 個、本體 9,224 bytes 為 brotli，改帶 identity 則為 22,124 bytes 之 JSON；本機同日取樣 7 次未重現，推測漏標只在特定條件（長回應）出現。要改回允許壓縮可給 `{ 'Accept-Encoding': 'gzip, deflate, br' }` |
| `timeoutMs` | Integer | `300000` | 逾時毫秒，逾時中止請求（含回應串流讀取）；全套件統一預設 |
| `maxRetries` | Integer | `0` | 失敗重試次數；**4xx(429除外)為客戶端錯誤不重試**，截斷（見`acceptTruncated`）亦不重試（同一請求必然再截斷），429/5xx/網路錯誤/逾時線性退避重試 |
| `acceptTruncated` | Boolean | `false` | **截斷預設失敗**：`finish_reason`為`length`或`content_filter`時，於`validate`之前回`errorType: 'incomplete'`（結果帶`truncated: true`，遞補層整組跳過）。`true`才放行`length`之截斷：有`validate`交其裁決、無則直接接受，結果仍標`truncated: true`；`content_filter`與可見輸出為空者一律失敗（空輸出之訊息附`reasoning_tokens`，常見於推理耗盡`max_tokens`）。`dispatchApiOpenaiResponses`同規則（`status: 'incomplete'`即截斷；`failed`不屬截斷）。**1.0.37 起行為改變**（此前截斷內容會交給`validate`判斷）：**直接呼叫`dispatchAiFallback`或轉接器、且`validate`內含搶救策略者，須自行給`acceptTruncated: true`**（`dispatchAiFallback`會原樣轉傳給轉接器）；工作流層`callAi`之預設見`salvageTruncatedArray`列 |
| `retryDelayMs` | Integer | `5000` | 重試間隔，實際為`retryDelayMs`×次數且上限15000ms |

結果結構對齊execCli：`stdout`為回覆內容、`code`為HTTP狀態碼（網路錯誤/逾時為`null`）、逾時`error`以`TIMEOUT`開頭、驗證失敗為`OUTPUT_VALIDATION_FAILED`——故可直接作為`dispatchAiFallback`條目（`kind: 'api-openai-compat'`，`keys`多金鑰輪替同樣適用）與工作流provider。

另追加`usage`欄位：原始回應之token用量物件**原樣透傳**（無則`null`；驗證失敗等已耗token之失敗亦帶出），經`dispatchAiFallback`（最終結果與`tried`歷程各項）與工作流層（`callAi`結果之`usage`欄）一路流出。CLI類轉接器無可靠來源故**無此欄**——對外提供OpenAI相容API的呼叫端可據此把「真實用量（REST路徑）」與「只能估算（CLI路徑）」分開處理。

**`errorType`機器可讀錯誤類別**（全部轉接器與`dispatchAiFallback`／`callAi`之失敗結果皆帶，成功結果無此欄；`error`字串保留不動，兩者並存）：

| errorType | 意義 | 出現於 |
| --- | --- | --- |
| `params` | 參數/設定檢核失敗（進入執行前即被擋） | 全部 |
| `timeout` | 逾時（execCli強殺或API abort） | 全部 |
| `spawn` | 子進程無法啟動（ENOENT／ENAMETOOLONG） | CLI類 |
| `validation` | stdout未過`validate` | 全部 |
| `exec` | CLI非零離開碼之一般執行失敗（未能再機械細分） | CLI類 |
| `http` | HTTP非2xx（`code`為狀態碼） | api類 |
| `fetch` | 網路層錯誤（DNS／連線拒絕） | api類 |
| `tool-unsupported` | 模型回tool_calls而api類不支援工具 | api類 |
| `invalid-response` | 回應結構不合規（缺`choices[0].message.content`、缺`output`陣列，或 systemone 缺`answers`／缺所請求題目之答案）；HTTP 200 但**本體非 JSON**時`error`另為`INVALID_RESPONSE: body is not JSON (<位元組數>, first bytes <前16位元組hex>, content-encoding=…, content-type=…)`，壓縮或損壞之本體可一眼辨識 | api類 |
| `incomplete` | 回應未完整：截斷（`finish_reason`為`length`／`content_filter`、Responses API 之`status: 'incomplete'`；結果帶`truncated: true`）或 Responses API 之其餘非完成狀態（如`failed`，`truncated: false`）。截斷判定只適用 REST 文字類；CLI 類拿不到終止訊號，截斷無從判別（已知限制） | api類 |
| `aborted` | `shouldStop`中止 | fallback層 |
| `budget` | 時間預算用盡 | fallback層 |

僅涵蓋**機械可判**者：CLI類之其餘失敗（額度上限／金鑰無效／服務端錯誤，各家字樣不同且隨版本漂移）一律歸`exec`，套件不維護簽章表（與否決金鑰停用清單同一理由）——需細分時以`coolDetect`式注入自判，或依`tried`內之`error`與`stderr`自行決策。

#### Options only for dispatchApiTypesafeSystemone:
[TypeSafe](https://typesafe.ai) 的 **jev** 是「System One」決策模型：**不產生文字**，而是對一段內容（state）回答你定義的型別化問題，每題回傳受限於你給的選項之答案與機率。官方只提供 API 與 Python／JavaScript SDK，**沒有 CLI**，故本套件只有 API 版（`kind: 'api-typesafe-systemone'`）。權威文件：[API reference](https://docs.typesafe.ai/api)。

| key | type | default | description |
| --- | --- | --- | --- |
| `questions` | Object | 必填 | 題目物件，鍵為自訂題目 id，值為下表三型之一；題型與欄位由伺服器驗證（不合規回 422） |
| `baseURL` | String | `'https://api.typesafe.ai/v1'` | 將於尾端接上`/systemone` |
| `model` | String | `'jev-latest'` | 另有`'jev-preview'`；回應之實際版本見結果之`modelResolved`（如`'jev-1.13.0'`） |
| `key` | String | `''` | API key（`.env` 慣用 `TYPESAFE_KEYS`），以`Bearer`置於`Authorization`標頭 |
| `body`／`headers` | Object | `{}` | 額外請求本體／標頭，同名鍵覆寫預設（標頭預設同 `dispatchApiOpenaiCompat` 帶 `Accept-Encoding: identity`） |
| `timeoutMs`／`validate`／`maxRetries`／`retryDelayMs` | | | 同 `dispatchApiOpenaiCompat`（4xx 除 429 外不重試） |

| 題型 `type` | `criteria` | 答案欄位 |
| --- | --- | --- |
| `noul`（是非題） | 選填 `{ true, false }` 說明是與否的意思 | `noul`：答案為「是」的機率（0～1） |
| `choice`（單選題） | 必填 `{ 選項: 描述或 null }` | `choice`、`probabilities`、`confidence` |
| `score`（有序量表） | 必填 `[層級描述, ...]`（至少 2 級） | `score`（可落在兩級之間）、`legend`、`probabilities`、`confidence` |

```alias
let r = await wdi.dispatchApiTypesafeSystemone('房間浴室水龍頭一直滴水，吵到睡不著', {
    key: typesafeKeys[0],
    questions: {
        category: {
            type: 'choice',
            instructions: '這則客房訊息屬於哪一類?',
            criteria: {
                '設備故障報修': '客人回報房間硬體設備損壞、水電問題或故障',
                '索取備品': '客人需要毛巾、牙刷、礦泉水等客房備品',
                '退房詢問': '詢問退房時間、行李寄放或延退相關事宜',
                '其他複雜對話': '閒聊、餐廳推薦或特殊客訴',
            },
        },
        urgent: { type: 'noul', instructions: '客人是否表達急迫性?' },
    },
})
console.log(r.ok, r.answers.category.choice, r.answers.category.probabilities, r.answers.urgent.noul)
// => true 設備故障報修 { '設備故障報修': 1, '索取備品': 0, '退房詢問': 0, '其他複雜對話': 0 } 0.86   (2026-09-17 實測約 1 秒；noul 為機率，每次可能差 0.01)
```

- **prompt 即 state**：結構化內容請傳 `JSON.stringify(物件)`（實測與傳物件之答案一致），題目的 `instructions` 可用 `` `ticket.messages[0].text` `` 這類路徑指向其中欄位。
- **結果**：`stdout` 為 `answers` 的 JSON 字串（遞補層與工作流層的 `parse`／`check` 可直接用），另追加 `answers`（已解析物件）與 `modelResolved`；`usage` 為 `{ input_tokens, output_tokens }` 原樣透傳。請求的題目 id 在回應中缺任何一個即回 `invalid-response`。
- **錯誤（實測）**：壞金鑰 401、未知 model 400、題型不合規 422，皆為 `errorType: 'http'`，原始本體（含 `detail`）在 `stderr`。
- **預設 `providers` 收有 `typesafe:jev-latest`（`envVar: 'TYPESAFE_KEYS'`），請以 `pick` 單獨取出**，`questions` 放呼叫層即會透傳；它不可與文字生成條目一起遞補（答案形狀不同）。全取做文字遞補時，此條因沒有 `questions` 會以 `params` 錯誤 0 毫秒失敗（每把金鑰各一次）後換下一家，不影響其他家；它刻意不放在清單末端，免得前面全敗時最終錯誤變成「questions 必填」而掩蓋真正原因：

```alias
let { providers: jev } = wdi.resolveProviders(wdi.providers, { env, pick: ['typesafe:jev-latest'] })
let r = await wdi.dispatchAiFallback(state, { providers: jev, questions })
```

- **同一個 jev 有兩條路**：TypeSafe 官方端點（`typesafe:jev-latest`，用 `TYPESAFE_KEYS`）與 OpenCode Zen 轉售（`zen:jev-1.13-free`，端點 `/zen/v1/systemone`，用 `OPENCODE_KEYS`；不帶金鑰亦可）。兩者用同一個 kind，答案一致（2026-09-22 實測同題 `choice` 相同、`noul` 差 0.01），額度池與故障域各自獨立，可互為遞補。Zen 對話型免費模型的 403 閘門**不套用**於 `/systemone`。

- **經工作流 `callAi` 呼叫時務必傳 `promptPrefix: ''`**：預設的防寫檔前綴會被當成 state 的一部分送去評估。

#### Options for dispatchAiFallback:
| key | type | default | description |
| --- | --- | --- | --- |
| `providers` | Array | 必填 | 供應商條目陣列，**順序即優先序**。條目除`id`、`keys`外即該次調用之opt，原樣透傳對應轉接器（`kind`、`model`、`exe`、`provider`、`config`、`sandbox`、`timeoutMs`等皆放條目內） |
| `providers[].id` | String | 條目索引 | 群組識別，游標以此為鍵、亦為日誌標籤；本套件不解讀其內容，命名規則見下方 |
| `providers[].keys` | Array | `[]` | 同一服務之多把API key，逐次注入輪替（`kind`為`opencode`時須同時給`provider`）；省略代表沿用CLI登入狀態 |
| `providers[].meta` | any | 無 | **保留鍵，保證永不轉傳**轉接器。條目其餘鍵一律原樣轉傳——呼叫端要在條目上掛自有資訊（分類、標籤、註記）一律放`meta`，與轉傳機制永久絕緣（頂層opt與工作流各層規格物件同此約定） |
| `budgetMs` | Integer | 不限 | 整輪遞補之時間上限，剩餘預算會壓進每次呼叫之`timeoutMs` |
| `minAttemptMs` | Integer | `20000` | 單次嘗試之最低剩餘預算，低於此值即停止並回報`budget exhausted` |
| `store` | Object | 行程內記憶體 | 狀態持久化`{get:()=>state, set:(state)=>{}}`，state含`cursors`（逐群組游標）與`cooling`（供應商冷卻時間戳，僅啟用cooldownMs時使用）；假定單行程序列調用。跨行程持久化可直接用`createFileStore`；自行實作時**務必整包原封存還**，白名單式挑欄位會在套件擴充state時靜默丟棄新欄位 |
| `cooldownMs` | Integer | `0`不啟用 | 供應商冷卻視窗：條目（限有明給id者）遭遇**限流(HTTP 429，僅api類可偵測)或逾時(TIMEOUT)**後，於視窗內之後續呼叫中被**移至鏈尾（只降序不移除）**——前面全敗時仍會被嘗試、任一次成功立即解除，故不存在把已恢復服務冰住的問題。多階段工作流可大幅省去逐階段重踩已失效供應商的成本（使用端實測107s→15s）。注意啟用時providers順序會被暫時重排，此即機制目的 |
| `coolDetect` | Function | 無 | 冷卻觸發之**注入判定**`(r)=>Boolean`，收完整失敗結果（含`stdout`、`stderr`、`code`、`error`），回傳`true`即視同冷卻觸發（內建429/TIMEOUT觸發不受影響）。CLI類限流字樣各家不同、隨版本漂移，且不一定在stderr（Claude Code之執行期失敗以result印在stdout，官方headless文件），**簽章表由觀察到字樣的呼叫端維護**，如`(r) => /FreeUsageLimitError/i.test(r.stderr \|\| '')`（注意：opencode 1.18.32 遇 Zen 免費層 429 時 `run` **不會結束**、stderr 只有 session 標頭，直到逾時才以 `TIMEOUT` 回報——內建 TIMEOUT 觸發已涵蓋；要讓字樣出現在 stderr 須於 `extraArgs` 加 `--print-logs --log-level ERROR`，2026-09-23 實測 DEBUG log 內為 `AI_APICallError: Rate limit exceeded`；不經本套件的原始 CLI 亦同）；漏判僅退回現狀（每階段重探一次）、誤判也只是降尾非移除，兩邊代價都有上限。僅`cooldownMs>0`時有效；回調拋出例外視同`false` |
| `shouldStop` | Function | 無 | 中止判定`()=>Boolean`，於**每次嘗試之間**檢查，`true`即停止遞補回報`ABORTED`——供成果已無人接收時（如server端客戶端斷線）止損，把「斷線後仍空耗整條鏈」縮成「至多再耗當前這一家」。**不中止進行中之嘗試**（不殺子進程/不斷開請求，見Known design notes）。經工作流層原樣轉傳：中止後每個後續呼叫進門即回`ABORTED`，整條工作流自然快速收束，無須逐層處理；回調拋出例外視同`false` |
| `meta` | any | 無 | 保留鍵，同`providers[].meta`，永不轉傳 |
| `onEvent` | Function | 無 | 事件回調`(ev)=>{}`，`ev.type`為`'try'`、`'ok'`、`'next-key'`、`'skip-group'`、`'budget-out'`、`'aborted'`、`'cooled'`(冷卻觸發，帶`error`與`cooldownMs`，僅啟用cooldownMs時出現)；失敗事件另帶`errorType`、`stdout`(被拒回覆)與`stderr`(錯誤輸出，皆已截斷)供診斷；回調拋出例外不影響主流程 |

頂層其餘設定（`timeoutMs`、`validate`、`maxRetries`等）為各attempt之共用預設，條目可覆寫；`maxRetries`建議維持預設`0`，韌性交給換家而非重試同一家。

**條目 `id` 之命名規則**（呼叫端負責設計，本套件只當作不透明字串使用）：

`id` 在套件內只有兩個用途——游標的物件鍵（`state.cursors[id]`）與日誌標籤（`providerId`、`keyId` = `` `${id}#${keyIndex}` ``）。不查表、不比對、無格式要求，故「什麼算同一個供應商」由呼叫端定義。

| 規則 | 說明 |
| --- | --- |
| **區分到「模型」而非只到「廠商」** | ❌ `id: 'claude'` — 日後無法同時掛 sonnet 與 opus，日誌也看不出用了哪個模型<br>✅ `id: 'claude:sonnet'`、`id: 'claude:opus'` |
| **同一模型經不同路徑時須帶路徑** | 同一個 laguna 可經 Poolside 官方 REST、OpenRouter、opencode CLI 三條路，額度池與故障域各自獨立，屬三個供應商：<br>`'poolside:laguna-s-2.1'`、`'or:poolside/laguna-s-2.1:free'`、`'oc:poolside/poolside/laguna-s-2.1'` |
| **務必給、務必唯一** | 未給時回退為**陣列索引字串**——索引是位置不是身分，日後於鏈中插入條目會令後續條目繼承他人的游標進度（輪替張冠李戴）。兩個條目同 `id` 則共用同一游標且日誌無法區分。 |

**同一組金鑰用於多個條目時**（例如某模型的 CLI 版與 REST 版共用同一批金鑰），各條目游標**獨立**：兩者各自從游標起點輪替，同一把金鑰可能被連續使用而另一把閒置。要共享輪替進度就給**相同** `id`（代價：日誌無法區分兩者）；要能區分就分開命名（代價：額度不均攤）。此取捨由呼叫端依實際需求決定。

**失敗分流規則**：
| 失敗 | 判定 | 處置 |
| --- | --- | --- |
| 逾時 | `error`以`TIMEOUT`開頭 | 整組跳過 |
| 執行檔不存在 | `error`含`ENOENT` | 整組跳過 |
| 參數錯誤 | `code === 2` | 整組跳過 |
| 輸出未過驗證 | `error === 'OUTPUT_VALIDATION_FAILED'` | 整組跳過 |
| 截斷（REST 文字類） | `truncated === true` | 整組跳過（同模型同請求換金鑰必然再截斷；`status: 'failed'`不屬此列，照「其餘」換下一把） |
| 模型回工具呼叫而 api 類不支援 | `error`以`TOOL_CALLS_UNSUPPORTED`開頭 | 整組跳過 |
| HTTP 200 但本體非 JSON（api 類） | `error`以`INVALID_RESPONSE: body is not JSON`開頭 | 整組跳過（傳輸或閘道狀態；「JSON 缺欄位」不在此列，照「其餘」換下一把） |
| kind無效 | `error`以`unknown ai kind`開頭 | 整組跳過 |
| 其餘（含額度上限、金鑰無效、服務回錯） | — | 換組內下一把 |

整組跳過的理由：同組各金鑰共用同一`exe`與`model`，這些失敗換金鑰必然再敗，逐把嘗試純屬空耗。其餘失敗一律換下一把、**不記憶不停用**——額度視窗形態多樣（5小時滾動、逐時、逐日），停用清單會把已恢復的金鑰閒置，而重探的代價僅一次快速失敗；跨次執行僅記憶游標（成功後推進，令額度在多把金鑰間均攤）。

#### Result of dispatch functions:
```alias
//成功
{
    ok: true,
    stdout: '完成\r\n',
    stderr: '\x1b[0m\r\n> build · muse-spark-1.3-contributor-free\r\n\x1b[0m\r\n',
    code: 0,
    error: '',
    durationMs: 11742,
    pid: 9800,
    attempts: 1,
}

//CLI執行失敗, 本套件各函數皆不reject
{
    ok: false,
    stdout: '',
    stderr: '\x1b[0m\r\n> build · muse-spark-1.3-contributor-free\r\n\x1b[0m\r\n\x1b[91m\x1b[1mError: \x1b[0mInvalid API key.\r\n',
    code: 1,
    error: 'Exit code 1',
    durationMs: 3049,
    pid: 15208,
    attempts: 1,
}

//參數檢核失敗, 未實際啟動子進程故無pid
{
    ok: false,
    stdout: '',
    stderr: '',
    code: null,
    error: 'prompt must be a non-empty string',
    durationMs: 0,
    attempts: 0,
}
```

#### Result of dispatchAiFallback:
於execCli既有欄位外追加：
```alias
{
    // ...ok, stdout, stderr, code, error, durationMs, attempts, pid...
    providerId: 'agnes:agnes-2.0-flash',  //實際使用之群組(即條目id)
    keyIndex: 1,                        //實際使用之金鑰索引, 無keys時為null
    kind: 'api-openai-compat',
    model: 'agnes-2.0-flash',
    tried: [                   //完整嘗試歷程, 成功時亦回傳; 失敗項另含stdout(被拒回覆)與stderr(錯誤輸出, 皆已截斷)供診斷; REST文字類各項另帶truncated與finishReason
        { providerId: 'agnes:agnes-2.0-flash', keyIndex: 0, keyId: 'agnes:agnes-2.0-flash#0', outcome: 'next-key', error: 'HTTP 401', durationMs: 105 },
        { providerId: 'agnes:agnes-2.0-flash', keyIndex: 1, keyId: 'agnes:agnes-2.0-flash#1', outcome: 'ok', durationMs: 1161 },
    ],
}
```

**全數失敗時，頂層`error`／`errorType`只反映「最後一次」嘗試**：多把金鑰或多家依序失敗時（例如第一把本體非 JSON、第二把以剩餘預算重打而逾時），只記最終錯誤會誤判歸因。記日誌或評比時請一併記下各次嘗試，例如`` r.tried.filter((t) => t.outcome !== 'ok').map((t) => `${t.keyId}:${t.errorType}`) ``。

#### dispatchAiWkf (workflow factory):
注入一次provider定義表(名稱 → `dispatchAiFallback`條目)與共用預設，之後以名稱宣告工作流；名稱查無定義即回報錯誤(fail fast)。回覆經寬鬆JSON解析(`extractJsonLoose`)＋自訂`check`驗證，非法回覆視為該家失敗而自動遞補；預設於prompt前掛「禁止建檔」約束(`promptPrefix: ''`可關閉)；措辭豁免唯讀查閱——codex以shell讀檔，一律禁指令會令其無法讀取專案檔案且靜默回拒答(2026-08-13實測)。

```alias
let wkf = wdi.dispatchAiWkf({
    providers: {
        'agnes:agnes-3.0-flash': { kind: 'api-openai-compat', baseURL: 'https://apihub.agnes-ai.com/v1', model: 'agnes-3.0-flash', keys: [...] },
        'claude:sonnet': { kind: 'claude', model: 'sonnet' },
        'codex:gpt-5.6-luna': { kind: 'codex', model: 'gpt-5.6-luna' },
    },
    defaults: { timeoutMs: 300000 },
})

//單一名額: 主模型＋自帶遞補鏈
let r1 = await wkf.callAi('...prompt...', { spec: { use: 'agnes:agnes-3.0-flash', fallback: ['claude:sonnet'] }, check: (j) => !!j.essence })

//Fanout: 並行多開執行 → 單點整合收斂(候選未達minCandidates時以首位候選為成果不硬整合)
//check為共用預設; 名額規格與integrate可各自帶check(候選與終稿判準常不同, 如終稿須含固定段落)
let r2 = await wkf.runFanout({ task, agents: [{ use: 'agnes:agnes-3.0-flash', fallback: ['claude:sonnet'] }, { use: 'claude:sonnet' }], integrate: { use: 'codex:gpt-5.6-luna' }, check })

//RolePipeline: 多角色串行鏈, 各階段可自帶AI/遞補/檢核, prompt收ctx={input,prev,results,index}
let r3 = await wkf.runRolePipeline({ input, stages: [{ id: 'draft', use: 'claude:sonnet', prompt: (ctx) => `...` }, { id: 'audit', use: 'codex:gpt-5.6-luna', prompt: (ctx) => `...${JSON.stringify(ctx.prev)}` }] })

//FanoutPipeline: Fanout成果接RolePipeline(品質天花板組合)
let r4 = await wkf.runFanoutPipeline({ task, agents, integrate, stages, check })
```

各工作流皆部分接受：個別名額/階段失敗不炸整輪，已完成成果完整回傳(`candidates`／`results`＋`failedStage`)，可只重跑失敗段。

#### Timeout 總覽（各層預設、行為與調整方式）:

**一句話**：全套件單一預設 **`300000`（5分鐘，單一來源 [src/dfTimeoutMs.mjs](https://github.com/yuda-lyu/w-dispatch-ai/blob/master/src/dfTimeoutMs.mjs)）**——不論直接呼叫轉接器、或經 `dispatchAiFallback`／工作流，「單次AI嘗試」的逾時都是它；工作流本身**沒有**獨立的總時限參數（總時長＝結構×單次，見下方公式）。

**階梯結構**（由細至粗，數值須嚴格遞增）：

```alias
agy --print-timeout（自動＝timeoutMs−30s）
  < timeoutMs（單次嘗試，統一預設300000）
    < budgetMs（單一名額之遞補鏈總預算，預設null不限）
      < 工作流總時長（無獨立參數，由結構推導）
```

**各參數一覽**：

| 參數 | 作用範圍 | 預設 | 逾時後果／備註 |
| --- | --- | --- | --- |
| `timeoutMs` | **單次AI嘗試**，所有kind一致（直接呼叫與工作流內皆同一數字） | `300000` | CLI強殺子進程樹／API中止請求；`error`以`TIMEOUT`開頭 → fallback視為**與金鑰無關**，整組跳過（不逐把空耗） |
| `printTimeout` | 僅antigravity，agy自身等待上限 | 自動＝timeoutMs−30s | 令CLI先於外層逾時，錯誤訊息來自agy自身；一般無須手動設 |
| `budgetMs` | `dispatchAiFallback`整輪遞補（＝工作流的一個名額／階段） | `null`不限 | 有值時剩餘預算會壓進每次嘗試的timeoutMs；用盡回`budget exhausted` |
| `minAttemptMs` | 搭配budgetMs的開工門檻 | `20000` | 剩餘預算低於此值即不再開工；**無budgetMs時不作用** |
| 工作流總時長 | `runFanout`／`runRolePipeline`／`runFanoutPipeline` | 無（刻意） | 由結構推導，要上限就設各名額的`budgetMs` |

**工作流總時長公式**（每次嘗試≤timeoutMs；K＝遞補鏈組數、M＝階段數）：

| 工作流 | 正常情況 | 最壞情況（多家連環卡死） |
| --- | --- | --- |
| `callAi`單一名額 | 首家耗時 | K×timeoutMs（逾時型失敗每組只燒一次即跳組；額度型失敗為秒級） |
| `runFanout` | 最慢名額＋整合名額（agents**並行**） | ≈2×K×timeoutMs |
| `runRolePipeline` | Σ各階段（**序列**） | ≈M×K×timeoutMs |
| `runFanoutPipeline` | 上兩者相加 | ≈(2+M)×K×timeoutMs |

量級感受：內建providers 9條全上陣時，一個名額最壞9×300s＝45min；3階段RolePipeline最壞約2.25小時（正常情況為秒級~分鐘級，最壞只在多家連環卡死時發生）。

**外部調整四層**（細者覆蓋粗者，全部免改套件程式）：
1. **全域**：`dispatchAiWkf({ defaults: { timeoutMs, budgetMs, minAttemptMs } })`
2. **單工作流**：`runFanout({ callOpt: { timeoutMs... } })`
3. **單階段／名額**：stage／agent 規格上直接給 `timeoutMs`／`budgetMs`
4. **單條目**：provider 條目給 `timeoutMs`（如已知會卡死之供應商給小蓋子，卡死成本從名額預算縮為該蓋子）

**三種常用設定**：

```alias
//1. 簡單任務(秒級~分鐘級): 什麼都不用設, 全走統一預設300000

//2. 要給工作流總上限: 設每名額budgetMs(序列工作流總上限≈Σ各階段budget; fanout≈名額+整合)
let wkf = wdi.dispatchAiWkf({ providers: table, defaults: {
    budgetMs: 900000,    //每名額至多15min → 3階段RolePipeline總上限≈45min
    minAttemptMs: 60000, //剩餘不足1min就不再開工
} })

//3. 複雜任務(單一AI工作約15min, fallback須能走到最末):
let wkf2 = wdi.dispatchAiWkf({ providers: table, defaults: {
    timeoutMs: 1200000,    //20min＝15min工作＋33%餘裕(太緊會殺掉合法執行)
    minAttemptMs: 1200000, //剩餘不足完整視窗即不開工——開了也不可能完成, 純浪費
    budgetMs: 4800000,     //鏈長K×timeoutMs(K=4→80min): 逾時每組只燒一次即跳組, 故保證走得到最末; 無外部時限可null
} })
```

#### providers.mjs(內建供應商定義檔):
[src/providers.mjs](https://github.com/yuda-lyu/w-dispatch-ai/blob/master/src/providers.mjs) 收錄各供應商條目(CLI版與REST版)，金鑰以 `envVar` 間接引用(機密只放 `.env`)，經 `resolveProviders` 展開後即可直接使用或以 `pick` 自選。

**zen免費模型清單為「更新日快照」**：`zen:` 系起於 2026-08-21 經 `GET /zen/v1/models` 查得之免費模型(`*-free`)，其後依實測增刪（最近一次 2026-09-24）；因 2026-09-17 起之 Zen 免費層閘門擋下多數對話型免費模型之 REST 直呼，`zen:` 現僅收 REST 實測可通者（`zen:jev-1.13-free`、`zen:space-bunny-free`），其餘免費模型改收 `oc:` 版，增刪經過見 providers.mjs 檔頭之漂移紀錄。不做好用篩選——新模型會上線、舊模型可能下架或限流，**不保證清單即為當前最新可用狀態**；且各模型能力/速度/輸出習慣差異極大（各條目註解記錄已測特性，如批次涵蓋率、實測耗時），由呼叫端自行評估選用。暫時打不通的條目依本套件哲學保留不移除：恢復的偵測就是下次再打一次，`fallback`/`cooldownMs` 即為此而生。

```alias
import wdi from 'w-dispatch-ai'

//金鑰放.env(OPENCODE_KEYS/AGNES_KEYS/POOLSIDE_KEYS, 逗號分隔多把), 以readEnvFile讀成物件——
//不用process.loadEnvFile: 那會把金鑰塞進process.env, 多專案並行時互相覆蓋
let env = wdi.readEnvFile('./.env')

//全取: envVar → keys, 缺環境變數之條目自動停用並列入skipped
let { providers, table, skipped } = wdi.resolveProviders(wdi.providers, { env })

//自選: pick順序即遞補優先序; providers餵dispatchAiFallback, table餵dispatchAiWkf
let picked = wdi.resolveProviders(wdi.providers, { env, pick: ['agnes:agnes-3.0-flash', 'claude:sonnet'] })
let r = await wdi.dispatchAiFallback(prompt, { providers: picked.providers, timeoutMs: 1200000 })
let wkf = wdi.dispatchAiWkf({ providers: picked.table, defaults: { timeoutMs: 1200000 } })

//後處理(選用): exes逐kind注入CLI執行檔絕對路徑(Windows排程session 0之PATH常缺npm全域目錄),
//patch逐id淺合併覆寫任意欄位; 兩者於函數內施作, providers與table同源產出必然一致
let p2 = wdi.resolveProviders(wdi.providers, {
    env,
    pick: ['claude:sonnet', 'codex:gpt-5.6-luna'],
    exes: { claude: 'C:/Users/x/.local/bin/claude.exe' },
    patch: { 'claude:sonnet': { timeoutMs: 360000 } },
})

//pick打錯字時missing附拼寫提示hints(最接近之可用id), 可直接組出可定位的錯誤訊息
let pm = wdi.resolveProviders(wdi.providers, { env, pick: ['poolside/laguna-s-2.1'] })
if (pm.missing.length > 0) {
    throw new Error(`unknown provider id(s): ${pm.missing.map((id) => `${id} (did you mean ${pm.hints[id]}?)`).join(', ')}`)
}
```

**自帶條目（新模型上線快於套件發版時）**：`resolveProviders` 第一參數就是普通條目陣列，安裝端把自訂條目**合併進輸入**再傳入即可，同 id 時以自訂者覆蓋內建：

```alias
let extra = [{ id: 'zen:some-new-model-free', model: 'some-new-model-free', kind: 'api-openai-compat', envVar: 'OPENCODE_KEYS', baseURL: 'https://opencode.ai/zen/v1', body: { max_tokens: 8192 } }]
let merged = [...wdi.providers.filter((p) => !extra.some((e) => e.id === p.id)), ...extra]
let resolved = wdi.resolveProviders(merged, { env, pick: [...] })
```

**推理模型請放寬 `body.max_tokens`**：推理模型的 `max_tokens` 含推理 token（2026-09-24 實測 `space-bunny-free` 列 10 個縣市一題即用 5222，其中推理 4849），照抄上例之 8192 容易截斷；截斷預設判失敗換家（`errorType: 'incomplete'`，見`acceptTruncated`），截斷頻繁等於白白換家；內建之 `zen:space-bunny-free` 即用 32768。

**警語：動「輸入」、不要動「回傳」**——把條目 push 進回傳的 `providers` 陣列不會同步進 `table`，兩者當場分歧；合併輸入再呼叫則兩種輸出同源產出、必然一致。另同 id 重複條目屬設定錯誤（共用游標、日誌無法區分），合併時務必如上例先濾再接。

**配套工具**（皆為選用，深層引入或由聚合物件取用）：

| 工具 | 用途 |
| --- | --- |
| `createFileStore({ dir })` | `dispatchAiFallback`之`store`的檔案持久化——排程任務每次執行都是新行程，記憶體游標/冷卻每次歸零；本實作採**排除式passthrough**（state原封存還，僅剔自用欄位`at`），日後套件擴充state欄位自動相容（殷鑑：白名單store曾把1.0.7新增的`cooling`靜默丟棄） |
| `createUsageCounter({ dir })` | 逐日逐鍵用量計帳，`onEvent`直接掛進dispatch即於`try`事件記帳；**純觀測絕不據以節流**（額度視窗形態多樣，臆測門檻擋自己的呼叫等同拿猜測當事實）；排程環境務必注入`getDate`錨定時區 |
| `budgetFor(chain)` | 遞補鏈走滿全鏈之時間預算（Σ各條目`timeoutMs`，未帶者以統一預設300000計）；與外部排程硬上限取小者交`budgetMs` |
| `salvageTruncatedArray(text)` | 截斷JSON陣列之前段搶救（救回的每個元素皆完整合法）；**不併入預設解析**——「判失敗換家重產」與「搶救前段部分接受」是同一問題的兩種合法策略，組成自訂`parse`注入即可。REST 文字類截斷預設失敗，但工作流`callAi`之`acceptTruncated`預設為「有自訂`parse`且非`rawText`」，故注入自訂`parse`即同意接受截斷內容、既有用法不必改；結果之`truncated: true`可辨識救回的是半批；**直接呼叫`dispatchAiFallback`或轉接器、把搶救寫在`validate`裡者，須自行給`acceptTruncated: true`**（1.0.37 起，否則截斷在`validate`之前即判失敗）。限制：只救頂層元素為物件之陣列，從第一個`[`起算（外包物件如`{"items":[…`會救回內層陣列、前言含`[`會失效） |
| `NO_SIDE_EFFECT` | 防副作用prompt前綴之單一來源（措辭含唯讀查閱豁免——codex以shell讀檔，一律禁指令等同禁讀檔）；工作流`callAi`預設自動掛上，直呼`dispatchAiFallback`者自行前綴 |

#### 訂閱額度查詢(quota)：`getQuotaClaude`／`getQuotaCodex`／`getQuotaAntigravity`

查詢**本機各 CLI 當前登入帳號**之訂閱額度窗口（5 小時／7 天／模型別 7 天等），三家回傳統一結構。所在目錄 `src/quota/`，深層引入 `w-dispatch-ai/src/quota/getQuotaClaude.mjs` 或由聚合物件取用。

```alias
import wdi from 'w-dispatch-ai'

let r = await wdi.getQuotaClaude('me@example.com') //給email即「比對」本機登入帳號; 給''則不比對直接回報
console.log(r.ok, r.matched, r.email, r.plan)
r.windows.forEach((w) => console.log(w.key, w.label, w.usedPercent, w.remainingPercent, w.resetAt, w.active, w.severity))
// session 5小時 3 97 2026-... false normal
// weekly_all 7天 13 87 2026-... false normal
// weekly_scoped 7天(Fable) 15 85 2026-... true normal   ← 帶模型別、實際會先觸頂的窗口

let c = await wdi.getQuotaCodex()        // source: 'codex-app-server'(主) 或 'chatgpt-wham-usage-api'(備援)
let a = await wdi.getQuotaAntigravity()  // source: 'agy-print-usage'; windows之scope為群組名(Gemini Models / Claude and GPT models)
```

**email 的真實角色是「比對」不是「查詢」**：三家額度皆綁定本機該 CLI 當前登入之憑證，沒有任何一家提供「給 email 查任意帳號」的公開介面（那會是帳號列舉漏洞）。故 `email` 參數用來核對本機實際登入者——一機多帳號時（實測本機 claude／codex／agy 分屬不同 gmail）不核對就會把甲帳號的額度當成乙的。不符時 `ok:false`、`matched:false`、`errorType:'account'`，但額度資料**仍回傳**（已取得，丟棄只是浪費）。

**結果結構**：`{ ok, provider, email, matched, plan, planTier, source, windows[], credits, raw, error, errorType, durationMs }`；每個窗口 `{ key, label, windowSeconds, usedPercent, remainingPercent, resetAt(ISO), resetAfterSeconds, scope, active, severity }`。`severity` 供應商有給即用，未給則由 `usedPercent` 推導（用罄 `exhausted`／其餘 `normal`）。

**`key` 是各家原生識別、刻意不統一；跨家比較用 `windowSeconds` 配 `scope`**。統一的是信封（上列欄位）——三家原始欄位確實互異（Claude 給已用 % `utilization`＋ISO `resets_at`；Codex 給 `usedPercent`＋unix 秒 `resetsAt`＋`windowDurationMins`；agy 給**剩餘**比例 `remaining_fraction`＋ISO `reset_time`），全部正規化為 `usedPercent`／`resetAt`／`resetAfterSeconds`／`windowSeconds`。但 `key` 原樣透傳各家自己的窗口識別：

| 供應商 | `key` 值 | 來源 |
| --- | --- | --- |
| Claude | `session`／`weekly_all`／`weekly_scoped` | Anthropic `limits[].kind` 原值（回退舊欄位時為 `five_hour`／`seven_day_opus` 等欄位名） |
| Codex | `primary`／`secondary`；巢狀限額為 `code_review:primary`、`<limitId>:primary` | app-server `rateLimits.primary`／`.secondary` 物件名；巢狀者由套件組唯一鍵 |
| agy | `gemini-5h`／`gemini-weekly`／`3p-5h`／`3p-weekly` | agy `buckets[].id` 原值 |

保留原生值可回溯 `raw`，也不必為求一致把 agy 的 4 桶 2 群組硬壓成 2 個。要「跨家找 5 小時窗口」請用 `windowSeconds === 18000`（7 天為 `604800`）配 `scope`，**不要比對 `key` 字串**。

**errorType（quota 專用詞彙，與轉接器之 errorType 分開）**：`params`／`notfound`（憑證或執行檔不存在、未登入）／`unsupported`（API key 或雲端模式無訂閱額度、agy 版本過舊）／`auth`（權杖被拒）／`forbidden`／`ratelimit`（查詢端點自身之 429，非訂閱額度用罄）／`http`／`parse`／`timeout`／`network`／`toolarge`／`account`（帳號不符）／`exit`／`rpc`。

| 設計要點 | 說明 |
| --- | --- |
| **唯讀憑證，刻意不刷新權杖** | Anthropic 的 refresh token 每次使用即輪替並作廢前一枚；監控程式若自行刷新而不寫回，Claude Code 存檔的權杖立即失效、使用者被迫重登；寫回則與 Claude Code 競爭同一檔。故 401 時的正確指引是「執行一次 claude 讓它自行刷新」，**不需重新登入**（存檔的 refresh token 仍有效，本機實測期限約登入後 30 天，只是要由 Claude Code 去用它）——錯誤訊息已內建此指引 |
| **codex 主路徑走第一方協定** | `codex app-server --stdio` JSON-RPC（認證、刷新、多帳號全由 codex 自理，本套件不碰 token），失敗才退回 chatgpt.com 之內部端點（欄位可能變動，對映邏輯獨立於 `fromCodexUsageHttp` 以便離線 fixture 驗證） |
| **agy 版本閘門** | 1.1.11 之前 `-p "/usage"` 會被當一般 prompt 起一個 agent turn（耗額度、留對話），故先以 `agy --version` 把關，過舊回 `unsupported` 而不冒險執行；另有 num_turns>0 之事後防呆 |
| **機密不入 log** | HTTP 錯誤訊息中之權杖與帳號 ID 一律先遮蔽（`[REDACTED]`）再截短；回應本文有 1MB 上限防異常頁撐爆 |
| **可測性／可注入** | `opt.env`（隔離本機環境變數）、`opt.usageUrl`／`opt.profileUrl`（指向假伺服器或企業代理）、`opt.configDir`／`opt.codexHome`（僅 codex 備援路徑用，app-server 主路徑之子進程繼承本進程的 `CODEX_HOME`）／`opt.exe`；額度查詢之預設逾時為 20 秒（`dfQuotaTimeoutMs`，與 agent 推論之 300 秒分開），agy 因啟動較慢預設 60 秒 |
| **需 wsemi ≥ 1.8.85** | codex 主路徑依賴其 `execCliJsonRpc`（stdio JSON-RPC 會話管理） |

**內建CLI條目之防寫機制對照**（內建清單定位為唯讀調用，各家CLI條目皆自帶機械防寫；需要寫入能力時於條目或呼叫時覆寫該欄位即可。api類為純文字生成天然無寫檔能力，不在此列）：

| kind | 條目防寫欄位 | 機制 | 實測依據 |
| --- | --- | --- | --- |
| `opencode` | `config.permission: { edit: 'deny', bash: 'ask' }` | `edit` deny 涵蓋 write/edit/patch；`bash` 用 `ask` 而非 `deny`——`opencode run` 為非互動，`ask` 一律自動拒絕（stderr：`The user rejected permission`）。**不可改成 `bash: 'deny'`**：Zen 免費層閘門以「工具清單含不含 bash」判定是否為 opencode 本體，deny 會被判非 opencode 而回 403 FreeTierError；呼叫端也勿另傳 `--auto`（2026-09-23 實測：帶上即自動核准 bash，模型以 node 寫檔落地） | 2026-09-18 金絲雀實測（寫檔與 shell 建檔皆未落地）；2026-09-23 於 1.18.32 重驗仍自動拒絕 |
| `claude` | `extraArgs: ['--tools', 'Read,Glob,Grep', '--strict-mcp-config']` | **白名單**：只開放讀檔三工具，並排除所有 MCP 工具。原本的黑名單 `--disallowedTools Write,Edit,NotebookEdit,Bash` **已失效**：Windows 版 Claude Code 另有 `PowerShell` 工具不在黑名單內，模型改用它寫檔；工具清單另含 Workflow、Cron、SendMessage 等及 claude.ai 連接器之 MCP 寫入工具。只用 `--tools` 不夠，MCP 工具須再加 `--strict-mcp-config` 才會排除。代價是沒有 WebFetch／WebSearch，需要時於條目覆寫。**邊界**：此鎖只管模型可用之工具；資料夾未受信任時 `-p` 仍會執行該專案 `.claude/settings.json` 的 hooks 與 `env`（官方 permissions 文件列為「Used」），在不信任的目錄派工可於條目另加 `--setting-sources user`（2026-09-23 實測可與本鎖及 skip 並用） | 2026-09-23 金絲雀實測（Claude Code 2.1.280：黑名單下 opus-5.5 與 sonnet 皆經 PowerShell 寫檔落地；白名單下工具清單恰為 Glob/Grep/Read、寫檔未落地、讀檔正常） |
| `codex` | `sandbox: 'read-only'` | Codex沙箱唯讀模式 | 2026-08-26 於 Codex 0.149.0 實測可執行唯讀命令；前提是 Windows elevated 沙箱之一次性設定已完成，否則所有命令 `blocked by policy`（診斷見「Options only for dispatchCodex」） |
| `antigravity` | `skipPermissions: false` | 保留agy權限閘門（不送`--dangerously-skip-permissions`） | 2026-08-15 canary實測：無此鎖時要求建檔**會真的落地**；`false`之下寫入被擋且**不卡逾時**（6.4s正常返回）、唯讀工具照常 |

注意agy被權限閘門擋下寫入時回`ok: true`且**stdout為空**（靜默拒絕非報錯）：工作流層無害（空回覆過不了validate而自動遞補），但直接呼叫`dispatchAntigravity`者須以「空輸出」判別被擋，不能只看`ok`。另提示詞層的`NO_SIDE_EFFECT`前綴是「請求」不是「強制」，機械防寫以上表欄位為準。

#### Known design notes:
- `package.json`**刻意不設**`exports`欄位：wsemi與w-*系列皆為自有套件，呼叫端以按需深層引入(`w-dispatch-ai/src/xxx.mjs`)為既定路線；增設exports會封死此路徑，勿加。
- `dispatchAi(kind, prompt, opt)`會把整個`opt`原樣轉傳對應轉接器，該轉接器用不到的鍵（例如輪替條目物件內的`kind`）會被忽略，故「供應商條目物件直接當`opt`」是預期用法；`dispatchAiFallback`之providers條目沿用同一約定。
- `dispatchAiFallback`為單向單輪：全數群組試畢即回傳最後一筆失敗結果與`tried`歷程，不回頭重試已敗的組。跨次執行僅記憶游標，不設金鑰停用清單（理由見上方失敗分流說明）；需跨次跳過特定金鑰時，由呼叫端依`tried`／`onEvent`內之`error`與`stderr`自行決策。
- `shouldStop`**只在嘗試邊界檢查，不中止進行中之嘗試**（不殺子進程、不斷開HTTP請求）：進行中嘗試之強制中止需侵入execCli層與各轉接器，屬已知設計取捨——最小版已把斷線後的損失從「整條鏈」縮成「至多再耗當前這一家」；如有實測場景證明不足再議完整版。
- CLI類限流簽章**不進套件**：各家字樣（stdout或stderr）不同且隨CLI版本漂移，套件維護簽章表等同養一個自己驗證不了的分類器（與否決金鑰停用清單同一理由）。偵測經`coolDetect`依賴注入，由觀察到字樣的呼叫端維護。
- `dispatchOpencode`之`key`與`provider`須同時給予才會注入金鑰；只給其一（或範例中`.env`缺鍵導致`key`為`undefined`）時不會報錯，而是靜默沿用CLI既有登入狀態。
- 範例中之`process.loadEnvFile`需Node.js >= 20.12，僅範例使用，套件本身無此限制。
- `config`以`OPENCODE_CONFIG_CONTENT`注入後，與使用者既有`opencode.jsonc`為覆蓋或合併關係未經實測確認；建議`config`內含該次調用所需之完整provider定義，不依賴與既有設定檔之合併行為。
