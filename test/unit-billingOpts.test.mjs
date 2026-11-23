import assert from 'assert'
/* eslint-disable no-new-wrappers */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { checkSafeOpts, readNameOpt, readEnumOpt, readTokenMaxOpt, readFunOpt, checkReadObj, ANTHROPIC_EFFORTS } from '../src/readSafeOpt.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { SENT, revoked, hostile, pathWithoutRealCli } from './tools/hostileValuesForTest.mjs'


// unit-billingOpts.test.mjs — 影響計費之opt「給了而無效即拒絕」(排程第553項之主控裁定; 帳本R-SAFEOPT-1規則11; dspec〈輸入參數之檢測機制〉§11「影響下單數量或金額之opt視同安全相關opt」、K4、K9)
//
// 判準(盤點見sgud/state/state_tdai2.md): 給了而無效時會改變計費者(改用CLI預設模型、預設effort、預設輸出上限、預設max_tokens、實際發出請求)⇒ 拒絕; 不改變計費者 ⇒ 維持K3(視為未給)。
//
// 規格句(每案註解標明):
//   B1 model(四家CLI與dispatchApiTypesafeSystemone): 未給(undefined、null)與''(文件載明之預設)不帶旗標／用官方預設; 給了而非原始非空字串以params回報(attempts 0、不起子行程、不送請求), 不改用CLI預設模型。
//   B2 dispatchAntigravity.effort: 同B1(不改用agy預設檔位); model與effort皆先於stdin路徑之agy --version探測。
//   B3 dispatchOpencode.outputTokenMax: 未給用呼叫端環境或預設128000; 有效之正整數(數字或數字字串)採用; 給了而無效(含'')以params回報、不改用預設; 回傳之值即注入之值(K4)。
//   B4 dispatchApiAnthropic.effort: 未給與''不送; 在{low,medium,high,xhigh,max}內送出; 給了而不在其內以params回報、不送請求。
//   B5 body(四個REST轉接器): 未給(undefined、null)與一般物件照舊(併入請求本體); 給了而非一般物件(字串、數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt)以params回報、不送請求(不略過而用預設max_tokens)。
//   B6 fetch(dispatchApiAnthropic、dispatchClaude之交叉確認)與crossCheck(dispatchClaude): 未給用全域fetch／預設開; 給了而非函數／非布林以params回報、不起子行程、不送請求(不改走全域fetch而發出真實請求、不多發請求)。
//   B7 遞補層(checkSafeOpts)於發try事件之前即判上列各opt(與轉接器同一判定單一來源)。
//   B8 維持K3之opt(不改變計費, 盤點見state_tdai2; config自tdai2b起改為拒絕, 見unit-patchCatalogueConfig): maxRetries、timeoutMs、agent、promptVia、stopOnLimit、crossCheckModel、crossCheckBaseURL等給了無效照舊視為未給(保持案)。
//   B9 K9: 訊息不回顯值。
//
// 安全: 不呼叫外部AI服務——CLI一律假執行檔(before把PATH換成移除真CLI者、after還原); 全域fetch於測試期間換為記錄替身(不發真實請求)。


let KEY = 'sk-test-billing-0001-SECRET'
let NUM = 123456789

//記號檔(測試中之臨時檔放test/_tmp/<案名>/, 由本檔after清除)
let MARK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'billingOpts')
let MARK_FILE = path.join(MARK_DIR, 'mark.txt')
let MARK_CODE = `
import fs from 'fs'
fs.appendFileSync(${JSON.stringify(MARK_FILE)}, 'x')
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ args: process.argv.slice(2), max: process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || '' }))
    process.exit(0)
})
`

//非原始非空字串之全部無效值(不含''、undefined、null: 其為未給)
let badNames = () => [NUM, 0, true, false, {}, [], new String(SENT), hostile(), revoked(), () => 1, [SENT], Symbol(SENT), 10n]
let badTokens = () => [0, -1, 1.5, 'abc', '', true, false, Infinity, NaN, {}, [], new String('64000'), hostile(), revoked(), () => 1, 10n, '0x10', '  ', '-5', '64000.5']
let badFuns = () => ['not-a-function', NUM, true, false, {}, [], new String(SENT), hostile(), revoked(), Symbol(SENT), 10n]
let badBools = () => ['false', 'true', 0, 1, '', {}, [], new Boolean(false), hostile(), revoked(), () => 1]
let badBodies = () => ['x', '', NUM, 0, true, false, [], [SENT], new Map(), () => 1, new String(SENT), Symbol(SENT), 10n]

//desc, 輸入值之標籤(僅供斷言列之對照; 已撤銷之Proxy等不可讀者不得使標籤本身拋錯)
let desc = (v) => {
    try {
        return typeof v === 'symbol' ? 'symbol' : typeof v === 'bigint' ? 'bigint' : (JSON.stringify(v) ?? typeof v)
    }
    catch {
        return 'unreadable'
    }
}
let isParams = (t) => t.ok === false && t.errorType === 'params' && t.attempts === 0
let noEcho = (t) => {
    let s = String(t.error)
    return !s.includes(SENT) && !s.includes(KEY) && !s.includes(String(NUM)) && !s.includes('64000')
}


describe('影響計費之opt給了而無效 → 拒絕(排程第553項裁定; 規則11)', function() {

    let fake = null
    let savedPath = null
    let realFetch = null
    let fcalls = [] //全域fetch替身收到之請求
    let bodyOf = (c) => {
        try {
            return JSON.parse(c.init.body)
        }
        catch {
            return null
        }
    }

    before(function() {
        savedPath = process.env.PATH === undefined ? null : process.env.PATH
        process.env.PATH = pathWithoutRealCli()
        fs.mkdirSync(MARK_DIR, { recursive: true })
        fake = createFakeCli('fake-billing-opts', MARK_CODE)
        realFetch = globalThis.fetch
        globalThis.fetch = async (url, init) => {
            fcalls.push({ url: String(url), init })
            return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], status: 'completed', answers: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
    })

    after(function() {
        if (savedPath !== null) {
            process.env.PATH = savedPath
        }
        if (realFetch !== null) {
            globalThis.fetch = realFetch
        }
        if (fake) {
            fake.clean()
        }
        fs.rmSync(MARK_DIR, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(MARK_DIR))
        }
        catch {}
    })

    beforeEach(function() {
        fcalls.length = 0
        fs.rmSync(MARK_FILE, { force: true })
    })

    let spawned = () => fs.existsSync(MARK_FILE)

    //---------- B1: model ----------
    let cliModel = {
        'dispatchCodex': { call: (o) => dispatchCodex('abc', { exe: fake.exe, ...o }), flag: '-m' },
        'dispatchClaude': { call: (o) => dispatchClaude('abc', { exe: fake.exe, ...o }), flag: '--model' },
        'dispatchOpencode': { call: (o) => dispatchOpencode('abc', { exe: fake.exe, ...o }), flag: '-m' },
        'dispatchAntigravity': { call: (o) => dispatchAntigravity('abc', { exe: fake.exe, ...o }), flag: '--model' },
    }

    for (let [name, { call, flag }] of Object.entries(cliModel)) {

        it(`B1 ${name}: model給了而非原始非空字串以params拒絕且不起子行程(不改用CLI預設模型); 訊息不回顯(B9)`, async function() {
            let r = []
            for (let v of badNames()) {
                fs.rmSync(MARK_FILE, { force: true })
                let t = await call({ model: v })
                r.push([desc(v), isParams(t), noEcho(t), /^model must be a non-empty string/.test(String(t.error)), spawned()])
            }
            assert.strict.deepEqual(r, badNames().map((v) => [desc(v), true, true, true, false]))
        })

        it(`B1 ${name}: model未給(undefined、null、'')不帶${flag}旗標; 有效字串帶旗標(合法輸入之行為不變)`, async function() {
            let rows = []
            for (let v of [undefined, null, '']) {
                let t = await call({ model: v })
                rows.push([t.ok, JSON.parse(t.stdout).args.includes(flag)])
            }
            assert.strict.deepEqual(rows, [[true, false], [true, false], [true, false]])
            let t = await call({ model: 'some-model' })
            let a = JSON.parse(t.stdout).args
            assert.strict.deepEqual([t.ok, a[a.indexOf(flag) + 1]], [true, 'some-model'])
        })

    }

    it('B1 dispatchApiTypesafeSystemone: model給了而非原始非空字串以params拒絕、不送請求(不改用官方預設jev-latest); 未給(undefined、null、\'\')用預設, 有效字串照用', async function() {
        let call = (o) => dispatchApiTypesafeSystemone('abc', { questions: { q1: { type: 'text' } }, baseURL: 'http://127.0.0.1:1', key: KEY, ...o })
        let r = []
        for (let v of badNames()) {
            let t = await call({ model: v })
            r.push([desc(v), isParams(t), noEcho(t), /^model must be a non-empty string/.test(String(t.error))])
        }
        assert.strict.deepEqual(r, badNames().map((v) => [desc(v), true, true, true]))
        assert.strict.deepEqual(fcalls.length, 0)
        for (let v of [undefined, null, '']) {
            await call({ model: v })
        }
        await call({ model: 'jev-preview' })
        assert.strict.deepEqual(fcalls.map((c) => bodyOf(c).model), ['jev-latest', 'jev-latest', 'jev-latest', 'jev-preview'])
    })

    it('B1 dispatchApiAnthropic／OpenaiCompat／OpenaiResponses: model必填(未給或無效本就以params拒絕, 保持案; 本輪不改)', async function() {
        let rows = []
        for (let v of [undefined, null, '', NUM, {}]) {
            let a = await dispatchApiAnthropic('abc', { key: KEY, model: v })
            let b = await dispatchApiOpenaiCompat('abc', { baseURL: 'http://127.0.0.1:1/v1', model: v })
            let c = await dispatchApiOpenaiResponses('abc', { baseURL: 'http://127.0.0.1:1/v1', model: v })
            rows.push([a, b, c].map((t) => isParams(t) && /^model must be a non-empty string/.test(String(t.error))))
        }
        assert.strict.deepEqual(rows, [0, 1, 2, 3, 4].map(() => [true, true, true]))
        assert.strict.deepEqual(fcalls.length, 0)
    })

    //---------- B2: agy effort ----------
    it('B2 dispatchAntigravity: effort給了而非原始非空字串以params拒絕且不起子行程(不改用agy預設檔位); 未給(undefined、null、\'\')不帶--effort; 有效字串帶旗標', async function() {
        let call = (o) => dispatchAntigravity('abc', { exe: fake.exe, ...o })
        let r = []
        for (let v of badNames()) {
            fs.rmSync(MARK_FILE, { force: true })
            let t = await call({ effort: v })
            r.push([desc(v), isParams(t), noEcho(t), /^effort must be a non-empty string/.test(String(t.error)), spawned()])
        }
        assert.strict.deepEqual(r, badNames().map((v) => [desc(v), true, true, true, false]))
        let rows = []
        for (let v of [undefined, null, '']) {
            let t = await call({ effort: v })
            rows.push([t.ok, JSON.parse(t.stdout).args.includes('--effort')])
        }
        assert.strict.deepEqual(rows, [[true, false], [true, false], [true, false]])
        let t = await call({ effort: 'high' })
        let a = JSON.parse(t.stdout).args
        assert.strict.deepEqual([t.ok, a[a.indexOf('--effort') + 1]], [true, 'high'])
    })

    it('B2 dispatchAntigravity: model、effort無效者於stdin路徑之agy --version探測之前即拒絕(記號假執行檔零次被啟動); 有效者為對照(確會啟動)', async function() {
        for (let o of [{ model: NUM }, { effort: {} }]) {
            fs.rmSync(MARK_FILE, { force: true })
            let t = await dispatchAntigravity('abc', { exe: fake.exe, promptVia: 'stdin', ...o })
            assert.strict.deepEqual([isParams(t), spawned()], [true, false])
        }
        fs.rmSync(MARK_FILE, { force: true })
        await dispatchAntigravity('abc', { exe: fake.exe, promptVia: 'stdin', model: 'm', effort: 'low' })
        assert.strict.deepEqual(spawned(), true)
    })

    //---------- B3: opencode outputTokenMax ----------
    it('B3 dispatchOpencode: outputTokenMax給了而無效(0、負數、小數、非數字字串、\'\'、布林、Infinity、NaN、物件、陣列、包裝物件、函數、BigInt、\'0x10\')以params拒絕且不起子行程(不改用預設128000); 訊息不回顯', async function() {
        let r = []
        for (let v of badTokens()) {
            fs.rmSync(MARK_FILE, { force: true })
            let t = await dispatchOpencode('abc', { exe: fake.exe, outputTokenMax: v })
            r.push([desc(v), isParams(t), noEcho(t), /^outputTokenMax must be a positive integer \(number or numeric string\) when given/.test(String(t.error)), spawned()])
        }
        assert.strict.deepEqual(r, badTokens().map((v) => [desc(v), true, true, true, false]))
    })

    it('B3 dispatchOpencode: outputTokenMax未給(undefined、null)用預設128000; 有效(數字、數字字串、頭尾空白、科學記號)採用且蓋過呼叫端環境; 子行程收到之值即檢查之值(K4)', async function() {
        let max = async (o) => JSON.parse((await dispatchOpencode('abc', { exe: fake.exe, ...o })).stdout).max
        let rows = [
            await max({}), await max({ outputTokenMax: undefined }), await max({ outputTokenMax: null }),
            await max({ outputTokenMax: 64000 }), await max({ outputTokenMax: '96000' }), await max({ outputTokenMax: ' 1e5 ' }),
            await max({ outputTokenMax: 32000, env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '50000' } }),
            await max({ env: { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '50000' } }), //未給opt: 保留呼叫端環境之有效值
        ]
        assert.strict.deepEqual(rows, ['128000', '128000', '128000', '64000', '96000', '100000', '32000', '50000'])
    })

    //---------- B4: anthropic effort ----------
    it('B4 dispatchApiAnthropic: effort給了而不在{low,medium,high,xhigh,max}內以params拒絕、不送請求(不改用API依模型之預設檔位); 大小寫與前後空白亦拒; 訊息列出允許集合而不寫給定之值', async function() {
        let call = (o) => dispatchApiAnthropic('abc', { key: KEY, model: 'claude-x', ...o })
        let r = []
        for (let v of ['ultra', 'LOW', ' low', 'low ', NUM, true, {}, [], new String('low'), hostile(), revoked(), () => 1, 10n]) {
            let t = await call({ effort: v })
            r.push([desc(v), isParams(t), noEcho(t), /^effort must be one of low, medium, high, xhigh, max when given \(got \w+\)/.test(String(t.error))])
        }
        assert.strict.deepEqual(r.map((x) => x.slice(1)), r.map(() => [true, true, true]))
        assert.strict.deepEqual(fcalls.length, 0)
        for (let v of ANTHROPIC_EFFORTS) {
            await call({ effort: v })
        }
        for (let v of [undefined, null, '']) {
            await call({ effort: v })
        }
        assert.strict.deepEqual(fcalls.map((c) => bodyOf(c).output_config), [...ANTHROPIC_EFFORTS.map((e) => ({ effort: e })), undefined, undefined, undefined])
    })

    //---------- B5: REST body ----------
    let rest = {
        'dispatchApiAnthropic': (o) => dispatchApiAnthropic('abc', { key: KEY, model: 'claude-x', ...o }),
        'dispatchApiOpenaiCompat': (o) => dispatchApiOpenaiCompat('abc', { baseURL: 'http://127.0.0.1:1/v1', model: 'm', ...o }),
        'dispatchApiOpenaiResponses': (o) => dispatchApiOpenaiResponses('abc', { baseURL: 'http://127.0.0.1:1/v1', model: 'm', ...o }),
        'dispatchApiTypesafeSystemone': (o) => dispatchApiTypesafeSystemone('abc', { questions: { q1: { type: 'text' } }, baseURL: 'http://127.0.0.1:1', key: KEY, ...o }),
    }

    for (let [name, call] of Object.entries(rest)) {

        it(`B5 ${name}: body給了而非一般物件(字串、數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt、'')以params拒絕、不送請求(不略過而用預設max_tokens)`, async function() {
            let r = []
            for (let v of badBodies()) {
                let t = await call({ body: v })
                r.push([desc(v), isParams(t), noEcho(t), /^body must be an object when given \(got \w+\)/.test(String(t.error))])
            }
            assert.strict.deepEqual(r, badBodies().map((v) => [desc(v), true, true, true]))
            assert.strict.deepEqual(fcalls.length, 0)
        })

        it(`B5 ${name}: body未給(undefined、null)、空物件、一般物件照舊(併入請求本體)`, async function() {
            for (let v of [undefined, null, {}]) {
                await call({ body: v })
            }
            await call({ body: { max_tokens: 777, SENTINEL_FIELD: 1 } })
            assert.strict.deepEqual(fcalls.length, 4)
            let last = bodyOf(fcalls[3])
            assert.strict.deepEqual([last.SENTINEL_FIELD, name === 'dispatchApiOpenaiResponses' ? 'n/a' : last.max_tokens], [1, name === 'dispatchApiOpenaiResponses' ? 'n/a' : 777])
        })

    }

    //---------- B6: fetch、crossCheck ----------
    it('B6 dispatchApiAnthropic: fetch給了而非函數以params拒絕、不送請求(不改走全域fetch而發出真實請求); 未給(undefined、null)用全域fetch; 函數照用', async function() {
        let r = []
        for (let v of badFuns()) {
            let t = await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-x', fetch: v })
            r.push([desc(v), isParams(t), noEcho(t), /^fetch must be a function when given/.test(String(t.error))])
        }
        assert.strict.deepEqual(r, badFuns().map((v) => [desc(v), true, true, true]))
        assert.strict.deepEqual(fcalls.length, 0)
        await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-x', fetch: undefined })
        await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-x', fetch: null })
        assert.strict.deepEqual(fcalls.length, 2) //全域fetch替身
        let own = []
        let ownFetch = async (u) => {
            own.push(String(u))
            return new Response(JSON.stringify({ content: [{ type: 'text', text: 'own' }], stop_reason: 'end_turn' }), { status: 200 })
        }
        let t = await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-x', fetch: ownFetch })
        assert.strict.deepEqual([t.ok, t.stdout, own.length, fcalls.length], [true, 'own', 1, 2])
    })

    it('B6 dispatchClaude: crossCheck給了而非布林、fetch給了而非函數以params拒絕且不起子行程(不多發交叉確認請求、不改走全域fetch); 未給與有效者照舊', async function() {
        let call = (o) => dispatchClaude('abc', { exe: fake.exe, key: KEY, ...o })
        let r = []
        for (let v of badBools()) {
            fs.rmSync(MARK_FILE, { force: true })
            let t = await call({ crossCheck: v })
            r.push([desc(v), isParams(t), noEcho(t), /^crossCheck must be a boolean when given/.test(String(t.error)), spawned()])
        }
        assert.strict.deepEqual(r, badBools().map((v) => [desc(v), true, true, true, false]))
        let r2 = []
        for (let v of badFuns()) {
            fs.rmSync(MARK_FILE, { force: true })
            let t = await call({ fetch: v })
            r2.push([desc(v), isParams(t), noEcho(t), /^fetch must be a function when given/.test(String(t.error)), spawned()])
        }
        assert.strict.deepEqual(r2, badFuns().map((v) => [desc(v), true, true, true, false]))
        for (let o of [{}, { crossCheck: undefined }, { crossCheck: null }, { crossCheck: true }, { crossCheck: false }, { fetch: undefined }, { fetch: null }, { fetch: async () => new Response('{}') }]) {
            let t = await call(o)
            assert.strict.deepEqual(t.ok, true)
        }
        assert.strict.deepEqual(fcalls.length, 0)
    })

    //---------- B7: checkSafeOpts與遞補層 ----------
    it('B7 checkSafeOpts: 各kind之計費相關opt給了而無效回訊息; 有效、未給、\'\'(name型)回空字串; 表外之kind與opt回空字串', function() {
        let bad = [
            ['claude', { model: NUM }], ['claude', { crossCheck: 'no' }], ['claude', { fetch: 'x' }],
            ['codex', { model: {} }],
            ['opencode', { model: true }], ['opencode', { outputTokenMax: 'abc' }], ['opencode', { outputTokenMax: '' }],
            ['antigravity', { model: [] }], ['antigravity', { effort: 5 }],
            ['api-anthropic', { effort: 'ultra' }], ['api-anthropic', { body: 'x' }], ['api-anthropic', { fetch: 'x' }],
            ['api-typesafe-systemone', { model: 5 }], ['api-typesafe-systemone', { body: [] }],
            ['api-openai-compat', { body: 'x' }], ['api-openai-responses', { body: 1 }],
        ]
        assert.strict.deepEqual(bad.map(([k, o]) => checkSafeOpts(k, o) !== ''), bad.map(() => true))
        assert.strict.deepEqual(bad.map(([k, o]) => !checkSafeOpts(k, o).includes(String(NUM)) && !checkSafeOpts(k, o).includes('abc')), bad.map(() => true)) //K9
        let ok = [
            ['claude', { model: 'm', crossCheck: false, fetch: () => 1 }], ['claude', { model: '', crossCheck: undefined, fetch: null }],
            ['codex', { model: 'gpt' }], ['codex', { model: '' }],
            ['opencode', { model: 'a/b', outputTokenMax: 32000 }], ['opencode', { outputTokenMax: '64000' }], ['opencode', { outputTokenMax: null }],
            ['antigravity', { model: 'm', effort: 'high' }], ['antigravity', { effort: '' }],
            ['api-anthropic', { effort: 'max', body: { max_tokens: 5 }, fetch: () => 1 }], ['api-anthropic', { effort: '', body: null }],
            ['api-typesafe-systemone', { model: 'jev-preview', body: {} }], ['api-typesafe-systemone', {}],
            ['api-openai-compat', { body: { temperature: 0 } }], ['api-openai-responses', { body: undefined }],
        ]
        assert.strict.deepEqual(ok.map(([k, o]) => checkSafeOpts(k, o)), ok.map(() => ''))
        assert.strict.deepEqual([checkSafeOpts('unknown-kind', { model: NUM }), checkSafeOpts('claude', { nonexistent: NUM })], ['', ''])
    })

    it('B7 遞補層: 條目之計費相關opt給了而無效走條目層params、不發try事件、不起子行程／不送請求; 正常條目照發try', async function() {
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [
                { id: 'bad:claude-model', kind: 'claude', exe: fake.exe, model: NUM },
                { id: 'bad:claude-cc', kind: 'claude', exe: fake.exe, crossCheck: 'no' },
                { id: 'bad:claude-fetch', kind: 'claude', exe: fake.exe, fetch: 'x' },
                { id: 'bad:codex', kind: 'codex', exe: fake.exe, model: true },
                { id: 'bad:opencode-model', kind: 'opencode', exe: fake.exe, model: {} },
                { id: 'bad:opencode-tok', kind: 'opencode', exe: fake.exe, outputTokenMax: 'abc' },
                { id: 'bad:agy-model', kind: 'antigravity', exe: fake.exe, model: [] },
                { id: 'bad:agy-effort', kind: 'antigravity', exe: fake.exe, effort: 5 },
                { id: 'bad:anth-effort', kind: 'api-anthropic', model: 'm', keys: [KEY], effort: 'ultra' },
                { id: 'bad:anth-body', kind: 'api-anthropic', model: 'm', keys: [KEY], body: 'x' },
                { id: 'bad:typesafe-model', kind: 'api-typesafe-systemone', questions: { q1: { type: 'text' } }, keys: [KEY], model: 7 },
                { id: 'bad:compat-body', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1/v1', model: 'm', keys: [KEY], body: [] },
                { id: 'bad:responses-body', kind: 'api-openai-responses', baseURL: 'http://127.0.0.1:1/v1', model: 'm', keys: [KEY], body: 'x' },
                { id: 'ok:one', kind: 'claude', exe: fake.exe, model: 'sonnet', crossCheck: false },
            ],
            onEvent: (ev) => events.push(ev),
        })
        let tries = events.filter((e) => e.type === 'try').map((e) => e.providerId)
        let want = r.tried.slice(0, 13).map(() => 'params')
        assert.strict.deepEqual(r.tried.map((t) => t.errorType), [...want, undefined])
        assert.strict.deepEqual([r.ok, r.providerId, tries, fcalls.length], [true, 'ok:one', ['ok:one'], 0])
    })

    //---------- B8: 維持K3之opt(保持案) ----------
    it('B8 維持K3(不改變計費之opt, 給了無效照舊視為未給; 保持案): checkSafeOpts不判maxRetries、timeoutMs、agent、promptVia、stopOnLimit、detectTruncation、crossCheckModel、crossCheckBaseURL、system、headers、acceptTruncated等', function() {
        let k3 = {
            'claude': { maxRetries: 'x', timeoutMs: {}, extraArgs: 5, validate: 5, crossCheckModel: 5, crossCheckBaseURL: 5, spawnGate: 'x' },
            'codex': { maxRetries: Infinity, timeoutMs: 'abc', extraArgs: 5 },
            'opencode': { agent: 5, stopOnLimit: 'x', detectTruncation: 'x', continueLoopOnDeny: 'x', acceptTruncated: 'x', maxRetries: -1 }, //config自tdai2b起給了而非字串亦非物件即拒絕(見unit-patchCatalogueConfig O1/O2), 不在此維持K3之列
            'antigravity': { promptVia: 'zzz', printTimeout: 5, timeoutMs: -5 },
            'api-anthropic': { system: 5, headers: 'x', acceptTruncated: 'x', maxRetries: 'x', timeoutMs: 'x', retryDelayMs: 'x' },
            'api-openai-compat': { system: 5, headers: 'x', acceptTruncated: 'x' },
        }
        for (let [k, o] of Object.entries(k3)) {
            assert.strict.deepEqual([k, checkSafeOpts(k, o)], [k, ''])
        }
    })

    it('B8 維持K3(行為): opencode之agent給了無效退回build、codex之maxRetries為Infinity視為未給(不無限重試)、agy之promptVia無效用auto(argv)', async function() {
        let o = JSON.parse((await dispatchOpencode('abc', { exe: fake.exe, agent: NUM })).stdout)
        assert.strict.deepEqual([o.args[o.args.indexOf('--agent') + 1]], ['build'])
        let fx = createFakeCli('fake-billing-opts-exit') //預設假CLI(支援--fake-exit=N)
        try {
            let c = await dispatchCodex('abc', { exe: fx.exe, maxRetries: Infinity, extraArgs: ['--fake-exit=1'], timeoutMs: 'abc' })
            assert.strict.deepEqual([c.ok, c.attempts], [false, 1])
        }
        finally {
            fx.clean()
        }
        let a = JSON.parse((await dispatchAntigravity('abc', { exe: fake.exe, promptVia: 'zzz', printTimeout: NUM })).stdout)
        assert.strict.deepEqual([a.args.includes('--print'), a.args.includes('--input-format')], [true, false])
    })

    //---------- B9: 單一來源之reader ----------
    it('B1～B6 readers(單一來源): 回傳值即使用之值; 未給回null值與空訊息; 訊息只含參數名與typeof', function() {
        assert.strict.deepEqual([readNameOpt('m', 'model'), readNameOpt('', 'model'), readNameOpt(undefined, 'model'), readNameOpt(null, 'model')], [{ value: 'm', err: '' }, { value: null, err: '' }, { value: null, err: '' }, { value: null, err: '' }])
        assert.strict.deepEqual(readNameOpt(NUM, 'model').err, 'model must be a non-empty string when given (got number); an invalid model is rejected instead of silently falling back to the default')
        assert.strict.deepEqual([readEnumOpt('high', 'effort', ANTHROPIC_EFFORTS).value, readEnumOpt('', 'effort', ANTHROPIC_EFFORTS).value, readEnumOpt('x', 'effort', ANTHROPIC_EFFORTS).err.startsWith('effort must be one of low, medium, high, xhigh, max')], ['high', null, true])
        assert.strict.deepEqual([readEnumOpt('toString', 'effort', ANTHROPIC_EFFORTS).err !== '', readEnumOpt('constructor', 'effort', ANTHROPIC_EFFORTS).err !== ''], [true, true]) //不經原型鏈
        assert.strict.deepEqual([readTokenMaxOpt(64000, 'outputTokenMax').value, readTokenMaxOpt('64000', 'outputTokenMax').value, readTokenMaxOpt(' 1e5 ', 'outputTokenMax').value, readTokenMaxOpt(undefined, 'outputTokenMax').value, readTokenMaxOpt(null, 'outputTokenMax').err], [64000, 64000, 100000, null, ''])
        assert.strict.deepEqual(badTokens().map((v) => readTokenMaxOpt(v, 'outputTokenMax').err !== ''), badTokens().map(() => true))
        let f = () => 1
        assert.strict.deepEqual([readFunOpt(f, 'fetch').value === f, readFunOpt(undefined, 'fetch').err, readFunOpt('x', 'fetch').err !== ''], [true, '', true])
        assert.strict.deepEqual([checkReadObj(undefined, 'body'), checkReadObj(null, 'body'), checkReadObj({}, 'body'), checkReadObj('x', 'body') !== '', checkReadObj([], 'body') !== '', checkReadObj(new Map(), 'body') !== ''], ['', '', '', true, true, true])
    })

})
