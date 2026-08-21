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

    it('exes逐kind注入exe, 條目已自帶exe者不覆寫(條目層優先)', function() {
        let defs = [
            { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
            { id: 'claude:opus', kind: 'claude', model: 'opus', exe: 'D:/own/claude.exe' }, //自帶exe
            { id: 'codex:g', kind: 'codex', model: 'g' }, //exes未含codex → 不動
        ]
        let t = resolveProviders(defs, { env: {}, exes: { claude: 'C:/bin/claude.exe' } })
        let r = [
            t.table['claude:sonnet'].exe,
            t.table['claude:opus'].exe,
            t.table['codex:g'].exe,
            t.providers[0].exe, //陣列版與table版同源, 必然一致
        ]
        let rr = ['C:/bin/claude.exe', 'D:/own/claude.exe', undefined, 'C:/bin/claude.exe']
        assert.strict.deepEqual(r, rr)
    })

    it('patch逐id淺合併覆寫, 於exes之後施作故可覆寫exe, 陣列與table同步生效', function() {
        let defs = [
            { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
            { id: 'codex:g', kind: 'codex', model: 'g' },
        ]
        let t = resolveProviders(defs, {
            env: {},
            exes: { claude: 'C:/bin/claude.exe' },
            patch: { 'claude:sonnet': { timeoutMs: 360000, exe: 'C:/patched/claude.exe' } },
        })
        let r = [
            t.table['claude:sonnet'].timeoutMs,
            t.table['claude:sonnet'].exe, //patch後於exes施作, 覆寫成功
            t.providers[0].timeoutMs, //陣列版同步
            t.table['codex:g'].timeoutMs, //未命中id者不動
            t.providers[0] === t.table['claude:sonnet'], //同源同一物件
        ]
        let rr = [360000, 'C:/patched/claude.exe', 360000, undefined, true]
        assert.strict.deepEqual(r, rr)
    })

    it('pick查無時missing附拼寫提示hints(最接近之可用id), 無missing時hints為空物件', function() {
        let defs = [
            { id: 'poolside:laguna-s-2.1', kind: 'api-openai-compat', model: 'm' },
            { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
        ]
        //實務上pick查無多半是打錯字(如分隔符「/」誤替「:」), hints直接定位
        let t1 = resolveProviders(defs, { env: {}, pick: ['poolside/laguna-s-2.1', 'claude:sonnet'] })
        let t2 = resolveProviders(defs, { env: {} })
        let r = [t1.missing, t1.hints, t1.providers.map((p) => p.id), t2.missing, t2.hints]
        let rr = [
            ['poolside/laguna-s-2.1'],
            { 'poolside/laguna-s-2.1': 'poolside:laguna-s-2.1' },
            ['claude:sonnet'], //查無者不影響其餘pick
            [],
            {},
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('providers為空而pick有值時hints值為null(無可比對之id), 不throw', function() {
        let t = resolveProviders([], { env: {}, pick: ['x'] })
        let r = [t.missing, t.hints]
        let rr = [['x'], { x: null }]
        assert.strict.deepEqual(r, rr)
    })

    it('exes與patch皆省略時行為與原版完全相同(向後相容), 且不改動輸入條目', function() {
        let defs = [{ id: 'a:m', kind: 'claude', model: 'm' }]
        let before = JSON.stringify(defs)
        let t1 = resolveProviders(defs, { env: {} })
        let t2 = resolveProviders(defs, { env: {}, exes: { claude: 'C:/bin/claude.exe' }, patch: { 'a:m': { timeoutMs: 1 } } })
        let r = [JSON.stringify(t1.table['a:m']), JSON.stringify(defs) === before, defs[0].exe, defs[0].timeoutMs]
        let rr = ['{"id":"a:m","kind":"claude","model":"m"}', true, undefined, undefined]
        assert.strict.deepEqual(r, rr)
        assert.strict.deepEqual(t2.table['a:m'].timeoutMs, 1)
    })

})
