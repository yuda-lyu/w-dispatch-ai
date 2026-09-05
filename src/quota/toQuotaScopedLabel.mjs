import isestr from 'wsemi/src/isestr.mjs'
import toQuotaLabel from './toQuotaLabel.mjs'


// toQuotaScopedLabel.mjs — 組出帶適用範圍之額度窗口標籤(單一來源)
//
// 【為何獨立成檔】三個額度轉接器都要把「窗口長度」與「範圍」拼成「7天(Fable)」「5小時(Gemini Models)」
//   這類標籤, 同一段拼接規則曾於fromCodexUsageHttp/getQuotaClaude/getQuotaCodex各手寫一份——
//   依全域規範「同一規則手寫≥2處即補丁訊號」收斂於此。基底一律取自toQuotaLabel,
//   窗口長度變動時標籤自動跟著正確, 不得手寫「7天」字串。


/**
 * 組出帶適用範圍之額度窗口標籤
 *
 * 無範圍時回傳空字串，令toQuotaWindow自行由windowSeconds推導預設標籤；
 * 有範圍但窗口秒數無效(供應商未提供)時僅以範圍為標籤
 *
 * @param {Number} windowSeconds 輸入窗口長度秒數
 * @param {String} scope 輸入適用範圍字串，例如模型名或群組名
 * @returns {String} 回傳標籤字串，例如'7天(Fable)'；無範圍回傳''
 * @example
 *
 * import toQuotaScopedLabel from './src/quota/toQuotaScopedLabel.mjs'
 *
 * console.log(toQuotaScopedLabel(604800, 'Fable'))
 * // => 7天(Fable)
 *
 * console.log(toQuotaScopedLabel(null, 'codex-spark'))
 * // => codex-spark
 *
 * console.log(toQuotaScopedLabel(18000, ''))
 * // => (空字串)
 *
 */
function toQuotaScopedLabel(windowSeconds, scope) {
    if (!isestr(scope)) {
        return ''
    }
    let base = toQuotaLabel(windowSeconds)
    return base === '' ? scope : `${base}(${scope})`
}


export default toQuotaScopedLabel
