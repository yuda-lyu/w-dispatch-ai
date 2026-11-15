import { execFile } from 'node:child_process'


// killProcessTree.mjs — 樹狀終止子行程(本套件主動終止用; 2026-11-15 wda156, Gitea #156)
//
// 【為何不直接用wsemi之execProcessKillPid】execCli逾時樹殺用的execProcessKillPid經tree-kill:
//   ①Windows以`child_process.exec('taskkill /pid N /T /F')`執行, 未設windowsHide——背景行程(無主控台者、pm2、排程)呼叫時會閃出主控台視窗;
//   ②非Windows以spawn('ps'…)／spawn('pgrep'…)列舉子孫, 該子行程只監聽close、未監聽error——ps／pgrep不存在時之非同步ENOENT成為未處理之'error'事件,
//     令呼叫端行程崩潰(tree-kill 1.2.2 index.js; 外審terra #4)。
//   本套件之規範為每一處child_process呼叫皆設windowsHide: true, 且主動終止不得令呼叫端崩潰, 故自寫:
//   Windows: execFile('taskkill', ['/F', '/T', '/PID', pid], { windowsHide: true })(不經shell; 同cliSpawnGate以名稱呼叫tasklist之寫法)。
//   其他平台: execFile('ps', ['-A', '-o', 'pid=,ppid='])一次列出全部行程之父子關係(錯誤由callback承接, 不會成為未處理事件), 自根pid廣度優先收集子孫,
//     由深至淺逐一process.kill(pid, 'SIGKILL'), 最後終止根; ps失敗(不存在、選項不支援、逾時)則只終止根(以ok與msg照實回報)。
//   限制: ①子孫之列舉發生在終止當下, 列舉與終止之間新生之行程、或已脫離父子關係者(重新指定父行程之daemon、setsid後被收養者)不在樹內, 不會被終止;
//   ②ps不可用時只終止根; ③本套件之CI與實測皆在Windows, 非Windows路徑僅以注入之execFile／kill單元測試, 未於真實Linux／macOS實測。
// 【永不reject】回傳{ ok, how, msg }; 失敗(行程已不存在、權限不足、指令不可用)皆以ok:false回報, 呼叫端可忽略——子行程若仍未結束, execCli之逾時樹殺仍為最後防線。


//taskkill／ps之逾時(毫秒), 防其本身懸置
let TOOL_TIMEOUT_MS = 15000


/**
 * 由`ps -A -o pid=,ppid=`之輸出收集根pid之子孫(廣度優先；回傳由深至淺之順序，不含根)
 *
 * @param {String} text 輸入ps輸出文字(每行「pid ppid」)
 * @param {Number} root 輸入根pid
 * @returns {Array} 回傳子孫pid陣列(由深至淺)
 * @example
 *
 * import { descendantsOf } from './src/killProcessTree.mjs'
 *
 * console.log(descendantsOf('1 0\n10 1\n11 10\n12 10\n20 1\n', 10))
 * // => [12, 11]
 *
 */
function descendantsOf(text, root) {
    let kids = new Map()
    for (let line of String(text).split('\n')) {
        let m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
        if (!m) {
            continue
        }
        let pid = Number(m[1])
        let ppid = Number(m[2])
        if (!kids.has(ppid)) {
            kids.set(ppid, [])
        }
        kids.get(ppid).push(pid)
    }
    let out = []
    let seen = new Set([root])
    let q = [root]
    while (q.length > 0) {
        let p = q.shift()
        for (let c of (kids.get(p) || [])) {
            if (!seen.has(c)) {
                seen.add(c)
                out.push(c)
                q.push(c)
            }
        }
    }
    return out.reverse()
}


/**
 * 樹狀終止指定pid之行程及其子孫行程：Windows以`taskkill /F /T /PID <pid>`，其他平台以`ps -A -o pid=,ppid=`列舉後由深至淺逐一SIGKILL(皆以execFile、windowsHide: true、不經shell)
 *
 * @param {Number} pid 輸入行程pid正整數
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.platform=process.platform] 輸入平台字串(測試用)
 * @param {Function} [opt.execFile=child_process.execFile] 輸入execFile實作(測試用，用以斷言參數與選項或模擬指令不存在)
 * @param {Function} [opt.kill=process.kill] 輸入非Windows之終止實作(pid, signal)=>{}(測試用)
 * @returns {Promise} 回傳Promise，resolve回傳物件{ ok(布林值), how('taskkill'、'ps-tree'、'kill-root'或'none'), msg(訊息字串) }；pid無效時ok為false且how為'none'；不會reject
 * @example
 * //need test in nodejs
 *
 * import killProcessTree from './src/killProcessTree.mjs'
 *
 * let r = await killProcessTree(-1)
 * console.log(r)
 * // => { ok: false, how: 'none', msg: 'invalid pid' }
 *
 */
function killProcessTree(pid, opt = {}) {
    return new Promise((resolve) => {
        try {
            let n = Number(pid)
            if (!Number.isInteger(n) || n <= 0) {
                resolve({ ok: false, how: 'none', msg: 'invalid pid' })
                return
            }
            let platform = (opt && typeof opt.platform === 'string') ? opt.platform : process.platform
            let ef = (opt && typeof opt.execFile === 'function') ? opt.execFile : execFile
            let o = { windowsHide: true, timeout: TOOL_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 }
            if (platform === 'win32') {
                ef('taskkill', ['/F', '/T', '/PID', String(n)], o, (err) => {
                    if (err) {
                        resolve({ ok: false, how: 'taskkill', msg: String((err && err.message) || err) })
                        return
                    }
                    resolve({ ok: true, how: 'taskkill', msg: `pid[${n}] killed` })
                })
                return
            }
            let kill = (opt && typeof opt.kill === 'function') ? opt.kill : process.kill.bind(process)
            ef('ps', ['-A', '-o', 'pid=,ppid='], o, (err, stdout) => {
                let desc = []
                if (!err) {
                    try {
                        desc = descendantsOf(String(stdout || ''), n)
                    }
                    catch {
                        desc = []
                    }
                }
                for (let p of desc) {
                    try {
                        kill(p, 'SIGKILL')
                    }
                    catch {} //子孫可能已結束
                }
                let how = err ? 'kill-root' : 'ps-tree'
                try {
                    kill(n, 'SIGKILL')
                    resolve({ ok: true, how, msg: `pid[${n}] killed${err ? ' (ps unavailable, root only)' : ` with ${desc.length} descendant(s)`}` })
                }
                catch (e) {
                    resolve({ ok: false, how, msg: String((e && e.message) || e) })
                }
            })
        }
        catch (err) {
            resolve({ ok: false, how: 'none', msg: String((err && err.message) || err) })
        }
    })
}


export default killProcessTree
export { descendantsOf }
