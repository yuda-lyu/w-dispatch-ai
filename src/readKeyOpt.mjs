import isestr from 'wsemi/src/isestr.mjs'
import { probeReadable, errMsg } from './callUserFn.mjs'


// readKeyOpt.mjs — 金鑰型opt(key、keys)之判定單一來源(內部模組; 帳本R-KEYOPT-1)
//
// 【為何】金鑰屬影響計費之opt(dspec〈輸入參數之檢測機制〉§11: 影響下單數量或金額之opt視同安全相關opt): 「給了而無效」即拒絕, 不靜默改走另一種計費——
//   修前: key／keys給了非字串(數字、物件、包裝物件、已撤銷之Proxy等)而濾後無有效字串時, 視同未給——claude CLI條目起一個不帶ANTHROPIC_API_KEY之子進程(改走登入態／訂閱或繼承之環境值),
//   REST條目送出不帶認證標頭之請求; 原本指定「以該API金鑰計費」之意圖被悄悄改成他種計費。
//
// 【視為未給(維持登入態／預設認證)】key: undefined、null、''; keys: undefined、null、[]; keys陣列內之''、null、undefined元素略過。
// 【給了而無效(params, 不起子進程、不送請求)】key為非字串(含包裝物件、數字、物件、函數、已撤銷之Proxy); keys為非陣列之值(含字串、''、數字、物件)、不可讀(已撤銷之Proxy、內部標籤拋錯)之陣列,
//   或陣列含「非空且非原始字串」之元素(數字、物件、包裝物件、已撤銷之Proxy等)而濾後無有效字串者。
// 【混合】keys含有效字串者, 無效元素照舊略過(只用有效字串; 不因同組有無效元素而拒絕整組)。
// 【訊息】只寫型別(typeof)與個數, 不回顯值(值可能為金鑰)。


//MAX_KEYS, keys陣列元素數上限(超過視為給了而無效, 避免巨大／稀疏陣列卡住事件迴圈)
let MAX_KEYS = 10000


//KEY_KINDS, 吃opt.key之供應商種類(對應adapters.mjs之鍵名; codex、antigravity無金鑰概念不在內)
let KEY_KINDS = new Set(['claude', 'opencode', 'api-openai-compat', 'api-openai-responses', 'api-anthropic', 'api-typesafe-systemone'])


/**
 * 判定單一金鑰opt(opt.key)：未給(undefined、null、'')回空字串金鑰；原始非空字串回該字串；其餘(給了而無效)回錯誤訊息
 *
 * @param {*} v 輸入opt.key之值
 * @param {String} [name='key'] 輸入名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含key(有效金鑰字串，未給或無效為空字串)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readKey(v, name = 'key') {
    if (v === undefined || v === null || v === '') {
        return { key: '', err: '' }
    }
    if (isestr(v)) {
        return { key: v, err: '' }
    }
    return { key: '', err: `${name} must be a non-empty string when given (got ${typeof v}); an invalid ${name} is rejected instead of silently falling back to the default authentication` }
}


/**
 * 判定金鑰陣列opt(entry.keys)：未給(undefined、null、[]、陣列內全為''／null／undefined)回空陣列；有效字串回該些字串(無效元素略過)；給了而無效且無任何有效字串者回錯誤訊息
 *
 * 只經typeof與可讀性探針判定，不執行呼叫端之回調，不讀屬性值以外之任何東西
 *
 * @param {*} v 輸入entry.keys之值
 * @param {String} [name='keys'] 輸入名稱字串，用於錯誤訊息
 * @returns {Object} 回傳物件，內含keys(有效金鑰字串陣列)、err(給了而無效時之訊息；否則空字串，訊息不含值本身)
 */
function readKeys(v, name = 'keys') {
    if (v === undefined || v === null) {
        return { keys: [], err: '' }
    }
    let p = probeReadable(v, name)
    if (!p.ok) {
        return { keys: [], err: p.msg }
    }
    if (!Array.isArray(v)) { //不用內部標籤判陣列: 偽造Symbol.toStringTag為'Array'之一般物件不是陣列(已撤銷之Proxy已被上方探針擋下, Array.isArray不會對其拋錯)
        return { keys: [], err: `${name} must be an array of non-empty strings (got ${typeof v}); an invalid ${name} is rejected instead of silently falling back to the default authentication` }
    }
    let out = []
    let bad = 0
    try {
        let n = v.length
        if (!Number.isInteger(n) || n < 0) { //陣列Proxy之length可讀出非整數／負數: 無法逐元素判定, 視為不可讀(不可當成空陣列而靜默走登入態)
            return { keys: [], err: `${name} is not readable: length is not a valid array length` }
        }
        if (n > MAX_KEYS) { //巨大陣列(含稀疏陣列)逐元素讀取會卡住事件迴圈, 且實務上無此用法
            return { keys: [], err: `${name} has too many elements (more than ${MAX_KEYS}); an invalid ${name} is rejected instead of silently falling back to the default authentication` }
        }
        for (let i = 0; i < n; i++) {
            let k = v[i]
            if (isestr(k)) {
                out.push(k)
            }
            else if (k !== undefined && k !== null && k !== '') {
                bad++
            }
        }
    }
    catch (err) {
        return { keys: [], err: `${name} is not readable: ${errMsg(err)}` }
    }
    if (out.length === 0 && bad > 0) {
        return { keys: [], err: `${name} has no valid key: ${bad} element(s) are not non-empty strings; an invalid ${name} is rejected instead of silently falling back to the default authentication` }
    }
    return { keys: out, err: '' }
}


export { readKey, readKeys, KEY_KINDS }
