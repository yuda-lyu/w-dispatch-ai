import assert from 'assert'
import toQuotaResult from '../src/quota/toQuotaResult.mjs'


describe('toQuotaResult', function() {

    it('未指定emailWant時不比對(matched為null), ok僅取決於查詢本身', function() {
        let r1 = toQuotaResult('claude', { email: 'a@b.com', windows: [{ key: 'x' }] })
        let r2 = toQuotaResult('claude', { email: 'a@b.com', error: 'boom', errorType: 'http' })
        let r = [[r1.ok, r1.matched, r1.windows.length], [r2.ok, r2.matched, r2.errorType]]
        let rr = [[true, null, 1], [false, null, 'http']]
        assert.strict.deepEqual(r, rr)
    })

    it('帳號比對去空白且不分大小寫; 不符時ok為false但額度資料仍回傳, error載明本機實際帳號', function() {
        let r1 = toQuotaResult('codex', { email: 'User@Example.com', emailWant: ' user@example.com ', windows: [{ key: 'x' }] })
        let r2 = toQuotaResult('codex', { email: 'a@b.com', emailWant: 'c@d.com', windows: [{ key: 'x' }] })
        let r = [
            [r1.ok, r1.matched],
            [r2.ok, r2.matched, r2.errorType, r2.windows.length, r2.error],
        ]
        let rr = [
            [true, true],
            [false, false, 'account', 1, 'local codex login account is [a@b.com], which does not match the requested account [c@d.com]'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('指定emailWant但無從取得本機帳號時視為不符並補述原因(errorType為account)', function() {
        let r1 = toQuotaResult('antigravity', { emailWant: 'a@b.com' })
        let r = [r1.ok, r1.matched, r1.errorType, r1.error]
        let rr = [false, false, 'account', 'cannot determine the local antigravity login account, so it is unknown whether it is the requested account [a@b.com]']
        assert.strict.deepEqual(r, rr)
    })

    it('已有查詢錯誤時不以帳號比對訊息覆蓋之', function() {
        let r1 = toQuotaResult('claude', { emailWant: 'a@b.com', error: 'unauthorized(401)', errorType: 'auth' })
        let r = [r1.ok, r1.matched, r1.error, r1.errorType]
        let rr = [false, false, 'unauthorized(401)', 'auth']
        assert.strict.deepEqual(r, rr)
    })

    it('回傳鍵名固定且無效輸入回退預設', function() {
        let r1 = toQuotaResult(null, { windows: 'bad', plan: 123, credits: undefined })
        let r = [Object.keys(r1), r1.provider, r1.windows, r1.plan, r1.credits, r1.raw, r1.durationMs]
        let rr = [
            ['ok', 'provider', 'email', 'matched', 'plan', 'planTier', 'source', 'windows', 'credits', 'raw', 'error', 'errorType', 'durationMs'],
            '', [], '', null, null, 0,
        ]
        assert.strict.deepEqual(r, rr)
    })

})
