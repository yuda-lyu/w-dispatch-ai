import assert from 'assert'
import { FAILURE_KINDS, classifyRestFailure, classifyCliFailure, classifyFetchError, collectCliEvidence, parseJsonLines } from '../src/failureKind.mjs'


// unit-failureKind.test.mjs — failureKind細分類(REST與CLI)之判定規則
//
// 規格來源(2026-10-25查證, 完整引用見src/failureKind.mjs檔頭):
//   REST: platform.claude.com/docs/en/api/errors(400/401/402/403/413/429/504/529與error.type)、
//         .../api/rate-limits(自設花費上限=400「You have reached your specified (workspace) API usage limits」;
//         用量級別月花費上限=429, 無retry-after, error.details.error_code為enforced_spend_limit_reached)、
//         .../build-with-claude/context-windows(輸入超過視窗=400 invalid_request_error「prompt is too long」);
//         「Your credit balance is too low…」為第三方回報之400訊息(官方errors頁未逐字載明)
//   CLI: code.claude.com/docs/en/agent-sdk/typescript(SDKAssistantMessage.error列舉、SDKResultMessage.api_error_status)、
//        Claude Code 2.1.302 claude.exe內嵌字串(「Credit balance is too low」「Prompt is too long」「Invalid API key」「Unable to connect to API」…)
// 全部為純函數測試, 不發任何請求。


describe('failureKind 一覽', function() {

    it('FAILURE_KINDS恰為九種(含CLI專屬之env-error)', function() {
        let r = FAILURE_KINDS
        let rr = ['no-credit', 'context-too-long', 'rate-limit', 'overloaded', 'key-invalid', 'no-permission', 'network', 'env-error', 'other']
        assert.strict.deepEqual(r, rr)
    })

})


describe('classifyRestFailure (REST: HTTP狀態碼、error.type、訊息)', function() {

    //spec(errors頁): 400 invalid_request_error; 402 billing_error; 401 authentication_error; 403 permission_error;
    //  413 request_too_large; 429 rate_limit_error; 504 timeout_error; 529 overloaded_error; 500 api_error; 404 not_found_error
    let cases = [
        //沒額度
        ['402 billing_error', { status: 402, apiErrorType: 'billing_error', message: 'There is an issue with your billing information' }, 'no-credit'],
        ['billing_error無狀態碼', { apiErrorType: 'billing_error' }, 'no-credit'],
        ['400 額度不足訊息(第三方回報)', { status: 400, apiErrorType: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' }, 'no-credit'],
        ['額度不足訊息大小寫不拘', { status: 400, apiErrorType: 'invalid_request_error', message: 'YOUR CREDIT BALANCE IS TOO LOW' }, 'no-credit'],
        ['400 自設花費上限(官方訊息開頭)', { status: 400, apiErrorType: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' }, 'no-credit'],
        ['400 工作區花費上限(官方訊息開頭)', { status: 400, apiErrorType: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' }, 'no-credit'],
        ['429 用量級別月花費上限(error_code)', { status: 429, apiErrorType: 'rate_limit_error', message: 'x', errorCode: 'enforced_spend_limit_reached' }, 'no-credit'],
        ['429 用量級別月花費上限(訊息)', { status: 429, apiErrorType: 'rate_limit_error', message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold' }, 'no-credit'],
        //脈絡過長
        ['400 prompt is too long', { status: 400, apiErrorType: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' }, 'context-too-long'],
        ['prompt is too long大小寫不拘', { status: 400, apiErrorType: 'invalid_request_error', message: 'Prompt is too long' }, 'context-too-long'],
        ['413 request_too_large', { status: 413, apiErrorType: 'request_too_large', message: 'Request exceeds the maximum allowed number of bytes.' }, 'context-too-long'],
        ['413 閘道HTML(無error.type)', { status: 413, apiErrorType: '', message: '' }, 'context-too-long'],
        //限流(一般429)
        ['429 rate_limit_error', { status: 429, apiErrorType: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' }, 'rate-limit'],
        ['rate_limit_error無狀態碼', { apiErrorType: 'rate_limit_error' }, 'rate-limit'],
        //過載
        ['529 overloaded_error', { status: 529, apiErrorType: 'overloaded_error', message: 'Overloaded' }, 'overloaded'],
        //金鑰無效／無權限
        ['401 authentication_error', { status: 401, apiErrorType: 'authentication_error', message: 'invalid x-api-key' }, 'key-invalid'],
        ['401閘道HTML', { status: 401 }, 'key-invalid'],
        ['403 permission_error', { status: 403, apiErrorType: 'permission_error', message: 'Your API key does not have permission to use the specified resource.' }, 'no-permission'],
        //網路類(504為逾時)
        ['504 timeout_error', { status: 504, apiErrorType: 'timeout_error', message: 'The request timed out while processing' }, 'network'],
        //其他: 一般400、404、500、未知
        ['400 一般參數錯誤', { status: 400, apiErrorType: 'invalid_request_error', message: 'messages: roles must alternate between "user" and "assistant"' }, 'other'],
        ['404 not_found_error', { status: 404, apiErrorType: 'not_found_error', message: 'model: x' }, 'other'],
        ['500 api_error', { status: 500, apiErrorType: 'api_error', message: 'Internal server error' }, 'other'],
        ['502閘道', { status: 502 }, 'other'],
        ['空證據', {}, 'other'],
        ['非物件證據', null, 'other'],
    ]
    for (let [name, input, want] of cases) {
        it(`${name} → ${want}`, function() {
            assert.strict.equal(classifyRestFailure(input), want)
        })
    }

    it('額度字樣先於狀態碼: 400與429皆可為額度類(不被誤判為參數錯誤或一般限流)', function() {
        let r = [
            classifyRestFailure({ status: 429, apiErrorType: 'rate_limit_error', message: 'Your credit balance is too low' }),
            classifyRestFailure({ status: 400, apiErrorType: 'invalid_request_error', message: 'Your credit balance is too low' }),
        ]
        assert.strict.deepEqual(r, ['no-credit', 'no-credit'])
    })

    it('脈絡過長與額度同時出現時額度優先(沒額度才是金鑰層級事實)', function() {
        let r = classifyRestFailure({ status: 400, apiErrorType: 'invalid_request_error', message: 'Your credit balance is too low; prompt is too long' })
        assert.strict.equal(r, 'no-credit')
    })

    it('狀態碼為字串數字亦可判讀', function() {
        assert.strict.equal(classifyRestFailure({ status: '529' }), 'overloaded')
    })

})


describe('classifyFetchError (fetch例外: 發生於收到回應之前)', function() {

    //外審#7: 非法金鑰(標頭值含換行)曾被歸為網路故障致整組跳過、有效金鑰永遠不試
    it('有cause.code(連線拒絕、DNS、重設、逾時、無效網址…)→ network', function() {
        let r = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ERR_INVALID_URL'].map((code) => {
            let e = new TypeError('fetch failed')
            e.cause = { code }
            return classifyFetchError(e)
        })
        assert.strict.deepEqual(r, ['network', 'network', 'network', 'network', 'network'])
    })

    it('標頭值非法(無cause.code，金鑰含換行等) → key-invalid(屬金鑰層，須換把)', function() {
        let r = [
            new TypeError('Headers.append: "bad\nkey" is an invalid header value'),
            new TypeError('Invalid character in header content ["x-api-key"]'),
            new TypeError('invalid header name'),
        ].map(classifyFetchError)
        assert.strict.deepEqual(r, ['key-invalid', 'key-invalid', 'key-invalid'])
    })

    it('無法判定(一般Error、非Error值、讀取拋錯之物件)→ other(維持既有處置，不憑空歸為網路故障)', function() {
        let thrower = {
            get message() {
                throw new Error('boom')
            },
            get cause() {
                throw new Error('boom')
            },
        }
        let r = [new Error('network down'), 'string error', null, undefined, 42, thrower].map(classifyFetchError)
        assert.strict.deepEqual(r, ['other', 'other', 'other', 'other', 'other', 'other'])
    })

})


describe('parseJsonLines／collectCliEvidence', function() {

    it('只取以{開頭且可解析為物件之行', function() {
        let r = parseJsonLines('not json\n{"a":1}\n  {"b":2}  \n{bad\n[1,2]\n')
        assert.strict.deepEqual(r, [{ a: 1 }, { b: 2 }])
    })

    it('stream-json: 取is_error之result(含api_error_status、errors)與帶error欄位之assistant事件(列舉值與文字區塊)', function() {
        let out = [
            JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' }),
            JSON.stringify({ type: 'assistant', error: 'billing_error', message: { content: [{ type: 'text', text: 'Credit balance is too low' }] } }),
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '正常回覆不應被收集' }] } }),
            JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'Credit balance is too low' }),
        ].join('\n')
        let r = collectCliEvidence(out, '')
        assert.strict.deepEqual(r, { status: 400, assistantErrors: ['billing_error'], texts: ['Credit balance is too low', 'Credit balance is too low'], structured: true })
    })

    it('純文字: stdout末行以錯誤訊息開頭且夠短才採信，過長(模型輸出)不收集；stdout有證據時不混入stderr，無證據時取stderr末三行', function() {
        let short = collectCliEvidence('Prompt is too long', 'warn: x')
        let long = collectCliEvidence('x'.repeat(1001) + ' prompt is too long', '')
        let errOnly = collectCliEvidence('', 'a\nb\nc\nd\n')
        assert.strict.deepEqual([short.texts, long.texts, short.structured, errOnly.texts], [['Prompt is too long'], [], false, ['b', 'c', 'd']])
    })

})


describe('classifyCliFailure (CLI: stream-json結構化證據與失敗文字)', function() {

    let fail = (patch) => ({ ok: false, code: 1, error: 'Exit code 1', errorType: 'exec', stdout: '', stderr: '', ...patch })

    //純文字模式(內建claude-api:條目所用: 不加--output-format)
    let textCases = [
        ['Credit balance is too low(主控2026-10-25於2.1.302實測之字樣)', { stdout: 'Credit balance is too low' }, 'no-credit'],
        ['沒額度字樣在stderr', { stderr: 'Credit balance is too low' }, 'no-credit'],
        ['Prompt is too long', { stdout: 'Prompt is too long' }, 'context-too-long'],
        ['Request too large', { stdout: 'Request too large (max 32MB). Try with a smaller file.' }, 'context-too-long'],
        ['Invalid API key', { stdout: 'Invalid API key · Please run /login' }, 'key-invalid'],
        ['API Error: 401', { stdout: 'API Error: 401 Invalid API key' }, 'key-invalid'],
        ['API Error: 403', { stdout: 'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"x"}}' }, 'no-permission'],
        ['API Error: 429', { stdout: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"x"}}' }, 'rate-limit'],
        ['Server is temporarily limiting requests', { stdout: 'Server is temporarily limiting requests (not your usage limit) · Rate limited' }, 'rate-limit'],
        ['Repeated 529 Overloaded errors', { stdout: 'Repeated 529 Overloaded errors' }, 'overloaded'],
        ['API Error: 529', { stdout: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }, 'overloaded'],
        ['Unable to connect to API', { stdout: 'Unable to connect to API (ECONNREFUSED)' }, 'network'],
        ['Request timed out', { stdout: 'Request timed out' }, 'network'],
        ['未識別字樣', { stdout: 'something unexpected happened' }, 'other'],
        ['空輸出', { stdout: '', stderr: '' }, 'other'],
    ]
    for (let [name, patch, want] of textCases) {
        it(`純文字: ${name} → ${want}`, function() {
            assert.strict.equal(classifyCliFailure(fail(patch)).kind, want)
        })
    }

    //stream-json: assistant.error列舉(官方12值之對映)
    let assistantCases = [
        ['billing_error', 'no-credit'],
        ['authentication_failed', 'key-invalid'],
        ['oauth_org_not_allowed', 'no-permission'],
        ['account_on_hold', 'no-permission'],
        ['rate_limit', 'rate-limit'],
        ['overloaded', 'overloaded'],
        ['invalid_request', 'other'], //本身只是一般400, 需文字才能細分
        ['model_not_found', 'other'],
        ['server_error', 'other'],
        ['max_output_tokens', 'other'],
        ['cloud_credential_error', 'other'],
        ['unknown', 'other'],
    ]
    for (let [ae, want] of assistantCases) {
        it(`stream-json assistant.error=${ae} → ${want}`, function() {
            let out = [
                JSON.stringify({ type: 'assistant', error: ae, message: { content: [{ type: 'text', text: 'opaque text' }] } }),
                JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'opaque text' }),
            ].join('\n')
            let r = classifyCliFailure(fail({ stdout: out }))
            assert.strict.equal(r.kind, want)
        })
    }

    it('stream-json: invalid_request搭「Prompt is too long」文字 → 脈絡過長', function() {
        let out = [
            JSON.stringify({ type: 'assistant', error: 'invalid_request', message: { content: [{ type: 'text', text: 'Prompt is too long' }] } }),
            JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 400, result: 'Prompt is too long' }),
        ].join('\n')
        assert.strict.equal(classifyCliFailure(fail({ stdout: out })).kind, 'context-too-long')
    })

    it('stream-json: result.api_error_status優先換算(429→限流、529→過載、401→金鑰無效、403→無權限、402→沒額度、413→脈絡過長)', function() {
        let r = [429, 529, 401, 403, 402, 413].map((st) => classifyCliFailure(fail({ stdout: JSON.stringify({ type: 'result', is_error: true, api_error_status: st, result: 'opaque' }) })).kind)
        assert.strict.deepEqual(r, ['rate-limit', 'overloaded', 'key-invalid', 'no-permission', 'no-credit', 'context-too-long'])
    })

    it('stream-json: 429且訊息為花費上限 → 沒額度(不是一般限流)', function() {
        let out = JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold' })
        assert.strict.equal(classifyCliFailure(fail({ stdout: out })).kind, 'no-credit')
    })

    it('execCli失敗時stdout只留前500字元: 以完整尾段(opt.stdout)分類，result事件在尾端', function() {
        let init = JSON.stringify({ type: 'system', subtype: 'init', tools: 'x'.repeat(5000) })
        let result = JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' })
        let truncated = (init + '\n' + result).slice(0, 500) + '...(truncated, total 5100 chars)'
        let without = classifyCliFailure(fail({ stdout: truncated }))
        let withTail = classifyCliFailure(fail({ stdout: truncated }), { stdout: init + '\n' + result })
        assert.strict.deepEqual([without.kind, withTail.kind], ['other', 'no-credit'])
    })

    it('逾時(TIMEOUT)→ network', function() {
        let r = classifyCliFailure({ ok: false, code: null, error: 'TIMEOUT after 300s', errorType: 'timeout', stdout: 'Credit balance is too low', stderr: '' })
        assert.strict.equal(r.kind, 'network')
    })

    it('與API錯誤無關者(spawn、params、驗證失敗)一律other，即使stdout含額度字樣(那是模型輸出)', function() {
        let r = [
            classifyCliFailure({ ok: false, code: null, pid: undefined, error: 'ENOENT: spawn claude ENOENT', errorType: 'spawn', stdout: '', stderr: '' }).kind,
            classifyCliFailure({ ok: false, code: null, error: 'env is not readable', errorType: 'params', stdout: '', stderr: '' }).kind,
            classifyCliFailure({ ok: false, code: 0, error: 'OUTPUT_VALIDATION_FAILED', errorType: 'validation', stdout: 'Credit balance is too low', stderr: '' }).kind,
        ]
        assert.strict.deepEqual(r, ['other', 'other', 'other'])
    })

    it('輸出未過驗證之防禦: 即使離開碼非零，errorType為validation或error為OUTPUT_VALIDATION_FAILED者仍為other(stdout是模型輸出)', function() {
        let r = [
            classifyCliFailure({ ok: false, code: 1, error: 'Exit code 1', errorType: 'validation', stdout: 'Credit balance is too low', stderr: '' }).kind,
            classifyCliFailure({ ok: false, code: 1, error: 'OUTPUT_VALIDATION_FAILED', errorType: 'exec', stdout: 'Credit balance is too low', stderr: '' }).kind,
        ]
        assert.strict.deepEqual(r, ['other', 'other'])
    })

    it('離開碼為null(訊號結束)或0者不分類(other)', function() {
        let r = [
            classifyCliFailure({ ok: false, code: null, error: 'Signal: SIGKILL', errorType: 'exec', stdout: 'Credit balance is too low', stderr: '' }).kind,
            classifyCliFailure({ ok: false, code: 0, error: 'x', errorType: 'exec', stdout: 'Credit balance is too low', stderr: '' }).kind,
        ]
        assert.strict.deepEqual(r, ['other', 'other'])
    })

    //外審#4: 以長度認定失敗文字、對全文搜尋關鍵字，會把「提到關鍵字的短模型回答」誤當API錯誤
    it('純文字stdout須以Claude Code錯誤訊息開頭才採信: 短模型回答中提到關鍵字(離開碼非零)不當API錯誤', function() {
        let r = [
            'The phrase "Prompt is too long" means the input exceeds the context window.',
            'Here is the doc: Credit balance is too low is shown when funds run out.',
            '回覆：API Error: 429 代表限流',
            'Note that Invalid API key can be caused by a revoked key',
        ].map((s) => classifyCliFailure(fail({ stdout: s })).kind)
        assert.strict.deepEqual(r, ['other', 'other', 'other', 'other'])
    })

    it('純文字stdout以Claude Code錯誤訊息開頭者照常分類(含尾端換行與CRLF)', function() {
        let r = ['Credit balance is too low\n', 'Prompt is too long\r\n', 'API Error: 529 overloaded_error\n'].map((s) => classifyCliFailure(fail({ stdout: s })).kind)
        assert.strict.deepEqual(r, ['no-credit', 'context-too-long', 'overloaded'])
    })

    //外審#5: execCli依maxRetries重試時多次嘗試之輸出累積在同一份stdout，只有最後一次嘗試決定最終分類
    it('多次嘗試(maxRetries)累積之輸出只看最後一次嘗試: 純文字取末行', function() {
        let r = [
            classifyCliFailure(fail({ stdout: 'API Error: 429 rate_limit_error\nUnable to connect to API (ECONNREFUSED)\n' })).kind,
            classifyCliFailure(fail({ stdout: 'Unable to connect to API (ECONNREFUSED)\nCredit balance is too low\n' })).kind,
        ]
        assert.strict.deepEqual(r, ['network', 'no-credit'])
    })

    it('多次嘗試之stream-json輸出只看最後一次init之後的事件', function() {
        let attempt1 = [
            JSON.stringify({ type: 'system', subtype: 'init' }),
            JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: 'API Error: 429' }] } }),
            JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: 'API Error: 429' }),
        ]
        let attempt2 = [
            JSON.stringify({ type: 'system', subtype: 'init' }),
            JSON.stringify({ type: 'result', is_error: true, result: 'Unable to connect to API (ECONNREFUSED)' }),
        ]
        let r = [
            classifyCliFailure(fail({ stdout: [...attempt1, ...attempt2].join('\n') })).kind,
            classifyCliFailure(fail({ stdout: [...attempt2, ...attempt1].join('\n') })).kind,
        ]
        assert.strict.deepEqual(r, ['network', 'rate-limit'])
    })

    //外審二#1: 結構化證據(HTTP狀態、assistant.error)即使沒有文字，stderr也不得以較高優先序之字樣蓋過它
    it('stream-json有api_error_status或assistant.error(無文字)時，stderr含衝突字樣不得蓋過', function() {
        let byStatus = JSON.stringify({ type: 'result', is_error: true, api_error_status: 429 })
        let byAssistant = JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [] } })
        let r = [
            classifyCliFailure(fail({ stdout: byStatus, stderr: 'warning: previous request said Prompt is too long' })).kind,
            classifyCliFailure(fail({ stdout: byAssistant, stderr: 'Credit balance is too low' })).kind,
        ]
        assert.strict.deepEqual(r, ['rate-limit', 'rate-limit'])
    })

    it('即使以錯誤訊息開頭，單行超過1000字元者不採信(長文是模型輸出)', function() {
        let r = classifyCliFailure(fail({ stdout: 'Credit balance is too low' + ' x'.repeat(600) }))
        assert.strict.equal(r.kind, 'other')
    })

    it('過長的純文字stdout(模型輸出)不當失敗訊息', function() {
        let r = classifyCliFailure(fail({ stdout: 'a'.repeat(1200) + ' Credit balance is too low' }))
        assert.strict.equal(r.kind, 'other')
    })

    it('detail為命中之失敗文字(≤200字元+省略號)，source標明依據', function() {
        let r1 = classifyCliFailure(fail({ stdout: 'Credit balance is too low' }))
        let r2 = classifyCliFailure(fail({ stdout: JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: 'rate limited' }) }))
        let r3 = classifyCliFailure(fail({ stdout: JSON.stringify({ type: 'assistant', error: 'rate_limit', message: { content: [] } }) }))
        assert.strict.deepEqual([r1, r2.source, r3.source], [{ kind: 'no-credit', detail: 'Credit balance is too low', source: 'text' }, 'api_error_status', 'assistant.error'])
    })

})
