import assert from 'assert'
import { coolEntry, coolingOf, coolCfgOf, DEFAULT_COOLDOWN_MAX_MS } from '../src/cooling.mjs'
import { capByHints, readAttemptHints } from '../src/attemptDeadline.mjs'
import { resolveSubQuotaGate } from '../src/subQuotaGate.mjs'
import { resolveQuotaGate } from '../src/goQuotaGate.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-msParamsG17.test.mjs — 其餘毫秒設定之判定(2026-11-13 da-hy, 排程第438項之「同類毫秒參數」; 帳本R-TIMEOUT-1、主控G17)
//
// 規格: opt之毫秒數以ise*判定「可計算」(1～MAX_SAFE_INTEGER之整數或其十進位數字字串; 見castPintOr), 非預期(含Infinity、'0x10'、小數、包裝物件)視為未給、改用預設,
// 不以ispint通過後cint(舊判定: Infinity→1.797e308、'0x10'→16)。本檔涵蓋: ①冷卻設定(cooldownMs、cooldownMaxMs); ②遞補層之minAttemptMs;
// ③期限提示(attemptHints.minAttemptMs／entryTimeoutMs)與其封頂之逾時須為整數(小數交execCli會被其判為無效而改用120000); ④額度閘「讀者逾時」(timeoutMs、antigravityTimeoutMs)與讀者同判定、
// 快取間隔(cacheMs)仍允許小數。castPintOr本身之輸入表見unit-castPintOr。


describe('冷卻設定(cooldownMs／cooldownMaxMs)之判定', function() {

    it('coolCfgOf: Infinity、\'Infinity\'、\'0x10\'、小數、0、負數之cooldownMs視為未給(0=未啟用); cooldownMaxMs無效者取預設24小時; 有效者原值(數字字串轉數字)', function() {
        let bad = [Infinity, 'Infinity', '0x10', 1.5, 0, -1, null, undefined, {}]
        let r1 = bad.map((v) => coolCfgOf({ cooldownMs: v }).cooldownMs)
        let r2 = bad.map((v) => coolCfgOf({ cooldownMs: 1000, cooldownMaxMs: v }).maxMs)
        assert.strict.deepEqual(r1, bad.map(() => 0))
        assert.strict.deepEqual(r2, bad.map(() => DEFAULT_COOLDOWN_MAX_MS))
        let ok = coolCfgOf({ cooldownMs: '1500', cooldownMaxMs: ' 9000 ' })
        assert.strict.deepEqual([ok.cooldownMs, ok.maxMs], [1500, 9000])
    })

    it('coolEntry: cooldownMs為Infinity／\'0x10\'時拋錯(非正整數); coolingOf: 無效cooldownMs回原紀錄不計視窗', function() {
        for (let v of [Infinity, '0x10', 1.5, 0]) {
            assert.strict.throws(() => coolEntry({}, 'x', { cooldownMs: v }), /invalid opt\.cooldownMs/)
        }
        let state = {}
        coolEntry(state, 'x', { cooldownMs: 1000, now: 5000 })
        let a = coolingOf(state, 'x', { cooldownMs: Infinity, now: 5100 })
        let b = coolingOf(state, 'x', { cooldownMs: 1000, now: 5100 })
        assert.strict.deepEqual([Object.keys(a).sort(), b.cooling], [['at', 'n', 'reason'], true])
    })

})


describe('期限提示與封頂之逾時', function() {

    it('readAttemptHints: minAttemptMs／entryTimeoutMs以可計算之正整數判定(Infinity、\'0x10\'、小數 → 預設20000／null)', function() {
        let h = (m, e) => readAttemptHints({ attemptHints: { deadlineAt: Date.now() + 100000, minAttemptMs: m, entryTimeoutMs: e } })
        let r = [h(Infinity, Infinity), h('0x10', '0x10'), h(1.5, 1.5), h(3000, 4000), h('3000', '4000')].map((x) => [x.minAttemptMs, x.entryTimeoutMs])
        assert.strict.deepEqual(r, [[20000, null], [20000, null], [20000, null], [3000, 4000], [3000, 4000]])
    })

    it('capByHints: 封頂後之逾時恆為整數(deadlineAt可為小數; 小數之timeoutMs交execCli會被其判為無效而改用120000), 至少1毫秒, 不超過原逾時', function() {
        //規格: execCli之timeoutMs須為整數(iseint timer); 呼叫端自給之deadlineAt可為小數(isenum), 剩餘毫秒須向下取整
        let h = { deadlineAt: Date.now() + 100000.5, minAttemptMs: 1, entryTimeoutMs: null }
        let a = capByHints(300000, h)
        let b = capByHints(300000, { ...h, deadlineAt: Date.now() - 5.5 })
        let c = capByHints(500, h)
        assert.strict.deepEqual([Number.isInteger(a), a >= 99000 && a <= 100000, b, c], [true, true, 1, 500])
        assert.strict.deepEqual(capByHints(1234, null), 1234)
    })

})


describe('額度閘「讀者逾時」與讀者同判定(整數, 1～2147483647), 快取間隔仍允許小數', function() {

    it('resolveSubQuotaGate: timeoutMs／antigravityTimeoutMs為小數、超過上限、Infinity、\'0x10\'者取預設(claude／codex 15000、antigravity 60000), 整數與其數字字串原值; cacheMs允許小數', function() {
        let r = (raw, kind) => resolveSubQuotaGate(raw, { kind }, 0, 'e', true)
        let bad = [5000.5, 2147483648, Infinity, '0x10', 0, -1]
        let c = bad.map((v) => r({ timeoutMs: v }, 'claude').timeoutMs)
        let a = bad.map((v) => r({ antigravityTimeoutMs: v }, 'antigravity').timeoutMs)
        assert.strict.deepEqual(c, bad.map(() => 15000))
        assert.strict.deepEqual(a, bad.map(() => 60000))
        assert.strict.deepEqual([r({ timeoutMs: '7000' }, 'codex').timeoutMs, r({ antigravityTimeoutMs: 9000 }, 'antigravity').timeoutMs, r({ timeoutMs: 2147483647 }, 'claude').timeoutMs], [7000, 9000, 2147483647])
        assert.strict.deepEqual(r({ cacheMs: 1234.5 }, 'claude').cacheMs, 1234.5)
    })

    it('resolveQuotaGate(Go): timeoutMs同判定(預設5000); cacheMs允許小數', function() {
        let bad = [5000.5, 2147483648, Infinity, '0x10', 0, -1]
        assert.strict.deepEqual(bad.map((v) => resolveQuotaGate({ timeoutMs: v }).timeoutMs), bad.map(() => 5000))
        assert.strict.deepEqual([resolveQuotaGate({ timeoutMs: 4000 }).timeoutMs, resolveQuotaGate({ timeoutMs: '4000' }).timeoutMs, resolveQuotaGate({ cacheMs: 1.5 }).cacheMs], [4000, 4000, 1.5])
    })

})


describe('遞補層之minAttemptMs與逾時逐層回退', function() {

    let fake = null
    before(function() {
        fake = createFakeCli('fake-g17')
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('minAttemptMs為Infinity／\'0x10\'時視為未給(預設20000): budgetMs 60000之遞補照常送出而成功(舊判定得1.797e308而回budget exhausted); 有效值過大者仍回budget exhausted(對照)', async function() {
        let run = (minAttemptMs) => dispatchAiFallback('abc', {
            providers: [{ id: 'agy:echo', kind: 'antigravity', exe: fake.exe, skipPermissions: false, addDirs: [] }],
            budgetMs: 60000,
            minAttemptMs,
            quotaGate: false,
            maxRetries: 0,
        })
        let r = []
        for (let v of [Infinity, '0x10', 20000]) {
            let t = await run(v)
            r.push([String(v), t.ok])
        }
        let t2 = await run(100000) //有效且大於預算 → 不送出(對照: 有效值仍被採用)
        r.push(['100000', t2.ok, t2.errorType])
        assert.strict.deepEqual(r, [['Infinity', true], ['0x10', true], ['20000', true], ['100000', false, 'budget']])
    })

})
