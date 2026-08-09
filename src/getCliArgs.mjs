import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'


/**
 * 將各段命令列參數展平為字串陣列，並濾除非有效字串
 *
 * 各轉接器之參數為「固定旗標」加「可選旗標」加「額外旗標」之組合，
 * 其中可選旗標於未給值時須整段消失(例如未給model就不可出現懸空的`--model`)，
 * 故呼叫端須以「整段陣列給或不給」表達，本函數僅負責展平與濾除非有效字串，不判斷旗標配對；
 * 過濾之必要在於Nodejs之spawn要求各參數必為字串，混入undefined或數字會直接拋出TypeError，
 * 破壞本套件「不reject、僅以結果物件回報」之約定
 *
 * @param {...(String|Array)} args 輸入參數字串或參數字串陣列，可給多個
 * @returns {Array} 回傳展平且濾除非有效字串後之參數字串陣列
 * @example
 *
 * import getCliArgs from './src/getCliArgs.mjs'
 *
 * console.log(getCliArgs('-p', ['--model', 'sonnet']))
 * // => ['-p', '--model', 'sonnet']
 *
 * console.log(getCliArgs('-p', null, 123, ['', '--verbose']))
 * // => ['-p', '--verbose']
 *
 */
function getCliArgs(...args) {

    let r = []

    for (let arg of args) {

        //陣列則逐項展開, 僅展一層
        if (isarr(arg)) {
            for (let v of arg) {
                if (isestr(v)) {
                    r.push(v)
                }
            }
            continue
        }

        //非陣列即視為單一參數
        if (isestr(arg)) {
            r.push(arg)
        }

    }

    return r
}


export default getCliArgs
