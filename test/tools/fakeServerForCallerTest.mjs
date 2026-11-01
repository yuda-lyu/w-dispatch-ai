import http from 'http'


// fakeServerForCallerTest.mjs — createAiCaller測試用的OpenAI相容替身端點(不連外網)
//
// createAiCaller之可觀察行為為「條目解析後送出什麼請求、結果如何原樣流出」, 故起本機http伺服器,
// 依請求之model決定回應行為; 與fakeServerForApiTest互補之處: 可回「完整JSON陣列」「截斷之JSON陣列」「回顯prompt」,
// 並記下每個請求(requests)供斷言「送出之prompt不被加前綴」「金鑰輪替順序」「請求次數」。
//
// 【路由(POST /v1/chat/completions, 依body.model)】
//   echo       — 200, content為JSON字串{ prompt, auth }（prompt即最後一則user訊息, 供斷言未被加前綴）
//   arr-full   — 200, content為完整JSON陣列[{"index":1,"t":"a"},{"index":2,"t":"b"}]
//   arr-part   — 200, content為缺第2項之JSON陣列[{"index":1,"t":"a"}]
//   arr-trunc  — 200, finish_reason為length, content為截斷之JSON陣列（括號未閉合）
//   plain      — 200, content為純文字hello
//   err-500    — 500
//   err-429    — 429（限流）
//   slow       — 延遲10秒才回應（逾時路徑用）
//   其他       — 404
// 【usage】成功回應皆帶usage（prompt_tokens 11、completion_tokens 22、reasoning_tokens 5）, 供斷言原樣流出與日誌渲染。
// 【金鑰規則】Authorization含'sk-bad'一律401。


//USAGE, 成功回應之usage
let USAGE = { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33, completion_tokens_details: { reasoning_tokens: 5 } }


/**
 * 啟動createAiCaller測試用替身端點
 *
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含url(基底網址字串，等同baseURL)、requests(已收請求之陣列，每項{ model, auth, prompt })、close(關閉伺服器之async函數)
 */
async function fakeServerForCallerTest() {

    let requests = []
    let sockets = new Set()

    let server = http.createServer((req, res) => {
        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
            let send = (code, obj) => {
                res.writeHead(code, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(obj))
            }
            if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
                send(404, { error: { message: 'not found' } })
                return
            }

            let body = {}
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            catch {}
            let auth = req.headers['authorization'] || ''
            let model = body.model || ''
            let msgs = Array.isArray(body.messages) ? body.messages : []
            let prompt = msgs.length > 0 ? String(msgs[msgs.length - 1].content) : ''
            requests.push({ model, auth, prompt })

            if (auth.includes('sk-bad')) {
                send(401, { type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } })
                return
            }

            let ok = (content, finishReason = 'stop') => {
                send(200, { choices: [{ finish_reason: finishReason, message: { role: 'assistant', content } }], usage: USAGE })
            }
            if (model === 'echo') {
                ok(JSON.stringify({ prompt, auth }))
            }
            else if (model === 'arr-full') {
                ok('[{"index":1,"t":"a"},{"index":2,"t":"b"}]')
            }
            else if (model === 'arr-part') {
                ok('[{"index":1,"t":"a"}]')
            }
            else if (model === 'arr-trunc') {
                ok('[{"index":1,"t":"a"},{"index":2,"t":"b"},{"index":3,"t":', 'length')
            }
            else if (model === 'plain') {
                ok('hello')
            }
            else if (model === 'err-500') {
                send(500, { error: { message: 'internal error' } })
            }
            else if (model === 'err-429') {
                send(429, { error: { message: 'rate limited' } })
            }
            else if (model === 'slow') {
                let tm = setTimeout(() => {
                    try {
                        ok('too late')
                    }
                    catch {}
                }, 10000)
                tm.unref() //不使測試行程為等它而延後結束
            }
            else {
                send(404, { error: { message: `unknown model ${model}` } })
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

    return { url: `http://127.0.0.1:${port}/v1`, requests, close }
}


export default fakeServerForCallerTest
