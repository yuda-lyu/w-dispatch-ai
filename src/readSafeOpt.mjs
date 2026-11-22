import isestr from 'wsemi/src/isestr.mjs'
import { probeReadable, errMsg } from './callUserFn.mjs'
import { readKey } from './readKeyOpt.mjs'


// readSafeOpt.mjs — 影響安全或計費之純量opt「給了而無效即拒絕」之判定單一來源(內部模組; 帳本R-SAFEOPT-1; 比照readKeyOpt.mjs之金鑰型opt)
//
// 【為何】dspec〈輸入參數之檢測機制〉§11〈安全相關opt為K3之例外〉: 影響安全或計費之opt「給了而無效」即拒絕(fail-closed), 不靜默改用預設:
//   修前: codex sandbox給了非字串→退回workspace-write(原要求read-only之意圖被放寬); claude／agy skipPermissions給了非布林→退回true(原要求保留權限閘門之意圖被關掉);
//   agy addDirs給了非陣列→退回[cwd](原要求限縮可視範圍之意圖被放寬); REST baseURL給了無效值→退回官方端點(金鑰改送官方); 各家exe給了無效值→退回PATH上之預設執行檔(換了執行檔),
//   各家cwd給了無效值→execCli退回process.cwd()(在別的目錄動手); getQuotaClaude／getQuotaCodex之env不可讀→退回process.env(查了預設帳號)。
//
// 【視為未給(維持預設)】undefined、null。 ''不視為未給(與金鑰型opt不同: 金鑰常取自環境變數而空字串＝缺值, 預設為登入態; 本檔各opt之空字串若退回預設即「悄悄改用預設值」, 屬給了而無效)。
// 【給了而無效(以params回報, 不起子行程、不送請求)】
//   readStrOpt  : 非原始字串、空字串(含包裝物件、數字、物件、函數、已撤銷之Proxy);
//   readBoolOpt : 非原始布林(含'true'、1、包裝物件);
//   readDirsOpt : 非陣列之定義值(字串、物件等)、不可讀之陣列(已撤銷之Proxy、length拋錯)、元素數逾上限, 或陣列含「非空且非原始字串」之元素而濾後無有效字串者;
//                 空陣列[]為合法(明示不揭露任何目錄); 含有效字串者無效元素照舊略過(同readKeys, 不因同組有無效元素而拒絕整組);
//   readEnvOpt  : 非一般物件(陣列、字串、數字等)或不可讀(拋錯之getter、已撤銷之Proxy); 用於env(額度讀者、四家CLI、filterOpencodeFree之子行程環境; resolveProviders／resolveCatalogue之金鑰來源)
//                 與exes(resolveProviders／resolveCatalogue之kind→執行檔路徑)——「給了而非物件」不視為未給(子行程不得因此悄悄繼承process.env、金鑰來源不得悄悄改用process.env、執行檔不得悄悄改用PATH上之預設);
//   readProviderOpt: dispatchOpencode之provider——只在key有效時才判(provider無效則key不被注入而悄悄改用auth.json既有登入＝計費路徑改變); ''與未給維持現狀(文件載明之預設／常見值)。
// 【訊息(K9)】只寫參數名、期望之種類與typeof, 不回顯值(值可能為路徑、網址或含金鑰之物件)。


//MAX_DIRS, addDirs陣列元素數上限(超過視為給了而無效, 同readKeyOpt之MAX_KEYS)
let MAX_DIRS = 10000


//given, 是否「給了」(undefined、null為未給)
function given(v) {
    return !(v === undefined || v === null)
}


//bad, 組「給了而無效」之訊息: 不含值本身(只含typeof; typeof對已撤銷之Proxy與包裝物件皆不拋錯)
function bad(name, want, v) {
    return `${name} must be ${want} when given (got ${typeof v}); an invalid ${name} is rejected instead of silently falling back to the default`
}


/**
 * 判定非空字串型之安全opt(exe、cwd、sandbox、baseURL)：未給(undefined、null)回null值；原始非空字串回該字串；其餘(給了而無效)回錯誤訊息
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含value(有效字串，未給或無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readStrOpt(v, name) {
    if (!given(v)) {
        return { value: null, err: '' }
    }
    if (isestr(v)) {
        return { value: v, err: '' }
    }
    return { value: null, err: bad(name, 'a non-empty string', v) }
}


/**
 * 判定布林型之安全opt(skipPermissions)：未給(undefined、null)回null值；原始布林回該值；其餘(給了而無效)回錯誤訊息
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含value(true、false；未給或無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readBoolOpt(v, name) {
    if (!given(v)) {
        return { value: null, err: '' }
    }
    if (v === true || v === false) {
        return { value: v, err: '' }
    }
    return { value: null, err: bad(name, 'a boolean', v) }
}


/**
 * 判定目錄陣列型之安全opt(addDirs)：未給回null；陣列回有效字串元素之陣列(無效元素略過；空陣列為合法)；其餘(給了而無效)回錯誤訊息
 *
 * 只經可讀性探針與typeof判定，不執行呼叫端之回調
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含dirs(有效目錄字串陣列；未給為null；無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readDirsOpt(v, name) {
    if (!given(v)) {
        return { dirs: null, err: '' }
    }
    let p = probeReadable(v, name)
    if (!p.ok) {
        return { dirs: null, err: p.msg }
    }
    if (!Array.isArray(v)) { //不用內部標籤判陣列: 偽造Symbol.toStringTag為'Array'之一般物件不是陣列
        return { dirs: null, err: bad(name, 'an array of non-empty strings', v) }
    }
    let out = []
    let nbad = 0
    try {
        let n = v.length
        if (!Number.isInteger(n) || n < 0) { //陣列Proxy之length可讀出非整數／負數: 無法逐元素判定, 視為不可讀
            return { dirs: null, err: `${name} is not readable: length is not a valid array length` }
        }
        if (n > MAX_DIRS) {
            return { dirs: null, err: `${name} has too many elements (more than ${MAX_DIRS}); an invalid ${name} is rejected instead of silently falling back to the default` }
        }
        for (let i = 0; i < n; i++) {
            let d = v[i]
            if (isestr(d)) {
                out.push(d)
            }
            else if (d !== undefined && d !== null && d !== '') {
                nbad++
            }
        }
    }
    catch (err) {
        return { dirs: null, err: `${name} is not readable: ${errMsg(err)}` }
    }
    if (out.length === 0 && nbad > 0) {
        return { dirs: null, err: `${name} has no valid directory: ${nbad} element(s) are not non-empty strings; an invalid ${name} is rejected instead of silently falling back to the default` }
    }
    return { dirs: out, err: '' }
}


/**
 * 判定一般物件型之安全opt(env：額度讀者、四家CLI、filterOpencodeFree、resolveProviders／resolveCatalogue；exes：resolveProviders／resolveCatalogue)：未給回null；可讀之一般物件回物化之淺層副本；其餘(給了而無效、不可讀)回錯誤訊息
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含env(物化之淺層副本；未給為null；無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readEnvOpt(v, name) {
    let e = checkObjOpt(v, name)
    if (e !== '') {
        return { env: null, err: e }
    }
    if (!given(v)) {
        return { env: null, err: '' }
    }
    if (v === process.env) {
        return { env: v, err: '' } //行程環境本身原樣交回(淺層副本會失去Windows之大小寫不分查找)
    }
    try {
        return { env: { ...v }, err: '' }
    }
    catch (err) {
        return { env: null, err: `${name} is not readable: ${errMsg(err)}` }
    }
}


/**
 * 判定一般物件型之安全opt之「形狀」(給了則須為可讀之一般物件)：只經可讀性探針與內部標籤判定，不展開、不讀屬性值(有狀態之getter不被讀取)
 *
 * 單一來源：readEnvOpt(展開前)、assertObjOpt、checkSafeOpts之env皆經此；遞補層與resolveProviders／resolveCatalogue不得執行呼叫端env內之getter(由轉接器物化讀一次，K4)
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {String} 回傳錯誤訊息字串(未給、或為可讀之一般物件、或為process.env本身回空字串；訊息不含值本身)
 */
function checkObjOpt(v, name) {
    if (!given(v) || v === process.env) {
        return ''
    }
    let p = probeReadable(v, name)
    if (!p.ok) {
        return p.msg
    }
    if (typeof v !== 'object' || p.tag !== '[object Object]') {
        return bad(name, 'an object', v)
    }
    return ''
}


/**
 * 斷言一般物件型之安全opt給了則須為可讀之物件，否則拋出(供同步函數用，如resolveProviders／resolveCatalogue之env、exes；其無params結果通道，與不可讀者同樣同步throw)
 *
 * 只驗形狀不取值、不執行getter：判定同checkObjOpt(單一來源)，呼叫端仍以原物件使用；未給(undefined、null)不拋
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {undefined} 無回傳值；給了而非物件或不可讀時拋出Error，訊息不含值本身
 */
function assertObjOpt(v, name) {
    let e = checkObjOpt(v, name)
    if (e !== '') {
        throw new Error(e)
    }
}


/**
 * 判定dispatchOpencode之provider：未給(undefined、null)與''(文件載明之預設／常見值)回null值；原始非空字串回該字串；
 * 其餘(給了而非原始非空字串)僅在key有效(keyed為true)時回錯誤訊息——provider無效則key不被注入，悄悄改用auth.json既有登入(計費路徑改變)；未給key者無此影響，維持現狀(回null值)
 *
 * @param {*} v 輸入provider之值
 * @param {Boolean} keyed 輸入是否有有效之key(非空原始字串)布林值
 * @param {String} [name='provider'] 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含value(有效provider字串；未給、''、未給key之無效值皆為null)、err(給了而無效且key有效時之訊息；否則空字串，訊息不含值本身)
 */
function readProviderOpt(v, keyed, name = 'provider') {
    if (v === undefined || v === null || v === '') {
        return { value: null, err: '' }
    }
    if (isestr(v)) {
        return { value: v, err: '' }
    }
    if (keyed === true) {
        return { value: null, err: `${name} must be a non-empty string when given together with a key (got ${typeof v}); an invalid ${name} is rejected instead of silently not injecting the key and falling back to the stored login` }
    }
    return { value: null, err: '' }
}


//SAFE_SPEC, 各kind(同adapters.mjs之鍵)之轉接器自身須判定之安全相關opt(鍵名與判定種類)——供遞補層於發出try事件之前判定(checkSafeOpts)
//種類: str(readStrOpt)、bool(readBoolOpt)、dirs(readDirsOpt)、env(checkObjOpt, 給了而非物件即拒絕; 只驗形狀不執行getter)、provider(readProviderOpt, 僅key有效時判)
let SAFE_SPEC = {
    'claude': [['exe', 'str'], ['cwd', 'str'], ['skipPermissions', 'bool'], ['env', 'env']],
    'codex': [['exe', 'str'], ['cwd', 'str'], ['sandbox', 'str'], ['cleanCodexRefs', 'bool'], ['env', 'env']],
    'opencode': [['exe', 'str'], ['cwd', 'str'], ['useStoredAuth', 'bool'], ['provider', 'provider'], ['env', 'env']],
    'antigravity': [['exe', 'str'], ['cwd', 'str'], ['skipPermissions', 'bool'], ['addDirs', 'dirs'], ['env', 'env']],
    'api-anthropic': [['baseURL', 'str']],
    'api-typesafe-systemone': [['baseURL', 'str']],
}


/**
 * 依kind判定轉接器之安全相關純量opt是否給了而無效，回第一個錯誤訊息(皆有效回空字串)
 *
 * 供dispatchAiFallback於發出try事件之前判定：此類params失敗於未送出任何嘗試即可知，不得發try事件(onUsage／createUsageCounter於try入帳)；
 * 轉接器自身仍各自判定(直呼時之防線)，兩處共用本檔之單一判定；讀取失敗(拋錯之getter等)視為不可讀回錯誤訊息
 *
 * @param {String} kind 輸入轉接器種類字串(claude、codex、opencode、antigravity、api-anthropic、api-typesafe-systemone；其餘回空字串)
 * @param {Object} opt 輸入條目疊上共用預設後之設定物件(已物化，可讀)
 * @param {Object} [ctx={}] 輸入情境物件，keyed為true代表該條目另有有效之金鑰(keys陣列帶有效字串；單一opt.key已由opt自身判定)，供provider之判定(僅key有效時才判)
 * @returns {String} 回傳第一個錯誤訊息字串(不含輸入值)，皆有效或kind不在表內回空字串
 * @example
 *
 * import { checkSafeOpts } from './src/readSafeOpt.mjs'
 *
 * console.log(checkSafeOpts('codex', { sandbox: 123 }))
 * // => 'sandbox must be a non-empty string when given (got number); an invalid sandbox is rejected instead of silently falling back to the default'
 *
 * console.log(checkSafeOpts('codex', { sandbox: 'read-only' }) === '')
 * // => true
 *
 */
function checkSafeOpts(kind, opt, ctx = {}) {
    let spec = Object.hasOwn(SAFE_SPEC, kind) ? SAFE_SPEC[kind] : null
    if (spec === null) {
        return ''
    }
    try {
        let keyed = ctx !== null && ctx !== undefined && ctx.keyed === true
        for (let [key, type] of spec) {
            let v = opt === null || opt === undefined ? undefined : opt[key]
            let r = null
            if (type === 'bool') {
                r = readBoolOpt(v, key)
            }
            else if (type === 'dirs') {
                r = readDirsOpt(v, key)
            }
            else if (type === 'env') {
                r = { err: checkObjOpt(v, key) } //只驗形狀、不展開(遞補層不執行呼叫端env內之getter, 由轉接器物化讀一次)
            }
            else if (type === 'provider') {
                r = readProviderOpt(v, keyed || readKey(opt === null || opt === undefined ? undefined : opt.key).key !== '', key)
            }
            else {
                r = readStrOpt(v, key)
            }
            if (r.err !== '') {
                return r.err
            }
        }
    }
    catch (err) {
        return `safe opt is not readable: ${errMsg(err)}`
    }
    return ''
}


export { readStrOpt, readBoolOpt, readDirsOpt, readEnvOpt, checkObjOpt, assertObjOpt, readProviderOpt, checkSafeOpts }
