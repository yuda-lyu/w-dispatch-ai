import assert from 'assert'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import NO_SIDE_EFFECT from '../src/wkf/noSideEffectPrefix.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'


//共用題目: 兩題, 用於檢核「每題皆有答案」
let Q = {
    category: { type: 'choice', instructions: '哪一類?', criteria: { '報修': '設備故障', '其他': null } },
    urgent: { type: 'noul', instructions: '是否急迫?' },
}


describe('dispatchApiTypesafeSystemone', function() {

    let svr = null

    before(async function() {
        svr = await fakeServerForApiTest()
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
    })

    it('prompt與questions之必填檢核(questions須為非空物件), 回傳錯誤結果物件且不reject', async function() {
        let t1 = await dispatchApiTypesafeSystemone('')
        let t2 = await dispatchApiTypesafeSystemone('abc')
        let t3 = await dispatchApiTypesafeSystemone('abc', { questions: {} })
        let t4 = await dispatchApiTypesafeSystemone('abc', { questions: [Q.urgent] })
        let r = [[t1.ok, t1.error, t1.errorType], [t2.ok, t2.error, t2.attempts], [t3.ok, t3.error], [t4.ok, t4.error]]
        let rr = [
            [false, 'prompt must be a non-empty string', 'params'],
            [false, 'questions must be a non-empty object', 0],
            [false, 'questions must be a non-empty object'],
            [false, 'questions must be a non-empty object'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('請求打/systemone: prompt置於state、questions原樣送出、model預設jev-latest、body額外鍵併入', async function() {
        let t = await dispatchApiTypesafeSystemone('房間水龍頭滴水\n第二行', { baseURL: svr.url, key: 'sk-good-1', questions: Q, body: { tag: 'x' } })
        let a = t.answers.urgent
        let r = [t.ok, t.code, t.attempts, a.echoAuth, a.echoBody.model, a.echoBody.state, a.echoBody.questions, a.echoBody.tag]
        let rr = [true, 200, 1, 'Bearer sk-good-1', 'jev-latest', '房間水龍頭滴水\n第二行', Q, 'x']
        assert.strict.deepEqual(r, rr)
    })

    it('baseURL尾端斜線正規化, 未給key時不帶Authorization標頭', async function() {
        let t = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url + '///', model: 'echo', questions: Q })
        let r = [t.ok, t.answers.urgent.echoAuth]
        let rr = [true, '']
        assert.strict.deepEqual(r, rr)
    })

    it('成功: stdout為answers之JSON字串且與answers一致, 追加modelResolved, usage原樣透傳', async function() {
        let t = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', questions: Q })
        let r = [t.ok, t.error, JSON.parse(t.stdout), Object.keys(t.answers), t.modelResolved, t.usage]
        let rr = [true, '', t.answers, ['category', 'urgent'], 'jev-1.13.0', { input_tokens: 7, output_tokens: 3 }]
        assert.strict.deepEqual(r, rr)
    })

    it('回應不合規: 缺任一題答案、缺answers、非JSON皆為invalid-response, 答案不外流', async function() {
        let t1 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'missing-answer', questions: Q })
        let t2 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'no-answers', questions: Q })
        let t3 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'not-json', questions: Q })
        let r = [
            [t1.ok, t1.errorType, t1.error, t1.answers, t1.stdout, t1.modelResolved, t1.usage],
            [t2.ok, t2.errorType, t2.error],
            [t3.ok, t3.errorType, t3.error],
        ]
        let rr = [
            [false, 'invalid-response', 'INVALID_RESPONSE: missing answers for [urgent]', null, '', 'jev-1.13.0', { input_tokens: 7, output_tokens: 3 }],
            [false, 'invalid-response', 'INVALID_RESPONSE: missing answers object'],
            [false, 'invalid-response', 'INVALID_RESPONSE: missing answers object'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('壞金鑰401、未知model 400、題型不合規422皆為http且4xx不重試, 原始本體置stderr', async function() {
        let t1 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-bad', model: 'echo', questions: Q, maxRetries: 3 })
        let t2 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'jev-nope', questions: Q, maxRetries: 3 })
        let t3 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'bad-question', questions: Q, maxRetries: 3 })
        let r = [
            [t1.ok, t1.code, t1.error, t1.errorType, t1.attempts, t1.stderr.includes('authentication_error')],
            [t2.ok, t2.code, t2.attempts, t2.stderr.includes('Unknown model: jev-nope')],
            [t3.ok, t3.code, t3.attempts, t3.stderr.includes('union_tag_invalid')],
        ]
        let rr = [
            [false, 401, 'HTTP 401', 'http', 1, true],
            [false, 400, 1, true],
            [false, 422, 1, true],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('429依maxRetries重試後成功, 5xx重試用盡仍失敗, 逾時error以TIMEOUT開頭', async function() {
        let t1 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-retry', model: 'flaky-429', questions: Q, maxRetries: 2, retryDelayMs: 10 })
        let t2 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'err-500', questions: Q, maxRetries: 1, retryDelayMs: 10 })
        let t3 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'slow', questions: Q, timeoutMs: 500 })
        let r = [
            [t1.ok, t1.attempts, t1.answers.urgent.attempt],
            [t2.ok, t2.code, t2.attempts, t2.errorType],
            [t3.ok, t3.code, t3.errorType, t3.error.indexOf('TIMEOUT') === 0],
        ]
        let rr = [
            [true, 2, 2],
            [false, 500, 2, 'http'],
            [false, null, 'timeout', true],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('連線失敗為fetch, validate未過為OUTPUT_VALIDATION_FAILED', async function() {
        let t1 = await dispatchApiTypesafeSystemone('abc', { baseURL: 'http://127.0.0.1:9/v1', questions: Q, timeoutMs: 3000 })
        let t2 = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-good-1', model: 'echo', questions: Q, validate: 'min:100000' })
        let r = [[t1.ok, t1.errorType, t1.error.indexOf('FETCH_ERROR') === 0], [t2.ok, t2.errorType, t2.error, t2.answers]]
        let rr = [[false, 'fetch', true], [false, 'validation', 'OUTPUT_VALIDATION_FAILED', null]]
        assert.strict.deepEqual(r, rr)
    })

    it('可作為dispatchAi之kind; dispatchAiFallback之questions可置於呼叫層並隨金鑰輪替透傳', async function() {
        let t1 = await dispatchAi('api-typesafe-systemone', 'abc', { baseURL: svr.url, key: 'sk-good-1', questions: Q })
        let t2 = await dispatchAiFallback('abc', {
            providers: [
                { id: 'typesafe:jev-latest', kind: 'api-typesafe-systemone', baseURL: svr.url, model: 'jev-latest', keys: ['sk-bad-a', 'sk-good-b'] },
            ],
            questions: Q,
        })
        let r = [
            t1.ok, t1.answers.urgent.echoBody.model,
            t2.ok, t2.providerId, t2.tried.map((x) => [x.keyId, x.outcome]), JSON.parse(t2.stdout).category.echoAuth,
        ]
        let rr = [
            true, 'jev-latest',
            true, 'typesafe:jev-latest', [['typesafe:jev-latest#0', 'next-key'], ['typesafe:jev-latest#1', 'ok']], 'Bearer sk-good-b',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('工作流callAi: promptPrefix為空時state即原文; 預設前綴會混入state(故須明傳promptPrefix:\'\')', async function() {
        let wkf = dispatchAiWkf({
            providers: {
                'jev': { kind: 'api-typesafe-systemone', baseURL: svr.url, model: 'echo', keys: ['sk-good-w'] },
            },
        })
        let t1 = await wkf.callAi('原文', { spec: { use: 'jev' }, questions: Q, promptPrefix: '', check: (j) => j.urgent.type === 'noul' })
        let t2 = await wkf.callAi('原文', { spec: { use: 'jev' }, questions: Q })
        let r = [t1.ok, t1.json.urgent.echoBody.state, t2.ok, t2.json.urgent.echoBody.state === NO_SIDE_EFFECT + '原文']
        let rr = [true, '原文', true, true]
        assert.strict.deepEqual(r, rr)
    })

})
