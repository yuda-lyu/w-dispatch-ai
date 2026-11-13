import http from 'http'


// delayProxyForTest.mjs — 延遲代理(測試用): 把每個請求收完後等delayMs毫秒才轉給目標伺服器, 回應原樣回傳
//
// 用途: 令既有假伺服器之成功路由(如echo)帶固定延遲, 以觀察「逾時值是否被正確採用」——
//   逾時值被誤採為1毫秒(計時器溢位)時請求於延遲內被中止(TIMEOUT), 正確採用預設者延遲後成功; 延遲由伺服器端決定、與測試機負載無關。


/**
 * 啟動延遲代理
 *
 * @param {String} targetOrigin 輸入目標伺服器之origin(如http://127.0.0.1:8123)
 * @param {Number} delayMs 輸入轉送前之延遲毫秒
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含port、origin(代理之origin)、close(關閉之async函數)
 */
async function delayProxyForTest(targetOrigin, delayMs) {
    let t = new URL(targetOrigin)
    let sockets = new Set()

    let server = http.createServer((req, res) => {
        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
            setTimeout(() => {
                let body = Buffer.concat(chunks)
                let pr = http.request({
                    host: t.hostname,
                    port: t.port,
                    method: req.method,
                    path: req.url,
                    headers: { ...req.headers, host: t.host },
                }, (pres) => {
                    res.writeHead(pres.statusCode, pres.headers)
                    pres.pipe(res)
                })
                pr.on('error', () => {
                    if (!res.headersSent) {
                        res.writeHead(502)
                    }
                    res.end()
                })
                pr.end(body)
            }, delayMs)
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

    return { port, origin: `http://127.0.0.1:${port}`, close }
}


export default delayProxyForTest
