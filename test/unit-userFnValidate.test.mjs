import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import execCli from 'wsemi/src/execCli.mjs'
import runExecCli from '../src/runExecCli.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'
import userFnForms, { captureUnhandled } from './tools/userFnFormsForTest.mjs'


//cls, 結果之stderr分類: validate拋錯(含reject)為'threw'、逾時為'timeout'、其餘''
function cls(stderr) {
    let s = String(stderr || '')
    if (s.indexOf('validate timed out: did not settle within') === 0) {
        return 'timeout'
    }
    if (s.indexOf('validate threw: ') === 0) {
        return 'threw'
    }
    return ''
}


//expectOf, 由形態種類推導應然(帳本R-USERFN-2): 通過→ok; 不通過→validation; 拋錯/reject→validation且stderr前綴validate threw; 逾時→同前且訊息為did not settle
function expectOf(kind, failType = 'validation') {
    if (kind === 'pass') {
        return [true, undefined, '']
    }
    return [false, failType, kind === 'fail' ? '' : kind === 'threw' ? 'threw' : 'timeout']
}


describe('自訂validate之回傳形態(CLI、REST、遞補層同規則)', function() {

    let fakes = {}
    let svr = null

    before(async function() {
        for (let k of ['claude', 'codex', 'opencode', 'agy']) {
            fakes[k] = createFakeCli(`fake-ufv-${k}`)
        }
        svr = await fakeServerForApiTest()
    })

    after(async function() {
        for (let k of Object.keys(fakes)) {
            fakes[k].clean()
        }
        if (svr) {
            await svr.close()
        }
    })

    it('CLI四家: 回傳Promise者以其resolve值判定, 拋錯/reject/逾時視同驗證失敗並註記, 永不落定者於timeoutMs內落定, 不使行程崩潰', async function() {
        //規格: 帳本R-USERFN-2; README Options shared之validate列(改寫後); CLI之validate由runExecCli判定(不交wsemi), 與子進程共用該次嘗試之timeoutMs
        let fns = { claude: dispatchClaude, codex: dispatchCodex, opencode: dispatchOpencode, agy: dispatchAntigravity }
        let forms = userFnForms(true, false, 4000)
        let { value: r, seen } = await captureUnhandled(() => Promise.all(Object.keys(fns).map(async (k) => {
            let rows = []
            for (let f of forms) {
                let t = await fns[k]('abc', { exe: fakes[k].exe, timeoutMs: 2000, validate: f.fn })
                rows.push([k, f.label, t.ok, t.errorType, cls(t.stderr)])
            }
            return rows
        })))
        let rr = Object.keys(fns).map((k) => forms.map((f) => [k, f.label, ...expectOf(f.kind)]))
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('REST三家: 同CLI類之判定與註記(safeValidateAsync), 永不落定者於timeoutMs內落定', async function() {
        //規格: 帳本R-USERFN-2; README Options only for dispatchApiOpenaiCompat之validate(同dispatch functions)
        let calls = {
            compat: (v) => dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-ufv-1', model: 'echo', timeoutMs: 1000, validate: v }),
            responses: (v) => dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-ufv-2', model: 'echo', timeoutMs: 1000, validate: v }),
            systemone: (v) => dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-ufv-3', model: 'echo', timeoutMs: 1000, questions: { q1: { type: 'noul', instructions: 'x?' } }, validate: v }),
        }
        let forms = userFnForms(true, false, 2000)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let k of Object.keys(calls)) {
                for (let f of forms) {
                    let t = await calls[k](f.fn)
                    rows.push([k, f.label, t.ok, t.errorType, cls(t.stderr)])
                }
            }
            return rows
        })
        let rr = []
        for (let k of Object.keys(calls)) {
            for (let f of forms) {
                rr.push([k, f.label, ...expectOf(f.kind)])
            }
        }
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('REST截斷且acceptTruncated:true: validate之回傳形態判定同上, 不放行者為incomplete(rejected by validate)', async function() {
        //規格: README acceptTruncated列(有validate交其裁決); 帳本R-USERFN-2
        let calls = {
            compat: (v) => dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-ufv-4', model: 'trunc-array', timeoutMs: 1000, acceptTruncated: true, validate: v }),
            responses: (v) => dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-ufv-5', model: 'incomplete-partial', timeoutMs: 1000, acceptTruncated: true, validate: v }),
        }
        let forms = userFnForms(true, false, 2000)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let k of Object.keys(calls)) {
                for (let f of forms) {
                    let t = await calls[k](f.fn)
                    rows.push([k, f.label, t.ok, t.errorType, cls(t.stderr), t.ok ? true : String(t.error).includes('rejected by validate')])
                }
            }
            return rows
        })
        let rr = []
        for (let k of Object.keys(calls)) {
            for (let f of forms) {
                rr.push([k, f.label, ...expectOf(f.kind, 'incomplete'), true])
            }
        }
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('遞補層: 條目validate不通過(含resolve假、reject、逾時)即整組跳過換下一家', async function() {
        //規格: README失敗分流表之「輸出未過驗證 → 整組跳過」; 帳本R-USERFN-2
        let forms = userFnForms(true, false, 3000)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let t = await dispatchAiFallback('abc', {
                    providers: [
                        { id: 'A', kind: 'claude', exe: fakes.claude.exe, timeoutMs: 1500, validate: f.fn },
                        { id: 'B', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-ufv-6'] },
                    ],
                })
                rows.push([f.label, t.ok, t.providerId, t.tried.map((x) => [x.providerId, x.outcome, x.errorType || null])])
            }
            return rows
        })
        let rr = forms.map((f) => (f.kind === 'pass'
            ? [f.label, true, 'A', [['A', 'ok', null]]]
            : [f.label, true, 'B', [['A', 'skip-group', 'validation'], ['B', 'ok', null]]]))
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('CLI重試: 前次拋錯、末次回false時, 結果stderr不殘留前次之validate threw註記', async function() {
        //規格: 帳本R-VALIDATE-1(stderr之validate threw只註記該次結果之拋錯); 前次之訊息不得張冠李戴
        let n = 0
        let t = await dispatchClaude('abc', {
            exe: fakes.claude.exe,
            maxRetries: 1,
            retryDelayMs: 1,
            validate: () => {
                n++
                if (n === 1) {
                    throw new Error('first-boom')
                }
                return false
            },
        })
        let r = [t.ok, t.error, t.attempts, n, t.stderr.includes('first-boom')]
        let rr = [false, 'OUTPUT_VALIDATION_FAILED', 2, 2, false]
        assert.strict.deepEqual(r, rr)
    })

    it('預算: 子進程耗時1.5秒且validate永不落定時, 驗證與子進程共用該次嘗試之時限, 整輪不超出budgetMs(容差0.5秒)', async function() {
        //規格: README Timeout總覽(每次嘗試≤timeoutMs; budgetMs之剩餘預算壓進每次嘗試之timeoutMs, 整輪≤budgetMs); 帳本R-USERFN-2之「驗證與子進程共用該次嘗試之timeoutMs」
        let budgetMs = 3000
        let t0 = Date.now()
        let t = await dispatchAiFallback('abc', {
            providers: [
                { id: 'A', kind: 'claude', exe: fakes.claude.exe, extraArgs: ['--fake-sleep=1500'], validate: () => new Promise(() => {}) },
                { id: 'B', kind: 'claude', exe: fakes.claude.exe },
            ],
            budgetMs,
            minAttemptMs: 100,
        })
        let ms = Date.now() - t0
        let a = t.tried[0] || {}
        let r = [a.providerId, a.outcome, a.errorType, String(a.stderr).indexOf('validate timed out: ') === 0, ms <= budgetMs + 500]
        let rr = ['A', 'skip-group', 'validation', true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('CLI四家之env: 有狀態getter(第2次讀取才拋錯)只讀一次而照常執行; 已撤銷之Proxy以params回報, 皆不reject', async function() {
        //規格: README「All functions never reject」; 帳本R-USERFN-1之呼叫端物件規則(readCallerObj)(只讀一次、不可讀即params); 複審B5、B6
        let fns = { claude: dispatchClaude, codex: dispatchCodex, opencode: dispatchOpencode, agy: dispatchAntigravity }
        let rows = []
        for (let k of Object.keys(fns)) {
            let n = 0
            let env2 = {}
            Object.defineProperty(env2, 'FAKE_ENV', {
                enumerable: true,
                get: () => {
                    n++
                    if (n > 1) {
                        throw new Error('getter-2nd-boom')
                    }
                    return 'v1'
                },
            })
            let p = Proxy.revocable({}, {})
            p.revoke()
            let res = []
            for (let env of [env2, p.proxy]) {
                try {
                    let t = await fns[k]('abc', { exe: fakes[k].exe, env })
                    res.push(t.ok ? 'ok' : t.errorType)
                }
                catch (err) {
                    res.push(`rejected:${String(err && err.message)}`)
                }
            }
            rows.push([k, ...res])
        }
        let rr = Object.keys(fns).map((k) => [k, 'ok', 'params'])
        assert.strict.deepEqual(rows, rr)
    })

    it('durationMs含驗證時間(CLI與REST同): validate於300ms後resolve真時, durationMs不少於300', async function() {
        //規格: 帳本R-USERFN-2——durationMs為該次嘗試之耗時(含驗證); 下游以tried[].durationMs區分快速失敗與空耗一輪逾時
        let slow = () => new Promise((resolve) => setTimeout(() => resolve(true), 300))
        let c = await dispatchClaude('abc', { exe: fakes.claude.exe, validate: slow })
        let s = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-ufv-7', model: 'echo', validate: slow })
        let r = [c.ok, c.durationMs >= 300, s.ok, s.durationMs >= 300]
        let rr = [true, true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('CLI與REST對稱: validate同步回傳已撤銷Proxy或then getter會拋錯之物件時皆以真值判定(通過)', async function() {
        //規格: 帳本R-USERFN-2——同步回傳值以真值判定(!!), CLI與REST同規則
        let p = Proxy.revocable({}, {})
        p.revoke()
        let thenBoom = {}
        Object.defineProperty(thenBoom, 'then', {
            get: () => {
                throw new Error('then-getter-boom')
            }
        })
        let rows = []
        for (let [label, val] of [['revoked', p.proxy], ['then-getter', thenBoom]]) {
            let c = await dispatchClaude('abc', { exe: fakes.claude.exe, validate: () => val })
            let s = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-ufv-8', model: 'echo', validate: () => val })
            rows.push([label, c.ok, s.ok])
        }
        assert.strict.deepEqual(rows, [['revoked', true, true], ['then-getter', true, true]])
    })

    it('CLI驗證失敗之結果形狀、attempts與重試間隔與wsemi之execCli一致(自wsemi複製之公式與形狀釘住)', async function() {
        //規格: 帳本R-USERFN-2之「自wsemi複製之部分(Q3來源記錄)」——runExecCli自判validate時, 失敗結果形狀(stdout/stderr截斷、code 0、error)、attempts與重試間隔(retryDelayMs×已嘗試次數, 上限15000ms)同wsemi execCli; wsemi改公式或形狀時本案即紅
        let fd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', `ufv-pin-${process.pid}`) //測試暫存落test/_tmp/<案名>/(gitignore), 本案finally刪除; 夾帶pid免同機並行之另一次執行寫入同一時刻檔
        fs.rmSync(fd, { recursive: true, force: true }) //先清空: 前次執行中斷(如降版至wsemi 1.9.15時此案拋未捕捉例外而finally未執行)會殘留時刻檔
        fs.mkdirSync(fd, { recursive: true })
        try {
            //子進程: 記下啟動時刻(供量測重試間隔), 輸出stdout與stderr後以0離開
            let script = (fp) => `require('fs').appendFileSync(${JSON.stringify(fp)}, Date.now() + '\\n'); process.stdout.write('out-' + 'x'.repeat(600)); process.stderr.write('err-' + 'y'.repeat(600))`
            let run = async (label, fn, validate) => {
                let fp = path.join(fd, `${label}.txt`)
                let r = await fn(process.execPath, ['-e', script(fp)], { maxRetries: 2, retryDelayMs: 400, timeoutMs: 20000, validate })
                let ts = fs.readFileSync(fp, 'utf8').trim().split('\n').map(Number)
                let gaps = ts.slice(1).map((t, i) => t - ts[i])
                let shape = { keys: Object.keys(r).filter((k) => k !== 'errorType').sort(), ok: r.ok, stdout: r.stdout, stderr: r.stderr, code: r.code, error: r.error, attempts: r.attempts, pid: typeof r.pid, durationMs: typeof r.durationMs }
                return { shape, gaps }
            }
            let vThrow = () => {
                throw new Error('pin-boom')
            }
            let vFalse = () => false
            let w1 = await run('w-throw', execCli, vThrow)
            let o1 = await run('o-throw', runExecCli, vThrow)
            let w2 = await run('w-false', execCli, vFalse)
            let o2 = await run('o-false', runExecCli, vFalse)
            //形狀: 本層與wsemi逐欄相同(本層另補errorType, 不在比對之列)
            assert.strict.deepEqual([o1.shape, o2.shape], [w1.shape, w2.shape])
            //重試間隔: 兩者逐次相差<400ms(子進程啟動耗時之雜訊), 且皆不短於公式值min(400×已嘗試次數, 15000)
            let near = [w1, o1, w2, o2].map((x) => x.gaps.length)
            let diff = [[w1, o1], [w2, o2]].map(([w, o]) => w.gaps.every((g, i) => Math.abs(g - o.gaps[i]) < 400))
            let floor = [w1, o1, w2, o2].map((x) => x.gaps.every((g, i) => g >= Math.min(400 * (i + 1), 15000)))
            assert.strict.deepEqual([near, diff, floor], [[2, 2, 2, 2], [true, true], [true, true, true, true]])
        }
        finally {
            fs.rmSync(fd, { recursive: true, force: true })
        }
    })

    it('一般資料物件(含巢狀、陣列)經readCallerObj後送出之內容與修前相同: CLI之env、REST三家之body與headers、遞補條目, 且不改動呼叫端物件', async function() {
        //規格: 主控裁示Q7之條件「一般資料物件之語意不得改變」; 帳本R-USERFN-1之readCallerObj(淺層副本、只取自有可列舉屬性, 同修前之物件展開)。本案修前修後皆應為綠
        let meta = { tags: ['a', { b: [1, 2] }], deep: { s: 'x', n: 0, f: false, z: null } }
        let mkBody = () => ({ metadata: meta, temperature: 0.3, list: [{ k: 'v' }] })
        let mkHeaders = () => ({ 'Authorization': 'Bearer from-headers', 'X-Extra': 'e1' })
        let snap = JSON.stringify([mkBody(), mkHeaders()])
        let body = mkBody()
        let headers = mkHeaders()
        let pick = (b) => ({ metadata: b.metadata, temperature: b.temperature, list: b.list })
        let rows = []

        //REST三家(直呼轉接器): 未給key, 故Authorization來自headers
        let c = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, model: 'echo', body, headers })
        let jc = JSON.parse(c.stdout)
        rows.push(['compat', c.ok, jc.auth, pick(jc.body)])
        let s = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, model: 'echo', body, headers })
        let js = JSON.parse(s.stdout)
        rows.push(['responses', s.ok, js.auth, pick(js.body)])
        let o = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, model: 'echo', questions: { q1: { type: 'noul', instructions: 'x?' } }, body, headers })
        let ao = o.answers.q1
        rows.push(['systemone', o.ok, ao.echoAuth, pick(ao.echoBody)])

        //遞補條目(條目本身經readCallerObj物化)
        let f = await dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', body, headers }] })
        let jf = JSON.parse(f.stdout)
        rows.push(['fallback', f.ok, jf.auth, pick(jf.body)])

        //CLI四家之env
        let fns = { claude: dispatchClaude, codex: dispatchCodex, opencode: dispatchOpencode, agy: dispatchAntigravity }
        for (let k of Object.keys(fns)) {
            let env = { FAKE_ENV: 'env-v1' }
            let t = await fns[k]('abc', { exe: fakes[k].exe, env })
            rows.push([k, t.ok, JSON.parse(t.stdout).env.FAKE_ENV, JSON.stringify(env)])
        }

        let exp = pick(mkBody())
        let rr = [
            ['compat', true, 'Bearer from-headers', exp],
            ['responses', true, 'Bearer from-headers', exp],
            ['systemone', true, 'Bearer from-headers', exp],
            ['fallback', true, 'Bearer from-headers', exp],
            ...Object.keys(fns).map((k) => [k, true, 'env-v1', '{"FAKE_ENV":"env-v1"}']),
        ]
        assert.strict.deepEqual([rows, JSON.stringify([body, headers])], [rr, snap])
    })

})
