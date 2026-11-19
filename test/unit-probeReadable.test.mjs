import assert from 'assert'
import { probeReadable, readCallerObj } from '../src/callUserFn.mjs'
import { revoked } from './tools/userFnFormsForTest.mjs'


// unit-probeReadable.test.mjs — 可讀性探針(probeReadable)與readCallerObj之規格測試(帳本R-USERFN-4)
//
// 規格: 本套件不借wsemi判斷函數(isobj、isarr、isstr等)對敵意輸入拋錯來成立防線——wsemi 1.9.69起判斷函數對任何輸入皆不拋錯(拋錯者回false, dspec〈輸入參數之檢測機制〉C2),
//   「不可讀」與「不是物件」於判斷函數上不可分; 站點須先經本探針(內部標籤＋自有鍵列表, 拋錯即不可讀)分辨, 不可讀者依該站點既有之失敗通道回報(多為params), 可讀者才交判斷函數判型。
//   readCallerObj: 非物件原樣交回、物件回物化之淺層副本、不可讀回'<name> is not readable: <訊息>'(帳本R-USERFN-1)。


//敵意值夾具: label → 產生函數(每次回新物件)
let HOSTILE = {
    'revoked-object': () => revoked(),
    'revoked-array': () => {
        let p = Proxy.revocable([], {})
        p.revoke()
        return p.proxy
    },
    'revoked-function': () => {
        let p = Proxy.revocable(function() {}, {})
        p.revoke()
        return p.proxy
    },
    'toStringTag-getter-throws': () => Object.defineProperty({}, Symbol.toStringTag, {
        get: () => {
            throw new Error('tag-boom')
        },
    }),
    'ownKeys-trap-throws': () => new Proxy({}, {
        ownKeys: () => {
            throw new Error('ownKeys-boom')
        },
    }),
    'get-trap-throws': () => new Proxy({}, {
        get: () => {
            throw new Error('get-boom')
        },
    }),
}


describe('probeReadable(可讀性探針)', function() {

    it('敵意值(已撤銷之Proxy、Symbol.toStringTag拋錯、ownKeys陷阱拋錯、get陷阱拋錯): 皆不拋錯、回ok為false並帶\'<name> is not readable: <原因>\'', function() {
        //規格: 帳本R-USERFN-4——不可讀者回錯誤訊息供站點以params回報; 探針本身不拋錯
        let rows = []
        for (let label of Object.keys(HOSTILE)) {
            let r = probeReadable(HOSTILE[label](), 'spec')
            rows.push([label, r.ok, r.tag, r.msg.startsWith('spec is not readable: '), r.msg === `spec is not readable: ${r.reason}`, r.reason !== ''])
        }
        let rr = Object.keys(HOSTILE).map((label) => [label, false, '', true, true, true])
        assert.strict.deepEqual(rows, rr)
    })

    it('可讀之值: 純量(含null、undefined、空字串)、一般物件、陣列、類別實例、凍結物件、函數、Map、帶getter之物件(只探針不讀屬性值)皆ok並回內部標籤', function() {
        //規格: 帳本R-USERFN-4——只取內部標籤與自有鍵列表, 不展開、不讀屬性值(有狀態之getter不被讀取)
        let reads = 0
        let withGetter = {}
        Object.defineProperty(withGetter, 'X', {
            enumerable: true,
            get: () => {
                reads++
                throw new Error('getter must not be read by the probe')
            },
        })
        class Foo {
            constructor() {
                this.a = 1
            }
        }
        let rows = [
            [undefined, '[object Undefined]'],
            [null, '[object Null]'],
            ['', '[object String]'],
            ['sk-x', '[object String]'],
            [123, '[object Number]'],
            [true, '[object Boolean]'],
            [{}, '[object Object]'],
            [Object.freeze({ a: 1 }), '[object Object]'],
            [new Foo(), '[object Object]'],
            [withGetter, '[object Object]'],
            [[], '[object Array]'],
            [[1, 2], '[object Array]'],
            [function() {}, '[object Function]'],
            [new Map(), '[object Map]'],
        ].map(([v, tag]) => {
            let r = probeReadable(v, 'v')
            return [r.ok, r.tag, r.msg, r.reason, tag]
        })
        let rr = rows.map(([, , , , tag]) => [true, tag, '', '', tag])
        assert.strict.deepEqual(rows, rr)
        assert.strict.equal(reads, 0)
    })

    it('name省略時訊息前綴為value', function() {
        let r = probeReadable(revoked())
        assert.strict.equal(r.msg.startsWith('value is not readable: '), true)
    })

})


describe('readCallerObj(依可讀性探針; 帳本R-USERFN-1、R-USERFN-4)', function() {

    it('不可讀之物件(敵意值): ok為false、value為undefined、訊息以\'<name> is not readable: \'開頭——與wsemi判斷函數是否拋錯無關', function() {
        //規格: 帳本R-USERFN-1「不可讀(拋錯之getter、已撤銷之Proxy)回<name> is not readable: <訊息>, 站點以params回報」
        let rows = []
        for (let label of Object.keys(HOSTILE)) {
            let r = readCallerObj(HOSTILE[label](), 'env')
            rows.push([label, r.ok, r.value, r.msg.startsWith('env is not readable: ')])
        }
        let rr = Object.keys(HOSTILE).map((label) => [label, false, undefined, true])
        assert.strict.deepEqual(rows, rr)
    })

    it('有拋錯getter之一般物件: 展開時拋錯 → ok為false(同修前之readCallerObj)', function() {
        let o = Object.defineProperty({}, 'X', {
            enumerable: true,
            get: () => {
                throw new Error('getter-boom')
            },
        })
        let r = readCallerObj(o, 'headers')
        assert.strict.deepEqual([r.ok, r.msg], [false, 'headers is not readable: getter-boom'])
    })

    it('可讀者: 一般物件回淺層副本(非同一參照、巢狀值同一參照、只讀一次getter); 陣列、Map、純量、null、函數原樣交回', function() {
        let nested = { n: 1 }
        let reads = 0
        let o = { a: 1, nested }
        Object.defineProperty(o, 'g', {
            enumerable: true,
            get: () => {
                reads++
                return `g${reads}`
            },
        })
        let r = readCallerObj(o, 'x')
        let arr = [1, 2]
        let map = new Map()
        let fn = () => {}
        let rows = [
            [r.ok, r.value !== o, r.value.nested === nested, r.value.g, reads],
            [readCallerObj(arr, 'x').value === arr, readCallerObj(map, 'x').value === map, readCallerObj(fn, 'x').value === fn],
            [readCallerObj(null, 'x').value, readCallerObj(undefined, 'x').value, readCallerObj('s', 'x').value, readCallerObj(7, 'x').value],
        ]
        let rr = [
            [true, true, true, 'g1', 1],
            [true, true, true],
            [null, undefined, 's', 7],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('函數型: 已撤銷之函數Proxy、標籤拋錯之函數為不可讀(ok為false); 可讀之函數原樣交回(不展開)', function() {
        //規格: 帳本R-USERFN-4——不可讀(含函數型之已撤銷Proxy)必須回報; 修前(1.9.69下)函數型於typeof即原樣交回而不經探針, 下游(如遞補條目為已撤銷之函數Proxy)讀取時reject
        let p = Proxy.revocable(function() {}, {})
        p.revoke()
        let tagFn = Object.defineProperty(function() {}, Symbol.toStringTag, {
            get: () => {
                throw new Error('fntag-boom')
            },
        })
        let fn = () => {}
        let rows = [readCallerObj(p.proxy, 'x'), readCallerObj(tagFn, 'x'), readCallerObj(fn, 'x')].map((r) => [r.ok, r.msg.startsWith('x is not readable: ')])
        assert.strict.deepEqual(rows, [[false, true], [false, true], [true, false]])
        assert.strict.equal(readCallerObj(fn, 'x').value, fn)
    })

})
