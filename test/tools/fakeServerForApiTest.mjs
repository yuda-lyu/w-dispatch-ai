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
//   garbage-200    — 200, Content-Type為application/json但本體為8個非JSON位元組(模擬壓縮或損壞本體)
//   slow-401       — 延遲300ms後回401(與金鑰有關之失敗但耗時, 供組內預算用盡之情境)
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
//   not-json/slow/err-500/flaky-429/br-noheader/garbage-200 — 同chat/completions之對應行為
//   其他           — 401(同Zen實測: 未知model回401非404)
// 【systemone之行為路由(POST /v1/systemone, 依body.model; 形狀取自2026-09-17 TypeSafe實測)】
//   echo / jev-latest — 200, 每題回{type:'noul', noul:0.5, echoAuth, echoBody}, 供斷言請求組成
//   missing-answer    — 200但answers缺最後一題
//   no-answers        — 200但無answers
//   bad-question      — 422 {detail:[{type:'union_tag_invalid',...}]}
//   not-json/slow/err-500/flaky-429/br-noheader/garbage-200 — 同chat/completions之對應行為
//   其他              — 400 {detail:{error_type:'api_usage_error', message:'Unknown model: X'}}
// 【金鑰規則】Authorization含'sk-bad'一律401(優先於model路由), 模擬無效金鑰;
//   systemone路由之401本體採TypeSafe形狀{detail:{error_type:'authentication_error'}}。
//
// 【伺服器端取證通道(2026-11-25 t628)】三家REST轉接器之成功stdout／answers／usage已精確遮蔽金鑰,
//   測試不得再以「成功回聲Authorization於stdout」驗標頭與請求本體(回聲之金鑰會被遮成***; 亦不得縮短測試金鑰或改用非金鑰字樣躲遮蔽);
//   改由伺服器端記錄每個收到之請求, 以回傳物件之requests()／lastRequest()／clearRequests()讀取:
//   每筆為{ method, url, headers(原標頭, 鍵為小寫), auth(authorization標頭值, 無則''), body(解析後JSON, 非JSON為null) }。
//   echo／jev-latest路由仍回聲{auth, body}(echoAuth／echoBody), 專供「回聲被遮蔽」之洩漏重現測試用, 不作為取證通道。


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
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含port(埠號)、url(基底網址字串，等同baseURL)、close(關閉伺服器之async函數)、
 * requests(函數，回傳至今收到之全部請求之副本陣列)、lastRequest(函數，回傳最後一個請求，無則null)、clearRequests(函數，清空記錄)；
 * 每筆請求為{ method, url, headers(原標頭, 鍵為小寫), auth, body }，見檔頭【伺服器端取證通道】
 */
async function fakeServerForApiTest() {

    //flakyCount, 記錄flaky-429各金鑰之呼叫次數
    let flakyCount = {}

    //reqLog, 伺服器端取證通道: 記錄每個收到之請求(依序; 不經轉接器之回傳值, 故不受成功路徑遮蔽影響)
    let reqLog = []

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
            let bodyOk = true
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            catch {
                bodyOk = false
            }

            //取證記錄(先於任何回應; 非JSON本體之body為null)
            reqLog.push({ method: req.method, url: req.url, headers: { ...req.headers }, auth, body })

            if (!bodyOk) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: { message: 'invalid json body' } }))
                return
            }

            //garbage-200, 三種端點共用: 200且宣稱JSON, 本體卻是8個非JSON位元組(不論Accept-Encoding)
            if (body.model === 'garbage-200') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(Buffer.from([0x8b, 0xef, 0x02, 0x00, 0xe4, 0xff, 0x11, 0x22]))
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

            //洩漏重現用之共通型號(三種端點皆同; 2026-11-24 tdai4b): 回顯收到之Authorization標頭與去掉Bearer前綴之金鑰本體
            //err-echo-key: HTTP 401, 錯誤本體回顯; nonjson-echo-key: HTTP 200非JSON, Content-Type之參數與本文皆回顯;
            //junk-json-echo-key: HTTP 200 JSON但無可用欄位(三家各回invalid-response), 本體回顯; trunc-echo-key(僅chat/completions): finish_reason為length且部分內容回顯
            let bare = auth.replace(/^Bearer\s+/i, '')
            if (model === 'err-echo-key') {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: { message: `bad credential ${auth} / ${bare}` } }))
                return
            }
            if (model === 'nonjson-echo-key') {
                res.writeHead(200, { 'Content-Type': `text/plain; debug-key=${bare}` })
                res.end(`oops ${bare}`)
                return
            }
            if (model === 'junk-json-echo-key') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ note: 'no usable fields', echo: bare }))
                return
            }
            if (model === 'failed-echo-key' && isResponses) { //responses端點: status為failed, error.message回顯金鑰(進入error字串之detail與stderr)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: 'failed', model, error: { code: 'server_error', message: `boom ${bare}` }, incomplete_details: null, output: [], usage: { input_tokens: 7, output_tokens: 3 } }))
                return
            }
            if (model === 'incomplete-echo-key' && isResponses) { //responses端點: status為incomplete, incomplete_details.reason回顯金鑰(進入judgeTruncated之error字串)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: 'incomplete', model, error: null, incomplete_details: { reason: bare }, output: [], usage: { input_tokens: 7, output_tokens: 3 } }))
                return
            }
            if (model === 'model-echo-key' && isSystemOne) { //systemone端點: 回應之model欄(modelResolved)回顯金鑰, answers缺漏令結果為失敗
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ model: bare, answers: {}, usage: { input_tokens: 7, output_tokens: 3 } }))
                return
            }
            if (model === 'trunc-echo-key' && !isResponses && !isSystemOne) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: `partial ${bare}` } }], usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 } }))
                return
            }

            //成功路徑之洩漏重現用(三種端點皆同; 2026-11-25 t628; 成功之模型輸出與回應中介資料回顯金鑰):
            //ok-echo-key: HTTP 200成功, 模型輸出(content／output_text／answers之note)回顯Authorization標頭與金鑰本體,
            //  usage之字串值、屬性名與巢狀陣列、chat/completions之finish_reason(大小寫混合之金鑰, 正規化會轉小寫)亦回顯金鑰;
            //ok-pattern-text: HTTP 200成功, 模型輸出含金鑰樣式字樣(sk-ant-、password=)但非本次金鑰——成功之stdout只精確遮蔽, 不得誤遮;
            //status-echo-key(僅responses): status本身為金鑰(非completed之失敗結果, finishReason取自status);
            //incomplete-echo-partial(僅responses): status為incomplete(max_output_tokens)且部分文字回顯金鑰(acceptTruncated放行時為成功結果);
            //ok-echo-xkey／ok-echo-hdrs: 模型輸出回顯呼叫端自給之x-api-key標頭值／非機密標頭值(M1: 預設拒絕下, 非白名單標頭值之字樣於成功輸出亦被遮);
            //ok-array-echo-key(僅chat/completions): content為陣列形態(轉接器序列化後遮蔽; 含引號或反斜線之金鑰於JSON文字內被跳脫);
            //finish-upper-echo-key／status-upper-echo-key: 終止原因回顯金鑰之大寫版(全小寫之金鑰經正規化轉小寫後即還原為金鑰本體)
            let meta = { served_by: bare, [bare]: 1, trace: [{ k: bare }], foreign: 'oc_sk_FOREIGNMETA0123456789' } //foreign: 非本次金鑰之他把金鑰字樣(回應中介資料以診斷家族遮蔽, 套金鑰樣式集)
            let sample = 'see sk-ant-api03-SAMPLEONLY-0123456789 and password=hunter2-sample'
            //ok-echo-xkey: 模型輸出回顯呼叫端自給之x-api-key標頭值; ok-echo-hdrs: 模型輸出回顯自給之非機密標頭值(X-Env: 不在白名單; HTTP-Referer: 白名單; X-Maybe: 值為undefined)
            let hv = (n) => (req.headers[n] === undefined ? '' : String(req.headers[n]))
            let textOf = {
                'ok-echo-key': `reply ${auth} / ${bare}`,
                'ok-pattern-text': sample,
                'ok-echo-xkey': `reply ${hv('x-api-key')}`,
                'ok-echo-hdrs': `env=${hv('x-env')} ref=${hv('http-referer')} maybe=${hv('x-maybe')}`,
            }
            if (textOf[model] !== undefined) {
                let text = textOf[model]
                let withMeta = model === 'ok-echo-key' //只有此型號附回顯金鑰之中介資料(usage之字串值、屬性名、巢狀陣列, finish_reason)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                if (isSystemOne) {
                    let answers = {}
                    for (let id of Object.keys(body.questions || {})) {
                        answers[id] = withMeta ? { type: 'noul', noul: 0.5, note: text, [bare]: 'x', list: [bare] } : { type: 'noul', noul: 0.5, note: text }
                    }
                    res.end(JSON.stringify({ model: 'jev-1.13.0', answers, usage: withMeta ? { input_tokens: 7, output_tokens: 3, ...meta } : { input_tokens: 7, output_tokens: 3 } }))
                }
                else if (isResponses) {
                    res.end(JSON.stringify({ status: 'completed', model, error: null, incomplete_details: null, output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: withMeta ? { input_tokens: 5, output_tokens: 11, ...meta } : { input_tokens: 5, output_tokens: 11 } }))
                }
                else {
                    res.end(JSON.stringify({ choices: [{ finish_reason: withMeta ? bare : 'stop', message: { role: 'assistant', content: text } }], usage: withMeta ? { prompt_tokens: 3, completion_tokens: 7, ...meta } : { prompt_tokens: 3, completion_tokens: 7 } }))
                }
                return
            }
            //ok-array-echo-key(僅chat/completions): content為陣列形態(轉接器以JSON.stringify轉字串, 含引號或反斜線之金鑰於其內被跳脫)
            if (model === 'ok-array-echo-key' && !isResponses && !isSystemOne) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: `reply ${bare}` }] } }], usage: { prompt_tokens: 3, completion_tokens: 7 } }))
                return
            }
            //finish-upper-echo-key(僅chat/completions)／status-upper-echo-key(僅responses): 終止原因(status)回顯金鑰之「大寫版」(全小寫之金鑰經正規化轉小寫後即還原為金鑰本體)
            if (model === 'finish-upper-echo-key' && !isResponses && !isSystemOne) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ choices: [{ finish_reason: bare.toUpperCase(), message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 7 } }))
                return
            }
            if (model === 'status-upper-echo-key' && isResponses) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: bare.toUpperCase(), model, error: null, incomplete_details: null, output: [], usage: { input_tokens: 5, output_tokens: 11 } }))
                return
            }
            if (model === 'status-echo-key' && isResponses) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: bare, model, error: null, incomplete_details: null, output: [], usage: { input_tokens: 5, output_tokens: 11 } }))
                return
            }
            if (model === 'incomplete-echo-partial' && isResponses) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ status: 'incomplete', model, error: null, incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: `partial ${bare}` }] }], usage: { input_tokens: 5, output_tokens: 11 } }))
                return
            }

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
            else if (model === 'slow-401') {
                setTimeout(() => {
                    res.writeHead(401, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } }))
                }, 300)
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

    let requests = () => [...reqLog]
    let lastRequest = () => reqLog.length === 0 ? null : reqLog[reqLog.length - 1]
    let clearRequests = () => {
        reqLog.length = 0
    }

    return { port, url: `http://127.0.0.1:${port}/v1`, close, requests, lastRequest, clearRequests }
}


export default fakeServerForApiTest
