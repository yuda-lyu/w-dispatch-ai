import iseint from 'wsemi/src/iseint.mjs'


/**
 * 正整數正規化：有效正整數即轉整數回傳，否則回傳預設值
 *
 * 本套件各層之數值設定(minAttemptMs、cooldownMs、retryDelayMs、budgetMs之建構值等)
 * 皆採同一寬容策略「無效即靜默回退預設」，統一收斂於此，
 * 避免同一7行判斷區塊散落各轉接器(曾重複6處)
 *
 * 判定(2026-11-13 da-hy, 帳本G17: opt之數值以ise*判定「可計算」, 不以ispint通過後cint):
 * 1～Number.MAX_SAFE_INTEGER之整數(數字，或可無損轉數字之十進位字串)為有效；
 * Infinity(含'Infinity')、NaN、小數、0、負數、'0x10'等非十進位字串、包裝物件、陣列、BigInt、布林、null、未給皆無效(舊判定ispint把Infinity、'0x10'、包裝物件當有效，
 * 再經cint得1.797e308、16、5000等非預期之值)。
 * 逾時毫秒(timeoutMs)另有計時器上限2147483647，不經本函數，見castTimerMs
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
 * console.log(castPintOr(Infinity, 300000))
 * // => 300000
 *
 * console.log(castPintOr(undefined, null))
 * // => null
 *
 */
function castPintOr(v, df) {
    if (!iseint(v, { min: 1 })) {
        return df
    }
    return Number(typeof v === 'string' ? v.trim() : v) //檢測之值即使用之值(K4)
}


export default castPintOr
