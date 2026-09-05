import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'


// toQuotaResult.mjs — 將各家額度查詢結果正規化為統一結構, 並判定帳號是否相符
//
// 【email在此類查詢中的真實角色】三家訂閱額度皆綁定「本機該CLI當前登入之憑證」，
//   無任一家提供「給email即可查任意帳號額度」之公開介面(那將是帳號列舉漏洞)。
//   故email之作用為比對——查出本機實際登入者，與呼叫端指定之email核對，
//   相符才視為查到「該帳號」之額度。此設計於一機多帳號(實測本機claude/codex/agy
//   分屬不同gmail)之情境尤其必要，否則呼叫端會把甲帳號的額度當成乙帳號的。
//
// 【為何不符時仍回傳額度資料】資料已取得，丟棄只是浪費一次往返；
//   但ok一律為false且matched為false，令呼叫端不會誤把他人額度當成指定帳號之額度。
//
// 【source欄位】各轉接器可能有主路徑與備援(例如codex以app-server為主、HTTP為備援)，
//   同一供應商回來的資料可能來自不同介面，呼叫端排錯時須知道走了哪條，故獨立一欄記錄。


/**
 * 將各家額度查詢結果正規化為統一結構，並判定帳號是否相符
 *
 * 帳號比對採去空白且不分大小寫之比較，因email本地部分雖理論上區分大小寫，
 * 但三家供應商實務上皆以不分大小寫視為同一帳號；
 * 未指定email時不做比對，matched為null，ok僅取決於查詢本身是否成功
 *
 * @param {String} provider 輸入供應商種類字串，例如'claude'、'codex'、'antigravity'
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.email=''] 輸入本機該CLI實際登入之帳號email字串，預設''代表無從取得
 * @param {String} [opt.emailWant=''] 輸入呼叫端指定欲查詢之帳號email字串，預設''代表不比對
 * @param {String} [opt.plan=''] 輸入方案別字串，例如'max'、'plus'，預設''
 * @param {String} [opt.planTier=''] 輸入方案細部級距字串，例如'default_claude_max_20x'，預設''
 * @param {String} [opt.source=''] 輸入資料來源介面字串，例如'oauth-usage-api'、'codex-app-server'、'agy-print'，預設''
 * @param {Array} [opt.windows=[]] 輸入額度窗口物件陣列，預設[]
 * @param {Object} [opt.credits=null] 輸入額外用量或點數資訊物件，預設null代表該供應商無此概念或未啟用
 * @param {Object} [opt.raw=null] 輸入供應商原始回應物件，預設null
 * @param {String} [opt.error=''] 輸入錯誤訊息字串，預設''代表查詢成功
 * @param {String} [opt.errorType=''] 輸入機器可讀之錯誤類別字串，預設''
 * @param {Number} [opt.durationMs=0] 輸入耗時毫秒，預設0
 * @returns {Object} 回傳結果物件，內含ok(查詢成功且帳號相符布林值)、provider、email(本機實際登入帳號)、matched(帳號是否相符布林值，未指定email時為null)、plan、planTier、source、windows(窗口陣列)、credits、raw、error、errorType、durationMs
 * @example
 *
 * import toQuotaResult from './src/quota/toQuotaResult.mjs'
 *
 * let r = toQuotaResult('claude', { email: 'a@b.com', emailWant: 'c@d.com' })
 * console.log(r.ok, r.matched)
 * // => false false
 *
 */
function toQuotaResult(provider, opt = {}) {

    //provider
    if (!isestr(provider)) {
        provider = ''
    }

    //email, 本機該CLI實際登入之帳號
    let email = get(opt, 'email', '')
    if (!isestr(email)) {
        email = ''
    }

    //emailWant, 呼叫端指定欲查詢之帳號
    let emailWant = get(opt, 'emailWant', '')
    if (!isestr(emailWant)) {
        emailWant = ''
    }

    //error
    let error = get(opt, 'error', '')
    if (!isestr(error)) {
        error = ''
    }

    //errorType
    let errorType = get(opt, 'errorType', '')
    if (!isestr(errorType)) {
        errorType = ''
    }

    //matched, 未指定emailWant時不比對(null); 指定但無從取得本機帳號時視為不符並補述原因
    let matched = null
    if (emailWant !== '') {
        if (email === '') {
            matched = false
            if (error === '') {
                error = `cannot determine the local ${provider} login account, so it is unknown whether it is the requested account [${emailWant}]`
                errorType = 'account'
            }
        }
        else {
            matched = email.trim().toLowerCase() === emailWant.trim().toLowerCase()
            if (!matched && error === '') {
                error = `local ${provider} login account is [${email}], which does not match the requested account [${emailWant}]`
                errorType = 'account'
            }
        }
    }

    //windows
    let windows = get(opt, 'windows', null)
    if (!isearr(windows)) {
        windows = []
    }

    //plan與planTier與source
    let plan = get(opt, 'plan', '')
    if (!isestr(plan)) {
        plan = ''
    }
    let planTier = get(opt, 'planTier', '')
    if (!isestr(planTier)) {
        planTier = ''
    }
    let source = get(opt, 'source', '')
    if (!isestr(source)) {
        source = ''
    }

    //ok, 須查詢無誤且帳號相符(未指定email時視為相符)
    let ok = error === '' && matched !== false

    return {
        ok,
        provider,
        email,
        matched,
        plan,
        planTier,
        source,
        windows,
        credits: get(opt, 'credits', null),
        raw: get(opt, 'raw', null),
        error,
        errorType,
        durationMs: get(opt, 'durationMs', 0),
    }
}


export default toQuotaResult
