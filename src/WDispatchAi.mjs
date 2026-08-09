import keys from 'lodash-es/keys.js'
import adapters from './adapters.mjs'
import dispatchAi from './dispatchAi.mjs'
import dispatchOpencode from './dispatchOpencode.mjs'
import dispatchClaude from './dispatchClaude.mjs'
import dispatchCodex from './dispatchCodex.mjs'


// WDispatchAi.mjs — AI供應商分派層
//
// 本套件封裝「以CLI調用各家AI」的差異，對外提供單一介面。
// 依專案方針，不引用全域技能(dispatch-claude／dispatch-codex／dispatch-opencode)，
// 而是把其調用方式移植於各轉接器內，方便自行偵錯、修改與擴充。


//KINDS, 由adapters鍵名產生, 令供應商清單只有一處來源
let KINDS = keys(adapters)


/**
 * AI供應商分派
 *
 * @returns {Object} 回傳物件，其內含KINDS(可用供應商種類字串陣列)，以及dispatchAi、dispatchOpencode、dispatchClaude、dispatchCodex之async函數
 * @example
 *
 * 詳見dispatchAi、dispatchOpencode、dispatchClaude、dispatchCodex範例
 *
 */
let WDispatchAi = {
    KINDS,
    dispatchAi,
    dispatchOpencode,
    dispatchClaude,
    dispatchCodex,
}


export default WDispatchAi
