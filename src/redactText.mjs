import isestr from 'wsemi/src/isestr.mjs'


// redactText.mjs — 錯誤訊息中之機密值遮蔽(單一來源)
//
// 【為何獨立成檔】額度查詢(fetchQuotaJson)與三家REST轉接器之錯誤訊息皆可能夾帶機密值:
//   前者為對端回顯之請求標頭, 後者為fetch在送出前驗標頭時之例外——金鑰含換行等非法字元時,
//   undici之訊息為「Headers.append: "Bearer <完整金鑰>" is an invalid header value.」,
//   經遞補層流入tried、事件與日誌(2026-10-14實測)。兩處共用同一遮蔽規則, 不各自手寫。


//遮蔽替代文字; 短於此長度之機密值不遮(避免把常見短字串誤遮成無法閱讀)
let REDACT_MASK = '[REDACTED]'
let REDACT_MIN_LEN = 6


/**
 * 將文字中之機密值替換為遮蔽字
 *
 * @param {String} text 輸入文字
 * @param {Array} redact 輸入機密值字串陣列，長度不足6者不處理
 * @returns {String} 回傳替換後文字
 * @example
 *
 * import redactText from './src/redactText.mjs'
 *
 * console.log(redactText('Headers.append: "Bearer sk-abc\nX" is an invalid header value.', ['Bearer sk-abc\nX']))
 * // => 'Headers.append: "[REDACTED]" is an invalid header value.'
 *
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
 * 取請求標頭中須遮蔽之值：固定之Content-Type與Accept-Encoding以外一律視為機密(Authorization、x-api-key等)
 *
 * @param {Object} headers 輸入請求標頭物件
 * @returns {Array} 回傳須遮蔽之標頭值字串陣列
 * @example
 *
 * import { secretHeaderValues } from './src/redactText.mjs'
 *
 * console.log(secretHeaderValues({ 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-abc' }))
 * // => [ 'Bearer sk-abc' ]
 *
 */
function secretHeaderValues(headers) {
    let r = []
    let hs = (headers && typeof headers === 'object') ? headers : {}
    for (let k of Object.keys(hs)) {
        if (['content-type', 'accept-encoding'].includes(k.toLowerCase())) {
            continue
        }
        if (isestr(hs[k])) {
            r.push(hs[k])
        }
    }
    return r
}


export default redactText
export { secretHeaderValues }
