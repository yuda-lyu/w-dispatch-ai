import iseint from 'wsemi/src/iseint.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import strleft from 'wsemi/src/strleft.mjs'


// strictStrTruncateForTest.mjs — 嚴格版strTruncate替身(wsemi第3輪契約之前瞻驗證用)
//
// 契約(主控r3da提示詞〈背景〉): strTruncate(str, maxLen, opt)之maxLen為必須參數, 以iseint之count判定, 未給或非預期即拋錯
//   (現行wsemi 1.9.44為「原樣回傳不截斷」)。本替身依此契約實作: 有效maxLen之輸出與現行strTruncate逐字相同, 無效maxLen一律拋錯。
// 檢查順序: 先查maxLen再查str(str為空字串或非字串時, 現行會先回''; 此處仍拋錯, 以更嚴格之方式證明下游不傳無效值)。
// 觀察點: 每次呼叫記入globalThis.__strictStrTruncate(calls: 有效呼叫之maxLen型別與值; throws: 拋錯次數),
//   使測試能證明「替身確實被使用」(非空轉)與「交給strTruncate的是數字」。


//state, 掛在globalThis, 子行程探針與測試皆可讀取
function getState() {
    if (!globalThis.__strictStrTruncate) {
        globalThis.__strictStrTruncate = { calls: [], throws: 0 }
    }
    return globalThis.__strictStrTruncate
}


/**
 * 嚴格版strTruncate: maxLen須為iseint(count)有效值，否則throw
 *
 * @param {*} str 輸入待裁切字串(非有效字串回空字串)
 * @param {*} maxLen 輸入保留字數(必須，iseint之count)
 * @param {Object} [opt={}] 輸入設定物件，opt.funWithMsg(str, maxLen)生成附註
 * @returns {String} 回傳裁切後字串
 */
function strTruncate(str, maxLen, opt = {}) {
    let st = getState()

    //maxLen必須且有效, 否則拋錯(不呼叫maxLen之任何方法, 只用typeof描述)
    if (!iseint(maxLen, { use: 'count' })) {
        st.throws++
        throw new Error(`strTruncate(strict): maxLen is required and must be a valid count, got ${typeof maxLen}`)
    }
    st.calls.push({ maxLenType: typeof maxLen, maxLen: typeof maxLen === 'number' ? maxLen : null })

    if (!isestr(str)) {
        return ''
    }
    let n = Number(maxLen)
    if (str.length <= n) {
        return str
    }
    let se = ''
    if (opt && typeof opt.funWithMsg === 'function') {
        let t = opt.funWithMsg(str, n)
        if (isestr(t)) {
            se = t
        }
    }
    return strleft(str, n) + `...${se}`
}


export default strTruncate
export { getState }
