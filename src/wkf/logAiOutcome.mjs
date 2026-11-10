import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseint from 'wsemi/src/iseint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { callHookSync } from '../callUserFn.mjs'
import { maskApiKeys } from '../redactText.mjs'


// logAiOutcome.mjs — 把一次dispatchAiFallback之結果渲染成日誌(用了哪家、遞補歷程、哪些供應商未納入)
//
// 【為何「換了一家才成功」非記不可】成功結果只有最終一家, 前面敗了幾家、為何敗(額度/逾時/驗證不過)全在tried;
//   不記則「這個月怎麼老是第三家在回」無從查起, 也看不出某家已持續失效。故逐筆記: key#(第幾把)、errorType(機器可讀)、
//   error字串(人讀; 兩者並記, 因errorType會把N種狀況併成M類)、耗時; token用量(含reasoning_tokens, 思考模型常見「輸出被思考吃光」)。
//   outcome譯成人話(OUTCOME_TEXT), 未收錄者原樣顯示。
//
// 【一律以成員呼叫形式觸發記錄器】log.log(msg)、log.warn(msg), 不可寫成`(lg.log || lg.info)(msg)`——
//   後者取出方法後脫離物件, class-based logger之this會失(內部欄位取不到而拋錯)。
//
// 【記錄器介面】接受兩種, 逐等級擇一: INFO＝log／info, WARN＝logWarn／warn, ERROR＝logError／error(依列出順序取第一個函數);
//   WARN／ERROR無專屬方法時退用INFO之方法(寧可等級不準也不讓「providerPick 有無效 id」這類設定錯誤消失)。
//   記錄器自身拋錯或回傳Promise之rejection一律吞掉——診斷輸出不得影響已取得之AI結果(診斷輸出與遮罩規格D4)。
//
// 【不外洩憑證】日誌內容來自結果之tried／error(轉接器已就注入之金鑰遮蔽, 見redactText.mjs), 本層再對整行套Anthropic金鑰樣式遮蔽(sk-ant-…)
//   作底線防護; 不輸出金鑰、不輸出stdout內容(模型輸出)。
//
// 【tag】多個呼叫點共用同一記錄器時區分來源: tag原樣接在每行訊息之前(不加括號與空白, 分隔符由呼叫端自帶, 如tag: '步驟6：'),
//   非字串視為''; 與執行殼原契約一致, 使用端的步驟行皆以`步驟N：`起頭, AI行須同形才能逐步驟grep。
//
// 【oneline】錯誤字串壓成單行並截斷(wsemi strTruncate, 刪節號`...`), 內嵌於本檔——不依賴w-data-pipeline。
//   截斷字數n由oneline自行檢查(wsemi iseint之count), 有效才Number(n)交給strTruncate, 無效則不截斷(回壓平之整行),
//   不依賴strTruncate對無效maxLen之處置(其maxLen為必須參數, 無效即拋錯); 呼叫處n皆為字面80／60。


/**
 * outcome對人話: 遞補歷程中非ok之outcome譯成中文，未收錄者(如budget-out、skip-key、context-too-long)原樣顯示；
 * budget-cut(2026-11-11 da402 DA-11)為嘗試之逾時被呼叫端預算封頂(預算用盡，非條目故障)
 */
let OUTCOME_TEXT = Object.freeze({
    'next-key': '換金鑰',
    'skip-group': '整組跳過',
    'budget-cut': '預算封頂',
})


//ledgerNoticed, 額度帳命中(quota-skip且source為ledger)已記過之條目＋重置時刻鍵(行程內模組層, 令「每行程每條目一次」跨記錄器實例成立; 見createAiEventLogger)
let ledgerNoticed = new Set()


//METHODS, 各等級依序嘗試之記錄器成員名
let METHODS = {
    info: ['log', 'info'],
    warn: ['logWarn', 'warn'],
    error: ['logError', 'error'],
}


/**
 * 壓成單行並截斷：先遮蔽Anthropic金鑰樣式，空白(含換行)壓為單一空格、修剪頭尾，超過n字以strTruncate截斷(補刪節號)
 *
 * n之檢查由本函數自行負責，不依賴strTruncate對無效maxLen之處置(其maxLen為必須參數，無效即拋錯)：
 * 以wsemi iseint之count判定(0～4294967295之安全整數，數字或可無損轉數字之字串皆可，如80、'80')，有效才轉為數字(Number(n))交給strTruncate；
 * 非有效值(未給、null、負數、小數、Infinity、'abc'、包裝物件、BigInt等)則不截斷，回壓平後之整行(與w-data-pipeline之oneline同語意)。
 * 本函數僅供本檔使用(呼叫處n皆為字面80／60)，匯出僅為單元測試取用，不列入套件對外介面
 *
 * @param {*} s 輸入文字(null與undefined視為空；無法轉字串者視為空)
 * @param {Number|String} n 輸入保留字數非負整數(或可無損轉為非負整數之字串)，非有效個數則不截斷
 * @returns {String} 回傳單行字串
 */
function oneline(s, n) {
    let t = ''
    try {
        t = maskApiKeys(String(s ?? ''))
    }
    catch {
        t = ''
    }
    let line = t.replace(/\s+/g, ' ').trim()
    if (!iseint(n, { use: 'count' })) {
        return line
    }
    return strTruncate(line, Number(n))
}


/**
 * 檢核記錄器：須為物件，否則throw
 *
 * @param {*} log 輸入記錄器
 * @param {String} who 輸入函數名稱字串，用於訊息
 * @returns {Object} 回傳記錄器本身
 */
function chkLog(log, who) {
    if (log === null || (typeof log !== 'object' && typeof log !== 'function')) {
        throw new Error(`${who} 需要 log（記錄器）`)
    }
    return log
}


/**
 * 以成員呼叫形式寫一行日誌(逐等級擇一成員、WARN與ERROR無專屬方法時退用INFO之方法；整行套Anthropic金鑰樣式遮蔽；記錄器自身之失敗吞掉)
 *
 * @param {Object} log 輸入記錄器
 * @param {String} level 輸入等級字串，'info'、'warn'、'error'
 * @param {String} msg 輸入訊息字串
 * @returns {undefined} 無回傳值
 */
function emitLine(log, level, msg) {
    let name = null
    for (let n of [...METHODS[level], ...(level === 'info' ? [] : METHODS.info)]) {
        let f = null
        try {
            f = log[n]
        }
        catch {}
        if (isfun(f)) {
            name = n
            break
        }
    }
    if (name === null) {
        return
    }
    let line = maskApiKeys(msg)
    callHookSync(() => log[name](line)) //成員呼叫, this維持為log
}


/**
 * 前綴: tag為字串時原樣回傳(不加括號與空白)，否則空字串
 *
 * @param {*} tag 輸入tag
 * @returns {String} 回傳前綴字串
 */
function prefixOf(tag) {
    return typeof tag === 'string' ? tag : ''
}


/**
 * 金鑰序號字串: keyIndex為數字時為`／key#n`(n從1起)，否則空字串(訂閱登入態CLI無金鑰)
 *
 * @param {*} keyIndex 輸入金鑰索引(從0起)
 * @returns {String} 回傳字串
 */
function keyText(keyIndex) {
    return (typeof keyIndex === 'number' && Number.isFinite(keyIndex)) ? `／key#${keyIndex + 1}` : ''
}


/**
 * 冷卻分鐘數: 毫秒換算為分鐘並四捨五入為整數(Math.round(ms / 60000))，無效回null
 *
 * @param {*} ms 輸入冷卻毫秒
 * @returns {Number|null} 回傳分鐘數
 */
function minutesOf(ms) {
    return (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) ? Math.round(ms / 60000) : null
}


/**
 * 成功那一家之說明：kind／model、token用量(僅REST類有；含思考)、截斷放行
 *
 * @param {Object} r 輸入dispatchAiFallback結果
 * @returns {String} 回傳括號內說明字串(可為空)
 */
function usedDetail(r) {
    let parts = [[get(r, 'kind', null), get(r, 'model', null)].filter((v) => isestr(v)).join('／')].filter((v) => v !== '')

    //tokens, OpenAI系(prompt_tokens／completion_tokens)與Anthropic系(input_tokens／output_tokens)皆收
    let u = get(r, 'usage', null)
    if (isobj(u)) {
        let p = u.prompt_tokens ?? u.input_tokens
        let c = u.completion_tokens ?? u.output_tokens
        if (typeof p === 'number' && typeof c === 'number') {
            let rs = get(u, 'completion_tokens_details.reasoning_tokens', null)
            parts.push(`tokens ${p}+${c}${(typeof rs === 'number' && rs > 0) ? `（含思考 ${rs}）` : ''}`)
        }
    }
    let s = parts.join('，')

    //截斷內容放行
    if (get(r, 'truncated', null) === true) {
        let fr = get(r, 'finishReason', null)
        s += `${s === '' ? '' : '；'}截斷內容放行${isestr(fr) ? `（finish_reason=${fr}）` : ''}`
    }
    return s
}


/**
 * 遞補歷程單筆: `providerId／key#n（outcome人話：errorType／原因，耗時s）`，耗時為秒且固定一位小數(toFixed(1)，1234ms為1.2s)
 *
 * @param {Object} t 輸入tried單筆
 * @returns {String} 回傳字串
 */
function triedText(t) {
    let oc = isestr(t.outcome) ? t.outcome : '?'
    let ocText = Object.prototype.hasOwnProperty.call(OUTCOME_TEXT, oc) ? OUTCOME_TEXT[oc] : oc
    let reason = isestr(t.reason) ? t.reason : t.error
    let why = [isestr(t.errorType) ? t.errorType : '', oneline(reason, 80)].filter((v) => v !== '').join('／')
    let sec = (typeof t.durationMs === 'number' && Number.isFinite(t.durationMs)) ? `，${(t.durationMs / 1000).toFixed(1)}s` : ''
    return `${isestr(t.providerId) ? t.providerId : '?'}${keyText(t.keyIndex)}（${ocText}${why === '' ? '' : `：${why}`}${sec}）`
}


/**
 * 把一次dispatchAiFallback(或createAiCaller.callAI)之結果渲染成日誌
 *
 * 特點：
 * 至多四行：①result.providerId有值時「使用 AI」(INFO；以providerId有值為準，不看ok；含kind／model、REST類之token用量含思考、截斷內容放行之加註)；
 * ②有非ok之嘗試時「AI 遞補歷程」(WARN；逐筆含key#、outcome人話、errorType、原因壓單行80字、耗時)；
 * ③providersSkipped非空時「AI 供應商未納入」(WARN)；④providersMissing非空時「providerPick 有無效 id」(ERROR)；
 * 記錄器接受log／logWarn／logError或info／warn／error兩種介面，一律以成員呼叫形式觸發(class-based logger之this不失)；
 * log缺或非物件即throw，result非物件則無事可記(不throw)；整行套Anthropic金鑰樣式遮蔽，不輸出stdout；記錄器自身之失敗吞掉
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} opt.result 輸入dispatchAiFallback或callAI之結果物件
 * @param {Object} opt.log 輸入記錄器物件(console亦可)
 * @param {String} [opt.tag=''] 輸入來源標籤字串，原樣接在每行之前(不加括號與空白，分隔符由呼叫端自帶，如'步驟6：')，非字串視為''，預設''
 * @returns {undefined} 無回傳值
 * @example
 *
 * import logAiOutcome from './src/wkf/logAiOutcome.mjs'
 *
 * let result = {
 *     ok: true,
 *     providerId: 'agnes:agnes-3.0-flash',
 *     keyIndex: 1,
 *     kind: 'api-openai-compat',
 *     model: 'agnes-3.0-flash',
 *     usage: { prompt_tokens: 120, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 30 } },
 *     tried: [
 *         { providerId: 'agnes:agnes-3.0-flash', keyIndex: 0, outcome: 'next-key', errorType: 'http', error: 'HTTP 429 quota\nexceeded', durationMs: 1200 },
 *         { providerId: 'agnes:agnes-3.0-flash', keyIndex: 1, outcome: 'ok', durationMs: 3400 },
 *     ],
 *     providersSkipped: ['my:model（MY_KEYS 無金鑰）'],
 *     providersMissing: ['claude/sonnet'],
 * }
 * logAiOutcome({ result, log: console, tag: '步驟6：' }) //tag原樣接在每行之前, 分隔符由呼叫端自帶
 * // => 步驟6：使用 AI agnes:agnes-3.0-flash／key#2（api-openai-compat／agnes-3.0-flash，tokens 120+80（含思考 30））
 * // => 步驟6：AI 遞補歷程 → agnes:agnes-3.0-flash／key#1（換金鑰：http／HTTP 429 quota exceeded，1.2s）
 * // => 步驟6：AI 供應商未納入 → my:model（MY_KEYS 無金鑰）
 * // => 步驟6：providerPick 有無效 id → claude/sonnet（請對照供應商目錄）
 *
 */
function logAiOutcome(opt) {
    let log = chkLog(get(opt, 'log', null), 'logAiOutcome')
    let result = get(opt, 'result', null)
    if (!isobj(result)) {
        return
    }
    let pre = prefixOf(get(opt, 'tag', ''))

    //① 使用 AI, 以providerId有值為準(不看ok; dispatchAiFallback失敗結果亦帶最後嘗試之providerId, 原契約如此)
    if (isestr(result.providerId)) {
        let d = usedDetail(result)
        emitLine(log, 'info', `${pre}使用 AI ${result.providerId}${keyText(result.keyIndex)}${d === '' ? '' : `（${d}）`}`)
    }

    //② 遞補歷程(濾掉ok者)
    let tried = isarr(result.tried) ? result.tried.filter((t) => isobj(t) && t.outcome !== 'ok') : []
    if (tried.length > 0) {
        emitLine(log, 'warn', `${pre}AI 遞補歷程 → ${tried.map((t) => triedText(t)).join('、')}`)
    }

    //③ 未納入(缺金鑰)
    let skipped = isarr(result.providersSkipped) ? result.providersSkipped.filter((v) => isestr(v)) : []
    if (skipped.length > 0) {
        emitLine(log, 'warn', `${pre}AI 供應商未納入 → ${skipped.join('、')}`)
    }

    //④ pick到不存在之id(設定錯誤)
    let missing = isarr(result.providersMissing) ? result.providersMissing.filter((v) => isestr(v)) : []
    if (missing.length > 0) {
        emitLine(log, 'error', `${pre}providerPick 有無效 id → ${missing.join('、')}（請對照供應商目錄）`)
    }
}


/**
 * 建立遞補事件記錄函數(目前處理cooled事件：供應商或金鑰進入冷卻；與quota-skip事件之額度帳命中)，可直接掛進onEvent
 *
 * 特點：
 * 回傳(ev)=>void，ev.type為'cooled'時以WARN記一行(供應商冷卻：降至鏈尾；scope為'key'之金鑰冷卻：降至組內最後)；
 * ev.type為'quota-skip'且source為'ledger'(訂閱類條目因store.quota記載額度用盡至某時刻而被略過)時以WARN記一行「額度帳：<id> 至 <until> 略過」，每行程每條目(同一重置時刻)只記一次；
 * ev.type為'quota-ledger-void'(Gitea #116：額度帳經帳號比對或定期重探而作廢)時以WARN記一行「額度帳：<id> 之帳因登入帳號改變（舊 → 新）而作廢」或「…之帳經重探確認用量已低於門檻而作廢」(帳號只有雜湊前8碼)，每次作廢記一行；其餘事件忽略；
 * 記錄器之規則同logAiOutcome(成員呼叫形式、兩種介面、整行遮蔽、自身失敗吞掉)；log缺或非物件即throw
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} opt.log 輸入記錄器物件
 * @param {String} [opt.tag=''] 輸入來源標籤字串，原樣接在每行之前(不加括號與空白，分隔符由呼叫端自帶)，非字串視為''，預設''
 * @returns {Function} 回傳事件記錄函數(ev)=>void
 * @example
 *
 * import { createAiEventLogger } from './src/wkf/logAiOutcome.mjs'
 *
 * let onEvent = createAiEventLogger({ log: console, tag: '步驟6：' })
 * onEvent({ type: 'cooled', providerId: 'agnes:agnes-3.0-flash', error: 'HTTP 429', cooldownMs: 600000 })
 * // => 步驟6：AI 供應商進入冷卻 → agnes:agnes-3.0-flash（HTTP 429，10 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）
 *
 * //掛進呼叫器: createAiCaller({ pick, onEvent })
 *
 */
function createAiEventLogger(opt) {
    let log = chkLog(get(opt, 'log', null), 'createAiEventLogger')
    let pre = prefixOf(get(opt, 'tag', ''))

    return (ev) => {

        //額度帳命中(quota-skip且source為ledger): 該條目因store.quota記載「至某時刻額度用盡」而被略過; 每行程每條目(同一重置時刻)只記一行, 免滿額期間每輪每席洗版
        if (get(ev, 'type', null) === 'quota-skip' && get(ev, 'source', null) === 'ledger') {
            let pid = get(ev, 'providerId', '?')
            let until = get(ev, 'until', null)
            let k = `${pid}|${until}`
            if (!ledgerNoticed.has(k)) {
                ledgerNoticed.add(k)
                emitLine(log, 'warn', `${pre}額度帳：${pid} 至 ${until === null || until === undefined ? '?' : until} 略過（額度用盡，重置前不派；quotaGate: false 可關閉）`)
            }
            return
        }
        //額度帳作廢(quota-ledger-void, Gitea #116): 帳經帳號比對或定期重探而作廢, 該次判定改走用量讀者; 帳作廢後即不存在, 每次作廢記一行(無洗版疑慮);
        //帳號欄只有雜湊前8碼(事件本身不含email), 缺漏記'?'
        if (get(ev, 'type', null) === 'quota-ledger-void') {
            let pid = get(ev, 'providerId', '?')
            let tagOf = (v) => (typeof v === 'string' && v !== '' ? v : '?')
            if (get(ev, 'reason', null) === 'account-changed') {
                emitLine(log, 'warn', `${pre}額度帳：${pid} 之帳因登入帳號改變（${tagOf(get(ev, 'accountFrom', null))} → ${tagOf(get(ev, 'accountTo', null))}）而作廢，改查用量讀者`)
            }
            else {
                emitLine(log, 'warn', `${pre}額度帳：${pid} 之帳經重探確認用量已低於門檻而作廢，改查用量讀者`)
            }
            return
        }
        if (get(ev, 'type', null) !== 'cooled') {
            return
        }
        let min = minutesOf(get(ev, 'cooldownMs', null))
        let err = oneline(get(ev, 'error', ''), 60)
        let isKey = get(ev, 'scope', null) === 'key'
        let when = (min === null) ? '冷卻視窗內' : `${min} 分鐘內`
        let head = isKey ? `AI 金鑰進入冷卻 → ${get(ev, 'providerId', '?')}${keyText(get(ev, 'keyIndex', null))}` : `AI 供應商進入冷卻 → ${get(ev, 'providerId', '?')}`
        let tail = isKey ? `${when}降至組內最後；只降序不移除，仍會被嘗試以偵測恢復` : `${when}降至鏈尾；只降序不移除，前面全敗時仍會被嘗試`
        emitLine(log, 'warn', `${pre}${head}（${err === '' ? '' : `${err}，`}${tail}）`)
    }
}


/**
 * 清空「額度帳命中已記過」之行程內記錄(僅供單元測試；對外匯出鍵不含此函數)
 *
 * @returns {undefined} 無回傳值
 */
function resetLedgerNotice() {
    ledgerNoticed.clear()
}


export default logAiOutcome
export { createAiEventLogger, OUTCOME_TEXT, oneline, resetLedgerNotice }
