import get from 'lodash-es/get.js'
import isint from 'wsemi/src/isint.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import { asText } from '../callUserFn.mjs'


// parseIndexList.mjs — 自AI回覆取編號清單(挑選類任務: 「回覆入選之編號」)
//
// 【為何取「數字個數最多的那一串」】模型偶把推理混進輸出, 實測如`5,6,15,16,28 Wait, let me reconsider…`——
//   答案是最長那串數字, 後面的推理文字不可當答案; 且提示詞含數量上限(如「最多選5則」)時,
//   模型複述該數字極易帶出獨立的「5」。故掃描全文取逗號/頓號分隔之數字串中個數最多者, 同長度取最先出現者。
//
// 【單一個0約定為空集合】提示詞約定「沒有入選請回0」: 勝出串恰為單一個0 → isZero為true、indices為空;
//   其餘依min/max過濾、topN截取。回覆中完全找不到數字時isZero為false且indices為空(呼叫端可據以判定未回答)。


//數字串: 數字以逗號(半形/全形)或頓號分隔(分隔符兩側容許空白, 不含換行)
let RUN = /\d+(?:[ \t]*[,，、][ \t]*\d+)*/g


/**
 * 自AI回覆文字取編號清單：取逗號或頓號分隔之數字串中個數最多者(同長度取最先)，單一個0視為空集合
 *
 * 特點：
 * 全文掃描所有數字串，個數最多者為答案，其餘(推理文字中夾帶之數字)忽略；
 * 勝出串恰為單一個0回傳{ isZero: true, indices: [] }；
 * 其餘依opt.min與opt.max保留範圍內之編號(含端點)，再依opt.topN截取前N個(保持原順序，不去重不排序)；
 * 超出安全整數範圍之數字略過；找不到數字回傳{ isZero: false, indices: [] }；
 * opt各鍵無效視為未給改用預設，不throw；輸入非字串視為空
 *
 * @param {String} text 輸入AI回覆文字字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.min=1] 輸入保留之最小編號整數，預設1
 * @param {Number} [opt.max=Infinity] 輸入保留之最大編號整數，預設Infinity代表不限
 * @param {Number} [opt.topN=Infinity] 輸入最多保留之編號個數正整數，預設Infinity代表不限
 * @returns {Object} 回傳物件，內含isZero(是否為單一個0之空集合約定)與indices(編號整數陣列)
 * @example
 *
 * import parseIndexList from './src/wkf/parseIndexList.mjs'
 *
 * console.log(parseIndexList('5,6,15,16,28 Wait, let me reconsider…'))
 * // => { isZero: false, indices: [ 5, 6, 15, 16, 28 ] }
 *
 * console.log(parseIndexList('最多選5則: 3、7、9', { max: 20 }))
 * // => { isZero: false, indices: [ 3, 7, 9 ] }
 *
 * console.log(parseIndexList('0'))
 * // => { isZero: true, indices: [] }
 *
 * console.log(parseIndexList('1,2,3,4,5', { topN: 2 }))
 * // => { isZero: false, indices: [ 1, 2 ] }
 *
 * console.log(parseIndexList('無'))
 * // => { isZero: false, indices: [] }
 *
 */
function parseIndexList(text, opt = {}) {

    //opt各鍵: 無效視為未給
    let min = get(opt, 'min', null)
    min = isint(min) ? cint(min) : 1
    let max = get(opt, 'max', null)
    max = isint(max) ? cint(max) : Infinity
    let topN = get(opt, 'topN', null)
    topN = ispint(topN) ? cint(topN) : Infinity

    //best, 數字個數最多之串(同長度取最先)
    let s = asText(text)
    let best = null
    for (let m of s.matchAll(RUN)) {
        let nums = m[0].split(/[ \t]*[,，、][ \t]*/).map((v) => Number(v)).filter((v) => Number.isSafeInteger(v))
        if (nums.length > 0 && (best === null || nums.length > best.length)) {
            best = nums
        }
    }
    if (best === null) {
        return { isZero: false, indices: [] }
    }

    //單一個0約定為空集合
    if (best.length === 1 && best[0] === 0) {
        return { isZero: true, indices: [] }
    }

    let indices = best.filter((v) => v >= min && v <= max).slice(0, topN)
    return { isZero: false, indices }
}


export default parseIndexList
