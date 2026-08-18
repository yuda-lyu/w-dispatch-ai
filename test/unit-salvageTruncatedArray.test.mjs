import assert from 'assert'
import salvageTruncatedArray from '../src/wkf/salvageTruncatedArray.mjs'


describe('salvageTruncatedArray', function() {

    it('截斷陣列搶救出前段完整元素(每個元素皆完整合法)', function() {
        let r = [
            salvageTruncatedArray('[{"a":1},{"b":2},{"c":'), //尾元素半途截斷
            salvageTruncatedArray('[{"a":1},{"b":2}'), //恰於元素邊界截斷
            salvageTruncatedArray('前導說明```json\n[{"a":1},{"b":{"c":2}},{"d"'), //含前導文字與巢狀物件
        ]
        let rr = [
            [{ a: 1 }, { b: 2 }],
            [{ a: 1 }, { b: 2 }],
            [{ a: 1 }, { b: { c: 2 } }],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('字串與跳脫感知: 元素內含括號與跳脫引號不干擾配對', function() {
        let r = salvageTruncatedArray('[{"a":"x]}","b":"y\\"z"},{"c":')
        let rr = [{ a: 'x]}', b: 'y"z' }]
        assert.strict.deepEqual(r, rr)
    })

    it('有正常閉合(非截斷)、無陣列、或救不回任何完整元素, 一律回null不硬救', function() {
        let r = [
            salvageTruncatedArray('[{"a":1}]'), //有閉合＝非截斷
            salvageTruncatedArray('純文字回覆'), //無[
            salvageTruncatedArray('[{"a":'), //首元素即截斷, 無完整元素
            salvageTruncatedArray(''),
            salvageTruncatedArray(null),
        ]
        let rr = [null, null, null, null, null]
        assert.strict.deepEqual(r, rr)
    })

})
