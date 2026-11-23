import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { probeReadable, errMsg } from './callUserFn.mjs'
import { readKey } from './readKeyOpt.mjs'
import { castOutputTokenMax } from './outputTokenMax.mjs'


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
//
// 【影響計費之opt(2026-11-23 tdai2, 帳本R-SAFEOPT-1規則11、12)】給了而無效時會改變計費(改用CLI預設模型、預設effort、預設輸出上限、預設max_tokens、實際發出請求)者, 一律「給了而無效即拒絕」:
//   readNameOpt  : model(四家CLI)、dispatchAntigravity之effort——未給(undefined、null)與''(文件載明之預設, 代表不帶旗標)為未給; 原始非空字串有效; 其餘無效(無效則整段旗標不出現而改用CLI預設);
//   readEnumOpt  : dispatchApiAnthropic之effort——未給與''為未給; 須在允許集合(ANTHROPIC_EFFORTS)內(無效則不送而由API依模型預設);
//   readTokenMaxOpt: dispatchOpencode之outputTokenMax——未給(undefined、null)為未給; 有效之正整數(數字或數字字串)採用; 其餘(含'')無效(無效則改用預設128000或呼叫端環境);
//   readFunOpt   : dispatchApiAnthropic／dispatchClaude(交叉確認)之fetch——未給為未給; 須為函數(非函數則改走全域fetch＝真實請求);
//   checkReadObj : 四個REST轉接器之body(已物化之值)——未給為未給; 須為一般物件(非物件則額外本體被略過而用預設max_tokens等);
//   dispatchClaude之crossCheck經readBoolOpt(非布林則視為true而多發一則REST請求)。
//   不改變計費者(maxRetries、timeoutMs、retryDelayMs、stopOnLimit、promptVia、printTimeout、acceptTruncated、detectTruncation、continueLoopOnDeny、validate、system、headers、agent、config、crossCheckBaseURL、crossCheckModel、extraArgs等)維持K3(無效視為未給); 盤點見sgud/state/state_tdai2.md。
//
// 【env各變數之值、exes各kind之值(2026-11-23 tdai2, 規則11)】env之值須為字串(undefined為合法: wsemi execCli載明「值為undefined代表移除該變數」, 實測Node spawn不傳該變數; null、數字、布林、物件等非字串給了即拒絕——
//   實測Node將其轉成字面字串'null'、'123'、'true'、'[object Object]', Symbol則拋TypeError); exes之值須為非空字串(undefined、null為未給該kind)。
//   形狀判定與值判定同源: checkObjOpt(v, name, vals)只驗形狀與「資料屬性」之值、不執行getter(遞補層與resolveProviders用); readEnvOpt／readExesOpt於物化(只讀一次)之副本上驗全部值(轉接器用)。
//   pick(resolveProviders／resolveCatalogue)給了而非陣列、patch給了而非物件同樣拒絕(同步throw): checkArrOpt／checkObjOpt。
//
// 【2026-11-23 tdai2b(排程第601項之主控裁定; 規則11補)】①patch內逐id之值須為一般物件(undefined、null為未給該id): readPatchOpt(與exes同源readMapOpt, 物化一次、於副本上驗全部值, 訊息不回顯id與值);
//   ②resolveCatalogue之catalogue給了而非陣列同步throw(assertArrOpt, 與pick同一判定; 未給才用內建目錄, 其內含付費條目);
//   ③dispatchOpencode之config給了而非字串亦非一般物件即拒絕(checkConfigOpt; ''與字串有效, 不可讀者之訊息同修前; 無效則沿用使用者既有設定, 其內可載model、provider之預設); agent維持(退回build, 屬權限面而非計費)。
// 【訊息(K9)】只寫參數名、期望之種類與typeof, 不回顯值(值可能為路徑、網址或含金鑰之物件); 物件類之值判定訊息只寫不合規之個數與其中首個之typeof, 不寫變數名／kind名(名稱亦由呼叫端給定)。


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
        return { env: v, err: '' } //行程環境本身原樣交回(淺層副本會失去Windows之大小寫不分查找; 其值恆為字串)
    }
    let copy = null
    try {
        copy = { ...v }
    }
    catch (err) {
        return { env: null, err: `${name} is not readable: ${errMsg(err)}` }
    }

    //各變數之值於物化之副本上判(getter已讀一次: 檢查之值即使用之值, K4); 值須為字串, undefined為合法(移除該變數)
    let ev = checkObjValues(copy, name, 'env')
    if (ev !== '') {
        return { env: null, err: ev }
    }
    return { env: copy, err: '' }
}


/**
 * 判定kind對執行檔路徑之物件型安全opt(exes：resolveProviders／resolveCatalogue)：未給回null；可讀之一般物件且各kind之值皆為非空字串(undefined、null為未給該kind)回物化之淺層副本；其餘(給了而無效、不可讀)回錯誤訊息
 *
 * 形狀與readEnvOpt同源(checkObjOpt)；各值於物化之副本上判(getter只讀一次，檢查之值即使用之值，K4)
 *
 * @param {*} v 輸入opt之值
 * @param {String} [name='exes'] 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含exes(物化之淺層副本；未給為null；無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身與kind名)
 */
function readExesOpt(v, name = 'exes') {
    let r = readMapOpt(v, name, 'exe')
    return { exes: r.value, err: r.err }
}


/**
 * 判定id對部分欄位物件之物件型opt(patch：resolveProviders／resolveCatalogue)：未給回null；可讀之一般物件且各id之值皆為一般物件(undefined、null為未給該id)回物化之淺層副本；其餘(給了而無效、不可讀)回錯誤訊息
 *
 * 形狀與值之判定與readExesOpt同源(readMapOpt)；各值於物化之副本上判(getter只讀一次，檢查之值即使用之值，K4)；訊息不回顯id與值
 *
 * @param {*} v 輸入opt之值
 * @param {String} [name='patch'] 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含patch(物化之淺層副本；未給為null；無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身與id)
 */
function readPatchOpt(v, name = 'patch') {
    let r = readMapOpt(v, name, 'obj')
    return { patch: r.value, err: r.err }
}


/**
 * 判定「鍵對值」之物件型opt(內部單一來源：exes、patch)：形狀同checkObjOpt，可讀之一般物件物化為淺層副本後於副本上驗全部值
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @param {String} vals 輸入值判定種類字串('exe'、'obj'，見checkObjValues)
 * @returns {Object} 回傳物件，內含value(物化之淺層副本；未給或無效為null)、err(給了而無效時之訊息；否則空字串)
 */
function readMapOpt(v, name, vals) {
    let e = checkObjOpt(v, name)
    if (e !== '') {
        return { value: null, err: e }
    }
    if (!given(v)) {
        return { value: null, err: '' }
    }
    let copy = null
    try {
        copy = { ...v }
    }
    catch (err) {
        return { value: null, err: `${name} is not readable: ${errMsg(err)}` }
    }
    let ev = checkObjValues(copy, name, vals)
    if (ev !== '') {
        return { value: null, err: ev }
    }
    return { value: copy, err: '' }
}


/**
 * 判定物件各自有屬性之值是否合規(內部)：只檢「資料屬性」之值，存取器(getter)不執行而略過(其值由取值之站點於物化時再判)；不可讀(陷阱拋錯)回錯誤訊息
 *
 * vals為'env'：值須為原始字串，undefined為合法(wsemi execCli載明為移除該變數；實測Node spawn不傳該變數)，null、數字、布林、物件、包裝物件、Symbol、BigInt皆無效(Node會轉成字面字串或拋錯)；
 * vals為'exe'：值須為原始非空字串，undefined、null為未給該kind；
 * vals為'obj'(patch：id對部分欄位物件)：值須為一般物件，undefined、null為未給該id，字串、數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt、已撤銷之Proxy皆無效
 *
 * @param {Object} v 輸入已通過形狀判定之一般物件
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @param {String} vals 輸入值判定種類字串('env'、'exe'、'obj')
 * @returns {String} 回傳錯誤訊息字串(皆合規回空字串；訊息只含不合規之個數與首個之typeof，不含值、變數名、kind名、id)
 */
function checkObjValues(v, name, vals) {
    let ok = vals === 'exe'
        ? (x) => x === undefined || x === null || isestr(x)
        : vals === 'obj'
            ? (x) => x === undefined || x === null || isobj(x)
            : (x) => x === undefined || typeof x === 'string'
    let want = vals === 'exe' ? 'non-empty strings' : vals === 'obj' ? 'objects' : 'strings'
    let n = 0
    let first = ''
    try {
        for (let k of Object.keys(v)) {
            let d = Object.getOwnPropertyDescriptor(v, k)
            if (d === undefined || !Object.prototype.hasOwnProperty.call(d, 'value')) {
                continue //存取器: 不執行(不讀其值)
            }
            if (!ok(d.value)) {
                n++
                if (first === '') {
                    first = typeof d.value
                }
            }
        }
    }
    catch (err) {
        return `${name} is not readable: ${errMsg(err)}`
    }
    if (n > 0) {
        return `${name} values must be ${want} when given (${n} invalid, first got ${first}); an invalid ${name} is rejected instead of silently coerced or skipped`
    }
    return ''
}


/**
 * 判定一般物件型之安全opt之「形狀」(給了則須為可讀之一般物件)：只經可讀性探針與內部標籤判定，不展開、不讀屬性值(有狀態之getter不被讀取)
 *
 * 單一來源：readEnvOpt(展開前)、assertObjOpt、checkSafeOpts之env皆經此；遞補層與resolveProviders／resolveCatalogue不得執行呼叫端env內之getter(由轉接器物化讀一次，K4)
 *
 * 給vals('env'、'exe')時另驗各自有屬性之「資料屬性」之值(存取器不執行而略過，見checkObjValues)；不給vals只驗形狀
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @param {String} [vals=''] 輸入值判定種類字串，''只驗形狀，'env'(值須為字串，undefined合法)、'exe'(值須為非空字串，undefined、null為未給該kind)、'obj'(值須為一般物件，undefined、null為未給該id)另驗各值
 * @returns {String} 回傳錯誤訊息字串(未給、或為可讀之一般物件、或為process.env本身回空字串；訊息不含值本身)
 */
function checkObjOpt(v, name, vals = '') {
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
    if (vals !== '') {
        return checkObjValues(v, name, vals)
    }
    return ''
}


/**
 * 斷言一般物件型之安全opt給了則須為可讀之物件，否則拋出(供同步函數用，如resolveProviders／resolveCatalogue之env、exes、patch；其無params結果通道，與不可讀者同樣同步throw)
 *
 * 只驗形狀與資料屬性之值、不取值、不執行getter：判定同checkObjOpt(單一來源)，呼叫端仍以原物件使用；未給(undefined、null)不拋
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @param {String} [vals=''] 輸入值判定種類字串，同checkObjOpt
 * @returns {undefined} 無回傳值；給了而非物件或不可讀(或vals指定之值不合規)時拋出Error，訊息不含值本身
 */
function assertObjOpt(v, name, vals = '') {
    let e = checkObjOpt(v, name, vals)
    if (e !== '') {
        throw new Error(e)
    }
}


/**
 * 判定陣列型之安全opt之「形狀」(給了則須為可讀之陣列)：只經可讀性探針與Array.isArray判定，不展開、不讀元素
 *
 * 供resolveProviders／resolveCatalogue之pick用(給了而非陣列者修前視同未給而全取，含付費條目)；空陣列合法(文件載明：空陣列代表全取)
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {String} 回傳錯誤訊息字串(未給或為可讀之陣列回空字串；訊息不含值本身)
 */
function checkArrOpt(v, name) {
    if (!given(v)) {
        return ''
    }
    let p = probeReadable(v, name)
    if (!p.ok) {
        return p.msg
    }
    let isArr = false
    try {
        isArr = Array.isArray(v)
    }
    catch (err) {
        return `${name} is not readable: ${errMsg(err)}`
    }
    if (!isArr) {
        return bad(name, 'an array', v)
    }
    return ''
}


/**
 * 斷言陣列型之安全opt給了則須為可讀之陣列，否則拋出(供同步函數用，如resolveProviders／resolveCatalogue之pick)
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {undefined} 無回傳值；給了而非陣列或不可讀時拋出Error，訊息不含值本身
 */
function assertArrOpt(v, name) {
    let e = checkArrOpt(v, name)
    if (e !== '') {
        throw new Error(e)
    }
}


/**
 * 判定名稱型之計費相關opt(四家CLI之model、dispatchAntigravity之effort)：未給(undefined、null)與''(文件載明之預設，代表不帶旗標)回null值；原始非空字串回該字串；其餘(給了而無效)回錯誤訊息
 *
 * 無效時修前整段旗標(`--model`、`-m`、`--effort`)不出現，改由CLI自行決定模型或檔位(計費隨之改變)，故給了而無效即拒絕
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含value(有效字串；未給、''或無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readNameOpt(v, name) {
    if (v === undefined || v === null || v === '') {
        return { value: null, err: '' }
    }
    if (isestr(v)) {
        return { value: v, err: '' }
    }
    return { value: null, err: bad(name, 'a non-empty string', v) }
}


//ANTHROPIC_EFFORTS, dispatchApiAnthropic之effort允許集合(單一來源: 轉接器送出前與遞補層判定共用)
let ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']


/**
 * 判定列舉型之計費相關opt(dispatchApiAnthropic之effort)：未給(undefined、null)與''(文件載明之預設，代表不送)回null值；在允許集合內之原始字串回該字串；其餘(給了而無效)回錯誤訊息
 *
 * 無效時修前不送output_config.effort，改由API依模型決定檔位(計費隨之改變)，故給了而無效即拒絕；訊息列出允許之集合(dspec V19)而不寫給定之值
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @param {Array} list 輸入允許值之字串陣列
 * @returns {Object} 回傳物件，內含value(有效字串；未給、''或無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readEnumOpt(v, name, list) {
    if (v === undefined || v === null || v === '') {
        return { value: null, err: '' }
    }
    if (typeof v === 'string' && list.includes(v)) {
        return { value: v, err: '' }
    }
    return { value: null, err: `${name} must be one of ${list.join(', ')} when given (got ${typeof v}); an invalid ${name} is rejected instead of silently falling back to the default` }
}


/**
 * 判定輸出上限型之計費相關opt(dispatchOpencode之outputTokenMax)：未給(undefined、null)回null值；有效之正整數(數字或數字字串，判定同castOutputTokenMax)回該正整數；其餘(含'')回錯誤訊息
 *
 * 無效時修前改用呼叫端環境或套件預設128000(輸出上限與計費隨之改變)，故給了而無效即拒絕
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含value(有效正整數；未給或無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readTokenMaxOpt(v, name) {
    if (!given(v)) {
        return { value: null, err: '' }
    }
    let n = castOutputTokenMax(v)
    if (n !== null) {
        return { value: n, err: '' }
    }
    return { value: null, err: bad(name, 'a positive integer (number or numeric string)', v) }
}


/**
 * 判定函數型之計費相關opt(dispatchApiAnthropic、dispatchClaude交叉確認之fetch)：未給(undefined、null)回null值；函數回該函數；其餘(給了而非函數)回錯誤訊息
 *
 * 無效時修前改走全域fetch(發出真實請求而非呼叫端注入之替身)，故給了而無效即拒絕
 *
 * @param {*} v 輸入opt之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含value(函數；未給或無效為null)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readFunOpt(v, name) {
    if (!given(v)) {
        return { value: null, err: '' }
    }
    if (isfun(v)) {
        return { value: v, err: '' }
    }
    return { value: null, err: bad(name, 'a function', v) }
}


/**
 * 判定「已物化之物件型opt」之形狀(四個REST轉接器之body，已經readCallerObj物化)：未給(undefined、null)或一般物件回空字串；其餘(給了而非一般物件：字串、數字、陣列、Map、函數等)回錯誤訊息
 *
 * body給了而非物件者修前被略過而用預設max_tokens等(輸出上限與計費隨之改變)，故給了而無效即拒絕；可讀性已由readCallerObj判定
 *
 * @param {*} v 輸入已物化之值
 * @param {String} name 輸入參數名稱字串，用於錯誤訊息
 * @returns {String} 回傳錯誤訊息字串(合規回空字串；訊息不含值本身)
 */
function checkReadObj(v, name) {
    if (!given(v) || isobj(v)) {
        return ''
    }
    return bad(name, 'an object', v)
}


/**
 * 判定dispatchOpencode之config(opencode設定內容)：未給(undefined、null)、原始字串(含'')、可讀之一般物件回空字串；其餘(給了而非字串亦非一般物件)與不可讀者回錯誤訊息
 *
 * config無效時修前被略過而沿用使用者既有設定檔(其內可載model、provider之預設，計費路徑隨之改變)，故給了而無效即拒絕(排程第601項tdai2b之主控裁定)；
 * 不可讀者(已撤銷之Proxy、內部標籤拋錯)之訊息同修前('config is not JSON-serializable: <原因>')；可序列化與否(BigInt、循環參照等)仍由轉接器於序列化時判
 *
 * @param {*} v 輸入config之值
 * @param {String} [name='config'] 輸入參數名稱字串，用於錯誤訊息
 * @returns {String} 回傳錯誤訊息字串(合規回空字串；訊息不含值本身)
 */
function checkConfigOpt(v, name = 'config') {
    if (!given(v)) {
        return ''
    }
    let p = probeReadable(v, name)
    if (!p.ok) {
        return `${name} is not JSON-serializable: ${p.reason}`
    }
    if (typeof v === 'string') {
        return ''
    }
    if (typeof v === 'object' && p.tag === '[object Object]') {
        return ''
    }
    return `${name} must be a string or an object when given (got ${typeof v}); an invalid ${name} is rejected instead of silently falling back to the existing settings`
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
//種類: str(readStrOpt)、bool(readBoolOpt)、dirs(readDirsOpt)、env(checkObjOpt加'env', 給了而非物件、或資料屬性之值非字串即拒絕; 只驗形狀與資料屬性之值、不執行getter)、provider(readProviderOpt, 僅key有效時判)、
//      name(readNameOpt: model、effort)、enum(readEnumOpt, 第三元素為允許集合)、tokmax(readTokenMaxOpt)、fun(readFunOpt)、obj(checkObjOpt只驗形狀: body)、config(checkConfigOpt: opencode之config, tdai2b); 帳本R-SAFEOPT-1規則11
//api-anthropic／api-openai-compat／api-openai-responses之model為必填(轉接器已於未給或無效時以params回報), 不列入; api-typesafe-systemone之model為選填(未給用官方預設), 列入(name)
let SAFE_SPEC = {
    'claude': [['exe', 'str'], ['cwd', 'str'], ['skipPermissions', 'bool'], ['env', 'env'], ['model', 'name'], ['crossCheck', 'bool'], ['fetch', 'fun']],
    'codex': [['exe', 'str'], ['cwd', 'str'], ['sandbox', 'str'], ['cleanCodexRefs', 'bool'], ['env', 'env'], ['model', 'name']],
    'opencode': [['exe', 'str'], ['cwd', 'str'], ['useStoredAuth', 'bool'], ['provider', 'provider'], ['env', 'env'], ['model', 'name'], ['outputTokenMax', 'tokmax'], ['config', 'config']],
    'antigravity': [['exe', 'str'], ['cwd', 'str'], ['skipPermissions', 'bool'], ['readOnly', 'bool'], ['addDirs', 'dirs'], ['env', 'env'], ['model', 'name'], ['effort', 'name']],
    'api-anthropic': [['baseURL', 'str'], ['effort', 'enum', ANTHROPIC_EFFORTS], ['body', 'obj'], ['fetch', 'fun']],
    'api-typesafe-systemone': [['baseURL', 'str'], ['model', 'name'], ['body', 'obj']],
    'api-openai-compat': [['body', 'obj']],
    'api-openai-responses': [['body', 'obj']],
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
        for (let [key, type, extra] of spec) {
            let v = opt === null || opt === undefined ? undefined : opt[key]
            let r = null
            if (type === 'bool') {
                r = readBoolOpt(v, key)
            }
            else if (type === 'dirs') {
                r = readDirsOpt(v, key)
            }
            else if (type === 'env') {
                r = { err: checkObjOpt(v, key, 'env') } //只驗形狀與資料屬性之值、不展開(遞補層不執行呼叫端env內之getter, 由轉接器物化讀一次並於副本上判全部值)
            }
            else if (type === 'obj') {
                r = { err: checkObjOpt(v, key) } //body: 只驗形狀(不執行getter; 值為何由轉接器物化後判)
            }
            else if (type === 'provider') {
                r = readProviderOpt(v, keyed || readKey(opt === null || opt === undefined ? undefined : opt.key).key !== '', key)
            }
            else if (type === 'name') {
                r = readNameOpt(v, key)
            }
            else if (type === 'enum') {
                r = readEnumOpt(v, key, extra)
            }
            else if (type === 'tokmax') {
                r = readTokenMaxOpt(v, key)
            }
            else if (type === 'fun') {
                r = readFunOpt(v, key)
            }
            else if (type === 'config') {
                r = { err: checkConfigOpt(v, key) } //opencode之config: 字串或一般物件(只驗形狀, 不序列化、不執行getter)
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


export { ANTHROPIC_EFFORTS, readStrOpt, readBoolOpt, readDirsOpt, readEnvOpt, readExesOpt, readPatchOpt, checkObjOpt, assertObjOpt, checkArrOpt, assertArrOpt, readProviderOpt, readNameOpt, readEnumOpt, readTokenMaxOpt, readFunOpt, checkReadObj, checkConfigOpt, checkSafeOpts }
