import assert from 'assert'
import dispatchAiFallback, { keysAreActualAuth, isOfficialAnthropicEntry, initState } from '../src/dispatchAiFallback.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import resolveCatalogue from '../src/resolveCatalogue.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import filterOpencodeFree from '../src/filterOpencodeFree.mjs'
import providersAll from '../src/providers.mjs'
import callAiWithFallback, { buildChain } from '../src/wkf/callAiWithFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { revoked } from './tools/userFnFormsForTest.mjs'


// unit-probeSites.test.mjs — 「借判斷函數拋錯」之防線改為明確可讀性探針之站點直測(帳本R-USERFN-4之站點表)
//
// 規格: wsemi 1.9.69起判斷函數(isobj、isarr、isestr等)對已撤銷之Proxy、Symbol.toStringTag拋錯等敵意輸入不再拋錯而回false;
//   本套件各站點須以probeReadable明確判定「不可讀」, 並依該站點既有之失敗通道回報(params、保守視為不可信／不屬範圍、本次以全新狀態執行且不回寫),
//   不得因判斷函數回false而把不可讀之輸入當成「非物件／未給」放行。
//   每案之「修前」為: 取掉該站點之probeReadable後判斷函數回false → 站點改走「放行／當成未給」之分支(見各案說明); 變異證據見報告。


//tagBoom, 內部標籤拋錯之物件(Object.prototype.toString拋)
let tagBoom = () => Object.defineProperty({}, Symbol.toStringTag, {
    get: () => {
        throw new Error('tag-boom')
    },
})
//tagBoomArr, 內部標籤拋錯之陣列
let tagBoomArr = () => Object.defineProperty([], Symbol.toStringTag, {
    get: () => {
        throw new Error('tag-boom')
    },
})
//ownKeysBoomArr, ownKeys陷阱拋錯之陣列Proxy
let ownKeysBoomArr = () => new Proxy([], {
    ownKeys: () => {
        throw new Error('ownKeys-boom')
    },
})
//trapBoom, 各陷阱皆拋錯之Proxy
let trapBoom = () => new Proxy({}, {
    get: () => {
        throw new Error('get-trap')
    },
    ownKeys: () => {
        throw new Error('ownKeys-trap')
    },
})


describe('keysAreActualAuth: 條目keys[]是否即實際認證身分(api-anthropic之headers); 不可讀之headers保守視為不可信', function() {

    it('headers為已撤銷之Proxy、標籤拋錯、陷阱拋錯者回false(不可信); 可讀且無認證標頭者回true; 帶x-api-key或authorization(不分大小寫)者回false; 非api-anthropic一律true', function() {
        //規格: keysAreActualAuth之JSDoc「任何讀取失敗一律保守視為不可信」; 修前(取掉探針): 不可讀之headers經isobj回false而被當成「無認證標頭」→ 回true(誤信)
        let rows = [
            ['revoked', keysAreActualAuth({ kind: 'api-anthropic', headers: revoked() })],
            ['tag-boom', keysAreActualAuth({ kind: 'api-anthropic', headers: tagBoom() })],
            ['trap-boom', keysAreActualAuth({ kind: 'api-anthropic', headers: trapBoom() })],
            ['plain-no-auth', keysAreActualAuth({ kind: 'api-anthropic', headers: { 'X-Other': 'v' } })],
            ['none', keysAreActualAuth({ kind: 'api-anthropic' })],
            ['x-api-key', keysAreActualAuth({ kind: 'api-anthropic', headers: { 'X-Api-Key': 'k' } })],
            ['authorization', keysAreActualAuth({ kind: 'api-anthropic', headers: { AUTHORIZATION: 'Bearer k' } })],
            ['other-kind-revoked-headers', keysAreActualAuth({ kind: 'claude', headers: revoked() })],
        ]
        let rr = [['revoked', false], ['tag-boom', false], ['trap-boom', false], ['plain-no-auth', true], ['none', true], ['x-api-key', false], ['authorization', false], ['other-kind-revoked-headers', true]]
        assert.strict.deepEqual(rows, rr)
    })

})


describe('isOfficialAnthropicEntry: 條目是否打向Anthropic官方端點; 不可讀之baseURL、crossCheckBaseURL、env、env.ANTHROPIC_BASE_URL值保守視為不屬範圍', function() {

    it('api-anthropic: baseURL已撤銷之Proxy／標籤拋錯者回false; 未給與官方網址回true; 自訂網址回false', function() {
        //規格: isOfficialAnthropicEntry之JSDoc「任何讀取失敗(不可讀之物件)一律保守視為不屬範圍」; 修前(取掉探針): isestr對不可讀值回false → 當成「非自訂端點」→ 回true(誤入共享沒額度紀錄之範圍)
        let rows = [
            ['revoked', isOfficialAnthropicEntry({ kind: 'api-anthropic', baseURL: revoked() })],
            ['tag-boom', isOfficialAnthropicEntry({ kind: 'api-anthropic', baseURL: tagBoom() })],
            ['absent', isOfficialAnthropicEntry({ kind: 'api-anthropic' })],
            ['official', isOfficialAnthropicEntry({ kind: 'api-anthropic', baseURL: 'https://api.anthropic.com' })],
            ['custom', isOfficialAnthropicEntry({ kind: 'api-anthropic', baseURL: 'http://gateway.invalid' })],
        ]
        assert.strict.deepEqual(rows, [['revoked', false], ['tag-boom', false], ['absent', true], ['official', true], ['custom', false]])
    })

    it('claude: crossCheckBaseURL、env、env.ANTHROPIC_BASE_URL之值不可讀者回false; 可讀且皆未自訂者回true; 自訂者回false', function() {
        //規格: 同上; env為呼叫端物件(已撤銷之Proxy時修前isobj回false → 略過env檢查而回true)
        let withBase = (v) => Object.defineProperty({}, 'ANTHROPIC_BASE_URL', { enumerable: true, value: v })
        let saved = process.env.ANTHROPIC_BASE_URL
        delete process.env.ANTHROPIC_BASE_URL
        try {
            let rows = [
                ['crossCheck-revoked', isOfficialAnthropicEntry({ kind: 'claude', crossCheckBaseURL: revoked() })],
                ['env-revoked', isOfficialAnthropicEntry({ kind: 'claude', env: revoked() })],
                ['env-tag-boom', isOfficialAnthropicEntry({ kind: 'claude', env: tagBoom() })],
                ['env-trap-boom', isOfficialAnthropicEntry({ kind: 'claude', env: trapBoom() })],
                ['env-base-revoked', isOfficialAnthropicEntry({ kind: 'claude', env: withBase(revoked()) })],
                ['env-base-custom', isOfficialAnthropicEntry({ kind: 'claude', env: withBase('http://gateway.invalid') })],
                ['env-base-official', isOfficialAnthropicEntry({ kind: 'claude', env: withBase('https://api.anthropic.com') })],
                ['plain', isOfficialAnthropicEntry({ kind: 'claude', env: { FAKE: '1' } })],
                ['none', isOfficialAnthropicEntry({ kind: 'claude' })],
                ['other-kind', isOfficialAnthropicEntry({ kind: 'codex', env: revoked() })],
            ]
            let rr = [['crossCheck-revoked', false], ['env-revoked', false], ['env-tag-boom', false], ['env-trap-boom', false], ['env-base-revoked', false], ['env-base-custom', false], ['env-base-official', true], ['plain', true], ['none', true], ['other-kind', false]]
            assert.strict.deepEqual(rows, rr)
        }
        finally {
            if (saved !== undefined) {
                process.env.ANTHROPIC_BASE_URL = saved
            }
        }
    })

})


describe('initState: store.get回傳值與其成員不可讀時本次以全新狀態執行且不回寫', function() {

    it('store.get回傳之cursors、cooling、keyCooling、failStreak任一為不可讀之物件: 不回寫(set 0次)、狀態為全新; 可讀者照舊回寫', function() {
        //規格: 帳本R-USERFN-1「store.get拋錯或回傳不可讀之物件 → 本次以全新狀態執行且不回寫(不覆寫既有cursors與cooling)」; 修前(取掉成員探針): isobj對已撤銷成員回false → 就地換成{}並於saveState寫回, 抹除store內該成員
        let rows = []
        for (let member of ['cursors', 'cooling', 'keyCooling', 'failStreak']) {
            for (let [label, mk] of [['revoked', () => revoked()], ['tag-boom', tagBoom], ['trap-boom', trapBoom]]) {
                let sets = []
                let { state, saveState } = initState({ get: () => ({ cursors: {}, cooling: {}, [member]: mk() }), set: (s) => sets.push(s) })
                saveState()
                rows.push([member, label, sets.length, Object.keys(state).sort().join(',')])
            }
        }
        let rr = []
        for (let member of ['cursors', 'cooling', 'keyCooling', 'failStreak']) {
            for (let label of ['revoked', 'tag-boom', 'trap-boom']) {
                rr.push([member, label, 0, 'cooling,cursors'])
            }
        }
        assert.strict.deepEqual(rows, rr)

        //對照: 可讀之狀態照舊回寫(set 1次)
        let sets = []
        let { saveState } = initState({ get: () => ({ cursors: { A: 1 }, cooling: {} }), set: (s) => sets.push(s) })
        saveState()
        assert.strict.deepEqual(sets.length, 1)
    })

    it('store.get回傳已撤銷之Proxy或標籤拋錯之物件: 同上不回寫(對照既有unit-userFnWorkflow之store案)', function() {
        let rows = []
        for (let mk of [() => revoked(), tagBoom, trapBoom]) {
            let sets = []
            let { state, saveState } = initState({ get: () => mk(), set: (s) => sets.push(s) })
            saveState()
            rows.push([sets.length, Object.keys(state).sort().join(',')])
        }
        assert.strict.deepEqual(rows, [0, 1, 2].map(() => [0, 'cooling,cursors']))
    })

})


describe('dispatchAiFallback之providers: 可讀之非物件條目濾除, 不可讀之條目與陣列本身以params回報(不悄悄消失)', function() {

    let fake = null

    before(function() {
        fake = createFakeCli(`fake-pe-${process.pid}`)
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('條目為字串、數字、null、陣列、Map(可讀而非物件)者濾除; 已撤銷之Proxy、標籤拋錯、陷阱拋錯者保留並於迴圈以params整組跳過(訊息帶原陣列索引); 其後之可用條目成交', async function() {
        //規格: 帳本R-USERFN-1「不可讀之條目不悄悄濾除而留下params歷程」; 修前(取掉探針): isobj對不可讀條目回false → 與非物件條目同被濾除而無歷程
        let r = await dispatchAiFallback('abc', { providers: ['x', 123, null, [], new Map(), revoked(), tagBoom(), { id: 'OK', kind: 'claude', exe: fake.exe }] })
        let rows = [
            r.ok, r.providerId,
            r.tried.map((t) => [t.outcome, t.errorType || null]),
            r.tried.slice(0, 2).map((t) => /^providers\[(\d)\] is not readable: /.exec(t.error)?.[1] || null),
        ]
        assert.strict.deepEqual(rows, [true, 'OK', [['skip-group', 'params'], ['skip-group', 'params'], ['ok', null]], ['5', '6']])
    })

    it('條目為已撤銷之函數Proxy(含啟用冷卻之路徑): 以params整組跳過(訊息帶原陣列索引)、不reject; 其後之可用條目成交', async function() {
        //規格: 帳本R-USERFN-4——函數型之不可讀亦經探針; 修前(readCallerObj對typeof非object原樣交回): 保留之函數Proxy於迴圈／冷卻重排讀取時TypeError而整個函數reject(1.9.69下之keepEntry不保留則為靜默濾除)
        let rows = []
        for (let opt of [{}, { cooldownMs: 1000 }]) {
            let fp = Proxy.revocable(function() {}, {})
            fp.revoke()
            let r = null
            try {
                r = await dispatchAiFallback('abc', { ...opt, providers: [fp.proxy, { id: 'OK', kind: 'claude', exe: fake.exe }] })
            }
            catch (err) {
                r = { ok: `rejected:${String(err && err.message)}`, tried: [] }
            }
            rows.push([r.ok, r.providerId, r.tried.map((t) => [t.outcome, t.errorType || null]), /^providers\[0\] is not readable: /.test((r.tried[0] || {}).error || '')])
        }
        assert.strict.deepEqual(rows, [0, 1].map(() => [true, 'OK', [['skip-group', 'params'], ['ok', null]], true]))
    })

    it('providers本身為已撤銷之Proxy、標籤拋錯之陣列: params且訊息為「providers is not readable」(非「must be a non-empty array」)', async function() {
        //規格: 同上; 修前(取掉探針): isarr對不可讀者回false → 落入「providers must be a non-empty array」(params, 但原因被掩蓋)
        let ra = Proxy.revocable([], {})
        ra.revoke()
        let tagArr = Object.defineProperty([], Symbol.toStringTag, {
            get: () => {
                throw new Error('tag-boom')
            },
        })
        let rows = []
        for (let providers of [ra.proxy, tagArr]) {
            let t = await dispatchAiFallback('abc', { providers })
            rows.push([t.ok, t.errorType, t.error.split(':')[0]])
        }
        rows.push((await dispatchAiFallback('abc', { providers: 'x' })).error)
        assert.strict.deepEqual(rows, [[false, 'params', 'providers is not readable'], [false, 'params', 'providers is not readable'], 'providers must be a non-empty array'])
    })

})


describe('dispatchOpencode之config不可讀: params、不起子進程、不靜默沿用使用者既有設定檔', function() {

    it('config為已撤銷之Proxy(含函數Proxy)、標籤拋錯、陷阱拋錯: ok為false、errorType為params、attempts為0(exe為不存在之檔, 若誤起子進程則為spawn)', async function() {
        //規格: 帳本R-USERFN-1「opencode之config判型與序列化同一try, 不可判型以params回報」; 修前(取掉探針): isobj對不可讀config回false → 當成未給而沿用使用者既有設定檔(ok為true或進入spawn)
        let fp = Proxy.revocable(function() {}, {})
        fp.revoke()
        let rows = []
        for (let config of [revoked(), fp.proxy, tagBoom(), trapBoom()]) {
            let t = await dispatchOpencode('abc', { exe: 'opencode-not-exist-for-probe-test', config })
            rows.push([t.ok, t.errorType, t.attempts, t.error.startsWith('config is not JSON-serializable: ')])
        }
        assert.strict.deepEqual(rows, [1, 2, 3, 4].map(() => [false, 'params', 0, true]))
    })

})


describe('callAi之定義表條目與spec.fallback不可讀: 以params回報並標明原因, 不誤報為「查無定義」或靜默略過fallback', function() {

    let fake = null

    before(function() {
        fake = createFakeCli(`fake-ps-${process.pid}`)
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('buildChain: 定義表條目不可讀(已撤銷之Proxy、標籤拋錯、陷阱拋錯)時拋出(由callAi轉params); 可讀而非物件者列入missing', function() {
        //規格: 帳本R-USERFN-1「callAi之providers條目為呼叫端物件, 不可讀以params回報」; 修前(取掉探針): isobj對不可讀條目回false → 列入missing → 誤報「unknown provider name(s)」
        let rows = []
        for (let mk of [() => revoked(), tagBoom, trapBoom]) {
            let threw = ''
            try {
                buildChain({ A: mk() }, { use: 'A', fallback: null })
            }
            catch (err) {
                threw = String(err && err.message)
            }
            rows.push(threw !== '')
        }
        let b = buildChain({ A: 'not-an-object', B: { kind: 'claude' } }, { use: 'A', fallback: ['B'] })
        assert.strict.deepEqual([rows, b.missing, b.chain.map((e) => e.id)], [[true, true, true], ['A'], ['B']])
    })

    it('callAiWithFallback: 定義表條目為不可讀物件 → params且訊息為「provider entry is not readable」(非「unknown provider name」); spec.fallback不可讀 → params且訊息為「spec is not readable」', async function() {
        //規格: 同上; spec.fallback為呼叫端陣列(帳本R-USERFN-1), 修前(取掉探針): isearr對已撤銷之Proxy回false → fallback被靜默當成未給而忽略
        let ps = (extra) => ({ A: { kind: 'claude', exe: fake.exe }, ...extra })
        let rows = []
        for (let [label, providers, spec] of [
            ['entry-revoked', ps({ B: revoked() }), { use: 'B' }],
            ['entry-tag-boom', ps({ B: tagBoom() }), { use: 'B' }],
            ['entry-trap-boom', ps({ B: trapBoom() }), { use: 'B' }],
            ['fallback-revoked', ps(), { use: 'A', fallback: revoked() }],
            ['fallback-tag-boom', ps(), { use: 'A', fallback: tagBoomArr() }],
            ['fallback-ownKeys-boom', ps(), { use: 'A', fallback: ownKeysBoomArr() }],
        ]) {
            let t = await callAiWithFallback('abc', { providers, spec, promptPrefix: '' })
            rows.push([label, t.ok, t.errorType, t.error.split(':')[0], /unknown provider name/.test(t.error)])
        }
        let rr = [
            ['entry-revoked', false, 'params', 'provider entry is not readable', false],
            ['entry-tag-boom', false, 'params', 'provider entry is not readable', false],
            ['entry-trap-boom', false, 'params', 'provider entry is not readable', false],
            ['fallback-revoked', false, 'params', 'spec is not readable', false],
            ['fallback-tag-boom', false, 'params', 'spec is not readable', false],
            ['fallback-ownKeys-boom', false, 'params', 'spec is not readable', false],
        ]
        assert.strict.deepEqual(rows, rr)
    })

})


describe('resolveProviders／resolveCatalogue／createAiCaller: 呼叫端物件不可讀時同步throw, 不靜默改用process.env、全取、內建目錄或略過patch', function() {

    let providers = () => [{ id: 'a', kind: 'claude' }, { id: 'b', kind: 'claude', envVar: 'PROBE_SITES_KEYS' }]

    it('resolveProviders: opt.env／pick／exes／patch、providers本身與其條目為不可讀之物件 → throw「<name> is not readable」; 可讀而型別不符(數字、字串)者照舊視同未給', function() {
        //規格: 帳本R-USERFN-4——同步函數無params結果通道, 不可讀者拋出; 修前(1.9.69下)isobj／isearr回false: env改用process.env(換掉金鑰來源)、pick視同未給而全取(含付費條目)、patch／exes略過、條目濾除
        let rows = []
        for (let [label, mk] of [['revoked', () => revoked()], ['tag-boom', tagBoom], ['trap-boom', trapBoom]]) {
            for (let k of ['env', 'pick', 'exes', 'patch']) {
                let msg = ''
                try {
                    resolveProviders(providers(), { [k]: mk() })
                }
                catch (err) {
                    msg = String(err && err.message)
                }
                rows.push([label, k, msg.startsWith(`${k} is not readable: `)])
            }
            let m1 = ''
            try {
                resolveProviders(mk(), {})
            }
            catch (err) {
                m1 = String(err && err.message)
            }
            let m2 = ''
            try {
                resolveProviders([{ id: 'a', kind: 'claude' }, mk()], {})
            }
            catch (err) {
                m2 = String(err && err.message)
            }
            rows.push([label, 'providers', m1.startsWith('providers is not readable: '), m2.startsWith('providers[1] is not readable: ')])
        }
        let rr = []
        for (let label of ['revoked', 'tag-boom', 'trap-boom']) {
            for (let k of ['env', 'pick', 'exes', 'patch']) {
                rr.push([label, k, true])
            }
            rr.push([label, 'providers', true, true])
        }
        assert.strict.deepEqual(rows, rr)

        //pick、patch可讀而型別不符: 2026-11-23 tdai2起同步throw(規則11; 修前視同未給——pick為字串即全取含付費條目、patch為字串不套用; 細案見unit-envExesValues)
        assert.strict.deepEqual(
            [{ pick: 'x' }, { patch: 'y' }].map((o) => {
                try {
                    resolveProviders(providers(), o)
                    return ''
                }
                catch (err) {
                    return String(err && err.message).split(' ')[0]
                }
            }),
            ['pick', 'patch'],
        )

        //env、exes可讀而非物件: 排程第553項裁示②起同步throw(不再視同未給而改用process.env、略過exes; 帳本R-SAFEOPT-1規則10, 細案見unit-envExesReject)
        assert.strict.deepEqual(
            [{ env: 123 }, { exes: 7 }].map((o) => {
                try {
                    resolveProviders(providers(), o)
                    return ''
                }
                catch (err) {
                    return String(err && err.message).split(' ')[0]
                }
            }),
            ['env', 'exes'],
        )
    })

    it('resolveCatalogue與createAiCaller: catalogue／extraProviders／env／pick／exes／patch／providerTimeouts不可讀 → throw; 可讀而非陣列之catalogue同步throw(2026-11-23 tdai2b起; 修前改用內建目錄)', function() {
        //規格: 同上; 修前(1.9.69下)catalogue不可讀被當成未給而靜默改用內建目錄(含付費條目)
        let rows = []
        for (let k of ['catalogue', 'extraProviders', 'env', 'pick', 'exes', 'patch', 'providerTimeouts']) {
            for (let mk of [() => revoked(), tagBoom, trapBoom]) {
                let msg = ''
                try {
                    resolveCatalogue({ [k]: mk() })
                }
                catch (err) {
                    msg = String(err && err.message)
                }
                rows.push([k, msg.startsWith(`${k} is not readable: `)])
            }
        }
        assert.strict.deepEqual(rows, rows.map(([k]) => [k, true]))
        //可讀而非陣列之catalogue: tdai2b起同步throw(不再改用含付費條目之內建目錄; 細案見unit-patchCatalogueConfig C1); 未給(undefined、null)才用內建目錄
        assert.strict.throws(() => resolveCatalogue({ catalogue: 123, env: {} }), /^Error: catalogue must be an array when given/)
        assert.strict.deepEqual(resolveCatalogue({ env: {} }).merged.length, providersAll.length)

        //createAiCaller建構時解析一次, 同樣throw
        let msg = ''
        try {
            createAiCaller({ env: revoked() })
        }
        catch (err) {
            msg = String(err && err.message)
        }
        assert.strict.equal(msg.startsWith('env is not readable: '), true)
    })

})


describe('filterOpencodeFree: opt.env不可讀 → params且不起子進程(不靜默以繼承之環境執行)', function() {

    it('env為已撤銷之Proxy、標籤拋錯、陷阱拋錯: ok為false、errorType為params、訊息為「env is not readable」(exe為不存在之檔, 若起子進程則errorType非params); 可讀之env照舊(走到spawn失敗)', async function() {
        //規格: 帳本R-USERFN-4; 修前(1.9.69下)isobj(env)回false → env被靜默丟棄, `opencode models`改以繼承之環境執行
        let providersIn = [{ id: 'oc:x-free', kind: 'opencode', model: 'opencode/x-free' }]
        let rows = []
        for (let mk of [() => revoked(), tagBoom, trapBoom]) {
            let t = await filterOpencodeFree(providersIn, { exe: 'opencode-not-exist-for-probe-test', env: mk() })
            rows.push([t.ok, t.errorType, t.error.startsWith('env is not readable: ')])
        }
        let ctl = await filterOpencodeFree(providersIn, { exe: 'opencode-not-exist-for-probe-test', env: {} })
        assert.strict.deepEqual([rows, ctl.errorType !== 'params'], [[0, 1, 2].map(() => [false, 'params', true]), true])
    })

})
