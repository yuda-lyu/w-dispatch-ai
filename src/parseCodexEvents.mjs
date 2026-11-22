import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'


// parseCodexEvents.mjs — 解析`codex exec --json`之stdout事件流(JSONL), 取出各命令之執行事件(2026-11-22 排程第448項③; 帳本R-CODEX-2)
//
// 【為何需要】Codex讀檔就是執行shell(`rg`、`cmd /c type`等), 審查回覆之引用與原文不符時, 須能分辨「讀檔時內容已失真」或「模型引用錯」——
//   兩者之分界即Codex實際收到之命令輸出。`--json`之事件流把每個命令之輸出放在`item.completed`(item.type為command_execution)之aggregated_output
//   (同命令另有`item.started`, 其輸出為空, 須取item.completed; 技能dispatch-codex〈輸出〉與〈中文檔案〉節, 0.167.0實測)。
//   失敗結果之stdout被execCli裁到500字元、成功結果之stdout為整串JSONL不便逐案取用, 故轉接器在帶`--json`時另把完整事件流放結果之raw欄、
//   解析出之命令事件放結果之commands欄(比照agy之raw; stdout本身不改, 既有以JSONL為stdout之呼叫端不受影響)。
//
// 【事件形狀(codex 0.167.0, 技能dispatch-codex實測)】每行一個JSON物件: thread.started、turn.started、
//   item.started／item.completed(item為{ id, type, ... }: command_execution帶command、aggregated_output、exit_code(進行中為null)、status;
//   agent_message帶text)、turn.completed(usage)、turn.failed、error。只認item.completed之command_execution; 其餘略過。
//
// 【解析不拋錯】非JSON行略過; 無任何已知事件(hasEvents為false)代表輸入不是事件流, 呼叫端應不加raw與commands。


//已知事件類型(其餘略過; 全部皆非已知類型者hasEvents為false)
let KNOWN_TYPES = ['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']

//單一命令輸出之字元上限(超過者截斷並標outputTruncated)
let OUTPUT_MAX = 2 * 1024 * 1024


/**
 * 解析`codex exec --json`之stdout事件流，取出各命令(command_execution)完成事件
 *
 * @param {String} text 輸入stdout字串(逐行一個JSON事件)
 * @returns {Object} 回傳物件，內含hasEvents(是否解出至少一個已知事件布林值)、commands(最後一次嘗試之命令完成事件陣列——每遇thread.started即重置，故execCli依maxRetries內部重試而累積多份事件流時只取最後一份；依出現順序，各項含id、command、exitCode(數字或null)、status、output(aggregated_output，超過上限者截斷)、outputTruncated)
 * @example
 *
 * import parseCodexEvents from './src/parseCodexEvents.mjs'
 *
 * let ev = [
 *     JSON.stringify({ type: 'item.started', item: { id: 'i0', type: 'command_execution', command: 'rg -n x a.txt', aggregated_output: '', exit_code: null, status: 'in_progress' } }),
 *     JSON.stringify({ type: 'item.completed', item: { id: 'i0', type: 'command_execution', command: 'rg -n x a.txt', aggregated_output: '1:x\n', exit_code: 0, status: 'completed' } }),
 * ].join('\n')
 * console.log(parseCodexEvents(ev).commands.map((c) => [c.command, c.exitCode, c.output]))
 * // => [ [ 'rg -n x a.txt', 0, '1:x\n' ] ]
 *
 */
function parseCodexEvents(text) {
    let res = { hasEvents: false, commands: [] }
    if (!isestr(text)) {
        return res
    }
    for (let line of text.split('\n')) {
        let s = line.replace(/\r$/, '').trim()
        if (s === '') {
            continue
        }
        let ev = null
        try {
            ev = JSON.parse(s)
        }
        catch {
            ev = null
        }
        if (!isobj(ev)) {
            continue
        }
        let type = get(ev, 'type', '')
        if (!isestr(type) || !KNOWN_TYPES.includes(type)) {
            continue
        }
        res.hasEvents = true

        //每次嘗試(含execCli依maxRetries於內部重試, 其輸出累積在同一份stdout)以thread.started起頭: 只取最後一次嘗試之命令
        if (type === 'thread.started') {
            res.commands = []
            continue
        }
        if (type !== 'item.completed') {
            continue
        }
        let item = get(ev, 'item', null)
        if (!isobj(item) || get(item, 'type', '') !== 'command_execution') {
            continue
        }
        let out = get(item, 'aggregated_output', '')
        out = isestr(out) ? out : ''
        let cut = out.length > OUTPUT_MAX
        let code = get(item, 'exit_code', null)
        let id = get(item, 'id', '')
        let cmd = get(item, 'command', '')
        let st = get(item, 'status', '')
        res.commands.push({
            id: isestr(id) ? id : '',
            command: isestr(cmd) ? cmd : '',
            exitCode: (typeof code === 'number' && Number.isFinite(code)) ? code : null,
            status: isestr(st) ? st : '',
            output: cut ? out.slice(0, OUTPUT_MAX) : out,
            outputTruncated: cut,
        })
    }
    return res
}


export default parseCodexEvents
