import keys from 'lodash-es/keys.js'
import includes from 'lodash-es/includes.js'
import isestr from 'wsemi/src/isestr.mjs'
import adapters from './adapters.mjs'
import getErrorResult from './getErrorResult.mjs'


/**
 * 依供應商種類(kind)分派至對應之CLI轉接器
 *
 * 三種供應商的差異(2026-08-08於本機實測確認)：
 * opencode支援逐次注入金鑰(OPENCODE_AUTH_CONTENT)，故可多把金鑰輪替；
 * claude與codex則沿用CLI既有登入狀態，無逐次金鑰概念。
 * 故「輪替」的單位是「供應商條目」而非單純的金鑰：一個條目即一組(kind, model, 可選的key／provider)，
 * 輪到誰就用誰的CLI與模型
 *
 * @param {String} kind 輸入供應商種類字串，可選'opencode'、'claude'、'codex'
 * @param {String} prompt 輸入提示詞字串，一律以stdin傳入子進程
 * @param {Object} [opt={}] 輸入設定物件，原樣轉傳對應轉接器，各轉接器可用設定詳見dispatchOpencode、dispatchClaude、dispatchCodex，預設{}
 * @returns {Promise} 回傳Promise，resolve回傳結果物件，內含ok(是否成功布林值)、stdout(標準輸出字串)、stderr(標準錯誤字串)、code(離開碼)、error(錯誤訊息字串，成功時為空字串)、durationMs(耗時毫秒)、attempts(實際嘗試次數)，本函數不會reject
 * @example
 * //need claude, codex or opencode cli in system PATH
 *
 * import dispatchAi from './src/dispatchAi.mjs'
 *
 * let test = async () => {
 *
 *     let r = await dispatchAi('claude', '請只回覆兩個字：完成', { model: 'sonnet' })
 *     console.log(r.ok, r.stdout.trim())
 *     // => true '完成'
 *
 *     let re = await dispatchAi('gemini', 'abc')
 *     console.log(re.ok, re.error)
 *     // => false 'unknown ai kind: "gemini" (available: opencode, claude, codex)'
 *
 * }
 * await test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function dispatchAi(kind, prompt, opt = {}) {

    //ks
    let ks = keys(adapters)

    //check kind, 須為對照表既有鍵名, 不可用物件取值判斷, 否則'constructor'等原型鍵會誤判為有效
    if (!isestr(kind) || !includes(ks, kind)) {
        return getErrorResult(`unknown ai kind: "${kind}" (available: ${ks.join(', ')})`)
    }

    //fn
    let fn = adapters[kind]

    //dispatch, prompt與opt之檢核由各轉接器自行負責
    return fn(prompt, opt)
}


export default dispatchAi
