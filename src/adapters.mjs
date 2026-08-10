import dispatchOpencode from './dispatchOpencode.mjs'
import dispatchClaude from './dispatchClaude.mjs'
import dispatchCodex from './dispatchCodex.mjs'
import dispatchAntigravity from './dispatchAntigravity.mjs'


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
 * // => ['opencode', 'claude', 'codex', 'antigravity']
 *
 */
let adapters = {
    opencode: dispatchOpencode,
    claude: dispatchClaude,
    codex: dispatchCodex,
    antigravity: dispatchAntigravity,
}


export default adapters
