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
- Each adapter also accepts an `exe` option to pin the executable path, useful when the CLI is not in PATH (e.g. Windows Task Scheduler environments).
- For the other three adapters the prompt is always passed through stdin, never as a positional argument, so a prompt of tens of thousands of characters will not cause `ENAMETOOLONG`.
- All functions never reject. Success or failure is reported by the `ok` and `error` fields of the result object.
- **Security**: `dispatchClaude` passes `--dangerously-skip-permissions` by default, so the non-interactive `-p` mode will not hang on permission prompts. If the prompt embeds untrusted content (e.g. a web page to summarize), instructions inside that content would also run without the permission gate. Pass `skipPermissions: false` to keep the CLI permission gate.

#### Functions:
| function | description |
| --- | --- |
| `dispatchAi(kind, prompt, opt)` | dispatch to the adapter of `kind`, one of `'opencode'`、`'claude'`、`'codex'`、`'antigravity'` |
| `dispatchAiFallback(prompt, opt)` | call ai with an ordered provider list, auto rotating keys within a group and falling back to the next group |
| `dispatchOpencode(prompt, opt)` | call an ai model by opencode cli, supports per-call api key and provider config |
| `dispatchClaude(prompt, opt)` | call a claude model by claude code cli |
| `dispatchCodex(prompt, opt)` | call a gpt model by openai codex cli |
| `dispatchAntigravity(prompt, opt)` | call an ai model by google antigravity cli (`agy`), a multi-model gateway (gemini, claude, gpt-oss) |
| `KINDS` | array of available kinds, `['opencode', 'claude', 'codex', 'antigravity']` |

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
    // => KINDS: [ 'opencode', 'claude', 'codex', 'antigravity' ]

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
    // => invalid kind: false unknown ai kind: "gemini" (available: opencode, claude, codex, antigravity)

    //prompt非有效字串亦回傳error結果物件
    let r5 = await wdi.dispatchClaude('')
    console.log('invalid prompt:', r5.ok, r5.error)
    // => invalid prompt: false prompt must be a non-empty string

    //CLI執行失敗時, 由ok、code、error與stderr判斷原因
    let r6 = await wdi.dispatchOpencode(prompt, {
        model: 'opencode/deepseek-v4-flash-free',
        provider: 'opencode',
        key: 'sk-invalid-key',
    })
    console.log('invalid key:', r6.ok, r6.code, r6.error, r6.stderr.includes('Invalid API key'))
    // => invalid key: false 1 Exit code 1 true

    //多供應商自動遞補: providers順序即優先序, 組內keys以游標輪替
    //此例第1把金鑰無效 → 自動換組內下一把成功; 若整組用盡會遞補下一組(claude), 再失敗遞補codex
    let r7 = await wdi.dispatchAiFallback(prompt, {
        providers: [
            {
                id: 'deepseek',
                kind: 'opencode',
                model: 'opencode/deepseek-v4-flash-free',
                provider: 'opencode',
                keys: ['sk-invalid-key-demo', opencodeKeys[0]], //第1把無效, 示範組內輪替
                timeoutMs: 180000,
            },
            {
                id: 'agnes',
                kind: 'opencode',
                model: 'agnes-ai/agnes-2.0-flash',
                provider: 'agnes-ai',
                keys: agnesKeys,
                config: configAgnes, //第三方provider須另給定義
                timeoutMs: 180000,
            },
            { id: 'claude', kind: 'claude', model: 'sonnet' },
            { id: 'codex', kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
            { id: 'antigravity', kind: 'antigravity', model: 'gemini-3.6-flash-low' },
        ],
        budgetMs: 600000,
        onEvent: (ev) => console.log('  event:', ev.type, ev.keyId, ev.error || ''),
    })
    console.log('fallback:', r7.ok, r7.providerId, r7.keyIndex, r7.stdout.trim())
    console.log('tried:', r7.tried.map((x) => `${x.keyId}:${x.outcome}`).join(', '))
    // =>   event: try deepseek#0
    // =>   event: next-key deepseek#0 Exit code 1
    // =>   event: try deepseek#1
    // =>   event: ok deepseek#1
    // => fallback: true deepseek 1 完成
    // => tried: deepseek#0:next-key, deepseek#1:ok

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
| `timeoutMs` | Integer | `120000` | 逾時毫秒，逾時將強制關閉子進程及其子孫程序 |
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
| `addDirs` | Array | `[]` | 加入workspace之目錄字串陣列，逐項展開為`--add-dir` |
| `timeoutMs` | Integer | `300000` | agy為agent型CLI，預設較其他轉接器長 |

注意：agy之prompt走`--print`旗標而非stdin（agy介面如此），故prompt長度上限30000字元，超過回傳錯誤結果物件（不reject）。

#### Options for dispatchAiFallback:
| key | type | default | description |
| --- | --- | --- | --- |
| `providers` | Array | 必填 | 供應商條目陣列，**順序即優先序**。條目除`id`、`keys`外即該次調用之opt，原樣透傳對應轉接器（`kind`、`model`、`exe`、`provider`、`config`、`sandbox`、`timeoutMs`等皆放條目內） |
| `providers[].id` | String | 條目索引 | 群組識別，游標以此為鍵，多金鑰條目應給予穩定`id` |
| `providers[].keys` | Array | `[]` | 同一服務之多把API key，逐次注入輪替（`kind`為`opencode`時須同時給`provider`）；省略代表沿用CLI登入狀態 |
| `budgetMs` | Integer | 不限 | 整輪遞補之時間上限，剩餘預算會壓進每次呼叫之`timeoutMs` |
| `minAttemptMs` | Integer | `20000` | 單次嘗試之最低剩餘預算，低於此值即停止並回報`budget exhausted` |
| `store` | Object | 行程內記憶體 | 狀態持久化`{get:()=>state, set:(state)=>{}}`，state僅含`cursors`（逐群組游標）；假定單行程序列調用 |
| `onEvent` | Function | 無 | 事件回調`(ev)=>{}`，`ev.type`為`'try'`、`'ok'`、`'next-key'`、`'skip-group'`、`'budget-out'`；回調拋出例外不影響主流程 |

頂層其餘設定（`timeoutMs`、`validate`、`maxRetries`等）為各attempt之共用預設，條目可覆寫；`maxRetries`建議維持預設`0`，韌性交給換家而非重試同一家。

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
    providerId: 'deepseek',    //實際使用之群組
    keyIndex: 1,               //實際使用之金鑰索引, 無keys時為null
    kind: 'opencode',
    model: 'opencode/deepseek-v4-flash-free',
    tried: [                   //完整嘗試歷程, 成功時亦回傳
        { providerId: 'deepseek', keyIndex: 0, keyId: 'deepseek#0', outcome: 'next-key', error: 'Exit code 1', durationMs: 3049 },
        { providerId: 'deepseek', keyIndex: 1, keyId: 'deepseek#1', outcome: 'ok', durationMs: 11742 },
    ],
}
```

#### Known design notes:
- `dispatchAi(kind, prompt, opt)`會把整個`opt`原樣轉傳對應轉接器，該轉接器用不到的鍵（例如輪替條目物件內的`kind`）會被忽略，故「供應商條目物件直接當`opt`」是預期用法；`dispatchAiFallback`之providers條目沿用同一約定。
- `dispatchAiFallback`為單向單輪：全數群組試畢即回傳最後一筆失敗結果與`tried`歷程，不回頭重試已敗的組。跨次執行僅記憶游標，不設金鑰停用清單（理由見上方失敗分流說明）；需跨次跳過特定金鑰時，由呼叫端依`tried`／`onEvent`內之`error`與`stderr`自行決策。
- `dispatchOpencode`之`key`與`provider`須同時給予才會注入金鑰；只給其一（或範例中`.env`缺鍵導致`key`為`undefined`）時不會報錯，而是靜默沿用CLI既有登入狀態。
- 範例中之`process.loadEnvFile`需Node.js >= 20.12，僅範例使用，套件本身無此限制。
- `config`以`OPENCODE_CONFIG_CONTENT`注入後，與使用者既有`opencode.jsonc`為覆蓋或合併關係未經實測確認；建議`config`內含該次調用所需之完整provider定義，不依賴與既有設定檔之合併行為。
