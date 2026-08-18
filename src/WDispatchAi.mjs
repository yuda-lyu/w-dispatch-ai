import keys from 'lodash-es/keys.js'
import adapters from './adapters.mjs'
import dispatchAi from './dispatchAi.mjs'
import dispatchAiFallback from './dispatchAiFallback.mjs'
import dispatchAiWkf from './dispatchAiWkf.mjs'
import dispatchOpencode from './dispatchOpencode.mjs'
import dispatchClaude from './dispatchClaude.mjs'
import dispatchCodex from './dispatchCodex.mjs'
import dispatchAntigravity from './dispatchAntigravity.mjs'
import dispatchApiOpenaiCompat from './dispatchApiOpenaiCompat.mjs'
import providers from './providers.mjs'
import resolveProviders from './resolveProviders.mjs'
import readEnvFile from './readEnvFile.mjs'
import budgetFor from './budgetFor.mjs'
import createFileStore from './wkf/createFileStore.mjs'
import createUsageCounter from './wkf/createUsageCounter.mjs'
import salvageTruncatedArray from './wkf/salvageTruncatedArray.mjs'
import NO_SIDE_EFFECT from './wkf/noSideEffectPrefix.mjs'


// WDispatchAi.mjs — AI供應商分派層
//
// 本套件封裝「以CLI或REST API調用各家AI」的差異，對外提供單一介面
// (CLI或API之選型判準見adapters.mjs檔頭)。
// 依專案方針，不引用全域技能(dispatch-claude／dispatch-codex／dispatch-opencode)，
// 而是把其調用方式移植於各轉接器內，方便自行偵錯、修改與擴充。


//KINDS, 由adapters鍵名產生, 令供應商清單只有一處來源
let KINDS = keys(adapters)


/**
 * AI供應商分派
 *
 * @returns {Object} 回傳物件，其內含KINDS(可用供應商種類字串陣列)，dispatchAiWkf之工作流工廠函數，dispatchAi、dispatchAiFallback、dispatchOpencode、dispatchClaude、dispatchCodex、dispatchAntigravity、dispatchApiOpenaiCompat之async函數，providers(預設providers定義檔)與resolveProviders(envVar展開器)，以及readEnvFile(讀.env不污染process.env)、budgetFor(遞補鏈時間預算推導)、createFileStore(store檔案持久化)、createUsageCounter(逐日用量計帳)、salvageTruncatedArray(截斷陣列搶救)、NO_SIDE_EFFECT(防副作用prompt前綴)等工具
 * @example
 *
 * 詳見dispatchAi、dispatchAiFallback、dispatchAiWkf、dispatchOpencode、dispatchClaude、dispatchCodex、dispatchAntigravity、dispatchApiOpenaiCompat、resolveProviders範例
 *
 */
let WDispatchAi = {
    KINDS,
    NO_SIDE_EFFECT,
    dispatchAi,
    dispatchAiFallback,
    dispatchAiWkf,
    dispatchOpencode,
    dispatchClaude,
    dispatchCodex,
    dispatchAntigravity,
    dispatchApiOpenaiCompat,
    providers,
    resolveProviders,
    readEnvFile,
    budgetFor,
    createFileStore,
    createUsageCounter,
    salvageTruncatedArray,
}


export default WDispatchAi
