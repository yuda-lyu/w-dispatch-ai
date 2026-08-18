// salvageTruncatedArray.mjs — 截斷JSON陣列之前段搶救
//
// 【為何需要】免費模型常在長陣列輸出中途被截斷(無閉合括號), 整包JSON.parse必失敗,
//   但前面k個元素是完整的。使用端殷鑑(2026-08-07~08): 兩日22次OUTPUT_VALIDATION_FAILED,
//   preview首元素皆完整合法——整批成果被截斷尾巴拖垮, 其中一輪3/3批全滅、整輪0產出。
//   字元掃描(含字串與跳脫感知)找出「最後一個完整的頂層元素」, 補上`]`後重新解析——
//   搶救回來的是**完整合法**的前段元素, 不是半成品。
//
// 【定位: 獨立工具, 不併入extractJsonLoose預設行為】「截斷」有兩種同樣合法的策略:
//   ①判失敗換家重產(全涵蓋驗證, 如逐篇摘要——缺篇的輸出本身即不完整);
//   ②搶救前段部分接受(批次萃取——避免全有全無, 一批30項救回25項遠勝重跑)。
//   套件提供工具, 策略由呼叫端選: extractJsonLoose檔頭明示之opt.parse擴充點即為此而留。
//
// 【只搶救「掃到結尾仍未閉合」的截斷】陣列有正常閉合但parse失敗屬別種毛病
//   (非法字元/壞跳脫), 補`]`救不了反而可能拼出語意錯誤的結果, 一律不碰回null。


/**
 * 自截斷的JSON陣列文字搶救出前段完整元素(頂層元素須為物件)
 *
 * 特點：
 * 自第一個`[`起逐字元掃描(字串與跳脫感知)，追蹤「最後一個完整結束的頂層物件元素」，
 * 補上`]`重新解析——回傳的每個元素皆完整合法，不是半成品；
 * 陣列有正常閉合(＝非截斷)、無`[`、或救回後為空陣列，一律回null不硬救；
 * 典型用法：extractJsonLoose回null時之後備，或組成自訂parse注入callAiWithFallback
 *
 * @param {String} text 輸入模型輸出文字字串
 * @returns {Array|null} 回傳搶救出之非空陣列，無法搶救回null
 * @example
 *
 * import salvageTruncatedArray from './src/wkf/salvageTruncatedArray.mjs'
 *
 * console.log(salvageTruncatedArray('[{"a":1},{"b":2},{"c":'))
 * // => [ { a: 1 }, { b: 2 } ]
 *
 * console.log(salvageTruncatedArray('[{"a":1}]')) //有閉合＝非截斷, 不在搶救範圍
 * // => null
 *
 */
function salvageTruncatedArray(text) {
    let s = String(text || '')
    let start = s.indexOf('[')
    if (start < 0) {
        return null
    }
    let depth = 0
    let inStr = false
    let esc = false
    let lastComplete = -1
    for (let i = start; i < s.length; i++) {
        let ch = s[i]
        if (esc) {
            esc = false
            continue
        }
        if (inStr) {
            if (ch === '\\') {
                esc = true
            }
            else if (ch === '"') {
                inStr = false
            }
            continue
        }
        if (ch === '"') {
            inStr = true
            continue
        }
        if (ch === '[' || ch === '{') {
            depth++
        }
        else if (ch === ']' || ch === '}') {
            depth--
            if (depth === 1 && ch === '}') {
                lastComplete = i //頂層元素(物件)完整結束
            }
            if (depth === 0) {
                return null //陣列有閉合＝非截斷, 不在搶救範圍
            }
        }
    }
    if (lastComplete < 0) {
        return null
    }
    try {
        let r = JSON.parse(s.slice(start, lastComplete + 1) + ']')
        return (Array.isArray(r) && r.length > 0) ? r : null
    }
    catch (e) {
        return null
    }
}


export default salvageTruncatedArray
