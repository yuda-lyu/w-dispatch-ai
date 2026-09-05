import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import toQuotaScopedLabel from './toQuotaScopedLabel.mjs'
import toQuotaWindow from './toQuotaWindow.mjs'


// fromCodexUsageHttp.mjs — 將chatgpt.com之/wham/usage回應對映為統一結構
//
// 【為何獨立成檔】此端點為ChatGPT前端自用之內部端點, 欄位形狀已知會變(尤其additional_rate_limits),
//   對映邏輯獨立後可用離線fixture斷言, 不必每次都靠真帳號才能驗證。
//
// 【additional_rate_limits之寬容解析】本機帳號此欄實測為null, 形狀取自同類工具codex-reset-checker
//   之測試fixture(其作者觀察到的真實回應): 集合可為陣列或以名稱為鍵之物件; 單筆之識別可為
//   limit_name / metered_limit_name / name / id; 顯示名可為display_name / title; 窗口可在單筆頂層、
//   rate_limit之下(snake或camel), 或單筆本身就是一個窗口(直接帶used_percent, 或置於window鍵);
//   直接窗口不分primary/secondary時, 以名稱含weekly/secondary/reserve或窗口長度≥6天判為週限額。
//   已知名稱: codex-spark(GPT-5.3-Codex-Spark)、gpt-reserve(Luna reserve之週限額)。
//   任何欄位缺漏皆「該窗口不列入」而不拋錯, 原始回應由呼叫端保留於raw。


//直接窗口判為週限額之窗口長度門檻(秒)
let SEC_WEEKLY_MIN = 6 * 86400


/**
 * 取第一個為非空字串之鍵值
 *
 * @param {Object} o 輸入物件
 * @param {Array} keys 輸入鍵陣列
 * @returns {String} 回傳字串, 皆無回傳''
 */
function firstStr(o, keys) {
    for (let k of keys) {
        let v = get(o, k, '')
        if (isestr(v)) {
            return v
        }
    }
    return ''
}


/**
 * 將單一窗口{used_percent, limit_window_seconds, reset_at, reset_after_seconds}正規化
 *
 * @param {Object} o 輸入窗口物件
 * @param {String} key 輸入窗口鍵字串
 * @param {String} scope 輸入範圍字串
 * @returns {Object|null} 回傳統一窗口物件, 輸入非物件回傳null
 */
function fromWindow(o, key, scope) {
    if (!iseobj(o)) {
        return null
    }
    let ws = get(o, 'limit_window_seconds', null)
    let windowSeconds = isnum(ws) ? cdbl(ws) : null
    return toQuotaWindow({
        key,
        label: toQuotaScopedLabel(windowSeconds, scope),
        windowSeconds,
        usedPercent: get(o, 'used_percent', null),
        resetAt: get(o, 'reset_at', ''),
        resetAfterSeconds: get(o, 'reset_after_seconds', null),
        scope,
    })
}


/**
 * 取出additional_rate_limits之集合並統一為陣列
 *
 * @param {Object} data 輸入回應物件
 * @returns {Array} 回傳單筆物件陣列, 無則[]
 */
function collectAdditional(data) {
    let cands = [
        get(data, 'additional_rate_limits', null),
        get(data, 'rate_limit.additional_rate_limits', null),
    ]
    for (let c of cands) {
        if (isearr(c)) {
            return c
        }
        if (iseobj(c)) {
            return Object.keys(c).map((k) => {
                let v = c[k]
                if (!iseobj(v)) {
                    return v
                }
                let nm = firstStr(v, ['limit_name', 'name', 'id'])
                return { ...v, limit_name: nm === '' ? k : nm }
            })
        }
    }
    return []
}


/**
 * 自單筆取出指定窗口(頂層、rate_limit、rateLimit之下, snake或camel)
 *
 * @param {Object} it 輸入單筆物件
 * @param {String} snake 輸入snake鍵, 例如'primary_window'
 * @param {String} camel 輸入camel鍵, 例如'primaryWindow'
 * @returns {Object|null} 回傳窗口物件, 無回傳null
 */
function pickWindow(it, snake, camel) {
    for (let c of [it, get(it, 'rate_limit', null), get(it, 'rateLimit', null)]) {
        if (!iseobj(c)) {
            continue
        }
        let w = get(c, snake, null)
        if (!iseobj(w)) {
            w = get(c, camel, null)
        }
        if (iseobj(w)) {
            return w
        }
    }
    return null
}


/**
 * 單筆本身即為窗口時取出之
 *
 * @param {Object} it 輸入單筆物件
 * @returns {Object|null} 回傳窗口物件, 無回傳null
 */
function directWindow(it) {
    if (!iseobj(it)) {
        return null
    }
    if (get(it, 'used_percent', undefined) !== undefined) {
        return it
    }
    let w = get(it, 'window', null)
    if (iseobj(w)) {
        return w
    }
    let rl = get(it, 'rate_limit', null)
    if (iseobj(rl) && get(rl, 'used_percent', undefined) !== undefined) {
        return rl
    }
    return null
}


/**
 * 將chatgpt.com之/wham/usage回應對映為統一結構
 *
 * 主窗口(rate_limit.primary_window / secondary_window)、程式碼審查限額(code_review_rate_limit)、
 * 以及寬容解析之additional_rate_limits皆納入windows；額外限額之窗口鍵為「<識別>:primary|secondary」，
 * scope為其顯示名或識別。任何欄位缺漏皆略過該窗口而不拋錯
 *
 * @param {Object} data 輸入/wham/usage之回應物件
 * @returns {Object} 回傳物件，內含email(字串，無則'')、plan(字串，無則'')、windows(統一窗口陣列)、credits(點數與重置券資訊物件)
 * @example
 *
 * import fromCodexUsageHttp from './src/quota/fromCodexUsageHttp.mjs'
 *
 * let m = fromCodexUsageHttp({
 *     email: 'a@b.c',
 *     plan_type: 'plus',
 *     rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 100 } },
 *     additional_rate_limits: [{ limit_name: 'codex-spark', primary_window: { used_percent: 12, limit_window_seconds: 18000 } }],
 * })
 * console.log(m.windows.map((w) => `${w.key}=${w.label}`))
 * // => [ 'primary=5小時', 'codex-spark:primary=5小時(codex-spark)' ]
 *
 */
function fromCodexUsageHttp(data) {

    //email與plan
    let email = firstStr(data, ['email'])
    let plan = firstStr(data, ['plan_type'])

    //windows, 主窗口
    let windows = []
    for (let k of ['primary', 'secondary']) {
        let w = fromWindow(get(data, `rate_limit.${k}_window`, null), k, '')
        if (w !== null) {
            windows.push(w)
        }
    }

    //code review限額, 與對話額度分開計算
    for (let k of ['primary', 'secondary']) {
        let w = fromWindow(get(data, `code_review_rate_limit.${k}_window`, null), `code_review:${k}`, 'code review')
        if (w !== null) {
            windows.push(w)
        }
    }

    //additional_rate_limits, 寬容解析
    let addi = collectAdditional(data)
    for (let i = 0; i < addi.length; i++) {
        let it = addi[i]
        if (!iseobj(it)) {
            continue
        }

        //id與scope
        let id = firstStr(it, ['limit_name', 'metered_limit_name', 'name', 'id'])
        if (id === '') {
            id = `additional_${i + 1}`
        }
        let display = firstStr(it, ['display_name', 'title', 'name', 'limit_name', 'metered_limit_name'])
        let scope = display === '' ? id : display
        let identity = `${id} ${display}`.toLowerCase()

        //窗口, 先找明確之primary/secondary, 皆無時把單筆本身當窗口並以名稱或長度判別週限額
        let pri = pickWindow(it, 'primary_window', 'primaryWindow')
        let sec = pickWindow(it, 'secondary_window', 'secondaryWindow')
        if (pri === null && sec === null) {
            let d = directWindow(it)
            if (d !== null) {
                let ws = get(d, 'limit_window_seconds', null)
                let weekly = /weekly|secondary|reserve/.test(identity) || (isnum(ws) && cdbl(ws) >= SEC_WEEKLY_MIN)
                if (weekly) {
                    sec = d
                }
                else {
                    pri = d
                }
            }
        }

        let wp = fromWindow(pri, `${id}:primary`, scope)
        if (wp !== null) {
            windows.push(wp)
        }
        let ws2 = fromWindow(sec, `${id}:secondary`, scope)
        if (ws2 !== null) {
            windows.push(ws2)
        }
    }

    //credits, 點數餘額與「額度重置券」(可提前重置窗口)與限額狀態
    let credits = {
        hasCredits: get(data, 'credits.has_credits', false),
        unlimited: get(data, 'credits.unlimited', false),
        balance: get(data, 'credits.balance', ''),
        resetCreditsAvailable: get(data, 'rate_limit_reset_credits.available_count', null),
        spendControlReached: get(data, 'spend_control.reached', false),
        rateLimitReachedType: get(data, 'rate_limit_reached_type', null),
        individualLimit: get(data, 'spend_control.individual_limit', null),
    }

    return {
        email,
        plan,
        windows,
        credits,
    }
}


export default fromCodexUsageHttp
