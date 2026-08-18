import assert from 'assert'
import budgetFor from '../src/budgetFor.mjs'
import dfTimeoutMs from '../src/dfTimeoutMs.mjs'


describe('budgetFor', function() {

    it('遞補鏈時間預算為各條目timeoutMs之總和', function() {
        let r = budgetFor([{ timeoutMs: 180000 }, { timeoutMs: 240000 }])
        let rr = 420000
        assert.strict.deepEqual(r, rr)
    })

    it('未帶或無效timeoutMs之條目以套件統一預設計(與執行時實際取值一致)', function() {
        let r = budgetFor([{ timeoutMs: 180000 }, {}, { timeoutMs: 'abc' }, { timeoutMs: -1 }])
        let rr = 180000 + dfTimeoutMs * 3
        assert.strict.deepEqual(r, rr)
    })

    it('輸入非陣列回傳0', function() {
        let r = [budgetFor(null), budgetFor(undefined), budgetFor('abc'), budgetFor({})]
        let rr = [0, 0, 0, 0]
        assert.strict.deepEqual(r, rr)
    })

})
