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
import { readCallerObj, errMsg, errField, asText } from './callUserFn.mjs'
import redactText, { secretHeaderValues, redactApiKeyText } from './redactText.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'
import { normalizeFinishReason, safeValidateAsync, judgeTruncated } from './checkTruncation.mjs'
import describeNonJsonBody from './describeNonJsonBody.mjs'


// dispatchApiAnthropic.mjs — 以fetch直呼Anthropic Messages API(POST /v1/messages), 以Console之API金鑰計費
//
// 【為何需要】使用者持有Anthropic Console之API額度(與Claude訂閱額度分開計費)。純文字生成(摘要、分析、改寫、產出JSON——素材已在prompt內)
//   直呼REST即可: 免安裝CLI、免預先登入、不受CLI版本與憑證優先序影響; 要工具(讀檔、grep、shell)請用CLI類(kind claude + key, 見dispatchClaude.mjs),
//   選型判準見adapters.mjs檔頭。本轉接器與其他REST轉接器同形(回傳物件、errorType、重試、遞補層分流), 差異集中於Anthropic協定。
//
// 【請求形狀(2026-10-24依官方Messages API與claude-api技能查證)】
//   POST <baseURL>/v1/messages; 標頭x-api-key(金鑰, 非Authorization: Bearer)、anthropic-version: 2023-06-01(必填, 缺則伺服器回400)、Content-Type: application/json;
//   本體: model、max_tokens(必填, 預設16000)、messages: [{role:'user', content: prompt}]、system(頂層字串欄位, 非messages內之角色)、
//   output_config: { effort }(effort選項)。不送stream(非串流, 見下)、不送tools、不送temperature/top_p/top_k。
//
// 【思考與effort(各模型限制; providers.mjs之anthropic:條目引用)】
//   claude-opus-5-5 / claude-sonnet-5-5 / claude-haiku-5-5皆為自適應思考: 省略thinking欄位即開啟, 故本轉接器預設不送thinking。
//   - Opus 5.5: 思考不可關閉——thinking:{type:'disabled'}與{type:'enabled',budget_tokens}在任何effort下皆回400; effort為唯一調節手段, API預設medium(非high), 故條目明給high。
//   - Sonnet 5.5: thinking:{type:'disabled'}回400(關思考須用{type:'between_tools'}, 僅effort high以下可用); API預設effort high。
//   - Haiku 5.5: 預設自適應思考; {type:'disabled'}僅effort low~high可用(xhigh/max回400); API預設effort medium。
//   - 三者皆已移除temperature/top_p/top_k(非預設值回400), 本轉接器不送; 亦不支援assistant預填(prefill, 回400)。
//   - 思考預設display為omitted(thinking區塊的thinking字串為空, 僅signature), 思考token計入max_tokens且不另列於usage——
//     故max_tokens須為思考與回覆預留空間; 預設16000(非串流之安全上限量級: 官方SDK對預期逾10分鐘之非串流請求拒絕送出, 約對應max_tokens>21333;
//     本轉接器不串流, 需要更大輸出請改用批次或自行串流, 或確認網路對長連線的閒置容忍)。
//   - 需要更精細控制(thinking.display、budget等)經opt.body覆寫, 例如body:{ thinking:{ type:'adaptive', display:'summarized' } }。
//   - 伺服器端遞補(fallbacks, beta server-side-fallback-2026-07-01)預設不送: 它會在同一次呼叫內改用他型模型、以他型單價計費, 屬計費行為變更,
//     且Haiku 5.5不支援; 供應商層的遞補由dispatchAiFallback負責。需要時經opt.body.fallbacks與opt.headers['anthropic-beta']自行開啟。
//
// 【stop_reason處置(HTTP 200亦可能失敗)】
//   end_turn / stop_sequence / 未知值   視為正常結束(未知值不可誤殺, 同其他REST轉接器)
//   max_tokens   截斷: 預設失敗(INCOMPLETE_RESPONSE、errorType incomplete、truncated true、不重試)——規則單一來源見checkTruncation.mjs;
//                思考耗盡max_tokens而無可見輸出者一律失敗(即使acceptTruncated); acceptTruncated:true才放行有部分文字者
//   refusal      安全分類器拒答(HTTP 200, stop_details含category): 失敗(error 'REFUSED: stop_reason=refusal (category=…)'、errorType refusal), 部分文字置stdout、
//                stop_details置stderr; 不重試, 遞補層視為與金鑰無關而整組跳過(同請求換金鑰必然再被拒); 由遞補鏈下一個條目接手
//   tool_use     本轉接器不支援工具, TOOL_CALLS_UNSUPPORTED(errorType tool-unsupported), 同其他REST轉接器
//   pause_turn   僅伺服器工具會出現(本轉接器不送工具), 保守視為未完成: INCOMPLETE_RESPONSE(errorType incomplete, 非截斷)
//   結果之finishReason為stop_reason小寫原值(end_turn、max_tokens、refusal…), truncated僅max_tokens為true。
//
// 【HTTP錯誤(皆errorType http、code為狀態碼、error為'HTTP <碼>', 原始本體置stderr, 另帶apiErrorType取自error.type)】
//   400 invalid_request_error(參數錯誤; 亦用於組織/工作區自訂花費上限, 及——第三方回報——「Your credit balance is too low to access the Anthropic API」額度不足)
//   401 authentication_error(金鑰無效/撤銷/過期)  402 billing_error(帳務問題)  403 permission_error(金鑰無權限)  404 not_found_error(含模型不存在/無權使用)
//   413 request_too_large  429 rate_limit_error(限流; 達用量級別之月花費上限者無retry-after且持續失敗)  500 api_error  504 timeout_error  529 overloaded_error(過載)
//   重試語意對齊execCli與其他REST轉接器: 4xx(429除外)為客戶端錯誤不重試; 429/5xx(含529)/網路錯誤/逾時依maxRetries線性退避重試(不讀retry-after)。
//   遞補層: 429觸發cooldownMs內建冷卻; 其餘HTTP錯誤(401/402/403與額度類400)換組內下一把金鑰、不整組跳過; 額度類字樣的冷卻可由呼叫端經coolDetect注入。
//
// 【key不外洩】錯誤路徑(fetch例外訊息、HTTP錯誤本體、refusal細節、部分輸出、非JSON診斷之回應標頭值、呼叫端validate之例外訊息、
//   啟動前params錯誤之外來例外訊息)一律先經redactApiKeyText: 遮蔽本次全部機密標頭值與key本身、再遮蔽sk-ant-樣式(見redactText.mjs);
//   成功之stdout為模型輸出: 只精確遮蔽本次機密值(redactText), 不做樣式遮蔽(合法內容可含「sk-ant-api03-…」範例字樣)。
//   usage、finishReason為伺服器回傳值原樣透傳, 不遮蔽。標頭值先物化為字串且只讀一次, 與其他REST轉接器相同。
//
// 【沿用其他REST轉接器之既有規則】預設Accept-Encoding: identity(防伺服器壓縮卻漏標Content-Encoding)、HTTP 200但本體非JSON另報INVALID_RESPONSE(describeNonJsonBody.mjs)、
//   截斷於validate之前裁定、validate支援Promise與該次嘗試共用timeoutMs、body/headers不可讀或不可序列化以params回報、不reject。
//
// 【結果結構】{ ok, stdout, stderr, code, error, durationMs, attempts, usage, finishReason, truncated }, 失敗另帶errorType(一覽見getErrorType.mjs檔頭);
//   usage為原始回應之usage物件原樣透傳(input_tokens、output_tokens、cache_*等; 思考token含於output_tokens)。


//預設值
let DEFAULT_BASE_URL = 'https://api.anthropic.com'
let ANTHROPIC_VERSION = '2023-06-01'
let DEFAULT_MAX_TOKENS = 16000
let DEFAULT_TIMEOUT_MS = dfTimeoutMs //全套件統一預設300000
let DEFAULT_RETRY_DELAY_MS = 5000
let MAX_RETRY_DELAY_MS = 15000

//effort有效值(Opus 5.5 / Sonnet 5.5 / Haiku 5.5皆支援五檔); 其餘值視為未給
let EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

//非機密之標頭(其值出現在錯誤本體中不應被遮蔽): 版本與beta旗標; Content-Type與Accept-Encoding已由secretHeaderValues排除
let PUBLIC_HEADERS = ['anthropic-version', 'anthropic-beta']


//optTruncate, 裁切失敗結果之內容時於刪節號後標註原始總長度(同execCli)
let optTruncate = {
    funWithMsg: (str) => `(truncated, total ${str.length} chars)`,
}


/**
 * 單次HTTP呼叫(內部使用, 不含重試邏輯)
 *
 * @param {String} url 輸入完整端點網址字串
 * @param {Object} headers 輸入請求標頭物件
 * @param {String} bodyText 輸入已序列化之請求本體JSON字串(送出前序列化一次, 重試共用)
 * @param {Number} timeoutMs 輸入逾時毫秒
 * @param {Function|null} validator 輸入驗證函式
 * @param {Boolean} acceptTruncated 輸入是否明示接受截斷內容
 * @param {Array} secrets 輸入須遮蔽之機密值字串陣列
 * @returns {Promise} 回傳Promise，resolve回傳結果物件
 */
async function callOnce(url, headers, bodyText, timeoutMs, validator, acceptTruncated, secrets) {

    let t0 = Date.now()

    //red, 錯誤路徑文字一律先遮蔽機密值與sk-ant-樣式
    let red = (s) => redactApiKeyText(s, secrets)

    //mkResult, 結果形狀之單一來源(欄位對齊execCli, 追加errorType與usage); 成功分支不帶errorType
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

    //本體先取原始位元組再以UTF-8解碼, 本體非JSON時才有原始位元組可供診斷(見describeNonJsonBody.mjs)
    let res = null
    let raw = new Uint8Array(0)
    let txt = ''
    try {
        res = await fetch(url, {
            method: 'POST',
            headers,
            body: bodyText,
            signal: controller.signal,
        })
        raw = new Uint8Array(await res.arrayBuffer())
        txt = new TextDecoder('utf-8').decode(raw)
    }
    catch (err) {
        clearTimeout(timer)

        //逾時, error以TIMEOUT開頭令dispatchAiFallback視為與金鑰無關而跳組
        if (errField(err, 'name') === 'AbortError') {
            return mkResult({ error: `TIMEOUT after ${timeoutMs / 1000}s`, errorType: 'timeout' })
        }

        //網路層錯誤; 無cause.code者(送出前之例外, 如標頭值含換行)之訊息會夾帶標頭值(含金鑰), 一律遮蔽
        let cause = errField(err, 'cause.code') || red(errMsg(err))
        return mkResult({ error: `FETCH_ERROR: ${cause}`, errorType: 'fetch' })
    }
    clearTimeout(timer)

    //HTTP非2xx, 原始回應本體放stderr供除錯與分類; apiErrorType取自本體error.type(如rate_limit_error、billing_error)
    if (!res.ok) {
        let apiErrorType = ''
        try {
            let ej = JSON.parse(txt)
            let t = get(ej, 'error.type', '')
            apiErrorType = isestr(t) ? strTruncate(red(t), 80, optTruncate) : ''
        }
        catch {}
        return mkResult({
            stderr: strTruncate(red(txt), 1000, optTruncate),
            code: res.status,
            error: `HTTP ${res.status}`,
            errorType: 'http',
            apiErrorType,
        })
    }

    //解析成功本體
    let j = null
    let parsed = true
    try {
        j = JSON.parse(txt)
    }
    catch {
        parsed = false
    }

    //本體非JSON, 與「JSON缺content」分開回報並附原始位元組資訊; 遞補層據前綴整組跳過(見describeNonJsonBody.mjs)
    if (!parsed) {
        return mkResult({
            stderr: strTruncate(red(txt), 500, optTruncate),
            code: res.status,
            error: red(describeNonJsonBody(raw, res.headers)), //含回應標頭值(content-type等), 屬外來文字故一併遮蔽(前綴INVALID_RESPONSE: body is not JSON不受影響)
            errorType: 'invalid-response',
            finishReason: '',
            truncated: false,
        })
    }

    let usage = get(j, 'usage', null)
    if (!isobj(usage)) {
        usage = null
    }
    let content = get(j, 'content', null)
    let blocks = isarr(content) ? content : []
    let stopDetails = get(j, 'stop_details', null)

    //fin, 自此起之每個結果皆外顯終止原因(stop_reason小寫原值)與是否截斷(僅max_tokens)
    let finishReason = normalizeFinishReason(get(j, 'stop_reason', null))
    let fin = { finishReason, truncated: finishReason === 'max_tokens' }

    //text, 全部text區塊依序串接(thinking、redacted_thinking等其他區塊略過); hasText為是否至少有一個text區塊
    let texts = blocks.filter((b) => get(b, 'type', '') === 'text' && typeof get(b, 'text', null) === 'string')
    let text = texts.map((b) => b.text).join('')
    let hasText = texts.length > 0

    //refusal, 安全分類器拒答(HTTP 200), 於結構檢查之前裁定(拒答時content可為空陣列)
    if (finishReason === 'refusal') {
        let cat = get(stopDetails, 'category', null)
        let category = isestr(cat) ? strTruncate(red(cat), 60, optTruncate) : 'unknown'
        return mkResult({
            stdout: strTruncate(red(text), 500, optTruncate),
            stderr: isobj(stopDetails) ? strTruncate(red(JSON.stringify(stopDetails)), 500, optTruncate) : '',
            code: res.status,
            error: `REFUSED: stop_reason=refusal (category=${category})`,
            errorType: 'refusal',
            usage,
            ...fin,
        })
    }

    //tool_use, 本轉接器不支援工具迴圈(同其他REST轉接器), 明確回報而不假裝成功
    if (finishReason === 'tool_use' || blocks.some((b) => get(b, 'type', '') === 'tool_use')) {
        return mkResult({
            stderr: strTruncate(red(txt), 1000, optTruncate),
            code: res.status,
            error: 'TOOL_CALLS_UNSUPPORTED: use a cli kind (opencode/claude/codex/antigravity) when tools are needed',
            errorType: 'tool-unsupported',
            usage,
            ...fin,
        })
    }

    //content須為陣列
    if (!isarr(content)) {
        return mkResult({
            stderr: strTruncate(red(txt), 500, optTruncate),
            code: res.status,
            error: 'INVALID_RESPONSE: missing content array',
            errorType: 'invalid-response',
            usage,
            ...fin,
        })
    }

    //pause_turn, 僅伺服器工具會出現(本轉接器不送工具), 保守視為未完成
    if (finishReason === 'pause_turn') {
        return mkResult({
            stdout: strTruncate(red(text), 500, optTruncate),
            stderr: strTruncate(red(txt), 500, optTruncate),
            code: res.status,
            error: 'INCOMPLETE_RESPONSE: stop_reason=pause_turn',
            errorType: 'incomplete',
            usage,
            ...fin,
        })
    }

    //max_tokens, 截斷於null檢查與validate之前裁定: 預設失敗, 明示acceptTruncated才交validate放行(規則見checkTruncation.mjs; 思考耗盡而無可見輸出者一律失敗)
    if (fin.truncated) {
        let d = await judgeTruncated({
            finishReason: 'length', //checkTruncation之放行規則以'length'代表「輸出上限截斷」
            content: text,
            acceptTruncated,
            validator,
            timeoutMs: Math.max(timeoutMs - (Date.now() - t0), 1), //validate與本次嘗試共用timeoutMs(剩餘時間)
            reasoningTokens: null, //Anthropic不另列思考token(含於output_tokens)
            label: 'stop_reason=max_tokens',
        })
        if (!d.accept) {
            return mkResult({
                stdout: strTruncate(red(text), 500, optTruncate),
                stderr: strTruncate(red((d.note ? `${d.note}\n` : '') + txt), 500, optTruncate), //d.note含呼叫端validate之例外訊息(外來文字), 與本體一併遮蔽再截斷
                code: res.status,
                error: d.error,
                errorType: 'incomplete',
                usage,
                ...fin,
            })
        }
        return mkResult({ ok: true, stdout: redactText(text, secrets), code: res.status, usage, ...fin }) //成功之stdout為模型輸出: 只精確遮蔽本次機密值, 不套sk-ant-樣式(同dispatchClaude)
    }

    //無任何text區塊(如僅thinking), 結構不合規
    if (!hasText) {
        return mkResult({
            stderr: strTruncate(red(txt), 500, optTruncate),
            code: res.status,
            error: 'INVALID_RESPONSE: no text block in content',
            errorType: 'invalid-response',
            usage,
            ...fin,
        })
    }

    //validator, error與execCli一致令dispatchAiFallback可統一分流; 拋錯視同拒絕(不reject), 訊息置stderr
    if (validator) {
        let v = await safeValidateAsync(validator, text, Math.max(timeoutMs - (Date.now() - t0), 1)) //validate與本次嘗試共用timeoutMs(剩餘時間)
        if (!v.pass) {
            return mkResult({
                stdout: strTruncate(red(text), 500, optTruncate),
                stderr: red(v.note), //呼叫端validate之例外訊息(外來文字)
                code: res.status,
                error: 'OUTPUT_VALIDATION_FAILED',
                errorType: 'validation',
                usage,
                ...fin,
            })
        }
    }

    return mkResult({
        ok: true,
        stdout: redactText(text, secrets), //同上: 成功之stdout只精確遮蔽
        code: res.status,
        usage,
        ...fin,
    })
}


//本轉接器不使用execCli, 全部設定鍵自理, 未知鍵一律忽略


/**
 * 以fetch直呼Anthropic Messages API(POST /v1/messages)呼叫Claude模型，以Console之API金鑰計費
 *
 * 特點：
 * 免安裝CLI、免預先登入，給key＋model即可呼叫；僅供純文字生成(素材已在prompt內之任務)——
 * 需要讀本機檔案、grep、執行指令等工具能力時，請改用CLI類kind(claude，並給key以API金鑰計費)；
 * 思考與effort依各模型現行規則(見檔頭【思考與effort】)：預設不送thinking(自適應思考)，effort以output_config.effort送出；
 * stop_reason之處置見檔頭：max_tokens預設失敗(截斷)、refusal失敗且遞補層整組跳過、tool_use不支援；
 * 錯誤依HTTP狀態碼分流：4xx(429除外)為客戶端錯誤不重試，429/5xx(含529)/網路錯誤/逾時依maxRetries線性退避重試；
 * key只置於x-api-key標頭，錯誤路徑之任何文字皆遮蔽key與sk-ant-樣式；
 * 結果結構與逾時/驗證失敗之error字樣對齊execCli，可直接作為dispatchAi與dispatchAiFallback之kind('api-anthropic')使用；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，作為user訊息置於HTTP body
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} opt.model 輸入模型ID字串，例如'claude-opus-5-5'、'claude-sonnet-5-5'、'claude-haiku-5-5'(完整ID，不加日期後綴)；Messages API無預設模型故必填
 * @param {String} [opt.key=''] 輸入Anthropic API金鑰字串(sk-ant-…)，置於x-api-key標頭，預設''代表不帶認證標頭(僅供不需金鑰之閘道；直連官方端點會回401)
 * @param {String} [opt.baseURL='https://api.anthropic.com'] 輸入API基底網址字串(不含/v1，尾端/v1會被去除)，將於尾端接上/v1/messages，預設官方端點
 * @param {String} [opt.system=''] 輸入system提示詞字串，置於頂層system欄位(非messages內之角色)，預設''代表不帶
 * @param {String} [opt.effort=''] 輸入思考強度字串，'low'、'medium'、'high'、'xhigh'、'max'之一，以output_config.effort送出，其他值視為未給，預設''代表不送(由API依模型決定：Opus 5.5與Haiku 5.5為medium，Sonnet 5.5為high)
 * @param {Object} [opt.body={}] 輸入額外請求本體物件(如max_tokens、thinking、output_config、fallbacks)，將併入預設body(同名鍵以此為準)，預設{}。預設body為{ model, max_tokens: 16000, messages, system?, output_config? }。注意本轉接器不支援工具，帶入tools而模型回tool_use時一律以TOOL_CALLS_UNSUPPORTED回報失敗，需要工具請改用CLI類kind
 * @param {Object} [opt.headers={}] 輸入額外請求標頭物件，同名鍵(不分大小寫)覆寫預設標頭而不重複送出；預設標頭含'anthropic-version: 2023-06-01'與'Accept-Encoding: identity'，預設{}
 * @param {Number} [opt.timeoutMs=300000] 輸入逾時毫秒正整數，逾時將中止請求(含回應串流讀取)，全套件統一預設300000
 * @param {String|Function} [opt.validate=undefined] 輸入回覆內容驗證規則字串或自訂驗證函數，規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接，自訂函數可回傳Promise(以resolve值判定，與該次HTTP嘗試共用timeoutMs)，拋錯或reject視同驗證失敗(stderr前綴'validate threw: 訊息')，逾時亦同(前綴'validate timed out: did not settle within Ns')，預設undefined代表不驗證
 * @param {Boolean} [opt.acceptTruncated=false] 輸入是否接受被截斷(stop_reason為max_tokens)之內容布林值，true代表交validate裁決(無validate則直接接受)且結果標truncated:true；無可見輸出(思考耗盡max_tokens)者一律失敗，預設false代表截斷一律失敗(errorType incomplete)
 * @param {Number} [opt.maxRetries=0] 輸入失敗後最大重試次數非負整數，4xx(429除外)、截斷與拒答不重試，預設0
 * @param {Number} [opt.retryDelayMs=5000] 輸入重試間隔毫秒正整數，實際間隔為retryDelayMs乘以重試次數且上限15000ms，預設5000
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(回覆文字，全部text區塊串接)、stderr(失敗時之原始回應本體或refusal之stop_details)、code(HTTP狀態碼，網路錯誤與逾時為null)、error(錯誤訊息字串，成功時為空字串)、errorType(僅失敗時，機器可讀錯誤類別字串，一覽見getErrorType.mjs檔頭，本轉接器另有'refusal')、durationMs(耗時毫秒)、attempts(實際嘗試次數)、usage(原始回應之usage物件原樣透傳，無則null)、finishReason(已取得回應時之stop_reason小寫原值，缺值為'')、truncated(是否因max_tokens截斷布林值)、apiErrorType(僅HTTP非2xx時，取自錯誤本體error.type之字串，如'rate_limit_error'、'billing_error'，無法解析為'')，本函數不會reject
 * @example
 * //need network, no cli required
 *
 * import dispatchApiAnthropic from './src/dispatchApiAnthropic.mjs'
 *
 * let test = async () => {
 *
 *     //金鑰自.env的ANTHROPIC_KEYS取得(readEnvFile不污染process.env); 勿把Console金鑰設為全域ANTHROPIC_API_KEY
 *     let r1 = await dispatchApiAnthropic('請只回覆兩個字：完成', {
 *         key: 'sk-ant-api03-xxxxxx',
 *         model: 'claude-haiku-5-5',
 *         effort: 'low',
 *     })
 *     console.log(r1.ok, r1.stdout.trim(), r1.finishReason)
 *     // => true 完成 end_turn
 *
 *     let re = await dispatchApiAnthropic('abc', { key: 'sk-bad', model: 'claude-haiku-5-5' })
 *     console.log(re.ok, re.code, re.errorType, re.apiErrorType)
 *     // => false 401 http authentication_error
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchApiAnthropic(prompt, opt = {}) {

    //check prompt, 不reject故以錯誤結果物件回報
    prompt = asText(prompt) //String包裝物件取其原始字串(空包裝不得繞過非空檢核); 判型不執行使用者程式碼(已撤銷之Proxy等回空字串)
    if (prompt === '') {
        return getErrorResult('prompt must be a non-empty string')
    }

    //model必填, Messages API無預設模型
    let model = get(opt, 'model', null)
    if (!isestr(model)) {
        return getErrorResult('model must be a non-empty string')
    }

    //baseURL, 無效回退官方端點; 正規化: 去尾端斜線與尾端/v1(端點路徑由本函數接上)
    let baseURL = get(opt, 'baseURL', null)
    if (!isestr(baseURL)) {
        baseURL = DEFAULT_BASE_URL
    }
    let url = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/messages'

    //key, 無效代表不帶認證標頭
    let key = get(opt, 'key', null)

    //redEarly, 啟動前(組本體與標頭階段)之params錯誤訊息含外來例外文字(呼叫端getter、toJSON、toString之例外), 可能夾帶key, 一律先遮蔽
    let redEarly = (s) => redactApiKeyText(s, isestr(key) ? [key] : [])

    //system
    let system = get(opt, 'system', null)

    //effort, 僅五個有效值才送出
    let effort = get(opt, 'effort', null)

    //bodyExtra
    let rbody = readCallerObj(get(opt, 'body', null), 'body') //呼叫端物件不可讀(拋錯之getter、已撤銷之Proxy)以params回報, 可讀者取物化之淺層副本
    if (!rbody.ok) {
        return getErrorResult(redEarly(rbody.msg))
    }
    let bodyExtra = rbody.value
    if (!isobj(bodyExtra)) {
        bodyExtra = {}
    }

    //headersExtra
    let rheaders = readCallerObj(get(opt, 'headers', null), 'headers')
    if (!rheaders.ok) {
        return getErrorResult(redEarly(rheaders.msg))
    }
    let headersExtra = rheaders.value
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

    //acceptTruncated, 僅明示true才放行截斷內容(見檔頭)
    let acceptTruncated = get(opt, 'acceptTruncated', null) === true

    //body, 額外鍵以bodyExtra為準
    let body = { model, max_tokens: DEFAULT_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }
    if (isestr(system)) {
        body.system = system
    }
    if (EFFORTS.includes(effort)) {
        body.output_config = { effort }
    }
    body = { ...body, ...bodyExtra }

    //headers, 預設標頭之後併入headersExtra(同名鍵不分大小寫覆寫: fetch對大小寫不同的同名標頭會合併成逗號串, 金鑰與版本不可被合併)
    let headers = { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'anthropic-version': ANTHROPIC_VERSION }
    if (isestr(key)) {
        headers['x-api-key'] = key
    }
    for (let k of Object.keys(headersExtra)) {
        let lk = k.toLowerCase()
        for (let hk of Object.keys(headers)) {
            if (hk.toLowerCase() === lk) {
                delete headers[hk]
            }
        }
        headers[k] = headersExtra[k]
    }

    //body, 送出前序列化一次(BigInt、循環參照、toJSON或getter拋錯等以params回報), 重試共用同一字串
    let bodyText = ''
    try {
        bodyText = JSON.stringify(body)
    }
    catch (err) {
        return getErrorResult(redEarly(`body is not JSON-serializable: ${errMsg(err)}`))
    }

    //headers之值, 物化為字串(同fetch之轉換)且只讀一次; 轉換拋錯以params回報
    try {
        for (let k of Object.keys(headers)) {
            headers[k] = String(headers[k])
        }
    }
    catch (err) {
        return getErrorResult(redEarly(`headers is not readable: ${errMsg(err)}`))
    }

    //secrets, 錯誤路徑須遮蔽之機密值: 全部機密標頭值(x-api-key、Authorization、呼叫端自給者; 版本與beta旗標除外)與key本身
    let secretSrc = {}
    for (let k of Object.keys(headers)) {
        if (!PUBLIC_HEADERS.includes(k.toLowerCase())) {
            secretSrc[k] = headers[k]
        }
    }
    let secrets = [...secretHeaderValues(secretSrc), ...(isestr(key) ? [key] : [])]

    let lastResult = null
    let totalAttempts = 0

    for (let attempt = 0; attempt <= maxRetries; attempt++) {

        //delay, 重試間隔隨次數遞增, 上限15000ms(同execCli)
        if (attempt > 0) {
            await delay(Math.min(retryDelayMs * attempt, MAX_RETRY_DELAY_MS))
        }

        lastResult = await callOnce(url, headers, bodyText, timeoutMs, validator, acceptTruncated, secrets)
        totalAttempts = attempt + 1

        if (lastResult.ok) {
            lastResult.attempts = totalAttempts
            return lastResult
        }

        //不可重試: 截斷為決定性(同一請求必然再截斷, 重試只會再燒一次輸出上限)
        if (lastResult.truncated === true) {
            break
        }

        //不可重試: 拒答為決定性(同一請求必然再被拒)
        if (lastResult.errorType === 'refusal') {
            break
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


export default dispatchApiAnthropic
