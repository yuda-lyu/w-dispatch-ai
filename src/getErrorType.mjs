import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'


// getErrorType.mjs — 由失敗結果推導機器可讀之errorType
//
// 【為何需要】失敗分類原本只能靠error字串前綴(TIMEOUT/ENOENT/OUTPUT_VALIDATION_FAILED...)
//   比對, 呼叫端各自重寫字串規則既脆弱又易漂移。errorType提供穩定的機器可讀分類,
//   error字串保留不動(人讀), 兩者並存。
//
// 【只判機械可判者, 不猜測】本函數僅涵蓋「由error字樣/結構即可100%確定」的類別;
//   dispatchAiFallback之isKeyIndependentFail直接取用本函數產出之'spawn'與'params'分流(單一來源, 不另寫字串規則);
//   各家CLI的其餘失敗(額度上限/金鑰無效/服務端錯誤等, 字樣各家不同且隨版本漂移)一律歸'exec',
//   不維護簽章表(與否決金鑰停用清單同一理由, 呼叫端需細分時用coolDetect式注入自判)。
//
// 【'spawn'以結構判定, 不列錯誤碼(wsemi>=1.9.15)】子進程未能啟動時execCli之結果code為null且pid為undefined
//   (同步拋錯與'error'事件兩路皆然, 且兩路皆帶自有之pid鍵; node文件: 子進程未能spawn時subprocess.pid為undefined),
//   已啟動者(逾時、非零離開、訊號結束)皆帶pid。錯誤碼隨平台與成因而異, 2026-10-14本機實測即有ENOENT(執行檔不存在、
//   cwd不存在、路徑為資料夾)、UNKNOWN(非有效PE)、EFTYPE(零位元組.exe、.ps1)、EPERM(ACL拒絕)、ENAMETOOLONG(命令列過長)、
//   ERR_INVALID_ARG_VALUE(參數或環境變數含空字元), 列舉必漏(如EFTYPE), 故以結構判定。
//   判定限於帶自有pid鍵之物件(execCli結果): REST結果與getErrorResult物件亦為code null且無pid, 若不限定會被誤判為spawn。
//   已知限制: .cmd/.bat經cmd.exe退路啟動者(路徑不存在、shim入口缺失)係cmd.exe或node已啟動後才以離開碼1結束,
//   帶pid, 歸'exec'(見wsemi之buildSpawnArgs)。不帶pid鍵之輸入(非execCli結果)以ENOENT/ENAMETOOLONG字樣判定。
//
// 【errorType一覽(僅失敗結果帶此欄, 成功結果無)】
//   'params'           參數/設定檢核失敗(進入執行前即被擋, getErrorResult預設)
//   'timeout'          逾時(execCli強殺或API abort, error以TIMEOUT開頭)
//   'spawn'            子進程未能啟動(execCli結果之code為null且帶pid鍵而值為undefined, 見isSpawnFail; 如執行檔不存在、
//                      非有效執行檔、權限不足、命令列過長、參數或環境變數含空字元、cwd不存在)
//   'validation'       stdout未過validate(OUTPUT_VALIDATION_FAILED)
//   'exec'             CLI非零離開碼之一般執行失敗(未能再機械細分)
//   'http'             HTTP非2xx(code為狀態碼, 僅api類)
//   'fetch'            網路層錯誤(DNS/連線拒絕, 僅api類)
//   'tool-unsupported' 模型回tool_calls而本轉接器不支援工具(僅api類)
//   'invalid-response' 回應結構不合規(缺choices[0].message.content、缺output陣列,
//                      或api-typesafe-systemone缺answers物件/缺所請求題目之答案, 僅api類);
//                      HTTP 200但本體非JSON時error另為'INVALID_RESPONSE: body is not JSON (...)'(附位元組資訊,
//                      遞補層整組跳過; 見describeNonJsonBody.mjs), 「JSON缺欄位」則仍換金鑰
//   'incomplete'       回應未完整: 截斷(chat/completions之finish_reason為length/content_filter、
//                      Responses API之status為incomplete; 結果另帶truncated:true, 規則見checkTruncation.mjs)
//                      與Responses API之其餘非completed狀態(如failed; truncated:false)。僅api類;
//                      半截內容預設不當成功回傳, 呼叫端明示acceptTruncated才可放行(2026-09-24起兩轉接器同規則)
//   'aborted'          shouldStop中止(僅dispatchAiFallback)
//   'budget'           時間預算用盡(僅dispatchAiFallback)


/**
 * 判斷execCli之失敗結果是否為子進程未能啟動(帶自有pid鍵且其值為undefined、code為null，不論錯誤碼；判準見檔頭)
 *
 * 供getErrorType與額度查詢等同樣以execCli啟動CLI之處共用，令「未能啟動」只有一處定義
 *
 * @param {Object} r 輸入execCli之結果物件
 * @returns {Boolean} 回傳是否為子進程未能啟動之布林值
 * @example
 *
 * import { isSpawnFail } from './src/getErrorType.mjs'
 *
 * console.log(isSpawnFail({ ok: false, code: null, pid: undefined, error: 'EPERM: spawn EPERM' }))
 * // => true
 *
 * console.log(isSpawnFail({ ok: false, code: null, pid: 1234, error: 'TIMEOUT after 10s' }))
 * // => false
 *
 * console.log(isSpawnFail({ ok: false, code: null, error: 'FETCH_ERROR: ECONNREFUSED' }))
 * // => false (無pid鍵, 非execCli結果)
 *
 */
function isSpawnFail(r) {
    if (!isobj(r) || r.ok === true) {
        return false
    }
    return r.code === null && Object.prototype.hasOwnProperty.call(r, 'pid') && r.pid === undefined
}


/**
 * 由失敗結果物件推導機器可讀之errorType(僅機械可判者，其餘歸'exec'，不猜測)
 *
 * error以TIMEOUT開頭為'timeout'；
 * 帶自有pid鍵且其值為undefined、code為null(execCli之子進程未能啟動，不論錯誤碼，見isSpawnFail)，或error含ENOENT或ENAMETOOLONG(不帶pid鍵之輸入)為'spawn'；
 * 恰為OUTPUT_VALIDATION_FAILED為'validation'；
 * 其餘失敗一律'exec'(各家CLI字樣不同且隨版本漂移，不維護簽章表)。
 * dispatchAiFallback以本函數產出之'spawn'整組跳過
 *
 * @param {Object} r 輸入失敗結果物件(取其error、code與pid欄位判別)
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
 * console.log(getErrorType({ ok: false, code: null, pid: undefined, error: 'UNKNOWN: spawn UNKNOWN' }))
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

    //子進程未能啟動, 以結構判定(見檔頭): 已啟動者必帶pid, 故不受錯誤碼種類影響
    if (isSpawnFail(r)) {
        return 'spawn'
    }

    //其餘輸入沿用字樣判定(實為不帶pid鍵之非execCli結果; execCli已啟動者之error為離開碼、訊號、逾時或驗證字樣, 不含此二字)
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
export { attachErrorType, isSpawnFail }
