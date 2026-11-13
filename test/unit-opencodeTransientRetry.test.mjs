import assert from 'assert'
import fs from 'fs'
import path from 'path'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import runExecCli, * as runExecCliNs from '../src/runExecCli.mjs'
import { createGateState } from '../src/cliSpawnGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-opencodeTransientRetry.test.mjs — opencode 暫時性錯誤(本機資料庫鎖競爭「database is locked」)之同家重試一次(帳本R-SPAWNGATE-5; Gitea #85)
//
// 規格來源: 主控派工 da320〈主控已定〉——辨識 `database is locked` 且失敗很快(預設 <15 秒)才重試; 獨立於 maxRetries、不佔其次數; 每次呼叫至多一次;
//   重試前再過守門; attempts 照實累計; shouldStop 成立或遞補層預算不足時不重試; 仍失敗才交遞補層; 不開放可配置之正規式(內部常數), 延遲可注入以利測試;
//   逾時類失敗不因此多重試; maxRetries 0 仍只一次; claude／codex／antigravity 預設行為不變。
// 假CLI: 依計數檔決定「第幾次呼叫」之行為(--seq=locked,ok,...), 計數檔落在假CLI資料夾; 重試延遲以 transientRetry.delayMs 注入為1ms, 不以固定等待同步。


//isTransientFailure、TRANSIENT_RETRY_DEFAULTS取自命名空間(缺少時該組案例以「不是函數」紅燈, 不使整檔因匯入失敗而全紅)
let isTransientFailure = (...a) => runExecCliNs.isTransientFailure(...a)
let TRANSIENT_RETRY_DEFAULTS = runExecCliNs.TRANSIENT_RETRY_DEFAULTS

//假CLI本體: --counter=<檔> 記呼叫次數, --seq=<逗號分隔行為> 依次數取行為(超出取最後一個)
//行為: ok(stdout OK-<n>, 離開碼0)｜locked(stderr含database is locked, 離開碼1)｜other(stderr其他錯誤, 離開碼1)｜
//      locked-event(離開碼1, stdout為type error之JSON事件行, 文字含database is locked)｜locked-stdout(離開碼1, 純文字stdout含該字樣、stderr空)｜
//      locked-hang(寫該字樣至stderr後掛住, 供逾時)｜locked-slow(400ms後才失敗)
let ENTRY = `
import fs from 'node:fs'
let args = process.argv.slice(2)
let get = (k) => {
    let p = '--' + k + '='
    let a = args.find((x) => x.startsWith(p))
    return a ? a.slice(p.length) : ''
}
let counter = get('counter')
let seq = get('seq').split(',')
let n = 0
try {
    n = Number(fs.readFileSync(counter, 'utf8'))
}
catch {}
fs.writeFileSync(counter, String(n + 1))
let b = seq[Math.min(n, seq.length - 1)]
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    if (b === 'ok') {
        process.stdout.write('OK-' + (n + 1))
        process.exit(0)
    }
    if (b === 'locked') {
        process.stderr.write('Error: Unexpected error database is locked')
        process.exit(1)
    }
    if (b === 'other') {
        process.stderr.write('Error: Unexpected error something else')
        process.exit(1)
    }
    if (b === 'locked-event') {
        process.stdout.write(JSON.stringify({ type: 'error', sessionID: 'ses_x', error: { name: 'UnknownError', data: { message: 'Unexpected error database is locked' } } }) + '\\n')
        process.exit(1)
    }
    if (b === 'locked-stdout') {
        process.stdout.write('the database is locked, said the model')
        process.exit(1)
    }
    if (b === 'locked-hang') {
        process.stderr.write('Error: Unexpected error database is locked')
        setTimeout(() => {}, 60000)
        return
    }
    if (b === 'locked-slow') {
        setTimeout(() => {
            process.stderr.write('Error: Unexpected error database is locked')
            process.exit(1)
        }, 400)
        return
    }
    process.exit(0)
})
`


describe('opencode暫時性錯誤(database is locked)重試一次(R-SPAWNGATE-5)', function() {

    this.timeout(60000)

    let fake = null
    let seqNo = 0
    before(function() {
        fake = createFakeCli('fake-transient', ENTRY)
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    //argsOf, 組假CLI之參數(每案獨立計數檔)並回傳計數讀取函數
    let argsOf = (seq) => {
        let counter = path.join(fake.fd, `counter-${++seqNo}.txt`)
        return { extraArgs: [`--counter=${counter}`, `--seq=${seq}`], counter }
    }
    let countOf = async (counter) => {
        return fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0
    }
    let FAST = { delayMs: 1 }

    describe('isTransientFailure: 辨識(內部常數, 不開放可配置之正規式)', function() {

        it('預設值: 重試延遲2000ms、「很快」門檻15000ms(主控已定; 延遲與門檻僅供測試注入)', function() {
            assert.strict.deepEqual(TRANSIENT_RETRY_DEFAULTS, { delayMs: 2000, fastMs: 15000 })
        })

        let fail = (over = {}) => ({ ok: false, code: 1, error: 'Exit code 1', stderr: 'Error: Unexpected error database is locked', stdout: '', durationMs: 900, ...over })

        it('stderr含database is locked(不分大小寫)且失敗很快(<15秒)且非逾時 → true', function() {
            assert.strict.deepEqual(isTransientFailure(fail()), true)
            assert.strict.deepEqual(isTransientFailure(fail({ stderr: 'ERROR: DATABASE IS LOCKED' })), true)
            assert.strict.deepEqual(isTransientFailure(fail({ durationMs: 14999 })), true)
        })

        it('失敗很慢(≥15秒)、逾時、成功、其他錯誤字樣 → false', function() {
            assert.strict.deepEqual(isTransientFailure(fail({ durationMs: 15000 })), false)
            assert.strict.deepEqual(isTransientFailure(fail({ error: 'TIMEOUT after 300s' })), false)
            assert.strict.deepEqual(isTransientFailure({ ok: true, stderr: 'database is locked', durationMs: 1 }), false)
            for (let s of ['Error: Unexpected error something else', 'table is locked', 'locked', 'database is busy', 'file is locked']) {
                assert.strict.deepEqual(isTransientFailure(fail({ stderr: s })), false)
            }
            assert.strict.deepEqual(isTransientFailure(null), false)
            assert.strict.deepEqual(isTransientFailure({ ok: false, stderr: 'database is locked' }), false) //無durationMs無從判斷「很快」
        })

        it('stdout已有tool_use事件(工具已執行, 重跑會重做副作用) → false; 只有text等事件 → 仍true', function() {
            assert.strict.deepEqual(isTransientFailure(fail({ stdout: '{"type":"tool_use","part":{"tool":"edit"}}\n' })), false)
            assert.strict.deepEqual(isTransientFailure(fail({ stdout: '{"type":"step_start"}\n{ "type" : "tool_use" }\n' })), false)
            assert.strict.deepEqual(isTransientFailure(fail({ stderr: '', stdout: '{"type":"tool_use"}\n{"type":"error","error":{"data":{"message":"database is locked"}}}\n' })), false)
            assert.strict.deepEqual(isTransientFailure(fail({ stdout: '{"type":"step_start"}\n{"type":"text","part":{"text":"hi"}}\n' })), true)
            assert.strict.deepEqual(isTransientFailure(fail({ stdout: '模型談到 tool_use 這個字' })), true)
        })

        it('stdout之純文字含該字樣不算(模型輸出可能談到資料庫); 只有type為error之事件行才算', function() {
            assert.strict.deepEqual(isTransientFailure(fail({ stderr: '', stdout: 'database is locked' })), false)
            let ev = JSON.stringify({ type: 'error', error: { data: { message: 'Unexpected error database is locked' } } })
            let txt = JSON.stringify({ type: 'text', part: { text: 'database is locked' } })
            assert.strict.deepEqual(isTransientFailure(fail({ stderr: '', stdout: `${txt}\n${ev}\n` })), true)
            assert.strict.deepEqual(isTransientFailure(fail({ stderr: '', stdout: `${txt}\n` })), false)

            //error事件不含該字樣、另一行(type為text)含該字樣 → 不算(須同一行既是error事件又含該字樣)
            let evOther = JSON.stringify({ type: 'error', error: { data: { message: 'Unexpected error something else' } } })
            assert.strict.deepEqual(isTransientFailure(fail({ stderr: '', stdout: `${evOther}\n${txt}\n` })), false)
        })

        it('fastMs可注入(測試用): 失敗耗時恰等於門檻不算很快', function() {
            assert.strict.deepEqual([isTransientFailure(fail({ durationMs: 99 }), 100), isTransientFailure(fail({ durationMs: 100 }), 100)], [true, false])
        })
    })

    describe('dispatchOpencode(假CLI)', function() {

        it('第一次exit 1＋該字樣、第二次成功 → ok:true、attempts:2, 子進程共啟動2次(issue §3-1)', async function() {
            let a = argsOf('locked,ok')
            let r = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST })
            assert.strict.deepEqual([r.ok, r.attempts, /^OK-2/.test(r.stdout), await countOf(a.counter)], [true, 2, true, 2])
        })

        it('成功結果之形狀與一般成功相同(不多欄位、不少欄位)', async function() {
            let a = argsOf('locked,ok')
            let b = argsOf('ok')
            let r1 = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST })
            let r2 = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: b.extraArgs, transientRetry: FAST })
            assert.strict.deepEqual(Object.keys(r1).sort(), Object.keys(r2).sort())
        })

        it('兩次皆失敗 → 回失敗、attempts:2、未再多試(至多一次); 失敗形狀與一般exec失敗相同, errorType仍為exec(遞補層看到之形狀不變)', async function() {
            let a = argsOf('locked')
            let b = argsOf('other')
            let r1 = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST })
            let r2 = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: b.extraArgs, transientRetry: FAST })
            assert.strict.deepEqual([r1.ok, r1.attempts, r1.errorType, r1.error, await countOf(a.counter)], [false, 2, 'exec', 'Exit code 1: Error: Unexpected error database is locked', 2]) //da110: error帶stderr尾段
            assert.strict.deepEqual(Object.keys(r1).sort(), Object.keys(r2).sort())
            assert.strict.deepEqual(/database is locked/.test(r1.stderr), true)
        })

        it('其他錯誤文字不重試(attempts 1、子進程只啟動1次)', async function() {
            let a = argsOf('other,ok')
            let r = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST })
            assert.strict.deepEqual([r.ok, r.attempts, await countOf(a.counter)], [false, 1, 1])
        })

        it('失敗很慢不重試: 同一失敗在fastMs=1時不重試(attempts 1), 預設fastMs則重試(對照)', async function() {
            let a = argsOf('locked,ok')
            let r = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: { delayMs: 1, fastMs: 1 } })
            assert.strict.deepEqual([r.ok, r.attempts, await countOf(a.counter)], [false, 1, 1])
        })

        it('逾時不重試(maxRetries 0 仍只一次): 假CLI寫出該字樣後掛住, 逾時 → errorType timeout、attempts 1', async function() {
            let a = argsOf('locked-hang,ok')
            let r = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST, timeoutMs: 800 })
            assert.strict.deepEqual([r.ok, r.errorType, r.attempts, await countOf(a.counter)], [false, 'timeout', 1, 1])
        })

        it('事件流形式: detectTruncation(還原為stderr)與自給--format json(stdout保留原事件)兩種, error事件含該字樣皆重試', async function() {
            let a = argsOf('locked-event,ok')
            let r1 = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST, detectTruncation: true })
            assert.strict.deepEqual([r1.ok, r1.attempts], [true, 2])
            let b = argsOf('locked-event,ok')
            let r2 = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: ['--format', 'json', ...b.extraArgs], transientRetry: FAST, detectTruncation: true })
            assert.strict.deepEqual([r2.ok, r2.attempts], [true, 2])
        })

        it('stdout之純文字含該字樣而離開碼1: 不重試(不把模型輸出誤認為鎖競爭)', async function() {
            let a = argsOf('locked-stdout,ok')
            let r = await dispatchOpencode('abc', { exe: fake.exe, spawnGate: false, extraArgs: a.extraArgs, transientRetry: FAST })
            assert.strict.deepEqual([r.ok, r.attempts, await countOf(a.counter)], [false, 1, 1])
        })
    })

    describe('與maxRetries／validate／守門／shouldStop／預算之關係(runExecCli)', function() {

        let run = (seq, opt = {}) => {
            let a = argsOf(seq)
            return runExecCli(fake.exe, a.extraArgs, { spawnGateKind: 'opencode', spawnGate: false, input: 'abc', transientRetry: FAST, ...opt }).then(async (r) => ({ r, n: await countOf(a.counter) }))
        }

        it('maxRetries:1 併用(無validate): execCli自理之重試先用完(locked,locked), 再多一次暫時性重試(ok) → attempts 3、子進程3次', async function() {
            let { r, n } = await run('locked,locked,ok', { maxRetries: 1, retryDelayMs: 1 })
            assert.strict.deepEqual([r.ok, r.attempts, n], [true, 3, 3])
        })

        it('maxRetries:1 併用: 全程locked → 失敗, attempts 3(execCli 2次＋暫時性1次, 不再多)', async function() {
            let { r, n } = await run('locked', { maxRetries: 1, retryDelayMs: 1 })
            assert.strict.deepEqual([r.ok, r.attempts, n], [false, 3, 3])
        })

        it('maxRetries:1、第一次locked而execCli自理之重試即成功: 不觸發暫時性重試, attempts 2', async function() {
            let { r, n } = await run('locked,ok', { maxRetries: 1, retryDelayMs: 1 })
            assert.strict.deepEqual([r.ok, r.attempts, n], [true, 2, 2])
        })

        it('有validate、maxRetries 1: 驗證不過而重試(第2次)遇locked → 暫時性重試(第3次)成功並驗證通過 → ok、attempts 3, 子進程3次', async function() {
            let v = 0
            let { r, n } = await run('ok,locked,ok', { maxRetries: 1, retryDelayMs: 1, validate: () => v++ > 0 })
            assert.strict.deepEqual([r.ok, r.attempts, n], [true, 3, 3])
        })

        it('有validate、maxRetries 0: 暫時性重試後仍失敗 → 回失敗, attempts 2, 不再多試', async function() {
            let { r, n } = await run('locked', { validate: () => true })
            assert.strict.deepEqual([r.ok, r.attempts, r.errorType, n], [false, 2, 'exec', 2])
        })

        it('有validate、暫時性重試成功但驗證不過且maxRetries 0: 回驗證失敗, attempts 2, 不因此多重試', async function() {
            let { r, n } = await run('locked,ok,ok', { validate: () => false })
            assert.strict.deepEqual([r.ok, r.errorType, r.attempts, n], [false, 'validation', 2, 2])
        })

        it('非opencode(claude／codex／antigravity／未給kind): 同一失敗不重試, attempts 1(預設行為不變)', async function() {
            for (let kind of ['claude', 'codex', 'antigravity', null]) {
                let { r, n } = await run('locked,ok', kind === null ? { spawnGateKind: undefined } : { spawnGateKind: kind })
                assert.strict.deepEqual([kind, r.ok, r.attempts, n], [kind, false, 1, 1])
            }
        })

        it('transientRetry.delayMs無效(超過計時器上限2147483647、Infinity、\'0x10\'、小數、0)者回退預設2000(經transient-retry事件之ms觀察), 有效值原值; 不把原值交計時器(wsemi delay對超過上限者改用10毫秒)', async function() {
            //規格: 帳本R-TIMEOUT-1(同timeoutMs之計時器範圍判定); 事件之ms為決定採用之重試延遲; 無效者每案實際等2秒(預設), 故只取3個代表值
            let got = []
            for (let v of [2147483648, Infinity, 7]) {
                let events = []
                await run('locked,ok', { transientRetry: { delayMs: v }, onTrace: (e) => events.push(e) })
                got.push([String(v), events.filter((e) => e.type === 'transient-retry').map((e) => e.ms)])
            }
            assert.strict.deepEqual(got, [['2147483648', [2000]], ['Infinity', [2000]], ['7', [7]]])
        })

        it('觀察回調(opt.onTrace): 決定重試時發出凍結之transient-retry事件{ n, ms, durationMs }, 位於第1次settle之後、第2次spawn之前; 無重試與非opencode不發; 回調拋錯不影響結果 — 無validate與有validate兩路', async function() {
            for (let opt of [{}, { validate: () => true }]) {
                let events = []
                let { r } = await run('locked,ok', { ...opt, transientRetry: { delayMs: 7 }, onTrace: (e) => events.push(e) })
                let types = events.map((e) => e.type)
                let tr = events.filter((e) => e.type === 'transient-retry')
                assert.strict.deepEqual([Object.keys(opt).length, r.ok, r.attempts, tr.length], [Object.keys(opt).length, true, 2, 1])
                assert.strict.deepEqual([Object.isFrozen(tr[0]), Object.keys(tr[0]).sort(), tr[0].n, tr[0].ms, typeof tr[0].durationMs], [true, ['durationMs', 'ms', 'n', 'type'], 1, 7, 'number'])
                let i = types.indexOf('transient-retry')
                assert.strict.deepEqual([types.indexOf('settle') < i, i < types.lastIndexOf('spawn')], [true, true])
            }

            //無重試(其他錯誤字樣)與非opencode: 不發
            let ev2 = []
            await run('other,ok', { transientRetry: FAST, onTrace: (e) => ev2.push(e.type) })
            await run('locked,ok', { spawnGateKind: 'claude', transientRetry: FAST, onTrace: (e) => ev2.push(e.type) })
            assert.strict.deepEqual(ev2.includes('transient-retry'), false)

            //回調拋錯、回傳rejected Promise: 不影響結果
            let { r: r3 } = await run('locked,ok', {
                transientRetry: FAST,
                onTrace: () => {
                    throw new Error('trace boom')
                }
            })
            let { r: r4 } = await run('locked,ok', {
                transientRetry: FAST,
                onTrace: async () => {
                    throw new Error('async trace boom')
                }
            })
            assert.strict.deepEqual([r3.ok, r3.attempts, r4.ok, r4.attempts], [true, 2, true, 2])
        })

        it('重試前再過守門: 守門放行2次、子進程啟動2次, 時間軸為 gate → spawn → gate → spawn', async function() {
            let timeline = []
            let t = 0
            let sg = {
                maxCli: 2,
                ramUsedMax: false,
                cpuMax: false,
                countCli: async () => 0,
                now: () => t,
                sleep: async (ms) => {
                    t += ms
                },
                state: createGateState(),
                ticketDir: false,
                minGapMs: false,
                onTrace: (e) => {
                    if (e.type === 'pass') {
                        timeline.push('gate')
                    }
                },
            }
            let a = argsOf('locked,ok')
            let r = await runExecCli(fake.exe, a.extraArgs, {
                spawnGateKind: 'opencode',
                spawnGate: sg,
                input: 'abc',
                transientRetry: FAST,
                onTrace: (e) => {
                    if (e.type === 'spawn') {
                        timeline.push('spawn')
                    }
                },
            })
            assert.strict.deepEqual([r.ok, r.attempts, timeline], [true, 2, ['gate', 'spawn', 'gate', 'spawn']])
        })

        it('重試前再過守門(有validate路徑)與間隔: 第二次守門受minGapMs約束(gap-wait事件)', async function() {
            let events = []
            let t = 0
            let sg = {
                maxCli: 2,
                ramUsedMax: false,
                cpuMax: false,
                countCli: async () => 0,
                now: () => t,
                sleep: async (ms) => {
                    t += ms
                },
                state: createGateState(),
                ticketDir: false,
                minGapMs: 1500,
                onTrace: (e) => events.push(e.type),
            }
            let a = argsOf('locked,ok')
            let r = await runExecCli(fake.exe, a.extraArgs, { spawnGateKind: 'opencode', spawnGate: sg, input: 'abc', transientRetry: FAST, validate: () => true })
            assert.strict.deepEqual([r.ok, r.attempts, events.filter((x) => x === 'gap-wait').length], [true, 2, 1])
        })

        it('shouldStop於失敗後成立 → 不重試, 回原失敗(非ABORTED)、attempts 1、子進程只啟動1次', async function() {
            let stop = false
            let { r, n } = await run('locked,ok', {
                spawnGateHints: { shouldStop: () => stop },
                onTrace: (e) => {
                    if (e.type === 'settle') {
                        stop = true
                    }
                },
            })
            assert.strict.deepEqual([r.ok, r.errorType, r.attempts, n], [false, 'exec', 1, 1])
        })

        it('重試前之守門被shouldStop中止(判定在延遲之後才轉真): 回ABORTED(errorType aborted)、attempts為已嘗試次數1、第二個子進程未啟動 — 無validate與有validate兩路', async function() {
            for (let opt of [{}, { validate: () => true }]) {
                let calls = 0
                let { r, n } = await run('locked,ok', {
                    ...opt,
                    //第1～3次判定(首次守門、canTransient、延遲後)皆為假; 第4次(重試前之守門)為真
                    spawnGate: { maxCli: 5, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false, countCli: async () => 0, state: createGateState(), shouldStop: () => calls++ >= 3 },
                })
                assert.strict.deepEqual([Object.keys(opt).length, r.ok, r.error, r.errorType, r.attempts, n], [Object.keys(opt).length, false, 'ABORTED', 'aborted', 1, 1])
            }
        })

        it('shouldStop於spawnGate物件內給時同樣生效; 拋錯視為不中止(照常重試)', async function() {
            let stop = false
            let a = argsOf('locked,ok')
            let r = await runExecCli(fake.exe, a.extraArgs, {
                spawnGateKind: 'opencode',
                spawnGate: { shouldStop: () => stop, maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false, state: createGateState() },
                input: 'abc',
                transientRetry: FAST,
                onTrace: (e) => {
                    if (e.type === 'settle') {
                        stop = true
                    }
                },
            })
            assert.strict.deepEqual([r.ok, r.attempts, await countOf(a.counter)], [false, 1, 1])
            let { r: r2 } = await run('locked,ok', {
                spawnGateHints: {
                    shouldStop: () => {
                        throw new Error('boom')
                    }
                }
            })
            assert.strict.deepEqual([r2.ok, r2.attempts], [true, 2])
        })

        it('遞補層預算不足不重試: 剩餘(deadlineAt − 現在 − 重試延遲)< minAttemptMs → 回原失敗; 預算足夠則重試(對照)', async function() {
            //剩餘約59.6秒; 扣延遲5秒後約54.6秒 < 57秒 → 不重試(若不扣延遲則約59.6秒 ≥ 57秒而重試, 二者各隔2秒以上之裕度)
            let { r: poor, n: n1 } = await run('locked,ok', { spawnGateHints: { deadlineAt: Date.now() + 60000, minAttemptMs: 57000 }, transientRetry: { delayMs: 5000 } })
            assert.strict.deepEqual([poor.ok, poor.attempts, n1], [false, 1, 1])
            let { r: rich, n: n2 } = await run('locked,ok', { spawnGateHints: { deadlineAt: Date.now() + 600000, minAttemptMs: 1000 } })
            assert.strict.deepEqual([rich.ok, rich.attempts, n2], [true, 2, 2])
        })

        it('重試輪之逾時以遞補層期限封頂(即使守門未運作): 期限約3秒、重試輪掛住 → 於期限附近逾時, 不拖到timeoutMs 40秒 — 無validate與有validate兩路', async function() {
            for (let opt of [{}, { validate: () => true }]) {
                let t0 = Date.now()
                let { r, n } = await run('locked,locked-hang', { ...opt, timeoutMs: 40000, spawnGateHints: { deadlineAt: Date.now() + 3000, minAttemptMs: 500 } })
                let wall = Date.now() - t0
                assert.strict.deepEqual([Object.keys(opt).length, r.ok, r.errorType, r.attempts, n, wall < 20000], [Object.keys(opt).length, false, 'timeout', 2, 2, true])
            }
        })

        it('預算判斷之minAttemptMs預設取守門之預設(20000): 剩餘約25秒 → 重試; 剩餘約19秒 → 不重試; spawnGate物件內之minAttemptMs優先於遞補層提示、deadlineAt兩者取較早者(排程第417項)', async function() {
            let { r: a } = await run('locked,ok', { spawnGateHints: { deadlineAt: Date.now() + 25000 } })
            assert.strict.deepEqual([a.ok, a.attempts], [true, 2])
            let { r: b, n: nb } = await run('locked,ok', { spawnGateHints: { deadlineAt: Date.now() + 19000 } })
            assert.strict.deepEqual([b.ok, b.attempts, nb], [false, 1, 1])
            //物件內給的deadlineAt(已近)優先於提示之寬裕期限 → 不重試
            let { r: c, n: nc } = await run('locked,ok', { spawnGate: { deadlineAt: Date.now() + 19000, minAttemptMs: 20000, maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false, state: createGateState() }, spawnGateHints: { deadlineAt: Date.now() + 600000, minAttemptMs: 1000 } })
            assert.strict.deepEqual([c.ok, c.attempts, nc], [false, 1, 1])
            //物件內給的deadlineAt(寬裕)晚於遞補層提示之期限(已近) → 取較早者(提示) → 不重試(修前物件優先, 取寬裕之值而重試)
            let { r: d, n: nd } = await run('locked,ok', { spawnGate: { deadlineAt: Date.now() + 600000, maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false, state: createGateState() }, spawnGateHints: { deadlineAt: Date.now() + 19000 } })
            assert.strict.deepEqual([d.ok, d.attempts, nd], [false, 1, 1])
        })

        //外審 terra #02(402 行為不得改變): 遞補層於 spawnGate:false 時只給 attemptHints(守門不運作、無 spawnGateHints), 暫時性重試之預算判斷只受 retryFits(attemptHints 自帶之 minAttemptMs)約束,
        //不採守門之預設 minAttemptMs(20000)——剩餘約 5 秒、minAttemptMs 100 → 仍重試(修前即重試; 把 attemptHints 併入封頂之期限來源則會誤擋)
        it('spawnGate:false 且遞補層期限只經 attemptHints: 暫時性重試照常(剩餘約5秒、minAttemptMs 100 → 重試, 不被守門之預設 20000 擋掉)', async function() {
            let base = Date.now()
            let { r, n } = await run('locked,ok', { attemptHints: { deadlineAt: base + 5000, minAttemptMs: 100, entryTimeoutMs: 15000 } })
            assert.strict.deepEqual([r.ok, r.attempts, n], [true, 2, 2])
        })

        //外審 terra #03: 暫時性重試輪之逾時另以期限封頂(即使守門未運作), 封頂之標記依取早後之來源——呼叫端期限較早者不標 cutByDeadline, 遞補層較早者標
        it('守門未運作之暫時性重試輪: 封頂標記依取早後之來源(呼叫端期限較早 → 不標 cutByDeadline; 遞補層期限較早 → 標) — 無validate與有validate兩路', async function() {
            let off = { maxCli: false, ramUsedMax: false, cpuMax: false, minGapMs: false, ticketDir: false }
            for (let opt of [{}, { validate: () => true }]) {
                let base = Date.now()
                let early = await run('locked,locked-hang', {
                    ...opt,
                    timeoutMs: 15000,
                    spawnGate: { ...off, state: createGateState(), deadlineAt: base + 1000 },
                    spawnGateHints: { deadlineAt: base + 60000, minAttemptMs: 100 },
                    attemptHints: { deadlineAt: base + 60000, minAttemptMs: 100, entryTimeoutMs: 15000 },
                })
                let base2 = Date.now()
                let late = await run('locked,locked-hang', {
                    ...opt,
                    timeoutMs: 15000,
                    spawnGate: { ...off, state: createGateState(), deadlineAt: base2 + 60000 },
                    spawnGateHints: { deadlineAt: base2 + 1000, minAttemptMs: 100 },
                    attemptHints: { deadlineAt: base2 + 1000, minAttemptMs: 100, entryTimeoutMs: 15000 },
                })
                assert.strict.deepEqual(
                    [Object.keys(opt).length, early.r.errorType, 'cutByDeadline' in early.r, late.r.errorType, late.r.cutByDeadline],
                    [Object.keys(opt).length, 'timeout', false, 'timeout', true],
                )
            }
        })

        it('重試前之等待中shouldStop轉真 → 不重試(回原失敗): 無validate與有validate兩路; 缺陷版(不等延遲或不於延遲後再判)會重試', async function() {
            for (let opt of [{}, { validate: () => true }]) {
                let t0 = 0
                let { r, n } = await run('locked,ok', {
                    ...opt,
                    transientRetry: { delayMs: 400 },
                    spawnGateHints: { shouldStop: () => t0 > 0 && Date.now() - t0 >= 150 }, //失敗後150ms起為真; 延遲400ms, 故延遲之後才為真
                    onTrace: (e) => {
                        if (e.type === 'settle') {
                            t0 = Date.now()
                        }
                    },
                })
                assert.strict.deepEqual([Object.keys(opt).length, r.ok, r.errorType, r.attempts, n], [Object.keys(opt).length, false, 'exec', 1, 1])
            }
        })

        it('transientRetry之輸入檢測(K3): 非物件(字串、負數、null、陣列)視為未給; 物件內非法鍵改用該鍵預設, 不拋錯、不影響他鍵', async function() {
            for (let v of ['x', -1, null, []]) {
                let a = argsOf('other')
                let r = await runExecCli(fake.exe, a.extraArgs, { spawnGateKind: 'opencode', spawnGate: false, input: 'abc', transientRetry: v })
                assert.strict.deepEqual([r.ok, r.attempts], [false, 1]) //錯誤字樣不符, 不重試; 此處只驗證輸入檢測不拋錯
            }
            //fastMs非法 → 取預設15000(失敗很快, 仍重試), delayMs合法
            let a1 = await run('locked,ok', { transientRetry: { delayMs: 1, fastMs: 'x' } })
            assert.strict.deepEqual([a1.r.ok, a1.r.attempts], [true, 2])
            //delayMs非法 → 取預設; fastMs 1合法 → 失敗不算很快而不重試(不等預設延遲)
            let a2 = await run('locked,ok', { transientRetry: { delayMs: -5, fastMs: 1 } })
            assert.strict.deepEqual([a2.r.ok, a2.r.attempts, a2.n], [false, 1, 1])
        })
    })
})
