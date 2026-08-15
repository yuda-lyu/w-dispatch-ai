import isestr from 'wsemi/src/isestr.mjs'


/**
 * 產生與execCli同結構之錯誤結果物件
 *
 * 本套件各dispatch函數一律不reject，參數檢核失敗時即以本函數回傳錯誤結果物件，
 * 其欄位與wsemi之execCli回傳結構一致，故呼叫端可用同一套欄位判斷成敗，
 * 無須區分「參數錯誤」與「CLI執行失敗」兩種來源
 *
 * @param {String} error 輸入錯誤訊息字串
 * @param {String} [errorType='params'] 輸入機器可讀之錯誤類別字串(一覽見getErrorType.mjs檔頭)，預設'params'(參數/設定檢核失敗)
 * @returns {Object} 回傳結果物件，內含ok(布林值，恆為false)、stdout(空字串)、stderr(空字串)、code(null)、error(錯誤訊息字串)、errorType(錯誤類別字串)、durationMs(0)、attempts(0)
 * @example
 *
 * import getErrorResult from './src/getErrorResult.mjs'
 *
 * console.log(getErrorResult('prompt must be a non-empty string'))
 * // => { ok: false, stdout: '', stderr: '', code: null, error: 'prompt must be a non-empty string', errorType: 'params', durationMs: 0, attempts: 0 }
 *
 * console.log(getErrorResult(null).error)
 * // => 'unknown error'
 *
 */
function getErrorResult(error, errorType = 'params') {

    //check, 非有效字串時給予預設訊息, 確保error欄位恆為非空字串
    if (!isestr(error)) {
        error = 'unknown error'
    }

    //check errorType, 非有效字串回退'params'
    if (!isestr(errorType)) {
        errorType = 'params'
    }

    return {
        ok: false,
        stdout: '',
        stderr: '',
        code: null,
        error,
        errorType,
        durationMs: 0,
        attempts: 0,
    }
}


export default getErrorResult
