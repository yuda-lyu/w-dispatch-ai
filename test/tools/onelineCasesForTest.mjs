// onelineCasesForTest.mjs — oneline之n輸入表(測試與子行程探針共用, 只定義一次)
//
// 規格句(主控r3da提示詞〈要做〉): oneline自行檢查n(以iseint之count判定), 有效才Number(n)交給strTruncate,
//   無效則不截斷(回壓平之整行; 與w-data-pipeline 1.0.25之oneline同語意), 有效輸入之輸出逐字不變。
// keep: 有效n之保留字數(= Number(n)); null代表無效n, 預期回壓平之整行。


//RAW, 含多種空白(雙空格、換行、tab)之長文字, 壓平後(FLAT)為單行、長度遠超各case之n
export const RAW = Array.from({ length: 150 }, (_, i) => 'w' + String(i).padStart(3, '0')).map((w, i) => w + (i % 3 === 0 ? '  ' : (i % 3 === 1 ? '\n' : '\t '))).join('') + '  \n'


//FLAT, 壓平並修剪頭尾(空白壓為單一空格)
export const FLAT = RAW.replace(/\s+/g, ' ').trim()


/**
 * 規格對輸出之描述: 無效n(keep為null)回整行; 有效n時未超過keep字原樣、超過則取前keep字補刪節號'...'
 *
 * @param {Number|null} keep 保留字數，無效n為null
 * @returns {String} 預期之輸出
 */
export function expectedOf(keep) {
    if (keep === null || FLAT.length <= keep) {
        return FLAT
    }
    return FLAT.slice(0, keep) + '...'
}


//hostile, 取值即拋錯之物件(oneline不得呼叫n之任何方法, 亦不得拋錯)
function mkHostile() {
    let boom = () => {
        throw new Error('hostile n touched')
    }
    return new Proxy({}, { get: boom, has: boom, getPrototypeOf: boom, ownKeys: boom, getOwnPropertyDescriptor: boom })
}


/**
 * n輸入表: label為顯示名, n為輸入值, keep為有效n之保留字數(無效為null)
 */
export const N_CASES = [

    //有效: 數字
    { label: '80', n: 80, keep: 80 },
    { label: '60', n: 60, keep: 60 },
    { label: '1', n: 1, keep: 1 },
    { label: '0', n: 0, keep: 0 },
    { label: '-0', n: -0, keep: 0 },
    { label: '300(超過byte範圍)', n: 300, keep: 300 },
    { label: '1000', n: 1000, keep: 1000 },
    { label: '4294967295(count上限)', n: 4294967295, keep: 4294967295 },

    //有效: 可無損轉數字之字串(iseint收, Number(n)後交給strTruncate)
    { label: '"80"', n: '80', keep: 80 },
    { label: '" 80 "', n: ' 80 ', keep: 80 },
    { label: '"1.5e1"', n: '1.5e1', keep: 15 },
    { label: '"0"', n: '0', keep: 0 },

    //無效: 不截斷
    { label: 'undefined(未給)', n: undefined, keep: null },
    { label: 'null', n: null, keep: null },
    { label: '-1', n: -1, keep: null },
    { label: '1.5', n: 1.5, keep: null },
    { label: '"1.5"', n: '1.5', keep: null },
    { label: 'Infinity', n: Infinity, keep: null },
    { label: '-Infinity', n: -Infinity, keep: null },
    { label: 'NaN', n: NaN, keep: null },
    { label: '"Infinity"', n: 'Infinity', keep: null },
    { label: '"abc"', n: 'abc', keep: null },
    { label: '""', n: '', keep: null },
    { label: '"  "', n: '  ', keep: null },
    { label: '"-1"', n: '-1', keep: null },
    { label: '"0x10"', n: '0x10', keep: null },
    { label: '4294967296(超過count)', n: 4294967296, keep: null },
    { label: '2**53(非安全整數)', n: 2 ** 53, keep: null },
    { label: 'true', n: true, keep: null },
    { label: 'false', n: false, keep: null },
    { label: '[](空陣列)', n: [], keep: null },
    { label: '[80](Number後為80)', n: [80], keep: null },
    { label: '{}', n: {}, keep: null },
    { label: '{ valueOf: 80 }', n: { valueOf: () => 80 }, keep: null },
    { label: 'new Number(80)(包裝物件)', n: new Number(80), keep: null }, // eslint-disable-line no-new-wrappers
    { label: 'new String("80")(包裝物件)', n: new String('80'), keep: null }, // eslint-disable-line no-new-wrappers
    { label: '80n(BigInt)', n: 80n, keep: null },
    { label: 'Symbol()', n: Symbol('n'), keep: null },
    { label: '函數', n: () => 80, keep: null },
    { label: '取值即拋錯之物件', n: mkHostile(), keep: null },
]
