import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import delay from 'wsemi/src/delay.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strdelleft from 'wsemi/src/strdelleft.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import getErrorResult from './getErrorResult.mjs'


// dispatchApiOpenaiCompat.mjs — 以fetch直呼OpenAI相容API(chat/completions)
//
// 【為何需要】opencode CLI調用的deepseek(OpenCode Zen閘道)與agnes-ai本體都是
//   OpenAI相容REST API, 直呼即可免安裝CLI、免預先登入(2026-08-11於本機實測):
//     OpenCode Zen — https://opencode.ai/zen/v1 (金鑰同auth.json之sk-..., 模型名去掉opencode/前綴)
//     Agnes — https://apihub.agnes-ai.com/v1
//   實測四把金鑰直呼皆200; 壞金鑰回401(Zen: `{"type":"AuthError","message":"Invalid API key."}`,
//   Agnes: `{"message":"无效的令牌...","type":"AgnesAI_error"}`)。
//
// 【與CLI轉接器之差異】prompt走HTTP body無命令列長度限制; 錯誤依HTTP狀態碼精確分流
//   (401/403金鑰、429限流、5xx服務端), 不再依賴stderr字串猜測; 純completion無agentic
//   能力(不讀檔不跑指令), 天然無寫檔風險。
//   注意: claude與codex走訂閱帳號登入態而非API金鑰, 無法比照, 仍須CLI轉接器。
//
// 【重試語意對齊execCli】4xx(429除外)為客戶端錯誤不可重試而立即中止;
//   429/5xx/網路錯誤/逾時依maxRetries線性退避重試(間隔retryDelayMs*次數, 上限15000ms)。
//
// 【結果結構對齊execCli】{ ok, stdout, stderr, code, error, durationMs, attempts },
//   stdout為回覆內容、code為HTTP狀態碼(網路錯誤與逾時為null)、逾時error以TIMEOUT開頭、
//   驗證失敗error為OUTPUT_VALIDATION_FAILED——故dispatchAiFallback之失敗分流
//   (TIMEOUT/驗證失敗跳組, 其餘換金鑰)對本轉接器同樣成立, 無須任何修改。


//預設值
let DEFAULT_TIMEOUT_MS = 120000
let DEFAULT_RETRY_DELAY_MS = 5000
let MAX_RETRY_DELAY_MS = 15000


//optTruncate, 裁切失敗結果之內容時於刪節號後標註原始總長度(同execCli)
let optTruncate = {
    funWithMsg: (str) => `(truncated, total ${str.length} chars)`,
}


/**
 * 建立驗證函式(規則語法同execCli之validate)
 *
 * @param {String|Function} rule 輸入驗證規則字串('nonempty'、'json'、'min:100', 逗號可串接)或自訂函式
 * @returns {Function|null} 回傳驗證函式，無有效規則回傳null
 */
function buildValidator(rule) {

    //自訂函式直接使用
    if (isfun(rule)) {
        return rule
    }

    //check
    if (!isestr(rule)) {
        return null
    }

    //checks
    let checks = rule.split(',').map((r) => r.trim()).filter(Boolean)
    if (checks.length === 0) {
        return null
    }

    return (stdout) => {
        for (let check of checks) {

            if (check === 'nonempty') {
                if (!isestr(stdout) || stdout.trim() === '') {
                    return false
                }
            }

            else if (check === 'json') {
                try {
                    JSON.parse(stdout)
                }
                catch {
                    return false
                }
            }

            else if (strleft(check, 4) === 'min:') {

                //規則本身無效(如min:abc) → 視為驗證失敗, 不靜默跳過
                let smin = strdelleft(check, 4)
                if (!isnum(smin)) {
                    return false
                }

                let min = cint(smin)
                if (!isestr(stdout) || stdout.length < min) {
                    return false
                }
            }

        }
        return true
    }
}


/**
 * 單次HTTP呼叫(內部使用, 不含重試邏輯)
 *
 * @param {String} url 輸入完整端點網址字串
 * @param {Object} headers 輸入請求標頭物件
 * @param {Object} body 輸入請求本體物件
 * @param {Number} timeoutMs 輸入逾時毫秒
 * @param {Function|null} validator 輸入驗證函式
 * @returns {Promise} 回傳Promise，resolve回傳結果物件
 */
async function callOnce(url, headers, body, timeoutMs, validator) {

    let t0 = Date.now()

    //AbortController, 逾時中止(含回應本體之串流讀取)
    let controller = new AbortController()
    let timer = setTimeout(() => {
        controller.abort()
    }, timeoutMs)

    let res = null
    let txt = ''
    try {
        res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        txt = await res.text()
    }
    catch (err) {
        clearTimeout(timer)
        let durationMs = Date.now() - t0

        //逾時, error以TIMEOUT開頭令dispatchAiFallback視為與金鑰無關而跳組
        if (err.name === 'AbortError') {
            return {
                ok: false,
                stdout: '',
                stderr: '',
                code: null,
                error: `TIMEOUT after ${timeoutMs / 1000}s`,
                durationMs,
            }
        }

        //網路層錯誤(DNS/連線拒絕等)
        let cause = get(err, 'cause.code', '') || err.message
        return {
            ok: false,
            stdout: '',
            stderr: '',
            code: null,
            error: `FETCH_ERROR: ${cause}`,
            durationMs,
        }
    }
    clearTimeout(timer)

    let durationMs = Date.now() - t0

    //HTTP非2xx, 原始回應本體放stderr供除錯與分類
    if (!res.ok) {
        return {
            ok: false,
            stdout: '',
            stderr: strTruncate(txt, 1000, optTruncate),
            code: res.status,
            error: `HTTP ${res.status}`,
            durationMs,
        }
    }

    //取出choices[0].message.content
    let content = null
    try {
        let j = JSON.parse(txt)
        content = get(j, 'choices.0.message.content', null)
    }
    catch {}
    if (content === null || content === undefined) {
        return {
            ok: false,
            stdout: '',
            stderr: strTruncate(txt, 500, optTruncate),
            code: res.status,
            error: 'INVALID_RESPONSE: missing choices[0].message.content',
            durationMs,
        }
    }
    if (typeof content !== 'string') {
        content = JSON.stringify(content) //少數閘道回array形態
    }

    //validator, error與execCli一致令dispatchAiFallback可統一分流
    if (validator && !validator(content)) {
        return {
            ok: false,
            stdout: strTruncate(content, 500, optTruncate),
            stderr: '',
            code: res.status,
            error: 'OUTPUT_VALIDATION_FAILED',
            durationMs,
        }
    }

    return {
        ok: true,
        stdout: content,
        stderr: '',
        code: res.status,
        error: '',
        durationMs,
    }
}


//本轉接器不使用execCli, 全部設定鍵自理, 未知鍵一律忽略


/**
 * 以fetch直呼OpenAI相容API(chat/completions)呼叫AI模型
 *
 * 特點：
 * 免安裝CLI、免預先登入，給baseURL＋key＋model即可呼叫(如OpenCode Zen、Agnes等OpenAI相容閘道)；
 * prompt走HTTP body，無命令列長度限制；
 * 錯誤依HTTP狀態碼分流：4xx(429除外)為客戶端錯誤不重試，429/5xx/網路錯誤/逾時依maxRetries線性退避重試；
 * 結果結構與逾時/驗證失敗之error字樣對齊execCli，可直接作為dispatchAi與dispatchAiFallback之kind('api-openai-compat')使用；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，作為user訊息置於HTTP body
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} opt.baseURL 輸入API基底網址字串，例如'https://opencode.ai/zen/v1'、'https://apihub.agnes-ai.com/v1'，將於尾端接上/chat/completions
 * @param {String} opt.model 輸入模型ID字串，例如'deepseek-v4-flash-free'(Zen之模型名不帶opencode/前綴)、'agnes-2.0-flash'
 * @param {String} [opt.key=''] 輸入API key字串，以Bearer置於Authorization標頭，預設''代表不帶認證標頭
 * @param {String} [opt.system=''] 輸入system提示詞字串，將以system角色置於messages首位，預設''代表不帶
 * @param {Object} [opt.body={}] 輸入額外請求本體物件(如temperature、max_tokens、response_format)，將併入預設body(同名鍵以此為準)，預設{}
 * @param {Object} [opt.headers={}] 輸入額外請求標頭物件，預設{}
 * @param {Number} [opt.timeoutMs=120000] 輸入逾時毫秒正整數，逾時將中止請求(含回應串流讀取)，預設120000
 * @param {String|Function} [opt.validate=undefined] 輸入回覆內容驗證規則字串或自訂驗證函數，規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接，預設undefined代表不驗證
 * @param {Number} [opt.maxRetries=0] 輸入失敗後最大重試次數非負整數，4xx(429除外)不重試，預設0
 * @param {Number} [opt.retryDelayMs=5000] 輸入重試間隔毫秒正整數，實際間隔為retryDelayMs乘以重試次數且上限15000ms，預設5000
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(回覆內容字串)、stderr(失敗時之原始回應本體)、code(HTTP狀態碼，網路錯誤與逾時為null)、error(錯誤訊息字串，成功時為空字串)、durationMs(耗時毫秒)、attempts(實際嘗試次數)，本函數不會reject
 * @example
 * //need network, no cli required
 *
 * import dispatchApiOpenaiCompat from './src/dispatchApiOpenaiCompat.mjs'
 *
 * let test = async () => {
 *
 *     //OpenCode Zen(即opencode CLI之自家閘道), 模型名不帶opencode/前綴
 *     let r1 = await dispatchApiOpenaiCompat('請只回覆兩個字：完成', {
 *         baseURL: 'https://opencode.ai/zen/v1',
 *         key: 'sk-xxxxxx',
 *         model: 'deepseek-v4-flash-free',
 *     })
 *     console.log(r1.ok, r1.stdout.trim())
 *     // => true 完成
 *
 *     //Agnes
 *     let r2 = await dispatchApiOpenaiCompat('請只回覆兩個字：完成', {
 *         baseURL: 'https://apihub.agnes-ai.com/v1',
 *         key: 'sk-xxxxxx',
 *         model: 'agnes-2.0-flash',
 *     })
 *     console.log(r2.ok, r2.stdout.trim())
 *     // => true 完成
 *
 *     let re = await dispatchApiOpenaiCompat('abc', { baseURL: 'https://opencode.ai/zen/v1', key: 'sk-bad', model: 'deepseek-v4-flash-free' })
 *     console.log(re.ok, re.code, re.error)
 *     // => false 401 HTTP 401
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchApiOpenaiCompat(prompt, opt = {}) {

    //check prompt, 不reject故以錯誤結果物件回報
    if (!isestr(prompt)) {
        return getErrorResult('prompt must be a non-empty string')
    }

    //baseURL必填, API無CLI可回退
    let baseURL = get(opt, 'baseURL', null)
    if (!isestr(baseURL)) {
        return getErrorResult('baseURL must be a non-empty string')
    }

    //model必填, chat/completions無預設模型
    let model = get(opt, 'model', null)
    if (!isestr(model)) {
        return getErrorResult('model must be a non-empty string')
    }

    //key, 無效代表不帶認證標頭(部分閘道免認證)
    let key = get(opt, 'key', null)

    //system
    let system = get(opt, 'system', null)

    //bodyExtra
    let bodyExtra = get(opt, 'body', null)
    if (!isobj(bodyExtra)) {
        bodyExtra = {}
    }

    //headersExtra
    let headersExtra = get(opt, 'headers', null)
    if (!isobj(headersExtra)) {
        headersExtra = {}
    }

    //timeoutMs
    let timeoutMs = get(opt, 'timeoutMs', null)
    if (!ispint(timeoutMs)) {
        timeoutMs = DEFAULT_TIMEOUT_MS
    }
    else {
        timeoutMs = cint(timeoutMs)
    }

    //maxRetries
    let maxRetries = get(opt, 'maxRetries', null)
    if (!isp0int(maxRetries)) {
        maxRetries = 0
    }
    else {
        maxRetries = cint(maxRetries)
    }

    //retryDelayMs
    let retryDelayMs = get(opt, 'retryDelayMs', null)
    if (!ispint(retryDelayMs)) {
        retryDelayMs = DEFAULT_RETRY_DELAY_MS
    }
    else {
        retryDelayMs = cint(retryDelayMs)
    }

    //validator
    let validator = buildValidator(get(opt, 'validate', null))

    //url, baseURL尾端斜線正規化後接上端點
    let url = baseURL.replace(/\/+$/, '') + '/chat/completions'

    //messages
    let messages = []
    if (isestr(system)) {
        messages.push({ role: 'system', content: system })
    }
    messages.push({ role: 'user', content: prompt })

    //body, 額外鍵以bodyExtra為準(可覆寫temperature等, 覆寫messages屬進階用法)
    let body = { model, messages, ...bodyExtra }

    //headers
    let headers = { 'Content-Type': 'application/json', ...headersExtra }
    if (isestr(key)) {
        headers['Authorization'] = `Bearer ${key}`
    }

    let lastResult = null
    let totalAttempts = 0

    for (let attempt = 0; attempt <= maxRetries; attempt++) {

        //delay, 重試間隔隨次數遞增, 上限15000ms(同execCli)
        if (attempt > 0) {
            await delay(Math.min(retryDelayMs * attempt, MAX_RETRY_DELAY_MS))
        }

        lastResult = await callOnce(url, headers, body, timeoutMs, validator)
        totalAttempts = attempt + 1

        if (lastResult.ok) {
            lastResult.attempts = totalAttempts
            return lastResult
        }

        //不可重試: 4xx(429除外)為客戶端錯誤, 重試無意義
        let c = lastResult.code
        if (isnum(c) && c >= 400 && c < 500 && c !== 429) {
            break
        }

    }

    lastResult.attempts = totalAttempts

    return lastResult
}


export default dispatchApiOpenaiCompat
