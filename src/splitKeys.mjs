import isestr from 'wsemi/src/isestr.mjs'


// splitKeys.mjs — 把「多把金鑰」環境變數之值拆成金鑰陣列(resolveProviders與probeAnthropicKeys共用)
//
// 【為何需要】`*_KEYS`變數之約定分隔符是逗號。使用者曾以分號分隔(sk-ant-aaa;sk-ant-bbb), 整串被當成「一把」金鑰送出,
//   結果是401(金鑰無效)而非明顯的設定錯誤, 且遞補層會把這「一把」當作失敗後續換家, 難以察覺根因。
//
// 【處置: 分號視同逗號並回報(不靜默)】已知內建供應商(ANTHROPIC/OPENCODE/AGNES/POOLSIDE/TYPESAFE)之金鑰字元皆為英數、底線與連字號, 不含分號;
//   含分號的值幾乎必然是分隔錯誤, 自動拆開比整串送出更貼近使用者意圖。為免靜默改變語意, 拆出之結果附warning(含變數名與拆出把數, 不含金鑰值),
//   且只作用於名稱以_KEYS結尾者(複數形＝清單); 單數形變數(如FOO_KEY)與其他欄位不受影響。
//   若某供應商之金鑰確實含分號, 呼叫端可在resolveProviders以opt.splitSemicolon: false關閉(此時分號保留於金鑰內, 仍發warning)。


/**
 * 把金鑰清單字串拆成陣列：逗號分隔，可選地將分號視同逗號；修剪空白並濾除空項
 *
 * @param {String} value 輸入環境變數之值字串(非字串視為空)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Boolean} [opt.splitSemicolon=true] 輸入是否將分號視同逗號布林值，false代表分號保留於金鑰內，預設true
 * @returns {Object} 回傳物件，內含keys(金鑰字串陣列)與hasSemicolon(原值是否含分號布林值，不論是否拆開)
 * @example
 *
 * import splitKeys from './src/splitKeys.mjs'
 *
 * console.log(splitKeys('sk-a, sk-b,'))
 * // => { keys: [ 'sk-a', 'sk-b' ], hasSemicolon: false }
 *
 * console.log(splitKeys('sk-a;sk-b'))
 * // => { keys: [ 'sk-a', 'sk-b' ], hasSemicolon: true }
 *
 * console.log(splitKeys('sk-a;sk-b', { splitSemicolon: false }))
 * // => { keys: [ 'sk-a;sk-b' ], hasSemicolon: true }
 *
 */
function splitKeys(value, opt = {}) {
    let s = isestr(value) ? value : ''
    let hasSemicolon = s.includes(';')
    let split = !(opt && opt.splitSemicolon === false)
    let parts = (hasSemicolon && split) ? s.split(/[,;]/) : s.split(',')
    let keys = parts.map((k) => k.trim()).filter(Boolean)
    return { keys, hasSemicolon }
}


export default splitKeys
