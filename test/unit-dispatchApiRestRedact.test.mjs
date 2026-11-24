import assert from 'assert'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'


// unit-dispatchApiRestRedact.test.mjs — 三家REST轉接器(api-openai-compat、api-openai-responses、api-typesafe-systemone)之錯誤路徑金鑰遮蔽
//   (2026-11-24 tdai4b; 主控裁定(a), 帳本R-REDACT-3: 預設拒絕, 比照api-anthropic)
//
// 規格(逐句對應下列各案):
//   S1 HTTP錯誤本體(stderr)回顯Authorization標頭或金鑰本體時, 結果物件不含金鑰(遮蔽字樣***);
//   S2 HTTP 200但本體非JSON: 診斷(error, 含回應標頭值)與stderr皆遮蔽, 前綴INVALID_RESPONSE: body is not JSON不變;
//   S3 HTTP 200之JSON無可用欄位(invalid-response): stderr遮蔽;
//   S4 呼叫端validate之例外訊息(stderr)遮蔽; validate回false時失敗結果之stdout(模型輸出之前段)遮蔽;
//   S5 啟動前params錯誤之外來例外訊息(body之toJSON、標頭值toString拋出夾帶金鑰)遮蔽;
//   S6 經dispatchAiFallback後頂層、tried與事件皆不含金鑰;
//   S7 截斷(finish_reason length)未放行之失敗結果, stdout與stderr遮蔽(chat/completions)。
// 金鑰本體刻意不屬任何金鑰樣式(sk-、oc_sk_等), 令斷言只靠「已登錄之機密值」(Authorization標頭值與金鑰本體)而非樣式。
// 全部為本機假伺服器, 不連外網。


let KEY = 'LEAKKEY-restredact-0123456789'

let Q = {
    urgent: { type: 'noul', instructions: '是否急迫?' },
}


describe('三家REST轉接器之錯誤路徑金鑰遮蔽(tdai4b)', function() {

    let svr = null

    before(async function() {
        svr = await fakeServerForApiTest()
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
    })

    let ADAPTERS = [
        { name: 'api-openai-compat', call: (opt) => dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: KEY, ...opt }) },
        { name: 'api-openai-responses', call: (opt) => dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: KEY, ...opt }) },
        { name: 'api-typesafe-systemone', call: (opt) => dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: KEY, questions: Q, ...opt }) },
    ]

    for (let a of ADAPTERS) {

        describe(a.name, function() {

            it('S1 HTTP錯誤本體回顯Authorization標頭與金鑰本體: stderr與整個結果物件皆不含金鑰, 以***遮蔽', async function() {
                let r = await a.call({ model: 'err-echo-key' })
                assert.strict.deepEqual(
                    [r.ok, r.errorType, r.error, r.stderr, JSON.stringify(r).includes(KEY)],
                    [false, 'http', 'HTTP 401', '{"error":{"message":"bad credential *** / ***"}}', false],
                )
            })

            it('S2 HTTP 200但本體非JSON(Content-Type參數與本文皆回顯金鑰): error與stderr皆遮蔽, 前綴不變', async function() {
                let r = await a.call({ model: 'nonjson-echo-key' })
                assert.strict.deepEqual(
                    [r.ok, r.errorType, r.error.startsWith('INVALID_RESPONSE: body is not JSON'), r.error.includes('***'), r.stderr, JSON.stringify(r).includes(KEY)],
                    [false, 'invalid-response', true, true, 'oops ***', false],
                )
            })

            it('S3 HTTP 200之JSON無可用欄位(invalid-response): stderr遮蔽金鑰本體', async function() {
                let r = await a.call({ model: 'junk-json-echo-key' })
                assert.strict.deepEqual(
                    [r.ok, r.errorType, r.stderr, JSON.stringify(r).includes(KEY)],
                    [false, 'invalid-response', '{"note":"no usable fields","echo":"***"}', false],
                )
            })

            it('S4 validate拋錯之例外訊息夾帶金鑰: stderr以***遮蔽; validate回false且內容含金鑰時失敗結果之stdout亦遮蔽', async function() {
                let r1 = await a.call({
                    model: 'echo',
                    validate: () => {
                        throw new Error(`validator saw ${KEY}`)
                    },
                })
                let r2 = await a.call({ model: 'echo', validate: () => false })
                assert.strict.deepEqual(
                    [
                        [r1.ok, r1.errorType, r1.stderr, JSON.stringify(r1).includes(KEY)],
                        [r2.ok, r2.errorType, r2.stdout.includes('***'), JSON.stringify(r2).includes(KEY)],
                    ],
                    [
                        [false, 'validation', 'validate threw: validator saw ***', false],
                        [false, 'validation', true, false],
                    ],
                )
            })

            it('S5 啟動前params錯誤之外來例外訊息(body之toJSON、標頭值之toString拋出夾帶金鑰)以***遮蔽, 且零次請求', async function() {
                let r1 = await a.call({
                    model: 'echo',
                    body: {
                        toJSON: () => {
                            throw new Error(`toJSON saw ${KEY}`)
                        },
                    },
                })
                let r2 = await a.call({
                    model: 'echo',
                    headers: {
                        'x-extra': {
                            toString: () => {
                                throw new Error(`header saw ${KEY}`)
                            },
                        },
                    },
                })
                assert.strict.deepEqual(
                    [
                        [r1.ok, r1.errorType, r1.attempts, r1.error, JSON.stringify(r1).includes(KEY)],
                        [r2.ok, r2.errorType, r2.attempts, r2.error, JSON.stringify(r2).includes(KEY)],
                    ],
                    [
                        [false, 'params', 0, 'body is not JSON-serializable: toJSON saw ***', false],
                        [false, 'params', 0, 'headers is not readable: header saw ***', false],
                    ],
                )
            })

        })

    }

    it('S6 經dispatchAiFallback(api-openai-compat、api-openai-responses各一條目): 頂層、tried與事件皆不含金鑰', async function() {
        let events = []
        let f = await dispatchAiFallback('abc', {
            providers: [
                { id: 'rr-compat', kind: 'api-openai-compat', baseURL: svr.url, model: 'err-echo-key', keys: [KEY] },
                { id: 'rr-resp', kind: 'api-openai-responses', baseURL: svr.url, model: 'err-echo-key', keys: [KEY] },
            ],
            onEvent: (ev) => events.push(ev),
        })
        let all = JSON.stringify({ f, events })
        assert.strict.deepEqual([f.ok, all.includes(KEY), all.includes('bad credential')], [false, false, true])
    })

    it('S8 api-openai-responses: status為failed且error.message回顯金鑰時, error(INCOMPLETE_RESPONSE之detail)與stderr皆以***遮蔽', async function() {
        let r = await ADAPTERS[1].call({ model: 'failed-echo-key' })
        assert.strict.deepEqual(
            [r.ok, r.errorType, r.error, r.stderr.includes('boom ***'), JSON.stringify(r).includes(KEY)],
            [false, 'incomplete', 'INCOMPLETE_RESPONSE: status=failed (boom ***)', true, false],
        )
    })

    it('S9 api-openai-responses: status為incomplete且incomplete_details.reason回顯金鑰時, error(截斷裁定之訊息)以***遮蔽', async function() {
        let r = await ADAPTERS[1].call({ model: 'incomplete-echo-key' })
        assert.strict.deepEqual([r.ok, r.errorType, r.error.includes('***'), JSON.stringify(r).includes(KEY)], [false, 'incomplete', true, false])
    })

    it('S10 api-typesafe-systemone: 回應之model欄(modelResolved)回顯金鑰時以***遮蔽(失敗結果亦帶之)', async function() {
        let r = await ADAPTERS[2].call({ model: 'model-echo-key' })
        assert.strict.deepEqual([r.ok, r.errorType, r.modelResolved, JSON.stringify(r).includes(KEY)], [false, 'invalid-response', '***', false])
    })

    it('S11 前後帶空白之金鑰(如自檔案讀入未trim; fetch送出前去掉標頭值之頭尾空白, 伺服器回顯去空白者)以去除後之本體與去Bearer前綴之本體遮蔽', async function() {
        let r = await ADAPTERS[0].call({ model: 'err-echo-key', key: `  ${KEY}\n` })
        //假伺服器回顯收到之Authorization標頭(fetch已去頭尾空白)與去Bearer前綴之本體
        assert.strict.deepEqual(
            [r.ok, r.errorType, r.stderr, JSON.stringify(r).includes(KEY)],
            [false, 'http', '{"error":{"message":"bad credential *** / ***"}}', false],
        )
    })

    it('S7 api-openai-compat: finish_reason為length且未放行時, 失敗結果之stdout(部分內容)與stderr皆以***遮蔽金鑰', async function() {
        let r = await ADAPTERS[0].call({ model: 'trunc-echo-key' })
        assert.strict.deepEqual(
            [r.ok, r.errorType, r.stdout, JSON.stringify(r).includes(KEY)],
            [false, 'incomplete', 'partial ***', false],
        )
    })

})
