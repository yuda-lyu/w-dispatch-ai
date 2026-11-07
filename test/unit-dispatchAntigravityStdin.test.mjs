import assert from 'assert'
import fs from 'fs'
import path from 'path'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { createQuotaGateState } from '../src/goQuotaGate.mjs'
import { clearAgyStdinSupportCache } from '../src/checkAgyStdinSupport.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//帳本: sgud/rule/rulebook_agy.md「R-AGY-4 提示詞傳法(promptVia)與stdin路徑之判成敗」(Gitea #94)
//假agy: 重現agy 1.5.2於2026-11-07本機實測之stream-json形狀(皆為實測形狀, 非臆造):
//  --version                         印版本號
//  無--input-format                  argv路徑: 把args以JSON印回(同一般假CLI)
//  --input-format stream-json        自stdin讀NDJSON, 輸出NDJSON事件(init, step_update, result)
//  -p/--print併--input-format        exit 2, stderr「Error: --input-format stream-json reads prompts from stdin, ...」
//  不認得之旗標(noFlag)              exit 2, stderr「flags provided but not defined: -input-format」(Go flag套件)
//  輸入訊息內容以[[mode]]開頭者依mode回應(mode見下), 無標記為ok
//    ok       result SUCCESS, response為JSON {args, stdin, content}(供測試檢視agy實際收到什麼)
//    echo     result SUCCESS, response為輸入內容原文
//    error0   result ERROR(error為quota exceeded), exit 0
//    error1   result ERROR, exit 1
//    noresult 只印init, stderr為「warning: ignoring unsupported stream input message event」, exit 0(實測: 不認得之輸入事件)
//    empty    什麼都不印, exit 0
//    plain    印非JSON文字, exit 0
//    emptyresp result SUCCESS, response為空字串(NDJSON本身非空)
//    jsonresp  result SUCCESS, response為{"a":1}(NDJSON整體不是合法JSON)
let codeAgy = (version, noFlag = false) => `
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
let here = path.dirname(fileURLToPath(import.meta.url))
let log = path.resolve(here, '..', '..', 'calls.log')
let args = process.argv.slice(2)
let VERSION = ${JSON.stringify(version)}
if (args[0] === '--version') {
    fs.appendFileSync(log, 'version\\n')
    if (VERSION === null) {
        process.stderr.write('boom\\n')
        process.exit(1)
    }
    process.stdout.write(VERSION + '\\n')
    process.exit(0)
}
if (${noFlag} && args.includes('--input-format')) {
    fs.appendFileSync(log, 'noflag\\n')
    process.stderr.write('flags provided but not defined: -input-format\\nUsage of agy.exe:\\n  --add-dir ...\\n')
    process.exit(2)
}
let chunks = []
process.stdin.on('data', (c) => {
    chunks.push(c)
})
process.stdin.on('end', () => {
    let stdin = Buffer.concat(chunks).toString('utf8')
    if (!args.includes('--input-format')) {
        fs.appendFileSync(log, 'argv\\n')
        process.stdout.write(JSON.stringify({ via: 'argv', args, stdin }))
        process.exit(0)
    }
    if (args.includes('-p') || args.includes('--print')) {
        process.stderr.write('Error: --input-format stream-json reads prompts from stdin, so a prompt given on the command line would be ignored\\n')
        process.exit(2)
    }
    fs.appendFileSync(log, 'stdin\\n')
    let msg = JSON.parse(stdin.split('\\n')[0])
    let content = msg.message.content
    let m = /^\\[\\[(\\w+)\\]\\]/.exec(content)
    let mode = m ? m[1] : 'ok'
    let out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
    if (mode === 'empty') {
        process.exit(0)
    }
    if (mode === 'plain') {
        process.stdout.write('hello\\n')
        process.exit(0)
    }
    out({ event: 'init', conversation_id: 'c1', init: { model: 'x', tools: ['a', 'b'] } })
    if (mode === 'noresult') {
        process.stderr.write('warning: ignoring unsupported stream input message event "user_message"\\n')
        process.exit(0)
    }
    out({ event: 'step_update', step_type: 'model_response' })
    let res = (status, response, error) => out({ event: 'result', result: { conversation_id: 'c1', status, response, ...(error ? { error } : {}), num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } } })
    if (mode === 'error0' || mode === 'error1') {
        res('ERROR', '', 'quota exceeded')
        process.exit(mode === 'error1' ? 1 : 0)
    }
    if (mode === 'echo') {
        res('SUCCESS', content)
    }
    else if (mode === 'emptyresp') {
        res('SUCCESS', '')
    }
    else if (mode === 'jsonresp') {
        res('SUCCESS', '{"a":1}')
    }
    else {
        res('SUCCESS', JSON.stringify({ args, stdin, content }))
    }
    process.exit(0)
})
`


describe('dispatchAntigravity: promptVia與stdin路徑(stream-json; Gitea #94)', function() {

    let tag = `${process.pid}`
    let fakes = {}
    let mk = (name, version, noFlag = false) => {
        fakes[name] = createFakeCli(`fake-agy-stdin-${tag}-${name}`, codeAgy(version, noFlag))
    }
    let logOf = (name) => {
        let f = path.join(fakes[name].fd, 'calls.log')
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((s) => s !== '') : []
    }
    let resetLog = (name) => {
        fs.rmSync(path.join(fakes[name].fd, 'calls.log'), { force: true })
        clearAgyStdinSupportCache()
    }
    let call = async (name, prompt, opt = {}) => {
        resetLog(name)
        return dispatchAntigravity(prompt, { exe: fakes[name].exe, timeoutMs: 30000, ...opt })
    }
    let big = (n, mode = '[[ok]]') => mode + 'x'.repeat(n - mode.length)

    before(function() {
        mk('new', '1.5.2')
        mk('old', '1.1.14')
        mk('edge', '1.1.15')
        mk('ten', '1.10.0')
        mk('nover', null) //--version失敗(離開碼1): 探測不確定, 放行
        mk('weird', 'build-xyz', true) //--version解析不出版本號且不認得--input-format: 放行後由旗標錯誤改寫為升級指引
    })

    after(function() {
        for (let k of Object.keys(fakes)) {
            fakes[k].clean()
        }
    })

    describe('A. 傳法分流(promptVia: argv／stdin／auto)', function() {

        it('[修前紅] 預設(auto)下35000字元prompt可派: 不回prompt too long、走stdin(argv不帶--print)、attempts 1', async function() {
            //規格: Gitea #94 建議A+C「超過MAX_PROMPT_LENGTH由params失敗變為可成交」; 修前此案回{ok:false, error:'prompt too long (35000 chars > 30000)…', attempts:0}
            let p = big(35000)
            let t = await call('new', p)
            let o = t.ok ? JSON.parse(t.stdout) : null
            assert.strict.deepEqual([t.ok, t.attempts, o && o.content === p, o && o.args.includes('--print')], [true, 1, true, false])
            assert.strict.deepEqual(logOf('new'), ['version', 'stdin'])
        })

        it('auto: 30000字元(含)以內走argv(與修前相同、不探測版本)、30001字元起走stdin', async function() {
            let a = await call('new', 'x'.repeat(30000))
            let la = logOf('new')
            let b = await call('new', 'x'.repeat(30001))
            let lb = logOf('new')
            let oa = JSON.parse(a.stdout)
            assert.strict.deepEqual([a.ok, oa.via, oa.args[oa.args.length - 2], la], [true, 'argv', '--print', ['argv']])
            assert.strict.deepEqual([b.ok, lb], [true, ['version', 'stdin']])
        })

        it('argv: 超過30000字元仍回prompt too long(params、attempts 0、不spawn); 不超過者走--print', async function() {
            let t = await call('new', 'x'.repeat(30001), { promptVia: 'argv' })
            let r = [t.ok, t.error.indexOf('prompt too long (30001 chars > 30000)') === 0, t.errorType, t.attempts, logOf('new')]
            assert.strict.deepEqual(r, [false, true, 'params', 0, []])
            let s = await call('new', 'abc', { promptVia: 'argv' })
            let o = JSON.parse(s.stdout)
            assert.strict.deepEqual([s.ok, o.via, o.args.slice(-2)], [true, 'argv', ['--print', 'abc']])
        })

        it('stdin: 短prompt亦走stdin(不帶--print), 固定旗標接在extraArgs之後; 與argv路徑共用的旗標(skipPermissions、print-timeout、model、effort、addDirs)順序相同', async function() {
            let t = await call('new', 'abc', { promptVia: 'stdin', model: 'gemini-4-argon', effort: 'low', extraArgs: ['--mode', 'plan'] })
            let o = JSON.parse(t.stdout)
            let rr = ['--dangerously-skip-permissions', '--print-timeout', '60s', '--model', 'gemini-4-argon', '--effort', 'low', '--add-dir', process.cwd(), '--mode', 'plan', '--input-format', 'stream-json', '--output-format', 'stream-json']
            assert.strict.deepEqual([t.ok, o.args], [true, rr])
            let t2 = await call('new', 'abc', { promptVia: 'stdin', skipPermissions: false, addDirs: [], printTimeout: '90s' })
            assert.strict.deepEqual(JSON.parse(t2.stdout).args, ['--print-timeout', '90s', '--input-format', 'stream-json', '--output-format', 'stream-json'])
        })

        it('promptVia無效值(非字串、未知字串、大小寫不同)回退預設auto', async function() {
            let r = []
            for (let v of [null, undefined, 123, {}, 'Stdin', 'bogus', '']) {
                let a = await call('new', 'abc', { promptVia: v })
                let b = await call('new', 'x'.repeat(30001), { promptVia: v })
                r.push([JSON.parse(a.stdout).via, b.ok])
            }
            assert.strict.deepEqual(r, new Array(7).fill(['argv', true]))
        })

        it('經dispatchAiFallback: 條目帶promptVia原樣轉傳; 35000字元於預設走stdin成交(tried為ok)', async function() {
            let p = big(35000, '[[echo]]')
            resetLog('new')
            let r = await dispatchAiFallback(p, { providers: [{ id: 'agy:x', kind: 'antigravity', exe: fakes.new.exe, model: 'm', skipPermissions: false, addDirs: ['.'] }], timeoutMs: 30000, quotaGate: false })
            assert.strict.deepEqual([r.ok, r.stdout === p, r.tried.map((t) => t.outcome)], [true, true, ['ok']])
            resetLog('new')
            let r2 = await dispatchAiFallback('abc', { providers: [{ id: 'agy:y', kind: 'antigravity', exe: fakes.new.exe, model: 'm', skipPermissions: false, addDirs: ['.'], promptVia: 'stdin' }], timeoutMs: 30000, quotaGate: false })
            assert.strict.deepEqual([r2.ok, logOf('new')], [true, ['version', 'stdin']])
        })

    })

    describe('B. stdin內容: 單行NDJSON', function() {

        it('stdin恰為一行{event:"user",message:{role:"user",content}}加換行; 含換行、引號、反斜線、中文、U+2028之prompt不破壞單行且內容完整', async function() {
            let p = '[[ok]]第一行\n第二行 "quoted" \'single\' \\back\\slash\r\n中文\u2028分隔\t tab {"event":"result"}'
            let t = await call('new', p, { promptVia: 'stdin' })
            let o = JSON.parse(t.stdout)
            assert.strict.deepEqual(o.stdin.endsWith('\n'), true)
            assert.strict.deepEqual(o.stdin.split('\n').length, 2) //一行內容 + 結尾換行後之空字串
            assert.strict.deepEqual(JSON.parse(o.stdin.split('\n')[0]), { event: 'user', message: { role: 'user', content: p } })
            assert.strict.deepEqual(o.content, p)
        })

        it('35000字元prompt經stdin完整抵達(含引號大量時不受命令列轉義膨脹影響)', async function() {
            let p = '[[echo]]' + '"'.repeat(35000)
            let t = await call('new', p, { promptVia: 'stdin' })
            assert.strict.deepEqual([t.ok, t.stdout === p], [true, true])
        })

    })

    describe('C. 輸出解析: 只看result事件', function() {

        it('SUCCESS: ok:true, stdout為result.response(純回覆文字, 非NDJSON), 原始NDJSON放raw(含init與result事件)', async function() {
            let t = await call('new', '[[echo]]你好\n世界', { promptVia: 'stdin' })
            let evs = t.raw.split('\n').filter((s) => s !== '').map((s) => JSON.parse(s).event)
            assert.strict.deepEqual([t.ok, t.stdout, t.error, t.errorType, evs], [true, '[[echo]]你好\n世界', '', undefined, ['init', 'step_update', 'result']])
        })

        it('result.status為ERROR(離開碼0): ok:false, errorType exec, error含status與agy之錯誤說明', async function() {
            let t = await call('new', '[[error0]]', { promptVia: 'stdin' })
            assert.strict.deepEqual([t.ok, t.errorType, t.code, t.error], [false, 'exec', 0, 'agy stream-json: result status ERROR: quota exceeded'])
        })

        it('result.status為ERROR且離開碼非0: ok:false, 保留Exit code並附result status說明, stdout為(截斷後之)response而非NDJSON', async function() {
            let t = await call('new', '[[error1]]', { promptVia: 'stdin' })
            assert.strict.deepEqual([t.ok, t.errorType, t.code, t.error, t.stdout], [false, 'exec', 1, 'Exit code 1 | agy stream-json: result status ERROR: quota exceeded', ''])
        })

        it('只印init(agy忽略不認得之輸入事件)且離開碼0: ok:false, error寫明「no result event」並附stderr, 不得因離開碼0或stdout非空判成功', async function() {
            //規格: Gitea #94「無 result 事件一律判失敗」; 實測形狀: stdout只有init、stderr為warning、離開碼0
            let t = await call('new', '[[noresult]]', { promptVia: 'stdin' })
            assert.strict.deepEqual([t.ok, t.code, t.errorType, t.stdout, t.error.includes('no result event'), t.error.includes('ignoring unsupported stream input message event'), t.raw.includes('"event":"init"')], [false, 0, 'exec', '', true, true, true])
        })

        it('什麼都沒印(離開碼0)、只印非JSON文字(離開碼0): 一律ok:false(no result event)', async function() {
            let a = await call('new', '[[empty]]', { promptVia: 'stdin' })
            let b = await call('new', '[[plain]]', { promptVia: 'stdin' })
            assert.strict.deepEqual([a, b].map((t) => [t.ok, t.errorType, t.stdout, t.error.includes('no result event')]), [[false, 'exec', '', true], [false, 'exec', '', true]])
        })

        it('validate在改寫stdout之後判定: nonempty對「NDJSON非空但response為空」判失敗(validation); json對response為JSON者通過(NDJSON整體不是合法JSON)', async function() {
            //若validate看到的是原始NDJSON: 前案會誤過(NDJSON非空)、後案會誤敗(多行NDJSON不是單一JSON)
            let a = await call('new', '[[emptyresp]]', { promptVia: 'stdin', validate: 'nonempty' })
            let b = await call('new', '[[jsonresp]]', { promptVia: 'stdin', validate: 'json' })
            let c = await call('new', '[[echo]]x', { promptVia: 'stdin', validate: 'nonempty' })
            assert.strict.deepEqual([a.ok, a.errorType, a.error], [false, 'validation', 'OUTPUT_VALIDATION_FAILED'])
            assert.strict.deepEqual([b.ok, b.stdout], [true, '{"a":1}'])
            assert.strict.deepEqual([c.ok, c.stdout], [true, '[[echo]]x'])
        })

        it('自訂validate收到的是response純文字; 無result事件時不進validate(直接以no result失敗)', async function() {
            let seen = []
            let rec = (s) => {
                seen.push(s)
                return true
            }
            let a = await call('new', '[[echo]]答案', { promptVia: 'stdin', validate: rec })
            let b = await call('new', '[[noresult]]', { promptVia: 'stdin', validate: rec })
            assert.strict.deepEqual([a.ok, seen, b.ok, b.errorType], [true, ['[[echo]]答案'], false, 'exec'])
        })

        it('經遞補層: result ERROR與no result皆為一般失敗(next-key/exec)而由下一條目接手', async function() {
            let ent = (id, exe) => ({ id, kind: 'antigravity', exe, model: 'm', skipPermissions: false, addDirs: ['.'], promptVia: 'stdin' })
            resetLog('new')
            let r = await dispatchAiFallback('[[noresult]]', { providers: [ent('agy:a', fakes.new.exe), { id: 'oc:b', kind: 'antigravity', exe: fakes.new.exe, model: 'm', skipPermissions: false, addDirs: ['.'], promptVia: 'argv' }], timeoutMs: 30000, quotaGate: false })
            assert.strict.deepEqual([r.ok, r.providerId, r.tried.map((t) => `${t.providerId}/${t.outcome}/${t.errorType || ''}`)], [true, 'oc:b', ['agy:a/next-key/exec', 'oc:b/ok/']])
        })

    })

    describe('D. extraArgs衝突旗標: stdin路徑明確拒絕(params、attempts 0、不spawn); argv路徑不受影響', function() {

        it('--output-format／--input-format／--print／-p／--prompt／-i／--prompt-interactive(含=值與單橫線寫法)皆拒絕', async function() {
            let cases = [
                ['--output-format', 'json'], ['--output-format=json'], ['-output-format', 'text'],
                ['--input-format', 'text'], ['--input-format=stream-json'],
                ['--print', 'x'], ['-p', 'x'], ['--prompt', 'x'], ['--prompt=x'], ['-p=x'],
                ['-i'], ['--prompt-interactive', 'x'],
            ]
            let r = []
            for (let extraArgs of cases) {
                let t = await call('new', 'abc', { promptVia: 'stdin', extraArgs })
                r.push([t.ok, t.errorType, t.attempts, t.error.includes(`[${extraArgs[0]}]`), logOf('new')])
            }
            assert.strict.deepEqual(r, cases.map(() => [false, 'params', 0, true, []]))
        })

        it('近似但不衝突之旗標不被誤拒(--print-timeout、--output-format之值、--json-schema)', async function() {
            let t = await call('new', 'abc', { promptVia: 'stdin', extraArgs: ['--json-schema', '{"type":"object"}', '--print-timeout', '5s'] })
            assert.strict.deepEqual(t.ok, true)
        })

        it('auto超長自動改走stdin時同樣拒絕衝突旗標; 短prompt走argv時extraArgs原樣放行(與修前相同)', async function() {
            let a = await call('new', 'x'.repeat(30001), { extraArgs: ['--output-format', 'json'] })
            assert.strict.deepEqual([a.ok, a.errorType, a.attempts, a.error.includes('[--output-format]'), a.error.includes('prompt too long')], [false, 'params', 0, true, false])
            let b = await call('new', 'abc', { extraArgs: ['--output-format', 'json'] })
            let o = JSON.parse(b.stdout)
            assert.strict.deepEqual([b.ok, o.args.slice(-4)], [true, ['--output-format', 'json', '--print', 'abc']])
        })

    })

    describe('E. agy版本: 低於1.1.15回明確錯誤, 不spawn實際呼叫', function() {

        it('1.1.14: params錯誤, 寫明須升級至1.1.15與agy update, attempts 0, 只探測版本、未送出prompt', async function() {
            let t = await call('old', 'abc', { promptVia: 'stdin' })
            assert.strict.deepEqual([t.ok, t.errorType, t.attempts, t.code], [false, 'params', 0, null])
            assert.strict.deepEqual([t.error.includes('[1.1.14]'), t.error.includes('>= 1.1.15'), t.error.includes('agy update')], [true, true, true])
            assert.strict.deepEqual(logOf('old'), ['version'])
        })

        it('auto超長遇舊版: 同樣明確錯誤(而非prompt too long或靜默失敗); 短prompt走argv不探測、不受影響', async function() {
            let a = await call('old', 'x'.repeat(30001))
            assert.strict.deepEqual([a.ok, a.errorType, a.error.includes('>= 1.1.15'), logOf('old')], [false, 'params', true, ['version']])
            let b = await call('old', 'abc')
            assert.strict.deepEqual([b.ok, logOf('old')], [true, ['argv']])
        })

        it('版本邊界: 1.1.15與1.10.0(數值比較非字串比較)放行', async function() {
            let a = await call('edge', 'abc', { promptVia: 'stdin' })
            let b = await call('ten', 'abc', { promptVia: 'stdin' })
            assert.strict.deepEqual([a.ok, b.ok], [true, true])
        })

        it('探測不確定(--version離開碼1、解析不出版本號)時放行: 前者照常成交; 後者遇「flags provided but not defined: -input-format」改寫為升級指引(params)', async function() {
            let a = await call('nover', 'abc', { promptVia: 'stdin' })
            assert.strict.deepEqual([a.ok, logOf('nover')], [true, ['version', 'stdin']])
            let b = await call('weird', 'abc', { promptVia: 'stdin' })
            assert.strict.deepEqual([b.ok, b.errorType, b.code, b.error.includes('does not recognize --input-format'), b.error.includes('>= 1.1.15'), b.error.includes('agy update'), b.attempts], [false, 'params', 2, true, true, true, 1])
        })

        it('探測只快取已確認支援者: 連呼兩次只探測一次; 低版本不快取(升級後下一次呼叫即重新探測)', async function() {
            clearAgyStdinSupportCache()
            fs.rmSync(path.join(fakes.new.fd, 'calls.log'), { force: true })
            let o = { exe: fakes.new.exe, timeoutMs: 30000, promptVia: 'stdin' }
            await dispatchAntigravity('abc', o)
            await dispatchAntigravity('abc', o)
            assert.strict.deepEqual(logOf('new'), ['version', 'stdin', 'stdin'])
            clearAgyStdinSupportCache()
            fs.rmSync(path.join(fakes.old.fd, 'calls.log'), { force: true })
            await dispatchAntigravity('abc', { ...o, exe: fakes.old.exe })
            await dispatchAntigravity('abc', { ...o, exe: fakes.old.exe })
            assert.strict.deepEqual(logOf('old'), ['version', 'version'])
        })

    })

    describe('F. 額度門檻(#93)在stdin路徑行為相同: 門檻在遞補層、轉接器之前', function() {

        it('antigravity條目達門檻即略過、不spawn(promptVia不影響); 未達門檻照常走stdin成交', async function() {
            let win = (usedPercent) => ({ key: 'k', label: '7天(Gemini Models)', windowSeconds: null, usedPercent, remainingPercent: 100 - usedPercent, resetAt: new Date(Date.UTC(2026, 0, 2)).toISOString(), resetAfterSeconds: null, scope: 'Gemini Models', active: false, severity: 'normal' })
            let okQuota = (windows) => ({ ok: true, provider: 'fake', email: '', matched: null, plan: '', planTier: '', source: 'fake', windows, credits: null, raw: null, error: '', errorType: '', durationMs: 1 })
            let gate = (usedPercent) => ({ state: createQuotaGateState(), readers: { antigravity: async () => okQuota([win(usedPercent)]) }, now: () => Date.UTC(2026, 0, 1, 4) })
            let ent = { id: 'agy:g', kind: 'antigravity', exe: fakes.new.exe, model: 'gemini-3.8-flash-high', skipPermissions: false, addDirs: ['.'], promptVia: 'stdin' }
            let mkStore = () => {
                let text = null //額度帳以JSON文字保存, 每次呼叫獨立(免入帳殘留於行程內記憶體影響下一案)
                return {
                    get: () => (text === null ? null : JSON.parse(text)),
                    set: (x) => {
                        text = JSON.stringify(x)
                    },
                }
            }
            resetLog('new')
            let a = await dispatchAiFallback('abc', { providers: [ent], timeoutMs: 30000, store: mkStore(), quotaGate: gate(99) })
            assert.strict.deepEqual([a.ok, a.errorType, a.attempts, a.tried.map((t) => t.outcome), logOf('new')], [false, 'quota', 0, ['quota-skip'], []])
            resetLog('new')
            let b = await dispatchAiFallback('abc', { providers: [ent], timeoutMs: 30000, store: mkStore(), quotaGate: gate(10) })
            assert.strict.deepEqual([b.ok, logOf('new')], [true, ['version', 'stdin']])
        })

    })

})
