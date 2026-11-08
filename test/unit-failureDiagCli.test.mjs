import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import runExecCli from '../src/runExecCli.mjs'
import createFakeCli, { createUnstartableExe } from './tools/fakeCliForTest.mjs'
import createFakeOpencodeEvents from './tools/fakeOpencodeEventsForTest.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'


// unit-failureDiagCli.test.mjs — CLI轉接器失敗時帶回原因、opencode日誌對時擷取、成功結果帶finish與outputChars (da110, Gitea #110)
//
// 規格來源: 主控派工 da110〈主控已定〉與〈必要之測試〉:
//   1 非零離開碼 → error含`Exit code N:`與stderr尾段, errorDetail{ exitCode, stderrTail, stdoutTail? }完整, 假金鑰被遮;
//   2 逾時附stderr尾段; 3 opencode日誌(±60秒內相符、不相符、超出時窗): 只取相符者, 日誌不存在或不可讀時欄位缺而不拋;
//   4 成功呼叫帶finish／outputChars, 既有incomplete案不變; 5 既有失敗分類與配額案不變。
// 假CLI以spec檔(JSON)決定stdout／stderr／離開碼／是否掛住; 金鑰皆為假值。不呼叫真實AI。


let FD_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'failureDiagCli')

//假CLI: --spec=<檔> { stdout, stderr, code, hang }; 先寫stderr再寫stdout, 寫完才結束(避免管線輸出被exit截斷)
let ENTRY = `
import fs from 'node:fs'
let args = process.argv.slice(2)
let a = args.find((x) => x.startsWith('--spec='))
let spec = a ? JSON.parse(fs.readFileSync(a.slice(7), 'utf8')) : {}
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stderr.write(spec.stderr || '', () => {
        process.stdout.write(spec.stdout || '', () => {
            if (spec.hang) {
                setTimeout(() => {}, 60000)
                return
            }
            process.exit(spec.code === undefined ? 0 : spec.code)
        })
    })
})
process.stdin.resume()
`

let FAKE_KEY = 'sk-test-FAKEKEY1234567890abcdef'
let FAKE_BEARER = 'FAKEBEARER9876543210'


describe('CLI失敗診斷: 非零離開碼帶回stderr尾段、errorDetail、遮罩; 逾時附尾段', function() {

    this.timeout(60000)

    let fake = null
    let bad = null
    let seq = 0
    before(function() {
        fake = createFakeCli('fake-diag-cli', ENTRY)
        bad = createUnstartableExe('bad-diag-cli')
        fs.mkdirSync(FD_TMP, { recursive: true })
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
        if (bad) {
            bad.clean()
        }
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    //spec, 寫入情境檔並回傳extraArgs
    let spec = (o) => {
        let f = path.join(FD_TMP, `spec-${++seq}.json`)
        fs.writeFileSync(f, JSON.stringify(o), 'utf8')
        return [`--spec=${f}`]
    }
    let STDERR = `Error: request failed\nAuthorization: Bearer ${FAKE_BEARER}\nkey=${FAKE_KEY}\nfinal line oops`

    //四家轉接器各以假CLI呼叫(opencode給key／provider令注入之金鑰亦在遮罩名單; claude給key同理)
    let callers = {
        codex: (o) => dispatchCodex('hi', { exe: fake.exe, ...o }),
        claude: (o) => dispatchClaude('hi', { exe: fake.exe, ...o }),
        opencode: (o) => dispatchOpencode('hi', { exe: fake.exe, model: 'opencode-go/m1', ...o }),
        antigravity: (o) => dispatchAntigravity('hi', { exe: fake.exe, ...o }),
    }

    for (let kind of Object.keys(callers)) {
        describe(`${kind}`, function() {

            it('非零離開碼+含假金鑰之stderr: error含`Exit code 1:`與尾段, errorDetail完整, 假金鑰與Bearer被遮 (必要測試1)', async function() {
                let r = await callers[kind]({ extraArgs: spec({ code: 1, stderr: STDERR }) })
                assert.strict.deepEqual([r.ok, r.errorType, r.code], [false, 'exec', 1])
                assert.strict.deepEqual(r.error.startsWith('Exit code 1: '), true, r.error)
                assert.strict.deepEqual(r.error.includes('final line oops'), true, r.error)
                assert.strict.deepEqual(r.errorDetail.exitCode, 1)
                assert.strict.deepEqual(r.errorDetail.stderrTail.includes('final line oops'), true)
                assert.strict.deepEqual(r.errorDetail.stderrTail.includes('request failed'), true)
                assert.strict.deepEqual('stdoutTail' in r.errorDetail, false)
                let shown = JSON.stringify([r.error, r.errorDetail])
                assert.strict.deepEqual([shown.includes(FAKE_KEY), shown.includes('FAKEKEY1234567890abcdef'), shown.includes(FAKE_BEARER)], [false, false, false], shown)
            })

            it('注入之金鑰(key／provider或key)即使不符任何樣式也被精確遮蔽', async function() {
                let secret = 'PLAINSECRETVALUE-01'
                let opt = { extraArgs: spec({ code: 1, stderr: `denied for ${secret} end` }) }
                if (kind === 'opencode') {
                    opt.key = secret
                    opt.provider = 'opencode-go'
                }
                if (kind === 'claude') {
                    opt.key = secret
                }
                if (kind === 'codex' || kind === 'antigravity') {

                    //無逐次金鑰概念: 非樣式之字串不在遮罩名單, 僅斷言其餘欄位完整
                    let r0 = await callers[kind](opt)
                    assert.strict.deepEqual(r0.errorDetail.stderrTail, `denied for ${secret} end`)
                    return
                }
                let r = await callers[kind](opt)
                let shown = JSON.stringify([r.error, r.errorDetail])
                assert.strict.deepEqual(shown.includes(secret), false, shown)
                assert.strict.deepEqual(r.errorDetail.stderrTail.includes('denied for'), true)
            })

            it('stderr很長時尾段取真正的尾端(execCli結果之stderr欄位只留前1000字元), 且長度受限 (R: 約300字元)', async function() {
                let r = await callers[kind]({ extraArgs: spec({ code: 3, stderr: `${'A'.repeat(3000)}\nTHE-END-MARK` }) })
                assert.strict.deepEqual(r.stderr.includes('THE-END-MARK'), false) //既有行為: 失敗結果之stderr欄位不含尾端
                assert.strict.deepEqual(r.error.startsWith('Exit code 3: '), true)
                assert.strict.deepEqual(r.error.endsWith('THE-END-MARK'), true, r.error)
                assert.strict.deepEqual(r.errorDetail.stderrTail.endsWith('THE-END-MARK'), true)
                assert.strict.deepEqual(r.errorDetail.stderrTail.length <= 300, true)
                assert.strict.deepEqual(r.error.length <= 'Exit code 3: '.length + 300, true)
            })

            it('逾時: error＝TIMEOUT after Ns: <stderr尾段>, 仍以TIMEOUT開頭, errorType timeout (必要測試2)', async function() {
                let r = await callers[kind]({ timeoutMs: 1500, extraArgs: spec({ hang: true, stderr: `${'.'.repeat(50)}\nwaiting for upstream response ${FAKE_KEY}` }) })
                assert.strict.deepEqual([r.ok, r.errorType], [false, 'timeout'])
                assert.strict.deepEqual(r.error.indexOf('TIMEOUT after 1.5s'), 0, r.error)
                assert.strict.deepEqual(r.error.includes('waiting for upstream response'), true, r.error)
                assert.strict.deepEqual(r.errorDetail.stderrTail.includes('waiting for upstream response'), true)
                assert.strict.deepEqual(JSON.stringify([r.error, r.errorDetail]).includes('FAKEKEY1234567890abcdef'), false)
            })

            it('驗證失敗、成功、無法啟動: 不加errorDetail, error文字不動', async function() {
                let v = await callers[kind]({ validate: 'min:100', extraArgs: spec({ code: 0, stdout: 'short', stderr: 'noise' }) })
                assert.strict.deepEqual([v.ok, v.error, v.errorType, 'errorDetail' in v], [false, 'OUTPUT_VALIDATION_FAILED', 'validation', false])
                let s = await callers[kind]({ extraArgs: spec({ code: 0, stdout: 'fine', stderr: 'noise' }) })
                assert.strict.deepEqual([s.ok, s.error, 'errorDetail' in s], [true, '', false])
                let u = await callers[kind]({ exe: bad.exe })
                assert.strict.deepEqual([u.ok, u.errorType, 'errorDetail' in u], [false, 'spawn', false])
            })
        })
    }

    describe('各條目 stderr 形態不同者(實查 2026-11-08)', function() {

        it('claude: 失敗訊息在stdout、stderr空 → error文字退用stdout尾段, errorDetail.stderrTail空、帶stdoutTail', async function() {
            let r = await callers.claude({ extraArgs: spec({ code: 1, stdout: 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)\n', stderr: '' }) })
            assert.strict.deepEqual(r.error, 'Exit code 1: API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)')
            assert.strict.deepEqual(r.errorDetail, { exitCode: 1, stderrTail: '', stdoutTail: 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)' })
        })

        it('claude: stderr有無關警告(給API金鑰時實測會有)、失敗訊息在stdout → error取stdout尾段; 其他CLI(codex)同形時取stderr尾段', async function() {
            let sp = { code: 1, stdout: 'API Error: Connection refused (ECONNREFUSED)\n', stderr: '⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set\n' }
            let c = await callers.claude({ extraArgs: spec(sp) })
            assert.strict.deepEqual(c.error, 'Exit code 1: API Error: Connection refused (ECONNREFUSED)')
            assert.strict.deepEqual([c.errorDetail.stderrTail.startsWith('⚠ claude.ai'), c.errorDetail.stdoutTail], [true, 'API Error: Connection refused (ECONNREFUSED)'])
            let x = await callers.codex({ extraArgs: spec(sp) })
            assert.strict.deepEqual(x.error, 'Exit code 1: ⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set')
        })

        it('claude帶假key且stdout含該key: error、errorDetail皆不含key (stdout尾段亦遮罩)', async function() {
            let key = 'sk-ant-api03-FAKEFAKEFAKEFAKE0000'
            let r = await callers.claude({ key, extraArgs: spec({ code: 1, stdout: `Invalid API key ${key}\n` }) })
            let shown = JSON.stringify([r.error, r.errorDetail, r.stdout, r.stderr])
            assert.strict.deepEqual(shown.includes('FAKEFAKEFAKEFAKE0000'), false, shown)
            assert.strict.deepEqual(r.errorDetail.stdoutTail.startsWith('Invalid API key'), true)
        })

        it('opencode: ANSI色碼＋pretty JSON的stderr → 尾段去色碼並折為單行(實查形狀: UnknownError「Unexpected server error. Check server logs for details.」+ ref)', async function() {
            let err = '\u001b[91m\u001b[1mError: \u001b[0m{\n  "name": "UnknownError",\n  "data": {\n    "message": "Unexpected server error. Check server logs for details.",\n    "ref": "err_0587b733"\n  }\n}\r\n'
            let r = await callers.opencode({ extraArgs: spec({ code: 1, stderr: err }) })
            assert.strict.deepEqual(r.error, 'Exit code 1: Error: { "name": "UnknownError", "data": { "message": "Unexpected server error. Check server logs for details.", "ref": "err_0587b733" } }')
            assert.strict.deepEqual(r.errorDetail.stderrTail.includes('\u001b'), false)
        })

        it('opencode(detectTruncation:true, --format json): 錯誤在stdout事件、stderr空 → 還原後之`Error: 訊息`進尾段', async function() {
            let ev = JSON.stringify({ type: 'error', timestamp: 1, sessionID: 'ses_x', error: { name: 'UnknownError', data: { message: 'Unexpected server error. Check server logs for details.' } } })
            let r = await callers.opencode({ detectTruncation: true, extraArgs: spec({ code: 1, stdout: `${ev}\n`, stderr: '' }) })
            assert.strict.deepEqual(r.error, 'Exit code 1: Error: Unexpected server error. Check server logs for details.')
            assert.strict.deepEqual(r.errorDetail.stderrTail, 'Error: Unexpected server error. Check server logs for details.')

            //內部提示(reshapeResult帶給runExecCli之diagStderr／diagStdout)取用後不留在結果; 呼叫端自給--format json者亦同
            assert.strict.deepEqual(['diagStderr' in r, 'diagStdout' in r], [false, false])
            let raw = await callers.opencode({ detectTruncation: true, extraArgs: ['--format', 'json', ...spec({ code: 1, stdout: `${ev}\n`, stderr: '' })] })
            assert.strict.deepEqual([raw.error, 'diagStderr' in raw, 'diagStdout' in raw], ['Exit code 1: Error: Unexpected server error. Check server logs for details.', false, false])
        })

        it('codex: 參數錯誤形態(clap, 離開碼2)的多行stderr → 尾段折為單行', async function() {
            let r = await callers.codex({ extraArgs: spec({ code: 2, stderr: 'error: invalid value \'bogus\' for \'--sandbox <SANDBOX_MODE>\'\n  [possible values: read-only, workspace-write, danger-full-access]\n\nFor more information, try \'--help\'.\n' }) })
            assert.strict.deepEqual(r.error, 'Exit code 2: error: invalid value \'bogus\' for \'--sandbox <SANDBOX_MODE>\' [possible values: read-only, workspace-write, danger-full-access] For more information, try \'--help\'.')
        })
    })

    describe('runExecCli: 重試只取最後一次嘗試之輸出; 自給之onStdout／onStderr／onTrace仍被呼叫', function() {

        it('maxRetries>0: 前次嘗試之stderr不混入最後一次之尾段 (每次spawn重置擷取)', async function() {
            let cnt = path.join(FD_TMP, 'retry-counter.txt')
            let code = `
import fs from 'node:fs'
let f = ${JSON.stringify(cnt)}
let n = 0
try { n = Number(fs.readFileSync(f, 'utf8')) } catch {}
fs.writeFileSync(f, String(n + 1))
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stderr.write(n === 0 ? 'FIRST-ATTEMPT-ERROR-LONG-TEXT-LONG-TEXT' : 'second', () => process.exit(1))
})
process.stdin.resume()
`
            let f2 = createFakeCli('fake-diag-retry', code)
            try {
                let r = await runExecCli(f2.exe, [], { input: 'x', maxRetries: 1, retryDelayMs: 1 })
                assert.strict.deepEqual([r.attempts, r.errorDetail.stderrTail, r.error], [2, 'second', 'Exit code 1: second'])
            }
            finally {
                f2.clean()
            }
        })

        it('呼叫端自給之onStdout、onStderr、onTrace照常收到資料(擷取不吞回調); 非函數之回調視同未給', async function() {
            let got = { out: '', err: '', spawn: 0 }
            let r = await dispatchCodex('hi', {
                exe: fake.exe,
                extraArgs: spec({ code: 1, stdout: 'OUT', stderr: 'ERR' }),
                onStdout: (s) => {
                    got.out += s
                },
                onStderr: (s) => {
                    got.err += s
                },
                onTrace: (ev) => {
                    if (ev.type === 'spawn') {
                        got.spawn++
                    }
                },
            })
            assert.strict.deepEqual([got.out, got.err, got.spawn], ['OUT', 'ERR', 1])
            assert.strict.deepEqual([r.ok, r.error, r.errorDetail.stderrTail, r.errorDetail.stdoutTail], [false, 'Exit code 1: ERR', 'ERR', 'OUT'])
            let r2 = await dispatchCodex('hi', { exe: fake.exe, extraArgs: spec({ code: 1, stderr: 'ERR2' }), onStdout: 'x', onStderr: 5, onTrace: {} })
            assert.strict.deepEqual([r2.ok, r2.error], [false, 'Exit code 1: ERR2'])
        })
    })
})


describe('opencode日誌對時擷取(必要測試3)', function() {

    this.timeout(60000)

    let fake = null
    let seq = 0
    before(function() {
        fake = createFakeCli('fake-diag-oc', ENTRY)
        fs.mkdirSync(FD_TMP, { recursive: true })
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    let specFile = (o) => {
        let f = path.join(FD_TMP, `oc-spec-${++seq}.json`)
        fs.writeFileSync(f, JSON.stringify(o), 'utf8')
        return `--spec=${f}`
    }
    let ln = (ms, extra) => `timestamp=${new Date(ms).toISOString()} level=ERROR run=ab12cd message="stream error" ${extra}`
    let logOf = (lines) => {
        let f = path.join(FD_TMP, `opencode-${++seq}.log`)
        fs.writeFileSync(f, lines.join('\n') + '\n', 'utf8')
        return f
    }
    let run = (opt = {}) => dispatchOpencode('hi', { exe: fake.exe, model: 'opencode-go/deepseek-v4-pro', extraArgs: [specFile({ code: 1, stderr: 'Error: Unexpected server error. Check server logs for details.' })], ...opt })

    it('±60秒內相符一筆、不相符(model、provider)與超出時窗各一筆: 只取相符者; 分類放進error文字', async function() {
        let now = Date.now()
        let f = logOf([
            ln(now - 3600 * 1000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="TOO-OLD-ENTRY"'),
            ln(now + 3600 * 1000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="TOO-NEW-ENTRY"'),
            ln(now, 'providerID=opencode-go modelID=other-model agent=build error.error="WRONG-MODEL-ENTRY"'),
            ln(now, 'providerID=opencode modelID=deepseek-v4-pro agent=build error.error="WRONG-PROVIDER-ENTRY"'),
            ln(now, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="AI_APICallError: Upstream request failed: [overloaded]"'),
        ])
        let r = await run({ opencodeLog: f })
        assert.strict.deepEqual(r.ok, false)
        assert.strict.deepEqual(r.errorDetail.upstream, 'AI_APICallError: Upstream request failed: [overloaded]')
        assert.strict.deepEqual(r.error, 'Exit code 1 [overloaded]: Error: Unexpected server error. Check server logs for details.')
        assert.strict.deepEqual(r.errorType, 'exec')
        assert.strict.deepEqual(JSON.stringify(r.errorDetail).includes('ENTRY'), false)
    })

    it('逾時: 原因行發生在嘗試之初, 仍於時窗內取得, error以TIMEOUT開頭並帶分類', async function() {
        let now = Date.now()
        let f = logOf([ln(now - 500, 'providerID=opencode modelID=beam-free agent=build error.error="AI_APICallError: Free usage limit reached. Free models work in OpenCode"')])
        let r = await dispatchOpencode('hi', { exe: fake.exe, model: 'opencode/beam-free', timeoutMs: 1500, opencodeLog: f, extraArgs: [specFile({ hang: true, stderr: '' })] })
        assert.strict.deepEqual(r.errorType, 'timeout')
        assert.strict.deepEqual(r.error, 'TIMEOUT after 1.5s [Free usage limit]')
        assert.strict.deepEqual(r.errorDetail.upstream.startsWith('AI_APICallError: Free usage limit reached'), true)
    })

    it('日誌檔不存在、路徑為資料夾: errorDetail無upstream、不拋錯、error文字同無日誌時', async function() {
        let base = await run({ opencodeLog: path.join(FD_TMP, 'nope.log') })
        assert.strict.deepEqual('upstream' in base.errorDetail, false)
        assert.strict.deepEqual(base.error, 'Exit code 1: Error: Unexpected server error. Check server logs for details.')
        let dir = await run({ opencodeLog: FD_TMP })
        assert.strict.deepEqual(['upstream' in dir.errorDetail, dir.error], [false, base.error])
    })

    it('opencodeLog:false 不讀日誌; model無provider前綴 → 不擷取', async function() {
        let now = Date.now()
        let f = logOf([ln(now, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="[overloaded]"')])
        let off = await run({ opencodeLog: false })
        assert.strict.deepEqual('upstream' in off.errorDetail, false)
        let noProv = await run({ opencodeLog: f, model: 'deepseek-v4-pro' })
        assert.strict.deepEqual('upstream' in noProv.errorDetail, false)
        let on = await run({ opencodeLog: f })
        assert.strict.deepEqual(on.errorDetail.upstream, '[overloaded]')
    })

    it('預設路徑依XDG_DATA_HOME(opt.env)推得: <XDG>/opencode/log/opencode.log', async function() {
        let now = Date.now()
        let xdg = path.join(FD_TMP, 'xdg-home')
        fs.mkdirSync(path.join(xdg, 'opencode', 'log'), { recursive: true })
        fs.writeFileSync(path.join(xdg, 'opencode', 'log', 'opencode.log'), ln(now, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="Upstream request failed: [prefill_cap_refused]"') + '\n')
        let r = await run({ env: { XDG_DATA_HOME: xdg } })
        assert.strict.deepEqual(r.error.startsWith('Exit code 1 [prefill_cap_refused]: '), true, r.error)
    })

    it('日誌內容含金鑰樣式時擷取結果亦遮罩; 注入之key精確遮蔽', async function() {
        let now = Date.now()
        let f = logOf([ln(now, `providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="denied sk-test-LOGKEY1234567890abcd and INJECTEDKEY-77777"`)])
        let r = await run({ opencodeLog: f, key: 'INJECTEDKEY-77777', provider: 'opencode-go' })
        let shown = JSON.stringify([r.error, r.errorDetail])
        assert.strict.deepEqual([shown.includes('LOGKEY'), shown.includes('INJECTEDKEY-77777')], [false, false], shown)
        assert.strict.deepEqual(r.errorDetail.upstream.startsWith('denied'), true)
    })

    it('成功呼叫不讀日誌、不加errorDetail; 非opencode條目(codex)不受opencodeLog影響', async function() {
        let now = Date.now()
        let f = logOf([ln(now, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="[overloaded]"')])
        let ok = await run({ opencodeLog: f, extraArgs: [specFile({ code: 0, stdout: 'fine' })] })
        assert.strict.deepEqual([ok.ok, 'errorDetail' in ok], [true, false])
        let cx = await dispatchCodex('hi', { exe: fake.exe, opencodeLog: f, extraArgs: [specFile({ code: 1, stderr: 'x' })] })
        assert.strict.deepEqual('upstream' in cx.errorDetail, false)
    })
})


describe('成功結果帶finish與outputChars (必要測試4)', function() {

    this.timeout(60000)

    let fake = null
    let ev = null
    let svr = null
    let seq = 0
    before(async function() {
        fake = createFakeCli('fake-diag-ok', ENTRY)
        ev = createFakeOpencodeEvents('fake-diag-ok-ev')
        svr = await fakeServerForApiTest()
        fs.mkdirSync(FD_TMP, { recursive: true })
    })
    after(async function() {
        if (fake) {
            fake.clean()
        }
        if (ev) {
            ev.clean()
        }
        if (svr) {
            await svr.close()
        }
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    let specFile = (o) => {
        let f = path.join(FD_TMP, `ok-spec-${++seq}.json`)
        fs.writeFileSync(f, JSON.stringify(o), 'utf8')
        return `--spec=${f}`
    }

    it('codex／claude／opencode(未開偵測)／antigravity: finish為unknown(終止原因不可見), outputChars為stdout字元數', async function() {
        let o = { extraArgs: [specFile({ code: 0, stdout: '中文abc' })] }
        let rs = [
            await dispatchCodex('hi', { exe: fake.exe, ...o }),
            await dispatchClaude('hi', { exe: fake.exe, ...o }),
            await dispatchOpencode('hi', { exe: fake.exe, model: 'p/m', ...o }),
            await dispatchAntigravity('hi', { exe: fake.exe, ...o }),
        ]
        assert.strict.deepEqual(rs.map((r) => [r.ok, r.stdout, r.finish, r.outputChars]), rs.map(() => [true, '中文abc', 'unknown', 5]))
    })

    it('opencode(detectTruncation:true): finish取自最後一步之終止原因(stop／length); outputChars為還原後stdout字元數', async function() {
        let run = (scen, opt = {}) => dispatchOpencode('hi', { exe: ev.exe, model: 'fake/m', detectTruncation: true, ...opt, extraArgs: [`--fake-scenario=${scen}`] })
        let stop = await run('stop')
        assert.strict.deepEqual([stop.ok, stop.finish, stop.outputChars, stop.stdout.length], [true, 'stop', stop.stdout.length, `hello world${os.EOL}`.length])
        let tool = await run('tool-then-stop')
        assert.strict.deepEqual([tool.ok, tool.finish, tool.outputChars], [true, 'stop', `final answer${os.EOL}`.length])
        let cut = await run('length-text', { acceptTruncated: true })
        assert.strict.deepEqual([cut.ok, cut.truncated, cut.finishReason, cut.finish, cut.outputChars], [true, true, 'length', 'length', cut.stdout.length])
        let off = await dispatchOpencode('hi', { exe: ev.exe, model: 'fake/m', extraArgs: ['--fake-scenario=stop'] })
        assert.strict.deepEqual([off.ok, off.finish, off.outputChars], [true, 'unknown', `hello world${os.EOL}`.length])
    })

    it('既有incomplete案不變: 截斷預設失敗, errorType incomplete、error以INCOMPLETE_RESPONSE開頭、帶truncated／finishReason／tokens, 不帶errorDetail／finish／outputChars', async function() {
        let r = await dispatchOpencode('hi', { exe: ev.exe, model: 'fake/m', detectTruncation: true, extraArgs: ['--fake-scenario=length-text'] })
        assert.strict.deepEqual([r.ok, r.errorType, r.truncated, r.finishReason], [false, 'incomplete', true, 'length'])
        assert.strict.deepEqual(r.error.indexOf('INCOMPLETE_RESPONSE'), 0)
        assert.strict.deepEqual([typeof r.tokens, 'errorDetail' in r, 'finish' in r, 'outputChars' in r], ['object', false, false, false])
    })

    it('opencode離開碼非0(含length之後才錯誤事件)仍是一般exec失敗: 帶errorDetail, 不帶finish／outputChars', async function() {
        let r = await dispatchOpencode('hi', { exe: ev.exe, model: 'fake/m', detectTruncation: true, extraArgs: ['--fake-scenario=length-then-error'] })
        assert.strict.deepEqual([r.ok, r.errorType, 'truncated' in r, 'finish' in r], [false, 'exec', false, false])
        assert.strict.deepEqual(r.error, 'Exit code 1: Error: boom after length')
    })

    it('REST條目經dispatchAi／dispatchAiFallback: finish取自finishReason(stop／length), 缺值為unknown; outputChars為stdout字元數', async function() {
        let call = (model, opt = {}) => dispatchAi('api-openai-compat', 'hi', { baseURL: svr.url, key: 'sk-good-1', model, ...opt })
        let a = await call('plain-content')
        assert.strict.deepEqual([a.ok, a.stdout, a.finishReason, a.finish, a.outputChars], [true, 'hello world', 'stop', 'stop', 11])
        let b = await call('finish-null')
        assert.strict.deepEqual([b.ok, b.finish, b.outputChars], [true, 'unknown', '完成'.length])
        let c = await call('trunc-text', { acceptTruncated: true })
        assert.strict.deepEqual([c.ok, c.truncated, c.finish, c.outputChars], [true, true, 'length', '第一段說明，第二'.length])
        let d = await dispatchAiFallback('hi', { providers: [{ id: 'oc:x', kind: 'api-openai-compat', baseURL: svr.url, keys: ['sk-good-1'], model: 'plain-content' }] })
        assert.strict.deepEqual([d.ok, d.finish, d.outputChars], [true, 'stop', 11])
    })

    it('失敗的REST結果不加finish／outputChars', async function() {
        let r = await dispatchAi('api-openai-compat', 'hi', { baseURL: svr.url, key: 'sk-good-1', model: 'err-500', maxRetries: 0 })
        assert.strict.deepEqual([r.ok, 'finish' in r, 'outputChars' in r], [false, false, false])
    })
})


describe('遞補層: 既有失敗分類不因error文字加了原因而改變 (必要測試5, 主控已定4)', function() {

    this.timeout(60000)

    let fake = null
    let seq = 0
    before(function() {
        fake = createFakeCli('fake-diag-fb', ENTRY)
        fs.mkdirSync(FD_TMP, { recursive: true })
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    let specFile = (o) => {
        let f = path.join(FD_TMP, `fb-spec-${++seq}.json`)
        fs.writeFileSync(f, JSON.stringify(o), 'utf8')
        return `--spec=${f}`
    }
    let outcomes = async (spec, extra = {}) => {
        let events = []
        let r = await dispatchAiFallback('hi', {
            providers: [{ id: 'cx:a', kind: 'codex', exe: fake.exe, extraArgs: [specFile(spec)], ...extra }],
            onEvent: (e) => events.push(e),
        })
        return { r, events, tried: r.tried.map((t) => [t.outcome, t.errorType]) }
    }

    it('stderr尾段含ENOENT: 仍為next-key(逐把換), 不被誤判為與金鑰無關而整組跳過(skip-group)', async function() {
        let { tried, r } = await outcomes({ code: 1, stderr: 'Error: ENOENT: no such file or directory, open "x"' })
        assert.strict.deepEqual(tried, [['next-key', 'exec']])
        assert.strict.deepEqual(r.error.startsWith('Exit code 1: '), true)
        assert.strict.deepEqual(r.error.includes('ENOENT'), true) //原因進了error文字, 分類卻不變
    })

    it('對照: 無ENOENT字樣之同形失敗亦為next-key; 逾時仍為skip-group(既有: 逾時整組跳過); 離開碼2仍為skip-group(CLI參數錯誤)', async function() {
        assert.strict.deepEqual((await outcomes({ code: 1, stderr: 'Error: boom' })).tried, [['next-key', 'exec']])
        assert.strict.deepEqual((await outcomes({ hang: true, stderr: 'waiting' }, { timeoutMs: 1200 })).tried, [['skip-group', 'timeout']])
        assert.strict.deepEqual((await outcomes({ code: 2, stderr: 'usage: x' })).tried, [['skip-group', 'exec']])
    })

    it('tried與事件帶的error文字含原因, stdout／stderr欄位維持execCli原樣(失敗時裁切)', async function() {
        let { r, events } = await outcomes({ code: 1, stderr: 'Error: reason-xyz' })
        let t = r.tried[0]
        assert.strict.deepEqual([t.error, t.stderr], ['Exit code 1: Error: reason-xyz', 'Error: reason-xyz'])
        assert.strict.deepEqual(events.filter((e) => e.type === 'next-key').map((e) => e.error), ['Exit code 1: Error: reason-xyz'])
        assert.strict.deepEqual(r.errorDetail.stderrTail, 'Error: reason-xyz')
    })

    it('errorType冷卻觸發不變: 逾時(TIMEOUT開頭)仍觸發cooldown, 一般exec失敗不觸發', async function() {
        let cooled = async (spec, extra = {}) => {
            let events = []
            await dispatchAiFallback('hi', { providers: [{ id: 'cx:b', kind: 'codex', exe: fake.exe, extraArgs: [specFile(spec)], ...extra }], cooldownMs: 60000, onEvent: (e) => events.push(e) })
            return events.some((e) => e.type === 'cooled')
        }
        assert.strict.deepEqual(await cooled({ hang: true, stderr: 'w' }, { timeoutMs: 1200 }), true)
        assert.strict.deepEqual(await cooled({ code: 1, stderr: 'Error: boom' }), false)
    })
})
