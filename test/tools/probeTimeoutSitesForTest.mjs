import { register } from 'node:module'
import { CASES, PAIRS } from './timeoutCasesForTest.mjs'


// probeTimeoutSitesForTest.mjs — 子行程探針: 在「wsemi execCli被換成記錄替身」之下, 逐入口、逐timeoutMs輸入值呼叫,
// 記錄各入口實際交給execCli之timeoutMs(2026-11-13 da-hy, 排程第438項)
//
// 以module.register掛resolve hook後, 才動態import src(靜態import會早於hook)。
// 結果以單行JSON印到stdout: { [入口名]: [ { label, got: [交給execCli之timeoutMs...] } ] }, 由單元測試解析斷言; 本檔不斷言。
// 單元測試以spawnSync啟動: node <本檔>(無需參數)。替身不spawn任何子進程, 不連網(各入口之額度閘、spawn守門皆明關)。


register('./recordExecCliHooksForTest.mjs', import.meta.url)

let { default: runExecCli } = await import('../../src/runExecCli.mjs')
let { default: dispatchClaude } = await import('../../src/dispatchClaude.mjs')
let { default: dispatchCodex } = await import('../../src/dispatchCodex.mjs')
let { default: dispatchOpencode } = await import('../../src/dispatchOpencode.mjs')
let { default: dispatchAntigravity } = await import('../../src/dispatchAntigravity.mjs')
let { default: dispatchAiFallback } = await import('../../src/dispatchAiFallback.mjs')
let { default: createAiCaller } = await import('../../src/createAiCaller.mjs')
let { default: checkAgyStdinSupport } = await import('../../src/checkAgyStdinSupport.mjs')
let { default: getQuotaAntigravity } = await import('../../src/quota/getQuotaAntigravity.mjs')


let state = globalThis.__recordExecCli
let nth = 0

//各入口之呼叫(opt只帶timeoutMs為cases之值; v為undefined時不帶該鍵)
let withTm = (o, v) => (v === undefined ? o : { ...o, timeoutMs: v })
let SITES = {
    'runExecCli': (v) => runExecCli('x', [], withTm({}, v)),
    'dispatchClaude': (v) => dispatchClaude('p', withTm({ exe: 'x', spawnGate: false }, v)),
    'dispatchCodex': (v) => dispatchCodex('p', withTm({ exe: 'x', spawnGate: false }, v)),
    'dispatchOpencode': (v) => dispatchOpencode('p', withTm({ exe: 'x', spawnGate: false }, v)),
    'dispatchAntigravity': (v) => dispatchAntigravity('p', withTm({ exe: 'x', spawnGate: false, promptVia: 'argv' }, v)),
    //遞補層: 條目自帶timeoutMs(entryTimeout之判定)、共用opt之timeoutMs
    'dispatchAiFallback(條目)': (v) => dispatchAiFallback('p', { providers: [withTm({ id: 'c', kind: 'claude', exe: 'x', spawnGate: false }, v)], quotaGate: false }),
    'dispatchAiFallback(共用)': (v) => dispatchAiFallback('p', withTm({ providers: [{ id: 'c', kind: 'claude', exe: 'x', spawnGate: false }], quotaGate: false }, v)),
    //目錄展開＋原始呼叫器: 建構期timeoutMs(經resolveCatalogue之timeoutPatch)與逐次callAI之timeoutMs
    'createAiCaller(建構)': async (v) => {
        let c = createAiCaller(withTm({ catalogue: [{ id: 'c', kind: 'claude', exe: 'x', spawnGate: false }], env: {}, quotaGate: false }, v))
        await c.callAI('p')
    },
    'createAiCaller(逐次)': async (v) => {
        let c = createAiCaller({ catalogue: [{ id: 'c', kind: 'claude', exe: 'x', spawnGate: false }], env: {}, quotaGate: false })
        await c.callAI('p', withTm({}, v))
    },
    //agy版本探測(上限15000)與額度查詢(版本把關上限15000、/usage用原值)
    'checkAgyStdinSupport': (v) => checkAgyStdinSupport(`x-${nth++}`, withTm({}, v)),
    'getQuotaAntigravity': (v) => getQuotaAntigravity('', withTm({ exe: 'x' }, v)),
}


let out = {}
for (let [name, fn] of Object.entries(SITES)) {
    out[name] = []
    for (let c of CASES) {
        state.calls.length = 0
        let err = null
        try {
            await fn(c.v)
        }
        catch (e) {
            err = String(e && e.message)
        }
        //pt: 各次呼叫帶之--print-timeout值(無該旗標為null), 供斷言agy之後備逾時由生效之timeoutMs推導
        let pt = state.calls.map((x) => (Array.isArray(x.args) && x.args.includes('--print-timeout') ? x.args[x.args.indexOf('--print-timeout') + 1] : null))
        out[name].push({ label: c.label, got: state.calls.map((x) => (x.has ? x.timeoutMs : 'absent')), pt, err })
    }
}

//遞補層之逐層判定(條目 → 共用 → 預設): 條目與共用各給一個值, 記錄實際交給execCli之timeoutMs(PAIRS見timeoutCasesForTest, 預期值於測試端依規格計算)
out['dispatchAiFallback(條目×共用)'] = []
for (let [e, s] of PAIRS) {
    state.calls.length = 0
    let ent = { id: 'c', kind: 'claude', exe: 'x', spawnGate: false }
    if (e !== undefined) {
        ent.timeoutMs = e
    }
    await dispatchAiFallback('p', withTm({ providers: [ent], quotaGate: false }, s))
    out['dispatchAiFallback(條目×共用)'].push({ label: `${String(e)}|${String(s)}`, got: state.calls.map((x) => (x.has ? x.timeoutMs : 'absent')), pt: [], err: null })
}

//守門運作且呼叫端自給小數deadlineAt: 該次spawn之timeoutMs(以剩餘預算封頂)須為整數(小數交execCli會被其判為無效而改用120000)
state.calls.length = 0
await runExecCli('x', [], {
    timeoutMs: 300000,
    spawnGateKind: 'claude',
    spawnGate: { maxCli: 1000, ramUsedMax: false, cpuMax: false, minGapMs: false, deadlineAt: Date.now() + 100000.5, countCli: () => 0 },
})
out['runExecCli(守門deadlineAt小數)'] = [{ label: 'deadlineAt=now+100000.5', got: state.calls.map((x) => (x.has ? x.timeoutMs : 'absent')), pt: [], err: null }]

//非有限數(Infinity、NaN)以字串表示, 免JSON.stringify把它們變成null而與「未給」混淆
console.log(JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)))
