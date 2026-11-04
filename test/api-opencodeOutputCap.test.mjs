import assert from 'assert'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import { OUTPUT_TOKEN_MAX_ENV, DEFAULT_OUTPUT_TOKEN_MAX } from '../src/outputTokenMax.mjs'


// api-opencodeOutputCap.test.mjs — 真實opencode CLI × 本機假OpenAI相容服務: 輸出上限(max_tokens)之來源與注入、截斷偵測(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 【為何需要】issue #78稱「OpenCode Go單次輸出上限32,000 token(reasoning+output)」, 未查證是閘道還是CLI端。本檔以自建127.0.0.1服務攔截opencode run實際送出之請求,
//   不花額度、不打外網, 釘住下列事實(證據: sgud/rule/rulebook_opencodego.md R-OCGO-4; 2026-11-04, opencode 1.19.5):
//   A1 請求之輸出上限欄位為`max_tokens`, 值 = min(模型型錄limit.output, 環境變數OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX或CLI預設32000)
//   A2 本套件預設注入DEFAULT_OUTPUT_TOKEN_MAX; opt.outputTokenMax可覆寫; 呼叫端環境內之有效值保留; 無效值視為未給
//   A3 終止原因為length時, `--format json`之step_finish帶reason 'length', detectTruncation據此回報incomplete(預設格式下完全看不出)
//   A4 未截斷時detectTruncation之stdout與預設路徑逐位元相同
//
// 【環境不足時略過(pending)而非通過】本檔需要本機已安裝opencode CLI, 且該CLI能載入@ai-sdk/openai-compatible(首次可能需連網安裝); 煙霧呼叫失敗時略過並印出原因。
//   「CLI可用卻與規格不符」一律紅燈。


let FD_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'opencodeOutputCap')


describe('opencode輸出上限與截斷偵測(真實CLI + 本機假服務)', function() {

    this.timeout(180000)

    let server = null
    let port = 0
    let seen = [] //{ model, max_tokens, hasTools }
    let savedEnv

    //model名即行為: ok* → stop; len-text → length且有部分文字; len-empty → length且無文字
    let handler = (req, res) => {
        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
            let j = null
            try {
                j = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            catch {}
            if (!j || !req.url.endsWith('/chat/completions')) {
                res.writeHead(404, { 'content-type': 'application/json' })
                res.end('{"error":"not found"}')
                return
            }
            seen.push({ model: j.model, max_tokens: j.max_tokens, hasTools: Array.isArray(j.tools) && j.tools.length > 0 })
            res.writeHead(200, { 'content-type': 'text/event-stream' })
            let mk = (delta, fr, usage) => 'data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: j.model, choices: [{ index: 0, delta, finish_reason: fr }], ...(usage ? { usage } : {}) }) + '\n\n'
            let u = (c, r) => ({ prompt_tokens: 10, completion_tokens: c, total_tokens: 10 + c, completion_tokens_details: { reasoning_tokens: r } })
            res.write(mk({ role: 'assistant', content: '' }, null))
            if (j.model === 'len-text') {
                res.write(mk({ content: 'partial {"a":' }, null))
                res.write(mk({}, 'length', u(32000, 20000)))
            }
            else if (j.model === 'len-empty') {
                res.write(mk({}, 'length', u(32000, 32000)))
            }
            else {
                res.write(mk({ content: '\n  OK  \n' }, null))
                res.write(mk({}, 'stop', u(1, 0)))
            }
            res.write('data: [DONE]\n\n')
            res.end()
        })
    }

    //模型型錄: 名稱 → limit.output
    let LIMITS = { 'ok-384k': 384000, 'ok-131k': 131072, 'ok-8k': 8000, 'len-text': 384000, 'len-empty': 384000 }

    let run = (model, opt = {}) => {
        let { env: envExtra = {}, ...rest } = opt
        let models = {}
        for (let [id, out] of Object.entries(LIMITS)) {
            models[id] = { name: id, limit: { context: 1000000, output: out } }
        }

        //env: 整份展開process.env(呼叫端常見用法), 另指向測試專用之XDG_DATA_HOME令session與資料庫不落使用者目錄
        return dispatchOpencode('say OK', {
            model: `fakeprov/${model}`,
            useStoredAuth: false,
            config: {
                provider: { fakeprov: { npm: '@ai-sdk/openai-compatible', name: 'Fake', options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'fake' }, models } },
                permission: { edit: 'deny', bash: 'ask' },
            },
            env: { ...process.env, XDG_DATA_HOME: path.join(FD_TMP, 'xdg'), ...envExtra },
            timeoutMs: 120000,
            spawnGate: false,
            ...rest,
        })
    }

    //取某次呼叫期間攔截到之max_tokens(去重)
    let capOf = async (model, opt = {}) => {
        seen.length = 0
        let t = await run(model, opt)
        let caps = [...new Set(seen.map((s) => s.max_tokens))]
        return { t, caps, n: seen.length }
    }

    before(async function() {
        let v = spawnSync('opencode', ['--version'], { shell: true, encoding: 'utf8', windowsHide: true })
        if (v.status !== 0) {
            console.log('[略過] 本機未安裝opencode CLI')
            this.skip()
        }
        fs.mkdirSync(path.join(FD_TMP, 'xdg'), { recursive: true })
        savedEnv = process.env[OUTPUT_TOKEN_MAX_ENV]
        delete process.env[OUTPUT_TOKEN_MAX_ENV]
        server = http.createServer(handler)
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        port = server.address().port

        //煙霧呼叫: CLI須能載入自訂provider並打到本機假服務
        let smoke = await capOf('ok-384k')
        if (!smoke.t.ok || smoke.n === 0) {
            console.log(`[略過] opencode無法使用本機假服務(可能需連網安裝provider套件): ok=${smoke.t.ok}, code=${smoke.t.code}, error=${smoke.t.error}, stderr=${String(smoke.t.stderr).slice(0, 200)}`)
            this.skip()
        }
    })

    after(async function() {
        if (savedEnv !== undefined) {
            process.env[OUTPUT_TOKEN_MAX_ENV] = savedEnv
        }
        if (server) {
            await new Promise((resolve) => server.close(resolve))
        }
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    it('A2: 預設 → 請求之max_tokens為套件預設(型錄output 384000較大時)', async function() {
        let r = await capOf('ok-384k')
        assert.strict.deepEqual([r.t.ok, r.caps], [true, [DEFAULT_OUTPUT_TOKEN_MAX]])
    })

    it('A1: 實際上限取min(型錄output, 注入值): 型錄8000 → 8000; 型錄131072且注入200000 → 131072', async function() {
        let a = await capOf('ok-8k')
        let b = await capOf('ok-131k', { outputTokenMax: 200000 })
        assert.strict.deepEqual([a.caps, b.caps], [[8000], [131072]])
    })

    it('A2: opt.outputTokenMax覆寫(數字、數字字串); 給32000即回到CLI原預設(修前形狀)', async function() {
        let a = await capOf('ok-384k', { outputTokenMax: 128000 })
        let b = await capOf('ok-384k', { outputTokenMax: '96000' })
        let c = await capOf('ok-384k', { outputTokenMax: 32000 })
        assert.strict.deepEqual([a.caps, b.caps, c.caps], [[128000], [96000], [32000]])
    })

    it('A2: 呼叫端opt.env已設有效值 → 保留(蓋過套件預設)', async function() {
        let r = await capOf('ok-384k', { env: { [OUTPUT_TOKEN_MAX_ENV]: '50000' } })
        assert.strict.deepEqual(r.caps, [50000])
    })

    it('A2: 本行程process.env已設有效值 → 保留; opt.outputTokenMax仍可蓋過', async function() {
        process.env[OUTPUT_TOKEN_MAX_ENV] = '48000'
        try {
            let a = await capOf('ok-384k')
            let b = await capOf('ok-384k', { outputTokenMax: 100000 })
            assert.strict.deepEqual([a.caps, b.caps], [[48000], [100000]])
        }
        finally {
            delete process.env[OUTPUT_TOKEN_MAX_ENV]
        }
    })

    it('A2: 無效值(opt與環境內)視為未給 → 套件預設; 未傳給CLI原值(CLI對無效值會靜默回32000)', async function() {
        let a = await capOf('ok-384k', { outputTokenMax: 'abc' })
        let b = await capOf('ok-384k', { outputTokenMax: 0 })
        let c = await capOf('ok-384k', { env: { [OUTPUT_TOKEN_MAX_ENV]: 'abc' } })
        let d = await capOf('ok-384k', { env: { [OUTPUT_TOKEN_MAX_ENV]: '64000.5' } })
        assert.strict.deepEqual([a.caps, b.caps, c.caps, d.caps], [[DEFAULT_OUTPUT_TOKEN_MAX], [DEFAULT_OUTPUT_TOKEN_MAX], [DEFAULT_OUTPUT_TOKEN_MAX], [DEFAULT_OUTPUT_TOKEN_MAX]])
    })

    it('A3: 預設路徑下length截斷無從分辨 —— ok:true、stdout空、離開碼0(本案症狀: 靜默成功)', async function() {
        let t = (await capOf('len-empty')).t
        assert.strict.deepEqual([t.ok, t.code, t.stdout.trim(), t.errorType, t.truncated], [true, 0, '', undefined, undefined])
    })

    it('A3: detectTruncation → length無可見輸出回incomplete, 帶reasoning token', async function() {
        let t = (await capOf('len-empty', { detectTruncation: true })).t
        let r = [t.ok, t.errorType, t.truncated, t.finishReason, t.tokens.reasoning, t.tokens.output, t.error.startsWith('INCOMPLETE_RESPONSE: finish_reason=length; no visible output')]
        assert.strict.deepEqual(r, [false, 'incomplete', true, 'length', 32000, 0, true])
    })

    it('A3: detectTruncation → length有部分文字回incomplete且保留部分文字; acceptTruncated放行並標truncated', async function() {
        let a = (await capOf('len-text', { detectTruncation: true })).t
        let b = (await capOf('len-text', { detectTruncation: true, acceptTruncated: true })).t
        let r = [[a.ok, a.errorType, a.stdout.trim()], [b.ok, b.truncated, b.stdout.trim()]]
        assert.strict.deepEqual(r, [[false, 'incomplete', 'partial {"a":'], [true, true, 'partial {"a":']])
    })

    it('A4: 未截斷時detectTruncation之stdout與預設路徑逐位元相同、結果欄位集合相同', async function() {
        let off = (await capOf('ok-384k')).t
        let on = (await capOf('ok-384k', { detectTruncation: true })).t
        let keys = (x) => Object.keys(x).sort()
        assert.strict.deepEqual([on.stdout, on.ok, on.code, keys(on)], [off.stdout, off.ok, off.code, keys(off)])
        assert.strict.deepEqual(on.stdout.trim(), 'OK')
    })

})
