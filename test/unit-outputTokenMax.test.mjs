import assert from 'assert'
import { OUTPUT_TOKEN_MAX_ENV, DEFAULT_OUTPUT_TOKEN_MAX, castOutputTokenMax, applyOutputTokenMax } from '../src/outputTokenMax.mjs'


// unit-outputTokenMax.test.mjs — opencode輸出上限環境變數之決定與注入(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 對應規格句(sgud/rule/rulebook_opencodego.md R-OCGO-4):
//   S1 預設: 呼叫端環境無有效值且未給opt.outputTokenMax → 注入套件預設DEFAULT_OUTPUT_TOKEN_MAX
//   S2 覆寫: opt.outputTokenMax為有效正整數(數字或數字字串) → 採用並蓋過呼叫端環境
//   S3 呼叫端環境優先於預設: opt.env或process.env已設有效值 → 原樣保留不改(兩處皆有時opt.env優先, 與execCli併入順序一致)
//   S4 非預期輸入視為未給(dspec輸入參數之檢測機制 K3): 0、負數、小數、非數字字串、空字串、Infinity、NaN、布林、null、物件、包裝物件、陣列 → 改用下一順位
//   S5 不改寫輸入物件; Windows環境變數名不分大小寫
//   S6 CLI原本之32000可由opt.outputTokenMax: 32000回到


describe('outputTokenMax', function() {

    let KEY = OUTPUT_TOKEN_MAX_ENV

    it('環境變數名稱為OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, 套件預設為大於opencode預設32000之正整數(S1)', function() {
        let r = [KEY, Number.isSafeInteger(DEFAULT_OUTPUT_TOKEN_MAX), DEFAULT_OUTPUT_TOKEN_MAX > 32000]
        let rr = ['OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX', true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('castOutputTokenMax: 有效正整數(含數字字串、科學記號、頭尾空白)轉為數字(S2/S4)', function() {
        let r = [64000, '64000', ' 64000 ', '1e5', 1e5, '+5', 1].map(castOutputTokenMax)
        let rr = [64000, 64000, 64000, 100000, 100000, 5, 1]
        assert.strict.deepEqual(r, rr)
    })

    it('castOutputTokenMax: 非預期輸入一律回null, 不拋錯(S4)', function() {
        //包裝物件(new Number)刻意入列: 檢測須拒收(dspec輸入參數之檢測機制 K6／N3: 包裝物件無效)
        // eslint-disable-next-line no-new-wrappers
        let bad = [0, '0', -5, '-5', 64000.5, '64000.5', '', ' ', 'abc', null, undefined, true, false, Infinity, -Infinity, NaN, '1e400', 2 ** 53, 2 ** 60, '0x10', '1,000', {}, [], [5], new Number(5), 5n, Symbol('x'), () => 5]
        let r = bad.map(castOutputTokenMax)
        assert.strict.deepEqual(r, bad.map(() => null))
    })

    it('S1: 無opt值且呼叫端環境皆空 → 注入預設, source為default', function() {
        let t = applyOutputTokenMax({}, undefined, {})
        let r = [t.value, t.source, t.env[KEY]]
        let rr = [DEFAULT_OUTPUT_TOKEN_MAX, 'default', String(DEFAULT_OUTPUT_TOKEN_MAX)]
        assert.strict.deepEqual(r, rr)
    })

    it('S1: env參數為非物件(undefined、null、字串)時視為空物件, 不拋錯', function() {
        let r = [undefined, null, 'x', 5].map((e) => applyOutputTokenMax(e, undefined, {}).env[KEY])
        let v = String(DEFAULT_OUTPUT_TOKEN_MAX)
        assert.strict.deepEqual(r, [v, v, v, v])
    })

    it('S2: opt.outputTokenMax有效 → 採用(數字或數字字串), source為opt', function() {
        let a = applyOutputTokenMax({}, 128000, {})
        let b = applyOutputTokenMax({}, '96000', {})
        let c = applyOutputTokenMax({}, 32000, {}) //S6: 回到CLI原預設
        let r = [[a.value, a.source, a.env[KEY]], [b.value, b.source, b.env[KEY]], [c.value, c.env[KEY]]]
        let rr = [[128000, 'opt', '128000'], [96000, 'opt', '96000'], [32000, '32000']]
        assert.strict.deepEqual(r, rr)
    })

    it('S2: opt.outputTokenMax有效時蓋過opt.env與process.env已設之值', function() {
        let t = applyOutputTokenMax({ [KEY]: '50000' }, 128000, { [KEY]: '40000' })
        let r = [t.value, t.source, t.env[KEY]]
        let rr = [128000, 'opt', '128000']
        assert.strict.deepEqual(r, rr)
    })

    it('S3: opt.env已設有效值 → 原樣保留, 回傳之env即原物件內容, source為env', function() {
        let env = { [KEY]: '50000', FOO: 'x' }
        let t = applyOutputTokenMax(env, undefined, {})
        let r = [t.value, t.source, t.env[KEY], t.env.FOO]
        let rr = [50000, 'env', '50000', 'x']
        assert.strict.deepEqual(r, rr)
    })

    it('S3: 僅本行程環境(process.env)已設有效值 → 不注入(子進程繼承), source為env', function() {
        let t = applyOutputTokenMax({ FOO: 'x' }, undefined, { [KEY]: '48000' })
        let r = [t.value, t.source, Object.prototype.hasOwnProperty.call(t.env, KEY), t.env.FOO]
        let rr = [48000, 'env', false, 'x']
        assert.strict.deepEqual(r, rr)
    })

    it('S3: opt.env與process.env皆有時以opt.env為準(execCli併入時opt.env蓋過process.env)', function() {
        let a = applyOutputTokenMax({ [KEY]: '50000' }, undefined, { [KEY]: '40000' })
        //opt.env內為無效值時不回退看process.env(子進程實際得到的是opt.env之無效值), 故改用預設覆蓋
        let b = applyOutputTokenMax({ [KEY]: 'abc' }, undefined, { [KEY]: '40000' })
        let r = [[a.value, a.source], [b.value, b.source, b.env[KEY]]]
        let rr = [[50000, 'env'], [DEFAULT_OUTPUT_TOKEN_MAX, 'default', String(DEFAULT_OUTPUT_TOKEN_MAX)]]
        assert.strict.deepEqual(r, rr)
    })

    it('S4: 呼叫端環境內之無效值(CLI本就忽略) → 以預設覆蓋, 不回顯', function() {
        let r = []
        for (let bad of ['abc', '0', '-5', '', ' ', '64000.5', 'Infinity', '0x10', '1,000', '1e400']) {
            let t = applyOutputTokenMax({ [KEY]: bad }, undefined, {})
            r.push([t.source, t.env[KEY]])
        }
        let v = ['default', String(DEFAULT_OUTPUT_TOKEN_MAX)]
        assert.strict.deepEqual(r, r.map(() => v))
    })

    it('S4: opt.outputTokenMax無效 → 視為未給, 依序看呼叫端環境再預設', function() {
        let r = []
        // eslint-disable-next-line no-new-wrappers
        for (let bad of [0, -1, 1.5, 'abc', '', null, true, false, Infinity, NaN, {}, [], [64000], new Number(64000), 5n]) {
            let a = applyOutputTokenMax({}, bad, {})
            let b = applyOutputTokenMax({ [KEY]: '50000' }, bad, {})
            r.push([a.source, a.value, b.source, b.value])
        }
        let v = ['default', DEFAULT_OUTPUT_TOKEN_MAX, 'env', 50000]
        assert.strict.deepEqual(r, r.map(() => v))
    })

    it('S5: 不改寫輸入之env物件與procEnv', function() {
        let env = { FOO: 'x' }
        let proc = { BAR: 'y' }
        let snapEnv = JSON.stringify(env)
        let snapProc = JSON.stringify(proc)
        let t = applyOutputTokenMax(env, 128000, proc)
        let r = [JSON.stringify(env), JSON.stringify(proc), t.env !== env, t.env.FOO]
        let rr = [snapEnv, snapProc, true, 'x']
        assert.strict.deepEqual(r, rr)
    })

    it('S5: Windows下大小寫異名之鍵視為同一變數且移除舊鍵(其他平台區分大小寫而不適用)', function() {
        if (process.platform !== 'win32') {
            this.skip()
        }
        let lower = KEY.toLowerCase()
        let t = applyOutputTokenMax({ [lower]: 'abc' }, undefined, {})
        let keys = Object.keys(t.env).filter((k) => k.toLowerCase() === lower)
        let t2 = applyOutputTokenMax({ [lower]: '50000' }, undefined, {})
        let r = [keys, t.env[KEY], t2.source, t2.value]
        let rr = [[KEY], String(DEFAULT_OUTPUT_TOKEN_MAX), 'env', 50000]
        assert.strict.deepEqual(r, rr)
    })

    it('S5: 非win32時大小寫異名之鍵不同視為不同變數(子進程環境亦區分)', function() {
        if (process.platform === 'win32') {
            this.skip()
        }
        let lower = KEY.toLowerCase()
        let t = applyOutputTokenMax({ [lower]: '50000' }, undefined, {})
        let r = [t.source, t.env[KEY], t.env[lower]]
        let rr = ['default', String(DEFAULT_OUTPUT_TOKEN_MAX), '50000']
        assert.strict.deepEqual(r, rr)
    })

})
