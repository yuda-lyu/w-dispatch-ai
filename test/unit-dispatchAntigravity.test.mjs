import assert from 'assert'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli, { createUnstartableExe } from './tools/fakeCliForTest.mjs'
import spawnFailCases, { envUnreadableOpt } from './tools/spawnFailCasesForTest.mjs'


describe('dispatchAntigravity', function() {

    let fake = null
    let bad = null

    before(function() {
        fake = createFakeCli('fake-agy')
        bad = createUnstartableExe('bad-antigravity')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
        if (bad) {
            bad.clean()
        }
    })

    it('prompt非有效字串時回傳錯誤結果物件且不reject', async function() {
        let r = []
        for (let prompt of [null, undefined, '', 123, {}, []]) {
            let t = await dispatchAntigravity(prompt)
            r.push([t.ok, t.error, t.attempts])
        }
        let rr = [
            [false, 'prompt must be a non-empty string', 0],
            [false, 'prompt must be a non-empty string', 0],
            [false, 'prompt must be a non-empty string', 0],
            [false, 'prompt must be a non-empty string', 0],
            [false, 'prompt must be a non-empty string', 0],
            [false, 'prompt must be a non-empty string', 0],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('prompt超過30000字元時回傳prompt too long且不spawn', async function() {
        let t = await dispatchAntigravity('x'.repeat(30001), { exe: fake.exe })
        let r = [t.ok, t.error.indexOf('prompt too long (30001 chars > 30000)') === 0, t.attempts]
        let rr = [false, true, 0]
        assert.strict.deepEqual(r, rr)
    })

    it('prompt恰為30000字元時可正常spawn', async function() {
        let prompt = 'x'.repeat(30000)
        let t = await dispatchAntigravity(prompt, { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args[o.args.length - 1] === prompt]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('轉義膨脹突破命令列上限時(spawn同步拋ENAMETOOLONG)回傳錯誤結果物件不reject, errorType為spawn且attempts為1', async function() {
        //規格: README errorType表之spawn列(命令列過長屬子進程未能啟動); attempts為實際嘗試次數(帳本R-SPAWN-1)
        //29000個引號長度過前置檢查, 但spawn轉義後約58000字元 → 同步拋ENAMETOOLONG, wsemi>=1.9.15由execCli以結果物件回報(實際嘗試1次)
        let t = await dispatchAntigravity('"'.repeat(29000), { exe: fake.exe })
        let r = [t.ok, t.error.includes('ENAMETOOLONG'), t.attempts, t.errorType]
        let rr = [false, true, 1, 'spawn']
        assert.strict.deepEqual(r, rr)
    })

    it('預設帶--dangerously-skip-permissions與--print-timeout, prompt為--print之值且位於最後', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['--dangerously-skip-permissions', '--print-timeout', '330s', '--add-dir', process.cwd(), '--print', 'abc']]
        assert.strict.deepEqual(r, rr)
    })

    it('prompt不走stdin(agy由--print取得, 塞stdin會進互動模式)', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [o.stdin, o.args.includes('abc')]
        let rr = ['', true]
        assert.strict.deepEqual(r, rr)
    })

    it('有給model時帶--model旗標', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, model: 'gemini-3.6-flash-low' })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '330s', '--model', 'gemini-3.6-flash-low', '--add-dir', process.cwd(), '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('有給effort時帶--effort旗標', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, model: 'gemini-3.1-pro', effort: 'low' })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '330s', '--model', 'gemini-3.1-pro', '--effort', 'low', '--add-dir', process.cwd(), '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('skipPermissions為false時不帶--dangerously-skip-permissions旗標', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, skipPermissions: false })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['--print-timeout', '330s', '--add-dir', process.cwd(), '--print', 'abc']]
        assert.strict.deepEqual(r, rr)
    })

    it('printTimeout未給時推導為timeoutMs加30秒, 恆大於timeoutMs(外層先逾時, 令TIMEOUT分流與冷卻可達; agy自身逾時是exit 0之部分輸出而非錯誤)', async function() {
        //規格: README Timeout階梯「timeoutMs < agy --print-timeout(自動＝timeoutMs＋30s, 後備)」與timeoutMs列「逾時→error以TIMEOUT開頭→整組跳過」; 帳本R-AGY-2
        //(40000為關鍵格: 舊推導timeoutMs減30秒為max(30,10)=30秒, 小於timeoutMs, agy先到時而以exit 0交回截斷輸出)
        //有效timeoutMs(正整數或其數字字串): 值為floor(秒)+30, 且恆大於timeoutMs; 無效值(0、負數、非整數)回退預設300000→330s;
        //超過wsemi execCli計時器上限2147483647者外層本就夾至該值, 推導同樣封頂(agy拒收超出Go duration範圍之值, 實測9007199254770s與9223372037s皆exit 2)
        let r = []
        let rr = []
        for (let [timeoutMs, want, effMs] of [
            [600000, '630s', 600000], [120000, '150s', 120000], [40000, '70s', 40000], [5000, '35s', 5000],
            [1, '30s', 1], [999, '30s', 999], [1001, '31s', 1001], [39999, '69s', 39999], [40001, '70s', 40001],
            ['40000', '70s', 40000],
            [0, '330s', 300000], [-1, '330s', 300000], [1.5, '330s', 300000], [40000.5, '330s', 300000],
            [2147483647, '2147513s', 2147483647], [9223372007000, '2147513s', 2147483647], [Number.MAX_SAFE_INTEGER, '2147513s', 2147483647],
            [undefined, '330s', 300000],
        ]) {
            let opt = { exe: fake.exe }
            if (timeoutMs !== undefined) {
                opt.timeoutMs = timeoutMs
            }
            let t = await dispatchAntigravity('abc', opt)
            let o = JSON.parse(t.stdout)
            let i = o.args.indexOf('--print-timeout')
            let sec = Number(String(o.args[i + 1]).replace(/s$/, ''))
            r.push([o.args[i + 1], sec * 1000 > effMs])
            rr.push([want, true])
        }
        assert.strict.deepEqual(r, rr)
    })

    it('經遞補層之budgetMs壓縮後, 推導之printTimeout隨壓縮後之timeoutMs走(仍大於實際生效之timeoutMs, 不退回未壓縮之330s)', async function() {
        //規格: README Timeout階梯「budgetMs把剩餘預算壓進每次嘗試之timeoutMs」與printTimeout列「自動＝timeoutMs＋30s」; 帳本R-AGY-2
        let r = await dispatchAiFallback('abc', {
            providers: [{ id: 'agy:echo', kind: 'antigravity', exe: fake.exe, skipPermissions: false }],
            budgetMs: 45000,
        })
        let o = JSON.parse(r.stdout)
        let sec = Number(String(o.args[o.args.indexOf('--print-timeout') + 1]).replace(/s$/, ''))
        //壓縮後timeoutMs略小於45000(扣去呼叫前耗時), 故推導值為74~75秒: 大於45秒(外層先逾時)且遠小於未壓縮之330秒
        assert.strict.deepEqual([r.ok, sec * 1000 > 45000, sec >= 74 && sec <= 75], [true, true, true])
    })

    it('printTimeout明確給定時不推導', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, printTimeout: '10m', timeoutMs: 600000 })
        let o = JSON.parse(t.stdout)
        let i = o.args.indexOf('--print-timeout')
        let r = o.args[i + 1]
        let rr = '10m'
        assert.strict.deepEqual(r, rr)
    })

    it('未給addDirs時自動納入有效cwd(明給的cwd優先)', async function() {
        let t1 = await dispatchAntigravity('abc', { exe: fake.exe }) //cwd未給 → process.cwd()
        let t2 = await dispatchAntigravity('abc', { exe: fake.exe, cwd: fake.fd }) //cwd明給
        let o1 = JSON.parse(t1.stdout)
        let o2 = JSON.parse(t2.stdout)
        let i1 = o1.args.indexOf('--add-dir')
        let i2 = o2.args.indexOf('--add-dir')
        let r = [o1.args[i1 + 1], o2.args[i2 + 1]]
        let rr = [process.cwd(), fake.fd]
        assert.strict.deepEqual(r, rr)
    })

    it('明示addDirs為空陣列時不自動加入(代表不揭露任何目錄)', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, addDirs: [] })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args.includes('--add-dir')]
        let rr = [true, false]
        assert.strict.deepEqual(r, rr)
    })

    it('addDirs逐項展開為--add-dir並濾除非有效字串', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, addDirs: ['c:/a', null, 'c:/b', 123] })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '330s', '--add-dir', 'c:/a', '--add-dir', 'c:/b', '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('extraArgs接於固定旗標之後且於--print之前', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, extraArgs: ['--output-format', 'json'] })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '330s', '--add-dir', process.cwd(), '--output-format', 'json', '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('中文與多行prompt於--print值內完整保留', async function() {
        let prompt = '第一行中文\n第二行 with "quote" & <sym>\n第三行'
        let t = await dispatchAntigravity(prompt, { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = o.args[o.args.length - 1] === prompt
        let rr = true
        assert.strict.deepEqual(r, rr)
    })

    it('執行檔不存在時回傳ENOENT且不重試', async function() {
        let t = await dispatchAntigravity('abc', { exe: 'agy-not-exist-for-test', maxRetries: 3 })
        let r = [t.ok, t.error.includes('ENOENT'), t.attempts]
        let rr = [false, true, 1]
        assert.strict.deepEqual(r, rr)
    })

    it('離開碼非0時回傳失敗(如model與effort衝突時agy回exit 1)', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, extraArgs: ['--fake-exit=1', '--fake-stderr=conflicts with --effort'] })
        let r = [t.ok, t.code, t.error, t.stderr]
        let rr = [false, 1, 'Exit code 1', 'conflicts with --effort']
        assert.strict.deepEqual(r, rr)
    })

    it('cwd等execCli設定原樣轉傳', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, cwd: process.cwd() })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.cwd === process.cwd()]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('子進程未能啟動(存在但無法執行之執行檔、參數或環境變數含空字元、cwd不存在、不存在之.cmd、入口缺失之npm shim[Windows])時不reject, errorType為spawn、code為null且attempts為1', async function() {
        //規格: README errorType表之spawn列(子進程未能啟動, 不論錯誤碼)與「All functions never reject」; attempts為實際嘗試次數(帳本R-SPAWN-1、R-SPAWN-3); 不存在之.cmd與入口缺失之npm shim不重試(帳本R-USERFN-3, wsemi>=1.9.17; 1.9.16下shim入口缺失為Exit code 1、attempts隨maxRetries而歸exec)
        let cases = spawnFailCases({ kind: 'antigravity', okExe: fake.exe, badExe: bad.exe, shimNoEntryExe: bad.shimNoEntryExe })
        let r = []
        for (let c of cases) {
            let t = await dispatchAntigravity(c.prompt, c.opt)
            r.push([c.label, t.ok, t.errorType, t.code, t.attempts])
        }
        let rr = cases.map((c) => [c.label, false, 'spawn', null, 1])
        assert.strict.deepEqual(r, rr)
    })

    it('自訂validate拋錯時視同驗證失敗(OUTPUT_VALIDATION_FAILED, errorType為validation)且stderr前綴validate threw訊息(同REST類), 不成為未捕捉例外', async function() {
        //規格: README行為變更紀錄1.0.37第3條與1.0.48(validate拋錯改回驗證失敗, stderr前綴validate threw, 與REST類同規則; 帳本R-VALIDATE-1)
        let t = await dispatchAntigravity('abc', {
            exe: fake.exe,
            validate: () => {
                throw new Error('validate boom')
            },
        })
        let r = [t.ok, t.error, t.errorType, t.stderr.indexOf('validate threw: validate boom') === 0]
        let rr = [false, 'OUTPUT_VALIDATION_FAILED', 'validation', true]
        assert.strict.deepEqual(r, rr)
    })


    it('env不可讀(getter拋錯)時不reject, 以params回報且訊息載明env is not readable(四家同)', async function() {
        //規格: README「All functions never reject」與行為變更紀錄1.0.49起之env不可讀改回params(改寫1.0.48第17條之已知例外); 帳本R-USERFN-1(readCallerObj)、R-SPAWN-3
        let t = await dispatchAntigravity('abc', envUnreadableOpt(fake.exe))
        let r = [t.ok, t.errorType, t.error.indexOf('env is not readable: env getter boom') === 0, t.attempts]
        let rr = [false, 'params', true, 0]
        assert.strict.deepEqual(r, rr)
    })
})
