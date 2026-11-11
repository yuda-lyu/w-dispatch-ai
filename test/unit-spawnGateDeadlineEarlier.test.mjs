import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import runExecCli from '../src/runExecCli.mjs'
import cliSpawnGate, { resolveSpawnGate, createGateState } from '../src/cliSpawnGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-spawnGateDeadlineEarlier — 呼叫端自給之 spawnGate.deadlineAt 與遞補層期限(budgetMs 換算)取較早者
// (排程第417項, 主控裁示甲; 承第402項外審 F11〔呼叫端給較晚之期限可令守門等待越過遞補層之 budgetMs, 放行後首次 spawn 沿用先前算出之逾時〕;
//  帳本 sgud/rule/rulebook_cooling.md R-COOL-1 第1點、R-COOL-5; 先前之優先序見 Gitea #67 及 sgud/rule/rulebook_spawngate.md)
//
// 規格句(主控派工):
//   S1 兩者皆有時取較早者; 呼叫端較晚 → 守門等待不越過遞補層期限、spawn 之逾時以遞補層剩餘封頂
//   S2 呼叫端較早 → 照用呼叫端(保持)
//   S3 只給呼叫端、遞補層無期限 → 照用呼叫端(保持)
//   S4 封頂之標記依取早後之來源: 被呼叫端較早期限切短者不算 budget-cut, 被遞補層切短者算
//   S5 minAttemptMs 與 shouldStop 之優先序不變(spawnGate 物件優先)
// 同步點: 守門等待以注入之假時鐘(不耗真實時間)與 gate 觀察回調 onTrace 之 fail-open 事件斷言; spawn 之逾時值以 execCli 結果 error「TIMEOUT after Ns」所示之逾時值斷言上界
// (逾時值 = 期限 − 呼叫當下, 恆 ≤ 期限 − 呼叫前之基準時刻, 不受負載影響)。標【真時間】之案使用真實之逾時(假 CLI 睡滿數秒), 斷言只依「逾時值之上界」之因果, 負載只使其更小。


//fakeClock, 假時鐘(固定起點; sleep 只推進時鐘並立即 resolve, 不耗真實時間)
function fakeClock(t0) {
    let t = t0
    return {
        now: () => t,
        sleep: async (ms) => {
            t += ms
        },
    }
}

//lazyClock, 假時鐘: 首次被讀取(守門起算)時取真實時刻為起點, 其後只由 sleep 推進(不耗真實時間); 令守門等待之長度由「期限 − 守門起算時刻」決定而與負載無關
function lazyClock() {
    let t = null
    let init = () => {
        if (t === null) {
            t = Date.now()
        }
    }
    return {
        now: () => {
            init()
            return t
        },
        sleep: async (ms) => {
            init()
            t += ms
        },
    }
}

//gateObj, 組 spawnGate 物件(只限行程數, 計數固定; 關閉放行最小間隔與預約票)
function gateObj(extra = {}) {
    return {
        maxCli: 2,
        ramUsedMax: false,
        cpuMax: false,
        minGapMs: false,
        pollMs: 100,
        gateWaitMaxMs: 100000,
        countCli: async () => 0,
        state: createGateState(),
        ticketDir: false,
        ...extra,
    }
}

//appliedMs, 自 execCli 之逾時結果取該次 spawn 實際套用之逾時毫秒(error 為「TIMEOUT after 0.795s」)
function appliedMs(r) {
    let m = /^TIMEOUT after ([\d.]+)s/.exec(String(r.error))
    return m ? Math.round(Number(m[1]) * 1000) : null
}

//memStore, 記憶體 store(同 dispatchAiFallback 之 store 契約)
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


describe('呼叫端 spawnGate.deadlineAt 與遞補層期限取較早者(第417項)', function() {

    this.timeout(60000)

    let fake = null
    before(function() {
        fake = createFakeCli('fake-di417-deadline')
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    describe('resolveSpawnGate: 兩來源之取法(純函數)', function() {

        //S1、S2、S3: 兩者皆有效取較早者; 只有一者有效用該者; 相等取該值
        it('S1～S3 呼叫端物件與呼叫層提示皆有效 → 取較早者(較晚者在物件、在提示各一例); 只有一者有效用該者; 相等為該值', function() {
            let at = (spawnGate, hint) => resolveSpawnGate({ kind: 'opencode', spawnGate, deadlineAt: hint, cores: 4 }).deadlineAt
            assert.strict.deepEqual(
                [
                    at({ deadlineAt: 9000 }, 5000), //呼叫端較晚 → 提示(遞補層)
                    at({ deadlineAt: 3000 }, 5000), //呼叫端較早 → 呼叫端
                    at({ deadlineAt: 3000 }, undefined), //只給呼叫端 → 呼叫端
                    at({}, 5000), //只給提示 → 提示
                    at({ deadlineAt: 4000 }, 4000), //相等
                    at({ deadlineAt: '9000' }, 5000), //數字字串收下後比較
                ],
                [5000, 3000, 3000, 5000, 4000, 5000],
            )
        })

        //S1 延伸: 一來源非法不遮蔽另一來源(修前物件之非法值使有效之提示被忽略)
        it('一來源非法(非正數、非數字)視為無, 不遮蔽另一來源之有效值; 皆非法為 null', function() {
            let at = (spawnGate, hint) => resolveSpawnGate({ kind: 'opencode', spawnGate, deadlineAt: hint, cores: 4 }).deadlineAt
            assert.strict.deepEqual(
                [at({ deadlineAt: 'x' }, 5000), at({ deadlineAt: -1 }, 5000), at({ deadlineAt: 3000 }, 'x'), at({ deadlineAt: 3000 }, -1), at({ deadlineAt: 'x' }, 'y'), at({ deadlineAt: null }, 5000)],
                [5000, 5000, 3000, 3000, null, 5000],
            )
        })

        //S5: minAttemptMs 與 shouldStop 之優先序不變(物件優先)
        it('S5 minAttemptMs 與 shouldStop 仍為 spawnGate 物件優先(本項只動 deadlineAt)', function() {
            let f1 = () => true
            let f2 = () => false
            let d = resolveSpawnGate({ kind: 'opencode', shouldStop: f1, deadlineAt: 5000, minAttemptMs: 300, spawnGate: { shouldStop: f2, deadlineAt: 7000, minAttemptMs: 100 }, cores: 4 })
            assert.strict.deepEqual([d.shouldStop === f2, d.minAttemptMs], [true, 100])
            let e = resolveSpawnGate({ kind: 'opencode', shouldStop: f1, minAttemptMs: 300, spawnGate: { minAttemptMs: 'x' }, cores: 4 })
            assert.strict.deepEqual([e.shouldStop === f1, e.minAttemptMs], [true, 20000]) //物件之 minAttemptMs 非法 → 沿用既有行為(取預設, 不退用提示之300); 本項不改
        })
    })

    describe('cliSpawnGate: 守門等待(假時鐘, 不耗真實時間)', function() {

        //S1: 呼叫端較晚 → 等待到「遞補層期限 − minAttemptMs」即 fail-open(修前物件優先, 等到 gateWaitMaxMs)
        it('S1 呼叫端期限較晚: 等待不越過遞補層期限 − minAttemptMs(fail-open, waitedMs 400); 修前等到 gateWaitMaxMs', async function() {
            let clock = fakeClock(1000)
            let ev = []
            let sg = gateObj({ countCli: async () => 9, now: clock.now, sleep: clock.sleep, gateWaitMaxMs: 100000, deadlineAt: 1000 + 90000, minAttemptMs: 200, onTrace: (e) => ev.push(e) })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: sg, deadlineAt: 1000 + 600 })
            assert.strict.deepEqual([r.outcome, r.waitedMs, ev.filter((e) => e.type === 'fail-open').length], ['fail-open', 400, 1])
        })

        //S2: 呼叫端較早 → 照用呼叫端(保持)
        it('S2 呼叫端期限較早: 照用呼叫端(waitedMs 400), 提示之寬裕期限不放寬', async function() {
            let clock = fakeClock(1000)
            let sg = gateObj({ countCli: async () => 9, now: clock.now, sleep: clock.sleep, gateWaitMaxMs: 100000, deadlineAt: 1000 + 600, minAttemptMs: 200 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: sg, deadlineAt: 1000 + 90000 })
            assert.strict.deepEqual([r.outcome, r.waitedMs], ['fail-open', 400])
        })

        //S3: 只給呼叫端(提示無) → 照用呼叫端(保持)
        it('S3 只給呼叫端期限(遞補層無期限): 照用呼叫端(waitedMs 400)', async function() {
            let clock = fakeClock(1000)
            let sg = gateObj({ countCli: async () => 9, now: clock.now, sleep: clock.sleep, gateWaitMaxMs: 100000, deadlineAt: 1000 + 600, minAttemptMs: 200 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual([r.outcome, r.waitedMs], ['fail-open', 400])
        })
    })

    describe('[真時間] runExecCli 直呼: 守門後 spawn 之逾時(假 CLI 睡 3 秒; 逾時值為期限 − 守門後之現在)', function() {

        let layerMs = 800
        let callerLaterMs = 60000

        //runWith, 以 spawnGate 物件之 deadlineAt(callerDa)與遞補層提示(layerDa; 無則不給)呼叫; timeoutMs 60000 遠大於兩期限
        let runWith = async (callerDa, layerDa, extra = {}) => {
            return runExecCli(fake.exe, ['--fake-sleep=3000'], {
                spawnGateKind: 'opencode',
                spawnGate: gateObj(callerDa === undefined ? {} : { deadlineAt: callerDa }),
                ...(layerDa === undefined ? {} : { spawnGateHints: { deadlineAt: layerDa, minAttemptMs: 100 } }),
                input: 'abc',
                timeoutMs: 60000,
                ...extra,
            })
        }

        //S1: 呼叫端較晚 → spawn 之逾時以遞補層剩餘封頂(修前以呼叫端之值, 假 CLI 睡滿 3 秒而成功 → 本案紅)
        it('S1 呼叫端期限較晚: spawn 之逾時以遞補層剩餘封頂(≤ 800ms, 逾時失敗); 修前未封頂而成功', async function() {
            let base = Date.now()
            let r = await runWith(base + callerLaterMs, base + layerMs)
            let ms = appliedMs(r)
            assert.strict.deepEqual([r.ok, r.errorType, ms !== null && ms >= 100 && ms <= layerMs], [false, 'timeout', true])
        })

        //S1 延伸: 呼叫端之值非法 → 不遮蔽遞補層(修前非法值使提示被忽略而未封頂)
        it('S1 呼叫端期限非法: 不遮蔽遞補層期限, spawn 之逾時仍以遞補層剩餘封頂', async function() {
            let base = Date.now()
            let r = await runWith('x', base + layerMs)
            let ms = appliedMs(r)
            assert.strict.deepEqual([r.ok, r.errorType, ms !== null && ms >= 100 && ms <= layerMs], [false, 'timeout', true])
        })

        //S2: 呼叫端較早 → 照用呼叫端(保持)
        it('S2 呼叫端期限較早: 照用呼叫端(逾時 ≤ 700ms), 遞補層之寬裕期限不放寬', async function() {
            let base = Date.now()
            let r = await runWith(base + 700, base + callerLaterMs)
            let ms = appliedMs(r)
            assert.strict.deepEqual([r.ok, r.errorType, ms !== null && ms >= 100 && ms <= 700], [false, 'timeout', true])
        })

        //S3: 只給呼叫端 → 照用呼叫端(保持)
        it('S3 只給呼叫端期限(無遞補層提示): 照用呼叫端(逾時 ≤ 700ms)', async function() {
            let base = Date.now()
            let r = await runWith(base + 700, undefined)
            let ms = appliedMs(r)
            assert.strict.deepEqual([r.ok, r.errorType, ms !== null && ms >= 100 && ms <= 700], [false, 'timeout', true])
        })

        //S4(標記之來源一致): 呼叫端較晚 → 由遞補層決定 → 標 cutByDeadline; 呼叫端較早 → 由呼叫端決定 → 不標
        it('S4 呼叫端期限較晚: 逾時由遞補層期限決定 → 結果標 cutByDeadline(appliedTimeoutMs ≤ 800)', async function() {
            let base = Date.now()
            let r = await runWith(base + callerLaterMs, base + layerMs, { attemptHints: { deadlineAt: base + layerMs, minAttemptMs: 100, entryTimeoutMs: 60000 } })
            assert.strict.deepEqual([r.errorType, r.cutByDeadline, typeof r.appliedTimeoutMs === 'number' && r.appliedTimeoutMs <= layerMs], ['timeout', true, true])
        })

        //保持(修前即綠): 遞補層期限只經 attemptHints 傳入(無 spawnGateHints; 內部鍵之直呼組合, 遞補層守門運作時恆兩者同給)——attemptHints 不併入守門後之封頂(沿修前:
        //封頂只看 spawnGate 物件與 spawnGateHints), 其期限另由重試之 retryFits 約束; 外審 terra #02／#10: 併入會改變 spawnGate:false 時暫時性重試之預算判斷與直呼之首次 spawn 逾時
        it('保持: 遞補層期限只經 attemptHints 傳入(無 spawnGateHints): 守門後之 spawn 不以 attemptHints 封頂(假 CLI 睡 1.2 秒而成功)', async function() {
            let base = Date.now()
            let r = await runExecCli(fake.exe, ['--fake-sleep=1200'], {
                spawnGateKind: 'opencode',
                spawnGate: gateObj({ deadlineAt: base + callerLaterMs }),
                attemptHints: { deadlineAt: base + 500, minAttemptMs: 100, entryTimeoutMs: 60000 },
                input: 'abc',
                timeoutMs: 60000,
            })
            assert.strict.deepEqual([r.ok, 'cutByDeadline' in r], [true, false])
        })

        //S4(動態讀取之呼叫端物件, 外審 terra #04): 封頂值與標記取自同一次讀取。getter 前 N+1 次讀回較早之期限(N＝守門自身讀取次數, 實測取得), 其後讀回與遞補層相等之值:
        //單次快照者兩處皆為較早 → 由呼叫端決定、不標 cutByDeadline; 分次讀取者(封頂一次、標記再一次)標記讀到相等之值 → 誤標為遞補層封頂(變異 M20)
        it('S4 呼叫端物件之 deadlineAt 為動態 getter: 封頂值與標記取自同一次讀取(快照), 不標 cutByDeadline', async function() {
            let base = Date.now()
            let reads = 0
            let early = Infinity
            let sgObj = gateObj()
            Object.defineProperty(sgObj, 'deadlineAt', {
                enumerable: true,
                get: () => (++reads <= early ? base + 700 : base + layerMs),
            })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgObj }) //量測守門自身讀取呼叫端物件之次數
            early = reads + 1
            reads = 0
            let r = await runExecCli(fake.exe, ['--fake-sleep=3000'], {
                spawnGateKind: 'opencode',
                spawnGate: sgObj,
                spawnGateHints: { deadlineAt: base + layerMs, minAttemptMs: 100 },
                attemptHints: { deadlineAt: base + layerMs, minAttemptMs: 100, entryTimeoutMs: 60000 },
                input: 'abc',
                timeoutMs: 60000,
            })
            let ms = appliedMs(r)
            assert.strict.deepEqual([r.errorType, 'cutByDeadline' in r, ms !== null && ms >= 100 && ms <= 700], ['timeout', false, true])
        })

        //相等: 呼叫端之值並非「早於」遞補層期限 → 視為遞補層決定(沿用修前 callerBelowDa 之嚴格小於; 兩值相同故逾時值不受影響, 只影響標記)
        it('S4 兩期限相等: 非「呼叫端早於遞補層」→ 視為遞補層期限決定 → 標 cutByDeadline', async function() {
            let base = Date.now()
            let r = await runWith(base + layerMs, base + layerMs, { attemptHints: { deadlineAt: base + layerMs, minAttemptMs: 100, entryTimeoutMs: 60000 } })
            assert.strict.deepEqual([r.errorType, r.cutByDeadline], ['timeout', true])
        })

        it('S4 呼叫端期限較早: 逾時由呼叫端期限決定 → 結果不標 cutByDeadline(不得被判為遞補層封頂)', async function() {
            let base = Date.now()
            let r = await runWith(base + 700, base + callerLaterMs, { attemptHints: { deadlineAt: base + callerLaterMs, minAttemptMs: 100, entryTimeoutMs: 600000 } })
            assert.strict.deepEqual([r.errorType, 'cutByDeadline' in r, 'appliedTimeoutMs' in r], ['timeout', false, false])
        })
    })

    describe('dispatchAiFallback 整合: 守門等待與封頂之標記', function() {

        //S1(整合): 呼叫端期限遠晚於遞補層 → 守門等待不越過遞補層期限(gate 之 fail-open 事件 waitedMs ≤ budgetMs − minAttemptMs); 逾時由遞補層切短 → budget-cut
        it('S1 [真時間] 呼叫端期限遠晚於 budgetMs: 守門等待以遞補層期限為上限(1500 ≤ waitedMs ≤ 2700, 即期限 − minAttemptMs), 被遞補層切短之逾時判為 budget-cut', async function() {
            let clock = lazyClock()
            let gev = []
            let ev = []
            let r = await dispatchAiFallback('abc', {
                providers: [{
                    id: 't417a:cli',
                    kind: 'claude',
                    exe: fake.exe,
                    extraArgs: ['--fake-sleep=20000'],
                    timeoutMs: 30000,
                    spawnGate: gateObj({ countCli: async () => 9, now: clock.now, sleep: clock.sleep, gateWaitMaxMs: 9000, deadlineAt: Date.now() + 600000, onTrace: (e) => gev.push(e) }),
                }],
                budgetMs: 3000, //預算大(3 秒): 排程停頓至多容忍約 2.7 秒仍不致在嘗試前耗盡(budget-out)
                minAttemptMs: 300,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            let fo = gev.filter((e) => e.type === 'fail-open')
            //等待 = (期限 − minAttemptMs) − 守門起算時刻; 起算時刻 ≥ 遞補層算期限之時刻, 故 ≤ 2700; 下界 1500 防「立即 fail-open、等 0 毫秒」(需起算延後逾 1.2 秒才翻轉)
            assert.strict.deepEqual([fo.length, fo.length === 1 && fo[0].waitedMs >= 1500 && fo[0].waitedMs <= 3000 - 300], [1, true])
            assert.strict.deepEqual([r.ok, r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'budget-cut').length], [false, 'budget', ['budget-cut'], 1])
        })

        //S4(整合): 呼叫端期限略早於遞補層(整鏈亦已用盡) → 由呼叫端決定 → 照一般逾時, 不判 budget-cut
        it('S4 [真時間] 呼叫端期限略早於遞補層期限(嘗試結束時整鏈亦已用盡): 照一般逾時(timeout、skip-group、cooled reason timeout), 不判 budget-cut', async function() {
            let ev = []
            let now = Date.now()
            let r = await dispatchAiFallback('abc', {
                providers: [{
                    id: 't417b:cli',
                    kind: 'claude',
                    exe: fake.exe,
                    extraArgs: ['--fake-sleep=8000'],
                    timeoutMs: 10000,
                    spawnGate: gateObj({ deadlineAt: now + 900 }),
                }],
                //預算 1000、minAttemptMs 600: 呼叫端期限(測試時刻 + 900)恆早於遞補層期限(算期限之時刻 + 1000); 逾時後遞補層剩餘 ≈ 100 + 兩次取時之差 < 600(差 < 500ms 皆成立)——
                //「整鏈已用盡」與「差額 ≥ minAttemptMs」皆成立, 故若標記誤依遞補層則判為 budget-cut(測試紅); 負載使取時差擴大至 500ms 內仍保有此判別力(外審 terra #13)
                budgetMs: 1000,
                minAttemptMs: 600,
                cooldownMs: 300000,
                store: memStore(),
                onEvent: (e) => ev.push(e),
            })
            assert.strict.deepEqual(
                [r.errorType, r.tried.map((t) => t.outcome), ev.filter((e) => e.type === 'cooled').map((e) => e.reason), ev.filter((e) => e.type === 'budget-cut').length],
                ['timeout', ['skip-group'], ['timeout'], 0],
            )
        })
    })
})
