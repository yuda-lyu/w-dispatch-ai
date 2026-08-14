import assert from 'assert'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('dispatchAntigravity', function() {

    let fake = null

    before(function() {
        fake = createFakeCli('fake-agy')
    })

    after(function() {
        if (fake) {
            fake.clean()
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

    it('轉義膨脹突破命令列上限時由try/catch兜底回傳錯誤結果物件不reject', async function() {
        //29000個引號長度過前置檢查, 但spawn轉義後約58000字元 → 同步拋ENAMETOOLONG
        let t = await dispatchAntigravity('"'.repeat(29000), { exe: fake.exe })
        let r = [t.ok, t.error.includes('ENAMETOOLONG'), t.attempts]
        let rr = [false, true, 0]
        assert.strict.deepEqual(r, rr)
    })

    it('預設帶--dangerously-skip-permissions與--print-timeout, prompt為--print之值且位於最後', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['--dangerously-skip-permissions', '--print-timeout', '270s', '--add-dir', process.cwd(), '--print', 'abc']]
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
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '270s', '--model', 'gemini-3.6-flash-low', '--add-dir', process.cwd(), '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('有給effort時帶--effort旗標', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, model: 'gemini-3.1-pro', effort: 'low' })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '270s', '--model', 'gemini-3.1-pro', '--effort', 'low', '--add-dir', process.cwd(), '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('skipPermissions為false時不帶--dangerously-skip-permissions旗標', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, skipPermissions: false })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['--print-timeout', '270s', '--add-dir', process.cwd(), '--print', 'abc']]
        assert.strict.deepEqual(r, rr)
    })

    it('printTimeout由timeoutMs推導並預留30秒緩衝, 下限30秒', async function() {
        let r = []
        for (let timeoutMs of [600000, 120000, 5000, undefined]) {
            let opt = { exe: fake.exe }
            if (timeoutMs !== undefined) {
                opt.timeoutMs = timeoutMs
            }
            let t = await dispatchAntigravity('abc', opt)
            let o = JSON.parse(t.stdout)
            let i = o.args.indexOf('--print-timeout')
            r.push(o.args[i + 1])
        }
        let rr = ['570s', '90s', '30s', '270s'] //600-30, 120-30, max(30,5-30), 預設300-30
        assert.strict.deepEqual(r, rr)
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
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '270s', '--add-dir', 'c:/a', '--add-dir', 'c:/b', '--print', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('extraArgs接於固定旗標之後且於--print之前', async function() {
        let t = await dispatchAntigravity('abc', { exe: fake.exe, extraArgs: ['--output-format', 'json'] })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['--dangerously-skip-permissions', '--print-timeout', '270s', '--add-dir', process.cwd(), '--output-format', 'json', '--print', 'abc']
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

})
