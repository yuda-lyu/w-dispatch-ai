import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'


/**
 * 正整數正規化：有效正整數即轉整數回傳，否則回傳預設值
 *
 * 本套件各層之數值設定(timeoutMs、budgetMs、minAttemptMs、cooldownMs、retryDelayMs等)
 * 皆採同一寬容策略「無效即靜默回退預設」，統一收斂於此，
 * 避免同一7行判斷區塊散落各轉接器(曾重複6處)
 *
 * @param {*} v 輸入待正規化之值
 * @param {*} df 輸入無效時之預設值(可為null代表不限)
 * @returns {Number|*} 回傳正規化後之正整數，v非有效正整數時回傳df
 * @example
 *
 * import castPintOr from './src/castPintOr.mjs'
 *
 * console.log(castPintOr(5000, 300000))
 * // => 5000
 *
 * console.log(castPintOr('abc', 300000))
 * // => 300000
 *
 * console.log(castPintOr(undefined, null))
 * // => null
 *
 */
function castPintOr(v, df) {
    if (!ispint(v)) {
        return df
    }
    return cint(v)
}


export default castPintOr
