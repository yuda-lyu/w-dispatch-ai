import http from 'http'


// fakeServerForGoUsageTest.mjs — OpenCode Go 用量端點(GET <base>/usage)之假HTTP伺服器
//
// 回應fixture形狀取自2026-11-03以已訂閱Go之金鑰對真實端點(https://opencode.ai/inference/go/v1/usage)之實測;
// 錯誤本體形狀亦取自同日實測: 401 { type:'error', error:{ type:'AuthError', message:'Unauthorized' } }、
// 403 { type:'error', error:{ type:'EntitlementError', message:'OpenCode Go subscription required.' } }。
// 'rate-limited'與未知狀態字為實測未撞限過之形狀(來自第三方記載與issue #65), 此處以假站台構造。
//
// 【行為路由(依Bearer權杖)】路徑非 /usage 一律404; 無Authorization標頭(含只給x-api-key)回401 Missing API key.:
//   oc_sk_ok            200 全部視窗ok
//   oc_sk_ok_extra      200 全部ok, 視窗物件帶額外欄位(測原值保留)與非整數／字串percent
//   oc_sk_lim_rolling   200 rolling為rate-limited
//   oc_sk_lim_two       200 rolling與weekly皆rate-limited, resetsAt為rolling較早、weekly較晚
//   oc_sk_lim_two_rev   200 rolling與monthly皆rate-limited, resetsAt為rolling較晚、monthly較早(防「取最後一個」之寫法)
//   oc_sk_lim_nodate    200 rolling與weekly皆rate-limited, weekly缺resetsAt
//   oc_sk_lim_baddate   200 rolling rate-limited且resetsAt非日期字串
//   oc_sk_unknown       200 weekly status為'blocked'(未知狀態字)
//   oc_sk_lim_and_unknown 200 rolling為rate-limited且weekly為未知狀態字'blocked'
//   oc_sk_unknown_case  200 rolling status為'OK'(大小寫不同, 視為未知)
//   oc_sk_nostatus      200 monthly無status欄
//   oc_sk_nomonthly     200 缺monthly視窗
//   oc_sk_shape_empty   200 {}
//   oc_sk_shape_arr     200 { usage: [] }
//   oc_sk_shape_str     200 { usage: 'x' }
//   oc_sk_401           401 AuthError
//   oc_sk_403_go        403 EntitlementError
//   oc_sk_403_scope     403 permission_error(非Go訂閱不足)
//   oc_sk_429           429
//   oc_sk_500           500
//   oc_sk_notjson       200 text/html
//   oc_sk_slow          延遲5秒才200(逾時路徑用)
//   oc_sk_echo          401, 本文回顯完整Authorization標頭與金鑰(測遮蔽)
//   其他                401 AuthError


//正常視窗
let W_OK = {
    rolling: { status: 'ok', percent: 10, resetsAt: '2026-11-03T16:48:24.000Z' },
    weekly: { status: 'ok', percent: 4, resetsAt: '2026-11-09T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 2, resetsAt: '2026-12-03T09:36:23.000Z' },
}

//各權杖之usage fixture(函數形式令每次回新物件, 測試可放心改動)
let usageOf = {
    oc_sk_ok: () => ({ usage: structuredClone(W_OK) }),
    oc_sk_ok_extra: () => ({
        usage: {
            rolling: { status: 'ok', percent: 37.5, resetsAt: '2026-11-03T16:48:24.000Z', extraField: 'keep-me' },
            weekly: { status: 'ok', percent: '12', resetsAt: '2026-11-09T00:00:00.000Z' },
            monthly: { status: 'ok', percent: 0, resetsAt: '2026-12-03T09:36:23.000Z' },
        },
    }),
    oc_sk_lim_rolling: () => ({
        usage: { ...structuredClone(W_OK), rolling: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-03T16:48:24.000Z' } },
    }),
    oc_sk_lim_two: () => ({
        usage: {
            ...structuredClone(W_OK),
            rolling: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-03T16:48:24.000Z' },
            weekly: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-09T00:00:00.000Z' },
        },
    }),
    oc_sk_lim_two_rev: () => ({
        usage: {
            ...structuredClone(W_OK),
            rolling: { status: 'rate-limited', percent: 100, resetsAt: '2026-12-01T00:00:00.000Z' },
            monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-05T00:00:00.000Z' },
        },
    }),
    oc_sk_lim_nodate: () => ({
        usage: {
            ...structuredClone(W_OK),
            rolling: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-03T16:48:24.000Z' },
            weekly: { status: 'rate-limited', percent: 100 },
        },
    }),
    oc_sk_lim_baddate: () => ({
        usage: { ...structuredClone(W_OK), rolling: { status: 'rate-limited', percent: 100, resetsAt: 'not-a-date' } },
    }),
    oc_sk_unknown: () => ({
        usage: { ...structuredClone(W_OK), weekly: { status: 'blocked', percent: 100, resetsAt: '2026-11-09T00:00:00.000Z' } },
    }),
    oc_sk_lim_and_unknown: () => ({
        usage: {
            ...structuredClone(W_OK),
            rolling: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-03T16:48:24.000Z' },
            weekly: { status: 'blocked', percent: 100, resetsAt: '2026-11-09T00:00:00.000Z' },
        },
    }),
    oc_sk_unknown_case: () => ({
        usage: { ...structuredClone(W_OK), rolling: { status: 'OK', percent: 10, resetsAt: '2026-11-03T16:48:24.000Z' } },
    }),
    oc_sk_nostatus: () => ({
        usage: { ...structuredClone(W_OK), monthly: { percent: 2, resetsAt: '2026-12-03T09:36:23.000Z' } },
    }),
    oc_sk_nomonthly: () => {
        let u = structuredClone(W_OK)
        delete u.monthly
        return { usage: u }
    },
    oc_sk_shape_empty: () => ({}),
    oc_sk_shape_arr: () => ({ usage: [] }),
    oc_sk_shape_str: () => ({ usage: 'x' }),
}


/**
 * 啟動Go用量端點用之假HTTP伺服器
 *
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含url(基底網址字串，如http://127.0.0.1:PORT/inference/go/v1，其下/usage為端點)、requests(已收到之請求紀錄陣列，各項含method、url、headers、body)、close(關閉伺服器之async函數)
 */
async function fakeServerForGoUsageTest() {
    let requests = []
    let sockets = new Set()
    let timers = new Set()

    let server = http.createServer((req, res) => {
        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
            requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') })

            let send = (code, obj, ct = 'application/json') => {
                res.writeHead(code, { 'Content-Type': ct })
                res.end(typeof obj === 'string' ? obj : JSON.stringify(obj))
            }
            let authErr = (code, type, message) => send(code, { type: 'error', error: { type, message } })

            if (req.url !== '/inference/go/v1/usage') {
                return send(404, '', 'text/plain')
            }
            let auth = req.headers['authorization'] || ''
            let m = /^Bearer (\S+)$/.exec(auth)
            if (!m) {
                return authErr(401, 'AuthError', 'Missing API key.')
            }
            let tok = m[1]

            if (tok === 'oc_sk_401') {
                return authErr(401, 'AuthError', 'Unauthorized')
            }
            if (tok === 'oc_sk_403_go') {
                return authErr(403, 'EntitlementError', 'OpenCode Go subscription required.')
            }
            if (tok === 'oc_sk_403_scope') {
                return authErr(403, 'permission_error', 'This API key does not have permission to access this resource.')
            }
            if (tok === 'oc_sk_429') {
                return authErr(429, 'rate_limit_error', 'Too many requests')
            }
            if (tok === 'oc_sk_500') {
                return authErr(500, 'server_error', 'internal')
            }
            if (tok === 'oc_sk_notjson') {
                return send(200, '<html>not json</html>', 'text/html')
            }
            if (tok === 'oc_sk_echo') {
                return authErr(401, 'AuthError', `echo of header: ${auth} / key=${tok}`)
            }
            if (tok === 'oc_sk_slow') {
                let t = setTimeout(() => {
                    timers.delete(t)
                    try {
                        send(200, { usage: structuredClone(W_OK) })
                    }
                    catch (err) {}
                }, 5000)
                timers.add(t)
                return
            }
            if (usageOf[tok]) {
                return send(200, usageOf[tok]())
            }
            return authErr(401, 'AuthError', 'Unauthorized')
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
    let url = `http://127.0.0.1:${port}/inference/go/v1`

    let close = async () => {
        for (let t of timers) {
            clearTimeout(t)
        }
        for (let s of sockets) {
            s.destroy()
        }
        await new Promise((resolve) => {
            server.close(resolve)
        })
    }

    return { url, port, requests, close }
}


export default fakeServerForGoUsageTest
export { W_OK }
