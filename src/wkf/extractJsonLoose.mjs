// extractJsonLoose.mjs — 從AI回覆文字中寬鬆抽取JSON(工作流層預設解析器, 可被注入覆寫)
//
// 【為何需要】各家CLI的回覆常帶code fence、前後說明文字、ANSI色碼;
//   直接JSON.parse必炸。本函數做清理後以「括號配對」找出第一個完整
//   物件或陣列再解析。呼叫端若有更強的解析器(如含截斷搶救), 以opt.parse注入即可。


/**
 * 從文字中抽取第一個完整的JSON物件或陣列
 *
 * 特點：
 * 先去除ANSI色碼與code fence標記後嘗試整段解析(最常見情境之最快路徑)；
 * 整段非法時自第一個`{`或`[`起以括號配對(跳過字串與跳脫)取得第一個完整片段再解析；
 * 僅接受物件與陣列，純量(字串/數字/布林)回傳null；
 * 括號未閉合(輸出被截斷)或片段非法一律回傳null，不throw
 *
 * @param {String} text 輸入AI回覆文字字串
 * @returns {Object|Array|null} 回傳解析成功之物件或陣列，失敗回傳null
 * @example
 *
 * import extractJsonLoose from './src/wkf/extractJsonLoose.mjs'
 *
 * console.log(extractJsonLoose('{"a":1}'))
 * // => { a: 1 }
 *
 * console.log(extractJsonLoose('說明文字\n```json\n{"a":1}\n```\n後記'))
 * // => { a: 1 }
 *
 * console.log(extractJsonLoose('{"a":1')) //截斷
 * // => null
 *
 * console.log(extractJsonLoose('純文字回覆'))
 * // => null
 *
 */
function extractJsonLoose(text) {
    let s = String(text || '')

    //去ANSI色碼與code fence標記
    s = s.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
    s = s.replace(/```(?:json)?/g, '')
    s = s.trim()
    if (s === '') {
        return null
    }

    //整段直接解析(最常見情境, 最快路徑)
    try {
        let j = JSON.parse(s)
        if (j !== null && typeof j === 'object') {
            return j
        }
    }
    catch (e) { /* 進入括號配對路徑 */ }

    //括號配對: 自第一個{或[起, 逐字元追蹤深度(跳過字串與跳脫), 取得第一個完整片段
    let start = -1
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '{' || s[i] === '[') {
            start = i
            break
        }
    }
    if (start < 0) {
        return null
    }
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < s.length; i++) {
        let c = s[i]
        if (inStr) {
            if (esc) {
                esc = false
            }
            else if (c === '\\') {
                esc = true
            }
            else if (c === '"') {
                inStr = false
            }
            continue
        }
        if (c === '"') {
            inStr = true
        }
        else if (c === '{' || c === '[') {
            depth++
        }
        else if (c === '}' || c === ']') {
            depth--
            if (depth === 0) {
                try {
                    let j = JSON.parse(s.slice(start, i + 1))
                    if (j !== null && typeof j === 'object') {
                        return j
                    }
                }
                catch (e) { /* 片段仍非法, 視為失敗 */ }
                return null
            }
        }
    }
    return null //括號未閉合(輸出被截斷)
}


export default extractJsonLoose
