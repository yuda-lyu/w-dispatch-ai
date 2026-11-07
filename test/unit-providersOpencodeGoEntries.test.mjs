import assert from 'assert'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import resolveCatalogue from '../src/resolveCatalogue.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-providersOpencodeGoEntries.test.mjs — 內建providers之OpenCode Go條目(CLI類; Gitea #65, 2026-11-03 da65; 帳本 sgud/rule/rulebook_opencodego.md R-OCGO-1)
//
// 規格來源(任務書〈要做的事〉2與〈必要之測試〉第二項):
//   G1 目錄新增CLI類Go條目: kind 'opencode'、provider 'opencode-go'(金鑰注入之provider鍵, 須與model前綴同名);
//   G2 id前綴 `ocgo:`、金鑰變數 `OPENCODE_GO_KEYS`(不沿用OPENCODE_KEYS: Go訂閱綁工作區, 本機實測同一份OPENCODE_KEYS內第1把Go用量端點200、第2把403);
//   G3 條目經resolveProviders以金鑰變數展開keys、移除envVar; 缺變數列入skipped不拋;
//   G4 檔位逐條依型錄核對(下列VARIANTS為2026-11-03以Go金鑰注入後`opencode models opencode-go --verbose`〔opencode 1.19.5〕之實查);
//   G5 REST類Go條目不收(Go基底必帶x-opencode-session, 見providers.mjs檔頭【OpenCode Go】段);
//   G6 既有條目與修前差異為0(除條數外): 以一次性比對腳本核對〔見報告〕, 不以指紋測試固定;
//   G7 條目防寫: 與其餘oc:條目同用OC_READONLY(edit:deny＋bash:ask), 不deny bash。
// 全部不連網、不呼叫任何AI模型(整合案以假opencode執行檔)。「條目 ⊆ 官方Go型錄」之連網守門在 test/api-providersOpencodeGo.test.mjs。


//2026-11-03 Go型錄(opencode 1.19.5 CLI)各模型之檔位; 空陣列代表無檔位
//(crouton-alpha-free為2026-11-07 Gitea #92新增, 檔位取自同日`opencode models opencode-go --refresh --verbose`之CLI型錄)
let VARIANTS = {
    'beam-free': ['low', 'medium', 'high', 'xhigh', 'max'],
    'crouton-alpha-free': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    'deepseek-v4.1-flash': ['low', 'high', 'max'],
    'minimax-m3.1-flash': ['low', 'medium', 'high', 'xhigh', 'max'],
    'qwen3.8-flash': ['low', 'medium', 'xhigh'],
    'glm-5.3-flash': ['low', 'high', 'max'],
    'mimo-v2.6-flash': [],
    'iceman-contributor-free': [],
    'muse-spark-1.3-contributor': ['minimal', 'low', 'medium', 'high', 'xhigh'],
}

//條目順序(不以請求資料訓練者在前, 會訓練者〔須使用者於工作區隱私設定明開〕殿後)
let GO_IDS = [
    'ocgo:opencode-go/beam-free',
    'ocgo:opencode-go/crouton-alpha-free',
    'ocgo:opencode-go/deepseek-v4.1-flash',
    'ocgo:opencode-go/minimax-m3.1-flash',
    'ocgo:opencode-go/qwen3.8-flash',
    'ocgo:opencode-go/glm-5.3-flash',
    'ocgo:opencode-go/mimo-v2.6-flash',
    'ocgo:opencode-go/iceman-contributor-free',
    'ocgo:opencode-go/muse-spark-1.3-contributor',
]

let goEntries = providers.filter((p) => p.id.startsWith('ocgo:'))


describe('providers之OpenCode Go條目(CLI類)', function() {

    describe('欄位(G1、G2、G7)', function() {

        it('恰有9條, 順序固定(不訓練者在前、iceman與muse殿後; 2026-11-07起crouton-alpha-free緊接beam-free之後)', function() {
            assert.strict.deepEqual(goEntries.map((p) => p.id), GO_IDS)
        })

        it('每條: kind=opencode、provider=opencode-go、model為id去掉ocgo:前綴且以opencode-go/開頭(provider與model配對)', function() {
            let r = goEntries.map((p) => [p.kind, p.provider, p.model === p.id.replace(/^ocgo:/, ''), p.model.startsWith(`${p.provider}/`)])
            assert.strict.deepEqual([goEntries.length, r], [9, GO_IDS.map(() => ['opencode', 'opencode-go', true, true])])
        })

        it('每條envVar為OPENCODE_GO_KEYS(不沿用OPENCODE_KEYS)', function() {
            assert.strict.deepEqual([goEntries.length, goEntries.map((p) => p.envVar)], [9, GO_IDS.map(() => 'OPENCODE_GO_KEYS')])
        })

        it('每條防寫同其餘oc:條目: permission為{edit:deny, bash:ask}, 不deny bash; 不匿名(無useStoredAuth:false, Go須金鑰)', function() {
            let r = goEntries.map((p) => [p.config.permission, p.useStoredAuth])
            assert.strict.deepEqual([goEntries.length, r], [9, GO_IDS.map(() => [{ edit: 'deny', bash: 'ask' }, undefined])])
        })

        it('每條只含預期欄位(id/model/kind/provider/envVar/detectTruncation/config/extraArgs; iceman另有outputTokenMax), config只有permission', function() {
            let r = goEntries.map((p) => [Object.keys(p).sort(), Object.keys(p.config)])
            let base = ['config', 'detectTruncation', 'envVar', 'id', 'kind', 'model', 'provider']
            let rr = goEntries.map((p) => {
                let ks = VARIANTS[p.model.replace('opencode-go/', '')].length > 0 ? [...base, 'extraArgs'] : [...base]
                if (p.id === 'ocgo:opencode-go/iceman-contributor-free') {
                    ks.push('outputTokenMax') //2026-11-04 da78: context 262144級維持CLI原預設以保輸入餘裕
                }
                return [ks.sort(), ['permission']]
            })
            assert.strict.deepEqual([goEntries.length, r], [9, rr])
            assert.strict.deepEqual(goEntries.filter((p) => 'outputTokenMax' in p).map((p) => [p.id, p.outputTokenMax]), [['ocgo:opencode-go/iceman-contributor-free', 32000]])
        })

        it('每條detectTruncation為true(2026-11-04 da78, Gitea #78: Go推理模型長提示詞被輸出上限截斷時須回報incomplete而非靜默成功; 帳本R-OCGO-4); 非Go之opencode條目不帶(行為不變)', function() {
            let others = providers.filter((p) => p.kind === 'opencode' && !p.id.startsWith('ocgo:'))
            assert.strict.deepEqual([goEntries.length, goEntries.map((p) => p.detectTruncation), others.length > 0, others.filter((p) => 'detectTruncation' in p).length], [9, GO_IDS.map(() => true), true, 0])
        })

    })

    describe('檔位逐條依型錄核對(G4)', function() {

        it('有檔位者帶--variant且該檔位在其型錄檔位內; 無檔位者不帶extraArgs', function() {
            let bad = []
            for (let p of goEntries) {
                let vs = VARIANTS[p.model.replace('opencode-go/', '')]
                if (!vs) {
                    bad.push([p.id, 'no catalog entry'])
                    continue
                }
                if (vs.length === 0) {
                    if ('extraArgs' in p) {
                        bad.push([p.id, 'has extraArgs but model has no variants'])
                    }
                    continue
                }
                let ea = p.extraArgs
                if (!Array.isArray(ea) || ea.length !== 2 || ea[0] !== '--variant' || !vs.includes(ea[1])) {
                    bad.push([p.id, ea])
                }
            }
            assert.strict.deepEqual([goEntries.length, bad], [9, []])
        })

        it('思考強度一律high(2026-09-30使用者指示): 型錄有high者帶high; 無high之qwen3.8-flash(low/medium/xhigh)取xhigh', function() {
            let r = goEntries.map((p) => {
                let vs = VARIANTS[p.model.replace('opencode-go/', '')]
                return vs.length === 0 ? null : p.extraArgs[1]
            })
            let rr = goEntries.map((p) => {
                let vs = VARIANTS[p.model.replace('opencode-go/', '')]
                if (vs.length === 0) {
                    return null
                }
                return vs.includes('high') ? 'high' : 'xhigh'
            })
            assert.strict.deepEqual(r, rr)
            assert.strict.deepEqual(rr, ['high', 'high', 'high', 'high', 'xhigh', 'high', null, null, 'high'])
        })

    })

    describe('目錄位置與REST類不收(G5)', function() {

        it('Go條目連續相鄰, 緊接最後一條oc:opencode/*之後、agy:之前', function() {
            let ids = providers.map((p) => p.id)
            let first = ids.indexOf(GO_IDS[0])
            let idx = GO_IDS.map((id) => ids.indexOf(id))
            let r = [
                idx.every((v, i) => v === first + i),
                ids[first - 1],
                ids[first + GO_IDS.length].startsWith('agy:'),
            ]
            assert.strict.deepEqual(r, [true, 'oc:opencode/nemotron-3.5-super-vl-free', true])
        })

        it('無REST類Go條目: 無條目baseURL指向/inference/go, 亦無api-*類kind之id含go', function() {
            let r = providers.filter((p) => /\/inference\/go|\/zen\/go/i.test(String(p.baseURL || '')) || (/^api-/.test(p.kind) && /(^|[:/_-])go([:/_-]|$)/i.test(p.id)))
            assert.strict.deepEqual([goEntries.length, r], [9, []])
        })

        it('內建目錄共38條(原29＋Go 9), id不重複', function() {
            let ids = providers.map((p) => p.id)
            assert.strict.deepEqual([ids.length, new Set(ids).size], [38, 38])
        })

    })

    describe('經resolveProviders展開(G3)', function() {

        it('給OPENCODE_GO_KEYS(逗號多把): 9條皆展開keys、移除envVar、其餘欄位原樣', function() {
            let r = resolveProviders(providers, { env: { OPENCODE_GO_KEYS: 'oc_sk_aaa111, oc_sk_bbb222' }, pick: GO_IDS })
            let got = r.providers
            assert.strict.deepEqual(
                [got.map((p) => p.id), got.map((p) => p.keys), got.map((p) => 'envVar' in p), r.skipped, r.missing],
                [GO_IDS, GO_IDS.map(() => ['oc_sk_aaa111', 'oc_sk_bbb222']), GO_IDS.map(() => false), [], []],
            )
            let src = goEntries.map((p) => ({ ...p, envVar: undefined }))
            let rest = got.map((p) => {
                let { keys, ...x } = p
                return x
            })
            assert.strict.deepEqual(rest, src.map((x) => {
                let { envVar, ...y } = x
                return y
            }))
        })

        it('缺OPENCODE_GO_KEYS(含空字串、全空白): 9條全列入skipped(envVar為OPENCODE_GO_KEYS)、不拋、不進providers', function() {
            let rs = [{}, { OPENCODE_GO_KEYS: '' }, { OPENCODE_GO_KEYS: '  ,  ' }].map((env) => resolveProviders(providers, { env, pick: GO_IDS }))
            let r = rs.map((x) => [x.providers.length, x.skipped.map((s) => s.id), x.skipped.every((s) => s.envVar === 'OPENCODE_GO_KEYS')])
            assert.strict.deepEqual(r, rs.map(() => [0, GO_IDS, true]))
        })

        it('只設OPENCODE_KEYS(不設OPENCODE_GO_KEYS): Go條目不展開(不沿用OPENCODE_KEYS), 免費REST條目照常展開', function() {
            let r = resolveProviders(providers, { env: { OPENCODE_KEYS: 'oc_sk_free1,oc_sk_free2' } })
            let ids = r.providers.map((p) => p.id)
            assert.strict.deepEqual(
                [ids.some((id) => id.startsWith('ocgo:')), r.skipped.filter((s) => s.id.startsWith('ocgo:')).length, ids.includes('zen:jev-1.13-free')],
                [false, 9, true],
            )
        })

        it('全取且備齊OPENCODE_GO_KEYS: Go條目9條在providers內、順序同目錄', function() {
            let r = resolveProviders(providers, { env: { OPENCODE_GO_KEYS: 'oc_sk_aaa111' } })
            assert.strict.deepEqual(r.providers.filter((p) => p.id.startsWith('ocgo:')).map((p) => p.id), GO_IDS)
        })

    })

    describe('經dispatchAiFallback以假opencode執行(整合, G1)', function() {

        let fake = null
        before(function() {
            fake = createFakeCli('opencodegoentries')
        })
        after(function() {
            fake.clean()
        })

        it('金鑰以OPENCODE_AUTH_CONTENT注入 {"opencode-go":{type:api,key}}, argv為 run --agent build -m opencode-go/<id> --format json [--variant](--format json為detectTruncation所加, 2026-11-04 da78)', async function() {
            let rr = resolveProviders(providers, {
                env: { OPENCODE_GO_KEYS: 'oc_sk_go_test_key' },
                pick: ['ocgo:opencode-go/glm-5.3-flash', 'ocgo:opencode-go/mimo-v2.6-flash'],
                exes: { opencode: fake.exe },
            })
            let rs = []
            for (let p of rr.providers) {
                let r = await dispatchAiFallback('hello', { providers: [p] })
                let o = JSON.parse(r.stdout)
                rs.push([
                    r.ok,
                    r.providerId,
                    o.args,
                    JSON.parse(o.env.OPENCODE_AUTH_CONTENT),
                    JSON.parse(o.env.OPENCODE_CONFIG_CONTENT),
                    o.stdin,
                ])
            }
            let perm = { permission: { edit: 'deny', bash: 'ask' } }
            assert.strict.deepEqual(rs, [
                [true, 'ocgo:opencode-go/glm-5.3-flash', ['run', '--agent', 'build', '-m', 'opencode-go/glm-5.3-flash', '--format', 'json', '--variant', 'high'], { 'opencode-go': { type: 'api', key: 'oc_sk_go_test_key' } }, perm, 'hello'],
                [true, 'ocgo:opencode-go/mimo-v2.6-flash', ['run', '--agent', 'build', '-m', 'opencode-go/mimo-v2.6-flash', '--format', 'json'], { 'opencode-go': { type: 'api', key: 'oc_sk_go_test_key' } }, perm, 'hello'],
            ])
        })

        it('多把金鑰逐把輪替: 第1把失敗(假CLI回Invalid API key)時換第2把, 且兩把都以opencode-go為provider鍵', async function() {
            let rr = resolveProviders(providers, {
                env: { OPENCODE_GO_KEYS: 'oc_sk_bad_one,oc_sk_good_two' },
                pick: ['ocgo:opencode-go/beam-free'],
                exes: { opencode: fake.exe },
                patch: { 'ocgo:opencode-go/beam-free': { extraArgs: ['--fake-fail-key=oc_sk_bad_one'] } },
            })
            let r = await dispatchAiFallback('hi', { providers: rr.providers })
            let o = JSON.parse(r.stdout)
            assert.strict.deepEqual(
                [r.ok, JSON.parse(o.env.OPENCODE_AUTH_CONTENT), r.tried.length],
                [true, { 'opencode-go': { type: 'api', key: 'oc_sk_good_two' } }, 2],
            )
        })

    })

})


// 2026-11-07 Gitea #92(主控任務20261107120446之ke339): 新增 ocgo:opencode-go/crouton-alpha-free(限時Unlimited之免費期Go模型; 帳本R-OCGO-1⑩)
// 規格來源(任務書〈主控已定〉2與〈必要之測試〉2): 形狀比照ocgo:opencode-go/beam-free; 依「不訓練者在前」緊接beam-free之後;
//   resolveCatalogue({ pick: [新id] }): 有金鑰時1條、缺OPENCODE_GO_KEYS時列入skipped(同既有ocgo:)。
describe('ocgo:opencode-go/crouton-alpha-free(Gitea #92)', function() {

    let ID = 'ocgo:opencode-go/crouton-alpha-free'
    let entry = providers.find((p) => p.id === ID)
    let beam = providers.find((p) => p.id === 'ocgo:opencode-go/beam-free')

    it('形狀比照ocgo:beam-free: 欄位集合、kind／provider／envVar／detectTruncation／防寫／檔位(--variant high)皆同, 僅id與model不同', function() {
        let strip = (p) => {
            let { id, model, ...x } = p
            return x
        }
        assert.strict.deepEqual(
            [entry !== undefined, entry.model, Object.keys(entry).sort(), strip(entry)],
            [true, 'opencode-go/crouton-alpha-free', Object.keys(beam).sort(), strip(beam)],
        )
        assert.strict.deepEqual(
            [entry.kind, entry.provider, entry.envVar, entry.detectTruncation, entry.config, entry.extraArgs],
            ['opencode', 'opencode-go', 'OPENCODE_GO_KEYS', true, { permission: { edit: 'deny', bash: 'ask' } }, ['--variant', 'high']],
        )
    })

    it('位置: 緊接beam-free之後、deepseek-v4.1-flash之前(不訓練者在前)', function() {
        let ids = providers.map((p) => p.id)
        let i = ids.indexOf(ID)
        assert.strict.deepEqual(
            [ids[i - 1], ids[i + 1]],
            ['ocgo:opencode-go/beam-free', 'ocgo:opencode-go/deepseek-v4.1-flash'],
        )
    })

    it('resolveCatalogue({ pick: [新id] }): 有OPENCODE_GO_KEYS時展開1條(keys、移除envVar)、skipped與missing皆空', function() {
        let { resolved } = resolveCatalogue({ pick: [ID], env: { OPENCODE_GO_KEYS: 'oc_sk_aaa111,oc_sk_bbb222' } })
        assert.strict.deepEqual(
            [resolved.providers.map((p) => p.id), resolved.providers.map((p) => p.keys), resolved.providers.map((p) => 'envVar' in p), resolved.skipped, resolved.missing],
            [[ID], [['oc_sk_aaa111', 'oc_sk_bbb222']], [false], [], []],
        )
    })

    it('resolveCatalogue({ pick: [新id] }): 缺OPENCODE_GO_KEYS(未設、空字串、全空白、只設OPENCODE_KEYS)時0條、列入skipped(envVar為OPENCODE_GO_KEYS)、不拋', function() {
        let envs = [{}, { OPENCODE_GO_KEYS: '' }, { OPENCODE_GO_KEYS: '  ,  ' }, { OPENCODE_KEYS: 'oc_sk_free1' }]
        let r = envs.map((env) => {
            let { resolved } = resolveCatalogue({ pick: [ID], env })
            return [resolved.providers.length, resolved.skipped, resolved.missing]
        })
        assert.strict.deepEqual(r, envs.map(() => [0, [{ id: ID, envVar: 'OPENCODE_GO_KEYS' }], []]))
    })

    describe('經dispatchAiFallback以假opencode執行', function() {

        let fake = null
        before(function() {
            fake = createFakeCli('opencodegocrouton')
        })
        after(function() {
            fake.clean()
        })

        it('金鑰以OPENCODE_AUTH_CONTENT注入 {"opencode-go":{type:api,key}}, argv為 run --agent build -m opencode-go/crouton-alpha-free --format json --variant high', async function() {
            let { resolved } = resolveCatalogue({ pick: [ID], env: { OPENCODE_GO_KEYS: 'oc_sk_go_test_key' }, exes: { opencode: fake.exe } })
            let r = await dispatchAiFallback('hello', { providers: resolved.providers })
            let o = JSON.parse(r.stdout)
            assert.strict.deepEqual(
                [r.ok, r.providerId, o.args, JSON.parse(o.env.OPENCODE_AUTH_CONTENT), JSON.parse(o.env.OPENCODE_CONFIG_CONTENT), o.stdin],
                [true, ID, ['run', '--agent', 'build', '-m', 'opencode-go/crouton-alpha-free', '--format', 'json', '--variant', 'high'], { 'opencode-go': { type: 'api', key: 'oc_sk_go_test_key' } }, { permission: { edit: 'deny', bash: 'ask' } }, 'hello'],
            )
        })

    })

})
