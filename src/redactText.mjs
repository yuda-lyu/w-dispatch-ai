import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import genDiagStreamMasker from 'wsemi/src/genDiagStreamMasker.mjs'


// redactText.mjs — 錯誤訊息與輸出中之機密值遮蔽(本套件對wsemi共用遮罩之單一入口)
//
// 【為何獨立成檔】額度查詢(fetchQuotaJson)與三家REST轉接器之錯誤訊息皆可能夾帶機密值:
//   前者為對端回顯之請求標頭, 後者為fetch在送出前驗標頭時之例外——金鑰含換行等非法字元時,
//   undici之訊息為「Headers.append: "Bearer <完整金鑰>" is an invalid header value.」,
//   經遞補層流入tried、事件與日誌(2026-10-14實測)。兩處共用同一遮蔽規則, 不各自手寫。
//
// 【單一實作(dspec〈診斷輸出與遮罩〉D1; 2026-11-24 tdai4起)】本檔不自寫遮罩, 全部交wsemi之串流遮罩器(genDiagStreamMasker;
//   規則與maskDiagText同一套: 已知機密值、網址帳密、憑證鍵值對、Bearer、opt.patterns), 遮罩字樣一律為'***'。
//   本檔保留為單一入口(而非讓各站點直接呼叫wsemi)之理由: ①機密值長度下限(SECRET_MIN_LEN)與兩種遮罩家族之設定只定義一處,
//   各站點不各自重複; ②金鑰樣式集(DIAG_PATTERNS)只在本檔定義一份, 診斷家族與failureDiag.mjs之maskDiag共用同一個陣列(2026-11-24 tdai4b);
//   ③secretHeaderValues為本套件之標頭政策; ④結果欄位遮蔽(redactResult)與回調遮蔽(maskStreamCallbacks)之作法由dispatchClaude與dispatchOpencode共用。
//   非串流入口亦以串流遮罩器實作(整段push一次再flush), 而不用maskDiagText: maskDiagText對超過20000字元者只輸出前20000字元並接「…(len=原長)」,
//   但成功之stdout為模型輸出(可達數萬字元)不得被截斷, 且下游strTruncate以遮蔽後長度標註原始總長度; 串流遮罩器輸出全文,
//   每列之結果等於maskDiagText(該列), 故兩者規則一致、唯長度不截; 另一差異(wsemi已知限制): 未登錄之憑證值若為引號或中括號包住且內含換行,
//   只遮至該列結尾、不跨列(已登錄之機密值不受影響, 含換行者亦整段遮到)。
//
// 【兩個遮罩家族】(串流與非串流同一家族同一設定, 同一段文字經onStdout/onStderr回調與結果物件所見一致)
//   ①精確家族(redactText、串流stdout): 只遮已登錄之機密值, 不套任何樣式(wsemi opt.credPatterns為false)——供模型輸出等不宜以樣式判定之文字
//     (合法內容可含「sk-ant-api03-…」或「password=…」範例字樣, 如金鑰說明文件之摘要)。
//   ②診斷家族(redactApiKeyText、maskApiKeys、串流stderr): 已登錄之機密值＋金鑰樣式集(DIAG_PATTERNS: sk-ant-、sk-／oc_sk_、AIza、ghp_、JWT、wrk_)
//     ＋wsemi內建憑證樣式(網址帳密、password／token／secret／authorization／api-key鍵值對、Bearer)——供失敗結果與診斷輸出。
//
// 【串流以列為單位】createStreamRedactor之輸出以列為單位: 收到換行才交出該列, 最後無換行之一段於flush交出(與切塊方式無關);
//   跨塊或跨列之機密值整段遮到。2026-11-24前為逐塊即時(只保留可能為機密值開頭之尾端), 現回調可能較晚才收到文字。


//機密值長度下限; 短於此長度之機密值不遮(避免把常見短字串誤遮成無法閱讀); 由本檔之呼叫入口過濾, wsemi之遮罩器不設下限
let SECRET_MIN_LEN = 6


// 【Anthropic金鑰樣式遮蔽(2026-10-24, dispatchClaude之key與dispatchApiAnthropic共用)】
//   Anthropic金鑰一律以sk-ant-開頭(sk-ant-api03-…、sk-ant-admin01-…等)。除遮蔽「本次注入之金鑰本身」外,
//   另以樣式遮蔽失敗輸出中的sk-ant-字樣: 子進程輸出或錯誤本體經strTruncate等截斷後, 金鑰可能只剩前段(殘段仍含金鑰前綴實質內容),
//   精確比對遮蔽不到; 他把金鑰(例如CLI回顯另一組設定)亦同。後綴至少4字元才遮蔽, 更短者無實質內容, 保留以免誤遮一般字串。
//   僅用於「失敗結果與診斷輸出」: 成功結果中模型的輸出可能合法含「sk-ant-api03-…」範例字樣(如金鑰說明文件之摘要), 不套用樣式遮蔽。
//   無g旗標(wsemi之opt.patterns自動加g與d旗標)
let API_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{4,}/

//金鑰樣式集(單一定義; 診斷家族與failureDiag.mjs之maskDiag共用, 2026-11-24 tdai4b自failureDiag.mjs移入並與診斷家族收斂為一份), 交wsemi以opt.patterns執行(re自動加g與d旗標):
//sk-ant-(Anthropic金鑰)、sk-／oc_sk_(OpenAI相容與OpenCode金鑰)、AIza(Google API金鑰)、ghp_等(GitHub權杖)、JWT(eyJ…三段)、
//wrk_(opencode Console工作區代號, 帳號識別; 有長度下限, `wrk_ab12`等短詞不遮)
let DIAG_PATTERNS = [
    { re: API_KEY_PATTERN },
    { re: /\b(?:sk|oc_sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/ },
    { re: /\bAIza[0-9A-Za-z_-]{30,}/ },
    { re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
    { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
    //opencode Console之工作區代號(wrk_ + 8碼以上英數; 訂閱到頂之錯誤文字內之網址帶此代號: https://opencode.ai/console/wrk_…/go)——非金鑰, 屬帳號識別, 不隨診斷文字外流(2026-11-16 wda158, Gitea #158)
    { re: /\bwrk_[A-Za-z0-9]{8,}/ },
]

//兩個遮罩家族之wsemi設定(見檔頭【兩個遮罩家族】)
let OPT_EXACT = { credPatterns: false }
let OPT_DIAG = { patterns: DIAG_PATTERNS }


/**
 * 取可交給wsemi遮罩器之機密值清單：非陣列視為空，非字串與長度不足6者略過；每個機密值另展開去頭尾空白與去Bearer前綴之變體(各須達長度下限)
 *
 * @param {Array} secrets 輸入機密值陣列
 * @returns {Array} 回傳機密值字串陣列
 */
function secretList(secrets) {
    let out = []
    for (let v of (Array.isArray(secrets) ? secrets : [])) {
        if (!isestr(v)) {
            continue
        }

        //變體: 原值、去頭尾空白(fetch送出前會去掉標頭值之頭尾空白, 伺服器回顯之金鑰即為去空白者)、再去Authorization之Bearer前綴(伺服器常回顯去前綴之本體);
        //各變體須達長度下限(原值之下限判定同修前: 長度不足者不處理); 各變體另展開JSON跳脫形(含引號、反斜線、換行等之金鑰,
        //於伺服器回應之JSON文字或本轉接器之JSON.stringify結果內已被跳脫, 原值比對不到; 2026-11-25 t628獨立複審L1)
        let t = v.trim()
        for (let x of [v, t, t.replace(/^Bearer\s+/i, '')]) {
            if (x.length < SECRET_MIN_LEN) {
                continue
            }
            for (let y of [x, JSON.stringify(x).slice(1, -1)]) {
                if (!out.includes(y)) {
                    out.push(y)
                }
            }
        }
    }
    return out
}


/**
 * 全文遮罩(不截長度)：整段交串流遮罩器一次push再flush，輸出等於逐列之maskDiagText結果
 *
 * @param {*} text 輸入文字，非字串以String轉換
 * @param {Array} secrets 輸入機密值陣列
 * @param {Object} opt 輸入wsemi遮罩器設定
 * @returns {String} 回傳遮罩後文字
 */
function maskFull(text, secrets, opt) {
    let sm = genDiagStreamMasker(secretList(secrets), opt)
    return sm.push(String(text)) + sm.flush()
}


/**
 * 將文字中之機密值替換為遮蔽字(精確家族：只遮蔽已登錄之機密值，不套樣式；字樣'***')
 *
 * @param {String} text 輸入文字
 * @param {Array} redact 輸入機密值字串陣列，長度不足6者不處理
 * @returns {String} 回傳替換後文字
 * @example
 *
 * import redactText from './src/redactText.mjs'
 *
 * console.log(redactText('Headers.append: "Bearer sk-abc\nX" is an invalid header value.', ['Bearer sk-abc\nX']))
 * // => 'Headers.append: "***" is an invalid header value.'
 *
 */
function redactText(text, redact) {
    return maskFull(text, redact, OPT_EXACT)
}


//已知非憑證之標頭名稱(小寫): 其值不視為機密(否則呼叫端自給之Accept、HTTP-Referer、X-Title等之值出現於錯誤本體時被誤遮成***, 無從診斷);
//預設拒絕: 此表以外之標頭(Authorization、x-api-key、呼叫端自訂者等)一律視為機密
let NON_SECRET_HEADERS = ['content-type', 'accept-encoding', 'accept', 'accept-language', 'user-agent', 'referer', 'http-referer', 'x-title', 'origin', 'host', 'connection', 'cache-control', 'content-length']


/**
 * 取請求標頭中須遮蔽之值：已知非憑證之標頭(Content-Type、Accept-Encoding、Accept、User-Agent、Referer、HTTP-Referer、X-Title等)以外一律視為機密(Authorization、x-api-key等)
 *
 * @param {Object} headers 輸入請求標頭物件
 * @returns {Array} 回傳須遮蔽之標頭值字串陣列
 * @example
 *
 * import { secretHeaderValues } from './src/redactText.mjs'
 *
 * console.log(secretHeaderValues({ 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-abc' }))
 * // => [ 'Bearer sk-abc' ]
 *
 */
function secretHeaderValues(headers) {
    let r = []
    let hs = (headers && typeof headers === 'object') ? headers : {}
    for (let k of Object.keys(hs)) {
        if (NON_SECRET_HEADERS.includes(k.toLowerCase())) {
            continue
        }
        //值為undefined／null者(呼叫端給了undefined之標頭值, fetch送出前字串化為'undefined'／'null')不是任何憑證, 不登錄(否則合法模型輸出中之'undefined'字樣於成功路徑被改成***; 2026-11-25 t628獨立複審M1)
        if (isestr(hs[k]) && hs[k] !== 'undefined' && hs[k] !== 'null') {
            r.push(hs[k])
        }
    }
    return r
}


/**
 * 遮蔽文字中sk-ant-形式之Anthropic金鑰(含被截斷而只剩前段之殘段；後綴不足4字元者保留)；診斷家族，另遮蔽wsemi內建憑證樣式
 *
 * @param {String} text 輸入文字
 * @returns {String} 回傳替換後文字
 * @example
 *
 * import { maskApiKeys } from './src/redactText.mjs'
 *
 * console.log(maskApiKeys('key=sk-ant-api03-ABCDEF_123-xyz end'))
 * // => 'key=*** end'
 *
 */
function maskApiKeys(text) {
    return maskFull(text, [], OPT_DIAG)
}


/**
 * 遮蔽指定機密值與sk-ant-形式之Anthropic金鑰(診斷家族：失敗結果與診斷輸出之單一入口；另遮蔽wsemi內建憑證樣式：網址帳密、password／token／secret／authorization／api-key鍵值對、Bearer)
 *
 * @param {String} text 輸入文字
 * @param {Array} redact 輸入機密值字串陣列，長度不足6者不處理
 * @returns {String} 回傳替換後文字
 * @example
 *
 * import { redactApiKeyText } from './src/redactText.mjs'
 *
 * console.log(redactApiKeyText('a MYSECRET-VALUE b sk-ant-api03-OTHER-1 c', ['MYSECRET-VALUE']))
 * // => 'a *** b *** c'
 *
 */
function redactApiKeyText(text, redact) {
    return maskFull(text, redact, OPT_DIAG)
}


//redactDeep走訪之深度上限(JSON.parse之結果可任意深); 超過者整段以遮蔽字取代(fail-closed, 不原樣放行)
let DEEP_MAX = 64


/**
 * 深層遮蔽值中之機密值：走訪純物件與陣列(回應本體經JSON.parse所得者)，所有字串值與屬性名皆遮蔽，回傳新值(原值不動)；其餘型別(數字、布林、null)原樣
 *
 * 供REST轉接器遮蔽取自伺服器回應之結構化外來文字(usage、answers)；僅供JSON.parse之產物(純物件、陣列、字串、數字、布林、null)，其他型別(Map、Date、類別實例、存取器等)非設計對象；
 * 永不拋錯：走訪失敗(如存取器拋錯)時回傳null(fail-closed，不原樣放行)；字樣、家族與redactText／redactApiKeyText相同(diag為true時走診斷家族，另遮蔽金鑰樣式集與內建憑證樣式)。
 * 屬性名遮蔽後同名者後者覆寫前者(屬性名含機密值之極端情形)；超過深度上限(64層)之子樹改為其JSON序列化文字整段遮蔽後之字串(序列化失敗者為null)；以defineProperty建立屬性，不因'__proto__'等屬性名改動原型
 *
 * @param {*} v 輸入值(通常為JSON.parse所得之物件、陣列或字串)
 * @param {Array} secrets 輸入機密值字串陣列，長度不足6者不處理
 * @param {Boolean} [diag=false] 輸入是否用診斷家族，預設false(精確家族，只遮蔽機密值；供模型輸出)
 * @returns {*} 回傳遮蔽後之新值
 * @example
 *
 * import { redactDeep } from './src/redactText.mjs'
 *
 * console.log(redactDeep({ a: 'key=SECRET-VALUE-1', n: 3, l: ['SECRET-VALUE-1'] }, ['SECRET-VALUE-1']))
 * // => { a: 'key=***', n: 3, l: [ '***' ] }
 *
 */
function redactDeep(v, secrets, diag = false) {
    try {
        return redactDeepCore(v, secrets, diag)
    }
    catch {
        return null //永不拋錯、fail-closed: 走訪失敗(如存取器拋錯)時整個值捨棄, 不原樣放行(2026-11-25 t628獨立複審C3)
    }
}


//redactDeep之本體(可拋錯, 由redactDeep包裝)
function redactDeepCore(v, secrets, diag) {
    let sm = genDiagStreamMasker(secretList(secrets), diag ? OPT_DIAG : OPT_EXACT)
    let mask = (s) => sm.push(s) + sm.flush() //flush後遮罩器重設, 可重複使用於下一個字串
    let walk = (x, depth) => {
        if (typeof x === 'string') {
            return mask(x)
        }
        if (x === null || typeof x !== 'object') {
            return x
        }
        if (depth >= DEEP_MAX) {
            try {
                return mask(JSON.stringify(x)) //過深之子樹整段序列化後當一個字串遮蔽(不再走訪; 不原樣放行); 序列化失敗者捨棄
            }
            catch {
                return null
            }
        }
        if (Array.isArray(x)) {
            return x.map((e) => walk(e, depth + 1))
        }
        let o = {}
        for (let [k, e] of Object.entries(x)) {
            Object.defineProperty(o, mask(k), { value: walk(e, depth + 1), enumerable: true, writable: true, configurable: true })
        }
        return o
    }
    return walk(v, 0)
}


/**
 * 建立串流遮蔽器：逐塊餵入文字，回傳此時可安全輸出之已遮蔽文字(可為空字串)；以列為單位，收到換行才交出該列，結束時須呼叫flush()取回其餘(最後無換行之一段)
 *
 * 特點：
 * 交wsemi之genDiagStreamMasker執行(規則見檔頭【單一實作】)，每列之輸出等於對該列做文字遮罩，與切塊方式無關；
 * 跨塊或跨列被切開之機密值整段遮到；塊可為字串或二進位(以UTF-8串流解碼)；
 * 供CLI之onStdout／onStderr回調使用(execCli逐塊呼叫，金鑰可能被切在兩塊之間)
 *
 * @param {Array} secrets 輸入機密值字串陣列，長度不足6者不處理(同redactText)
 * @param {Boolean} [pattern=false] 輸入是否用診斷家族(另遮蔽`sk-ant-`樣式與內建憑證樣式；供stderr)，預設false(精確家族，只遮蔽機密值；供stdout)
 * @returns {Object} 回傳物件，內含push(chunk)=>已遮蔽文字字串、flush()=>其餘已遮蔽文字字串
 * @example
 *
 * import { createStreamRedactor } from './src/redactText.mjs'
 *
 * let rd = createStreamRedactor(['sk-ant-api03-SECRET-123456'])
 * let out = rd.push('key=sk-ant-api03-SEC') + rd.push('RET-123456 end\nnext') + rd.flush()
 * console.log(out)
 * // => 'key=*** end\nnext'
 *
 */
function createStreamRedactor(secrets, pattern = false) {
    return genDiagStreamMasker(secretList(secrets), pattern ? OPT_DIAG : OPT_EXACT)
}


/**
 * 遮蔽CLI結果物件中之機密值(stdout／stderr／error與errorDetail之尾段；淺拷貝)：成功之stdout屬模型輸出走精確家族，失敗之stdout、stderr、error走診斷家族
 *
 * errorDetail(stderrTail、stdoutTail、upstream)於runExecCli／dispatchOpencode已遮罩，此處再套同規則作最後防線(冪等)
 *
 * @param {Object} r 輸入execCli結果物件
 * @param {Array} secrets 輸入機密值字串陣列
 * @returns {Object} 回傳遮蔽後之結果物件(淺拷貝)
 * @example
 *
 * import { redactResult } from './src/redactText.mjs'
 *
 * console.log(redactResult({ ok: true, stdout: 'key=SECRET-VALUE-1', stderr: '' }, ['SECRET-VALUE-1']))
 * // => { ok: true, stdout: 'key=***', stderr: '' }
 *
 */
function redactResult(r, secrets) {
    let out = { ...r }
    if (typeof out.stdout === 'string') {
        out.stdout = out.ok === true ? redactText(out.stdout, secrets) : redactApiKeyText(out.stdout, secrets)
    }
    if (typeof out.stderr === 'string') {
        out.stderr = redactApiKeyText(out.stderr, secrets)
    }
    if (typeof out.error === 'string') {
        out.error = redactApiKeyText(out.error, secrets)
    }
    if (out.errorDetail && typeof out.errorDetail === 'object') {
        let d = { ...out.errorDetail }
        for (let k of ['stderrTail', 'stdoutTail', 'upstream']) {
            if (typeof d[k] === 'string') {
                d[k] = redactApiKeyText(d[k], secrets)
            }
        }
        out.errorDetail = d
    }
    return out
}


/**
 * 以串流遮罩器包住呼叫端自給之onStdout／onStderr(就地改寫optCli)：回調收到已遮蔽之文字(以列為單位；stdout精確家族、stderr診斷家族)，回傳之函數於子進程結束後補送結尾無換行之一段
 *
 * 只包函數型之回調(非函數者視同未給，不動)；push／flush回傳非空字串才轉交回調；補送時回調拋錯不外拋(屬呼叫端回調)。
 * 須於其他包裝(如判讀事件流、擷取尾段之包裝)之前呼叫，令內部包裝仍收原文、只有呼叫端之回調收遮蔽文字
 *
 * @param {Object} optCli 輸入轉傳execCli之設定物件(可含onStdout、onStderr；將被就地改寫)
 * @param {Array} secrets 輸入機密值字串陣列
 * @returns {Function} 回傳補送函數，無參數，於子進程結束後呼叫一次(永不拋錯)
 * @example
 *
 * import { maskStreamCallbacks } from './src/redactText.mjs'
 *
 * let got = []
 * let opt = { onStdout: (s) => got.push(s) }
 * let flush = maskStreamCallbacks(opt, ['SECRET-VALUE-1'])
 * opt.onStdout('key=SECRET-VAL')
 * opt.onStdout('UE-1\nrest')
 * flush()
 * console.log(got)
 * // => [ 'key=***\n', 'rest' ]
 *
 */
function maskStreamCallbacks(optCli, secrets) {
    let flushers = []
    for (let [name, pattern] of [['onStdout', false], ['onStderr', true]]) {
        let fn = optCli[name]
        if (isfun(fn)) {
            let rd = createStreamRedactor(secrets, pattern)
            optCli[name] = (chunk) => {
                let s = rd.push(chunk)
                if (s !== '') {
                    fn(s)
                }
            }
            flushers.push(() => {
                let s = rd.flush()
                if (s !== '') {
                    fn(s)
                }
            })
        }
    }
    return () => {
        for (let flush of flushers) {
            try {
                flush()
            }
            catch {}
        }
    }
}


export default redactText
export { secretHeaderValues, maskApiKeys, redactApiKeyText, redactDeep, createStreamRedactor, redactResult, maskStreamCallbacks, API_KEY_PATTERN, DIAG_PATTERNS, SECRET_MIN_LEN }
