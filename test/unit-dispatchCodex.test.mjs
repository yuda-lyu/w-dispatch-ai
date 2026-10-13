import assert from 'assert'
import dispatchCodex from '../src/dispatchCodex.mjs'
import createFakeCli, { createUnstartableExe } from './tools/fakeCliForTest.mjs'
import spawnFailCases from './tools/spawnFailCasesForTest.mjs'


describe('dispatchCodex', function() {

    let fake = null
    let bad = null

    before(function() {
        fake = createFakeCli('fake-codex')
        bad = createUnstartableExe('bad-codex')
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
            let t = await dispatchCodex(prompt)
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

    it('固定帶exec與--skip-git-repo-check旗標, sandbox預設workspace-write', async function() {
        let t = await dispatchCodex('abc', { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check']]
        assert.strict.deepEqual(r, rr)
    })

    it('有給model時帶-m旗標', async function() {
        let t = await dispatchCodex('abc', { exe: fake.exe, model: 'gpt-5.6-luna' })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-m', 'gpt-5.6-luna']
        assert.strict.deepEqual(r, rr)
    })

    it('model非有效字串時整段-m旗標不出現', async function() {
        let r = []
        for (let model of [null, undefined, '', 123, {}]) {
            let t = await dispatchCodex('abc', { exe: fake.exe, model })
            let o = JSON.parse(t.stdout)
            r.push(o.args.includes('-m'))
        }
        let rr = [false, false, false, false, false]
        assert.strict.deepEqual(r, rr)
    })

    it('sandbox可自訂, 非有效字串則回退workspace-write', async function() {
        let t1 = await dispatchCodex('abc', { exe: fake.exe, sandbox: 'read-only' })
        let t2 = await dispatchCodex('abc', { exe: fake.exe, sandbox: 123 })
        let r = [
            JSON.parse(t1.stdout).args[2],
            JSON.parse(t2.stdout).args[2],
        ]
        let rr = ['read-only', 'workspace-write']
        assert.strict.deepEqual(r, rr)
    })

    it('extraArgs接於固定旗標之後', async function() {
        let t = await dispatchCodex('abc', { exe: fake.exe, model: 'gpt-5.6-luna', extraArgs: ['--config', 'model_reasoning_effort="max"'] })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-m', 'gpt-5.6-luna', '--config', 'model_reasoning_effort="max"']
        assert.strict.deepEqual(r, rr)
    })

    it('prompt以stdin傳入, 中文與多行皆完整保留', async function() {
        let prompt = '第一行中文\n第二行 with "quote" & <sym>\n第三行'
        let t = await dispatchCodex(prompt, { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [o.stdin === prompt, o.args.includes(prompt)]
        let rr = [true, false]
        assert.strict.deepEqual(r, rr)
    })

    it('執行檔不存在時回傳ENOENT且不重試', async function() {
        let t = await dispatchCodex('abc', { exe: 'codex-not-exist-for-test', maxRetries: 3 })
        let r = [t.ok, t.error.includes('ENOENT'), t.attempts]
        let rr = [false, true, 1]
        assert.strict.deepEqual(r, rr)
    })

    it('失敗時依maxRetries重試, 重試次數含初始共maxRetries+1次', async function() {
        let t = await dispatchCodex('abc', { exe: fake.exe, extraArgs: ['--fake-exit=1'], maxRetries: 1, retryDelayMs: 100 })
        let r = [t.ok, t.code, t.attempts]
        let rr = [false, 1, 2]
        assert.strict.deepEqual(r, rr)
    })

    it('stderr內容原樣回傳', async function() {
        let t = await dispatchCodex('abc', { exe: fake.exe, extraArgs: ['--fake-stderr=some warning'] })
        let r = [t.ok, t.stderr]
        let rr = [true, 'some warning']
        assert.strict.deepEqual(r, rr)
    })

    it('子進程未能啟動(存在但無法執行之執行檔、參數或環境變數含空字元、cwd不存在)時不reject, errorType為spawn、code為null且attempts為1', async function() {
        //規格: README errorType表之spawn列(子進程未能啟動, 不論錯誤碼)與「All functions never reject」; attempts為實際嘗試次數(帳本R-SPAWN-1、R-SPAWN-3)
        let cases = spawnFailCases({ kind: 'codex', okExe: fake.exe, badExe: bad.exe })
        let r = []
        for (let c of cases) {
            let t = await dispatchCodex(c.prompt, c.opt)
            r.push([c.label, t.ok, t.errorType, t.code, t.attempts])
        }
        let rr = cases.map((c) => [c.label, false, 'spawn', null, 1])
        assert.strict.deepEqual(r, rr)
    })

    it('自訂validate拋錯時視同驗證失敗(OUTPUT_VALIDATION_FAILED, errorType為validation)且stderr前綴validate threw訊息(同REST類), 不成為未捕捉例外', async function() {
        //規格: README行為變更紀錄1.0.37第3條與1.0.48(validate拋錯改回驗證失敗, stderr前綴validate threw, 與REST類同規則; 帳本R-VALIDATE-1)
        let t = await dispatchCodex('abc', {
            exe: fake.exe,
            validate: () => {
                throw new Error('validate boom')
            },
        })
        let r = [t.ok, t.error, t.errorType, t.stderr.indexOf('validate threw: validate boom') === 0]
        let rr = [false, 'OUTPUT_VALIDATION_FAILED', 'validation', true]
        assert.strict.deepEqual(r, rr)
    })

})
