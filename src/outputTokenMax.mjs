import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import iseint from 'wsemi/src/iseint.mjs'


// outputTokenMax.mjs — opencode單次回應輸出上限(OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX)之決定與注入(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 【根因(本機opencode 1.19.5, 假OpenAI相容服務攔截請求實測)】opencode run送出的輸出上限欄位為`max_tokens`(chat/completions),
//   值 = min(模型型錄之limit.output, 環境變數OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX 或預設32000):
//     未設環境變數: limit.output 384000 → 32000; 131072 → 32000; 8000 → 8000;
//     設64000: limit.output 384000 → 64000; 131072 → 64000; 8000 → 8000; 設200000且limit.output 131072 → 131072。
//   即「單次輸出32,000 token」是opencode CLI端之預設上限(源碼常數OUTPUT_TOKEN_MAX), 不是閘道限制; 推理模型之reasoning與output共用此額度
//   (OpenAI相容協定之max_tokens含推理token), 檔位越高推理越長、正文越易被擠光。真實Go模型驗證見sgud/rule/rulebook_opencodego.md R-OCGO-4。
//   環境變數之解析: 正整數(含科學記號'1e5'、頭尾空白)有效; '0'、'-5'、''、'abc'、'64000.5'皆被CLI靜默忽略而回預設32000。
//
// 【取值優先序(高→低)】
//   ① opt.outputTokenMax: 有效正整數(數字或數字字串)即採用, 蓋過下列呼叫端環境;
//   ② 子進程環境中呼叫端已設之有效值: opt.env內之同名變數(Windows不分大小寫), 無則本行程process.env之同名變數(execCli會把process.env併入子進程環境) → 原樣保留不改;
//   ③ 套件預設DEFAULT_OUTPUT_TOKEN_MAX。
//   無效值(非正整數、0、負數、小數、空字串、Infinity、超出安全整數、包裝物件、布林)一律視為未給(依dspec輸入參數之檢測機制 K3), 不報錯、不回顯值;
//   呼叫端環境內之無效值等同CLI本就忽略之值, 故以第③項覆蓋。
//   要回到CLI原本之32000: 給opt.outputTokenMax: 32000(或在環境設OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=32000)。
//
// 【調高之代價(寫給選預設與覆寫的人)】
//   ① 輸入餘裕: 多數OpenAI相容伺服器以「輸入 + max_tokens ≤ context上限」驗請求, 且opencode本機壓縮門檻亦扣除輸出保留量,
//      故上限每調高N token, 可用輸入約少N token。context 1M之模型影響可忽略; 但context 26萬級者從32000調到128000, 單則可用輸入約少96K token
//      (providers.mjs各條「脈絡長度」註記之約23萬token輸入上限即以32000預留計算)。因此目錄內context 262144且型錄輸出上限逾32000之三條
//      (oc:flint-40b-free、oc:nemotron-3.5-lightning-free、ocgo:iceman-contributor-free)明給outputTokenMax: 32000維持原輸入餘裕; 需長輸出者以resolveProviders之patch覆寫。
//   ② 逾時: 上限本身不延長timeoutMs; 回應若真的長到用滿上限, 耗時隨之增加(實測速度見R-OCGO-4), 超過timeoutMs者改以TIMEOUT失敗(確定性逾時, 仍不重試同檔位);
//      本套件預設timeoutMs 300000, 呼叫端跑長提示詞+高檔位者應自行加大。
//   ③ 額度: 只在模型「實際產出」時計費, 調高上限本身不扣額度; 以前被32000截掉的長推理現在會完整產出, 單次呼叫之token用量因此上升(Go計入5小時/週/月視窗)。


//環境變數名稱
let OUTPUT_TOKEN_MAX_ENV = 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX'


//套件預設輸出上限(token)。選值依據(2026-11-04 Go真實模型實測, 3萬字元提示詞、--variant high、需大量算術推理之合成任務, 證據見帳本R-OCGO-4):
//   glm-5.3-flash 於上限128000下finish=stop, reasoning 32768＋output 1137(合計33905, 僅略超CLI預設32000);
//   deepseek-v4.1-flash 於上限128000下finish=stop, reasoning 70358＋output 964(合計71322, 為CLI預設之2.2倍; 64000不夠);
//   二者於預設32000下皆finish=length、reasoning恰32000、output 0。故取128000(deepseek實測最大量之1.8倍餘裕),
//   實際上限仍受模型型錄limit.output約束(取較小者, 例glm型錄131072 → 128000; 型錄僅32000或8000者不變)。
let DEFAULT_OUTPUT_TOKEN_MAX = 128000


/**
 * 將輸入轉為有效之輸出上限(正整數), 無效回傳null
 *
 * 有效: 數字或數字字串(頭尾空白、科學記號'1e5'可)轉換後為正之安全整數; 無效(含Infinity、'0x10'、包裝物件、布林、null)回傳null, 不拋錯
 *
 * @param {*} v 輸入待檢測之值
 * @returns {Number|null} 回傳正整數, 無效為null
 * @example
 *
 * import { castOutputTokenMax } from './src/outputTokenMax.mjs'
 *
 * console.log(castOutputTokenMax('64000'), castOutputTokenMax(' 1e5 '), castOutputTokenMax('abc'), castOutputTokenMax(0))
 * // => 64000 100000 null null
 *
 */
function castOutputTokenMax(v) {
    if (!iseint(v, { min: 1 })) {
        return null
    }
    let n = typeof v === 'number' ? v : Number(String(v).trim())
    return Number.isSafeInteger(n) && n > 0 ? n : null
}


/**
 * 在環境物件中找出某變數之實際鍵名(Windows環境變數名不分大小寫, 其他平台區分)
 *
 * @param {Object} env 輸入環境物件
 * @param {String} name 輸入變數名
 * @returns {String|null} 回傳實際鍵名, 無則null
 */
function findEnvKey(env, name) {
    if (!isobj(env)) {
        return null
    }
    let ks = Object.keys(env)
    if (process.platform === 'win32') {
        let lc = name.toLowerCase()
        return ks.find((k) => k.toLowerCase() === lc) || null
    }
    return ks.includes(name) ? name : null
}


/**
 * 決定本次子進程環境之輸出上限, 回傳應注入之環境物件(不改寫輸入, 呼叫端已設之有效值不覆蓋; 優先序見檔頭)
 *
 * @param {Object} env 輸入呼叫端欲傳入子進程之env物件(可為undefined)
 * @param {*} optValue 輸入opt.outputTokenMax(有效正整數時蓋過呼叫端環境)
 * @param {Object} [procEnv=process.env] 輸入本行程環境(子進程會繼承), 供測試注入
 * @returns {Object} 回傳物件，內含env(新的env物件，必要時已寫入OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX)、value(生效之上限正整數)、source('opt'、'env'、'default'三者之一，指出取值來源)
 * @example
 *
 * import { applyOutputTokenMax } from './src/outputTokenMax.mjs'
 *
 * console.log(applyOutputTokenMax({}, undefined, {}).value)
 * // => 128000
 *
 * console.log(applyOutputTokenMax({}, 32000, {}).value)
 * // => 32000
 *
 */
function applyOutputTokenMax(env, optValue, procEnv = process.env) {
    let base = isobj(env) ? env : {}
    let kUser = findEnvKey(base, OUTPUT_TOKEN_MAX_ENV)

    //① opt.outputTokenMax
    let nOpt = castOutputTokenMax(optValue)
    //② 呼叫端環境: opt.env有該鍵(不論值)即以它為準(execCli併入時它蓋過process.env), 否則看本行程環境
    let nEnv = null
    if (kUser !== null) {
        nEnv = castOutputTokenMax(get(base, kUser, null))
    }
    else {
        let kProc = findEnvKey(procEnv, OUTPUT_TOKEN_MAX_ENV)
        nEnv = kProc !== null ? castOutputTokenMax(get(procEnv, kProc, null)) : null
    }

    if (nOpt === null && nEnv !== null) {
        return { env: base, value: nEnv, source: 'env' }
    }
    let n = nOpt !== null ? nOpt : DEFAULT_OUTPUT_TOKEN_MAX
    let out = { ...base }
    if (kUser !== null) {
        delete out[kUser] //大小寫異名之舊鍵移除, 避免子進程環境同名重複
    }
    out[OUTPUT_TOKEN_MAX_ENV] = String(n)
    return { env: out, value: n, source: nOpt !== null ? 'opt' : 'default' }
}


export { OUTPUT_TOKEN_MAX_ENV, DEFAULT_OUTPUT_TOKEN_MAX, castOutputTokenMax, applyOutputTokenMax }
