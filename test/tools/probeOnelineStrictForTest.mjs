import { register } from 'node:module'
import { N_CASES, RAW } from './onelineCasesForTest.mjs'


// probeOnelineStrictForTest.mjs — 子行程探針: 在「wsemi strTruncate被換成嚴格版替身」之下跑src之oneline／logAiOutcome／createAiEventLogger
//
// 以module.register掛resolve hook後, 才動態import src(靜態import會早於hook), 故src內之strTruncate為替身(無效maxLen即拋錯)。
// 結果以單行JSON印到stdout, 由單元測試解析斷言; 本檔不斷言。
// 單元測試以spawnSync啟動: node <本檔>(無需參數), src路徑由本檔位置衍生(test/tools/ → src/wkf/logAiOutcome.mjs)。


register('./strictStrTruncateHooksForTest.mjs', import.meta.url)

let mod = await import('../../src/wkf/logAiOutcome.mjs')


//state, 替身記錄之呼叫(globalThis, 替身載入後才有)
let getCalls = () => (globalThis.__strictStrTruncate ? globalThis.__strictStrTruncate.calls.length : 0)


//逐case呼叫oneline, 記錄輸出／拋錯／該case內替身被呼叫之次數與maxLen型別
let cases = []
for (let c of N_CASES) {
    let before = getCalls()
    let rec = { label: c.label, out: null, err: null, calls: [] }
    try {
        rec.out = mod.oneline(RAW, c.n)
    }
    catch (err) {
        rec.err = String(err && err.message)
    }
    rec.calls = globalThis.__strictStrTruncate ? globalThis.__strictStrTruncate.calls.slice(before) : []
    cases.push(rec)
}


//實際對外路徑(呼叫處n為字面80／60): logAiOutcome之遞補歷程原因(80)與createAiEventLogger之冷卻錯誤(60)
let long = 'x'.repeat(100)
let lines = []
let lg = { log: (m) => lines.push(['INFO', m]), logWarn: (m) => lines.push(['WARN', m]), logError: (m) => lines.push(['ERROR', m]) }
let pathErr = null
try {
    mod.default({ result: { ok: false, tried: [{ providerId: 'c', keyIndex: 0, outcome: 'next-key', errorType: 'exec', error: long }] }, log: lg })
    mod.createAiEventLogger({ log: lg })({ type: 'cooled', providerId: 'p', error: long, cooldownMs: 90000 })
}
catch (err) {
    pathErr = String(err && err.message)
}

console.log(JSON.stringify({
    cases,
    lines,
    pathErr,
    stubCalls: globalThis.__strictStrTruncate ? globalThis.__strictStrTruncate.calls : [],
    stubThrows: globalThis.__strictStrTruncate ? globalThis.__strictStrTruncate.throws : 0,
}))
