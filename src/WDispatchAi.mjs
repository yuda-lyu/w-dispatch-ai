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
import dispatchApiOpenaiResponses from './dispatchApiOpenaiResponses.mjs'
import dispatchApiAnthropic from './dispatchApiAnthropic.mjs'
import dispatchApiTypesafeSystemone from './dispatchApiTypesafeSystemone.mjs'
import providers from './providers.mjs'
import resolveProviders from './resolveProviders.mjs'
import resolveCatalogue from './resolveCatalogue.mjs'
import readEnvFile from './readEnvFile.mjs'
import budgetFor from './budgetFor.mjs'
import createAiCaller from './createAiCaller.mjs'
import createFileStore from './wkf/createFileStore.mjs'
import createUsageCounter from './wkf/createUsageCounter.mjs'
import logAiOutcome, { createAiEventLogger, OUTCOME_TEXT } from './wkf/logAiOutcome.mjs'
import salvageTruncatedArray from './wkf/salvageTruncatedArray.mjs'
import parseJsonArray from './wkf/parseJsonArray.mjs'
import parseIndexList from './wkf/parseIndexList.mjs'
import makeArrayCoverageValidator from './wkf/makeArrayCoverageValidator.mjs'
import NO_SIDE_EFFECT from './wkf/noSideEffectPrefix.mjs'
import getQuotaClaude from './quota/getQuotaClaude.mjs'
import getQuotaCodex from './quota/getQuotaCodex.mjs'
import getQuotaAntigravity from './quota/getQuotaAntigravity.mjs'
import probeAnthropicKeys from './probeAnthropicKeys.mjs'
import filterOpencodeFree from './filterOpencodeFree.mjs'
import opencodeGoUsage from './opencodeGoUsage.mjs'


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
 * @returns {Object} 回傳物件，其內含KINDS(可用供應商種類字串陣列)，dispatchAiWkf之工作流工廠函數，dispatchAi、dispatchAiFallback、dispatchOpencode、dispatchClaude、dispatchCodex、dispatchAntigravity、dispatchApiOpenaiCompat、dispatchApiOpenaiResponses、dispatchApiAnthropic(Anthropic Messages API，以Console API金鑰計費)、dispatchApiTypesafeSystemone(TypeSafe jev之型別化決策API，非文字生成)之async函數，probeAnthropicKeys(對每把Anthropic金鑰送極小請求，回報此刻能否呼叫與每分鐘限額標頭，無查餘額端點)，filterOpencodeFree(以`opencode models`之輸出過濾目錄之opencode免費條目，回報目前確實供應與已下架者，下游組遞補鏈或評比名單前對一次)，opencodeGoUsage(以Go訂閱之工作區金鑰查5小時／週／月三視窗之用量百分比與重置時刻，端點為實測所得非官方文件所載，回原值不換算金額)，providers(預設providers定義檔)與resolveProviders(envVar展開器)、resolveCatalogue(目錄展開：合併安裝方自帶條目、逾時三層取值、env／envFile、pick、exes後交resolveProviders)，以及readEnvFile(讀.env不污染process.env)、budgetFor(遞補鏈時間預算推導)、createAiCaller(原始遞補呼叫器：回dispatchAiFallback原始結果、不解析不加前綴，與工作流並存)、createFileStore(store檔案持久化)、createUsageCounter(逐日用量計帳)、logAiOutcome／createAiEventLogger／OUTCOME_TEXT(把呼叫結果與冷卻事件渲染成日誌)、salvageTruncatedArray(截斷陣列搶救)、parseJsonArray／parseIndexList／makeArrayCoverageValidator(嚴格解析與涵蓋率驗證，與寬鬆／搶救版並存)、NO_SIDE_EFFECT(防副作用prompt前綴)等工具，以及getQuotaClaude、getQuotaCodex、getQuotaAntigravity(查詢各訂閱制CLI本機登入帳號之額度窗口，統一結構，可比對指定email)
 * @example
 *
 * 詳見dispatchAi、dispatchAiFallback、dispatchAiWkf、dispatchOpencode、dispatchClaude、dispatchCodex、dispatchAntigravity、dispatchApiOpenaiCompat、dispatchApiOpenaiResponses、dispatchApiAnthropic、dispatchApiTypesafeSystemone、resolveProviders、resolveCatalogue、createAiCaller、logAiOutcome、parseJsonArray、parseIndexList、makeArrayCoverageValidator、filterOpencodeFree、opencodeGoUsage、getQuotaClaude、getQuotaCodex、getQuotaAntigravity範例
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
    dispatchApiOpenaiResponses,
    dispatchApiAnthropic,
    dispatchApiTypesafeSystemone,
    probeAnthropicKeys,
    filterOpencodeFree,
    opencodeGoUsage,
    providers,
    resolveProviders,
    resolveCatalogue,
    readEnvFile,
    budgetFor,
    createAiCaller,
    createFileStore,
    createUsageCounter,
    logAiOutcome,
    createAiEventLogger,
    OUTCOME_TEXT,
    salvageTruncatedArray,
    parseJsonArray,
    parseIndexList,
    makeArrayCoverageValidator,
    getQuotaClaude,
    getQuotaCodex,
    getQuotaAntigravity,
}


export default WDispatchAi
