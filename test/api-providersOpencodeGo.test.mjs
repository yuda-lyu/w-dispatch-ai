import assert from 'assert'
import providers from '../src/providers.mjs'


// api-providersOpencodeGo.test.mjs — 目錄之OpenCode Go條目 ⊆ 官方Go型錄 之連網守門(2026-11-03 da65, Gitea #65; 帳本R-OCGO-1⑥)
//
// 【本檔需要連網】只GET https://opencode.ai/inference/go/v1/models (官方Go頁〈Models〉節所載之公開清單, 匿名可查; 不帶金鑰、不呼叫任何模型、不耗額度)。
//   與純單元案(test/unit-providersOpencodeGoEntries.test.mjs)分開: 本檔結果隨官方當日狀態而變, 屬「漂移守門」——
//   紅燈意謂目錄收了已不在Go型錄之model(下架或改名), 須依帳本R-OCGO-1重查後自目錄移除, 不是程式缺陷。
//
// 【環境不足時略過(pending)而非通過】離線、HTTP非200、本文非預期格式、清單為空: 於before以this.skip()略過並印出原因。
//   「清單可讀且非空、卻查無條目之model」不是環境不足, 一律紅燈。
//
// 【此清單只證明「Go型錄有列」】不證明該模型此刻可呼叫(需金鑰與訂閱); 可用性以帶金鑰之實呼為準(帳本R-OCGO-1之實測項)。


describe('providers之Go條目與官方Go型錄之對照(連網守門)', function() {

    this.timeout(60000)

    let ids = []

    before(async function() {
        let res = null
        try {
            res = await fetch('https://opencode.ai/inference/go/v1/models', { signal: AbortSignal.timeout(45000) })
        }
        catch (err) {
            console.log(`[略過] 取官方Go型錄失敗: ${String(err && err.message)}`)
            this.skip()
        }
        if (res.status !== 200) {
            console.log(`[略過] 官方Go型錄 HTTP ${res.status}`)
            this.skip()
        }
        let j = null
        try {
            j = await res.json()
        }
        catch (err) {
            console.log(`[略過] 官方Go型錄本文非JSON: ${String(err && err.message)}`)
            this.skip()
        }
        ids = Array.isArray(j && j.data) ? j.data.map((m) => m && m.id).filter((x) => typeof x === 'string' && x !== '') : []
        if (ids.length === 0) {
            console.log('[略過] 官方Go型錄清單為空(非預期格式), 不得當成守門通過')
            this.skip()
        }
    })

    it('目錄所有ocgo:條目之model(去掉opencode-go/前綴)皆在官方Go型錄內(缺 → 紅燈)', function() {
        let es = providers.filter((p) => p.id.startsWith('ocgo:'))
        let missing = es.filter((p) => !ids.includes(p.model.replace(/^opencode-go\//, ''))).map((p) => p.id)
        assert.strict.deepEqual([es.length > 0, missing], [true, []])
    })

    it('比對對象非空: 官方Go型錄至少列出目錄Go條目數以上之模型', function() {
        let n = providers.filter((p) => p.id.startsWith('ocgo:')).length
        assert.strict.deepEqual(ids.length >= n, true)
    })

})
