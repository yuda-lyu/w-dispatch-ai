import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'


// unit-providersOpencodeFreeEntries.test.mjs — 內建providers之opencode免費條目增刪(2026-10-30 run01; 帳本R-OCFREE-2)
//
// 規格來源: 建議檔(Gitea issue #25)〈1〉與主控裁定1、2:
//   裁定1 三條opencode免費條目(minimax-m3.1-flash-free、longcat-2.5-preview-free、nemotron-3-ultra-free)當日重查屬實(不在`opencode models`、
//         依條目呼叫約1.5s回UnknownError, 兩條件同時滿足)→ 自目錄下架, 記於providers.mjs檔頭;
//   裁定2 flint-40b-free依條目慣例實測後收錄(匿名、唯讀鎖、有high檔位故帶--variant high)。
// 全部不連網、不呼叫任何AI模型。「目錄 ⊆ 當日opencode models」之連網守門在 test/api-providersOpencodeFree.test.mjs。


let REMOVED = [
    'oc:opencode/minimax-m3.1-flash-free',
    'oc:opencode/longcat-2.5-preview-free',
    'oc:opencode/nemotron-3-ultra-free',
]


describe('providers之opencode免費條目增刪(2026-10-30)', function() {

    it('已下架之三條不在目錄(以id與model兩種鍵皆查無)', function() {
        let r = [
            REMOVED.map((id) => providers.some((p) => p.id === id)),
            REMOVED.map((id) => providers.some((p) => p.model === id.replace(/^oc:/, ''))),
        ]
        assert.strict.deepEqual(r, [[false, false, false], [false, false, false]])
    })

    it('以下架之id做pick者落入missing(不靜默忽略), 且不進providers', function() {
        let r = resolveProviders(providers, { env: {}, pick: [...REMOVED, 'oc:opencode/beam-free'] })
        assert.strict.deepEqual([r.missing, r.providers.map((p) => p.id)], [REMOVED, ['oc:opencode/beam-free']])
    })

    it('flint-40b-free條目: 欄位比照其餘oc:opencode免費條目(匿名useStoredAuth:false、無envVar、唯讀鎖edit:deny＋bash:ask、有high檔位故帶--variant high)', function() {
        let p = providers.find((x) => x.id === 'oc:opencode/flint-40b-free')
        assert.strict.deepEqual(
            p,
            {
                id: 'oc:opencode/flint-40b-free',
                model: 'opencode/flint-40b-free',
                kind: 'opencode',
                provider: 'opencode',
                useStoredAuth: false,
                config: { permission: { edit: 'deny', bash: 'ask' } },
                extraArgs: ['--variant', 'high'],
                outputTokenMax: 32000, //2026-11-04 da78: context 262144級維持CLI原預設輸出上限以保輸入餘裕(見outputTokenMax.mjs檔頭)
            },
        )
    })

    it('oc:opencode/*條目之順序: 下架三條(2026-10-30)與glm-5.3-flash-free(2026-11-18)移除、flint置於deepseek之後(原glm之後)與nemotron兩條之前, 2026-11-24新增之hy4-flash-free置於deepseek之後、flint之前, 其餘相對順序不變', function() {
        let r = providers.filter((p) => p.id.startsWith('oc:opencode/')).map((p) => p.id)
        let rr = [
            'oc:opencode/big-pickle',
            'oc:opencode/mimo-v2.6-flash-free',
            'oc:opencode/beam-free',
            'oc:opencode/deepseek-v4.1-flash-free',
            'oc:opencode/hy4-flash-free',
            'oc:opencode/flint-40b-free',
            'oc:opencode/nemotron-3.5-lightning-free',
            'oc:opencode/nemotron-3.5-super-vl-free',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('oc:opencode/*條目連續相鄰(不被他家條目隔開, 全取遞補時免費條目成一組)', function() {
        let idx = providers.map((p, i) => (p.id.startsWith('oc:opencode/') ? i : -1)).filter((i) => i >= 0)
        assert.strict.deepEqual(idx[idx.length - 1] - idx[0] + 1, idx.length)
    })

})


// 2026-11-03 da63(Gitea #63): 兩項依帳本R-OCFREE-2之裁定(皆為「不改目錄」, 以測試固定其依據)
describe('providers之opencode免費條目裁定(2026-11-03)', function() {

    it('nemotron-3.5-super-vl-free 保留(不下架): 當日重查「CLI清單(--refresh)仍列」故不滿足R-OCFREE-2①之清單消失條件; 條目欄位不變', function() {
        let p = providers.find((x) => x.id === 'oc:opencode/nemotron-3.5-super-vl-free')
        let r = [
            p ? p.model : null,
            p ? p.useStoredAuth : null,
            p ? p.config.permission : null,
            p ? p.extraArgs : null,
        ]
        let rr = ['opencode/nemotron-3.5-super-vl-free', false, { edit: 'deny', bash: 'ask' }, ['--variant', 'high']]
        assert.strict.deepEqual(r, rr)
    })

    it('pulse-alpha-free 不在目錄: 收錄須R-OCFREE-2②各項實測皆完成, 2026-11-03免費額度用盡(Free usage limit)致簡答亦未完成, 不得收錄(列待辦); 完成實測後收錄時連同本案一併改為欄位斷言', function() {
        let r = [
            providers.some((p) => p.id === 'oc:opencode/pulse-alpha-free'),
            providers.some((p) => p.model === 'opencode/pulse-alpha-free' || p.model === 'pulse-alpha-free'),
            providers.length,
        ]
        //條目數: 2026-11-03 da63時為29; 同日da65(Gitea #65)新增8條CLI類Go條目(ocgo:, 見unit-providersOpencodeGoEntries)而為37;
        //2026-11-07 ke339(Gitea #92)曾再新增1條ocgo:免費期條目而為38; 2026-11-10 da405因上游下架移除而回到37(oc:／zen:條目始終零增刪);
        //2026-11-13 da-hy(Gitea #137)新增1條agy:gemini-4-hydrogen-high而為38(其餘條目零增刪);
        //2026-11-18 wda530下架oc:opencode/glm-5.3-flash-free(已自`opencode models`消失, 見下方describe)而為37(其餘條目零增刪);
        //2026-11-21 dl583移除oc:poolside/poolside/laguna-s-2.1與poolside:laguna-s-2.1(POST /chat/completions一律HTTP 400 deactivated, 見unit-providersPoolsideRemoved)而為35(其餘條目零增刪);
        //2026-11-24 tdai3(排程第341項)新增oc:opencode/hy4-flash-free(R-OCFREE-2②七項實測全過, 見下方describe)而為36(其餘條目零增刪)
        assert.strict.deepEqual(r, [false, false, 36])
    })

})


// 2026-11-18 wda530(主控任務20261118202733): oc:opencode/glm-5.3-flash-free已自`opencode models`消失(連網守門api-providersOpencodeFree紅燈),
// 依帳本R-OCFREE-2①(清單消失＋依條目呼叫數秒內回UnknownError)下架並記於providers.mjs檔頭。全部不連網。
// 下列各案之斷言即「須下架並記於providers.mjs檔頭」之可執行翻譯:
describe('providers之opencode免費條目下架: glm-5.3-flash-free(2026-11-18)', function() {

    let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    let read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
    let ID = 'oc:opencode/glm-5.3-flash-free'

    it('已下架之oc:opencode/glm-5.3-flash-free不在目錄(以id與model兩種鍵皆查無); 付費Go路徑之同名ocgo:opencode-go/glm-5.3-flash仍在(不同供應商, 不受影響)', function() {
        let go = providers.find((p) => p.id === 'ocgo:opencode-go/glm-5.3-flash')
        let r = [
            providers.some((p) => p.id === ID),
            providers.some((p) => p.model === 'opencode/glm-5.3-flash-free'),
            go ? [go.model, go.provider, go.envVar] : null,
        ]
        assert.strict.deepEqual(r, [false, false, ['opencode-go/glm-5.3-flash', 'opencode-go', 'OPENCODE_GO_KEYS']])
    })

    it('以下架之id做pick者落入missing(不靜默忽略)且不進providers; 以patch指名此id者靜默無作用(不拋錯、不新增條目)', function() {
        let r1 = resolveProviders(providers, { env: {}, pick: [ID, 'oc:opencode/beam-free'] })
        let r2 = resolveProviders(providers, { env: {}, patch: { [ID]: { timeoutMs: 1234 } } })
        let r3 = resolveProviders(providers, { env: {} })
        assert.strict.deepEqual(
            [r1.missing, r1.providers.map((p) => p.id), r2.providers.map((p) => p.id).includes(ID), r2.providers.length === r3.providers.length],
            [[ID], ['oc:opencode/beam-free'], false, true],
        )
    })

    it('oc:opencode/*於glm下架後為7條(下架前8條; 2026-11-24新增hy4-flash-free後為8條), 依序為`opencode models opencode --refresh`清單內仍在之7個加hy4(其餘條目零增刪)', function() {
        let ocs = providers.filter((p) => p.id.startsWith('oc:opencode/')).map((p) => p.model)
        assert.strict.deepEqual(ocs, [
            'opencode/big-pickle',
            'opencode/mimo-v2.6-flash-free',
            'opencode/beam-free',
            'opencode/deepseek-v4.1-flash-free',
            'opencode/hy4-flash-free',
            'opencode/flint-40b-free',
            'opencode/nemotron-3.5-lightning-free',
            'opencode/nemotron-3.5-super-vl-free',
        ])
    })

    it('providers.mjs: 條目區塊已移除(無id字面之物件), 檔頭有2026-11-18漂移紀錄(日期、清單消失之依據、依條目呼叫之失敗形狀、38 → 37、Go路徑不受影響)', function() {
        let s = read('src/providers.mjs')
        let r = [
            s.includes(`id: '${ID}'`),
            s.includes('//   2026-11-18之漂移(opencode 1.19.5; 主控任務20261118202733之wda530'),
            s.includes('移除oc:opencode/glm-5.3-flash-free') && s.includes('`opencode models opencode --refresh`列11個, 無此id'),
            s.includes('UnknownError「Unexpected server error」') && s.includes('兩條件同時滿足'),
            s.includes('內建providers 38 → 37條(oc:opencode/*由8 → 7條)'),
            s.includes('付費Go路徑之同名ocgo:opencode-go/glm-5.3-flash'),
        ]
        assert.strict.deepEqual(r, [false, true, true, true, true, true])
    })

    it('README: 行為變更第76條載明移除、依據、38 → 37、pick落入missing、patch無作用、Go路徑同名條目不受影響', function() {
        let t = read('README.md')
        let r = [
            t.includes('76. ①**移除內建條目 `oc:opencode/glm-5.3-flash-free`**'),
            t.includes('內建 providers 38 → 37 條（`oc:opencode/*` 由 8 → 7 條'),
            t.includes('`pick` 指名 `oc:opencode/glm-5.3-flash-free` 者，該 id 列入 `missing`'),
            t.includes('`patch` 指名此 id 者靜默無作用'),
            t.includes('`ocgo:opencode-go/glm-5.3-flash` 為不同供應商，不受影響'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true])
    })

})


// 2026-11-24 tdai3(主控任務20261124014253, 排程第341項): 以當日`opencode models opencode --refresh --verbose`(10個、單價皆0)重新盤點免費池——
//   新增oc:opencode/hy4-flash-free(R-OCFREE-2②七項實測全過); 不收tidepool-alpha-free與iceman-free(官方Privacy載明資料保留並用於改進模型,
//   依外部呼叫界線只對其送「回覆」類提示, ②之脈絡長度等項缺, 故不收); 目錄7個皆仍在清單、單價仍為0(無下架)。全部不連網、不呼叫任何AI模型。
// 下列斷言即上述裁定之可執行翻譯(規格: 帳本R-OCFREE-2②「各項實測全數完成才收」與⑥、任務書〈主控已定〉第1點「可能以資料訓練者若收須殿後並標隱私」)。
describe('providers之opencode免費條目收錄: hy4-flash-free(2026-11-24)', function() {

    let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    let read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
    let ID = 'oc:opencode/hy4-flash-free'
    let NOT_ADDED = ['oc:opencode/tidepool-alpha-free', 'oc:opencode/iceman-free']

    it('hy4-flash-free條目欄位: 匿名(useStoredAuth:false、無envVar)、唯讀鎖edit:deny＋bash:ask、目錄檔位為none/high故帶--variant high、不另設outputTokenMax(1M脈絡, 同beam)', function() {
        let p = providers.find((x) => x.id === ID)
        assert.strict.deepEqual(p, {
            id: ID,
            model: 'opencode/hy4-flash-free',
            kind: 'opencode',
            provider: 'opencode',
            useStoredAuth: false,
            config: { permission: { edit: 'deny', bash: 'ask' } },
            extraArgs: ['--variant', 'high'],
        })
    })

    it('排序: 置於deepseek-v4.1-flash-free之後、flint-40b-free之前(官方載明零保留且不訓練者在前); 全取時為連續相鄰之8條', function() {
        let ids = providers.map((p) => p.id)
        let i = ids.indexOf(ID)
        let r = [i > 0 ? ids[i - 1] : null, ids[i + 1], providers.filter((p) => p.id.startsWith('oc:opencode/')).length]
        assert.strict.deepEqual(r, ['oc:opencode/deepseek-v4.1-flash-free', 'oc:opencode/flint-40b-free', 8])
    })

    it('tidepool-alpha-free與iceman-free不在目錄(以id與model兩種鍵皆查無); 以其id做pick者落入missing(不靜默忽略); 內建條目共36條', function() {
        let r1 = NOT_ADDED.map((id) => providers.some((p) => p.id === id || p.model === id.replace(/^oc:/, '') || p.model === id.replace(/^oc:opencode\//, '')))
        let r2 = resolveProviders(providers, { env: {}, pick: [...NOT_ADDED, ID] })
        assert.strict.deepEqual([r1, r2.missing, r2.providers.map((p) => p.id), providers.length], [[false, false], NOT_ADDED, [ID], 36])
    })

    it('providers.mjs條目註解: 官方零保留與不訓練之原文、匿名CLI四項實測(簡答／推理題答對／read／寫檔金絲雀被擋)、REST 429與對照組、脈絡278235與950292答對(型錄上限之90.6%)、不覆寫limit、證據出處', function() {
        let s = read('src/providers.mjs')
        let a = s.indexOf('//hy4-flash-free(2026-11-24新增')
        let b = s.indexOf(`id: '${ID}'`)
        let blk = a >= 0 && b > a ? s.slice(a, b) : ''
        let r = [
            blk.includes('Its provider follows a zero-retention policy and does not use your data for model training'),
            blk.includes('release_date 2026-11-16') && blk.includes('context 1048576、輸出上限65536') && blk.includes('檔位none/high(故帶--variant high)'),
            blk.includes('簡答11.7s(回「完成」)、推理題8.8s答對(16)、read工具讀相對路徑24.2s正確(Glob＋Read)'),
            blk.includes('寫檔金絲雀21.0s被OC_READONLY擋下未落地') && /errorType 'denied'/.test(blk),
            blk.includes('回429 FreeUsageLimitError, 同時段已收錄之big-pickle對照組亦同'),
            blk.includes('伺服器回報總token 278235答對(20.4s)與950292答對(57.7s; 型錄上限之90.6%') && blk.includes('本條目不覆寫limit'),
            blk.includes('未二分逼近確切上限(不寫成已逼近)') && blk.includes('tdai3-修正報告.md'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true])
    })

    it('providers.mjs檔頭2026-11-24漂移紀錄: 清單10個與目錄7個皆在(removed為空)、未收三個(hy4已收、tidepool／iceman不收)、官方Privacy原文、缺項理由、日後收錄須殿後並標隱私', function() {
        let s = read('src/providers.mjs')
        let a = s.indexOf('//   2026-11-24之漂移(opencode 1.19.5; 主控任務20261124014253之tdai3')
        let blk = a >= 0 ? s.slice(a, a + 3000) : ''
        let r = [
            blk.includes('列10個、cost皆0') && blk.includes('removed為空'),
            blk.includes('hy4-flash-free(release 2026-11-16)') && blk.includes('iceman-free(2026-11-06)') && blk.includes('tidepool-alpha-free(2026-11-18)'),
            blk.includes('inkling-2-small-free與longcat-2.5-free本輪CLI清單已不列'),
            blk.includes('新增oc:opencode/hy4-flash-free(七項全過'),
            blk.includes('During its free period, collected data is retained and used to improve the model'),
            blk.includes('「脈絡長度」缺項故不收') && blk.includes('推理題、read、寫檔金絲雀、脈絡長度皆缺故不收'),
            blk.includes('須殿後排序(置於nemotron兩條之後)並於條目註解標隱私'),
            blk.includes('deepseek-v4.1-flash-free之CLI目錄release_date現為2026-10-17'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true, true])
    })

    it('README行為變更第89條: 載明新增hy4-flash-free與盤點數字(清單10個、目錄7個仍在)、七項實測摘要、不收tidepool／iceman之依據(Privacy:資料保留並用於改進模型)與殿後標隱私條件、35 → 36、pick落入missing', function() {
        let t = read('README.md')
        let r = [
            t.includes('89. ①**新增內建條目 `oc:opencode/hy4-flash-free`**'),
            t.includes('清單列 10 個免費模型（單價皆 0），目錄原有之 7 個 `oc:opencode/*` 皆仍在清單、單價仍為 0（無下架）'),
            t.includes('匿名 CLI 簡答 11.7s、推理題 8.8s 答對、read 工具 24.2s 正確、寫檔金絲雀 21.0s 被唯讀鎖擋下未落地'),
            t.includes('針在乾草堆 278235 與 950292 token（型錄上限之 90.6%）皆答對'),
            t.includes('**不收 `tidepool-alpha-free` 與 `iceman-free`**：官方〈Privacy〉載明二者「資料保留並用於改進模型」'),
            t.includes('日後若收須殿後（置於 nemotron 兩條之後）並於條目註解標隱私'),
            t.includes('內建 providers 35 → 36 條（`oc:opencode/*` 7 → 8 條'),
            t.includes('`pick` 指名未收之 `oc:opencode/tidepool-alpha-free`、`oc:opencode/iceman-free` 者落入 `missing`'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true, true])
    })

})
