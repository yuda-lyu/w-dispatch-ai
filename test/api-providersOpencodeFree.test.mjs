import assert from 'assert'
import filterOpencodeFree from '../src/filterOpencodeFree.mjs'
import providers from '../src/providers.mjs'


// api-providersOpencodeFree.test.mjs — 目錄之opencode免費條目 ⊆ 當日`opencode models`之連網守門(2026-10-30 run01; 帳本R-OCFREE-1)
//
// 【本檔需要本機有opencode CLI並連網】以真實`opencode models --refresh`(自models.dev更新opencode之本機快取; 不呼叫任何模型、不耗免費額度)取當日清單。
//   與純單元案(test/unit-filterOpencodeFree.test.mjs、test/unit-providersOpencodeFreeEntries.test.mjs)分開:
//   本檔之結果隨上游當日狀態而變, 屬「漂移守門」——紅燈意謂目錄收了已不被opencode供應之免費id, 須依providers.mjs檔頭先例
//   (已自CLI清單消失且依條目呼叫約2s即回UnknownError兩條件同時滿足)下架並記於檔頭; 不是程式缺陷。
//
// 【環境不足時略過(pending)而非通過】opencode不存在、查詢失敗(離線等)、空輸出: 於before以this.skip()略過並印出原因,
//   不得把「查不到」當成「守門通過」(filterOpencodeFree對查詢失敗回ok:false而非空清單, 見其檔頭)。
//
// 規格來源: 建議檔〈驗證建議〉3「修後: 目錄之免費條目(id或model含free, 另加big-pickle)之model集合 ⊆ opencode models之輸出」。


describe('providers與當日opencode models之對照(連網守門; 需opencode CLI)', function() {

    this.timeout(120000)

    let r = null

    before(async function() {
        r = await filterOpencodeFree(providers, { refresh: true, timeoutMs: 90000 })
        if (!r.ok) {
            console.log(`[略過] filterOpencodeFree查詢失敗: errorType=${r.errorType}; ${r.error}`)
            this.skip()
        }
    })

    it('目錄之opencode免費條目(id或model含free, 另加big-pickle)之model集合 ⊆ opencode models之輸出(removed須為空)', function() {
        let msg = `目錄收了不在當日opencode models之免費條目(須下架並記於providers.mjs檔頭): ${r.removed.map((p) => p.model).join(', ')}`
        assert.strict.deepEqual(r.removed.map((p) => p.model), [], msg)
    })

    it('守門確有比對對象: 目錄至少有1個免費opencode條目在清單內(防止比對範圍被悄悄縮成空集合而空過)', function() {
        assert.strict.deepEqual(r.available.length > 0, true)
    })

})
