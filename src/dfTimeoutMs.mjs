// dfTimeoutMs.mjs — 全套件統一之預設逾時毫秒(單一來源)
//
// 【為何統一】各轉接器與各層若各有預設(曾為CLI 120s/agy 300s/api 120s),
//   呼叫方難以理解為何不一致; 統一後呼叫方只需記一個數字, 要改就由opt傳入覆寫。
//
// 【為何取300000(5分鐘)】原依早期文件所載對齊agy自身print-timeout之預設5m0s(舊版實際預設未於本案重驗; agy 1.4.0之--help載明預設為0s=等到完成,
//   此數值不再以對齊為依據, dispatchAntigravity亦改令外層timeoutMs先於agy自身計時到時);
//   agy為agent型CLI, 實測合法執行可達116秒, 統一成120秒會誤殺;
//   快速任務有需要可自行下調, 複雜任務(如單一AI工作15分鐘)依README之Timeout規劃上調。


/**
 * 全套件統一之預設逾時毫秒
 *
 * @returns {Number} 回傳預設逾時毫秒整數300000(5分鐘)
 * @example
 *
 * import dfTimeoutMs from './src/dfTimeoutMs.mjs'
 *
 * console.log(dfTimeoutMs)
 * // => 300000
 *
 */
let dfTimeoutMs = 300000


export default dfTimeoutMs
