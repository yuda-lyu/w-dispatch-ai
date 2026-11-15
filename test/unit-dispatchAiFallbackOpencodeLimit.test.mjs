import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { createQuotaGateState } from '../src/goQuotaGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import CODE_ENTRY_LIMIT from './tools/fakeOpencodeLimitForTest.mjs'


// unit-dispatchAiFallbackOpencodeLimit.test.mjs — 遞補層遇opencode免費池用盡／免費層429之處置(wda156, Gitea #156; 帳本R-OCLIMIT-1)
//
// spec(派工〈本輪範圍〉3、建議檔§2-3): dispatchAiFallback遇此結果以額度冷卻(reason 'quota', 固定視窗)改派下一條目, 不等逾時;
//   既有之quota-skip、quotaGate語意不變; 429走既有限流冷卻(reason 'rate-limit')。
// 假CLI: 只在帶--print-logs時印錯誤列、印後不結束(同真實opencode); 修前之遞補層看到的是TIMEOUT(條目逾時給LIMIT_TMO)。
// 另(wda158, Gitea #158; 帳本R-OCLIMIT-2): 訂閱(opencode-go)到頂之結果帶limitScope 'key' ⇒ 遞補層走「該把沒額度 → 換組內下一把」(不整組跳過); 免費池用盡(無limitScope)與無金鑰條目維持整組跳過。


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

    //訂閱(opencode-go)到頂(wda158, Gitea #158; 帳本R-OCLIMIT-2): 結果帶limitScope 'key' ⇒ 走「該把沒額度 → 換組內下一把」; 金鑰以子字串LIMITED／GOOD／BAD區分(假CLI依注入之OPENCODE_AUTH_CONTENT判定)
    let goEntry = (id, keys, extra = {}) => ({
        id,
        kind: 'opencode',
        provider: 'opencode-go',
        model: 'opencode-go/deepseek-v4.1-flash',
        exe: fake.exe,
        useStoredAuth: false,
        keys,
        extraArgs: ['--fake-limit=go-limit-keyed', '--fake-limited-key=LIMITED', '--fake-bad-key=BAD'],
        timeoutMs: LIMIT_TMO,
        quotaGate: false, //預設會查真實用量端點(假金鑰無意義), 關閉; 與quotaGate之合成見最後一案
        ...extra,
    })
    let K = (tag, n) => `oc_sk_fake${tag}aaaaaaaaaaaa${n}`

    it('訂閱到頂(limitScope key): 第一把金鑰到頂 ⇒ 同組換第二把並成功(不整組跳過、不寫條目冷卻、不經coolDetect、不計連敗); 未改派下一條目', async function() {
        //spec: 派工裁定(a)「走既有之該把沒額度→換組內下一把之路徑, 不整組跳過」; dispatchAiFallback檔頭【轉接器回報之額度用盡】例外①②
        let store = memStore()
        let events = []
        let coolCalls = 0
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake', [K('LIMITED', 1), K('GOOD', 2)]), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            coolAfterFails: 1,
            coolDetect: () => {
                coolCalls++
                return true
            },
            store,
            onEvent: (e) => events.push(e),
        })
        let st = store.peek()
        let rr = {
            ok: r.ok,
            by: [r.providerId, r.keyIndex],
            tried: r.tried.map((t) => [t.providerId, t.keyIndex, t.outcome, t.errorType || '', t.failureKind || '']),
            kinds: events.map((e) => e.type).filter((t) => ['skip-group', 'next-key', 'cooled', 'group-exhausted', 'ok'].includes(t)),
            coolCalls,
            cooling: Object.keys(st.cooling || {}),
            streak: Object.keys(st.failStreak || {}),
            noWorkspaceId: !/wrk_/.test(JSON.stringify(r.tried.map((t) => t.error))),
        }
        assert.strict.deepEqual(rr, {
            ok: true,
            by: ['ocgo:fake', 1],
            tried: [['ocgo:fake', 0, 'next-key', 'quota', 'no-credit'], ['ocgo:fake', 1, 'ok', '', '']],
            kinds: ['next-key', 'ok'],
            coolCalls: 0,
            cooling: [],
            streak: [],
            noWorkspaceId: true,
        })
    })

    it('訂閱到頂: 組內每一把皆到頂 ⇒ 同既有整組沒額度(group-exhausted by all-keys＋quotaExhausted、reason quota條目冷卻〔scope entry〕、QUOTA_EXHAUSTED錯誤、不計連敗), 改派下一條目成交', async function() {
        //spec: 派工裁定(a)「組內每把皆因此類到頂者, 結果與事件同既有整組沒額度」; 檔頭【failureKind處置】no-credit「組內每一把皆沒額度才標quotaExhausted」、R-COOL-2 reason 'quota'固定視窗
        let store = memStore()
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake', [K('LIMITED', 1), K('LIMITED', 2)]), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            cooldownGrowth: 2,
            coolAfterFails: 1,
            store,
            onEvent: (e) => events.push(e),
        })
        let st = store.peek()
        let ge = events.filter((e) => e.type === 'group-exhausted' && e.providerId === 'ocgo:fake')
        let cooled = events.filter((e) => e.type === 'cooled')
        let rr = {
            ok: r.ok,
            by: r.providerId,
            tried: r.tried.map((t) => [t.providerId, t.keyIndex, t.outcome, t.errorType || '']),
            ge: ge.map((e) => [e.by, e.attempted, e.keys, e.quotaExhausted === true, e.errorTypes, e.failureKinds]),
            cooled: cooled.map((e) => [e.providerId, e.scope || '', e.reason, e.failureKind || '', e.cooldownMs, e.n]),
            rec: [st.cooling['ocgo:fake'].reason, st.cooling['ocgo:fake'].n],
            streak: Object.keys(st.failStreak || {}),
        }
        assert.strict.deepEqual(rr, {
            ok: true,
            by: 'oc:fake-ok',
            tried: [['ocgo:fake', 0, 'next-key', 'quota'], ['ocgo:fake', 1, 'next-key', 'quota'], ['oc:fake-ok', null, 'ok', '']],
            ge: [['all-keys', 2, 2, true, ['quota', 'quota'], ['no-credit', 'no-credit']]],
            cooled: [['ocgo:fake', 'entry', 'quota', 'no-credit', 600000, 1]],
            rec: ['quota', 1],
            streak: [],
        })
    })

    it('訂閱到頂: 單條目鏈、每把皆到頂 ⇒ 最終結果errorType \'quota\'＋failureKind \'no-credit\'＋limitScope／limitUntil、quotaExhausted清單、error為QUOTA_EXHAUSTED(工作區代號已遮蔽)', async function() {
        //spec: 檔頭【failureKind處置】「組內每一把皆沒額度才標quotaExhausted(組盡事件與最終結果)」、最終error為QUOTA_EXHAUSTED; 契約r.ok===false && r.errorType==='quota'
        let r = await dispatchAiFallback('abc', { providers: [goEntry('ocgo:fake', [K('LIMITED', 1), K('LIMITED', 2)])] })
        let rr = [
            r.ok,
            r.errorType,
            r.failureKind,
            r.limitScope,
            r.limitWindow,
            typeof r.limitUntil,
            r.quotaExhausted,
            r.error.startsWith('QUOTA_EXHAUSTED: provider "ocgo:fake" has no credit on all 2 key(s) (AI_APICallError: OpenCode Go usage limit reached (weekly, resets in 5h 3m)'),
            /wrk_/.test(JSON.stringify([r.error, r.failureDetail, r.tried.map((t) => t.error)])),
        ]
        assert.strict.deepEqual(rr, [false, 'quota', 'no-credit', 'key', 'weekly', 'string', ['ocgo:fake'], true, false])
    })

    it('訂閱到頂: 部分到頂(第一把到頂、第二把一般失敗)不算整組沒額度——無quotaExhausted、無quota冷卻, 依既有no-credit之處置計入持久連敗', async function() {
        //spec: 檔頭【failureKind處置】no-credit「部分沒額度(其餘為限流、金鑰無效等)不算」; 【持久連敗】組盡且非整組沒額度者計一次(R-COOL-3)
        let store = memStore()
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake', [K('LIMITED', 1), K('BAD', 2)])],
            cooldownMs: 600000,
            coolAfterFails: 1,
            store,
            onEvent: (e) => events.push(e),
        })
        let st = store.peek()
        let ge = events.filter((e) => e.type === 'group-exhausted')
        let rr = [
            r.ok,
            r.errorType,
            r.quotaExhausted,
            r.tried.map((t) => [t.keyIndex, t.outcome, t.errorType || '']),
            ge.map((e) => [e.by, e.quotaExhausted === true]),
            events.filter((e) => e.type === 'cooled').map((e) => [e.reason]),
            st.failStreak['ocgo:fake'].k,
        ]
        assert.strict.deepEqual(rr, [false, 'exec', undefined, [[0, 'next-key', 'quota'], [1, 'next-key', 'exec']], [['all-keys', false]], [['streak']], 1])
    })

    it('免費池用盡(無limitScope)即使為opencode-go條目且有多把金鑰, 仍整組跳過(skip-group)、以reason \'quota\'冷卻並改派; 不標quotaExhausted(1.0.95語意不變)', async function() {
        //spec: 派工〈不得改變〉「免費池用盡之結果形狀不變」與裁定(a)「limitScope非key者維持整組跳過」; R-OCLIMIT-1第8點(免費池用盡與金鑰無關)
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake-free', [K('GOOD', 1), K('GOOD', 2)], { extraArgs: ['--fake-limit=quota'] }), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            onEvent: (e) => events.push(e),
        })
        let rr = [
            r.ok,
            r.providerId,
            r.tried.map((t) => [t.providerId, t.keyIndex, t.outcome, t.errorType || '']),
            events.filter((e) => e.type === 'group-exhausted').map((e) => [e.providerId, e.by, e.quotaExhausted === true]),
            events.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason]),
        ]
        assert.strict.deepEqual(rr, [
            true,
            'oc:fake-ok',
            [['ocgo:fake-free', 0, 'skip-group', 'quota'], ['oc:fake-ok', null, 'ok', '']],
            [['ocgo:fake-free', 'skip-group', false]],
            [['ocgo:fake-free', 'quota']],
        ])
    })

    it('訂閱到頂之結果但條目無金鑰(nk 0, 如登入態): 無「下一把」可換, 維持整組跳過與reason \'quota\'冷卻(1.0.95語意)', async function() {
        //spec: 檔頭【轉接器回報之額度用盡】例外之適用範圍「條目有金鑰」; 無金鑰者維持整組跳過
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake-nokey', undefined, { extraArgs: ['--fake-limit=go-limit'], keys: undefined }), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            onEvent: (e) => events.push(e),
        })
        let rr = [r.ok, r.providerId, r.tried.map((t) => [t.providerId, t.outcome, t.errorType || '']), events.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason])]
        assert.strict.deepEqual(rr, [true, 'oc:fake-ok', [['ocgo:fake-nokey', 'skip-group', 'quota'], ['oc:fake-ok', 'ok', '']], [['ocgo:fake-nokey', 'quota']]])
    })

    it('訂閱到頂之結果但條目未給provider(金鑰未注入, 各把沿用同一份登入態): 換鑰無意義, 維持整組跳過(不逐把空試、不標quotaExhausted)', async function() {
        //spec: dispatchAiFallback檔頭【轉接器回報之額度用盡】例外之適用範圍「條目給了provider(金鑰只在key與provider皆有效時才注入)」(外審terra #1)
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake-noprov', [K('GOOD', 1), K('GOOD', 2)], { provider: undefined, extraArgs: ['--fake-limit=go-limit'] }), entry('oc:fake-ok', 'ok')],
            onEvent: (e) => events.push(e),
        })
        let rr = [
            r.ok,
            r.providerId,
            r.tried.map((t) => [t.providerId, t.keyIndex, t.outcome, t.errorType || '']),
            events.filter((e) => e.type === 'group-exhausted').map((e) => [e.by, e.quotaExhausted === true]),
        ]
        assert.strict.deepEqual(rr, [true, 'oc:fake-ok', [['ocgo:fake-noprov', 0, 'skip-group', 'quota'], ['oc:fake-ok', null, 'ok', '']], [['skip-group', false]]])
    })

    it('訂閱到頂但樹狀終止失敗而等到逾時(error以TIMEOUT開頭、errorType仍為quota): 仍依錯誤列判為該把之額度——換第二把成功, 不當逾時整組跳過、不以timeout冷卻', async function() {
        //spec: 檔頭【轉接器回報之額度用盡】例外「isKeyQuota先於isKeyIndependentFail, 即使error以TIMEOUT開頭仍換下一把」(外審terra #2);
        //  假CLI go-limit-orphan: 根行程先結束、孫行程後印到頂列, 轉接器之taskkill打在已不存在之pid上而失敗, 只能等execCli之逾時
        let store = memStore()
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [goEntry('ocgo:fake-orphan', [K('LIMITED', 1), K('GOOD', 2)], { extraArgs: ['--fake-limit=go-limit-orphan', '--fake-limited-key=LIMITED'], timeoutMs: 3000 }), entry('oc:fake-ok', 'ok')],
            cooldownMs: 600000,
            store,
            onEvent: (e) => events.push(e),
        })
        let t0 = r.tried[0]
        let rr = {
            ok: r.ok,
            by: [r.providerId, r.keyIndex],
            first: [t0.outcome, t0.errorType, t0.failureKind, String(t0.error).indexOf('TIMEOUT') === 0],
            kinds: events.map((e) => e.type).filter((t) => ['skip-group', 'next-key', 'cooled', 'group-exhausted'].includes(t)),
            cooling: Object.keys((store.peek() || {}).cooling || {}),
        }
        assert.strict.deepEqual(rr, {
            ok: true,
            by: ['ocgo:fake-orphan', 1],
            first: ['next-key', 'quota', 'no-credit', true],
            kinds: ['next-key'],
            cooling: [],
        })
    })

    it('訂閱到頂與quotaGate略過併入同一組盡判定: 第一把由quotaGate(用量端點回limited)略過、第二把實際到頂 ⇒ 整組沒額度(quotaExhausted、QUOTA_EXHAUSTED)', async function() {
        //spec: 檔頭【failureKind處置】「組內每一把皆沒額度(本次嘗試失敗, 或本次呼叫內已證實而略過)才標quotaExhausted」(外審terra #9: 刪去略過併入noCreditIdx時舊斷言仍綠)
        let events = []
        let gateState = createQuotaGateState()
        let keys = [K('GOOD', 1), K('LIMITED', 2)]
        let usage = async ({ key }) => ({ ok: true, usage: { weekly: key === keys[0] ? { status: 'rate-limited', percent: 100, resetsAt: new Date(Date.now() + 3600000).toISOString() } : { percent: 10 } } })
        let r = await dispatchAiFallback('abc', { providers: [goEntry('ocgo:fake', keys, { quotaGate: { usage, state: gateState } })], onEvent: (e) => events.push(e) })
        let rr = [
            r.ok,
            r.tried.map((t) => [t.keyIndex, t.outcome]),
            events.filter((e) => e.type === 'group-exhausted').map((e) => [e.by, e.attempted, e.quotaExhausted === true]),
            r.quotaExhausted,
            r.error.startsWith('QUOTA_EXHAUSTED: provider "ocgo:fake" has no credit on all 2 key(s)'),
        ]
        assert.strict.deepEqual(rr, [false, [[0, 'quota-skip'], [1, 'next-key']], [['all-keys', 1, true]], ['ocgo:fake'], true])
    })

    it('與quotaGate合成: 到頂之金鑰於其後之呼叫由quotaGate(用量端點回limited)略過、不送請求, 直接用第二把', async function() {
        //spec: 檔頭【failureKind處置】用量門檻之略過併入noCreditIdx; 派前之檢查(quotaGate)與中途到頂之處置(本層換鑰)互補(建議檔第1節「派前之檢查擋得住已到頂者」)
        let store = memStore()
        let gateState = createQuotaGateState()
        let limited = new Set()
        let usage = async ({ key }) => ({ ok: true, usage: { weekly: limited.has(key) ? { status: 'rate-limited', percent: 100, resetsAt: new Date(Date.now() + 3600000).toISOString() } : { percent: 10 } } })
        let keys = [K('LIMITED', 1), K('GOOD', 2)]
        let clock = Date.now() //quotaGate之注入時鐘(now): 以推進時鐘令快取過期, 不以延時等待(計時器相關測試以事件／假時鐘同步)
        let mk = () => goEntry('ocgo:fake', keys, { quotaGate: { usage, state: gateState, now: () => clock } })
        let r1 = await dispatchAiFallback('abc', { providers: [mk()], store })
        limited.add(keys[0])
        clock += 120000 //越過預設cacheMs 60000, 閘門重查用量端點
        let events = []
        let r2 = await dispatchAiFallback('abc', { providers: [mk()], store, onEvent: (e) => events.push(e) })
        let rr = [
            [r1.ok, r1.tried.map((t) => [t.keyIndex, t.outcome])],
            [r2.ok, r2.keyIndex, r2.tried.map((t) => [t.keyIndex, t.outcome]), events.filter((e) => e.type === 'quota-skip').map((e) => [e.keyIndex, e.source])],
        ]
        assert.strict.deepEqual(rr, [
            [true, [[0, 'next-key'], [1, 'ok']]],
            [true, 1, [[0, 'quota-skip'], [1, 'ok']], [[0, 'usage-api']]],
        ])
    })

})
