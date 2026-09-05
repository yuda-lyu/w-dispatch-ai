import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import readJsonOrNull from '../src/quota/readJsonOrNull.mjs'


//產物落test/tmp/(同fakeCliForTest慣例), 測試結束清除
let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp', 'read-json-or-null')


describe('readJsonOrNull', function() {

    before(function() {
        fs.mkdirSync(FD, { recursive: true })
    })

    after(function() {
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch (e) {}
    })

    it('合法JSON回解析值(物件或陣列皆可)', function() {
        let fp1 = path.join(FD, 'a.json')
        let fp2 = path.join(FD, 'b.json')
        fs.writeFileSync(fp1, '{"a":1,"b":{"c":[1,2]}}', 'utf8')
        fs.writeFileSync(fp2, '[1,2,3]', 'utf8')
        let r = [readJsonOrNull(fp1), readJsonOrNull(fp2)]
        let rr = [{ a: 1, b: { c: [1, 2] } }, [1, 2, 3]]
        assert.strict.deepEqual(r, rr)
    })

    it('檔案不存在、內容非JSON、路徑無效皆回null不throw(三種情形對呼叫端皆為「取不到」)', function() {
        let fp = path.join(FD, 'broken.json')
        fs.writeFileSync(fp, '{ not json', 'utf8')
        let r = [readJsonOrNull(path.join(FD, 'nope.json')), readJsonOrNull(fp), readJsonOrNull(''), readJsonOrNull(null)]
        let rr = [null, null, null, null]
        assert.strict.deepEqual(r, rr)
    })

})
