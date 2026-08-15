import assert from 'assert'
import getErrorResult from '../src/getErrorResult.mjs'


describe('getErrorResult', function() {

    it('回傳與execCli同結構之錯誤結果物件', function() {
        let r = getErrorResult('something wrong')
        let rr = {
            ok: false,
            stdout: '',
            stderr: '',
            code: null,
            error: 'something wrong',
            errorType: 'params',
            durationMs: 0,
            attempts: 0,
        }
        assert.strict.deepEqual(r, rr)
    })

    it('鍵名與順序固定', function() {
        let r = Object.keys(getErrorResult('abc'))
        let rr = ['ok', 'stdout', 'stderr', 'code', 'error', 'errorType', 'durationMs', 'attempts']
        assert.strict.deepEqual(r, rr)
    })

    it('errorType可指定, 非有效字串回退params', function() {
        let r = [
            getErrorResult('x').errorType,
            getErrorResult('x', 'aborted').errorType,
            getErrorResult('x', null).errorType,
            getErrorResult('x', '').errorType,
        ]
        let rr = ['params', 'aborted', 'params', 'params']
        assert.strict.deepEqual(r, rr)
    })

    it('非有效字串之錯誤訊息回退為unknown error', function() {
        let r = []
        for (let v of [null, undefined, '', 123, {}, []]) {
            r.push(getErrorResult(v).error)
        }
        let rr = ['unknown error', 'unknown error', 'unknown error', 'unknown error', 'unknown error', 'unknown error']
        assert.strict.deepEqual(r, rr)
    })

    it('各次呼叫回傳互相獨立之物件', function() {
        let a = getErrorResult('a')
        let b = getErrorResult('b')
        a.stdout = 'modified'
        let r = [a === b, b.stdout, b.error]
        let rr = [false, '', 'b']
        assert.strict.deepEqual(r, rr)
    })

})
