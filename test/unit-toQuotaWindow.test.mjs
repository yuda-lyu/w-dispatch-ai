import assert from 'assert'
import toQuotaWindow from '../src/quota/toQuotaWindow.mjs'


describe('toQuotaWindow', function() {

    it('正規化基本欄位: label由windowSeconds推導, remainingPercent由usedPercent推得', function() {
        let w = toQuotaWindow({ key: 'five_hour', windowSeconds: 18000, usedPercent: 11 })
        let r = [w.key, w.label, w.windowSeconds, w.usedPercent, w.remainingPercent, w.scope, w.active, w.severity]
        let rr = ['five_hour', '5小時', 18000, 11, 89, '', false, 'normal']
        assert.strict.deepEqual(r, rr)
    })

    it('usedPercent夾至0~100且未知時remainingPercent同為null(不假造100)', function() {
        let w1 = toQuotaWindow({ usedPercent: 150 })
        let w2 = toQuotaWindow({ usedPercent: -3 })
        let w3 = toQuotaWindow({})
        let r = [[w1.usedPercent, w1.remainingPercent], [w2.usedPercent, w2.remainingPercent], [w3.usedPercent, w3.remainingPercent]]
        let rr = [[100, 0], [0, 100], [null, null]]
        assert.strict.deepEqual(r, rr)
    })

    it('resetAt接受ISO字串或unix秒數, 一律轉ISO字串並補算resetAfterSeconds', function() {
        let future = Math.floor(Date.now() / 1000) + 3600
        let w1 = toQuotaWindow({ resetAt: future })
        let w2 = toQuotaWindow({ resetAt: '2099-01-01T00:00:00.000Z' })
        let w3 = toQuotaWindow({ resetAt: 'not-a-date' })
        let r = [
            w1.resetAt === new Date(future * 1000).toISOString(),
            w1.resetAfterSeconds >= 3598 && w1.resetAfterSeconds <= 3600,
            w2.resetAt,
            w2.resetAfterSeconds > 0,
            w3.resetAt,
            w3.resetAfterSeconds,
        ]
        let rr = [true, true, '2099-01-01T00:00:00.000Z', true, '', null]
        assert.strict.deepEqual(r, rr)
    })

    it('只給resetAfterSeconds時反推resetAt; 已過期之resetAt其resetAfterSeconds夾為0', function() {
        let w1 = toQuotaWindow({ resetAfterSeconds: 120 })
        let w2 = toQuotaWindow({ resetAt: '2000-01-01T00:00:00.000Z' })
        let dt = Math.round((new Date(w1.resetAt).getTime() - Date.now()) / 1000)
        let r = [dt >= 118 && dt <= 120, w1.resetAfterSeconds, w2.resetAfterSeconds]
        let rr = [true, 120, 0]
        assert.strict.deepEqual(r, rr)
    })

    it('severity: 供應商有給即用之; 未給則由usedPercent推導(用罄exhausted/其餘normal/未知空字串)——三家對稱', function() {
        let r = [
            toQuotaWindow({ usedPercent: 50, severity: 'warning' }).severity,
            toQuotaWindow({ usedPercent: 50 }).severity,
            toQuotaWindow({ usedPercent: 100 }).severity,
            toQuotaWindow({}).severity,
        ]
        let rr = ['warning', 'normal', 'exhausted', '']
        assert.strict.deepEqual(r, rr)
    })

    it('明給label優先於推導; scope與active原樣保留', function() {
        let w = toQuotaWindow({ windowSeconds: 604800, label: '7天(Fable)', scope: 'Fable', active: true })
        let r = [w.label, w.scope, w.active]
        let rr = ['7天(Fable)', 'Fable', true]
        assert.strict.deepEqual(r, rr)
    })

    it('回傳鍵名固定', function() {
        let r = Object.keys(toQuotaWindow({}))
        let rr = ['key', 'label', 'windowSeconds', 'usedPercent', 'remainingPercent', 'resetAt', 'resetAfterSeconds', 'scope', 'active', 'severity']
        assert.strict.deepEqual(r, rr)
    })

})
