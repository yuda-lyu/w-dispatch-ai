import iseint from 'wsemi/src/iseint.mjs'


// castTimerMs.mjs — 計時毫秒設定(timeoutMs)之正規化(單一份; 2026-11-13 da-hy, 排程第438項; 帳本R-TIMEOUT-1、G17)
//
// 【規則】有效才採用: 1～2147483647之整數(數字, 或可無損轉數字之十進位字串; 判定即wsemi iseint之use:'timer'、min:1,
//   與wsemi 1.9.59起execCli之timeoutMs判定相同); 其餘一律回預設, 不夾至上限、不報錯:
//   0、負數、小數、超過計時器上限2147483647、Infinity(含'Infinity')、NaN、'0x10'等非十進位字串、包裝物件、陣列、BigInt、布林、null、未給。
// 【為何不用舊判定(ispint通過後cint)】舊判定以ispint(數學定義之正整數, Infinity為真)通過後cint: Infinity變1.7976931348623157e308、'0x10'變16、new Number(5)變5、
//   超過計時器上限之值原樣通過; 轉交execCli(1.9.59起以iseint判定)時: 1.797e308與超過上限者被execCli判為無效而改用「它自己的」預設120000(外層實際為120秒, 本套件之預設為300000, 兩層不一致),
//   '0x10'(16)與包裝物件(5000)則被當有效而得16毫秒／原值(非預期之採用); REST類入口把原值交setTimeout, 超過2147483647者被Node視為1毫秒(立即逾時)。
//   故timeoutMs於本套件各入口一律先經本函數(帳本G17: opt之毫秒數以ise*判定「可計算」)。
// 【檢測之值即使用之值(K4)】通過iseint者以Number(trim後之字串)轉為number回傳, 不交原值。
// 【不適用】budgetMs等「執行期剩餘時間」見castBudgetMs; 其餘毫秒設定(minAttemptMs、cooldownMs、retryDelayMs等)非timeoutMs之判定, 依各自語意(見帳本R-TIMEOUT-1之盤點表)。


let TIMER_RULE = { use: 'timer', min: 1 }


/**
 * 計時毫秒設定(timeoutMs)之正規化：有效(1～2147483647之整數或其十進位數字字串)回該數值，其餘回預設值，不夾上限
 *
 * @param {*} v 輸入待正規化之值
 * @param {*} df 輸入無效時之預設值(可為null代表未給)
 * @returns {Number|*} 回傳有效時之整數毫秒，v非有效值時回傳df
 * @example
 *
 * import castTimerMs from './src/castTimerMs.mjs'
 *
 * console.log(castTimerMs(5000, 300000), castTimerMs('5000', 300000), castTimerMs(2147483647, 300000))
 * // => 5000 5000 2147483647
 *
 * console.log(castTimerMs(2147483648, 300000), castTimerMs(Infinity, 300000), castTimerMs('0x10', 300000), castTimerMs(1.5, 300000))
 * // => 300000 300000 300000 300000
 *
 * console.log(castTimerMs(undefined, null))
 * // => null
 *
 */
function castTimerMs(v, df) {
    if (!iseint(v, TIMER_RULE)) {
        return df
    }
    return Number(typeof v === 'string' ? v.trim() : v)
}


export default castTimerMs
