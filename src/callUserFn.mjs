import strTruncate from 'wsemi/src/strTruncate.mjs'
import getErrorMessage from 'wsemi/src/getErrorMessage.mjs'
import util from 'util'


// callUserFn.mjs — 呼叫「呼叫端注入之函數」與讀取「呼叫端物件」之單一入口(內部模組, 不列入README之Functions; 帳本R-USERFN-1)
//
// 【為何需要】各站點原以同步方式取用回傳值(!!fn()、fn()===true、isestr(fn())), 回調為async函數(或回傳Promise)時:
//   validate恆視為通過、check恆不過、parse之Promise被當成果、prompt被判空、shouldStop/coolDetect恆為false;
//   其Promise被reject時無人承接→未處理之rejection→行程崩潰(node預設)。2026-10-14實測30站點×13回傳形態(./tmp/asyncval-20261014-全盤.md)。
//
// 【三種呼叫法】
//   awaitUserFn: 內容類回調(validate、check、parse、prompt函式)——支援非同步, 以呼叫端給定之上限等待(上限由各站點依
//     「該次嘗試／該段之剩餘時間」計算, 見runExecCli與REST轉接器), 永不落定者亦必落定; 逾時不取消使用者之工作(無signal)
//   callHookSync: 控制類回調(shouldStop、coolDetect、onEvent、store.get/set)與工廠注入之函數(stamp、getDate、keyOf)——
//     同步契約, 回傳thenable視同失敗(由各站點採其既有之安全預設), 並承接其rejection(不使行程崩潰)
//   readCallerObj: 本套件會展開之呼叫端物件(env、headers、body、providers條目)——不可讀者回錯誤訊息供站點以params回報,
//     可讀者回物化之淺層副本(自有可列舉屬性, 同物件展開; 只讀一次, 有狀態之getter不會被讀第二次; 巢狀值為同一參照, 一般資料物件之送出內容不變)
//   probeReadable: 可讀性探針(單一來源, 帳本R-USERFN-4)——呼叫端給的物件／陣列可否讀取(內部標籤＋自有鍵列表, 拋錯即不可讀); 本套件不借wsemi判斷函數(isobj、isarr等)對敵意輸入拋錯來成立防線
//   皆收thunk(而非fn與參數), 保留呼叫端原有之this綁定(如store.get())
//
// 【訊息】取wsemi之getErrorMessage(對null、已撤銷Proxy等不拋錯), 為空者退String(err), 再不行為'unknown error'; 截斷至500字元(同wsemi之execCli)


//TIMER_MAX, setTimeout之上限(超過即被node視為1ms)
let TIMER_MAX = 2147483647


//optTruncate, 同execCli: 刪節號後標註原始總長度
let optTruncate = {
    funWithMsg: (str) => `(truncated, total ${str.length} chars)`,
}


/**
 * 安全讀取拋出值之字串欄位(如'name'、'cause.code')：拋出值為null、已撤銷之Proxy或欄位getter拋錯時回空字串，不拋錯
 *
 * @param {*} err 輸入拋出值
 * @param {String} path 輸入以點分隔之欄位路徑字串，例如'cause.code'
 * @returns {String} 回傳欄位值字串，非字串或讀取失敗回空字串
 */
function errField(err, path) {
    try {
        let v = err
        for (let k of path.split('.')) {
            if (v === null || v === undefined) {
                return ''
            }
            v = v[k]
        }
        return typeof v === 'string' ? v : ''
    }
    catch {
        return ''
    }
}


/**
 * 取呼叫端函數回傳值之文字(prompt函式、keyOf等)：原始字串原樣；String包裝物件取其字串值(此為轉型取文字、不經isestr；wsemi 1.9.69起判斷函數isestr只收原始字串，本函數行為不變)；其餘或轉換拋錯回空字串，不拋錯
 *
 * @param {*} v 輸入呼叫端函數之回傳值(或resolve值)
 * @returns {String} 回傳文字，無法取得時為空字串
 */
function asText(v) {
    if (typeof v === 'string') {
        return v
    }
    try {
        if (v instanceof String) {
            let s = String(v)
            return typeof s === 'string' ? s : ''
        }
    }
    catch {}
    return ''
}


function errMsg(err) {
    let m = getErrorMessage(err)
    if (m === '') {
        try {
            m = String(err)
        }
        catch {
            m = 'unknown error'
        }
    }
    return strTruncate(m, 500, optTruncate)
}


/**
 * 回傳值若為thenable則轉為原生Promise，否則回null(不拋錯)
 *
 * then只讀一次並以之承接(Promise.resolve會再讀一次then, 有狀態之then getter會因此被誤判)；
 * 原生Promise一律以內建then承接(不讀其自有之then屬性, 免then getter拋錯時被當成同步值而遺留其rejection)；
 * 讀then拋錯之非原生物件視為非thenable(以同步值論，同既有規則)。
 * 承接過程拋錯(如自訂then同步拋錯、原生Promise之constructor getter拋錯)時回傳之Promise為reject，由呼叫端以threw回報；
 * 惟「已reject之原生Promise且其constructor getter拋錯」者，任何使用者層之承接(內建then、await、Promise.resolve)皆先讀constructor而失敗，
 * 其rejection無從承接(2026-10-16實測6種寫法皆崩潰)，屬契約外(帳本R-USERFN-1)。
 *
 * @param {*} v 輸入回傳值
 * @returns {Promise|null} 回傳原生Promise，非thenable時回null
 */
function adoptThenable(v) {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) {
        return null
    }
    if (util.types.isPromise(v)) {
        return new Promise((resolve, reject) => {
            Promise.prototype.then.call(v, resolve, reject)
        })
    }
    let then = null
    try {
        then = v.then
    }
    catch {
        return null
    }
    if (typeof then !== 'function') {
        return null
    }
    return new Promise((resolve, reject) => {
        then.call(v, resolve, reject)
    })
}


/**
 * 承接使用者回傳值：thenable則等待其結果(只讀一次then，同adoptThenable)，否則原樣回傳；不設上限(由外層之awaitUserFn設限)
 *
 * 供以await串接多個呼叫端函數之站點(如工作流之parse→check、交集之validate)，令其判型與awaitUserFn一致——
 * 原生await會再讀then，同步回傳then getter拋錯之物件時會拋錯，與轉接器「同步值以真值判定」不一致
 *
 * 結果裝箱回傳({ value })：Promise之resolve程序會再讀resolve值之then(已撤銷Proxy等即拋錯), 故不可直接以值resolve
 *
 * @param {*} v 輸入回傳值
 * @returns {Promise} 回傳Promise，resolve回傳物件{ value }(value為原值或thenable之resolve值)，thenable被reject時同樣reject
 */
async function settleUserValue(v) {
    let p = adoptThenable(v)
    if (p === null) {
        return { value: v }
    }
    return p.then((value) => ({ value }))
}


/**
 * 呼叫內容類回調並等待其結果(支援非同步，以timeoutMs為上限，不拋錯、不reject)
 *
 * @param {Function} thunk 輸入無參數之呼叫函數，例如() => validate(stdout)
 * @param {Number} timeoutMs 輸入回傳Promise時之等待上限毫秒正整數
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含state('value'、'threw'、'timeout')、value(回傳值或resolve值)、msg(拋錯訊息或逾時說明)
 */
async function awaitUserFn(thunk, timeoutMs) {
    let v
    try {
        v = thunk()
    }
    catch (err) {
        return { state: 'threw', value: undefined, msg: errMsg(err) }
    }
    let pv = adoptThenable(v)
    if (pv === null) {
        return { state: 'value', value: v, msg: '' }
    }

    //pUser先建, 成功後才建計時器; adoptThenable之承接錯誤(如constructor getter拋錯)以reject呈現, 歸threw
    let pUser = pv.then(
        (value) => ({ state: 'value', value, msg: '' }),
        (err) => ({ state: 'threw', value: undefined, msg: errMsg(err) }),
    )
    let ms = Math.min(Math.max(Number(timeoutMs) || 0, 1), TIMER_MAX)
    let timer = null
    let pTimeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve({ state: 'timeout', value: undefined, msg: `did not settle within ${ms / 1000}s` })
        }, ms)
    })
    let r = await Promise.race([pUser, pTimeout])
    clearTimeout(timer)
    return r
}


/**
 * 由awaitUserFn之結果產出validate之stderr註記(拋錯與reject為'validate threw: 訊息'，逾時為'validate timed out: 說明'，其餘空字串)
 *
 * @param {Object} v 輸入awaitUserFn之結果物件
 * @returns {String} 回傳註記字串
 */
function validateNote(v) {
    if (v.state === 'threw') {
        return `validate threw: ${v.msg}`
    }
    if (v.state === 'timeout') {
        return `validate timed out: ${v.msg}`
    }
    return ''
}


/**
 * 呼叫控制類回調(同步契約；回傳thenable視同失敗並承接其rejection，不拋錯)
 *
 * @param {Function} thunk 輸入無參數之呼叫函數，例如() => shouldStop()
 * @returns {Object} 回傳物件，內含state('value'、'threw'、'async')、value(同步回傳值)、msg(拋錯訊息)
 */
function callHookSync(thunk) {
    let v
    try {
        v = thunk()
    }
    catch (err) {
        return { state: 'threw', value: undefined, msg: errMsg(err) }
    }
    let pv = adoptThenable(v)
    if (pv !== null) {
        pv.then(undefined, () => {}) //承接其rejection(含承接過程之錯誤), 不使行程崩潰
        return { state: 'async', value: undefined, msg: 'returned a Promise (must be synchronous)' }
    }
    return { state: 'value', value: v, msg: '' }
}


/**
 * 可讀性探針(本套件內部共用之單一來源；帳本R-USERFN-4)：判定呼叫端給的物件、陣列、函數可否被讀取，不執行呼叫端之回調
 *
 * 探針為明確之兩步——取內部標籤(Object.prototype.toString.call，已撤銷之Proxy、Symbol.toStringTag拋錯者拋)與列自有鍵(Reflect.ownKeys，ownKeys陷阱拋錯者拋)，
 * 拋錯即不可讀，回錯誤訊息供站點依其既有之失敗通道回報(多為params)。
 * 本套件不再借wsemi判斷函數(isobj、isarr、isstr等)對敵意輸入拋錯來成立防線：wsemi 1.9.69起判斷函數對任何輸入皆不拋錯(拋錯者回false，dspec〈輸入參數之檢測機制〉C2)，
 * 於是「不可讀」與「不是物件」於判斷函數上不可分，須先經本探針分辨(不可讀者回報，可讀者才交判斷函數判型)。
 * 純量(含null、undefined)恆可讀；只探針不展開、不讀屬性值(有狀態之getter不被讀取)。
 *
 * @param {*} v 輸入呼叫端給予之值
 * @param {String} [name='value'] 輸入名稱字串，用於錯誤訊息，例如'spec.fallback'
 * @returns {Object} 回傳物件，內含ok(是否可讀布林值)、tag(可讀時為Object.prototype.toString.call(v)之結果，如'[object Object]'、'[object Array]'；不可讀時為空字串)、msg(不可讀時之訊息'<name> is not readable: <訊息>')、reason(不可讀時之原因訊息，即msg去掉前綴者；可讀時為空字串)
 */
function probeReadable(v, name = 'value') {
    try {
        let tag = Object.prototype.toString.call(v)
        if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
            Reflect.ownKeys(v)
        }
        return { ok: true, tag, msg: '', reason: '' }
    }
    catch (err) {
        let reason = errMsg(err)
        return { ok: false, tag: '', msg: `${name} is not readable: ${reason}`, reason }
    }
}


/**
 * 斷言呼叫端給的物件／陣列可讀，不可讀即拋出(供同步函數用，如resolveProviders；其無params結果通道，修前由判斷函數對敵意輸入拋錯而同步throw，改為明確拋出)
 *
 * @param {*} v 輸入呼叫端給予之值(純量恆可讀)
 * @param {String} name 輸入名稱字串，用於錯誤訊息
 * @returns {undefined} 無回傳值；不可讀時拋出Error，訊息為'<name> is not readable: <原因>'
 */
function assertReadable(v, name) {
    let p = probeReadable(v, name)
    if (!p.ok) {
        throw new Error(p.msg)
    }
}


/**
 * 讀取呼叫端物件(本套件會展開者)：非物件原樣交回；物件回物化之淺層副本；不可讀(拋錯之getter、已撤銷之Proxy)回錯誤訊息
 *
 * 可讀性先經probeReadable(不借isobj對敵意輸入拋錯)，含函數型(已撤銷之函數Proxy亦為不可讀)；只有內部標籤為'[object Object]'之物件才展開(函數、陣列、Headers、Map等原樣交回)
 *
 * @param {*} v 輸入呼叫端給予之值
 * @param {String} name 輸入名稱字串，用於錯誤訊息，例如'env'、'headers'
 * @returns {Object} 回傳物件，內含ok(是否可讀布林值)、value(原值或物化之副本)、msg(不可讀時之訊息'<name> is not readable: <訊息>')
 */
function readCallerObj(v, name) {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) {
        return { ok: true, value: v, msg: '' }
    }
    let p = probeReadable(v, name)
    if (!p.ok) {
        return { ok: false, value: undefined, msg: p.msg }
    }
    if (typeof v !== 'object' || p.tag !== '[object Object]') {
        return { ok: true, value: v, msg: '' } //函數(可讀者)、陣列、Headers、Map等原樣交回
    }
    try {
        return { ok: true, value: { ...v }, msg: '' }
    }
    catch (err) {
        return { ok: false, value: undefined, msg: `${name} is not readable: ${errMsg(err)}` }
    }
}


export { awaitUserFn, callHookSync, probeReadable, assertReadable, readCallerObj, validateNote, adoptThenable, settleUserValue, asText, errMsg, errField }
