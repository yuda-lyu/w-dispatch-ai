import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'


// unit-providersConsoleEndpoint.test.mjs — OpenCode Console(原Zen)路徑對齊官方(2026-11-03 da63; Gitea #63; 帳本R-CONSOLE-1)
//
// 規格來源(2026-11-03當日重查, 皆為官方文件, 非 issue 草案之轉述):
//   S1 https://opencode.ai/v2/docs/console/models/ 之〈端點〉欄為完整URL: jev-1.13-free → https://opencode.ai/inference/systemone/v1/systemone;
//      對話型 → https://opencode.ai/inference/openai/v1/chat/completions;GPT系 → https://opencode.ai/inference/openai/v1/responses
//   S2 https://opencode.ai/v2/docs/console/api/inference/ : 基底 https://opencode.ai/inference, 其後依協定分流; 模型清單為例外(/inference/v1/models)
//   S3 https://opencode.ai/v2/docs/console/api/ : 金鑰前綴 oc_sk_
//   S4 https://opencode.ai/v2/docs/console/budgets/ : 預算用盡為 HTTP 429 `Upstream request failed: Policy budget exceeded`(非限流)
//   S5 https://opencode.ai/v2/docs/console/harnesses/ : Go 必帶 x-opencode-session
// 全部不連網、不呼叫任何AI模型(fetch 以替身取代)。「kind×baseURL 與官方端點欄逐項相符」之連網守門在 test/api-providersConsoleEndpoint.test.mjs。


let readSrc = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

//providers.mjs 檔頭註解(第一個 `let OC_READONLY` 之前)
let headOf = () => {
    let t = readSrc('../src/providers.mjs')
    return t.slice(0, t.indexOf('let OC_READONLY'))
}

//取檔頭中自 startMark 起、至 endMark 前之片段; 找不到起點回 ''(令相關斷言紅燈而非 TypeError)
let sectionOf = (head, startMark, endMark) => {
    let i = head.indexOf(startMark)
    if (i < 0) {
        return ''
    }
    let j = head.indexOf(endMark, i + startMark.length)
    return head.slice(i, j < 0 ? undefined : j)
}

//kind → 官方端點欄之基底(S1: baseURL 後接 /chat/completions、/responses、/systemone 即端點欄之完整URL)
let KIND_BASE = {
    'api-openai-compat': 'https://opencode.ai/inference/openai/v1',
    'api-openai-responses': 'https://opencode.ai/inference/openai/v1',
    'api-typesafe-systemone': 'https://opencode.ai/inference/systemone/v1',
}
let isOpencodeAi = (p) => typeof p.baseURL === 'string' && p.baseURL.startsWith('https://opencode.ai/')


describe('providers-OpenCode Console端點(S1、S2)', function() {

    it('目錄內經opencode.ai之REST條目: baseURL 與其kind之官方端點欄基底逐條相符(收錄檢核②「依端點欄挑對kind」)', function() {
        let es = providers.filter(isOpencodeAi)
        let r = [
            es.length > 0, //防比對範圍被悄悄縮成空集合
            es.filter((p) => KIND_BASE[p.kind] !== p.baseURL).map((p) => [p.id, p.kind, p.baseURL]),
        ]
        let rr = [true, []]
        assert.strict.deepEqual(r, rr)
    })

    it('目錄內無任何條目之baseURL落在舊式 /zen/v1 或 /inference/v1(官方文件已不列, 不留舊路徑退路)', function() {
        let r = providers.filter((p) => /^https:\/\/opencode\.ai\/(zen\/v1|inference\/v1)\/?$/.test(String(p.baseURL))).map((p) => p.id)
        assert.strict.deepEqual(r, [])
    })

    it('zen:jev-1.13-free 經 resolveProviders＋dispatchAiFallback 實際送往 /inference/systemone/v1/systemone, 金鑰以Bearer帶出', async function() {
        let urls = []
        let auths = []
        let ori = globalThis.fetch
        globalThis.fetch = async (url, init) => {
            urls.push(String(url))
            auths.push(String((init && init.headers && init.headers.Authorization) || ''))
            return new Response(JSON.stringify({ model: 'jev-1.13-free', answers: { q: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        try {
            let { providers: ps } = resolveProviders(providers, { env: { OPENCODE_KEYS: 'oc_sk_fake_unit' }, pick: ['zen:jev-1.13-free'] })
            let re = await dispatchAiFallback('state', { providers: ps, questions: { q: { type: 'noul', instructions: 'x' } } })
            let r = [re.ok, re.code, urls, auths]
            let rr = [true, 200, ['https://opencode.ai/inference/systemone/v1/systemone'], ['Bearer oc_sk_fake_unit']]
            assert.strict.deepEqual(r, rr)
        }
        finally {
            globalThis.fetch = ori
        }
    })

})


describe('JSDoc與README之範例(S2、S3; 歷史紀錄段與已發布版本之行為變更條目不在此限)', function() {

    //擷取 `baseURL: 'https://opencode.ai/…'`(範例物件)與 `例如'https://opencode.ai/…'`(@param說明)之URL, 及其後2行內之 key: '…' 字面
    let examplesOf = (text) => {
        let lines = text.split(/\r?\n/)
        let out = []
        for (let i = 0; i < lines.length; i++) {
            let m = lines[i].match(/(?:baseURL: |例如)'(https:\/\/opencode\.ai\/[^']*)'/)
            if (!m) {
                continue
            }
            let near = lines.slice(i, i + 3).join('\n')
            let k = near.match(/\bkey: '([^']*)'/)
            out.push({ line: i + 1, url: m[1], key: k ? k[1] : null })
        }
        return out
    }
    let FILES = ['src/dispatchApiOpenaiCompat.mjs', 'src/dispatchApiOpenaiResponses.mjs', 'README.md']
    let OK_URL = ['https://opencode.ai/inference/openai/v1', 'https://opencode.ai/inference/systemone/v1']

    it('範例之opencode.ai baseURL 皆為官方分流路徑(/inference/openai/v1 或 /inference/systemone/v1), 不再是 /zen/v1、/inference/v1', function() {
        let r = []
        let n = 0
        for (let f of FILES) {
            for (let e of examplesOf(readSrc('../' + f))) {
                n++
                if (!OK_URL.includes(e.url)) {
                    r.push([f, e.line, e.url])
                }
            }
        }
        assert.strict.deepEqual([n >= 3, r], [true, []]) //至少涵蓋 Compat×2、Responses×2、README自帶條目 等站點, 防範例被悄悄刪光而空過
    })

    it('範例中緊鄰opencode.ai baseURL 之 key 字面為官方前綴 oc_sk_(S3), 不是舊式 sk-', function() {
        let r = []
        for (let f of FILES) {
            for (let e of examplesOf(readSrc('../' + f))) {
                if (e.key !== null && !e.key.startsWith('oc_sk_')) {
                    r.push([f, e.line, e.key])
                }
            }
        }
        assert.strict.deepEqual(r, [])
    })

    it('Responses轉接器之範例模型不再是已下架之 muse-spark-1.3-contributor-free', function() {
        let t = readSrc('../src/dispatchApiOpenaiResponses.mjs')
        // 檔頭「為何需要」段曾記 muse-spark 系走/responses 之歷史事實, 故只查 JSDoc 之 @param/@example 區(自 `/**` 起)
        let doc = t.slice(t.indexOf('/**'))
        assert.strict.deepEqual(/muse-spark-1\.3-contributor-free/.test(doc), false)
    })

    it('README自帶條目範例(合併進resolveProviders)之 baseURL 為 /inference/openai/v1', function() {
        let t = readSrc('../README.md')
        let i = t.indexOf('**自帶條目（新模型上線快於套件發版時）**')
        let seg = i < 0 ? '' : t.slice(i, i + 900)
        let m = seg.match(/baseURL: '([^']*)'/)
        assert.strict.deepEqual(m ? m[1] : null, 'https://opencode.ai/inference/openai/v1')
    })

})


describe('providers.mjs檔頭(權威來源、端點表、收錄檢核、診斷段; da63)', function() {

    let head = headOf()
    let diag = sectionOf(head, '★ 診斷流程', '★ Zen免費層閘門')
    let src = sectionOf(head, '權威來源', '★ 端點基底改名')
    let table = sectionOf(head, '★ 核心事實', '★ 因此')
    let check = sectionOf(head, '★ 收錄zen:條目前之檢核', '★ 診斷流程')

    it('權威來源列出 Console 之 api/inference、models、api(金鑰)、harnesses、budgets 五頁', function() {
        let need = [
            'https://opencode.ai/v2/docs/console/api/inference/',
            'https://opencode.ai/v2/docs/console/models/',
            'https://opencode.ai/v2/docs/console/api/',
            'https://opencode.ai/v2/docs/console/harnesses/',
            'https://opencode.ai/v2/docs/console/budgets/',
        ]
        assert.strict.deepEqual(need.filter((u) => !src.includes(u)), [])
    })

    it('權威來源不再宣稱 /models「需Bearer金鑰」(匿名亦200), 並載明清單隨金鑰而異', function() {
        let r = [src.includes('需Bearer金鑰'), /匿名/.test(src), /隨金鑰|依該金鑰|金鑰之工作區/.test(src)]
        assert.strict.deepEqual(r, [false, true, true])
    })

    it('端點表為官方分流後之完整路徑(/inference/openai/v1/…、/inference/anthropic/v1/messages、/inference/google/v1beta/…、/inference/systemone/v1/systemone), 不再以 /zen/v1/ 起頭列表', function() {
        let need = [
            '/inference/openai/v1/chat/completions',
            '/inference/openai/v1/responses',
            '/inference/anthropic/v1/messages',
            '/inference/google/v1beta/models/<model-id>:generateContent',
            '/inference/systemone/v1/systemone',
        ]
        let r = [need.filter((u) => !table.includes(u)), /\n\/\/\s+\/zen\/v1\//.test(table)]
        assert.strict.deepEqual(r, [[], false])
    })

    it('收錄檢核①載明 systemone(jev系)不在 /models 清單但可用之例外; ②載明 /messages 之 x-api-key 假金鑰探測結果', function() {
        //第2項須命中「2026-11-03以假金鑰探測」該句內之 x-api-key 與 Invalid credential(②條原文另有一般性之 x-api-key 字樣, 不能單以其存在判定)
        let r = [/jev/.test(check) && /例外/.test(check), /2026-11-03以假金鑰探測[\s\S]{0,200}x-api-key[\s\S]{0,200}Invalid credential/.test(check) && /Missing API key/.test(check)]
        assert.strict.deepEqual(r, [true, true])
    })

    it('診斷段: 429 分 FreeUsageLimitError(免費額度/閘門)與 Policy budget exceeded(預算用盡, 非限流)兩種, 不再寫成「閘道容量型限流…暫時性」', function() {
        let r = [
            diag.includes('FreeUsageLimitError'),
            diag.includes('Policy budget exceeded'),
            /預算用盡/.test(diag) && /非限流/.test(diag),
            diag.includes('閘道容量型限流'),
        ]
        assert.strict.deepEqual(r, [true, true, true, false])
    })

    it('診斷段: 400 MissingSessionID(打 /inference/go/… 未帶 x-opencode-session; 先於金鑰檢查)', function() {
        let r = [diag.includes('MissingSessionID'), diag.includes('x-opencode-session'), diag.includes('/inference/go/')]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('診斷段之 HTTP 500 驗法範例使用官方路徑 /inference/openai/v1/responses', function() {
        let r = [diag.includes('https://opencode.ai/inference/openai/v1/responses'), diag.includes('https://opencode.ai/zen/v1/responses')]
        assert.strict.deepEqual(r, [true, false])
    })

})
