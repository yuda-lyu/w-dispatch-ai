import fs from 'fs'
import path from 'path'
import assert from 'assert'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import CODE_ENTRY_LIMIT from './tools/fakeOpencodeLimitForTest.mjs'


// unit-dispatchOpencodeLimit.test.mjs — 免費池用盡／免費層429時樹狀終止並回可判讀之errorType(wda156, Gitea #156; 帳本R-OCLIMIT-1)
//
// spec(派工〈本輪範圍〉2、建議檔§2-1/2-2、契約§3): 主要請求之錯誤列(agent=title之附帶請求不算; 可跨兩個區塊送達) ⇒ 樹狀終止子行程, 數秒內回失敗;
//   免費池用盡 ⇒ errorType 'quota'、failureKind 'no-credit'; 429 ⇒ 既有限流分類(failureKind 'rate-limit'); 兩者該次不重試;
//   ERROR列之取得: 呼叫端未帶之旗標自動加、已帶者不重複; 訂閱(opencode-go)之列不臆測。
// 假CLI(test/tools/fakeOpencodeLimitForTest.mjs)只在帶--print-logs時印錯誤列(同真實opencode), 印後不結束, 並帶一個繼承stdio之孫行程。
// 修前(不補旗標、不監看)各「終止」案皆為TIMEOUT(errorType 'timeout'), 故逾時給LIMIT_TMO(遠大於終止所需), 以errorType與子孫行程是否仍在判定, 不以毫秒數斷言。


let LIMIT_TMO = 20000


//行程是否仍在(process.kill(pid, 0): 不存在拋ESRCH; EPERM代表存在但無權限)
function alive(pid) {
    try {
        process.kill(pid, 0)
        return true
    }
    catch (e) {
        return e.code === 'EPERM'
    }
}


//等候行程消失(可觀察條件, 上限ms; 作業系統回收行程物件可能稍晚於taskkill返回)
async function waitGone(pid, ms = 5000) {
    let t0 = Date.now()
    while (alive(pid)) {
        if (Date.now() - t0 > ms) {
            return false
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 50)
        })
    }
    return true
}


//由stdout取孫行程pid(假CLI第一行FAKE_GC=<pid>)
function gcPidOf(r) {
    let m = /FAKE_GC=(\d+)/.exec(String(r.stdout || ''))
    return m ? Number(m[1]) : null
}


describe('dispatchOpencode 免費池用盡／免費層429即終止', function() {

    let fake = null
    let echo = null
    let gateDir = ''
    let gateN = 0
    let newGate = () => path.join(gateDir, `gate-${++gateN}`)

    before(function() {
        fake = createFakeCli('fake-oclimit-a', CODE_ENTRY_LIMIT)
        echo = createFakeCli('fake-oclimit-echo')
        gateDir = path.join(fake.fd, 'gates')
        fs.mkdirSync(gateDir, { recursive: true })
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
        if (echo) {
            echo.clean()
        }
    })

    it('免費池用盡(主要請求agent=build之錯誤列): 樹狀終止子行程與孫行程, 回ok:false、errorType \'quota\'、failureKind \'no-credit\'(非逾時), 帶failureDetail與errorDetail.upstream', async function() {
        //spec: 建議檔§2-1「讀到主要請求之免費池用盡錯誤列即樹狀終止子行程, 數秒內回失敗: errorType 'quota'、failureKind 'no-credit'」; 契約§3 r.ok===false && r.errorType==='quota'
        let events = []
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota'], timeoutMs: LIMIT_TMO, onTrace: (ev) => events.push(ev) })
        let gc = gcPidOf(r)
        let stops = events.filter((e) => e.type === 'limit-stop')
        let rr = {
            ok: r.ok,
            errorType: r.errorType,
            failureKind: r.failureKind,
            notTimeout: String(r.error).indexOf('TIMEOUT') !== 0,
            detail: /Free usage limit reached/.test(r.failureDetail),
            upstream: /Free usage limit reached/.test(r.errorDetail.upstream),
            errorClass: String(r.error).includes('[Free usage limit]'),
            attempts: r.attempts,
            stops: stops.map((e) => [e.kind, typeof e.pid]),
            rootGone: await waitGone(r.pid),
            gcGone: gc !== null && await waitGone(gc),
        }
        assert.strict.deepEqual(rr, {
            ok: false,
            errorType: 'quota',
            failureKind: 'no-credit',
            notTimeout: true,
            detail: true,
            upstream: true,
            errorClass: true,
            attempts: 1,
            stops: [['quota', 'number']],
            rootGone: true,
            gcGone: true,
        })
    })

    it('免費層429(主要請求之Rate limit exceeded列): 樹狀終止, 回ok:false、errorType依既有判定(\'exec\', 非\'timeout\')、failureKind \'rate-limit\'', async function() {
        //spec: 派工〈本輪範圍〉2「429限流 ⇒ 依本套件既有之限流分類」(failureKind一覽之'rate-limit'; errorType之值域不變)
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=rate'], timeoutMs: LIMIT_TMO })
        let gc = gcPidOf(r)
        let rr = [r.ok, r.errorType, r.failureKind, /Rate limit exceeded/.test(r.failureDetail), String(r.error).includes('[rate limit]'), await waitGone(r.pid), gc !== null && await waitGone(gc)]
        assert.strict.deepEqual(rr, [false, 'exec', 'rate-limit', true, true, true, true])
    })

    it('錯誤列跨兩個stderr區塊送達(前段止於字樣中間, 閘門後才送後段): 仍判中並終止, 回errorType \'quota\'', async function() {
        //spec: 派工〈本輪範圍〉2「錯誤列可能跨兩個區塊送達」
        let gate = newGate()
        let chunks = []
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode/beam-free',
            extraArgs: ['--fake-limit=split', `--fake-gate=${gate}`],
            timeoutMs: LIMIT_TMO,
            onStderr: (s) => {
                chunks.push(s)
                if (chunks.join('').includes('Free usage li') && !fs.existsSync(gate)) { //以累積輸出判斷(區塊可能切在字樣內; 外審terra #19)
                    fs.writeFileSync(gate, '') //收到前段後才放行後段: 確定錯誤列被切在兩個區塊
                }
            },
        })
        let gc = gcPidOf(r)
        let rr = [
            r.errorType,
            r.failureKind,
            chunks.some((s) => s.includes('Free usage limit reached')), //沒有任何單一區塊含完整字樣(確為跨區塊)
            await waitGone(r.pid),
            gc !== null && await waitGone(gc),
        ]
        assert.strict.deepEqual(rr, ['quota', 'no-credit', false, true, true])
    })

    it('agent=title之附帶請求列(同字樣): 不終止、不改分類——子行程照常以0結束, ok:true且無limit-stop事件', async function() {
        //spec: 建議檔§2-1「agent=title之列不算」、§1「其失敗不代表主要請求失敗」
        let gate = newGate()
        let events = []
        let acc = ''
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode/beam-free',
            extraArgs: ['--fake-limit=title', `--fake-gate=${gate}`],
            timeoutMs: LIMIT_TMO,
            onTrace: (ev) => events.push(ev),
            onStderr: (s) => {
                acc += s
                if (acc.includes('agent=title') && !fs.existsSync(gate)) {
                    fs.writeFileSync(gate, '') //title列已交本轉接器判讀後才令假CLI結束
                }
            },
        })
        let rr = [r.ok, r.errorType, r.failureKind, r.stdout.includes('完成'), events.filter((e) => e.type === 'limit-stop').length]
        assert.strict.deepEqual(rr, [true, undefined, undefined, true, 0])
    })

    it('訂閱opencode-go之錯誤列(429與免費池用盡字樣): 不臆測——不終止, 照子行程自身之結束回報(errorType \'exec\'、無failureKind)', async function() {
        //spec: 派工〈本輪範圍〉4「訂閱(opencode-go)條目不臆測行為」、建議檔§2-4
        let gate = newGate()
        let events = []
        let acc = ''
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode-go/glm-5.3-flash',
            extraArgs: ['--fake-limit=go', `--fake-gate=${gate}`],
            timeoutMs: LIMIT_TMO,
            onTrace: (ev) => events.push(ev),
            onStderr: (s) => {
                acc += s
                if (acc.includes('providerID=opencode-go') && acc.includes('Free usage limit reached') && !fs.existsSync(gate)) {
                    fs.writeFileSync(gate, '')
                }
            },
        })
        let rr = [r.ok, r.code, r.errorType, r.failureKind, events.filter((e) => e.type === 'limit-stop').length]
        assert.strict.deepEqual(rr, [false, 1, 'exec', undefined, 0])
    })

    it('其餘上游錯誤(主要請求之[overloaded]列後子行程自行以1結束): 不終止、errorType \'exec\'、無failureKind; errorDetail.upstream改由stderr之ERROR列取(日誌印到stderr時日誌檔不寫入)', async function() {
        //spec: 既有errorType／failureKind之值與判定不變(派工〈不得改變〉); da110之errorDetail.upstream不因--print-logs而遺失
        let events = []
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=other'], timeoutMs: LIMIT_TMO, opencodeLog: path.join(gateDir, 'no-such.log'), onTrace: (ev) => events.push(ev) })
        let rr = [r.ok, r.errorType, r.failureKind, r.errorDetail.upstream, String(r.error).startsWith('Exit code 1 [overloaded]: '), events.filter((e) => e.type === 'limit-stop').length]
        assert.strict.deepEqual(rr, [false, 'exec', undefined, 'AI_APICallError: Upstream request failed: [overloaded]', true, 0])
    })

    it('不重試: maxRetries 2(無validate與有validate兩路)下判中者只spawn一次、attempts 1', async function() {
        //spec: 建議檔§2-1「該次不重試(maxRetries不再跑一次)」; 派工〈本輪範圍〉2「兩者該次皆不重試」
        let got = []
        for (let validate of [undefined, 'nonempty']) {
            for (let sc of ['quota', 'rate']) {
                let spawns = 0
                let r = await dispatchOpencode('abc', {
                    exe: fake.exe,
                    model: 'opencode/beam-free',
                    extraArgs: [`--fake-limit=${sc}`],
                    timeoutMs: LIMIT_TMO,
                    maxRetries: 2,
                    retryDelayMs: 100,
                    validate,
                    onTrace: (ev) => {
                        if (ev.type === 'spawn') {
                            spawns++
                        }
                    },
                })
                got.push([String(validate), sc, r.ok, r.failureKind, r.attempts, spawns])
            }
        }
        assert.strict.deepEqual(got, [
            ['undefined', 'quota', false, 'no-credit', 1, 1],
            ['undefined', 'rate', false, 'rate-limit', 1, 1],
            ['nonempty', 'quota', false, 'no-credit', 1, 1],
            ['nonempty', 'rate', false, 'rate-limit', 1, 1],
        ])
    })

    it('不做暫時性重試: 判中之失敗即使stderr另含database is locked且很快, 亦不多跑一次(無transient-retry事件、只spawn一次)', async function() {
        //spec: 「兩者該次皆不重試」(暫時性重試為runExecCli之另一種重試, 見其檔頭【暫時性錯誤重試】)
        let events = []
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota-locked'], timeoutMs: LIMIT_TMO, onTrace: (ev) => events.push(ev.type) })
        let rr = [r.errorType, r.attempts, events.filter((t) => t === 'spawn').length, events.includes('transient-retry')]
        assert.strict.deepEqual(rr, ['quota', 1, 1, false])
    })

    it('一般失敗之重試不受影響: maxRetries 1時非判中之失敗仍重試, 次數與觀察事件序列同stopOnLimit:false(execCli內部重試)', async function() {
        //spec: runExecCli檔頭【命中即不重試】「接管迴圈之觀察事件序列與execCli自身之重試迴圈相同」; 既有maxRetries語意不變
        let seq = async (stopOnLimit, validate) => {
            let ev = []
            let r = await dispatchOpencode('abc', {
                exe: fake.exe,
                model: 'opencode/beam-free',
                extraArgs: ['--fake-limit=other'],
                timeoutMs: LIMIT_TMO,
                maxRetries: 1,
                retryDelayMs: 50,
                stopOnLimit,
                validate,
                opencodeLog: false,
                onTrace: (e) => {
                    if (['attempt', 'retry', 'spawn', 'done'].includes(e.type)) {
                        ev.push(e.type === 'spawn' ? 'spawn' : `${e.type}:${e.n}`)
                    }
                },
            })
            return [r.ok, r.errorType, r.attempts, ev]
        }
        let a = await seq(true, undefined)
        let b = await seq(false, undefined)
        let c = await seq(true, 'nonempty')
        let d = await seq(false, 'nonempty')
        assert.strict.deepEqual(a, [false, 'exec', 2, ['attempt:1', 'spawn', 'retry:2', 'attempt:2', 'spawn', 'done:2']])
        assert.strict.deepEqual(b, a)
        assert.strict.deepEqual(d, a) //有validate之修前路徑(execCli內部重試)
        assert.strict.deepEqual(c, d) //有validate時之接管亦與修前逐項相同(外審agy-hydrogen #1／#6)
    })

    it('暫時性錯誤(database is locked)之重試順序同修前: maxRetries 1時先用完maxRetries再做暫時性重試——無validate與有validate兩路, 事件序列與stopOnLimit:false相同', async function() {
        //spec: runExecCli檔頭【命中即不重試】「無期限時逐項比照修前之execCli內部重試(先用完maxRetries才考慮暫時性重試)」(外審agy-hydrogen #5)
        let seq = async (stopOnLimit, validate) => {
            let ev = []
            let r = await dispatchOpencode('abc', {
                exe: fake.exe,
                model: 'opencode/beam-free',
                extraArgs: ['--fake-limit=locked'],
                timeoutMs: LIMIT_TMO,
                maxRetries: 1,
                retryDelayMs: 50,
                transientRetry: { delayMs: 50 },
                stopOnLimit,
                validate,
                opencodeLog: false,
                onTrace: (e) => {
                    if (['attempt', 'retry', 'spawn', 'done', 'transient-retry'].includes(e.type)) {
                        ev.push(e.type === 'spawn' ? 'spawn' : `${e.type}:${e.n}`)
                    }
                },
            })
            return [r.ok, r.errorType, r.attempts, ev]
        }
        let exp = [false, 'exec', 3, ['attempt:1', 'spawn', 'retry:2', 'attempt:2', 'spawn', 'done:2', 'transient-retry:2', 'attempt:1', 'spawn', 'done:1']]
        let rr = [await seq(false, undefined), await seq(true, undefined), await seq(false, 'nonempty'), await seq(true, 'nonempty')]
        assert.strict.deepEqual(rr, [exp, exp, exp, exp])
    })

    it('第1次嘗試為一般失敗、第2次(重試)才出現錯誤列: 每次嘗試重置監看, 第2次判中即終止並回\'quota\', 不再重試', async function() {
        //spec: 「兩者該次皆不重試」與每次嘗試(spawn)重置監看(src/opencodeLimit.mjs檔頭【逐行】)
        let cf = path.join(gateDir, `count-${++gateN}`)
        let spawns = 0
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode/beam-free',
            extraArgs: ['--fake-limit=other-then-quota', `--fake-count=${cf}`],
            timeoutMs: LIMIT_TMO,
            maxRetries: 3,
            retryDelayMs: 50,
            onTrace: (e) => {
                if (e.type === 'spawn') {
                    spawns++
                }
            },
        })
        assert.strict.deepEqual([r.ok, r.errorType, r.attempts, spawns], [false, 'quota', 2, 2])
    })

    it('旗標: 呼叫端未帶者自動補--print-logs與--log-level ERROR(置於固定旗標之後、extraArgs之前); 已帶者(各種寫法)不重複不覆寫; stopOnLimit:false不補', async function() {
        //spec: 派工〈本輪範圍〉2「呼叫端不必知道旗標、呼叫端自帶之旗標不重複」
        let argsOf = async (o) => JSON.parse((await dispatchOpencode('abc', { exe: echo.exe, ...o })).stdout).args
        let rr = [
            await argsOf({}),
            await argsOf({ model: 'opencode/beam-free', extraArgs: ['--variant', 'high'] }),
            await argsOf({ extraArgs: ['--print-logs', '--log-level', 'DEBUG'] }),
            await argsOf({ extraArgs: ['--print-logs'] }),
            await argsOf({ extraArgs: ['--log-level=WARN'] }),
            await argsOf({ extraArgs: ['--print-logs=false'] }),
            await argsOf({ extraArgs: ['--variant', 'high'], stopOnLimit: false }),
        ]
        assert.strict.deepEqual(rr, [
            ['run', '--agent', 'build', '--print-logs', '--log-level', 'ERROR'],
            ['run', '--agent', 'build', '-m', 'opencode/beam-free', '--print-logs', '--log-level', 'ERROR', '--variant', 'high'],
            ['run', '--agent', 'build', '--print-logs', '--log-level', 'DEBUG'],
            ['run', '--agent', 'build', '--print-logs'],
            ['run', '--agent', 'build', '--print-logs', '--log-level=WARN'],
            ['run', '--agent', 'build', '--print-logs=false'],
            ['run', '--agent', 'build', '--variant', 'high'],
        ])
    })

    it('stopOnLimit:false: 不補旗標、不監看, 與修前相同(錯誤列不印出, 等到逾時: errorType \'timeout\')', async function() {
        //spec: 選項之退回路徑(修前行為); 逾時給短值以免空等
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota'], timeoutMs: 3000, stopOnLimit: false, opencodeLog: false })
        assert.strict.deepEqual([r.ok, r.errorType, r.failureKind], [false, 'timeout', undefined])
    })

    it('子行程印出錯誤列後自行以非0結束(未待終止): 仍回errorType \'quota\'(分類依錯誤列, 不依由誰結束)', async function() {
        //spec: 建議檔§2-1之分類(免費池用盡 ⇒ errorType 'quota'); 日後opencode改為自行結束時契約不變
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota-exit'], timeoutMs: LIMIT_TMO })
        assert.strict.deepEqual([r.ok, r.errorType, r.failureKind, r.attempts], [false, 'quota', 'no-credit', 1])
    })

    it('子行程印出錯誤列後立即自行以0結束而無回覆(validate不過)、maxRetries 2: 不做驗證重試(只spawn一次), 失敗分類為\'quota\'', async function() {
        //spec: 「兩者該次皆不重試」(含驗證重試; runExecCli檔頭【命中即不重試】); 判中即為最終結果、不等驗證(外審terra #1); 分類依錯誤列
        let spawns = 0
        let vCalls = 0
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode/beam-free',
            extraArgs: ['--fake-limit=quota-exit0'],
            timeoutMs: LIMIT_TMO,
            maxRetries: 2,
            retryDelayMs: 100,
            validate: (s) => {
                vCalls++
                return s.includes('完成')
            },
            onTrace: (e) => {
                if (e.type === 'spawn') {
                    spawns++
                }
            },
        })
        assert.strict.deepEqual([r.ok, r.errorType, r.failureKind, r.attempts, spawns, vCalls], [false, 'quota', 'no-credit', 1, 1, 0])
    })

    it('子行程印出錯誤列後立即自行以0結束且有輸出、無validate: 仍回失敗(ok:false、\'quota\'), 形狀同失敗結果(errorDetail、無finish／outputChars)', async function() {
        //spec: 建議檔§2-1「讀到主要請求之錯誤列即…回失敗」——主要請求已失敗, 不因離開碼0而當成功(外審terra #1)
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota-exit0-out'], timeoutMs: LIMIT_TMO })
        let rr = [r.ok, r.code, r.errorType, r.failureKind, String(r.error).startsWith('Exit code 0 [Free usage limit]'), 'finish' in r, 'outputChars' in r, /Free usage limit reached/.test(r.errorDetail.upstream)]
        assert.strict.deepEqual(rr, [false, 0, 'quota', 'no-credit', true, false, false, true])
    })

    it('同一區塊於免費池用盡列之後緊接另一主要請求ERROR列: errorDetail.upstream與error分類取觸發終止之該列(與failureKind一致)', async function() {
        //spec: dispatchOpencode檔頭【免費池用盡與免費層429】③「上游原因即觸發終止之該列」(外審terra #14)
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota-then-other'], timeoutMs: LIMIT_TMO })
        let rr = [r.errorType, /Free usage limit reached/.test(r.errorDetail.upstream), String(r.error).includes('[Free usage limit]')]
        assert.strict.deepEqual(rr, ['quota', true, true])
    })

    it('暫時性重試輪之失敗不再接管重試(同修前): 第1次離開碼2含database is locked(不可一般重試)→暫時性重試→以1失敗, maxRetries 1——spawn次數與事件序列同stopOnLimit:false(有validate)', async function() {
        //spec: runExecCli檔頭【命中即不重試】「暫時性重試輪之失敗不再接管重試(修前其為單獨一次execCli呼叫)」(外審terra #12)
        let seq = async (stopOnLimit) => {
            let cf = path.join(gateDir, `count-${++gateN}`)
            let ev = []
            let r = await dispatchOpencode('abc', {
                exe: fake.exe,
                model: 'opencode/beam-free',
                extraArgs: ['--fake-limit=locked2-then-boom', `--fake-count=${cf}`],
                timeoutMs: LIMIT_TMO,
                maxRetries: 1,
                retryDelayMs: 50,
                transientRetry: { delayMs: 50 },
                validate: 'nonempty',
                stopOnLimit,
                opencodeLog: false,
                onTrace: (e) => {
                    if (['attempt', 'retry', 'spawn', 'done', 'transient-retry'].includes(e.type)) {
                        ev.push(e.type === 'spawn' ? 'spawn' : `${e.type}:${e.n}`)
                    }
                },
            })
            return [r.ok, r.errorType, r.attempts, ev]
        }
        let a = await seq(false)
        let b = await seq(true)
        assert.strict.deepEqual(a, [false, 'exec', 2, ['attempt:1', 'spawn', 'done:1', 'transient-retry:1', 'attempt:1', 'spawn', 'done:1']])
        assert.strict.deepEqual(b, a)
    })

    it('maxRetries為execCli不接受之值(Infinity、\'0x10\'): 同修前不重試(只spawn一次)——無validate與有validate兩路', async function() {
        //spec: runExecCli檔頭【命中即不重試】「無期限而maxRetries非execCli所接受之次數者不接管(照舊交execCli, 其改用0)」(外審terra #11)
        let got = []
        for (let mr of [Infinity, '0x10']) {
            for (let validate of [undefined, 'nonempty']) {
                let spawns = 0
                let r = await dispatchOpencode('abc', {
                    exe: fake.exe,
                    model: 'opencode/beam-free',
                    extraArgs: ['--fake-limit=other'],
                    timeoutMs: LIMIT_TMO,
                    maxRetries: mr,
                    retryDelayMs: 50,
                    validate,
                    opencodeLog: false,
                    onTrace: (e) => {
                        if (e.type === 'spawn') {
                            spawns++
                        }
                    },
                })
                got.push([String(mr), String(validate), r.ok, spawns])
            }
        }
        assert.strict.deepEqual(got, [['Infinity', 'undefined', false, 1], ['Infinity', 'nonempty', false, 1], ['0x10', 'undefined', false, 1], ['0x10', 'nonempty', false, 1]])
    })

    it('stderr之日誌列(附帶請求)含database is locked而主要失敗為一般錯誤: 不做暫時性重試(同修前: 日誌原在日誌檔)', async function() {
        //spec: runExecCli檔頭「stopRetryIf在場時暫時性錯誤之判定不看stderr之日誌列」(外審terra #13)
        let ev = []
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=loglocked'], timeoutMs: LIMIT_TMO, onTrace: (e) => ev.push(e.type) })
        assert.strict.deepEqual([r.ok, r.errorType, r.attempts, ev.filter((t) => t === 'spawn').length, ev.includes('transient-retry')], [false, 'exec', 1, 1, false])
    })

    it('detectTruncation:true(--format json)時亦判中並終止(日誌列仍在stderr)', async function() {
        //spec: 判中與輸出格式無關(錯誤列由--print-logs印到stderr; dispatchOpencode檔頭【免費池用盡與免費層429】②)
        let r = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota'], timeoutMs: LIMIT_TMO, detectTruncation: true })
        let gc = gcPidOf(r)
        assert.strict.deepEqual([r.ok, r.errorType, await waitGone(r.pid), gc === null || await waitGone(gc)], [false, 'quota', true, true])
    })

    it('並行: 兩個呼叫同時進行, 一個判中而終止、另一個照常成功——監看與終止只及於各自之子行程', async function() {
        //spec: 不採日誌檔之理由(多行程共用, 並行無從歸屬); stderr與pid為本次呼叫專屬
        //b先起, 待其印出title列(確已存活並停在閘門前)才起a; a判中、終止、回傳之後才開b之閘門——b須仍存活並照常成功(外審agy-hydrogen #12: 以事件確定兩者存活期重疊)
        let gate = newGate()
        let bReady = null
        let bSeen = new Promise((resolve) => {
            bReady = resolve
        })
        let acc = ''
        let pb = dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode/beam-free',
            extraArgs: ['--fake-limit=title', `--fake-gate=${gate}`],
            timeoutMs: LIMIT_TMO,
            onStderr: (s) => {
                acc += s
                if (acc.includes('agent=title')) {
                    bReady('ready')
                }
            },
        })
        let first = await Promise.race([bSeen, pb.then(() => 'b-ended')]) //b已結束(如未印出title列者)亦放行, 不無限等待; 其值供斷言(外審terra #19)
        let a = await dispatchOpencode('abc', { exe: fake.exe, model: 'opencode/beam-free', extraArgs: ['--fake-limit=quota'], timeoutMs: LIMIT_TMO })
        fs.writeFileSync(gate, '')
        let b = await pb
        assert.strict.deepEqual([first, a.errorType, b.ok, b.errorType, b.stdout.includes('完成')], ['ready', 'quota', true, undefined, true])
    })

    it('呼叫端自給之onStderr與onTrace照常收到(含錯誤列與spawn事件), 回調拋錯不影響判中與終止', async function() {
        //spec: 既有回調契約不變(execCli之onStderr／onTrace; 呼叫端回調拋錯由execCli承接)
        let seen = []
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            model: 'opencode/beam-free',
            extraArgs: ['--fake-limit=quota'],
            timeoutMs: LIMIT_TMO,
            onStderr: (s) => {
                seen.push(s)
            },
            onTrace: (ev) => {
                if (ev.type === 'spawn') {
                    seen.push('SPAWN')
                }
                throw new Error('trace boom')
            },
        })
        let rr = [r.errorType, seen.includes('SPAWN'), seen.join('').includes('agent=build')]
        assert.strict.deepEqual(rr, ['quota', true, true])
    })

})
