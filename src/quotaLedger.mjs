import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'


// quotaLedger.mjs — 額度帳(store.quota)之讀寫(內部模組; 訂閱類用量門檻subQuotaGate.mjs使用; Gitea #93; 帳本R-SPAWNGATE-6)
//
// 【帳是什麼】門檻判定為blocked且重置時刻可解析、或CLI失敗文字帶重置時刻時, 記下「此鍵至何時不要再派」, 之後的呼叫(含下一個行程, 經遞補層既有的store持久化)
//   在 now < until 期間直接略過、不再查詢額度, until過後才重查。帳存於遞補層狀態物件之quota欄(與cursors、cooling並列, 同一個store、同一個saveState),
//   store無效時狀態退回行程內記憶體, 帳亦隨之。
//
// 【資料形狀】state.quota[鍵] = { until: ISO字串, at: ISO字串(入帳時刻), source: 'usage-api'|'limit-text', windows?: [{ name, percent, resetsAt, scope }],
//   account?: 字串|null(入帳時讀者回應之帳號識別, 正規化後之雜湊, 見subQuotaGate.mjs accountIdOf; 無則null), rechecked?: ISO字串(最近一次以讀者重探之時刻, 成功或失敗皆記),
//   family?: 'claude'|'codex'|'antigravity'(僅entry帳, 供forgetQuota依家族清除) }
//   鍵: 讀者家族(claude、codex、antigravity:<群組或*>)或entry:<條目id>(CLI文字命中, 只知該條目被拒)。不存金鑰、權杖、email本文(2026-11-09 Gitea #116起帳內有account欄, 但只是雜湊, 不可還原為email)。
//   windows只在usage-api來源時有(每個視窗帶scope: 模型別視窗之帳不得外洩到他model): 讀帳時只以「適用於該條目之視窗」依現行門檻重判, 重置時刻已過之視窗不計;
//   重判後對該條目不擋(門檻已調高、帳內視窗不適用於它)者只略過此帳、不刪(他條目或他設定可能仍適用, 到期時自然清除), 不盲信。
//   舊格式(無account、無rechecked、無family)可讀: 缺欄視為null／未重探, 維持舊行為; 新增欄位皆為可選, 舊版套件讀新格式時忽略之。
//   帳號比對與定期重探(account不符或重探時用量已低於門檻即作廢)之判定在subQuotaGate.mjs, 本檔只提供讀寫、作廢(ledgerDrop)、標記重探(ledgerMark)與明示清除(ledgerForget)。
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
 * @returns {Object} 回傳物件，內含hit(有效帳{ key, until(ISO), source, windows, account(字串或null), at(字串或null), rechecked(字串或null) }或null)、dirty(是否清除過帳而需寫回)
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
            return {
                hit: {
                    key,
                    until: new Date(until).toISOString(),
                    source: isestr(rec.source) ? rec.source : '',
                    windows,
                    account: isestr(rec.account) ? rec.account : null, //舊格式或非字串視為null(不比對帳號)
                    at: isestr(rec.at) ? rec.at : null,
                    rechecked: isestr(rec.rechecked) ? rec.rechecked : null,
                },
                dirty,
            }
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


/**
 * 作廢(刪除)某鍵之帳；鍵不存在或state不可寫(凍結)時回傳false，不拋錯
 *
 * @param {Object} state 輸入遞補層狀態物件
 * @param {String} key 輸入帳鍵
 * @returns {Boolean} 回傳是否確實刪除了該鍵(false亦可能是他呼叫已先刪除)
 */
function ledgerDrop(state, key) {
    try {
        let q = state.quota
        if (!isobj(q) || !isestr(key) || !Object.hasOwn(q, key)) {
            return false
        }
        delete q[key]
        return true
    }
    catch {
        return false
    }
}


/**
 * 標記某鍵之帳於指定時刻以讀者重探過(寫入rechecked；成功或失敗之重探皆標記，作為下次重探間隔之起點)；鍵不存在、形狀不符或不可寫時回傳false，不拋錯
 *
 * @param {Object} state 輸入遞補層狀態物件
 * @param {String} key 輸入帳鍵
 * @param {Number} ms 輸入重探時刻毫秒
 * @returns {Boolean} 回傳是否寫入成功
 */
function ledgerMark(state, key, ms) {
    try {
        let q = state.quota
        if (!isobj(q) || !isestr(key) || !Object.hasOwn(q, key) || !isobj(q[key])) {
            return false
        }
        q[key].rechecked = new Date(ms).toISOString()
        return true
    }
    catch {
        return false
    }
}


//家族名(forgetQuota之家族涵蓋範圍判定用)
let FAMILIES = ['claude', 'codex', 'antigravity']


/**
 * 明示清除帳(見forgetQuota.mjs)：鍵為家族名時涵蓋該家族全部帳(家族鍵、`<家族>@<雜湊>`、`<家族>:<群組>`、帶family欄為該家族之entry帳)，為'*'時清全部，其餘只清該鍵；永不拋錯
 *
 * @param {Object} state 輸入遞補層狀態物件(取其quota)
 * @param {String} key 輸入家族名、帳鍵或'*'
 * @returns {Array} 回傳確實被清除之鍵陣列(不可寫、無此帳回傳[])
 */
function ledgerForget(state, key) {
    let removed = []
    try {
        let q = state.quota
        if (!isobj(q) || !isestr(key)) {
            return removed
        }
        let isFamily = FAMILIES.includes(key)
        for (let k of Object.keys(q)) {
            let hit = key === '*' || k === key
            if (!hit && isFamily) {
                hit = k.startsWith(`${key}@`) || k.startsWith(`${key}:`) || (isobj(q[k]) && q[k].family === key)
            }
            if (hit) {
                delete q[k]
                removed.push(k)
            }
        }
    }
    catch {
        //凍結之state、不可讀之物件: 回傳已清除者(通常為[])
    }
    return removed
}


export { ledgerFind, ledgerPut, ledgerDrop, ledgerMark, ledgerForget, toMs, clampUntilMs, UNTIL_CAP_MS }
