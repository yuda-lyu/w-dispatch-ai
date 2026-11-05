import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import cliSpawnGate, { resolveSpawnGate, createGateState, createCountCli, createCpuSampler, parseTasklistCsv, parsePsComm, defaultImages, exeStem, readTickets, writeTicket } from '../src/cliSpawnGate.mjs'
import { createWorld, settleAll } from './tools/spawnGateWorldForTest.mjs'


//hashOf, 預約票檔名之images雜湊(同src之算法: images小寫排序以|相接取sha1前10碼)
let hashOf = (images) => crypto.createHash('sha1').update(images.map((s) => s.toLowerCase()).sort().join('|')).digest('hex').slice(0, 10)


// 規格來源: Gitea #67(issue67.md §1、§4)、主控派工單〈主控之疑慮〉1～4、dspec〈計時器相關函數之觀察回調與測試〉(以onTrace事件同步、假時鐘)、
//   dspec〈輸入參數之檢測機制〉(K3 opt非預期輸入改用預設)。每條斷言註明對應之規格句(R編號見帳本R-SPAWNGATE-1)。


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

//gateOf, 組opencode之守門設定(預設關閉CPU與RAM檢查, 只測行程數; 各測試以extra覆寫)
function gateOf(extra = {}) {
    let state = createGateState()
    let events = []
    let logs = []
    let clock = fakeClock()
    let sg = {
        maxCli: 3,
        ramUsedMax: false,
        cpuMax: false,
        pollMs: 100,
        gateWaitMaxMs: 100000,
        now: clock.now,
        sleep: clock.sleep,
        state,
        ticketDir: false, //預設不寫跨行程預約票(不碰真實os.tmpdir(); 票之行為見專屬describe)
        minGapMs: false, //本檔測行程數／RAM／CPU與預約, 關閉放行最小間隔(R-SPAWNGATE-4之預設1500ms會改變這些案例之時間軸); 間隔之行為見unit-cliSpawnGateMinGap.test.mjs
        onTrace: (e) => events.push(e),
        log: (level, msg) => logs.push([level, msg]),
        ...extra,
    }
    return { sg, events, logs, clock, state }
}

let types = (events) => events.map((e) => e.type)


describe('cliSpawnGate(R-SPAWNGATE-1)', function() {

    describe('resolveSpawnGate: 預設值與種類解析', function() {

        it('opencode預設: 只數opencode.exe, maxCli = max(1, 核心數-1), RAM 0.85, CPU 0.90(issue §1.1-1、§1.1-2)', function() {
            let rs = [1, 2, 4, 8, 16].map((cores) => {
                let c = resolveSpawnGate({ kind: 'opencode', cores, platform: 'win32' })
                return [c.maxCli, c.ramUsedMax, c.cpuMax, c.images]
            })
            let rr = [
                [1, 0.85, 0.9, ['opencode.exe']],
                [1, 0.85, 0.9, ['opencode.exe']],
                [3, 0.85, 0.9, ['opencode.exe']],
                [7, 0.85, 0.9, ['opencode.exe']],
                [15, 0.85, 0.9, ['opencode.exe']],
            ]
            assert.strict.deepEqual(rs, rr)
        })

        it('非Windows之預設image去.exe; darwin之RAM門檻預設關(os.freemem不含可回收快取)(issue §1.1-1)', function() {
            let linux = resolveSpawnGate({ kind: 'opencode', cores: 4, platform: 'linux' })
            let darwin = resolveSpawnGate({ kind: 'opencode', cores: 4, platform: 'darwin' })
            assert.strict.deepEqual([linux.images, linux.ramUsedMax, darwin.images, darwin.ramUsedMax, darwin.cpuMax], [['opencode'], 0.85, ['opencode'], null, 0.9])
        })

        it('claude／codex／antigravity預設不守門(回傳null): 等候模型回應時幾乎不占CPU(主控疑慮1)', function() {
            let rs = ['claude', 'codex', 'antigravity'].map((kind) => resolveSpawnGate({ kind, cores: 8, platform: 'win32' }))
            assert.strict.deepEqual(rs, [null, null, null])
        })

        it('四個kind之CLI名與預設image對照(antigravity為agy)', function() {
            let r = ['opencode', 'claude', 'codex', 'antigravity', 'nope'].map((k) => defaultImages(k, 'win32'))
            assert.strict.deepEqual(r, [['opencode.exe'], ['claude.exe'], ['codex.exe'], ['agy.exe'], []])
        })

        it('claude等明給maxCli即啟用, 數該CLI之image, RAM與CPU門檻仍為預設關(主控疑慮1: 可分家設定)', function() {
            let c = resolveSpawnGate({ kind: 'claude', spawnGate: { maxCli: 4 }, platform: 'win32' })
            assert.strict.deepEqual([c.maxCli, c.images, c.ramUsedMax, c.cpuMax], [4, ['claude.exe'], null, null])
            let d = resolveSpawnGate({ kind: 'codex', spawnGate: { cpuMax: 0.8 }, platform: 'win32' })
            assert.strict.deepEqual([d.maxCli, d.ramUsedMax, d.cpuMax], [null, null, 0.8])
        })

        it('預設情形(未給spawnGate)只守「真的該CLI」: exe為假CLI或他程式時不守門; 明給true或物件不受限', function() {
            let exes = [undefined, 'opencode', 'C:\\Users\\x\\AppData\\Roaming\\npm\\opencode.cmd', '/usr/local/bin/opencode', 'OPENCODE.EXE']
            let hit = exes.map((exe) => resolveSpawnGate({ kind: 'opencode', exe, cores: 4 }) !== null)
            assert.strict.deepEqual(hit, [true, true, true, true, true])
            let miss = ['fake-opencode.cmd', 'C:\\x\\node.exe', 'opencode-wrapper', 'my-oc'].map((exe) => resolveSpawnGate({ kind: 'opencode', exe, cores: 4 }) !== null)
            assert.strict.deepEqual(miss, [false, false, false, false])
            let forced = [true, {}, { maxCli: 2 }].map((spawnGate) => resolveSpawnGate({ kind: 'opencode', exe: 'fake-opencode.cmd', spawnGate, cores: 4 }) !== null)
            assert.strict.deepEqual(forced, [true, true, true])
        })

        it('exeStem: 去目錄(含\\與/)與副檔名並轉小寫; 非字串回空字串', function() {
            let r = ['opencode', 'C:\\a\\b\\Claude.EXE', '/a/b/codex.cmd', 'agy.bat', 'x.y.exe', 5, null, ''].map(exeStem)
            assert.strict.deepEqual(r, ['opencode', 'claude', 'codex', 'agy', 'x.y', '', '', ''])
        })

        it('spawnGate:false 關閉(回傳null); 三項限制皆false亦無事可守(回傳null)', function() {
            assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: false }), null)
            assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false, ramUsedMax: false, cpuMax: false } }), null)
        })

        it('maxCli無效值改用預設而不拋錯(K3); 數字字串轉換後使用(K4); false關閉該項', function() {
            let bad = [0, -1, 2.5, 'abc', true, NaN, Infinity, {}, [], 1e12, '', ' ']
            let r = bad.map((v) => resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: v }, cores: 4 }).maxCli)
            assert.strict.deepEqual(r, bad.map(() => 3))
            let ok = [2, '2', ' 5 '].map((v) => resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: v }, cores: 4 }).maxCli)
            assert.strict.deepEqual(ok, [2, 2, 5])
            let off = resolveSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false }, cores: 4 })
            assert.strict.deepEqual([off.maxCli, off.ramUsedMax, off.cpuMax], [null, 0.85, 0.9])
        })

        it('ramUsedMax／cpuMax須為(0,1]之有效數字, 其餘改用預設, false關閉', function() {
            let bad = [0, -0.1, 1.01, 'x', NaN, true, {}, '']
            let r = bad.map((v) => {
                let c = resolveSpawnGate({ kind: 'opencode', spawnGate: { ramUsedMax: v, cpuMax: v }, cores: 4 })
                return [c.ramUsedMax, c.cpuMax]
            })
            assert.strict.deepEqual(r, bad.map(() => [0.85, 0.9]))
            let c = resolveSpawnGate({ kind: 'opencode', spawnGate: { ramUsedMax: '0.5', cpuMax: 1 }, cores: 4 })
            assert.strict.deepEqual([c.ramUsedMax, c.cpuMax], [0.5, 1])
            let off = resolveSpawnGate({ kind: 'opencode', spawnGate: { ramUsedMax: false, cpuMax: false }, cores: 4 })
            assert.strict.deepEqual([off.ramUsedMax, off.cpuMax, off.maxCli], [null, null, 3])
        })

        it('毫秒類須為正數且不超過2147483647, 其餘改用預設(pollMs 10000、gateWaitMaxMs 600000、settleMs 3000)', function() {
            let bad = [0, -5, 'abc', 2147483648, NaN, Infinity, true, {}, '']
            let r = bad.map((v) => {
                let c = resolveSpawnGate({ kind: 'opencode', spawnGate: { pollMs: v, gateWaitMaxMs: v, settleMs: v }, cores: 4 })
                return [c.pollMs, c.gateWaitMaxMs, c.settleMs]
            })
            assert.strict.deepEqual(r, bad.map(() => [10000, 600000, 3000]))
            let c = resolveSpawnGate({ kind: 'opencode', spawnGate: { pollMs: '250', gateWaitMaxMs: 1.5, settleMs: 2147483647 }, cores: 4 })
            assert.strict.deepEqual([c.pollMs, c.gateWaitMaxMs, c.settleMs], [250, 1.5, 2147483647])
        })

        it('images: 只收[A-Za-z0-9._-]之字串元素, 無效元素濾除, 全無效改用預設(不經shell, 無注入面)', function() {
            let c1 = resolveSpawnGate({ kind: 'opencode', spawnGate: { images: ['a.exe', 'b c.exe', 'x" & calc', '..\\evil', 5, null, 'ok-1_2.exe'] }, platform: 'win32', cores: 4 })
            assert.strict.deepEqual(c1.images, ['a.exe', 'ok-1_2.exe'])
            for (let v of [[], 'opencode.exe', ['', ' '], [5, null], {}, 0]) {
                let c = resolveSpawnGate({ kind: 'opencode', spawnGate: { images: v }, platform: 'win32', cores: 4 })
                assert.strict.deepEqual(c.images, ['opencode.exe'])
            }
        })

        it('spawnGate非預期型別(字串、數字、陣列)視為未給; 不可讀(拋錯之getter)視為未給, 皆不拋錯', function() {
            let hostile = {}
            Object.defineProperty(hostile, 'maxCli', {
                enumerable: true,
                get() {
                    throw new Error('boom')
                }
            })
            let r = ['x', 5, [], hostile, new Proxy({}, {
                ownKeys() {
                    throw new Error('boom')
                }
            })].map((spawnGate) => {
                let c = resolveSpawnGate({ kind: 'opencode', spawnGate, cores: 4 })
                return c === null ? null : c.maxCli
            })
            assert.strict.deepEqual(r, [3, 3, 3, 3, 3])
        })

        it('debug為true時非預期之設定值另輸出警告(只含鍵名、種類與預設, 不含傳入之值; K9)', function() {
            let logs = []
            resolveSpawnGate({ kind: 'opencode', spawnGate: { debug: true, log: (l, m) => logs.push([l, m]), maxCli: 'SECRET-VALUE-1', cpuMax: 'SECRET-VALUE-2', pollMs: 'SECRET-VALUE-3', images: ['bad name'] }, cores: 4, platform: 'win32' })
            assert.strict.deepEqual(logs.map((x) => x[0]), ['warn', 'warn', 'warn', 'warn'])
            assert.strict.deepEqual(logs.map((x) => /invalid opt\.(\w+): must be/.exec(x[1])[1]), ['maxCli', 'cpuMax', 'pollMs', 'images'])
            assert.strict.deepEqual(logs.some((x) => x[1].includes('SECRET-VALUE')), false)
            let quiet = []
            resolveSpawnGate({ kind: 'opencode', spawnGate: { log: (l, m) => quiet.push(m), maxCli: 'x' }, cores: 4 })
            assert.strict.deepEqual(quiet, [])
        })

        it('ticketDir: 預設為os.tmpdir()下之w-dispatch-ai-spawngate; false關閉(null); 非空字串採用; 其餘非預期改用預設(K3); pid預設為本行程', function() {
            let dflt = path.join(os.tmpdir(), 'w-dispatch-ai-spawngate')
            let c = resolveSpawnGate({ kind: 'opencode', cores: 4 })
            assert.strict.deepEqual([c.ticketDir, c.pid], [dflt, process.pid])
            assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: { ticketDir: false }, cores: 4 }).ticketDir, null)
            assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: { ticketDir: 'C:\\x\\tickets' }, cores: 4 }).ticketDir, 'C:\\x\\tickets')
            for (let v of ['', 5, true, {}, [], 'a\u0000b', NaN]) {
                assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: { ticketDir: v }, cores: 4 }).ticketDir, dflt)
            }
            assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: { pid: 4321 }, cores: 4 }).pid, 4321)
            for (let v of [0, -1, 1.5, 'x', true, {}]) {
                assert.strict.deepEqual(resolveSpawnGate({ kind: 'opencode', spawnGate: { pid: v }, cores: 4 }).pid, process.pid)
            }
        })

        it('呼叫層提示(shouldStop、deadlineAt、minAttemptMs)於spawnGate物件未給同名鍵時採用, 物件優先', function() {
            let f1 = () => true
            let f2 = () => false
            let c = resolveSpawnGate({ kind: 'opencode', shouldStop: f1, deadlineAt: 5000, minAttemptMs: 300, cores: 4 })
            assert.strict.deepEqual([c.shouldStop === f1, c.deadlineAt, c.minAttemptMs], [true, 5000, 300])
            let d = resolveSpawnGate({ kind: 'opencode', shouldStop: f1, deadlineAt: 5000, minAttemptMs: 300, spawnGate: { shouldStop: f2, deadlineAt: 7000, minAttemptMs: 100 }, cores: 4 })
            assert.strict.deepEqual([d.shouldStop === f2, d.deadlineAt, d.minAttemptMs], [true, 7000, 100])
            let e = resolveSpawnGate({ kind: 'opencode', shouldStop: 'x', deadlineAt: -1, minAttemptMs: 'x', cores: 4 })
            assert.strict.deepEqual([e.shouldStop, e.deadlineAt, e.minAttemptMs], [null, null, 20000])
        })
    })

    describe('計數與取樣之預設實作(parse、createCountCli、createCpuSampler)', function() {

        it('parseTasklistCsv: 數第一欄等於image之行(不分大小寫); 無符合時之提示訊息(各語系)不計', function() {
            let csv = [
                '"opencode.exe","1234","Console","1","360,000 K"',
                '"OpenCode.EXE","1235","Console","1","361,000 K"',
                '"opencode.exe.bak","1236","Console","1","1 K"',
                '"xopencode.exe","1237","Console","1","1 K"',
                '',
            ].join('\r\n')
            assert.strict.deepEqual(parseTasklistCsv(csv, 'opencode.exe'), 2)
            assert.strict.deepEqual(parseTasklistCsv('INFO: No tasks are running which match the specified criteria.\r\n', 'opencode.exe'), 0)
            assert.strict.deepEqual(parseTasklistCsv('資訊: 沒有執行中的工作符合指定的準則。\r\n', 'opencode.exe'), 0)
            assert.strict.deepEqual(parseTasklistCsv('', 'opencode.exe'), 0)
        })

        it('parsePsComm: 去目錄與.exe後比對名稱, 空行不計', function() {
            let ps = ['opencode', '/usr/bin/opencode', 'node', '  claude  ', 'opencode.exe', '', 'opencode-x'].join('\n')
            assert.strict.deepEqual(parsePsComm(ps, ['opencode.exe']), 3)
            assert.strict.deepEqual(parsePsComm(ps, ['opencode', 'claude']), 4)
            assert.strict.deepEqual(parsePsComm('', ['opencode']), 0)
        })

        it('createCountCli(win32): 每個image各以 /FI "IMAGENAME eq <image>" 篩選查詢(不全列舉)並合計, 無.exe者補上', async function() {
            let calls = []
            let count = createCountCli({
                platform: 'win32',
                run: async (file, args) => {
                    calls.push([file, args])
                    return args[4] === 'IMAGENAME eq a.exe' ? '"a.exe","1","Console","1","1 K"\r\n"a.exe","2","Console","1","1 K"\r\n' : '"b.exe","3","Console","1","1 K"\r\n'
                },
            })
            let n = await count(['a.exe', 'b'])
            assert.strict.deepEqual(n, 3)
            assert.strict.deepEqual(calls, [
                ['tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq a.exe']],
                ['tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq b.exe']],
            ])
        })

        it('createCountCli(非win32): 以 ps -eo comm= 列舉一次; 指令失敗即reject(由守門視為探針失敗)', async function() {
            let calls = []
            let count = createCountCli({
                platform: 'linux',
                run: async (file, args) => {
                    calls.push([file, args])
                    return 'opencode\nnode\nopencode\n'
                }
            })
            assert.strict.deepEqual(await count(['opencode']), 2)
            assert.strict.deepEqual(calls, [['ps', ['-eo', 'comm=']]])
            let bad = createCountCli({
                platform: 'linux',
                run: async () => {
                    throw new Error('no ps')
                }
            })
            await assert.rejects(() => bad(['opencode']), /no ps/)
        })

        it('createCpuSampler: 首次取樣等windowMs並算使用率; 0.3秒內重用上次值; 0.3~10秒內以差值計(不等); 超過10秒重取(等)', async function() {
            let clock = fakeClock(0)
            let sleeps = []
            let total = 0
            let idle = 0
            let busyShare = 0.5 //每次呼叫cpus之前, 依下一段之使用率推進累計值
            let advance = (dt) => {
                total += dt
                idle += dt * (1 - busyShare)
            }
            let cpus = () => [{ times: { user: total - idle, nice: 0, sys: 0, idle, irq: 0 } }]
            let sampler = createCpuSampler({
                cpus,
                now: clock.now,
                sleep: async (ms) => {
                    sleeps.push(ms)
                    clock.sleep(ms)
                    advance(ms)
                },
            })

            //首次: 等1000ms, 使用率0.5
            let v1 = await sampler.sample()
            assert.strict.deepEqual([v1, sleeps], [0.5, [1000]])

            //0.1秒後: 重用(不等、值不變)
            await clock.sleep(100)
            advance(100)
            busyShare = 1
            let v2 = await sampler.sample()
            assert.strict.deepEqual([v2, sleeps], [0.5, [1000]])

            //5秒後: 以「自上次取樣(1秒處)起」之差計(含其後0.1秒之使用率0.5與此段5秒之使用率1: 1 − 50/5100 ≈ 0.99), 不等
            await clock.sleep(5000)
            advance(5000)
            let v3 = await sampler.sample()
            assert.strict.deepEqual([Math.round(v3 * 100) / 100, sleeps], [0.99, [1000]])

            //超過10秒: 重取, 等1000ms
            await clock.sleep(20000)
            advance(20000)
            busyShare = 0.2
            let v4 = await sampler.sample()
            assert.strict.deepEqual([Math.round(v4 * 100) / 100, sleeps], [0.2, [1000, 1000]])
        })

        it('createCpuSampler: 累計時間無增長(total差為0)時回傳null而非NaN', async function() {
            let clock = fakeClock(0)
            let sampler = createCpuSampler({ cpus: () => [{ times: { user: 5, nice: 0, sys: 0, idle: 5, irq: 0 } }], now: clock.now, sleep: clock.sleep })
            assert.strict.deepEqual(await sampler.sample(), null)
        })
    })

    describe('守門行為(假機器、假時鐘、以onTrace事件同步)', function() {

        it('issue §4: 行程數2 < maxCli 3 → 直接放行(gated false, 不等待)', async function() {
            let g = gateOf({ countCli: async () => 2 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([r.outcome, r.gated, r.waitedMs, r.failOpen, r.snapshot.cli], ['pass', false, 0, false, 2])
            assert.strict.deepEqual(types(g.events), ['start', 'check', 'pass'])
            assert.strict.deepEqual(g.logs, [])
        })

        it('issue §4: 行程數3 ≥ maxCli 3 → 被擋, 數降為2後放行(等待後放行, 日誌被擋與放行各一行)', async function() {
            let counts = [3, 3, 2]
            let g = gateOf({ countCli: async () => counts.shift() })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([r.outcome, r.gated, r.waitedMs], ['waited', true, 200])
            assert.strict.deepEqual(types(g.events), ['start', 'check', 'wait', 'check', 'wait', 'check', 'pass'])
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'check').map((e) => [e.n, e.pass, e.blockedBy, e.visible, e.cli]), [
                [1, false, 'count', 3, 3],
                [2, false, 'count', 3, 3],
                [3, true, '', 2, 2],
            ])
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'wait').map((e) => e.ms), [100, 100])
            assert.strict.deepEqual(g.events.at(-1).gated, true)
            //日誌: 被擋時info一行(不每輪洗版)、放行時info一行
            assert.strict.deepEqual(g.logs.map((x) => x[0]), ['info', 'info'])
            assert.strict.deepEqual(/waiting \(blockedBy=count cli=3/.test(g.logs[0][1]) && /released after 0s/.test(g.logs[1][1]), true)
        })

        it('issue §4: CPU 0.95 > cpuMax 0.90 被擋, 0.5放行; 邊界值恰等於門檻不擋', async function() {
            let seq = [0.95, 0.9, 0.5]
            let g = gateOf({ maxCli: false, cpuMax: 0.9, sampleCpu: async () => seq.shift() })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'check').map((e) => [e.pass, e.blockedBy, e.cpu]), [[false, 'cpu', 0.95], [true, '', 0.9]])
            assert.strict.deepEqual([r.outcome, r.snapshot.cpu], ['waited', 0.9])
        })

        it('issue §4: RAM 0.9 > ramUsedMax 0.85 被擋, 0.5放行; 邊界值恰等於門檻不擋', async function() {
            let seq = [0.9, 0.85]
            let g = gateOf({ maxCli: false, ramUsedMax: 0.85, sampleRam: () => seq.shift() })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'check').map((e) => [e.pass, e.blockedBy, e.ram]), [[false, 'ram', 0.9], [true, '', 0.85]])
            assert.strict.deepEqual([r.outcome, r.snapshot.ram], ['waited', 0.85])
        })

        it('三項皆開時依序RAM→行程數→CPU, RAM或行程數已擋即不取CPU樣(CPU取樣約1秒, 省之; 主控疑慮3)', async function() {
            let cpuCalls = 0
            let ramSeq = [0.9, 0.5, 0.5]
            let cntSeq = [1, 5, 1]
            let g = gateOf({
                ramUsedMax: 0.85,
                cpuMax: 0.9,
                sampleRam: () => ramSeq.shift(),
                countCli: async () => cntSeq.shift(),
                sampleCpu: async () => {
                    cpuCalls++
                    return 0.1
                },
            })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            let checks = g.events.filter((e) => e.type === 'check')
            assert.strict.deepEqual(checks.map((e) => [e.blockedBy, e.cpu]), [['ram', null], ['count', null], ['', 0.1]])
            assert.strict.deepEqual([cpuCalls, r.outcome], [1, 'waited'])
        })

        it('多項同時超標時blockedBy依序列出(ram,count), 且不取CPU樣', async function() {
            let g = gateOf({ ramUsedMax: 0.85, cpuMax: 0.9, sampleRam: () => 0.99, countCli: async () => 9, sampleCpu: async () => 0.1, gateWaitMaxMs: 150 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(g.events.find((e) => e.type === 'check').blockedBy, 'ram,count')
            assert.strict.deepEqual(r.outcome, 'fail-open')
        })

        it('issue §4: gateWaitMaxMs到期仍被擋 → fail-open放行並warn(failOpen true), 不回error', async function() {
            let g = gateOf({ countCli: async () => 3, pollMs: 100, gateWaitMaxMs: 250 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([r.outcome, r.failOpen, r.gated, r.waitedMs, r.aborted], ['fail-open', true, true, 250, false])
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'wait').map((e) => e.ms), [100, 100, 50])
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'check').length, 4)
            assert.strict.deepEqual(g.events.at(-1), { type: 'fail-open', reason: 'timeout', waitedMs: 250 })
            assert.strict.deepEqual(g.logs.map((x) => x[0]), ['info', 'warn'])
            assert.strict.deepEqual(/proceeding \(fail-open\)/.test(g.logs[1][1]), true)
        })

        it('燈號門檻全關或限制皆false → 無事可守, 不呼叫任何探針(outcome off, snapshot全null)', async function() {
            let calls = 0
            let spy = async () => {
                calls++
                return 0
            }
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: { maxCli: false, ramUsedMax: false, cpuMax: false, countCli: spy, sampleCpu: spy, sampleRam: spy } })
            assert.strict.deepEqual([r.outcome, r.snapshot, calls], ['off', { cli: null, cpu: null, ram: null }, 0])
        })

        it('spawnGate:false 與claude預設 → outcome off, 未取任何樣(snapshot全null)(issue §4 spawnGate:false不呼叫計數)', async function() {
            for (let o of [{ kind: 'opencode', spawnGate: false }, { kind: 'claude' }, { kind: 'codex', spawnGate: undefined }, { kind: 'antigravity', spawnGate: null }, { kind: 'opencode', exe: 'fake.cmd' }, {}]) {
                let r = await cliSpawnGate(o)
                assert.strict.deepEqual([r.outcome, r.gated, r.waitedMs, r.snapshot, r.failOpen], ['off', false, 0, { cli: null, cpu: null, ram: null }, false])
            }
        })

        it('未給onTrace、log時行為相同(零成本); 回調拋錯或回傳rejected Promise皆不影響結果與不產生未處理rejection', async function() {
            let counts = [3, 1]
            let g1 = gateOf({ countCli: async () => counts.shift(), onTrace: undefined, log: undefined })
            let r1 = await cliSpawnGate({ kind: 'opencode', spawnGate: g1.sg })
            let counts2 = [3, 1]
            let g2 = gateOf({
                countCli: async () => counts2.shift(),
                onTrace: () => {
                    throw new Error('trace boom')
                },
                log: () => {
                    throw new Error('log boom')
                },
            })
            let r2 = await cliSpawnGate({ kind: 'opencode', spawnGate: g2.sg })
            let counts3 = [3, 1]
            let g3 = gateOf({
                countCli: async () => counts3.shift(),
                onTrace: async () => {
                    throw new Error('async trace boom')
                }
            })
            let r3 = await cliSpawnGate({ kind: 'opencode', spawnGate: g3.sg })
            assert.strict.deepEqual([r1, r2, r3].map((r) => [r.outcome, r.waitedMs]), [['waited', 100], ['waited', 100], ['waited', 100]])
        })

        it('事件為凍結物件且type皆為JSDoc列舉之固定字串', async function() {
            let counts = [9, 1]
            let g = gateOf({ countCli: async () => counts.shift() })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(g.events.every((e) => Object.isFrozen(e)), true)
            let allowed = ['start', 'probe-fail', 'probe-skip', 'recount', 'check', 'wait', 'pass', 'fail-open', 'aborted']
            assert.strict.deepEqual(g.events.every((e) => allowed.includes(e.type)), true)
        })

        it('shouldStop為真時不再等待(outcome aborted), 且不呼叫任何探針; 等待中轉真則於下一輪起點中止', async function() {
            let calls = 0
            let r0 = await cliSpawnGate({
                kind: 'opencode',
                spawnGate: {
                    ...gateOf().sg,
                    countCli: async () => {
                        calls++
                        return 0
                    },
                    shouldStop: () => true
                }
            })
            assert.strict.deepEqual([r0.outcome, r0.aborted, r0.failOpen, calls], ['aborted', true, false, 0])

            let stop = false
            let g = gateOf({
                countCli: async () => 9,
                shouldStop: () => stop,
                sleep: async (ms) => {
                    stop = true //第一次等待後呼叫端成果已無人接收
                    g.clock.sleep(ms)
                }
            })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([r.outcome, r.aborted, r.gated], ['aborted', true, true])
            assert.strict.deepEqual(types(g.events), ['start', 'check', 'wait', 'aborted'])
        })

        it('shouldStop拋錯或回傳非true視同不中止(不得中斷守門)', async function() {
            for (let fn of [() => {
                throw new Error('x')
            }, () => 'true', () => 1, async () => true, () => undefined]) {
                let g = gateOf({ countCli: async () => 0, shouldStop: fn })
                let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
                assert.strict.deepEqual(r.outcome, 'pass')
            }
        })

        it('deadlineAt(遞補層之budgetMs): 等待不超過 deadlineAt − minAttemptMs, 到點即fail-open(守門等待計入預算)', async function() {
            let clock = fakeClock(1000)
            let g = gateOf({ countCli: async () => 9, now: clock.now, sleep: clock.sleep, pollMs: 100, gateWaitMaxMs: 100000, deadlineAt: 1000 + 600, minAttemptMs: 200 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([r.outcome, r.waitedMs], ['fail-open', 400])
            //無deadlineAt時不受限(對照: 同設定之等待上限100000)
            let g2 = gateOf({ countCli: async () => 9, pollMs: 100, gateWaitMaxMs: 500 })
            let r2 = await cliSpawnGate({ kind: 'opencode', spawnGate: g2.sg })
            assert.strict.deepEqual([r2.outcome, r2.waitedMs], ['fail-open', 500])
        })

        it('呼叫層提示(shouldStop／deadlineAt／minAttemptMs)於預設情形(未給spawnGate)亦生效', async function() {
            let stop = true
            let r = await cliSpawnGate({ kind: 'opencode', exe: 'opencode', shouldStop: () => stop, cores: 4 })
            assert.strict.deepEqual([r.outcome, r.aborted], ['aborted', true])
        })
    })

    describe('fail-open: 計數或取樣本身失敗必放行, 不得使派工失敗(主控疑慮4)', function() {

        let failures = {
            '拋出例外(同步)': () => {
                throw new Error('boom')
            },
            'reject': () => Promise.reject(new Error('boom')),
            '回傳NaN': () => NaN,
            '回傳負數': () => -1,
            '回傳小數': () => 1.5,
            '回傳字串': () => '3',
            '回傳undefined': () => undefined,
            '回傳null': () => null,
            '回傳Infinity': () => Infinity,
        }

        for (let [name, fn] of Object.entries(failures)) {
            it(`countCli ${name} → 該項視為通過(放行), 記probe-fail事件與warn, 不reject`, async function() {
                let g = gateOf({ countCli: fn })
                let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
                assert.strict.deepEqual([r.outcome, r.failOpen, r.snapshot.cli], ['pass', false, null])
                let pf = g.events.find((e) => e.type === 'probe-fail')
                assert.strict.deepEqual([pf.probe, ['threw', 'invalid'].includes(pf.reason)], ['count', true])
                assert.strict.deepEqual(g.logs.map((x) => x[0]), ['warn'])
            })
        }

        it('sampleRam／sampleCpu 失敗或回傳超出0~1亦視為通過, 且各自只影響自己那一項', async function() {
            let g = gateOf({
                maxCli: 3,
                ramUsedMax: 0.85,
                cpuMax: 0.9,
                sampleRam: () => {
                    throw new Error('x')
                },
                sampleCpu: async () => 1.5,
                countCli: async () => 1,
            })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'probe-fail').map((e) => [e.probe, e.reason]), [['ram', 'threw'], ['cpu', 'invalid']])
            assert.strict.deepEqual([r.outcome, r.snapshot], ['pass', { cli: 1, cpu: null, ram: null }])
        })

        it('探針懸置(永不落定)以probeTimeoutMs判逾時而放行(以事件判定, 不以延時斷言)', async function() {
            let g = gateOf({ countCli: () => new Promise(() => {}), probeTimeoutMs: 30 })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(g.events.find((e) => e.type === 'probe-fail'), { type: 'probe-fail', probe: 'count', reason: 'timeout' })
            assert.strict.deepEqual(r.outcome, 'pass')
        })

        it('探針失敗後probeFailCooldownMs內不再呼叫(probe-skip), 冷卻過後恢復呼叫(免對壞掉之tasklist每次卡住)', async function() {
            let calls = 0
            let behave = 'throw'
            let g = gateOf({
                probeFailCooldownMs: 1000,
                countCli: async () => {
                    calls++
                    if (behave === 'throw') {
                        throw new Error('x')
                    }
                    return 0
                }
            })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([calls, g.events.filter((e) => e.type === 'probe-skip').length], [1, 1])
            behave = 'ok'
            await g.clock.sleep(1000)
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([calls, r.snapshot.cli], [2, 0])
        })

        it('同一探針之同一失敗原因warn只一次(同狀態物件)', async function() {
            let g = gateOf({
                probeFailCooldownMs: 1,
                countCli: () => {
                    throw new Error('x')
                }
            })
            for (let i = 0; i < 3; i++) {
                await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
                await g.clock.sleep(10)
            }
            assert.strict.deepEqual(g.logs.filter((x) => x[0] === 'warn').length, 1)
        })

        it('守門本身之未預期例外(如注入之sleep拋錯)亦放行(outcome fail-open), 永不reject', async function() {
            let g = gateOf({
                countCli: async () => 9,
                sleep: async () => {
                    throw new Error('sleep broke')
                }
            })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([r.outcome, r.failOpen, r.aborted], ['fail-open', true, false])
        })

        it('不可讀之spawnGate(拋錯getter)不使守門失敗: 視為未給, 取預設後正常運作', async function() {
            let hostile = {}
            Object.defineProperty(hostile, 'maxCli', {
                enumerable: true,
                get() {
                    throw new Error('boom')
                }
            })
            let r = await cliSpawnGate({ kind: 'claude', spawnGate: hostile })
            assert.strict.deepEqual(r.outcome, 'off') //claude預設不限
        })
    })

    describe('同一瞬間整批放行(主控疑慮2): 行程內序列化＋預約', function() {

        //simulate, 模擬N個呼叫同一瞬間進門: 通過守門後才spawn(spawn後visibleLagMs才出現在計數)
        let simulate = async (n, worldOpt, sgOpt = {}) => {
            let world = createWorld(worldOpt)
            let state = createGateState()
            let outs = []
            let ps = Array.from({ length: n }, (_, i) => (async () => {
                let r = await cliSpawnGate({
                    kind: 'opencode',
                    spawnGate: { maxCli: 3, ramUsedMax: false, cpuMax: false, minGapMs: false, pollMs: 10000, gateWaitMaxMs: 600000, settleMs: 3000, countCli: world.countCli, now: world.now, sleep: world.sleep, state, ticketDir: false, ...sgOpt },
                })
                world.spawn(i)
                outs.push([i, r.outcome, world.now()])
            })())
            await settleAll(world, ps)
            return { world, outs }
        }

        it('6個呼叫同一瞬間進門、子行程1秒後才出現在計數: 真實併發恆≤maxCli 3, 全部最終放行', async function() {
            let { world, outs } = await simulate(6, { visibleLagMs: 1000, lifeMs: 20000 })
            assert.strict.deepEqual(world.stats.maxConcurrent, 3)
            assert.strict.deepEqual(outs.length, 6)
            //前3個同一瞬間直接放行(未等待), 其餘3個等到前批結束(20秒)後才放行
            let first = outs.filter((o) => o[1] === 'pass').map((o) => o[0]).sort()
            let later = outs.filter((o) => o[1] === 'waited')
            assert.strict.deepEqual([first, later.length], [[0, 1, 2], 3])
            assert.strict.deepEqual(later.every((o) => o[2] >= 1000000 + 20000), true)
        })

        it('子行程從未出現在計數(如spawn即失敗): 預約過期(settleMs)後不再占名額, 不無限累加', async function() {
            let { world, outs } = await simulate(6, { visibleLagMs: Infinity, lifeMs: Infinity })
            //前3個放行; 其餘3個於第一次輪詢(10秒, 預約已過期)時放行
            assert.strict.deepEqual(outs.map((o) => o[1]).sort(), ['pass', 'pass', 'pass', 'waited', 'waited', 'waited'])
            let waited = outs.filter((o) => o[1] === 'waited')
            assert.strict.deepEqual(waited.every((o) => o[2] === 1000000 + 10000), true)
            //第二批3個之放行亦各登記預約, 但不致把名額無限占住: 真實併發為6(因該模擬行程永不結束、計數永遠看不到), 此處只證明不死鎖、不無限等待
            assert.strict.deepEqual(world.stats.spawned, 6)
        })

        it('9個呼叫、行程存活20秒: 分三批(3+3+3)放行, 真實併發恆≤3', async function() {
            let { world, outs } = await simulate(9, { visibleLagMs: 500, lifeMs: 20000 })
            assert.strict.deepEqual([world.stats.maxConcurrent, outs.length], [3, 9])
        })

        it('maxCli為1時: 同一瞬間4個呼叫逐一放行(嚴格序列), 真實併發恆為1', async function() {
            let { world } = await simulate(4, { visibleLagMs: 800, lifeMs: 15000 }, { maxCli: 1 })
            assert.strict.deepEqual(world.stats.maxConcurrent, 1)
        })

        it('狀態物件互相隔離: 另一個狀態物件之預約不影響本狀態(各自獨立計數)', async function() {
            let world = createWorld({ visibleLagMs: Infinity, lifeMs: Infinity })
            let base = { kind: 'opencode', spawnGate: { maxCli: 1, ramUsedMax: false, cpuMax: false, minGapMs: false, countCli: world.countCli, now: world.now, sleep: world.sleep, ticketDir: false } }
            let a = createGateState()
            let b = createGateState()
            let ra = await cliSpawnGate({ ...base, spawnGate: { ...base.spawnGate, state: a } })
            let rb = await cliSpawnGate({ ...base, spawnGate: { ...base.spawnGate, state: b } })
            assert.strict.deepEqual([ra.outcome, rb.outcome], ['pass', 'pass'])
            //同一狀態再進一個: 被預約擋下, 以gateWaitMaxMs小值使其fail-open以便收尾(假時鐘由settleAll推進)
            let rc = null
            await settleAll(world, [(async () => {
                rc = await cliSpawnGate({ ...base, spawnGate: { ...base.spawnGate, state: a, pollMs: 100, gateWaitMaxMs: 200 } })
            })()])
            assert.strict.deepEqual([rc.outcome, rc.gated], ['fail-open', true])
        })

        it('同一臨界區之FIFO: 先進門者先通過(等待佇列依進門順序)', async function() {
            let world = createWorld({ visibleLagMs: 100, lifeMs: 100000 })
            let state = createGateState()
            let order = []
            let ps = [0, 1, 2, 3, 4, 5].map((i) => (async () => {
                await cliSpawnGate({ kind: 'opencode', spawnGate: { maxCli: 6, ramUsedMax: false, cpuMax: false, minGapMs: false, countCli: world.countCli, now: world.now, sleep: world.sleep, state, ticketDir: false } })
                order.push(i)
            })())
            await settleAll(world, ps)
            assert.strict.deepEqual(order, [0, 1, 2, 3, 4, 5])
        })
    })

    describe('取新CPU樣之後放行前重查行程數(取樣約1秒, 其間他行程可能已放行)', function() {

        it('慢取樣(耗時≥200ms)期間行程數由0增為3: 放行前重查而被擋(recount事件), 不依取樣前之舊讀數放行', async function() {
            let counts = [0, 3, 2]
            let cpuCalls = 0
            let g = gateOf({
                maxCli: 3,
                cpuMax: 0.9,
                countCli: async () => counts.shift(),
                sampleCpu: async () => {
                    cpuCalls++
                    if (cpuCalls === 1) {
                        await g.clock.sleep(1000) //模擬新取樣耗1秒(假時鐘推進)
                    }
                    return 0.1
                },
            })
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(types(g.events), ['start', 'recount', 'check', 'wait', 'check', 'pass'])
            assert.strict.deepEqual(g.events.filter((e) => e.type === 'check').map((e) => [e.pass, e.blockedBy, e.visible]), [[false, 'count', 3], [true, '', 2]])
            assert.strict.deepEqual([r.outcome, g.events.find((e) => e.type === 'recount').afterMs], ['waited', 1000])
        })

        it('取樣瞬間完成(重用上次樣, <200ms)不重查; 未限行程數(maxCli false)時亦不重查', async function() {
            let calls = 0
            let g = gateOf({
                maxCli: 3,
                cpuMax: 0.9,
                countCli: async () => {
                    calls++
                    return 0
                },
                sampleCpu: async () => 0.1
            })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual([calls, types(g.events).includes('recount')], [1, false])
            let g2 = gateOf({
                maxCli: false,
                cpuMax: 0.9,
                sampleCpu: async () => {
                    await g2.clock.sleep(1000)
                    return 0.1
                }
            })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g2.sg })
            assert.strict.deepEqual(types(g2.events).includes('recount'), false)
        })
    })

    describe('跨行程預約票(整點多個專案同時起跑; 主控疑慮2之跨行程部分)', function() {

        let base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'cliSpawnGate-tickets')
        let seq = 0
        let dirOf = () => path.join(base, `case${++seq}`)
        after(function() {
            fs.rmSync(base, { recursive: true, force: true })
        })

        it('writeTicket寫空檔案(檔名帶雜湊、pid、時刻、所見行程數或n); readTickets只收同雜湊、他行程、settleMs內者, 並刪除超過60秒者', function() {
            let dir = dirOf()
            writeTicket(dir, 'aaaaaaaaaa', 111, 1000000, 2)
            writeTicket(dir, 'aaaaaaaaaa', 222, 1000500, 1)
            writeTicket(dir, 'aaaaaaaaaa', 333, 1000900, null)
            writeTicket(dir, 'bbbbbbbbbb', 222, 1001000, 0) //他種image
            writeTicket(dir, 'aaaaaaaaaa', 222, 1000000 - 5000, 0) //過期(>settleMs)但未達清理門檻
            writeTicket(dir, 'aaaaaaaaaa', 222, 1000000 - 61000, 0) //超過60秒: 應被刪除
            fs.writeFileSync(path.join(dir, 'not-a-ticket.txt'), '')
            let names = fs.readdirSync(dir)
            assert.strict.deepEqual(names.filter((n) => /^[0-9a-f]+\.\d+\.\d+\.(n|\d+)\.[0-9a-z]+$/.test(n)).length, 6)
            assert.strict.deepEqual(names.every((n) => fs.statSync(path.join(dir, n)).size === 0), true)
            let got = readTickets(dir, 'aaaaaaaaaa', 1001000, 3000, 111).sort((a, b) => a.t - b.t)
            assert.strict.deepEqual(got, [{ t: 1000500, v: 1 }, { t: 1000900, v: null }]) //111為本行程不計, 過期者不計
            assert.strict.deepEqual(fs.readdirSync(dir).filter((n) => n.includes(`.${1000000 - 61000}.`)).length, 0) //超過60秒者已刪
            assert.strict.deepEqual(fs.readdirSync(dir).filter((n) => n.includes(`.${1000000 - 5000}.`)).length, 1) //過期但未達清理者保留
        })

        it('readTickets: 資料夾不存在或不可讀回空陣列, 不拋錯', function() {
            assert.strict.deepEqual(readTickets(path.join(base, 'no-such-dir'), 'aaaaaaaaaa', 1, 3000, 1), [])
        })

        it('兩個「行程」(不同pid、共用票資料夾與機器)同一瞬間各發3個呼叫、maxCli 2: 有票時全機真實併發≤2; 無票(ticketDir:false)時各放行2個而達4(對照)', async function() {
            let run = async (ticketDir) => {
                let world = createWorld({ visibleLagMs: 1000, lifeMs: 20000 })
                let states = [createGateState(), createGateState()]
                let ps = [0, 1, 2, 3, 4, 5].map((i) => (async () => {
                    let proc = i < 3 ? 0 : 1
                    await cliSpawnGate({ kind: 'opencode', spawnGate: { maxCli: 2, ramUsedMax: false, cpuMax: false, minGapMs: false, pollMs: 10000, settleMs: 3000, countCli: world.countCli, now: world.now, sleep: world.sleep, state: states[proc], pid: proc === 0 ? 111 : 222, ticketDir } })
                    world.spawn(i)
                })())
                await settleAll(world, ps)
                return world.stats.maxConcurrent
            }
            let withTickets = await run(dirOf())
            let without = await run(false)
            assert.strict.deepEqual([withTickets, without], [2, 4])
        })

        it('本行程自己之票不重複計入(其預約已在記憶體): 同pid連續兩個放行不被自己之票擋下', async function() {
            let dir = dirOf()
            let world = createWorld({ visibleLagMs: 1000, lifeMs: 20000 })
            let state = createGateState()
            let sg = { maxCli: 2, ramUsedMax: false, cpuMax: false, minGapMs: false, countCli: world.countCli, now: world.now, sleep: world.sleep, state, pid: 111, ticketDir: dir }
            let a = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            let b = await cliSpawnGate({ kind: 'opencode', spawnGate: sg })
            assert.strict.deepEqual([a.outcome, b.outcome, b.snapshot.cli], ['pass', 'pass', 1])
        })

        it('他行程之票於settleMs內計入、過期不計: 新票(齡1秒, 當時所見1)令行程數估為2而被擋; 5秒前之票不計', async function() {
            let dir = dirOf()
            let world = createWorld({ visibleLagMs: Infinity, lifeMs: Infinity })
            let sgOf = () => ({ maxCli: 2, ramUsedMax: false, cpuMax: false, minGapMs: false, countCli: async () => 1, now: world.now, sleep: world.sleep, state: createGateState(), pid: 111, ticketDir: dir, pollMs: 100, gateWaitMaxMs: 200 })
            writeTicket(dir, hashOf(['opencode.exe']), 222, world.now() - 1000, 1)
            let blocked = null
            await settleAll(world, [(async () => {
                blocked = await cliSpawnGate({ kind: 'opencode', spawnGate: { ...sgOf(), images: ['opencode.exe'] } })
            })()])
            assert.strict.deepEqual([blocked.outcome, blocked.snapshot.cli], ['fail-open', 2])
            let dir2 = dirOf()
            writeTicket(dir2, hashOf(['opencode.exe']), 222, world.now() - 5000, 1)
            let r = await cliSpawnGate({ kind: 'opencode', spawnGate: { ...sgOf(), ticketDir: dir2, images: ['opencode.exe'] } })
            assert.strict.deepEqual([r.outcome, r.snapshot.cli], ['pass', 1])
        })

        it('只在限行程數(maxCli)或錯開間隔(minGapMs)時才寫票: 兩者皆關(maxCli false、minGapMs false，只看RAM／CPU)時不寫; ticketDir:false 不寫; 票寫入失敗(路徑為檔案)靜默, 守門照常放行(間隔啟用時之寫票見unit-cliSpawnGateMinGap)', async function() {
            let dir = dirOf()
            let g = gateOf({ maxCli: false, ramUsedMax: 0.9, sampleRam: () => 0.1, ticketDir: dir })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g.sg })
            assert.strict.deepEqual(fs.existsSync(dir), false)
            let g2 = gateOf({ countCli: async () => 0, ticketDir: false })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g2.sg })
            //路徑為檔案: mkdir／write皆失敗
            fs.mkdirSync(base, { recursive: true })
            let fileAsDir = path.join(base, 'iam-a-file')
            fs.writeFileSync(fileAsDir, 'x')
            let g3 = gateOf({ countCli: async () => 0, ticketDir: fileAsDir })
            let r3 = await cliSpawnGate({ kind: 'opencode', spawnGate: g3.sg })
            assert.strict.deepEqual([r3.outcome, r3.failOpen], ['pass', false])
            //有限行程數時確實寫票
            let dir4 = dirOf()
            let g4 = gateOf({ countCli: async () => 0, ticketDir: dir4 })
            await cliSpawnGate({ kind: 'opencode', spawnGate: g4.sg })
            assert.strict.deepEqual(fs.readdirSync(dir4).length, 1)
        })
    })
})
