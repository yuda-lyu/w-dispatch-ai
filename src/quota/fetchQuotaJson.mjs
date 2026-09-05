import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import castPintOr from '../castPintOr.mjs'
import dfQuotaTimeoutMs from './dfQuotaTimeoutMs.mjs'


// fetchQuotaJson.mjs — 各額度查詢端點共用之HTTP請求並解析JSON
//
// 【為何自寫而不引HTTP套件】本套件相依僅wsemi一項, 額度查詢只需單次請求,
//   Node 18+已內建fetch, 引入額外相依不划算。
//
// 【為何逾時走AbortController且涵蓋讀取本文】fetch本身無逾時參數; 且fetch resolve只代表收到標頭,
//   本文仍可能無限期慢流, 故計時器須持續到本文讀完才解除。
//
// 【為何錯誤要分類】呼叫端對「token過期(auth)」與「暫時性網路失敗(network/timeout)」
//   之處置完全不同, 只給錯誤訊息字串則呼叫端須解析文字判斷。
//
// 【為何有redact與maxBodyBytes】錯誤訊息會夾帶回應本文片段, 若對端把請求標頭回顯(除錯頁、代理錯誤頁),
//   權杖或帳號ID便會流入log; 呼叫端把機密值交給redact, 進訊息前一律替換。本文大小上限則防止
//   異常回應(例如導向到整頁HTML或無限串流)撐爆記憶體; 額度端點正常回應不到10KB, 1MB綽綽有餘。
//   兩者皆參考同類工具codex-reset-checker之做法。


//回應本文預設上限位元組
let DEFAULT_MAX_BODY_BYTES = 1048576


//遮蔽替代文字; 短於此長度之機密值不遮(避免把常見短字串誤遮成無法閱讀)
let REDACT_MASK = '[REDACTED]'
let REDACT_MIN_LEN = 6


/**
 * 將文字中之機密值替換為遮蔽字
 *
 * @param {String} text 輸入文字
 * @param {Array} redact 輸入機密值字串陣列
 * @returns {String} 回傳替換後文字
 */
function redactText(text, redact) {
    let s = String(text)
    for (let v of redact) {
        if (isestr(v) && v.length >= REDACT_MIN_LEN) {
            s = s.split(v).join(REDACT_MASK)
        }
    }
    return s
}


/**
 * 讀取回應本文, 超過上限即中止
 *
 * @param {Object} r 輸入fetch之Response
 * @param {Number} maxBytes 輸入上限位元組
 * @returns {Promise} 回傳物件{ok, text, bytes}, 超限時ok為false且bytes為已讀位元組(或content-length)
 */
async function readBodyCapped(r, maxBytes) {

    //content-length, 先擋明顯超限者, 不必開始讀
    let cl = Number(r.headers.get('content-length') || 0)
    if (cl > maxBytes) {
        return { ok: false, text: '', bytes: cl }
    }

    //無串流介面時退回text(), 讀完再量
    let body = r.body
    if (!body || typeof body.getReader !== 'function') {
        let t = await r.text()
        let n = Buffer.byteLength(t)
        if (n > maxBytes) {
            return { ok: false, text: '', bytes: n }
        }
        return { ok: true, text: t, bytes: n }
    }

    //串流讀取, 邊讀邊量, 超限即取消
    let reader = body.getReader()
    let chunks = []
    let total = 0
    while (true) {
        let { done, value } = await reader.read()
        if (done) {
            break
        }
        total += value.byteLength
        if (total > maxBytes) {
            try {
                await reader.cancel()
            }
            catch (err) {}
            return { ok: false, text: '', bytes: total }
        }
        chunks.push(Buffer.from(value))
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf8'), bytes: total }
}


/**
 * 各額度查詢端點共用之HTTP請求並解析JSON
 *
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗，
 * 並將失敗歸入機器可讀之errorType，令呼叫端無須解析錯誤訊息字串即可分流處置
 *
 * @param {String} url 輸入查詢端點網址字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.method='GET'] 輸入HTTP方法字串，預設'GET'
 * @param {Object|String} [opt.body=null] 輸入請求內容，給物件時序列化為JSON並自動補Content-Type，給字串時原樣送出，預設null代表無內容
 * @param {Object} [opt.headers={}] 輸入額外HTTP標頭物件，預設{}
 * @param {Number} [opt.timeoutMs=20000] 輸入逾時毫秒正整數，涵蓋連線至本文讀完，逾時將中止連線，預設20000
 * @param {Number} [opt.maxBodyBytes=1048576] 輸入回應本文上限位元組正整數，超過即中止並回errorType 'toolarge'，預設1048576
 * @param {Array} [opt.redact=[]] 輸入須自錯誤訊息中遮蔽之機密值字串陣列(例如權杖、帳號ID)，長度不足6者不處理，預設[]
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、status(HTTP狀態碼整數，未連上為0)、data(解析後之JSON物件，失敗為null)、error(錯誤訊息字串，成功時為空字串，已套用redact)、errorType(錯誤類別字串：params/auth/forbidden/ratelimit/http/parse/timeout/network/toolarge)、durationMs(耗時毫秒)，本函數不會reject
 * @example
 * //need network
 *
 * import fetchQuotaJson from './src/quota/fetchQuotaJson.mjs'
 *
 * let test = async () => {
 *     let r = await fetchQuotaJson('https://api.anthropic.com/api/oauth/usage', {
 *         headers: { Authorization: 'Bearer xxx' },
 *     })
 *     console.log(r.ok, r.status)
 *     // => false 401
 * }
 * test()
 *
 */
async function fetchQuotaJson(url, opt = {}) {

    let t0 = Date.now()

    //rs, 各分支共用之結果骨架
    let rs = (ok, status, data, error, errorType) => {
        return {
            ok,
            status,
            data,
            error,
            errorType,
            durationMs: Date.now() - t0,
        }
    }

    //check url
    if (!isestr(url)) {
        return rs(false, 0, null, 'url must be a non-empty string', 'params')
    }

    //headers, 非物件回退空物件
    let headers = get(opt, 'headers', null)
    if (!iseobj(headers)) {
        headers = {}
    }

    //method, 無效回退GET
    let method = get(opt, 'method', null)
    if (!isestr(method)) {
        method = 'GET'
    }

    //body, 物件即序列化為JSON並補Content-Type, 字串原樣送出
    let body = get(opt, 'body', null)
    if (iseobj(body)) {
        body = JSON.stringify(body)
        if (!isestr(get(headers, 'Content-Type', null))) {
            headers = {
                ...headers,
                'Content-Type': 'application/json',
            }
        }
    }
    else if (!isestr(body)) {
        body = null
    }

    //timeoutMs
    let timeoutMs = castPintOr(get(opt, 'timeoutMs', null), dfQuotaTimeoutMs)

    //maxBodyBytes
    let maxBodyBytes = castPintOr(get(opt, 'maxBodyBytes', null), DEFAULT_MAX_BODY_BYTES)

    //redact
    let redact = get(opt, 'redact', null)
    if (!isearr(redact)) {
        redact = []
    }

    //snip, 錯誤訊息用之本文片段: 先遮蔽再截短, 避免機密值被截半後漏出
    let snip = (text) => redactText(text, redact).slice(0, 300)

    //ac, 逾時中止連線; 計時器持續至本文讀完
    let ac = new AbortController()
    let idTimer = setTimeout(() => {
        ac.abort()
    }, timeoutMs)

    let r = null
    let text = ''
    try {

        //fetch, resolve僅代表收到標頭
        try {
            r = await fetch(url, {
                method,
                headers,
                body,
                signal: ac.signal,
            })
        }
        catch (err) {
            if (get(err, 'name', '') === 'AbortError') {
                return rs(false, 0, null, `request timeout over ${timeoutMs}ms`, 'timeout')
            }
            return rs(false, 0, null, `network error: ${redactText(get(err, 'message', 'unknown'), redact)}`, 'network')
        }

        //body, 先取原文再解析, 令非JSON之錯誤頁能原樣回報而非只說解析失敗
        try {
            let rb = await readBodyCapped(r, maxBodyBytes)
            if (!rb.ok) {
                ac.abort()
                return rs(false, r.status, null, `response body too large: ${rb.bytes} bytes over limit ${maxBodyBytes}`, 'toolarge')
            }
            text = rb.text
        }
        catch (err) {
            if (get(err, 'name', '') === 'AbortError') {
                return rs(false, r.status, null, `request timeout over ${timeoutMs}ms while reading body`, 'timeout')
            }
            return rs(false, r.status, null, `read body error: ${redactText(get(err, 'message', 'unknown'), redact)}`, 'network')
        }

    }
    finally {
        clearTimeout(idTimer)
    }

    //auth, 401代表憑證本身不被接受(過期或撤銷)。此處不給處置指引——各家正確處置不同
    //(Claude/Codex之CLI會於執行時自行刷新, 貿然指引「重新登入」反而使其他工作階段失效), 由各轉接器補述
    if (r.status === 401) {
        return rs(false, r.status, null, `unauthorized(401), credential rejected (expired or revoked): ${snip(text)}`, 'auth')
    }

    //forbidden, 403代表憑證有效但此帳號無權存取該資源, 與401分流(401重新登入可解, 403重新登入一百次也一樣)
    if (r.status === 403) {
        return rs(false, r.status, null, `forbidden(403), credential valid but this account has no access to the resource (plan does not include it, or the service no longer serves this account tier): ${snip(text)}`, 'forbidden')
    }

    //ratelimit, 429為端點自身之查詢頻率限制, 與訂閱額度用罄無關
    if (r.status === 429) {
        return rs(false, r.status, null, `rate limited(429) by usage endpoint: ${snip(text)}`, 'ratelimit')
    }

    //http
    if (!r.ok) {
        return rs(false, r.status, null, `http error(${r.status}): ${snip(text)}`, 'http')
    }

    //data
    let data = null
    try {
        data = JSON.parse(text)
    }
    catch (err) {
        return rs(false, r.status, null, `invalid json: ${snip(text)}`, 'parse')
    }

    return rs(true, r.status, data, '', '')
}


export default fetchQuotaJson
