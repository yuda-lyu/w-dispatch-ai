import assert from 'assert'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import extractJsonLoose from '../src/wkf/extractJsonLoose.mjs'
import salvageTruncatedArray from '../src/wkf/salvageTruncatedArray.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'


describe('dispatchApiOpenaiCompat', function() {

    let svr = null

    before(async function() {
        svr = await fakeServerForApiTest()
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
    })

    it('prompt非有效字串時回傳錯誤結果物件且不reject', async function() {
        let r = []
        for (let prompt of [null, undefined, '', 123, {}, []]) {
            let t = await dispatchApiOpenaiCompat(prompt)
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

    it('baseURL與model必填, 缺一即回傳錯誤結果物件', async function() {
        let t1 = await dispatchApiOpenaiCompat('abc', { model: 'echo' })
        let t2 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url })
        let r = [[t1.ok, t1.error], [t2.ok, t2.error]]
        let rr = [
            [false, 'baseURL must be a non-empty string'],
            [false, 'model must be a non-empty string'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('成功時stdout為回覆內容, 請求含Bearer金鑰與model與user訊息', async function() {
        let t = await dispatchApiOpenaiCompat('中文prompt\n第二行', { baseURL: svr.url, key: 'sk-good-1', model: 'echo' })
        let o = JSON.parse(t.stdout)
        let r = [
            t.ok,
            t.code,
            t.error,
            t.attempts,
            o.auth,
            o.body.model,
            o.body.messages,
        ]
        let rr = [
            true,
            200,
            '',
            1,
            'Bearer sk-good-1',
            'echo',
            [{ role: 'user', content: '中文prompt\n第二行' }],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('未給key時不帶Authorization標頭', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, model: 'echo' })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.auth]
        let rr = [true, '']
        assert.strict.deepEqual(r, rr)
    })

    it('baseURL尾端斜線自動正規化', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url + '///', key: 'sk-good-1', model: 'echo' })
        let r = [t.ok, t.code]
        let rr = [true, 200]
        assert.strict.deepEqual(r, rr)
    })

    it('system置於messages首位, body額外鍵可併入', async function() {
        let t = await dispatchApiOpenaiCompat('abc', {
            baseURL: svr.url,
            key: 'sk-good-1',
            model: 'echo',
            system: '你是審計者',
            body: { temperature: 0.2, max_tokens: 100 },
        })
        let o = JSON.parse(t.stdout)
        let r = [
            o.body.messages,
            o.body.temperature,
            o.body.max_tokens,
        ]
        let rr = [
            [{ role: 'system', content: '你是審計者' }, { role: 'user', content: 'abc' }],
            0.2,
            100,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('無效金鑰回401且不重試(4xx為客戶端錯誤)', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-bad-x', model: 'echo', maxRetries: 3, retryDelayMs: 100 })
        let r = [t.ok, t.code, t.error, t.attempts, t.stderr.includes('Invalid API key')]
        let rr = [false, 401, 'HTTP 401', 1, true]
        assert.strict.deepEqual(r, rr)
    })

    it('429依maxRetries重試後成功', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-flaky1', model: 'flaky-429', maxRetries: 1, retryDelayMs: 100 })
        let r = [t.ok, t.code, t.attempts, JSON.parse(t.stdout).attempt]
        let rr = [true, 200, 2, 2]
        assert.strict.deepEqual(r, rr)
    })

    it('429且maxRetries為0時直接失敗', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-flaky2', model: 'flaky-429' })
        let r = [t.ok, t.code, t.error, t.attempts]
        let rr = [false, 429, 'HTTP 429', 1]
        assert.strict.deepEqual(r, rr)
    })

    it('HTTP 500回傳失敗且stderr含回應本體', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'err-500' })
        let r = [t.ok, t.code, t.error, t.stderr.includes('internal error')]
        let rr = [false, 500, 'HTTP 500', true]
        assert.strict.deepEqual(r, rr)
    })

    it('逾時時中止請求且error以TIMEOUT開頭', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'slow', timeoutMs: 1000 })
        let r = [t.ok, t.code, t.error, t.durationMs < 9000]
        let rr = [false, null, 'TIMEOUT after 1s', true]
        assert.strict.deepEqual(r, rr)
    })

    it('網路層錯誤回傳FETCH_ERROR', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: 'http://127.0.0.1:1/v1', key: 'sk-good-1', model: 'echo', timeoutMs: 3000 })
        let r = [t.ok, t.code, t.error.indexOf('FETCH_ERROR') === 0]
        let rr = [false, null, true]
        assert.strict.deepEqual(r, rr)
    })

    it('回應缺choices時回傳INVALID_RESPONSE', async function() {
        let r = []
        for (let model of ['no-choices', 'not-json']) {
            let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model })
            r.push([t.ok, t.code, t.error.indexOf('INVALID_RESPONSE') === 0])
        }
        let rr = [[false, 200, true], [false, 200, true]]
        assert.strict.deepEqual(r, rr)
    })

    it('預設帶Accept-Encoding: identity——伺服器壓縮卻漏標Content-Encoding時仍可正確解析(2026-09-24使用端回報)', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'br-noheader' })
        let r = [t.ok, t.code, t.stdout, t.error]
        let rr = [true, 200, '完成', '']
        assert.strict.deepEqual(r, rr)
    })

    it('呼叫端headers可覆寫Accept-Encoding: 改回允許壓縮時, 遇漏標之壓縮本體即解析失敗(invalid-response)', async function() {
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'br-noheader', headers: { 'Accept-Encoding': 'gzip, deflate' } })
        let r = [t.ok, t.code, t.errorType, t.error]
        let rr = [false, 200, 'invalid-response', 'INVALID_RESPONSE: missing choices[0].message.content']
        assert.strict.deepEqual(r, rr)
    })

    it('validate字串規則與自訂函數皆可用, 失敗回傳OUTPUT_VALIDATION_FAILED', async function() {
        let t1 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'empty-content', validate: 'nonempty' })
        let t2 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', validate: 'nonempty,json' })
        let t3 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', validate: (s) => s.includes('絕不存在的字串') })
        let r = [
            [t1.ok, t1.code, t1.error],
            [t2.ok, t2.error],
            [t3.ok, t3.error],
        ]
        let rr = [
            [false, 200, 'OUTPUT_VALIDATION_FAILED'],
            [true, ''],
            [false, 'OUTPUT_VALIDATION_FAILED'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('模型回tool_calls時明確回報不支援而非靜默成功', async function() {
        let t = await dispatchApiOpenaiCompat('台北天氣如何', {
            baseURL: svr.url,
            key: 'sk-good-1',
            model: 'tool-calls',
            body: { tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }] },
        })
        let r = [
            t.ok,
            t.code,
            t.stdout,
            t.error.indexOf('TOOL_CALLS_UNSUPPORTED') === 0,
            t.error.includes('cli kind'),
            t.stderr.includes('get_weather'), //原始回應保留供除錯
        ]
        let rr = [false, 200, '', true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('tool_calls為與金鑰無關之失敗, 於fallback鏈中不逐把空耗而遞補下一組', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                { id: 'g-tool', kind: 'api-openai-compat', baseURL: svr.url, model: 'tool-calls', keys: ['sk-t0', 'sk-t1'] },
                { id: 'g-text', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-x0'] },
            ],
        })
        let r = [t.ok, t.providerId, t.tried.map((x) => [x.keyId, x.outcome])]
        let rr = [true, 'g-text', [['g-tool#0', 'skip-group'], ['g-text#0', 'ok']]]
        assert.strict.deepEqual(r, rr)
    })

    it('截斷預設失敗: finish_reason為length且可見輸出為空(空字串/null/純空白)一律incomplete, 訊息標明無可見輸出並附reasoning_tokens', async function() {
        let r = []
        for (let model of ['trunc-empty', 'trunc-null', 'trunc-space']) {
            let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model })
            r.push([t.ok, t.errorType, t.truncated, t.finishReason, t.error.indexOf('INCOMPLETE_RESPONSE: finish_reason=length') === 0, t.error.includes('no visible output')])
        }
        let t0 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-empty' })
        r.push(t0.error.includes('reasoning_tokens=600'))
        let rr = [
            [false, 'incomplete', true, 'length', true, true],
            [false, 'incomplete', true, 'length', true, true],
            [false, 'incomplete', true, 'length', true, true],
            true,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('截斷預設失敗且與validate無關: 截斷陣列/截斷文字/完整載荷加截尾 × {無, nonempty, json, 搶救函數}皆incomplete', async function() {
        let salvage = (s) => salvageTruncatedArray(s) !== null
        let r = []
        for (let model of ['trunc-array', 'trunc-text', 'trunc-tail']) {
            for (let validate of [undefined, 'nonempty', 'json', salvage]) {
                let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model, validate })
                r.push([model, t.ok, t.errorType, t.truncated])
            }
        }
        let rr = []
        for (let model of ['trunc-array', 'trunc-text', 'trunc-tail']) {
            for (let i = 0; i < 4; i++) {
                rr.push([model, false, 'incomplete', true])
            }
        }
        assert.strict.deepEqual(r, rr)
    })

    it('acceptTruncated:true才放行: length且內容非空交validate(通過ok帶truncated、不過incomplete、無validate亦ok); 空內容與content_filter仍失敗', async function() {
        let salvage = (s) => salvageTruncatedArray(s) !== null
        let a1 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-array', acceptTruncated: true, validate: salvage })
        let a2 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-text', acceptTruncated: true, validate: 'json' })
        let a3 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-text', acceptTruncated: true })
        let a4 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-empty', acceptTruncated: true })
        let a5 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'filtered', acceptTruncated: true })
        let r = [
            [a1.ok, a1.stdout, a1.truncated, a1.finishReason],
            [a2.ok, a2.errorType, a2.truncated, a2.error.includes('rejected by validate')],
            [a3.ok, a3.stdout, a3.truncated],
            [a4.ok, a4.errorType],
            [a5.ok, a5.errorType, a5.truncated, a5.finishReason],
        ]
        let rr = [
            [true, '[{"a":1},{"b":2},{"c":', true, 'length'],
            [false, 'incomplete', true, true],
            [true, '第一段說明，第二', true],
            [false, 'incomplete'],
            [false, 'incomplete', true, 'content_filter'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('防誤殺: finish_reason為stop、null、未知值時照常成功且truncated為false; 截斷判定不分大小寫', async function() {
        let r = []
        for (let model of ['finish-stop', 'finish-null', 'finish-other']) {
            let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model })
            r.push([model, t.ok, t.stdout, t.truncated, t.finishReason])
        }
        let tu = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-upper' })
        r.push(['trunc-upper', tu.ok, tu.errorType, tu.finishReason])
        let rr = [
            ['finish-stop', true, '完成', false, 'stop'],
            ['finish-null', true, '完成', false, ''],
            ['finish-other', true, '完成', false, 'eos'],
            ['trunc-upper', false, 'incomplete', 'length'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('截斷與金鑰無關: 遞補鏈只試一把即整組跳過且tried帶truncated; 轉接器重試遇截斷不重打', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                { id: 'g-trunc', kind: 'api-openai-compat', baseURL: svr.url, model: 'trunc-text', keys: ['sk-a0', 'sk-a1'] },
                { id: 'g-ok', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-b0'] },
            ],
        })
        let t2 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'trunc-text', maxRetries: 2, retryDelayMs: 10 })
        let r = [t.ok, t.providerId, t.tried.map((x) => [x.keyId, x.outcome, x.truncated === true]), t2.attempts]
        let rr = [true, 'g-ok', [['g-trunc#0', 'skip-group', true], ['g-ok#0', 'ok', false]], 1]
        assert.strict.deepEqual(r, rr)
    })

    it('validate拋錯視同驗證失敗, Promise照常resolve不reject', async function() {
        let boom = () => {
            throw new Error('boom-validate')
        }
        let t = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', validate: boom })
        let r = [t.ok, t.errorType, t.error, t.stderr.includes('boom-validate')]
        let rr = [false, 'validation', 'OUTPUT_VALIDATION_FAILED', true]
        assert.strict.deepEqual(r, rr)
    })

    it('工作流: 自訂搶救parse遇截斷即視為同意→ok且json為前段、truncated可見; 預設parse、rawText、明示acceptTruncated:false遇截斷→失敗', async function() {
        let wkf = dispatchAiWkf({
            providers: {
                'p-trunc': { kind: 'api-openai-compat', baseURL: svr.url, model: 'trunc-array', keys: ['sk-w1'] },
                'p-trunc-text': { kind: 'api-openai-compat', baseURL: svr.url, model: 'trunc-text', keys: ['sk-w2'] },
            },
            defaults: { promptPrefix: '' },
        })
        let parseSalvage = (s) => extractJsonLoose(s) || salvageTruncatedArray(s)
        let t1 = await wkf.callAi('abc', { spec: { use: 'p-trunc' }, parse: parseSalvage })
        let t2 = await wkf.callAi('abc', { spec: { use: 'p-trunc' } })
        let t3 = await wkf.callAi('abc', { spec: { use: 'p-trunc-text' }, rawText: true })
        let t4 = await wkf.callAi('abc', { spec: { use: 'p-trunc' }, parse: parseSalvage, acceptTruncated: false })
        let r = [
            [t1.ok, t1.json, t1.truncated, t1.finishReason],
            [t2.ok, t2.errorType, t2.truncated, t2.tried.map((x) => x.outcome)],
            [t3.ok, t3.errorType],
            [t4.ok, t4.errorType],
        ]
        let rr = [
            [true, [{ a: 1 }, { b: 2 }], true, 'length'],
            [false, 'incomplete', true, ['skip-group']],
            [false, 'incomplete'],
            [false, 'incomplete'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('工作流: 條目自帶validate不再繞過工作流驗證(兩者取交集), 不過即遞補下一家', async function() {
        let wkf = dispatchAiWkf({
            providers: {
                'p-plain': { kind: 'api-openai-compat', baseURL: svr.url, model: 'plain-content', keys: ['sk-v1'], validate: 'nonempty' },
                'p-echo': { kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-v2'] },
            },
            defaults: { promptPrefix: '' },
        })
        let t = await wkf.callAi('abc', { spec: { use: 'p-plain', fallback: ['p-echo'] } })
        let r = [t.ok, t.providerId, t.tried.map((x) => [x.providerId, x.outcome, x.error || null])]
        let rr = [true, 'p-echo', [['p-plain', 'skip-group', 'OUTPUT_VALIDATION_FAILED'], ['p-echo', 'ok', null]]]
        assert.strict.deepEqual(r, rr)
    })

    it('工作流: check拋錯視同驗證失敗, callAi照常resolve不reject', async function() {
        let wkf = dispatchAiWkf({
            providers: { 'p-e1': { kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-c1'] } },
            defaults: { promptPrefix: '' },
        })
        let t = await wkf.callAi('abc', { spec: { use: 'p-e1' }, check: (j) => j.nope.deep === 1 })
        let r = [t.ok, t.errorType, t.error]
        let rr = [false, 'validation', 'OUTPUT_VALIDATION_FAILED']
        assert.strict.deepEqual(r, rr)
    })

    it('可經dispatchAi以kind api-openai-compat分派', async function() {
        let t = await dispatchAi('api-openai-compat', 'abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo' })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.body.model]
        let rr = [true, 'echo']
        assert.strict.deepEqual(r, rr)
    })

    it('可作為dispatchAiFallback條目, 多金鑰輪替(401換下一把)', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [{
                id: 'g-api',
                kind: 'api-openai-compat',
                baseURL: svr.url,
                model: 'echo',
                keys: ['sk-bad-r0', 'sk-good-r1'],
            }],
        })
        let o = JSON.parse(t.stdout)
        let r = [
            t.ok,
            t.providerId,
            t.keyIndex,
            o.auth,
            t.tried.map((x) => [x.keyId, x.outcome, x.error || null]),
        ]
        let rr = [
            true,
            'g-api',
            1,
            'Bearer sk-good-r1',
            [['g-api#0', 'next-key', 'HTTP 401'], ['g-api#1', 'ok', null]],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('HTTP 429觸發冷卻: 次輪該條目降至鏈尾', async function() {
        let stored = { cursors: {}, cooling: {} }
        let store = {
            get: () => stored,
            set: (s) => {
                stored = s
            }
        }
        //flaky-429對同一金鑰首次回429; maxRetries預設0故第1輪即失敗並觸發冷卻
        let p429 = { id: 'cd-api-429', kind: 'api-openai-compat', baseURL: svr.url, model: 'flaky-429', keys: ['sk-good-cd429'] }
        let pEcho = { id: 'cd-api-echo', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-good-cd-e'] }
        let r1 = await dispatchAiFallback('abc', { providers: [p429, pEcho], store, cooldownMs: 300000 })
        let r2 = await dispatchAiFallback('abc', { providers: [p429, pEcho], store, cooldownMs: 300000 })
        let r = [
            r1.providerId,
            r1.tried.map((x) => [x.providerId, x.error || null]),
            typeof stored.cooling['cd-api-429'],
            r2.tried.map((x) => x.providerId), //429者已降尾, echo先上即成功
        ]
        let rr = [
            'cd-api-echo',
            [['cd-api-429', 'HTTP 429'], ['cd-api-echo', null]],
            'number',
            ['cd-api-echo'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('可作為工作流provider, 回覆JSON經解析與檢核', async function() {
        let wkf = dispatchAiWkf({
            providers: {
                'api-echo': { kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-good-w0'] },
            },
            defaults: { promptPrefix: '' },
        })
        let t = await wkf.callAi('abc', {
            spec: { use: 'api-echo' },
            check: (j) => j.body.model === 'echo',
        })
        let r = [t.ok, t.providerId, t.keyId, t.json.auth, t.json.body.messages[0].content]
        let rr = [true, 'api-echo', 'api-echo#0', 'Bearer sk-good-w0', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('usage原樣透傳: 成功帶回應之token用量, 網路層與HTTP錯誤為null', async function() {
        let t1 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo' })
        let t2 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'err-500' })
        let r = [t1.ok, t1.usage, t2.ok, t2.usage]
        let rr = [true, { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 }, false, null]
        assert.strict.deepEqual(r, rr)
    })

    it('usage經遞補層與工作流層流出於結果與tried, CLI路徑無此欄', async function() {
        let tf = await dispatchAiFallback('abc', {
            providers: [{ id: 'us-api', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-good-us'] }],
        })
        let wkf = dispatchAiWkf({
            providers: {
                'us-w-api': { kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-good-us2'] },
            },
            defaults: { promptPrefix: '' },
        })
        let tw = await wkf.callAi('abc', { spec: { use: 'us-w-api' } })
        let r = [
            tf.usage.total_tokens,
            tf.tried[0].usage.total_tokens, //tried歷程各項一併帶上, 供加總實際耗用
            tw.usage.total_tokens,
        ]
        let rr = [10, 10, 10]
        assert.strict.deepEqual(r, rr)
    })

    it('errorType機器可讀分類: http/tool-unsupported/validation/timeout, 成功無此欄', async function() {
        let t1 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'err-500' })
        let t2 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'tool-calls' })
        let t3 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', validate: 'min:100000' })
        let t4 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'slow', timeoutMs: 500 })
        let t5 = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo' })
        let r = [t1.errorType, t2.errorType, t3.errorType, t4.errorType, t5.errorType]
        let rr = ['http', 'tool-unsupported', 'validation', 'timeout', undefined]
        assert.strict.deepEqual(r, rr)
    })

})
