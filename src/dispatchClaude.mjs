import get from 'lodash-es/get.js'
import omit from 'lodash-es/omit.js'
import isbol from 'wsemi/src/isbol.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import getCliArgs from './getCliArgs.mjs'
import getErrorResult from './getErrorResult.mjs'
import runExecCli from './runExecCli.mjs'
import { asText, readCallerObj } from './callUserFn.mjs'
import castPintOr from './castPintOr.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'
import redactText, { redactApiKeyText, createStreamRedactor } from './redactText.mjs'


// dispatchClaude.mjs — 以Claude Code CLI呼叫Claude模型
//
// 【調用方式】參考全域技能dispatch-claude之慣例，依專案方針「不直接引用全域技能」，
//   將其調用方式移植於此，方便本專案自行偵錯、修改與擴充。
//   2026-08-08於本機實測：`claude -p --dangerously-skip-permissions --model sonnet` + stdin
//   可正確產出合規JSON摘要(15.5s)。
//
// 【認證——兩種模式, 由opt.key有無決定】
//   ① 未給key(預設, 行為與2026-10-24前完全相同): 沿用Claude Code既有登入狀態(帳號層級, 訂閱額度)——
//      輪替時它是「一個獨立的供應商」而非「另一把金鑰」(如providers.mjs之claude:條目)。
//   ② 給key(2026-10-24起): 以Anthropic Console之API金鑰計費(與Claude訂閱額度分開計費), 供要工具之派工使用
//      (純文字派工請用kind api-anthropic, 見dispatchApiAnthropic.mjs與adapters.mjs之選型判準)。
//      key「只」注入該次子進程的環境變數ANTHROPIC_API_KEY, 不寫入process.env(並行呼叫可各帶不同key)、
//      不進命令列參數(ps可見)、不出現於回傳物件(stdout/stderr/error經遮蔽, 見下)。
//
// 【key模式之憑證優先序——為何要自子進程環境移除其他憑證變數(2026-10-24查官方authentication文件)】
//   Claude Code同時有多種憑證時依序擇一(序位高者勝出):
//     1. 雲端供應商選擇器: CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY/MANTLE/ANTHROPIC_AWS(另有已登入之gateway工作階段, 屬登入態不經環境變數)
//     2. ANTHROPIC_AUTH_TOKEN(Authorization: Bearer)
//     3. ANTHROPIC_API_KEY(X-Api-Key; 互動模式須核可一次, -p「一律使用」)   ← 本模式要勝出者
//     4. apiKeyHelper(settings之腳本)  5. CLAUDE_CODE_OAUTH_TOKEN(claude setup-token之長效權杖)
//     6. Anthropic profile/federation(ANTHROPIC_PROFILE、ANTHROPIC_FEDERATION_RULE_ID等)  7. 訂閱OAuth(/login)
//   故序位高於3者(1、2)若殘留於父環境或opt.env, 會蓋過key而悄悄走別的計費/路徑, 給key時一律自子進程環境移除;
//   序位低於3者(5、6)目前不會蓋過key, 為防日後改序一併移除(縱深防禦)。移除只作用於該次子進程, 不動本進程環境。
//   無法由環境變數處理而仍可能蓋過者: 使用者settings.json之env區塊重新設入上述變數、已登入之gateway工作階段、ANTHROPIC_BASE_URL將請求導向他處
//   ——故「確實走API金鑰」須以實際輸出驗證, 不以本層之設定推定: 加`--output-format stream-json --verbose`時,
//   首個system/init事件之apiKeySource為'ANTHROPIC_API_KEY'是「走API金鑰」之必要條件(四種值: ANTHROPIC_API_KEY | apiKeyHelper | /login managed key | none,
//   none代表以登入態/bearer/雲端供應商認證); 但它只證明來源「種類」, 不證明是「本次傳入的那把key」或預期的Console/端點
//   (例如settings.json之env區塊另設了ANTHROPIC_API_KEY、或ANTHROPIC_BASE_URL導向他處時, 來源仍顯示ANTHROPIC_API_KEY)——
//   故另須核對Console之用量/費用(對應該把key所屬組織/工作區)與實際端點(詳README「Claude以API金鑰計費」)。
//
// 【key模式——繼承之父session連結變數(2026-10-25 dispatch-run03; 主控以Claude Code 2.1.302實測)】
//   本函數在Claude Code工作階段內被呼叫時(例如主控agent派工), 子進程會繼承父session注入之連結變數
//   (CLAUDECODE、CLAUDE_CODE_CHILD_SESSION、CLAUDE_CODE_ENTRYPOINT、CLAUDE_CODE_MESSAGING_SOCKET、CLAUDE_CODE_MESSAGING_TOKEN、CLAUDE_CODE_SESSION_ID、
//   CLAUDE_AGENT_SDK_VERSION、CLAUDE_PID、CLAUDE_EFFORT等): 子claude因而沿用父session之登入, 即使環境有ANTHROPIC_API_KEY, init事件之apiKeySource仍為none(訂閱登入, 未走API計費)。
//   主控探測: 全部繼承+ANTHROPIC_API_KEY → none; 移除繼承之CLAUDE_CODE_*、CLAUDE_AGENT_SDK_VERSION、CLAUDE_PID、CLAUDE_EFFORT後 → ANTHROPIC_API_KEY
//   (stderr並出現「claude.ai connectors are disabled because ANTHROPIC_API_KEY … takes precedence」)。
//   官方env-vars文件只載明這些變數「由Claude Code設定」, 未載明巢狀session如何沿用登入; 元兇是哪一個變數未逐一隔離(本套件未自行啟動真實claude探測), 故以前綴規則整批移除。
//   規則(僅key模式; 僅作用於「繼承自process.env」者, 不動本進程環境):
//     移除: 前綴CLAUDE_CODE_、CLAUDE_AGENT_SDK_, 與完整名稱CLAUDECODE、CLAUDE_PID、CLAUDE_EFFORT、CLAUDE_JOB_DIR(Windows下名稱不分大小寫)。
//     保留(例外): CLAUDE_CODE_GIT_BASH_PATH——它是使用者設定而非父session注入; Windows上Git Bash不在PATH時claude靠它找Bash, 移除會令子進程無法啟動工具。
//     呼叫端以opt.env明確傳入者保留(同名以呼叫端值為準, 值為undefined者維持移除); 要保留某使用者設定(如CLAUDE_CODE_EFFORT_LEVEL、CLAUDE_CODE_USE_POWERSHELL_TOOL)請由opt.env傳入。
//     憑證類(CLAUDE_CODE_USE_*、CLAUDE_CODE_OAUTH_TOKEN等)仍依上節規則一律移除, 含opt.env中者。
//   「整批移除CLAUDE_CODE_*會否誤刪必要變數」之判斷(依官方env-vars文件, 未實測): CLAUDE_CODE_*中絕大多數是行為偏好(TMPDIR、SHELL、USE_POWERSHELL_TOOL、EFFORT_LEVEL、SUBAGENT_MODEL、PLUGIN_*等),
//     子進程缺它們只是回到預設而非失效; 唯一「缺了即可能無法啟動」者是Windows之CLAUDE_CODE_GIT_BASH_PATH, 故列為保留。日後若發現其他必要變數, 加進LINK_KEEP即可。
//   不處理: CLAUDE_CONFIG_DIR(非上述前綴; 決定設定/登入目錄, 屬使用者設定)、ANTHROPIC_BASE_URL等。
//   未給key時完全不處理(行為與舊版相同, 繼承之連結變數照舊流入)。
//   這是令key「有機會勝出」之必要修正而非證明: 是否確實走API金鑰仍以apiKeySource==='ANTHROPIC_API_KEY'(必要條件)加Console用量(充分條件)驗證, 見上節。
//
// 【key之不外洩(帳本R-ANTHROPIC-1)】
//   ①結果物件之stdout/stderr/error以redactText遮蔽key本身; stderr與error與失敗結果之stdout另以sk-ant-樣式遮蔽(殘段與他把金鑰);
//     成功之stdout為模型輸出, 只遮蔽key本身而不套樣式(合法內容可含「sk-ant-api03-…」範例字樣)。
//   ②呼叫端自給之onStdout/onStderr回調(例如把串流寫入stdout.log): key模式下包一層串流遮蔽器(createStreamRedactor), 回調收到的是已遮蔽之文字——
//     stdout回調只遮蔽key本身、stderr回調另遮蔽sk-ant-樣式; 金鑰被切在兩塊之間時以「尾端保留」處理, 故回調可能晚一塊收到尾端、結束時補送保留之尾端。
//   ③啟動前之參數檢核失敗(例如opt.env不可讀)之錯誤訊息亦經遮蔽(外來例外訊息可能夾帶key)。
//   ④key含NUL字元時(無法放進環境變數)回INVALID_KEY失敗(errorType 'exec', 與金鑰相依, 遞補層換下一把而非整組跳過; 否則子進程啟動失敗會被歸為與金鑰無關之spawn)。
//   已知限制: validate函數收到的是未遮蔽之原始stdout(其需要原文判斷, 處置由呼叫端負責);
//   長度不足6字元之key不遮蔽(redactText之最短長度; 真實sk-ant-金鑰遠長於此);
//   子進程(模型)可讀環境之情境(如Linux之/proc/self/environ經Read工具)仍可能讀到key, 但其輸出經上述遮蔽不會回到呼叫端
//   (CLI自己的session紀錄不在本套件掌握內)。
//
// 【勿帶--bare, 並留意其未來成為-p預設(2026-09-23查官方headless文件)】文件原文:
//   「--bare is the recommended mode for scripted and SDK calls, and will become the default for -p in a
//   future release」且「In bare mode, Claude Code never reads OAuth credentials or the system keychain」。
//   本轉接器靠訂閱登入(OAuth), 故extraArgs勿帶--bare(會直接認證失敗); 若日後某版把-p預設改為bare,
//   所有訂閱條目會一併失效——徵狀為非零離開碼, 失敗訊息印在stdout而非stderr(官方: 執行期失敗如未登入
//   以result印在stdout)。2.1.280尚無退出bare之旗標, 無法預先處理; 每次升級Claude Code後跑一次claude
//   條目即可偵測, 屆時再查該版之退出方式調整此處。
//   另兩點同日查證: stdin傳入之prompt上限10MB(超過即非零離開, 見@param prompt);
//   2.1.280起Pro/Team Standard方案未給model時預設由Sonnet改為Opus(只影響未帶--model之呼叫)。


//預設值
let DEFAULT_EXE = 'claude'


//本轉接器自用之設定鍵, 其餘鍵一律原樣轉傳execCli
let OWN_KEYS = ['exe', 'model', 'key', 'skipPermissions', 'extraArgs', 'input']


//key模式下自子進程環境移除之憑證變數(單一來源; 序位與理由見檔頭【key模式之憑證優先序】)
let CRED_VARS_REMOVED = [
    //序位高於ANTHROPIC_API_KEY者: 不移除則key被蓋過
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'ANTHROPIC_AUTH_TOKEN',
    //序位低於ANTHROPIC_API_KEY者: 目前不會蓋過key, 縱深防禦
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_PROFILE',
    'ANTHROPIC_FEDERATION_RULE_ID',
]


//key模式下自「繼承之process.env」移除之父session連結變數(單一來源; 規則、保留例外與理由見檔頭【key模式——繼承之父session連結變數】)
let LINK_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_']
let LINK_NAMES = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_JOB_DIR']
let LINK_KEEP = ['CLAUDE_CODE_GIT_BASH_PATH'] //屬前綴範圍但為使用者設定、移除會令子進程無法運作者


//Windows環境變數名不分大小寫: 比對一律先正規化(非Windows區分大小寫, 原樣)
let normName = (k) => process.platform === 'win32' ? k.toUpperCase() : k


/**
 * 判斷環境變數名是否為須自繼承環境移除之父session連結變數(前綴或完整名稱命中，且不在保留清單)
 *
 * @param {String} name 輸入環境變數名字串
 * @returns {Boolean} 回傳是否須移除布林值
 */
function isLinkVar(name) {
    let u = normName(name)
    if (LINK_KEEP.some((n) => normName(n) === u)) {
        return false
    }
    return LINK_NAMES.some((n) => normName(n) === u) || LINK_PREFIXES.some((p) => u.startsWith(normName(p)))
}


/**
 * 組出key模式之子進程環境差異物件：自呼叫端env剔除全部憑證變數後設入ANTHROPIC_API_KEY，另將繼承自process.env之父session連結變數(呼叫端未以env明確傳入者)標記移除，被移除之變數以undefined標記(execCli以之遮蔽繼承自process.env之同名變數)
 *
 * @param {Object} base 輸入呼叫端env物件(已物化之淺層副本，可為空物件)
 * @param {String} key 輸入Anthropic API金鑰字串
 * @returns {Object} 回傳env物件
 */
function buildKeyEnv(base, key) {

    //Windows環境變數名不分大小寫, 呼叫端env若以不同大小寫給了同名變數亦須剔除(否則與下方設值並存而行為不定)
    let drop = new Set([...CRED_VARS_REMOVED, 'ANTHROPIC_API_KEY'].map(normName))
    let env = {}
    for (let k of Object.keys(base)) {
        if (!drop.has(normName(k))) {
            env[k] = base[k]
        }
    }

    //父session連結變數: 只處理繼承自process.env者; 呼叫端明確傳入者(上方已原樣收進env, 含值為undefined者)保留, 以同名(含大小寫)已在env為準
    //(呼叫端以不同大小寫傳入者, execCli於Windows以不分大小寫視為同名覆蓋, 於非Windows則為另一變數; 兩者皆為呼叫端之值留存、繼承值被移除)
    for (let k of Object.keys(process.env)) {
        if (isLinkVar(k) && !Object.prototype.hasOwnProperty.call(env, k)) {
            env[k] = undefined
        }
    }

    for (let n of CRED_VARS_REMOVED) {
        env[n] = undefined
    }
    env.ANTHROPIC_API_KEY = key
    return env
}


/**
 * 遮蔽結果物件中的key(stdout/stderr/error；樣式遮蔽之適用範圍見檔頭【key之不外洩】)
 *
 * @param {Object} r 輸入execCli結果物件
 * @param {String} key 輸入Anthropic API金鑰字串
 * @returns {Object} 回傳遮蔽後之結果物件(淺拷貝)
 */
function redactResult(r, key) {
    let secrets = [key]
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
    return out
}


/**
 * 以Claude Code CLI呼叫Claude模型
 *
 * 特點：
 * prompt一律走stdin而非位置參數，因摘要內文可達數萬字，當命令列參數會spawn ENAMETOOLONG；
 * 未給key時沿用Claude Code既有登入狀態(訂閱額度)；給key時改以Anthropic Console之API金鑰計費(2026-10-24起)：
 * 該key只注入該次子進程之環境變數ANTHROPIC_API_KEY(不寫入process.env、不進命令列)，並自子進程環境移除會優先於它之憑證變數
 * (ANTHROPIC_AUTH_TOKEN、CLAUDE_CODE_USE_BEDROCK等，見檔頭【key模式之憑證優先序】)，以及繼承自process.env之父session連結變數
 * (於Claude Code工作階段內呼叫時，子claude會因它們沿用父登入而無視key，見檔頭【key模式——繼承之父session連結變數】；呼叫端以env明確傳入者保留)，
 * 結果之stdout/stderr/error與onStdout／onStderr回調收到之文字皆遮蔽key；
 * 未給model時不帶`--model`旗標，由CLI自行決定使用模型；
 * 預設帶`--dangerously-skip-permissions`令非互動之`-p`模式不因權限確認而卡住，
 * 惟prompt含不可信內容(例如待摘要之網頁)時該內容之指示亦將無權限閘門執行，
 * 可給予skipPermissions為false保留CLI權限閘門；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，一律以stdin傳入子進程(Claude Code之stdin上限10MB，超過即非零離開)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.exe='claude'] 輸入claude執行檔名稱或絕對路徑字串，給予名稱時由execCli自系統PATH解析(.cmd/.bat只給檔名時依cmd.exe語意先搜cwd再搜PATH，cwd不可信時請給絕對路徑)，預設'claude'
 * @param {String} [opt.model=''] 輸入模型別名或模型ID字串，例如'claude-opus-5-5'(全名, 固定版本)、'opus'或'sonnet'(別名, 隨CLI指向最新版)，預設''代表不帶`--model`旗標，由CLI依方案決定(2.1.280起Pro/Team Standard亦預設Opus)
 * @param {String} [opt.key=''] 輸入Anthropic Console之API金鑰字串(sk-ant-…)，給予有效字串即以API金鑰計費：只於該次子進程環境設ANTHROPIC_API_KEY並移除ANTHROPIC_AUTH_TOKEN、CLAUDE_CODE_USE_*、CLAUDE_CODE_OAUTH_TOKEN等其他憑證變數(含opt.env中同名者)，另自子進程環境移除繼承自process.env之父session連結變數(前綴CLAUDE_CODE_、CLAUDE_AGENT_SDK_與CLAUDECODE、CLAUDE_PID、CLAUDE_EFFORT、CLAUDE_JOB_DIR，保留CLAUDE_CODE_GIT_BASH_PATH；opt.env明確傳入者保留，要保留某使用者設定如CLAUDE_CODE_EFFORT_LEVEL請由opt.env傳入)，結果之stdout/stderr/error與onStdout／onStderr回調收到之文字遮蔽key(長度不足6字元者不遮蔽；含NUL字元者回INVALID_KEY失敗)；未給或非有效字串代表沿用登入狀態(行為與無此參數時完全相同，不移除任何變數)，預設''。經dispatchAiFallback時由條目之keys逐把注入(providers.mjs之claude-api:條目以envVar ANTHROPIC_KEYS取得)。勿把Console金鑰設為全域環境變數ANTHROPIC_API_KEY，否則本機全部Claude Code皆改走API計費
 * @param {Boolean} [opt.skipPermissions=true] 輸入是否帶`--dangerously-skip-permissions`旗標布林值，false代表保留CLI權限閘門，預設true
 * @param {Array} [opt.extraArgs=[]] 輸入額外命令列旗標字串陣列，將接於固定旗標之後，預設[]
 * @param {Number} [opt.timeoutMs=300000] 輸入逾時毫秒正整數，逾時將強制關閉子進程及其子孫程序，全套件統一預設300000
 * @param {String} [opt.cwd=process.cwd()] 輸入子進程工作目錄字串，預設process.cwd()
 * @param {String|Function} [opt.validate=undefined] 輸入stdout驗證規則字串或自訂驗證函數，規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接，自訂函數可回傳Promise(以resolve值判定，與子進程共用該次嘗試之timeoutMs)，拋錯或reject視同驗證失敗(OUTPUT_VALIDATION_FAILED，stderr前綴'validate threw: 訊息')，逾時亦同(前綴'validate timed out: did not settle within Ns')，durationMs含驗證時間，預設undefined代表不驗證
 * @param {Number} [opt.maxRetries=0] 輸入失敗後最大重試次數非負整數，預設0
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(標準輸出字串)、stderr(標準錯誤字串，自訂validate拋錯時前綴'validate threw: 訊息')、code(離開碼，子進程未能啟動時為null)、error(錯誤訊息字串，成功時為空字串)、errorType(僅失敗時，機器可讀錯誤類別字串，子進程未能啟動為'spawn'，一覽見getErrorType.mjs檔頭)、durationMs(耗時毫秒)、pid(子進程pid，未能啟動時為undefined)、attempts(實際嘗試次數)，本函數不會reject
 * @example
 * //need claude cli in system PATH
 *
 * import dispatchClaude from './src/dispatchClaude.mjs'
 *
 * let test = async () => {
 *
 *     let r = await dispatchClaude('請只回覆兩個字：完成', { model: 'sonnet' })
 *     console.log(r.ok, r.stdout.trim())
 *     // => true '完成'
 *
 *     let re = await dispatchClaude('')
 *     console.log(re.ok, re.error)
 *     // => false 'prompt must be a non-empty string'
 *
 *     //以Anthropic API金鑰計費(要工具之派工): key自.env的ANTHROPIC_KEYS取得, 不設全域ANTHROPIC_API_KEY
 *     //驗證確實走API金鑰: extraArgs加['--output-format', 'stream-json', '--verbose'], 首個system/init事件之apiKeySource須為'ANTHROPIC_API_KEY'
 *     let rk = await dispatchClaude('請只回覆兩個字：完成', { model: 'claude-haiku-5-5', key: 'sk-ant-api03-xxxxxx' })
 *     console.log(rk.ok, rk.stdout.trim())
 *     // => true '完成'
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchClaude(prompt, opt = {}) {

    //check prompt, 不reject故以錯誤結果物件回報
    prompt = asText(prompt) //String包裝物件取其原始字串(stdin只收原始字串, 空包裝不得繞過非空檢核); 判型不執行使用者程式碼(已撤銷之Proxy等回空字串)
    if (prompt === '') {
        return getErrorResult('prompt must be a non-empty string')
    }

    //exe, 無效回退預設'claude', 由execCli自系統PATH解析實體路徑
    let exe = get(opt, 'exe', null)
    if (!isestr(exe)) {
        exe = DEFAULT_EXE
    }

    //model, 無效時整段`--model`旗標不出現, 由CLI自行決定使用模型
    let model = get(opt, 'model', null)

    //skipPermissions, 非布林值回退預設true(非互動-p模式不卡權限確認)
    let skipPermissions = get(opt, 'skipPermissions', null)
    if (!isbol(skipPermissions)) {
        skipPermissions = true
    }

    //extraArgs
    let extraArgs = get(opt, 'extraArgs', null)

    //args
    let args = getCliArgs(
        '-p',
        skipPermissions ? '--dangerously-skip-permissions' : [],
        isestr(model) ? ['--model', model] : [],
        extraArgs,
    )

    //timeoutMs, 無效回退全套件統一預設(dfTimeoutMs=300000), 各轉接器一致令呼叫方無須記多套數字
    let timeoutMs = castPintOr(get(opt, 'timeoutMs', null), dfTimeoutMs)

    //optCli, 剔除本轉接器自用鍵後原樣轉傳, 令呼叫端可用execCli全部設定(例如onStdout、maxBuffer)
    let optCli = omit(opt, OWN_KEYS)

    //key, 有效字串才啟用API金鑰模式(無效視同未給, 與全套件「無效回退預設」慣例一致; 未給時env原樣交runExecCli, 行為與舊版相同)
    let key = get(opt, 'key', null)
    let hasKey = isestr(key)
    let flushers = [] //key模式下串流遮蔽器之補送函數(結束時送出保留之尾端)
    if (hasKey) {

        //key含NUL字元無法放進環境變數: 回與金鑰相依之失敗(errorType 'exec'), 令遞補層換下一把; 不可放行至spawn(其失敗會被歸為與金鑰無關之spawn而整組跳過)
        if (key.includes('\u0000')) {
            return getErrorResult('INVALID_KEY: key contains a NUL character and cannot be passed in an environment variable', 'exec')
        }

        //呼叫端env不可讀(拋錯之getter、已撤銷之Proxy)以params回報, 訊息與runExecCli同(四家一致); 外來例外訊息可能夾帶key故先遮蔽
        let er = readCallerObj(get(opt, 'env', null), 'env')
        if (!er.ok) {
            return getErrorResult(redactApiKeyText(er.msg, [key]))
        }
        optCli.env = buildKeyEnv(isobj(er.value) ? er.value : {}, key)

        //onStdout／onStderr(如把串流寫入stdout.log): 包串流遮蔽器, 回調收到已遮蔽文字(stdout只遮蔽key本身, stderr另遮蔽sk-ant-樣式, 與結果物件同規則)
        for (let [name, pattern] of [['onStdout', false], ['onStderr', true]]) {
            let fn = get(optCli, name, null)
            if (isfun(fn)) {
                let rd = createStreamRedactor([key], pattern)
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
    }

    //execCli(經runExecCli: 自訂validate拋錯視同驗證失敗、失敗結果補上機器可讀之errorType, 見runExecCli.mjs), prompt一律走stdin
    let r = await runExecCli(exe, args, {
        ...optCli,
        input: prompt,
        timeoutMs,
    })

    //補送串流遮蔽器保留之尾端; 回調拋錯不得使本函數reject(其錯誤屬呼叫端回調, 這裡的補送不另外外拋)
    for (let flush of flushers) {
        try {
            flush()
        }
        catch {}
    }

    //key模式遮蔽結果中的key(未給key時結果原樣, 見檔頭【key之不外洩】)
    return hasKey ? redactResult(r, key) : r
}


export default dispatchClaude
