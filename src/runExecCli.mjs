import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import delay from 'wsemi/src/delay.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import execCli from 'wsemi/src/execCli.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import { attachErrorType } from './getErrorType.mjs'
import getErrorResult from './getErrorResult.mjs'
import buildValidator from './buildValidator.mjs'
import cliSpawnGate, { DEFAULT_MIN_ATTEMPT_MS } from './cliSpawnGate.mjs'
import castPintOr from './castPintOr.mjs'
import castTimerMs from './castTimerMs.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'
import { judgeTruncated } from './checkTruncation.mjs'
import { awaitUserFn, callHookSync, readCallerObj, validateNote } from './callUserFn.mjs'
import { addErrorDetail, withOutputInfo, createTailCapture } from './failureDiag.mjs'
import { readAttemptHints, retryFits, capByHints, createCutTracker } from './attemptDeadline.mjs'


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
//   要完全一致須由本層逐次呼叫execCli(maxRetries 0)並複製其不重試判準——遞補層有期限時已由本層接管(見下【期限約束重試】), 無期限時仍為上述已知差異。
//
// 【期限約束重試(2026-11-11 da402／di402; 帳本R-COOL-4)】遞補層有期限(budgetMs)時經內部鍵attemptHints傳{ deadlineAt, minAttemptMs, entryTimeoutMs }(見attemptDeadline.mjs):
//   ①本層接管重試: 交execCli之maxRetries為0, 由本層逐次呼叫並沿用execCli之不重試判準(以其觀察事件done之reason: 'spawn'／'enoent'／'code2'不重試, 'exhausted'可重試)
//     與間隔公式(retryDelayMs×已嘗試次數, 上限15000ms)——修前無驗證路徑之重試在wsemi execCli內部而不看期限(探測P7: budgetMs 1500、牆鐘3327、3次請求), 本層接管而不擴充wsemi;
//   ②每次重試之逾時以期限封頂, 「剩餘 − 退避 < minAttemptMs」即不再重試(驗證重試亦同); 無驗證路徑之重試不重新守門(同修前execCli內部重試之已知限制);
//   ③封頂之標記: 最後一次嘗試以逾時結束(TIMEOUT開頭或validate timed out)且其逾時由遞補層期限決定(< entryTimeoutMs, 且非呼叫端自給之spawnGate.deadlineAt早於遞補層期限所致——兩者取早後由誰決定即依誰判)、
//     先前之重試沒有以足額逾時者, 結果加cutByDeadline與appliedTimeoutMs, 由遞補層裁定是否為budget-cut(見dispatchAiFallback檔頭【封頂逾時】)。
//   未給attemptHints(直呼轉接器、遞補層無期限)者與修前逐位元相同。
//
// 【env不可讀】呼叫端env物件不可讀(拋錯之getter、已撤銷之Proxy)者, 於啟動前以params回報(四家同; opencode於自身組env時同判);
//   可讀者以物化之淺層副本交execCli(只讀一次; 自有可列舉屬性, 同wsemi之buildSpawnEnv)。
//
// 【spawn守門(2026-11-04 Gitea #67; 見cliSpawnGate.mjs)】四家轉接器經本層統一於「每次spawn前」呼叫cliSpawnGate(轉接器只傳spawnGateKind與使用端之spawnGate, 皆為本層自用鍵, 不轉傳execCli):
//   無validate: 守門一次後以execCli自理之重試跑(execCli內部之非驗證失敗重試不重新守門, 已知限制); 有validate: 每次(含驗證不過後之重試)spawn前各守門一次。
//   守門等待不計入timeoutMs: 守門實際運作過(outcome非'off')且有deadlineAt(遞補層之budgetMs經spawnGateHints, 或使用端自給之spawnGate物件;
//   兩者皆有時取較早者——2026-11-11 排程第417項, 主控裁示甲; 修前使用端之值優先, 其值較晚時可越過budgetMs)者, spawn之timeoutMs以剩餘預算封頂, 令等待計入budgetMs;
//   守門未運作(關閉、預設不限之kind、假exe)時timeoutMs原值不動, 與修前逐位元相同。守門中止(shouldStop)回errorType 'aborted'。
//   實際等過或fail-open時結果加gateWaitedMs(驗證重試時為合計)與gateFailOpen; 未等待者不加欄位。cliSpawnGate永不reject, 此處另以try/catch為最後防線(守門失敗一律放行)。
//
// 【輸出重整與截斷(2026-11-04 da78, Gitea #78)】本層自用鍵reshapeResult(函數(execCli結果)=>結果)由轉接器傳入, 對execCli之每個結果(成功與否皆然)
//   在驗證之前套用, 拋錯一律沿用原結果; 目前僅dispatchOpencode使用(把`--format json`之事件流還原為預設格式之文字並讀出終止原因, 見parseOpencodeEvents.mjs)。
//   重整後之結果若帶truncated:true(終止原因為length／content_filter), 於驗證之前以checkTruncation之judgeTruncated裁定(與REST轉接器同一規則):
//   預設失敗(errorType 'incomplete', error以INCOMPLETE_RESPONSE開頭, 結果帶truncated、finishReason), 不驗證、不重試——同提示詞同上限必然再截斷;
//   呼叫端明示acceptTruncated:true才放行length(可見輸出為空與content_filter仍一律失敗), 放行後照常驗證, 結果標truncated:true。
//   未給reshapeResult者此段全不作用, 與修前逐位元相同。
//
// 【暫時性錯誤重試(2026-11-05 Gitea #85; 帳本R-SPAWNGATE-5; 只對spawnGateKind為'opencode')】opencode實例同瞬間啟動時, 偶因本機sqlite資料庫鎖競爭而立即失敗(離開碼1, 訊息含「database is locked」);
//   這類失敗幾秒內即回、與額度或模型無關, 換家(遞補層)是浪費且改變觀點組成, 而maxRetries預設0(其設計考量是逾時乘以次數)不涵蓋。故本層對這個已知字樣多給一次同家重試:
//   ①辨識(isTransientFailure): 失敗(ok非true)、非逾時(error不以TIMEOUT開頭)、失敗耗時durationMs < 15秒(很快)、且stderr含`database is locked`(不分大小寫)——或stdout含type為error之事件行且該行含此字樣
//      (`--format json`且未經還原者; detectTruncation還原後之錯誤已併入stderr)。stdout之純文字不算(模型輸出可能談到資料庫)。正規式為內部常數、不開放可配置, 日後真有第二個已知字樣再開;
//   ②獨立於maxRetries、不佔其次數: 該次重試單獨跑一次(execCli之maxRetries 0), 其attempts計入結果之attempts(照實累計)但不計入驗證重試之次數預算; 每次呼叫至多一次(整個呼叫鏈共用一次額度, 含有validate時之各輪);
//   ③重試前先等延遲(預設2000ms)並再過守門(含放行最小間隔; 守門等待照常計入deadlineAt): 無validate與有validate兩路皆然;
//   ④不重試之情形: spawnGateKind非'opencode'(claude／codex／antigravity與未給kind者行為不變)、逾時、失敗很慢、其他錯誤字樣、stdout已有tool_use事件(工具已執行, 重試會重跑整個提示詞而重做副作用)、截斷(incomplete)、驗證失敗、shouldStop成立(取spawnGate物件之shouldStop, 否則遞補層提示;
//      回原失敗而非ABORTED)、遞補層預算不足(有deadlineAt時, 剩餘 − 重試延遲 < minAttemptMs)。仍失敗則原樣交遞補層(errorType仍為'exec', 結果形狀只多attempts之累計);
//   ⑤opt.transientRetry({ delayMs, fastMs })為測試用注入(非預期之值逐鍵改用預設, K3), 不轉傳execCli; 一般呼叫端不必給;
//   ⑥觀察回調: 決定重試時(等延遲之前)經opt.onTrace(與execCli同一回調, 凍結事件、同步、拋錯忽略、未給時不組事件)發出 'transient-retry' { n(已嘗試次數), ms(重試延遲), durationMs(該次失敗耗時) },
//      令測試與診斷能以事件為同步點(dspec〈計時器相關函數之觀察回調與測試〉); 事件不含輸出內文。
//
// 【失敗診斷與成功欄位(2026-11-08 da110, Gitea #110; 規則與實查見failureDiag.mjs檔頭)】本層於每個最終結果(withGate)統一補:
//   ①失敗(errorType 'exec'或'timeout', 即非零離開、訊號結束、逾時)加errorDetail{ exitCode, stderrTail, stdoutTail? }, 且execCli原生error形狀(`Exit code N`、`Signal: X`、`TIMEOUT after Ns`)
//     寫成`<原始>: <尾段>`(stderr空且為Exit code時退用stdout尾段——claude把失敗訊息印在stdout); stdout／stderr／errorType等既有欄位不動, errorType於補原因之前已決定;
//     spawn、params、validation、incomplete、aborted不加(它們的error已自足或與子進程輸出無關)。
//   ②成功加finish(終止原因, 取不到為'unknown')與outputChars(stdout字元數), 已有者不覆寫(reshapeResult可先給finish)。
//   尾段來源: 本層包onStdout／onStderr／onTrace擷取每次嘗試(spawn事件重置)輸出之最後4096字元(execCli失敗結果之stderr欄位只留前1000字元、逾時前500字元, 真正的尾端不在其中);
//   呼叫端自給之回調照常呼叫(非函數者視同未給, 同execCli), 回調內容與時機不變。機密值遮罩: opt.diagSecrets(字串陣列, 轉接器傳入本次注入之金鑰)＋樣式遮罩, 見failureDiag.mjs。
//   reshapeResult可於結果帶diagStderr／diagStdout(轉接器還原之完整文字, 優先於擷取), 本層取用後自結果移除。
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


//暫時性錯誤(見檔頭【暫時性錯誤重試】): 辨識用正規式(內部常數, 不開放配置)與預設值
let TRANSIENT_RE = /database is locked/i
let TOOL_USE_RE = /"type"\s*:\s*"tool_use"/
let TRANSIENT_RETRY_DEFAULTS = { delayMs: 2000, fastMs: 15000 }
let TRANSIENT_KIND = 'opencode'


/**
 * 判斷失敗結果是否為「opencode本機資料庫鎖競爭」之暫時性錯誤(失敗、非逾時、失敗很快、stdout無tool_use事件、stderr或type為error之stdout事件行含`database is locked`)
 *
 * @param {Object} r 輸入execCli(或經重整)之結果物件
 * @param {Number} [fastMs=15000] 輸入「很快」之門檻毫秒，失敗耗時(durationMs)須小於此值；無durationMs者無從判斷，視為否
 * @returns {Boolean} 回傳是否為暫時性錯誤之布林值
 * @example
 *
 * import { isTransientFailure } from './src/runExecCli.mjs'
 *
 * console.log(isTransientFailure({ ok: false, code: 1, error: 'Exit code 1', stderr: 'Error: Unexpected error database is locked', stdout: '', durationMs: 900 }))
 * // => true
 *
 * console.log(isTransientFailure({ ok: false, code: 1, error: 'TIMEOUT after 300s', stderr: 'database is locked', stdout: '', durationMs: 900 }))
 * // => false (逾時不算)
 *
 */
function isTransientFailure(r, fastMs = TRANSIENT_RETRY_DEFAULTS.fastMs) {
    if (!isobj(r) || r.ok === true) {
        return false
    }
    let error = get(r, 'error', '')
    if (typeof error === 'string' && error.indexOf('TIMEOUT') === 0) {
        return false
    }
    let d = get(r, 'durationMs', null)
    if (typeof d !== 'number' || !(d < fastMs)) {
        return false
    }
    let so = get(r, 'stdout', '')
    if (typeof so === 'string' && TOOL_USE_RE.test(so)) {
        return false
    }
    let se = get(r, 'stderr', '')
    if (typeof se === 'string' && TRANSIENT_RE.test(se)) {
        return true
    }
    if (typeof so === 'string' && so.includes('"error"')) {
        for (let line of so.split('\n')) {
            if (/"type"\s*:\s*"error"/.test(line) && TRANSIENT_RE.test(line)) {
                return true
            }
        }
    }
    return false
}


/**
 * CLI類轉接器呼叫execCli之單一入口：validate由本層判定(回傳Promise者與子進程共用該次嘗試之timeoutMs)，失敗結果補上errorType
 *
 * @param {String} exe 輸入執行檔名稱或路徑字串
 * @param {Array} args 輸入參數字串陣列
 * @param {Object} [opt={}] 輸入execCli設定物件，validate以外原樣轉傳(env以物化之淺層副本轉傳)；validate可為規則字串、(stdout)=>Boolean或回傳Promise之函數，回傳Promise者至多等待「timeoutMs − 該次子進程耗時」
 * @param {Object} [opt.transientRetry] 輸入暫時性錯誤重試之注入設定{ delayMs(重試前延遲毫秒，預設2000), fastMs(「失敗很快」之門檻毫秒，預設15000) }，僅供測試，非預期之值逐鍵改用預設；暫時性錯誤重試只在spawnGateKind為'opencode'時作用，見檔頭
 * @returns {Promise} 回傳Promise，resolve回傳execCli之結果物件(durationMs含驗證時間)，失敗時另帶errorType；env不可讀時回params錯誤結果；spawnGateKind為'opencode'且遇暫時性錯誤(database is locked)時多重試一次，attempts為兩段之和；本函數不會reject
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
    //timeoutMs, 兩路(有無validate)同一預設: 1～2147483647之整數才採用, 無效(含超過計時器上限)回退全套件統一之dfTimeoutMs(四家轉接器皆已正規化後傳入, 此為直呼本函數時之一致性;
    //判定同wsemi execCli(1.9.59起iseint之timer), 但無效時用本套件之預設而非execCli自有之120000, 不夾上限; 帳本R-TIMEOUT-1)
    let timeoutMs = castTimerMs(get(opt, 'timeoutMs', null), dfTimeoutMs)

    //spawnGate／spawnGateKind為本層自用鍵(不轉傳execCli): 每次spawn前經cliSpawnGate守門(見cliSpawnGate.mjs); kind未給(直呼本函數)則不守門
    //spawnGateHints為遞補層傳入之提示({ shouldStop, deadlineAt, minAttemptMs }, 見dispatchAiFallback), 令預設情形下守門等待亦可被中止、計入budgetMs
    let sgKind = get(opt, 'spawnGateKind', null)
    let sg = get(opt, 'spawnGate', undefined)
    let sgHints = get(opt, 'spawnGateHints', null)
    let gateWaitedMs = 0 //各次守門等待之合計
    let gateFailOpen = false
    //遞補層之期限提示(內部鍵attemptHints, 見attemptDeadline.mjs與檔頭【期限約束重試】): 有期限時重試受期限約束, 最後一次逾時由期限決定者標記cutByDeadline
    let hints = readAttemptHints(opt)
    let cut = createCutTracker(hints)

    //有效期限(2026-11-11 排程第417項, 主控裁示甲): 呼叫端自給之spawnGate.deadlineAt與遞補層經spawnGateHints傳入之期限(由budgetMs換算)皆有效時取較早者
    //(修前呼叫端之值優先, 其值較晚時守門等待與放行後之首次spawn可越過遞補層之budgetMs); 只有一者有效則用該者; 皆無回at: null。
    //期限之來源只這兩個(與修前相同): attemptHints不併入封頂與暫時性重試之預算判斷——它另由retryFits約束重試(含其自帶之minAttemptMs);
    //遞補層於守門運作時恆兩者同給同值, spawnGate:false時只給attemptHints而守門不運作, 若併入則暫時性重試之預算判斷會改採守門之預設minAttemptMs(外審terra #02)。
    //callerBound: 取早後由呼叫端之值決定(嚴格早於遞補層之期限; 相等視為遞補層)——封頂之標記依此判, 呼叫端期限所致者不得標記為遞補層封頂(budget-cut);
    //遞補層期限無spawnGateHints時, 比對基準退用attemptHints.deadlineAt(同修前之callerBelowDa; 僅影響標記, 不影響封頂)。
    //一次決定(封頂值與標記)只讀一次呼叫端物件: 呼叫端為可動態讀取之物件(getter), 分次讀取可使封頂值與標記分叉(外審terra #04), 故回傳之快照供同一次決定共用。
    //spawnGate為呼叫端物件, 讀取拋錯視為該來源無期限(另一來源仍生效)
    let daOf = (v) => (v !== null && v !== undefined && isenum(v, { gt: 0 }) ? Number(v) : null)
    let effDeadline = () => {
        let c = null
        let l = null
        try {
            c = daOf(get(sg, 'deadlineAt', null))
        }
        catch {}
        try {
            l = daOf(get(sgHints, 'deadlineAt', null))
        }
        catch {}
        if (c === null) {
            return { at: l, callerBound: false }
        }
        let ref = l !== null ? l : (hints !== null ? hints.deadlineAt : null)
        let callerBound = ref === null || c < ref
        if (l === null) {
            return { at: c, callerBound }
        }
        return { at: c < l ? c : l, callerBound }
    }

    //spawn之timeoutMs: 守門實際運作過且有有效期限(effDeadline: 遞補層之budgetMs與呼叫端自給期限取早)者, 以守門後之剩餘預算封頂, 令守門等待計入budgetMs(逾時仍自spawn起算);
    //守門未運作(off: 關閉、預設不限之kind、假exe)時一律原值, 與修前逐位元相同。ed為effDeadline之快照
    let capByDeadline = (ed) => {
        let da = ed.at
        if (da !== null) {
            //向下取整: 呼叫端自給之deadlineAt可為小數, 小數之timeoutMs交execCli會被其判為無效而改用120000(整數/計時器範圍之判定, 見castTimerMs)
            return Math.max(Math.min(timeoutMs, Math.floor(da - Date.now())), 1)
        }
        return timeoutMs
    }

    //enterGate: 回傳{ aborted, tmo, callerBound, ed }(tmo為該次spawn之timeoutMs; callerBound為守門後之封頂由呼叫端自給期限決定; ed為本次決定所用之期限快照,
    //守門未運作者亦附, 供暫時性重試輪另以期限封頂時沿用——同一次決定之封頂值與標記取自同一快照)
    let enterGate = async () => {
        let g = null
        try {
            g = await cliSpawnGate({
                kind: sgKind,
                exe,
                spawnGate: sg,
                shouldStop: get(sgHints, 'shouldStop', undefined),
                deadlineAt: get(sgHints, 'deadlineAt', undefined),
                minAttemptMs: get(sgHints, 'minAttemptMs', undefined),
            })
        }
        catch {
            g = null //cliSpawnGate不reject, 此為最後防線: 守門失敗一律放行
        }
        let ran = g !== null && get(g, 'outcome', 'off') !== 'off'
        if (ran) {
            gateWaitedMs += get(g, 'waitedMs', 0)
            gateFailOpen = gateFailOpen || get(g, 'failOpen', false) === true
        }
        let ed = effDeadline()
        return { aborted: get(g, 'aborted', false) === true, tmo: ran ? capByDeadline(ed) : timeoutMs, callerBound: ran && hints !== null && ed.callerBound, ed }
    }
    //輸出尾端擷取與機密值名單(失敗診斷用, 見檔頭【失敗診斷與成功欄位】): 擷取器於每次spawn重置, 故取到的是最後一次嘗試之輸出
    let cap = createTailCapture()
    let diagSecrets = (Array.isArray(get(opt, 'diagSecrets', null)) ? opt.diagSecrets : []).filter((v) => isestr(v))

    //finalize: 最終結果統一補欄位——取走reshapeResult帶來之diagStderr／diagStdout提示(不論成敗皆自結果移除); 失敗加errorDetail與原因, 成功加finish與outputChars
    let finalize = (r) => {
        let hasHint = Object.prototype.hasOwnProperty.call(r, 'diagStderr') || Object.prototype.hasOwnProperty.call(r, 'diagStdout')
        let hintErr = hasHint ? r.diagStderr : undefined
        let hintOut = hasHint ? r.diagStdout : undefined
        let rr = r
        if (hasHint) {
            rr = { ...r }
            delete rr.diagStderr
            delete rr.diagStdout
        }
        if (get(rr, 'ok', false) === true) {
            return withOutputInfo(rr)
        }
        return addErrorDetail(rr, {
            stderr: typeof hintErr === 'string' ? hintErr : cap.err(), //提示為空字串者(轉接器還原後確實為空)不退用原始擷取(如json事件流), 由addErrorDetail退回結果欄位
            stdout: typeof hintOut === 'string' ? hintOut : cap.out(),
            secrets: diagSecrets,
            prefer: sgKind === 'claude' ? 'stdout' : 'stderr', //claude把失敗訊息印在stdout(stderr可能只有無關警告), 見failureDiag.mjs檔頭
        })
    }

    //守門等待之註記: 只在實際等過或fail-open時才加欄位(未等待者結果形狀不變)
    let withGate = (r0) => {
        let r = finalize(r0)
        if (gateWaitedMs > 0 || gateFailOpen) {
            return { ...r, gateWaitedMs, ...(gateFailOpen ? { gateFailOpen: true } : {}) }
        }
        return r
    }

    //暫時性錯誤重試(見檔頭【暫時性錯誤重試】): 只對spawnGateKind為opencode; transientRetry為測試用注入, 非預期之值逐鍵改用預設(K3)
    let trOpt = get(opt, 'transientRetry', null)
    let trObj = isobj(trOpt) ? trOpt : {}
    let trDelayMs = castTimerMs(get(trObj, 'delayMs', null), TRANSIENT_RETRY_DEFAULTS.delayMs) //交wsemi delay(計時器): 超過2147483647者無效(wsemi delay對其改用10毫秒)
    let trFastMs = castPintOr(get(trObj, 'fastMs', null), TRANSIENT_RETRY_DEFAULTS.fastMs)
    let trOn = sgKind === TRANSIENT_KIND
    let trTrace = getTrace({ onTrace: get(opt, 'onTrace', null) }) //觀察回調: 與execCli共用同一opt.onTrace(凍結事件、同步、拋錯忽略、未給時為null)
    let trUsed = false //每次呼叫至多一次(含有validate時之各輪)
    let trAtt = 0 //暫時性重試耗用之嘗試次數: 計入結果之attempts, 不計入驗證重試之次數預算
    //shouldStop: spawnGate物件之鍵優先, 否則遞補層提示(同cliSpawnGate之取法); 非函數、拋錯、回傳不為true皆視為不中止
    let stopNow = () => {
        try {
            let f = get(sg, 'shouldStop', null)
            if (f === null || f === undefined) {
                f = get(sgHints, 'shouldStop', null)
            }
            if (typeof f !== 'function') {
                return false
            }
            let h = callHookSync(() => f())
            return h.state === 'value' && h.value === true
        }
        catch {
            return false //spawnGate為呼叫端物件, 讀取拋錯視為不中止
        }
    }
    //budgetOk: 有deadlineAt(遞補層之budgetMs)時, 重試後剩餘預算(扣掉重試延遲)須仍夠一次最低嘗試(minAttemptMs); 無deadlineAt不限
    let budgetOk = () => {
        //遞補層之期限提示(attemptHints)恆受約束: 「剩餘 − 重試延遲 < minAttemptMs」即不重試(守門關閉時無spawnGateHints, 修前因而不看期限——外審terra F01)
        if (!retryFits(hints, trDelayMs)) {
            return false
        }
        try {
            let da = effDeadline().at //呼叫端自給期限與遞補層(spawnGateHints)期限取早(第417項); minAttemptMs之優先序不變(呼叫端物件優先)
            if (da === null) {
                return true
            }
            let ma = get(sg, 'minAttemptMs', null)
            if (ma === null || ma === undefined) {
                ma = get(sgHints, 'minAttemptMs', null)
            }
            return da - Date.now() - trDelayMs >= castPintOr(ma, DEFAULT_MIN_ATTEMPT_MS)
        }
        catch {
            return true
        }
    }
    let canTransient = (r) => trOn && !trUsed && isTransientFailure(r, trFastMs) && !stopNow() && budgetOk()

    //reshapeResult／acceptTruncated為本層自用鍵(不轉傳execCli), 見檔頭【輸出重整與截斷(2026-11-04 da78)】
    let reshapeFn = get(opt, 'reshapeResult', null)
    let acceptTruncated = get(opt, 'acceptTruncated', false) === true

    //shape: 對execCli之每個結果(成功與否皆然)套重整函數, 再裁定截斷; 回傳{ r, fail }, fail非null代表應立即以該失敗結果收場(不驗證、不重試)
    let shape = async (r0) => {
        let r = r0
        if (typeof reshapeFn === 'function') {
            try {
                let x = reshapeFn(r0)
                if (isobj(x)) {
                    r = x
                }
            }
            catch {} //重整為最佳努力, 拋錯一律沿用原結果
        }
        if (get(r, 'truncated', false) !== true) {
            return { r, fail: null }
        }
        let fr = get(r, 'finishReason', '')
        let d = await judgeTruncated({
            finishReason: fr,
            content: get(r, 'stdout', ''),
            acceptTruncated,
            validator: null, //放行後之驗證交本層既有流程(有validate則於其後驗證)
            reasoningTokens: get(r, 'tokens.reasoning', null),
            label: `finish_reason=${fr}`,
        })
        if (d.accept) {
            return { r, fail: null }
        }
        let failBase = { ...r }
        delete failBase.finish //reshapeResult為成功路徑先給之finish不帶入incomplete失敗結果(截斷失敗之形狀不變, 終止原因已在finishReason／truncated)
        return {
            r,
            fail: {
                ...failBase,
                ok: false,
                stdout: strTruncate(get(r, 'stdout', '') || '', 500, optTruncate),
                error: d.error,
                errorType: 'incomplete',
            },
        }
    }

    let validator = buildValidator(get(opt, 'validate', null))
    let base = { ...opt, env: er.value, validate: undefined, timeoutMs }
    delete base.spawnGate
    delete base.spawnGateKind
    delete base.spawnGateHints
    delete base.reshapeResult
    delete base.acceptTruncated
    delete base.transientRetry
    delete base.diagSecrets
    delete base.attemptHints

    //maxRetries、retryDelayMs, 無效回退與execCli相同之預設(0、5000)
    let maxRetries = get(opt, 'maxRetries', null)
    maxRetries = isp0int(maxRetries) ? cint(maxRetries) : 0
    let retryDelayMs = castPintOr(get(opt, 'retryDelayMs', null), 5000)

    //lastDone: execCli之觀察事件done之reason(本層接管重試時沿用其不重試判準: 'spawn'無法啟動、'enoent'命令不存在、'code2'離開碼2皆不重試, 'exhausted'可重試); 每次呼叫execCli前重置
    let lastDone = null

    //擷取回調: 先記入擷取器再呼叫呼叫端自給之回調(回傳值與拋錯原樣交execCli處理); 非函數者視同未給(同execCli判型)
    for (let [name, push] of [['onStdout', cap.pushOut], ['onStderr', cap.pushErr]]) {
        let userFn = get(base, name, null)
        base[name] = (s) => {
            push(s)
            if (isfun(userFn)) {
                return userFn(s)
            }
        }
    }
    let userTrace = get(base, 'onTrace', null)

    //接管重試(無驗證路徑, 見檔頭【期限約束重試】)時, 呼叫端之觀察回調所見之事件序列與execCli自身之重試迴圈相同(外審terra F13):
    //attempt之n為累計次數、重試前補發retry { n, ms }、各次之done暫存不轉、結束時以累計次數補發一則done
    let traceTakeover = false
    let traceBase = 0
    let heldDone = null
    let emitUser = (ev) => {
        if (isfun(userTrace)) {
            callHookSync(() => userTrace(Object.freeze(ev))) //補發之事件: 拋錯與回傳值皆忽略(同execCli之觀察回調契約)
        }
    }
    base.onTrace = (ev) => {
        let t = get(ev, 'type', '')
        if (t === 'spawn') {
            cap.reset() //新一次嘗試(含execCli內部重試)開始, 前次輸出不混入尾段
        }
        if (t === 'done') {
            lastDone = get(ev, 'reason', null)
        }
        if (!isfun(userTrace)) {
            return
        }
        if (traceTakeover && t === 'attempt') {
            return userTrace(Object.freeze({ ...ev, n: traceBase + get(ev, 'n', 1) }))
        }
        if (traceTakeover && t === 'done') {
            heldDone = ev
            return
        }
        return userTrace(ev)
    }
    if (validator === null) {
        let g0 = await enterGate()
        if (g0.aborted) {
            return getErrorResult('ABORTED', 'aborted')
        }
        let s0 = null
        let r0 = null
        if (hints === null || maxRetries === 0) {

            //無期限(或不重試): 同修前, 非驗證之失敗與其重試由execCli自理
            s0 = await shape(await execCli(exe, args, { ...base, timeoutMs: g0.tmo }))
            r0 = s0.fail !== null ? s0.fail : s0.r
            cut.note(g0.tmo, r0, g0.callerBound)
        }
        else {

            //有期限且maxRetries>0: 本層接管重試(execCli之maxRetries 0, 沿用其不重試判準與間隔公式), 每次重試之逾時以期限封頂、「剩餘 − 退避 < minAttemptMs」即不再重試;
            //重試不重新守門(同修前execCli內部重試之已知限制)
            let usedA = 0
            let tmo = g0.tmo
            let cb = g0.callerBound
            traceTakeover = true
            traceBase = 0
            heldDone = null
            for (;;) {
                lastDone = null
                s0 = await shape(await execCli(exe, args, { ...base, timeoutMs: tmo, maxRetries: 0 }))
                r0 = s0.fail !== null ? s0.fail : s0.r
                usedA += get(r0, 'attempts', 1)
                traceBase = usedA
                cut.note(tmo, r0, cb)
                if (r0.ok === true || s0.fail !== null || lastDone !== 'exhausted' || usedA > maxRetries) {
                    break
                }
                let d = Math.min(retryDelayMs * usedA, MAX_RETRY_DELAY_MS)
                if (!retryFits(hints, d)) {
                    break
                }
                emitUser({ type: 'retry', n: usedA + 1, ms: d })
                await delay(d)
                tmo = capByHints(timeoutMs, hints)
                cb = false
            }
            traceTakeover = false
            if (heldDone !== null) {
                emitUser({ ...heldDone, n: usedA })
                heldDone = null
            }
            r0 = { ...r0, attempts: usedA }
        }

        //暫時性錯誤: 等延遲、再過守門、單獨再跑一次(execCli之maxRetries 0; execCli自理之重試已用完), 結果之attempts為兩段之和
        if (s0.fail === null && canTransient(r0)) {
            trUsed = true
            let a0 = get(r0, 'attempts', 1)
            if (trTrace) {
                trTrace('transient-retry', { n: a0, ms: trDelayMs, durationMs: get(r0, 'durationMs', 0) })
            }
            await delay(trDelayMs)
            if (!stopNow()) {
                let g1 = await enterGate()
                if (g1.aborted) {
                    return withGate({ ...getErrorResult('ABORTED', 'aborted'), attempts: a0 })
                }
                //重試輪之timeoutMs另以期限封頂(即使守門未運作而g1.tmo為原值: 首次耗時與重試延遲已用掉預算, 原值可能超出期限);
                //封頂之標記依本輪實際決定者: 呼叫端期限(取早後)決定且遞補層之封頂未更短者為呼叫端所致, 不論守門是否運作(外審terra #03)
                let m1 = Math.min(g1.tmo, capByDeadline(g1.ed))
                let capL = capByHints(timeoutMs, hints)
                let tmo1 = Math.min(m1, capL)
                let s1 = await shape(await execCli(exe, args, { ...base, maxRetries: 0, timeoutMs: tmo1 }))
                let r1 = s1.fail !== null ? s1.fail : s1.r
                cut.note(tmo1, r1, hints !== null && g1.ed.callerBound && !(capL < m1))
                return withGate(cut.mark(attachErrorType({ ...r1, attempts: a0 + get(r1, 'attempts', 1) })))
            }
        }
        return withGate(cut.mark(attachErrorType(r0)))
    }

    let used = 0 //計入maxRetries預算之嘗試次數(暫時性重試之嘗試不計入, 另記於trAtt)
    let trPending = false //下一輪為暫時性重試(單獨一次嘗試, 不佔預算)
    for (;;) {

        //守門(每次驗證重試前亦重新守門; execCli自理之非驗證失敗重試不在此列, 見cliSpawnGate.mjs檔頭)
        let gi = await enterGate()
        if (gi.aborted) {
            return withGate({ ...getErrorResult('ABORTED', 'aborted'), attempts: used + trAtt })
        }
        let tmo = trPending ? Math.min(gi.tmo, capByDeadline(gi.ed)) : gi.tmo //暫時性重試輪另以期限封頂(同路徑A)
        let cb = gi.callerBound || (trPending && hints !== null && gi.ed.callerBound) //暫時性重試輪之封頂不論守門是否運作皆含呼叫端期限, 標記同依取早後之來源(外審terra #03)
        if (hints !== null && (used > 0 || trPending)) {
            let th = capByHints(timeoutMs, hints) //有期限: 重試之逾時以遞補層期限封頂(見檔頭【期限約束重試】)
            if (th < tmo) {
                tmo = th
                cb = false
            }
        }

        //子進程(本次至多maxRetries-used次重試, 由execCli自理非驗證之失敗與其重試; 暫時性重試輪只跑一次);
        //有期限時本層接管非驗證失敗之重試(execCli之maxRetries 0, 沿用其不重試判準), 令每次重試皆受期限約束
        lastDone = null
        let rRaw = await execCli(exe, args, { ...base, timeoutMs: tmo, maxRetries: (trPending || hints !== null) ? 0 : maxRetries - used, retryDelayMs })
        if (trPending) {
            trAtt += get(rRaw, 'attempts', 1)
            trPending = false
        }
        else {
            used += get(rRaw, 'attempts', 1)
        }
        let sh = await shape(rRaw)
        let r = sh.r
        if (!r.ok) {
            cut.note(tmo, r, cb)

            //暫時性錯誤: 等延遲後回迴圈頂(再過守門)單獨再跑一次; shouldStop於等待中成立則回原失敗
            if (sh.fail === null && canTransient(r)) {
                trUsed = true
                if (trTrace) {
                    trTrace('transient-retry', { n: used + trAtt, ms: trDelayMs, durationMs: get(r, 'durationMs', 0) })
                }
                await delay(trDelayMs)
                if (!stopNow()) {
                    trPending = true
                    continue
                }
            }

            //有期限時本層接管之非驗證失敗重試: 可重試(execCli判準)、尚有次數、且「剩餘 − 退避 ≥ minAttemptMs」才重試(回迴圈頂再過守門)
            if (hints !== null && sh.fail === null && lastDone === 'exhausted' && used <= maxRetries) {
                let d = Math.min(retryDelayMs * used, MAX_RETRY_DELAY_MS)
                if (retryFits(hints, d)) {
                    await delay(d)
                    continue
                }
            }
            return withGate(cut.mark(attachErrorType({ ...r, attempts: used + trAtt })))
        }

        //截斷(確定性: 同提示詞同上限必然再截斷), 不驗證、不重試, 直接以incomplete收場
        if (sh.fail !== null) {
            return withGate(attachErrorType({ ...sh.fail, attempts: used + trAtt }))
        }

        //驗證, 上限為該次嘗試之剩餘時間(timeoutMs − 子進程耗時)
        let t0 = Date.now()
        let v = await awaitUserFn(() => validator(r.stdout), Math.max(tmo - get(r, 'durationMs', 0), 1))
        let vMs = Date.now() - t0
        if (v.state === 'value' && !!v.value) {
            return withGate({ ...r, durationMs: r.durationMs + vMs, attempts: used + trAtt })
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
            attempts: used + trAtt,
            ...(get(r, 'truncated', false) === true ? { truncated: true, finishReason: get(r, 'finishReason', ''), tokens: get(r, 'tokens', null) } : {}), //acceptTruncated放行後驗證不過者仍標明被截斷
        }
        cut.note(tmo, fail, cb)
        if (used > maxRetries) {
            return withGate(cut.mark(attachErrorType(fail)))
        }

        //重試間隔, 同execCli: retryDelayMs×已嘗試次數, 上限15000ms; 有期限時「剩餘 − 退避 < minAttemptMs」即不再重試
        let dv = Math.min(retryDelayMs * used, MAX_RETRY_DELAY_MS)
        if (!retryFits(hints, dv)) {
            return withGate(cut.mark(attachErrorType(fail)))
        }
        await delay(dv)
    }
}


export default runExecCli
export { optTruncate, isTransientFailure, TRANSIENT_RETRY_DEFAULTS }
