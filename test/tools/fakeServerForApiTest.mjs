import http from 'http'
import zlib from 'zlib'


// fakeServerForApiTest.mjs — 測試用的OpenAI相容假伺服器
//
// dispatchApiOpenaiCompat之可觀察行為為「送出什麼HTTP請求、如何處理各種回應」,
// 故起一個本機http伺服器, 依請求之model與Authorization決定回應行為,
// 即可對成功/401/429/500/逾時/畸形回應逐條斷言, 而無須真的呼叫外部API。
//
// 【路由】POST /v1/chat/completions 與 POST /v1/responses 兩種端點,
//   回應形狀依端點而異(Responses API無choices, 改為output陣列且usage欄位名不同),
//   對應dispatchApiOpenaiCompat與dispatchApiOpenaiResponses。
//
// 【chat/completions之行為路由(依body.model)】
//   echo           — 200, content為JSON字串{ auth, body }, 供斷言請求組成
//   empty-content  — 200, content為空字串(驗證路徑用)
//   slow           — 延遲10秒才回應(逾時路徑用)
//   err-500        — 500
//   flaky-429      — 同一Authorization首次429, 之後200(重試路徑用)
//   no-choices     — 200但無choices(畸形回應路徑用)
//   not-json       — 200但本體非JSON(畸形回應路徑用)
//   tool-calls     — 200但finish_reason為tool_calls(工具不支援路徑用)
//   br-noheader    — 200, 請求之Accept-Encoding恰為identity才回原文; 否則回brotli壓縮本體且刻意不帶
//                    Content-Encoding(模擬2026-09-24使用端回報之伺服器: 壓縮卻漏標, Node fetch因而不解壓)
//   TRUNC_ROUTES   — 200, 依表回指定之finish_reason與content(截斷處理之規格測試用, 見下方常數)
//   其他           — 404
// 【responses之行為路由(依body.model)】
//   echo           — 200, message之output_text為JSON字串{ auth, body }
//   multi-message  — 200, 多個message元素(驗證依序串接、reasoning項被略過)
//   empty-content  — 200但output_text為空字串
//   incomplete     — 200但status為incomplete(reason: max_output_tokens, output為空)
//   failed         — 200但status為failed(帶error.message)
//   reasoning-only — 200且completed但output僅reasoning無message(結構不合規)
//   tool-calls     — 200但output含function_call元素
//   no-output      — 200但缺output陣列
//   incomplete-partial — 200, status為incomplete(max_output_tokens)但已有部分文字(可搶救之截斷陣列)
//   incomplete-filter  — 200, status為incomplete(content_filter)且有部分文字
//   no-status      — 200, 缺status欄但有文字(非截斷之不合規狀態)
//   not-json/slow/err-500/flaky-429/br-noheader — 同chat/completions之對應行為
//   其他           — 401(同Zen實測: 未知model回401非404)
// 【systemone之行為路由(POST /v1/systemone, 依body.model; 形狀取自2026-09-17 TypeSafe實測)】
//   echo / jev-latest — 200, 每題回{type:'noul', noul:0.5, echoAuth, echoBody}, 供斷言請求組成
//   missing-answer    — 200但answers缺最後一題
//   no-answers        — 200但無answers
//   bad-question      — 422 {detail:[{type:'union_tag_invalid',...}]}
//   not-json/slow/err-500/flaky-429/br-noheader — 同chat/completions之對應行為
//   其他              — 400 {detail:{error_type:'api_usage_error', message:'Unknown model: X'}}
// 【金鑰規則】Authorization含'sk-bad'一律401(優先於model路由), 模擬無效金鑰;
//   systemone路由之401本體採TypeSafe形狀{detail:{error_type:'authentication_error'}}。


//TRUNC_ROUTES, chat/completions之截斷與終止原因情境(2026-09-24截斷處理之規格測試):
//fr為finish_reason原值(含大小寫與null), content為message.content原值(含null與純空白)
let TRUNC_ROUTES = {
    'trunc-empty': { fr: 'length', content: '', usage: { prompt_tokens: 181, completion_tokens: 600, total_tokens: 781, completion_tokens_details: { reasoning_tokens: 600 } } }, //推理耗盡(Zen實測形態)
    'trunc-null': { fr: 'length', content: null },
    'trunc-space': { fr: 'length', content: '\n\n' },
    'trunc-array': { fr: 'length', content: '[{"a":1},{"b":2},{"c":' }, //可搶救前段
    'trunc-text': { fr: 'length', content: '第一段說明，第二' },
    'trunc-tail': { fr: 'length', content: '{"a":1}\n\n說明：因為' }, //完整載荷+截尾(寬鬆解析可過)
    'trunc-upper': { fr: 'LENGTH', content: '[{"a":1},{"b":' }, //大小寫不同
    'filtered': { fr: 'content_filter', content: '部分內容' },
    'finish-stop': { fr: 'stop', content: '完成' },
    'finish-null': { fr: null, content: '完成' },
    'finish-other': { fr: 'eos', content: '完成' }, //未知值, 不可誤殺
    'plain-content': { fr: 'stop', content: 'hello world' }, //非JSON純文字
}


/**
 * 啟動測試用OpenAI相容假伺服器
 *
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含port(埠號)、url(基底網址字串，等同baseURL)、close(關閉伺服器之async函數)
 */
async function fakeServerForApiTest() {

    //flakyCount, 記錄flaky-429各金鑰之呼叫次數
    let flakyCount = {}

    //sockets, 追蹤連線供close時強制斷開(避免keep-alive令close懸置)
    let sockets = new Set()

    let server = http.createServer((req, res) => {

        //僅受理POST /v1/chat/completions、POST /v1/responses與POST /v1/systemone
        let isResponses = req.url.endsWith('/responses')
        let isSystemOne = req.url.endsWith('/systemone')
        if (req.method !== 'POST' || (!req.url.endsWith('/chat/completions') && !isResponses && !isSystemOne)) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: 'not found' } }))
            return
        }

        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {

            let auth = req.headers['authorization'] || ''

            //sendUndeclaredBr, br-noheader路由用: 客戶端明示identity才回原文, 否則回brotli本體且刻意不帶Content-Encoding
            let ae = String(req.headers['accept-encoding'] || '').trim().toLowerCase()
            let sendUndeclaredBr = (obj) => {
                let buf = Buffer.from(JSON.stringify(obj))
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(ae === 'identity' ? buf : zlib.brotliCompressSync(buf))
            }

            //body非JSON → 400
            let body = null
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: { message: 'invalid json body' } }))
                return
            }

            //無效金鑰, 模擬Zen之401形態(systemone則模擬TypeSafe之形態)
            if (auth.includes('sk-bad')) {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                if (isSystemOne) {
                    res.end(JSON.stringify({ detail: { error_type: 'authentication_error', message: 'Cannot authenticate with the server. Please check your API key and try again.' } }))
                }
                else {
                    res.end(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } }))
                }
                return
            }

            let model = body.model || ''

            //System One路由(/systemone): 回answers而非文字, 見dispatchApiTypesafeSystemone檔頭
            if (isSystemOne) {
                let send = (code, obj) => {
                    res.writeHead(code, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify(obj))
                }
                let ids = Object.keys(body.questions || {})
                let usage = { input_tokens: 7, output_tokens: 3 }
                let okResp = (extra = {}) => {
                    let answers = {}
                    for (let id of ids) {
                        answers[id] = { type: 'noul', noul: 0.5, ...extra }
                    }
                    send(200, { model: 'jev-1.13.0', answers, usage })
                }
                if (model === 'echo' || model === 'jev-latest') {
                    okResp({ echoAuth: auth, echoBody: body })
                }
                else if (model === 'missing-answer') {
                    let answers = {}
                    for (let id of ids.slice(0, -1)) {
                        answers[id] = { type: 'noul', noul: 0.5 }
                    }
                    send(200, { model: 'jev-1.13.0', answers, usage })
                }
                else if (model === 'no-answers') {
                    send(200, { model: 'jev-1.13.0', usage })
                }
                else if (model === 'bad-question') {
                    send(422, { detail: [{ type: 'union_tag_invalid', loc: ['body', 'questions', ids[0]], msg: 'Input tag does not match any of the expected tags' }] })
                }
                else if (model === 'br-noheader') {
                    let answers = {}
                    for (let id of ids) {
                        answers[id] = { type: 'noul', noul: 0.5 }
                    }
                    sendUndeclaredBr({ model: 'jev-1.13.0', answers, usage })
                }
                else if (model === 'not-json') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' })
                    res.end('plain text body')
                }
                else if (model === 'slow') {
                    setTimeout(() => okResp(), 10000)
                }
                else if (model === 'err-500') {
                    send(500, { detail: { error_type: 'server_error', message: 'internal error' } })
                }
                else if (model === 'flaky-429') {
                    flakyCount[auth] = (flakyCount[auth] || 0) + 1
                    if (flakyCount[auth] === 1) {
                        send(429, { detail: { error_type: 'rate_limit_error', message: 'rate limited' } })
                    }
                    else {
                        okResp({ attempt: flakyCount[auth] })
                    }
                }
                else {
                    send(400, { detail: { error_type: 'api_usage_error', message: `Unknown model: ${model}` } })
                }
                return
            }

            //Responses API路由(/responses): 形狀與chat/completions完全不同, 見dispatchApiOpenaiResponses檔頭
            if (isResponses) {
                let send = (code, obj) => {
                    res.writeHead(code, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify(obj))
                }
                //usage欄位名為input_tokens/output_tokens(與chat/completions不同), 供斷言原樣透傳
                let usage = { input_tokens: 5, output_tokens: 11, total_tokens: 16 }
                let okResp = (text) => send(200, {
                    id: 'resp_x',
                    object: 'response',
                    status: 'completed',
                    model,
                    error: null,
                    incomplete_details: null,
                    output: [
                        { id: 'rs_1', type: 'reasoning', status: 'completed', content: [] }, //思考項應被略過
                        { id: 'msg_1', type: 'message', status: 'completed', content: [{ type: 'output_text', text }] },
                    ],
                    usage,
                })
                if (model === 'echo') {
                    okResp(JSON.stringify({ auth, body }))
                }
                else if (model === 'multi-message') { //多個message元素應依序串接
                    send(200, {
                        status: 'completed',
                        model,
                        error: null,
                        incomplete_details: null,
                        output: [
                            { type: 'message', content: [{ type: 'output_text', text: 'AA' }] },
                            { type: 'reasoning', content: [] },
                            { type: 'message', content: [{ type: 'output_text', text: 'BB' }] },
                        ],
                        usage,
                    })
                }
                else if (model === 'empty-content') {
                    okResp('')
                }
                else if (model === 'incomplete') { //max_output_tokens耗盡, output為空
                    send(200, { status: 'incomplete', model, error: null, incomplete_details: { reason: 'max_output_tokens' }, output: [], usage })
                }
                else if (model === 'failed') {
                    send(200, { status: 'failed', model, error: { code: 'server_error', message: 'upstream blew up' }, incomplete_details: null, output: [], usage })
                }
                else if (model === 'reasoning-only') { //僅思考無message, 屬結構不合規
                    send(200, { status: 'completed', model, error: null, incomplete_details: null, output: [{ type: 'reasoning', content: [] }], usage })
                }
                else if (model === 'tool-calls') {
                    send(200, {
                        status: 'completed',
                        model,
                        error: null,
                        incomplete_details: null,
                        output: [{ type: 'function_call', name: 'get_weather', arguments: '{"city":"台北"}', call_id: 'call-1' }],
                        usage,
                    })
                }
                else if (model === 'no-output') { //缺output陣列
                    send(200, { status: 'completed', model, id: 'resp_y' })
                }
                else if (model === 'incomplete-partial') { //max_output_tokens耗盡但已有部分文字
                    send(200, {
                        status: 'incomplete',
                        model,
                        error: null,
                        incomplete_details: { reason: 'max_output_tokens' },
                        output: [{ type: 'message', content: [{ type: 'output_text', text: '[{"a":1},{"b":2},{"c":' }] }],
                        usage: { ...usage, output_tokens_details: { reasoning_tokens: 9 } },
                    })
                }
                else if (model === 'incomplete-filter') {
                    send(200, { status: 'incomplete', model, error: null, incomplete_details: { reason: 'content_filter' }, output: [{ type: 'message', content: [{ type: 'output_text', text: '部分' }] }], usage })
                }
                else if (model === 'no-status') {
                    send(200, { model, error: null, incomplete_details: null, output: [{ type: 'message', content: [{ type: 'output_text', text: 'x' }] }], usage })
                }
                else if (model === 'br-noheader') {
                    sendUndeclaredBr({
                        status: 'completed',
                        model,
                        error: null,
                        incomplete_details: null,
                        output: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
                        usage,
                    })
                }
                else if (model === 'not-json') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' })
                    res.end('plain text body')
                }
                else if (model === 'slow') {
                    setTimeout(() => okResp('too late'), 10000)
                }
                else if (model === 'err-500') {
                    send(500, { error: { message: 'internal error' } })
                }
                else if (model === 'flaky-429') {
                    flakyCount[auth] = (flakyCount[auth] || 0) + 1
                    if (flakyCount[auth] === 1) {
                        send(429, { error: { message: 'rate limited' } })
                    }
                    else {
                        okResp(JSON.stringify({ attempt: flakyCount[auth] }))
                    }
                }
                else {
                    send(401, { type: 'error', error: { type: 'ModelError', message: `Model ${model} is not supported` } }) //同Zen實測: 未知model回401非404
                }
                return
            }

            let ok = (content) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    choices: [{ message: { role: 'assistant', content } }],
                    usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 }, //供斷言usage原樣透傳
                }))
            }

            if (model === 'echo') {
                ok(JSON.stringify({ auth, body }))
            }
            else if (model === 'empty-content') {
                ok('')
            }
            else if (model === 'slow') {
                setTimeout(() => ok('too late'), 10000)
            }
            else if (model === 'err-500') {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: { message: 'internal error' } }))
            }
            else if (model === 'flaky-429') {
                flakyCount[auth] = (flakyCount[auth] || 0) + 1
                if (flakyCount[auth] === 1) {
                    res.writeHead(429, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: { message: 'rate limited' } }))
                }
                else {
                    ok(JSON.stringify({ attempt: flakyCount[auth] }))
                }
            }
            else if (model === 'tool-calls') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    choices: [{
                        finish_reason: 'tool_calls',
                        message: {
                            role: 'assistant',
                            content: '\n\n', //Agnes實測形態: 非null而是空白, 不攔截會靜默成功
                            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"台北"}' } }],
                        },
                    }],
                }))
            }
            else if (model === 'no-choices') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ id: 'x', object: 'chat.completion' }))
            }
            else if (model === 'br-noheader') {
                sendUndeclaredBr({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '完成' } }] })
            }
            else if (TRUNC_ROUTES[model] !== undefined) {
                let t = TRUNC_ROUTES[model]
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    choices: [{ finish_reason: t.fr, message: { role: 'assistant', content: t.content } }],
                    usage: t.usage || { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 },
                }))
            }
            else if (model === 'not-json') {
                res.writeHead(200, { 'Content-Type': 'text/plain' })
                res.end('plain text body')
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: { message: `model ${model} not found` } }))
            }

        })
    })

    server.on('connection', (s) => {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
    })

    //listen於127.0.0.1動態埠
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

    return { port, url: `http://127.0.0.1:${port}/v1`, close }
}


export default fakeServerForApiTest
