import assert from 'assert'
import dispatchAi from '../src/dispatchAi.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('dispatchAi', function() {

    let fake = null

    before(function() {
        fake = createFakeCli('fake-dispatchai')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('未知kind時回傳錯誤結果物件且不reject', async function() {
        let t = await dispatchAi('gemini', 'abc')
        let r = [t.ok, t.error, t.attempts]
        let rr = [false, 'unknown ai kind: "gemini" (available: opencode, claude, codex, antigravity, api-openai-compat)', 0]
        assert.strict.deepEqual(r, rr)
    })

    it('kind非有效字串時回傳錯誤結果物件', async function() {
        let r = []
        for (let kind of [null, undefined, '', 123, {}]) {
            let t = await dispatchAi(kind, 'abc')
            r.push([t.ok, t.error.indexOf('unknown ai kind') === 0])
        }
        let rr = [[false, true], [false, true], [false, true], [false, true], [false, true]]
        assert.strict.deepEqual(r, rr)
    })

    it('kind為原型鍵名時不可誤判為有效供應商', async function() {
        let r = []
        for (let kind of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
            let t = await dispatchAi(kind, 'abc')
            r.push([t.ok, t.error.indexOf('unknown ai kind') === 0])
        }
        let rr = [[false, true], [false, true], [false, true], [false, true]]
        assert.strict.deepEqual(r, rr)
    })

    it('prompt之檢核由各轉接器負責, 錯誤結果物件一致', async function() {
        let r = []
        for (let kind of ['opencode', 'claude', 'codex', 'antigravity']) {
            let t = await dispatchAi(kind, '')
            r.push([t.ok, t.error])
        }
        let rr = [
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('各kind分派至對應轉接器, 由其固定旗標可辨識', async function() {
        let r = []
        for (let kind of ['opencode', 'claude', 'codex', 'antigravity']) {
            let t = await dispatchAi(kind, 'abc', { exe: fake.exe, model: 'mdl' })
            let o = JSON.parse(t.stdout)
            r.push([t.ok, o.args])
        }
        let rr = [
            [true, ['run', '--agent', 'build', '-m', 'mdl']],
            [true, ['-p', '--dangerously-skip-permissions', '--model', 'mdl']],
            [true, ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-m', 'mdl']],
            [true, ['--dangerously-skip-permissions', '--print-timeout', '270s', '--model', 'mdl', '--print', 'abc']],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('opt原樣轉傳至對應轉接器', async function() {
        let t = await dispatchAi('opencode', 'abc', { exe: fake.exe, provider: 'opencode', key: 'sk-abc', extraArgs: ['--fake-stderr=warn'] })
        let o = JSON.parse(t.stdout)
        let r = [t.stderr, JSON.parse(o.env.OPENCODE_AUTH_CONTENT).opencode.key]
        let rr = ['warn', 'sk-abc']
        assert.strict.deepEqual(r, rr)
    })

    it('供應商條目可逐一輪替, 各條目自帶kind與model', async function() {
        let items = [
            { kind: 'opencode', model: 'opencode/free', provider: 'opencode', key: 'sk-1' },
            { kind: 'claude', model: 'sonnet' },
            { kind: 'codex', model: 'gpt-5.6-luna' },
            { kind: 'antigravity', model: 'gemini-3.6-flash-low' },
        ]
        let r = []
        for (let item of items) {
            let t = await dispatchAi(item.kind, 'abc', { ...item, exe: fake.exe })
            let o = JSON.parse(t.stdout)
            r.push([item.kind, o.args[0], o.args.includes(item.model)])
        }
        let rr = [
            ['opencode', 'run', true],
            ['claude', '-p', true],
            ['codex', 'exec', true],
            ['antigravity', '--dangerously-skip-permissions', true],
        ]
        assert.strict.deepEqual(r, rr)
    })

})
