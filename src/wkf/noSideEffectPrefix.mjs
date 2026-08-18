// noSideEffectPrefix.mjs — 防副作用prompt前綴(單一來源)
//
// 【為何獨立成檔】此措辭原內嵌於callAiWithFallback, 但不經該層、直接呼叫
//   dispatchAiFallback的呼叫端也需要同一約束——實例(2026-08-18使用端調研):
//   某使用端自帶一份「舊措辭」(一律禁止執行任何指令), 而該措辭的codex禁讀bug
//   本套件早已修正, 形成「套件修了、消費端沒跟上」的分岔。抽成獨立模組後
//   所有路徑引用同一來源, 措辭再修正時全體同步。
//
// 【為何需要此前綴】agentic CLI自帶檔案讀寫工具且對cwd隔離免疫(會自行解析
//   專案根目錄以絕對路徑寫檔), 實測會「順手」把結果另存孤兒檔,
//   甚至可能覆蓋呼叫端資料本體(殷鑑: 2026-08-10執行任務歷史.md遭AI覆寫、
//   評比腳本繞過前綴又產生根目錄孤兒檔); 各家CLI的權限機制彼此不同(codex有sandbox、
//   claude有--disallowedTools、opencode有config.permission),
//   唯有prompt指示跨provider一致生效。CLI層限制可作第二道防線並存
//   (內建providers.mjs各CLI條目即自帶機械防寫, 對照表見README)。
//
// 【措辭須豁免「唯讀查閱」(2026-08-13 A/B實測)】各CLI取得檔案內容的途徑不同——
//   opencode與claude有獨立的read/grep工具, 不受「禁止執行指令」約束;
//   但codex讀檔即是執行shell指令, 舊措辭「禁止執行任何指令」對它等同「禁止讀檔」,
//   凡需讀專案的任務會得到一句「請貼上檔案內容」而非成果, 且該拒答是合法字串,
//   會通過驗證被遞補層當成「成功」, 整條fallback鏈就此停住——兜底地位被靜默廢掉。
//   實測: 舊措辭下codex回「無法讀取該檔案」, 現行措辭正常讀檔作答(11.1s),
//   防副作用(建檔/改檔/刪檔/改動系統狀態)之本旨不變。


/**
 * 防副作用prompt前綴：禁止寫入類副作用、豁免唯讀查閱
 *
 * 用法：`NO_SIDE_EFFECT + prompt`後交dispatchAiFallback；
 * callAiWithFallback預設自動掛上(傳promptPrefix:''關閉)，
 * 直接呼叫dispatchAiFallback的呼叫端自行前綴
 *
 * @example
 *
 * import NO_SIDE_EFFECT from './src/wkf/noSideEffectPrefix.mjs'
 *
 * //let r = await dispatchAiFallback(NO_SIDE_EFFECT + prompt, { providers })
 *
 */
let NO_SIDE_EFFECT = [
    '【執行約束】你只需把結果輸出在回覆內容中。',
    '禁止建立、修改或刪除任何檔案，也不要執行任何會改動磁碟或系統狀態的指令——',
    '呼叫端只讀取你的回覆文字，任何寫入磁碟的動作都不會被採用，只會製造無人讀取的垃圾檔。',
    '唯讀查閱（讀取檔案、搜尋內容、列出目錄）不在此限，需要時請照常使用。',
    '', '',
].join('\n')


export default NO_SIDE_EFFECT
