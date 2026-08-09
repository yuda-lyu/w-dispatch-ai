import assert from 'assert'
import dispatchClaude from '../src/dispatchClaude.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('dispatchClaude', function() {

    let fake = null

    before(function() {
        fake = createFakeCli('fake-claude')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('prompt非有效字串時回傳錯誤結果物件且不reject', async function() {
        let r = []
        for (let prompt of [null, undefined, '', 123, {}, []]) {
            let t = await dispatchClaude(prompt)
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

    it('固定帶-p與--dangerously-skip-permissions旗標', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['-p', '--dangerously-skip-permissions']]
        assert.strict.deepEqual(r, rr)
    })

    it('有給model時帶--model旗標', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, model: 'sonnet' })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['-p', '--dangerously-skip-permissions', '--model', 'sonnet']
        assert.strict.deepEqual(r, rr)
    })

    it('model非有效字串時整段--model旗標不出現', async function() {
        let r = []
        for (let model of [null, undefined, '', 123, {}]) {
            let t = await dispatchClaude('abc', { exe: fake.exe, model })
            let o = JSON.parse(t.stdout)
            r.push(o.args.includes('--model'))
        }
        let rr = [false, false, false, false, false]
        assert.strict.deepEqual(r, rr)
    })

    it('skipPermissions為false時不帶--dangerously-skip-permissions旗標', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, model: 'sonnet', skipPermissions: false })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['-p', '--model', 'sonnet']]
        assert.strict.deepEqual(r, rr)
    })

    it('skipPermissions非布林值時回退預設true', async function() {
        let r = []
        for (let skipPermissions of [null, undefined, 1, 'false', {}]) {
            let t = await dispatchClaude('abc', { exe: fake.exe, skipPermissions })
            let o = JSON.parse(t.stdout)
            r.push(o.args.includes('--dangerously-skip-permissions'))
        }
        let rr = [true, true, true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('extraArgs接於固定旗標之後', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, model: 'sonnet', extraArgs: ['--verbose', '--fake-stderr=warn'] })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['-p', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose', '--fake-stderr=warn']
        assert.strict.deepEqual(r, rr)
    })

    it('prompt以stdin傳入, 中文與多行皆完整保留', async function() {
        let prompt = '第一行中文\n第二行 with "quote" & <sym>\n第三行'
        let t = await dispatchClaude(prompt, { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [o.stdin === prompt, o.args.includes(prompt)]
        let rr = [true, false]
        assert.strict.deepEqual(r, rr)
    })

    it('執行檔不存在時回傳ENOENT且不重試', async function() {
        let t = await dispatchClaude('abc', { exe: 'claude-not-exist-for-test', maxRetries: 3 })
        let r = [t.ok, t.error.includes('ENOENT'), t.attempts]
        let rr = [false, true, 1]
        assert.strict.deepEqual(r, rr)
    })

    it('離開碼非0時回傳失敗', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, extraArgs: ['--fake-exit=1'] })
        let r = [t.ok, t.code, t.error]
        let rr = [false, 1, 'Exit code 1']
        assert.strict.deepEqual(r, rr)
    })

    it('validate驗證失敗時回傳OUTPUT_VALIDATION_FAILED', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, validate: 'min:100000' })
        let r = [t.ok, t.code, t.error]
        let rr = [false, 0, 'OUTPUT_VALIDATION_FAILED']
        assert.strict.deepEqual(r, rr)
    })

    it('逾時時強制關閉子進程並回傳TIMEOUT', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, extraArgs: ['--fake-sleep=10000'], timeoutMs: 1000 })
        let r = [t.ok, t.error.includes('TIMEOUT')]
        let rr = [false, true]
        assert.strict.deepEqual(r, rr)
    })

    it('cwd等execCli設定原樣轉傳', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, cwd: process.cwd() })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.cwd === process.cwd()]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('無key概念, 給予key與provider亦不注入OPENCODE_AUTH_CONTENT', async function() {
        let t = await dispatchClaude('abc', { exe: fake.exe, key: 'sk-abc', provider: 'opencode' })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.env.OPENCODE_AUTH_CONTENT]
        let rr = [true, '']
        assert.strict.deepEqual(r, rr)
    })

})
