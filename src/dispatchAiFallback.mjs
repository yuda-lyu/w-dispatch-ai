import get from 'lodash-es/get.js'
import omit from 'lodash-es/omit.js'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import dispatchAi from './dispatchAi.mjs'
import getErrorResult from './getErrorResult.mjs'
import castPintOr from './castPintOr.mjs'
import dfTimeoutMs from './dfTimeoutMs.mjs'
import { BODY_NOT_JSON } from './describeNonJsonBody.mjs'


// dispatchAiFallback.mjs — 多供應商自動遞補層
//
// 【兩層策略】群組之間依providers宣告順序(優先序), 群組之內(keys多把)以游標輪替(額度均攤)。
//
// 【失敗分流】只分兩路:
//   與金鑰無關之失敗(TIMEOUT/ENOENT/參數錯誤/驗證失敗/未知kind/截斷/工具不支援/本體非JSON) → 整組跳過——
//   同組各金鑰共用同一exe與model, 換金鑰必然再敗一次, 純屬空耗;
//   本體非JSON(REST之HTTP 200但無法解析, 見describeNonJsonBody.mjs)屬傳輸或閘道狀態, 2026-09-24依安裝方實例納入
//   (換第二把金鑰只是以剩餘預算重打至逾時); 「JSON缺欄位」不在此列, 仍換金鑰(部分閘道以200回帳號層級錯誤);
//   截斷(結果之truncated為true, 僅REST文字類可判, 見checkTruncation.mjs)與工具不支援(TOOL_CALLS_UNSUPPORTED)
//   皆屬模型對同一請求之產出性質, 2026-09-24起納入(前者由複審指出同模型換金鑰再截斷一次;
//   後者之既有測試標題即寫「不逐把空耗」而斷言卻為逐把換金鑰, 一併更正);
//   REST之status=failed(服務回錯)不屬截斷, 維持換金鑰;
//   其餘失敗(含額度上限/金鑰無效/服務回錯等一切未分類者) → 換組內下一把, 不記憶、不停用。
//   不可把正確性建立在「錯誤分類器必須窮盡」之上——實測各家額度/金鑰錯誤訊息
//   含中文(无效的令牌)與無特徵字串(UnknownError), 正則涵蓋不了; 而額度視窗有5小時滾動、
//   逐小時、逐日等多種形態, 「命中即停用到當日結束」會把已復活的金鑰冰到隔天。
//   故跨次執行不設停用清單: 額度恢復的偵測就是「下次再打一次」, 代價僅一次快速失敗。
//
// 【跨次記憶只有游標】成功後游標推進至下一把, 令額度在同組多把金鑰間自動均攤;
//   死金鑰的代價也被游標攤平——這輪從key1敗轉key2成功後游標停在key3, 下輪不會先碰key1。
//
// 【供應商冷卻(選用, cooldownMs>0啟用, 預設關閉)】多階段工作流的每一階段都會從鏈首
//   重新探測同一家已失效的供應商——限流時每階段各踩一輪429、卡死時各燒一次完整逾時
//   (使用端實測: 一次107秒的多階段請求中72秒耗在重複踩同一組429, 啟用冷卻後降至15秒)。
//   設計與「金鑰停用清單」(已否決)的關鍵差異: 以「條目」為單位、短視窗、且「只降序不移除」
//   ——冷卻中的條目移到鏈尾而非移除, 前面全敗時照樣會被嘗試, 故不存在把已恢復服務冰住的問題;
//   任一次成功立即解除。內建觸發限於限流(HTTP 429, 僅api-openai-compat可靠偵測; CLI類之
//   限流埋在stderr文字中, 各家字樣不同且隨版本漂移, 本套件不維護簽章表)與逾時(TIMEOUT開頭,
//   各kind皆可)兩類——其餘失敗已有換金鑰換家機制處理, 納入反而誤傷。
//   CLI類限流之偵測採依賴注入: 呼叫端於實測中觀察到穩定字樣時, 以coolDetect(r)=>Boolean
//   自行判定(收到完整失敗結果含stderr), 命中即視同冷卻觸發——簽章表由觀察到字樣的呼叫端
//   維護, 漏判僅退回現狀(每階段重探一次), 誤判也只是降尾非移除, 兩邊代價都有上限。
//   狀態存於state.cooling, 與cursors同走store持久化。
//
// 【中止(shouldStop)】呼叫端(如server於客戶端斷線後)可注入shouldStop()=>Boolean,
//   於「每次嘗試之間」檢查, true即停止遞補回報ABORTED——把「斷線後仍空耗整條鏈」
//   縮成「至多再耗當前這一家」。檢查點只此一處: 工作流各層經omit轉傳自動獲得,
//   中止後每個後續呼叫進門即回ABORTED, 整條工作流自然快速收束, 不需逐層實作。
//   不中止進行中之嘗試(不殺子進程/不斷開請求), 此為已知設計取捨(避免侵入execCli層)。
//
// 【組盡事件(group-exhausted)】逐次事件(try/next-key/skip-group等)不帶呼叫識別, 而同一onEvent常被並行呼叫共用
//   (如runFanout之各席位)。呼叫端要判斷「某條目在這次呼叫裡整組試完仍無成交」(如健康層據以降序)時,
//   若以金鑰數與逐把失敗次數重建, 並行呼叫跨越一次成交就會多計或少計——游標只在成交時推進,
//   在途呼叫與新呼叫的起點不同(2026-09-24下游w-knowledge-extract實測重現), 且重建本身依賴本層之
//   游標推進時機、每把至多一次、金鑰濾法三項內部性質。故由本層於本組未成交而試完時直接發出,
//   每次呼叫每組恰一次; 成交、預算用盡、中止(本組未試完)皆不發——後兩者屬呼叫端的時間或意願, 非該組故障。
//   組邊界只發事件, 不寫入tried(tried為逐次嘗試歷程, 其長度即嘗試次數)。
//
// 【meta保留鍵】「剔除自用鍵後原樣轉傳」令條目即調校點, 但呼叫端放進條目/opt的任何
//   自有欄位都會被靜默轉傳——保留meta一鍵保證永不轉傳, 呼叫端要掛分類/標籤/註記
//   一律放meta, 與轉傳機制永久絕緣(工作流各層之規格物件同此約定)。
//
// 【時間預算】budgetMs限制整輪遞補的總時長, 剩餘預算會壓進每次呼叫的timeoutMs,
//   防止多家連續卡逾時而撞破外部排程的執行上限。
//
// ══ 條目id之設計規則(呼叫端負責, 本套件不解讀其內容) ══
//
//   id於本套件內只有兩個用途: 游標的物件鍵(state.cursors[id])與日誌標籤
//   (providerId、keyId=`${id}#${keyIndex}`)。不查表、不比對、無格式要求,
//   純粹是呼叫端的命名空間——故「什麼算同一個供應商」由呼叫端定義, 本套件不猜。
//
//   ① id須能區分到「模型」而非只到「廠商」
//      ✗ id:'claude' —— 日後要同時掛sonnet與opus就無法並存, 且日誌看不出用了哪個模型
//      ✓ id:'claude:sonnet' / id:'claude:opus'
//
//   ② 同一模型經不同路徑取得時, id須帶上路徑, 且前綴用「具體路徑名」不用泛稱
//      同一個laguna可經Poolside官方REST、OpenRouter、opencode CLI三條路,
//      三者額度池與故障域各自獨立, 屬三個供應商:
//      ✓ 'poolside:laguna-s-2.1' / 'or:poolside/laguna-s-2.1:free' / 'oc:poolside/poolside/laguna-s-2.1'
//      ✗ 'api:laguna-s-2.1' —— 泛稱api:在同模型有多個REST閘道時會撞名, 且日誌看不出走哪個閘道
//      慣用前綴: CLI類＝oc:/agy:/claude:/codex:(即kind或CLI名); REST類＝閘道名(zen:/agnes:/poolside:/or:/nv:)
//
//   ③ id務必給且務必唯一
//      未給時本套件回退為「陣列索引字串」——索引是位置不是身分, 日後於鏈中插入條目
//      會讓後續條目繼承他人的游標進度(輪替張冠李戴), 故正式設定一律明給。
//      兩個條目同id則共用同一游標且日誌無法區分, 屬設定錯誤。
//
//   ④ 同一組金鑰用於多個條目時, 各條目游標獨立
//      例如agnes的CLI版與REST版共用同一批金鑰時, 兩者各自從游標起點輪替,
//      同一把金鑰可能被連續使用而另一把閒置(帳號額度未均攤)。
//      要讓它們共享輪替進度就給相同id(代價: 日誌無法區分兩者);
//      要能區分就分開命名(代價: 額度不均攤)。此取捨由呼叫端依實際需求決定。


//fallback層自用之設定鍵, 其餘鍵作為各attempt之共用預設原樣轉傳
//meta為保留鍵: 呼叫端掛自有資訊(分類/標籤/註記)用, 保證永不轉傳(見檔頭【meta保留鍵】)
let FALLBACK_KEYS = ['providers', 'budgetMs', 'minAttemptMs', 'cooldownMs', 'shouldStop', 'coolDetect', 'store', 'onEvent', 'meta']


//providers條目自用之設定鍵, 其餘鍵(含kind)即該條目之opt原樣轉傳對應轉接器
let ENTRY_KEYS = ['id', 'keys', 'meta']


//預設值
let DEFAULT_MIN_ATTEMPT_MS = 20000
let DEFAULT_TIMEOUT_MS = dfTimeoutMs //全套件統一預設300000


//memoryState, 未注入store時之行程內預設狀態(跨呼叫有效, 重啟歸零)
let memoryState = { cursors: {} }


/**
 * 初始化游標與冷卻狀態(store有效即載入持久化狀態, 否則用行程內記憶體)
 *
 * @param {Object} store 輸入狀態持久化物件{get,set}，無效代表用行程內記憶體
 * @returns {Object} 回傳物件，內含state(狀態物件，保證有cursors與cooling)與saveState(寫回函數，store無效或寫入失敗皆靜默)
 */
function initState(store) {
    let useStore = isobj(store) && isfun(store.get) && isfun(store.set)
    let state = null
    if (useStore) {
        try {
            state = store.get()
        }
        catch {}
    }
    if (!isobj(state)) {
        state = useStore ? { cursors: {} } : memoryState
    }
    if (!isobj(state.cursors)) {
        state.cursors = {}
    }
    if (!isobj(state.cooling)) {
        state.cooling = {}
    }
    let saveState = () => {
        if (useStore) {
            try {
                store.set(state)
            }
            catch {}
        }
    }
    return { state, saveState }
}


/**
 * 依冷卻狀態重排providers：冷卻中的條目「只降序不移除」——移到鏈尾, 前面全敗時仍會被嘗試,
 * 故不存在把已恢復服務冰住的問題(此為與「金鑰停用清單」的關鍵差異, 後者已被否決)。
 * 僅追蹤有明給id之條目(索引式id會因重排而錯位); 過期紀錄順手清除並寫回
 *
 * @param {Array} providers 輸入供應商條目陣列
 * @param {Object} state 輸入狀態物件(取其cooling)
 * @param {Number} cooldownMs 輸入冷卻視窗毫秒正整數
 * @param {Function} saveState 輸入狀態寫回函數
 * @returns {Array} 回傳重排後之條目陣列(active在前, 冷卻中殿後, 各自保持原相對順序)
 */
function reorderByCooling(providers, state, cooldownMs, saveState) {
    let now = Date.now()
    let act = []
    let cool = []
    let dirty = false
    for (let p of providers) {
        let pid = get(p, 'id', null)
        let ts = isestr(pid) ? get(state.cooling, pid, null) : null
        if (ispint(ts) && (now - ts) < cooldownMs) {
            cool.push(p)
        }
        else {
            if (isestr(pid) && state.cooling[pid] !== undefined) {
                delete state.cooling[pid] //冷卻已過期, 清除
                dirty = true
            }
            act.push(p)
        }
    }
    if (dirty) {
        saveState()
    }
    return [...act, ...cool]
}


/**
 * 取結果之截斷資訊供tried各項記錄(REST文字類轉接器才帶, 其餘kind回空物件)
 *
 * @param {Object} r 輸入dispatchAi結果物件
 * @returns {Object} 回傳物件，含truncated與finishReason，或空物件
 */
function finOf(r) {
    return (get(r, 'truncated', undefined) !== undefined) ? { truncated: r.truncated, finishReason: r.finishReason } : {}
}


/**
 * 判斷失敗結果是否與「哪一把金鑰」無關(換組內金鑰必然再敗, 應整組跳過)
 *
 * @param {Object} r 輸入dispatchAi失敗結果物件
 * @returns {Boolean} 回傳是否應整組跳過之布林值
 */
function isKeyIndependentFail(r) {

    let error = get(r, 'error', '')
    if (!isestr(error)) {
        error = ''
    }
    let code = get(r, 'code', null)

    //逾時, 該服務卡住, 同服務其他金鑰只會再空耗一次完整timeout
    if (error.indexOf('TIMEOUT') === 0) {
        return true
    }

    //執行檔不存在, 同組共用同一exe
    if (error.includes('ENOENT')) {
        return true
    }

    //參數錯誤, 同組共用同一組旗標
    if (code === 2) {
        return true
    }

    //輸出未過驗證, CLI正常結束(code=0)且模型有回應, 換金鑰仍是同一模型之產出習慣
    //注意判定依據是error字串而非code===0(code===0且ok===true是成功)
    if (error === 'OUTPUT_VALIDATION_FAILED') {
        return true
    }

    //截斷, 同模型同請求換金鑰必然再截斷(依機械旗標truncated判定, 不依errorType——REST之status=failed亦為incomplete但非截斷)
    if (get(r, 'truncated', false) === true) {
        return true
    }

    //模型回工具呼叫而api類不支援, 屬模型對同一請求之產出性質, 換金鑰仍是同樣產出
    if (error.indexOf('TOOL_CALLS_UNSUPPORTED') === 0) {
        return true
    }

    //HTTP 200但本體非JSON, 屬傳輸或閘道狀態, 換金鑰必然再敗(「JSON缺欄位」不在此列, 仍換金鑰; 見describeNonJsonBody.mjs)
    if (error.indexOf(BODY_NOT_JSON) === 0) {
        return true
    }

    //kind無效, 屬條目設定錯誤
    if (error.indexOf('unknown ai kind') === 0) {
        return true
    }

    return false
}


/**
 * 依供應商清單順序自動遞補調用AI，組內多金鑰以游標輪替
 *
 * 特點：
 * providers陣列順序即優先序，排前面的先用；
 * 條目本身即該次調用之opt(除id與keys外原樣透傳對應轉接器)，與dispatchAi「條目直接當opt」同一約定；
 * 條目給予keys(多把金鑰)時以游標輪替，某把失敗自動換下一把，全數失敗才遞補下一組；
 * 與金鑰無關之失敗(逾時/執行檔不存在/參數錯誤/輸出未過驗證/未知kind/截斷/工具不支援/HTTP 200但本體非JSON)直接整組跳過，不逐把空耗；
 * 跨次執行僅記憶游標(經store注入持久化)，不設金鑰停用清單——額度視窗形態多樣(5小時滾動/逐時/逐日)，
 * 停用會把已恢復的金鑰閒置，而重探的代價僅一次快速失敗；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，一律以stdin傳入子進程
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} opt.providers 輸入供應商條目物件陣列，順序即優先序。各條目除下列鍵外，其餘鍵(kind、model、exe、provider、config、sandbox、timeoutMs等)即該條目之opt原樣透傳對應轉接器
 * @param {String} [opt.providers[].id=條目索引字串] 輸入群組識別字串，游標以此為鍵、亦為日誌標籤，本套件不解讀其內容。須區分到「模型」而非只到「廠商」(如'claude:sonnet'而非'claude')，同一模型經不同路徑取得時須帶上路徑(如'poolside:laguna-s-2.1'與'or:poolside/laguna-s-2.1:free')，且務必唯一。省略時回退為陣列索引字串——索引是位置不是身分，日後插入條目會令後續條目繼承他人游標進度，故正式設定一律明給。詳見本檔檔頭之id設計規則
 * @param {Array} [opt.providers[].keys=[]] 輸入同一服務之多把API key字串陣列，逐次注入輪替(kind為opencode時須同時於條目給予provider)，省略代表沿用CLI既有登入狀態之單一虛擬金鑰
 * @param {*} [opt.providers[].meta=undefined] 輸入呼叫端自有資訊(分類、標籤、註記)，保留鍵保證永不轉傳對應轉接器——條目其餘鍵一律原樣轉傳，自有欄位放此鍵可與轉傳機制永久絕緣，預設undefined
 * @param {Number} [opt.budgetMs=null] 輸入整輪遞補之時間上限毫秒正整數，剩餘預算會壓進每次呼叫之timeoutMs，預設null代表不限
 * @param {Number} [opt.minAttemptMs=20000] 輸入單次嘗試之最低剩餘預算毫秒正整數，剩餘低於此值即停止嘗試回報budget exhausted，預設20000
 * @param {Object} [opt.store=null] 輸入狀態持久化物件{get:()=>state,set:(state)=>{}}，state內含cursors(逐群組游標)與cooling(供應商冷卻時間戳，僅cooldownMs>0時使用)，省略代表用行程內記憶體(跨呼叫有效，重啟歸零)。假定單行程序列調用，並行請自行加鎖
 * @param {Number} [opt.cooldownMs=0] 輸入供應商冷卻視窗毫秒非負整數，>0啟用：條目(限有明給id者)遭遇限流(HTTP 429，僅api類可偵測；CLI類可經coolDetect注入判定)或逾時(TIMEOUT開頭)後，於冷卻視窗內之後續呼叫中被移至鏈尾——只降序不移除，前面全敗時仍會被嘗試，任一次成功立即解除；注意啟用時「providers順序即優先序」會被暫時重排，此即本機制之目的；預設0代表不啟用
 * @param {Function} [opt.coolDetect=null] 輸入冷卻觸發判定函數(r)=>Boolean，收完整失敗結果物件(含stdout、stderr、code、error)，回傳true即視同冷卻觸發(內建429/TIMEOUT觸發不受影響)——CLI類限流埋在stderr且各家字樣不同，簽章表由觀察到字樣的呼叫端維護，如(r)=>/FreeUsageLimitError/i.test(r.stderr||'')；僅cooldownMs>0時有效，回調拋出例外視同false，預設null
 * @param {Function} [opt.shouldStop=null] 輸入中止判定函數()=>Boolean，於每次嘗試之間檢查，回傳true即停止遞補回報ABORTED(不中止進行中之嘗試)——供呼叫端於成果已無人接收時(如客戶端斷線)止損；經工作流層原樣轉傳，中止後各後續呼叫進門即回ABORTED令整條工作流快速收束；回調拋出例外視同false，預設null
 * @param {*} [opt.meta=undefined] 輸入呼叫端自有資訊，保留鍵保證永不轉傳各轉接器，預設undefined
 * @param {Function} [opt.onEvent=null] 輸入事件回調函數(ev)=>{}，ev.type可為'try'、'ok'、'next-key'、'skip-group'、'budget-out'、'aborted'、'cooled'(冷卻觸發，帶error與cooldownMs，僅cooldownMs>0時出現)、'group-exhausted'(本組未成交而試完，每次呼叫每組恰一次，位於本組最後一個next-key或skip-group之後、下一組首個try之前；帶keys(有效金鑰數，0代表登入態之單一虛擬金鑰)、attempted(本組實際嘗試數)、by('all-keys'每把皆換鑰失敗，或'skip-group'以與金鑰無關之失敗收尾)、errorTypes(本組各次嘗試之errorType依序)與error(本組最後一次錯誤)；成交、預算用盡、中止之組不發，亦不寫入tried)；失敗事件(next-key/skip-group)另帶errorType、stdout(被拒回覆)與stderr(錯誤輸出)供診斷，後兩者於失敗路徑已由轉接器截斷；回調拋出例外不影響主流程，預設null
 * @param {Number} [opt.timeoutMs=300000] 輸入各attempt共用之逾時毫秒正整數，條目可覆寫，全套件統一預設300000
 * @param {String|Function} [opt.validate=undefined] 輸入各attempt共用之stdout驗證規則，條目可覆寫，預設undefined
 * @param {Boolean} [opt.acceptTruncated=false] 輸入是否接受REST文字類轉接器回報之截斷內容布林值(原樣轉傳轉接器)，1.0.37起截斷於validate之前判失敗，validate內含搶救策略者須給true，預設false
 * @param {Number} [opt.maxRetries=0] 輸入各attempt共用之同家重試次數非負整數，韌性建議交給換家而非重試同一家，預設0
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，除execCli既有欄位(ok、stdout、stderr、code、error、durationMs、attempts、pid)外，追加providerId(實際使用之群組)、keyIndex(實際使用之金鑰索引，無keys時為null)、kind、model、tried(全部嘗試歷程陣列，成功時亦回傳；失敗項含errorType、stdout與stderr供診斷被拒原因)；失敗結果帶機器可讀之errorType(一覽見getErrorType.mjs檔頭)；api類轉接器提供usage(token用量)時原樣流出於結果與tried各項，CLI類無此欄；REST文字類轉接器另帶finishReason與truncated(是否截斷)，同樣流出於結果與tried各項；本函數不會reject
 * @example
 * //need opencode, claude, codex cli in system PATH
 *
 * import dispatchAiFallback from './src/dispatchAiFallback.mjs'
 *
 * let test = async () => {
 *
 *     let r = await dispatchAiFallback('請只回覆兩個字：完成', {
 *         providers: [
 *             {
 *                 //id區分到模型且帶路徑: 同一模型經REST與CLI取得屬兩個供應商
 *                 id: 'agnes:agnes-3.0-flash',
 *                 kind: 'api-openai-compat',
 *                 baseURL: 'https://apihub.agnes-ai.com/v1',
 *                 model: 'agnes-3.0-flash',
 *                 keys: ['sk-aaa', 'sk-bbb'], //多把金鑰, 某把失敗自動換下一把
 *             },
 *             {
 *                 id: 'oc:opencode/muse-spark-1.3-contributor-free', //CLI版(有工具, 較慢)
 *                 kind: 'opencode',
 *                 model: 'opencode/muse-spark-1.3-contributor-free',
 *                 useStoredAuth: false, //opencode自家免費模型以匿名存取, 不沿用本機auth.json之登入
 *                 timeoutMs: 180000,
 *             },
 *             { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' }, //以上全敗時遞補
 *             { id: 'codex:gpt-5.6-luna', kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
 *         ],
 *         budgetMs: 600000,
 *         onEvent: (ev) => console.log(ev.type, ev.providerId, ev.keyIndex),
 *     })
 *     console.log(r.ok, r.providerId, r.keyIndex, r.tried.length)
 *     // => true 'agnes:agnes-3.0-flash' 0 1
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchAiFallback(prompt, opt = {}) {

    //check prompt, 於頂層先擋, 否則會逐組空跑同一錯誤
    if (!isestr(prompt)) {
        return { ...getErrorResult('prompt must be a non-empty string'), tried: [] }
    }

    //providers, 濾除非物件條目
    let providersRaw = get(opt, 'providers', null)
    let providers = isarr(providersRaw) ? providersRaw.filter(isobj) : []
    if (providers.length === 0) {
        return { ...getErrorResult('providers must be a non-empty array'), tried: [] }
    }

    //budgetMs, 無效視為不限
    let budgetMs = castPintOr(get(opt, 'budgetMs', null), null)
    let deadline = (budgetMs === null) ? null : Date.now() + budgetMs

    //minAttemptMs, 無效回退預設20000
    let minAttemptMs = castPintOr(get(opt, 'minAttemptMs', null), DEFAULT_MIN_ATTEMPT_MS)

    //state與saveState, store須同時具get與set函數才視為有效, 否則用行程內記憶體
    let { state, saveState } = initState(get(opt, 'store', null))

    //cooldownMs, 無效視為0＝不啟用(現行行為零改變)
    let cooldownMs = castPintOr(get(opt, 'cooldownMs', null), 0)

    //coolDetect, 冷卻觸發之注入判定(CLI類限流簽章由呼叫端維護, 見檔頭), 僅cooldownMs>0時有意義
    let coolDetect = get(opt, 'coolDetect', null)
    if (!isfun(coolDetect)) {
        coolDetect = null
    }

    //shouldStop, 中止判定, 於每次嘗試之間檢查; 回調拋出例外視同false(不中止), 不得中斷主流程
    let shouldStop = get(opt, 'shouldStop', null)
    if (!isfun(shouldStop)) {
        shouldStop = null
    }
    let stopRequested = () => {
        if (shouldStop === null) {
            return false
        }
        try {
            return shouldStop() === true
        }
        catch {
            return false
        }
    }

    //供應商冷卻: 冷卻中的條目降至鏈尾(細節見reorderByCooling)
    if (cooldownMs > 0) {
        providers = reorderByCooling(providers, state, cooldownMs, saveState)
    }

    //onEvent, 回調拋出例外不得中斷主流程
    let onEvent = get(opt, 'onEvent', null)
    let emit = (ev) => {
        if (isfun(onEvent)) {
            try {
                onEvent(ev)
            }
            catch {}
        }
    }

    //sharedOpt, 剔除fallback層自用鍵後作為各attempt共用預設, 條目覆寫之
    let sharedOpt = omit(opt, FALLBACK_KEYS)

    let tried = []
    let lastResult = null
    let lastMeta = null

    //逐群組(宣告順序即優先序), 單向單輪不回頭
    for (let ig = 0; ig < providers.length; ig++) {
        let entry = providers[ig]

        //id, 無效回退條目索引字串; idExplicit供冷卻機制判別(索引式id不參與冷卻)
        let id = get(entry, 'id', null)
        let idExplicit = isestr(id)
        if (!idExplicit) {
            id = String(ig)
        }

        //kind與model僅供事件與回傳meta, kind有效性由dispatchAi判定
        let kind = get(entry, 'kind', null)
        let model = get(entry, 'model', null)

        //keys, 濾除非有效字串, 空陣列視同未給(登入態單一虛擬金鑰)
        let keysRaw = get(entry, 'keys', null)
        let keys = isarr(keysRaw) ? keysRaw.filter(isestr) : []
        let nk = keys.length

        //entryOpt, 剔除條目自用鍵後即該條目之opt
        let entryOpt = omit(entry, ENTRY_KEYS)

        //游標, 逐群組記錄, 以現行keys長度取模自癒(金鑰陣列改動時不出界)
        let cursor = 0
        if (nk > 0) {
            let c = get(state.cursors, id, 0)
            cursor = ispint(c) ? cint(c) % nk : 0
        }

        //組內逐把嘗試, 每把至多一次, 全敗即組盡遞補下一組
        let nAttempts = (nk > 0) ? nk : 1
        let skipGroup = false
        let groupStart = tried.length //本組於tried之起點, 供組盡事件取本組各次嘗試
        for (let a = 0; a < nAttempts && !skipGroup; a++) {

            //中止檢查(嘗試邊界): 成果已無人接收時止損, 不中止進行中之嘗試(見檔頭【中止】)
            if (stopRequested()) {
                emit({ type: 'aborted', providerId: id, keyIndex: null, keyId: id })
                tried.push({ providerId: id, keyIndex: null, keyId: id, outcome: 'aborted' })
                return { ...getErrorResult('ABORTED', 'aborted'), tried }
            }

            //keyIndex, 無keys時為null
            let keyIndex = (nk > 0) ? (cursor + a) % nk : null
            let keyId = (keyIndex === null) ? id : `${id}#${keyIndex}`

            //attemptOpt, 共用預設 <- 條目覆寫 <- 本把金鑰
            let attemptOpt = { ...sharedOpt, ...entryOpt }
            if (nk > 0) {
                attemptOpt.key = keys[keyIndex]
            }

            //有效timeout, 有預算時以剩餘預算封頂
            let effTimeout = castPintOr(get(attemptOpt, 'timeoutMs', null), DEFAULT_TIMEOUT_MS)
            if (deadline !== null) {
                let remaining = deadline - Date.now()

                //剩餘不足一次最低嘗試, 停止遞補回報預算用盡
                if (remaining < minAttemptMs) {
                    emit({ type: 'budget-out', providerId: id, keyIndex, keyId, remainingMs: remaining })
                    tried.push({ providerId: id, keyIndex, keyId, outcome: 'budget-out' })
                    return { ...getErrorResult('budget exhausted', 'budget'), tried }
                }
                effTimeout = Math.min(effTimeout, remaining)
            }
            attemptOpt.timeoutMs = effTimeout

            //dispatch
            emit({ type: 'try', providerId: id, keyIndex, keyId, kind, model })
            let r = await dispatchAi(kind, prompt, attemptOpt)

            //成功, 推進游標(額度均攤)並回傳; 任一次成功立即解除該家冷卻
            if (r.ok) {
                if (cooldownMs > 0 && idExplicit && state.cooling[id] !== undefined) {
                    delete state.cooling[id]
                    saveState()
                }
                if (nk > 0) {
                    state.cursors[id] = (keyIndex + 1) % nk
                    saveState()
                }
                emit({ type: 'ok', providerId: id, keyIndex, keyId, durationMs: r.durationMs })
                tried.push({ providerId: id, keyIndex, keyId, outcome: 'ok', durationMs: r.durationMs, ...(r.usage !== undefined ? { usage: r.usage } : {}), ...finOf(r) })
                return { ...r, providerId: id, keyIndex, kind, model, tried }
            }

            //失敗分流
            lastResult = r
            lastMeta = { providerId: id, keyIndex, kind, model }
            //冷卻觸發: 內建為限流(HTTP 429, 僅api類可偵測)與逾時(TIMEOUT開頭, CLI與api皆可)——
            //其餘失敗(金鑰無效/服務端錯誤)已有換金鑰換家機制處理, 納入冷卻反而誤傷;
            //CLI類限流簽章經coolDetect注入判定(呼叫端維護, 見檔頭), 拋出例外視同false
            if (cooldownMs > 0 && idExplicit) {
                let isCoolTrigger = (r.code === 429) || (isestr(r.error) && r.error.indexOf('TIMEOUT') === 0)
                if (!isCoolTrigger && coolDetect !== null) {
                    try {
                        isCoolTrigger = coolDetect(r) === true
                    }
                    catch {}
                }
                if (isCoolTrigger) {
                    state.cooling[id] = Date.now()
                    saveState()
                    emit({ type: 'cooled', providerId: id, keyIndex, keyId, error: r.error, cooldownMs })
                }
            }

            //失敗事件與tried一併帶被拒回覆(stdout)與錯誤輸出(stderr), 供呼叫端診斷失敗原因
            //(如驗證失敗時模型究竟回了什麼); 兩者於失敗路徑已由轉接器截斷(≤500/1000字元), 不會過大
            if (isKeyIndependentFail(r)) {

                //與金鑰無關, 整組跳過
                emit({ type: 'skip-group', providerId: id, keyIndex, keyId, error: r.error, errorType: r.errorType, stdout: r.stdout, stderr: r.stderr })
                tried.push({ providerId: id, keyIndex, keyId, outcome: 'skip-group', error: r.error, errorType: r.errorType, stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, ...(r.usage !== undefined ? { usage: r.usage } : {}), ...finOf(r) })
                skipGroup = true
            }
            else {

                //其餘(含額度上限/金鑰無效/未分類), 換組內下一把, 不記憶不停用
                emit({ type: 'next-key', providerId: id, keyIndex, keyId, error: r.error, errorType: r.errorType, stdout: r.stdout, stderr: r.stderr })
                tried.push({ providerId: id, keyIndex, keyId, outcome: 'next-key', error: r.error, errorType: r.errorType, stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, ...(r.usage !== undefined ? { usage: r.usage } : {}), ...finOf(r) })
            }

        }

        //組盡: 走到這裡即本組未成交且已試完(成交、預算用盡、中止皆於迴圈內回傳), 每次呼叫每組恰發一次(見檔頭【組盡事件】)
        let tg = tried.slice(groupStart)
        emit({
            type: 'group-exhausted',
            providerId: id,
            keyIndex: null,
            keyId: id,
            keys: nk, //有效金鑰數(同上方濾法), 0代表登入態之單一虛擬金鑰
            attempted: tg.length, //本組實際送出之嘗試數
            by: skipGroup ? 'skip-group' : 'all-keys', //以與金鑰無關之失敗收尾, 或每把皆換鑰失敗
            errorTypes: tg.map((t) => t.errorType), //本組各次嘗試之errorType, 依嘗試順序
            error: get(lastResult, 'error', ''), //本組最後一次嘗試之錯誤
        })
    }

    //全數失敗, 回傳最後一筆失敗結果(含其errorType)與完整歷程
    let r = lastResult || getErrorResult('all providers failed', 'exec')
    return { ...r, ...(lastMeta || {}), tried }
}


export default dispatchAiFallback
