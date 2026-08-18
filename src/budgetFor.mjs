import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import castPintOr from './castPintOr.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'


// budgetFor.mjs — 由供應商鏈推導走滿全鏈之時間預算
//
// 【為何屬本套件】「逾時型失敗每組只燒一次timeout即跳組, 故走滿全鏈的上限＝各組
//   timeout相加」是dispatchAiFallback失敗分流模型的直接推論。消費端手算此值,
//   會在改動fallback鏈時忘記同步而再度budget exhausted(使用端殷鑑: 2026-08-14
//   revise名額之預算未跟上鏈變動而失敗); 或於設定檔維護一大段人工反推註解。
//
// 【與外部排程上限的關係】本函數給的是「保證能遞補到鏈尾」的值; 呼叫端之外層
//   常另有硬上限(如Windows排程ExecutionTimeLimit), 兩者取小者交budgetMs即可——
//   截短的取捨(可能走不完全鏈)由呼叫端自行決定。


/**
 * 計算遞補鏈走滿所需之時間預算(＝各條目timeoutMs之總和, 未帶者以套件統一預設計)
 *
 * 特點：
 * 條目timeoutMs取正整數者計入，未帶或無效者以dfTimeoutMs(全套件統一預設300000)計——
 * 與dispatchAiFallback執行時之實際取值一致，故總和即為走滿全鏈之上限；
 * 輸入非陣列回傳0
 *
 * @param {Array} providers 輸入供應商條目物件陣列(dispatchAiFallback之providers)
 * @returns {Number} 回傳時間預算毫秒整數
 * @example
 *
 * import budgetFor from './src/budgetFor.mjs'
 *
 * console.log(budgetFor([{ timeoutMs: 180000 }, { timeoutMs: 240000 }]))
 * // => 420000
 *
 * console.log(budgetFor([{ timeoutMs: 180000 }, {}])) //未帶者以套件統一預設300000計
 * // => 480000
 *
 */
function budgetFor(providers) {
    if (!isarr(providers)) {
        return 0
    }
    let n = 0
    for (let p of providers) {
        n += castPintOr(get(p, 'timeoutMs', null), dfTimeoutMs)
    }
    return n
}


export default budgetFor
