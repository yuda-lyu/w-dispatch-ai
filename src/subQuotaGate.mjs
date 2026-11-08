import crypto from 'node:crypto'
import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isenum from 'wsemi/src/isenum.mjs'
import getQuotaClaude from './quota/getQuotaClaude.mjs'
import getQuotaCodex from './quota/getQuotaCodex.mjs'
import getQuotaAntigravity from './quota/getQuotaAntigravity.mjs'
import { KIND_CLI, exeStem } from './cliSpawnGate.mjs'
import { stateOf } from './goQuotaGate.mjs'
import { judgeWindowItems, cachedQuery } from './quotaJudge.mjs'
import { ledgerFind, ledgerPut, toMs, clampUntilMs } from './quotaLedger.mjs'
import claudeLimitUntilOf from './claudeLimitUntil.mjs'
import { awaitUserFn, callHookSync, readCallerObj } from './callUserFn.mjs'
import { baseErrorOf } from './failureDiag.mjs'


// subQuotaGate.mjs — 訂閱類條目(claude無金鑰者、codex、antigravity)之用量門檻(內部模組, 由dispatchAiFallback於選到該條目、呼叫轉接器前使用; Gitea #93; 帳本R-SPAWNGATE-6)
//
// 【做什麼】與Go用量冷卻(goQuotaGate.mjs, R-SPAWNGATE-2)同語意、同一個quotaGate鍵: 訂閱類條目送出前先看額度——
//   ①額度帳(store.quota, 見quotaLedger.mjs): 該條目所屬家族或該條目本身在帳內且now<until → 直接略過(事件source 'ledger'), 不查、不派;
//   ②否則以三家既有讀者(getQuotaClaude／getQuotaCodex／getQuotaAntigravity, 統一windows[]{label,usedPercent,resetAt,windowSeconds,scope})查用量(唯讀、不耗額度),
//      任一視窗usedPercent為有效數字且≥門檻(預設95)即略過不派(事件source 'usage-api'), 並於重置時刻可解析時入帳(跨行程不再查詢直到重置);
//   ③條目失敗後(afterFailure): 結果文字命中Claude Code官方額度訊息且帶重置時刻、或呼叫端注入之opt.quotaUntilOf回傳時刻 → 以entry:<id>入帳(事件source 'limit-text')。
//   為何不等撞額度才知道: 撞額度後的重試是空耗(Claude數秒、agy／codex可達逾時), 且滿額期間每輪每席皆重試; 用量讀者是唯讀的(OAuth usage API／codex app-server／agy -p "/usage")。
//
// 【判定與Go共用】視窗判定與快取用quotaJudge.mjs之judgeWindowItems／cachedQuery(同一份實作), 本檔只把讀者回應轉成視窗項。
//
// 【不得誤判到頂(fail-open)】讀者失敗(逾時、拋錯、reject、未授權、ok為false、windows缺漏或非陣列)、percent缺漏或非數字 → 一律不擋, 失敗發quota-gate-error事件(快取同長度內只發一次);
//   視窗缺resetAt時仍擋但不入帳(until null), 回到逐次快取查詢。
//
// 【適用範圍】
//   claude: 無金鑰者(條目無keys、無key、env無ANTHROPIC_API_KEY有效字串)——訂閱登入態; 帶金鑰者為API計費, 行為不變(不適用)。條目env若指定CLAUDE_CONFIG_DIR, 讀者以該設定目錄查(快取與帳鍵含其雜湊)。
//   codex: 無keys者; 條目env之CODEX_HOME與本行程不同者不適用(app-server讀者繼承本行程環境, 查的會是別的帳號)。
//   antigravity: 無keys者; 依model對到/usage之群組scope(gemini-4-argon*→Gemini 4 Argon、gemini-*→Gemini Models、claude-*／gpt-oss-*→Claude and GPT models), 對不到取全部視窗。
//   claude／codex之model別視窗(scope非空, 如「7天(Fable)」)只在條目model含該scope(忽略大小寫與非英數)時計入: 他模型之週限額到頂不擋本條目; 無scope之視窗一律計入。
//   預設(未明給quotaGate)只作用於「真的該CLI」(exe去目錄與副檔名等於claude／codex／agy或未給exe), 同spawnGate之原則: 假CLI、包裝腳本不被預設查詢(它們用的未必是本機登入的那個帳號);
//   明給quotaGate: true或物件則不論exe皆作用。quotaGate: false(呼叫層或條目)全關(不查、不讀帳、不寫帳)。
//
// 【選項】沿用quotaGate物件: claudeMax／codexMax／antigravityMax(0~100之數字或false關閉該家, 預設各95)、windowMax(物件, 視窗label → 0~100之數字或false, 覆蓋該家門檻)、
//   cacheMs(claude／codex讀者家族快取, 預設60000)、timeoutMs(claude／codex讀者逾時, 預設15000)、antigravityCacheMs(預設300000; agy的/usage實測10～60秒, 不宜每呼叫查)、
//   antigravityTimeoutMs(預設60000)、readers({ claude, codex, antigravity }皆為(opt)=>Promise之讀者函數, 預設為三家既有讀者; 測試或自訂來源注入)、now、state(同Go)。


//預設值
let DEFAULT_MAX_PERCENT = 95
let DEFAULT_CACHE_MS = 60000
let DEFAULT_AGY_CACHE_MS = 300000
let DEFAULT_TIMEOUT_MS = 15000
let DEFAULT_AGY_TIMEOUT_MS = 60000

//家族顯示名
let LABELS = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' }


/**
 * 由agy的model對到/usage之群組顯示名(隨方案與型錄變動, 對不到回null代表取全部視窗)
 *
 * @param {*} model 輸入條目model
 * @returns {String|null} 回傳群組顯示名，對不到回傳null
 */
function agyGroupOf(model) {
    if (!isestr(model)) {
        return null
    }
    if (/^gemini-4-argon/i.test(model)) {
        return 'Gemini 4 Argon'
    }
    if (/^gemini-/i.test(model)) {
        return 'Gemini Models'
    }
    if (/^(claude|gpt-oss)-/i.test(model)) {
        return 'Claude and GPT models'
    }
    return null
}


/**
 * 去大小寫與非英數字元(視窗scope與model比對用)
 *
 * @param {*} s 輸入字串
 * @returns {String} 回傳正規化字串
 */
function norm(s) {
    return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}


/**
 * 讀條目env內某鍵之值——只以屬性描述子判讀資料屬性，不執行getter、不展開整個env物件
 * （env為呼叫端物件，由轉接器物化讀一次，本層不得多讀；同isOfficialAnthropicEntry之作法）。不可讀、非資料屬性、非字串皆回傳null
 *
 * @param {*} env 輸入條目env物件
 * @param {String} key 輸入鍵名
 * @returns {String|null} 回傳字串值或null
 */
function envStrOf(env, key) {
    try {
        if (env === null || typeof env !== 'object') {
            return null
        }
        let d = Object.getOwnPropertyDescriptor(env, key)
        return (d !== undefined && Object.hasOwn(d, 'value') && isestr(d.value)) ? d.value : null
    }
    catch {
        return null
    }
}


/**
 * 判斷條目是否屬訂閱類並回傳家族名
 *
 * @param {Object} attemptOpt 輸入該次嘗試之opt(條目與共用設定合併後)
 * @param {Number} nk 輸入條目有效金鑰數
 * @param {*} env 輸入條目env物件(原樣，不物化)
 * @returns {String|null} 回傳'claude'、'codex'、'antigravity'，不適用回傳null
 */
function subFamilyOf(attemptOpt, nk, env) {
    if (nk > 0) {
        return null
    }
    let kind = get(attemptOpt, 'kind', null)
    if (kind === 'claude') {
        if (isestr(get(attemptOpt, 'key', null)) || envStrOf(env, 'ANTHROPIC_API_KEY') !== null) {
            return null //API金鑰在場: API計費, 不適用
        }
        return 'claude'
    }
    if (kind === 'codex' || kind === 'antigravity') {
        return kind
    }
    return null
}


/**
 * 解析訂閱類用量門檻設定與該條目之查詢目標(不拋錯)：回傳null代表此條目不適用或已關閉
 *
 * @param {*} raw 輸入使用端之quotaGate設定(條目同名鍵優先於呼叫層後之值)：false關閉；true或物件為明給；其餘視為未給
 * @param {Object} attemptOpt 輸入該次嘗試之opt(條目與共用設定合併後；取kind、model、exe、key、env)
 * @param {Number} nk 輸入條目有效金鑰數
 * @param {*} id 輸入條目id(僅idExplicit為真時用於帳鍵)
 * @param {Boolean} idExplicit 輸入id是否為使用端明給(索引式id不入entry帳)
 * @returns {Object|null} 回傳設定與目標物件，不適用或關閉回傳null
 */
function resolveSubQuotaGate(raw, attemptOpt, nk, id, idExplicit) {
    if (raw === false) {
        return null
    }
    let kind0 = get(attemptOpt, 'kind', null)
    if (kind0 !== 'claude' && kind0 !== 'codex' && kind0 !== 'antigravity') {
        return null
    }

    //env, 原樣取用(不展開、不執行getter: 由轉接器物化讀一次, 本層只以屬性描述子讀所需之三個鍵)
    let env = get(attemptOpt, 'env', null)
    let family = subFamilyOf(attemptOpt, nk, env)
    if (family === null) {
        return null
    }

    //明給(true或可讀物件)與否
    let o = {}
    let given = false
    if (raw === true) {
        given = true
    }
    else if (raw !== undefined && raw !== null) {
        let r = readCallerObj(raw, 'quotaGate')
        if (r.ok && isobj(r.value)) {
            o = r.value
            given = true
        }
    }

    //預設只作用於「真的該CLI」
    let exe = get(attemptOpt, 'exe', null)
    let realExe = !isestr(exe) || exeStem(exe) === KIND_CLI[family]
    if (!given && !realExe) {
        return null
    }

    //codex的CODEX_HOME與本行程不同: app-server讀者查的是本行程環境所指之帳號, 不適用
    let envHome = envStrOf(env, 'CODEX_HOME')
    if (family === 'codex' && envHome !== null && envHome !== process.env.CODEX_HOME) {
        return null
    }

    //claude的CLAUDE_CONFIG_DIR: 讀者改以該目錄查, 快取與帳鍵含其雜湊
    let cfgDir = family === 'claude' ? envStrOf(env, 'CLAUDE_CONFIG_DIR') : null
    let dirTag = cfgDir !== null ? `@${crypto.createHash('sha256').update(cfgDir).digest('hex').slice(0, 8)}` : ''

    let num = (v) => (typeof v === 'string' ? Number(v.trim()) : v)
    let maxOf = (v) => {
        if (v === false) {
            return null
        }
        return (v !== undefined && v !== null && isenum(v, { gt: 0, max: 100 })) ? num(v) : DEFAULT_MAX_PERCENT
    }
    let ms = (v, d) => (v !== undefined && v !== null && isenum(v, { use: 'timer', gt: 0 }) ? num(v) : d)

    //windowMax: label → 0~100之數字或false(關閉該視窗); 非預期之值略過(沿用該家門檻)
    let windowMax = {}
    let wm = readCallerObj(o.windowMax, 'windowMax')
    if (wm.ok && isobj(wm.value)) {
        for (let k of Object.keys(wm.value)) {
            let v = wm.value[k]
            if (v === false) {
                windowMax[k] = null
            }
            else if (v !== undefined && v !== null && isenum(v, { gt: 0, max: 100 })) {
                windowMax[k] = num(v)
            }
        }
    }

    //readers, 注入者優先, 預設為三家既有讀者(email一律不比對)
    let rd = readCallerObj(o.readers, 'readers')
    let injected = (rd.ok && isobj(rd.value) && isfun(rd.value[family])) ? rd.value[family] : null
    let defaults = {
        claude: (opt) => getQuotaClaude('', opt),
        codex: (opt) => getQuotaCodex('', opt),
        antigravity: (opt) => getQuotaAntigravity('', opt),
    }
    let reader = injected || defaults[family]

    //讀者選項
    let isAgy = family === 'antigravity'
    let timeoutMs = isAgy ? ms(o.antigravityTimeoutMs, DEFAULT_AGY_TIMEOUT_MS) : ms(o.timeoutMs, DEFAULT_TIMEOUT_MS)
    let readerOpt = { timeoutMs }
    if (family === 'claude') {
        readerOpt.profileFallback = false //只要額度, 不多打profile端點
        if (cfgDir !== null) {
            readerOpt.env = { ...process.env, CLAUDE_CONFIG_DIR: cfgDir }
        }
    }
    else if (isestr(exe) && exeStem(exe) === KIND_CLI[family]) {
        readerOpt.exe = exe
    }

    //帳鍵: 讀者家族(agy含群組)與條目(僅明給id者)
    let model = get(attemptOpt, 'model', null)
    let group = isAgy ? agyGroupOf(model) : null
    let familyKey = isAgy ? `antigravity:${group || '*'}` : `${family}${dirTag}`
    let entryKey = (idExplicit && isestr(id)) ? `entry:${id}` : null

    return {
        family,
        label: LABELS[family],
        kind: get(attemptOpt, 'kind', null),
        model,
        group,
        max: maxOf(isAgy ? o.antigravityMax : o[`${family}Max`]),
        windowMax,
        cacheMs: isAgy ? ms(o.antigravityCacheMs, DEFAULT_AGY_CACHE_MS) : ms(o.cacheMs, DEFAULT_CACHE_MS),
        timeoutMs,
        reader,
        readerOpt,
        now: isfun(o.now) ? o.now : Date.now,
        state: isobj(o.state) && get(o.state, 'cache', null) instanceof Map ? o.state : null,
        cacheKey: `sub:${family}${dirTag}`,
        familyKey,
        entryKey,
    }
}


/**
 * 將讀者回應正規化為可快取之快照(永不拋錯)
 *
 * @param {*} r 輸入讀者回應(toQuotaResult之形狀)
 * @returns {Object} 回傳快照物件{ ok, windows([{ label, scope, usedPercent, resetAt }]), errorType }
 */
function toSnapshot(r) {
    try {
        if (!isobj(r)) {
            return { ok: false, windows: [], errorType: 'other' }
        }
        if (r.ok !== true) {
            return { ok: false, windows: [], errorType: isestr(r.errorType) ? r.errorType : 'other' }
        }
        if (!Array.isArray(r.windows)) {
            return { ok: false, windows: [], errorType: 'shape' }
        }
        let windows = r.windows.filter((w) => isobj(w)).map((w) => ({
            label: isestr(w.label) ? w.label : (isestr(w.key) ? w.key : ''),
            scope: isestr(w.scope) ? w.scope : '',
            usedPercent: w.usedPercent,
            resetAt: isestr(w.resetAt) ? w.resetAt : null,
        }))
        return { ok: true, windows, errorType: '' }
    }
    catch {
        return { ok: false, windows: [], errorType: 'other' } //回應物件不可讀(拋錯之getter等): 不擋
    }
}


/**
 * 取某視窗label適用之門檻(windowMax優先於該家門檻；null代表不判)
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果
 * @param {String} label 輸入視窗label
 * @returns {Number|null} 回傳門檻
 */
function maxFor(sq, label) {
    return Object.hasOwn(sq.windowMax, label) ? sq.windowMax[label] : sq.max
}


/**
 * 某視窗是否適用於該條目(讀者快照與額度帳內之視窗共用同一判定)
 *
 * antigravity: model對得到群組時，視窗之scope(無scope時看label)須含該群組名，對不到群組則全部適用；
 * claude／codex: scope為空之視窗一律適用，scope非空者(模型別視窗，如「7天(Fable)」)只在條目model含該scope(忽略大小寫與非英數)時適用，model未給則不適用
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果
 * @param {Object} w 輸入視窗{ label, scope }
 * @returns {Boolean} 回傳是否適用
 */
function windowApplies(sq, w) {
    if (sq.family === 'antigravity') {
        if (sq.group === null) {
            return true
        }
        return (w.scope !== '' ? w.scope : w.label).toLowerCase().includes(sq.group.toLowerCase())
    }
    if (w.scope === '') {
        return true
    }
    let m = norm(sq.model)
    return m !== '' && m.includes(norm(w.scope))
}


/**
 * 由快照視窗挑出該條目適用者並轉為視窗項
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果
 * @param {Array} windows 輸入快照視窗陣列
 * @returns {Array} 回傳視窗項陣列(同quotaJudge.mjs)
 */
function itemsOf(sq, windows) {
    return windows
        .filter((w) => windowApplies(sq, w))
        .map((w) => ({ name: w.label !== '' ? w.label : w.scope, percent: w.usedPercent, max: maxFor(sq, w.label), limited: false, resetsAt: w.resetAt }))
}


/**
 * 描述被擋視窗(事件與錯誤訊息用)
 *
 * @param {Array} windows 輸入被擋視窗陣列[{ name, percent }]
 * @returns {String} 回傳描述字串
 */
function descOf(windows) {
    return windows.map((w) => `${w.name} ${w.percent === null ? 'rate-limited' : `${w.percent}%`}`).join(', ')
}


/**
 * 以現行門檻重判帳內之視窗(只計適用於該條目者；重置時刻已過者不計；用於讀帳)
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果
 * @param {Array} windows 輸入帳內視窗[{ name, percent, resetsAt, scope }]
 * @param {Number} nowMs 輸入現在毫秒
 * @returns {Object} 回傳判定物件{ blocked, until }
 */
function recheck(sq, windows, nowMs) {
    let items = windows
        .filter((w) => Number.isFinite(toMs(w.resetsAt)) && toMs(w.resetsAt) > nowMs)
        .filter((w) => windowApplies(sq, { label: isestr(w.name) ? w.name : '', scope: isestr(w.scope) ? w.scope : '' }))
        .map((w) => ({ name: w.name, percent: w.percent, max: maxFor(sq, w.name), limited: false, resetsAt: w.resetsAt }))
    let j = judgeWindowItems(items)
    return { blocked: j.blocked, until: j.until }
}


/**
 * 查詢並快取讀者回應(永不reject；失敗亦快取同長度)
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果
 * @returns {Promise} 回傳Promise，resolve回傳快照(同toSnapshot，另帶cached)
 */
async function querySnapshot(sq) {
    return cachedQuery(stateOf(sq), sq.cacheKey, sq, async () => {
        let r = await awaitUserFn(() => sq.reader({ ...sq.readerOpt }), sq.timeoutMs + 2000)
        if (r.state !== 'value') {
            return { ok: false, windows: [], errorType: r.state === 'timeout' ? 'timeout' : 'other' }
        }
        return toSnapshot(r.value)
    })
}


/**
 * 判定某訂閱類條目此刻是否該略過(含額度帳與用量讀者；永不reject；失敗不擋)
 *
 * 流程: 先查帳(命中且now<until → blocked, source 'ledger', 不查讀者)；否則查讀者(家族快取)→視窗判定→blocked且until可解析即入帳；
 * 帳有清除過期項時呼叫saveState
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果(非null)
 * @param {Object} state 輸入遞補層狀態物件(取其quota)
 * @param {Function} saveState 輸入狀態寫回函數
 * @returns {Promise} 回傳Promise，resolve回傳判定物件，內含blocked、reason('limit'、'ok'、'error')、source('ledger'或'usage-api'，僅blocked)、windows、until(ISO或null)、cached、error(blocked時之略過訊息)、errorType與code(reason為error時)
 */
async function subGateDecide(sq, state, saveState) {
    let nowMs = sq.now()

    //①額度帳
    let f = ledgerFind(state, [sq.familyKey, sq.entryKey], nowMs, (windows, t) => recheck(sq, windows, t))
    if (f.dirty) {
        saveState()
    }
    if (f.hit !== null) {
        let ws = f.hit.windows.map((w) => ({ name: isestr(w.name) ? w.name : '', percent: typeof w.percent === 'number' ? w.percent : null, resetsAt: isestr(w.resetsAt) ? w.resetsAt : null, limited: false }))
        let why = ws.length > 0 ? `: ${descOf(ws)}` : ''
        return {
            blocked: true,
            reason: 'limit',
            source: 'ledger',
            windows: ws,
            until: f.hit.until,
            cached: true,
            error: `QUOTA_COOLDOWN: ${sq.label} subscription quota recorded as exhausted until ${f.hit.until} (${f.hit.source || 'ledger'}${why}); entry skipped`,
        }
    }

    //②用量讀者(家族快取、並行共用)
    let snap = await querySnapshot(sq)
    if (snap.ok !== true) {
        return { blocked: false, reason: 'error', windows: [], until: null, errorType: snap.errorType, code: null, cached: snap.cached }
    }
    let j = judgeWindowItems(itemsOf(sq, snap.windows))
    if (!j.blocked) {
        return { blocked: false, reason: 'ok', windows: [], until: null, cached: snap.cached }
    }

    //blocked: until可解析即入帳(截斷於8天)
    let until = null
    if (j.until !== null) {
        let u = clampUntilMs(toMs(j.until), nowMs)
        until = new Date(u).toISOString()
        let scopeOf = new Map(snap.windows.map((x) => [x.label !== '' ? x.label : x.scope, x.scope]))
        let wins = j.windows.map((w) => ({ name: w.name, percent: w.percent, resetsAt: w.resetsAt, scope: scopeOf.get(w.name) ?? '' }))
        if (ledgerPut(state, sq.familyKey, { until, at: new Date(nowMs).toISOString(), source: 'usage-api', windows: wins })) {
            saveState()
        }
    }
    return {
        blocked: true,
        reason: 'limit',
        source: 'usage-api',
        windows: j.windows,
        until,
        cached: snap.cached,
        error: `QUOTA_COOLDOWN: ${sq.label} subscription usage at or above the limit (${descOf(j.windows)}${until !== null ? `; resets at ${until}` : ''}); entry skipped`,
    }
}


/**
 * 條目失敗後學習重置時刻(CLI文字命中)：注入之quotaUntilOf優先，其次(僅claude)內建Claude Code官方額度字樣；有值即以entry:<id>入帳
 *
 * validation失敗(stdout為模型輸出)與索引式id(entryKey為null)不處理；永不拋錯
 *
 * @param {Object} sq 輸入resolveSubQuotaGate之結果(非null)
 * @param {Object} state 輸入遞補層狀態物件
 * @param {Function} saveState 輸入狀態寫回函數
 * @param {Object} r 輸入該次失敗結果
 * @param {Function|null} quotaUntilOf 輸入呼叫端注入之(r)=>Date|ISO字串|毫秒數|null同步函數，拋錯或回傳Promise視同null
 * @returns {Object|null} 回傳{ until(ISO), error }，未入帳回傳null
 */
function learnQuotaFromFailure(sq, state, saveState, r, quotaUntilOf) {
    try {
        if (sq.entryKey === null || get(r, 'errorType', null) === 'validation') {
            return null
        }
        let nowMs = sq.now()
        let untilMs = NaN
        if (quotaUntilOf !== null) {
            let h = callHookSync(() => quotaUntilOf(r))
            if (h.state === 'value') {
                untilMs = toMs(h.value)
            }
        }
        if (!Number.isFinite(untilMs) && sq.kind === 'claude') {
            //error取原始部分(baseErrorOf): CLI失敗之error可能已補上`: <stderr尾段>`(2026-11-08 da110), 該尾段是新增資訊, 不另當額度證據(stderr／stdout欄位照舊)
            let text = [baseErrorOf(get(r, 'error', null)), get(r, 'stderr', null), get(r, 'stdout', null)].filter(isestr).join('\n')
            untilMs = toMs(claudeLimitUntilOf(text, nowMs))
        }
        if (!Number.isFinite(untilMs) || untilMs <= nowMs) {
            return null
        }
        let until = new Date(clampUntilMs(untilMs, nowMs)).toISOString()
        if (!ledgerPut(state, sq.entryKey, { until, at: new Date(nowMs).toISOString(), source: 'limit-text' })) {
            return null
        }
        saveState()
        return { until, error: `QUOTA_COOLDOWN: ${sq.label} reported its usage limit (resets at ${until}); recorded in the quota ledger, entry skipped until then` }
    }
    catch {
        return null
    }
}


export { resolveSubQuotaGate, subGateDecide, learnQuotaFromFailure, agyGroupOf, itemsOf, toSnapshot }
