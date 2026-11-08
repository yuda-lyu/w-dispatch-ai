import fs from 'fs'
import os from 'os'
import path from 'path'
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import { maskDiag, upstreamClassOf } from './failureDiag.mjs'


// opencodeUpstream.mjs — opencode失敗時對時擷取其日誌檔中的上游錯誤原因(2026-11-08 da110, Gitea #110)
//
// 【為何需要】opencode遇供應商錯誤時, stderr常只有`Unexpected server error. Check server logs for details.`之類通稱字樣(或根本不帶, 例免費層429令run不結束而以逾時回報),
//   真因(`[overloaded]`、`[prefill_cap_refused]`、`Free usage limit reached`、`Model access is disabled`…)只在opencode日誌檔, 且時戳為UTC、須人工對時。
//
// 【日誌位置與格式(2026-11-08本機實查, opencode 1.19.5, Windows)】
//   路徑: `<XDG_DATA_HOME 或 ~/.local/share>/opencode/log/opencode.log`(Windows亦為使用者目錄下`.local\share`, 與auth.json之資料夾同源, 見dispatchOpencode檔頭;
//         單一累積檔, 實查6MB／約3萬行起於2026-07-06; 找不到opencode.log時退用該資料夾內最新之*.log, 以涵蓋依啟動時間分檔之版本)。
//   格式: 每行一筆, 空白分隔之key=value; 字串值以雙引號包起並以反斜線跳脫:
//     timestamp=2026-11-05T08:51:51.776Z level=ERROR run=0ebec445 message="stream error" providerID=opencode modelID=beam-free session.id=ses_… small=false agent=build mode=primary error.error="AI_APICallError: Free usage limit reached. …"
//   原因鍵為`error.error`(非建議檔所寫之`error=`); 同一次失敗常見兩筆: agent=build(實際請求)與agent=title(標題小模型的附帶請求, 訊息可為`AI_RetryError: Failed after 3 attempts. Last error: …`);
//   行序不嚴格依時戳(實查有相差數百毫秒之倒序), 故不假設有序, 逐行依時戳篩選。
//
// 【時窗】失敗時刻tFail(讀檔當下)往前往後各60秒; 失敗耗時超過60秒者(例逾時)下界延至該次嘗試的起點(tFail − durationMs), 否則慢失敗之原因行(發生於嘗試之初)會落在時窗之外——
//   免費層429即是如此(run不結束, 原因行在起點後約1秒, 失敗在逾時才回報)。再加2秒下界寬限(起點為事後由耗時推算)。
// 【相符與擇一】providerID與modelID須與`-m provider/model`相符(model無provider前綴者無從比對, 不擷取); 多筆相符時優先agent非title者, 其次取時戳最晚者(重試後之最終原因)。
// 【只在失敗時讀一次、讀檔失敗不拋】僅讀檔尾UPSTREAM_TAIL_BYTES(2MiB)並於記憶體內篩選; 不存在、不可讀、無相符者回null; 任何例外皆吞掉。擷取內容同樣經maskDiag遮罩。


//讀檔尾位元組數與擷取原因之最大字元數
let UPSTREAM_TAIL_BYTES = 2 * 1024 * 1024
let UPSTREAM_MAX = 300

//時窗: 失敗時刻前後各60秒; 下界寬限2秒
let WINDOW_MS = 60 * 1000
let SLACK_MS = 2000


/**
 * 解出opencode日誌檔路徑：opt.file給了非空字串即用之；否則`<XDG_DATA_HOME或~/.local/share>/opencode/log/opencode.log`(XDG_DATA_HOME先取env再取process.env)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.file=''] 輸入日誌檔路徑字串，預設''代表依平台推得
 * @param {Object} [opt.env=null] 輸入子進程環境變數物件(取其XDG_DATA_HOME)，預設null
 * @returns {String} 回傳日誌檔絕對路徑字串
 * @example
 *
 * import { getOpencodeLogPath } from './src/opencodeUpstream.mjs'
 *
 * console.log(getOpencodeLogPath({ file: 'x/y.log' }).endsWith('y.log'))
 * // => true
 *
 */
function getOpencodeLogPath(opt = {}) {
    let file = get(opt, 'file', '')
    if (isestr(file) && file.trim() !== '') {
        return path.resolve(file)
    }
    let xdg = get(opt, 'env.XDG_DATA_HOME', '')
    if (!isestr(xdg) || xdg === '') {
        xdg = isestr(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : ''
    }
    let dataHome = xdg !== '' ? xdg : path.join(os.homedir(), '.local', 'share')
    return path.join(dataHome, 'opencode', 'log', 'opencode.log')
}


/**
 * 取日誌行中某鍵之值(雙引號字串解跳脫，否則取至下一空白)
 *
 * @param {String} line 輸入日誌行
 * @param {String} key 輸入鍵名(如`error.error`)
 * @returns {String} 回傳值字串，無此鍵為空字串
 */
function valueOf(line, key) {
    let k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let m = new RegExp(`(?:^|\\s)${k}=(?:"((?:[^"\\\\]|\\\\.)*)"|(\\S+))`).exec(line)
    if (!m) {
        return ''
    }
    if (m[1] !== undefined) {
        try {
            return JSON.parse(`"${m[1]}"`)
        }
        catch {
            return m[1].replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n')
        }
    }
    return m[2]
}


/**
 * 由日誌行陣列取時窗內providerID／modelID相符之ERROR行的上游原因(純函數，不讀檔)
 *
 * @param {Array} lines 輸入日誌行字串陣列(不必有序)
 * @param {Object} q 輸入查詢物件
 * @param {String} q.provider 輸入providerID
 * @param {String} q.modelID 輸入modelID
 * @param {Number} q.fromMs 輸入時窗下界(epoch毫秒，含)
 * @param {Number} q.toMs 輸入時窗上界(epoch毫秒，含)
 * @returns {Object} 回傳物件{ text, timestamp, agent }(text為原因原文)；無相符者回傳null
 * @example
 *
 * import { pickUpstream } from './src/opencodeUpstream.mjs'
 *
 * let line = 'timestamp=2026-11-05T08:51:51.776Z level=ERROR run=a message="stream error" providerID=opencode modelID=beam-free agent=build error.error="AI_APICallError: [overloaded]"'
 * console.log(pickUpstream([line], { provider: 'opencode', modelID: 'beam-free', fromMs: Date.parse('2026-11-05T08:51:00Z'), toMs: Date.parse('2026-11-05T08:52:00Z') }).text)
 * // => 'AI_APICallError: [overloaded]'
 *
 */
function pickUpstream(lines, q) {
    let best = null
    for (let raw of lines) {
        if (!isestr(raw) || !raw.includes('level=ERROR')) {
            continue
        }
        let line = raw.replace(/\r$/, '')
        let mt = /^timestamp=(\S+)\s+level=ERROR\b/.exec(line)
        if (!mt) {
            continue
        }
        let t = Date.parse(mt[1])
        if (!Number.isFinite(t) || t < q.fromMs || t > q.toMs) {
            continue
        }
        if (valueOf(line, 'providerID') !== q.provider || valueOf(line, 'modelID') !== q.modelID) {
            continue
        }
        let text = valueOf(line, 'error.error') || valueOf(line, 'error')
        if (text === '') {
            let msg = valueOf(line, 'message')
            text = (msg !== 'stream error') ? msg : ''
        }
        if (text.trim() === '') {
            continue
        }
        let agent = valueOf(line, 'agent')
        let cand = { text, timestamp: mt[1], agent, t }
        let better = best === null ||
            ((best.agent === 'title') && (cand.agent !== 'title')) ||
            ((best.agent === 'title') === (cand.agent === 'title') && cand.t > best.t)
        if (better) {
            best = cand
        }
    }
    return best === null ? null : { text: best.text, timestamp: best.timestamp, agent: best.agent }
}


/**
 * 讀檔尾(至多maxBytes位元組)並切成行(檔案大於maxBytes時丟棄開頭的不完整行)
 *
 * @param {String} file 輸入檔案路徑
 * @param {Number} maxBytes 輸入最大位元組數
 * @returns {Promise} 回傳Promise，resolve回傳行字串陣列；檔案不存在或不可讀時reject
 */
async function readTailLines(file, maxBytes) {
    let fh = await fs.promises.open(file, 'r')
    try {
        let st = await fh.stat()
        let len = Math.min(st.size, maxBytes)
        let pos = st.size - len
        let buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, pos)
        let lines = buf.toString('utf8').split('\n')
        if (pos > 0) {
            lines.shift()
        }
        return lines
    }
    finally {
        await fh.close()
    }
}


/**
 * 失敗後擷取opencode日誌中的上游原因：讀日誌檔尾一次，取失敗時窗內providerID／modelID相符之ERROR行的原因；找不到、讀檔失敗、無法比對皆回傳null，永不拋錯
 *
 * @param {Object} q 輸入查詢物件
 * @param {String} q.model 輸入`-m`之模型字串，須為`<providerID>/<modelID>`形式(無前綴者無從比對，回傳null)
 * @param {Number} q.tFailMs 輸入失敗時刻(epoch毫秒)
 * @param {Number} q.durationMs 輸入該次嘗試耗時毫秒
 * @param {String} [q.file=''] 輸入日誌檔路徑，預設''代表依平台推得
 * @param {Object} [q.env=null] 輸入子進程環境變數物件(取XDG_DATA_HOME)
 * @param {Array} [q.secrets=[]] 輸入已知機密值字串陣列(擷取內容遮罩用)
 * @returns {Promise} 回傳Promise，resolve回傳物件{ upstream(遮罩並折為單行、至多300字元之原因字串), class(簡短分類，可為空字串), timestamp, file }；無則null；不會reject
 * @example
 * //need opencode.log of a failed run
 *
 * import { readOpencodeUpstream } from './src/opencodeUpstream.mjs'
 *
 * let r = await readOpencodeUpstream({ model: 'opencode-go/deepseek-v4-pro', tFailMs: Date.now(), durationMs: 1500 })
 * console.log(r === null || typeof r.upstream === 'string')
 * // => true
 *
 */
async function readOpencodeUpstream(q) {
    try {
        let model = get(q, 'model', '')
        if (!isestr(model)) {
            return null
        }
        let i = model.indexOf('/')
        if (i <= 0 || i >= model.length - 1) {
            return null
        }
        let provider = model.slice(0, i)
        let modelID = model.slice(i + 1)
        let tFail = get(q, 'tFailMs', Date.now())
        let dur = Math.max(Number(get(q, 'durationMs', 0)) || 0, 0)
        let fromMs = Math.min(tFail - WINDOW_MS, tFail - dur) - SLACK_MS
        let toMs = tFail + WINDOW_MS
        let file = getOpencodeLogPath({ file: get(q, 'file', ''), env: get(q, 'env', null) })
        let lines = null
        try {
            lines = await readTailLines(file, UPSTREAM_TAIL_BYTES)
        }
        catch {
            lines = null
        }

        //預設路徑找不到opencode.log時, 退用同資料夾內最新之*.log(依啟動時間分檔之版本); 呼叫端明給路徑者不退用
        if (lines === null && !(isestr(get(q, 'file', '')) && q.file.trim() !== '')) {
            let dir = path.dirname(file)
            let names = await fs.promises.readdir(dir)
            let best = null
            for (let n of names.filter((v) => v.endsWith('.log'))) {
                let st = await fs.promises.stat(path.join(dir, n))
                if (best === null || st.mtimeMs > best.mtimeMs) {
                    best = { name: n, mtimeMs: st.mtimeMs }
                }
            }
            if (best !== null) {
                file = path.join(dir, best.name)
                lines = await readTailLines(file, UPSTREAM_TAIL_BYTES)
            }
        }
        if (lines === null) {
            return null
        }
        let p = pickUpstream(lines, { provider, modelID, fromMs, toMs })
        if (p === null) {
            return null
        }
        let secrets = get(q, 'secrets', [])
        let flat = maskDiag(p.text, secrets).replace(/\s+/g, ' ').trim()
        let upstream = flat.length > UPSTREAM_MAX ? `${flat.slice(0, UPSTREAM_MAX - 1)}…` : flat
        if (upstream === '') {
            return null
        }
        return { upstream, class: upstreamClassOf(upstream), timestamp: p.timestamp, file }
    }
    catch {
        return null
    }
}


export { UPSTREAM_TAIL_BYTES, UPSTREAM_MAX, getOpencodeLogPath, pickUpstream, readOpencodeUpstream }
