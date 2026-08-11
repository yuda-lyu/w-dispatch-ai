import get from 'lodash-es/get.js'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import callAiWithFallback from './callAiWithFallback.mjs'


// runFanout.mjs — Fanout工作流: 多開執行＋單點整合收斂
//
// 【結構】前段(fanout)並行開N個AI名額執行同一任務, 各名額可指定主模型與自帶fallback;
//   後段開單一AI名額把成功候選整合成最終版; 整合成果即工作流成果。
//
// 【部分接受】個別名額失敗不炸整輪: 成功候選達minCandidates才進整合;
//   未達門檻(含恰為1份)時不硬整合, 直接以首位成功候選為成果(integrated:false)——
//   單稿無從「整合」, 硬呼叫整合者只是空耗一次額度。
//   全部失敗才回ok:false, 且已成功候選仍完整回傳(便於接續重試)。
//
// 【實測依據(2026-08-10評比)】整合者是本流程的單點故障——端點不穩的模型
//   (如偶發靜默空回者)當整合者時, 靠spec.fallback遞補或maxRetries調高才能保住整條鏈。


/**
 * 預設整合提示詞模板：把成功候選JSON併入整合任務
 *
 * @param {Array} candidates 輸入成功候選物件陣列
 * @param {Object} [opt={}] 輸入設定物件(取schema作為輸出格式示意)，預設{}
 * @returns {String} 回傳整合提示詞字串
 */
function defaultIntegratePrompt(candidates, opt = {}) {
    let schema = get(opt, 'schema', '')
    let schemaLine = isestr(schema) ? `\n只回覆 JSON 物件，不要任何其他說明文字，格式與候選相同：\n${schema}\n` : '\n只回覆 JSON 物件，不要任何其他說明文字，格式與候選相同。\n'
    return `你是整合者。以下是同一任務由 ${candidates.length} 個獨立執行產生的候選結果（JSON），請整合成單一最佳版本：擇優合併、去重、保留最完整的證據標注與爭議呈現，不可加入候選中沒有的數字或結論。
${schemaLine}
${candidates.map((c, i) => `【候選 ${i + 1}】\n${JSON.stringify(c)}`).join('\n\n')}`
}


/**
 * 執行Fanout工作流：多開執行與單點整合
 *
 * 特點：
 * 前段各名額並行執行同一任務，各名額可指定主模型(use)與自帶遞補鏈(fallback)；
 * 後段為單一整合名額，同樣可帶遞補鏈；
 * 個別名額失敗不中斷整輪，成功候選未達minCandidates時以首位候選為成果(integrated:false)不硬整合；
 * 成功候選完整保留於回傳(部分接受、便於接續重試整合)；
 * 本函數不會reject
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} opt.providers 輸入provider定義表物件(名稱 → 條目)，透傳callAiWithFallback
 * @param {String} opt.task 輸入前段各名額共用之任務提示詞字串
 * @param {Array} opt.agents 輸入前段名額規格陣列，各元素{ use, fallback, maxRetries?, timeoutMs? }等(除use/fallback外之鍵覆寫該名額呼叫設定)
 * @param {Object} opt.integrate 輸入整合名額規格物件{ use, fallback, prompt?, ... }，prompt可為(candidates)=>String自訂整合提示詞，省略用預設模板
 * @param {Function} [opt.check=null] 輸入候選與終稿共用之檢核函數(json)=>Boolean，預設null
 * @param {String} [opt.schema=''] 輸入輸出格式示意字串，供預設整合模板嵌入，預設''
 * @param {Number} [opt.minCandidates=2] 輸入進入整合所需之最少成功候選數正整數，未達門檻以首位候選為成果，預設2
 * @param {Object} [opt.callOpt={}] 輸入透傳callAiWithFallback之共用設定(cwd、store、onEvent、timeoutMs、promptPrefix等)，預設{}
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(布林值)、result(工作流成果)、integrated(是否經過整合布林值)、agents(各名額完整結果陣列)、candidates(成功候選陣列)、integrateDetail(整合呼叫完整結果)、totalMs(總耗時毫秒)、error(錯誤訊息字串)，本函數不會reject
 * @example
 * //need cli in system PATH
 *
 * import runFanout from './src/wkf/runFanout.mjs'
 *
 * let providers = {
 *     'deepseek': { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', keys: ['sk-xxx'] },
 *     'sonnet': { kind: 'claude', model: 'sonnet' },
 * }
 *
 * let test = async () => {
 *
 *     let r = await runFanout({
 *         providers,
 *         task: '分析並只回覆JSON: {"essence":"..."}',
 *         agents: [
 *             { use: 'deepseek', fallback: ['sonnet'] },
 *             { use: 'sonnet' },
 *         ],
 *         integrate: { use: 'sonnet' },
 *         check: (j) => !!j.essence,
 *     })
 *     console.log(r.ok, r.integrated, r.candidates.length)
 *     // => true true 2
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function runFanout(opt = {}) {
    let t0 = Date.now()
    let providers = get(opt, 'providers', null)
    let task = get(opt, 'task', '')
    let agents = get(opt, 'agents', null)
    let integrate = get(opt, 'integrate', null)
    let check = get(opt, 'check', null)
    let callOpt = get(opt, 'callOpt', {})

    if (!isestr(task)) {
        return { ok: false, result: null, integrated: false, agents: [], candidates: [], totalMs: 0, error: 'task must be a non-empty string' }
    }
    if (!isearr(agents)) {
        return { ok: false, result: null, integrated: false, agents: [], candidates: [], totalMs: 0, error: 'agents must be a non-empty array' }
    }

    let minCandidates = get(opt, 'minCandidates', null)
    if (!ispint(minCandidates)) {
        minCandidates = 2
    }
    else {
        minCandidates = cint(minCandidates)
    }

    //前段: 並行多開, 個別失敗不炸整輪
    let rsAgents = await Promise.all(agents.map((spec) => {
        let { use, fallback, ...overrides } = spec
        return callAiWithFallback(task, { ...callOpt, ...overrides, providers, spec: { use, fallback }, check })
    }))
    let candidates = rsAgents.filter((r) => r.ok).map((r) => r.json)

    //全部失敗
    if (candidates.length === 0) {
        return { ok: false, result: null, integrated: false, agents: rsAgents, candidates, totalMs: Date.now() - t0, error: 'all agents failed' }
    }

    //未達整合門檻(含恰為1份): 不硬整合, 以首位成功候選為成果
    if (candidates.length === 1 || candidates.length < minCandidates) {
        return { ok: true, result: candidates[0], integrated: false, agents: rsAgents, candidates, totalMs: Date.now() - t0, error: '' }
    }

    //後段: 整合
    if (!integrate || !isestr(get(integrate, 'use', ''))) {
        return { ok: false, result: null, integrated: false, agents: rsAgents, candidates, totalMs: Date.now() - t0, error: 'integrate spec (with use) is required' }
    }
    let { use, fallback, prompt: intPromptFn, ...intOverrides } = integrate
    let intPrompt = isfun(intPromptFn) ? intPromptFn(candidates) : defaultIntegratePrompt(candidates, opt)
    let rInt = await callAiWithFallback(intPrompt, { ...callOpt, ...intOverrides, providers, spec: { use, fallback }, check })

    return {
        ok: rInt.ok,
        result: rInt.ok ? rInt.json : null,
        integrated: rInt.ok,
        agents: rsAgents,
        candidates, //即使整合失敗, 成功候選仍完整回傳, 供接續重試整合(只重跑整合段)
        integrateDetail: rInt,
        totalMs: Date.now() - t0,
        error: rInt.ok ? '' : `integrate failed: ${rInt.error}`,
    }
}


export default runFanout
export { defaultIntegratePrompt }
