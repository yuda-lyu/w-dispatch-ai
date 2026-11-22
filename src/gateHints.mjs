import isfun from 'wsemi/src/isfun.mjs'
import castPintOr from './castPintOr.mjs'
import { callHookSync } from './callUserFn.mjs'


// gateHints.mjs — 守門之兩來源提示(呼叫端自給之spawnGate物件與遞補層經spawnGateHints傳入者)之合併規則單一來源(排程第422項; 帳本R-COOL-5第5點)
//
// 【為何】呼叫端自給之spawnGate物件與遞補層之提示(shouldStop、minAttemptMs)同時存在時, 修前為「物件優先」(取代):
//   ①呼叫端給shouldStop時, 遞補層之中止請求(stopRequested)不能中止守門等待(只在嘗試邊界生效);
//   ②呼叫端給較小之minAttemptMs時, 守門截止「期限 − minAttemptMs」較遲, 放行後之剩餘預算可低於遞補層之minAttemptMs;
//   ③同一minAttemptMs於兩處判型不同(守門以toMs收正小數, 暫時性重試之預算判斷以castPintOr要求正整數、否則20000)。
//   改為: shouldStop以「或」合併(任一為true即中止); minAttemptMs取兩來源有效值之較大者(取嚴: 單次嘗試最低預算越大, 越早停止等待與重試), 判型統一為castPintOr(1～Number.MAX_SAFE_INTEGER之整數或其十進位數字字串)。
//   deadlineAt之「取較早」見cliSpawnGate.mjs之resolveSpawnGate與runExecCli之effDeadline(排程第417項)。
//   兩來源皆無效或未給者行為與修前相同(預設值、不中止)。


/**
 * 合併多個中止判定函數為「或」：任一回傳恰為true即中止；非函數者忽略；拋錯、回傳Promise、回傳非true皆視為該函數不中止；全無函數回null
 *
 * 各函數於每次呼叫時才執行(不快取其結果)，且依序短路(前者為true即不再呼叫後者)
 *
 * @param {...*} fns 輸入各來源之中止判定函數(呼叫端spawnGate物件之shouldStop、遞補層提示之shouldStop等)
 * @returns {Function|null} 回傳合併後之同步函數()=>Boolean，無任何有效函數時回傳null
 * @example
 *
 * import { orStop } from './src/gateHints.mjs'
 *
 * let f = orStop(() => false, null, () => true)
 * console.log(f())
 * // => true
 *
 * console.log(orStop(null, 123))
 * // => null
 *
 */
function orStop(...fns) {
    let list = fns.filter((f) => isfun(f))
    if (list.length === 0) {
        return null
    }
    return () => {
        for (let f of list) {
            let h = callHookSync(() => f())
            if (h.state === 'value' && h.value === true) {
                return true
            }
        }
        return false
    }
}


/**
 * 取兩來源單次嘗試最低預算(minAttemptMs)有效值之較大者：各來源以castPintOr判型(正整數), 無效者忽略(不遮蔽另一來源之有效值), 兩者皆無效回預設
 *
 * @param {*} a 輸入來源一(呼叫端spawnGate物件之minAttemptMs)
 * @param {*} b 輸入來源二(遞補層提示之minAttemptMs)
 * @param {Number} df 輸入兩者皆無效時之預設毫秒
 * @returns {Number} 回傳毫秒
 * @example
 *
 * import { maxMinAttemptMs } from './src/gateHints.mjs'
 *
 * console.log(maxMinAttemptMs(5000, 30000, 20000), maxMinAttemptMs('5000', null, 20000), maxMinAttemptMs(Infinity, 1.5, 20000))
 * // => 30000 5000 20000
 *
 */
function maxMinAttemptMs(a, b, df) {
    let x = castPintOr(a, null)
    let y = castPintOr(b, null)
    if (x === null && y === null) {
        return df
    }
    if (x === null) {
        return y
    }
    if (y === null) {
        return x
    }
    return Math.max(x, y)
}


export { orStop, maxMinAttemptMs }
