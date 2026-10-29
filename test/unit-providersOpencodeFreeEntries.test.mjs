import assert from 'assert'
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
            },
        )
    })

    it('oc:opencode/*條目之順序: 下架三條移除、flint置於glm之後與nemotron兩條之前, 其餘相對順序不變', function() {
        let r = providers.filter((p) => p.id.startsWith('oc:opencode/')).map((p) => p.id)
        let rr = [
            'oc:opencode/big-pickle',
            'oc:opencode/mimo-v2.6-flash-free',
            'oc:opencode/beam-free',
            'oc:opencode/deepseek-v4.1-flash-free',
            'oc:opencode/glm-5.3-flash-free',
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
