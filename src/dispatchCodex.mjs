import get from 'lodash-es/get.js'
import omit from 'lodash-es/omit.js'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { readStrOpt, readBoolOpt, readEnvOpt, readNameOpt } from './readSafeOpt.mjs'
import parseCodexEvents from './parseCodexEvents.mjs'
import { listCodexRefs, removeNewCodexRefs } from './cleanCodexRefs.mjs'
import getCliArgs from './getCliArgs.mjs'
import getErrorResult from './getErrorResult.mjs'
import runExecCli from './runExecCli.mjs'
import { asText } from './callUserFn.mjs'
import castTimerMs from './castTimerMs.mjs'
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
//
// 【Windows「所有命令blocked by policy」不是本轉接器的問題, 也刻意不在此加預設繞道】
//   Codex 0.149起Windows預設走elevated沙箱, 需一次性管理員設定(專用使用者+WFP+ACL);
//   設定未完成時execpolicy於spawn前拒絕所有shell命令, Codex讀檔即執行shell故等同不能讀檔,
//   且常回「請貼上檔案內容」之合法字串而通過nonempty驗證(靜默失敗)。
//   2026-08-26實測: 設定完成前全擋、完成後read-only/workspace-write/elevated皆通。
//   正解是完成該設定(互動跑一次codex); 臨時繞道可經extraArgs帶
//   ['--config', 'windows.sandbox="unelevated"'](隔離較弱)。不設為win32預設:
//   那會在已完成設定的機器上默默降級沙箱, 拿全體使用者的隔離換一個一次性環境問題。
//   詳見README「Options only for dispatchCodex」之診斷段。


//預設值
let DEFAULT_EXE = 'codex'
let DEFAULT_SANDBOX = 'workspace-write'


//本轉接器自用之設定鍵, 其餘鍵一律原樣轉傳execCli
let OWN_KEYS = ['exe', 'model', 'sandbox', 'extraArgs', 'input', 'cleanCodexRefs']

//帶--json時累積codex stdout全文之上限(字元), 超出部分不再累積(execCli預設maxBuffer為10MB, 此值恆不先到)
let ACC_MAX = 32 * 1024 * 1024


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
 * @param {String} [opt.exe='codex'] 輸入codex執行檔名稱或絕對路徑字串，給予名稱時由execCli自系統PATH解析(.cmd/.bat只給檔名時依cmd.exe語意先搜cwd再搜PATH，cwd不可信時請給絕對路徑)，未給(undefined、null)用'codex'，給了而非非空字串(含'')以params回報、不起子進程(不退回預設；排程第553項)
 * @param {String} [opt.model=''] 輸入模型ID字串，例如'gpt-5.6-luna'、'gpt-6.1-terra'、'gpt-6.1-sol'，預設''代表不帶`-m`旗標(此時由CLI依config.toml之model或官方推薦預設決定)；未給(undefined、null、'')才不帶旗標，給了而非原始非空字串(數字、物件等)以params回報、不起子進程(不改用CLI預設模型；影響計費之opt，帳本R-SAFEOPT-1規則11)
 * @param {String} [opt.sandbox='workspace-write'] 輸入沙箱模式字串，例如'read-only'、'workspace-write'、'danger-full-access'，未給(undefined、null)用'workspace-write'，給了而非非空字串(含'')以params回報、不起子進程(不退回'workspace-write'放寬沙箱；排程第553項)
 * @param {Array} [opt.extraArgs=[]] 輸入額外命令列旗標字串陣列，例如['--config', 'model_reasoning_effort="max"']，將接於固定旗標之後，預設[]。帶`--json`時stdout為JSONL事件流(不改)，結果另帶raw(該次嘗試之完整事件流文字)與commands(各命令之完成事件陣列，各項含id、command、exitCode、status、output、outputTruncated；output即Codex實際收到之命令輸出，供審查引用與原文不符時分辨「讀檔失真」或「模型引用錯」；成功與失敗皆帶，事件流無任何已知事件者不帶)
 * @param {Boolean} [opt.cleanCodexRefs=true] 輸入是否於派工結束後清除Codex於cwd所在git repo新留下之`refs/codex/*`布林值(只刪派工前不存在、前綴為`refs/codex/`者，不碰其他ref；最佳努力，git不存在或cwd非repo者略過)，false代表不清；有清除者結果另帶codexRefsRemoved(個數)，預設true
 * @param {Number} [opt.timeoutMs=300000] 輸入逾時毫秒，須為1至2147483647之整數(計時器上限，可為數字字串)，逾時將強制關閉子進程及其子孫程序，非預期之輸入(含超過上限、Infinity、小數、0、負數、'0x10'、包裝物件)視為未給而用預設，不夾至上限、不報錯，全套件統一預設300000
 * @param {String} [opt.cwd=process.cwd()] 輸入子進程工作目錄字串，未給(undefined、null)用process.cwd()，給了而非非空字串(含'')以params回報、不起子進程(排程第553項)；亦為cleanCodexRefs清除refs/codex/*所在之git repo
 * @param {String|Function} [opt.validate=undefined] 輸入stdout驗證規則字串或自訂驗證函數，規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接，自訂函數可回傳Promise(以resolve值判定，與子進程共用該次嘗試之timeoutMs)，拋錯或reject視同驗證失敗(OUTPUT_VALIDATION_FAILED，stderr前綴'validate threw: 訊息')，逾時亦同(前綴'validate timed out: did not settle within Ns')，durationMs含驗證時間，預設undefined代表不驗證
 * @param {Number} [opt.maxRetries=0] 輸入失敗後最大重試次數非負整數(0至4294967295之整數或其十進位數字字串，Infinity、小數、負數、'0x10'與超過上限者視為未給)，預設0
 * @param {Boolean|Object} [opt.spawnGate=undefined] 輸入spawn前之機器級守門設定：未給為預設(codex預設不限，守門為no-op、零成本)，false關閉，物件可明給maxCli(數codex.exe)、ramUsedMax、cpuMax等逐次開啟，等待不計入timeoutMs，見cliSpawnGate.mjs檔頭，預設undefined
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(標準輸出字串)、stderr(標準錯誤字串，自訂validate拋錯時前綴'validate threw: 訊息')、code(離開碼，子進程未能啟動時為null)、error(錯誤訊息字串，成功時為空字串)、errorType(僅失敗時，機器可讀錯誤類別字串，子進程未能啟動為'spawn'，一覽見getErrorType.mjs檔頭)、durationMs(耗時毫秒)、pid(子進程pid，未能啟動時為undefined)、attempts(實際嘗試次數)；失敗(離開碼非零、訊號結束、逾時)時error為`Exit code N: <stderr尾段>`(至多300字元，已遮蔽金鑰權杖；stderr空時Exit code退用stdout尾段)並另帶errorDetail({ exitCode(數字或null), stderrTail, stdoutTail(僅stdout非空) })；成功時另帶finish(終止原因簡值，codex輸出不揭露故恆為'unknown')與outputChars(stdout字元數)，見runExecCli.mjs與failureDiag.mjs檔頭；本函數不會reject
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
    prompt = asText(prompt) //String包裝物件取其原始字串(stdin只收原始字串, 空包裝不得繞過非空檢核); 判型不執行使用者程式碼(已撤銷之Proxy等回空字串)
    if (prompt === '') {
        return getErrorResult('prompt must be a non-empty string')
    }

    //exe、sandbox、cwd為影響執行與安全之純量opt: 未給(undefined、null)用預設('codex'、'workspace-write'、process.cwd()), 給了而無效即以params回報、不起子行程(帳本R-SAFEOPT-1; dspec §11, 不退回預設)
    //exe, 由execCli自系統PATH解析實體路徑
    let rexe = readStrOpt(get(opt, 'exe', null), 'exe')
    if (rexe.err !== '') {
        return getErrorResult(rexe.err)
    }
    let exe = rexe.value === null ? DEFAULT_EXE : rexe.value

    //model為影響計費之opt: 未給(undefined、null、'')不帶`-m`旗標由CLI自行決定使用模型; 給了而無效(非原始非空字串)以params回報、不起子行程——
    //修前無效時整段`-m`旗標悄悄不出現而改用CLI預設模型(帳本R-SAFEOPT-1規則11; dspec §11〈影響下單數量或金額之opt視同安全相關opt〉)
    let rmodel = readNameOpt(get(opt, 'model', null), 'model')
    if (rmodel.err !== '') {
        return getErrorResult(rmodel.err)
    }
    let model = rmodel.value

    //sandbox: 修前非字串退回workspace-write(原要求read-only之意圖被放寬)
    let rsandbox = readStrOpt(get(opt, 'sandbox', null), 'sandbox')
    if (rsandbox.err !== '') {
        return getErrorResult(rsandbox.err)
    }
    let sandbox = rsandbox.value === null ? DEFAULT_SANDBOX : rsandbox.value

    //cwd(原樣留在optCli轉傳execCli): 修前非字串由execCli退回process.cwd()(在別的目錄動手)
    let rcwd = readStrOpt(get(opt, 'cwd', null), 'cwd')
    if (rcwd.err !== '') {
        return getErrorResult(rcwd.err)
    }

    //env給了而非物件或不可讀以params回報(帳本R-SAFEOPT-1規則10; 與runExecCli同一判定readEnvOpt, 於起任何子行程[git基準列舉、codex]之前判); 可讀者之物化副本於下方交runExecCli(只讀一次)
    let renv = readEnvOpt(get(opt, 'env', null), 'env')
    if (renv.err !== '') {
        return getErrorResult(renv.err)
    }

    //extraArgs(只讀一次並展開為字串陣列, 供args與`--json`判定共用)
    let extraList = getCliArgs(get(opt, 'extraArgs', null))

    //args, --skip-git-repo-check令非git倉庫之工作目錄亦可執行, 缺此旗標codex會拒絕執行
    let args = getCliArgs(
        'exec',
        ['--sandbox', sandbox],
        '--skip-git-repo-check',
        isestr(model) ? ['-m', model] : [],
        extraList,
    )

    //timeoutMs, 無效回退全套件統一預設(dfTimeoutMs=300000), 各轉接器一致令呼叫方無須記多套數字
    let timeoutMs = castTimerMs(get(opt, 'timeoutMs', null), dfTimeoutMs)

    //optCli, 剔除本轉接器自用鍵後原樣轉傳, 令呼叫端可用execCli全部設定(例如onStdout、maxBuffer)
    let optCli = omit(opt, OWN_KEYS)
    if (renv.env !== null) {
        optCli.env = renv.env
    }

    //命令事件之保留(排程第448項③; 見parseCodexEvents.mjs檔頭): extraArgs帶`--json`時stdout為JSONL事件流, 失敗結果之stdout被execCli裁到500字元,
    //故以onStdout自行累積該次嘗試之全文, reshapeResult於每次execCli結果出來後(成功與否皆然)補raw(完整事件流)與commands(各命令之完成事件: command、exitCode、output等);
    //stdout本身不改(既有以JSONL為stdout之呼叫端不受影響); 事件流無任何已知事件者不加。未帶--json時完全不介入(結果形狀同修前)
    if (extraList.includes('--json')) {
        let acc = ''
        let userOnStdout = get(optCli, 'onStdout', null)
        optCli.onStdout = (str) => {
            if (acc.length < ACC_MAX) {
                acc += str
            }
            if (isfun(userOnStdout)) {
                return userOnStdout(str) //呼叫端回調之回傳值與拋錯交execCli處理(同未介入時)
            }
        }
        let userReshape = get(optCli, 'reshapeResult', null)
        optCli.reshapeResult = (r) => {
            let raw = acc !== '' ? acc : String(get(r, 'stdout', '') || '')
            acc = '' //下一次嘗試重新累積
            let p = parseCodexEvents(raw)
            let out = p.hasEvents ? { ...r, raw, commands: p.commands } : r
            return isfun(userReshape) ? userReshape(out) : out
        }
    }

    //收尾清除Codex於目標repo留下之refs/codex/*(排程第388項②; 見cleanCodexRefs.mjs檔頭): 派工前取refs/codex/下既有ref為基準, 派工後只刪新出現者(最佳努力, 不拋錯);
    //cwd不是git repo、git不存在者無基準而略過; opt.cleanCodexRefs為false關閉(預設開)
    //cleanCodexRefs為破壞性(刪ref)之開關: 給了而非布林以params拒絕(不退回「開」而刪其不要刪之ref; 帳本R-SAFEOPT-1), 未給(undefined、null)為開
    let rclean = readBoolOpt(get(opt, 'cleanCodexRefs', null), 'cleanCodexRefs')
    if (rclean.err !== '') {
        return getErrorResult(rclean.err)
    }
    let cleanOn = rclean.value !== false
    let cwdEff = rcwd.value === null ? process.cwd() : rcwd.value
    let before = cleanOn ? await listCodexRefs(cwdEff) : { ok: false, refs: new Set() }

    //execCli(經runExecCli: 自訂validate拋錯視同驗證失敗、失敗結果補上機器可讀之errorType, 見runExecCli.mjs), prompt一律走stdin
    //spawnGate(使用端給之守門設定, 原樣留在optCli)與spawnGateKind交runExecCli於每次spawn前守門(見cliSpawnGate.mjs; codex預設不限)
    let r = await runExecCli(exe, args, {
        ...optCli,
        input: prompt,
        timeoutMs,
        spawnGateKind: 'codex',
    })

    //收尾: 成功與失敗皆清; 有清除者結果另帶codexRefsRemoved(個數), 無則結果形狀不變
    if (before.ok) {
        let c = await removeNewCodexRefs(cwdEff, before.refs)
        if (c.removed > 0) {
            r = { ...r, codexRefsRemoved: c.removed }
        }
    }
    return r
}


export default dispatchCodex
