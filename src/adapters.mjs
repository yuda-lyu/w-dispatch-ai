import dispatchOpencode from './dispatchOpencode.mjs'
import dispatchClaude from './dispatchClaude.mjs'
import dispatchCodex from './dispatchCodex.mjs'
import dispatchAntigravity from './dispatchAntigravity.mjs'
import dispatchApiOpenaiCompat from './dispatchApiOpenaiCompat.mjs'


// adapters.mjs — kind對照表, 亦為「CLI或API」之選型判準所在
//
// ══ 選 kind 的唯一判準: 這次呼叫需不需要「工具」? ══
//
//   需要工具 → 用CLI類kind(opencode/claude/codex/antigravity)
//     所謂工具即: 讀取本機檔案、grep搜尋、執行shell指令、抓取網頁、寫檔。
//     CLI本身是agentic harness, 自帶完整工具迴圈, 呼叫端什麼都不必做。
//
//   純文字生成 → 用API類kind(api-openai-compat)
//     所謂純文字即: 摘要、分析、改寫、翻譯、產出JSON——所有素材都已在prompt內,
//     模型只需讀prompt再輸出文字, 全程不需要碰外部世界。
//     免安裝CLI、免預先登入, 且實測比CLI快(agnes: API 1~2.5s vs CLI 4~6s)。
//
// ══ 為何API類不自建工具迴圈(2026-08-11實測後之決策, 勿再自行推翻) ══
//
//   1. 閘道端零內建工具: 實測Zen與Agnes皆然, 連web_search都沒有——
//      對`tools:[{type:'web_search'}]`回400並要求function.parameters,
//      即端點只接受「呼叫端自行定義且自行執行」的function工具。
//   2. 協定雖支援function calling(Zen之nemotron與Agnes皆實測回tool_calls),
//      但工具的定義、執行、錯誤處理、安全邊界全部得由本套件實作與維護,
//      等同重造CLI已經提供的harness; 工作流日後仍會持續擴充,
//      自建工具集之維護成本只會擴大, 故一律不走此路。
//   3. tool_calls有會話束縛(tool_call_id須於同一條messages串回填),
//      無法跨行程外傳給上層agent(如hermes)代為執行——
//      工作流是被上層阻塞呼叫的函式, 沒有反向請求工具的通道。
//      詳見dispatchApiOpenaiCompat.mjs檔頭。
//
// ══ 混用才是常態 ══
//
//   同一條dispatchAiFallback鏈可逐條目混搭kind, 工作流各階段亦然:
//   產生候選、整合收斂等純文字階段用API(快且省), 需要讀專案檔案或grep的
//   階段換CLI。判準永遠是「這一步需不需要碰外部世界」, 而非整條鏈二選一。


/**
 * 各AI供應商種類(kind)對CLI轉接器函數之對照表
 *
 * 本對照表為kind之唯一來源，dispatchAi以其鍵值分派，WDispatchAi以其鍵名產生KINDS，
 * 新增供應商時僅須於此加入一個鍵值對即可
 *
 * @returns {Object} 回傳對照表物件，鍵名為供應商種類字串，鍵值為對應之dispatch函數
 * @example
 *
 * import adapters from './src/adapters.mjs'
 *
 * console.log(Object.keys(adapters))
 * // => ['opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat']
 *
 */
let adapters = {
    'opencode': dispatchOpencode,
    'claude': dispatchClaude,
    'codex': dispatchCodex,
    'antigravity': dispatchAntigravity,
    'api-openai-compat': dispatchApiOpenaiCompat,
}


export default adapters
