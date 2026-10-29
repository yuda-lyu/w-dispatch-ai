import assert from 'assert'
import filterOpencodeFree, { isFreeText, parseModelIds } from '../src/filterOpencodeFree.mjs'
import providers from '../src/providers.mjs'
import createFakeCli, { createUnstartableExe } from './tools/fakeCliForTest.mjs'


// unit-filterOpencodeFree.test.mjs — filterOpencodeFree(以`opencode models`過濾目錄之opencode免費條目)之規格測試(2026-10-30 run01; 帳本R-OCFREE-1)
//
// 規格來源: 任務書裁定3與建議檔(Gitea issue #25)〈建議〉③、〈驗證建議〉3:
//   R1 輸入目錄條目(或預設目錄), 以`opencode models`之輸出過濾出目前確實供應之免費條目; 免費之判定為id或model含free, 另加big-pickle;
//   R2 `opencode`不存在或查詢失敗時回明確之錯誤狀態, 不得默默回空清單被當成「全部下架」(空輸出亦然);
//   R3 可注入查詢函數供單元測試(本檔除「預設查詢路徑」一節用假opencode執行檔外, 全部為注入之query, 不啟動子進程);
//   R4 本函數不reject。
// 全部不連網、不呼叫任何AI模型。連網守門(目錄 ⊆ 當日opencode models)在 test/api-providersOpencodeFree.test.mjs。


//條目工廠(欄位同providers.mjs之oc:opencode/*條目: 匿名、opencode自家provider)
let oc = (name, extra = {}) => ({ id: `oc:opencode/${name}`, model: `opencode/${name}`, kind: 'opencode', provider: 'opencode', useStoredAuth: false, ...extra })

//輸入目錄: 3條免費(big-pickle無free字樣)、1條非免費之opencode條目(付費)、第三方opencode條目、claude、REST免費條目
let FREE_A = oc('big-pickle')
let FREE_B = oc('beam-free')
let FREE_C = oc('glm-5.3-flash-free')
let PAID = oc('paid-model-x')
let THIRD = { id: 'oc:agnes-ai/agnes-3.0-flash', model: 'agnes-ai/agnes-3.0-flash', kind: 'opencode', provider: 'agnes-ai' }
let CLAUDE = { id: 'claude:sonnet', model: 'sonnet', kind: 'claude' }
let ZEN = { id: 'zen:jev-1.13-free', model: 'jev-1.13-free', kind: 'api-typesafe-systemone' }
let CATALOG = [CLAUDE, FREE_A, ZEN, FREE_B, PAID, THIRD, FREE_C]

//execCli形狀之結果物件
let okOut = (stdout) => ({ ok: true, stdout, stderr: '', code: 0, pid: 111, error: '' })
let ids = (arr) => arr.map((p) => p.id)

//可觀察之query: 記錄收到之引數, 回傳指定值
let spyQuery = (value) => {
    let calls = []
    let fn = async (ctx) => {
        calls.push(ctx)
        return typeof value === 'function' ? value(ctx) : value
    }
    return { fn, calls }
}


describe('filterOpencodeFree (以opencode models過濾目錄之免費條目)', function() {

    describe('R1 過濾: 目前確實供應之免費條目', function() {

        it('清單含全部免費條目: available為免費條目(依輸入順序, 內容同輸入), removed／unchecked／uncatalogued為空, ok為true', async function() {
            let q = spyQuery(okOut('opencode/big-pickle\nopencode/beam-free\nopencode/glm-5.3-flash-free\n'))
            let r = await filterOpencodeFree(CATALOG, { query: q.fn })
            assert.strict.deepEqual(
                [r.ok, r.errorType, r.error, ids(r.available), ids(r.removed), ids(r.unchecked), r.uncatalogued, r.listed, r.refreshed],
                [true, '', '', ['oc:opencode/big-pickle', 'oc:opencode/beam-free', 'oc:opencode/glm-5.3-flash-free'], [], ['zen:jev-1.13-free'], [], ['opencode/big-pickle', 'opencode/beam-free', 'opencode/glm-5.3-flash-free'], false],
            )
            assert.strict.deepEqual(r.available, [FREE_A, FREE_B, FREE_C]) //條目內容(淺層副本)同輸入
            assert.strict.deepEqual([typeof r.durationMs, r.durationMs >= 0], ['number', true])
        })

        it('某條下架(不在清單): 該條在removed、其餘仍在available(原缺陷: 目錄收了已下架之id而無從察覺)', async function() {
            let q = spyQuery(okOut('opencode/big-pickle\nopencode/glm-5.3-flash-free\n'))
            let r = await filterOpencodeFree(CATALOG, { query: q.fn })
            assert.strict.deepEqual([r.ok, ids(r.available), ids(r.removed)], [true, ['oc:opencode/big-pickle', 'oc:opencode/glm-5.3-flash-free'], ['oc:opencode/beam-free']])
            assert.strict.deepEqual(r.removed[0], FREE_B) //下架者之完整條目(供下游依id剔除或回報)
        })

        it('全部免費條目皆不在清單(清單解析得出id): 全入removed——與「查詢失敗」不同, 此時ok為true、清單欄位為陣列', async function() {
            let q = spyQuery(okOut('opencode/some-other-free\n'))
            let r = await filterOpencodeFree(CATALOG, { query: q.fn })
            assert.strict.deepEqual([r.ok, ids(r.available), ids(r.removed), r.uncatalogued], [true, [], ['oc:opencode/big-pickle', 'oc:opencode/beam-free', 'oc:opencode/glm-5.3-flash-free'], ['opencode/some-other-free']])
        })

        it('免費之判定: id或model含free、另加big-pickle; 非免費之opencode條目、claude、第三方provider條目不出現在任何清單', async function() {
            let byId = { id: 'oc:x-free', model: 'opencode/x', kind: 'opencode' } //僅id含free
            let byModel = { id: 'oc:y', model: 'opencode/y-free', kind: 'opencode' } //僅model含free
            let upper = oc('Z-FREE') //不分大小寫
            let q = spyQuery(okOut('opencode/x\nopencode/y-free\n'))
            let r = await filterOpencodeFree([byId, byModel, upper, PAID, THIRD, CLAUDE, FREE_A], { query: q.fn })
            assert.strict.deepEqual([ids(r.available), ids(r.removed), ids(r.unchecked)], [['oc:x-free', 'oc:y'], ['oc:opencode/Z-FREE', 'oc:opencode/big-pickle'], []])
        })

        it('無從以清單判定者列unchecked而不判下架: REST條目(zen:jev-1.13-free, 不在opencode models)與須注入config之第三方免費條目', async function() {
            let third = { id: 'oc:myprov/m-free', model: 'myprov/m-free', kind: 'opencode', provider: 'myprov' }
            let q = spyQuery(okOut('opencode/beam-free\n'))
            let r = await filterOpencodeFree([ZEN, third, FREE_B], { query: q.fn })
            assert.strict.deepEqual([ids(r.available), ids(r.removed), ids(r.unchecked)], [['oc:opencode/beam-free'], [], ['zen:jev-1.13-free', 'oc:myprov/m-free']])
        })

        it('uncatalogued: 清單有列之opencode/免費id而輸入未收者(如新上線之flint-40b-free); 非免費id與他家provider之id不列', async function() {
            let q = spyQuery(okOut('opencode/beam-free\nopencode/flint-40b-free\nopencode/paid-new-model\nanthropic/claude-x-free\nopencode/big-pickle\n'))
            let r = await filterOpencodeFree([FREE_B, FREE_A], { query: q.fn })
            assert.strict.deepEqual(r.uncatalogued, ['opencode/flint-40b-free'])
        })

        it('uncatalogued不含已被「非免費字樣之條目」涵蓋者(輸入條目之model即該id)', async function() {
            let covered = { id: 'oc:custom-name', model: 'opencode/flint-40b-free', kind: 'opencode' } //id不含free但model含
            let q = spyQuery(okOut('opencode/flint-40b-free\n'))
            let r = await filterOpencodeFree([covered], { query: q.fn })
            assert.strict.deepEqual([r.uncatalogued, ids(r.available)], [[], ['oc:custom-name']])
        })

        it('預設目錄(省略providers): 以內建目錄過濾——清單恰為內建免費opencode條目之model時全在available; 清單換成他物時全部免費opencode條目入removed', async function() {
            let freeOc = providers.filter((p) => p.kind === 'opencode' && p.model.startsWith('opencode/') && isFreeText(p.id + p.model))
            assert.strict.deepEqual(freeOc.length > 0, true)
            let all = await filterOpencodeFree(undefined, { query: spyQuery(okOut(freeOc.map((p) => p.model).join('\n'))).fn })
            assert.strict.deepEqual([all.ok, ids(all.available), all.removed, all.uncatalogued], [true, ids(freeOc), [], []])
            assert.strict.deepEqual(ids(all.unchecked).includes('zen:jev-1.13-free'), true) //REST條目列unchecked
            let none = await filterOpencodeFree(undefined, { query: spyQuery(okOut('opencode/unrelated-free\n')).fn })
            assert.strict.deepEqual([none.ok, none.available, ids(none.removed)], [true, [], ids(freeOc)])
        })

        it('條目為淺層副本: 改動回傳之條目不影響輸入; 輸入之陣列與條目不被改動', async function() {
            let input = [{ ...FREE_B }]
            let before = JSON.stringify(input)
            let r = await filterOpencodeFree(input, { query: spyQuery(okOut('opencode/beam-free\n')).fn })
            r.available[0].id = 'mutated'
            assert.strict.deepEqual([JSON.stringify(input), r.available[0] === input[0]], [before, false])
        })

    })

    describe('R2 查詢失敗回明確錯誤狀態, 不得默默回空清單被當成「全部下架」', function() {

        //失敗結果之統一斷言: ok為false, errorType符合, 各清單欄位為null(而非空陣列)
        let assertFail = (r, errorType) => {
            assert.strict.deepEqual(
                [r.ok, r.errorType, typeof r.error === 'string' && r.error !== '', r.available, r.removed, r.unchecked, r.uncatalogued, r.listed],
                [false, errorType, true, null, null, null, null, null],
            )
        }

        it('opencode不存在(execCli之spawn失敗形狀: code為null、pid為undefined): errorType為notfound', async function() {
            let q = spyQuery({ ok: false, stdout: '', stderr: '', code: null, pid: undefined, error: 'spawn opencode ENOENT' })
            assertFail(await filterOpencodeFree(CATALOG, { query: q.fn }), 'notfound')
        })

        it('opencode不存在(僅有ENOENT字樣、無pid鍵之形狀): 仍為notfound(與getErrorType同一判準)', async function() {
            assertFail(await filterOpencodeFree(CATALOG, { query: spyQuery({ ok: false, error: 'spawn opencode ENOENT' }).fn }), 'notfound')
        })

        it('非零離開(查詢失敗): errorType為exit, error帶離開碼與stderr尾段(去色)', async function() {
            let q = spyQuery({ ok: false, stdout: '', stderr: '\u001b[91mError: \u001b[0mcatalog broken', code: 1, pid: 222, error: 'Exit code 1' })
            let r = await filterOpencodeFree(CATALOG, { query: q.fn })
            assertFail(r, 'exit')
            assert.strict.deepEqual([r.error.includes('Exit code 1'), r.error.includes('catalog broken'), r.error.includes('\u001b')], [true, true, false])
        })

        it('逾時(execCli之TIMEOUT形狀): errorType為timeout', async function() {
            assertFail(await filterOpencodeFree(CATALOG, { query: spyQuery({ ok: false, stdout: '', stderr: '', code: null, pid: 333, error: 'TIMEOUT after 30s' }).fn }), 'timeout')
        })

        it('空輸出(查詢成功但無任何模型id): errorType為empty, 不得回「全部下架」', async function() {
            for (let out of ['', '\n', '   \r\n  \r\n', 'Models cache refreshed\n', 'warning: something went wrong\n']) {
                assertFail(await filterOpencodeFree(CATALOG, { query: spyQuery(out).fn }), 'empty')
                assertFail(await filterOpencodeFree(CATALOG, { query: spyQuery(okOut(out)).fn }), 'empty')
            }
        })

        it('輸入目錄本身無免費條目且清單有效: ok為true、各清單為空陣列(合法之空, 與查詢失敗之null區分)', async function() {
            let r = await filterOpencodeFree([CLAUDE, PAID], { query: spyQuery(okOut('opencode/beam-free\n')).fn })
            assert.strict.deepEqual([r.ok, r.available, r.removed, r.unchecked, r.uncatalogued], [true, [], [], [], ['opencode/beam-free']])
        })

        it('注入之query同步拋錯、reject、拋出非Error值: errorType為query, 本函數不reject', async function() {
            let boomSync = () => {
                throw new Error('boom-sync')
            }
            let boomAsync = async () => {
                throw new Error('boom-async')
            }
            let boomReject = () => Promise.reject(new Error('boom-reject'))
            let boomNull = () => {
                // eslint-disable-next-line no-throw-literal
                throw null
            }
            let r = []
            for (let fn of [boomSync, boomAsync, boomReject, boomNull]) {
                let t = await filterOpencodeFree(CATALOG, { query: fn })
                r.push([t.ok, t.errorType, t.available])
            }
            assert.strict.deepEqual(r, [[false, 'query', null], [false, 'query', null], [false, 'query', null], [false, 'query', null]])
        })

        it('注入之query永不落定: 於timeoutMs後回timeout, 不掛住', async function() {
            let t0 = Date.now()
            let r = await filterOpencodeFree(CATALOG, { query: () => new Promise(() => {}), timeoutMs: 80 })
            assertFail(r, 'timeout')
            assert.strict.deepEqual(Date.now() - t0 < 5000, true)
        })

        it('注入之query回傳畸形值(null、數字、陣列、stdout非字串): errorType為query', async function() {
            for (let v of [null, undefined, 123, [], { ok: true }, { ok: true, stdout: 5 }]) {
                assertFail(await filterOpencodeFree(CATALOG, { query: () => v }), 'query')
            }
        })

        it('providers非陣列: errorType為params, 且不呼叫query(查詢前即擋)', async function() {
            for (let bad of [null, {}, 'x', 5, true]) {
                let q = spyQuery(okOut('opencode/beam-free\n'))
                assertFail(await filterOpencodeFree(bad, { query: q.fn }), 'params')
                assert.strict.deepEqual(q.calls.length, 0)
            }
        })

        it('條目非物件或不可讀(拋錯之getter、已撤銷之Proxy): errorType為params, 且不呼叫query', async function() {
            let thrower = {}
            Object.defineProperty(thrower, 'model', {
                enumerable: true,
                get() {
                    throw new Error('getter boom')
                },
            })
            let revoked = Proxy.revocable({}, {})
            revoked.revoke()
            for (let badEntry of [null, 5, 'str', [], thrower, revoked.proxy]) {
                let q = spyQuery(okOut('opencode/beam-free\n'))
                let r = await filterOpencodeFree([FREE_B, badEntry], { query: q.fn })
                assertFail(r, 'params')
                assert.strict.deepEqual(q.calls.length, 0)
            }
        })

        it('最後防線: 讀取opt拋錯(拋錯之getter)亦不reject, errorType為other', async function() {
            let opt = {}
            Object.defineProperty(opt, 'refresh', {
                enumerable: true,
                get() {
                    throw new Error('opt boom')
                },
            })
            assertFail(await filterOpencodeFree(CATALOG, opt), 'other')
        })

    })

    describe('R3 query之注入介面與旗標', function() {

        it('預設呼叫引數: { exe: opencode, args: [models], timeoutMs: 30000, refresh: false }; refreshed為false', async function() {
            let q = spyQuery(okOut('opencode/beam-free\n'))
            let r = await filterOpencodeFree(CATALOG, { query: q.fn })
            assert.strict.deepEqual([q.calls, r.refreshed], [[{ exe: 'opencode', args: ['models'], timeoutMs: 30000, refresh: false }], false])
        })

        it('refresh:true附--refresh, exe與timeoutMs可自訂(無效值回退預設)', async function() {
            let q = spyQuery(okOut('opencode/beam-free\n'))
            let r = await filterOpencodeFree(CATALOG, { query: q.fn, refresh: true, exe: 'C:/x/opencode.cmd', timeoutMs: 1234 })
            assert.strict.deepEqual([q.calls, r.refreshed], [[{ exe: 'C:/x/opencode.cmd', args: ['models', '--refresh'], timeoutMs: 1234, refresh: true }], true])
            let q2 = spyQuery(okOut('opencode/beam-free\n'))
            await filterOpencodeFree(CATALOG, { query: q2.fn, refresh: 'yes', exe: '', timeoutMs: -5 })
            assert.strict.deepEqual(q2.calls, [{ exe: 'opencode', args: ['models'], timeoutMs: 30000, refresh: false }]) //僅布林true才開refresh
        })

        it('失敗結果亦記refreshed(令呼叫端知道失敗發生於哪種查詢)', async function() {
            let r = await filterOpencodeFree(CATALOG, { query: () => '', refresh: true })
            assert.strict.deepEqual([r.ok, r.errorType, r.refreshed], [false, 'empty', true])
        })

        it('query回傳純字串視同成功之stdout', async function() {
            let r = await filterOpencodeFree(CATALOG, { query: () => 'opencode/beam-free\n' })
            assert.strict.deepEqual([r.ok, ids(r.available)], [true, ['oc:opencode/beam-free']])
        })

    })

    describe('輸出解析(parseModelIds)', function() {

        it('去色、CRLF、空行、橫幅與警告行、重複行、三段式id', function() {
            let esc = String.fromCharCode(27)
            let out = [
                `${esc}[92mopencode/beam-free${esc}[0m\r`,
                '',
                'Models cache refreshed',
                '  opencode/big-pickle  ',
                'opencode/beam-free', //重複
                'poolside/poolside/laguna-s-2.1',
                'http://example.com/x', //含冒號與雙斜線之網址不是id
                'Error: foo/bar baz', //含空白
                'single-token-without-slash',
                'opencode/glm-5.3-flash-free',
            ].join('\n')
            assert.strict.deepEqual(parseModelIds(out), ['opencode/beam-free', 'opencode/big-pickle', 'poolside/poolside/laguna-s-2.1', 'opencode/glm-5.3-flash-free'])
        })

        it('isFreeText: 含free(不分大小寫)或big-pickle為真; 非字串與其餘為假', function() {
            assert.strict.deepEqual(
                ['oc:opencode/beam-free', 'opencode/Big-Pickle', 'X-FREE', 'opencode/paid', '', null, undefined, 5, {}].map((s) => isFreeText(s)),
                [true, true, true, false, false, false, false, false, false],
            )
        })

    })

    describe('預設查詢路徑(假opencode執行檔; 不連網)', function() {

        //假opencode: 只接受`models`子命令; --refresh時多列一個id; 以FAKE_MODE令其空輸出/非零離開/延遲
        let CODE = `
let args = process.argv.slice(2)
if (args[0] !== 'models') {
    process.stderr.write('unexpected args: ' + args.join(' '))
    process.exit(2)
}
let mode = process.env.FAKE_MODE || ''
if (mode === 'exit1') {
    process.stderr.write('catalog broken')
    process.exit(1)
}
if (mode === 'sleep') {
    setTimeout(() => process.exit(0), 5000)
}
else {
    let lines = mode === 'empty' ? [] : ['opencode/big-pickle', 'opencode/beam-free']
    if (args.includes('--refresh')) {
        lines.push('opencode/refreshed-free')
    }
    process.stdout.write(lines.join('\\r\\n') + '\\r\\n')
    process.exit(0)
}
`
        let fake = null
        let bad = null

        before(function() {
            fake = createFakeCli('fake-opencode-filterfree', CODE)
            bad = createUnstartableExe('bad-opencode-filterfree')
        })

        after(function() {
            if (fake) {
                fake.clean()
            }
            if (bad) {
                bad.clean()
            }
        })

        it('實際以子進程執行`<exe> models`並解析其stdout(CRLF); 不給refresh時不帶--refresh', async function() {
            let r = await filterOpencodeFree([FREE_A, FREE_B, oc('refreshed-free')], { exe: fake.exe })
            assert.strict.deepEqual([r.ok, r.listed, ids(r.available), ids(r.removed)], [true, ['opencode/big-pickle', 'opencode/beam-free'], ['oc:opencode/big-pickle', 'oc:opencode/beam-free'], ['oc:opencode/refreshed-free']])
        })

        it('refresh:true時子進程收到--refresh(假CLI多列refreshed-free)', async function() {
            let r = await filterOpencodeFree([FREE_A, FREE_B, oc('refreshed-free')], { exe: fake.exe, refresh: true })
            assert.strict.deepEqual([r.ok, r.refreshed, ids(r.available), r.removed], [true, true, ['oc:opencode/big-pickle', 'oc:opencode/beam-free', 'oc:opencode/refreshed-free'], []])
        })

        it('子進程非零離開 → exit; 空輸出 → empty; 逾時 → timeout; env傳入子進程(FAKE_MODE經opt.env)', async function() {
            let r1 = await filterOpencodeFree([FREE_A], { exe: fake.exe, env: { ...process.env, FAKE_MODE: 'exit1' } })
            let r2 = await filterOpencodeFree([FREE_A], { exe: fake.exe, env: { ...process.env, FAKE_MODE: 'empty' } })
            let r3 = await filterOpencodeFree([FREE_A], { exe: fake.exe, env: { ...process.env, FAKE_MODE: 'sleep' }, timeoutMs: 700 })
            assert.strict.deepEqual(
                [[r1.ok, r1.errorType, r1.error.includes('catalog broken')], [r2.ok, r2.errorType], [r3.ok, r3.errorType], r1.available, r2.available, r3.available],
                [[false, 'exit', true], [false, 'empty'], [false, 'timeout'], null, null, null],
            )
        })

        it('執行檔不存在或無法啟動 → notfound(不reject、各清單為null)', async function() {
            let r1 = await filterOpencodeFree([FREE_A], { exe: 'definitely-not-an-existing-opencode-binary-xyz' })
            let r2 = await filterOpencodeFree([FREE_A], { exe: bad.exe })
            assert.strict.deepEqual([[r1.ok, r1.errorType, r1.available], [r2.ok, r2.errorType, r2.available]], [[false, 'notfound', null], [false, 'notfound', null]])
        })

    })

})
