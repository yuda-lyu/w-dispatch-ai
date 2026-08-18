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
- `dispatchApiOpenaiCompat` needs **no cli and no login**: it calls any OpenAI-compatible endpoint directly by fetch. Known-working gateways (verified 2026-08-11): [OpenCode Zen](https://opencode.ai/docs/zen) `https://opencode.ai/zen/v1` (same `sk-...` keys as opencode cli, model names without the `opencode/` prefix, e.g. `deepseek-v4-flash-free`) and Agnes `https://apihub.agnes-ai.com/v1` (model `agnes-2.0-flash`). Note claude/codex use subscription login state, not api keys, so they cannot be called this way.
- Each cli adapter also accepts an `exe` option to pin the executable path, useful when the CLI is not in PATH (e.g. Windows Task Scheduler environments).
- For the other three adapters the prompt is always passed through stdin, never as a positional argument, so a prompt of tens of thousands of characters will not cause `ENAMETOOLONG`.
- All functions never reject. Success or failure is reported by the `ok` and `error` fields of the result object.
- **Security**: `dispatchClaude` passes `--dangerously-skip-permissions` by default, so the non-interactive `-p` mode will not hang on permission prompts. If the prompt embeds untrusted content (e.g. a web page to summarize), instructions inside that content would also run without the permission gate. Pass `skipPermissions: false` to keep the CLI permission gate.

#### Functions:
| function | description |
| --- | --- |
| `dispatchAi(kind, prompt, opt)` | dispatch to the adapter of `kind`, one of `'opencode'`、`'claude'`、`'codex'`、`'antigravity'`、`'api-openai-compat'` |
| `dispatchAiFallback(prompt, opt)` | call ai with an ordered provider list, auto rotating keys within a group and falling back to the next group |
| `dispatchAiWkf(opt)` | workflow factory: inject a named provider table once, returns bound `callAi`／`runFanout`／`runRolePipeline`／`runFanoutPipeline` |
| `dispatchOpencode(prompt, opt)` | call an ai model by opencode cli, supports per-call api key and provider config |
| `dispatchClaude(prompt, opt)` | call a claude model by claude code cli |
| `dispatchCodex(prompt, opt)` | call a gpt model by openai codex cli |
| `dispatchAntigravity(prompt, opt)` | call an ai model by google antigravity cli (`agy`), a multi-model gateway (gemini, claude, gpt-oss) |
| `dispatchApiOpenaiCompat(prompt, opt)` | call an ai model by direct fetch to any OpenAI-compatible API (`baseURL`+`key`+`model`), no cli and no login required |
| `providers` | curated provider entries verified by real tests (cli and rest paths), pick or use all via `resolveProviders` |
| `resolveProviders(providers, opt)` | expand `envVar` → `keys` from env (comma-separated, missing vars auto-skipped), supports `pick` subset by id, `exes` per-kind exe injection and `patch` per-id field override |
| `readEnvFile(file)` | read a `.env` file into a plain object for `resolveProviders`'s `opt.env`, without polluting `process.env` |
| `budgetFor(providers)` | derive the time budget to walk a whole fallback chain (sum of per-entry `timeoutMs`, defaults applied) |
| `createFileStore(opt)` | file-persisted `store` for `dispatchAiFallback` (cursors and cooling survive across processes), exclusion-style passthrough |
| `createUsageCounter(opt)` | per-day per-key usage counter fed by `onEvent` (observation only, never throttles) |
| `salvageTruncatedArray(text)` | salvage the complete leading elements of a truncated JSON array (opt-in, not part of default parsing) |
| `NO_SIDE_EFFECT` | the no-side-effect prompt prefix (single source), auto-applied by workflow `callAi`, prepend manually for direct `dispatchAiFallback` calls |
| `KINDS` | array of available kinds, `['opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat']` |

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-dispatch-ai/blob/master/g.mjs)]
```alias
import wdi from 'w-dispatch-ai'


//由.env載入金鑰, OPENCODE_KEYS與AGNES_KEYS各以逗號分隔多把, 未提供時沿用各CLI既有登入狀態
try {
    process.loadEnvFile('./.env')
}
catch {}
let opencodeKeys = (process.env.OPENCODE_KEYS || '').split(',').filter(Boolean)
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
    // => KINDS: [ 'opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat' ]

    let prompt = '請只回覆兩個字：完成，不要有任何其他文字'

    //以Claude Code CLI呼叫, 沿用CLI既有登入狀態
    let r1 = await wdi.dispatchClaude(prompt, { model: 'sonnet' })
    console.log('claude:', r1.ok, r1.stdout.trim())
    // => claude: true 完成

    //以Codex CLI呼叫, 可指定沙箱模式
    let r2 = await wdi.dispatchCodex(prompt, { model: 'gpt-5.6-luna', sandbox: 'read-only' })
    console.log('codex:', r2.ok, r2.stdout.trim())
    // => codex: true 完成

    //以opencode CLI呼叫, 未給key與provider即沿用CLI既有登入狀態
    let r3 = await wdi.dispatchOpencode(prompt, { model: 'opencode/deepseek-v4-flash-free', timeoutMs: 180000 })
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
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[0], timeoutMs: 180000 },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[1], timeoutMs: 180000 },
        { kind: 'opencode', model: 'agnes-ai/agnes-2.0-flash', provider: 'agnes-ai', key: agnesKeys[0], config: configAgnes, timeoutMs: 180000 },
        { kind: 'antigravity', model: 'gemini-3.6-flash-low' },
    ]
    for (let item of items) {
        let r = await wdi.dispatchAi(item.kind, prompt, item)
        console.log('dispatchAi ' + item.model + ':', r.ok, r.stdout.trim())
        // => dispatchAi sonnet: true 完成
        // => dispatchAi gpt-5.6-luna: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi agnes-ai/agnes-2.0-flash: true 完成
        // => dispatchAi gemini-3.6-flash-low: true 完成
    }

    //未知供應商回傳error結果物件, 不會reject
    let r4 = await wdi.dispatchAi('gemini', prompt)
    console.log('invalid kind:', r4.ok, r4.error)
    // => invalid kind: false unknown ai kind: "gemini" (available: opencode, claude, codex, antigravity, api-openai-compat)

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

#### Options shared by all dispatch functions:
| key | type | default | description |
| --- | --- | --- | --- |
| `exe` | String | 各CLI名稱 | 執行檔名稱或絕對路徑，給予名稱時由系統`PATH`解析 |
| `model` | String | `''` | 模型ID，未給予則不帶模型旗標，由CLI自行決定 |
| `extraArgs` | Array | `[]` | 額外命令列旗標字串陣列，接於固定旗標之後 |
| `timeoutMs` | Integer | `300000` | 逾時毫秒，逾時將強制關閉子進程及其子孫程序；**全套件統一預設**(所有轉接器與各層一致，單一來源`dfTimeoutMs.mjs`)，由opt傳入即可覆寫 |
| `cwd` | String | `process.cwd()` | 子進程工作目錄 |
| `validate` | String\|Function | `undefined` | `stdout`驗證規則，可用`'nonempty'`、`'json'`、`'min:100'`，多規則以逗號串接，亦可給予`(stdout)=>Boolean` |
| `maxRetries` | Integer | `0` | 失敗後最大重試次數，遇`ENOENT`或exit code 2視為不可重試而立即中止 |

其餘設定會原樣轉傳給`wsemi`之`execCli`，例如`retryDelayMs`、`maxBuffer`、`onStdout`、`onStderr`、`env`。

#### Options only for dispatchOpencode:
| key | type | default | description |
| --- | --- | --- | --- |
| `key` | String | `''` | 該provider之API key，須與`provider`同時給予才會以`OPENCODE_AUTH_CONTENT`注入 |
| `provider` | String | `''` | `key`所屬provider名稱，須與`model`為同一組 |
| `config` | Object\|String | `null` | opencode設定內容，將以`OPENCODE_CONFIG_CONTENT`注入，供補上第三方provider之定義 |
| `agent` | String | `'build'` | opencode代理名稱 |

#### Options only for dispatchClaude:
| key | type | default | description |
| --- | --- | --- | --- |
| `skipPermissions` | Boolean | `true` | 是否帶`--dangerously-skip-permissions`旗標，`false`代表保留CLI權限閘門（見上方Security說明） |

#### Options only for dispatchCodex:
| key | type | default | description |
| --- | --- | --- | --- |
| `sandbox` | String | `'workspace-write'` | 沙箱模式，可用`'read-only'`、`'workspace-write'`、`'danger-full-access'` |

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

#### Options only for dispatchApiOpenaiCompat:
| key | type | default | description |
| --- | --- | --- | --- |
| `baseURL` | String | 必填 | API基底網址，將於尾端接上`/chat/completions` |
| `model` | String | 必填 | 模型ID（Zen之模型名不帶`opencode/`前綴） |
| `key` | String | `''` | API key，以`Bearer`置於`Authorization`標頭，省略代表不帶認證 |
| `system` | String | `''` | system提示詞，置於messages首位 |
| `body` | Object | `{}` | 額外請求本體（`temperature`、`max_tokens`、`response_format`等），同名鍵覆寫預設 |
| `headers` | Object | `{}` | 額外請求標頭 |
| `timeoutMs` | Integer | `300000` | 逾時毫秒，逾時中止請求（含回應串流讀取）；全套件統一預設 |
| `maxRetries` | Integer | `0` | 失敗重試次數；**4xx(429除外)為客戶端錯誤不重試**，429/5xx/網路錯誤/逾時線性退避重試 |
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
| `invalid-response` | 回應缺`choices[0].message.content` | api類 |
| `aborted` | `shouldStop`中止 | fallback層 |
| `budget` | 時間預算用盡 | fallback層 |

僅涵蓋**機械可判**者：CLI類之其餘失敗（額度上限／金鑰無效／服務端錯誤，各家字樣不同且隨版本漂移）一律歸`exec`，套件不維護簽章表（與否決金鑰停用清單同一理由）——需細分時以`coolDetect`式注入自判，或依`tried`內之`error`與`stderr`自行決策。

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
| `coolDetect` | Function | 無 | 冷卻觸發之**注入判定**`(r)=>Boolean`，收完整失敗結果（含`stdout`、`stderr`、`code`、`error`），回傳`true`即視同冷卻觸發（內建429/TIMEOUT觸發不受影響）。CLI類限流埋在stderr且各家字樣不同、隨版本漂移，**簽章表由觀察到字樣的呼叫端維護**，如`(r) => /FreeUsageLimitError/i.test(r.stderr \|\| '')`；漏判僅退回現狀（每階段重探一次）、誤判也只是降尾非移除，兩邊代價都有上限。僅`cooldownMs>0`時有效；回調拋出例外視同`false` |
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
| kind無效 | `error`以`unknown ai kind`開頭 | 整組跳過 |
| 其餘（含額度上限、金鑰無效、服務回錯） | — | 換組內下一把 |

整組跳過的理由：同組各金鑰共用同一`exe`與`model`，這些失敗換金鑰必然再敗，逐把嘗試純屬空耗。其餘失敗一律換下一把、**不記憶不停用**——額度視窗形態多樣（5小時滾動、逐時、逐日），停用清單會把已恢復的金鑰閒置，而重探的代價僅一次快速失敗；跨次執行僅記憶游標（成功後推進，令額度在多把金鑰間均攤）。

#### Result of dispatch functions:
```alias
//成功
{
    ok: true,
    stdout: '完成\r\n',
    stderr: '\x1b[0m\r\n> build · deepseek-v4-flash-free\r\n\x1b[0m\r\n',
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
    stderr: '\x1b[0m\r\n> build · deepseek-v4-flash-free\r\n\x1b[0m\r\n\x1b[91m\x1b[1mError: \x1b[0mInvalid API key.\r\n',
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
    tried: [                   //完整嘗試歷程, 成功時亦回傳; 失敗項另含stdout(被拒回覆)與stderr(錯誤輸出, 皆已截斷)供診斷
        { providerId: 'agnes:agnes-2.0-flash', keyIndex: 0, keyId: 'agnes:agnes-2.0-flash#0', outcome: 'next-key', error: 'HTTP 401', durationMs: 105 },
        { providerId: 'agnes:agnes-2.0-flash', keyIndex: 1, keyId: 'agnes:agnes-2.0-flash#1', outcome: 'ok', durationMs: 1161 },
    ],
}
```

#### dispatchAiWkf (workflow factory):
注入一次provider定義表(名稱 → `dispatchAiFallback`條目)與共用預設，之後以名稱宣告工作流；名稱查無定義即回報錯誤(fail fast)。回覆經寬鬆JSON解析(`extractJsonLoose`)＋自訂`check`驗證，非法回覆視為該家失敗而自動遞補；預設於prompt前掛「禁止建檔」約束(`promptPrefix: ''`可關閉)；措辭豁免唯讀查閱——codex以shell讀檔，一律禁指令會令其無法讀取專案檔案且靜默回拒答(2026-08-13實測)。

```alias
let wkf = wdi.dispatchAiWkf({
    providers: {
        'zen:deepseek-v4-flash-free': { kind: 'api-openai-compat', baseURL: 'https://opencode.ai/zen/v1', model: 'deepseek-v4-flash-free', keys: [...] },
        'claude:sonnet': { kind: 'claude', model: 'sonnet' },
        'codex:gpt-5.6-luna': { kind: 'codex', model: 'gpt-5.6-luna' },
    },
    defaults: { timeoutMs: 300000 },
})

//單一名額: 主模型＋自帶遞補鏈
let r1 = await wkf.callAi('...prompt...', { spec: { use: 'zen:deepseek-v4-flash-free', fallback: ['claude:sonnet'] }, check: (j) => !!j.essence })

//Fanout: 並行多開執行 → 單點整合收斂(候選未達minCandidates時以首位候選為成果不硬整合)
//check為共用預設; 名額規格與integrate可各自帶check(候選與終稿判準常不同, 如終稿須含固定段落)
let r2 = await wkf.runFanout({ task, agents: [{ use: 'zen:deepseek-v4-flash-free', fallback: ['claude:sonnet'] }, { use: 'claude:sonnet' }], integrate: { use: 'codex:gpt-5.6-luna' }, check })

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
[src/providers.mjs](https://github.com/yuda-lyu/w-dispatch-ai/blob/master/src/providers.mjs) 收錄實測可用之條目(CLI版與REST版)，金鑰以 `envVar` 間接引用(機密只放 `.env`)，經 `resolveProviders` 展開後即可直接使用或以 `pick` 自選：

```alias
import wdi from 'w-dispatch-ai'

//金鑰放.env(OPENCODE_KEYS/AGNES_KEYS/POOLSIDE_KEYS, 逗號分隔多把), 以readEnvFile讀成物件——
//不用process.loadEnvFile: 那會把金鑰塞進process.env, 多專案並行時互相覆蓋
let env = wdi.readEnvFile('./.env')

//全取: envVar → keys, 缺環境變數之條目自動停用並列入skipped
let { providers, table, skipped } = wdi.resolveProviders(wdi.providers, { env })

//自選: pick順序即遞補優先序; providers餵dispatchAiFallback, table餵dispatchAiWkf
let picked = wdi.resolveProviders(wdi.providers, { env, pick: ['agnes:agnes-2.0-flash', 'claude:sonnet'] })
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
```

**配套工具**（皆為選用，深層引入或由聚合物件取用）：

| 工具 | 用途 |
| --- | --- |
| `createFileStore({ dir })` | `dispatchAiFallback`之`store`的檔案持久化——排程任務每次執行都是新行程，記憶體游標/冷卻每次歸零；本實作採**排除式passthrough**（state原封存還，僅剔自用欄位`at`），日後套件擴充state欄位自動相容（殷鑑：白名單store曾把1.0.7新增的`cooling`靜默丟棄） |
| `createUsageCounter({ dir })` | 逐日逐鍵用量計帳，`onEvent`直接掛進dispatch即於`try`事件記帳；**純觀測絕不據以節流**（額度視窗形態多樣，臆測門檻擋自己的呼叫等同拿猜測當事實）；排程環境務必注入`getDate`錨定時區 |
| `budgetFor(chain)` | 遞補鏈走滿全鏈之時間預算（Σ各條目`timeoutMs`，未帶者以統一預設300000計）；與外部排程硬上限取小者交`budgetMs` |
| `salvageTruncatedArray(text)` | 截斷JSON陣列之前段搶救（救回的每個元素皆完整合法）；**不併入預設解析**——「判失敗換家重產」與「搶救前段部分接受」是同一問題的兩種合法策略，組成自訂`parse`注入即可 |
| `NO_SIDE_EFFECT` | 防副作用prompt前綴之單一來源（措辭含唯讀查閱豁免——codex以shell讀檔，一律禁指令等同禁讀檔）；工作流`callAi`預設自動掛上，直呼`dispatchAiFallback`者自行前綴 |

**內建CLI條目之防寫機制對照**（內建清單定位為唯讀調用，各家CLI條目皆自帶機械防寫；需要寫入能力時於條目或呼叫時覆寫該欄位即可。api類為純文字生成天然無寫檔能力，不在此列）：

| kind | 條目防寫欄位 | 機制 | 實測依據 |
| --- | --- | --- | --- |
| `opencode` | `config.permission: { edit/write/bash: 'deny' }` | opencode設定層拒絕編輯/寫檔/執行指令 | 2026-08 實測 |
| `claude` | `extraArgs: ['--disallowedTools', 'Write,Edit,NotebookEdit,Bash']` | CLI停用寫入類工具 | 2026-08 實測 |
| `codex` | `sandbox: 'read-only'` | Codex沙箱唯讀模式 | 2026-08 實測 |
| `antigravity` | `skipPermissions: false` | 保留agy權限閘門（不送`--dangerously-skip-permissions`） | 2026-08-15 canary實測：無此鎖時要求建檔**會真的落地**；`false`之下寫入被擋且**不卡逾時**（6.4s正常返回）、唯讀工具照常 |

注意agy被權限閘門擋下寫入時回`ok: true`且**stdout為空**（靜默拒絕非報錯）：工作流層無害（空回覆過不了validate而自動遞補），但直接呼叫`dispatchAntigravity`者須以「空輸出」判別被擋，不能只看`ok`。另提示詞層的`NO_SIDE_EFFECT`前綴是「請求」不是「強制」，機械防寫以上表欄位為準。

#### Known design notes:
- `package.json`**刻意不設**`exports`欄位：wsemi與w-*系列皆為自有套件，呼叫端以按需深層引入(`w-dispatch-ai/src/xxx.mjs`)為既定路線；增設exports會封死此路徑，勿加。
- `dispatchAi(kind, prompt, opt)`會把整個`opt`原樣轉傳對應轉接器，該轉接器用不到的鍵（例如輪替條目物件內的`kind`）會被忽略，故「供應商條目物件直接當`opt`」是預期用法；`dispatchAiFallback`之providers條目沿用同一約定。
- `dispatchAiFallback`為單向單輪：全數群組試畢即回傳最後一筆失敗結果與`tried`歷程，不回頭重試已敗的組。跨次執行僅記憶游標，不設金鑰停用清單（理由見上方失敗分流說明）；需跨次跳過特定金鑰時，由呼叫端依`tried`／`onEvent`內之`error`與`stderr`自行決策。
- `shouldStop`**只在嘗試邊界檢查，不中止進行中之嘗試**（不殺子進程、不斷開HTTP請求）：進行中嘗試之強制中止需侵入execCli層與各轉接器，屬已知設計取捨——最小版已把斷線後的損失從「整條鏈」縮成「至多再耗當前這一家」；如有實測場景證明不足再議完整版。
- CLI類限流簽章**不進套件**：各家stderr字樣不同且隨CLI版本漂移，套件維護簽章表等同養一個自己驗證不了的分類器（與否決金鑰停用清單同一理由）。偵測經`coolDetect`依賴注入，由觀察到字樣的呼叫端維護。
- `dispatchOpencode`之`key`與`provider`須同時給予才會注入金鑰；只給其一（或範例中`.env`缺鍵導致`key`為`undefined`）時不會報錯，而是靜默沿用CLI既有登入狀態。
- 範例中之`process.loadEnvFile`需Node.js >= 20.12，僅範例使用，套件本身無此限制。
- `config`以`OPENCODE_CONFIG_CONTENT`注入後，與使用者既有`opencode.jsonc`為覆蓋或合併關係未經實測確認；建議`config`內含該次調用所需之完整provider定義，不依賴與既有設定檔之合併行為。
