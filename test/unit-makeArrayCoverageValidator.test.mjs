import assert from 'assert'
import makeArrayCoverageValidator from '../src/wkf/makeArrayCoverageValidator.mjs'


// unit-makeArrayCoverageValidator.test.mjs — 逐項編號之JSON陣列涵蓋率驗證器(2026-11-01 da40, Gitea #40; 帳本R-PARSE-1)
//
// 規格來源: 建議檔§4: makeArrayCoverageValidator({ indices=[], indexField='index', contentFields=[], maxLengths={}, onReject })
//   回(stdout)=>Boolean: 非陣列或截斷→reject('非 JSON 陣列或輸出截斷'); 任一項任一受限欄位超過maxLengths[f]→
//   reject(`第 ${index} 項之 ${f} 為 ${len} 字，超過上限 ${max}`)(整體不合格,不剔除該項); 以「涵蓋」判定(同一編號可回多筆)且
//   contentFields任一非空才算有內容; 缺項→reject(`未涵蓋編號 …（缺項或內容為空）`); indices給了但非陣列拋TypeError(不可靜默改空陣列)。


//collect, 蒐集onReject回報
let collect = () => {
    let reasons = []
    return { reasons, onReject: (r) => reasons.push(r) }
}


describe('makeArrayCoverageValidator', function() {

    // 建議檔§7-4
    it('建議檔驗收: 超長即整體不合格(false)，合格輸入為true', function() {
        let v = makeArrayCoverageValidator({ indices: [1, 2], contentFields: ['t'], maxLengths: { t: 3 } })
        assert.strict.equal(v('[{"index":1,"t":"abcd"},{"index":2,"t":"x"}]'), false)
        assert.strict.equal(v('[{"index":1,"t":"a"},{"index":2,"t":"b"}]'), true)
    })

    // 規格句: 非陣列或截斷 → reject('非 JSON 陣列或輸出截斷')
    it('非JSON陣列或輸出截斷: false並回報固定原因', function() {
        let { reasons, onReject } = collect()
        let v = makeArrayCoverageValidator({ indices: [1], contentFields: ['t'], onReject })
        let inputs = ['', '純文字', '{"index":1,"t":"a"}', '[{"index":1,"t":"a"},{"index":2', null, undefined, 5, {}]
        for (let s of inputs) {
            assert.strict.equal(v(s), false)
        }
        assert.strict.deepEqual(reasons, inputs.map(() => '非 JSON 陣列或輸出截斷'))
    })

    // 規格句: 超長 → 整體不合格, 不剔除該項
    it('任一項任一受限欄位超長: 整體不合格並回報（第 N 項之 欄位 為 L 字，超過上限 M）', function() {
        let { reasons, onReject } = collect()
        let v = makeArrayCoverageValidator({ indices: [1, 2, 3], contentFields: ['t', 'u'], maxLengths: { t: 3, u: 2 }, onReject })
        assert.strict.equal(v('[{"index":1,"t":"ab"},{"index":2,"t":"ab","u":"xyz"},{"index":3,"t":"a"}]'), false)
        assert.strict.equal(v('[{"index":1,"t":"abcd"},{"index":2,"t":"a"},{"index":3,"t":"a"}]'), false)
        assert.strict.deepEqual(reasons, ['第 2 項之 u 為 3 字，超過上限 2', '第 1 項之 t 為 4 字，超過上限 3'])
        //恰等於上限不算超長
        assert.strict.equal(v('[{"index":1,"t":"abc"},{"index":2,"t":"ab","u":"xy"},{"index":3,"t":"a"}]'), true)
    })

    it('超長項即使其餘項完整涵蓋仍整體不合格（不剔除該項後放行）', function() {
        let v = makeArrayCoverageValidator({ indices: [1, 2], contentFields: ['t'], maxLengths: { t: 3 } })
        assert.strict.equal(v('[{"index":1,"t":"a"},{"index":2,"t":"b"},{"index":9,"t":"zzzzzzzz"}]'), false) //多餘項超長亦不合格
    })

    it('超長回報之項號只回數字編號（編號欄位非數字時為?，不回顯回覆中的任意值）', function() {
        let { reasons, onReject } = collect()
        let v = makeArrayCoverageValidator({ indices: [], maxLengths: { t: 1 }, onReject })
        v('[{"index":"secret-token-abc","t":"zz"}]')
        v('[{"t":"zz"}]')
        assert.strict.deepEqual(reasons, ['第 ? 項之 t 為 2 字，超過上限 1', '第 ? 項之 t 為 2 字，超過上限 1'])
    })

    // 規格句: 以「涵蓋」判定(同一編號可回多筆)且contentFields任一非空才算有內容
    it('缺項: false並回報未涵蓋編號（缺項或內容為空）', function() {
        let { reasons, onReject } = collect()
        let v = makeArrayCoverageValidator({ indices: [1, 2, 3], contentFields: ['t'], onReject })
        assert.strict.equal(v('[{"index":1,"t":"a"},{"index":3,"t":"c"}]'), false)
        assert.strict.equal(v('[]'), false)
        assert.strict.deepEqual(reasons, ['未涵蓋編號 2（缺項或內容為空）', '未涵蓋編號 1、2、3（缺項或內容為空）'])
    })

    it('內容為空（空字串、純空白、null、缺欄位、空陣列）不算涵蓋；contentFields任一非空即算有內容', function() {
        let { reasons, onReject } = collect()
        let v = makeArrayCoverageValidator({ indices: [1], contentFields: ['t', 'u'], onReject })
        for (let item of ['{"index":1,"t":""}', '{"index":1,"t":"  \\n"}', '{"index":1,"t":null}', '{"index":1}', '{"index":1,"t":[]}']) {
            assert.strict.equal(v(`[${item}]`), false, item)
        }
        assert.strict.equal(reasons.length, 5)
        assert.strict.equal(v('[{"index":1,"t":"","u":"有內容"}]'), true) //任一欄位非空
        assert.strict.equal(v('[{"index":1,"t":["x"]}]'), true)
        assert.strict.equal(v('[{"index":1,"t":0}]'), true) //非字串非空值(數字)視為有內容
    })

    it('同一編號可回多筆: 只要有一筆有內容即算涵蓋', function() {
        let v = makeArrayCoverageValidator({ indices: [1, 2], contentFields: ['t'] })
        assert.strict.equal(v('[{"index":1,"t":""},{"index":1,"t":"a"},{"index":2,"t":"b"},{"index":2,"t":"c"}]'), true)
        assert.strict.equal(v('[{"index":1,"t":""},{"index":1,"t":" "},{"index":2,"t":"b"}]'), false)
    })

    it('contentFields為空: 只驗編號有被涵蓋；多餘編號與非物件元素不影響', function() {
        let v = makeArrayCoverageValidator({ indices: [1, 2] })
        assert.strict.equal(v('[{"index":1},{"index":2},{"index":99},7,null,"x"]'), true)
        assert.strict.equal(v('[{"index":1},7]'), false)
    })

    it('編號須為數字: 字串數字不算涵蓋；indexField可改欄位名', function() {
        let v = makeArrayCoverageValidator({ indices: [1] })
        assert.strict.equal(v('[{"index":"1"}]'), false)
        let w = makeArrayCoverageValidator({ indices: [1, 2], indexField: 'no', contentFields: ['s'] })
        assert.strict.equal(w('[{"no":1,"s":"a"},{"no":2,"s":"b"}]'), true)
        assert.strict.equal(w('[{"index":1,"s":"a"},{"index":2,"s":"b"}]'), false)
    })

    // 規格句: 回覆格式容忍(code fence與前後說明, 同parseJsonArray)
    it('回覆帶code fence與前後說明文字仍可驗', function() {
        let v = makeArrayCoverageValidator({ indices: [1], contentFields: ['t'] })
        assert.strict.equal(v('以下是結果:\n```json\n[{"index":1,"t":"a"}]\n```\n完成'), true)
    })

    // 規格句: indices給了但非陣列拋TypeError; 省略不拋
    it('indices給了但非陣列: 拋TypeError（含null；不可靜默改空陣列形同放行），訊息為「makeArrayCoverageValidator 之 indices 須為陣列」（srcRunner原契約，Gitea #42 §5）', function() {
        for (let v of ['1,2', 5, {}, null, true]) {
            assert.throws(() => makeArrayCoverageValidator({ indices: v }), TypeError)
            assert.throws(() => makeArrayCoverageValidator({ indices: v }), { message: 'makeArrayCoverageValidator 之 indices 須為陣列' })
        }
    })

    it('indices省略不拋: 視為空陣列（只驗為完整陣列與超長）；opt非物件亦不拋', function() {
        let v = makeArrayCoverageValidator({})
        assert.strict.equal(v('[]'), true)
        assert.strict.equal(v('[{"a":1}]'), true)
        assert.strict.equal(v('{"a":1}'), false)
        for (let o of [undefined, null, 'x', 5, []]) {
            let w = makeArrayCoverageValidator(o)
            assert.strict.equal(w('[1]'), true)
        }
    })

    // 規格句: contentFields／maxLengths型別回退
    it('contentFields、maxLengths、indexField型別不符視為未給（不throw）；maxLengths內非正整數之上限略過', function() {
        let v1 = makeArrayCoverageValidator({ indices: [1], contentFields: 'abc', maxLengths: 'x', indexField: 5 })
        assert.strict.equal(v1('[{"index":1}]'), true) //contentFields回退[]→只驗編號; indexField回退'index'
        let v2 = makeArrayCoverageValidator({ indices: [1], maxLengths: { t: 0, u: -1, w: 'x', z: 1.5, ok: 2 } })
        assert.strict.equal(v2('[{"index":1,"t":"aaa","u":"aaa","w":"aaa","z":"aaa"}]'), true) //無效上限全略過
        assert.strict.equal(v2('[{"index":1,"ok":"aaa"}]'), false) //有效上限仍生效
        let v3 = makeArrayCoverageValidator({ indices: [1], contentFields: ['t', 5, null, ''] })
        assert.strict.equal(v3('[{"index":1,"t":"a"}]'), true) //contentFields內非字串元素略過
    })

    it('maxLengths只檢字串欄位（非字串值不檢）', function() {
        let v = makeArrayCoverageValidator({ indices: [1], maxLengths: { t: 1 } })
        assert.strict.equal(v('[{"index":1,"t":12345,"u":"xxxxxxxx"}]'), true)
    })

    // 規格句: onReject非函數不回報; 回調出錯不影響驗證結果
    it('onReject非函數不回報不throw；onReject拋錯或回傳Promise皆忽略、驗證結果不變', async function() {
        for (let onReject of [undefined, null, 'x', 5, {}]) {
            let v = makeArrayCoverageValidator({ indices: [1], onReject })
            assert.strict.equal(v('[]'), false)
        }
        let v1 = makeArrayCoverageValidator({
            indices: [1],
            onReject: () => {
                throw new Error('boom')
            }
        })
        assert.strict.equal(v1('[]'), false)
        let unhandled = []
        let h = (e) => unhandled.push(e)
        process.on('unhandledRejection', h)
        try {
            let v2 = makeArrayCoverageValidator({
                indices: [1],
                onReject: async () => {
                    throw new Error('async boom')
                }
            })
            assert.strict.equal(v2('[]'), false)
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        finally {
            process.off('unhandledRejection', h)
        }
        assert.strict.deepEqual(unhandled, [])
    })

    it('合格時不呼叫onReject；indices於建構時拷貝（事後改動原陣列不影響已建之驗證器）', function() {
        let { reasons, onReject } = collect()
        let indices = [1]
        let v = makeArrayCoverageValidator({ indices, contentFields: ['t'], onReject })
        indices.push(2)
        assert.strict.equal(v('[{"index":1,"t":"a"}]'), true)
        assert.strict.deepEqual(reasons, [])
    })

    it('驗證器對任意輸入不throw（物件、陣列、包裝物件）', function() {
        let v = makeArrayCoverageValidator({ indices: [1], contentFields: ['t'] })
        for (let s of [{}, [], Object('[{"index":1,"t":"a"}]'), Symbol.iterator.description, 12.5]) {
            assert.strict.doesNotThrow(() => v(s))
        }
    })

})
