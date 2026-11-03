import assert from 'assert'
import providers from '../src/providers.mjs'


// api-providersConsoleEndpoint.test.mjs — 目錄經opencode.ai之REST條目 與 官方〈Models〉頁端點欄 逐條相符之連網守門(2026-11-03 da63; 帳本R-CONSOLE-1)
//
// 【本檔需要連網】只GET官方文件頁 https://opencode.ai/v2/docs/console/models/ (HTML, 約58KB; 不呼叫任何模型、不耗額度、不帶金鑰)。
//   與純單元案(test/unit-providersConsoleEndpoint.test.mjs)分開: 本檔結果隨官方文件當日狀態而變, 屬「漂移守門」——
//   紅燈意謂官方端點欄與條目之 baseURL＋kind 路徑不一致(或文件已不列該model), 須依providers.mjs檔頭〈收錄zen:條目前之檢核〉重查, 不是程式缺陷。
//
// 【環境不足時略過(pending)而非通過】離線、HTTP非200、頁面無任何端點欄(非預期格式): 於before以this.skip()略過並印出原因。
//   但「頁面可讀且有端點欄、卻查無該條目之model」不是環境不足, 是官方已不列/改名, 一律紅燈。
//
// 規格: 官方〈Models〉頁之〈端點〉欄為完整URL(如 jev-1.13-free → https://opencode.ai/inference/systemone/v1/systemone);
//   本套件三個REST轉接器分別固定接上 /chat/completions、/responses、/systemone 於 baseURL 之後。


let KIND_PATH = {
    'api-openai-compat': '/chat/completions',
    'api-openai-responses': '/responses',
    'api-typesafe-systemone': '/systemone',
}

let escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

//HTML → 以 ' | ' 分隔儲存格之純文字
let toText = (h) => h
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/t[dh]>/g, ' | ')
    .replace(/<\/(p|li|tr|h[1-6]|pre|div|table|ul|ol)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')


describe('providers與官方〈Models〉頁端點欄之對照(連網守門)', function() {

    this.timeout(60000)

    let text = ''

    before(async function() {
        let res = null
        try {
            res = await fetch('https://opencode.ai/v2/docs/console/models/', { signal: AbortSignal.timeout(45000) })
        }
        catch (err) {
            console.log(`[略過] 取官方〈Models〉頁失敗: ${String(err && err.message)}`)
            this.skip()
        }
        if (res.status !== 200) {
            console.log(`[略過] 官方〈Models〉頁 HTTP ${res.status}`)
            this.skip()
        }
        text = toText(await res.text())
        if (!/https:\/\/opencode\.ai\/inference\/[a-z0-9/_.:-]+\s*\|/.test(text)) {
            console.log('[略過] 官方〈Models〉頁無任何端點欄(頁面格式與預期不同), 不得當成守門通過')
            this.skip()
        }
    })

    it('目錄經opencode.ai之REST條目: 官方端點欄 === baseURL＋該kind固定接上之路徑(查無該model列 → 紅燈)', function() {
        let es = providers.filter((p) => typeof p.baseURL === 'string' && p.baseURL.startsWith('https://opencode.ai/'))
        let bad = []
        for (let p of es) {
            let m = text.match(new RegExp('\\|\\s*' + escRe(p.model) + '\\s*\\|\\s*(https://[^\\s|]+)'))
            let doc = m ? m[1] : null
            let mine = p.baseURL.replace(/\/+$/, '') + (KIND_PATH[p.kind] || '(未知kind)')
            if (doc !== mine) {
                bad.push({ id: p.id, doc, mine })
            }
        }
        assert.strict.deepEqual([es.length > 0, bad], [true, []])
    })

})
