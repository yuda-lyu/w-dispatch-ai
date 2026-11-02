import assert from 'assert'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import strTruncateReal from 'wsemi/src/strTruncate.mjs'
import { oneline } from '../src/wkf/logAiOutcome.mjs'
import { maskApiKeys } from '../src/redactText.mjs'
import strictStrTruncate, { getState } from './tools/strictStrTruncateForTest.mjs'
import { N_CASES, RAW, FLAT, expectedOf } from './tools/onelineCasesForTest.mjs'


// unit-onelineStrictN.test.mjs — logAiOutcome.mjs之oneline自行檢查截斷字數n(2026-11-02 r3da; 帳本R-LOG-2)
//
// 規格來源: 主控r3da提示詞〈本套件之站點〉與〈背景〉:
//   S1 oneline自行檢查n(以iseint之count判定), 有效才Number(n)交給strTruncate, 無效則不截斷(回壓平之整行; 與w-data-pipeline 1.0.25之oneline同語意);
//   S2 有效輸入之輸出逐字不變;
//   S3 wsemi第3輪後strTruncate之maxLen為必須參數(iseint之count), 未給或非預期即拋錯 → 下游不得傳無效值(前瞻驗證: 以嚴格版替身證明不拋錯)。
// 嚴格版替身(test/tools/strictStrTruncateForTest.mjs)經module.register換入src內之strTruncate, 於子行程(probeOnelineStrictForTest.mjs)執行, src與wsemi皆不改。
// oneline之n輸入表(onelineCasesForTest.mjs)測試與探針共用。


let PROBE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'probeOnelineStrictForTest.mjs')


//runProbe, 啟動子行程探針並解析其單行JSON; 子行程失敗即fail
function runProbe() {
    let r = spawnSync(process.execPath, [PROBE], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
    assert.strict.equal(r.status, 0, `探針子行程離開碼${r.status}: ${r.stderr}`)
    let lastLine = r.stdout.trim().split('\n').pop()
    return JSON.parse(lastLine)
}


//unstringable, String()會拋錯之物件(oneline之s須視為空字串)
let unstringable = {
    toString() {
        throw new Error('x')
    },
}


//refOld, 修前之oneline公式(strTruncate(壓平行, n)直接交n), 以現行wsemi之strTruncate為底, 作「有效輸入逐字不變」之對照
function refOld(s, n) {
    let t = ''
    try {
        t = maskApiKeys(String(s ?? ''))
    }
    catch {
        t = ''
    }
    return strTruncateReal(t.replace(/\s+/g, ' ').trim(), n)
}


describe('oneline之n檢查（現行wsemi，直接呼叫）', function() {

    // S1: 有效n（iseint count）依Number(n)截斷補刪節號, 無效n不截斷回整行, 皆不throw
    it('n輸入表: 有效n截斷、無效n回壓平整行（含0、\'80\'、null、-1、1.5、Infinity、\'abc\'、包裝物件、取值即拋錯之物件）', function() {
        for (let c of N_CASES) {
            let out = null
            assert.strict.doesNotThrow(() => {
                out = oneline(RAW, c.n)
            }, `case ${c.label} 不應throw`)
            assert.strict.equal(out, expectedOf(c.keep), `case ${c.label}`)
        }
    })

    it('表覆蓋: 有效與無效n皆有、含0與count上限、含包裝物件與BigInt', function() {
        let labels = N_CASES.map((c) => c.label)
        assert.strict.equal(N_CASES.filter((c) => c.keep !== null).length >= 8, true)
        assert.strict.equal(N_CASES.filter((c) => c.keep === null).length >= 20, true)
        for (let need of ['0', '"80"', 'null', '-1', '1.5', 'Infinity', '"abc"', 'new Number(80)(包裝物件)', '80n(BigInt)', '4294967295(count上限)', '4294967296(超過count)']) {
            assert.strict.equal(labels.includes(need), true, `缺case ${need}`)
        }
    })

    // S1: s之處理不變(null／undefined視為空、無法轉字串視為空), 與n無關
    it('s: null／undefined／無法轉字串者視為空字串；壓平空白；金鑰樣式先遮蔽；n無效時亦同', function() {
        for (let n of [80, null, 'abc', 0]) {
            assert.strict.equal(oneline(null, n), '')
            assert.strict.equal(oneline(undefined, n), '')
            assert.strict.equal(oneline(unstringable, n), '')
        }
        assert.strict.equal(oneline('a\n\n  b\tc ', null), 'a b c') //n無效: 壓平後整行
        assert.strict.equal(oneline('a\n\n  b\tc ', 80), 'a b c')
        assert.strict.equal(oneline('', 0), '') //空字串不補刪節號
        let masked = oneline('x sk-ant-api03-SECRETSECRET1234 y', null)
        assert.strict.equal(masked.includes('SECRETSECRET'), false) //n無效亦先遮蔽
    })

    // S2: 有效輸入之輸出逐字不變(對照修前公式)
    it('有效n（數字與數字字串）× 多種輸入: 輸出與修前公式（strTruncate(壓平行, n)）逐字相同', function() {
        //corpus, 含空字串、剛好80／60字及前後、中文、surrogate pair、金鑰樣式、非字串；'line1…'一項內含NBSP(U+00A0)與全形空白(U+3000)
        let corpus = [
            '', ' ', 'abc', 'a\nb\n\nc', 'x'.repeat(100), 'x'.repeat(80), 'x'.repeat(81), 'x'.repeat(60), 'x'.repeat(61),
            '中文錯誤訊息'.repeat(30), 'emoji😀'.repeat(30), 'line1\r\nline2' + String.fromCharCode(0xa0) + 'line3' + String.fromCharCode(0x3000) + 'line4',
            'k sk-ant-api03-ABCDEFGH12345678 end '.repeat(4), RAW, FLAT, null, undefined, 123, true, unstringable,
        ]
        let ns = [0, 1, 3, 59, 60, 61, 79, 80, 81, 100, 500, 4294967295, '0', '60', '80', ' 80 ']
        let n = 0
        for (let s of corpus) {
            for (let k of ns) {
                assert.strict.equal(oneline(s, k), refOld(s, k), `s=${String(typeof s === 'object' && s !== null ? 'obj' : s).slice(0, 12)} n=${JSON.stringify(k)}`)
                n++
            }
        }
        assert.strict.equal(n, corpus.length * ns.length)
    })

})


describe('oneline之n檢查（嚴格版strTruncate替身，前瞻驗證）', function() {

    let probe = null
    before(function() {
        probe = runProbe()
    })

    // S3: 替身自證嚴格(否則下列斷言為空轉)
    it('替身自證: 無效maxLen一律拋錯；有效maxLen輸出與現行strTruncate逐字相同；被呼叫有記錄', function() {
        let st = getState()
        let keepCalls = st.calls.length
        let keepThrows = st.throws
        for (let bad of [undefined, null, -1, 1.5, Infinity, NaN, 'abc', '', new Number(3), 3n, [3], {}, true]) { // eslint-disable-line no-new-wrappers
            assert.strict.throws(() => strictStrTruncate('abcdef', bad), /maxLen is required/, `maxLen=${String(typeof bad)}`)
        }
        assert.strict.throws(() => strictStrTruncate('abcdef'), /maxLen is required/) //未給
        assert.strict.throws(() => strictStrTruncate('', null), /maxLen is required/) //空字串亦拋(更嚴)
        assert.strict.throws(() => strictStrTruncate(undefined, undefined), /maxLen is required/)
        for (let ok of [0, 1, 3, 6, 80, '3']) {
            assert.strict.equal(strictStrTruncate('abcdef', ok), strTruncateReal('abcdef', ok))
        }
        assert.strict.equal(strictStrTruncate('abcdef', 3, { funWithMsg: (s) => `(${s.length})` }), strTruncateReal('abcdef', 3, { funWithMsg: (s) => `(${s.length})` }))
        assert.strict.equal(strictStrTruncate(null, 3), '') //非字串回空字串
        assert.strict.equal(st.throws - keepThrows, 16)
        assert.strict.equal(st.calls.length - keepCalls, 8)
    })

    // S3 + 修前紅之重現: 改前寫法(n直接交strTruncate)在嚴格版下對無效n拋錯
    it('改前寫法（n直接交strTruncate）在嚴格版下: 無效n全部拋錯、有效n不拋 —— 即修前紅之成因', function() {
        for (let c of N_CASES) {
            let old = () => strictStrTruncate(FLAT, c.n)
            if (c.keep === null) {
                assert.strict.throws(old, /maxLen is required/, `case ${c.label} 改前寫法應拋錯`)
            }
            else {
                assert.strict.doesNotThrow(old, `case ${c.label} 改前寫法有效n不應拋`)
            }
        }
    })

    // S1+S3: src之oneline在嚴格版下不拋錯、輸出正確
    it('src之oneline於嚴格版替身下: n輸入表每個case皆不拋錯，輸出與規格一致', function() {
        assert.strict.equal(probe.cases.length, N_CASES.length)
        for (let i = 0; i < N_CASES.length; i++) {
            let c = N_CASES[i]
            let rec = probe.cases[i]
            assert.strict.equal(rec.label, c.label)
            assert.strict.equal(rec.err, null, `case ${c.label} 於嚴格版不應拋錯: ${rec.err}`)
            assert.strict.equal(rec.out, expectedOf(c.keep), `case ${c.label}`)
        }
    })

    // S1: 無效n不呼叫strTruncate; 有效n只呼叫一次且交給它的是數字(Number(n))
    it('無效n不呼叫strTruncate；有效n恰呼叫一次、maxLen為number型別且等於Number(n)（\'80\'→80）', function() {
        for (let i = 0; i < N_CASES.length; i++) {
            let c = N_CASES[i]
            let rec = probe.cases[i]
            if (c.keep === null) {
                assert.strict.deepEqual(rec.calls, [], `case ${c.label} 不應呼叫strTruncate`)
            }
            else {
                assert.strict.equal(rec.calls.length, 1, `case ${c.label} 應呼叫一次`)
                assert.strict.equal(rec.calls[0].maxLenType, 'number', `case ${c.label} 應交數字`)
                assert.strict.equal(rec.calls[0].maxLen, c.keep, `case ${c.label}`)
            }
        }
    })

    // S3: 實際對外路徑(呼叫處n為字面80／60)在嚴格版下不拋錯
    it('實際對外路徑（logAiOutcome遞補歷程原因n=80、createAiEventLogger冷卻錯誤n=60）於嚴格版下不拋錯，輸出同現行', function() {
        assert.strict.equal(probe.pathErr, null)
        assert.strict.equal(probe.stubThrows, 0)
        assert.strict.deepEqual(probe.lines, [
            ['WARN', `AI 遞補歷程 → c／key#1（換金鑰：exec／${'x'.repeat(80)}...）`],
            ['WARN', `AI 供應商進入冷卻 → p（${'x'.repeat(60)}...，2 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）`],
        ])
        let mx = probe.stubCalls.map((x) => x.maxLen)
        assert.strict.equal(mx.includes(80), true) //替身確實被用於n=80
        assert.strict.equal(mx.includes(60), true) //替身確實被用於n=60
        assert.strict.equal(probe.stubCalls.every((x) => x.maxLenType === 'number'), true)
    })

})
