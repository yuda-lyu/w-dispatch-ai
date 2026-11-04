import os from 'os'
import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { normalizeFinishReason, TRUNCATION_REASONS } from './checkTruncation.mjs'


// parseOpencodeEvents.mjs — 解析`opencode run --format json`之事件流(2026-11-04 da78, Gitea #78)
//
// 【為何需要】預設格式(非json)下, opencode run之stdout只有模型的文字、stderr只有`> agent · model`標頭, 回應「為何結束」完全不可見:
//   輸出上限(length)被截斷與正常結束(stop)無從分辨(2026-11-04實測: 推理耗盡上限時stdout為空字串、離開碼0、stderr僅標頭)。
//   `--format json`會把每個事件印成一行JSON, 其中`step_finish`事件之part.reason即該步之終止原因(本機opencode 1.19.5, 假OpenAI相容服務實測:
//   finish_reason=length → reason 'length'; stop → 'stop'; 工具呼叫 → 'tool-calls'), part.tokens為{ total, input, output, reasoning, cache }。
//
// 【stdout重建規則(源自opencode 1.19.5之run指令原始碼, 本機以假服務逐案比對預設格式輸出相同)】預設格式下stdout只寫「已結束(part.time.end)之text」:
//   `text.trim()`為空則略過, 否則寫`text.trim() + EOL`(EOL即os.EOL); JSON格式下同一事件改印為一行JSON而不寫上列文字。
//   故由事件流重建: 對每個text事件取part.text去頭尾空白, 非空者接上os.EOL。reasoning事件僅於帶--thinking時才有輸出(預設格式為`Thinking: <trim>` + EOL), 同理重建。
//   stderr: 預設格式之標頭、工具進度行與錯誤行(`Error: <訊息>`, 訊息取自session.error)皆寫stderr; JSON格式下錯誤改為type 'error'事件(寫stdout),
//   本函數把錯誤事件還原為`Error: <訊息>` + EOL的stderr文字(去ANSI色碼; 訊息取error.data.message, 否則error.name), 標頭與工具進度行不還原(無從得知亦無用)。
//
// 【截斷判定以「最後一個step_finish」為準】opencode遇length即結束迴圈(不續跑下一步), 故最後一步之reason即整次回應之終止原因;
//   中間步驟(工具呼叫)之reason為'tool-calls'。只認最後一個step_finish, 不因任一步曾為length就判截斷。截斷集合沿用checkTruncation之TRUNCATION_REASONS(length、content_filter;
//   AI SDK之'content-filter'正規化為'content_filter')。content_filter本機未能以真實服務觸發, 僅以假服務確認事件形狀, 見帳本。
//
// 【解析不拋錯】非JSON行(例如其他程式寫入stdout之警告)原樣保留在重建之stdout中(視同預設格式下亦會出現); 無任何事件(hasEvents為false)代表輸入不是事件流,
//   呼叫端應原樣使用輸入, 不得據此判定未截斷。
// 【只認已知事件類型(KNOWN_TYPES)】JSON物件但type不是已知類型者(含opencode日後新增或改名者)略過、不計入hasEvents:
//   若opencode改了事件名而整串皆未識別, hasEvents為false, dispatchOpencode沿用原輸出(原始事件行), 後續validate會明確失敗,
//   而不會被重建成「空回應」而靜默成功; 僅部分改名(例如只有step_finish改名)則該部分失效(例如無法判截斷), 其餘照舊。opencode v2之事件格式未驗證。


//文字結尾符, 與子進程(opencode)同機同平台故取本機EOL
let EOL = os.EOL


//ANSI色碼(刻意比對控制字元ESC以去除色碼)
// eslint-disable-next-line no-control-regex
let RE_ANSI = /\u001b\[[0-9;]*m/g


//已知事件類型(opencode 1.19.5 run --format json): 其餘類型(含日後新增者)略過、不計入hasEvents——
//整串都不是已知類型時(例如日後改名)hasEvents為false, 呼叫端沿用原輸出, 不會把一串未識別之事件當成「回應為空」
let KNOWN_TYPES = ['step_start', 'step_finish', 'text', 'reasoning', 'error', 'tool_use']


/**
 * 還原一個錯誤事件之人讀訊息(取error.data.message, 否則error.name, 再否則'unknown error'; 去ANSI色碼與開頭之'Error: ')
 *
 * @param {Object} err 輸入錯誤事件之error欄位
 * @returns {String} 回傳訊息字串
 */
function errorMessageOf(err) {
    let msg = get(err, 'data.message', '')
    if (!isestr(msg)) {
        msg = get(err, 'name', '')
    }
    if (!isestr(msg) || msg.trim() === '') {
        msg = 'unknown error'
    }
    msg = msg.replace(RE_ANSI, '').trim()
    if (msg.startsWith('Error: ')) {
        msg = msg.slice(7)
    }
    return msg
}


/**
 * 解析`opencode run --format json`之stdout事件流, 重建預設格式下之stdout/stderr, 並取最後一步之終止原因與token
 *
 * @param {String} text 輸入stdout字串(逐行一個JSON事件)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.lastSessionOnly=false] 輸入是否只取最後一個sessionID之事件布林值(同一串流含多次嘗試時用)，預設false
 * @returns {Object} 回傳物件，內含hasEvents(是否解出至少一個事件布林值)、stdout(重建之文字字串，text事件去頭尾空白後各接os.EOL，非JSON行原樣保留)、stderr(錯誤事件還原之`Error: 訊息`文字字串)、finishReason(最後一個step_finish之終止原因，正規化為小寫並以底線取代連字號，無則空字串)、truncated(finishReason屬TRUNCATION_REASONS布林值)、tokens(最後一個step_finish之tokens物件，無則null)、sessionID(事件中的session id字串，無則空字串)、steps(step_finish事件數)
 * @example
 *
 * import parseOpencodeEvents from './src/parseOpencodeEvents.mjs'
 *
 * let ev = [
 *     JSON.stringify({ type: 'text', part: { type: 'text', text: ' partial ', time: { start: 1, end: 2 } } }),
 *     JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'length', tokens: { total: 32010, input: 10, output: 0, reasoning: 32000 } } }),
 * ].join('\n')
 * let r = parseOpencodeEvents(ev)
 * console.log(r.stdout.trim(), r.finishReason, r.truncated, r.tokens.reasoning)
 * // => 'partial' 'length' true 32000
 *
 */
function parseOpencodeEvents(text, opt = {}) {
    let res = {
        hasEvents: false,
        stdout: '',
        stderr: '',
        finishReason: '',
        truncated: false,
        tokens: null,
        sessionID: '',
        steps: 0,
    }
    if (!isestr(text)) {
        return res
    }
    let lastSessionOnly = get(opt, 'lastSessionOnly', false) === true

    //逐行解析
    let rows = []
    for (let line of text.split('\n')) {
        let s = line.replace(/\r$/, '')
        if (s.trim() === '') {
            continue
        }
        let ev = null
        try {
            ev = JSON.parse(s)
        }
        catch {
            ev = null
        }
        rows.push({ s, ev: (isobj(ev) && isestr(get(ev, 'type', ''))) ? ev : null })
    }

    //lastSessionOnly: 同一串流含多次嘗試(重試各開新session)時, 只取最後一個session之事件
    let sidKeep = ''
    if (lastSessionOnly) {
        for (let row of rows) {
            if (row.ev !== null && isestr(get(row.ev, 'sessionID', ''))) {
                sidKeep = row.ev.sessionID
            }
        }
    }

    let lastFinish = null
    for (let { s, ev } of rows) {
        if (ev === null) {

            //非事件行, 原樣保留
            res.stdout += s + EOL
            continue
        }
        if (sidKeep !== '' && isestr(get(ev, 'sessionID', '')) && ev.sessionID !== sidKeep) {
            continue
        }
        let type = ev.type
        if (!KNOWN_TYPES.includes(type)) {
            continue
        }
        res.hasEvents = true
        if (res.sessionID === '' && isestr(get(ev, 'sessionID', ''))) {
            res.sessionID = ev.sessionID
        }
        if (type === 'text' || type === 'reasoning') {
            let t = get(ev, 'part.text', '')
            t = isestr(t) ? t.trim() : ''
            if (t !== '') {
                res.stdout += (type === 'reasoning' ? `Thinking: ${t}` : t) + EOL
            }
        }
        else if (type === 'step_finish') {
            lastFinish = ev
            res.steps++
        }
        else if (type === 'error') {
            res.stderr += `Error: ${errorMessageOf(get(ev, 'error', null))}` + EOL
        }
    }

    if (lastFinish !== null) {
        res.finishReason = normalizeFinishReason(get(lastFinish, 'part.reason', '')).replace(/-/g, '_')
        res.truncated = TRUNCATION_REASONS.includes(res.finishReason)
        let tk = get(lastFinish, 'part.tokens', null)
        res.tokens = isobj(tk) ? tk : null
    }
    return res
}


export default parseOpencodeEvents
export { errorMessageOf }
