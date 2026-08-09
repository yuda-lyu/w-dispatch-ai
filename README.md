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
- The prompt is always passed through stdin, never as a positional argument, so a prompt of tens of thousands of characters will not cause `ENAMETOOLONG`.
- All functions never reject. Success or failure is reported by the `ok` and `error` fields of the result object.
- **Security**: `dispatchClaude` passes `--dangerously-skip-permissions` by default, so the non-interactive `-p` mode will not hang on permission prompts. If the prompt embeds untrusted content (e.g. a web page to summarize), instructions inside that content would also run without the permission gate. Pass `skipPermissions: false` to keep the CLI permission gate.

#### Functions:
| function | description |
| --- | --- |
| `dispatchAi(kind, prompt, opt)` | dispatch to the adapter of `kind`, one of `'opencode'`、`'claude'`、`'codex'` |
| `dispatchOpencode(prompt, opt)` | call an ai model by opencode cli, supports per-call api key and provider config |
| `dispatchClaude(prompt, opt)` | call a claude model by claude code cli |
| `dispatchCodex(prompt, opt)` | call a gpt model by openai codex cli |
| `KINDS` | array of available kinds, `['opencode', 'claude', 'codex']` |

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
    // => KINDS: [ 'opencode', 'claude', 'codex' ]

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

    //以供應商條目輪替, 一個條目即一組(kind, model, 可選的key與provider與config), 輪到誰就用誰的CLI與模型
    //opencode支援逐次注入金鑰, 故同一provider之多把金鑰可各成一個條目
    let items = [
        { kind: 'claude', model: 'sonnet' },
        { kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[0], timeoutMs: 180000 },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[1], timeoutMs: 180000 },
        { kind: 'opencode', model: 'agnes-ai/agnes-2.0-flash', provider: 'agnes-ai', key: agnesKeys[0], config: configAgnes, timeoutMs: 180000 },
    ]
    for (let item of items) {
        let r = await wdi.dispatchAi(item.kind, prompt, item)
        console.log('dispatchAi ' + item.model + ':', r.ok, r.stdout.trim())
        // => dispatchAi sonnet: true 完成
        // => dispatchAi gpt-5.6-luna: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi agnes-ai/agnes-2.0-flash: true 完成
    }

    //未知供應商回傳error結果物件, 不會reject
    let r4 = await wdi.dispatchAi('gemini', prompt)
    console.log('invalid kind:', r4.ok, r4.error)
    // => invalid kind: false unknown ai kind: "gemini" (available: opencode, claude, codex)

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

#### Known design notes:
- `dispatchAi(kind, prompt, opt)`會把整個`opt`原樣轉傳對應轉接器，該轉接器用不到的鍵（例如輪替條目物件內的`kind`）會被忽略，故「供應商條目物件直接當`opt`」是預期用法。
- `dispatchOpencode`之`key`與`provider`須同時給予才會注入金鑰；只給其一（或範例中`.env`缺鍵導致`key`為`undefined`）時不會報錯，而是靜默沿用CLI既有登入狀態。
- 範例中之`process.loadEnvFile`需Node.js >= 20.12，僅範例使用，套件本身無此限制。
- `config`以`OPENCODE_CONFIG_CONTENT`注入後，與使用者既有`opencode.jsonc`為覆蓋或合併關係未經實測確認；建議`config`內含該次調用所需之完整provider定義，不依賴與既有設定檔之合併行為。
