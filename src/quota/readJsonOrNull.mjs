import get from 'lodash-es/get.js'
import fsReadJson from 'wsemi/src/fsReadJson.mjs'


// readJsonOrNull.mjs — 讀取JSON檔, 任何失敗一律回null
//
// 【為何獨立成檔】三個額度轉接器都要讀各自CLI之憑證或設定檔, 且處置一致(檔案不存在、
//   無權限、內容非JSON皆視為「取不到」而非錯誤); 同一段判斷曾各自手寫三份,
//   依全域規範「同一規則手寫≥2處即補丁訊號」收斂於此。
//
// 【為何包wsemi之fsReadJson而非自寫try/catch】fsReadJson已是套件內讀JSON之canonical實作
//   (純JSON.parse, 無型別轉換), 以{ success }/{ error }回報; 本檔只把它收斂成
//   「成功回值、失敗回null」之單一契約, 令呼叫端不必每處都判斷error鍵。


/**
 * 讀取JSON檔，任何失敗一律回傳null
 *
 * 檔案不存在、無讀取權限、內容非合法JSON三種情形對呼叫端而言皆為「取不到」，
 * 無須區分，故一律回null，由呼叫端決定後續處置(例如回報未登入)
 *
 * @param {String} fp 輸入檔案路徑字串
 * @returns {Object|Array|null} 回傳解析後之JSON值，讀取或解析失敗回傳null
 * @example
 *
 * import readJsonOrNull from './src/quota/readJsonOrNull.mjs'
 *
 * console.log(readJsonOrNull('./package.json') !== null)
 * // => true
 *
 * console.log(readJsonOrNull('./no-such-file.json'))
 * // => null
 *
 */
function readJsonOrNull(fp) {
    let rj = fsReadJson(fp)
    return get(rj, 'success', null)
}


export default readJsonOrNull
