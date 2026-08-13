import http from 'http'


// fakeServerForApiTest.mjs — 測試用的OpenAI相容假伺服器
//
// dispatchApiOpenaiCompat之可觀察行為為「送出什麼HTTP請求、如何處理各種回應」,
// 故起一個本機http伺服器, 依請求之model與Authorization決定回應行為,
// 即可對成功/401/429/500/逾時/畸形回應逐條斷言, 而無須真的呼叫外部API。
//
// 【行為路由(依body.model)】
//   echo           — 200, content為JSON字串{ auth, body }, 供斷言請求組成
//   empty-content  — 200, content為空字串(驗證路徑用)
//   slow           — 延遲10秒才回應(逾時路徑用)
//   err-500        — 500
//   flaky-429      — 同一Authorization首次429, 之後200(重試路徑用)
//   no-choices     — 200但無choices(畸形回應路徑用)
//   not-json       — 200但本體非JSON(畸形回應路徑用)
//   tool-calls     — 200但finish_reason為tool_calls(工具不支援路徑用)
//   其他           — 404
// 【金鑰規則】Authorization含'sk-bad'一律401(優先於model路由), 模擬無效金鑰。


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

        //僅受理POST /v1/chat/completions
        if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: 'not found' } }))
            return
        }

        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {

            let auth = req.headers['authorization'] || ''

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

            //無效金鑰, 模擬Zen之401形態
            if (auth.includes('sk-bad')) {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } }))
                return
            }

            let model = body.model || ''
            let ok = (content) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
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
