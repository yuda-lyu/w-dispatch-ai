import get from 'lodash-es/get.js'
import omit from 'lodash-es/omit.js'
import isestr from 'wsemi/src/isestr.mjs'
import execCli from 'wsemi/src/execCli.mjs'
import getCliArgs from './getCliArgs.mjs'
import getErrorResult from './getErrorResult.mjs'
import { attachErrorType } from './getErrorType.mjs'
import castPintOr from './castPintOr.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'


// dispatchCodex.mjs — 以OpenAI Codex CLI呼叫GPT模型
//
// 【調用方式】參考全域技能dispatch-codex之慣例，依專案方針「不直接引用全域技能」，
//   將其調用方式移植於此，方便本專案自行偵錯、修改與擴充。
//
// 【走stdin而非位置參數】技能文件的範例是把prompt當位置參數，但摘要內文可達數萬字，
//   當命令列參數會spawn ENAMETOOLONG(本專案在opencode上已實際踩過)。
//   2026-08-08實測：codex exec未帶位置prompt時可從stdin讀取，
//   以gpt-5.6-luna產出合規JSON摘要(10.5s)，與位置參數版結果等價。
//
// 【認證】沿用Codex CLI既有登入狀態，不逐次注入API key。


//預設值
let DEFAULT_EXE = 'codex'
let DEFAULT_SANDBOX = 'workspace-write'


//本轉接器自用之設定鍵, 其餘鍵一律原樣轉傳execCli
let OWN_KEYS = ['exe', 'model', 'sandbox', 'extraArgs', 'input']


/**
 * 以OpenAI Codex CLI呼叫GPT模型
 *
 * 特點：
 * prompt一律走stdin而非位置參數，因摘要內文可達數萬字，當命令列參數會spawn ENAMETOOLONG；
 * 固定帶`--skip-git-repo-check`，令非git倉庫之工作目錄亦可執行；
 * 沿用Codex CLI既有登入狀態，無逐次注入API key之概念，故無key參數；
 * 未給model時不帶`-m`旗標，由CLI自行決定使用模型；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，一律以stdin傳入子進程
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.exe='codex'] 輸入codex執行檔名稱或絕對路徑字串，給予名稱時由execCli自系統PATH解析，預設'codex'
 * @param {String} [opt.model=''] 輸入模型ID字串，例如'gpt-5.6-luna'，預設''代表不帶`-m`旗標
 * @param {String} [opt.sandbox='workspace-write'] 輸入沙箱模式字串，例如'read-only'、'workspace-write'、'danger-full-access'，預設'workspace-write'
 * @param {Array} [opt.extraArgs=[]] 輸入額外命令列旗標字串陣列，例如['--config', 'model_reasoning_effort="max"']，將接於固定旗標之後，預設[]
 * @param {Number} [opt.timeoutMs=300000] 輸入逾時毫秒正整數，逾時將強制關閉子進程及其子孫程序，全套件統一預設300000
 * @param {String} [opt.cwd=process.cwd()] 輸入子進程工作目錄字串，預設process.cwd()
 * @param {String|Function} [opt.validate=undefined] 輸入stdout驗證規則字串或自訂驗證函數，規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接，預設undefined代表不驗證
 * @param {Number} [opt.maxRetries=0] 輸入失敗後最大重試次數非負整數，預設0
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(標準輸出字串)、stderr(標準錯誤字串)、code(離開碼)、error(錯誤訊息字串，成功時為空字串)、durationMs(耗時毫秒)、attempts(實際嘗試次數)，本函數不會reject
 * @example
 * //need codex cli in system PATH
 *
 * import dispatchCodex from './src/dispatchCodex.mjs'
 *
 * let test = async () => {
 *
 *     let r = await dispatchCodex('請只回覆兩個字：完成', { model: 'gpt-5.6-luna', sandbox: 'read-only' })
 *     console.log(r.ok, r.stdout.includes('完成'))
 *     // => true true
 *
 *     let re = await dispatchCodex('abc', { exe: 'codex-not-exist' })
 *     console.log(re.ok, re.error.includes('ENOENT'))
 *     // => false true
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchCodex(prompt, opt = {}) {

    //check prompt, 不reject故以錯誤結果物件回報
    if (!isestr(prompt)) {
        return getErrorResult('prompt must be a non-empty string')
    }

    //exe, 無效回退預設'codex', 由execCli自系統PATH解析實體路徑
    let exe = get(opt, 'exe', null)
    if (!isestr(exe)) {
        exe = DEFAULT_EXE
    }

    //model, 無效時整段`-m`旗標不出現, 由CLI自行決定使用模型
    let model = get(opt, 'model', null)

    //sandbox, 無效回退預設'workspace-write'
    let sandbox = get(opt, 'sandbox', null)
    if (!isestr(sandbox)) {
        sandbox = DEFAULT_SANDBOX
    }

    //extraArgs
    let extraArgs = get(opt, 'extraArgs', null)

    //args, --skip-git-repo-check令非git倉庫之工作目錄亦可執行, 缺此旗標codex會拒絕執行
    let args = getCliArgs(
        'exec',
        ['--sandbox', sandbox],
        '--skip-git-repo-check',
        isestr(model) ? ['-m', model] : [],
        extraArgs,
    )

    //timeoutMs, 無效回退全套件統一預設(dfTimeoutMs=300000), 各轉接器一致令呼叫方無須記多套數字
    let timeoutMs = castPintOr(get(opt, 'timeoutMs', null), dfTimeoutMs)

    //optCli, 剔除本轉接器自用鍵後原樣轉傳, 令呼叫端可用execCli全部設定(例如onStdout、maxBuffer)
    let optCli = omit(opt, OWN_KEYS)

    //execCli, prompt一律走stdin; 失敗結果補上機器可讀之errorType(僅機械可判者, 見getErrorType.mjs)
    let r = await execCli(exe, args, {
        ...optCli,
        input: prompt,
        timeoutMs,
    })
    return attachErrorType(r)
}


export default dispatchCodex
