import os from 'os'
import path from 'path'
import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import execCliJsonRpc from 'wsemi/src/execCliJsonRpc.mjs'
import castPintOr from '../castPintOr.mjs'
import dfQuotaTimeoutMs from './dfQuotaTimeoutMs.mjs'
import readJsonOrNull from './readJsonOrNull.mjs'
import fetchQuotaJson from './fetchQuotaJson.mjs'
import fromCodexUsageHttp from './fromCodexUsageHttp.mjs'
import toQuotaScopedLabel from './toQuotaScopedLabel.mjs'
import toQuotaWindow from './toQuotaWindow.mjs'
import toQuotaResult from './toQuotaResult.mjs'


// getQuotaCodex.mjs — 查詢Codex(ChatGPT訂閱)帳號之當前額度
//
// 【主路徑: codex app-server(第一方協定), 2026-09-05本機實測】
//   `codex app-server --stdio` JSON-RPC: account/read → {account:{type:'chatgpt',email,planType}}(0.4s);
//   account/rateLimits/read → {rateLimits:{primary,secondary,credits,planType,...}, rateLimitsByLimitId, rateLimitResetCredits}(1.4s)。
//   認證與權杖刷新由codex自理, 本路徑不讀auth.json、不碰任何token; app-server子進程繼承本進程環境,
//   故查的是本進程CODEX_HOME(未設則~/.codex)所指之帳號——opt.codexHome不影響此路徑, 只用於下方備援;
//   要讓主路徑查別的目錄, 須於本進程環境設CODEX_HOME, 或以useAppServer:false改走備援。
//   Codex Desktop/IDE走同一協定, 有`codex app-server generate-json-schema`可產schema, 遠比
//   chatgpt.com之內部端點穩。同類工具wakamex/codex-cli-usage亦以此為主路徑。
//   工作階段由wsemi之execCliJsonRpc(1.8.85起)承擔: Windows之.cmd解析、維持stdin開啟直到回應到齊、
//   stdin.end()令其自行退出、逾寬限樹殺、以及「收尾之退出不算失敗」皆在其內; 本檔只負責
//   握手內容(initialize之clientInfo、initialized通知)與codex專屬之回應對映。
//   rateLimitResetCredits(額度重置券)由此路徑取得, 實測含id/title/description/grantedAt/expiresAt,
//   比chatgpt.com之rate-limit-reset-credits專用端點更完整; 兌換重置券亦有第一方方法
//   account/rateLimitResetCredit/consume({idempotencyKey, creditId?}), 屬動作非查詢, 本檔刻意不做。
//
// 【備援: GET https://chatgpt.com/backend-api/wham/usage】codex不存在、版本無app-server、
//   或RPC失敗時退回直打(實測200), 憑證取自<opt.codexHome|CODEX_HOME|~/.codex>/auth.json(opt.codexHome僅於此生效); 該回應本身即帶
//   email與plan_type。此為ChatGPT前端自用之內部端點, 路徑與欄位可能隨時變動, 對映邏輯獨立於
//   fromCodexUsageHttp以便用離線fixture驗證; 錯誤訊息一律先遮蔽權杖與帳號ID。
//
// 【認證模式】auth.json之auth_mode欄位實測存在(本機'chatgpt'); API key模式下無tokens而有
//   OPENAI_API_KEY, 此模式按用量計費、無訂閱額度窗口, 回unsupported而非誤導其去登入。
//   app-server之account.type同義(非'chatgpt'即非訂閱)。
//
// 【為何備援不自行刷新權杖】auth.json之access_token實測壽命10天且由codex於執行時自行刷新;
//   監控程式不擁有憑證生命週期(理由同getQuotaClaude), 401時指引執行一次codex即可。


//備援端點與其UA/originator(Codex CLI對此端點之自我標識)
let URL_USAGE = 'https://chatgpt.com/backend-api/wham/usage'
let DEFAULT_UA = 'codex-cli/0.153.0'
let DEFAULT_ORIGINATOR = 'codex_cli_rs'


//app-server之請求序列: 握手(initialize須帶clientInfo; initialized為通知)後讀帳號與額度
let DEFAULT_EXE = 'codex'
let RPC_REQUESTS = [
    { method: 'initialize', params: { clientInfo: { name: 'w-dispatch-ai', title: 'w-dispatch-ai', version: '1.0.0' } } },
    { notify: 'initialized', params: {} },
    { method: 'account/read', params: {} },
    { method: 'account/rateLimits/read', params: {} },
]


/**
 * 解出JWT之payload, 僅供顯示用途, 不驗簽
 *
 * @param {String} jwt 輸入JWT字串
 * @returns {Object|null} 回傳payload物件, 解析失敗回傳null
 */
function decodeJwtPayload(jwt) {
    try {
        let ss = jwt.split('.')
        if (ss.length < 2) {
            return null
        }
        return JSON.parse(Buffer.from(ss[1], 'base64url').toString('utf8'))
    }
    catch (err) {
        return null
    }
}


/**
 * 將app-server之單一窗口(primary/secondary)正規化為統一窗口物件
 *
 * @param {Object} o 輸入窗口物件{usedPercent, windowDurationMins, resetsAt}
 * @param {String} key 輸入窗口鍵字串
 * @param {String} scope 輸入範圍字串
 * @returns {Object|null} 回傳統一窗口物件, 輸入非物件回傳null
 */
function fromRpcWindow(o, key, scope) {
    if (!iseobj(o)) {
        return null
    }
    let mins = get(o, 'windowDurationMins', null)
    let windowSeconds = isnum(mins) ? cdbl(mins) * 60 : null
    return toQuotaWindow({
        key,
        label: toQuotaScopedLabel(windowSeconds, scope),
        windowSeconds,
        usedPercent: get(o, 'usedPercent', null),
        resetAt: get(o, 'resetsAt', ''),
        scope,
    })
}


/**
 * 以app-server取得額度並正規化
 *
 * @param {Object} opt 輸入設定物件
 * @returns {Promise} 回傳結果片段物件{ok, email, plan, accountType, windows, credits, raw, error, errorType}
 */
async function viaAppServer(opt) {

    //exe
    let exe = get(opt, 'exe', null)
    if (!isestr(exe)) {
        exe = DEFAULT_EXE
    }

    //rpc, errorType為params/notfound/timeout/exit/rpc
    let r = await execCliJsonRpc(exe, ['app-server', '--stdio'], RPC_REQUESTS, {
        timeoutMs: get(opt, 'timeoutMs', null),
    })
    if (!r.ok) {
        return { ok: false, error: r.error, errorType: r.errorType, raw: { appServer: { error: r.error, errorType: r.errorType, exitCode: r.exitCode, responses: r.responses } } }
    }

    let acc = get(r.results, ['account/read', 'account'], null)
    let rl = get(r.results, ['account/rateLimits/read'], null)

    //account, null代表codex尚未登入
    if (!iseobj(acc)) {
        return { ok: false, notLoggedIn: true, error: 'codex app-server reports not logged in (account is null); run [codex login] first', errorType: 'notfound', raw: { appServer: r.results } }
    }
    let email = get(acc, 'email', '')
    let plan = get(acc, 'planType', '')
    let accountType = get(acc, 'type', '')

    //accountType, 非chatgpt(例如apikey)即非訂閱, 無額度窗口
    if (isestr(accountType) && accountType !== 'chatgpt') {
        return {
            ok: false,
            email,
            plan,
            accountType,
            error: `codex is logged in with [${accountType}] mode; this mode is billed by usage and has no 5-hour/7-day subscription quota windows`,
            errorType: 'unsupported',
            raw: { appServer: r.results },
        }
    }

    //windows, 彙總窗口為主; rateLimitsByLimitId內與彙總同id者略過, 其餘以limitId為範圍逐一納入
    let windows = []
    let agg = get(rl, 'rateLimits', null)
    let aggId = get(agg, 'limitId', 'codex')
    let wPri = fromRpcWindow(get(agg, 'primary', null), 'primary', '')
    if (wPri !== null) {
        windows.push(wPri)
    }
    let wSec = fromRpcWindow(get(agg, 'secondary', null), 'secondary', '')
    if (wSec !== null) {
        windows.push(wSec)
    }
    let byId = get(rl, 'rateLimitsByLimitId', null)
    if (iseobj(byId)) {
        for (let limitId of Object.keys(byId)) {
            if (limitId === aggId) {
                continue
            }
            let it = byId[limitId]
            let scope = get(it, 'limitName', '')
            if (!isestr(scope)) {
                scope = limitId
            }
            for (let k of ['primary', 'secondary']) {
                let w = fromRpcWindow(get(it, k, null), `${limitId}:${k}`, scope)
                if (w !== null) {
                    windows.push(w)
                }
            }
        }
    }

    //credits, 點數餘額、額度重置券(Codex特有, 可提前重置窗口)與限額狀態
    let credits = {
        hasCredits: get(agg, 'credits.hasCredits', false),
        unlimited: get(agg, 'credits.unlimited', false),
        balance: get(agg, 'credits.balance', ''),
        resetCreditsAvailable: get(rl, 'rateLimitResetCredits.availableCount', null),
        resetCredits: get(rl, 'rateLimitResetCredits.credits', null),
        spendControlReached: get(agg, 'spendControlReached', false),
        rateLimitReachedType: get(agg, 'rateLimitReachedType', null),
        individualLimit: get(agg, 'individualLimit', null),
    }

    //plan, account/read為先, 其次rateLimits
    if (!isestr(plan)) {
        plan = get(agg, 'planType', '')
    }

    return {
        ok: true,
        email,
        plan,
        accountType,
        windows,
        credits,
        raw: { appServer: r.results },
    }
}


/**
 * 以備援端點取得額度並正規化
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} codexHome 輸入codex設定目錄字串
 * @param {Number} timeoutMs 輸入逾時毫秒
 * @returns {Promise} 回傳結果片段物件{ok, email, plan, windows, credits, raw, error, errorType}
 */
async function viaHttp(opt, codexHome, timeoutMs) {

    //env, 同主函數之注入來源
    let env = get(opt, 'env', null)
    if (!isobj(env)) {
        env = process.env
    }

    //auth
    let fpAuth = path.join(codexHome, 'auth.json')
    let auth = readJsonOrNull(fpAuth)
    let token = get(auth, 'tokens.access_token', '')
    let accountId = get(auth, 'tokens.account_id', '')

    //email與plan, 先由id_token取得(查詢失敗時仍能指出本機綁定之帳號), 查詢成功後以回應為準
    let email = ''
    let plan = ''
    let idToken = get(auth, 'tokens.id_token', '')
    if (isestr(idToken)) {
        let pl = decodeJwtPayload(idToken)
        let e = get(pl, 'email', '')
        if (isestr(e)) {
            email = e
        }
        //claim名本身含點號, 路徑須給陣列形式, 給字串會被lodash切開而永遠取不到
        let p = get(pl, ['https://api.openai.com/auth', 'chatgpt_plan_type'], '')
        if (isestr(p)) {
            plan = p
        }
    }

    //check token
    if (!isestr(token)) {

        //unsupported, API key模式: auth.json只有OPENAI_API_KEY而無tokens
        let apiKey = get(auth, 'OPENAI_API_KEY', '')
        if (isestr(apiKey) || isestr(get(env, 'OPENAI_API_KEY', ''))) {
            return { ok: false, email, plan, error: 'codex is running in API key mode (auth.json has OPENAI_API_KEY but no tokens); this mode is billed by usage and has no subscription quota windows', errorType: 'unsupported' }
        }

        return { ok: false, email, plan, error: `Codex CLI credential not found (${fpAuth}); run [codex login] first`, errorType: 'notfound' }
    }

    //headers
    let userAgent = get(opt, 'userAgent', null)
    if (!isestr(userAgent)) {
        userAgent = DEFAULT_UA
    }
    let originator = get(opt, 'originator', null)
    if (!isestr(originator)) {
        originator = DEFAULT_ORIGINATOR
    }
    let headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent,
        originator,
    }
    if (isestr(accountId)) {
        headers['ChatGPT-Account-ID'] = accountId
    }

    //fetch, 錯誤訊息中之權杖與帳號ID一律遮蔽
    let usageUrl = get(opt, 'usageUrl', null)
    if (!isestr(usageUrl)) {
        usageUrl = URL_USAGE
    }
    let r = await fetchQuotaJson(usageUrl, { headers, timeoutMs, redact: [token, accountId] })
    if (!r.ok) {
        let msg = r.error
        if (r.errorType === 'auth') {
            msg = `${msg} → codex refreshes the token on every run; run any codex command then retry, and only fall back to [codex login] if it still fails`
        }
        return { ok: false, email, plan, error: msg, errorType: r.errorType }
    }

    //map, 回應之帳號與方案為權威值
    let m = fromCodexUsageHttp(r.data)
    if (isestr(m.email)) {
        email = m.email
    }
    if (isestr(m.plan)) {
        plan = m.plan
    }

    return { ok: true, email, plan, windows: m.windows, credits: m.credits, raw: { usage: r.data } }
}


/**
 * 查詢Codex(ChatGPT訂閱)帳號之當前額度
 *
 * 主路徑以codex app-server之JSON-RPC取得帳號與額度(認證與刷新由codex自理)，
 * codex不存在或RPC失敗時退回直打chatgpt.com之用量端點。
 * 額度綁定本機Codex CLI之登入憑證，無「給email查任意帳號」之公開介面，
 * 故email參數之作用為比對——不符時ok為false且matched為false，並於error載明本機實際登入之帳號；
 * 未給email時不比對。本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} [email=''] 輸入欲查詢之帳號email字串，預設''代表不比對而直接回報本機當前帳號
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.exe='codex'] 輸入codex執行檔名稱或路徑字串，預設'codex'
 * @param {Boolean} [opt.useAppServer=true] 輸入是否以app-server為主路徑布林值，false代表直接走備援端點，預設true
 * @param {Boolean} [opt.fallbackHttp=true] 輸入app-server失敗時是否退回備援端點布林值，預設true
 * @param {String} [opt.codexHome] 輸入codex設定目錄字串，僅備援路徑讀其auth.json時生效；app-server主路徑之子進程繼承本進程環境，查的是本進程CODEX_HOME所指之帳號，不受此參數影響（要讓主路徑查別的目錄，須於本進程環境設CODEX_HOME，或以useAppServer:false改走備援），預設取環境變數CODEX_HOME，未設則<homeDir>/.codex
 * @param {String} [opt.homeDir=os.homedir()] 輸入家目錄字串，僅於未指定codexHome且未設環境變數時使用
 * @param {String} [opt.userAgent='codex-cli/0.153.0'] 輸入備援端點之User-Agent字串
 * @param {String} [opt.originator='codex_cli_rs'] 輸入備援端點之originator標頭字串
 * @param {String} [opt.usageUrl='https://chatgpt.com/backend-api/wham/usage'] 輸入備援端點網址字串，供測試指向假伺服器或經企業代理，預設官方端點
 * @param {Object} [opt.env=process.env] 輸入環境變數來源物件(讀CODEX_HOME與API key模式判定用之OPENAI_API_KEY)，供測試隔離本機環境，預設process.env
 * @param {Number} [opt.timeoutMs=20000] 輸入逾時毫秒正整數(app-server整體或單次HTTP)，預設20000
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok、provider('codex')、email、matched、plan(例如'plus')、planTier(空字串)、source('codex-app-server'或'chatgpt-wham-usage-api')、windows(含5小時與7天，另有依limitId分列之窗口)、credits(點數、重置券清單、限額狀態)、raw、error、errorType、durationMs，本函數不會reject
 * @example
 * //need codex cli logged in
 *
 * import getQuotaCodex from './src/quota/getQuotaCodex.mjs'
 *
 * let test = async () => {
 *     let r = await getQuotaCodex('firsemisphere@gmail.com')
 *     console.log(r.ok, r.plan, r.source)
 *     // => true plus codex-app-server
 *     console.log(r.windows[0].label, r.windows[0].usedPercent)
 *     // => 5小時 37 (百分比為查詢當下之即時值, 每次不同)
 * }
 * test()
 *
 */
async function getQuotaCodex(email = '', opt = {}) {

    let t0 = Date.now()

    //emailWant
    let emailWant = isestr(email) ? email : ''

    //env, 環境變數來源可注入(測試以替身隔離本機環境), 預設process.env
    let env = get(opt, 'env', null)
    if (!isobj(env)) {
        env = process.env
    }

    //homeDir
    let homeDir = get(opt, 'homeDir', null)
    if (!isestr(homeDir)) {
        homeDir = os.homedir()
    }

    //codexHome, 依序取opt、CODEX_HOME、<homeDir>/.codex(codex --help: auth still uses CODEX_HOME);
    //僅備援路徑用, app-server主路徑之子進程繼承本進程環境而不看此值(見檔頭)
    let codexHome = get(opt, 'codexHome', null)
    if (!isestr(codexHome)) {
        codexHome = get(env, 'CODEX_HOME', '')
        if (!isestr(codexHome)) {
            codexHome = path.join(homeDir, '.codex')
        }
    }

    //timeoutMs
    let timeoutMs = castPintOr(get(opt, 'timeoutMs', null), dfQuotaTimeoutMs)

    //useAppServer與fallbackHttp
    let useAppServer = get(opt, 'useAppServer', true) !== false
    let fallbackHttp = get(opt, 'fallbackHttp', true) !== false

    //fin
    let fin = (source, o) => {
        return toQuotaResult('codex', {
            emailWant,
            source,
            durationMs: Date.now() - t0,
            ...o,
        })
    }

    //app-server
    let appErr = null
    if (useAppServer) {
        let a = await viaAppServer({ ...opt, timeoutMs })
        if (a.ok) {
            return fin('codex-app-server', {
                email: a.email,
                plan: a.plan,
                windows: a.windows,
                credits: a.credits,
                raw: { accountType: a.accountType, ...a.raw },
            })
        }

        //unsupported與「尚未登入」(notLoggedIn旗標, 不靠錯誤字串比對)為帳號狀態, 備援亦無解, 直接回報
        if (a.errorType === 'unsupported' || a.notLoggedIn === true) {
            return fin('codex-app-server', { email: a.email, plan: a.plan, error: a.error, errorType: a.errorType, raw: a.raw })
        }
        appErr = a
        if (!fallbackHttp) {
            return fin('codex-app-server', { error: a.error, errorType: a.errorType, raw: a.raw })
        }
    }

    //http fallback
    let h = await viaHttp(opt, codexHome, timeoutMs)
    let note = appErr !== null ? ` (app-server path failed: ${appErr.error})` : ''
    if (!h.ok) {
        return fin('chatgpt-wham-usage-api', {
            email: h.email,
            plan: h.plan,
            error: `${h.error}${note}`,
            errorType: h.errorType,
            raw: appErr !== null ? appErr.raw : null,
        })
    }
    return fin('chatgpt-wham-usage-api', {
        email: h.email,
        plan: h.plan,
        windows: h.windows,
        credits: h.credits,
        raw: { codexHome, appServerError: appErr !== null ? appErr.error : '', ...h.raw },
    })
}


export default getQuotaCodex
