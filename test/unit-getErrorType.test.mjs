import assert from 'assert'
import getErrorType, { attachErrorType, isSpawnFail } from '../src/getErrorType.mjs'


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

    it('execCli結果之code為null且帶pid鍵而值為undefined(子進程未能啟動)一律為spawn, 不論錯誤碼; 已啟動者(帶pid)與不帶pid鍵之輸入不以結構判定', function() {
        //規格: README errorType表之spawn列(以execCli結果之code與pid鍵結構判定, 不論錯誤碼; 帳本R-SPAWN-1)
        let r = [
            getErrorType({ ok: false, code: null, pid: undefined, error: 'UNKNOWN: spawn UNKNOWN' }),
            getErrorType({ ok: false, code: null, pid: undefined, error: 'EFTYPE: spawn EFTYPE' }),
            getErrorType({ ok: false, code: null, pid: undefined, error: 'EPERM: spawn EPERM' }),
            getErrorType({ ok: false, code: null, pid: undefined, error: 'ERR_INVALID_ARG_VALUE: The argument args[1] must be a string without null bytes' }),
            getErrorType({ ok: false, code: null, error: 'EACCES: spawn x EACCES' }), //無pid鍵(非execCli結果)不以結構判定, 字樣亦非ENOENT/ENAMETOOLONG
            getErrorType({ ok: false, code: null, pid: 1234, error: 'TIMEOUT after 1s' }),
            getErrorType({ ok: false, code: null, pid: 1234, error: 'Signal: SIGTERM' }),
            getErrorType({ ok: false, code: 1, pid: 1234, error: 'Exit code 1' }),
            getErrorType({ ok: false, code: 0, pid: 1234, error: 'OUTPUT_VALIDATION_FAILED' }),
        ]
        let rr = ['spawn', 'spawn', 'spawn', 'spawn', 'exec', 'timeout', 'exec', 'exec', 'validation']
        assert.strict.deepEqual(r, rr)
    })

    it('isSpawnFail僅對失敗且code為null、帶自有pid鍵而其值為undefined者(execCli之未能啟動)為true', function() {
        //規格: 同上(isSpawnFail: 失敗、code為null、帶自有pid鍵且其值為undefined; 帳本R-SPAWN-1)
        let r = [
            isSpawnFail({ ok: false, code: null, pid: undefined, error: 'UNKNOWN: spawn UNKNOWN' }),
            isSpawnFail({ ok: false, code: null, pid: 99, error: 'TIMEOUT after 1s' }),
            isSpawnFail({ ok: false, code: 2, pid: 99, error: 'Exit code 2' }),
            isSpawnFail({ ok: true, code: null }),
            isSpawnFail({ ok: false, error: 'Exit code 1' }), //無code鍵(非execCli結果)
            isSpawnFail(null),
            isSpawnFail({ ok: false, code: null, error: 'FETCH_ERROR: ECONNREFUSED', errorType: 'fetch' }), //REST結果無pid鍵
            isSpawnFail({ ok: false, stdout: '', stderr: '', code: null, error: 'x', errorType: 'params', durationMs: 0, attempts: 0 }), //getErrorResult形狀
        ]
        let rr = [true, false, false, false, false, false, false, false]
        assert.strict.deepEqual(r, rr)
    })

})
