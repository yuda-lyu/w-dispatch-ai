import assert from 'assert'
import parseJsonArray from '../src/wkf/parseJsonArray.mjs'
import extractJsonLoose from '../src/wkf/extractJsonLoose.mjs'
import salvageTruncatedArray from '../src/wkf/salvageTruncatedArray.mjs'


// unit-parseJsonArray.test.mjs — 嚴格版JSON陣列解析(2026-11-01 da40, Gitea #40; 帳本R-PARSE-1)
//
// 規格來源: 建議檔§4: parseJsonArray(stdout)為extractJsonLoose之結果非陣列即null; 取第一個完整片段,
//   括號未閉合即回null, 不搶救半成品(與salvageTruncatedArray語意相反、刻意並存)。


describe('parseJsonArray', function() {

    // 規格句: extractJsonLoose之結果為陣列即回之
    it('完整JSON陣列: 原樣、code fence與前後說明文字、ANSI色碼皆可取出', function() {
        let esc = String.fromCharCode(27)
        let cases = [
            ['[{"index":1,"t":"a"}]', [{ index: 1, t: 'a' }]],
            ['說明文字\n```json\n[{"index":1},{"index":2}]\n```\n後記', [{ index: 1 }, { index: 2 }]],
            [`${esc}[32m[1,2,3]${esc}[0m`, [1, 2, 3]],
            ['[]', []],
        ]
        for (let [input, expected] of cases) {
            assert.strict.deepEqual(parseJsonArray(input), expected)
        }
    })

    // 規格句: 結果非陣列即null
    it('物件、純量、純文字一律回null', function() {
        for (let input of ['{"index":1}', '"str"', '123', 'true', 'null', '純文字回覆', '', '   ']) {
            assert.strict.equal(parseJsonArray(input), null)
        }
    })

    // 規格句: 取第一個完整片段(第一個片段是物件即回null, 不往後找陣列)
    it('取第一個完整片段: 外層為物件者回null(即使內含陣列)；多個陣列取第一個', function() {
        assert.strict.equal(parseJsonArray('{"items":[1,2]}'), null)
        assert.strict.deepEqual(parseJsonArray('先 [1] 再 [2]'), [1])
    })

    // 規格句: 括號未閉合(截斷)即回null, 不搶救半成品
    it('截斷(括號未閉合)回null，不搶救前段', function() {
        let truncated = '[{"index":1,"t":"a"},{"index":2,"t":"b"},{"index":3,"t'
        assert.strict.equal(parseJsonArray(truncated), null)
        //與搶救版語意相反: salvageTruncatedArray可救回前兩項, 嚴格版一項都不收
        assert.strict.equal(salvageTruncatedArray(truncated).length, 2)
    })

    it('與extractJsonLoose一致: 陣列結果同一份解析，非陣列結果一律null', function() {
        for (let input of ['[1,2]', '{"a":1}', '[1,', 'abc [3] def', '```json\n[{"a":1}]\n```']) {
            let j = extractJsonLoose(input)
            assert.strict.deepEqual(parseJsonArray(input), Array.isArray(j) ? j : null)
        }
    })

    it('輸入非字串不throw: null、undefined、數字、物件視為無可解析內容', function() {
        for (let input of [null, undefined, 5, {}, [], true]) {
            assert.strict.doesNotThrow(() => parseJsonArray(input))
        }
        assert.strict.equal(parseJsonArray(null), null)
        assert.strict.equal(parseJsonArray(undefined), null)
    })

})
