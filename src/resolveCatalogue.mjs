import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import providersAll from './providers.mjs'
import resolveProviders from './resolveProviders.mjs'
import readEnvFile from './readEnvFile.mjs'
import castPintOr from './castPintOr.mjs'


// resolveCatalogue.mjs — 目錄展開: 內建目錄＋安裝方自帶條目合併 → 逾時三層取值寫進patch → resolveProviders
//
// 【為何需要】消費端(呼叫器createAiCaller、批次AI任務層)都要做同一件事: 把「內建目錄＋安裝方自帶條目」合併、
//   把逾時三層取值寫進patch、再交resolveProviders展開(env/pick/exes/patch)。兩處各寫一份必然漂移——
//   殷鑑(使用端2026-08-14, 與resolveProviders檔頭同一類): 逐條timeout只加在陣列版、工作流走table版全部落回預設。
//   故收斂於此, 陣列版(resolved.providers)與table版(resolved.table)同源產出。
//
// 【extraProviders】安裝方不改套件即可接新模型: 新id追加於目錄末端, 同id逐欄覆蓋(淺合併)。
//
// 【逾時三層(細者覆蓋粗者)】providerTimeouts[id](逐條) → 條目自帶timeoutMs → 全域timeoutMs; 皆無則不寫入patch(落回轉接器預設)。
//
// 【env與envFile二擇一】env為物件則用之; 否則envFile有給才readEnvFile(envFile)(不污染process.env); 皆無交resolveProviders預設(process.env)。
//
// 【exes】逐kind注入CLI執行檔絕對路徑(Windows排程session 0之PATH不含npm全域目錄, 靠指令名會ENOENT)。
//
// 【訊息字樣】'ai.extraProviders 須為陣列'、'ai.extraProviders[i] 須為含 id 之條目物件'沿用自執行殼時代之字面,
//   使用端有測試以字樣比對, 移入本套件時不改字; 訊息只帶欄位名與索引, 不回顯輸入值。
//
// 【失敗通道】同步工廠性質: mergeCatalogue與timeoutPatch之必要參數不合規即throw(先於任何副作用),
//   resolveCatalogue隨mergeCatalogue之throw; opt之選填鍵不合規一律視為未給(不throw)。


/**
 * 合併目錄與安裝方自帶條目：新id追加於末端、同id逐欄覆蓋(淺合併)
 *
 * 特點：
 * 不改動輸入之陣列與條目(回傳新陣列，被覆蓋之條目為新物件)；
 * extraProviders為undefined或null視為空陣列，給了但非陣列即throw；
 * extraProviders之條目須為含id(非空字串)之物件，否則throw並於訊息附索引(不回顯值)；
 * catalogue非陣列時用內建目錄(providers.mjs)
 *
 * @param {Array} [catalogue=內建目錄] 輸入條目物件陣列，非陣列時用內建目錄
 * @param {Array} [extraProviders=[]] 輸入安裝方自帶條目物件陣列(各須含id)，預設[]
 * @returns {Array} 回傳合併後之新條目陣列
 * @example
 *
 * import { mergeCatalogue } from './src/resolveCatalogue.mjs'
 *
 * let base = [{ id: 'a', kind: 'claude', model: 'sonnet' }]
 * let r = mergeCatalogue(base, [{ id: 'a', model: 'opus' }, { id: 'b', kind: 'codex' }])
 * console.log(r)
 * // => [ { id: 'a', kind: 'claude', model: 'opus' }, { id: 'b', kind: 'codex' } ]
 * console.log(base)
 * // => [ { id: 'a', kind: 'claude', model: 'sonnet' } ] (輸入不被改動)
 *
 */
function mergeCatalogue(catalogue, extraProviders) {

    //base, 非陣列用內建目錄
    let base = isarr(catalogue) ? catalogue : providersAll

    //extra, undefined與null視為空陣列, 給了但非陣列為設定錯誤
    let extra = (extraProviders === undefined || extraProviders === null) ? [] : extraProviders
    if (!isarr(extra)) {
        throw new Error('ai.extraProviders 須為陣列')
    }

    //先全數檢核再合併, 不合規時不留任何半成品
    for (let i = 0; i < extra.length; i++) {
        let x = extra[i]
        if (!isobj(x) || typeof x.id !== 'string' || x.id === '') {
            throw new Error(`ai.extraProviders[${i}] 須為含 id 之條目物件`)
        }
    }

    //merge, 新id追加、同id逐欄覆蓋(輸入陣列與條目皆不改動)
    let out = [...base]
    for (let x of extra) {
        let k = out.findIndex((p) => isobj(p) && p.id === x.id)
        if (k >= 0) {
            out[k] = { ...out[k], ...x }
        }
        else {
            out.push({ ...x })
        }
    }

    return out
}


/**
 * 逾時三層取值：逐id取providerTimeouts[id]、條目自帶timeoutMs、全域timeoutMs之第一個有效值，寫成可餵resolveProviders之patch
 *
 * 特點：
 * 只收正整數(數字字串轉為數字)，某層無效視為未給而落到下一層，三層皆無效之id不寫入；
 * pick省略或為空陣列時對全目錄，給了則只取pick內之id；
 * merged非陣列即throw；opt非物件或各鍵無效時只用條目自帶值
 *
 * @param {Array} merged 輸入合併後條目物件陣列(如mergeCatalogue之回傳)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.pick=null] 輸入自選id字串陣列，預設null代表對全目錄
 * @param {Object} [opt.providerTimeouts=null] 輸入逐id逾時毫秒物件(如{'claude:sonnet':360000})，最優先，預設null
 * @param {Number} [opt.timeoutMs=null] 輸入全域逾時毫秒正整數，最後備援，預設null
 * @returns {Object} 回傳patch物件，形如{ [id]: { timeoutMs } }
 * @example
 *
 * import { timeoutPatch } from './src/resolveCatalogue.mjs'
 *
 * let merged = [{ id: 'a', timeoutMs: 1000 }, { id: 'b' }, { id: 'c' }]
 * console.log(timeoutPatch(merged, { providerTimeouts: { a: 5000 }, timeoutMs: 300000 }))
 * // => { a: { timeoutMs: 5000 }, b: { timeoutMs: 300000 }, c: { timeoutMs: 300000 } }
 *
 * console.log(timeoutPatch(merged, { pick: ['a', 'b'] }))
 * // => { a: { timeoutMs: 1000 } }
 *
 */
function timeoutPatch(merged, opt = {}) {
    if (!isarr(merged)) {
        throw new Error('timeoutPatch 需要 merged（條目陣列）')
    }

    let pick = get(opt, 'pick', null)
    let ids = isearr(pick) ? new Set(pick) : null
    let pts = get(opt, 'providerTimeouts', null)
    let tm = castPintOr(get(opt, 'timeoutMs', null), null)

    let out = {}
    for (let p of merged) {
        if (!isobj(p) || typeof p.id !== 'string' || p.id === '') {
            continue
        }
        if (ids !== null && !ids.has(p.id)) {
            continue
        }
        let v1 = (isobj(pts) && Object.prototype.hasOwnProperty.call(pts, p.id)) ? castPintOr(pts[p.id], null) : null
        let v2 = castPintOr(p.timeoutMs, null)
        let v = v1 ?? v2 ?? tm
        if (v !== null) {
            out[p.id] = { timeoutMs: v }
        }
    }

    return out
}


/**
 * 目錄展開：合併安裝方自帶條目、逾時三層取值寫進patch、交resolveProviders展開(envVar → keys、pick、exes、patch)
 *
 * 特點：
 * 回傳之resolved即resolveProviders原始回傳(providers陣列版、table物件版同源，另含skipped、missing、hints、warnings)；
 * env為物件則用之，否則envFile有給才readEnvFile(envFile)，皆無交resolveProviders預設(process.env，此時回傳之env為null)；
 * 逾時patch與呼叫端opt.patch逐id淺合併且呼叫端優先(故opt.patch可覆寫逾時三層之結果)；
 * extraProviders不合規時throw(見mergeCatalogue)；opt非物件視為{}
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.catalogue=內建目錄] 輸入條目物件陣列，非陣列時用內建目錄
 * @param {Array} [opt.extraProviders=[]] 輸入安裝方自帶條目物件陣列(各須含id；新id追加、同id逐欄覆蓋)，預設[]
 * @param {Array} [opt.pick=null] 輸入自選id字串陣列(順序即遞補優先序)，查無之id列入resolved.missing，預設null代表全取
 * @param {Object} [opt.env=null] 輸入金鑰來源物件(變數名 → 逗號分隔之金鑰字串)，與envFile二擇一，預設null
 * @param {String} [opt.envFile=null] 輸入.env檔路徑字串，env未給時以readEnvFile讀入(不污染process.env)，預設null
 * @param {Object} [opt.exes=null] 輸入kind對執行檔絕對路徑之物件，預設null
 * @param {Object} [opt.patch=null] 輸入id對部分欄位之物件，淺合併覆寫且優先於逾時三層，預設null
 * @param {Object} [opt.providerTimeouts=null] 輸入逐id逾時毫秒物件，逾時三層之最優先層，預設null
 * @param {Number} [opt.timeoutMs=null] 輸入全域逾時毫秒正整數，逾時三層之最後備援，預設null
 * @returns {Object} 回傳物件，內含merged(合併後條目陣列)、env(實際使用之金鑰來源物件，交resolveProviders預設時為null)、resolved(resolveProviders之原始回傳：providers、table、skipped、missing、hints、warnings)
 * @example
 * //need .env with AGNES_KEYS
 *
 * import resolveCatalogue from './src/resolveCatalogue.mjs'
 *
 * let { merged, resolved } = resolveCatalogue({
 *     envFile: './.env',
 *     extraProviders: [{ id: 'my:model', kind: 'api-openai-compat', baseURL: 'https://example.com/v1', model: 'm1', envVar: 'MY_KEYS' }],
 *     pick: ['agnes:agnes-3.0-flash', 'my:model', 'claude:sonnet'],
 *     exes: { claude: 'C:/Users/x/.local/bin/claude.exe' },
 *     providerTimeouts: { 'claude:sonnet': 360000 },
 *     timeoutMs: 300000,
 * })
 * console.log(resolved.providers.map((p) => p.id), resolved.skipped, resolved.missing)
 * // => [ 'agnes:agnes-3.0-flash', 'claude:sonnet' ] [ { id: 'my:model', envVar: 'MY_KEYS' } ] [] (MY_KEYS未設而停用)
 * console.log(resolved.table['claude:sonnet'].timeoutMs, resolved.table['agnes:agnes-3.0-flash'].timeoutMs)
 * // => 360000 300000
 *
 * //逐條優先於條目自帶: extra條目自帶timeoutMs: 1, providerTimeouts給360000, 以後者為準
 * let r2 = resolveCatalogue({ extraProviders: [{ id: 'claude:sonnet', timeoutMs: 1 }], pick: ['claude:sonnet'], providerTimeouts: { 'claude:sonnet': 360000 } })
 * console.log(r2.resolved.table['claude:sonnet'].timeoutMs)
 * // => 360000
 *
 * //pick打錯字: 列入missing並附最接近id之hints, 不throw
 * let r3 = resolveCatalogue({ pick: ['claude/sonnet'] })
 * console.log(r3.resolved.missing, r3.resolved.hints)
 * // => [ 'claude/sonnet' ] { 'claude/sonnet': 'claude:sonnet' }
 *
 */
function resolveCatalogue(opt = {}) {

    //merged
    let merged = mergeCatalogue(get(opt, 'catalogue', null), get(opt, 'extraProviders', null))

    //env, 物件則用之; 否則envFile有給才讀; 皆無交resolveProviders預設(process.env)
    let pick = get(opt, 'pick', null)
    let env = get(opt, 'env', null)
    if (!isobj(env)) {
        let envFile = get(opt, 'envFile', null)
        env = isestr(envFile) ? readEnvFile(envFile) : null
    }

    //patch, 逾時三層之結果與呼叫端patch逐id淺合併, 呼叫端優先
    let tp = timeoutPatch(merged, {
        pick,
        providerTimeouts: get(opt, 'providerTimeouts', null),
        timeoutMs: get(opt, 'timeoutMs', null),
    })
    let patch = { ...tp }
    let pin = get(opt, 'patch', null)
    if (isobj(pin)) {
        for (let id of Object.keys(pin)) {
            if (isobj(pin[id])) {
                patch[id] = { ...get(tp, [id], {}), ...pin[id] }
            }
        }
    }

    //resolveProviders, env為null時不傳(用其預設process.env)
    let ro = { pick, exes: get(opt, 'exes', null), patch }
    if (env !== null) {
        ro.env = env
    }
    let resolved = resolveProviders(merged, ro)

    return { merged, env, resolved }
}


export default resolveCatalogue
export { mergeCatalogue, timeoutPatch }
