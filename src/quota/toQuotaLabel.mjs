import isnum from 'wsemi/src/isnum.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'


// toQuotaLabel.mjs — 由額度窗口長度秒數推導人類可讀之中文標籤(單一來源)
//
// 【為何獨立成檔】toQuotaWindow推導預設標籤用它; 各轉接器對「帶模型別或群組別」之窗口
//   須自組「7天(Fable)」「5小時(Gemini)」這類標籤, 也用它取基底。
//   原版把此邏輯藏在toQuotaWindow內部, 轉接器只好各自手寫「7天(」字串,
//   結果session窗口與weekly窗口之標籤不對稱(前者漏了「5小時」基底); 抽出後只剩一份規則。
//
// 【為何由秒數推導而非寫死】寫死「5小時/7天」等於把當下的窗口長度當成永久事實,
//   供應商調整窗口時字面會說謊且無人察覺; 由秒數推導則窗口一變標籤即隨之正確。


//每分鐘/每小時/每日之秒數
let SEC_MIN = 60
let SEC_HOUR = 3600
let SEC_DAY = 86400


/**
 * 由額度窗口長度秒數推導人類可讀之中文標籤
 *
 * 能整除日數即以「N天」表示，其次「N小時」、「N分鐘」，皆不整除則「N秒」；
 * 無效或非正數回傳空字串，令呼叫端可用空字串判斷「供應商未提供窗口長度」
 *
 * @param {Number} sec 輸入窗口長度秒數
 * @returns {String} 回傳中文標籤字串，無效秒數回傳空字串
 * @example
 *
 * import toQuotaLabel from './src/quota/toQuotaLabel.mjs'
 *
 * console.log(toQuotaLabel(18000))
 * // => 5小時
 *
 * console.log(toQuotaLabel(604800))
 * // => 7天
 *
 * console.log(toQuotaLabel(900))
 * // => 15分鐘
 *
 * console.log(toQuotaLabel(null))
 * // => (空字串)
 *
 */
function toQuotaLabel(sec) {

    //check, 無效或非正數無從推導
    if (!isnum(sec) || cdbl(sec) <= 0) {
        return ''
    }
    sec = cdbl(sec)

    //day
    if (sec % SEC_DAY === 0) {
        return `${sec / SEC_DAY}天`
    }

    //hour
    if (sec % SEC_HOUR === 0) {
        return `${sec / SEC_HOUR}小時`
    }

    //minute
    if (sec % SEC_MIN === 0) {
        return `${sec / SEC_MIN}分鐘`
    }

    return `${sec}秒`
}


export default toQuotaLabel
