import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import execCli from 'wsemi/src/execCli.mjs'
import strCompareForVersion from 'wsemi/src/strCompareForVersion.mjs'
import castTimerMs from './castTimerMs.mjs'


// checkAgyStdinSupport.mjs — 探測agy是否支援`--input-format stream-json`(內部模組, 由dispatchAntigravity之stdin路徑使用; 帳本R-AGY-4)
//
// 【為何要探測】stdin路徑(promptVia為stdin、或auto且超過命令列上限)須用`--input-format stream-json`。本套件不安裝亦不鎖定agy版本(各機自行安裝與更新),
//   舊版agy不認得該旗標時會以離開碼2結束(實測agy 1.5.2對未知旗標印`flags provided but not defined: -<旗標>`後離開, 約0.2秒), 但訊息不指引升級;
//   先以`agy --version`(本機實測約0.15秒)探測, 低於門檻直接回明確錯誤(寫明須升級至哪一版), 不必等實際呼叫失敗。
//
// 【門檻1.1.15之依據】`agy changelog`1.1.15原文: 「Added `--input-format stream-json` to print mode, which reads newline-delimited JSON prompts from stdin and runs one turn per message」。
//   **輸入訊息形狀(`{"event":"user","message":{"role":"user","content":...}}`)僅在agy 1.5.2實測**, 1.1.15～1.5.1之形狀未驗證; 門檻是旗標存在之最早版本, 不保證舊版訊息形狀相同(不符時由「無result事件」之判失敗兜底)。
//
// 【探測不確定時放行(fail-open)】`--version`未能啟動、逾時、非零離開、或輸出解析不出三段版本號時, 回supported為null並放行——
//   實際呼叫自有其錯誤(執行檔不存在為spawn、旗標不認得由dispatchAntigravity改寫為明確錯誤、無result事件判失敗), 探測不得因自身失敗而擋下可用之agy。
//
// 【快取】只快取「已確認支援」者(依exe字串為鍵, 同行程內不再探測; 並行呼叫共用同一個進行中之探測)。低於門檻或不確定者不快取,
//   使用者執行`agy update`後下一次呼叫即重新探測, 不必重啟行程。


//stdin路徑所需之agy最低版本(旗標存在之最早版本, 見檔頭)
let MIN_STDIN_VERSION = '1.1.15'

//探測逾時上限(毫秒); agy --version本機實測約0.15秒
let PROBE_TIMEOUT_MAX_MS = 15000

//已確認支援者之快取: exe → Promise<{ supported, version }>
let supportCache = new Map()


/**
 * 清除「已確認支援」快取(測試或需強制重新探測時使用)
 *
 * @returns {Number} 回傳清除前之快取筆數
 * @example
 *
 * import { clearAgyStdinSupportCache } from './src/checkAgyStdinSupport.mjs'
 *
 * clearAgyStdinSupportCache()
 *
 */
function clearAgyStdinSupportCache() {
    let n = supportCache.size
    supportCache.clear()
    return n
}


/**
 * 探測agy是否支援`--input-format stream-json`(以`agy --version`比對最低版本1.1.15)
 *
 * @param {String} exe 輸入agy執行檔名稱或絕對路徑字串，與dispatchAntigravity實際spawn者相同
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.cwd=undefined] 輸入探測子進程工作目錄字串，預設undefined代表process.cwd()
 * @param {Number} [opt.timeoutMs=15000] 輸入探測逾時毫秒，須為1至2147483647之整數(可為數字字串)，非預期之輸入視為未給，有效值超過15000者取15000(上限15000)
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含supported(true代表版本不低於1.1.15、false代表低於、null代表無法判定[未能啟動、逾時、非零離開或解析不出版本號])、version(--version首行字串，無法取得為'')、minVersion('1.1.15')；本函數不會reject
 * @example
 * //need agy cli in system PATH
 *
 * import checkAgyStdinSupport from './src/checkAgyStdinSupport.mjs'
 *
 * let test = async () => {
 *
 *     let r = await checkAgyStdinSupport('agy')
 *     console.log(r.supported, r.version, r.minVersion)
 *     // => true '1.5.2' '1.1.15'
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function checkAgyStdinSupport(exe, opt = {}) {

    let hit = supportCache.get(exe)
    if (hit) {
        return hit
    }

    let cwd = get(opt, 'cwd', null)
    let timeoutMs = Math.min(castTimerMs(get(opt, 'timeoutMs', null), PROBE_TIMEOUT_MAX_MS), PROBE_TIMEOUT_MAX_MS)

    let p = (async () => {
        let ro = { timeoutMs, maxRetries: 0 }
        if (isestr(cwd)) {
            ro.cwd = cwd
        }
        let rv = await execCli(exe, ['--version'], ro)
        if (!get(rv, 'ok', false)) {
            return { supported: null, version: '', minVersion: MIN_STDIN_VERSION }
        }
        let version = String(get(rv, 'stdout', '')).trim().split(/\r?\n/)[0].trim()
        let cmp = strCompareForVersion(version, MIN_STDIN_VERSION)
        if (cmp === null) {
            return { supported: null, version: '', minVersion: MIN_STDIN_VERSION }
        }
        return { supported: cmp >= 0, version, minVersion: MIN_STDIN_VERSION }
    })()

    supportCache.set(exe, p)
    let v = await p
    if (v.supported !== true && supportCache.get(exe) === p) {
        supportCache.delete(exe)
    }
    return v
}


export default checkAgyStdinSupport
export { MIN_STDIN_VERSION, clearAgyStdinSupportCache }
