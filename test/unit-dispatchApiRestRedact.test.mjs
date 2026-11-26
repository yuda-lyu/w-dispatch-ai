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
// 成功路徑(2026-11-25 t628; 主控裁定①, 帳本R-REDACT-3; 三家各逐案):
//   S12 成功之模型輸出(stdout; typesafe為answers之字串值、屬性名與巢狀陣列)回顯Authorization與金鑰本體時以***遮蔽;
//   S13 成功之回聲(model echo)遮蔽為***, 標頭須改讀伺服器端取證通道(svr.lastRequest()), 原斷言形狀(JSON可解析、本體欄位不變)維持;
//   S14 usage(字串值、屬性名、巢狀陣列)深層遮蔽, 數值原樣; S15 validate收原文而結果已遮蔽; S16 只精確遮蔽(金鑰樣式字樣非本次金鑰者原樣);
//   S17 經遞補層之成功結果不含金鑰; S18 未給key之成功結果原樣; S19／S21 finishReason先遮原值再正規化(大小寫混合之金鑰);
//   S20／S22 acceptTruncated放行之截斷成功結果遮蔽。
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

    //========== 成功路徑(2026-11-25 t628; 帳本R-REDACT-3: 成功之stdout／answers與回應中介資料亦精確遮蔽, 比照api-anthropic) ==========

    for (let a of ADAPTERS) {

        describe(`${a.name} 成功路徑`, function() {

            it('S12 成功之模型輸出(stdout)回顯Authorization標頭與金鑰本體: 以***遮蔽, 整個結果物件不含金鑰', async function() {
                let r = await a.call({ model: 'ok-echo-key' })
                //typesafe之stdout為answers之JSON字串(由遮蔽後之answers序列化), 另驗answers之各字串值、屬性名與巢狀陣列
                let expect = a.name === 'api-typesafe-systemone'
                    ? { ok: true, note: 'reply *** / ***', named: 'x', inList: '***' }
                    : { ok: true, stdout: 'reply *** / ***' }
                let got = a.name === 'api-typesafe-systemone'
                    ? { ok: r.ok, note: r.answers.urgent.note, named: r.answers.urgent['***'], inList: r.answers.urgent.list[0] }
                    : { ok: r.ok, stdout: r.stdout }
                assert.strict.deepEqual([got, JSON.stringify(r).includes(KEY), r.stderr, r.error], [expect, false, '', ''])
            })

            it('S13 成功之回聲(model: echo回聲Authorization於stdout／answers): 遮蔽為***, 標頭須改讀伺服器端取證通道; 原本之斷言形狀(JSON可解析、本體欄位不變)維持', async function() {
                let r = await a.call({ model: 'echo' })
                let seen = svr.lastRequest()
                let echoed = a.name === 'api-typesafe-systemone' ? r.answers.urgent.echoAuth : JSON.parse(r.stdout).auth
                let echoedBody = a.name === 'api-typesafe-systemone' ? r.answers.urgent.echoBody.model : JSON.parse(r.stdout).body.model
                assert.strict.deepEqual(
                    [r.ok, echoed, echoedBody, seen.auth, JSON.stringify(r).includes(KEY)],
                    [true, '***', 'echo', `Bearer ${KEY}`, false],
                )
            })

            it('S14 成功結果之usage(字串值、屬性名、巢狀陣列)回顯金鑰: 深層遮蔽, 數值欄位原樣', async function() {
                let r = await a.call({ model: 'ok-echo-key' })
                let u = r.usage
                //回應中介資料(usage)走診斷家族: 另遮蔽非本次金鑰之金鑰樣式字樣(foreign為oc_sk_形式之他把金鑰)
                assert.strict.deepEqual(
                    [u.served_by, u['***'], u.trace, u.foreign, JSON.stringify(u).includes(KEY), typeof Object.values(u).find((v) => typeof v === 'number')],
                    ['***', 1, [{ k: '***' }], '***', false, 'number'],
                )
            })

            it('S15 validate收到原文(可據以判斷), 但回給呼叫端之結果已遮蔽: validate判含金鑰而通過, 結果stdout不含金鑰', async function() {
                let seenByValidate = ''
                let r = await a.call({
                    model: 'echo',
                    validate: (s) => {
                        seenByValidate = s
                        return s.includes(KEY)
                    },
                })
                assert.strict.deepEqual([r.ok, seenByValidate.includes(KEY), r.stdout.includes(KEY), JSON.stringify(r).includes(KEY)], [true, true, false, false])
            })

            it('S16 成功之模型輸出含金鑰樣式字樣(sk-ant-、password=)但非本次金鑰: 只精確遮蔽, 原樣保留(不套樣式集)', async function() {
                let r = await a.call({ model: 'ok-pattern-text' })
                let text = a.name === 'api-typesafe-systemone' ? r.answers.urgent.note : r.stdout
                assert.strict.deepEqual([r.ok, text], [true, 'see sk-ant-api03-SAMPLEONLY-0123456789 and password=hunter2-sample'])
            })

            it('S17 經dispatchAiFallback之成功結果: 頂層、tried與事件皆不含金鑰', async function() {
                let events = []
                let f = await dispatchAiFallback('abc', {
                    providers: [{ id: 'rr-ok', kind: a.name, baseURL: svr.url, model: 'ok-echo-key', keys: [KEY] }], //a.name即各轉接器之kind
                    questions: Q,
                    onEvent: (ev) => events.push(ev),
                })
                let all = JSON.stringify({ f, events })
                assert.strict.deepEqual([f.ok, all.includes(KEY), all.includes('***')], [true, false, true])
            })

            it('S18 未給key且無機密標頭之成功結果: 原樣(無可遮之機密值, 回聲內容不被改動)', async function() {
                let r = await a.call({ model: 'echo', key: undefined })
                let echoed = a.name === 'api-typesafe-systemone' ? r.answers.urgent.echoAuth : JSON.parse(r.stdout).auth
                assert.strict.deepEqual([r.ok, echoed, JSON.stringify(r).includes('***')], [true, '', false])
            })

        })

    }

    //========== 獨立複審(2026-11-25 t628)補案: 特殊字元金鑰、全小寫金鑰、自給標頭 ==========

    //含引號與反斜線之金鑰(HTTP標頭值可含; 於伺服器回應之JSON文字或本轉接器之JSON.stringify結果內被跳脫, 原值比對不到——由wsemi遮罩器內建展開JSON跳脫形, wsemi 1.9.82起)
    let KEYQ = 'LEAKKEY"quo\\te-0123456789'

    for (let a of ADAPTERS) {

        describe(`${a.name} 複審補案`, function() {

            it('S23 金鑰含引號與反斜線: 錯誤本體(JSON文字內金鑰被跳脫)之stderr與整個結果物件仍不含金鑰', async function() {
                let r = await a.call({ model: 'err-echo-key', key: KEYQ })
                assert.strict.deepEqual(
                    [r.ok, r.errorType, r.stderr, JSON.stringify(r).includes('LEAKKEY'), JSON.stringify(r).includes(JSON.stringify(KEYQ).slice(1, -1))],
                    [false, 'http', '{"error":{"message":"bad credential *** / ***"}}', false, false],
                )
            })

            it('S24 呼叫端自給x-api-key標頭值: 成功之模型輸出回顯該值時以***遮蔽(成功路徑遮蔽全部機密標頭值, 不只Authorization)', async function() {
                let X = 'HDRSECRET-xapikey-0123456789'
                let r = await a.call({ model: 'ok-echo-xkey', headers: { 'X-Api-Key': X } })
                let text = a.name === 'api-typesafe-systemone' ? r.answers.urgent.note : r.stdout
                assert.strict.deepEqual([r.ok, text, JSON.stringify(r).includes(X)], [true, 'reply ***', false])
            })

            it('S25 (M1現況釘住)預設拒絕之副作用: 呼叫端自給之非白名單標頭值(如X-Env: production)之字樣出現於成功之模型輸出時亦被遮為***; 白名單標頭(HTTP-Referer)之值與值為undefined之標頭(送出為字面undefined)不登錄、原樣', async function() {
                let r = await a.call({ model: 'ok-echo-hdrs', headers: { 'X-Env': 'production', 'HTTP-Referer': 'https://example.test/app', 'X-Maybe': undefined } })
                let text = a.name === 'api-typesafe-systemone' ? r.answers.urgent.note : r.stdout
                assert.strict.deepEqual([r.ok, text], [true, 'env=*** ref=https://example.test/app maybe=undefined'])
            })

        })

    }

    it('S26 api-openai-compat: 金鑰含引號與反斜線且content為陣列形態(轉接器以JSON.stringify轉字串)之成功stdout仍遮蔽金鑰', async function() {
        let r = await ADAPTERS[0].call({ model: 'ok-array-echo-key', key: KEYQ })
        assert.strict.deepEqual([r.ok, JSON.stringify(r).includes('LEAKKEY'), r.stdout.includes('***')], [true, false, true])
    })

    it('S27 全小寫之金鑰而伺服器回顯其大寫版於終止原因: finishReason(正規化轉小寫後即等於金鑰本體)仍以***遮蔽(compat之finish_reason、responses之status)', async function() {
        let LOW = 'leakkey-lower-0123456789'
        let r1 = await ADAPTERS[0].call({ model: 'finish-upper-echo-key', key: LOW })
        let r2 = await ADAPTERS[1].call({ model: 'status-upper-echo-key', key: LOW })
        assert.strict.deepEqual(
            [[r1.ok, r1.finishReason, JSON.stringify(r1).includes(LOW)], [r2.ok, r2.finishReason, JSON.stringify(r2).includes(LOW)]],
            [[true, '***', false], [false, '***', false]],
        )
    })

    it('S19 api-openai-compat: finish_reason回顯大小寫混合之金鑰時, finishReason以***遮蔽(先遮原值再正規化; 正規化轉小寫後之字串已不等於登錄值)', async function() {
        let r = await ADAPTERS[0].call({ model: 'ok-echo-key' })
        assert.strict.deepEqual([r.ok, r.finishReason, r.truncated, r.finishReason.includes(KEY.toLowerCase())], [true, '***', false, false])
    })

    it('S20 api-openai-compat: acceptTruncated放行之截斷成功結果(finish_reason為length), stdout以***遮蔽金鑰, truncated仍為true', async function() {
        let r = await ADAPTERS[0].call({ model: 'trunc-echo-key', acceptTruncated: true })
        assert.strict.deepEqual([r.ok, r.truncated, r.stdout, JSON.stringify(r).includes(KEY)], [true, true, 'partial ***', false])
    })

    it('S21 api-openai-responses: status為非completed之字串且為金鑰(失敗結果)時, finishReason與error皆以***遮蔽(先遮原值再正規化)', async function() {
        let r = await ADAPTERS[1].call({ model: 'status-echo-key' })
        assert.strict.deepEqual(
            [r.ok, r.finishReason, r.error.includes('***'), JSON.stringify(r).includes(KEY), JSON.stringify(r).includes(KEY.toLowerCase())],
            [false, '***', true, false, false],
        )
    })

    it('S22 api-openai-responses: acceptTruncated放行之截斷成功結果(status incomplete), stdout以***遮蔽金鑰, truncated仍為true', async function() {
        let r = await ADAPTERS[1].call({ model: 'incomplete-echo-partial', acceptTruncated: true })
        assert.strict.deepEqual([r.ok, r.truncated, r.finishReason, r.stdout, JSON.stringify(r).includes(KEY)], [true, true, 'length', 'partial ***', false])
    })

})
