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

    it('oc:opencode/*條目之順序: 下架三條(2026-10-30)與glm-5.3-flash-free(2026-11-18)移除、flint置於deepseek之後(原glm之後)與nemotron兩條之前, 其餘相對順序不變', function() {
        let r = providers.filter((p) => p.id.startsWith('oc:opencode/')).map((p) => p.id)
        let rr = [
            'oc:opencode/big-pickle',
            'oc:opencode/mimo-v2.6-flash-free',
            'oc:opencode/beam-free',
            'oc:opencode/deepseek-v4.1-flash-free',
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
        //2026-11-21 dl583移除oc:poolside/poolside/laguna-s-2.1與poolside:laguna-s-2.1(POST /chat/completions一律HTTP 400 deactivated, 見unit-providersPoolsideRemoved)而為35(其餘條目零增刪)
        assert.strict.deepEqual(r, [false, false, 35])
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

    it('oc:opencode/*恰7條(下架前8條), 依序為當日`opencode models opencode --refresh`清單內仍在之7個(其餘條目零增刪)', function() {
        let ocs = providers.filter((p) => p.id.startsWith('oc:opencode/')).map((p) => p.model)
        assert.strict.deepEqual(ocs, [
            'opencode/big-pickle',
            'opencode/mimo-v2.6-flash-free',
            'opencode/beam-free',
            'opencode/deepseek-v4.1-flash-free',
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
