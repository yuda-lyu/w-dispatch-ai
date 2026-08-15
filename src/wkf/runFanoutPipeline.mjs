import omit from 'lodash-es/omit.js'
import runFanout from './runFanout.mjs'
import runRolePipeline from './runRolePipeline.mjs'


//兩段各自剔除「對方專屬鍵」後原樣轉傳(providers與callOpt等共用鍵兩段皆收):
//曾因白名單式逐鍵轉送漏掉minAttemptMs令下層設定靜默失效(2026-08-14使用端實測回報),
//故一律採omit式, 任一段日後新增頂層選項時本檔無須跟改
let B_ONLY_KEYS = ['stages', 'input'] //後段專屬(input由前段成果給定, 不收外部傳入)
let A_ONLY_KEYS = ['task', 'agents', 'integrate', 'check', 'schema', 'minCandidates'] //前段專屬


// runFanoutPipeline.mjs — FanoutPipeline工作流(Fanout+RolePipeline): 多開收斂成果接串行角色鏈
//
// 【結構】先跑runFanout(多開 → 整合), 其成果作為runRolePipeline的input
//   (各階段以ctx.input取用), 最末階段回傳即工作流成果。
//
// 【實測依據(2026-08-10評比)】Fanout+RolePipeline是品質天花板: 前段的多樣性擇優給出最豐底稿、
//   審計鏈再修幻覺與證據標注; 六模型的歷史最高品質全部出現在此組合(或與純RolePipeline並列)。
//
// 【部分接受】前段失敗即回(附前段完整明細, 含已成功候選);
//   後段失敗回傳前段成果與後段已完成階段——呼叫端可只重跑失敗段。


/**
 * 執行FanoutPipeline工作流(Fanout+RolePipeline)：多開＋整合＋串行角色鏈
 *
 * 特點：
 * 前段同runFanout(agents各名額可自帶fallback、integrate單點整合)；
 * 後段同runRolePipeline(stages各階段可自帶AI／fallback／提示詞)，其input即前段成果；
 * 本函數不會reject
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} opt.providers 輸入provider定義表物件(名稱 → 條目)
 * @param {String} opt.task 輸入前段各名額共用之任務提示詞字串
 * @param {Array} opt.agents 輸入前段名額規格陣列(同runFanout)
 * @param {Object} opt.integrate 輸入前段整合名額規格物件(同runFanout)
 * @param {Array} opt.stages 輸入後段階段規格陣列(同runRolePipeline)，各階段以ctx.input取得前段成果
 * @param {Function} [opt.check=null] 輸入前段共用檢核函數(前段名額規格與integrate可各自帶check覆寫，同runFanout)，後段各階段自帶check，預設null
 * @param {String} [opt.schema=''] 輸入輸出格式示意字串(供前段預設整合模板)，預設''
 * @param {Number} [opt.minCandidates=2] 輸入前段整合門檻正整數，預設2
 * @param {Object} [opt.callOpt={}] 輸入透傳兩段之共用呼叫設定，預設{}
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(布林值)、result(工作流成果)、A(前段runFanout完整結果)、B(後段runRolePipeline完整結果)、totalMs(總耗時毫秒)、error(錯誤訊息字串)，本函數不會reject
 * @example
 * //need cli in system PATH
 *
 * import runFanoutPipeline from './src/wkf/runFanoutPipeline.mjs'
 *
 * let providers = {
 *     'claude:sonnet': { kind: 'claude', model: 'sonnet' },
 *     'codex:gpt-5.6-luna': { kind: 'codex', model: 'gpt-5.6-luna' },
 * }
 *
 * let test = async () => {
 *
 *     let r = await runFanoutPipeline({
 *         providers,
 *         task: '分析並只回覆JSON: {"essence":"..."}',
 *         agents: [{ use: 'claude:sonnet' }, { use: 'codex:gpt-5.6-luna' }],
 *         integrate: { use: 'claude:sonnet' },
 *         stages: [
 *             { id: 'audit', use: 'codex:gpt-5.6-luna', prompt: (ctx) => `審計此稿並修訂, 只回覆同格式JSON: ${JSON.stringify(ctx.input)}` },
 *         ],
 *         check: (j) => !!j.essence,
 *     })
 *     console.log(r.ok, r.A.integrated, r.B.order)
 *     // => true true [ 'audit' ]
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function runFanoutPipeline(opt = {}) {
    let t0 = Date.now()

    //前段: Fanout(多開 → 整合), 剔除後段專屬鍵後原樣轉傳
    let rA = await runFanout(omit(opt, B_ONLY_KEYS))
    if (!rA.ok) {
        return { ok: false, result: null, A: rA, B: null, totalMs: Date.now() - t0, error: `A failed: ${rA.error}` }
    }

    //後段: RolePipeline, 剔除前段專屬鍵後原樣轉傳, input即前段成果
    let rB = await runRolePipeline({
        ...omit(opt, A_ONLY_KEYS),
        input: rA.result,
    })

    return {
        ok: rB.ok,
        result: rB.ok ? rB.result : null,
        A: rA, //前段成果與明細一律回傳——後段失敗時可據此只重跑後段
        B: rB,
        totalMs: Date.now() - t0,
        error: rB.ok ? '' : `B failed: ${rB.error}`,
    }
}


export default runFanoutPipeline
