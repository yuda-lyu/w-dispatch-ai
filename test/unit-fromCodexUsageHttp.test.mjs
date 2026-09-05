import assert from 'assert'
import fromCodexUsageHttp from '../src/quota/fromCodexUsageHttp.mjs'
import { FIXTURE_CODEX_USAGE } from './tools/fakeServerForQuotaTest.mjs'


describe('fromCodexUsageHttp', function() {

    it('對映主窗口、code review限額與additional_rate_limits(陣列形態), 標籤帶範圍', function() {
        let m = fromCodexUsageHttp(FIXTURE_CODEX_USAGE)
        let r = [
            m.email,
            m.plan,
            m.windows.map((w) => `${w.key}=${w.label}|${w.usedPercent}|${w.scope}`),
            m.credits.resetCreditsAvailable,
            m.credits.hasCredits,
        ]
        let rr = [
            'codex-user@example.com',
            'plus',
            [
                'primary=5小時|0|',
                'secondary=7天|31|',
                'code_review:primary=5小時(code review)|5|code review',
                'codex-spark:primary=5小時(GPT-5.3-Codex-Spark)|12|GPT-5.3-Codex-Spark',
            ],
            1,
            false,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('additional_rate_limits為物件形態(名稱為鍵)時亦可解析, 缺識別欄位者以鍵名為id', function() {
        let m = fromCodexUsageHttp({
            additional_rate_limits: {
                'gpt-reserve': { primary_window: { used_percent: 9, limit_window_seconds: 604800 } },
            },
        })
        let r = m.windows.map((w) => `${w.key}=${w.label}`)
        let rr = ['gpt-reserve:primary=7天(gpt-reserve)']
        assert.strict.deepEqual(r, rr)
    })

    it('單筆本身即窗口時: 名稱含weekly/reserve或長度≥6天判為secondary, 否則primary', function() {
        let m = fromCodexUsageHttp({
            additional_rate_limits: [
                { name: 'gpt-reserve', used_percent: 1, limit_window_seconds: 18000 },
                { name: 'spark', used_percent: 2, limit_window_seconds: 18000 },
                { name: 'longwin', used_percent: 3, limit_window_seconds: 6 * 86400 },
            ],
        })
        let r = m.windows.map((w) => w.key)
        let rr = ['gpt-reserve:secondary', 'spark:primary', 'longwin:secondary']
        assert.strict.deepEqual(r, rr)
    })

    it('窗口可置於rate_limit/rateLimit之下(snake或camel), 缺漏欄位之窗口略過不拋錯', function() {
        let m = fromCodexUsageHttp({
            additional_rate_limits: [
                { limit_name: 'a', rateLimit: { primaryWindow: { used_percent: 4, limit_window_seconds: 18000 } } },
                { limit_name: 'b' }, //無任何窗口 → 不列入
                'garbage', //非物件 → 略過
            ],
        })
        let r = m.windows.map((w) => w.key)
        let rr = ['a:primary']
        assert.strict.deepEqual(r, rr)
    })

    it('空物件或缺欄位時回傳空值結構不拋錯', function() {
        let m = fromCodexUsageHttp({})
        let r = [m.email, m.plan, m.windows, m.credits.hasCredits, m.credits.resetCreditsAvailable]
        let rr = ['', '', [], false, null]
        assert.strict.deepEqual(r, rr)
    })

})
