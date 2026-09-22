import assert from 'assert'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('dispatchOpencode', function() {

    let fake = null

    before(function() {
        fake = createFakeCli('fake-opencode')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('prompt非有效字串時回傳錯誤結果物件且不reject', async function() {
        let r = []
        for (let prompt of [null, undefined, '', 123, {}, []]) {
            let t = await dispatchOpencode(prompt)
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

    it('固定帶run與--agent旗標, agent預設build', async function() {
        let t = await dispatchOpencode('abc', { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['run', '--agent', 'build']]
        assert.strict.deepEqual(r, rr)
    })

    it('有給model時帶-m旗標', async function() {
        let t = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/muse-spark-1.3-contributor-free' })
        let o = JSON.parse(t.stdout)
        let r = o.args
        let rr = ['run', '--agent', 'build', '-m', 'opencode/muse-spark-1.3-contributor-free']
        assert.strict.deepEqual(r, rr)
    })

    it('agent可自訂, 非有效字串則回退build', async function() {
        let t1 = await dispatchOpencode('abc', { exe: fake.exe, agent: 'plan' })
        let t2 = await dispatchOpencode('abc', { exe: fake.exe, agent: 123 })
        let r = [
            JSON.parse(t1.stdout).args[2],
            JSON.parse(t2.stdout).args[2],
        ]
        let rr = ['plan', 'build']
        assert.strict.deepEqual(r, rr)
    })

    it('同時給予key與provider時注入OPENCODE_AUTH_CONTENT', async function() {
        let t = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key: 'sk-abc123' })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, JSON.parse(o.env.OPENCODE_AUTH_CONTENT)]
        let rr = [true, { opencode: { type: 'api', key: 'sk-abc123' } }]
        assert.strict.deepEqual(r, rr)
    })

    it('僅給key或僅給provider時不注入OPENCODE_AUTH_CONTENT', async function() {
        let t1 = await dispatchOpencode('abc', { exe: fake.exe, key: 'sk-abc123' })
        let t2 = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode' })
        let t3 = await dispatchOpencode('abc', { exe: fake.exe })
        let r = [
            JSON.parse(t1.stdout).env.OPENCODE_AUTH_CONTENT,
            JSON.parse(t2.stdout).env.OPENCODE_AUTH_CONTENT,
            JSON.parse(t3.stdout).env.OPENCODE_AUTH_CONTENT,
        ]
        let rr = ['', '', '']
        assert.strict.deepEqual(r, rr)
    })

    it('useStoredAuth為false且未注入金鑰時注入空憑證\'{}\'(不讀auth.json); 非false一律不注入; 旗標不進命令列', async function() {
        let t1 = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', useStoredAuth: false })
        let t2 = await dispatchOpencode('abc', { exe: fake.exe, useStoredAuth: false })
        let t3 = await dispatchOpencode('abc', { exe: fake.exe, useStoredAuth: true })
        let t4 = await dispatchOpencode('abc', { exe: fake.exe, useStoredAuth: 'false' })
        let r = [
            JSON.parse(t1.stdout).env.OPENCODE_AUTH_CONTENT,
            JSON.parse(t2.stdout).env.OPENCODE_AUTH_CONTENT,
            JSON.parse(t3.stdout).env.OPENCODE_AUTH_CONTENT,
            JSON.parse(t4.stdout).env.OPENCODE_AUTH_CONTENT,
            JSON.parse(t1.stdout).args,
        ]
        let rr = ['{}', '{}', '', '', ['run', '--agent', 'build']]
        assert.strict.deepEqual(r, rr)
    })

    it('useStoredAuth為false但同時給key與provider時以金鑰注入為準; 亦覆寫呼叫端env內之同名變數', async function() {
        let t1 = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key: 'sk-abc123', useStoredAuth: false })
        let t2 = await dispatchOpencode('abc', { exe: fake.exe, useStoredAuth: false, env: { OPENCODE_AUTH_CONTENT: '', FAKE_ENV: 'x' } })
        let o2 = JSON.parse(t2.stdout)
        let r = [JSON.parse(JSON.parse(t1.stdout).env.OPENCODE_AUTH_CONTENT), o2.env.OPENCODE_AUTH_CONTENT, o2.env.FAKE_ENV]
        let rr = [{ opencode: { type: 'api', key: 'sk-abc123' } }, '{}', 'x']
        assert.strict.deepEqual(r, rr)
    })

    it('金鑰注入僅作用於當次子進程, 不影響本進程之process.env', async function() {
        let before = process.env.OPENCODE_AUTH_CONTENT
        let t = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key: 'sk-abc123' })
        let o = JSON.parse(t.stdout)
        let after = process.env.OPENCODE_AUTH_CONTENT
        let r = [o.env.OPENCODE_AUTH_CONTENT !== '', before === after]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('逐次可帶不同金鑰, 供多把金鑰輪替', async function() {
        let r = []
        for (let key of ['sk-key1', 'sk-key2', 'sk-key3']) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key })
            let o = JSON.parse(t.stdout)
            r.push(JSON.parse(o.env.OPENCODE_AUTH_CONTENT).opencode.key)
        }
        let rr = ['sk-key1', 'sk-key2', 'sk-key3']
        assert.strict.deepEqual(r, rr)
    })

    it('config為物件時序列化後以OPENCODE_CONFIG_CONTENT注入', async function() {
        let config = {
            provider: {
                'agnes-ai': {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Agnes',
                    options: { baseURL: 'https://apihub.agnes-ai.com/v1' },
                    models: { 'agnes-2.0-flash': { name: 'Agnes 2.0 Flash' } },
                },
            },
        }
        let t = await dispatchOpencode('abc', { exe: fake.exe, model: 'agnes-ai/agnes-2.0-flash', provider: 'agnes-ai', key: 'sk-abc123', config })
        let o = JSON.parse(t.stdout)
        let r = [
            JSON.parse(o.env.OPENCODE_CONFIG_CONTENT),
            JSON.parse(o.env.OPENCODE_AUTH_CONTENT),
            o.args,
        ]
        let rr = [
            config,
            { 'agnes-ai': { type: 'api', key: 'sk-abc123' } },
            ['run', '--agent', 'build', '-m', 'agnes-ai/agnes-2.0-flash'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('config為JSON字串時原樣注入', async function() {
        let config = '{"provider":{"agnes-ai":{"npm":"@ai-sdk/openai-compatible"}}}'
        let t = await dispatchOpencode('abc', { exe: fake.exe, config })
        let o = JSON.parse(t.stdout)
        let r = o.env.OPENCODE_CONFIG_CONTENT
        let rr = config
        assert.strict.deepEqual(r, rr)
    })

    it('config非有效物件或字串時不注入OPENCODE_CONFIG_CONTENT', async function() {
        let r = []
        for (let config of [null, undefined, '', 123, []]) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, config })
            let o = JSON.parse(t.stdout)
            r.push(o.env.OPENCODE_CONFIG_CONTENT)
        }
        let rr = ['', '', '', '', '']
        assert.strict.deepEqual(r, rr)
    })

    it('自帶env可與金鑰注入併存', async function() {
        let t = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key: 'sk-abc123', env: { FAKE_ENV: 'hello' } })
        let o = JSON.parse(t.stdout)
        let r = [o.env.FAKE_ENV, JSON.parse(o.env.OPENCODE_AUTH_CONTENT).opencode.key]
        let rr = ['hello', 'sk-abc123']
        assert.strict.deepEqual(r, rr)
    })

    it('prompt以stdin傳入, 中文與多行皆完整保留', async function() {
        let prompt = '第一行中文\n第二行 with "quote" & <sym>\n第三行'
        let t = await dispatchOpencode(prompt, { exe: fake.exe })
        let o = JSON.parse(t.stdout)
        let r = [o.stdin === prompt, o.args.includes(prompt)]
        let rr = [true, false]
        assert.strict.deepEqual(r, rr)
    })

    it('執行檔不存在時回傳ENOENT且不重試', async function() {
        let t = await dispatchOpencode('abc', { exe: 'opencode-not-exist-for-test', maxRetries: 3 })
        let r = [t.ok, t.error.includes('ENOENT'), t.attempts]
        let rr = [false, true, 1]
        assert.strict.deepEqual(r, rr)
    })

})
