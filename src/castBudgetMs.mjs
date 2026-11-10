import isenum from 'wsemi/src/isenum.mjs'


// castBudgetMs.mjs — 執行期「剩餘時間」之正規化(單一份; 2026-11-11 da402／di402, 主控裁示D11採甲)
//
// 【兩類宣告(輸入參數之檢測機制K1: 種類由程式碼宣告)】
//   ①執行期之剩餘時間: dispatchAiFallback之budgetMs、createAiCaller之callAI逐次budgetMs、工作流(runFanout之整合段、runRolePipeline之各階段)
//     扣除prompt等待後之預算——本函數之對象。值是「呼叫端此刻還剩多少時間」, 0或負代表已無時間, 不得當成不限;
//   ②設定值: createAiCaller之建構budgetMs、呼叫端設定檔之席位budgetMs——非正整數依K3視為未給(不限), 不經本函數(沿用castPintOr)。
//
// 【規則】有限數或數字字串(K7, 格式同dspec〈輸入參數之檢測機制〉§3.1, 由wsemi isenum判定)為有效:
//   ≤0 → 0(已無時間: 遞補層不送出、回budget exhausted);
//   小數取整(向下, 收嚴; 0~1毫秒 → 0);
//   超出安全整數(K6) → 不限(null);
//   -Infinity → 0(負無限即已無時間; 原則1預設拒絕、原則3衝突收嚴);
//   +Infinity、未給(undefined／null)、非數值(含NaN、'Infinity'、'0x10'等非十進位字串、物件) → 不限(null)。
//   修前(castPintOr)之差異: 0、負、小數皆被當不限(探測P3～P5), +Infinity得1.797e308之有限數。


/**
 * 執行期剩餘時間(budgetMs)之正規化：有限數或數字字串為有效，≤0回0(已無時間)、小數向下取整，+Infinity、未給或非數值回null(不限)
 *
 * @param {*} v 輸入剩餘時間毫秒(數字或數字字串)
 * @returns {Number|null} 回傳非負整數毫秒(0代表已無時間)，或null(不限)
 * @example
 *
 * import castBudgetMs from './src/castBudgetMs.mjs'
 *
 * console.log(castBudgetMs(1500), castBudgetMs('1500'), castBudgetMs(1200.5), castBudgetMs(0.5))
 * // => 1500 1500 1200 0
 *
 * console.log(castBudgetMs(0), castBudgetMs(-100), castBudgetMs(-Infinity))
 * // => 0 0 0
 *
 * console.log(castBudgetMs(undefined), castBudgetMs(null), castBudgetMs(Infinity), castBudgetMs('abc'), castBudgetMs(NaN))
 * // => null null null null null
 *
 */
function castBudgetMs(v) {
    if (v === -Infinity) {
        return 0
    }
    if (!isenum(v)) {
        return null //未給、+Infinity、NaN、非數值字串、物件皆不限
    }
    let n = Number(typeof v === 'string' ? v.trim() : v) //檢測之值即使用之值(K4): isenum已確認為十進位有限數
    n = Math.floor(n)
    if (n <= 0) {
        return 0
    }
    if (n > Number.MAX_SAFE_INTEGER) {
        return null
    }
    return n
}


export default castBudgetMs
