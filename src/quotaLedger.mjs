import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'


// quotaLedger.mjs — 額度帳(store.quota)之讀寫(內部模組; 訂閱類用量門檻subQuotaGate.mjs使用; Gitea #93; 帳本R-SPAWNGATE-6)
//
// 【帳是什麼】門檻判定為blocked且重置時刻可解析、或CLI失敗文字帶重置時刻時, 記下「此鍵至何時不要再派」, 之後的呼叫(含下一個行程, 經遞補層既有的store持久化)
//   在 now < until 期間直接略過、不再查詢額度, until過後才重查。帳存於遞補層狀態物件之quota欄(與cursors、cooling並列, 同一個store、同一個saveState),
//   store無效時狀態退回行程內記憶體, 帳亦隨之。
//
// 【資料形狀】state.quota[鍵] = { until: ISO字串, at: ISO字串(入帳時刻), source: 'usage-api'|'limit-text', windows?: [{ name, percent, resetsAt }] }
//   鍵: 讀者家族(claude、codex、antigravity:<群組或*>)或entry:<條目id>(CLI文字命中, 只知該條目被拒)。不存金鑰、權杖、帳號識別。
//   windows只在usage-api來源時有(每個視窗帶scope: 模型別視窗之帳不得外洩到他model): 讀帳時只以「適用於該條目之視窗」依現行門檻重判, 重置時刻已過之視窗不計;
//   重判後對該條目不擋(門檻已調高、帳內視窗不適用於它)者只略過此帳、不刪(他條目或他設定可能仍適用, 到期時自然清除), 不盲信。
//
// 【上限】until最晚為入帳時刻加8天(週額度重置最遠7天), 逾者截斷; 讀帳時對「遠超上限」之until(如時鐘回撥後讀回)視為不可信、作廢並重查。
//   fail-open: 帳缺漏、形狀不符、until無法解析、已過期一律視為無帳(並順手清除), 回到逐次查詢。


//until上限(毫秒; 8天)與讀帳時對上限之容忍(1小時)
let UNTIL_CAP_MS = 8 * 86400000
let UNTIL_SLACK_MS = 3600000


/**
 * 將Date、ISO字串或毫秒數轉為毫秒
 *
 * @param {*} v 輸入值
 * @returns {Number} 回傳毫秒時刻，無法轉換回傳NaN
 */
function toMs(v) {
    if (v instanceof Date) {
        return v.getTime()
    }
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : NaN
    }
    if (typeof v === 'string' && v.trim() !== '') {
        return Date.parse(v)
    }
    return NaN
}


/**
 * 將重置時刻截斷於上限(現在加8天)
 *
 * @param {Number} untilMs 輸入重置時刻毫秒
 * @param {Number} nowMs 輸入現在毫秒
 * @returns {Number} 回傳截斷後毫秒
 */
function clampUntilMs(untilMs, nowMs) {
    return Math.min(untilMs, nowMs + UNTIL_CAP_MS)
}


/**
 * 依鍵序查帳，回傳第一個仍有效者(過期、形狀不符、遠超上限者順手清除；重判對此次查詢者不擋者略過但不刪)
 *
 * @param {Object} state 輸入遞補層狀態物件(取其quota)
 * @param {Array} keys 輸入帳鍵陣列(依序查，null略過)
 * @param {Number} nowMs 輸入現在毫秒
 * @param {Function} [recheck=null] 輸入重判函數(windows, nowMs)=>{ blocked, until }，僅對帶windows之帳呼叫；回傳blocked為假即略過該帳(不刪)，until(ISO字串)為重判後仍擋之視窗重置時刻最晚者
 * @returns {Object} 回傳物件，內含hit(有效帳{ key, until(ISO), source, windows }或null)、dirty(是否清除過帳而需寫回)
 */
function ledgerFind(state, keys, nowMs, recheck = null) {
    let dirty = false
    try {
        let q = state.quota
        if (!isobj(q)) {
            return { hit: null, dirty: false }
        }
        for (let key of keys) {
            if (!isestr(key) || !Object.hasOwn(q, key)) {
                continue
            }
            let rec = q[key]
            let until = isobj(rec) ? toMs(rec.until) : NaN
            let ok = Number.isFinite(until) && until > nowMs && until <= nowMs + UNTIL_CAP_MS + UNTIL_SLACK_MS
            let windows = (ok && Array.isArray(rec.windows)) ? rec.windows.filter((w) => isobj(w)) : []
            if (ok && recheck !== null && windows.length > 0) {
                let j = recheck(windows, nowMs)
                if (j.blocked !== true) {
                    continue //對此次查詢者不擋(門檻已調高、或帳內視窗不適用於它): 略過此帳但不刪——他條目或他設定可能仍適用, 到期時自然清除
                }
                let u2 = toMs(j.until)
                if (Number.isFinite(u2)) {
                    until = Math.min(until, u2) //重判後以仍擋之視窗為準, 且不超過入帳時之(已截斷)until
                }
            }
            if (!ok) {
                delete q[key]
                dirty = true
                continue
            }
            return { hit: { key, until: new Date(until).toISOString(), source: isestr(rec.source) ? rec.source : '', windows }, dirty }
        }
    }
    catch {
        return { hit: null, dirty } //凍結之state、不可讀之物件: 視為無帳
    }
    return { hit: null, dirty }
}


/**
 * 入帳(覆寫同鍵)；state不可寫(凍結)時回傳false，不拋錯
 *
 * @param {Object} state 輸入遞補層狀態物件
 * @param {String} key 輸入帳鍵
 * @param {Object} rec 輸入帳內容{ until, at, source, windows? }
 * @returns {Boolean} 回傳是否寫入成功
 */
function ledgerPut(state, key, rec) {
    try {
        if (!isobj(state.quota)) {
            state.quota = {}
        }
        state.quota[key] = rec
        return true
    }
    catch {
        return false
    }
}


export { ledgerFind, ledgerPut, toMs, clampUntilMs, UNTIL_CAP_MS }
