import get from 'lodash-es/get.js'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import execCli from 'wsemi/src/execCli.mjs'
import { attachErrorType } from './getErrorType.mjs'


// runExecCli.mjs — CLI類轉接器呼叫wsemi之execCli之單一入口(四家轉接器共用, 規則只寫一處)
//
// 【自訂validate拋錯視同驗證失敗, 與REST類同規則】execCli於子進程close事件內呼叫validate,
//   自訂函式拋錯會成為未捕捉例外——行程崩潰, 或該次呼叫之Promise永不落定(2026-10-14實測wsemi 1.9.15)。
//   故自訂函式一律包成「拋錯回false」, 並把拋錯訊息以「validate threw: 訊息」前綴於結果之stderr,
//   與REST類轉接器之safeValidate(見checkTruncation.mjs)之判定與診斷一致; 規則字串由execCli自行解析, 不會拋錯。
//
// 【不reject】wsemi>=1.9.15之execCli對spawn同步錯誤回結果物件(code null、pid undefined、attempts 1),
//   本函數不另包try/catch(四家一致, 見getErrorType.mjs之isSpawnFail)。
//
// 【失敗結果補errorType】僅機械可判者, 見getErrorType.mjs。


/**
 * CLI類轉接器呼叫execCli之單一入口：自訂validate拋錯視同驗證失敗並於stderr註記，失敗結果補上errorType
 *
 * @param {String} exe 輸入執行檔名稱或路徑字串
 * @param {Array} args 輸入參數字串陣列
 * @param {Object} [opt={}] 輸入execCli設定物件，原樣轉傳(validate為自訂函式時先行包裝)
 * @returns {Promise} 回傳Promise，resolve回傳execCli之結果物件，失敗時另帶errorType，本函數不會reject
 * @example
 * //need test in nodejs
 *
 * import runExecCli from './src/runExecCli.mjs'
 *
 * let r = await runExecCli(process.execPath, ['-e', 'process.stdout.write("x")'], {
 *     validate: () => {
 *         throw new Error('boom')
 *     },
 * })
 * console.log(r.ok, r.error, r.errorType, r.stderr)
 * // => false 'OUTPUT_VALIDATION_FAILED' 'validation' 'validate threw: boom'
 *
 */
async function runExecCli(exe, args, opt = {}) {

    //validate, 自訂函式包成拋錯回false並記下訊息; 規則字串與無效值原樣交execCli
    let validate = get(opt, 'validate', null)
    let threw = ''
    if (isfun(validate)) {
        let fn = validate
        validate = (stdout) => {
            try {
                return !!fn(stdout)
            }
            catch (err) {
                let msg = get(err, 'message', '')
                threw = isestr(msg) ? msg : String(err)
                return false
            }
        }
    }

    let r = await execCli(exe, args, {
        ...opt,
        validate,
    })

    //拋錯訊息註記於stderr(同REST類之'validate threw: 訊息'), 只在確為驗證失敗時
    if (threw !== '' && get(r, 'error', '') === 'OUTPUT_VALIDATION_FAILED') {
        let stderr = get(r, 'stderr', '')
        r = { ...r, stderr: `validate threw: ${threw}${isestr(stderr) ? `\n${stderr}` : ''}` }
    }

    return attachErrorType(r)
}


export default runExecCli
