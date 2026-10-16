import get from 'lodash-es/get.js'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import delay from 'wsemi/src/delay.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import execCli from 'wsemi/src/execCli.mjs'
import { attachErrorType } from './getErrorType.mjs'
import getErrorResult from './getErrorResult.mjs'
import buildValidator from './buildValidator.mjs'
import castPintOr from './castPintOr.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'
import { awaitUserFn, readCallerObj, validateNote } from './callUserFn.mjs'


// runExecCli.mjs — CLI類轉接器呼叫wsemi之execCli之單一入口(四家轉接器共用, 規則只寫一處)
//
// 【validate由本層判定(2026-10-16起, 帳本R-USERFN-2)】本套件之timeoutMs為「單次嘗試」時限(README之Timeout總覽),
//   且遞補層把剩餘預算壓進timeoutMs; 自訂validate可回傳Promise, 其等待須與子進程共用同一次嘗試之時限,
//   否則單次嘗試可達2×timeoutMs而突破budgetMs(2026-10-14實測budgetMs 3000 → 5093ms)。wsemi之execCli於子進程結束時才呼叫validate
//   且不受timeoutMs約束(永不落定之validate令execCli永不落定), 亦不提供該次嘗試之起點, 故本層不把validate交execCli:
//   以maxRetries之剩餘次數呼叫execCli(不帶validate, 非驗證之失敗與其重試由execCli自理),
//   成功後於本層以「timeoutMs − 該次子進程耗時」為上限等待驗證; 驗證不過且尚有次數時依wsemi同一公式延遲後重試。
//   驗證失敗結果之形狀同wsemi(stdout/stderr截斷500、code 0、error恰為OUTPUT_VALIDATION_FAILED), stderr前綴
//   'validate threw: <訊息>'(拋錯、reject)或'validate timed out: did not settle within <N>s'(逾時); durationMs含驗證時間;
//   註記只屬該次結果(重試不殘留前次訊息)。規則字串('nonempty'等)以本套件之buildValidator判定(與wsemi逐字相同)。
//   判定不依賴wsemi是否承接Promise(降版亦不靜默放行)。
//
// 【自wsemi複製之部分(來源: wsemi 1.9.16之src/execCli.mjs; 帳本R-USERFN-2之Q3來源記錄)】wsemi改下列任一項時須同步本檔,
//   測試unit-userFnValidate之「CLI驗證失敗之結果形狀、attempts與重試間隔與wsemi之execCli一致」把兩者釘在一起:
//   ①重試間隔Math.min(retryDelayMs × 已嘗試次數, 15000)(:562-566) ②maxRetries無效回退0、retryDelayMs無效回退5000(:522-536)
//   ③驗證失敗結果{ ok, stdout, stderr, code: 0, error: 'OUTPUT_VALIDATION_FAILED', durationMs, pid }與stderr前綴之組法(:352-370), attempts(:589)
//   ④截斷500之optTruncate(:33-36)
//   已知差異(2026-10-16外審): 驗證失敗後重呼execCli時, 其後「非驗證之失敗」之重試間隔由execCli以其本次呼叫內之次數計(自1起算),
//   故「驗證不過→非零離開→…」之混合序列中, 後段間隔短於整輪以已嘗試次數計之公式(attempts與成敗判定不受影響);
//   要完全一致須由本層逐次呼叫execCli(maxRetries 0)並複製其不重試判準, 屬另案。
//
// 【env不可讀】呼叫端env物件不可讀(拋錯之getter、已撤銷之Proxy)者, 於啟動前以params回報(四家同; opencode於自身組env時同判);
//   可讀者以物化之淺層副本交execCli(只讀一次; 自有可列舉屬性, 同wsemi之buildSpawnEnv)。
//
// 【不reject】wsemi>=1.9.15之execCli對spawn同步錯誤回結果物件(code null、pid undefined、attempts 1),
//   本函數不另包try/catch(四家一致, 見getErrorType.mjs之isSpawnFail)。
//
// 【失敗結果補errorType】僅機械可判者, 見getErrorType.mjs。


//optTruncate, 同execCli: 刪節號後標註原始總長度
let optTruncate = {
    funWithMsg: (str) => `(truncated, total ${str.length} chars)`,
}


//MAX_RETRY_DELAY_MS, 同execCli之重試間隔上限
let MAX_RETRY_DELAY_MS = 15000


/**
 * CLI類轉接器呼叫execCli之單一入口：validate由本層判定(回傳Promise者與子進程共用該次嘗試之timeoutMs)，失敗結果補上errorType
 *
 * @param {String} exe 輸入執行檔名稱或路徑字串
 * @param {Array} args 輸入參數字串陣列
 * @param {Object} [opt={}] 輸入execCli設定物件，validate以外原樣轉傳(env以物化之淺層副本轉傳)；validate可為規則字串、(stdout)=>Boolean或回傳Promise之函數，回傳Promise者至多等待「timeoutMs − 該次子進程耗時」
 * @returns {Promise} 回傳Promise，resolve回傳execCli之結果物件(durationMs含驗證時間)，失敗時另帶errorType；env不可讀時回params錯誤結果；本函數不會reject
 * @example
 * //need test in nodejs
 *
 * import runExecCli from './src/runExecCli.mjs'
 *
 * let r = await runExecCli(process.execPath, ['-e', 'process.stdout.write("x")'], {
 *     validate: async () => {
 *         throw new Error('boom')
 *     },
 * })
 * console.log(r.ok, r.error, r.errorType, r.stderr)
 * // => false 'OUTPUT_VALIDATION_FAILED' 'validation' 'validate threw: boom'
 *
 * let r2 = await runExecCli(process.execPath, ['-e', 'process.stdout.write("x")'], {
 *     timeoutMs: 2000,
 *     validate: () => new Promise(() => {}),
 * })
 * console.log(r2.ok, r2.errorType, r2.stderr.indexOf('validate timed out: did not settle within'))
 * // => false 'validation' 0
 *
 */
async function runExecCli(exe, args, opt = {}) {

    //env, 不可讀以params回報; 可讀者以物化之副本交execCli(只讀一次)
    let er = readCallerObj(get(opt, 'env', undefined), 'env')
    if (!er.ok) {
        return getErrorResult(er.msg)
    }

    //validator, 規則字串與自訂函式皆由本層判定; 無有效規則則不驗證
    //timeoutMs, 兩路(有無validate)同一預設: 無效回退全套件統一之dfTimeoutMs(四家轉接器皆已正規化後傳入, 此為直呼本函數時之一致性)
    let timeoutMs = castPintOr(get(opt, 'timeoutMs', null), dfTimeoutMs)

    let validator = buildValidator(get(opt, 'validate', null))
    let base = { ...opt, env: er.value, validate: undefined, timeoutMs }
    if (validator === null) {
        return attachErrorType(await execCli(exe, args, base))
    }

    //maxRetries、retryDelayMs, 無效回退與execCli相同之預設(0、5000)
    let maxRetries = get(opt, 'maxRetries', null)
    maxRetries = isp0int(maxRetries) ? cint(maxRetries) : 0
    let retryDelayMs = castPintOr(get(opt, 'retryDelayMs', null), 5000)

    let used = 0
    for (;;) {

        //子進程(本次至多maxRetries-used次重試, 由execCli自理非驗證之失敗與其重試)
        let r = await execCli(exe, args, { ...base, timeoutMs, maxRetries: maxRetries - used, retryDelayMs })
        used += get(r, 'attempts', 1)
        if (!r.ok) {
            return attachErrorType({ ...r, attempts: used })
        }

        //驗證, 上限為該次嘗試之剩餘時間(timeoutMs − 子進程耗時)
        let t0 = Date.now()
        let v = await awaitUserFn(() => validator(r.stdout), Math.max(timeoutMs - get(r, 'durationMs', 0), 1))
        let vMs = Date.now() - t0
        if (v.state === 'value' && !!v.value) {
            return { ...r, durationMs: r.durationMs + vMs, attempts: used }
        }

        //驗證失敗, 形狀同execCli
        let se = strTruncate(r.stderr || '', 500, optTruncate)
        let note = validateNote(v)
        let fail = {
            ok: false,
            stdout: strTruncate(r.stdout || '', 500, optTruncate),
            stderr: note !== '' ? `${note}${se !== '' ? `\n${se}` : ''}` : se,
            code: 0,
            error: 'OUTPUT_VALIDATION_FAILED',
            durationMs: r.durationMs + vMs,
            pid: r.pid,
            attempts: used,
        }
        if (used > maxRetries) {
            return attachErrorType(fail)
        }

        //重試間隔, 同execCli: retryDelayMs×已嘗試次數, 上限15000ms
        await delay(Math.min(retryDelayMs * used, MAX_RETRY_DELAY_MS))
    }
}


export default runExecCli
