import isestr from 'wsemi/src/isestr.mjs'
import { UPSTREAM_MAX } from './opencodeUpstream.mjs'
import { maskDiag } from './failureDiag.mjs'


// opencodeLimit.mjs — opencode免費池用盡／免費層429之即時偵測(2026-11-15 wda156, Gitea #156; 帳本R-OCLIMIT-1)
//
// 【為何需要】opencode run之主要請求收到免費池用盡(`Free usage limit reached`)或免費層429(`Rate limit exceeded`)後不結束(見dispatchOpencode檔頭),
//   本套件原只能等timeoutMs。opencode之日誌列(含上游錯誤原文)預設寫入日誌檔; 帶`--print-logs`時改印到stderr(且不再寫入日誌檔——本機實測: 同一匿名成功呼叫,
//   帶`--print-logs --log-level ERROR`者opencode.log增0位元組、不帶者增17490位元組〔58行INFO〕)。stderr為本行程專屬, 據以終止不會誤及並行之其他opencode行程;
//   日誌檔則為多行程共用之累積檔(同模型並行無從歸屬, 見state_diag之已知缺口), 不宜據以終止行程。
//
// 【錯誤列之形狀(本機opencode.log實查, opencode 1.19.x; 2026-11-15以本機日誌統計)】一行一筆, 空白分隔之key=value(字串值雙引號、反斜線跳脫):
//     … level=ERROR run=… message="stream error" providerID=opencode modelID=beam-free session.id=… small=false agent=build mode=primary error.error="AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go"
//     … level=ERROR … providerID=opencode modelID=… small=false agent=build mode=primary error.error="AI_APICallError: Rate limit exceeded. Please try again later."
//   標題用小模型之附帶請求同時段亦常見(small=true agent=title, error.error="AI_RetryError: Failed after 3 attempts. Last error: Free usage limit reached. …")——其失敗不代表主要請求失敗, 不算。
//   使用端以真實CLI(免費池已用盡)實測: 帶旗標後stderr約3.1秒出現agent=build之該列(建議檔第1節)。
//
// 【判準(classifyLimitLine)】去ANSI色碼與行尾CR後, 以頂層key=value解析(parseLogFields; 引號內之文字不當成欄位——外審terra #16: message內含`agent=build`者不得被誤取):
//   ①level為ERROR; ②有agent欄且其值不為title(附帶請求); ③mode欄若存在須為primary(子agent〔mode=subagent等〕之錯誤列不代表主要請求; 實際列皆為mode=primary, 外審terra #17);
//   ④providerID為opencode(免費池與免費層之供應商; 訂閱opencode-go到頂之字樣與行為無實例, 不臆測、不判); ⑤原因(error.error, 其次error、message)含`Free usage limit reached`為'quota'
//   (該字樣本身即免費池), 含`Rate limit exceeded`且modelID以`-free`結尾者為'rate-limit'——本機日誌之429列皆為`-free`免費模型, 同provider之按量模型遇429時opencode是否同樣不結束
//   (或會自行退避重試)無實例, 不臆測而不判(外審terra #18; 無`-free`後綴之免費模型如big-pickle之429因而不涵蓋, 退回修前)。
//   其餘(含舊版非key=value格式之日誌列)一律不判, 退回修前行為(等到逾時)——安全方向。
// 【逐行】stderr以區塊送達, 錯誤列可能跨兩個區塊: 只判斷已收到換行之完整行; 超過LINE_MAX字元之行不論是否跨區塊一律捨棄、不判(外審terra #9: 判定不隨區塊切法而異)。
//   每次嘗試(spawn)重置; 每次嘗試至多觸發一次。另保留本次嘗試之ERROR列(至多KEEP_LINES行、每行至多KEEP_LINE_MAX字元)供失敗時擷取上游原因(upstreamFromLines)。


//字樣
let RE_QUOTA = /Free usage limit reached/i
let RE_RATE = /Rate limit exceeded/i
let RE_FREE_MODEL = /-free$/ //429之即時終止只認免費模型(見檔頭⑤)

//供應商: 免費池與免費層之provider id(訂閱opencode-go不在此列)
let LIMIT_PROVIDER = 'opencode'

//未完之行之保留上限、保留ERROR列之行數與每行字元上限
let LINE_MAX = 64 * 1024
let KEEP_LINES = 50
let KEEP_LINE_MAX = 4000

//ANSI控制序列(刻意比對控制字元ESC)
// eslint-disable-next-line no-control-regex
let RE_ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g


/**
 * 以頂層key=value解析一行日誌(空白分隔；值以雙引號包起者可含空白並以反斜線跳脫，引號內之文字不當成欄位；同名鍵取第一個)
 *
 * @param {String} line 輸入已去色碼之日誌行
 * @returns {Object} 回傳欄位物件(鍵→字串值)；無欄位為空物件
 * @example
 *
 * import { parseLogFields } from './src/opencodeLimit.mjs'
 *
 * console.log(parseLogFields('level=ERROR message="x agent=build x" agent=title').agent)
 * // => 'title'
 *
 */
function parseLogFields(line) {
    let o = {}
    let s = String(line)
    let re = /([A-Za-z0-9_.-]+)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/y
    let i = 0
    while (i < s.length) {
        if (s[i] === ' ' || s[i] === '\t') {
            i++
            continue
        }
        re.lastIndex = i
        let m = re.exec(s)
        if (!m) {
            //非key=value之詞(或未閉合之引號): 略過至下一個空白
            let j = s.indexOf(' ', i)
            i = j < 0 ? s.length : j
            continue
        }
        let k = m[1]
        let v = m[3]
        if (m[2] !== undefined) {
            try {
                v = JSON.parse(`"${m[2]}"`)
            }
            catch {
                v = m[2].replace(/\\(["\\])/g, '$1')
            }
        }
        if (!Object.prototype.hasOwnProperty.call(o, k)) {
            o[k] = v
        }
        i = re.lastIndex
    }
    return o
}


/**
 * 取日誌欄位之原因文字：error.error，其次error，其次message(非'stream error')
 *
 * @param {Object} f 輸入parseLogFields之回傳
 * @returns {String} 回傳原因字串，無則空字串
 */
function reasonOf(f) {
    let t = f['error.error'] || f.error || ''
    if (t === '') {
        let msg = f.message || ''
        t = (msg !== 'stream error') ? msg : ''
    }
    return t
}


/**
 * 去ANSI色碼與行尾CR
 *
 * @param {String} raw 輸入原始行
 * @returns {String} 回傳清理後之行
 */
function cleanLine(raw) {
    return String(raw).replace(RE_ANSI, '').replace(/\r+$/, '')
}


/**
 * 判讀一行opencode日誌列是否為主要請求之免費池用盡或免費層429(判準見檔頭)
 *
 * @param {String} raw 輸入一行文字(可含ANSI色碼與行尾CR)
 * @returns {Object|null} 回傳{ kind('quota'或'rate-limit'), text(原因原文), agent, providerID, modelID }；不符者回傳null
 * @example
 *
 * import { classifyLimitLine } from './src/opencodeLimit.mjs'
 *
 * let line = 'timestamp=2026-11-15T01:00:00.000Z level=ERROR message="stream error" providerID=opencode modelID=beam-free small=false agent=build mode=primary error.error="AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go"'
 * console.log(classifyLimitLine(line).kind)
 * // => 'quota'
 *
 * console.log(classifyLimitLine(line.replace('agent=build', 'agent=title')))
 * // => null
 *
 */
function classifyLimitLine(raw) {
    if (!isestr(raw)) {
        return null
    }
    let f = parseLogFields(cleanLine(raw))
    if (f.level !== 'ERROR') {
        return null
    }
    let agent = f.agent || ''
    if (agent === '' || agent === 'title') {
        return null
    }
    if (Object.prototype.hasOwnProperty.call(f, 'mode') && f.mode !== 'primary') {
        return null
    }
    let providerID = f.providerID || ''
    if (providerID !== LIMIT_PROVIDER) {
        return null
    }
    let modelID = f.modelID || ''
    let text = reasonOf(f)
    let kind = ''
    if (RE_QUOTA.test(text)) {
        kind = 'quota'
    }
    else if (RE_RATE.test(text) && RE_FREE_MODEL.test(modelID)) {
        kind = 'rate-limit'
    }
    if (kind === '') {
        return null
    }
    return { kind, text, agent, providerID, modelID }
}


/**
 * 由命令列旗標判斷opencode之日誌列是否印到stderr(`--print-logs`或`--print-logs=true`為是，`--print-logs=false`或`--no-print-logs`為否，以最後一個為準；皆無為否)；
 * `--print-logs=<其他值>`(如`=TRUE`、`=1`)不認為是(不監看，退回修前行為；logFlagsToAdd對任何`--print-logs=…`亦不補——呼叫端已自行決定)
 *
 * @param {Array} args 輸入旗標字串陣列
 * @returns {Boolean} 回傳是否印到stderr
 */
function printLogsOn(args) {
    let on = false
    for (let a0 of (Array.isArray(args) ? args : [])) {
        let a = isestr(a0) ? String(a0) : '' //字串包裝物件(getCliArgs以isestr收)亦以原始字串比對(外審terra #15)
        if (a === '--print-logs' || a === '--print-logs=true') {
            on = true
        }
        else if (a === '--print-logs=false' || a === '--no-print-logs') {
            on = false
        }
    }
    return on
}


/**
 * 求應補上之日誌旗標：呼叫端已給任何`--print-logs`形式(含`--print-logs=…`、`--no-print-logs`)者一律不補(其日誌去向與層級由呼叫端決定；任何層級皆含ERROR)；
 * 未給者補`--print-logs`，且未給`--log-level`(含`--log-level=…`)時另補`--log-level ERROR`(只把ERROR列印到stderr；呼叫端已給之層級原樣保留)
 *
 * @param {Array} args 輸入呼叫端旗標字串陣列
 * @returns {Array} 回傳應補上之旗標字串陣列(可為空陣列)
 * @example
 *
 * import { logFlagsToAdd } from './src/opencodeLimit.mjs'
 *
 * console.log(logFlagsToAdd([]))
 * // => ['--print-logs', '--log-level', 'ERROR']
 *
 * console.log(logFlagsToAdd(['--log-level=WARN']))
 * // => ['--print-logs']
 *
 * console.log(logFlagsToAdd(['--print-logs']))
 * // => []
 *
 */
function logFlagsToAdd(args) {
    let a = Array.isArray(args) ? args.filter((v) => isestr(v)).map((v) => String(v)) : [] //字串包裝物件亦以原始字串比對(外審terra #15)
    let hasPrint = a.some((v) => v === '--print-logs' || v.startsWith('--print-logs=') || v === '--no-print-logs')
    if (hasPrint) {
        return []
    }
    let hasLevel = a.some((v) => v === '--log-level' || v.startsWith('--log-level='))
    return ['--print-logs', ...(hasLevel ? [] : ['--log-level', 'ERROR'])]
}


/**
 * 建立stderr逐行監看器：只判完整行(跨區塊之行於收到換行時才判)，每次嘗試至多觸發一次onHit；另保留本次嘗試之ERROR列
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Function} [opt.onHit] 輸入首次判中時之同步回調(hit)=>{}，hit同classifyLimitLine之回傳
 * @returns {Object} 回傳物件，內含push(chunk)、reset()、hit()(本次嘗試判中者或null)、errorLines()(本次嘗試之ERROR列陣列，已去色碼)
 * @example
 *
 * import { createLimitWatch } from './src/opencodeLimit.mjs'
 *
 * let w = createLimitWatch()
 * w.push('x level=ERROR providerID=opencode modelID=beam-free agent=build error.error="AI_APICallError: Rate limit')
 * console.log(w.hit())
 * // => null
 * w.push(' exceeded. Please try again later."\n')
 * console.log(w.hit().kind)
 * // => 'rate-limit'
 *
 */
function createLimitWatch(opt = {}) {
    let onHit = (opt && typeof opt.onHit === 'function') ? opt.onHit : null
    let pending = ''
    let dropping = false //未完之行已超過LINE_MAX: 捨棄至下一個換行
    let hit = null
    let lines = []
    let take = (raw) => {
        if (raw.length > LINE_MAX) {
            return //超長行不論是否跨區塊一律捨棄(與未完行之上限一致; 外審terra #9)
        }
        let line = cleanLine(raw) //先去色碼再比對(色碼可能插在level=與ERROR之間; 外審agy-hydrogen #10)
        if (!/(?:^|\s)level=ERROR(?:\s|$)/.test(line)) {
            return
        }
        lines.push(line.length > KEEP_LINE_MAX ? line.slice(0, KEEP_LINE_MAX) : line)
        if (lines.length > KEEP_LINES) {
            lines.shift()
        }
        if (hit !== null) {
            return
        }
        let c = classifyLimitLine(line)
        if (c !== null) {
            hit = c
            if (onHit !== null) {
                onHit(c)
            }
        }
    }
    let push = (chunk) => {
        if (!isestr(chunk)) {
            return
        }
        let s = pending + chunk
        let parts = s.split('\n')
        pending = parts.pop()
        for (let p of parts) {
            if (dropping) {
                dropping = false //被捨棄之長行至此結束
                continue
            }
            take(p)
        }
        if (pending.length > LINE_MAX) {
            pending = ''
            dropping = true
        }
    }
    let reset = () => {
        pending = ''
        dropping = false
        hit = null
        lines = []
    }
    return {
        push,
        reset,
        hit: () => hit,
        errorLines: () => lines.slice(),
    }
}


/**
 * 由本行程stderr之ERROR列取上游原因(供失敗結果之errorDetail.upstream；日誌印到stderr時日誌檔不寫入，不能再讀檔)：
 * model為`provider/model`形式者只取providerID／modelID相符之列，無`provider/`前綴(或未給)者不比對、取本次全部ERROR列(皆為本行程之列；與讀日誌檔路徑「無前綴不擷取」不同，因日誌檔為多行程共用)；
 * 多筆時優先agent非title者，其次取最後一筆
 *
 * @param {Array} lines 輸入ERROR列字串陣列(已去色碼)
 * @param {Object} [q={}] 輸入查詢物件
 * @param {String} [q.model=''] 輸入`-m`之模型字串
 * @param {Array} [q.secrets=[]] 輸入已知機密值字串陣列(遮罩用)
 * @returns {Object|null} 回傳{ upstream(遮罩並折為單行、至多300字元), agent }；無則null
 */
function upstreamFromLines(lines, q = {}) {
    try {
        let model = (q && isestr(q.model)) ? q.model : ''
        let i = model.indexOf('/')
        let provider = (i > 0 && i < model.length - 1) ? model.slice(0, i) : ''
        let modelID = provider !== '' ? model.slice(i + 1) : ''
        let best = null
        for (let line of (Array.isArray(lines) ? lines : [])) {
            if (!isestr(line)) {
                continue
            }
            let f = parseLogFields(line)
            if (provider !== '' && (f.providerID !== provider || f.modelID !== modelID)) {
                continue
            }
            let text = reasonOf(f)
            if (text.trim() === '') {
                continue
            }
            let agent = f.agent || ''
            if (best === null || best.agent === 'title' || agent !== 'title') {
                best = { text, agent }
            }
        }
        if (best === null) {
            return null
        }
        let flat = maskDiag(best.text, (q && Array.isArray(q.secrets)) ? q.secrets : []).replace(/\s+/g, ' ').trim()
        let upstream = flat.length > UPSTREAM_MAX ? `${flat.slice(0, UPSTREAM_MAX - 1)}…` : flat
        return upstream === '' ? null : { upstream, agent: best.agent }
    }
    catch {
        return null
    }
}


export { LIMIT_PROVIDER, LINE_MAX, KEEP_LINES, parseLogFields, classifyLimitLine, printLogsOn, logFlagsToAdd, createLimitWatch, upstreamFromLines }
