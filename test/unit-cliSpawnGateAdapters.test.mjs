import assert from 'assert'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import runExecCli from '../src/runExecCli.mjs'
import { createGateState, defaultImages } from '../src/cliSpawnGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// 規格來源: Gitea #67 §1.2(四個CLI轉接器於spawn前呼叫守門; 每次嘗試都呼叫)、§1.1-4(等待不計入該次timeoutMs)、§1.1-6(spawnGate開關與覆寫, 走遞補層時放opt或條目)、
//   主控派工單〈要做的事〉1、〈主控之疑慮〉2(整批)、4(fail-open)。守門本身之行為見unit-cliSpawnGate.test.mjs, 此檔驗「接點」。


//fakeClock, 假時鐘與假sleep
function fakeClock(t0 = 0) {
    let t = 0 + t0
    return {
        now: () => t,
        sleep: async (ms) => {
            t += ms
        },
    }
}

//gateOf, 組spawnGate物件(關閉CPU與RAM, 只測行程數; 事件寫入共用時間軸timeline)
function gateOf(timeline, extra = {}) {
    let clock = fakeClock()
    return {
        maxCli: 2,
        ramUsedMax: false,
        cpuMax: false,
        pollMs: 100,
        gateWaitMaxMs: 100000,
        now: clock.now,
        sleep: clock.sleep,
        state: createGateState(),
        ticketDir: false, //不寫跨行程預約票(不碰真實os.tmpdir())
        onTrace: (e) => timeline.push(`gate:${e.type}`),
        ...extra,
    }
}

//cliTrace, execCli之觀察回調(經轉接器原樣轉傳): 記錄子進程啟動
let cliTrace = (timeline) => (e) => {
    if (e.type === 'spawn') {
        timeline.push('cli:spawn')
    }
}


describe('cliSpawnGate之接點: 四個CLI轉接器(R-SPAWNGATE-1)', function() {

    let fake = null
    before(function() {
        fake = createFakeCli('fake-spawngate-adapters')
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let adapters = [
        ['opencode', dispatchOpencode],
        ['claude', dispatchClaude],
        ['codex', dispatchCodex],
        ['antigravity', dispatchAntigravity],
    ]

    for (let [kind, fn] of adapters) {

        describe(kind, function() {

            it('守門先於spawn: 時間軸為 gate放行 → 子進程啟動; countCli收到該kind之預設image(issue §1.2)', async function() {
                let timeline = []
                let seen = []
                let sg = gateOf(timeline, {
                    countCli: async (images) => {
                        seen.push(images)
                        return 0
                    }
                })
                let r = await fn('abc', { exe: fake.exe, spawnGate: sg, onTrace: cliTrace(timeline) })
                assert.strict.deepEqual(r.ok, true)
                assert.strict.deepEqual(seen, [defaultImages(kind)])
                assert.strict.deepEqual(timeline.indexOf('gate:pass') >= 0 && timeline.indexOf('gate:pass') < timeline.indexOf('cli:spawn'), true)
                assert.strict.deepEqual(timeline.filter((x) => x === 'gate:pass').length, 1)
            })

            it('被擋時等到放行才spawn(時間軸: wait先於pass先於spawn), 結果帶gateWaitedMs; 逾時自spawn起算故不受等待影響', async function() {
                let timeline = []
                let counts = [2, 2, 0]
                let sg = gateOf(timeline, { countCli: async () => counts.shift() })
                let r = await fn('abc', { exe: fake.exe, spawnGate: sg, onTrace: cliTrace(timeline), timeoutMs: 20000 })
                assert.strict.deepEqual([r.ok, r.gateWaitedMs, 'gateFailOpen' in r], [true, 200, false])
                let i = (x) => timeline.indexOf(x)
                assert.strict.deepEqual(timeline.filter((x) => x === 'gate:wait').length, 2)
                assert.strict.deepEqual(i('gate:wait') < i('gate:pass') && i('gate:pass') < i('cli:spawn'), true)
            })

            it('未被擋時結果不帶gateWaitedMs／gateFailOpen欄位(結果形狀不變)', async function() {
                let r = await fn('abc', { exe: fake.exe, spawnGate: gateOf([], { countCli: async () => 0 }) })
                assert.strict.deepEqual(['gateWaitedMs' in r, 'gateFailOpen' in r], [false, false])
            })

            it('fail-open: 等待逾時仍放行, 子進程照常執行(ok true), 結果帶gateFailOpen', async function() {
                let timeline = []
                let sg = gateOf(timeline, { countCli: async () => 9, pollMs: 100, gateWaitMaxMs: 250 })
                let r = await fn('abc', { exe: fake.exe, spawnGate: sg, onTrace: cliTrace(timeline) })
                assert.strict.deepEqual([r.ok, r.gateWaitedMs, r.gateFailOpen], [true, 250, true])
                assert.strict.deepEqual(timeline.indexOf('gate:fail-open') < timeline.indexOf('cli:spawn'), true)
            })

            it('fail-open: 計數與取樣函數拋錯不使派工失敗(ok true)', async function() {
                let boom = () => {
                    throw new Error('boom')
                }
                let sg = gateOf([], { maxCli: 2, ramUsedMax: 0.85, cpuMax: 0.9, countCli: boom, sampleRam: boom, sampleCpu: boom })
                let r = await fn('abc', { exe: fake.exe, spawnGate: sg })
                assert.strict.deepEqual([r.ok, 'gateFailOpen' in r], [true, false])
            })

            it('spawnGate:false 不守門(無任何gate事件), 結果與未給spawnGate之假CLI(預設情形不守門)一致', async function() {
                let a = await fn('abc', { exe: fake.exe, spawnGate: false })
                let b = await fn('abc', { exe: fake.exe })
                let strip = (r) => ({ ...r, durationMs: 0, pid: 0, stdout: JSON.parse(r.stdout).args })
                assert.strict.deepEqual(strip(a), strip(b))
            })

            it('shouldStop為真(spawnGate內)時於spawn前中止: errorType aborted、attempts 0、子進程未啟動', async function() {
                let timeline = []
                let sg = gateOf(timeline, { countCli: async () => 9, shouldStop: () => true })
                let r = await fn('abc', { exe: fake.exe, spawnGate: sg, onTrace: cliTrace(timeline) })
                assert.strict.deepEqual([r.ok, r.error, r.errorType, r.attempts], [false, 'ABORTED', 'aborted', 0])
                assert.strict.deepEqual(timeline.includes('cli:spawn'), false)
            })

            it('無效之spawnGate值(字串、數字)視為未給; 假CLI預設不守門而照常執行', async function() {
                for (let v of ['x', 5, null, [], true]) {
                    let r = await fn('abc', { exe: fake.exe, spawnGate: v })
                    assert.strict.deepEqual(r.ok, true)
                }
            })
        })
    }

    describe('預設情形(未給spawnGate): 只有opencode預設守門, 其餘三家不限', function() {

        it('claude／codex／antigravity預設無限制(主控疑慮1): 明給物件但未給任何限制項時為no-op, 不取任何樣; 明給maxCli才數該CLI之image', async function() {
            for (let [kind, fn] of adapters.slice(1)) {
                let calls = 0
                let spy = async () => {
                    calls++
                    return 0
                }
                let r = await fn('abc', { exe: fake.exe, spawnGate: { countCli: spy, sampleCpu: spy, sampleRam: spy, state: createGateState(), ticketDir: false } })
                assert.strict.deepEqual([kind, r.ok, calls], [kind, true, 0])
                let r2 = await fn('abc', { exe: fake.exe, spawnGate: { maxCli: 2, countCli: spy, sampleCpu: spy, sampleRam: spy, state: createGateState(), ticketDir: false } })
                assert.strict.deepEqual([kind, r2.ok, calls], [kind, true, 1]) //只數行程(RAM與CPU門檻預設關)
            }
        })
    })

    describe('驗證重試與execCli自理之重試', function() {

        it('自訂validate不過而重試: 每次重新spawn前都重新守門(gate放行2次, 子進程啟動2次)', async function() {
            let timeline = []
            let n = 0
            let sg = gateOf(timeline, { countCli: async () => 0 })
            let r = await dispatchOpencode('abc', {
                exe: fake.exe,
                spawnGate: sg,
                onTrace: cliTrace(timeline),
                maxRetries: 1,
                retryDelayMs: 1,
                validate: () => n++ > 0,
            })
            assert.strict.deepEqual([r.ok, r.attempts], [true, 2])
            assert.strict.deepEqual([timeline.filter((x) => x === 'gate:pass').length, timeline.filter((x) => x === 'cli:spawn').length], [2, 2])
        })

        it('驗證重試時第二次守門被shouldStop中止: errorType aborted、attempts為已嘗試次數(1)、第二個子進程未啟動', async function() {
            let timeline = []
            let calls = 0
            let sg = gateOf(timeline, {
                countCli: async () => 0,
                shouldStop: () => calls++ >= 1,
            })
            let r = await dispatchOpencode('abc', {
                exe: fake.exe,
                spawnGate: sg,
                onTrace: cliTrace(timeline),
                maxRetries: 1,
                retryDelayMs: 1,
                validate: () => false,
            })
            assert.strict.deepEqual([r.ok, r.error, r.errorType, r.attempts], [false, 'ABORTED', 'aborted', 1])
            assert.strict.deepEqual(timeline.filter((x) => x === 'cli:spawn').length, 1)
        })

        it('已知限制: execCli自理之非驗證失敗重試(maxRetries＞0且未給validate)不重新守門(整輪只守門一次)', async function() {
            let timeline = []
            let sg = gateOf(timeline, { countCli: async () => 0 })
            let r = await dispatchOpencode('abc', {
                exe: fake.exe,
                spawnGate: sg,
                onTrace: cliTrace(timeline),
                extraArgs: ['--fake-exit=1'],
                maxRetries: 2,
                retryDelayMs: 1,
            })
            assert.strict.deepEqual([r.ok, r.attempts], [false, 3])
            assert.strict.deepEqual([timeline.filter((x) => x === 'gate:pass').length, timeline.filter((x) => x === 'cli:spawn').length], [1, 3])
        })
    })

    describe('守門等待計入遞補層之budgetMs(real clock; 以事件順序與寬鬆上界斷言, 缺陷版之等待為上界之數倍)', function() {

        it('runExecCli直呼: 提示deadlineAt後, 等待到deadline減minAttemptMs即fail-open, 放行後spawn之timeoutMs以剩餘預算封頂', async function() {
            let timeline = []
            let t0 = Date.now()
            let r = await runExecCli(fake.exe, ['--fake-sleep=3000'], {
                spawnGateKind: 'opencode',
                spawnGate: gateOf(timeline, { countCli: async () => 9, now: undefined, sleep: undefined, pollMs: 50, gateWaitMaxMs: 20000 }),
                spawnGateHints: { deadlineAt: Date.now() + 1500, minAttemptMs: 500 },
                onTrace: cliTrace(timeline),
                input: 'abc',
                timeoutMs: 60000,
            })
            let wall = Date.now() - t0
            //等待約1000ms後放行, 子進程以約500ms之剩餘預算逾時; 缺陷版(未封頂)為等20000ms或不逾時而睡滿3000ms
            assert.strict.deepEqual([r.ok, r.errorType, r.gateFailOpen], [false, 'timeout', true])
            assert.strict.deepEqual(timeline.indexOf('gate:fail-open') < timeline.indexOf('cli:spawn'), true)
            assert.strict.deepEqual(wall < 6000, true)
        })

        it('守門未運作(spawnGateKind未給、或預設不限之kind)時, 遞補層提示之deadlineAt不改變spawn之timeoutMs(與修前相同, 不因提示而收緊)', async function() {
            let r1 = await runExecCli(fake.exe, ['--fake-sleep=1200'], { spawnGateHints: { deadlineAt: Date.now() + 300, minAttemptMs: 100 }, input: 'abc', timeoutMs: 20000 })
            assert.strict.deepEqual([r1.ok, 'gateWaitedMs' in r1], [true, false])
            let r2 = await runExecCli(fake.exe, ['--fake-sleep=1200'], { spawnGateKind: 'claude', spawnGateHints: { deadlineAt: Date.now() + 300, minAttemptMs: 100 }, input: 'abc', timeoutMs: 20000 })
            assert.strict.deepEqual(r2.ok, true)
        })

        it('dispatchAiFallback: 守門等待過而成交者, 結果與tried成交項皆帶gateWaitedMs', async function() {
            let counts = [2, 0]
            let r = await dispatchAiFallback('abc', { providers: [{ id: 'a', kind: 'opencode', exe: fake.exe, spawnGate: gateOf([], { countCli: async () => counts.shift() }) }] })
            assert.strict.deepEqual([r.ok, r.gateWaitedMs, r.tried[0].outcome, r.tried[0].gateWaitedMs], [true, 100, 'ok', 100])
        })

        it('dispatchAiFallback: budgetMs使守門等待受限(tried帶gateFailOpen), 整輪不超出預算之數倍', async function() {
            let timeline = []
            let t0 = Date.now()
            let r = await dispatchAiFallback('abc', {
                providers: [{ id: 'oc:fake', kind: 'opencode', exe: fake.exe, extraArgs: ['--fake-sleep=3000'], onTrace: cliTrace(timeline), spawnGate: gateOf(timeline, { countCli: async () => 9, now: undefined, sleep: undefined, pollMs: 50, gateWaitMaxMs: 20000 }) }],
                budgetMs: 2000,
                minAttemptMs: 700,
            })
            let wall = Date.now() - t0
            assert.strict.deepEqual([r.ok, r.errorType, r.tried[0].gateFailOpen, r.tried[0].outcome], [false, 'timeout', true, 'skip-group'])
            assert.strict.deepEqual(timeline.indexOf('gate:fail-open') < timeline.indexOf('cli:spawn'), true)
            assert.strict.deepEqual(wall < 7000, true)
        })
    })

    describe('經dispatchAiFallback／createAiCaller傳遞spawnGate(共用opt、條目覆寫、中止)', function() {

        it('共用opt之spawnGate套用於CLI條目; 條目自帶spawnGate:false覆寫共用設定; REST類不經此門', async function() {
            let calls = 0
            let sg = {
                maxCli: 2,
                ramUsedMax: false,
                cpuMax: false,
                minGapMs: false, //本案測傳遞, 關閉放行最小間隔(否則共用state之連續呼叫會真實等1.5秒; 間隔見unit-cliSpawnGateMinGap)
                countCli: async () => {
                    calls++
                    return 0
                },
                state: createGateState(),
                ticketDir: false
            }
            let r1 = await dispatchAiFallback('abc', { providers: [{ id: 'a', kind: 'opencode', exe: fake.exe }], spawnGate: sg })
            assert.strict.deepEqual([r1.ok, calls], [true, 1])
            let r2 = await dispatchAiFallback('abc', { providers: [{ id: 'a', kind: 'opencode', exe: fake.exe, spawnGate: false }], spawnGate: sg })
            assert.strict.deepEqual([r2.ok, calls], [true, 1])
            //條目之物件覆寫共用之物件(整個取代, 非逐鍵合併)
            let calls2 = 0
            let r3 = await dispatchAiFallback('abc', {
                providers: [{
                    id: 'a',
                    kind: 'opencode',
                    exe: fake.exe,
                    spawnGate: {
                        ...sg,
                        countCli: async () => {
                            calls2++
                            return 0
                        }
                    }
                }],
                spawnGate: sg
            })
            assert.strict.deepEqual([r3.ok, calls, calls2], [true, 1, 1])
            //REST類不經守門: 不呼叫countCli
            await dispatchAiFallback('abc', { providers: [{ id: 'r', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1/v1', model: 'm' }], spawnGate: sg })
            assert.strict.deepEqual(calls, 1)
        })

        it('shouldStop於守門等待中轉真: 結果為ABORTED(errorType aborted), tried末項為aborted而非next-key, 子進程未啟動', async function() {
            let timeline = []
            let stop = false
            let clock = fakeClock()
            let r = await dispatchAiFallback('abc', {
                providers: [
                    { id: 'a', kind: 'opencode', exe: fake.exe, onTrace: cliTrace(timeline) },
                    { id: 'b', kind: 'opencode', exe: fake.exe, onTrace: cliTrace(timeline) },
                ],
                spawnGate: gateOf(timeline, {
                    countCli: async () => 9,
                    now: clock.now,
                    sleep: async (ms) => {
                        stop = true
                        await clock.sleep(ms)
                    }
                }),
                shouldStop: () => stop,
            })
            assert.strict.deepEqual([r.ok, r.error, r.errorType], [false, 'ABORTED', 'aborted'])
            assert.strict.deepEqual(r.tried.map((t) => t.outcome), ['aborted'])
            assert.strict.deepEqual(timeline.includes('cli:spawn'), false)
        })

        it('createAiCaller之spawnGate原樣交dispatchAiFallback', async function() {
            let calls = 0
            let caller = createAiCaller({
                catalogue: [{ id: 't:fake', kind: 'opencode', exe: fake.exe, model: 'm' }],
                pick: ['t:fake'],
                spawnGate: {
                    maxCli: 2,
                    ramUsedMax: false,
                    cpuMax: false,
                    state: createGateState(),
                    ticketDir: false,
                    countCli: async () => {
                        calls++
                        return 0
                    }
                },
            })
            let r = await caller.callAI('abc')
            assert.strict.deepEqual([r.ok, calls], [true, 1])
        })
    })
})
