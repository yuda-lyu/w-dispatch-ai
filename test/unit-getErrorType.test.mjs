import assert from 'assert'
import getErrorType, { attachErrorType } from '../src/getErrorType.mjs'


describe('getErrorType', function() {

    it('機械可判之類別: timeout/spawn/validation, 其餘歸exec', function() {
        let r = [
            getErrorType({ error: 'TIMEOUT after 300s' }),
            getErrorType({ error: 'spawn my-cli ENOENT' }),
            getErrorType({ error: 'ENAMETOOLONG: spawn error' }),
            getErrorType({ error: 'OUTPUT_VALIDATION_FAILED' }),
            getErrorType({ error: 'Exit code 1' }),
            getErrorType({ error: 'Invalid API key.' }),
            getErrorType({}),
            getErrorType({ error: '' }),
        ]
        let rr = ['timeout', 'spawn', 'spawn', 'validation', 'exec', 'exec', 'exec', 'exec']
        assert.strict.deepEqual(r, rr)
    })

    it('attachErrorType僅對失敗且未帶errorType之結果追加', function() {
        let rOk = { ok: true, stdout: 'abc' }
        let rFail = { ok: false, error: 'TIMEOUT after 10s' }
        let rTyped = { ok: false, error: 'HTTP 429', errorType: 'http' }
        let r = [
            attachErrorType(rOk).errorType,
            attachErrorType(rOk) === rOk, //成功結果原樣回傳
            attachErrorType(rFail).errorType,
            attachErrorType(rTyped).errorType, //已帶有效errorType則不覆寫
        ]
        let rr = [undefined, true, 'timeout', 'http']
        assert.strict.deepEqual(r, rr)
    })

})
