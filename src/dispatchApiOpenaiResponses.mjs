import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import cint from 'wsemi/src/cint.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import delay from 'wsemi/src/delay.mjs'
import castPintOr from './castPintOr.mjs'
import buildValidator from './buildValidator.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import getErrorResult from './getErrorResult.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'


// dispatchApiOpenaiResponses.mjs — 以fetch直呼OpenAI Responses API(/responses)
//
// 【為何需要(2026-09-03實測後新增)】OpenCode Zen之端點「依模型家族而異」, 並非全部走
//   chat/completions: 官方文件(https://opencode.ai/docs/zh-tw/zen/)之端點欄明載
//   muse-spark系與GPT系走/responses(@ai-sdk/openai)、Claude系走/messages、Gemini系走
//   /models/<id>, 僅deepseek/glm/kimi/minimax/nemotron/ling/mimo等走/chat/completions。
//   以dispatchApiOpenaiCompat打/responses型模型會得到HTTP 500而非404, 極易被誤判為
//   「模型故障」而反覆重試——實測muse-spark-1.2/1.3走/chat/completions連續10次500,
//   同金鑰同模型改打/responses立即200。本轉接器即為補上該端點型別。
//
// 【與chat/completions之協定差異(皆2026-09-03於Zen實測確認)】
//   請求: 單一輸入欄位input(字串或訊息陣列)而非messages; system提示走instructions;
//        輸出上限為max_output_tokens而非max_tokens。
//   回應: 無choices, 改為output陣列, 元素type可為'reasoning'(思考, 實測content為空)、
//        'message'(內容在content[].text, type為'output_text')、'function_call'(工具呼叫);
//        另有頂層status(completed/incomplete/failed)與incomplete_details。
//   用量: usage欄位名不同——input_tokens/output_tokens/total_tokens
//        (chat/completions為prompt_tokens/completion_tokens/total_tokens)。
//        本套件usage一律原樣透傳不做正規化, 跨kind加總時呼叫端須自行對應欄位名。
//
// 【status不為completed一律視為失敗, 不回半截內容】incomplete(如max_output_tokens
//   耗盡)之output常為空陣列或截斷內容, 當成功回傳會讓截斷結果流入下游而無人察覺;
//   故以INCOMPLETE_RESPONSE回報(errorType為incomplete), 呼叫端據此調高max_output_tokens
//   或換家。實測: max_output_tokens為16時status為incomplete、incomplete_details為
//   {reason:'max_output_tokens'}、output為空陣列。
//
// 【不支援工具, 與dispatchApiOpenaiCompat同一決策】output含function_call型元素時
//   以TOOL_CALLS_UNSUPPORTED回報而不假裝成功; 理由(工具迴圈須自建harness、tool_call
//   有會話束縛無法外傳上層agent)詳見dispatchApiOpenaiCompat.mjs與adapters.mjs檔頭。
//
// 【錯誤碼實測(Zen)】壞金鑰401(AuthError); 未知model亦回401(ModelError: Model X is not
//   supported)而非404——故不可用狀態碼區分「金鑰錯」與「模型名錯」, 須讀stderr之訊息。
//
// 【結果結構對齊execCli】{ ok, stdout, stderr, code, error, errorType, durationMs,
//   attempts, usage }, 與dispatchApiOpenaiCompat完全一致, 故dispatchAiFallback之
//   失敗分流與工作流層無須任何修改即可使用本kind。


//預設值
let DEFAULT_TIMEOUT_MS = dfTimeoutMs //全套件統一預設300000
let DEFAULT_RETRY_DELAY_MS = 5000
let MAX_RETRY_DELAY_MS = 15000


//optTruncate, 裁切失敗結果之內容時於刪節號後標註原始總長度(同execCli)
let optTruncate = {
    funWithMsg: (str) => `(truncated, total ${str.length} chars)`,
}


/**
 * 自Responses API之output陣列取出文字內容(僅取message型元素之output_text)
 *
 * reasoning型元素為模型思考過程(Zen實測其content為空陣列)，不屬回覆內容故略過；
 * 多個message元素依序串接
 *
 * @param {Array} output 輸入回應之output陣列
 * @returns {String} 回傳串接後之文字內容，無有效內容回傳空字串
 * @example
 *
 * import { extractOutputText } from './src/dispatchApiOpenaiResponses.mjs'
 *
 * let output = [
 *     { type: 'reasoning', content: [] },
 *     { type: 'message', content: [{ type: 'output_text', text: '完成' }] },
 * ]
 * console.log(extractOutputText(output))
 * // => '完成'
 *
 */
function extractOutputText(output) {
    if (!isarr(output)) {
        return ''
    }
    let rs = []
    for (let item of output) {
        if (get(item, 'type', '') !== 'message') {
            continue
        }
        let content = get(item, 'content', null)
        if (!isarr(content)) {
            continue
        }
        for (let c of content) {
            let t = get(c, 'text', null)
            if (isestr(t)) {
                rs.push(t)
            }
        }
    }
    return rs.join('')
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

    //mkResult, 結果形狀之單一來源(欄位對齊execCli, 追加errorType與usage),
    //durationMs於呼叫當下計算; 失敗分支各自給errorType, 成功分支不帶(僅失敗結果有此欄)
    let mkResult = (patch) => ({
        ok: false,
        stdout: '',
        stderr: '',
        code: null,
        error: '',
        durationMs: Date.now() - t0,
        usage: null,
        ...patch,
    })

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

        //逾時, error以TIMEOUT開頭令dispatchAiFallback視為與金鑰無關而跳組
        if (err.name === 'AbortError') {
            return mkResult({ error: `TIMEOUT after ${timeoutMs / 1000}s`, errorType: 'timeout' })
        }

        //網路層錯誤(DNS/連線拒絕等)
        let cause = get(err, 'cause.code', '') || err.message
        return mkResult({ error: `FETCH_ERROR: ${cause}`, errorType: 'fetch' })
    }
    clearTimeout(timer)

    //HTTP非2xx, 原始回應本體放stderr供除錯與分類
    //(Zen實測: 壞金鑰與未知model皆401, 故訊息須讀stderr而非僅看狀態碼)
    if (!res.ok) {
        return mkResult({
            stderr: strTruncate(txt, 1000, optTruncate),
            code: res.status,
            error: `HTTP ${res.status}`,
            errorType: 'http',
        })
    }

    //解析output/status/usage(token用量原樣透傳; 失敗回應亦可能已耗token, 一併帶出)
    let output = null
    let status = ''
    let incompleteReason = ''
    let failMsg = ''
    let usage = null
    let parsed = true
    try {
        let j = JSON.parse(txt)
        output = get(j, 'output', null)
        status = get(j, 'status', '')
        incompleteReason = get(j, 'incomplete_details.reason', '')
        failMsg = get(j, 'error.message', '') || get(j, 'error.code', '')
        usage = get(j, 'usage', null)
        if (!isobj(usage)) {
            usage = null
        }
    }
    catch {
        parsed = false
    }
    if (!parsed || !isarr(output)) {
        return mkResult({
            stderr: strTruncate(txt, 500, optTruncate),
            code: res.status,
            error: 'INVALID_RESPONSE: missing output array',
            errorType: 'invalid-response',
            usage,
        })
    }

    //function_call, 本轉接器不支援工具迴圈(見檔頭), 明確回報而不假裝成功
    let hasToolCall = output.some((o) => get(o, 'type', '') === 'function_call')
    if (hasToolCall) {
        return mkResult({
            stderr: strTruncate(txt, 1000, optTruncate),
            code: res.status,
            error: 'TOOL_CALLS_UNSUPPORTED: use a cli kind (opencode/claude/codex/antigravity) when tools are needed',
            errorType: 'tool-unsupported',
            usage,
        })
    }

    //status非completed一律失敗: incomplete之內容為截斷品, 當成功回傳會讓半截結果流入下游
    if (status !== 'completed') {
        let detail = incompleteReason || failMsg || status || 'unknown'
        return mkResult({
            stdout: strTruncate(extractOutputText(output), 500, optTruncate),
            stderr: strTruncate(txt, 500, optTruncate),
            code: res.status,
            error: `INCOMPLETE_RESPONSE: status=${status || 'missing'} (${detail})`,
            errorType: 'incomplete',
            usage,
        })
    }

    //content, 自output取message型之output_text
    let content = extractOutputText(output)
    if (content === '') {
        return mkResult({
            stderr: strTruncate(txt, 500, optTruncate),
            code: res.status,
            error: 'INVALID_RESPONSE: no output_text in output messages',
            errorType: 'invalid-response',
            usage,
        })
    }

    //validator, error與execCli一致令dispatchAiFallback可統一分流
    if (validator && !validator(content)) {
        return mkResult({
            stdout: strTruncate(content, 500, optTruncate),
            code: res.status,
            error: 'OUTPUT_VALIDATION_FAILED',
            errorType: 'validation',
            usage,
        })
    }

    return mkResult({
        ok: true,
        stdout: content,
        code: res.status,
        usage,
    })
}


//本轉接器不使用execCli, 全部設定鍵自理, 未知鍵一律忽略


/**
 * 以fetch直呼OpenAI Responses API(/responses)呼叫AI模型
 *
 * 特點：
 * 免安裝CLI、免預先登入，給baseURL＋key＋model即可呼叫(如OpenCode Zen之muse-spark系與GPT系)；
 * 端點型別與dispatchApiOpenaiCompat不同——Zen之端點依模型家族而異，收錄前須查官方文件端點欄
 * (https://opencode.ai/docs/zh-tw/zen/)，打錯端點會得到HTTP 500而非404，詳見providers.mjs檔頭；
 * 僅供純文字生成，需要工具能力請改用CLI類kind(opencode/claude/codex/antigravity)；
 * status非completed(如max_output_tokens耗盡)一律以INCOMPLETE_RESPONSE回報，不回半截內容；
 * 結果結構與dispatchApiOpenaiCompat完全一致，可直接作為dispatchAi與dispatchAiFallback之kind('api-openai-responses')使用；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，作為input置於HTTP body
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} opt.baseURL 輸入API基底網址字串，例如'https://opencode.ai/zen/v1'，將於尾端接上/responses
 * @param {String} opt.model 輸入模型ID字串，例如'muse-spark-1.3-contributor-free'
 * @param {String} [opt.key=''] 輸入API key字串，以Bearer置於Authorization標頭，預設''代表不帶認證標頭
 * @param {String} [opt.system=''] 輸入system提示詞字串，將置於instructions欄位(Responses API之system管道)，預設''代表不帶
 * @param {Object} [opt.body={}] 輸入額外請求本體物件(如temperature、max_output_tokens、reasoning)，將併入預設body(同名鍵以此為準)，預設{}。注意輸出上限欄位名為max_output_tokens而非max_tokens；本轉接器不支援工具，帶入tools而模型回function_call時一律以TOOL_CALLS_UNSUPPORTED回報失敗
 * @param {Object} [opt.headers={}] 輸入額外請求標頭物件，預設{}
 * @param {Number} [opt.timeoutMs=300000] 輸入逾時毫秒正整數，逾時將中止請求(含回應串流讀取)，全套件統一預設300000
 * @param {String|Function} [opt.validate=undefined] 輸入回覆內容驗證規則字串或自訂驗證函數，規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接，預設undefined代表不驗證
 * @param {Number} [opt.maxRetries=0] 輸入失敗後最大重試次數非負整數，4xx(429除外)不重試，預設0
 * @param {Number} [opt.retryDelayMs=5000] 輸入重試間隔毫秒正整數，實際間隔為retryDelayMs乘以重試次數且上限15000ms，預設5000
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(回覆內容字串)、stderr(失敗時之原始回應本體)、code(HTTP狀態碼，網路錯誤與逾時為null)、error(錯誤訊息字串，成功時為空字串)、errorType(僅失敗時，機器可讀錯誤類別字串，一覽見getErrorType.mjs檔頭)、durationMs(耗時毫秒)、attempts(實際嘗試次數)、usage(原始回應之token用量物件原樣透傳，欄位名為input_tokens/output_tokens/total_tokens，無則null)，本函數不會reject
 * @example
 * //need network, no cli required
 *
 * import dispatchApiOpenaiResponses from './src/dispatchApiOpenaiResponses.mjs'
 *
 * let test = async () => {
 *
 *     //OpenCode Zen之muse-spark系走/responses(非chat/completions), 詳見providers.mjs檔頭
 *     let r = await dispatchApiOpenaiResponses('請只回覆兩個字：完成', {
 *         baseURL: 'https://opencode.ai/zen/v1',
 *         key: 'sk-xxxxxx',
 *         model: 'muse-spark-1.3-contributor-free',
 *     })
 *     console.log(r.ok, r.stdout.trim())
 *     // => true 完成
 *
 *     let re = await dispatchApiOpenaiResponses('abc', { baseURL: 'https://opencode.ai/zen/v1', key: 'sk-bad', model: 'muse-spark-1.3-contributor-free' })
 *     console.log(re.ok, re.code, re.errorType)
 *     // => false 401 http
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchApiOpenaiResponses(prompt, opt = {}) {

    //check prompt, 不reject故以錯誤結果物件回報
    if (!isestr(prompt)) {
        return getErrorResult('prompt must be a non-empty string')
    }

    //baseURL必填, API無CLI可回退
    let baseURL = get(opt, 'baseURL', null)
    if (!isestr(baseURL)) {
        return getErrorResult('baseURL must be a non-empty string')
    }

    //model必填, responses無預設模型
    let model = get(opt, 'model', null)
    if (!isestr(model)) {
        return getErrorResult('model must be a non-empty string')
    }

    //key, 無效代表不帶認證標頭(部分閘道免認證)
    let key = get(opt, 'key', null)

    //system, Responses API之system管道為instructions
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
    let timeoutMs = castPintOr(get(opt, 'timeoutMs', null), DEFAULT_TIMEOUT_MS)

    //maxRetries
    let maxRetries = get(opt, 'maxRetries', null)
    if (!isp0int(maxRetries)) {
        maxRetries = 0
    }
    else {
        maxRetries = cint(maxRetries)
    }

    //retryDelayMs
    let retryDelayMs = castPintOr(get(opt, 'retryDelayMs', null), DEFAULT_RETRY_DELAY_MS)

    //validator
    let validator = buildValidator(get(opt, 'validate', null))

    //url, baseURL尾端斜線正規化後接上端點
    let url = baseURL.replace(/\/+$/, '') + '/responses'

    //body, input為Responses API之輸入欄位; 額外鍵以bodyExtra為準(可覆寫temperature等)
    let body = { model, input: prompt }
    if (isestr(system)) {
        body.instructions = system
    }
    body = { ...body, ...bodyExtra }

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


export default dispatchApiOpenaiResponses
export { extractOutputText }
