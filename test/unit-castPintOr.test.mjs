import assert from 'assert'
import castPintOr from '../src/castPintOr.mjs'


describe('castPintOr', function() {

    it('有效正整數即轉整數回傳', function() {
        let r = [castPintOr(5000, 300000), castPintOr(1, 0), castPintOr('123', 0)]
        let rr = [5000, 1, 123]
        assert.strict.deepEqual(r, rr)
    })

    it('無效值回退預設值(含null代表不限)', function() {
        let r = []
        for (let v of [null, undefined, 0, -1, 1.5, 'abc', '', {}, [], true]) {
            r.push(castPintOr(v, 300000))
        }
        let rr = [300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000]
        assert.strict.deepEqual(r, rr)
    })

    it('預設值可為null', function() {
        let r = [castPintOr(undefined, null), castPintOr(-5, null), castPintOr(7, null)]
        let rr = [null, null, 7]
        assert.strict.deepEqual(r, rr)
    })

    it('可計算之正整數(帳本G17、R-TIMEOUT-1; 2026-11-13 da-hy由ispint＋cint改iseint): 1～MAX_SAFE_INTEGER之整數與其十進位數字字串有效; Infinity、\'Infinity\'、\'0x10\'、包裝物件、2**53、1e300、BigInt、陣列一律回預設', function() {
        //規格: opt之毫秒設定(minAttemptMs、cooldownMs、retryDelayMs等)以ise*判定「可計算」, Infinity為非預期、改用預設(dspec〈輸入參數之檢測機制〉§11第19～21項)
        //舊判定之結果: Infinity→1.797e308、'0x10'→16、new Number(5)→5(皆非預期)
        // eslint-disable-next-line no-new-wrappers
        let wrapped = new Number(5)
        let r = [
            castPintOr(2147483648, 'd'), castPintOr(Number.MAX_SAFE_INTEGER, 'd'), castPintOr(' 12 ', 'd'), castPintOr('1e3', 'd'),
            castPintOr(Infinity, 'd'), castPintOr('Infinity', 'd'), castPintOr('0x10', 'd'), castPintOr(wrapped, 'd'), castPintOr(2 ** 53, 'd'), castPintOr(1e300, 'd'),
            castPintOr(5n, 'd'), castPintOr([5], 'd'), castPintOr(NaN, 'd'), castPintOr(40000.5, 'd'),
        ]
        let rr = [2147483648, Number.MAX_SAFE_INTEGER, 12, 1000, 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd']
        assert.strict.deepEqual(r, rr)
        assert.strict.deepEqual(typeof castPintOr('123', 0), 'number')
    })

})
