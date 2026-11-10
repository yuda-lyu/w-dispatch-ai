import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import dispatchAiFallback from './dispatchAiFallback.mjs'
import resolveCatalogue from './resolveCatalogue.mjs'
import castPintOr from './castPintOr.mjs'
import castBudgetMs from './castBudgetMs.mjs'
import { callHookSync } from './callUserFn.mjs'


// createAiCaller.mjs — 原始遞補呼叫器: 設定轉dispatchAiFallback參數, 回「原始結果」(不解析、不加前綴)
//
// 【契約: 原始遞補呼叫】validate由呼叫端逐次給; 回傳dispatchAiFallback之原始結果(stdout／tried／usage／providerId／keyIndex／durationMs…),
//   供logAiOutcome渲染; 只做接線不做策略。不掛NO_SIDE_EFFECT前綴、不解析JSON。
//
// 【與工作流callAiWithFallback／dispatchAiWkf.callAi的選型(兩者語意不同、並存)】
//   本件: 條目來源為「內建目錄＋extraProviders → resolveCatalogue → pick順序之條目陣列」; 回原始結果(＋providersSkipped／providersMissing);
//         回覆不解析(呼叫端自行解析, validate逐次給); 不掛prompt前綴; pick到不存在之id不throw、不失敗而是列入missing／hints由呼叫端以ERROR記;
//         用量以onUsage(providerId)於try事件入帳。
//   工作流: 條目來源為呼叫端自備之定義表(名稱 → 條目), spec:{use,fallback}展開; 回結構化{ ok, json, providerId, … };
//         parse＋check接進validate(預設extractJsonLoose); 預設掛NO_SIDE_EFFECT前綴(promptPrefix:''關閉); 未知名稱直接失敗(errorType params);
//         用量由呼叫端掛createUsageCounter(...).onEvent。
//   要「自行解析回覆、要看原始tried／usage」(排程殼)用本件; 要「JSON任務＋多名額工作流」用工作流。
//
// 【條目於建構時解析一次】排程為短生命行程, 不隨呼叫重解析; 解析結果含金鑰(resolved.providers之keys), 回傳之providers勿寫入日誌。
//
// 【missing與skipped分開回報】missing＝pick到不存在之id(設定錯誤, 常是打錯字); skipped＝缺金鑰而停用(暫時少一層備援)。
//   兩者皆不使建構失敗; 全部條目都不可用時callAI回同形失敗(attempts為0), 其error只列skipped(`無可用的 AI 供應商（<skipped以、相接>）`, 無skipped則無括號),
//   missing不進error, 由providersMissing欄位與logAiOutcome之ERROR行表達(原契約如此)。
//
// 【逐次預算只收緊、不放寬】budgetMs為建構參數(整輪遞補之上限), callAI另收逐次opt.budgetMs, 供呼叫端以「剩餘時間」封頂單次呼叫而免為逐次預算另建caller;
//   兩者種類不同(2026-11-11 主控裁示D11甲, 帳本R-CALLER-1-6改寫): 建構值為「設定值」——非正整數依K3視為未給(不限);
//   逐次值為「執行期之剩餘時間」(castBudgetMs)——有限數或數字字串有效, ≤0為已無時間(本次不送出、回budget exhausted)、小數向下取整, +Infinity／未給／null／非數值視為未給而沿用建構值;
//   有效時本次budgetMs＝min(建構值(不限則忽略), 逐次值), 即逐次值只能收緊建構預算、不得放寬; dispatchAiFallback之minAttemptMs語意不變
//   (逐次預算小於minAttemptMs時依其既有規則回budget exhausted, 是否「不開工」由呼叫端自行先判)。逐次值只作用於該次呼叫, 不改建構期設定。
//   (修前逐次值0、負、小數皆視為未給而沿用建構值, 剩0秒之呼叫端仍照跑整條鏈; 見README〈Breaking changes〉)


/**
 * 建立原始遞補呼叫器：條目於建構時由resolveCatalogue解析一次，callAI回dispatchAiFallback之原始結果
 *
 * 特點：
 * 條目來源＝內建目錄＋extraProviders，依pick順序(即遞補優先序)，envVar → keys、exes、patch、逾時三層取值皆同resolveCatalogue；
 * pick到不存在之id列入missing(附hints拼寫提示)、缺金鑰者列入skipped，皆不throw；
 * callAI回dispatchAiFallback原始結果，另掛providersSkipped與providersMissing；零供應商時回同形失敗(ok為false、attempts為0、tried為空陣列，error為`無可用的 AI 供應商`後接`（<skipped以、相接>）`，無skipped則無括號，missing不進error)；
 * 不解析回覆、不掛NO_SIDE_EFFECT前綴；本函數不會reject，extraProviders不合規時建構throw(見resolveCatalogue)；
 * onUsage於try事件(實際送出嘗試)時以providerId呼叫，與createUsageCounter(...).onEvent於try事件記帳之時機相同(後者預設記到keyId，改記到條目請給keyOf: (ev) => ev.providerId，則與onUsage(providerId)等價)，純觀測，拋錯與回傳Promise皆忽略
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.pick=null] 輸入自選id字串陣列(順序即遞補優先序)，預設null代表全取內建目錄(含計費條目，通常應明給pick)
 * @param {Object} [opt.env=null] 輸入金鑰來源物件，與envFile二擇一，預設null
 * @param {String} [opt.envFile=null] 輸入.env檔路徑字串，預設null(皆無時用process.env)
 * @param {Array} [opt.catalogue=內建目錄] 輸入條目物件陣列，非陣列時用內建目錄
 * @param {Array} [opt.extraProviders=[]] 輸入安裝方自帶條目陣列(各須含id；新id追加、同id逐欄覆蓋)，預設[]
 * @param {Object} [opt.exes=null] 輸入kind對執行檔絕對路徑之物件，預設null
 * @param {Object} [opt.patch=null] 輸入id對部分欄位之物件，優先於逾時三層，預設null
 * @param {Object} [opt.providerTimeouts=null] 輸入逐id逾時毫秒物件(逾時三層最優先層)，預設null
 * @param {Number} [opt.timeoutMs=null] 輸入全域逾時毫秒正整數(逾時三層最後備援，寫入各條目)，預設null
 * @param {Number} [opt.maxRetries=null] 輸入同家重試次數，原樣交dispatchAiFallback，預設null代表其預設
 * @param {Number} [opt.budgetMs=null] 輸入整輪遞補時間上限毫秒正整數(建構期預算，屬設定值：非正整數視為未給；callAI另可逐次收緊，見callAI之budgetMs)，預設null代表不限
 * @param {Number} [opt.minAttemptMs=null] 輸入單次嘗試最低剩餘預算毫秒，預設null代表其預設
 * @param {Number} [opt.cooldownMs=null] 輸入供應商冷卻視窗毫秒，預設null代表不啟用
 * @param {Number} [opt.cooldownGrowth=null] 輸入冷卻加長倍率(≥1)，原樣交dispatchAiFallback(見其opt.cooldownGrowth)，預設null代表1(視窗恆為cooldownMs)
 * @param {Number} [opt.cooldownMaxMs=null] 輸入冷卻加長之上限毫秒，原樣交dispatchAiFallback，預設null代表24小時
 * @param {Number} [opt.coolAfterFails=null] 輸入持久連敗門檻正整數，原樣交dispatchAiFallback(見其opt.coolAfterFails)，預設null代表不計數
 * @param {Function} [opt.envDown=null] 輸入環境歸因函數async()=>Boolean(如本機斷網)，原樣交dispatchAiFallback(見其opt.envDown)，預設null
 * @param {Function} [opt.coolDetect=null] 輸入冷卻觸發判定函數(r)=>Boolean，預設null
 * @param {String} [opt.cwd=null] 輸入CLI類條目之工作目錄字串，預設null
 * @param {Object} [opt.store=null] 輸入狀態持久化物件{get,set}，建議createFileStore({ dir })令游標與冷卻跨行程保留，預設null代表行程內記憶體
 * @param {Boolean|Object} [opt.spawnGate=undefined] 輸入CLI類條目spawn前之機器級守門設定，原樣交dispatchAiFallback(false關閉；物件可覆寫maxCli、ramUsedMax、cpuMax等，預設只對opencode啟用，見cliSpawnGate.mjs檔頭)，預設undefined
 * @param {Boolean|Object} [opt.quotaGate=undefined] 輸入用量門檻設定，原樣交dispatchAiFallback(false關閉；物件可覆寫OpenCode Go條目之rollingMax、weeklyMax、monthlyMax、cacheMs〔見goQuotaGate.mjs檔頭〕，與訂閱類條目〔claude無金鑰者、codex、antigravity；2026-11-07起預設開啟〕之claudeMax、codexMax、antigravityMax、windowMax等〔見subQuotaGate.mjs檔頭〕)，預設undefined
 * @param {Function} [opt.quotaUntilOf=undefined] 輸入訂閱類條目失敗後由失敗結果判定額度重置時刻之同步函數(r)=>Date|ISO字串|毫秒數|null，原樣交dispatchAiFallback(見其opt.quotaUntilOf)，預設undefined
 * @param {Function} [opt.onUsage=null] 輸入用量回調(providerId)=>void，於try事件呼叫，預設null
 * @param {Function} [opt.onEvent=null] 輸入事件回調(ev)=>void，每個遞補事件皆轉呼叫，預設null
 * @returns {Object} 回傳物件，內含callAI(async函數(prompt, { timeoutMs, budgetMs, validate, acceptTruncated, onEvent })，回dispatchAiFallback原始結果並另掛providersSkipped與providersMissing；逐次budgetMs為執行期之剩餘時間(有限數或數字字串有效，≤0為已無時間而本次回budget exhausted、小數向下取整)，有效時本次整輪預算取min(建構budgetMs，逐次budgetMs)，只收緊不放寬，+Infinity、未給、null或非數值視為未給而沿用建構值)、providers(解析後條目陣列，含金鑰勿寫入日誌)、skipped(缺金鑰而停用之字串陣列，形如'id（ENVVAR 無金鑰）')、missing(pick查無之id字串陣列)、hints(missing id對最接近可用id之提示物件)
 * @example
 * //need .env with AGNES_KEYS; claude cli in system PATH
 *
 * import createAiCaller from './src/createAiCaller.mjs'
 * import createFileStore from './src/wkf/createFileStore.mjs'
 * import createUsageCounter from './src/wkf/createUsageCounter.mjs'
 * import logAiOutcome from './src/wkf/logAiOutcome.mjs'
 * import parseJsonArray from './src/wkf/parseJsonArray.mjs'
 *
 * let usage = createUsageCounter({ dir: './state' })
 * let caller = createAiCaller({
 *     envFile: './.env',
 *     pick: ['agnes:agnes-3.0-flash', 'claude:sonnet'],
 *     timeoutMs: 300000,
 *     budgetMs: 600000,
 *     store: createFileStore({ dir: './state' }),
 *     onEvent: usage.onEvent, //等價於onUsage, 改掛createUsageCounter更完整(預設記到keyId)
 * })
 * console.log(caller.providers.map((p) => p.id), caller.skipped, caller.missing)
 * // => [ 'agnes:agnes-3.0-flash', 'claude:sonnet' ] [] []
 *
 * let test = async () => {
 *     let r = await caller.callAI('只回覆JSON陣列: [{"index":1,"t":"..."}]', {
 *         validate: (stdout) => parseJsonArray(stdout) !== null, //回覆不由本件解析, validate逐次給
 *         budgetMs: 120000, //逐次預算, 與建構budgetMs(600000)取小, 本次整輪至多120000; 給大於建構值者仍以建構值為限
 *     })
 *     console.log(r.ok, r.providerId, r.tried.length)
 *     // => true 'agnes:agnes-3.0-flash' 1
 *     logAiOutcome({ result: r, log: console, tag: 'news' })
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
function createAiCaller(opt = {}) {

    //resolved, 建構時解析一次
    let { resolved } = resolveCatalogue({
        pick: get(opt, 'pick', null),
        env: get(opt, 'env', null),
        envFile: get(opt, 'envFile', null),
        catalogue: get(opt, 'catalogue', null),
        extraProviders: get(opt, 'extraProviders', null),
        exes: get(opt, 'exes', null),
        patch: get(opt, 'patch', null),
        providerTimeouts: get(opt, 'providerTimeouts', null),
        timeoutMs: get(opt, 'timeoutMs', null),
    })
    let providers = resolved.providers
    let skipped = resolved.skipped.map((s) => `${s.id}（${s.envVar} 無金鑰）`)
    let missing = resolved.missing
    let hints = resolved.hints

    //建構期設定, 只收有給(非undefined與null)者原樣交dispatchAiFallback, 其檢核與預設由其負責;
    //冷卻加長、持久連敗與環境歸因(cooldownGrowth、cooldownMaxMs、coolAfterFails、envDown; 2026-11-11 da402 DA-8)同此
    let base = {}
    for (let k of ['maxRetries', 'budgetMs', 'minAttemptMs', 'cooldownMs', 'cooldownGrowth', 'cooldownMaxMs', 'coolAfterFails', 'envDown', 'coolDetect', 'cwd', 'store', 'spawnGate', 'quotaGate', 'quotaUntilOf']) {
        let v = get(opt, k, null)
        if (v !== null && v !== undefined) {
            base[k] = v
        }
    }

    //建構budgetMs為「設定值」(主控裁示D11甲): 非正整數依K3視為未給(不限), 不交dispatchAiFallback(其budgetMs為執行期剩餘時間, 0或負即已無時間)
    let budgetMsBase = castPintOr(get(base, 'budgetMs', null), null)
    if (budgetMsBase === null) {
        delete base.budgetMs
    }
    else {
        base.budgetMs = budgetMsBase
    }
    let onUsage = get(opt, 'onUsage', null)
    let onEventB = get(opt, 'onEvent', null)

    let callAI = async (prompt, o = {}) => {
        let co = isobj(o) ? o : {}

        //零供應商: 回與套件同形之失敗(attempts為0); error括號內只列skipped(以「、」相接, 無則無括號), missing由providersMissing與logAiOutcome之ERROR行表達
        if (providers.length === 0) {
            return {
                ok: false,
                stdout: '',
                stderr: '',
                code: null,
                durationMs: 0,
                attempts: 0,
                error: `無可用的 AI 供應商${skipped.length > 0 ? `（${skipped.join('、')}）` : ''}`,
                tried: [],
                providersSkipped: [...skipped],
                providersMissing: [...missing],
            }
        }

        //逐次設定: timeoutMs(有效正整數)、budgetMs(有效正整數, 與建構值取小)、validate(有給)、acceptTruncated(僅布林時透傳)、onEvent
        let callOpt = { providers, ...base }
        let timeoutMs = castPintOr(get(co, 'timeoutMs', null), null)
        if (timeoutMs !== null) {
            callOpt.timeoutMs = timeoutMs
        }

        //budgetMs, 逐次值為「執行期之剩餘時間」(castBudgetMs, 主控裁示D11甲): 有限數或數字字串有效, ≤0為已無時間(本次不送出、budget exhausted)、小數向下取整;
        //+Infinity、未給、非數值視為未給而沿用建構值; 有效時與建構值(非正整數視為不限)取小, 只收緊不放寬; callOpt為本次副本, 不改base
        let budgetMs = castBudgetMs(get(co, 'budgetMs', null))
        if (budgetMs !== null) {
            callOpt.budgetMs = (budgetMsBase === null) ? budgetMs : Math.min(budgetMsBase, budgetMs)
        }
        let validate = get(co, 'validate', null)
        if (validate !== null && validate !== undefined) {
            callOpt.validate = validate
        }
        let acceptTruncated = get(co, 'acceptTruncated', null)
        if (isbol(acceptTruncated)) {
            callOpt.acceptTruncated = acceptTruncated
        }

        //onEvent, try事件先記用量(按實際嘗試入帳), 再轉呼建構期onEvent與逐次onEvent; 三者互相隔離, 拋錯與回傳Promise皆忽略
        let onEventC = get(co, 'onEvent', null)
        callOpt.onEvent = (ev) => {
            if (isfun(onUsage) && get(ev, 'type', null) === 'try') {
                callHookSync(() => onUsage(ev.providerId))
            }
            if (isfun(onEventB)) {
                callHookSync(() => onEventB(ev))
            }
            if (isfun(onEventC)) {
                callHookSync(() => onEventC(ev))
            }
        }

        let r = await dispatchAiFallback(prompt, callOpt)
        return { ...r, providersSkipped: [...skipped], providersMissing: [...missing] }
    }

    return { callAI, providers, skipped, missing, hints }
}


export default createAiCaller
