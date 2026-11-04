import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { DEFAULT_OUTPUT_TOKEN_MAX, OUTPUT_TOKEN_MAX_ENV } from '../src/outputTokenMax.mjs'


// unit-opencodeOutputCapDocs.test.mjs — 輸出上限與截斷診斷之檔頭／README 文字守門(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 對應規格句(任務書〈要做的事〉3): providers.mjs檔頭新增診斷段(症狀、根因、opencode export診斷法、處置、仍未查證之處; 內容以實測為準, 不抄提案數字);
//   README寫明調高上限對逾時與額度之影響、環境變數優先序。
// 斷言一律錨定在「目標句」本身(帳本R-CONSOLE-1教訓)。


let readSrc = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let providersSrc = readSrc('../src/providers.mjs')
let readme = readSrc('../README.md')
let dispatchSrc = readSrc('../src/dispatchOpencode.mjs')

//檔頭診斷段(自標題起至下一個頂層標題止)
let diag = (() => {
    let i = providersSrc.indexOf('【輸出上限與截斷診斷——推理模型長提示詞')
    let j = providersSrc.indexOf('【zen免費模型清單', i + 1)
    return i < 0 ? '' : providersSrc.slice(i, j < 0 ? undefined : j)
})()


describe('providers.mjs檔頭【輸出上限與截斷診斷】段', function() {

    it('段存在, 且五個必載項(症狀、根因、診斷、處置、仍未查證)各有標題', function() {
        let r = ['★ 症狀 ★', '★ 根因 ★', '★ 診斷 ★', '★ 處置(本套件已做) ★', '★ 仍未查證 ★'].map((s) => diag.includes(s))
        assert.strict.deepEqual([diag !== '', r], [true, [true, true, true, true, true]])
    })

    it('根因句: 32,000是opencode CLI端預設而非閘道限制、非型錄limit.output, 並寫出max_tokens公式與環境變數名', function() {
        let r = [
            diag.includes('單次回應輸出上限是opencode「CLI端」的預設值32,000 token, 不是Go閘道、也不是模型型錄之limit.output'),
            diag.includes('opencode以min(型錄limit.output, 環境變數OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX或預設32000)作為請求之max_tokens'),
            diag.includes(OUTPUT_TOKEN_MAX_ENV),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('實測數字錨在實測句: 預設上限下reasoning恰32000／output 0; 上限128000下glm 32768＋1137、deepseek 70358＋964; 設3000時恰3000', function() {
        let r = [
            diag.includes('預設上限: glm、deepseek皆finish=length、reasoning恰32000、output 0'),
            diag.includes('設上限3000(deepseek): finish=length、reasoning恰3000'),
            diag.includes('glm finish=stop(reasoning 32768＋output 1137)'),
            diag.includes('deepseek finish=stop(reasoning 70358＋output 964)'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('診斷法: opencode session list --format json取sessionID、opencode export <sessionID>看finish與tokens、finish為length且reasoning＋output＝上限即中', function() {
        let r = [
            diag.includes('`opencode session list --format json`'),
            diag.includes('`opencode export <sessionID>`: 看assistant訊息之finish與tokens(reasoning／output)'),
            diag.includes('finish為length且reasoning＋output＝上限(預設32000)即中'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('處置: 維持「思考強度一律high」、不以降檔位當解法; 調高上限對逾時與額度之影響; 不加大timeoutMs解截斷也不重試', function() {
        let r = [
            diag.includes('「思考強度一律high」原則維持, 不以降檔位(--variant low)當解法'),
            diag.includes('調高上限後單次呼叫可能更久、更耗額度'),
            diag.includes('上限本身不延長逾時'),
            diag.includes('不要以加大timeoutMs當截斷對策(回應早已結束), 也不要重試同一請求(確定性)'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('仍未查證: 其餘ocgo模型未實測、oc:免費池未實測、content_filter不呈現為step_finish; 不得抄提案原稱之「閘道單次輸出上限」', function() {
        let r = [
            diag.includes('其餘ocgo:模型(minimax-m3.1-flash、qwen3.8-flash、mimo-v2.6-flash、muse-spark-1.3-contributor、beam-free)於128000上限之接受度與耗時未實測'),
            diag.includes('oc:免費池條目調高上限後之行為未實測'),
            diag.includes('content_filter: opencode不以step_finish呈現而是error事件＋離開碼1'),
            diag.includes('issue #78原稱「32,000是閘道限制(或CLI端, 未查證)」, 實測為CLI端預設'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true])
    })

    it('段內預設值與outputTokenMax.mjs之DEFAULT_OUTPUT_TOKEN_MAX一致', function() {
        assert.strict.deepEqual(diag.includes(`把上限調為${DEFAULT_OUTPUT_TOKEN_MAX}`), true)
    })

    it('三條維持32000之條目都明給outputTokenMax: 32000並附理由', function() {
        let n = (providersSrc.match(/outputTokenMax: 32000, \/\//g) || []).length
        assert.strict.deepEqual(n, 3)
    })

})


describe('dispatchOpencode.mjs檔頭與README', function() {

    it('dispatchOpencode.mjs檔頭載【單次回應輸出上限】與【截斷偵測】兩段', function() {
        let r = [
            dispatchSrc.includes('【單次回應輸出上限: 預設注入OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX(2026-11-04 da78, Gitea #78'),
            dispatchSrc.includes('【截斷偵測(opt.detectTruncation, 預設false; 2026-11-04 da78)】'),
            dispatchSrc.includes(`[opt.outputTokenMax=${DEFAULT_OUTPUT_TOKEN_MAX}]`),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('README: Options表三列(outputTokenMax、detectTruncation、acceptTruncated)與優先序、代價句', function() {
        let r = [
            readme.includes('| `outputTokenMax` | Integer\\|String | `' + DEFAULT_OUTPUT_TOKEN_MAX + '` |'),
            readme.includes('| `detectTruncation` | Boolean | `false` |'),
            readme.includes('| `acceptTruncated` | Boolean | `false` |'),
            readme.includes('取值優先序：①`opt.outputTokenMax`（有效正整數，數字或數字字串）→ ②呼叫端環境（`opt.env` 或本行程 `process.env`）已設之有效值（原樣保留，不覆蓋）→ ③套件預設'),
            readme.includes('不延長 `timeoutMs`，長推理真的用到上限時耗時隨之增加'),
            readme.includes('③額度只計實際產出之 token'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true])
    })

    it('README: 行為變更第64條載明根因（CLI端預設）、行為變更（更久／輸入餘裕／ocgo的argv與stderr）、未實測項', function() {
        let i = readme.indexOf('64. ①**根因查明')
        let seg = i < 0 ? '' : readme.slice(i, readme.indexOf('#### Options shared by all dispatch functions:', i))
        let r = [
            seg.includes('32,000 是 opencode CLI 端預設'),
            seg.includes('故主修法是調高上限，不是降檔位；「思考強度一律 high」維持'),
            seg.includes('可能比修前**更久、單次 token 用量更高**'),
            seg.includes('其 argv 多 `--format json`、`stderr` 不再含 `> agent · model` 標頭與工具進度行'),
            seg.includes('**未實測**：minimax-m3.1-flash、qwen3.8-flash、mimo-v2.6-flash、muse-spark-1.3-contributor、beam-free 於 128000 上限之接受度與耗時'),
        ]
        assert.strict.deepEqual([i > 0, r], [true, [true, true, true, true, true]])
    })

    it('README: 診斷小節寫出根因、session list／export診斷法、處置與未查證', function() {
        let i = readme.indexOf('**推理模型長提示詞回空字串／被截斷（opencode 單次輸出上限')
        let seg = i < 0 ? '' : readme.slice(i, readme.indexOf('**配套工具**', i))
        let r = [
            seg.includes('**不是閘道限制，也不是型錄 `limit.output`**'),
            seg.includes('`opencode session list --format json` 取 sessionID'),
            seg.includes('再 `opencode export <sessionID>` 看 assistant 訊息之 `finish` 與 `tokens`'),
            seg.includes('**不要**以加大 `timeoutMs` 解截斷（回應早已結束）、**不要**重試同一請求（確定性）'),
            seg.includes('**未查證**'),
        ]
        assert.strict.deepEqual([i > 0, r], [true, [true, true, true, true, true]])
    })

})
