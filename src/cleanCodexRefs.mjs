import { execFile } from 'node:child_process'
import isestr from 'wsemi/src/isestr.mjs'


// cleanCodexRefs.mjs — 派工結束後清除Codex於目標repo留下之refs/codex/*(2026-11-22 排程第388項②; 帳本R-CODEX-3)
//
// 【現象(2026-11-10, 使用端連動提交時)】Codex CLI於其工作目錄所在之git repo留下`refs/codex/turn-diffs/checkpoints/*`(loose ref), 其中有指向不存在物件者,
//   之後該repo之`git gc`報`fatal: bad object …`、`failed to run repack`、`task 'gc' failed`(不影響提交與推送, 但auto gc反覆失敗)。
//   2026-11-22以git 2.53.0實測重現: 手寫loose ref指向不存在之物件後, `git gc`報`error: <ref> does not point to a valid object!`、`fatal: bad object <ref>`、`fatal: failed to run repack`;
//   `git for-each-ref refs/codex/`仍列出該ref(狀態0、無stderr), `git update-ref -d <ref>`可刪(`git show-ref`則報bad ref而中止, 故不用)。
// 【為何用清除而非設定】2026-11-22以Codex 0.167.1查證: `codex features list`無任何關閉turn-diff檢查點之旗標(僅cwd_relative_turn_diffs, 屬顯示路徑, 預設關);
//   執行檔字串中亦無`refs/codex/turn-diffs`(僅`refs/codex/curated-sync`, 屬外掛同步)——該檢查點ref之來源與開關無從在本機確認, 故不依賴設定, 於收尾時清除。
// 【清除範圍(只刪refs/codex/之下, 不碰其他ref)】派工前先列出refs/codex/下既有之ref(基準), 派工後只刪「基準中不存在」者(本次派工新留下者):
//   使用者自己或其他進行中之Codex工作階段(如互動TUI)先前建立之ref不動; 前綴須為`refs/codex/`(含結尾斜線), `refs/codex-x/`、`refs/heads/codex/`等不在其內。
//   基準非Set(缺基準)者一律不刪(removed 0)。
// 【最佳努力】git不存在、cwd不是git repo、命令逾時或失敗一律忽略(不影響派工結果、不拋錯); git子行程皆windowsHide、逾時上限;
//   子行程之環境移除GIT_DIR／GIT_WORK_TREE／GIT_INDEX_FILE(於git hook內執行時其會令git作用於hook所屬之repo而非cwd所在之repo)。
//   已知限制: extraArgs帶`-C`／`--cd`令Codex作用於他目錄者, 清除之repo仍為本轉接器之cwd所在者。


//ref前綴(含結尾斜線)
let REF_PREFIX = 'refs/codex/'

//列舉之逾時毫秒(派工前之基準列舉在runExecCli之前進行, 不計入該次之timeoutMs與budgetMs, 故取短)與刪除之逾時毫秒
let LIST_TIMEOUT_MS = 5000
let DELETE_TIMEOUT_MS = 15000

//一次最多刪除之ref個數(異常大量時之上限, 剩餘者留待下次)
let MAX_DELETE = 2000

//移除之git環境變數(令git依cwd尋找repo)
let DROP_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']


/**
 * 取子行程環境(移除會改變git所選repo之變數)
 *
 * @returns {Object} 回傳環境物件
 */
function gitEnv() {
    let env = { ...process.env }
    for (let k of Object.keys(env)) {
        if (DROP_ENV.includes(k.toUpperCase())) {
            delete env[k]
        }
    }
    return env
}


/**
 * 執行單一git命令(最佳努力: 失敗、逾時皆回ok為false，不拋錯)
 *
 * @param {Array} args 輸入git參數陣列
 * @param {String} cwd 輸入工作目錄
 * @param {Number} timeoutMs 輸入逾時毫秒
 * @param {String} [input=''] 輸入經stdin送入之文字，空字串代表不送
 * @returns {Promise} 回傳Promise，resolve為{ ok, stdout }
 */
function runGit(args, cwd, timeoutMs, input = '') {
    return new Promise((resolve) => {
        try {
            let child = execFile('git', args, { cwd, env: gitEnv(), windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
                if (err) {
                    resolve({ ok: false, stdout: '' })
                    return
                }
                resolve({ ok: true, stdout: String(stdout || '') })
            })
            if (input !== '') {
                child.stdin.on('error', () => {}) //git提前結束時之EPIPE不外拋
                child.stdin.end(input)
            }
        }
        catch {
            resolve({ ok: false, stdout: '' })
        }
    })
}


/**
 * 列出repo內refs/codex/下之全部ref名稱(cwd不是git repo、git不存在或失敗時ok為false)
 *
 * @param {String} cwd 輸入工作目錄(須為git repo內之目錄)
 * @returns {Promise} 回傳Promise，resolve為{ ok, refs }(refs為Set，內為完整ref名稱)
 * @example
 *
 * import { listCodexRefs } from './src/cleanCodexRefs.mjs'
 *
 * let r = await listCodexRefs(process.cwd())
 * console.log(r.ok, [...r.refs])
 * // => true []
 *
 */
async function listCodexRefs(cwd) {
    if (!isestr(cwd)) {
        return { ok: false, refs: new Set() }
    }
    let g = await runGit(['for-each-ref', '--format=%(refname)', REF_PREFIX], cwd, LIST_TIMEOUT_MS)
    if (!g.ok) {
        return { ok: false, refs: new Set() }
    }
    let refs = new Set()
    for (let line of g.stdout.split('\n')) {
        let s = line.replace(/\r$/, '').trim()
        if (s.startsWith(REF_PREFIX) && s.length > REF_PREFIX.length) {
            refs.add(s)
        }
    }
    return { ok: true, refs }
}


/**
 * 刪除refs/codex/下「基準之後新出現」之ref(只刪前綴為refs/codex/者, 不碰其他ref; 基準須為Set, 否則不刪)
 *
 * 先以`git update-ref --stdin`一次交易刪除(`delete <ref>`逐行); 交易失敗(如其中一個ref同時被他行程刪除)時退回逐一`git update-ref -d`
 *
 * @param {String} cwd 輸入工作目錄(須為git repo內之目錄)
 * @param {Set} before 輸入基準(派工前listCodexRefs所得之refs)
 * @returns {Promise} 回傳Promise，resolve為{ removed }(實際刪除之個數)
 * @example
 *
 * import { listCodexRefs, removeNewCodexRefs } from './src/cleanCodexRefs.mjs'
 *
 * let b = await listCodexRefs(process.cwd())
 * // ...派工...
 * let r = await removeNewCodexRefs(process.cwd(), b.refs)
 * console.log(r.removed)
 * // => 0
 *
 */
async function removeNewCodexRefs(cwd, before) {
    if (!(before instanceof Set)) {
        return { removed: 0 } //缺基準: 無從分辨哪些為本次派工新留下者, 一律不刪
    }
    let now = await listCodexRefs(cwd)
    if (!now.ok) {
        return { removed: 0 }
    }
    let targets = [...now.refs].filter((ref) => ref.startsWith(REF_PREFIX) && !before.has(ref)).slice(0, MAX_DELETE)
    if (targets.length === 0) {
        return { removed: 0 }
    }

    //一次交易刪除; ref名依git之ref名規則不含空白、換行與控制字元, 故逐行一個delete指令安全
    let batch = await runGit(['update-ref', '--stdin'], cwd, DELETE_TIMEOUT_MS, `${targets.map((ref) => `delete ${ref}`).join('\n')}\n`)
    if (batch.ok) {
        return { removed: targets.length }
    }

    //退回逐一刪除
    let removed = 0
    for (let ref of targets) {
        let g = await runGit(['update-ref', '-d', ref], cwd, DELETE_TIMEOUT_MS)
        if (g.ok) {
            removed++
        }
    }
    return { removed }
}


export { listCodexRefs, removeNewCodexRefs, REF_PREFIX }
