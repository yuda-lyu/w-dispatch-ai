import assert from 'assert'
import dispatchApiOpenaiResponses, { extractOutputText } from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'


describe('dispatchApiOpenaiResponses', function() {

    let svr = null

    before(async function() {
        svr = await fakeServerForApiTest()
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
    })

    it('extractOutputText只取message型之output_text, 略過reasoning且多段依序串接', function() {
        let r = [
            extractOutputText([
                { type: 'reasoning', content: [] },
                { type: 'message', content: [{ type: 'output_text', text: '完成' }] },
            ]),
            extractOutputText([
                { type: 'message', content: [{ type: 'output_text', text: 'AA' }] },
                { type: 'reasoning', content: [] },
                { type: 'message', content: [{ type: 'output_text', text: 'BB' }] },
            ]),
            extractOutputText([{ type: 'reasoning', content: [] }]), //僅思考
            extractOutputText(null),
            extractOutputText([]),
        ]
        let rr = ['完成', 'AABB', '', '', '']
        assert.strict.deepEqual(r, rr)
    })

    it('prompt/baseURL/model之必填檢核, 回傳錯誤結果物件且不reject', async function() {
        let t1 = await dispatchApiOpenaiResponses('')
        let t2 = await dispatchApiOpenaiResponses('abc', { model: 'echo' })
        let t3 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url })
        let r = [[t1.ok, t1.error], [t2.ok, t2.error], [t3.ok, t3.error, t3.errorType]]
        let rr = [
            [false, 'prompt must be a non-empty string'],
            [false, 'baseURL must be a non-empty string'],
            [false, 'model must be a non-empty string', 'params'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('請求打/responses端點, prompt置於input、system置於instructions', async function() {
        let t = await dispatchApiOpenaiResponses('中文prompt\n第二行', {
            baseURL: svr.url, key: 'sk-good-1', model: 'echo', system: '你是審計者', body: { max_output_tokens: 2048 },
        })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, t.code, t.attempts, o.auth, o.body.model, o.body.input, o.body.instructions, o.body.max_output_tokens, o.body.messages]
        let rr = [true, 200, 1, 'Bearer sk-good-1', 'echo', '中文prompt\n第二行', '你是審計者', 2048, undefined]
        assert.strict.deepEqual(r, rr)
    })

    it('baseURL尾端斜線正規化, 未給key時不帶Authorization標頭', async function() {
        let t = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url + '///', model: 'echo' })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, t.code, o.auth]
        let rr = [true, 200, '']
        assert.strict.deepEqual(r, rr)
    })

    it('多個message元素依序串接為stdout', async function() {
        let t = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'multi-message' })
        let r = [t.ok, t.stdout]
        let rr = [true, 'AABB']
        assert.strict.deepEqual(r, rr)
    })

    it('status非completed一律失敗不回半截內容: incomplete與failed', async function() {
        let t1 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'incomplete' })
        let t2 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'failed' })
        let r = [
            [t1.ok, t1.errorType, t1.error],
            [t2.ok, t2.errorType, t2.error],
        ]
        let rr = [
            [false, 'incomplete', 'INCOMPLETE_RESPONSE: status=incomplete (max_output_tokens)'],
            [false, 'incomplete', 'INCOMPLETE_RESPONSE: status=failed (upstream blew up)'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('結構不合規之回應: 缺output陣列、非JSON、僅reasoning無message', async function() {
        let t1 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'no-output' })
        let t2 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'not-json' })
        let t3 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'reasoning-only' })
        let r = [
            [t1.ok, t1.errorType, t1.error],
            [t2.ok, t2.errorType],
            [t3.ok, t3.errorType, t3.error],
        ]
        let rr = [
            [false, 'invalid-response', 'INVALID_RESPONSE: missing output array'],
            [false, 'invalid-response'],
            [false, 'invalid-response', 'INVALID_RESPONSE: no output_text in output messages'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('output含function_call時以TOOL_CALLS_UNSUPPORTED回報而不假裝成功', async function() {
        let t = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'tool-calls' })
        let r = [t.ok, t.errorType, t.error.indexOf('TOOL_CALLS_UNSUPPORTED') === 0, t.stdout]
        let rr = [false, 'tool-unsupported', true, '']
        assert.strict.deepEqual(r, rr)
    })

    it('validate未過為OUTPUT_VALIDATION_FAILED(令遞補層可統一分流)', async function() {
        let t1 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', validate: 'min:100000' })
        let t2 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'empty-content', validate: 'nonempty' })
        let r = [
            [t1.ok, t1.error, t1.errorType, t1.stdout.length > 0],
            [t2.ok, t2.errorType], //空內容於取值階段即判invalid-response
        ]
        let rr = [
            [false, 'OUTPUT_VALIDATION_FAILED', 'validation', true],
            [false, 'invalid-response'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('壞金鑰與未知model皆401(同Zen實測), 4xx不重試', async function() {
        let t1 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-bad', model: 'echo', maxRetries: 3 })
        let t2 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'no-such-model', maxRetries: 3 })
        let r = [
            [t1.ok, t1.code, t1.errorType, t1.attempts, t1.stderr.includes('AuthError')],
            [t2.ok, t2.code, t2.attempts, t2.stderr.includes('is not supported')],
        ]
        let rr = [
            [false, 401, 'http', 1, true],
            [false, 401, 1, true],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('429與5xx依maxRetries重試, 逾時error以TIMEOUT開頭', async function() {
        let t1 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-retry', model: 'flaky-429', maxRetries: 2, retryDelayMs: 10 })
        let t2 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'slow', timeoutMs: 500 })
        let r = [
            [t1.ok, t1.attempts, JSON.parse(t1.stdout).attempt],
            [t2.ok, t2.code, t2.errorType, t2.error.indexOf('TIMEOUT') === 0],
        ]
        let rr = [
            [true, 2, 2],
            [false, null, 'timeout', true],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('usage原樣透傳(欄位名為input_tokens/output_tokens, 與chat/completions不同)', async function() {
        let t1 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo' })
        let t2 = await dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'incomplete' })
        let r = [t1.usage, t2.usage] //失敗結果亦帶出已耗token
        let rr = [
            { input_tokens: 5, output_tokens: 11, total_tokens: 16 },
            { input_tokens: 5, output_tokens: 11, total_tokens: 16 },
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('可作為dispatchAi之kind與dispatchAiFallback之條目', async function() {
        let t1 = await dispatchAi('api-openai-responses', 'abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo' })
        //遞補: responses型條目失敗(未知model→401)後換chat/completions型條目成功, 兩kind混用於同一鏈
        let t2 = await dispatchAiFallback('abc', {
            providers: [
                { id: 'r-bad', kind: 'api-openai-responses', baseURL: svr.url, model: 'no-such-model', keys: ['sk-good-a'] },
                { id: 'c-ok', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-good-b'] },
            ],
        })
        let r = [t1.ok, JSON.parse(t1.stdout).body.model, t2.ok, t2.providerId, t2.tried.map((x) => [x.providerId, x.outcome])]
        let rr = [true, 'echo', true, 'c-ok', [['r-bad', 'next-key'], ['c-ok', 'ok']]]
        assert.strict.deepEqual(r, rr)
    })

    it('可作為工作流provider, 回覆經解析與檢核', async function() {
        let wkf = dispatchAiWkf({
            providers: {
                'resp-echo': { kind: 'api-openai-responses', baseURL: svr.url, model: 'echo', keys: ['sk-good-w'] },
            },
            defaults: { promptPrefix: '' },
        })
        let t = await wkf.callAi('abc', { spec: { use: 'resp-echo' }, check: (j) => j.body.model === 'echo' })
        let r = [t.ok, t.providerId, t.keyId, t.json.auth, t.json.body.input, t.usage.total_tokens]
        let rr = [true, 'resp-echo', 'resp-echo#0', 'Bearer sk-good-w', 'abc', 16]
        assert.strict.deepEqual(r, rr)
    })

})
