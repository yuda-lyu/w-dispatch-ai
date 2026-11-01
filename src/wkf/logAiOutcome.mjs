import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
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
// 【tag】多個呼叫點共用同一記錄器時區分來源: 非空字串時每行前綴`[tag] `。
//
// 【oneline】錯誤字串壓成單行並截斷(wsemi strTruncate, 刪節號`...`), 內嵌於本檔——不依賴w-data-pipeline。


/**
 * outcome對人話: 遞補歷程中非ok之outcome譯成中文，未收錄者(如budget-out、skip-key、context-too-long)原樣顯示
 */
let OUTCOME_TEXT = Object.freeze({
    'next-key': '換金鑰',
    'skip-group': '整組跳過',
})


//METHODS, 各等級依序嘗試之記錄器成員名
let METHODS = {
    info: ['log', 'info'],
    warn: ['logWarn', 'warn'],
    error: ['logError', 'error'],
}


/**
 * 壓成單行並截斷：先遮蔽Anthropic金鑰樣式，空白(含換行)壓為單一空格、修剪頭尾，超過n字以strTruncate截斷(補刪節號)
 *
 * @param {*} s 輸入文字(null與undefined視為空；無法轉字串者視為空)
 * @param {Number} n 輸入保留字數非負整數
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
    return strTruncate(t.replace(/\s+/g, ' ').trim(), n)
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
 * 前綴: tag為非空字串時為`[tag] `，否則空字串
 *
 * @param {*} tag 輸入tag
 * @returns {String} 回傳前綴字串
 */
function prefixOf(tag) {
    return isestr(tag) ? `[${tag}] ` : ''
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
 * 冷卻分鐘數: 毫秒換算為分鐘(至多一位小數)，無效回null
 *
 * @param {*} ms 輸入冷卻毫秒
 * @returns {Number|null} 回傳分鐘數
 */
function minutesOf(ms) {
    return (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) ? Number((ms / 60000).toFixed(1)) : null
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
 * 遞補歷程單筆: `providerId／key#n（outcome人話：errorType／原因，耗時s）`
 *
 * @param {Object} t 輸入tried單筆
 * @returns {String} 回傳字串
 */
function triedText(t) {
    let oc = isestr(t.outcome) ? t.outcome : '?'
    let ocText = Object.prototype.hasOwnProperty.call(OUTCOME_TEXT, oc) ? OUTCOME_TEXT[oc] : oc
    let reason = isestr(t.reason) ? t.reason : t.error
    let why = [isestr(t.errorType) ? t.errorType : '', oneline(reason, 80)].filter((v) => v !== '').join('／')
    let sec = (typeof t.durationMs === 'number' && Number.isFinite(t.durationMs)) ? `，${t.durationMs / 1000}s` : ''
    return `${isestr(t.providerId) ? t.providerId : '?'}${keyText(t.keyIndex)}（${ocText}${why === '' ? '' : `：${why}`}${sec}）`
}


/**
 * 把一次dispatchAiFallback(或createAiCaller.callAI)之結果渲染成日誌
 *
 * 特點：
 * 至多四行：①成功時「使用 AI」(INFO；含kind／model、REST類之token用量含思考、截斷內容放行之加註)；
 * ②有非ok之嘗試時「AI 遞補歷程」(WARN；逐筆含key#、outcome人話、errorType、原因壓單行80字、耗時)；
 * ③providersSkipped非空時「AI 供應商未納入」(WARN)；④providersMissing非空時「providerPick 有無效 id」(ERROR)；
 * 記錄器接受log／logWarn／logError或info／warn／error兩種介面，一律以成員呼叫形式觸發(class-based logger之this不失)；
 * log缺或非物件即throw，result非物件則無事可記(不throw)；整行套Anthropic金鑰樣式遮蔽，不輸出stdout；記錄器自身之失敗吞掉
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} opt.result 輸入dispatchAiFallback或callAI之結果物件
 * @param {Object} opt.log 輸入記錄器物件(console亦可)
 * @param {String} [opt.tag=''] 輸入來源標籤字串，非空時每行前綴`[tag] `，預設''
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
 * logAiOutcome({ result, log: console, tag: 'news' })
 * // => [news] 使用 AI agnes:agnes-3.0-flash／key#2（api-openai-compat／agnes-3.0-flash，tokens 120+80（含思考 30））
 * // => [news] AI 遞補歷程 → agnes:agnes-3.0-flash／key#1（換金鑰：http／HTTP 429 quota exceeded，1.2s）
 * // => [news] AI 供應商未納入 → my:model（MY_KEYS 無金鑰）
 * // => [news] providerPick 有無效 id → claude/sonnet（請對照供應商目錄）
 *
 */
function logAiOutcome(opt) {
    let log = chkLog(get(opt, 'log', null), 'logAiOutcome')
    let result = get(opt, 'result', null)
    if (!isobj(result)) {
        return
    }
    let pre = prefixOf(get(opt, 'tag', ''))

    //① 使用 AI
    if (result.ok === true && isestr(result.providerId)) {
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
 * 建立遞補事件記錄函數(目前處理cooled事件：供應商或金鑰進入冷卻)，可直接掛進onEvent
 *
 * 特點：
 * 回傳(ev)=>void，ev.type為'cooled'時以WARN記一行(供應商冷卻：降至鏈尾；scope為'key'之金鑰冷卻：降至組內最後)，其餘事件忽略；
 * 記錄器之規則同logAiOutcome(成員呼叫形式、兩種介面、整行遮蔽、自身失敗吞掉)；log缺或非物件即throw
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} opt.log 輸入記錄器物件
 * @param {String} [opt.tag=''] 輸入來源標籤字串，預設''
 * @returns {Function} 回傳事件記錄函數(ev)=>void
 * @example
 *
 * import { createAiEventLogger } from './src/wkf/logAiOutcome.mjs'
 *
 * let onEvent = createAiEventLogger({ log: console, tag: 'news' })
 * onEvent({ type: 'cooled', providerId: 'agnes:agnes-3.0-flash', error: 'HTTP 429', cooldownMs: 600000 })
 * // => [news] AI 供應商進入冷卻 → agnes:agnes-3.0-flash（HTTP 429，10 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）
 *
 * //掛進呼叫器: createAiCaller({ pick, onEvent })
 *
 */
function createAiEventLogger(opt) {
    let log = chkLog(get(opt, 'log', null), 'createAiEventLogger')
    let pre = prefixOf(get(opt, 'tag', ''))

    return (ev) => {
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


export default logAiOutcome
export { createAiEventLogger, OUTCOME_TEXT }
