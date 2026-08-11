import assert from 'assert'
import extractJsonLoose from '../src/wkf/extractJsonLoose.mjs'


describe('extractJsonLoose', function() {

    it('整段即為合法JSON時直接解析', function() {
        let r = [
            extractJsonLoose('{"a":1}'),
            extractJsonLoose('[1,2,3]'),
            extractJsonLoose('  {"a":{"b":[1]}}  '),
        ]
        let rr = [{ a: 1 }, [1, 2, 3], { a: { b: [1] } }]
        assert.strict.deepEqual(r, rr)
    })

    it('去除code fence與前後說明文字後抽取第一個完整物件', function() {
        let r = [
            extractJsonLoose('說明文字\n```json\n{"a":1}\n```\n後記'),
            extractJsonLoose('```\n{"a":1}\n```'),
            extractJsonLoose('前綴 {"a":1} 後綴 {"b":2}'),
        ]
        let rr = [{ a: 1 }, { a: 1 }, { a: 1 }]
        assert.strict.deepEqual(r, rr)
    })

    it('去除ANSI色碼', function() {
        let esc = String.fromCharCode(27)
        let r = extractJsonLoose(`${esc}[0m{"a":1}${esc}[91m`)
        let rr = { a: 1 }
        assert.strict.deepEqual(r, rr)
    })

    it('字串值內之括號與跳脫不干擾配對', function() {
        let r = extractJsonLoose('{"a":"x{y}[z]","b":"q\\"w"}')
        let rr = { a: 'x{y}[z]', b: 'q"w' }
        assert.strict.deepEqual(r, rr)
    })

    it('截斷(括號未閉合)回傳null', function() {
        let r = [
            extractJsonLoose('{"a":1'),
            extractJsonLoose('[1,2'),
            extractJsonLoose('{"a":"未閉合字串'),
        ]
        let rr = [null, null, null]
        assert.strict.deepEqual(r, rr)
    })

    it('非物件與陣列之JSON回傳null', function() {
        let r = [
            extractJsonLoose('"hello"'),
            extractJsonLoose('123'),
            extractJsonLoose('true'),
            extractJsonLoose('null'),
        ]
        let rr = [null, null, null, null]
        assert.strict.deepEqual(r, rr)
    })

    it('無JSON內容回傳null', function() {
        let r = [
            extractJsonLoose('純文字回覆'),
            extractJsonLoose(''),
            extractJsonLoose(null),
            extractJsonLoose(undefined),
        ]
        let rr = [null, null, null, null]
        assert.strict.deepEqual(r, rr)
    })

    it('第一個片段非法時回傳null(不繼續嘗試後續片段)', function() {
        let r = extractJsonLoose('{"a":1,} {"b":2}')
        let rr = null
        assert.strict.deepEqual(r, rr)
    })

})
