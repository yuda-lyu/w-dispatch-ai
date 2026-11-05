import assert from 'assert'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import cliSpawnGate, { resolveSpawnGate, createGateState, writeTicket } from '../src/cliSpawnGate.mjs'
import runExecCli from '../src/runExecCli.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-cliSpawnGateMinGap.test.mjs — 放行最小間隔 minGapMs(帳本R-SPAWNGATE-4; Gitea #85)
//
// 規格來源: 主控派工 da320〈主控已定〉——守門物件增 minGapMs, 預設只對 opencode 生效, false 關閉, 鍵之驗證依 cliSpawnGate.mjs 檔頭〈輸入檢測〉;
//   spawnGate:false 者不受影響; 等待在臨界區內使同行程 FIFO 依序錯開; 不計入 timeoutMs 但計入 deadlineAt; 跨行程以既有預約票之時刻為準;
//   trace 增 'gap-wait'。預設值 1500 之依據為量測(帳本R-SPAWNGATE-4): 冷啟動資料庫時併發啟動之首個實例約在啟動後1.0～1.2秒失敗, 間隔1500ms者3/3成功。
// 同步方式: 注入之 now／sleep(假時鐘, sleep 只推進時鐘)與 onTrace 事件, 不以固定等待(dspec〈計時器相關函數之觀察回調與測試〉)。
//   唯一使用真實計時器者為「不計入timeoutMs」一案(須經真實子進程與真實 timeoutMs), 以寬裕倍數斷言。


//hashOf, 預約票檔名之images雜湊(同src之算法)
let hashOf = (images) => crypto.createHash('sha1').update(images.map((s) => s.toLowerCase()).sort().join('|')).digest('hex').slice(0, 10)

//fakeClock, 假時鐘與假sleep(sleep只推進時鐘並立即resolve, 不真實等待)
function fakeClock(t0 = 0) {
    let t = t0
    return {
        now: () => t,
        sleep: async (ms) => {
            t += ms
        },
        get t() {
            return t
        },
    }
}

//sgOf, 組守門設定(只留行程數檢查且上限寬鬆, 不干擾間隔之觀察; 事件附放行當下之假時鐘)
function sgOf(clock, events, extra = {}) {
    return {
        maxCli: 50,
        ramUsedMax: false,
        cpuMax: false,
        countCli: async () => 0,
        pollMs: 100,
        gateWaitMaxMs: 10000000,
        now: clock.now,
        sleep: clock.sleep,
        state: createGateState(),
        ticketDir: false,
        images: ['opencode.exe'],
        onTrace: (e) => events.push({ ...e, at: clock.now() }),
        ...extra,
    }
}

//releases, 同一瞬間進門n個呼叫, 回傳各放行時刻(取pass事件當下之假時鐘; pass事件在臨界區之後同步發出, 不受後續呼叫推進時鐘影響)
async function releases(n, kind, sg, events) {
    await Promise.all(Array.from({ length: n }, () => cliSpawnGate({ kind, spawnGate: sg })))
    return events.filter((e) => e.type === 'pass').map((e) => e.at)
}

let diffs = (xs) => xs.slice(1).map((x, i) => x - xs[i])


describe('放行最小間隔 minGapMs(R-SPAWNGATE-4; Gitea #85)', function() {

    describe('resolveSpawnGate: 預設值與輸入檢測(dspec〈輸入參數之檢測機制〉K3／K4)', function() {

        it('opencode預設1500ms; claude／codex／antigravity預設不錯開(null)(主控已定: 預設只對opencode生效)', function() {
            let r = (kind, spawnGate) => resolveSpawnGate({ kind, spawnGate, cores: 4, platform: 'win32' }).minGapMs
            assert.strict.deepEqual(r('opencode', undefined), 1500)
            assert.strict.deepEqual(r('opencode', true), 1500)
            for (let kind of ['claude', 'codex', 'antigravity']) {
                assert.strict.deepEqual(r(kind, { maxCli: 2 }), null)
            }
        })

        it('false關閉(null); 有效毫秒收下(數字字串轉換後使用, K4)', function() {
            let r = (v, kind = 'opencode') => resolveSpawnGate({ kind, spawnGate: { minGapMs: v }, cores: 4, platform: 'win32' })
            assert.strict.deepEqual(r(false).minGapMs, null)
            assert.strict.deepEqual([r(400).minGapMs, r(' 800 ').minGapMs, r('1200').minGapMs, r(2147483647).minGapMs], [400, 800, 1200, 2147483647])
            assert.strict.deepEqual(r(250, 'claude').minGapMs, 250)
        })

        it('非預期之值(字串、0、負數、NaN、Infinity、超過上限、物件、陣列、true)視為未給、改用預設(opencode 1500／其餘null), 不拋錯(K3)', function() {
            for (let v of ['x', '', 0, -5, NaN, Infinity, 2147483648, {}, [], true, () => 1]) {
                let a = resolveSpawnGate({ kind: 'opencode', spawnGate: { minGapMs: v }, cores: 4, platform: 'win32' })
                let b = resolveSpawnGate({ kind: 'claude', spawnGate: { maxCli: 2, minGapMs: v }, cores: 4, platform: 'win32' })
                assert.strict.deepEqual([a.minGapMs, b.minGapMs], [1500, null])
            }
        })

        it('undefined／null取預設; debug為true時非預期值以warn一行指出鍵名與預設、不含傳入之值(K9)', function() {
            let logs = []
            let a = resolveSpawnGate({ kind: 'opencode', spawnGate: { minGapMs: null }, cores: 4, platform: 'win32' })
            let b = resolveSpawnGate({ kind: 'opencode', spawnGate: { minGapMs: 'secret-value', debug: true, log: (lv, msg) => logs.push([lv, msg]) }, cores: 4, platform: 'win32' })
            assert.strict.deepEqual([a.minGapMs, b.minGapMs], [1500, 1500])
            assert.strict.deepEqual(logs.length, 1)
            assert.strict.deepEqual([logs[0][0], /minGapMs/.test(logs[0][1]), /secret-value/.test(logs[0][1])], ['warn', true, false])
        })

        it('間隔不單獨啟動守門(預設情形): 行程數／RAM／CPU皆false且未明給minGapMs → 不守門(null), 與修前相同; 明給minGapMs則成為只錯開之守門', function() {
            let off = resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false, ramUsedMax: false, cpuMax: false }, cores: 4, platform: 'win32' })
            let on = resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: 500 }, cores: 4, platform: 'win32' })
            let offByFalse = resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: false }, cores: 4, platform: 'win32' })
            assert.strict.deepEqual([off, on !== null && on.minGapMs, offByFalse], [null, 500, null])
        })
    })

    describe('同行程錯開(假時鐘; 等待在臨界區內, FIFO)', function() {

        it('預設: opencode同一瞬間3個併發, 相鄰放行時距 ≥ 1500ms(issue §3-2)', async function() {
            let events = []
            let clock = fakeClock(1000)
            let at = await releases(3, 'opencode', sgOf(clock, events), events)
            assert.strict.deepEqual(at.length, 3)
            assert.strict.deepEqual(diffs(at).every((d) => d >= 1500), true)
        })

        it('明給minGapMs 400: 放行時刻恰為 0、400、800(只補足剩餘時距, 不多等); 第一個無前一放行故不等待', async function() {
            let events = []
            let clock = fakeClock(1000)
            let at = await releases(3, 'opencode', sgOf(clock, events, { minGapMs: 400 }), events)
            assert.strict.deepEqual(at, [1000, 1400, 1800])
        })

        it('gap-wait事件內容: 第2、3個各一則{ ms, minGapMs, sinceLastMs, capped }, 事件凍結, 先於該呼叫之check與pass', async function() {
            let events = []
            let clock = fakeClock(1000)
            await releases(3, 'opencode', sgOf(clock, events, { minGapMs: 400 }), events)
            let gaps = events.filter((e) => e.type === 'gap-wait')
            assert.strict.deepEqual(gaps.map(({ type, ms, minGapMs, sinceLastMs, capped }) => ({ type, ms, minGapMs, sinceLastMs, capped })), [
                { type: 'gap-wait', ms: 400, minGapMs: 400, sinceLastMs: 0, capped: false },
                { type: 'gap-wait', ms: 400, minGapMs: 400, sinceLastMs: 0, capped: false },
            ])
            let ts = events.map((e) => e.type)
            //第2個呼叫: gap-wait 在它自己的 check 之前
            assert.strict.deepEqual(ts.indexOf('gap-wait') < ts.indexOf('check', ts.indexOf('pass')), true)
        })

        it('onTrace收到之事件為凍結物件(gap-wait亦然)', async function() {
            let seen = []
            let clock = fakeClock(0)
            let sg = sgOf(clock, [], { minGapMs: 100, onTrace: (e) => seen.push(Object.isFrozen(e) && e.type) })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual(seen.includes('gap-wait'), true)
            assert.strict.deepEqual(seen.every((x) => x !== false), true)
        })

        it('已過足夠時間則不等待: 距上次放行已 ≥ minGapMs 時直接放行, 不發gap-wait', async function() {
            let events = []
            let clock = fakeClock(0)
            let sg = sgOf(clock, events, { minGapMs: 400 })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            clock.sleep(400) //假時鐘自行前進(模擬時間流逝)
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual(events.filter((e) => e.type === 'gap-wait').length, 0)
        })

        it('放行順序仍為進門順序(FIFO): 6個呼叫依序放行, 時距各 ≥ minGapMs', async function() {
            let clock = fakeClock(0)
            let base = sgOf(clock, [], { minGapMs: 300 })
            let order = []
            let at = []
            await Promise.all([0, 1, 2, 3, 4, 5].map((i) => cliSpawnGate({
                kind: 'opencode',
                spawnGate: {
                    ...base,
                    onTrace: (e) => {
                        if (e.type === 'pass') {
                            order.push(i)
                            at.push(clock.now())
                        }
                    }
                },
            })))
            assert.strict.deepEqual(order, [0, 1, 2, 3, 4, 5])
            assert.strict.deepEqual(diffs(at).every((d) => d >= 300), true)
        })

        it('間隔取自「放行」而非「進門」: 被行程數擋住後才放行者, 與前一放行之時距亦 ≥ minGapMs', async function() {
            let clock = fakeClock(0)
            let events = []
            let counts = [0, 9, 9, 0] //第1個0放行; 第2個先被擋(9、9)再0放行
            let sg = sgOf(clock, events, { minGapMs: 500, maxCli: 3, pollMs: 100, countCli: async () => counts.shift() })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let at = events.filter((e) => e.type === 'pass').map((e) => e.at)
            assert.strict.deepEqual(diffs(at).every((d) => d >= 500), true)
        })
    })

    describe('關閉與不受影響者', function() {

        it('minGapMs:false → 不錯開: 3個併發全在同一時刻放行, 無gap-wait事件', async function() {
            let events = []
            let clock = fakeClock(1000)
            let at = await releases(3, 'opencode', sgOf(clock, events, { minGapMs: false }), events)
            assert.strict.deepEqual([at, events.filter((e) => e.type === 'gap-wait').length], [[1000, 1000, 1000], 0])
        })

        it('spawnGate:false → 守門整個不運作(outcome off, 等待0ms), 3個併發全部立即回傳, 不錯開', async function() {
            let rs = await Promise.all([1, 2, 3].map(() => cliSpawnGate({ kind: 'opencode', spawnGate: false, exe: 'opencode' })))
            assert.strict.deepEqual(rs.map((r) => [r.outcome, r.waitedMs, r.gated]), [['off', 0, false], ['off', 0, false], ['off', 0, false]])
        })

        it('claude／codex／antigravity: 未給spawnGate → off; 明給限制項但未給minGapMs → 不錯開(預設不限間隔); 明給minGapMs才錯開', async function() {
            for (let kind of ['claude', 'codex', 'antigravity']) {
                let r0 = await cliSpawnGate({ kind })
                assert.strict.deepEqual(r0.outcome, 'off')

                let ev1 = []
                let c1 = fakeClock(1000)
                let at1 = await releases(3, kind, sgOf(c1, ev1, { images: [`${kind}.exe`] }), ev1)
                assert.strict.deepEqual([kind, at1, ev1.filter((e) => e.type === 'gap-wait').length], [kind, [1000, 1000, 1000], 0])

                let ev2 = []
                let c2 = fakeClock(1000)
                let at2 = await releases(3, kind, sgOf(c2, ev2, { images: [`${kind}.exe`], minGapMs: 250 }), ev2)
                assert.strict.deepEqual([kind, at2], [kind, [1000, 1250, 1500]])
            }
        })

        it('行程數／RAM／CPU皆false且未明給minGapMs → 仍為off(與修前相同, 預設間隔不使「已全關」之守門復活)', async function() {
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false, ramUsedMax: false, cpuMax: false } })
            assert.strict.deepEqual([r.outcome, r.waitedMs], ['off', 0])
        })

        it('限制皆false但明給minGapMs → 只錯開之守門(outcome pass, 不查任何探針)', async function() {
            let calls = 0
            let spy = async () => {
                calls++
                return 0
            }
            let events = []
            let clock = fakeClock(1000)
            let sg = sgOf(clock, events, { maxCli: false, minGapMs: 300, countCli: spy, sampleCpu: spy, sampleRam: spy })
            let at = await releases(3, 'opencode', sg, events)
            assert.strict.deepEqual([at, calls], [[1000, 1300, 1600], 0])
        })
    })

    describe('跨行程(預約票; 票只是提示)', function() {

        let base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'cliSpawnGateMinGap')
        let seq = 0
        let dirOf = () => path.join(base, `case${++seq}`)
        after(function() {
            fs.rmSync(base, { recursive: true, force: true })
        })
        let hash = hashOf(['opencode.exe'])

        it('他行程500ms前放行(有票): 本行程補足剩餘1000ms才放行, gap-wait事件sinceLastMs為500', async function() {
            let dir = dirOf()
            let events = []
            let clock = fakeClock(100000)
            writeTicket(dir, hash, 222, clock.now() - 500, 0)
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, events, { ticketDir: dir, pid: 111, minGapMs: 1500 }) })
            let g = events.find((e) => e.type === 'gap-wait')
            assert.strict.deepEqual([g.ms, g.sinceLastMs, clock.t], [1000, 500, 101000])
        })

        it('票早於minGapMs(已間隔夠久)不等待; 本行程自己之票不重複計入(其放行由記憶體負責)', async function() {
            let dir = dirOf()
            let events = []
            let clock = fakeClock(100000)
            writeTicket(dir, hash, 222, clock.now() - 2000, 0) //他行程, 2000ms前 ≥ 1500
            writeTicket(dir, hash, 111, clock.now() - 100, 0) //本行程自己之票
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, events, { ticketDir: dir, pid: 111, minGapMs: 1500 }) })
            assert.strict.deepEqual(events.filter((e) => e.type === 'gap-wait').length, 0)
        })

        it('minGapMs大於settleMs時, 票之採計窗口隨minGapMs加寬(否則settleMs外之票令間隔失效)', async function() {
            let dir = dirOf()
            let events = []
            let clock = fakeClock(100000)
            writeTicket(dir, hash, 222, clock.now() - 4000, 0) //4000ms前, 超過settleMs 1000 但在minGapMs 5000內
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, events, { ticketDir: dir, pid: 111, minGapMs: 5000, settleMs: 1000 }) })
            let g = events.find((e) => e.type === 'gap-wait')
            assert.strict.deepEqual([g.ms, g.sinceLastMs], [1000, 4000])
        })

        it('票之時刻晚於現在(時鐘偏差、他機寫入): 視為剛放行, 等待不超過minGapMs(不被未來時刻之票拖長)', async function() {
            let dir = dirOf()
            let events = []
            let clock = fakeClock(100000)
            writeTicket(dir, hash, 222, clock.now() + 5000, 0)
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, events, { ticketDir: dir, pid: 111, minGapMs: 1500 }) })
            let g = events.find((e) => e.type === 'gap-wait')
            assert.strict.deepEqual([g.ms, g.sinceLastMs, clock.t], [1500, 0, 101500])
        })

        it('同時有本行程記憶體之放行與他行程之票: 取較晚者為「上一次放行」', async function() {
            let dir = dirOf()
            let events = []
            let clock = fakeClock(100000)
            let sg = sgOf(clock, events, { ticketDir: dir, pid: 111, minGapMs: 1000 })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg }) //本行程於100000放行
            clock.sleep(300)
            writeTicket(dir, hash, 222, clock.now() - 100, 0) //他行程於100200放行(較晚)
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let g = events.find((e) => e.type === 'gap-wait')
            assert.strict.deepEqual([g.ms, g.sinceLastMs], [900, 100]) //以100200為準(自本行程100000起算則為700)
        })

        it('不同image之票不影響; ticketDir:false 時不讀票', async function() {
            let dir = dirOf()
            let events = []
            let clock = fakeClock(100000)
            writeTicket(dir, hashOf(['claude.exe']), 222, clock.now() - 100, 0) //他種image
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, events, { ticketDir: dir, pid: 111, minGapMs: 1500 }) })
            let events2 = []
            let clock2 = fakeClock(100000)
            writeTicket(dir, hash, 222, clock2.now() - 100, 0)
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock2, events2, { ticketDir: false, pid: 111, minGapMs: 1500 }) })
            assert.strict.deepEqual([events.filter((e) => e.type === 'gap-wait').length, events2.filter((e) => e.type === 'gap-wait').length], [0, 0])
        })

        it('放行即寫票(令他行程之間隔以此為準): 行程數檢查關閉(maxCli false)但間隔啟用時亦寫; 兩者皆關時不寫', async function() {
            let dir = dirOf()
            let clock = fakeClock(100000)
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, [], { ticketDir: dir, maxCli: false, ramUsedMax: 0.9, sampleRam: () => 0.1, pid: 111 }) })
            assert.strict.deepEqual(fs.readdirSync(dir).length, 1)
            let dir2 = dirOf()
            await cliSpawnGate({ kind: 'opencode', spawnGate: sgOf(clock, [], { ticketDir: dir2, maxCli: false, ramUsedMax: 0.9, sampleRam: () => 0.1, pid: 111, minGapMs: false }) })
            assert.strict.deepEqual(fs.existsSync(dir2), false)
        })

        it('兩個「行程」(不同pid、共用票資料夾)各發2個: 全部相鄰放行時距 ≥ minGapMs(以票之時刻為準)', async function() {
            let dir = dirOf()
            let clock = fakeClock(100000)
            let at = []
            let mk = (pid) => sgOf(clock, [], {
                ticketDir: dir,
                pid,
                minGapMs: 700,
                state: createGateState(),
                onTrace: (e) => {
                    if (e.type === 'pass') {
                        at.push(clock.now())
                    }
                }
            })
            let a = mk(111)
            let b = mk(222)
            await Promise.all([
                cliSpawnGate({ kind: 'opencode', spawnGate: a }),
                cliSpawnGate({ kind: 'opencode', spawnGate: a }),
            ])
            await Promise.all([
                cliSpawnGate({ kind: 'opencode', spawnGate: b }),
                cliSpawnGate({ kind: 'opencode', spawnGate: b }),
            ])
            assert.strict.deepEqual(at.length, 4)
            assert.strict.deepEqual(diffs(at).every((d) => d >= 700), true)
        })
    })

    describe('歸屬: 計入deadlineAt、可中止、永不reject', function() {

        it('計入deadlineAt: 等待不超過「deadlineAt − minAttemptMs」, 超過者截斷(capped true)而仍放行, 不標failOpen', async function() {
            let events = []
            let clock = fakeClock(1000)
            //deadline = 3000 − 500 = 2500: 第1個1000放行; 第2個等1500到2500(未截斷); 第3個到2500時餘額0 → 不等(截斷), 與第2個同刻放行
            let sg = sgOf(clock, events, { minGapMs: 1500, deadlineAt: 3000, minAttemptMs: 500 })
            let rs = await Promise.all([1, 2, 3].map(() => cliSpawnGate({ kind: 'opencode', spawnGate: sg })))
            let at = events.filter((e) => e.type === 'pass').map((e) => e.at)
            let gaps = events.filter((e) => e.type === 'gap-wait').map((e) => [e.ms, e.capped])
            assert.strict.deepEqual(at, [1000, 2500, 2500])
            assert.strict.deepEqual(gaps, [[1500, false], [0, true]])
            assert.strict.deepEqual(rs.map((r) => [r.failOpen, r.aborted]), [[false, false], [false, false], [false, false]])
        })

        it('deadlineAt已過: 不等待(0ms)、仍放行', async function() {
            let events = []
            let clock = fakeClock(10000)
            let sg = sgOf(clock, events, { minGapMs: 1500, deadlineAt: 5000, minAttemptMs: 100 })
            await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual([r.outcome, clock.t, events.filter((e) => e.type === 'gap-wait').map((e) => [e.ms, e.capped])], ['pass', 10000, [[0, true]]])
        })

        it('間隔等待後shouldStop為真 → aborted(不放行), 且臨界區已釋放(其後之呼叫不死鎖)', async function() {
            let events = []
            let clock = fakeClock(1000)
            let stop = false
            let sg = sgOf(clock, events, {
                minGapMs: 500,
                shouldStop: () => stop,
                sleep: async (ms) => {
                    stop = true
                    await clock.sleep(ms)
                }
            })
            let r1 = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let r2 = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual([r1.outcome, r2.outcome, r2.aborted], ['pass', 'aborted', true])
            stop = false
            sg.sleep = clock.sleep
            let r3 = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual(r3.outcome, 'pass')

            //中止之呼叫不檢查、不登記放行: 事件序列為 第1個[start,check,pass]、第2個[start,gap-wait,aborted]、第3個[start,check,pass]
            assert.strict.deepEqual(events.map((e) => e.type), ['start', 'check', 'pass', 'start', 'gap-wait', 'aborted', 'start', 'check', 'pass'])
        })

        it('sleep拋錯: 守門不reject(fail-open放行), 臨界區已釋放(其後之呼叫不死鎖)', async function() {
            let clock = fakeClock(1000)
            let sg = sgOf(clock, [], {
                minGapMs: 500,
                sleep: async () => {
                    throw new Error('boom')
                }
            })
            let r1 = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let r2 = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let r3 = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual([r1.outcome, r2.outcome, r2.failOpen, r3.outcome, r3.failOpen], ['pass', 'fail-open', true, 'fail-open', true])
        })
    })

    describe('不計入timeoutMs(真實子進程與真實計時器; 以寬裕倍數斷言)', function() {

        let fake = null
        before(function() {
            fake = createFakeCli('fake-mingap')
        })
        after(function() {
            if (fake) {
                fake.clean()
            }
        })

        it('第2個呼叫等間隔900ms、timeoutMs僅700ms: 仍成功(逾時自spawn起算), gateWaitedMs ≥ 800 > timeoutMs', async function() {
            let sg = { maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: 900, state: createGateState(), ticketDir: false, images: ['opencode.exe'] }
            let go = () => runExecCli(fake.exe, ['--fake-sleep=1'], { spawnGateKind: 'opencode', spawnGate: sg, input: 'abc', timeoutMs: 700 })
            let rs = await Promise.all([go(), go()])
            assert.strict.deepEqual(rs.map((r) => r.ok), [true, true])
            let waited = Math.max(...rs.map((r) => r.gateWaitedMs ?? 0))
            assert.strict.deepEqual(waited >= 800, true)
        })
    })
})
