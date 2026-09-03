import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import cint from 'wsemi/src/cint.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strdelleft from 'wsemi/src/strdelleft.mjs'


// buildValidator.mjs — 由validate規則建立驗證函式(規則語法同wsemi之execCli)
//
// 【為何獨立成檔】CLI類轉接器之validate由execCli實作, 而api類轉接器自行呼叫fetch
//   故須自備同語法之驗證器; 現有多個api類轉接器(chat/completions與responses)共用同一份,
//   分居各檔會讓「規則語法」隨修改而分岔——同一個'min:100'在不同kind行為不同即為災難。


/**
 * 建立驗證函式(規則語法同execCli之validate)
 *
 * 特點：
 * 傳入自訂函式時直接使用；
 * 規則字串支援'nonempty'、'json'、'min:100'，多規則可用逗號串接(須全部通過)；
 * 規則本身無效(如'min:abc')視為驗證失敗而非靜默跳過——避免打錯規則卻以為有在驗
 *
 * @param {String|Function} rule 輸入驗證規則字串('nonempty'、'json'、'min:100', 逗號可串接)或自訂函式
 * @returns {Function|null} 回傳驗證函式，無有效規則回傳null
 * @example
 *
 * import buildValidator from './src/buildValidator.mjs'
 *
 * let v = buildValidator('nonempty,min:3')
 * console.log(v('abcd'), v('ab'), v(''))
 * // => true false false
 *
 * console.log(buildValidator(null))
 * // => null
 *
 */
function buildValidator(rule) {

    //自訂函式直接使用
    if (isfun(rule)) {
        return rule
    }

    //check
    if (!isestr(rule)) {
        return null
    }

    //checks
    let checks = rule.split(',').map((r) => r.trim()).filter(Boolean)
    if (checks.length === 0) {
        return null
    }

    return (stdout) => {
        for (let check of checks) {

            if (check === 'nonempty') {
                if (!isestr(stdout) || stdout.trim() === '') {
                    return false
                }
            }

            else if (check === 'json') {
                try {
                    JSON.parse(stdout)
                }
                catch {
                    return false
                }
            }

            else if (strleft(check, 4) === 'min:') {

                //規則本身無效(如min:abc) → 視為驗證失敗, 不靜默跳過
                let smin = strdelleft(check, 4)
                if (!isnum(smin)) {
                    return false
                }

                let min = cint(smin)
                if (!isestr(stdout) || stdout.length < min) {
                    return false
                }
            }

        }
        return true
    }
}


export default buildValidator
