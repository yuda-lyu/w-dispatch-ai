import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import createUsageCounter from '../src/wkf/createUsageCounter.mjs'


//產物落test/tmp/(同fakeCliForTest慣例), 測試結束清除
let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp', 'usage-counter')


describe('createUsageCounter', function() {

    before(function() {
        fs.mkdirSync(FD, { recursive: true })
    })

    after(function() {
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch (e) {}
    })

    it('file與dir皆缺時throw(組裝期設定錯誤fail fast)', function() {
        assert.throws(() => createUsageCounter(), { message: 'createUsageCounter: file or dir is required' })
    })

    it('onEvent只於try事件記帳, 依keyOf(預設keyId)分鍵累加', function() {
        let usage = createUsageCounter({ dir: FD, name: 'u1.json', getDate: () => '2026-08-18' })
        usage.onEvent({ type: 'try', providerId: 'agnes:agnes-2.5-flash', keyIndex: 0, keyId: 'agnes:agnes-2.5-flash#0' })
        usage.onEvent({ type: 'try', providerId: 'agnes:agnes-2.5-flash', keyIndex: 0, keyId: 'agnes:agnes-2.5-flash#0' })
        usage.onEvent({ type: 'try', providerId: 'claude:sonnet', keyIndex: null, keyId: 'claude:sonnet' })
        usage.onEvent({ type: 'ok', providerId: 'claude:sonnet', keyIndex: null, keyId: 'claude:sonnet' }) //非try不記
        usage.onEvent({ type: 'next-key', providerId: 'x', keyId: 'x#0' }) //非try不記
        let r = usage.today()
        let rr = { today: '2026-08-18', byKey: { 'agnes:agnes-2.5-flash#0': 2, 'claude:sonnet': 1 }, total: 3 }
        assert.strict.deepEqual(r, rr)
    })

    it('keyOf可改計帳粒度(記到條目), bump可手動累加', function() {
        let usage = createUsageCounter({ dir: FD, name: 'u2.json', getDate: () => '2026-08-18', keyOf: (ev) => ev.providerId })
        usage.onEvent({ type: 'try', providerId: 'agnes:agnes-2.5-flash', keyId: 'agnes:agnes-2.5-flash#0' })
        usage.onEvent({ type: 'try', providerId: 'agnes:agnes-2.5-flash', keyId: 'agnes:agnes-2.5-flash#1' }) //不同金鑰同條目
        usage.bump('manual-key', 5)
        let r = usage.today()
        let rr = { today: '2026-08-18', byKey: { 'agnes:agnes-2.5-flash': 2, 'manual-key': 5 }, total: 7 }
        assert.strict.deepEqual(r, rr)
    })

    it('逐日分桶且只保留最近keepDays天', function() {
        let day = '2026-08-01'
        let usage = createUsageCounter({ dir: FD, name: 'u3.json', getDate: () => day, keepDays: 2 })
        usage.bump('k')
        day = '2026-08-02'
        usage.bump('k')
        day = '2026-08-03'
        usage.bump('k')
        let onDisk = JSON.parse(fs.readFileSync(usage.file, 'utf8'))
        let r = [Object.keys(onDisk).sort(), usage.today()]
        let rr = [['2026-08-02', '2026-08-03'], { today: '2026-08-03', byKey: { k: 1 }, total: 1 }] //08-01已被修剪
        assert.strict.deepEqual(r, rr)
    })

    it('跨計數器實例讀同一檔(模擬下一次行程)', function() {
        let usage1 = createUsageCounter({ dir: FD, name: 'u4.json', getDate: () => '2026-08-18' })
        usage1.bump('k1')
        let usage2 = createUsageCounter({ dir: FD, name: 'u4.json', getDate: () => '2026-08-18' })
        usage2.bump('k1')
        let r = usage2.today()
        let rr = { today: '2026-08-18', byKey: { k1: 2 }, total: 2 }
        assert.strict.deepEqual(r, rr)
    })

})
