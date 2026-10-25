import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-dispatchClaudeKey.test.mjs — dispatchClaude以Anthropic API金鑰計費(opt.key)之規格測試
//
// 規格來源: README「Claude以API金鑰計費」、帳本R-ANTHROPIC-1(sgud/rule/rulebook.md)、
//   Claude Code官方憑證優先序(code.claude.com/docs/en/authentication, 2026-10-24查證):
//   雲端供應商選擇器(CLAUDE_CODE_USE_*)與ANTHROPIC_AUTH_TOKEN之序位高於ANTHROPIC_API_KEY, 故給key時須自子進程環境移除;
//   -p模式下ANTHROPIC_API_KEY「一律使用」(不需核可)。
//   R08(2026-10-25 dispatch-run03): 主控以claude 2.1.302實測——於Claude Code工作階段內被啟動之子claude會繼承父session連結變數而沿用父登入(apiKeySource=none),
//   故給key時須自繼承之process.env移除之(呼叫端以opt.env明確傳入者保留; 未給key時不動), 規則與清單見src/dispatchClaude.mjs檔頭【key模式——繼承之父session連結變數】。
// 全部以假CLI驗證「子進程環境/argv/結果」, 不發出任何Anthropic請求。


//假CLI本體: 把環境變數(缺值為null)、argv、stdin寫入--fake-report指定之檔案(不走stdout, 因結果之stdout會遮蔽key)
let ENV_NAMES = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'ANTHROPIC_PROFILE',
    'ANTHROPIC_FEDERATION_RULE_ID',
    'FAKE_ENV',
    //父session連結變數(R08): 在Claude Code工作階段內被啟動之子進程會繼承它們, 於2.1.302實測令子claude沿用父登入而無視ANTHROPIC_API_KEY
    'CLAUDECODE',
    'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_SESSION_ATTENDED',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_AGENT_SDK_VERSION',
    'CLAUDE_PID',
    'CLAUDE_EFFORT',
    'CLAUDE_JOB_DIR',
    'CLAUDE_CODE_FUTURE_LINK_VAR', //前綴規則之證明: 官方文件未列、日後才可能出現之CLAUDE_CODE_*名稱
    'CLAUDE_AGENT_SDK_FUTURE_LINK_VAR',
    //應保留者: 使用者設定類(非父session注入)
    'CLAUDE_CODE_GIT_BASH_PATH',
    'CLAUDE_CODE_EFFORT_LEVEL',
    'CLAUDE_CONFIG_DIR',
]
let ENTRY = `
import fs from 'fs'
let args = process.argv.slice(2)
let opt = (name) => {
    let a = args.find((x) => x.startsWith('--' + name + '='))
    return a ? a.slice(name.length + 3) : null
}
let key = process.env.ANTHROPIC_API_KEY
let names = ${JSON.stringify(ENV_NAMES)}
let chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
    let rp = opt('fake-report')
    if (rp) {
        let env = {}
        for (let n of names) {
            env[n] = process.env[n] === undefined ? null : process.env[n]
        }
        fs.writeFileSync(rp, JSON.stringify({ args, stdin: Buffer.concat(chunks).toString('utf8'), env }), 'utf8')
    }
    let leak = opt('fake-leak')
    let other = 'sk-ant-api03-OTHERLEAK1234567890abcdef'
    let say = (where, text) => {
        if (leak === where || leak === 'both') {
            (where === 'out' ? process.stdout : process.stderr).write(text)
        }
    }
    //--fake-split: 把key與他把sk-ant-金鑰各切成兩塊、分兩次write(間隔), 測串流回調之跨塊遮蔽
    if (opt('fake-split') && key) {
        let other2 = 'sk-ant-api03-SPLITLEAK-9876543210zyx'
        process.stdout.write('A' + key.slice(0, 11))
        process.stderr.write('E' + other2.slice(0, 13))
        setTimeout(() => {
            process.stdout.write(key.slice(11) + 'Z')
            process.stderr.write(other2.slice(13) + 'F')
            process.exit(0)
        }, 250)
        return
    }
    let failKey = opt('fake-fail-key')
    if (failKey && key && key.includes(failKey)) {
        let ft = opt('fake-fail-text') || 'Invalid API key'
        process.stderr.write(ft)
        say('err', ' key=' + key + ' other=' + other)
        process.exit(1)
    }
    process.stdout.write('OK')
    say('out', ' key=' + key + ' other=' + other)
    say('err', ' key=' + key + ' other=' + other)
    let ex = opt('fake-exit')
    process.exit(ex ? Number(ex) : 0)
})
`

let KEY = 'sk-ant-api03-TESTKEY-AAAA1111BBBB2222cccc3333'
let KEY2 = 'sk-ant-api03-TESTKEY-ZZZZ9999YYYY8888xxxx7777'
let MASK = '[REDACTED]'

//會優先於(或可能干擾)ANTHROPIC_API_KEY之變數(序位見檔頭)
let OVERRIDE_VARS = [
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'ANTHROPIC_PROFILE',
    'ANTHROPIC_FEDERATION_RULE_ID',
]


describe('dispatchClaude key(Anthropic API金鑰計費)', function() {

    let fake = null
    let fd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'dispatchClaudeKey')
    let seq = 0

    before(function() {
        fake = createFakeCli('fake-claude-key', ENTRY)
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
        fs.rmSync(fd, { recursive: true, force: true })
    })

    //withEnv, 暫時改父行程環境(測完還原), 值為undefined代表刪除
    let withEnv = async (patch, fn) => {
        let old = {}
        for (let k of Object.keys(patch)) {
            old[k] = process.env[k]
            if (patch[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = patch[k]
            }
        }
        try {
            return await fn()
        }
        finally {
            //逆序還原: Windows環境變數名不分大小寫, patch內不同大小寫之同名鍵(如ANTHROPIC_AUTH_TOKEN與anthropic_auth_token)須由後設者先還原, 最先設者之舊值才是最終值
            for (let k of Object.keys(patch).reverse()) {
                if (old[k] === undefined) {
                    delete process.env[k]
                }
                else {
                    process.env[k] = old[k]
                }
            }
        }
    }

    //run, 呼叫dispatchClaude並讀回假CLI之報告(子進程實際收到之argv/env)
    let run = async (opt = {}, args = []) => {
        let rp = path.join(fd, `rep-${process.pid}-${seq++}.json`)
        let r = await dispatchClaude('abc', { exe: fake.exe, ...opt, extraArgs: [`--fake-report=${rp}`, ...args] })
        let rep = fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, 'utf8')) : null
        return { r, rep }
    }

    //基準: 清掉父環境中全部相關變數
    let cleanParent = () => {
        let p = {}
        for (let n of ENV_NAMES) {
            p[n] = undefined
        }
        return p
    }

    it('R01 key為有效字串時, 子進程環境ANTHROPIC_API_KEY為該key', async function() {
        //規格: README「Claude以API金鑰計費」——給key即只在該次子進程之環境設ANTHROPIC_API_KEY
        let { r, rep } = await withEnv(cleanParent(), () => run({ key: KEY }))
        let o = [r.ok, rep.env.ANTHROPIC_API_KEY]
        let oo = [true, KEY]
        assert.strict.deepEqual(o, oo)
    })

    it('R02 key有效時, 子進程環境移除全部會優先於(或干擾)ANTHROPIC_API_KEY之憑證變數, 變數來自process.env時亦然', async function() {
        //規格: 官方憑證優先序——CLAUDE_CODE_USE_*與ANTHROPIC_AUTH_TOKEN高於ANTHROPIC_API_KEY; OAUTH_TOKEN/PROFILE/FEDERATION較低, 縱深防禦一併移除
        let parent = cleanParent()
        for (let n of OVERRIDE_VARS) {
            parent[n] = `parent-${n}`
        }
        let { r, rep } = await withEnv(parent, () => run({ key: KEY }))
        let o = [r.ok, rep.env.ANTHROPIC_API_KEY, ...OVERRIDE_VARS.map((n) => rep.env[n])]
        let oo = [true, KEY, ...OVERRIDE_VARS.map(() => null)]
        assert.strict.deepEqual(o, oo)
    })

    it('R02 key有效時, 變數來自opt.env亦被移除(key之憑證意圖優先於呼叫端env中的衝突變數), 其餘opt.env變數照常傳入', async function() {
        let env = { ANTHROPIC_AUTH_TOKEN: 'opt-token', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: 'opt-api-key', FAKE_ENV: 'keep-me' }
        let { rep } = await withEnv(cleanParent(), () => run({ key: KEY, env }))
        let o = [rep.env.ANTHROPIC_API_KEY, rep.env.ANTHROPIC_AUTH_TOKEN, rep.env.CLAUDE_CODE_USE_BEDROCK, rep.env.FAKE_ENV]
        let oo = [KEY, null, null, 'keep-me']
        assert.strict.deepEqual(o, oo)
    })

    it('R03 key未給或無效(undefined、null、空字串、非字串)時環境與現行相同: 父環境之ANTHROPIC_API_KEY與其他變數原樣流過、不移除任何變數', async function() {
        //規格: 「未給時行為與現行完全相同(沿用訂閱登入)」; 無效key視同未給(與全套件「無效回退預設」慣例一致)
        let parent = cleanParent()
        parent.ANTHROPIC_API_KEY = 'parent-api-key'
        parent.ANTHROPIC_AUTH_TOKEN = 'parent-token'
        parent.CLAUDE_CODE_OAUTH_TOKEN = 'parent-oauth'
        let r = []
        await withEnv(parent, async () => {
            for (let key of [undefined, null, '', 123, {}, []]) {
                let { rep } = await run({ key })
                r.push([rep.env.ANTHROPIC_API_KEY, rep.env.ANTHROPIC_AUTH_TOKEN, rep.env.CLAUDE_CODE_OAUTH_TOKEN])
            }
        })
        let rr = [1, 2, 3, 4, 5, 6].map(() => ['parent-api-key', 'parent-token', 'parent-oauth'])
        assert.strict.deepEqual(r, rr)
    })

    it('R03 key未給時完全不給key之呼叫(opt無key鍵)之argv與有key時相同(固定旗標、model、extraArgs不受key影響)', async function() {
        let a = await withEnv(cleanParent(), () => run({ model: 'claude-opus-5-5' }, ['--effort', 'high']))
        let b = await withEnv(cleanParent(), () => run({ model: 'claude-opus-5-5', key: KEY }, ['--effort', 'high']))
        let o = [a.rep.args.filter((x) => !x.startsWith('--fake-report=')), b.rep.args.filter((x) => !x.startsWith('--fake-report='))]
        let oo = [
            ['-p', '--dangerously-skip-permissions', '--model', 'claude-opus-5-5', '--effort', 'high'],
            ['-p', '--dangerously-skip-permissions', '--model', 'claude-opus-5-5', '--effort', 'high'],
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('R04 key不出現在argv與stdin, 不寫入process.env, 呼叫後父環境之ANTHROPIC_API_KEY維持原值', async function() {
        let parent = cleanParent()
        parent.ANTHROPIC_API_KEY = 'parent-api-key'
        let o = await withEnv(parent, async () => {
            let { rep } = await run({ key: KEY })
            return [
                JSON.stringify(rep.args).includes(KEY),
                rep.stdin.includes(KEY),
                process.env.ANTHROPIC_API_KEY,
                Object.values(process.env).some((v) => v === KEY),
            ]
        })
        let oo = [false, false, 'parent-api-key', false]
        assert.strict.deepEqual(o, oo)
    })

    it('R05 子進程把key回聲到stdout與stderr時, 成功結果之stdout、stderr皆已遮蔽key; stderr另遮蔽sk-ant-形式, 成功之stdout(模型輸出)只遮蔽key本身而不動其他sk-ant-字樣', async function() {
        //規格: key不得出現在任何log、錯誤訊息、stdout.log或回傳物件(以redactText遮蔽key本身, 另遮蔽sk-ant-形式)。
        //成功之stdout為模型輸出, 其中合法出現之「sk-ant-api03-…」範例字樣(如文件摘要)不可被樣式遮蔽破壞, 故僅遮蔽key本身
        let { r } = await withEnv(cleanParent(), () => run({ key: KEY }, ['--fake-leak=both']))
        let all = JSON.stringify(r)
        let o = [
            r.ok,
            r.stdout,
            r.stderr,
            all.includes(KEY),
        ]
        let oo = [
            true,
            `OK key=${MASK} other=sk-ant-api03-OTHERLEAK1234567890abcdef`,
            ` key=${MASK} other=${MASK}`,
            false,
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('R05 失敗結果(非零離開、驗證失敗)之stdout、stderr、error亦已遮蔽key', async function() {
        let fail = await withEnv(cleanParent(), () => run({ key: KEY }, ['--fake-leak=both', '--fake-exit=1']))
        let val = await withEnv(cleanParent(), () => run({ key: KEY, validate: () => false }, ['--fake-leak=both']))
        let o = [fail, val].map(({ r }) => {
            let all = JSON.stringify(r)
            return [r.ok, all.includes(KEY), all.includes('OTHERLEAK'), r.stdout.includes(MASK)]
        })
        let oo = [
            [false, false, false, true],
            [false, false, false, true],
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('R05 未給key時不做額外遮蔽(行為與現行相同): 子進程輸出原樣回傳', async function() {
        //未給key代表沒有機密值可遮蔽; 此測試釘住「未給時結果原樣」, 防止遮蔽邏輯誤套於訂閱登入路徑
        let { r } = await withEnv(cleanParent(), () => run({}, ['--fake-leak=out']))
        let o = [r.ok, r.stdout]
        let oo = [true, 'OK key=undefined other=sk-ant-api03-OTHERLEAK1234567890abcdef']
        assert.strict.deepEqual(o, oo)
    })

    it('R06 並行呼叫各見自己的key(環境隔離於各次子進程, 不互相污染)', async function() {
        let keys = [KEY, KEY2, 'sk-ant-api03-THIRD-KEY-0000111122223333']
        let rs = await withEnv(cleanParent(), () => Promise.all(keys.map((k) => run({ key: k }))))
        let o = rs.map(({ rep }) => rep.env.ANTHROPIC_API_KEY)
        assert.strict.deepEqual(o, keys)
    })

    it('R07 dispatchAiFallback: claude條目帶keys時逐把注入子進程環境並輪替(第1把失敗換第2把), 回傳、tried與事件皆不含任何金鑰', async function() {
        //規格: resolveProviders展開之keys經dispatchAiFallback輪替(attemptOpt.key); 失敗分支之stdout/stderr/error亦不得夾帶key
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [{
                id: 'claude-api:test',
                kind: 'claude',
                exe: fake.exe,
                model: 'claude-haiku-5-5',
                keys: ['sk-ant-api03-BADBAD-1111', KEY2],
                extraArgs: ['--fake-fail-key=BADBAD', '--fake-leak=both'],
            }],
            onEvent: (ev) => events.push(ev),
        })
        let all = JSON.stringify({ r, events })
        let o = [
            r.ok,
            r.keyIndex,
            r.tried.map((t) => [t.keyIndex, t.outcome]),
            all.includes('BADBAD'),
            all.includes(KEY2),
            JSON.stringify([r.tried, events]).includes('OTHERLEAK'), //失敗分支(tried/事件)之stderr已連同sk-ant-形式遮蔽
            r.tried[0].stderr.includes(MASK),
        ]
        let oo = [true, 1, [[0, 'next-key'], [1, 'ok']], false, false, false, true]
        assert.strict.deepEqual(o, oo)
    })

    //── 2026-10-25 外審回饋補強 ──

    it('R05 onStdout／onStderr回調(如把串流寫入stdout.log): key與他把sk-ant-金鑰被切在兩塊之間時, 回調收到的合併文字已遮蔽(stdout只遮蔽key、stderr另遮蔽sk-ant-樣式)', async function() {
        //規格: 提示詞「不得出現在任何log、錯誤訊息、stdout.log或回傳物件」——dispatch腳本慣例以onStdout逐塊寫stdout.log
        let outChunks = []
        let errChunks = []
        let { r } = await withEnv(cleanParent(), () => run({
            key: KEY,
            onStdout: (c) => outChunks.push(String(c)),
            onStderr: (c) => errChunks.push(String(c)),
        }, ['--fake-split=1']))
        let so = outChunks.join('')
        let se = errChunks.join('')
        //stderr之sk-ant-樣式連尾端字母數字一併吞入(樣式 [A-Za-z0-9_-]{4,} 為貪婪), 故「他把金鑰+F」整段成為一個遮蔽字
        let o = [r.ok, so, se, so.includes(KEY.slice(0, 11)), se.includes('SPLITLEAK'), r.stdout.includes(KEY)]
        let oo = [true, `A${MASK}Z`, `E${MASK}`, false, false, false]
        assert.strict.deepEqual(o, oo)
    })

    it('R03 未給key時onStdout／onStderr回調原樣收到子進程輸出(不包遮蔽器, 與舊版相同)', async function() {
        let outChunks = []
        let { r } = await withEnv(cleanParent(), () => run({ onStdout: (c) => outChunks.push(String(c)) }, ['--fake-leak=out']))
        assert.strict.deepEqual([r.ok, outChunks.join('')], [true, 'OK key=undefined other=sk-ant-api03-OTHERLEAK1234567890abcdef'])
    })

    it('R05 啟動前參數檢核失敗(opt.env之getter拋出夾帶key之例外)時, params錯誤訊息已遮蔽key', async function() {
        let env = Object.defineProperty({}, 'X', {
            enumerable: true,
            get: () => {
                throw new Error(`env getter leaked ${KEY}`)
            },
        })
        let r = await dispatchClaude('abc', { exe: fake.exe, key: KEY, env })
        assert.strict.deepEqual([r.ok, r.errorType, r.attempts, JSON.stringify(r).includes(KEY), r.error.includes(MASK)], [false, 'params', 0, false, true])
    })

    it('key含NUL字元(無法放進環境變數)時回INVALID_KEY(errorType exec, attempts 0, 不啟動子進程); dispatchAiFallback換下一把而非整組跳過', async function() {
        let a = await dispatchClaude('abc', { exe: fake.exe, key: 'sk-ant-api03-BAD\u0000TAIL-1111' })
        let f = await dispatchAiFallback('abc', {
            providers: [{ id: 'claude-api:nul', kind: 'claude', exe: fake.exe, keys: ['sk-ant-api03-BAD\u0000TAIL-1111', KEY2] }],
        })
        let o = [[a.ok, a.errorType, a.attempts, a.error.indexOf('INVALID_KEY') === 0], [f.ok, f.keyIndex, f.tried.map((t) => [t.outcome, t.errorType])]]
        assert.strict.deepEqual(o, [[false, 'exec', 0, true], [true, 1, [['next-key', 'exec'], ['ok', undefined]]]])
    })

    it('R02 key有效時, 凍結(Object.freeze)之opt.env不被改動且不拋錯; Windows下不同大小寫拼法之衝突憑證變數(opt.env與父環境)亦被移除', async function() {
        let env = Object.freeze({ KEEP_ME: 'yes' })
        let a = await withEnv(cleanParent(), () => run({ key: KEY, env }))
        let o = [a.r.ok, a.rep.env.ANTHROPIC_API_KEY, Object.keys(env)]
        assert.strict.deepEqual(o, [true, KEY, ['KEEP_ME']])
        if (process.platform === 'win32') {
            //Windows環境變數名不分大小寫: 以小寫／混合大小寫給衝突變數, 子進程以大寫名查詢亦必須查無
            let parent = cleanParent()
            parent.anthropic_auth_token = 'parent-lower-token'
            let b = await withEnv(parent, () => run({ key: KEY, env: { Anthropic_Auth_Token: 'opt-mixed-token', anthropic_api_key: 'opt-lower-key', Claude_Code_Use_Bedrock: '1' } }))
            assert.strict.deepEqual([b.rep.env.ANTHROPIC_API_KEY, b.rep.env.ANTHROPIC_AUTH_TOKEN, b.rep.env.CLAUDE_CODE_USE_BEDROCK], [KEY, null, null])
        }
    })

    it('R03 key為null且給了opt.env(含衝突變數)時, 子進程環境逐欄與舊版相同(opt.env原樣生效, 父環境變數不被移除)', async function() {
        let parent = cleanParent()
        parent.ANTHROPIC_AUTH_TOKEN = 'parent-token'
        let { rep } = await withEnv(parent, () => run({ key: null, env: { ANTHROPIC_API_KEY: 'opt-key', FAKE_ENV: 'f' } }))
        assert.strict.deepEqual([rep.env.ANTHROPIC_API_KEY, rep.env.ANTHROPIC_AUTH_TOKEN, rep.env.FAKE_ENV], ['opt-key', 'parent-token', 'f'])
    })

    it('R07 額度不足/限流之CLI失敗(離開碼1, 訊息在stderr)依既有機制換下一把; cooldownMs>0且coolDetect命中字樣時該條目被標記冷卻(cooled事件)', async function() {
        //CLI類限流/額度字樣不內建簽章(見dispatchAiFallback檔頭), 由呼叫端經coolDetect注入; 此處示範README建議之字樣
        let events = []
        let coolDetect = (r) => /credit balance is too low|rate_limit_error|usage limit/i.test(`${r.stdout} ${r.stderr}`)
        let r = await dispatchAiFallback('abc', {
            providers: [{
                id: 'claude-api:test2',
                kind: 'claude',
                exe: fake.exe,
                keys: ['sk-ant-api03-BADBAD-2222', KEY],
                extraArgs: ['--fake-fail-key=BADBAD', '--fake-fail-text=Credit balance is too low'],
            }],
            cooldownMs: 60000,
            coolDetect,
            onEvent: (ev) => events.push(ev),
        })
        let o = [r.ok, r.keyIndex, events.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.keyIndex])]
        let oo = [true, 1, [['claude-api:test2', 0]]]
        assert.strict.deepEqual(o, oo)
    })

    //── 2026-10-25 dispatch-run03: 父session連結變數(主控實測: 於Claude Code工作階段內呼叫時apiKeySource=none) ──
    //規格: 主控以claude 2.1.302探測——子進程繼承父session之CLAUDE_CODE_*／CLAUDE_AGENT_SDK_VERSION／CLAUDE_PID／CLAUDE_EFFORT等連結變數時,
    //  即使有ANTHROPIC_API_KEY, apiKeySource仍為none(沿用父登入); 移除這些繼承變數後為ANTHROPIC_API_KEY。
    //  故給key時須自「繼承之process.env」移除之; 呼叫端以opt.env明確傳入者保留; 未給key時行為與現行完全相同。

    //須自繼承環境移除者(單一來源; 含前綴規則之未知名稱)
    let LINK_VARS = [
        'CLAUDECODE',
        'CLAUDE_CODE_CHILD_SESSION',
        'CLAUDE_CODE_ENTRYPOINT',
        'CLAUDE_CODE_MESSAGING_SOCKET',
        'CLAUDE_CODE_MESSAGING_TOKEN',
        'CLAUDE_CODE_SESSION_ID',
        'CLAUDE_CODE_SESSION_ATTENDED',
        'CLAUDE_CODE_EXECPATH',
        'CLAUDE_AGENT_SDK_VERSION',
        'CLAUDE_PID',
        'CLAUDE_EFFORT',
        'CLAUDE_JOB_DIR',
        'CLAUDE_CODE_FUTURE_LINK_VAR',
        'CLAUDE_AGENT_SDK_FUTURE_LINK_VAR',
        'CLAUDE_CODE_EFFORT_LEVEL', //使用者設定類, 但不在保留清單: 繼承而來者於key模式一併移除(要保留須由opt.env明確傳入, 見下)
    ]

    //父環境帶齊連結變數(值為`parent-<名稱>`)
    let parentWithLinks = () => {
        let p = cleanParent()
        for (let n of LINK_VARS) {
            p[n] = `parent-${n}`
        }
        return p
    }

    it('R08 key有效時, 自繼承之process.env移除全部父session連結變數(含前綴規則涵蓋之未知名稱), key照常注入, 不動process.env', async function() {
        let { r, rep } = await withEnv(parentWithLinks(), () => run({ key: KEY }))
        let o = [r.ok, rep.env.ANTHROPIC_API_KEY, ...LINK_VARS.map((n) => rep.env[n])]
        let oo = [true, KEY, ...LINK_VARS.map(() => null)]
        assert.strict.deepEqual(o, oo)
    })

    it('R08 key有效時, 本進程process.env內的連結變數於呼叫後仍在(只作用於子進程)', async function() {
        let after = await withEnv(parentWithLinks(), async () => {
            await run({ key: KEY })
            return LINK_VARS.map((n) => process.env[n])
        })
        assert.strict.deepEqual(after, LINK_VARS.map((n) => `parent-${n}`))
    })

    it('R08 key有效時, 非連結變數照常繼承: CLAUDE_CONFIG_DIR(不屬CLAUDE_CODE_／CLAUDE_AGENT_SDK_前綴)、CLAUDE_CODE_GIT_BASH_PATH(保留清單: Windows找不到Git Bash時子進程無法啟動工具)、FAKE_ENV', async function() {
        let p = parentWithLinks()
        p.CLAUDE_CONFIG_DIR = 'parent-config-dir'
        p.CLAUDE_CODE_GIT_BASH_PATH = 'parent-git-bash-path'
        p.FAKE_ENV = 'parent-fake'
        let { rep } = await withEnv(p, () => run({ key: KEY }))
        let o = [rep.env.CLAUDE_CONFIG_DIR, rep.env.CLAUDE_CODE_GIT_BASH_PATH, rep.env.FAKE_ENV]
        assert.strict.deepEqual(o, ['parent-config-dir', 'parent-git-bash-path', 'parent-fake'])
    })

    it('R08 key有效時, 呼叫端以opt.env明確傳入之連結變數保留(覆蓋同名繼承值), 其餘繼承之連結變數仍移除', async function() {
        //規格: 「呼叫端以env選項明確傳入者保留(例如CLAUDE_CODE_EFFORT_LEVEL)」
        let env = {
            CLAUDE_CODE_EFFORT_LEVEL: 'high', //父環境亦有同名: 以呼叫端值為準
            CLAUDE_CODE_ENTRYPOINT: 'caller-entry', //連結變數被呼叫端明確傳入: 保留
            CLAUDE_PID: '4321',
            CLAUDE_CODE_FUTURE_LINK_VAR: 'caller-future',
        }
        let { rep } = await withEnv(parentWithLinks(), () => run({ key: KEY, env }))
        let kept = Object.keys(env)
        let o = LINK_VARS.map((n) => rep.env[n])
        let oo = LINK_VARS.map((n) => kept.includes(n) ? env[n] : null)
        assert.strict.deepEqual([rep.env.ANTHROPIC_API_KEY, o], [KEY, oo])
    })

    it('R08 key有效時, 呼叫端明確傳入值為undefined之變數維持移除語意(不被還原成繼承值)', async function() {
        let { rep } = await withEnv(parentWithLinks(), () => run({ key: KEY, env: { CLAUDE_CODE_SESSION_ID: undefined } }))
        assert.strict.deepEqual([rep.env.CLAUDE_CODE_SESSION_ID, rep.env.CLAUDE_PID], [null, null])
    })

    it('R08 key有效時, 呼叫端傳入之憑證變數仍被移除(連結變數保留規則不放行憑證變數: CLAUDE_CODE_USE_BEDROCK／CLAUDE_CODE_OAUTH_TOKEN同屬CLAUDE_CODE_前綴)', async function() {
        let { rep } = await withEnv(parentWithLinks(), () => run({ key: KEY, env: { CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_OAUTH_TOKEN: 'opt-oauth', CLAUDE_CODE_EFFORT_LEVEL: 'low' } }))
        assert.strict.deepEqual([rep.env.CLAUDE_CODE_USE_BEDROCK, rep.env.CLAUDE_CODE_OAUTH_TOKEN, rep.env.CLAUDE_CODE_EFFORT_LEVEL], [null, null, 'low'])
    })

    it('R08 key未給或無效(undefined、null、空字串、非字串)時, 繼承之連結變數原樣流入子進程(不移除任何變數), 與現行相同', async function() {
        let r = []
        await withEnv(parentWithLinks(), async () => {
            for (let key of [undefined, null, '', 123, {}, []]) {
                let { rep } = await run({ key })
                r.push(LINK_VARS.map((n) => rep.env[n]))
            }
        })
        let rr = [1, 2, 3, 4, 5, 6].map(() => LINK_VARS.map((n) => `parent-${n}`))
        assert.strict.deepEqual(r, rr)
    })

    it('R08 key未給且給了opt.env時, 繼承之連結變數同樣原樣流入(opt.env只覆蓋同名者)', async function() {
        let { rep } = await withEnv(parentWithLinks(), () => run({ env: { CLAUDE_PID: 'caller-pid', FAKE_ENV: 'f' } }))
        let o = LINK_VARS.map((n) => rep.env[n])
        let oo = LINK_VARS.map((n) => n === 'CLAUDE_PID' ? 'caller-pid' : `parent-${n}`)
        assert.strict.deepEqual([o, rep.env.FAKE_ENV], [oo, 'f'])
    })

    it('R08 Windows環境變數名不分大小寫: 以小寫繼承之連結變數亦被移除; 呼叫端以不同大小寫明確傳入者保留且只剩該值', async function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let p = cleanParent()
        p.claude_code_session_id = 'parent-lower-session'
        p.Claude_Pid = 'parent-mixed-pid'
        p.claude_code_entrypoint = 'parent-lower-entry'
        //子進程以大寫名查詢: 呼叫端未傳入者查無; 呼叫端以小寫傳入CLAUDE_CODE_ENTRYPOINT者其值為呼叫端之值
        let { rep } = await withEnv(p, () => run({ key: KEY, env: { claude_code_entrypoint: 'caller-lower-entry' } }))
        assert.strict.deepEqual([rep.env.CLAUDE_CODE_SESSION_ID, rep.env.CLAUDE_PID, rep.env.CLAUDE_CODE_ENTRYPOINT], [null, null, 'caller-lower-entry'])
    })

    it('R08 dispatchAiFallback: claude條目帶keys時, 子進程環境亦無繼承之連結變數(整條路徑, 非僅dispatchClaude單點)', async function() {
        let rp = path.join(fd, `rep-${process.pid}-${seq++}.json`)
        let r = await withEnv(parentWithLinks(), () => dispatchAiFallback('abc', {
            providers: [{ id: 'claude-api:link', kind: 'claude', exe: fake.exe, keys: [KEY], extraArgs: [`--fake-report=${rp}`] }],
        }))
        let rep = JSON.parse(fs.readFileSync(rp, 'utf8'))
        assert.strict.deepEqual([r.ok, rep.env.ANTHROPIC_API_KEY, LINK_VARS.map((n) => rep.env[n])], [true, KEY, LINK_VARS.map(() => null)])
    })

})
