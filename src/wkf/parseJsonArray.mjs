import isarr from 'wsemi/src/isarr.mjs'
import extractJsonLoose from './extractJsonLoose.mjs'


// parseJsonArray.mjs — 嚴格版JSON陣列解析(與工作流層之寬鬆/搶救版刻意並存)
//
// 【與批次JSON任務層之分工】批次層(callAiWithFallback之預設parse＋salvageTruncatedArray)取「最後一段合格JSON」,
//   且截斷放行時可搶救前段(部分接受); 本檔為嚴格版: 取第一個完整片段, 括號未閉合(輸出被截斷)即回null,
//   不搶救半成品——逐則推送之實戰結論: 缺項輸出即不完整, 寧可換家重產。
//   兩者語意相反、各有依據, 刻意並存, 由呼叫端選(截斷之兩種策略: 換家重產 vs 搶救前段)。


/**
 * 嚴格解析AI回覆中之JSON陣列：取第一個完整片段，非陣列或括號未閉合(截斷)一律回null
 *
 * 特點：
 * 即extractJsonLoose之陣列限定版(先去ANSI色碼與code fence、括號配對取第一個完整物件或陣列)，結果不是陣列即回null；
 * 不搶救截斷之半成品(要搶救前段請用salvageTruncatedArray)；
 * 不throw，輸入非字串視為空
 *
 * @param {String} stdout 輸入AI回覆文字字串
 * @returns {Array|null} 回傳解析成功之陣列，失敗(非JSON、非陣列、截斷)回傳null
 * @example
 *
 * import parseJsonArray from './src/wkf/parseJsonArray.mjs'
 *
 * console.log(parseJsonArray('說明\n```json\n[{"index":1,"t":"a"}]\n```'))
 * // => [ { index: 1, t: 'a' } ]
 *
 * console.log(parseJsonArray('{"index":1}')) //物件不是陣列
 * // => null
 *
 * console.log(parseJsonArray('[{"index":1},{"index":2')) //截斷, 不搶救
 * // => null
 *
 */
function parseJsonArray(stdout) {
    let j = extractJsonLoose(stdout)
    return isarr(j) ? j : null
}


export default parseJsonArray
