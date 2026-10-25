import http from 'http'
import zlib from 'zlib'


// fakeServerForAnthropicTest.mjs — 測試用的Anthropic Messages API假伺服器
//
// dispatchApiAnthropic之可觀察行為為「送出什麼HTTP請求、如何處理各種回應」, 故起本機http伺服器,
// 依請求之model決定回應, 即可對成功/refusal/max_tokens/各HTTP錯誤/畸形回應逐條斷言, 全程不連外、不發任何Anthropic請求。
//
// 【形狀依據】官方Messages API(platform.claude.com/docs/en/api/errors與claude-api技能, 2026-10-24查證):
//   成功: { id, type:'message', role:'assistant', model, content:[{type:'text'|'thinking'|'tool_use',...}], stop_reason, stop_sequence, usage }
//   錯誤: { type:'error', error:{ type, message }, request_id }, type為invalid_request_error(400)/authentication_error(401)/
//         billing_error(402)/permission_error(403)/not_found_error(404)/request_too_large(413)/rate_limit_error(429)/api_error(500)/overloaded_error(529)
//   refusal: HTTP 200, stop_reason 'refusal', stop_details { type:'refusal', category, explanation }
//
// 【請求把關(模擬真伺服器對缺少必要標頭/欄位之回應, 令「缺anthropic-version」等缺陷在任何成功路徑測試中即現形)】
//   缺x-api-key → 401 authentication_error; x-api-key含'sk-bad' → 401(無效金鑰);
//   缺anthropic-version標頭 → 400 invalid_request_error; 缺max_tokens → 400。
//
// 【行為路由(依body.model)】
//   ok             — 200, text 'hello', end_turn, usage含快取欄位
//   multi-text     — 200, content為[thinking(空字串), text 'AA', text 'BB'], 應串接為'AABB'
//   empty-text     — 200, 單一text區塊為空字串, end_turn
//   thinking-only  — 200, content僅thinking無text, end_turn(結構不合規)
//   stop-sequence  — 200, stop_reason 'stop_sequence'(正常結束)
//   unknown-stop   — 200, stop_reason為未知值(不可誤殺)
//   max-tokens     — 200, 部分文字, stop_reason 'max_tokens'
//   max-tokens-empty — 200, 僅thinking(思考耗盡max_tokens), stop_reason 'max_tokens'
//   refusal        — 200, content空, stop_reason 'refusal'與stop_details
//   refusal-partial — 200, 部分文字且stop_reason 'refusal'
//   tool-use       — 200, stop_reason 'tool_use'
//   pause-turn     — 200, stop_reason 'pause_turn'
//   no-content     — 200但無content
//   not-json / garbage-200 / slow / br-noheader — 同OpenAI相容假伺服器之對應行為
//   err-400 / err-402 / err-403 / err-404 / err-413 / err-429 / err-500 / err-529 — 對應HTTP錯誤與官方error type
//   flaky-429 / flaky-529 — 同一金鑰首次失敗, 之後200(重試路徑)
//   echo-key-error — 400, 錯誤訊息回顯x-api-key(測遮蔽)
//   (2026-10-25 dispatch-run01, failureKind細分類; 形狀依官方errors與rate-limits頁)
//   err-credit-400 — 400 invalid_request_error「Your credit balance is too low to access the Anthropic API…」(第三方回報之額度不足訊息)
//   err-spend-limit-400 / err-spend-limit-ws-400 — 400, 使用者自設花費上限(官方: 訊息開頭「You have reached your specified (workspace) API usage limits」)
//   err-spend-cap-429 — 429 rate_limit_error, 用量級別月花費上限(無retry-after, error.details.error_code為enforced_spend_limit_reached)
//   err-spend-cap-opaque-429 — 429, 訊息為opaque message, 只有error.details.error_code為enforced_spend_limit_reached(隔離錯誤碼接線)
//   err-context-400 — 400 invalid_request_error「prompt is too long: N tokens > M maximum」
//   ok-with-limits — 200, 回應帶anthropic-ratelimit-*標頭
//   by-key         — 依x-api-key內含字樣路由: nocredit→額度不足400、spendcap→月花費上限429(僅error_code)、ratelimited→429、overloaded→529、ctx→脈絡過長400、forbidden→403、gwtimeout→504、否則200(每把金鑰可有不同結果, 供遞補測試)
//   其他           — 404 not_found_error


/**
 * 啟動測試用Anthropic Messages API假伺服器
 *
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含port(埠號)、url(基底網址字串，不含/v1，等同baseURL)、requests(收到之請求紀錄陣列，各項含headers與body)、close(關閉伺服器之async函數)
 */
async function fakeServerForAnthropicTest() {

    let flakyCount = {}
    let sockets = new Set()
    let requests = []

    let server = http.createServer((req, res) => {

        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {

            let send = (code, obj, headers = {}) => {
                res.writeHead(code, { 'Content-Type': 'application/json', ...headers })
                res.end(JSON.stringify(obj))
            }
            let err = (code, type, message, headers = {}) => send(code, { type: 'error', error: { type, message }, request_id: 'req_fake' }, headers)

            if (req.method !== 'POST' || req.url !== '/v1/messages') {
                err(404, 'not_found_error', 'The requested resource could not be found.')
                return
            }

            let key = req.headers['x-api-key'] || ''
            let rawBody = Buffer.concat(chunks).toString('utf8')
            let body = null
            try {
                body = JSON.parse(rawBody)
            }
            catch {
                requests.push({ headers: req.headers, body: null, rawBody })
                err(400, 'invalid_request_error', 'Could not parse JSON body')
                return
            }
            requests.push({ headers: req.headers, body, rawBody })

            //把關
            if (key === '') {
                err(401, 'authentication_error', 'x-api-key header is required')
                return
            }
            if (key.includes('sk-bad')) {
                err(401, 'authentication_error', 'invalid x-api-key')
                return
            }
            if (!req.headers['anthropic-version']) {
                err(400, 'invalid_request_error', 'anthropic-version: header is required')
                return
            }
            if (body.max_tokens === undefined) {
                err(400, 'invalid_request_error', 'max_tokens: Field required')
                return
            }

            let model = body.model || ''
            let usage = { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
            let msg = (content, stop_reason = 'end_turn', extra = {}) => send(200, {
                id: 'msg_fake',
                type: 'message',
                role: 'assistant',
                model,
                content,
                stop_reason,
                stop_sequence: null,
                usage,
                ...extra,
            })
            let thinking = { type: 'thinking', thinking: '', signature: 'EqQBCkYIAxgCIkD-fake' } //display預設omitted: 空字串+signature

            //br-noheader, 客戶端明示identity才回原文, 否則回brotli本體且刻意不帶Content-Encoding
            let ae = String(req.headers['accept-encoding'] || '').trim().toLowerCase()

            if (model === 'ok' || /^claude-(opus|sonnet|haiku)-5-5$/.test(model)) { //後者供內建條目(真實模型ID)之整合測試與主控實測腳本之離線乾跑
                msg([thinking, { type: 'text', text: 'hello' }])
            }
            else if (model === 'multi-text') {
                msg([thinking, { type: 'text', text: 'AA' }, { type: 'text', text: 'BB' }])
            }
            else if (model === 'empty-text') {
                msg([{ type: 'text', text: '' }])
            }
            else if (model === 'thinking-only') {
                msg([thinking])
            }
            else if (model === 'stop-sequence') {
                msg([{ type: 'text', text: 'done' }], 'stop_sequence')
            }
            else if (model === 'unknown-stop') {
                msg([{ type: 'text', text: 'done' }], 'future_reason')
            }
            else if (model === 'max-tokens') {
                msg([thinking, { type: 'text', text: '[{"a":1},{"b":' }], 'max_tokens')
            }
            else if (model === 'max-tokens-empty') {
                msg([thinking], 'max_tokens')
            }
            else if (model === 'refusal') {
                msg([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined by safety classifier' } })
            }
            else if (model === 'refusal-partial') {
                msg([{ type: 'text', text: 'I can start with' }], 'refusal', { stop_details: { type: 'refusal', category: 'bio', explanation: 'x' } })
            }
            else if (model === 'echo-text') { //成功回覆回顯收到的x-api-key(測成功路徑之精確遮蔽)
                msg([{ type: 'text', text: `echo ${key}` }])
            }
            else if (model === 'echo-text-max') { //max_tokens截斷之回覆回顯x-api-key(測acceptTruncated放行路徑之精確遮蔽)
                msg([{ type: 'text', text: `echo ${key}` }], 'max_tokens')
            }
            else if (model === 'text-with-example-key') { //成功回覆含合法之sk-ant-範例字樣(非本次key), 不得被樣式遮蔽破壞
                msg([{ type: 'text', text: 'set ANTHROPIC_KEYS=sk-ant-api03-DOC-EXAMPLE-0000 in your .env' }])
            }
            else if (model === 'nonjson-ct-key') { //HTTP 200非JSON, 且回應Content-Type標頭參數夾帶x-api-key
                res.writeHead(200, { 'Content-Type': `text/plain; debug-key=${key}` })
                res.end('oops')
            }
            else if (model === 'err-foreign-key') { //錯誤訊息夾帶「不在本次請求標頭中」之他把金鑰(須靠sk-ant-樣式遮蔽)
                err(400, 'invalid_request_error', 'bad request, see sk-ant-api03-FOREIGN-9999-zzzz for details')
            }
            else if (model === 'refusal-foreign') { //refusal之category與explanation夾帶他把金鑰
                msg([], 'refusal', { stop_details: { type: 'refusal', category: 'sk-ant-api03-FOREIGN-9999-zzzz', explanation: 'detail sk-ant-api03-FOREIGN-8888-yyyy' } })
            }
            else if (model === 'err-504') {
                err(504, 'timeout_error', 'The request timed out while processing')
            }
            else if (model === 'err-credit-400') {
                err(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
            }
            else if (model === 'err-spend-limit-400') {
                err(400, 'invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.')
            }
            else if (model === 'err-spend-limit-ws-400') {
                err(400, 'invalid_request_error', 'You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.')
            }
            else if (model === 'err-spend-cap-429') {
                send(429, { type: 'error', error: { type: 'rate_limit_error', message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier. You will regain access on 2026-11-01 at 00:00 UTC.', details: { error_code: 'enforced_spend_limit_reached' } }, request_id: 'req_fake' })
            }
            else if (model === 'err-spend-cap-opaque-429') { //訊息不含任何已知字樣, 只靠error.details.error_code(隔離錯誤碼接線)
                send(429, { type: 'error', error: { type: 'rate_limit_error', message: 'opaque message', details: { error_code: 'enforced_spend_limit_reached' } }, request_id: 'req_fake' })
            }
            else if (model === 'err-context-400') {
                err(400, 'invalid_request_error', 'prompt is too long: 250000 tokens > 200000 maximum')
            }
            else if (model === 'ok-with-limits') {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'anthropic-ratelimit-requests-limit': '1000',
                    'anthropic-ratelimit-requests-remaining': '999',
                    'anthropic-ratelimit-requests-reset': '2026-10-25T12:00:00Z',
                    'anthropic-ratelimit-input-tokens-limit': '2000000',
                    'anthropic-ratelimit-input-tokens-remaining': '1999000',
                    'anthropic-ratelimit-input-tokens-reset': '2026-10-25T12:00:00Z',
                    'anthropic-ratelimit-output-tokens-limit': '400000',
                    'anthropic-ratelimit-output-tokens-remaining': '399000',
                    'anthropic-ratelimit-output-tokens-reset': '2026-10-25T12:00:00Z',
                })
                res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'h' }], stop_reason: 'max_tokens', stop_sequence: null, usage }))
            }
            else if (model === 'by-key') {
                if (key.includes('nocredit')) {
                    err(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
                }
                else if (key.includes('spendcap')) {
                    send(429, { type: 'error', error: { type: 'rate_limit_error', message: 'opaque message', details: { error_code: 'enforced_spend_limit_reached' } }, request_id: 'req_fake' })
                }
                else if (key.includes('ratelimited')) {
                    err(429, 'rate_limit_error', 'rate limited', { 'retry-after': '30' })
                }
                else if (key.includes('overloaded')) {
                    err(529, 'overloaded_error', 'Overloaded')
                }
                else if (key.includes('ctx')) {
                    err(400, 'invalid_request_error', 'prompt is too long: 250000 tokens > 200000 maximum')
                }
                else if (key.includes('forbidden')) {
                    err(403, 'permission_error', 'Your API key does not have permission to use the specified resource.')
                }
                else if (key.includes('gwtimeout')) {
                    err(504, 'timeout_error', 'The request timed out while processing')
                }
                else {
                    msg([{ type: 'text', text: `ok ${key.slice(-4)}` }])
                }
            }
            else if (model === 'err-html-401') { //非JSON之401(如閘道HTML錯誤頁): 仍為http分類, apiErrorType為空字串
                res.writeHead(401, { 'Content-Type': 'text/html' })
                res.end('<html><body>unauthorized</body></html>')
            }
            else if (model === 'text-and-tool-use') { //end_turn但content含tool_use區塊
                msg([{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'toolu_2', name: 'get_weather', input: {} }])
            }
            else if (model === 'tool-use') {
                msg([{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Taipei' } }], 'tool_use')
            }
            else if (model === 'pause-turn') {
                msg([{ type: 'text', text: 'working' }], 'pause_turn')
            }
            else if (model === 'no-content') {
                send(200, { id: 'msg_fake', type: 'message', role: 'assistant', model, stop_reason: 'end_turn', usage })
            }
            else if (model === 'not-json') {
                res.writeHead(200, { 'Content-Type': 'text/plain' })
                res.end('plain text body')
            }
            else if (model === 'garbage-200') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(Buffer.from([0x8b, 0xef, 0x02, 0x00, 0xe4, 0xff, 0x11, 0x22]))
            }
            else if (model === 'slow') {
                setTimeout(() => {
                    try {
                        msg([{ type: 'text', text: 'too late' }])
                    }
                    catch {}
                }, 10000)
            }
            else if (model === 'br-noheader') {
                let buf = Buffer.from(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: '完成' }], stop_reason: 'end_turn', stop_sequence: null, usage }))
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(ae === 'identity' ? buf : zlib.brotliCompressSync(buf))
            }
            else if (model === 'err-400') {
                err(400, 'invalid_request_error', 'messages: roles must alternate')
            }
            else if (model === 'err-402') {
                err(402, 'billing_error', 'There is an issue with your billing information')
            }
            else if (model === 'err-403') {
                err(403, 'permission_error', 'Your API key does not have permission to use the specified resource.')
            }
            else if (model === 'err-404') {
                err(404, 'not_found_error', `model: ${model}`)
            }
            else if (model === 'err-413') {
                err(413, 'request_too_large', 'Request exceeds the maximum allowed number of bytes.')
            }
            else if (model === 'err-429') {
                err(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit', { 'retry-after': '30' })
            }
            else if (model === 'err-500') {
                err(500, 'api_error', 'Internal server error')
            }
            else if (model === 'err-529') {
                err(529, 'overloaded_error', 'Overloaded')
            }
            else if (model === 'flaky-429' || model === 'flaky-529') {
                flakyCount[`${model}:${key}`] = (flakyCount[`${model}:${key}`] || 0) + 1
                if (flakyCount[`${model}:${key}`] === 1) {
                    if (model === 'flaky-429') {
                        err(429, 'rate_limit_error', 'rate limited', { 'retry-after': '1' })
                    }
                    else {
                        err(529, 'overloaded_error', 'Overloaded')
                    }
                }
                else {
                    msg([{ type: 'text', text: `attempt ${flakyCount[`${model}:${key}`]}` }])
                }
            }
            else if (model === 'echo-key-error') {
                err(400, 'invalid_request_error', `bad request for key ${key}`)
            }
            else {
                err(404, 'not_found_error', `model: ${model}`)
            }

        })
    })

    server.on('connection', (s) => {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
    })

    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve)
    })
    let port = server.address().port

    let close = async () => {
        for (let s of sockets) {
            s.destroy()
        }
        await new Promise((resolve) => {
            server.close(resolve)
        })
    }

    return { port, url: `http://127.0.0.1:${port}`, requests, close }
}


export default fakeServerForAnthropicTest
