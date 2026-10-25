import assert from 'assert'
import resolveProviders from '../src/resolveProviders.mjs'
import splitKeys from '../src/splitKeys.mjs'
import providers from '../src/providers.mjs'


// unit-resolveProvidersKeys.test.mjs — `*_KEYS`環境變數之分隔符處理(2026-10-25 dispatch-run01)
//
// 規格來源: 任務書範圍三「ANTHROPIC_KEYS之解析」、README「ANTHROPIC_KEYS的分隔符」、帳本R-ANTHROPIC-5:
//   分隔符原只認逗號; 使用者曾以分號分隔致整串被當成一把。處置: 名稱以_KEYS結尾之變數遇分號時視同逗號並發warning(不含金鑰值);
//   其他變數名只認逗號; opt.splitSemicolon: false可關閉拆分(仍發warning)。
// 全部為純函數測試。


let A = 'sk-ant-api03-AAAA1111'
let B = 'sk-ant-api03-BBBB2222'
let C = 'sk-ant-api03-CCCC3333'


describe('splitKeys', function() {

    it('逗號分隔、修剪空白、濾除空項', function() {
        assert.strict.deepEqual(splitKeys(` ${A} , ${B},, `), { keys: [A, B], hasSemicolon: false })
    })

    it('分號視同逗號(預設)，hasSemicolon標記為true', function() {
        assert.strict.deepEqual(splitKeys(`${A};${B}`), { keys: [A, B], hasSemicolon: true })
    })

    it('逗號與分號混用皆拆開', function() {
        assert.strict.deepEqual(splitKeys(`${A};${B},${C}`).keys, [A, B, C])
    })

    it('splitSemicolon: false時分號保留於金鑰內（仍標記hasSemicolon）', function() {
        assert.strict.deepEqual(splitKeys(`${A};${B}`, { splitSemicolon: false }), { keys: [`${A};${B}`], hasSemicolon: true })
    })

    it('非字串視為空', function() {
        assert.strict.deepEqual([splitKeys(null).keys, splitKeys(undefined).keys, splitKeys(123).keys, splitKeys({}).keys], [[], [], [], []])
    })

})


describe('resolveProviders 之 *_KEYS 分隔符', function() {

    let pick = ['anthropic:haiku-5.5', 'claude-api:haiku-5.5']

    it('ANTHROPIC_KEYS以分號分隔: 拆成多把(不再整串當一把)，並回報warnings(含變數名與受影響之條目，不含金鑰值)', function() {
        let r = resolveProviders(providers, { env: { ANTHROPIC_KEYS: `${A};${B}` }, pick })
        assert.strict.deepEqual(
            [r.providers.map((p) => p.keys), r.warnings.length, r.warnings[0].envVar, r.warnings[0].code, r.warnings[0].ids, JSON.stringify(r.warnings).includes('AAAA1111')],
            [[[A, B], [A, B]], 1, 'ANTHROPIC_KEYS', 'KEYS_SEMICOLON', pick, false],
        )
    })

    it('逗號分隔: 行為不變、無warning', function() {
        let r = resolveProviders(providers, { env: { ANTHROPIC_KEYS: `${A},${B}` }, pick })
        assert.strict.deepEqual([r.providers.map((p) => p.keys), r.warnings], [[[A, B], [A, B]], []])
    })

    it('其他*_KEYS變數(OPENCODE_KEYS等)遇分號亦同', function() {
        let entry = { id: 'x:1', kind: 'opencode', envVar: 'OPENCODE_KEYS' }
        let r = resolveProviders([entry], { env: { OPENCODE_KEYS: 'k1;k2' } })
        assert.strict.deepEqual([r.providers[0].keys, r.warnings.map((w) => w.envVar)], [['k1', 'k2'], ['OPENCODE_KEYS']])
    })

    it('名稱不以_KEYS結尾之變數(單數形等)只認逗號，分號保留且不發warning（相容）', function() {
        let entry = { id: 'x:2', kind: 'opencode', envVar: 'SOME_KEY' }
        let r = resolveProviders([entry], { env: { SOME_KEY: 'k1;k2,k3' } })
        assert.strict.deepEqual([r.providers[0].keys, r.warnings], [['k1;k2', 'k3'], []])
    })

    it('opt.splitSemicolon: false → 分號保留於金鑰內，仍發warning', function() {
        let r = resolveProviders(providers, { env: { ANTHROPIC_KEYS: `${A};${B}` }, pick: ['anthropic:haiku-5.5'], splitSemicolon: false })
        assert.strict.deepEqual([r.providers[0].keys, r.warnings.length, r.warnings[0].message.includes('kept inside the key')], [[`${A};${B}`], 1, true])
    })

    it('多個條目共用同一變數只發一則warning，ids累加', function() {
        let r = resolveProviders(providers, { env: { ANTHROPIC_KEYS: `${A};${B}` }, pick: ['anthropic:opus-5.5', 'anthropic:sonnet-5.5', 'claude-api:haiku-5.5'] })
        assert.strict.deepEqual([r.warnings.length, r.warnings[0].ids], [1, ['anthropic:opus-5.5', 'anthropic:sonnet-5.5', 'claude-api:haiku-5.5']])
    })

    it('不同變數各自一則warning', function() {
        let es = [{ id: 'a:1', kind: 'opencode', envVar: 'A_KEYS' }, { id: 'b:1', kind: 'opencode', envVar: 'B_KEYS' }]
        let r = resolveProviders(es, { env: { A_KEYS: 'x;y', B_KEYS: 'p;q' } })
        assert.strict.deepEqual(r.warnings.map((w) => w.envVar), ['A_KEYS', 'B_KEYS'])
    })

    it('無分號時warnings為空陣列；既有回傳鍵（providers、table、skipped、missing、hints）不變，table與providers同源', function() {
        let r = resolveProviders(providers, { env: { ANTHROPIC_KEYS: A }, pick })
        assert.strict.deepEqual(
            [Object.keys(r), r.warnings, r.table['anthropic:haiku-5.5'].keys],
            [['providers', 'table', 'skipped', 'missing', 'hints', 'warnings'], [], [A]],
        )
    })

    it('分號拆出後為空（只有分隔符）仍視為缺金鑰進skipped，並發warning', function() {
        let r = resolveProviders(providers, { env: { ANTHROPIC_KEYS: ' ; ; ' }, pick: ['anthropic:haiku-5.5'] })
        assert.strict.deepEqual([r.providers.length, r.skipped.map((s) => s.id), r.warnings.length], [0, ['anthropic:haiku-5.5'], 1])
    })

    it('條目自帶有效keys者不經envVar展開，故無warning', function() {
        let r = resolveProviders([{ id: 'x:3', kind: 'opencode', envVar: 'ZZZ_KEYS', keys: ['a;b'] }], { env: { ZZZ_KEYS: 'x;y' } })
        assert.strict.deepEqual([r.providers[0].keys, r.warnings], [['a;b'], []])
    })

})
