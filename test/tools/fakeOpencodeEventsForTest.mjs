import createFakeCli from './fakeCliForTest.mjs'


// fakeOpencodeEventsForTest.mjs — 模擬`opencode run`在預設格式與`--format json`兩種輸出之假CLI(2026-11-04 da78, Gitea #78)
//
// 形狀取自本機opencode 1.19.5(假OpenAI相容服務實測, 證據見sgud/rule/rulebook_opencodego.md R-OCGO-4):
//   預設格式: stdout只寫已結束text之trim()+EOL; stderr為`\n> build · <model>\n\n`標頭, 錯誤另寫`Error: <訊息>`+EOL; 錯誤時離開碼1。
//   json格式: 每個事件一行JSON(step_start/text/step_finish/error), step_finish.part帶reason與tokens; 錯誤改為type 'error'事件(寫stdout), 離開碼同為1。
//
// 以`--fake-scenario=<名>`選情境(經extraArgs傳入), 以`--fake-count-file=<檔>`每次被呼叫追加一行(供數嘗試次數):
//   stop            text '  hello world  ' → 正常結束(reason stop)
//   length-text     text ' partial {"a": ' → reason length(reasoning 20000、output 12000)
//   length-empty    無text → reason length(reasoning 32000、output 0)
//   tool-then-stop  step1 reason tool-calls; step2 text 'final answer' reason stop
//   length-then-stop step1 reason length; step2 text 'recovered' reason stop(最後一步為stop → 非截斷)
//   stop-then-length step1 text 'first' reason stop; step2 reason length(最後一步為length → 截斷)
//   multi-text      兩個text('one'、'two')
//   noise           stdout先有一行非JSON雜訊, 再text 'after noise'
//   error           錯誤事件'boom from fake', 離開碼1
//   long-then-error 先有900字元的text再錯誤事件(execCli失敗時stdout只留前500字元, 事件流會被截斷, 用來釘住「自行累積全文」之必要性), 離開碼1
//   echo-env        text為JSON {"max":"<OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX>"}
//   echo-args       text為JSON陣列(收到之命令列參數)
//   unknown-events  json格式下只印未知類型之事件(模擬opencode日後改名事件類型)
//   length-then-error 先有text 'cut'與reason length之step_finish, 其後才有錯誤事件, 離開碼1(離開碼非0者不判截斷, 屬一般exec失敗)
//   two-sessions    先印一個舊session(text 'old text', reason length), 再印新session(text 'latest', reason stop)——模擬execCli內部重試後stdout含多次嘗試
//   none            不印任何東西(離開碼0)
// 模型名取`-m`之值(無則'fake-model')。


let CODE_ENTRY = `
import fs from 'fs'

let args = process.argv.slice(2)
let arg = (p) => {
    let a = args.find((x) => x.startsWith(p))
    return a ? a.slice(p.length) : ''
}
let scen = arg('--fake-scenario=') || 'stop'
let countFile = arg('--fake-count-file=')
let iFmt = args.indexOf('--format')
let json = (iFmt >= 0 && args[iFmt + 1] === 'json') || args.includes('--format=json')
let iM = args.indexOf('-m')
let model = iM >= 0 ? args[iM + 1] : 'fake-model'
let EOL = '\\r\\n'

if (countFile) {
    fs.appendFileSync(countFile, '1\\n')
}

let tk = (total, input, output, reasoning) => ({ total, input, output, reasoning, cache: { write: 0, read: 0 } })
let ev = (sid, type, extra) => JSON.stringify({ type, timestamp: 1, sessionID: sid, ...extra })
let text = (sid, t) => ev(sid, 'text', { part: { id: 'p', sessionID: sid, type: 'text', text: t, time: { start: 1, end: 2 } } })
let stepStart = (sid) => ev(sid, 'step_start', { part: { id: 'p', sessionID: sid, type: 'step-start' } })
let stepFinish = (sid, reason, tokens) => ev(sid, 'step_finish', { part: { id: 'p', sessionID: sid, type: 'step-finish', reason, tokens, cost: 0 } })

//steps: [{ texts: [...], reason, tokens }]
let SC = {
    'stop': [{ texts: ['  hello world  '], reason: 'stop', tokens: tk(11, 10, 1, 0) }],
    'length-text': [{ texts: [' partial {"a": '], reason: 'length', tokens: tk(32010, 10, 12000, 20000) }],
    'length-empty': [{ texts: [], reason: 'length', tokens: tk(32010, 10, 0, 32000) }],
    'tool-then-stop': [{ texts: [], reason: 'tool-calls', tokens: tk(20, 10, 10, 0) }, { texts: ['final answer'], reason: 'stop', tokens: tk(30, 20, 10, 0) }],
    'length-then-stop': [{ texts: [], reason: 'length', tokens: tk(32010, 10, 0, 32000) }, { texts: ['recovered'], reason: 'stop', tokens: tk(30, 20, 10, 0) }],
    'stop-then-length': [{ texts: ['first'], reason: 'stop', tokens: tk(11, 10, 1, 0) }, { texts: [], reason: 'length', tokens: tk(32010, 10, 0, 32000) }],
    'multi-text': [{ texts: ['one', 'two'], reason: 'stop', tokens: tk(11, 10, 1, 0) }],
    'noise': [{ texts: ['after noise'], reason: 'stop', tokens: tk(11, 10, 1, 0) }],
    'echo-env': [{ texts: [JSON.stringify({ max: process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || '' })], reason: 'stop', tokens: tk(11, 10, 1, 0) }],
    'echo-args': [{ texts: [JSON.stringify(args)], reason: 'stop', tokens: tk(11, 10, 1, 0) }],
}

let out = ''
let err = ''
let code = 0
let sidA = 'ses_fake_A'
let sidB = 'ses_fake_B'

if (scen === 'none') {
    //無輸出
}
else if (scen === 'error' || scen === 'long-then-error') {
    code = 1
    let big = scen === 'long-then-error' ? 'x'.repeat(900) : ''
    if (json) {
        out += stepStart(sidA) + EOL
        if (big) {
            out += text(sidA, big) + EOL
        }
        out += ev(sidA, 'error', { error: { name: 'APIError', data: { message: 'boom from fake', statusCode: 400 } } }) + EOL
    }
    else {
        if (big) {
            out += big + EOL
        }
        err += '\\u001b[0m' + EOL + '> build · ' + model + EOL + '\\u001b[0m' + EOL + 'Error: boom from fake' + EOL
    }
}
else if (scen === 'unknown-events') {
    if (json) {
        out += ev(sidA, 'message_part', { part: { text: 'hi' } }) + EOL + ev(sidA, 'finish', { part: { reason: 'length' } }) + EOL
    }
    else {
        out += 'hi' + EOL
    }
}
else if (scen === 'length-then-error') {
    code = 1
    if (json) {
        out += stepStart(sidA) + EOL + text(sidA, 'cut') + EOL + stepFinish(sidA, 'length', tk(32010, 10, 12000, 20000)) + EOL
        out += ev(sidA, 'error', { error: { name: 'APIError', data: { message: 'boom after length' } } }) + EOL
    }
    else {
        out += 'cut' + EOL
        err += 'Error: boom after length' + EOL
    }
}
else if (scen === 'two-sessions') {
    if (json) {
        out += stepStart(sidA) + EOL + text(sidA, 'old text') + EOL + stepFinish(sidA, 'length', tk(32010, 10, 12000, 20000)) + EOL
        out += stepStart(sidB) + EOL + text(sidB, 'latest') + EOL + stepFinish(sidB, 'stop', tk(11, 10, 1, 0)) + EOL
    }
    else {
        out += 'latest' + EOL
    }
}
else {
    let steps = SC[scen] || SC.stop
    if (!json) {
        err += '\\u001b[0m' + EOL + '> build · ' + model + EOL + '\\u001b[0m' + EOL
    }
    if (scen === 'noise') {
        out += 'WARNING: something on stdout' + EOL
    }
    for (let st of steps) {
        if (json) {
            out += stepStart(sidA) + EOL
        }
        for (let t of st.texts) {
            if (json) {
                out += text(sidA, t) + EOL
            }
            else if (t.trim() !== '') {
                out += t.trim() + EOL
            }
        }
        if (json) {
            out += stepFinish(sidA, st.reason, st.tokens) + EOL
        }
    }
}

let chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
    if (err) {
        process.stderr.write(err)
    }
    process.stdout.write(out, () => {
        process.exit(code)
    })
})
process.stdin.resume()
`


/**
 * 產生模擬opencode預設格式與json事件流之假CLI
 *
 * @param {String} name 輸入假CLI名稱字串，各測試檔須給予不同名稱，避免mocha並行執行時互相干擾
 * @returns {Object} 回傳物件，內含exe(假CLI執行檔絕對路徑字串)、fd(產物資料夾絕對路徑字串)、clean(清除產物之函數)
 */
function createFakeOpencodeEvents(name) {
    return createFakeCli(name, CODE_ENTRY)
}


export default createFakeOpencodeEvents
