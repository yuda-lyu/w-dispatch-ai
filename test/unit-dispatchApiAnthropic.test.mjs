import assert from 'assert'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'


// unit-dispatchApiAnthropic.test.mjs — dispatchApiAnthropic(kind: api-anthropic)之規格測試
//
// 規格來源: README「dispatchApiAnthropic」、帳本R-ANTHROPIC-2(sgud/rule/rulebook.md)、
//   官方Messages API(platform.claude.com/docs/en/api/errors、claude-api技能, 2026-10-24查證):
//   POST /v1/messages; 標頭x-api-key與anthropic-version(2023-06-01); system為頂層欄位; max_tokens必填;
//   thinking/effort: Opus 5.5/Sonnet 5.5/Haiku 5.5省略thinking即自適應思考, effort以output_config.effort表示, 無temperature/top_p/top_k;
//   stop_reason: end_turn/stop_sequence/max_tokens/tool_use/pause_turn/refusal; 錯誤碼400/401/402/403/404/413/429/500/529。
// 全部打本機假伺服器(test/tools/fakeServerForAnthropicTest.mjs), 不發出任何Anthropic請求。


let KEY = 'sk-ant-api03-TESTKEY-AAAA1111BBBB2222cccc3333'
let MASK = '[REDACTED]'


describe('dispatchApiAnthropic', function() {

    let srv = null

    before(async function() {
        srv = await fakeServerForAnthropicTest()
    })

    after(async function() {
        if (srv) {
            await srv.close()
        }
    })

    let call = (model, opt = {}, prompt = 'abc') => dispatchApiAnthropic(prompt, { baseURL: srv.url, key: KEY, model, ...opt })
    let last = () => srv.requests[srv.requests.length - 1]

    it('prompt非有效字串時回傳錯誤結果物件且不reject', async function() {
        let r = []
        for (let prompt of [null, undefined, '', 123, {}, []]) {
            let t = await dispatchApiAnthropic(prompt, { key: KEY, model: 'ok' })
            r.push([t.ok, t.error, t.errorType, t.attempts])
        }
        let rr = [1, 2, 3, 4, 5, 6].map(() => [false, 'prompt must be a non-empty string', 'params', 0])
        assert.strict.deepEqual(r, rr)
    })

    it('model必填(Messages API無預設模型), 缺則以params回報', async function() {
        let r = []
        for (let model of [undefined, null, '', 123, {}]) {
            let t = await dispatchApiAnthropic('abc', { baseURL: srv.url, key: KEY, model })
            r.push([t.ok, t.error, t.errorType, t.attempts])
        }
        let rr = [1, 2, 3, 4, 5].map(() => [false, 'model must be a non-empty string', 'params', 0])
        assert.strict.deepEqual(r, rr)
    })

    it('請求形狀: POST /v1/messages, 標頭x-api-key與anthropic-version(2023-06-01)、不帶Authorization, 本體含model、max_tokens(預設16000)、messages', async function() {
        //規格: 官方Messages API必要標頭x-api-key與anthropic-version; 缺anthropic-version時真伺服器回400(假伺服器同), 故此測試與全部成功路徑測試皆守住它
        srv.requests.length = 0
        let t = await call('ok')
        let q = last()
        let o = [
            t.ok,
            srv.requests.length,
            q.headers['x-api-key'],
            q.headers['anthropic-version'],
            q.headers['content-type'],
            q.headers['accept-encoding'],
            q.headers['authorization'],
            q.body,
        ]
        let oo = [
            true,
            1,
            KEY,
            '2023-06-01',
            'application/json',
            'identity',
            undefined,
            { model: 'ok', max_tokens: 16000, messages: [{ role: 'user', content: 'abc' }] },
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('本體預設不含temperature、top_p、top_k、thinking、stream、tools、output_config(5.5系列移除取樣參數, thinking省略即自適應)', async function() {
        await call('ok')
        let b = last().body
        let o = ['temperature', 'top_p', 'top_k', 'thinking', 'stream', 'tools', 'output_config', 'system', 'tool_choice'].map((k) => k in b)
        let oo = [false, false, false, false, false, false, false, false, false]
        assert.strict.deepEqual(o, oo)
    })

    it('system為頂層欄位(非messages內之system角色); 非字串或空字串不帶', async function() {
        await call('ok', { system: '你是助理' })
        let a = last().body
        let r = []
        for (let system of ['', null, 123, {}]) {
            await call('ok', { system })
            r.push('system' in last().body)
        }
        let o = [a.system, a.messages, r]
        let oo = ['你是助理', [{ role: 'user', content: 'abc' }], [false, false, false, false]]
        assert.strict.deepEqual(o, oo)
    })

    it('effort為low/medium/high/xhigh/max時以output_config.effort送出; 其他值視為未給(不送)', async function() {
        let r = []
        for (let effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
            await call('ok', { effort })
            r.push(last().body.output_config)
        }
        for (let effort of ['ultra', '', null, undefined, 5, {}]) {
            await call('ok', { effort })
            r.push(last().body.output_config)
        }
        let rr = [
            { effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' },
            undefined, undefined, undefined, undefined, undefined, undefined,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('body併入請求本體且同名鍵以body為準(max_tokens、thinking、output_config、fallbacks皆可覆寫或加入)', async function() {
        await call('ok', {
            effort: 'high',
            body: { max_tokens: 4096, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'low' } },
        })
        let b = last().body
        let o = [b.max_tokens, b.thinking, b.output_config]
        let oo = [4096, { type: 'adaptive', display: 'summarized' }, { effort: 'low' }]
        assert.strict.deepEqual(o, oo)
    })

    it('headers同名鍵(不分大小寫)覆寫預設標頭而不重複送出(重複標頭會被合併成逗號串)', async function() {
        await call('ok', { headers: { 'Anthropic-Version': '2024-01-01', 'anthropic-beta': 'x-beta-1', 'X-API-KEY': 'sk-ant-api03-OVERRIDE-0000' } })
        let h = last().headers
        let o = [h['anthropic-version'], h['anthropic-beta'], h['x-api-key']]
        let oo = ['2024-01-01', 'x-beta-1', 'sk-ant-api03-OVERRIDE-0000']
        assert.strict.deepEqual(o, oo)
    })

    it('未給key時不帶x-api-key標頭(與全套件REST慣例一致), 由伺服器回401', async function() {
        let t = await dispatchApiAnthropic('abc', { baseURL: srv.url, model: 'ok' })
        let o = ['x-api-key' in last().headers, t.ok, t.code, t.errorType, t.apiErrorType]
        let oo = [false, false, 401, 'http', 'authentication_error']
        assert.strict.deepEqual(o, oo)
    })

    it('成功: stdout為text區塊文字(thinking區塊略過)、code 200、usage原樣透傳、finishReason為end_turn、truncated為false、attempts為1', async function() {
        let t = await call('ok')
        let o = [t.ok, t.stdout, t.stderr, t.code, t.error, t.finishReason, t.truncated, t.attempts, t.usage, 'errorType' in t]
        let oo = [
            true, 'hello', '', 200, '', 'end_turn', false, 1,
            { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            false,
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('多個text區塊依序串接(中間之thinking區塊略過)', async function() {
        let t = await call('multi-text')
        assert.strict.deepEqual([t.ok, t.stdout], [true, 'AABB'])
    })

    it('單一空字串text區塊為成功之空輸出(交validate裁決); stop_sequence與未知stop_reason皆視為正常結束(不可誤殺)', async function() {
        let a = await call('empty-text')
        let b = await call('empty-text', { validate: 'nonempty' })
        let c = await call('stop-sequence')
        let d = await call('unknown-stop')
        let o = [[a.ok, a.stdout], [b.ok, b.errorType], [c.ok, c.stdout, c.finishReason], [d.ok, d.stdout, d.finishReason]]
        let oo = [[true, ''], [false, 'validation'], [true, 'done', 'stop_sequence'], [true, 'done', 'future_reason']]
        assert.strict.deepEqual(o, oo)
    })

    it('end_turn但content無任何text區塊(僅thinking)為結構不合規: invalid-response', async function() {
        let t = await call('thinking-only')
        let o = [t.ok, t.errorType, t.error.indexOf('INVALID_RESPONSE: ') === 0, t.code, t.finishReason]
        let oo = [false, 'invalid-response', true, 200, 'end_turn']
        assert.strict.deepEqual(o, oo)
    })

    it('stop_reason為max_tokens: 預設失敗(INCOMPLETE_RESPONSE、errorType incomplete、truncated為true), 截斷具決定性故不重試', async function() {
        //規格: 同REST文字轉接器之截斷規則(checkTruncation.mjs); Anthropic之思考token計入max_tokens, 耗盡時常無可見輸出
        let t = await call('max-tokens', { maxRetries: 2, retryDelayMs: 10 })
        let o = [t.ok, t.errorType, t.error, t.truncated, t.finishReason, t.stdout, t.attempts, t.code]
        let oo = [false, 'incomplete', 'INCOMPLETE_RESPONSE: stop_reason=max_tokens', true, 'max_tokens', '[{"a":1},{"b":', 1, 200]
        assert.strict.deepEqual(o, oo)
    })

    it('max_tokens: acceptTruncated:true放行(交validate裁決, 結果仍標truncated:true); 可見輸出為空(思考耗盡)者一律失敗並註明', async function() {
        let a = await call('max-tokens', { acceptTruncated: true })
        let b = await call('max-tokens', { acceptTruncated: true, validate: () => false })
        let c = await call('max-tokens-empty', { acceptTruncated: true })
        let o = [
            [a.ok, a.stdout, a.truncated],
            [b.ok, b.errorType, b.error],
            [c.ok, c.errorType, c.error.includes('no visible output')],
        ]
        let oo = [
            [true, '[{"a":1},{"b":', true],
            [false, 'incomplete', 'INCOMPLETE_RESPONSE: stop_reason=max_tokens; rejected by validate'],
            [false, 'incomplete', true],
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('stop_reason為refusal(HTTP 200): 失敗, errorType為refusal, error含類別, stderr帶stop_details, 不重試', async function() {
        //規格: claude-api技能「refusal stop reason」——HTTP 200、stop_reason 'refusal'、stop_details含category; 處置: 視為失敗(不假裝成功)、同請求重試必然再被拒故不重試
        let t = await call('refusal', { maxRetries: 2, retryDelayMs: 10 })
        let sd = JSON.parse(t.stderr)
        let o = [t.ok, t.errorType, t.error, t.code, t.finishReason, t.truncated, t.attempts, t.stdout, sd.category]
        let oo = [false, 'refusal', 'REFUSED: stop_reason=refusal (category=cyber)', 200, 'refusal', false, 1, '', 'cyber']
        assert.strict.deepEqual(o, oo)
    })

    it('refusal已輸出部分文字者, 部分文字置stdout(失敗結果, 供診斷)而不當成功', async function() {
        let t = await call('refusal-partial')
        let o = [t.ok, t.errorType, t.error, t.stdout]
        let oo = [false, 'refusal', 'REFUSED: stop_reason=refusal (category=bio)', 'I can start with']
        assert.strict.deepEqual(o, oo)
    })

    it('stop_reason為tool_use: TOOL_CALLS_UNSUPPORTED(errorType tool-unsupported); pause_turn: INCOMPLETE_RESPONSE(errorType incomplete、非截斷)', async function() {
        let a = await call('tool-use')
        let b = await call('pause-turn')
        let o = [
            [a.ok, a.errorType, a.error.indexOf('TOOL_CALLS_UNSUPPORTED') === 0],
            [b.ok, b.errorType, b.error, b.truncated],
        ]
        let oo = [
            [false, 'tool-unsupported', true],
            [false, 'incomplete', 'INCOMPLETE_RESPONSE: stop_reason=pause_turn', false],
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('HTTP非2xx: errorType為http、code為狀態碼、error為HTTP <碼>、apiErrorType取自error.type; 4xx(429除外)不重試, 429與5xx(含529)依maxRetries重試', async function() {
        //規格: 官方錯誤碼表; 重試語意對齊execCli與其他REST轉接器(4xx客戶端錯誤不可重試, 429/5xx可重試)
        let table = [
            ['err-400', 400, 'invalid_request_error', 1],
            ['err-402', 402, 'billing_error', 1],
            ['err-403', 403, 'permission_error', 1],
            ['err-404', 404, 'not_found_error', 1],
            ['err-413', 413, 'request_too_large', 1],
            ['err-429', 429, 'rate_limit_error', 3],
            ['err-500', 500, 'api_error', 3],
            ['err-529', 529, 'overloaded_error', 3],
        ]
        let r = []
        for (let [model] of table) {
            let t = await call(model, { maxRetries: 2, retryDelayMs: 10 })
            r.push([model, t.ok, t.code, t.error, t.errorType, t.apiErrorType, t.stderr.includes('"type":"error"'), t.attempts])
        }
        let rr = table.map(([model, code, apiErrorType, attempts]) => [model, false, code, `HTTP ${code}`, 'http', apiErrorType, true, attempts])
        assert.strict.deepEqual(r, rr)
    })

    it('金鑰無效(401 authentication_error): errorType http、code 401、不重試', async function() {
        let t = await call('ok', { key: 'sk-bad-key-000000', maxRetries: 2, retryDelayMs: 10 })
        let o = [t.ok, t.code, t.errorType, t.apiErrorType, t.attempts]
        let oo = [false, 401, 'http', 'authentication_error', 1]
        assert.strict.deepEqual(o, oo)
    })

    it('429與529於重試後成功(同一金鑰首次失敗)', async function() {
        let a = await call('flaky-429', { maxRetries: 1, retryDelayMs: 10 })
        let b = await call('flaky-529', { maxRetries: 1, retryDelayMs: 10 })
        let o = [[a.ok, a.stdout, a.attempts], [b.ok, b.stdout, b.attempts]]
        let oo = [[true, 'attempt 2', 2], [true, 'attempt 2', 2]]
        assert.strict.deepEqual(o, oo)
    })

    it('逾時: TIMEOUT開頭、errorType為timeout', async function() {
        let t = await call('slow', { timeoutMs: 300 })
        let o = [t.ok, t.error.indexOf('TIMEOUT') === 0, t.errorType, t.code]
        let oo = [false, true, 'timeout', null]
        assert.strict.deepEqual(o, oo)
    })

    it('網路層錯誤(連線拒絕): FETCH_ERROR、errorType為fetch、code為null', async function() {
        let t = await dispatchApiAnthropic('abc', { baseURL: 'http://127.0.0.1:1', key: KEY, model: 'ok' })
        let o = [t.ok, t.error.indexOf('FETCH_ERROR: ') === 0, t.errorType, t.code, JSON.stringify(t).includes(KEY)]
        let oo = [false, true, 'fetch', null, false]
        assert.strict.deepEqual(o, oo)
    })

    it('HTTP 200但本體非JSON或缺content陣列: invalid-response(前者error為INVALID_RESPONSE: body is not JSON開頭, 遞補層據此整組跳過)', async function() {
        let a = await call('not-json')
        let b = await call('garbage-200')
        let c = await call('no-content')
        let o = [
            [a.ok, a.errorType, a.error.indexOf('INVALID_RESPONSE: body is not JSON') === 0],
            [b.ok, b.errorType, b.error.indexOf('INVALID_RESPONSE: body is not JSON') === 0],
            [c.ok, c.errorType, c.error],
        ]
        let oo = [
            [false, 'invalid-response', true],
            [false, 'invalid-response', true],
            [false, 'invalid-response', 'INVALID_RESPONSE: missing content array'],
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('預設帶Accept-Encoding: identity, 伺服器壓縮卻漏標Content-Encoding時仍可解析(同其他REST轉接器)', async function() {
        let t = await call('br-noheader')
        assert.strict.deepEqual([t.ok, t.stdout], [true, '完成'])
    })

    it('金鑰不外洩: 伺服器錯誤本體回顯x-api-key時stderr已遮蔽, 回傳物件整體不含金鑰', async function() {
        let t = await call('echo-key-error')
        let o = [t.ok, t.code, t.stderr.includes(MASK), JSON.stringify(t).includes(KEY)]
        let oo = [false, 400, true, false]
        assert.strict.deepEqual(o, oo)
    })

    it('金鑰不外洩: 金鑰含換行等非法標頭字元(送出前fetch即拋錯)時, 錯誤訊息遮蔽金鑰', async function() {
        let bad = 'sk-ant-api03-LINE1\nLINE2-0000'
        let t = await call('ok', { key: bad })
        let o = [t.ok, t.errorType, JSON.stringify(t).includes('LINE1'), JSON.stringify(t).includes('LINE2')]
        let oo = [false, 'fetch', false, false]
        assert.strict.deepEqual(o, oo)
    })

    it('金鑰不外洩: 失敗結果之stderr(HTTP錯誤本體、refusal細節)中的任何sk-ant-形式字樣皆遮蔽(含非本次使用之金鑰)', async function() {
        //echo-key-error回顯的是本次key; 此處改以caller headers使x-api-key為另一值, 驗證「本次redact集合」涵蓋全部機密標頭
        let t = await call('echo-key-error', { key: undefined, headers: { 'x-api-key': 'sk-ant-api03-HEADERKEY-1111' } })
        let o = [t.ok, JSON.stringify(t).includes('HEADERKEY'), t.stderr.includes(MASK)]
        let oo = [false, false, true]
        assert.strict.deepEqual(o, oo)
    })

    it('自訂validate: 通過成功、不過為OUTPUT_VALIDATION_FAILED(validation)、拋錯註記validate threw; validate只收text', async function() {
        let seen = []
        let a = await call('ok', {
            validate: (s) => {
                seen.push(s)
                return s === 'hello'
            },
        })
        let b = await call('ok', { validate: () => false })
        let c = await call('ok', {
            validate: () => {
                throw new Error('boom')
            },
        })
        let o = [seen, a.ok, [b.ok, b.error, b.errorType], [c.ok, c.errorType, c.stderr.indexOf('validate threw: boom') === 0]]
        let oo = [['hello'], true, [false, 'OUTPUT_VALIDATION_FAILED', 'validation'], [false, 'validation', true]]
        assert.strict.deepEqual(o, oo)
    })

    it('body或headers不可讀(getter拋錯)、body不可序列化時以params回報且不reject', async function() {
        let bodyBad = {
            get x() {
                throw new Error('body getter boom')
            },
        }
        let headersBad = {
            get x() {
                throw new Error('headers getter boom')
            },
        }
        let a = await call('ok', { body: bodyBad })
        let b = await call('ok', { headers: headersBad })
        let c = await call('ok', { body: { n: 10n } })
        let o = [a, b, c].map((t) => [t.ok, t.errorType, t.attempts])
        let oo = [[false, 'params', 0], [false, 'params', 0], [false, 'params', 0]]
        assert.strict.deepEqual(o, oo)
    })

    //── 2026-10-25 外審回饋補強: 金鑰所有出口(成功路徑、validate註記、啟動前params、非JSON診斷、集合外金鑰)與其餘邊界格 ──

    it('金鑰不外洩: 成功回覆文字夾帶本次key(含max_tokens經acceptTruncated放行者)時, stdout已精確遮蔽, 經dispatchAiFallback後頂層與tried亦不含key', async function() {
        let a = await call('echo-text')
        let b = await call('echo-text-max', { acceptTruncated: true })
        let f = await dispatchAiFallback('abc', { providers: [{ id: 'anthropic:echo', kind: 'api-anthropic', baseURL: srv.url, model: 'echo-text', keys: [KEY] }] })
        let o = [
            [a.ok, a.stdout],
            [b.ok, b.stdout, b.truncated],
            [f.ok, f.stdout, JSON.stringify(f).includes(KEY)],
        ]
        let oo = [
            [true, `echo ${MASK}`],
            [true, `echo ${MASK}`, true],
            [true, `echo ${MASK}`, false],
        ]
        assert.strict.deepEqual(o, oo)
    })

    it('金鑰不外洩: 成功stdout只精確遮蔽, 不套sk-ant-樣式(模型輸出可含合法範例字樣); validate仍收到原文', async function() {
        let seen = []
        let t = await call('text-with-example-key', {
            validate: (s) => {
                seen.push(s)
                return true
            },
        })
        let want = 'set ANTHROPIC_KEYS=sk-ant-api03-DOC-EXAMPLE-0000 in your .env'
        assert.strict.deepEqual([t.ok, t.stdout, seen], [true, want, [want]])
    })

    it('金鑰不外洩: 呼叫端validate之例外訊息(同步throw、Promise.reject、max_tokens放行後之validate)夾帶key時, stderr、tried、事件皆已遮蔽', async function() {
        let a = await call('ok', {
            validate: () => {
                throw new Error(`validator saw ${KEY}`)
            },
        })
        let b = await call('ok', { validate: () => Promise.reject(new Error(`rejected ${KEY}`)) })
        let c = await call('max-tokens', {
            acceptTruncated: true,
            validate: () => {
                throw new Error(`truncated path ${KEY}`)
            },
        })
        let events = []
        let f = await dispatchAiFallback('abc', {
            providers: [{
                id: 'anthropic:v',
                kind: 'api-anthropic',
                baseURL: srv.url,
                model: 'ok',
                keys: [KEY],
                validate: () => {
                    throw new Error(`in chain ${KEY}`)
                },
            }],
            onEvent: (ev) => events.push(ev),
        })
        let o = [a, b, c].map((t) => [t.ok, t.errorType, t.stderr.includes(MASK), JSON.stringify(t).includes(KEY)])
        o.push([f.ok, JSON.stringify({ f, events }).includes(KEY)])
        let oo = [[false, 'validation', true, false], [false, 'validation', true, false], [false, 'incomplete', true, false], [false, false]]
        assert.strict.deepEqual(o, oo)
    })

    it('金鑰不外洩: 啟動前params錯誤(body／headers之getter、toJSON、標頭值toString拋出夾帶key之例外)之訊息已遮蔽, 且零次請求', async function() {
        srv.requests.length = 0
        let throwing = () => {
            throw new Error(`leaky ${KEY}`)
        }
        let cases = [
            { body: Object.defineProperty({}, 'x', { get: throwing, enumerable: true }) },
            { headers: Object.defineProperty({}, 'x', { get: throwing, enumerable: true }) },
            { body: { toJSON: throwing } },
            { headers: { 'x-extra': { toString: throwing } } },
        ]
        let r = []
        for (let c of cases) {
            let t = await call('ok', c)
            r.push([t.ok, t.errorType, t.attempts, JSON.stringify(t).includes(KEY), t.error.includes(MASK)])
        }
        let rr = cases.map(() => [false, 'params', 0, false, true])
        assert.strict.deepEqual([r, srv.requests.length], [rr, 0])
    })

    it('金鑰不外洩: HTTP 200非JSON時, 診斷訊息中的回應標頭值(Content-Type參數夾帶key)已遮蔽, 前綴不變', async function() {
        let t = await call('nonjson-ct-key')
        let o = [t.ok, t.errorType, t.error.indexOf('INVALID_RESPONSE: body is not JSON') === 0, JSON.stringify(t).includes(KEY), t.error.includes(MASK)]
        assert.strict.deepEqual(o, [false, 'invalid-response', true, false, true])
    })

    it('金鑰不外洩: 錯誤本體與refusal細節夾帶「不在本次請求標頭中」之他把金鑰時, 靠sk-ant-樣式遮蔽(只留精確遮蔽即抓得到之測試)', async function() {
        let a = await call('err-foreign-key')
        let b = await call('refusal-foreign')
        let o = [a, b].map((t) => [t.ok, JSON.stringify(t).includes('FOREIGN'), JSON.stringify(t).includes(MASK)])
        assert.strict.deepEqual(o, [[false, false, true], [false, false, true]])
    })

    it('HTTP 504 timeout_error: http分類且依maxRetries重試; 401回HTML(非JSON)仍為http分類、apiErrorType為空字串、不重試', async function() {
        let a = await call('err-504', { maxRetries: 2, retryDelayMs: 10 })
        let b = await call('err-html-401', { maxRetries: 2, retryDelayMs: 10 })
        let o = [[a.code, a.errorType, a.apiErrorType, a.attempts], [b.code, b.errorType, b.apiErrorType, b.attempts, b.stderr.includes('unauthorized')]]
        assert.strict.deepEqual(o, [[504, 'http', 'timeout_error', 3], [401, 'http', '', 1, true]])
    })

    it('end_turn但content含tool_use區塊: tool-unsupported(不把前面的text當成功)', async function() {
        let t = await call('text-and-tool-use')
        assert.strict.deepEqual([t.ok, t.errorType], [false, 'tool-unsupported'])
    })

    it('baseURL尾端多個斜線與/v1(如/v1///)正規化為單一/v1/messages; 連線拒絕(已關閉之真實埠)為FETCH_ERROR: ECONNREFUSED', async function() {
        srv.requests.length = 0
        let a = await dispatchApiAnthropic('abc', { baseURL: `${srv.url}/v1///`, key: KEY, model: 'ok' })
        let s2 = await fakeServerForAnthropicTest()
        let closedUrl = s2.url
        await s2.close()
        let b = await dispatchApiAnthropic('abc', { baseURL: closedUrl, key: KEY, model: 'ok' })
        assert.strict.deepEqual([a.ok, srv.requests.length, b.errorType, b.error], [true, 1, 'fetch', 'FETCH_ERROR: ECONNREFUSED'])
    })

    it('validate永不落定: 與該次嘗試共用timeoutMs(剩餘時間), 逾時以validation失敗落定且註記validate timed out', async function() {
        let t0 = Date.now()
        let t = await call('ok', { timeoutMs: 400, validate: () => new Promise(() => {}) })
        let ms = Date.now() - t0
        assert.strict.deepEqual([t.ok, t.errorType, t.stderr.indexOf('validate timed out') === 0, ms < 3000], [false, 'validation', true, true])
    })

    it('經dispatchAiFallback啟用冷卻: 429之條目於下一次呼叫被降至鏈尾(請求順序可觀察), 另一條目照常成功', async function() {
        let store = null
        let opt = {
            providers: [
                { id: 'anthropic:cool-a', kind: 'api-anthropic', baseURL: srv.url, model: 'err-429', keys: [KEY] },
                { id: 'anthropic:cool-b', kind: 'api-anthropic', baseURL: srv.url, model: 'ok', keys: [KEY] },
            ],
            cooldownMs: 600000,
            store: {
                get: () => store,
                set: (s) => {
                    store = s
                },
            },
        }
        srv.requests.length = 0
        let r1 = await dispatchAiFallback('abc', opt)
        let first = srv.requests.map((q) => q.body.model)
        srv.requests.length = 0
        let r2 = await dispatchAiFallback('abc', opt)
        let second = srv.requests.map((q) => q.body.model)
        assert.strict.deepEqual([r1.ok, first, r2.ok, second], [true, ['err-429', 'ok'], true, ['ok']])
    })

    it('dispatchAi(kind: api-anthropic)分派到本轉接器', async function() {
        let t = await dispatchAi('api-anthropic', 'abc', { baseURL: srv.url, key: KEY, model: 'ok' })
        assert.strict.deepEqual([t.ok, t.stdout], [true, 'hello'])
    })

    describe('經dispatchAiFallback(輪替、冷卻、整組跳過)', function() {

        it('第1把金鑰無效(401)換第2把成功; 回傳、tried與事件皆不含任何金鑰', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [{ id: 'anthropic:t1', kind: 'api-anthropic', baseURL: srv.url, model: 'ok', keys: ['sk-bad-key-111111', KEY] }],
                onEvent: (ev) => events.push(ev),
            })
            let all = JSON.stringify({ r, events })
            let o = [r.ok, r.keyIndex, r.tried.map((t) => [t.outcome, t.errorType]), all.includes(KEY), all.includes('sk-bad-key-111111')]
            let oo = [true, 1, [['next-key', 'http'], ['ok', undefined]], false, false]
            assert.strict.deepEqual(o, oo)
        })

        it('429(rate_limit_error)逐把換鑰, 且cooldownMs>0時內建冷卻觸發(cooled事件)——API類可靠偵測429', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [{ id: 'anthropic:t2', kind: 'api-anthropic', baseURL: srv.url, model: 'err-429', keys: [KEY, 'sk-ant-api03-SECOND-2222'] }],
                cooldownMs: 60000,
                onEvent: (ev) => events.push(ev),
            })
            let o = [r.ok, r.code, r.errorType, r.tried.map((t) => t.outcome), events.filter((e) => e.type === 'cooled').length]
            let oo = [false, 429, 'http', ['next-key', 'next-key'], 2]
            assert.strict.deepEqual(o, oo)
        })

        it('billing_error(402)與額度類4xx亦換下一把(金鑰相依, 不整組跳過)', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [{ id: 'anthropic:t3', kind: 'api-anthropic', baseURL: srv.url, model: 'err-402', keys: [KEY, 'sk-ant-api03-SECOND-3333'] }],
            })
            let o = [r.ok, r.code, r.tried.map((t) => [t.outcome, t.errorType])]
            let oo = [false, 402, [['next-key', 'http'], ['next-key', 'http']]]
            assert.strict.deepEqual(o, oo)
        })

        it('refusal屬模型/請求性質, 與金鑰無關: 整組跳過(skip-group)而不逐把重打, 並遞補下一個條目', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [
                    { id: 'anthropic:refuse', kind: 'api-anthropic', baseURL: srv.url, model: 'refusal', keys: [KEY, 'sk-ant-api03-SECOND-4444'] },
                    { id: 'anthropic:ok', kind: 'api-anthropic', baseURL: srv.url, model: 'ok', keys: [KEY] },
                ],
                onEvent: (ev) => events.push(ev),
            })
            let o = [r.ok, r.providerId, r.tried.map((t) => [t.providerId, t.outcome, t.errorType])]
            let oo = [true, 'anthropic:ok', [['anthropic:refuse', 'skip-group', 'refusal'], ['anthropic:ok', 'ok', undefined]]]
            assert.strict.deepEqual(o, oo)
        })

    })

})
