import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import { callHookSync } from '../callUserFn.mjs'
import parseJsonArray from './parseJsonArray.mjs'


// makeArrayCoverageValidator.mjs — 逐項編號之JSON陣列涵蓋率驗證器(可直接作dispatchAiFallback／callAI之validate)
//
// 【為何驗涵蓋率】逐則摘要/翻譯類任務, 提示詞給N則並要求每則一筆回覆; 實戰上模型會漏項、空內容、
//   或單項過長(Telegram單則訊息硬限4,096字元, 實戰超限5次; 某供應商長摘要為規格之2.6～4.4倍)。
//   缺項輸出即不完整, 與其部分接受不如整體不合格換家重產——故為嚴格版: 配合parseJsonArray(截斷即null,不搶救)。
//
// 【超長即整體不合格, 不剔除該項】截去超長項會改變下游看到的內容(或缺項), 與「缺項即不完整」同理, 整體判不合格換家重產。
//
// 【涵蓋判定】以「涵蓋」計(同一編號可回多筆, 只要有一筆有內容即算涵蓋); 編號須為數字(字串數字不算涵蓋)。
//
// 【indices不可靜默改空陣列】給了但非陣列即throw TypeError——改成空陣列則「無任何編號須涵蓋」, 驗證器形同放行一切。


/**
 * 內容是否非空(字串修剪後非空、陣列有元素、null與undefined為空、其餘視為有內容)
 *
 * @param {*} v 輸入欄位值
 * @returns {Boolean} 回傳是否非空
 */
function hasContent(v) {
    if (v === null || v === undefined) {
        return false
    }
    if (typeof v === 'string') {
        return v.trim() !== ''
    }
    if (isarr(v)) {
        return v.length > 0
    }
    return true
}


/**
 * 建立逐項編號之JSON陣列涵蓋率驗證器，回傳可直接作validate之函數
 *
 * 特點：
 * 回傳(stdout)=>Boolean，同步、不throw：回覆須為完整之JSON陣列(非陣列或輸出截斷即不合格)；
 * 任一項任一受限欄位(maxLengths)字數超過上限即整體不合格(不剔除該項)；
 * indices內每個編號須被涵蓋(同一編號可回多筆)，且該筆contentFields任一欄位非空才算有內容，缺項或內容為空即不合格；
 * 每次不合格以onReject(reason)回報原因字串(回調拋錯或回傳Promise皆忽略)，供呼叫端寫日誌；
 * indices給了但非陣列即throw TypeError(不可靜默改空陣列，否則形同放行)，省略視為空陣列；
 * 其餘鍵型別不符視為未給改用預設(indexField非非空字串、contentFields非陣列、maxLengths非物件、onReject非函數；maxLengths內非正整數之上限略過)
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Array} [opt.indices=[]] 輸入須涵蓋之編號陣列(數字)，預設[]
 * @param {String} [opt.indexField='index'] 輸入編號欄位名字串，預設'index'
 * @param {Array} [opt.contentFields=[]] 輸入內容欄位名字串陣列，任一非空才算該筆有內容；空陣列代表只驗編號，預設[]
 * @param {Object} [opt.maxLengths={}] 輸入欄位名對字數上限(正整數)之物件，如{ summary: 600 }，預設{}
 * @param {Function} [opt.onReject=null] 輸入不合格回報函數(reason)=>void，預設null代表不回報
 * @returns {Function} 回傳驗證函數(stdout)=>Boolean
 * @example
 *
 * import makeArrayCoverageValidator from './src/wkf/makeArrayCoverageValidator.mjs'
 *
 * let validate = makeArrayCoverageValidator({
 *     indices: [1, 2],
 *     contentFields: ['t'],
 *     maxLengths: { t: 3 },
 *     onReject: (reason) => console.log(reason),
 * })
 *
 * console.log(validate('[{"index":1,"t":"a"},{"index":2,"t":"b"}]'))
 * // => true
 *
 * console.log(validate('[{"index":1,"t":"abcd"},{"index":2,"t":"x"}]')) //超長, 整體不合格
 * // => 第 1 項之 t 為 4 字，超過上限 3
 * // => false
 *
 * console.log(validate('[{"index":1,"t":"a"},{"index":2,"t":" "}]')) //第2項內容為空
 * // => 未涵蓋編號 2（缺項或內容為空）
 * // => false
 *
 * console.log(validate('[{"index":1,"t":"a"},{"index":2')) //截斷
 * // => 非 JSON 陣列或輸出截斷
 * // => false
 *
 * //可直接作callAI／dispatchAiFallback之validate: caller.callAI(prompt, { validate })
 *
 */
function makeArrayCoverageValidator(opt = {}) {

    //indices, 給了但非陣列即throw(null亦屬給了); 省略(undefined)視為空陣列
    let indices = get(opt, 'indices', undefined)
    if (indices === undefined) {
        indices = []
    }
    if (!isarr(indices)) {
        throw new TypeError('makeArrayCoverageValidator 之 indices 須為陣列')
    }
    indices = [...indices]

    //其餘鍵: 無效視為未給
    let indexField = get(opt, 'indexField', null)
    if (!isestr(indexField)) {
        indexField = 'index'
    }
    let contentFields = get(opt, 'contentFields', null)
    contentFields = isarr(contentFields) ? contentFields.filter((f) => isestr(f)) : []
    let maxLengths = get(opt, 'maxLengths', null)
    let limits = []
    if (isobj(maxLengths)) {
        for (let f of Object.keys(maxLengths)) {
            if (ispint(maxLengths[f])) {
                limits.push([f, cint(maxLengths[f])])
            }
        }
    }
    let onReject = get(opt, 'onReject', null)

    let reject = (reason) => {
        if (isfun(onReject)) {
            callHookSync(() => onReject(reason))
        }
        return false
    }

    return (stdout) => {

        //完整之JSON陣列, 截斷或非陣列即不合格
        let arr = parseJsonArray(stdout)
        if (arr === null) {
            return reject('非 JSON 陣列或輸出截斷')
        }
        let items = arr.filter((it) => isobj(it))

        //超長: 任一項任一受限欄位, 整體不合格(不剔除該項)
        for (let it of items) {
            for (let [f, max] of limits) {
                let v = it[f]
                if (typeof v === 'string' && v.length > max) {
                    let no = (typeof it[indexField] === 'number') ? it[indexField] : '?' //只回報數字編號, 不回顯回覆中的任意值
                    return reject(`第 ${no} 項之 ${f} 為 ${v.length} 字，超過上限 ${max}`)
                }
            }
        }

        //涵蓋: 同一編號可回多筆, contentFields任一非空才算有內容(contentFields為空則只驗編號)
        let covered = new Set()
        for (let it of items) {
            let idx = it[indexField]
            if (typeof idx !== 'number') {
                continue
            }
            if (contentFields.length === 0 || contentFields.some((f) => hasContent(it[f]))) {
                covered.add(idx)
            }
        }
        let lack = [...new Set(indices.filter((i) => !covered.has(i)))]
        if (lack.length > 0) {
            return reject(`未涵蓋編號 ${lack.join('、')}（缺項或內容為空）`)
        }

        return true
    }
}


export default makeArrayCoverageValidator
