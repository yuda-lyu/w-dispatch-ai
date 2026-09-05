import assert from 'assert'
import fetchQuotaJson from '../src/quota/fetchQuotaJson.mjs'
import fakeServerForQuotaTest from './tools/fakeServerForQuotaTest.mjs'


describe('fetchQuotaJson', function() {

    let svr = null

    before(async function() {
        svr = await fakeServerForQuotaTest()
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
    })

    let call = (tok, o = {}) => fetchQuotaJson(svr.usageUrlClaude, { headers: { Authorization: `Bearer ${tok}` }, ...o })

    it('url無效回params, 不reject', async function() {
        let r = await fetchQuotaJson('')
        let rr = [r.ok, r.status, r.data, r.errorType]
        assert.strict.deepEqual(rr, [false, 0, null, 'params'])
    })

    it('200且JSON合法時回data; 物件body自動序列化並補Content-Type', async function() {
        let r1 = await call('tok-ok')
        let r2 = await fetchQuotaJson(svr.usageUrlClaude, { method: 'POST', headers: { Authorization: 'Bearer tok-echo' }, body: { a: 1 } })
        let rr = [r1.ok, r1.status, typeof r1.data.limits, r2.ok, r2.data.headers['content-type'], r2.data.headers['content-length']]
        assert.strict.deepEqual(rr, [true, 200, 'object', true, 'application/json', '7'])
    })

    it('狀態碼分類: 401→auth, 403→forbidden, 429→ratelimit, 500→http; 錯誤訊息含本文片段', async function() {
        let r1 = await call('tok-401')
        let r2 = await call('tok-403-org')
        let r3 = await call('tok-429')
        let r4 = await call('tok-500')
        let rr = [
            [r1.ok, r1.status, r1.errorType, r1.error.indexOf('unauthorized(401)') === 0],
            [r2.ok, r2.status, r2.errorType, /oauth_not_allowed_for_organization/.test(r2.error)],
            [r3.ok, r3.status, r3.errorType],
            [r4.ok, r4.status, r4.errorType],
        ]
        assert.strict.deepEqual(rr, [[false, 401, 'auth', true], [false, 403, 'forbidden', true], [false, 429, 'ratelimit'], [false, 500, 'http']])
    })

    it('200但非JSON→parse; 本文超過maxBodyBytes→toolarge; 逾時→timeout; 連線拒絕→network', async function() {
        let r1 = await call('tok-notjson')
        let r2 = await call('tok-big', { maxBodyBytes: 1024 })
        let r3 = await call('tok-slow', { timeoutMs: 300 })
        let r4 = await fetchQuotaJson('http://127.0.0.1:9/nothing', { timeoutMs: 3000 })
        let rr = [
            [r1.ok, r1.status, r1.errorType],
            [r2.ok, r2.errorType, /too large/.test(r2.error)],
            [r3.ok, r3.status, r3.errorType],
            [r4.ok, r4.status, r4.errorType],
        ]
        assert.strict.deepEqual(rr, [[false, 200, 'parse'], [false, 'toolarge', true], [false, 0, 'timeout'], [false, 0, 'network']])
    })

    it('redact: 錯誤訊息中之機密值被遮蔽(長度不足6者不處理, 避免誤遮常見短字串)', async function() {
        //tok-echo會把標頭回顯, 模擬對端把權杖夾進錯誤頁的情境: 以403路徑令本文含權杖字樣
        let r = await fetchQuotaJson(svr.usageUrlClaude, { headers: { 'Authorization': 'Bearer tok-403-org', 'X-Secret': 'my-secret-value' }, redact: ['oauth_not_allowed_for_organization', 'org'] })
        let rr = [r.errorType, /\[REDACTED\]/.test(r.error), /oauth_not_allowed_for_organization/.test(r.error), /forbidden\(403\)/.test(r.error)]
        assert.strict.deepEqual(rr, ['forbidden', true, false, true])
    })

})
