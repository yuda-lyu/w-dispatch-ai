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

})
