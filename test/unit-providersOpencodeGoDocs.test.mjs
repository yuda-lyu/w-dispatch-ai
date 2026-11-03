import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import providers from '../src/providers.mjs'


// unit-providersOpencodeGoDocs.test.mjs — OpenCode Go 之檔頭／條目註解／README 文字守門(Gitea #65, 2026-11-03 da65; 帳本 sgud/rule/rulebook_opencodego.md R-OCGO-1、R-OCGO-3)
//
// 任務書〈要做的事〉2、5: 條目註解載明隱私前提; 實測不到者不得寫成已驗證(標明未實測); REST類Go條目不收之理由寫入檔頭;
//   providers.mjs／dispatchOpencode.mjs檔頭補Go段(provider分流、錯誤字樣對照、隱私前提); 條數相關之README、resolveProviders註解同步; README寫明Go之用法;
//   文件未載之用量端點須標明是實測所得、非官方承諾。
// 斷言一律錨定在「目標句」本身(帳本R-CONSOLE-1教訓: 只查同區段別處也會出現的字樣,刪掉目標句仍綠)。


let readSrc = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

let providersSrc = readSrc('../src/providers.mjs')
let head = providersSrc.slice(0, providersSrc.indexOf('let OC_READONLY'))

//檔頭【OpenCode Go】段(自標題起至下一個頂層標題「【zen免費模型清單」止)
let goHead = (() => {
    let i = head.indexOf('【OpenCode Go(月費訂閱) 接入方式')
    let j = head.indexOf('【zen免費模型清單', i + 1)
    return i < 0 ? '' : head.slice(i, j < 0 ? undefined : j)
})()

//各ocgo:條目於原始碼中的註解與欄位片段(自該id行起至下一個id行止)
let entrySrc = (id) => {
    let i = providersSrc.indexOf(`id: '${id}'`)
    if (i < 0) {
        return ''
    }
    let j = providersSrc.indexOf('id: \'', i + 10)
    return providersSrc.slice(i, j < 0 ? undefined : j)
}

//註記: 本機實測了什麼(以「〔本機實測〕」與「本機未實測」標示); 依任務書〈必要之測試〉實呼金絲雀之範圍
//anchor: 本機實測之「證據句」(標記須緊接實測結果, 不只是條目內任一處出現〔本機實測〕字樣)
let LOCAL = {
    'ocgo:opencode-go/beam-free': { local: true, proposer: false, anchor: '〔本機實測〕(opencode 1.19.5、variant high): 簡答5.5s與6.1s、推理題4.9s答對(54)' },
    'ocgo:opencode-go/iceman-contributor-free': { local: true, proposer: true, anchor: '〔本機實測〕(opencode 1.19.5、OC_READONLY): 簡答6.5s、推理題8.0s答對(54)' }, //proposer: 隱私開關未開之錯誤字樣為提出端自述
    'ocgo:opencode-go/glm-5.3-flash': { local: true, proposer: true, anchor: '〔本機實測〕本條為本輪唯一一次付費簡答(variant high、OC_READONLY): 36.7s成功' },
    'ocgo:opencode-go/deepseek-v4.1-flash': { local: false, proposer: true },
    'ocgo:opencode-go/minimax-m3.1-flash': { local: false, proposer: true },
    'ocgo:opencode-go/qwen3.8-flash': { local: false, proposer: true },
    'ocgo:opencode-go/mimo-v2.6-flash': { local: false, proposer: true },
    'ocgo:opencode-go/muse-spark-1.3-contributor': { local: false, proposer: true },
}


describe('providers.mjs檔頭【OpenCode Go】段', function() {

    it('標題在、官方權威來源為Go頁與其佐證頁(含當日日期)、並標明models.dev之opencode-go', function() {
        let r = [
            goHead.includes('【OpenCode Go(月費訂閱) 接入方式——動 ocgo:條目前必讀】(2026-11-03 da65, Gitea #65'),
            goHead.includes('https://opencode.ai/v2/docs/console/go/        ← 【主】方案、模型表、各模型月額、額度比例、隱私前提、端點、Extra Usage'),
            goHead.includes('https://opencode.ai/inference/go/v1/models     ← Go公開型錄(匿名可查; 當日28個;'),
            goHead.includes('https://models.dev/api.json 之 opencode-go'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('provider分流: opencode/<id>走免費池或按量、opencode-go/<id>走Go月費額度; 同一把金鑰; Go訂閱不改變opencode/*免費上限', function() {
        let r = [
            goHead.includes('★ provider分流: 同一把工作區金鑰(前綴oc_sk_), 兩個provider id, 額度池與計費完全不同 ★'),
            goHead.includes('opencode/<id>     provider opencode     免費池或按量(餘額)'),
            goHead.includes('opencode-go/<id>  provider opencode-go  Go月費額度'),
            goHead.includes('Go訂閱不改變 opencode/* 之免費上限'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('「Model access is disabled」現有兩種成因並載明(按量工作區未開該模型／付費id錯用opencode/前綴)', function() {
        let r = [
            goHead.includes('此字樣現有兩種成因'),
            goHead.includes('①按量工作區未開該模型'),
            goHead.includes('②付費id錯用 opencode/ 前綴(應為 opencode-go/)'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('金鑰變數: 另立OPENCODE_GO_KEYS不沿用OPENCODE_KEYS, 附本機實測依據(同一份OPENCODE_KEYS第1把200、第2把403; 未訂閱金鑰打Go模型77秒失敗)', function() {
        let r = [
            goHead.includes('★ 金鑰變數: OPENCODE_GO_KEYS, 不沿用 OPENCODE_KEYS ★'),
            goHead.includes('第1把Go用量端點200(已訂閱)、第2把403 EntitlementError「OpenCode Go subscription required.」(未訂閱)'),
            goHead.includes('An active OpenCode Go subscription is required to use Go models.'),
            goHead.includes('opencode內部重試後77秒才exit 1〔本機實測, 1次〕'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('REST類Go條目不收之理由寫入檔頭(必帶x-opencode-session、400 MissingSessionID、官方限coding agent、一般REST是否允許官方未載)', function() {
        let r = [
            goHead.includes('★ 為何只收CLI類、不收REST類Go條目 ★'),
            goHead.includes('必帶穩定之 x-opencode-session 標頭: 缺則400 MissingSessionID(先於金鑰檢查, 以假金鑰實測)'),
            goHead.includes('一般REST呼叫是否被官方允許文件未載, 保守不收'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('用量端點標明為實測所得、非官方承諾; 遞補層不接用量之理由(Go到頂時run之行為未查明)', function() {
        let r = [
            goHead.includes('三視窗之查詢端點「官方文件未載」, 為實測所得、非官方承諾: GET https://opencode.ai/inference/go/v1/usage'),
            goHead.includes('遞補層(dispatchAiFallback)不查用量、不依用量冷卻——Go額度到頂時 `opencode run` 之行為未查明'),
        ]
        assert.strict.deepEqual(r, [true, true])
    })

    it('隱私前提: 預設擋train-on-data與地區、DeepSeek須Global、Muse／Iceman須開關; iceman／muse訓練Yes; 附兩句原文字樣', function() {
        let r = [
            goHead.includes('★ 隱私前提〔官方Go頁〈Enable restricted models〉〈Privacy〉'),
            goHead.includes('DeepSeek V4.1 Flash／V4 Pro: Regions須選Global, 否則「This Go model requires Global regions. Select Global in your workspace\'s Privacy settings to use it.」〔提出端〕'),
            goHead.includes('Allow paid endpoints that train on request data」, 否則'),
            goHead.includes('This Go model trains on request data. Allow paid endpoints that train on request data in your workspace\'s Privacy settings to use it.'),
            goHead.includes('iceman、muse＝訓練Yes且非零保留(敏感內容勿走'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true])
    })

    it('錯誤字樣對照: 本機實測兩句(無訂閱、id不在型錄)與免費池用盡之辨別; 提出端自述者標明本機未重現; Go到頂未知', function() {
        let r = [
            goHead.includes('「ProviderModelNotFoundError: Model not found: opencode-go/<id>」〔本機實測, 1.7秒〕'),
            goHead.includes('「Free usage limit reached…subscribe to OpenCode Go to keep going」〔本機實測〕＝ opencode/* 免費池用盡, 不是Go額度'),
            goHead.includes('「Model is unavailable」〔提出端〕'),
            goHead.includes('Go額度到頂之字樣與CLI行為: 未撞到, 未知。'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('收錄範圍: 8條與未收之22個及理由(提出端未測、本機不得多次發付費請求; 依R-OCFREE-2「實測不到者不收」)', function() {
        let r = [
            goHead.includes('ocgo:共8條, 置於oc:opencode/*之後、agy:之前'),
            goHead.includes('未收之其餘22個Go模型('),
            goHead.includes('依R-OCFREE-2「實測不到者不收」之精神不收'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('既有舊句已更正: 不再寫「本目錄無Go條目」', function() {
        assert.strict.deepEqual(head.includes('本目錄無Go條目'), false)
    })

})


describe('各ocgo:條目註解(實測不到者不得寫成已驗證)', function() {

    for (let id of Object.keys(LOCAL)) {
        it(`${id}: 載明〔CLI型錄〕欄位與官方隱私／單價; 實測狀態標示與事實相符`, function() {
            let s = entrySrc(id)
            let want = LOCAL[id]
            let r = [
                s !== '',
                s.includes('〔CLI型錄〕'),
                s.includes('〔本機實測〕') === want.local,
                s.includes('〔提出端〕') === want.proposer,
                want.local ? !s.includes('本機未實測') : s.includes('本機未實測'),
                /官方: |官方Privacy: /.test(s),
                want.local ? s.includes(want.anchor) : true,
            ]
            assert.strict.deepEqual(r, [true, true, true, true, true, true, true])
        })
    }

    it('隱私前提逐條載明: deepseek須Global、iceman與muse為訓練資料(敏感勿走)並須開關、beam-free限地區且保留30天', function() {
        let r = [
            entrySrc('ocgo:opencode-go/deepseek-v4.1-flash').includes('須先於工作區Settings›Privacy›Regions選Global'),
            entrySrc('ocgo:opencode-go/iceman-contributor-free').includes('【訓練資料】官方Privacy'),
            entrySrc('ocgo:opencode-go/iceman-contributor-free').includes('工作區須開「Allow paid endpoints that train on request data」'),
            entrySrc('ocgo:opencode-go/muse-spark-1.3-contributor').includes('【訓練資料】官方Privacy'),
            entrySrc('ocgo:opencode-go/muse-spark-1.3-contributor').includes('工作區須開「Allow paid endpoints that train on request data」'),
            entrySrc('ocgo:opencode-go/beam-free').includes('不訓練、保留30天、限地區'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true])
    })

    it('qwen3.8-flash註解載明無high檔而取xhigh、偏離「一律high」並待裁示; iceman註解載明脈絡實測上限(262139、輸入約23萬)', function() {
        let r = [
            entrySrc('ocgo:opencode-go/qwen3.8-flash').includes('僅low/medium/xhigh、無high, 故取不低於high之最高檔xhigh'),
            entrySrc('ocgo:opencode-go/qwen3.8-flash').includes('待使用者裁示'),
            entrySrc('ocgo:opencode-go/iceman-contributor-free').includes('伺服器上限262139'),
            entrySrc('ocgo:opencode-go/iceman-contributor-free').includes('輸入實際上限約23萬token'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('glm-5.3-flash註解不把「用量計入」寫成已證明(+1%無法歸因於這1次簡答)', function() {
        let s = entrySrc('ocgo:opencode-go/glm-5.3-flash')
        assert.strict.deepEqual([s.includes('無法歸因於這1次'), s.includes('「用量計入」未能由此證明')], [true, true])
    })

    it('目錄之ocgo:條目數與README／resolveProviders註解之37一致', function() {
        let n = providers.length
        let readme = readSrc('../README.md')
        let rp = readSrc('../src/resolveProviders.mjs')
        let r = [
            n,
            readme.includes('量級感受：內建providers 37條全上陣時'),
            rp.includes('// => 37 []') && rp.includes('內建條目共37條'),
        ]
        assert.strict.deepEqual(r, [37, true, true])
    })

})


describe('dispatchOpencode.mjs檔頭【OpenCode Go】段', function() {

    let src = readSrc('../src/dispatchOpencode.mjs')
    let i = src.indexOf('【OpenCode Go(月費訂閱)——provider opencode-go')
    let j = src.indexOf('【第三方provider須另給config', i + 1)
    let sec = i < 0 ? '' : src.slice(i, j < 0 ? undefined : j)

    it('provider分流(同一把金鑰兩個provider id; 注入鍵為opencode-go)與REST不收之理由', function() {
        let r = [
            sec.includes('同一把Console工作區金鑰(前綴oc_sk_)有兩個provider id'),
            sec.includes('OPENCODE_AUTH_CONTENT={"opencode-go":{type:\'api\',key}}'),
            sec.includes('直打Go之REST基底須自帶該標頭(缺則400 MissingSessionID), 故本套件只收CLI類Go條目'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('錯誤字樣對照: 本機實測三句(無訂閱77秒、id不在型錄、免費池用盡不影響Go)與提出端自述者之區分', function() {
        let r = [
            sec.includes('未訂閱Go之金鑰 → stderr「Upstream request failed: An active OpenCode Go subscription is required to use Go models.」, opencode內部重試約77秒才exit 1'),
            sec.includes('id不在Go型錄 → 「ProviderModelNotFoundError: Model not found: opencode-go/<id>.」, 約1.7秒即exit 1'),
            sec.includes('「Free usage limit reached…subscribe to OpenCode Go to keep going」＝ provider opencode之免費池用盡, 不影響opencode-go/之模型'),
            sec.includes('〔issue #65提出端自述, 本機未重現〕'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('隱私前提與Go到頂行為未查明', function() {
        let r = [
            sec.includes('隱私前提: Go繼承工作區Settings›Privacy'),
            sec.includes('iceman與muse會以提示詞訓練模型, 敏感內容勿走'),
            sec.includes('Go額度到頂時run之行為與字樣未查明'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

})


describe('opencodeGoUsage.mjs檔頭與README', function() {

    it('檔頭標明端點「不在官方文件內」、為實測所得非官方承諾, 並記上游PR與形狀曾變', function() {
        let src = readSrc('../src/opencodeGoUsage.mjs')
        let r = [
            src.includes('這個端點「不在官方文件內」'),
            src.includes('端點為實測所得, 非官方承諾, 形狀可能無預警改變'),
            src.includes('anomalyco/opencode之PR #16513'),
            src.includes('nextResetAt   「被限視窗全部解除」之最早時刻(ISO字串): 取被限視窗之 resetsAt 的**最晚者**'),
            src.includes('判讀: 用 available, 不要用 !limited'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true])
    })

    it('README: 函數表列opencodeGoUsage並標明端點不在官方文件; 行為變更第62條; Go用法段含ocgo:與OPENCODE_GO_KEYS', function() {
        let readme = readSrc('../README.md')
        let r = [
            readme.includes('| `opencodeGoUsage({ key, baseURL, timeoutMs })` |'),
            readme.includes('**The endpoint is not in the official docs — it is observed behaviour (2026-11-03), not a promise.**'),
            readme.includes('62. 內建 providers 新增 **8 條 OpenCode Go 之 CLI 類條目**'),
            readme.includes('**OpenCode Go（月費訂閱）：8 條 `ocgo:` 條目與用量查詢 `opencodeGoUsage`（2026-11-03 起，Gitea #65）**'),
            readme.includes('//.env: OPENCODE_GO_KEYS=oc_sk_xxxx（只放「已訂閱 Go」之工作區金鑰'),
            readme.includes('**沒有 REST 類 Go 條目**'),
            readme.includes('**遞補層不接用量**'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true])
    })

})
