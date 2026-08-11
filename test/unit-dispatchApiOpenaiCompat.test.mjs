import assert from 'assert'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
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

})
