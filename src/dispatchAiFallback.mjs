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


// dispatchAiFallback.mjs — 多供應商自動遞補層
//
// 【兩層策略】群組之間依providers宣告順序(優先序), 群組之內(keys多把)以游標輪替(額度均攤)。
//
// 【失敗分流】只分兩路:
//   與金鑰無關之失敗(TIMEOUT/ENOENT/參數錯誤/驗證失敗/未知kind) → 整組跳過——
//   同組各金鑰共用同一exe與model, 換金鑰必然再敗一次, 純屬空耗;
//   其餘失敗(含額度上限/金鑰無效/服務回錯等一切未分類者) → 換組內下一把, 不記憶、不停用。
//   不可把正確性建立在「錯誤分類器必須窮盡」之上——實測各家額度/金鑰錯誤訊息
//   含中文(无效的令牌)與無特徵字串(UnknownError), 正則涵蓋不了; 而額度視窗有5小時滾動、
//   逐小時、逐日等多種形態, 「命中即停用到當日結束」會把已復活的金鑰冰到隔天。
//   故跨次執行不設停用清單: 額度恢復的偵測就是「下次再打一次」, 代價僅一次快速失敗。
//
// 【跨次記憶只有游標】成功後游標推進至下一把, 令額度在同組多把金鑰間自動均攤;
//   死金鑰的代價也被游標攤平——這輪從key1敗轉key2成功後游標停在key3, 下輪不會先碰key1。
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
//   ② 同一模型經不同路徑取得時, id須帶上路徑
//      同一個laguna可經Poolside官方REST、OpenRouter、opencode CLI三條路,
//      三者額度池與故障域各自獨立, 屬三個供應商:
//      ✓ 'poolside:laguna-s-2.1' / 'or:poolside/laguna-s-2.1:free' / 'oc:poolside/poolside/laguna-s-2.1'
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
let FALLBACK_KEYS = ['providers', 'budgetMs', 'minAttemptMs', 'store', 'onEvent']


//providers條目自用之設定鍵, 其餘鍵(含kind)即該條目之opt原樣轉傳對應轉接器
let ENTRY_KEYS = ['id', 'keys']


//預設值
let DEFAULT_MIN_ATTEMPT_MS = 20000
let DEFAULT_TIMEOUT_MS = 120000


//memoryState, 未注入store時之行程內預設狀態(跨呼叫有效, 重啟歸零)
let memoryState = { cursors: {} }


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
 * 與金鑰無關之失敗(逾時/執行檔不存在/參數錯誤/輸出未過驗證/未知kind)直接整組跳過，不逐把空耗；
 * 跨次執行僅記憶游標(經store注入持久化)，不設金鑰停用清單——額度視窗形態多樣(5小時滾動/逐時/逐日)，
 * 停用會把已恢復的金鑰閒置，而重探的代價僅一次快速失敗；
 * 本函數不會reject，一律以結果物件之ok與error欄位回報成敗
 *
 * @param {String} prompt 輸入提示詞字串，一律以stdin傳入子進程
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} opt.providers 輸入供應商條目物件陣列，順序即優先序。各條目除下列鍵外，其餘鍵(kind、model、exe、provider、config、sandbox、timeoutMs等)即該條目之opt原樣透傳對應轉接器
 * @param {String} [opt.providers[].id=條目索引字串] 輸入群組識別字串，游標以此為鍵、亦為日誌標籤，本套件不解讀其內容。須區分到「模型」而非只到「廠商」(如'claude:sonnet'而非'claude')，同一模型經不同路徑取得時須帶上路徑(如'poolside:laguna-s-2.1'與'or:poolside/laguna-s-2.1:free')，且務必唯一。省略時回退為陣列索引字串——索引是位置不是身分，日後插入條目會令後續條目繼承他人游標進度，故正式設定一律明給。詳見本檔檔頭之id設計規則
 * @param {Array} [opt.providers[].keys=[]] 輸入同一服務之多把API key字串陣列，逐次注入輪替(kind為opencode時須同時於條目給予provider)，省略代表沿用CLI既有登入狀態之單一虛擬金鑰
 * @param {Number} [opt.budgetMs=null] 輸入整輪遞補之時間上限毫秒正整數，剩餘預算會壓進每次呼叫之timeoutMs，預設null代表不限
 * @param {Number} [opt.minAttemptMs=20000] 輸入單次嘗試之最低剩餘預算毫秒正整數，剩餘低於此值即停止嘗試回報budget exhausted，預設20000
 * @param {Object} [opt.store=null] 輸入狀態持久化物件{get:()=>state,set:(state)=>{}}，state內含cursors(逐群組游標)，省略代表用行程內記憶體(跨呼叫有效，重啟歸零)。假定單行程序列調用，並行請自行加鎖
 * @param {Function} [opt.onEvent=null] 輸入事件回調函數(ev)=>{}，ev.type可為'try'、'ok'、'next-key'、'skip-group'、'budget-out'，回調拋出例外不影響主流程，預設null
 * @param {Number} [opt.timeoutMs=120000] 輸入各attempt共用之逾時毫秒正整數，條目可覆寫，預設120000
 * @param {String|Function} [opt.validate=undefined] 輸入各attempt共用之stdout驗證規則，條目可覆寫，預設undefined
 * @param {Number} [opt.maxRetries=0] 輸入各attempt共用之同家重試次數非負整數，韌性建議交給換家而非重試同一家，預設0
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，除execCli既有欄位(ok、stdout、stderr、code、error、durationMs、attempts、pid)外，追加providerId(實際使用之群組)、keyIndex(實際使用之金鑰索引，無keys時為null)、kind、model、tried(全部嘗試歷程陣列，成功時亦回傳)，本函數不會reject
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
 *                 id: 'zen:deepseek-v4-flash-free',
 *                 kind: 'api-openai-compat',
 *                 baseURL: 'https://opencode.ai/zen/v1',
 *                 model: 'deepseek-v4-flash-free',
 *                 keys: ['sk-aaa', 'sk-bbb'], //多把金鑰, 某把失敗自動換下一把
 *             },
 *             {
 *                 id: 'oc:opencode/deepseek-v4-flash-free', //同一模型之CLI版(有工具, 較慢)
 *                 kind: 'opencode',
 *                 model: 'opencode/deepseek-v4-flash-free',
 *                 provider: 'opencode',
 *                 keys: ['sk-aaa', 'sk-bbb'],
 *                 timeoutMs: 180000,
 *             },
 *             { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' }, //以上全敗時遞補
 *             { id: 'codex:gpt-5.6-luna', kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
 *         ],
 *         budgetMs: 600000,
 *         onEvent: (ev) => console.log(ev.type, ev.providerId, ev.keyIndex),
 *     })
 *     console.log(r.ok, r.providerId, r.keyIndex, r.tried.length)
 *     // => true 'zen:deepseek-v4-flash-free' 0 1
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
    let budgetMs = get(opt, 'budgetMs', null)
    if (!ispint(budgetMs)) {
        budgetMs = null
    }
    else {
        budgetMs = cint(budgetMs)
    }
    let deadline = (budgetMs === null) ? null : Date.now() + budgetMs

    //minAttemptMs, 無效回退預設20000
    let minAttemptMs = get(opt, 'minAttemptMs', null)
    if (!ispint(minAttemptMs)) {
        minAttemptMs = DEFAULT_MIN_ATTEMPT_MS
    }
    else {
        minAttemptMs = cint(minAttemptMs)
    }

    //store, 須同時具get與set函數才視為有效, 否則用行程內記憶體
    let store = get(opt, 'store', null)
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
    let saveState = () => {
        if (useStore) {
            try {
                store.set(state)
            }
            catch {}
        }
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

        //id, 無效回退條目索引字串
        let id = get(entry, 'id', null)
        if (!isestr(id)) {
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
        for (let a = 0; a < nAttempts && !skipGroup; a++) {

            //keyIndex, 無keys時為null
            let keyIndex = (nk > 0) ? (cursor + a) % nk : null
            let keyId = (keyIndex === null) ? id : `${id}#${keyIndex}`

            //attemptOpt, 共用預設 <- 條目覆寫 <- 本把金鑰
            let attemptOpt = { ...sharedOpt, ...entryOpt }
            if (nk > 0) {
                attemptOpt.key = keys[keyIndex]
            }

            //有效timeout, 有預算時以剩餘預算封頂
            let effTimeout = get(attemptOpt, 'timeoutMs', null)
            if (!ispint(effTimeout)) {
                effTimeout = DEFAULT_TIMEOUT_MS
            }
            else {
                effTimeout = cint(effTimeout)
            }
            if (deadline !== null) {
                let remaining = deadline - Date.now()

                //剩餘不足一次最低嘗試, 停止遞補回報預算用盡
                if (remaining < minAttemptMs) {
                    emit({ type: 'budget-out', providerId: id, keyIndex, keyId, remainingMs: remaining })
                    tried.push({ providerId: id, keyIndex, keyId, outcome: 'budget-out' })
                    return { ...getErrorResult('budget exhausted'), tried }
                }
                effTimeout = Math.min(effTimeout, remaining)
            }
            attemptOpt.timeoutMs = effTimeout

            //dispatch
            emit({ type: 'try', providerId: id, keyIndex, keyId, kind, model })
            let r = await dispatchAi(kind, prompt, attemptOpt)

            //成功, 推進游標(額度均攤)並回傳
            if (r.ok) {
                if (nk > 0) {
                    state.cursors[id] = (keyIndex + 1) % nk
                    saveState()
                }
                emit({ type: 'ok', providerId: id, keyIndex, keyId, durationMs: r.durationMs })
                tried.push({ providerId: id, keyIndex, keyId, outcome: 'ok', durationMs: r.durationMs })
                return { ...r, providerId: id, keyIndex, kind, model, tried }
            }

            //失敗分流
            lastResult = r
            lastMeta = { providerId: id, keyIndex, kind, model }
            if (isKeyIndependentFail(r)) {

                //與金鑰無關, 整組跳過
                emit({ type: 'skip-group', providerId: id, keyIndex, keyId, error: r.error })
                tried.push({ providerId: id, keyIndex, keyId, outcome: 'skip-group', error: r.error, durationMs: r.durationMs })
                skipGroup = true
            }
            else {

                //其餘(含額度上限/金鑰無效/未分類), 換組內下一把, 不記憶不停用
                emit({ type: 'next-key', providerId: id, keyIndex, keyId, error: r.error })
                tried.push({ providerId: id, keyIndex, keyId, outcome: 'next-key', error: r.error, durationMs: r.durationMs })
            }

        }
    }

    //全數失敗, 回傳最後一筆失敗結果與完整歷程
    let r = lastResult || getErrorResult('all providers failed')
    return { ...r, ...(lastMeta || {}), tried }
}


export default dispatchAiFallback
