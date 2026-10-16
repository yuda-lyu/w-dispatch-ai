import assert from 'assert'
import path from 'path'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import createFakeCli, { createUnstartableExe } from './tools/fakeCliForTest.mjs'
import spawnFailCases, { envUnreadableOpt } from './tools/spawnFailCasesForTest.mjs'


describe('dispatchOpencode', function() {

    let fake = null
    let bad = null

    before(function() {
        fake = createFakeCli('fake-opencode')
        bad = createUnstartableExe('bad-opencode')
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

    it('PWD同步為有效cwd之絕對路徑: 有給cwd(絕對或相對)即解析之且等於子進程真實cwd, 未給則為process.cwd()', async function() {
        let t1 = await dispatchOpencode('abc', { exe: fake.exe, cwd: fake.fd })
        let t2 = await dispatchOpencode('abc', { exe: fake.exe, cwd: path.relative(process.cwd(), fake.fd) })
        let t3 = await dispatchOpencode('abc', { exe: fake.exe })
        let o1 = JSON.parse(t1.stdout)
        let o2 = JSON.parse(t2.stdout)
        let o3 = JSON.parse(t3.stdout)
        let r = [o1.env.PWD, o1.env.PWD === o1.cwd, o2.env.PWD, o3.env.PWD, o3.env.PWD === o3.cwd]
        let rr = [path.resolve(fake.fd), true, path.resolve(fake.fd), process.cwd(), true]
        assert.strict.deepEqual(r, rr)
    })

    it('呼叫端env內之PWD(含整份展開process.env之寫法)被有效cwd覆寫, 其餘變數保留', async function() {
        let t = await dispatchOpencode('abc', { exe: fake.exe, cwd: fake.fd, env: { ...process.env, PWD: 'C:/somewhere/else', FAKE_ENV: 'x' } })
        let o = JSON.parse(t.stdout)
        let r = [o.env.PWD, o.env.FAKE_ENV]
        let rr = [path.resolve(fake.fd), 'x']
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

    it('子進程未能啟動(存在但無法執行之執行檔、參數或環境變數含空字元、cwd不存在、不存在之.cmd、入口缺失之npm shim[Windows])時不reject, errorType為spawn、code為null且attempts為1', async function() {
        //規格: README errorType表之spawn列(子進程未能啟動, 不論錯誤碼)與「All functions never reject」; attempts為實際嘗試次數(帳本R-SPAWN-1、R-SPAWN-3); 不存在之.cmd與入口缺失之npm shim不重試(帳本R-USERFN-3, wsemi>=1.9.17; 1.9.16下shim入口缺失為Exit code 1、attempts隨maxRetries而歸exec)
        let cases = spawnFailCases({ kind: 'opencode', okExe: fake.exe, badExe: bad.exe, shimNoEntryExe: bad.shimNoEntryExe })
        let r = []
        for (let c of cases) {
            let t = await dispatchOpencode(c.prompt, c.opt)
            r.push([c.label, t.ok, t.errorType, t.code, t.attempts])
        }
        let rr = cases.map((c) => [c.label, false, 'spawn', null, 1])
        assert.strict.deepEqual(r, rr)
    })

    it('自訂validate拋錯時視同驗證失敗(OUTPUT_VALIDATION_FAILED, errorType為validation)且stderr前綴validate threw訊息(同REST類), 不成為未捕捉例外', async function() {
        //規格: README行為變更紀錄1.0.37第3條與1.0.48(validate拋錯改回驗證失敗, stderr前綴validate threw, 與REST類同規則; 帳本R-VALIDATE-1)
        let t = await dispatchOpencode('abc', {
            exe: fake.exe,
            validate: () => {
                throw new Error('validate boom')
            },
        })
        let r = [t.ok, t.error, t.errorType, t.stderr.indexOf('validate threw: validate boom') === 0]
        let rr = [false, 'OUTPUT_VALIDATION_FAILED', 'validation', true]
        assert.strict.deepEqual(r, rr)
    })

    it('config不可序列化(BigInt、循環參照)時回傳params錯誤結果物件且不reject', async function() {
        //規格: README行為變更紀錄1.0.48(config不可序列化回params, 不reject; 帳本R-NOREJECT-1)
        let circ = {}
        circ.self = circ
        let r = []
        for (let config of [{ x: 10n }, circ]) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, config })
            r.push([t.ok, t.errorType, t.error.indexOf('config is not JSON-serializable') === 0, t.attempts])
        }
        let rr = [[false, 'params', true, 0], [false, 'params', true, 0]]
        assert.strict.deepEqual(r, rr)
    })


    it('env不可讀(getter拋錯)時不reject, 以params回報且訊息載明env is not readable(四家同)', async function() {
        //規格: README「All functions never reject」與行為變更紀錄1.0.49起之env不可讀改回params(改寫1.0.48第17條之已知例外); 帳本R-USERFN-1(readCallerObj)、R-SPAWN-3
        let t = await dispatchOpencode('abc', envUnreadableOpt(fake.exe))
        let r = [t.ok, t.errorType, t.error.indexOf('env is not readable: env getter boom') === 0, t.attempts]
        let rr = [false, 'params', true, 0]
        assert.strict.deepEqual(r, rr)
    })
})
