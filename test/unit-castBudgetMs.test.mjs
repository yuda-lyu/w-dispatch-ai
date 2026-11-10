import assert from 'assert'
import castBudgetMs from '../src/castBudgetMs.mjs'


// unit-castBudgetMs — 執行期剩餘時間(budgetMs)之正規化
// (2026-11-11 di402; 主控裁示D11甲; 設計 da402-審計報告 表T3、§4.2 DA-7、§5.2〈DA〉DA-7)


describe('castBudgetMs(表T3各值, 主控裁示D11甲)', function() {

    it('有限正數照用、小數向下取整(收嚴)、數字字串依dspec§3.1收(K7)', function() {
        let r = [castBudgetMs(1500), castBudgetMs(1200.5), castBudgetMs('1500'), castBudgetMs(' 1500 '), castBudgetMs('1e3'), castBudgetMs('1200.9'), castBudgetMs(1)]
        assert.strict.deepEqual(r, [1500, 1200, 1500, 1500, 1000, 1200, 1])
    })

    it('≤0與0～1毫秒 → 0(已無時間); -Infinity → 0', function() {
        let r = [castBudgetMs(0), castBudgetMs(-0), castBudgetMs(-100), castBudgetMs(0.5), castBudgetMs('0'), castBudgetMs('-5'), castBudgetMs(-Infinity)]
        assert.strict.deepEqual(r, [0, 0, 0, 0, 0, 0, 0])
    })

    it('+Infinity、未給、null、NaN、非十進位字串、物件、布林 → null(不限); 超出安全整數 → null', function() {
        let r = [castBudgetMs(Infinity), castBudgetMs(undefined), castBudgetMs(null), castBudgetMs(NaN), castBudgetMs('abc'), castBudgetMs('Infinity'), castBudgetMs('0x10'), castBudgetMs('1,500'), castBudgetMs(''), castBudgetMs({}), castBudgetMs(true), castBudgetMs(1e300)]
        assert.strict.deepEqual(r, [null, null, null, null, null, null, null, null, null, null, null, null])
    })

})
