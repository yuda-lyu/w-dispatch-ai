import assert from 'assert'
import providersAll from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-providersAnthropicEntries.test.mjs — 內建 Anthropic 條目(claude-api:×3、anthropic:×3)經 resolveProviders → dispatchAiFallback 之整合行為
//
// 規格來源: README「Claude以API金鑰計費」、帳本R-ANTHROPIC-3(sgud/rule/rulebook_anthropic.md)。
// 條目本身只是資料; 本檔驗證「資料→轉接器」整條路徑確實把模型ID、思考強度、金鑰、防寫白名單送到子進程或請求本體(含 .env 風格的 ANTHROPIC_KEYS 展開),
// 全程假伺服器與假 CLI, 不發出任何 Anthropic 請求。


let K1 = 'sk-ant-api03-ENTRY-KEY-ONE-1111'
let K2 = 'sk-ant-api03-ENTRY-KEY-TWO-2222'
let MASK = '[REDACTED]'

//假claude: 把收到的argv與ANTHROPIC_API_KEY/AUTH_TOKEN回寫stdout(JSON); key會被dispatchClaude遮蔽, 故以遮蔽字樣證明「key確在子進程環境」
let ENTRY = `
let chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({
        args: process.argv.slice(2),
        stdin: Buffer.concat(chunks).toString('utf8'),
        apiKey: process.env.ANTHROPIC_API_KEY || null,
        authToken: process.env.ANTHROPIC_AUTH_TOKEN || null,
    }))
})
`

describe('內建Anthropic條目整合(resolveProviders → dispatchAiFallback)', function() {

    let srv = null
    let fake = null

    before(async function() {
        srv = await fakeServerForAnthropicTest()
        fake = createFakeCli('fake-claude-entries', ENTRY)
    })

    after(async function() {
        if (srv) {
            await srv.close()
        }
        if (fake) {
            fake.clean()
        }
    })

    //每次呼叫用全新store, 不與同行程其他測試共用dispatchAiFallback之行程內游標
    let freshStore = () => {
        let st = null
        return {
            get: () => st,
            set: (s) => {
                st = s
            },
        }
    }

    let env = { ANTHROPIC_KEYS: ` ${K1} , ${K2},` }
    let models = { 'opus-5.5': 'claude-opus-5-5', 'sonnet-5.5': 'claude-sonnet-5-5', 'haiku-5.5': 'claude-haiku-5-5' }

    it('anthropic:三條: 以展開之金鑰、完整模型ID、effort high、x-api-key與anthropic-version送出請求(第1把金鑰先用, 成功後游標前進)', async function() {
        let rp = resolveProviders(providersAll, {
            env,
            pick: Object.keys(models).map((k) => `anthropic:${k}`),
            patch: Object.fromEntries(Object.keys(models).map((k) => [`anthropic:${k}`, { baseURL: srv.url }])),
        })
        let seen = []
        for (let p of rp.providers) {
            srv.requests.length = 0
            let r = await dispatchAiFallback('abc', { providers: [p], store: freshStore() })
            let q = srv.requests[0]
            seen.push([p.id, r.ok, r.keyIndex, q.headers['x-api-key'] === K1, q.headers['anthropic-version'], q.body.model, q.body.output_config, q.body.max_tokens, JSON.stringify(r).includes(K1)])
        }
        let rr = Object.keys(models).map((k) => [`anthropic:${k}`, true, 0, true, '2023-06-01', models[k], { effort: 'high' }, 16000, false])
        assert.strict.deepEqual([rp.skipped, seen], [[], rr])
    })

    it('anthropic:同一條目連續呼叫兩次: 金鑰游標前進, 第2次改用第2把金鑰', async function() {
        let rp = resolveProviders(providersAll, { env, pick: ['anthropic:haiku-5.5'], patch: { 'anthropic:haiku-5.5': { baseURL: srv.url } } })
        let opt = { providers: rp.providers, store: freshStore() } //兩次呼叫共用同一store, 游標才會前進
        srv.requests.length = 0
        let r1 = await dispatchAiFallback('abc', opt)
        let r2 = await dispatchAiFallback('abc', opt)
        let used = srv.requests.map((q) => q.headers['x-api-key'])
        assert.strict.deepEqual([r1.keyIndex, r2.keyIndex, used], [0, 1, [K1, K2]])
    })

    it('claude-api:三條: 完整模型ID、唯讀白名單(--tools Read,Glob,Grep --strict-mcp-config)、--effort high、key在子進程環境(經遮蔽)、父環境之AUTH_TOKEN被移除', async function() {
        let rp = resolveProviders(providersAll, {
            env,
            pick: Object.keys(models).map((k) => `claude-api:${k}`),
            exes: { claude: fake.exe },
        })
        let old = process.env.ANTHROPIC_AUTH_TOKEN
        process.env.ANTHROPIC_AUTH_TOKEN = 'parent-token-for-test'
        let seen = []
        try {
            for (let p of rp.providers) {
                let r = await dispatchAiFallback('abc', { providers: [p], store: freshStore() })
                let o = JSON.parse(r.stdout)
                seen.push([p.id, r.ok, r.keyIndex, o.args, o.apiKey, o.authToken, JSON.stringify(r).includes(K1)])
            }
        }
        finally {
            if (old === undefined) {
                delete process.env.ANTHROPIC_AUTH_TOKEN
            }
            else {
                process.env.ANTHROPIC_AUTH_TOKEN = old
            }
        }
        let rr = Object.keys(models).map((k) => [
            `claude-api:${k}`,
            true,
            0,
            ['-p', '--dangerously-skip-permissions', '--model', models[k], '--tools', 'Read,Glob,Grep', '--strict-mcp-config', '--effort', 'high'],
            MASK,
            null,
            false,
        ])
        assert.strict.deepEqual([rp.skipped, seen], [[], rr])
    })

    it('claude-api:同一條目連續呼叫兩次(CLI): 金鑰游標前進, 第2次改用第2把金鑰, 兩次皆成功', async function() {
        let rp = resolveProviders(providersAll, { env, pick: ['claude-api:haiku-5.5'], exes: { claude: fake.exe } })
        let opt = { providers: rp.providers, store: freshStore() }
        let r1 = await dispatchAiFallback('abc', opt)
        let r2 = await dispatchAiFallback('abc', opt)
        assert.strict.deepEqual([r1.ok, r1.keyIndex, r2.ok, r2.keyIndex], [true, 0, true, 1])
    })

    it('缺ANTHROPIC_KEYS時六條全數skipped; 只有ANTHROPIC_API_KEY(全域設定)時亦不展開——內建條目不認它', function() {
        let a = resolveProviders(providersAll, { env: {}, pick: [...Object.keys(models).map((k) => `anthropic:${k}`), ...Object.keys(models).map((k) => `claude-api:${k}`)] })
        let b = resolveProviders(providersAll, { env: { ANTHROPIC_API_KEY: K1 }, pick: ['anthropic:haiku-5.5', 'claude-api:haiku-5.5'] })
        assert.strict.deepEqual([a.providers.length, a.skipped.length, b.providers.length, b.skipped.map((s) => s.id)], [0, 6, 0, ['anthropic:haiku-5.5', 'claude-api:haiku-5.5']])
    })

})
