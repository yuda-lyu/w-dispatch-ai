import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import callAiWithFallback from './wkf/callAiWithFallback.mjs'
import runFanout from './wkf/runFanout.mjs'
import runRolePipeline from './wkf/runRolePipeline.mjs'
import runFanoutPipeline from './wkf/runFanoutPipeline.mjs'


// dispatchAiWkf.mjs — 工作流工廠: 注入provider定義表與共用預設, 回傳綁定版API
//
// 【用途】專案端只需注入一次providers(名稱 → dispatchAiFallback條目)與共用設定
//   (cwd、store、onEvent、timeoutMs…), 之後以名稱宣告工作流即可, 不必每次傳定義表。
//
// 【並行與游標之說明】多名額並行且共用同一store時, 游標read-modify-write
//   可能交錯, 造成金鑰輪替不完全均攤——只影響公平性、不影響正確性(每把金鑰仍有效),
//   故不加鎖; 要求嚴格均攤者可注入自帶佇列的store。
//
// 【本函數為同步工廠會throw】providers無效屬設定錯誤, 應於啟動期即失敗(fail fast),
//   與各dispatch函數「不reject」之約定不衝突——後者是執行期呼叫, 前者是組裝期設定。
//
// 【定義表之鍵名即條目id】該鍵名會成為dispatchAiFallback之條目id(游標鍵與日誌標籤),
//   須區分到「模型」而非只到「廠商」——鍵名取'claude'則日後無法同時掛sonnet與opus,
//   且日誌看不出實際用了哪個模型; 同一模型經不同路徑(REST／CLI／不同閘道)取得時,
//   額度池與故障域各自獨立而屬不同供應商, 鍵名須帶上路徑加以區分。
//   命名規則與取捨詳見dispatchAiFallback.mjs檔頭之「條目id之設計規則」。
//
// 【定義providers時如何選kind: CLI或API】判準是「該階段需不需要工具」:
//   需要讀本機檔案、grep、執行指令、抓網頁 → CLI類kind(opencode/claude/codex/antigravity);
//   純文字生成(素材皆已在prompt內) → API類kind(api-openai-compat), 免安裝免登入且較快。
//   工作流常態是混用: runFanout之候選生成與整合、runRolePipeline之審計修訂等
//   多屬純文字階段可走API; 唯獨需要實際翻閱專案檔案的階段必須走CLI。
//   API類不支援工具且不會自建工具迴圈, 理由詳見adapters.mjs檔頭之選型判準區塊。
//
// 【工具無法向上層轉送】工作流各名額(如runFanout之agents)只是同行程之async函數呼叫,
//   非獨立agent; 模型回傳之tool_calls受會話束縛而無法外傳給上層agent(如hermes)代跑,
//   故「讓外殼提供工具給工作流內的模型使用」在本架構下不成立——需要工具就選CLI類kind。


/**
 * 建立AI工作流執行環境(工廠)，注入provider定義表與共用預設後回傳綁定版API
 *
 * 特點：
 * providers為名稱對dispatchAiFallback條目之定義表，之後各工作流以名稱宣告主模型與遞補鏈；
 * defaults為共用呼叫設定，各工作流之callOpt與名額規格可逐項覆寫；
 * 回傳之各函數皆不reject；本工廠為同步函數，providers無效時throw(設定錯誤應於啟動期即失敗)
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} opt.providers 輸入provider定義表物件(名稱 → dispatchAiFallback條目：{ kind, model, keys, exe, provider, config, sandbox, extraArgs... })
 * @param {Object} [opt.defaults={}] 輸入共用呼叫設定物件(cwd、store、onEvent、timeoutMs、budgetMs、maxRetries、promptPrefix、parse等)，預設{}
 * @returns {Object} 回傳綁定版API物件，內含callAi(單一名額呼叫)、runFanout(多開＋整合)、runRolePipeline(串行角色鏈)、runFanoutPipeline(多開＋整合＋角色鏈)、providers(定義表原樣)
 * @example
 * //need cli in system PATH
 *
 * import dispatchAiWkf from './src/dispatchAiWkf.mjs'
 *
 * //定義表之鍵名即dispatchAiFallback之條目id, 須區分到模型而非只到廠商,
 * //同一模型經不同路徑取得時須帶上路徑(REST與CLI屬兩個供應商, 能力與速度皆不同)
 * let wkf = dispatchAiWkf({
 *     providers: {
 *         'zen:deepseek-v4-flash-free': { kind: 'api-openai-compat', baseURL: 'https://opencode.ai/zen/v1', model: 'deepseek-v4-flash-free', keys: ['sk-xxx'] },
 *         'oc:opencode/deepseek-v4-flash-free': { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', keys: ['sk-xxx'] },
 *         'claude:sonnet': { kind: 'claude', model: 'sonnet' },
 *         'claude:opus': { kind: 'claude', model: 'opus' },
 *         'codex:gpt-5.6-luna': { kind: 'codex', model: 'gpt-5.6-luna' },
 *     },
 *     defaults: { timeoutMs: 300000 },
 * })
 *
 * let test = async () => {
 *
 *     //單一名額: 主模型＋遞補鏈
 *     let r1 = await wkf.callAi('只回覆JSON: {"a":1}', { spec: { use: 'zen:deepseek-v4-flash-free', fallback: ['claude:sonnet'] }, check: (j) => j.a === 1 })
 *     console.log(r1.ok, r1.json)
 *     // => true { a: 1 }
 *
 *     //Fanout工作流: 多開執行＋單點整合
 *     //純文字階段用REST(快), 需要讀專案檔案之階段才用CLI(有工具)
 *     let r2 = await wkf.runFanout({
 *         task: '分析並只回覆JSON: {"essence":"..."}',
 *         agents: [
 *             { use: 'zen:deepseek-v4-flash-free', fallback: ['claude:sonnet'] },
 *             { use: 'claude:sonnet' },
 *         ],
 *         integrate: { use: 'codex:gpt-5.6-luna' },
 *         check: (j) => !!j.essence,
 *     })
 *     console.log(r2.ok, r2.integrated)
 *     // => true true
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
function dispatchAiWkf(opt = {}) {
    let providers = get(opt, 'providers', null)
    if (!isobj(providers)) {
        throw new Error('dispatchAiWkf: opt.providers must be an object (name → provider entry)')
    }
    let defaults = get(opt, 'defaults', null)
    if (!isobj(defaults)) {
        defaults = {}
    }

    return {
        providers,

        //單一名額呼叫: callAi(prompt, { spec:{use,fallback}, check, ... })
        callAi: (prompt, o = {}) => callAiWithFallback(prompt, { ...defaults, ...o, providers }),

        //Fanout工作流: runFanout({ task, agents, integrate, check, schema, minCandidates, callOpt? })
        runFanout: (o = {}) => runFanout({ ...o, providers, callOpt: { ...defaults, ...get(o, 'callOpt', {}) } }),

        //RolePipeline工作流: runRolePipeline({ input, stages, callOpt? })
        runRolePipeline: (o = {}) => runRolePipeline({ ...o, providers, callOpt: { ...defaults, ...get(o, 'callOpt', {}) } }),

        //FanoutPipeline工作流: runFanoutPipeline({ task, agents, integrate, stages, check, schema, callOpt? })
        runFanoutPipeline: (o = {}) => runFanoutPipeline({ ...o, providers, callOpt: { ...defaults, ...get(o, 'callOpt', {}) } }),
    }
}


export default dispatchAiWkf
