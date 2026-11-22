import iseint from 'wsemi/src/iseint.mjs'


// castCountOr.mjs — 次數類設定(maxRetries、keepDays、minCandidates、maxLengths之上限、topN、coolAfterFails、游標等)之正規化(單一份; 2026-11-22 排程第446項; 帳本R-COUNT-1、G17)
//
// 【規則】有效才採用: 以wsemi iseint之use:'count'判定(0～4294967295之整數, 數字或可無損轉數字之十進位字串; 呼叫端以min指定下界, 0或1),
//   其餘一律回預設(K3: 非預期之值視為未給), 不夾至上限、不報錯:
//   Infinity(含'Infinity')、NaN、小數、負數、'0x10'等非十進位字串、超過4294967295之值(含1e10)、包裝物件、陣列、BigInt、布林、null、未給。
// 【為何不用舊判定(isp0int／ispint／isint通過後cint)】舊判定為數學定義之「是否整數」: Infinity為真且cint得1.7976931348623157e308(次數類即近乎無限重試, 外審terra #4)、
//   '0x10'為真且得16、超過4294967295者原樣通過(轉交wsemi execCli時被其判為無效而改用0, 兩層不一致)。帳本G17: opt之數值以ise*判定「可計算」, 不以is*通過後cint。
// 【檢測之值即使用之值(K4)】通過iseint者以Number(trim後之字串)轉為number回傳, 不交原值。
// 【不適用】計時毫秒見castTimerMs(逾時)與castPintOr(其餘毫秒設定); 索引類(游標)與時間戳以iseint之index／timestamp用途就地判定(見各站點)。


/**
 * 次數類設定之正規化：有效(count範圍內之整數或其十進位數字字串，且不小於min)回該數值，其餘回預設值
 *
 * @param {*} v 輸入待正規化之值
 * @param {*} df 輸入無效時之預設值
 * @param {Number} [min=0] 輸入下界(含)整數，0或1，預設0
 * @returns {Number|*} 回傳有效時之整數，v無效時回傳df
 * @example
 *
 * import castCountOr from './src/castCountOr.mjs'
 *
 * console.log(castCountOr(2, 0), castCountOr('2', 0), castCountOr(' 2 ', 0), castCountOr(0, 5))
 * // => 2 2 2 0
 *
 * console.log(castCountOr(Infinity, 0), castCountOr('0x2', 0), castCountOr(4294967296, 0), castCountOr(1.5, 0), castCountOr(-1, 0))
 * // => 0 0 0 0 0
 *
 * console.log(castCountOr(0, 14, 1), castCountOr(undefined, 14, 1))
 * // => 14 14
 *
 */
function castCountOr(v, df, min = 0) {
    if (!iseint(v, { use: 'count', min })) {
        return df
    }
    return Number(typeof v === 'string' ? v.trim() : v) //檢測之值即使用之值(K4)
}


export default castCountOr
