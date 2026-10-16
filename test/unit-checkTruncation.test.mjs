import assert from 'assert'
import { safeValidate, safeValidateAsync } from '../src/checkTruncation.mjs'
import userFnForms, { captureUnhandled } from './tools/userFnFormsForTest.mjs'


describe('checkTruncation', function() {

    it('safeValidate維持同步簽章(下游以.pass同步取用): 同步值照判, 拋錯為拒絕附訊息, 回傳Promise者視同拒絕且其rejection被承接', async function() {
        //規格: 帳本R-USERFN-2之相容條款——w-knowledge-extract之adapter以safeValidate(ev, s).pass同步取用, 不得改為async
        let forms = userFnForms(true, false, 50)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let v = safeValidate(f.fn, 'abc')
                rows.push([f.label, typeof v.then, v.pass, v.threw !== ''])
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
            return rows
        })
        let rr = forms.map((f) => [f.label, 'undefined', f.label === 'sync-true', !['sync-true', 'sync-false'].includes(f.label)])
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('safeValidateAsync: 回傳Promise者以resolve值判定, 拋錯/reject為validate threw、逾時為validate timed out, 不reject', async function() {
        //規格: 帳本R-USERFN-2——REST類轉接器之validate判定(含截斷放行時); 註記前綴: 拋錯與reject為'validate threw: ', 逾時為'validate timed out: '
        let forms = userFnForms(true, false, 400)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let v = await safeValidateAsync(f.fn, 'abc', 150)
                rows.push([f.label, v.pass, v.note === '' ? '' : /^validate timed out: did not settle within 0\.15s$/.test(v.note) ? 'timeout' : v.note.indexOf('validate threw: ') === 0 ? 'threw' : v.note])
            }
            return rows
        })
        let rr = forms.map((f) => [f.label, f.kind === 'pass', f.kind === 'pass' || f.kind === 'fail' ? '' : f.kind])
        assert.strict.deepEqual([r, seen], [rr, []])
    })

})
