import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'


// parseAgyStream.mjs — 解析agy `--output-format stream-json`之NDJSON輸出(內部模組, 由dispatchAntigravity之stdin路徑使用; 帳本R-AGY-4)
//
// 【事件形狀(2026-11-07以agy 1.5.2實測)】stdout逐行一個JSON物件, 皆帶字串欄位event: 首行`{"event":"init",...}`, 中間`step_update`(數量不定),
//   末行`{"event":"result","result":{"conversation_id":...,"status":"SUCCESS","response":"完成\n","duration_seconds":...,"num_turns":1,"usage":{...}}}`。
//   status為ERROR時帶錯誤說明(欄位error; 本機未能穩定觸發, 以字串或物件皆容忍)。
//
// 【判成敗只看result事件】agy對「不認得之輸入事件」只在stderr印warning、stdout只留init事件、**離開碼0**(實測event為user_message時),
//   故離開碼0或stdout非空皆不足以判成功; 無result事件即無從得知回覆, 呼叫端一律須判失敗(dispatchAntigravity如此處理)。
//
// 【多個result或多段session】取「最後一個init事件之後的最後一個result事件」: 同一個stdout若累積了多次嘗試(重試各自重新init), 前次嘗試之result不得被當成本次結果。
//   非JSON行、不是物件之JSON、無字串event欄之行一律略過(不拋錯)。


/**
 * 解析agy stream-json之NDJSON輸出，取最後一次session之最後一個result事件
 *
 * @param {String} text 輸入agy stdout全文字串，逐行一個JSON事件；非字串視為空字串
 * @returns {Object} 回傳解析結果物件，內含hasEvents(是否讀到任何帶event欄之行布林值)、hasResult(是否讀到result事件布林值)、status(result.status字串，無result為'')、ok(status恰為SUCCESS布林值)、response(result.response字串，非字串為'')、error(result.error字串化後截至500字元，無為'')、conversationId(result.conversation_id字串，無為'')
 * @example
 *
 * import parseAgyStream from './src/parseAgyStream.mjs'
 *
 * let text = [
 *     '{"event":"init","conversation_id":"c1","init":{"model":"gemini-3.8-flash-low"}}',
 *     '{"event":"step_update","step_type":"model_response"}',
 *     '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"完成\\n","num_turns":1}}',
 * ].join('\n')
 * let r = parseAgyStream(text)
 * console.log(r.hasResult, r.ok, r.status, JSON.stringify(r.response))
 * // => true true 'SUCCESS' '"完成\\n"'
 *
 * //只有init(agy忽略了不認得之輸入事件, 離開碼0): 無result
 * let r2 = parseAgyStream('{"event":"init","conversation_id":"c2"}')
 * console.log(r2.hasEvents, r2.hasResult, r2.ok)
 * // => true false false
 *
 */
function parseAgyStream(text) {

    let r = {
        hasEvents: false,
        hasResult: false,
        status: '',
        ok: false,
        response: '',
        error: '',
        conversationId: '',
    }

    if (!isestr(text)) {
        return r
    }

    for (let line of text.split(/\r?\n/)) {
        let s = line.trim()
        if (s === '' || s[0] !== '{') {
            continue
        }

        let j = null
        try {
            j = JSON.parse(s)
        }
        catch {
            continue
        }
        if (!isobj(j) || !isestr(j.event)) {
            continue
        }
        r.hasEvents = true

        //新session(重試或多次嘗試累積於同一stdout), 先前之result不屬於本次
        if (j.event === 'init') {
            r.hasResult = false
            r.status = ''
            r.ok = false
            r.response = ''
            r.error = ''
            r.conversationId = ''
            continue
        }

        if (j.event === 'result' && isobj(j.result)) {
            let o = j.result
            let status = get(o, 'status', '')
            let response = get(o, 'response', '')
            let err = get(o, 'error', '')
            let cid = get(o, 'conversation_id', '')
            r.hasResult = true
            r.status = isestr(status) ? status : ''
            r.ok = r.status === 'SUCCESS'
            r.response = typeof response === 'string' ? response : ''
            if (isestr(err)) {
                r.error = err.slice(0, 500)
            }
            else if (isobj(err)) {
                r.error = JSON.stringify(err).slice(0, 500)
            }
            else {
                r.error = ''
            }
            r.conversationId = isestr(cid) ? cid : ''
        }

    }

    return r
}


export default parseAgyStream
