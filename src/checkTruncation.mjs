import get from 'lodash-es/get.js'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'


// checkTruncation.mjs — REST文字轉接器之截斷裁定與安全驗證(單一來源, compat與responses共用)
//
// 【為何需要(2026-09-24實測後之終審方案)】Zen之space-bunny-free帶max_tokens:600時推理階段即耗盡,
//   回finish_reason:"length"、content:""(空字串), 舊版dispatchApiOpenaiCompat不看finish_reason而回ok:true、
//   stdout為空——截斷成了無人察覺的成功。同期dispatchApiOpenaiResponses則對status≠completed一律失敗,
//   兩個兄弟轉接器規則不一; 截斷規則若各自手寫, 日後必再分岔, 故收斂於此。
//
// 【規則(兩位Opus 5.5獨立複審後之終審結論, 見README之截斷處理段)】
//   ① 截斷一律於validate之前判定, 預設失敗(errorType incomplete)——「validate接受」不代表內容完整:
//      nonempty/min:N/rawText不檢查完整性, 寬鬆JSON解析還會從前言取出錯誤片段, 不可推定為同意;
//   ② 呼叫端明示acceptTruncated:true才放行, 且僅限length(content_filter為政策性過濾, 殘文一律不收);
//      放行時有validate則交validate裁決, 無validate則直接接受(供轉發型呼叫端), 結果一律標truncated:true;
//   ③ 可見輸出為空(null/空字串/純空白)時無物可收, 一律失敗, 訊息標明推理可能耗盡輸出上限並附reasoning_tokens。
//
// 【validate拋錯視同拒絕】呼叫端之validate(或工作流之parse/check)拋錯時, 舊版一路reject至最外層,
//   違反各函數「不會reject」之承諾; safeValidate統一接住並回傳拋錯訊息供轉接器置入stderr診斷。


//截斷終止原因集合(正規化後); 其餘值(stop、null、各家未知值)一律視為非截斷, 不可誤殺
let TRUNCATION_REASONS = ['length', 'content_filter']


/**
 * 正規化終止原因字串(去頭尾空白、轉小寫；非字串回傳空字串)
 *
 * @param {*} v 輸入原始終止原因
 * @returns {String} 回傳正規化字串
 * @example
 *
 * import { normalizeFinishReason } from './src/checkTruncation.mjs'
 *
 * console.log(normalizeFinishReason(' LENGTH '), normalizeFinishReason(null))
 * // => 'length' ''
 *
 */
function normalizeFinishReason(v) {
    return isestr(v) ? v.trim().toLowerCase() : ''
}


/**
 * 以不拋錯方式執行驗證函式(拋錯視同拒絕)
 *
 * @param {Function} validator 輸入驗證函式(text)=>Boolean
 * @param {String} text 輸入待驗證文字
 * @returns {Object} 回傳物件，內含pass(是否通過布林值)與threw(拋錯訊息字串，未拋錯為空字串)
 * @example
 *
 * import { safeValidate } from './src/checkTruncation.mjs'
 *
 * console.log(safeValidate((s) => s.length > 1, 'ab'))
 * // => { pass: true, threw: '' }
 *
 * console.log(safeValidate(() => { throw new Error('x') }, 'ab'))
 * // => { pass: false, threw: 'x' }
 *
 */
function safeValidate(validator, text) {
    try {
        return { pass: !!validator(text), threw: '' }
    }
    catch (err) {
        let msg = get(err, 'message', '')
        return { pass: false, threw: isestr(msg) ? msg : String(err) }
    }
}


/**
 * 裁定一次已截斷之回應應失敗或放行(呼叫端先判定truncated為true才呼叫)
 *
 * @param {Object} o 輸入設定物件
 * @param {String} o.finishReason 輸入正規化後之終止原因字串，'length'才可能放行
 * @param {String|null} o.content 輸入可見輸出文字，null代表無
 * @param {Boolean} [o.acceptTruncated=false] 輸入呼叫端是否明示接受截斷內容布林值
 * @param {Function|null} [o.validator=null] 輸入驗證函式，放行時交其裁決
 * @param {Number|null} [o.reasoningTokens=null] 輸入推理token數，可見輸出為空時附於訊息
 * @param {String} o.label 輸入錯誤訊息主體字串，例如'finish_reason=length'或'status=incomplete (max_output_tokens)'
 * @returns {Object} 回傳物件，內含accept(是否放行布林值)、error(不放行時之錯誤訊息字串)、threw(validate拋錯訊息字串)
 * @example
 *
 * import { judgeTruncated } from './src/checkTruncation.mjs'
 *
 * console.log(judgeTruncated({ finishReason: 'length', content: '', reasoningTokens: 600, label: 'finish_reason=length' }).error)
 * // => 'INCOMPLETE_RESPONSE: finish_reason=length; no visible output (reasoning may have used up the output token limit, reasoning_tokens=600)'
 *
 * console.log(judgeTruncated({ finishReason: 'length', content: '[{"a":1},', acceptTruncated: true, label: 'finish_reason=length' }).accept)
 * // => true
 *
 */
function judgeTruncated(o) {
    let finishReason = get(o, 'finishReason', '')
    let content = get(o, 'content', null)
    let acceptTruncated = get(o, 'acceptTruncated', false) === true
    let validator = get(o, 'validator', null)
    let reasoningTokens = get(o, 'reasoningTokens', null)
    let base = `INCOMPLETE_RESPONSE: ${get(o, 'label', '')}`

    //可見輸出為空: 無物可收, 一律失敗並標明可能為推理耗盡
    let visible = isestr(content) ? content.trim() : ''
    if (visible === '') {
        let rt = isnum(reasoningTokens) ? `, reasoning_tokens=${reasoningTokens}` : ''
        return { accept: false, error: `${base}; no visible output (reasoning may have used up the output token limit${rt})`, threw: '' }
    }

    //content_filter等非length之截斷一律不收; 未明示同意亦不收
    if (finishReason !== 'length' || !acceptTruncated) {
        return { accept: false, error: base, threw: '' }
    }

    //明示同意: 有validate交其裁決, 無validate直接接受
    if (typeof validator === 'function') {
        let v = safeValidate(validator, content)
        if (!v.pass) {
            return { accept: false, error: `${base}; rejected by validate`, threw: v.threw }
        }
    }
    return { accept: true, error: '', threw: '' }
}


export { TRUNCATION_REASONS, normalizeFinishReason, safeValidate, judgeTruncated }
