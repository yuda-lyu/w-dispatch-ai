import assert from 'assert'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import { castOutputTokenMax } from '../src/outputTokenMax.mjs'


// unit-providersOutputCap.test.mjs — 目錄內條目之outputTokenMax／detectTruncation欄位守門(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 對應規格句(src/outputTokenMax.mjs檔頭【調高之代價】、providers.mjs檔頭【輸出上限與截斷診斷】):
//   P1 outputTokenMax只出現在kind opencode條目, 且為有效正整數
//   P2 context 262144級且型錄輸出上限逾32000之三條(flint-40b-free、nemotron-3.5-lightning-free、iceman-contributor-free)明給32000維持原輸入餘裕; 其餘條目不帶(用套件預設)
//   P3 detectTruncation只出現在kind opencode條目, 且只有ocgo:條目為true(oc:條目行為不變)
//   P4 條目欄位經resolveProviders展開後原樣保留(可用patch覆寫)


let PINNED = ['oc:opencode/flint-40b-free', 'oc:opencode/nemotron-3.5-lightning-free', 'ocgo:opencode-go/iceman-contributor-free']


describe('providers目錄之輸出上限與截斷偵測欄位', function() {

    it('P1: outputTokenMax只出現在kind opencode條目且為有效正整數', function() {
        let withCap = providers.filter((p) => 'outputTokenMax' in p)
        let r = [withCap.every((p) => p.kind === 'opencode'), withCap.every((p) => castOutputTokenMax(p.outputTokenMax) !== null)]
        assert.strict.deepEqual(r, [true, true])
    })

    it('P2: outputTokenMax: 32000恰為context 262144級之三條, 其餘條目不帶', function() {
        let withCap = providers.filter((p) => 'outputTokenMax' in p).map((p) => [p.id, p.outputTokenMax])
        assert.strict.deepEqual(withCap, PINNED.map((id) => [id, 32000]).sort((a, b) => providers.findIndex((p) => p.id === a[0]) - providers.findIndex((p) => p.id === b[0])))
    })

    it('P3: detectTruncation只出現在kind opencode條目, 且恰為8條ocgo:條目(true); oc:與其他kind不帶', function() {
        let withDt = providers.filter((p) => 'detectTruncation' in p)
        let r = [withDt.every((p) => p.kind === 'opencode'), withDt.map((p) => p.id.startsWith('ocgo:')), withDt.every((p) => p.detectTruncation === true), withDt.length]
        assert.strict.deepEqual(r, [true, withDt.map(() => true), true, 8])
    })

    it('P4: 經resolveProviders展開後欄位保留, patch可覆寫outputTokenMax', function() {
        let r = resolveProviders(providers, {
            env: { OPENCODE_GO_KEYS: 'oc_sk_aaa111' },
            pick: ['ocgo:opencode-go/iceman-contributor-free', 'ocgo:opencode-go/glm-5.3-flash'],
            patch: { 'ocgo:opencode-go/iceman-contributor-free': { outputTokenMax: 100000 } },
        })
        let got = Object.fromEntries(r.providers.map((p) => [p.id, [p.outputTokenMax, p.detectTruncation]]))
        assert.strict.deepEqual(got, { 'ocgo:opencode-go/iceman-contributor-free': [100000, true], 'ocgo:opencode-go/glm-5.3-flash': [undefined, true] })
    })

})
