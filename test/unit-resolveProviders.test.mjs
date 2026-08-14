import assert from 'assert'
import resolveProviders from '../src/resolveProviders.mjs'
import providersAll from '../src/providers.mjs'


describe('resolveProviders', function() {

    //測試用定義, 不依賴真實環境變數
    let defs = [
        { id: 'api:m1', kind: 'api-openai-compat', baseURL: 'https://x/v1', model: 'm1', envVar: 'T_K1' },
        { id: 'api:m2', kind: 'api-openai-compat', baseURL: 'https://x/v1', model: 'm2', envVar: 'T_K2' },
        { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
        { id: 'api:m3', kind: 'api-openai-compat', baseURL: 'https://x/v1', model: 'm3', envVar: 'T_K1', keys: ['sk-own'] },
    ]
    let env = { T_K1: 'sk-a, sk-b,', T_K2: '' }

    it('envVar展開為keys(逗號分隔且修剪空白), envVar欄位自輸出移除', function() {
        let { providers } = resolveProviders(defs, { env })
        let p = providers.find((x) => x.id === 'api:m1')
        let r = [p.keys, p.envVar]
        let rr = [['sk-a', 'sk-b'], undefined]
        assert.strict.deepEqual(r, rr)
    })

    it('缺環境變數(或值為空)之條目停用並列入skipped', function() {
        let { providers, skipped } = resolveProviders(defs, { env })
        let r = [providers.map((x) => x.id), skipped]
        let rr = [['api:m1', 'claude:sonnet', 'api:m3'], [{ id: 'api:m2', envVar: 'T_K2' }]]
        assert.strict.deepEqual(r, rr)
    })

    it('無envVar之條目(訂閱登入態)原樣通過, 自帶keys者以keys為準', function() {
        let { providers } = resolveProviders(defs, { env })
        let pc = providers.find((x) => x.id === 'claude:sonnet')
        let p3 = providers.find((x) => x.id === 'api:m3')
        let r = [pc.model, p3.keys, p3.envVar]
        let rr = ['sonnet', ['sk-own'], undefined]
        assert.strict.deepEqual(r, rr)
    })

    it('pick自選子集且依pick順序回傳, 查無之id列入missing', function() {
        let { providers, missing } = resolveProviders(defs, { env, pick: ['claude:sonnet', 'api:m1', 'api:nope'] })
        let r = [providers.map((x) => x.id), missing]
        let rr = [['claude:sonnet', 'api:m1'], ['api:nope']]
        assert.strict.deepEqual(r, rr)
    })

    it('table以id為鍵, 可直接作dispatchAiWkf之定義表', function() {
        let { table } = resolveProviders(defs, { env })
        let r = [Object.keys(table), table['api:m1'].keys]
        let rr = [['api:m1', 'claude:sonnet', 'api:m3'], ['sk-a', 'sk-b']]
        assert.strict.deepEqual(r, rr)
    })

    it('輸入陣列與條目皆不被改動', function() {
        let before = JSON.stringify(defs)
        resolveProviders(defs, { env })
        let r = JSON.stringify(defs)
        assert.strict.deepEqual(r, before)
    })

    it('providers無效時回傳空結果不throw', function() {
        let r = []
        for (let v of [null, undefined, 'abc', {}, [null, 'x']]) {
            let t = resolveProviders(v, { env })
            r.push([t.providers.length, t.skipped.length, t.missing.length])
        }
        let rr = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
        assert.strict.deepEqual(r, rr)
    })

    it('可展開套件內建providers.mjs(以模擬env驗證, 不依賴真實.env)', function() {
        let fakeEnv = { OPENCODE_KEYS: 'sk-1,sk-2', AGNES_KEYS: 'sk-3', POOLSIDE_KEYS: 'sk-4' }
        let { providers, skipped } = resolveProviders(providersAll, { env: fakeEnv })
        let r = [
            providers.length === providersAll.length, //三個envVar皆有值 → 無停用
            skipped.length,
            providers.every((p) => p.envVar === undefined),
            providers.filter((p) => Array.isArray(p.keys)).length > 0,
        ]
        let rr = [true, 0, true, true]
        assert.strict.deepEqual(r, rr)
    })

})
