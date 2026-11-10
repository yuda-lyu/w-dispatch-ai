import http from 'http'


// fakeServerForDeadlineTest.mjs — 期限、封頂與冷卻之測試用本機替身伺服器(2026-11-11 di402)
//
// 以請求之body.model決定行為, 並逐model計收件數(requests[model]), 供測試以「收件數」而非牆鐘斷言重試次數;
// model可帶':<標籤>'以分開計數(如'hang:da1'), 行為依標籤前之路由:
//   hang            收件後永不回應(由轉接器逾時; close時強制斷開)
//   fail-then-hang  同一model首次回500(可重試之失敗), 之後永不回應
//   ok              200, chat/completions形狀, content為'OK'
//   bad             200, chat/completions形狀, content為'bad'(供validate不過)
//   429             429(限流)
//   500             500(可重試之服務端錯誤)
//   其他            404
// 四種端點(/chat/completions、/responses、/v1/messages、/systemone)皆受理; 只有ok與bad回chat/completions之成功形狀(本檔只供api-openai-compat之成功路徑)。


/**
 * 啟動替身伺服器
 *
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含url(基底網址，含/v1)、root(不含/v1之根網址，供api-anthropic)、requests(各model收件數物件)、reset(歸零收件數)、close(關閉之async函數)
 */
async function fakeServerForDeadlineTest() {
    let requests = {}
    let seen = {}
    let sockets = new Set()

    let server = http.createServer((req, res) => {
        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
            let body = {}
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            catch {}
            let model = String(body.model || '')
            requests[model] = (requests[model] || 0) + 1
            let route = model.split(':')[0]
            let send = (code, obj) => {
                res.writeHead(code, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(obj))
            }
            let chat = (content) => send(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
            if (route === 'hang') {
                return //永不回應
            }
            if (route === 'fail-then-hang') {
                seen[model] = (seen[model] || 0) + 1
                if (seen[model] === 1) {
                    send(500, { error: { message: 'internal error' } })
                }
                return
            }
            if (route === 'ok') {
                chat('OK')
                return
            }
            if (route === 'bad') {
                chat('bad')
                return
            }
            if (route === '429') {
                send(429, { error: { message: 'rate limited' } })
                return
            }
            if (route === '500') {
                send(500, { error: { message: 'internal error' } })
                return
            }
            send(404, { error: { message: `model ${model} not found` } })
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

    let reset = () => {
        for (let k of Object.keys(requests)) {
            delete requests[k]
        }
        for (let k of Object.keys(seen)) {
            delete seen[k]
        }
    }

    let close = async () => {
        for (let s of sockets) {
            s.destroy()
        }
        await new Promise((resolve) => {
            server.close(resolve)
        })
    }

    return { url: `http://127.0.0.1:${port}/v1`, root: `http://127.0.0.1:${port}`, requests, reset, close }
}


export default fakeServerForDeadlineTest
