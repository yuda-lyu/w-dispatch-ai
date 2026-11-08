import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { maskDiag, tailOf, baseErrorOf, upstreamClassOf, composeError, addErrorDetail, addUpstream, finishOf, withOutputInfo, createTailCapture } from '../src/failureDiag.mjs'
import { getOpencodeLogPath, pickUpstream, readOpencodeUpstream } from '../src/opencodeUpstream.mjs'
import diagCases from 'wsemi/src/_diagCases.mjs'
import getDiagSecrets from 'wsemi/src/getDiagSecrets.mjs'
import getErrorType from '../src/getErrorType.mjs'
import { learnQuotaFromFailure, resolveSubQuotaGate } from '../src/subQuotaGate.mjs'
import { createQuotaGateState } from '../src/goQuotaGate.mjs'


// unit-failureDiag.test.mjs — CLI失敗診斷之純函數(尾段、遮罩、原始error還原、上游分類、日誌擷取)與「不改變既有分類」之釘住(da110, Gitea #110)
//
// 規格來源: 主控派工 da110〈主控已定〉——
//   §1 非零離開碼之error文字為`Exit code N: <stderr尾段>`(約300字元), 結果加errorDetail{ exitCode, stderrTail, stdoutTail? }, 遮罩沿用既有函數(金鑰、權杖、帶憑證之連線字串);
//   §2 opencode日誌對時擷取: 失敗時刻±60秒內providerID／modelID相符之ERROR行的原因附入errorDetail.upstream, 簡短分類放進error文字, 找不到即略、讀檔失敗不拋;
//   §3 成功結果帶finish與outputChars; 4. 既有失敗分類與配額判定不因error文字加了原因而改變。
// 本檔之金鑰皆為假值(FAKE開頭), 不讀任何真實金鑰。


let FD_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'failureDiag')
let T = Date.parse('2026-11-05T08:52:00.000Z')
let iso = (ms) => new Date(ms).toISOString()


describe('failureDiag: 遮罩與尾段', function() {

    it('maskDiag: 精確機密值、sk-ant-、sk-／oc_sk_／AIza／ghp_／JWT樣式、Bearer、token=、網址帳密皆遮蔽(R1: 金鑰、權杖、帶憑證之連線字串一律遮蔽)', function() {
        let jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFIn0.FAKESIGNATUREabcdef'
        let cases = [
            ['bad key sk-test-FAKEKEY1234567890abcdef rejected', 'FAKEKEY1234567890abcdef'],
            ['oc_sk_FAKEOCKEYabcdefghijklmnop used', 'FAKEOCKEYabcdefghijklmnop'],
            ['key sk-ant-api03-FAKEANTKEY-abcdef end', 'FAKEANTKEY'],
            ['AIzaFAKEGOOGLEKEY0123456789abcdefghijk', 'FAKEGOOGLEKEY'],
            ['ghp_FAKEGITHUBTOKEN0123456789ABCDEFGH', 'FAKEGITHUBTOKEN'],
            [`jwt ${jwt}`, 'FAKESIGNATURE'],
            ['Authorization: Bearer FAKEBEARER.abc.def', 'FAKEBEARER'],
            ['token=FAKETOKEN123456 x', 'FAKETOKEN123456'],
            ['connect https://user:FAKEPASS99@host.example/db failed', 'FAKEPASS99'],
            ['{"apiKey":"FAKEAPIKEYVALUE1234"}', 'FAKEAPIKEYVALUE1234'],
            ['own FAKE-EXACT-SECRET-77 value', 'FAKE-EXACT-SECRET-77'],
        ]
        for (let [text, secret] of cases) {
            let out = maskDiag(text, ['FAKE-EXACT-SECRET-77'])
            assert.strict.deepEqual(out.includes(secret), false, `${text} → ${out}`)
            assert.strict.deepEqual(out.length > 0, true)
        }
    })

    it('maskDiag: 無機密的一般錯誤文字原樣保留(含task-、risk-等含sk-子字串之詞); 非字串回空字串; 永不拋錯', function() {
        assert.strict.deepEqual(maskDiag('Error: Unexpected server error. Check server logs for details. ref err_0587b733', []), 'Error: Unexpected server error. Check server logs for details. ref err_0587b733')
        assert.strict.deepEqual(maskDiag('task-force-assessment-framework-document risk-management-plan-v2', []), 'task-force-assessment-framework-document risk-management-plan-v2')
        assert.strict.deepEqual([maskDiag(null, []), maskDiag(undefined), maskDiag(123, ['x']), maskDiag({}, null)], ['', '', '', ''])
    })

    it('tailOf: 去ANSI色碼、CRLF正規化、折疊空白、略過空白行; 超過300字元只留尾端並以…接頭(R2: 約300字元)', function() {
        assert.strict.deepEqual(tailOf('\u001b[91m\u001b[1mError: \u001b[0m{\r\n  "name": "UnknownError"\r\n}\r\n\r\n'), 'Error: {\n"name": "UnknownError"\n}')
        let long = `${'A'.repeat(500)}\nTHE-END-MARK`
        let t = tailOf(long)
        assert.strict.deepEqual([t.length, t.startsWith('…'), t.endsWith('THE-END-MARK')], [300, true, true])
        assert.strict.deepEqual(tailOf('short'), 'short')
        assert.strict.deepEqual([tailOf(''), tailOf(null), tailOf(undefined), tailOf(42)], ['', '', '', ''])
        assert.strict.deepEqual(tailOf('x'.repeat(100), { max: 10 }), `…${'x'.repeat(9)}`)
    })

    it('tailOf: 遮蔽先於截尾——被尾段邊界切開的金鑰不會殘留前段; 機密值亦遮', function() {
        let key = 'sk-test-FAKEKEY1234567890abcdefXYZ'
        let text = `${'y'.repeat(285)} ${key} tail`
        let t = tailOf(text)
        assert.strict.deepEqual(t.includes('FAKEKEY'), false, t)
        assert.strict.deepEqual(t.includes('abcdefXYZ'), false, t)
        let t2 = tailOf(`pre ${'z'.repeat(280)} MY-INJECTED-SECRET-9 end`, { secrets: ['MY-INJECTED-SECRET-9'] })
        assert.strict.deepEqual(t2.includes('MY-INJECTED-SECRET-9'), false)
    })

    it('tailOf: 不切在代理對中間', function() {
        let s = '😀'.repeat(400)
        let t = tailOf(s, { max: 11 })
        assert.strict.deepEqual(/[\ud800-\udbff]$/.test(t) || /^…[\udc00-\udfff]/.test(t), false)
    })
})


describe('failureDiag: wsemi共用語料(dspec〈診斷輸出與遮罩〉D5)之接線案', function() {

    //語料中標wire:true且受測函數為maskDiagText者(T01 字串含密碼、T07 Bearer／token=／"password":／authorization: Basic), 以本套件之呼叫點maskDiag重跑;
    //語料以getDiagSecrets之結果傳秘密, 本套件之呼叫點收字串陣列, 故轉接器只取其detail清單(測試端轉接, 不屬正式碼)
    let wired = diagCases.cases.filter((c) => c.wire && c.fn === 'maskDiagText')

    it('語料中有wire案可跑(語料改版令wire案消失時此案先紅, 不致靜默略過)', function() {
        assert.strict.deepEqual(wired.length >= 2, true)
    })

    for (let c of wired) {
        it(`${c.id} ${c.label}`, async function() {
            let ctx = diagCases.mkCtx({ util: true })
            let api = {
                getDiagSecrets,
                maskDiagText: (s, secrets) => maskDiag(s, Array.isArray(secrets) ? secrets : (secrets && secrets.detail) || []),
            }
            let out = await c.call(api, ctx)
            assert.strict.deepEqual(diagCases.verify(c, out, ctx), null)
        })
    }
})


describe('failureDiag: baseErrorOf／composeError／upstreamClassOf', function() {

    it('baseErrorOf: execCli原生三形狀(含加了分類與尾段者)還原為原始error; 其餘原樣', function() {
        let r = [
            baseErrorOf('Exit code 1'),
            baseErrorOf('Exit code 1: Error: ENOENT something'),
            baseErrorOf('Exit code 137 [overloaded]: Error: x\ny'),
            baseErrorOf('Exit code -1073741510: boom'),
            baseErrorOf('Signal: SIGTERM: killed'),
            baseErrorOf('TIMEOUT after 300s: waiting'),
            baseErrorOf('TIMEOUT after 1.5s(子進程未能結束) [Free usage limit]: x'),
            baseErrorOf('OUTPUT_VALIDATION_FAILED'),
            baseErrorOf('FETCH_ERROR: ENOENT'),
            baseErrorOf('Exit code 1 | agy stream-json: result status ERROR: x'),
            baseErrorOf(null),
        ]
        let rr = ['Exit code 1', 'Exit code 1', 'Exit code 137', 'Exit code -1073741510', 'Signal: SIGTERM', 'TIMEOUT after 300s', 'TIMEOUT after 1.5s(子進程未能結束)', 'OUTPUT_VALIDATION_FAILED', 'FETCH_ERROR: ENOENT', 'Exit code 1 | agy stream-json: result status ERROR: x', null]
        assert.strict.deepEqual(r, rr)
    })

    it('composeError: <原始>[ [分類]][: <尾段>], 尾段內換行折為單一空白', function() {
        assert.strict.deepEqual(composeError('Exit code 1', '', 'Error: x\n  y'), 'Exit code 1: Error: x y')
        assert.strict.deepEqual(composeError('Exit code 1', 'overloaded', 'Error: x'), 'Exit code 1 [overloaded]: Error: x')
        assert.strict.deepEqual(composeError('TIMEOUT after 5s', 'Free usage limit', ''), 'TIMEOUT after 5s [Free usage limit]')
        assert.strict.deepEqual(composeError('Exit code 2', '', ''), 'Exit code 2')
    })

    it('upstreamClassOf: 方括號詞優先; 已知字樣表; 雜訊方括號詞不當分類(R2: [overloaded]／[prefill_cap_refused]／Free usage limit／Model access is disabled)', function() {
        let r = [
            upstreamClassOf('AI_APICallError: Upstream request failed: [overloaded]'),
            upstreamClassOf('Upstream request failed: [prefill_cap_refused] input too large'),
            upstreamClassOf('AI_RetryError: Failed after 3 attempts. Last error: Free usage limit reached. Free models work in OpenCode'),
            upstreamClassOf('AI_APICallError: Upstream request failed: Model access is disabled'),
            upstreamClassOf('Invalid API key.'),
            upstreamClassOf('weird [REDACTED] and [object Object]'),
            upstreamClassOf('something unrecognised'),
            upstreamClassOf(''),
            upstreamClassOf(null),
        ]
        assert.strict.deepEqual(r, ['overloaded', 'prefill_cap_refused', 'Free usage limit', 'Model access is disabled', 'Invalid API key', '', '', '', ''])
    })
})


describe('failureDiag: addErrorDetail／addUpstream', function() {

    let fail = (extra = {}) => ({ ok: false, stdout: '', stderr: '', code: 1, error: 'Exit code 1', errorType: 'exec', durationMs: 5, pid: 1, ...extra })

    it('exec失敗: error＝Exit code N: <stderr尾段>, errorDetail{ exitCode, stderrTail }(stdoutTail空者不出現); stdout／stderr／errorType不動', function() {
        let r0 = fail({ stderr: 'Error: boom\r\n' })
        let r = addErrorDetail(r0, {})
        assert.strict.deepEqual(r.error, 'Exit code 1: Error: boom')
        assert.strict.deepEqual(r.errorDetail, { exitCode: 1, stderrTail: 'Error: boom' })
        assert.strict.deepEqual([r.stdout, r.stderr, r.errorType, r.code], [r0.stdout, r0.stderr, 'exec', 1])
    })

    it('src.stderr(擷取到之子進程輸出尾端)優先於結果之stderr欄位(execCli失敗時該欄位只留前1000字元)', function() {
        let r = addErrorDetail(fail({ stderr: `${'H'.repeat(900)}...(truncated, total 5000 chars)` }), { stderr: `${'x'.repeat(4000)}\nREAL-TAIL-LINE` })
        assert.strict.deepEqual(r.errorDetail.stderrTail.endsWith('REAL-TAIL-LINE'), true)
        assert.strict.deepEqual(r.error.endsWith('REAL-TAIL-LINE'), true)
    })

    it('stderr為空且為Exit code時error文字退用stdout尾段(claude把失敗訊息印在stdout), errorDetail帶stdoutTail; 逾時與訊號結束不退用', function() {
        let r = addErrorDetail(fail({ stdout: 'API Error: Connection refused (ECONNREFUSED)\n' }), {})
        assert.strict.deepEqual(r.error, 'Exit code 1: API Error: Connection refused (ECONNREFUSED)')
        assert.strict.deepEqual(r.errorDetail, { exitCode: 1, stderrTail: '', stdoutTail: 'API Error: Connection refused (ECONNREFUSED)' })
        let t = addErrorDetail(fail({ code: null, error: 'TIMEOUT after 5s', errorType: 'timeout', stdout: 'partial model text' }), {})
        assert.strict.deepEqual([t.error, t.errorDetail.stdoutTail, t.errorDetail.exitCode], ['TIMEOUT after 5s', 'partial model text', null])
        let g = addErrorDetail(fail({ code: null, error: 'Signal: SIGTERM', stdout: 'out' }), {})
        assert.strict.deepEqual(g.error, 'Signal: SIGTERM')
    })

    it('prefer為stdout(claude): Exit code之error文字取stdout尾段優先(stderr可能只有無關警告), stdout空才退用stderr; 其他prefer與逾時不受影響; errorDetail兩者皆帶', function() {
        let both = fail({ stdout: 'API Error: Connection refused (ECONNREFUSED)\n', stderr: '⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set\n' })
        let a = addErrorDetail(both, { prefer: 'stdout' })
        assert.strict.deepEqual(a.error, 'Exit code 1: API Error: Connection refused (ECONNREFUSED)')
        assert.strict.deepEqual([a.errorDetail.stderrTail.startsWith('⚠ claude.ai'), a.errorDetail.stdoutTail.startsWith('API Error')], [true, true])
        let b = addErrorDetail(both, {})
        assert.strict.deepEqual(b.error, 'Exit code 1: ⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set')
        let c = addErrorDetail(fail({ stdout: '', stderr: 'only stderr' }), { prefer: 'stdout' })
        assert.strict.deepEqual(c.error, 'Exit code 1: only stderr')
        let d = addErrorDetail(fail({ code: null, error: 'TIMEOUT after 5s', errorType: 'timeout', stdout: 'out', stderr: 'err' }), { prefer: 'stdout' })
        assert.strict.deepEqual(d.error, 'TIMEOUT after 5s: err')
    })

    it('逾時: error＝TIMEOUT after Ns: <stderr尾段>, 仍以TIMEOUT開頭', function() {
        let r = addErrorDetail(fail({ code: null, error: 'TIMEOUT after 300s', errorType: 'timeout', stderr: 'waiting for upstream' }), {})
        assert.strict.deepEqual(r.error, 'TIMEOUT after 300s: waiting for upstream')
        assert.strict.deepEqual(r.error.indexOf('TIMEOUT'), 0)
    })

    it('機密值經src.secrets與樣式遮蔽, errorDetail與error文字皆不含', function() {
        let r = addErrorDetail(fail({ stderr: 'Error: Authorization: Bearer FAKEBEARER.x.y and INJECTED-SECRET-123456 and sk-test-FAKEKEY1234567890abcdef' }), { secrets: ['INJECTED-SECRET-123456'] })
        let all = JSON.stringify([r.error, r.errorDetail])
        for (let s of ['FAKEBEARER', 'INJECTED-SECRET-123456', 'FAKEKEY1234567890abcdef']) {
            assert.strict.deepEqual(all.includes(s), false, s)
        }
    })

    it('不適用者原樣回傳(同一物件): 成功、spawn、params、validation、incomplete、aborted、非物件', function() {
        let items = [
            { ok: true, stdout: 'x' },
            fail({ errorType: 'spawn', code: null, error: 'ENOENT: spawn x ENOENT' }),
            fail({ errorType: 'params', error: 'prompt must be a non-empty string' }),
            fail({ errorType: 'validation', error: 'OUTPUT_VALIDATION_FAILED', code: 0 }),
            fail({ errorType: 'incomplete', error: 'INCOMPLETE_RESPONSE: x' }),
            fail({ errorType: 'aborted', error: 'ABORTED' }),
        ]
        for (let it of items) {
            assert.strict.deepEqual(addErrorDetail(it, { stderr: 'zzz' }) === it, true, JSON.stringify(it))
        }
        assert.strict.deepEqual([addErrorDetail(null), addErrorDetail('x'), addErrorDetail(undefined)], [null, 'x', undefined])
    })

    it('非execCli原生形狀之error(轉接器自組, 如agy)文字原樣保留, 仍附errorDetail; 已加過原因者再處理不重複加(冪等)', function() {
        let agy = fail({ error: 'Exit code 1 | agy stream-json: result status ERROR: quota', stderr: 'AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED"}' })
        let r = addErrorDetail(agy, {})
        assert.strict.deepEqual(r.error, agy.error)
        assert.strict.deepEqual(r.errorDetail.stderrTail, 'AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED"}')
        let once = addErrorDetail(fail({ stderr: 'Error: boom' }), {})
        let twice = addErrorDetail(once, {})
        assert.strict.deepEqual(twice.error, once.error)
    })

    it('addUpstream: errorDetail.upstream, 分類放進error文字(原尾段保留); 無errorDetail、成功、null原樣', function() {
        let r1 = addErrorDetail(fail({ stderr: 'Error: Unexpected server error' }), {})
        let r2 = addUpstream(r1, { upstream: 'AI_APICallError: Upstream request failed: [overloaded]', class: 'overloaded' })
        assert.strict.deepEqual(r2.error, 'Exit code 1 [overloaded]: Error: Unexpected server error')
        assert.strict.deepEqual(r2.errorDetail, { exitCode: 1, stderrTail: 'Error: Unexpected server error', upstream: 'AI_APICallError: Upstream request failed: [overloaded]' })
        assert.strict.deepEqual(baseErrorOf(r2.error), 'Exit code 1')

        //無尾段者: Exit code 1 [class]
        let r3 = addUpstream(addErrorDetail(fail(), {}), { upstream: 'x [rate_limited]', class: 'rate_limited' })
        assert.strict.deepEqual(r3.error, 'Exit code 1 [rate_limited]')

        //再次加(換新分類)取代舊分類, 不疊加
        let r4 = addUpstream(r2, { upstream: 'y', class: 'Free usage limit' })
        assert.strict.deepEqual(r4.error, 'Exit code 1 [Free usage limit]: Error: Unexpected server error')

        let plain = fail()
        assert.strict.deepEqual(addUpstream(plain, { upstream: 'x', class: '' }) === plain, true)
        assert.strict.deepEqual(addUpstream(r1, null) === r1, true)
        let okr = { ok: true, stdout: 'x' }
        assert.strict.deepEqual(addUpstream(okr, { upstream: 'x', class: '' }) === okr, true)
    })
})


describe('failureDiag: finish／outputChars', function() {

    it('finishOf: stop-like→stop, max_tokens→length, 其餘原值小寫, 空值→unknown', function() {
        assert.strict.deepEqual(['stop', 'end_turn', 'STOP', 'completed', 'stop_sequence'].map(finishOf), ['stop', 'stop', 'stop', 'stop', 'stop'])
        assert.strict.deepEqual(['length', 'max_tokens', 'content_filter', 'tool_calls', '', null, undefined, 5].map(finishOf), ['length', 'length', 'content_filter', 'tool_calls', 'unknown', 'unknown', 'unknown', 'unknown'])
    })

    it('withOutputInfo: 成功結果加finish(取自finishReason, 無則unknown)與outputChars(stdout字元數); 已有者不覆寫; 失敗與非物件原樣', function() {
        assert.strict.deepEqual(withOutputInfo({ ok: true, stdout: 'abc' }), { ok: true, stdout: 'abc', finish: 'unknown', outputChars: 3 })
        assert.strict.deepEqual(withOutputInfo({ ok: true, stdout: '中文', finishReason: 'end_turn' }), { ok: true, stdout: '中文', finishReason: 'end_turn', finish: 'stop', outputChars: 2 })
        assert.strict.deepEqual(withOutputInfo({ ok: true, stdout: 'abc', finish: 'length', outputChars: 99 }), { ok: true, stdout: 'abc', finish: 'length', outputChars: 99 })
        let bad = { ok: false, stdout: 'x' }
        assert.strict.deepEqual([withOutputInfo(bad) === bad, withOutputInfo(null), withOutputInfo('s')], [true, null, 's'])
        assert.strict.deepEqual(withOutputInfo({ ok: true }), { ok: true, finish: 'unknown', outputChars: 0 })
    })

    it('createTailCapture: 只保留各自最後4096字元; reset清空', function() {
        let c = createTailCapture()
        c.pushErr('a'.repeat(5000))
        c.pushErr('END')
        c.pushOut('o')
        c.pushOut(5)
        assert.strict.deepEqual([c.err().length, c.err().endsWith('END'), c.out()], [4096, true, 'o'])
        c.reset()
        assert.strict.deepEqual([c.err(), c.out()], ['', ''])
    })
})


describe('opencodeUpstream: 日誌路徑與擷取', function() {

    before(function() {
        fs.mkdirSync(FD_TMP, { recursive: true })
    })
    after(function() {
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    let line = (ts, extra) => `timestamp=${iso(ts)} level=ERROR run=ab12cd message="stream error" ${extra}`
    let q = { provider: 'opencode-go', modelID: 'deepseek-v4-pro', fromMs: T - 60000, toMs: T + 60000 }

    it('getOpencodeLogPath: 給file用之; 否則<XDG_DATA_HOME(env優先於process.env)或~/.local/share>/opencode/log/opencode.log (R: 預設依平台推得)', function() {
        assert.strict.deepEqual(getOpencodeLogPath({ file: path.join(FD_TMP, 'x.log') }), path.join(FD_TMP, 'x.log'))
        assert.strict.deepEqual(getOpencodeLogPath({ env: { XDG_DATA_HOME: path.join(FD_TMP, 'xdg') } }), path.join(FD_TMP, 'xdg', 'opencode', 'log', 'opencode.log'))
        let saved = process.env.XDG_DATA_HOME
        delete process.env.XDG_DATA_HOME
        try {
            assert.strict.deepEqual(getOpencodeLogPath({}), path.join(os.homedir(), '.local', 'share', 'opencode', 'log', 'opencode.log'))
            process.env.XDG_DATA_HOME = path.join(FD_TMP, 'pxdg')
            assert.strict.deepEqual(getOpencodeLogPath({ env: {} }), path.join(FD_TMP, 'pxdg', 'opencode', 'log', 'opencode.log'))
        }
        finally {
            if (saved === undefined) {
                delete process.env.XDG_DATA_HOME
            }
            else {
                process.env.XDG_DATA_HOME = saved
            }
        }
    })

    it('pickUpstream: 只取時窗內且providerID／modelID皆相符之ERROR行; 不相符、時窗外、非ERROR、無原因皆略(R: ±60秒)', function() {
        let lines = [
            line(T - 5000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="AI_APICallError: Upstream request failed: [overloaded]"'),
            line(T - 5000, 'providerID=opencode-go modelID=other-model agent=build error.error="WRONG-MODEL"'),
            line(T - 5000, 'providerID=opencode modelID=deepseek-v4-pro agent=build error.error="WRONG-PROVIDER"'),
            line(T - 10 * 60000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="TOO-OLD"'),
            line(T + 10 * 60000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="TOO-NEW"'),
            `timestamp=${iso(T)} level=INFO providerID=opencode-go modelID=deepseek-v4-pro error.error="NOT-ERROR-LEVEL"`,
            line(T, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build'),
        ]
        let p = pickUpstream(lines, q)
        assert.strict.deepEqual(p.text, 'AI_APICallError: Upstream request failed: [overloaded]')
        assert.strict.deepEqual(pickUpstream(lines.slice(1), q), null)
    })

    it('pickUpstream: 多筆相符時優先agent非title者, 其次時戳最晚者; 行序不必有序; 引號內跳脫還原; 無error.error退用error與非通稱message', function() {
        let lines = [
            line(T - 1000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=title error.error="TITLE-NEWER"'),
            line(T - 4000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="BUILD-OLDER"'),
            line(T - 3000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="BUILD-NEWER with \\"quote\\""'),
        ]
        assert.strict.deepEqual(pickUpstream(lines, q).text, 'BUILD-NEWER with "quote"')
        assert.strict.deepEqual(pickUpstream([lines[0]], q).text, 'TITLE-NEWER')
        let l2 = [line(T, 'providerID=opencode-go modelID=deepseek-v4-pro error="legacy form"')]
        assert.strict.deepEqual(pickUpstream(l2, q).text, 'legacy form')
        let l3 = [`timestamp=${iso(T)} level=ERROR providerID=opencode-go modelID=deepseek-v4-pro message="provider auth failed"`]
        assert.strict.deepEqual(pickUpstream(l3, q).text, 'provider auth failed')
    })

    it('readOpencodeUpstream: 讀日誌檔尾、時窗內相符者回{ upstream, class }; 內容遮罩並折為單行(R: 擷取內容同樣過遮罩)', async function() {
        let f = path.join(FD_TMP, 'a.log')
        fs.writeFileSync(f, [
            line(T - 90 * 1000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="OLD-OUT-OF-WINDOW"'),
            line(T - 2000, 'providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="AI_APICallError: Upstream request failed: [prefill_cap_refused] key sk-test-LOGKEY1234567890abcd\\nsecond line"'),
            line(T - 2000, 'providerID=zzz modelID=deepseek-v4-pro agent=build error.error="NOT-MINE"'),
        ].join('\n'))
        let r = await readOpencodeUpstream({ model: 'opencode-go/deepseek-v4-pro', tFailMs: T, durationMs: 1500, file: f, secrets: [] })
        assert.strict.deepEqual(r.class, 'prefill_cap_refused')
        assert.strict.deepEqual(r.upstream.includes('LOGKEY'), false)
        assert.strict.deepEqual(r.upstream.includes('\n'), false)
        assert.strict.deepEqual(r.upstream.includes('NOT-MINE') || r.upstream.includes('OLD-OUT'), false)
        assert.strict.deepEqual(r.file, f)
    })

    it('readOpencodeUpstream: 失敗耗時超過60秒者(逾時)下界延至該次嘗試起點, 發生於起點後之原因行仍取得; 更早者不取', async function() {
        let f = path.join(FD_TMP, 'slow.log')
        fs.writeFileSync(f, [
            line(T - 290 * 1000, 'providerID=opencode agent=build modelID=beam-free error.error="Free usage limit reached. subscribe"'),
            line(T - 400 * 1000, 'providerID=opencode agent=build modelID=beam-free error.error="BEFORE-ATTEMPT"'),
        ].join('\n'))
        let r = await readOpencodeUpstream({ model: 'opencode/beam-free', tFailMs: T, durationMs: 300 * 1000, file: f })
        assert.strict.deepEqual([r.class, r.upstream.startsWith('Free usage limit')], ['Free usage limit', true])
        let short = await readOpencodeUpstream({ model: 'opencode/beam-free', tFailMs: T, durationMs: 1000, file: f })
        assert.strict.deepEqual(short, null)
    })

    it('readOpencodeUpstream: 時窗為失敗時刻前後各60秒(短失敗): +30秒與-50秒內取得, +90秒與-90秒外不取', async function() {
        let at = async (offsetMs, name) => {
            let f = path.join(FD_TMP, `edge-${name}.log`)
            fs.writeFileSync(f, line(T + offsetMs, 'providerID=a modelID=b agent=build error.error="edge-hit"'))
            return readOpencodeUpstream({ model: 'a/b', tFailMs: T, durationMs: 1000, file: f })
        }
        let r = [await at(30000, 'p30'), await at(-50000, 'm50'), await at(90000, 'p90'), await at(-90000, 'm90')].map((x) => (x === null ? null : x.upstream))
        assert.strict.deepEqual(r, ['edge-hit', 'edge-hit', null, null])
    })

    it('readOpencodeUpstream: 檔案不存在、路徑為資料夾、model無provider前綴、model非字串 → null, 不拋錯', async function() {
        let base = { tFailMs: T, durationMs: 1000 }
        assert.strict.deepEqual(await readOpencodeUpstream({ ...base, model: 'a/b', file: path.join(FD_TMP, 'nope.log') }), null)
        assert.strict.deepEqual(await readOpencodeUpstream({ ...base, model: 'a/b', file: FD_TMP }), null)
        let f = path.join(FD_TMP, 'b.log')
        fs.writeFileSync(f, line(T, 'providerID=a modelID=b error.error="x"'))
        for (let m of ['b', '/b', 'a/', '', null, undefined, 5]) {
            assert.strict.deepEqual(await readOpencodeUpstream({ ...base, model: m, file: f }), null, String(m))
        }
        assert.strict.deepEqual((await readOpencodeUpstream({ ...base, model: 'a/b', file: f })).upstream, 'x')
        assert.strict.deepEqual(await readOpencodeUpstream(null), null)
    })

    it('readOpencodeUpstream: 預設路徑找不到opencode.log時退用同資料夾最新之*.log; 呼叫端明給路徑者不退用', async function() {
        let xdg = path.join(FD_TMP, 'xdg2')
        let dir = path.join(xdg, 'opencode', 'log')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, '2026-11-05T080000.log'), line(T, 'providerID=a modelID=b error.error="from-timestamped-file"'))
        let r = await readOpencodeUpstream({ model: 'a/b', tFailMs: T, durationMs: 1000, env: { XDG_DATA_HOME: xdg } })
        assert.strict.deepEqual(r.upstream, 'from-timestamped-file')
        let r2 = await readOpencodeUpstream({ model: 'a/b', tFailMs: T, durationMs: 1000, file: path.join(dir, 'missing.log') })
        assert.strict.deepEqual(r2, null)
    })

    it('readOpencodeUpstream: 大檔只讀尾端2MiB(開頭不完整行丟棄), 尾端之相符行仍取得', async function() {
        let f = path.join(FD_TMP, 'big.log')
        let filler = `${line(T - 3 * 3600 * 1000, 'providerID=x modelID=y error.error="' + 'f'.repeat(200) + '"')}\n`
        let n = Math.ceil((2 * 1024 * 1024 + 4096) / filler.length)
        fs.writeFileSync(f, filler.repeat(n) + line(T - 1000, 'providerID=a modelID=b agent=build error.error="tail-hit"') + '\n')
        let r = await readOpencodeUpstream({ model: 'a/b', tFailMs: T, durationMs: 1000, file: f })
        assert.strict.deepEqual(r.upstream, 'tail-hit')
    })
})


describe('不改變既有分類(da110 主控已定4: 以新增資訊為輸入時不得改變既有分類結果)', function() {

    it('getErrorType: error文字加了尾段(尾段含ENOENT／ENAMETOOLONG)仍歸exec／timeout, 不因尾段被誤判為spawn', function() {
        assert.strict.deepEqual(getErrorType({ ok: false, code: 1, pid: 12, error: 'Exit code 1: Error: ENOENT: no such file or directory' }), 'exec')
        assert.strict.deepEqual(getErrorType({ ok: false, code: 1, pid: 12, error: 'Exit code 1 [overloaded]: ENAMETOOLONG in log' }), 'exec')
        assert.strict.deepEqual(getErrorType({ ok: false, code: null, pid: 12, error: 'TIMEOUT after 5s: ENOENT' }), 'timeout')

        //既有行為不變: 不帶pid鍵之非execCli結果以字樣判spawn; 真正未能啟動仍spawn
        assert.strict.deepEqual(getErrorType({ error: 'spawn cli ENOENT' }), 'spawn')
        assert.strict.deepEqual(getErrorType({ ok: false, code: null, pid: undefined, error: 'ENOENT: spawn x ENOENT' }), 'spawn')
    })

    it('learnQuotaFromFailure(claude額度字樣): 只在error尾段出現的額度字樣不當額度證據(error尾段是新增資訊); 字樣在stdout／stderr欄位或非原生形狀之error時行為不變', function() {
        let TEXT = 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)'
        let mk = () => resolveSubQuotaGate({ readers: { claude: () => ({ ok: true, windows: [] }) }, state: createQuotaGateState(), now: () => Date.parse('2026-11-08T00:00:00.000Z') }, { kind: 'claude', model: 'sonnet' }, 0, 'claude:sonnet', true)
        let learn = (r) => learnQuotaFromFailure(mk(), {}, () => {}, r, null)

        //新增資訊(原生形狀error的尾段)不入判定
        assert.strict.deepEqual(learn({ ok: false, error: `Exit code 1: ${TEXT}`, stdout: '', stderr: '' }), null)
        assert.strict.deepEqual(learn({ ok: false, error: `Exit code 1 [x]: ${TEXT}`, stdout: 'nothing', stderr: 'nothing' }), null)

        //既有欄位照舊
        assert.strict.deepEqual(learn({ ok: false, error: 'Exit code 1', stdout: TEXT, stderr: '' }).until, '2026-11-09T09:00:00.000Z')
        assert.strict.deepEqual(learn({ ok: false, error: 'Exit code 1', stdout: '', stderr: TEXT }).until, '2026-11-09T09:00:00.000Z')
        assert.strict.deepEqual(learn({ ok: false, error: `x ${TEXT} y` }).until, '2026-11-09T09:00:00.000Z')
        assert.strict.deepEqual(learn({ ok: false, error: `Exit code 1: ${TEXT}`, stdout: TEXT }).until, '2026-11-09T09:00:00.000Z')
    })
})
