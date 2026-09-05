// dfQuotaTimeoutMs.mjs — 額度查詢類函數統一之預設逾時毫秒(單一來源)
//
// 【為何不沿用dfTimeoutMs】dfTimeoutMs(300000)是為agent型CLI之單次推論而設,
//   該類任務實測可達116秒故須寬放; 額度查詢是單次HTTP或一次唯讀CLI呼叫,
//   給5分鐘只會讓斷網或DNS異常的呼叫端空等5分鐘。
//
// 【為何取20000】HTTP查詢正常在1秒內; codex app-server握手加兩次讀取實測約2秒;
//   留給TLS握手、跨海延遲與冷啟動充裕餘裕, 又不至於讓失敗案例卡住呼叫端。
//   agy之print模式實測5~8秒(含啟動、認證、兩個後端往返), 其轉接器另以較寬之預設覆寫, 見getQuotaAntigravity。


/**
 * 額度查詢類函數統一之預設逾時毫秒
 *
 * @returns {Number} 回傳預設逾時毫秒整數20000(20秒)
 * @example
 *
 * import dfQuotaTimeoutMs from './src/quota/dfQuotaTimeoutMs.mjs'
 *
 * console.log(dfQuotaTimeoutMs)
 * // => 20000
 *
 */
let dfQuotaTimeoutMs = 20000


export default dfQuotaTimeoutMs
