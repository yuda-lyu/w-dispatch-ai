import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'


// getErrorType.mjs — 由失敗結果推導機器可讀之errorType
//
// 【為何需要】失敗分類原本只能靠error字串前綴(TIMEOUT/ENOENT/OUTPUT_VALIDATION_FAILED...)
//   比對, 呼叫端各自重寫字串規則既脆弱又易漂移。errorType提供穩定的機器可讀分類,
//   error字串保留不動(人讀), 兩者並存。
//
// 【只判機械可判者, 不猜測】本函數僅涵蓋「由error字樣/結構即可100%確定」的類別,
//   與dispatchAiFallback之isKeyIndependentFail同一組機械判準; 各家CLI的其餘失敗
//   (額度上限/金鑰無效/服務端錯誤等, 字樣各家不同且隨版本漂移)一律歸'exec',
//   不維護簽章表(與否決金鑰停用清單同一理由, 呼叫端需細分時用coolDetect式注入自判)。
//
// 【errorType一覽(僅失敗結果帶此欄, 成功結果無)】
//   'params'           參數/設定檢核失敗(進入執行前即被擋, getErrorResult預設)
//   'timeout'          逾時(execCli強殺或API abort, error以TIMEOUT開頭)
//   'spawn'            子進程無法啟動(執行檔不存在ENOENT/命令列過長ENAMETOOLONG)
//   'validation'       stdout未過validate(OUTPUT_VALIDATION_FAILED)
//   'exec'             CLI非零離開碼之一般執行失敗(未能再機械細分)
//   'http'             HTTP非2xx(code為狀態碼, 僅api類)
//   'fetch'            網路層錯誤(DNS/連線拒絕, 僅api類)
//   'tool-unsupported' 模型回tool_calls而本轉接器不支援工具(僅api類)
//   'invalid-response' 回應缺choices[0].message.content(僅api類)
//   'aborted'          shouldStop中止(僅dispatchAiFallback)
//   'budget'           時間預算用盡(僅dispatchAiFallback)


/**
 * 由失敗結果物件推導機器可讀之errorType(僅機械可判者，其餘歸'exec'，不猜測)
 *
 * 判準與dispatchAiFallback之isKeyIndependentFail同組：error以TIMEOUT開頭為'timeout'、
 * 含ENOENT或ENAMETOOLONG為'spawn'、恰為OUTPUT_VALIDATION_FAILED為'validation'，
 * 其餘失敗一律'exec'(各家CLI字樣不同且隨版本漂移，不維護簽章表)
 *
 * @param {Object} r 輸入失敗結果物件(取其error欄位判別)
 * @returns {String} 回傳errorType字串
 * @example
 *
 * import getErrorType from './src/getErrorType.mjs'
 *
 * console.log(getErrorType({ error: 'TIMEOUT after 300s' }))
 * // => 'timeout'
 *
 * console.log(getErrorType({ error: 'spawn cli ENOENT' }))
 * // => 'spawn'
 *
 * console.log(getErrorType({ error: 'Exit code 1' }))
 * // => 'exec'
 *
 */
function getErrorType(r) {
    let error = get(r, 'error', '')
    if (!isestr(error)) {
        return 'exec'
    }
    if (error.indexOf('TIMEOUT') === 0) {
        return 'timeout'
    }
    if (error.includes('ENOENT') || error.includes('ENAMETOOLONG')) {
        return 'spawn'
    }
    if (error === 'OUTPUT_VALIDATION_FAILED') {
        return 'validation'
    }
    return 'exec'
}


/**
 * 失敗結果補上errorType欄位(已帶有效errorType或成功結果則原樣回傳)
 *
 * @param {Object} r 輸入結果物件
 * @returns {Object} 回傳結果物件，失敗且未帶errorType時追加之
 * @example
 *
 * import { attachErrorType } from './src/getErrorType.mjs'
 *
 * console.log(attachErrorType({ ok: false, error: 'TIMEOUT after 10s' }).errorType)
 * // => 'timeout'
 *
 * console.log(attachErrorType({ ok: true, stdout: 'abc' }).errorType)
 * // => undefined
 *
 */
function attachErrorType(r) {
    if (get(r, 'ok', false) === true) {
        return r
    }
    if (isestr(get(r, 'errorType', null))) {
        return r
    }
    return { ...r, errorType: getErrorType(r) }
}


export default getErrorType
export { attachErrorType }
