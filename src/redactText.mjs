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


// 【Anthropic金鑰樣式遮蔽(2026-10-24, dispatchClaude之key與dispatchApiAnthropic共用)】
//   Anthropic金鑰一律以sk-ant-開頭(sk-ant-api03-…、sk-ant-admin01-…等)。除遮蔽「本次注入之金鑰本身」外,
//   另以樣式遮蔽失敗輸出中的sk-ant-字樣: 子進程輸出或錯誤本體經strTruncate等截斷後, 金鑰可能只剩前段(殘段仍含金鑰前綴實質內容),
//   精確比對遮蔽不到; 他把金鑰(例如CLI回顯另一組設定)亦同。後綴至少4字元才遮蔽, 更短者無實質內容, 保留以免誤遮一般字串。
//   僅用於「失敗結果與診斷輸出」: 成功結果中模型的輸出可能合法含「sk-ant-api03-…」範例字樣(如金鑰說明文件之摘要), 不套用樣式遮蔽。
let API_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{4,}/g


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


/**
 * 遮蔽文字中sk-ant-形式之Anthropic金鑰(含被截斷而只剩前段之殘段；後綴不足4字元者保留)
 *
 * @param {String} text 輸入文字
 * @returns {String} 回傳替換後文字
 * @example
 *
 * import { maskApiKeys } from './src/redactText.mjs'
 *
 * console.log(maskApiKeys('key=sk-ant-api03-ABCDEF_123-xyz end'))
 * // => 'key=[REDACTED] end'
 *
 */
function maskApiKeys(text) {
    return String(text).replace(API_KEY_PATTERN, REDACT_MASK)
}


/**
 * 先遮蔽指定機密值，再遮蔽sk-ant-形式之Anthropic金鑰(失敗結果與診斷輸出之單一入口)
 *
 * @param {String} text 輸入文字
 * @param {Array} redact 輸入機密值字串陣列，長度不足6者不處理
 * @returns {String} 回傳替換後文字
 * @example
 *
 * import { redactApiKeyText } from './src/redactText.mjs'
 *
 * console.log(redactApiKeyText('a MYSECRET-VALUE b sk-ant-api03-OTHER-1 c', ['MYSECRET-VALUE']))
 * // => 'a [REDACTED] b [REDACTED] c'
 *
 */
function redactApiKeyText(text, redact) {
    return maskApiKeys(redactText(text, redact))
}


/**
 * 建立串流遮蔽器：逐塊餵入文字，回傳可安全輸出之已遮蔽文字；跨塊被切開之機密值以「尾端保留」處理
 *
 * 特點：
 * 每塊輸出前，把尾端「可能是機密值開頭」之部分(機密值之真前綴；pattern為true時另含`sk-ant-`樣式之未完成尾段)留到下一塊再判斷，
 * 且保留位置不切在已完整出現之機密值中間；結束時須呼叫flush()取回保留之尾端；
 * 供CLI之onStdout／onStderr回調使用(execCli逐塊呼叫，金鑰可能被切在兩塊之間)
 *
 * @param {Array} secrets 輸入機密值字串陣列，長度不足6者不處理(同redactText)
 * @param {Boolean} [pattern=false] 輸入是否另遮蔽`sk-ant-`樣式，預設false(僅精確遮蔽)
 * @returns {Object} 回傳物件，內含push(chunk)=>已遮蔽文字字串、flush()=>保留尾端之已遮蔽文字字串
 * @example
 *
 * import { createStreamRedactor } from './src/redactText.mjs'
 *
 * let rd = createStreamRedactor(['sk-ant-api03-SECRET-123456'])
 * let out = rd.push('key=sk-ant-api03-SEC') + rd.push('RET-123456 end') + rd.flush()
 * console.log(out)
 * // => 'key=[REDACTED] end'
 *
 */
function createStreamRedactor(secrets, pattern = false) {
    let list = (Array.isArray(secrets) ? secrets : []).filter((v) => isestr(v) && v.length >= REDACT_MIN_LEN)
    let hold = ''
    let mask = (s) => pattern ? redactApiKeyText(s, list) : redactText(s, list)

    //keepLen, 尾端須保留之長度: 最長之「機密值真前綴」尾段, 與(pattern時)未完成之sk-ant-樣式尾段; 再避免切在完整出現之機密值或樣式中間
    let keepLen = (s) => {
        let k = 0
        for (let v of list) {
            for (let n = Math.min(v.length - 1, s.length); n > k; n--) {
                if (s.endsWith(v.slice(0, n))) {
                    k = n
                    break
                }
            }
        }
        if (pattern) {
            let m = /(?:sk-ant-[A-Za-z0-9_-]*|sk-ant|sk-an|sk-a|sk-|sk|s)$/.exec(s)
            if (m && m[0].length > k) {
                k = m[0].length
            }
        }
        let cut = s.length - k
        let spans = []
        for (let v of list) {
            for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + 1)) {
                spans.push([i, i + v.length])
            }
        }
        if (pattern) {
            for (let m of s.matchAll(API_KEY_PATTERN)) {
                spans.push([m.index, m.index + m[0].length])
            }
        }
        let moved = true
        while (moved) {
            moved = false
            for (let [a, b] of spans) {
                if (a < cut && cut < b) {
                    cut = a
                    moved = true
                }
            }
        }
        return s.length - cut
    }

    return {
        push(chunk) {
            let s = hold + String(chunk)
            let k = keepLen(s)
            hold = s.slice(s.length - k)
            return mask(s.slice(0, s.length - k))
        },
        flush() {
            let out = mask(hold)
            hold = ''
            return out
        },
    }
}


export default redactText
export { secretHeaderValues, maskApiKeys, redactApiKeyText, createStreamRedactor }
