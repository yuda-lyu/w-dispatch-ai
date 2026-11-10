import assert from 'assert'
import dispatchAiFallback, * as fallbackNs from '../src/dispatchAiFallback.mjs'
import { createGateState } from '../src/cliSpawnGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-dispatchAiFallbackBudgetCut — 封頂逾時budget-cut、提前返回帶quotaExhausted、預算檢查先於額度閘
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-1～DA-3、§5.2〈DA〉; 帳本 sgud/rule/rulebook_cooling.md R-COOL-1)
//
// 判定以 tried、事件、store 內容與替身伺服器之收件數為準, 不以牆鐘斷言。
// 【真時間】標記之describe使用真實之逾時(本機替身伺服器收件後不回應, 由轉接器逾時; 計時器規格P6): 斷言只依「是否被期限封頂」之因果,
//   負載只使嘗試更晚結束(剩餘更少), 不改變判定; 唯DA-1③(差額邊界之整合)以300ms以上之裕度避開時差。


//memStore, 記憶體store(同dispatchAiFallback之store契約)
function memStore(init = { cursors: {}, cooling: {} }) {
    let st = init
    return {
        get: () => st,
        set: (s) => {
            st = s
        },
        peek: () => st,
    }
}

//goBlocked, OpenCode Go條目且用量達門檻(注入之usage)→ 該把金鑰quota-skip、整組沒額度(quotaExhausted)
function goBlocked(id, key, fake) {
    return {
        id,
        kind: 'opencode',
        provider: 'opencode-go',
        model: 'opencode-go/x',
        exe: fake.exe,
        keys: [key],
        quotaGate: { usage: async () => ({ ok: true, usage: { rolling: { percent: 99, resetsAt: new Date(Date.now() + 3600000).toISOString() } } }) },
    }
}


describe('dispatchAiFallback 封頂逾時(budget-cut)與提前返回(da402 DA-1～3)', function() {

    let srv = null
    let fake = null
    before(async function() {
        srv = await fakeServerForDeadlineTest()
        fake = createFakeCli('fake-di402-budgetcut')
    })
    after(async function() {
        await srv.close()
        fake.clean()
    })

    let rest = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: ['sk-test-di402'], ...extra })

    describe('judgeBudgetCut(判定式之邊界, 純函數)', function() {

        //設計DA-1③: 差額 minAttemptMs−1 與 minAttemptMs 兩點; 整鏈已用盡(剩餘 < minAttemptMs)與標記為必要條件
        it('差額恰為minAttemptMs為budget-cut, minAttemptMs−1則否; 未標記、非逾時、整鏈未用盡皆否', function() {
            let judgeBudgetCut = fallbackNs.judgeBudgetCut //以命名空間取用(修前版本無此匯出時本案單獨失敗, 不使整檔載入失敗)
            let base = { timeoutLike: true, cutByDeadline: true, remainingMs: 0, entryTimeoutMs: 3000, minAttemptMs: 200 }
            let r = [
                judgeBudgetCut({ ...base, appliedTimeoutMs: 2800 }), //差額200 = minAttemptMs
                judgeBudgetCut({ ...base, appliedTimeoutMs: 2801 }), //差額199 = minAttemptMs−1
                judgeBudgetCut({ ...base, appliedTimeoutMs: 1500, cutByDeadline: false }),
                judgeBudgetCut({ ...base, appliedTimeoutMs: 1500, timeoutLike: false }),
                judgeBudgetCut({ ...base, appliedTimeoutMs: 1500, remainingMs: 200 }), //剩餘恰為minAttemptMs: 整鏈未用盡
                judgeBudgetCut({ ...base, appliedTimeoutMs: 1500, remainingMs: 199 }),
                judgeBudgetCut({ ...base, appliedTimeoutMs: null }),
            ]
            assert.strict.deepEqual(r, [true, false, false, false, false, true, false])
        })

    })

    describe('[真時間] DA-1 封頂逾時', function() {

        //設計DA-1①(探測P1): 條目3000／預算1500／minAttemptMs 200 → budget, tried為budget-cut, 不發skip-group／group-exhausted;
        //鏈首例外: cooled之reason為budget且n不動(預寫n 3)
        it('① 鏈首被封頂: errorType budget、tried為budget-cut(帶appliedTimeoutMs與entryTimeoutMs)、無skip-group與group-exhausted、鏈首例外之cooled為budget且n不動', async function() {
            let store = memStore({ cursors: {}, cooling: { 'p1:hang': { at: Date.now() - 7200000, n: 3, reason: 'timeout' } } })
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [rest('p1:hang', 'hang:da1-1', { timeoutMs: 3000 })],
                budgetMs: 1500,
                minAttemptMs: 200,
                cooldownMs: 300000,
                store,
                onEvent: (e) => ev.push(e),
            })
            let t0 = r.tried[0]
            let cooled = ev.filter((e) => e.type === 'cooled')
            assert.strict.deepEqual(
                [r.ok, r.errorType, r.error, r.tried.map((t) => t.outcome), t0.errorType, t0.entryTimeoutMs, t0.appliedTimeoutMs <= 1500, t0.error.indexOf('TIMEOUT') === 0],
                [false, 'budget', 'budget exhausted', ['budget-cut'], 'timeout', 3000, true, true],
            )
            assert.strict.deepEqual(ev.filter((e) => ['skip-group', 'group-exhausted', 'next-key'].includes(e.type)).length, 0)
            assert.strict.deepEqual(ev.filter((e) => e.type === 'budget-cut').length, 1)
            assert.strict.deepEqual(cooled.map((e) => [e.reason, e.n]), [['budget', 3]])
            assert.strict.deepEqual([store.peek().cooling['p1:hang'].n, store.peek().cooling['p1:hang'].reason], [3, 'budget'])
        })

        //設計DA-1②(opus#27: 修前回傳亦為budget, 須以tried與cooled分出): [hang 3000, ok]、預算1500 → budget、ok未試、tried[0]為budget-cut、無reason非budget之cooled
        it('② [hang, ok]: 回budget、ok未被嘗試、tried[0]為budget-cut、無reason非budget之cooled', async function() {
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [rest('p2:hang', 'hang:da1-2', { timeoutMs: 3000 }), rest('p2:ok', 'ok:da1-2')],
                budgetMs: 1500,
                minAttemptMs: 200,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => [t.providerId, t.outcome]), srv.requests['ok:da1-2'] || 0], ['budget', [['p2:hang', 'budget-cut']], 0])
            assert.strict.deepEqual(ev.filter((e) => e.type === 'cooled' && e.reason !== 'budget').length, 0)
        })

        //設計DA-1③(opus#27、探測P2之邊界政策): 兩家各2000、預算3700、minAttemptMs 600 → 第二家被封頂約300ms(差額 < minAttemptMs) → 照條目自己之逾時(冷卻、組盡、timeout)
        //修前亦同(本案為「邊界不得過度判為封頂」之守門, 非修前紅之案); 裁量: 負載使第一家晚結束δ時差額為300+δ, δ>300ms才翻轉
        it('③ 末家被封頂之差額 < minAttemptMs: 照條目自己之逾時(skip-group、cooled reason timeout、group-exhausted、最終timeout)', async function() {
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [rest('p3:a', 'hang:da1-3a', { timeoutMs: 2000 }), rest('p3:b', 'hang:da1-3b', { timeoutMs: 2000 })],
                budgetMs: 3700,
                minAttemptMs: 600,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            assert.strict.deepEqual(
                [r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason]), ev.filter((e) => e.type === 'group-exhausted').map((e) => e.providerId)],
                ['timeout', ['skip-group', 'skip-group'], [['p3:a', 'timeout'], ['p3:b', 'timeout']], ['p3:a', 'p3:b']],
            )
        })

        //設計DA-1④(terra#12): 呼叫端自給spawnGate.deadlineAt縮短該次逾時而遞補層剩餘充足 → 照一般逾時(非封頂)
        it('④ 呼叫端自給spawnGate.deadlineAt使逾時縮短(遞補層剩餘充足): 照一般逾時(skip-group、cooled reason timeout)', async function() {
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [{
                    id: 'p4:cli',
                    kind: 'claude',
                    exe: fake.exe,
                    extraArgs: ['--fake-sleep=8000'],
                    timeoutMs: 10000,
                    spawnGate: { maxCli: 2, ramUsedMax: false, cpuMax: false, countCli: async () => 0, state: createGateState(), ticketDir: false, deadlineAt: Date.now() + 700 },
                }],
                budgetMs: 30000,
                minAttemptMs: 200,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            assert.strict.deepEqual(
                [r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'cooled').map((e) => e.reason)],
                ['timeout', ['skip-group'], ['timeout']],
            )
        })

        //設計DA-1②之「由封頂發生處標記」(terra#12): 呼叫端自給之spawnGate.deadlineAt早於遞補層期限50ms, 嘗試結束時整鏈亦已用盡(剩餘 < minAttemptMs)——
        //逾時由呼叫端期限決定, 不得標記為遞補層封頂, 照一般逾時(本案令「整鏈用盡」條件成立, 單獨驗證標記之callerBound; 變異M26)
        it('④\' 呼叫端期限略早於遞補層期限且整鏈已用盡: 仍照一般逾時(標記不由呼叫端期限產生)', async function() {
            let ev = []
            let now = Date.now()
            let r = await dispatchAiFallback('abc', {
                providers: [{
                    id: 'p4b:cli',
                    kind: 'claude',
                    exe: fake.exe,
                    extraArgs: ['--fake-sleep=8000'],
                    timeoutMs: 10000,
                    spawnGate: { maxCli: 2, ramUsedMax: false, cpuMax: false, countCli: async () => 0, state: createGateState(), ticketDir: false, deadlineAt: now + 900 },
                }],
                budgetMs: 950,
                minAttemptMs: 200,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'budget-cut').length], ['timeout', ['skip-group'], 0])
        })

        //設計DA-1⑤(opus#14): maxRetries 1, 首次跑滿條目逾時、次次被期限切短 → 條目已有足額證據, 照一般逾時
        it('⑤ maxRetries 1: 首次跑滿條目逾時、重試被期限切短 → 照一般逾時(skip-group、timeout), 收件2', async function() {
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [rest('p5:hang', 'hang:da1-5', { timeoutMs: 1000, maxRetries: 1, retryDelayMs: 50 })],
                budgetMs: 1500,
                minAttemptMs: 100,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            //收件恰為2(外審terra T02: 須確實走到「前次足額、末次被切」): 首次跑滿1000後剩約450, 退避50後重試以約400封頂; 首次結束延遲逾約300ms才會不重試
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'cooled').map((e) => e.reason), srv.requests['hang:da1-5']], ['timeout', ['skip-group'], ['timeout'], 2])
        })

        //鏈首例外之「第一個實際嘗試」不含未送出之參數失敗(外審terra F04): 前一條目為未知kind(params, 未送出), 被封頂之掛起條目仍為鏈首 → reason budget降序
        it('⑧ 前一條目為參數失敗(未送出)時, 被封頂者仍屬第一個實際嘗試 → 鏈首例外之cooled reason budget', async function() {
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [{ id: 'p8:bad', kind: 'no-such-kind' }, rest('p8:hang', 'hang:da1-8', { timeoutMs: 3000 })],
                budgetMs: 1000,
                minAttemptMs: 200,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.reason])], ['budget', ['skip-group', 'budget-cut'], [['p8:hang', 'budget']]])
        })

        //設計DA-1⑥(terra#14): 驗證等待逾時(與被封頂之嘗試共用時限)→ budget
        it('⑥ 被封頂之嘗試中驗證等待逾時: budget-cut(修前為validation之skip-group)', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [rest('p6:ok', 'ok:da1-6', { timeoutMs: 3000, validate: () => new Promise(() => {}) })],
                budgetMs: 1000,
                minAttemptMs: 200,
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => [t.outcome, t.errorType])], ['budget', [['budget-cut', 'validation']]])
        })

        //設計DA-1⑦(opus#2, 不退化): 鏈首被封頂而次次呼叫 → 鏈首以reason budget降序, 第二次呼叫之tried[0]為遞補
        it('⑦ 鏈首被封頂後之下一次呼叫: tried[0]為遞補(鏈首以reason budget降序一個固定視窗)', async function() {
            let store = memStore()
            let opt = { budgetMs: 1000, minAttemptMs: 200, cooldownMs: 300000, store }
            let ev1 = []
            let r1 = await dispatchAiFallback('abc', { ...opt, providers: [rest('p7:head', 'hang:da1-7', { timeoutMs: 3000 }), rest('p7:fb', 'ok:da1-7')], onEvent: (e) => ev1.push(e) })
            let r2 = await dispatchAiFallback('abc', { ...opt, providers: [rest('p7:head', 'hang:da1-7', { timeoutMs: 3000 }), rest('p7:fb', 'ok:da1-7')] })
            assert.strict.deepEqual(
                [r1.errorType, ev1.filter((e) => e.type === 'cooled').map((e) => e.reason), r2.ok, r2.tried[0].providerId],
                ['budget', ['budget'], true, 'p7:fb'],
            )
        })

    })

    describe('DA-2 提前返回帶已累積之quotaExhausted', function() {

        //設計DA-2(terra#27): 先一條目整組沒額度, 再分別觸發budget-out、budget-cut、嘗試之間中止、守門中止 → 皆帶quotaExhausted(修前皆無)
        it('[真時間] budget-out: 帶quotaExhausted', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [goBlocked('q1:go', 'go-key-di402-q1', fake), rest('q1:hang', 'hang:da2-1', { timeoutMs: 300 }), rest('q1:ok', 'ok:da2-1')],
                budgetMs: 600,
                minAttemptMs: 400,
            })
            assert.strict.deepEqual([r.errorType, r.tried[r.tried.length - 1].outcome, r.quotaExhausted], ['budget', 'budget-out', ['q1:go']])
        })

        //額度閘「之後」之budget-out(外審terra T01): 第二個Go條目之用量查詢慢於剩餘預算 → 等候以剩餘預算截斷 → 閘後之期限檢查budget-out, 亦帶quotaExhausted
        it('[真時間] 額度閘之後之budget-out: 帶quotaExhausted', async function() {
            let slowGo = { id: 'q5:go', kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/x', exe: fake.exe, keys: ['go-key-di402-q5'], quotaGate: { usage: () => new Promise((resolve) => setTimeout(() => resolve({ ok: false, errorType: 'network', code: null, error: 'x' }), 1500)) } }
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [goBlocked('q5:blk', 'go-key-di402-q5b', fake), slowGo],
                budgetMs: 400,
                minAttemptMs: 100,
                onEvent: (e) => ev.push(e),
            })
            let bo = ev.filter((e) => e.type === 'budget-out')
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), r.quotaExhausted, bo.length, bo[0].remainingMs < 100], ['budget', ['quota-skip', 'budget-out'], ['q5:blk'], 1, true])
        })

        it('[真時間] budget-cut: 帶quotaExhausted', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [goBlocked('q2:go', 'go-key-di402-q2', fake), rest('q2:hang', 'hang:da2-2', { timeoutMs: 3000 }), rest('q2:ok', 'ok:da2-2')],
                budgetMs: 800,
                minAttemptMs: 200,
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), r.quotaExhausted], ['budget', ['quota-skip', 'budget-cut'], ['q2:go']])
        })

        it('嘗試之間中止(shouldStop): 帶quotaExhausted', async function() {
            let n = 0
            let r = await dispatchAiFallback('abc', {
                providers: [goBlocked('q3:go', 'go-key-di402-q3', fake), rest('q3:ok', 'ok:da2-3')],
                shouldStop: () => ++n >= 2, //第一個條目進門時為false, 第二個條目進門時為true
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), r.quotaExhausted, srv.requests['ok:da2-3'] || 0], ['aborted', ['quota-skip', 'aborted'], ['q3:go'], 0])
        })

        it('守門等待中止(cliSpawnGate回aborted): 帶quotaExhausted', async function() {
            let n = 0
            let t = 0
            let r = await dispatchAiFallback('abc', {
                providers: [
                    goBlocked('q4:go', 'go-key-di402-q4', fake),
                    {
                        id: 'q4:cli',
                        kind: 'claude',
                        exe: fake.exe,
                        spawnGate: {
                            maxCli: 1,
                            ramUsedMax: false,
                            cpuMax: false,
                            countCli: async () => 9,
                            pollMs: 50,
                            gateWaitMaxMs: 100000,
                            now: () => t,
                            sleep: async (ms) => {
                                t += ms
                            },
                            state: createGateState(),
                            ticketDir: false
                        },
                    },
                ],
                shouldStop: () => ++n >= 3, //兩個條目進門時皆為false, 守門等待中轉為true
            })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome), r.quotaExhausted], ['aborted', ['quota-skip', 'aborted'], ['q4:go']])
        })

    })

    describe('DA-3 預算檢查先於額度閘', function() {

        //設計DA-3(terra#15): 剩餘不足一次最低嘗試時不等候用量查詢(查詢次數0)、回budget-out(修前先查用量)
        it('預算100、minAttemptMs 5000、條目為ocgo: → 用量查詢0次、budget-out', async function() {
            let calls = 0
            let r = await dispatchAiFallback('abc', {
                providers: [{
                    id: 'g1:go',
                    kind: 'opencode',
                    provider: 'opencode-go',
                    model: 'opencode-go/x',
                    exe: fake.exe,
                    keys: ['go-key-di402-g1'],
                    quotaGate: {
                        usage: async () => {
                            calls++; throw new Error('should not query')
                        }
                    }
                }],
                budgetMs: 100,
                minAttemptMs: 5000,
            })
            assert.strict.deepEqual([calls, r.errorType, r.tried.map((t) => t.outcome)], [0, 'budget', ['budget-out']])
        })

        //設計DA-3＋D11甲: 預算0(已無時間)→ 用量查詢0次、不送出、budget-out(修前0＝不限: 先查用量再派出)
        it('預算0、條目為ocgo: → 用量查詢0次、不送出、budget-out', async function() {
            let calls = 0
            let r = await dispatchAiFallback('abc', {
                providers: [{
                    id: 'g2:go',
                    kind: 'opencode',
                    provider: 'opencode-go',
                    model: 'opencode-go/x',
                    exe: fake.exe,
                    keys: ['go-key-di402-g2'],
                    spawnGate: false,
                    quotaGate: {
                        usage: async () => {
                            calls++; return { ok: false, errorType: 'network', code: null, error: 'x' }
                        }
                    }
                }],
                budgetMs: 0,
            })
            assert.strict.deepEqual([calls, r.ok, r.errorType, r.tried.map((t) => t.outcome)], [0, false, 'budget', ['budget-out']])
        })

    })

})
