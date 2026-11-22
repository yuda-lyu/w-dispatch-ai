import assert from 'assert'
import path from 'path'
import runExecCli from '../src/runExecCli.mjs'
import cliSpawnGate, { resolveSpawnGate, createGateState } from '../src/cliSpawnGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-gateHintsMerge.test.mjs — 守門其餘同形之取嚴(排程第422項; 帳本R-COOL-5第5、6點; 承排程第417項「deadlineAt取較早」)
//
// 規格句(每案註解標明):
//   S1 shouldStop以「或」合併: 呼叫端spawnGate物件與遞補層提示任一回傳恰為true即中止(守門等待與暫時性重試); 拋錯、回傳非true、非函數皆視為該來源不中止、不遮蔽另一來源。
//   S2 minAttemptMs取兩來源有效值之較大者(取嚴), 判型統一為正整數(castPintOr: 數字或十進位數字字串; 小數、Infinity、'abc'無效); 無效者不遮蔽另一來源之有效值; 兩者皆無效用預設20000。
//   S3 守門之探針(sampleRam等)逾時不超過「期限 − minAttemptMs − 現在」(有期限時): 期限已到者不啟動探針; 因期限被縮短而逾時者不算探針故障(不冷卻、不警告)。
//   S4 守門排互斥鎖之等待受同一截止約束(有期限時): 到點即fail-open放行(failOpen true), 不無限排隊。
//   S5 無期限(deadlineAt未給)時探針與互斥鎖行為不變。


//offObj, 只留shouldStop／minAttemptMs／期限等之守門物件(其餘限制全關; resolveSpawnGate回非null須至少一個限制或明給minGapMs, 故測純函數時開maxCli)
let offObj = (extra = {}) => ({ maxCli: 2, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false, countCli: async () => 0, state: createGateState(), ...extra })


describe('守門兩來源提示之合併(排程第422項)', function() {

    this.timeout(60000)

    //---------- 純函數 ----------
    describe('gateHints: orStop、maxMinAttemptMs', function() {

        it('orStop: 任一回傳恰為true即true; 非函數忽略; 拋錯／回傳非true視為不中止; 全無函數回null; 依序短路', async function() {
            let { orStop } = await import('../src/gateHints.mjs')
            let calls = []
            let f1 = () => {
                calls.push(1)
                return false
            }
            let f2 = () => {
                calls.push(2)
                return true
            }
            let f3 = () => {
                calls.push(3)
                return true
            }
            let boom = () => {
                throw new Error('x')
            }
            assert.strict.deepEqual([orStop(f1, f2, f3)(), calls], [true, [1, 2]])
            assert.strict.deepEqual([orStop(f1, 123, null, undefined)(), orStop(boom, f1)(), orStop(boom, f2)(), orStop(() => 'true')(), orStop(async () => true)()], [false, false, true, false, false])
            assert.strict.deepEqual([orStop(), orStop(null, 123, 'x')], [null, null])
        })

        it('maxMinAttemptMs: 取兩來源有效(正整數)值之較大者; 無效者忽略不遮蔽; 皆無效用預設', async function() {
            let { maxMinAttemptMs } = await import('../src/gateHints.mjs')
            let r = [
                maxMinAttemptMs(5000, 30000, 20000), maxMinAttemptMs(30000, 5000, 20000), maxMinAttemptMs('5000', ' 30000 ', 20000),
                maxMinAttemptMs(5000, undefined, 20000), maxMinAttemptMs(undefined, 7000, 20000), maxMinAttemptMs(Infinity, 7000, 20000), maxMinAttemptMs(0.5, 7000, 20000),
                maxMinAttemptMs('abc', null, 20000), maxMinAttemptMs(undefined, undefined, 20000), maxMinAttemptMs(0, -1, 20000), maxMinAttemptMs(1.5, '0x10', 20000),
            ]
            assert.strict.deepEqual(r, [30000, 30000, 30000, 5000, 7000, 7000, 7000, 20000, 20000, 20000, 20000])
        })

    })

    //---------- resolveSpawnGate ----------
    describe('resolveSpawnGate: 兩來源之合併', function() {

        //S2
        it('S2 minAttemptMs: 呼叫端物件與遞補層提示皆有效取較大者; 一來源無效(小數、Infinity、\'abc\')不遮蔽另一來源之有效值; 皆無效用預設20000', function() {
            let ma = (obj, hint) => resolveSpawnGate({ kind: 'opencode', spawnGate: offObj(obj === undefined ? {} : { minAttemptMs: obj }), minAttemptMs: hint, cores: 4 }).minAttemptMs
            assert.strict.deepEqual(
                [
                    ma(5000, 30000), //物件較小 → 提示(修前物件優先取5000)
                    ma(30000, 5000), //物件較大 → 物件
                    ma('5000', '30000'), //數字字串
                    ma(0.5, 30000), //物件小數(修前守門之toMs收小數而得0.5)無效 → 提示
                    ma(Infinity, 7000), //物件無效 → 提示(修前被無效值遮蔽而得預設20000)
                    ma('abc', 7000),
                    ma(5000, undefined), //只給物件
                    ma(undefined, 5000), //只給提示
                    ma(undefined, undefined), //皆未給 → 預設
                    ma(0, -1), //皆無效 → 預設
                ],
                [30000, 30000, 30000, 30000, 7000, 7000, 5000, 5000, 20000, 20000],
            )
        })

        //S1
        it('S1 shouldStop: 呼叫端物件與遞補層提示以「或」合併; 一來源拋錯、非函數、回傳非true不遮蔽另一來源; 皆無函數為null', function() {
            let sig = (objFn, hintFn) => {
                let c = resolveSpawnGate({ kind: 'opencode', spawnGate: offObj(objFn === undefined ? {} : { shouldStop: objFn }), shouldStop: hintFn, cores: 4 })
                return c.shouldStop === null ? null : c.shouldStop()
            }
            let boom = () => {
                throw new Error('x')
            }
            assert.strict.deepEqual(
                [
                    sig(() => false, () => true), //物件不中止、提示中止 → 中止(修前物件優先: 不中止)
                    sig(() => true, () => false), //物件中止
                    sig(() => false, () => false),
                    sig(boom, () => true), //物件拋錯 → 仍看提示
                    sig(() => true, boom),
                    sig('x', () => true), //物件非函數 → 看提示
                    sig(() => false, 123),
                    sig(() => 'true', () => 1), //非true皆視為否
                    sig(undefined, undefined), //皆無 → null
                    sig(undefined, () => true), //只給提示
                    sig(() => true, undefined), //只給物件
                ],
                [true, true, false, true, true, true, false, false, null, true, true],
            )
        })

    })

    //---------- cliSpawnGate行為(假時鐘不耗真實時間) ----------
    describe('cliSpawnGate: 提示之shouldStop中止守門等待(呼叫端自給shouldStop時亦然)', function() {

        it('S1 守門被擋(行程數達上限)而呼叫端shouldStop回false、遞補層提示之shouldStop回true → 立即以aborted中止(修前物件優先, 持續等待至期限fail-open)', async function() {
            let t = 1000000
            let sleep = async (ms) => {
                t += ms
            }
            let r = await cliSpawnGate({
                kind: 'opencode',
                shouldStop: () => true, //遞補層提示
                spawnGate: offObj({ maxCli: 1, countCli: async () => 5, shouldStop: () => false, pollMs: 100, gateWaitMaxMs: 10000, now: () => t, sleep }),
            })
            assert.strict.deepEqual([r.outcome, r.aborted, r.failOpen], ['aborted', true, false])
        })

    })

    //---------- runExecCli: 暫時性重試之預算與中止判斷 ----------
    describe('runExecCli: 暫時性重試之shouldStop與minAttemptMs合併', function() {

        let fake = null
        let seqNo = 0
        let ENTRY = `
import fs from 'node:fs'
let args = process.argv.slice(2)
let counter = (args.find((x) => x.startsWith('--counter=')) || '').slice(10)
let n = 0
try {
    n = Number(fs.readFileSync(counter, 'utf8'))
}
catch {}
fs.writeFileSync(counter, String(n + 1))
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    if (n === 0) {
        process.stderr.write('Error: Unexpected error database is locked')
        process.exit(1)
    }
    process.stdout.write('OK-' + (n + 1))
    process.exit(0)
})
`
        before(function() {
            fake = createFakeCli('fake-gate-hints-merge', ENTRY)
        })
        after(function() {
            if (fake) {
                fake.clean()
            }
        })

        //run: 第1次locked、第2次ok之假CLI; attempts 2代表有暫時性重試, 1代表被擋
        let run = async (opt) => {
            let counter = path.join(fake.fd, `counter-${++seqNo}.txt`)
            let r = await runExecCli(fake.exe, [`--counter=${counter}`], { spawnGateKind: 'opencode', input: 'abc', transientRetry: { delayMs: 1 }, ...opt })
            return [r.ok, r.attempts]
        }
        let off = (extra = {}) => ({ maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false, state: createGateState(), ...extra })

        it('S1 shouldStop: 呼叫端spawnGate.shouldStop回false而遞補層提示回true → 不重試(attempts 1; 修前物件優先而重試); 兩者皆false → 照常重試(對照)', async function() {
            let a = await run({ spawnGate: off({ shouldStop: () => false }), spawnGateHints: { shouldStop: () => true } })
            let b = await run({ spawnGate: off({ shouldStop: () => false }), spawnGateHints: { shouldStop: () => false } })
            let c = await run({ spawnGate: off({ shouldStop: () => true }), spawnGateHints: { shouldStop: () => false } })
            assert.strict.deepEqual([a, b, c], [[false, 1], [true, 2], [false, 1]])
        })

        it('S2 minAttemptMs: 剩餘約25秒時, 物件5000＋提示30000 → 取30000而不重試(attempts 1; 修前物件優先取5000而重試); 物件無效(\'abc\'、小數)不遮蔽提示之30000 → 不重試; 物件30000＋提示5000 → 取30000不重試; 兩者5000 → 重試(對照)', async function() {
            let da = () => Date.now() + 25000
            let a = await run({ spawnGate: off({ deadlineAt: da(), minAttemptMs: 5000 }), spawnGateHints: { deadlineAt: da(), minAttemptMs: 30000 } })
            let b = await run({ spawnGate: off({ deadlineAt: da(), minAttemptMs: 'abc' }), spawnGateHints: { deadlineAt: da(), minAttemptMs: 30000 } })
            let c = await run({ spawnGate: off({ deadlineAt: da(), minAttemptMs: 0.5 }), spawnGateHints: { deadlineAt: da(), minAttemptMs: 30000 } })
            let d = await run({ spawnGate: off({ deadlineAt: da(), minAttemptMs: 30000 }), spawnGateHints: { deadlineAt: da(), minAttemptMs: 5000 } })
            let e = await run({ spawnGate: off({ deadlineAt: da(), minAttemptMs: 5000 }), spawnGateHints: { deadlineAt: da(), minAttemptMs: 5000 } })
            assert.strict.deepEqual([a, b, c, d, e], [[false, 1], [false, 1], [false, 1], [false, 1], [true, 2]])
        })

    })

    //---------- 探針與互斥鎖等待受期限約束(真時間) ----------
    describe('cliSpawnGate: 探針與互斥鎖等待受期限約束(有期限時)', function() {

        //hangRam, 永不落定之RAM探針(以呼叫次數計)
        let hangRam = () => {
            let n = { calls: 0 }
            n.fn = () => {
                n.calls++
                return new Promise(() => {})
            }
            return n
        }

        it('S3 探針逾時不超過「期限 − minAttemptMs − 現在」: 期限約1.5秒、minAttemptMs 1秒 → 探針至多等約0.5秒(probeTimeoutMs 4秒); 修前等滿probeTimeoutMs', async function() {
            let ram = hangRam()
            let state = createGateState()
            let t0 = Date.now()
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: ram.fn, probeTimeoutMs: 4000, state, deadlineAt: Date.now() + 1500, minAttemptMs: 1000 }) })
            let wall = Date.now() - t0
            assert.strict.deepEqual([r.aborted, wall < 2500, ram.calls], [false, true, 1])
            assert.strict.deepEqual(Object.keys(state.probeDownUntil), []) //因期限被縮短而逾時者不算探針故障: 不冷卻
        })

        it('S3 期限已到(deadlineAt − minAttemptMs ≤ 現在): 探針只給最短逾時(1ms)、立即以fail-open放行(failOpen true, 不冷卻); 即時可得之探針結果照用(通過者仍為pass); 修前仍等滿probeTimeoutMs', async function() {
            let ram = hangRam()
            let state = createGateState()
            let t0 = Date.now()
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: ram.fn, probeTimeoutMs: 4000, state, deadlineAt: Date.now() + 500, minAttemptMs: 1000 }) })
            assert.strict.deepEqual([r.outcome, r.failOpen, Date.now() - t0 < 2500, ram.calls, Object.keys(state.probeDownUntil)], ['fail-open', true, true, 1, []])
            assert.strict.deepEqual([...state.reservations.values()].flat().length, 1) //因截止而fail-open者只登記1筆預約(不與一般通過之登記重複, 否則後續行程數估計多算1; 複審補: 變異G13存活)
            let r2 = await cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: async () => 0.1, probeTimeoutMs: 4000, state: createGateState(), deadlineAt: Date.now() + 500, minAttemptMs: 1000 }) })
            assert.strict.deepEqual([r2.outcome, r2.failOpen], ['pass', false]) //期限已過而探針即時回報通過 → 照用(不因期限已過而一律fail-open)
        })

        it('S5 無期限: 探針照常等滿probeTimeoutMs(逾時視為通過並冷卻該探針), 行為不變', async function() {
            let ram = hangRam()
            let state = createGateState()
            let t0 = Date.now()
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: ram.fn, probeTimeoutMs: 600, state }) })
            let wall = Date.now() - t0
            assert.strict.deepEqual([r.aborted, wall >= 500, ram.calls, Object.keys(state.probeDownUntil)], [false, true, 1, ['ram']])
        })

        it('S4 互斥鎖等待受期限約束: 前一呼叫持鎖(探針掛住約3秒)時, 同狀態之後來呼叫有期限約1.5秒、minAttemptMs 1秒 → 約0.5秒即fail-open放行(failOpen true); 修前排隊至前者釋放(約3秒)', async function() {
            let ram = hangRam()
            let state = createGateState()
            let holder = cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: ram.fn, probeTimeoutMs: 3000, state }) }) //無期限, 持鎖至探針逾時
            await new Promise((resolve) => setTimeout(resolve, 100)) //令持鎖者先取得鎖
            let t0 = Date.now()
            let r2 = await cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: ram.fn, probeTimeoutMs: 3000, state, deadlineAt: Date.now() + 1500, minAttemptMs: 1000 }) })
            let wait2 = Date.now() - t0
            assert.strict.deepEqual([r2.outcome, r2.failOpen, wait2 < 2200], ['fail-open', true, true])
            let r1 = await holder //持鎖者照常完成(取消排隊者不得使鎖遺失或重複釋放)
            assert.strict.deepEqual([r1.outcome, r1.aborted], ['pass', false])
            let r3 = await cliSpawnGate({ kind: 'opencode', spawnGate: offObj({ maxCli: false, ramUsedMax: 0.5, sampleRam: async () => 0.1, probeTimeoutMs: 3000, state }) }) //鎖已釋放且可再取
            assert.strict.deepEqual([r3.outcome, state.busy, state.queue.length], ['pass', false, 0])
        })

    })

})
