import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import CODE_ENTRY_LIMIT from './tools/fakeOpencodeLimitForTest.mjs'


// unit-dispatchAiFallbackOpencodeLimit.test.mjs — 遞補層遇opencode免費池用盡／免費層429之處置(wda156, Gitea #156; 帳本R-OCLIMIT-1)
//
// spec(派工〈本輪範圍〉3、建議檔§2-3): dispatchAiFallback遇此結果以額度冷卻(reason 'quota', 固定視窗)改派下一條目, 不等逾時;
//   既有之quota-skip、quotaGate語意不變; 429走既有限流冷卻(reason 'rate-limit')。
// 假CLI: 只在帶--print-logs時印錯誤列、印後不結束(同真實opencode); 修前之遞補層看到的是TIMEOUT(條目逾時給LIMIT_TMO)。


let LIMIT_TMO = 20000


//記憶體store(同步get/set, 深拷貝以免共用參照)
function memStore() {
    let s = null
    return {
        get: () => (s === null ? null : JSON.parse(JSON.stringify(s))),
        set: (v) => {
            s = JSON.parse(JSON.stringify(v))
        },
        peek: () => s,
    }
}


describe('dispatchAiFallback 遇opencode免費池用盡／免費層429', function() {

    let fake = null

    before(function() {
        fake = createFakeCli('fake-oclimit-fb', CODE_ENTRY_LIMIT)
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let entry = (id, sc, extra = {}) => ({ id, kind: 'opencode', exe: fake.exe, model: 'opencode/beam-free', useStoredAuth: false, extraArgs: [`--fake-limit=${sc}`], timeoutMs: LIMIT_TMO, ...extra })

    it('無金鑰條目回errorType \'quota\': 以reason \'quota\'冷卻(視窗恆為cooldownMs)並改派下一條目成交; 下一次呼叫該條目降至鏈尾、不再先試', async function() {
        //spec: 建議檔§2-3「以額度冷卻(reason: 'quota', 固定視窗)並改派下一條目, 不等逾時」
        let store = memStore()
        let events = []
        let providers = [entry('oc:fake-quota', 'quota'), entry('oc:fake-ok', 'ok')]
        let r1 = await dispatchAiFallback('abc', { providers, cooldownMs: 600000, cooldownGrowth: 2, store, onEvent: (e) => events.push(e) })
        let cooled = events.filter((e) => e.type === 'cooled')
        let rec = store.peek().cooling['oc:fake-quota']
        let r2 = await dispatchAiFallback('abc', { providers, cooldownMs: 600000, cooldownGrowth: 2, store })
        let rr = {
            ok1: r1.ok,
            by1: r1.providerId,
            tried1: r1.tried.map((t) => [t.providerId, t.outcome, t.errorType || '', t.failureKind || '']),
            cooled: cooled.map((e) => [e.providerId, e.reason, e.cooldownMs, e.n]),
            rec: [rec.reason, rec.n],
            ok2: r2.ok,
            tried2: r2.tried.map((t) => t.providerId),
        }
        assert.strict.deepEqual(rr, {
            ok1: true,
            by1: 'oc:fake-ok',
            tried1: [['oc:fake-quota', 'skip-group', 'quota', 'no-credit'], ['oc:fake-ok', 'ok', '', '']], //整組跳過(與金鑰無關; 外審terra #7)
            cooled: [['oc:fake-quota', 'quota', 600000, 1]],
            rec: ['quota', 1],
            ok2: true,
            tried2: ['oc:fake-ok'],
        })
    })

    it('內建觸發先於coolDetect: 呼叫端coolDetect恆回true時, quota結果之冷卻原因仍為\'quota\'(固定視窗), 非\'detect\'', async function() {
        //spec: dispatchAiFallback檔頭「內建先判、未命中才呼叫coolDetect」; 【轉接器回報之額度用盡】「先於coolDetect判定」
        let events = []
        let calls = 0
        await dispatchAiFallback('abc', {
            providers: [entry('oc:fake-quota', 'quota'), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            coolDetect: () => {
                calls++
                return true
            },
            onEvent: (e) => events.push(e),
        })
        assert.strict.deepEqual([events.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason]), calls], [[['oc:fake-quota', 'quota']], 0])
    })

    it('有期限(budgetMs)且條目maxRetries 2: 判中者不重試(只送一次, attempts 1), 隨即改派', async function() {
        //spec: 「兩者該次皆不重試」——遞補層有期限時重試由runExecCli接管(R-COOL-4), 判中亦須停止
        let spawns = 0
        let r = await dispatchAiFallback('abc', {
            providers: [entry('oc:fake-quota', 'quota', { maxRetries: 2, retryDelayMs: 100 }), entry('oc:fake-ok', 'ok')],
            budgetMs: 120000,
            onTrace: (e) => {
                if (e.type === 'spawn') {
                    spawns++
                }
            },
        })
        let rr = [r.ok, r.providerId, r.tried[0].errorType, spawns]
        assert.strict.deepEqual(rr, [true, 'oc:fake-ok', 'quota', 2])
    })

    it('cooldownMs為0(未啟用冷卻): 仍改派下一條目成交, 不寫冷卻、無cooled事件', async function() {
        //spec: 「改派下一條目, 不等逾時」不以冷卻為前提(冷卻為選用, cooldownMs>0才啟用)
        let events = []
        let r = await dispatchAiFallback('abc', { providers: [entry('oc:fake-quota', 'quota'), entry('oc:fake-ok', 'ok')], onEvent: (e) => events.push(e) })
        let rr = [r.ok, r.providerId, r.tried[0].errorType, events.filter((e) => e.type === 'cooled').length]
        assert.strict.deepEqual(rr, [true, 'oc:fake-ok', 'quota', 0])
    })

    it('免費層429(failureKind \'rate-limit\'): 走既有限流冷卻(reason \'rate-limit\')並改派', async function() {
        //spec: 派工〈本輪範圍〉2「429限流 ⇒ 依本套件既有之限流分類」; dispatchAiFallback檔頭【failureKind處置】rate-limit
        let events = []
        let r = await dispatchAiFallback('abc', { providers: [entry('oc:fake-rate', 'rate'), entry('oc:fake-ok', 'ok')], cooldownMs: 600000, onEvent: (e) => events.push(e) })
        let rr = [r.ok, r.providerId, r.tried[0].errorType, r.tried[0].failureKind, events.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason])]
        assert.strict.deepEqual(rr, [true, 'oc:fake-ok', 'exec', 'rate-limit', [['oc:fake-rate', 'rate-limit']]])
    })

    it('額度用盡不計持久連敗(同整組沒額度): coolAfterFails 1時store無該條目之failStreak; 全鏈皆敗時最終結果仍為errorType \'quota\'(契約r.ok===false && r.errorType===\'quota\')', async function() {
        //spec: dispatchAiFallback檔頭【轉接器回報之額度用盡】「不計持久連敗」; 契約§3
        let store = memStore()
        let r = await dispatchAiFallback('abc', { providers: [entry('oc:fake-quota', 'quota')], cooldownMs: 600000, coolAfterFails: 1, store })
        let st = store.peek()
        let rr = [r.ok, r.errorType, r.failureKind, (st.failStreak || {})['oc:fake-quota'], st.cooling['oc:fake-quota'].reason]
        assert.strict.deepEqual(rr, [false, 'quota', 'no-credit', undefined, 'quota'])
    })

    it('有金鑰條目(keys 2把)回quota: 不試組內其他金鑰——整組跳過(skip-group)、以reason \'quota\'冷卻並改派下一條目; 未逐把確認故不標quotaExhausted', async function() {
        //spec: 建議檔§2-3「改派下一條目」; 免費池用盡與金鑰無關(providers.mjs檔頭診斷段①); dispatchAiFallback檔頭【轉接器回報之額度用盡】②⑤(外審terra #7)
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [entry('oc:fake-quota-keys', 'quota', { provider: 'opencode', keys: ['oc_sk_fakekeyaaaaaaaaaaaa1', 'oc_sk_fakekeyaaaaaaaaaaaa2'] }), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            onEvent: (e) => events.push(e),
        })
        let rr = [
            r.ok,
            r.providerId,
            events.filter((e) => e.type === 'group-exhausted').map((e) => [e.providerId, e.by, e.quotaExhausted === true]),
            r.tried.map((t) => [t.providerId, t.keyIndex, t.outcome, t.errorType || '']),
            events.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason]),
        ]
        assert.strict.deepEqual(rr, [
            true,
            'oc:fake-ok',
            [['oc:fake-quota-keys', 'skip-group', false]],
            [['oc:fake-quota-keys', 0, 'skip-group', 'quota'], ['oc:fake-ok', null, 'ok', '']],
            [['oc:fake-quota-keys', 'quota']],
        ])
    })

})
