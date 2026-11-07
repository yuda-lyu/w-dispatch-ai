import assert from 'assert'
import claudeLimitUntilOf from '../src/claudeLimitUntil.mjs'
import { judgeWindowItems, cachedQuery } from '../src/quotaJudge.mjs'
import { ledgerFind, ledgerPut, toMs, clampUntilMs, UNTIL_CAP_MS } from '../src/quotaLedger.mjs'
import { resolveSubQuotaGate, agyGroupOf, itemsOf, toSnapshot, learnQuotaFromFailure, subGateDecide } from '../src/subQuotaGate.mjs'
import { judgeGoUsage, createQuotaGateState, stateOf } from '../src/goQuotaGate.mjs'
import { createAiEventLogger, resetLedgerNotice } from '../src/wkf/logAiOutcome.mjs'


// 規格來源: Gitea semi/opensrcOper#93 與主控派工單ke340(見unit-quotaGateSubscription.test.mjs檔頭); 本檔測純函數與內部件(不連網、不跑子行程)。
//   帳本R-SPAWNGATE-6。


let T = Date.UTC(2026, 10, 6, 4, 0, 0) //2026-11-06 12:00(Asia/Taipei)
let D = 86400000
let H = 3600000
let iso = (ms) => new Date(ms).toISOString()
let win = (label, usedPercent, resetAt, scope = '') => ({ label, scope, usedPercent, resetAt })
let EXE = { claude: 'claude', codex: 'codex', antigravity: 'agy' }


describe('claudeLimitUntilOf: Claude Code官方額度訊息之重置時刻', function() {

    let TEXT = 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)'

    it('實見字樣: 2026-11-06為現在 → 2026-11-09T17:00+08:00(=09:00Z)', function() {
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, T), '2026-11-09T09:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, new Date(T)), '2026-11-09T09:00:00.000Z') //now可為Date
    })

    it('變體: 分鐘(5:30pm)、12am／12pm、大小寫、前後夾其他文字、換行多段、完整月名', function() {
        assert.strict.deepEqual(claudeLimitUntilOf('You\'ve hit your weekly limit · resets Nov 9, 5:30pm (Asia/Taipei)', T), '2026-11-09T09:30:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('hit your session limit · resets Nov 7, 12am (Asia/Taipei)', T), '2026-11-06T16:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('hit your session limit · resets Nov 7, 12pm (Asia/Taipei)', T), '2026-11-07T04:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('xx\nYOU\'VE HIT YOUR WEEKLY LIMIT · RESETS NOV 9, 5PM (Asia/Taipei)\nyy', T), '2026-11-09T09:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('You\'ve hit your Opus limit · resets November 9, 5pm (Asia/Taipei)', T), '2026-11-09T09:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('You\'ve hit your weekly limit ∙ resets Nov 9, 5pm (Asia/Taipei)', T), '2026-11-09T09:00:00.000Z') //U+2219分隔符
    })

    it('時區依括號內IANA名(含夏令): America/New_York在11月為EST(UTC-5)、7月為EDT(UTC-4)', function() {
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Nov 9, 5pm (America/New_York)', T), '2026-11-09T22:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Jul 9, 5pm (America/New_York)', Date.UTC(2026, 6, 6)), '2026-07-09T21:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Nov 9, 5pm (UTC)', T), '2026-11-09T17:00:00.000Z')
    })

    it('夏令間隙內不存在之本地時刻回null(2027-03-14 2:30am America/New_York不存在), 存在者(3am)正常', function() {
        let now = Date.UTC(2027, 2, 10)
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Mar 14, 2:30am (America/New_York)', now), null)
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Mar 14, 3am (America/New_York)', now), '2027-03-14T07:00:00.000Z')
    })

    it('跨年: 12月30日讀到「Jan 2, 3am」取次年(未來最近者); 一般情形取本年', function() {
        let now = Date.UTC(2026, 11, 30, 4, 0, 0)
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Jan 2, 3am (Asia/Taipei)', now), '2027-01-01T19:00:00.000Z')
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, T), '2026-11-09T09:00:00.000Z')
    })

    it('上限截斷: 逾現在+8天者截斷為現在+8天(capMs可調); 恰8天內不截斷', function() {
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Nov 20, 5pm (Asia/Taipei)', T), iso(T + 8 * D))
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, T, { capMs: 2 * D }), iso(T + 2 * D))
        assert.strict.deepEqual(claudeLimitUntilOf('hit your weekly limit · resets Nov 14, 12pm (Asia/Taipei)', T), '2026-11-14T04:00:00.000Z') //T+8天整
    })

    it('不猜: 無時區、無resets、無日期、無月份、無分隔符、時區名無效、時分越界、不存在之日期 → null', function() {
        for (let bad of [
            'You\'ve hit your weekly limit · resets Nov 9, 5pm',
            'You\'ve hit your weekly limit',
            'You\'ve hit your weekly limit · resets 5pm (Asia/Taipei)',
            'You\'ve hit your weekly limit · resets soon (Asia/Taipei)',
            'You\'ve hit your weekly limit resets Nov 9, 5pm (Asia/Taipei)',
            'You\'ve hit your weekly limit · resets Nov 9, 5pm (Not/AZone)',
            'You\'ve hit your weekly limit · resets Nov 9, 13pm (Asia/Taipei)',
            'You\'ve hit your weekly limit · resets Nov 9, 0am (Asia/Taipei)',
            'You\'ve hit your weekly limit · resets Nov 9, 5:61pm (Asia/Taipei)',
            'You\'ve hit your weekly limit · resets Feb 30, 5pm (Asia/Taipei)',
            'You\'ve hit your weekly limit · resets Xyz 9, 5pm (Asia/Taipei)',
            'Usage limit reached. Your limit will reset at 5pm (Asia/Taipei)',
            '',
            null,
            undefined,
            42,
            {},
        ]) {
            assert.strict.deepEqual(claudeLimitUntilOf(bad, T), null, String(bad))
        }
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, NaN), null)
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, 'x'), null)
    })

    it('過時文字: 所載時刻落在剛過去(約兩天內)回null(不往次年推); 更久者推次年再截斷於8天', function() {
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, Date.UTC(2026, 10, 10, 4, 0, 0)), null) //11/9 17:00(+08)已過約19小時
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, Date.UTC(2026, 10, 11, 4, 0, 0)), null) //已過約43小時
        assert.strict.deepEqual(claudeLimitUntilOf(TEXT, Date.UTC(2026, 10, 12, 4, 0, 0)), iso(Date.UTC(2026, 10, 12, 4, 0, 0) + 8 * D)) //已過約67小時: 取次年, 再截斷於8天
    })
})


describe('judgeWindowItems: 視窗判定(Go與訂閱類共用)', function() {

    let it1 = (percent, max = 95, extra = {}) => ({ name: 'w', percent, max, limited: false, resetsAt: iso(T + D), ...extra })

    it('達門檻(≥)才擋、未達不擋; 回報被擋視窗name／percent／resetsAt／limited與until(最晚者)', function() {
        assert.strict.deepEqual(judgeWindowItems([it1(94.99)]).blocked, false)
        let j = judgeWindowItems([{ name: 'a', percent: 96, max: 95, limited: false, resetsAt: iso(T + H) }, { name: 'b', percent: 10, max: 95, limited: false, resetsAt: iso(T + 9 * D) }, { name: 'c', percent: 95, max: 95, limited: false, resetsAt: iso(T + 2 * D) }])
        assert.strict.deepEqual(j, { blocked: true, windows: [{ name: 'a', percent: 96, resetsAt: iso(T + H), limited: false }, { name: 'c', percent: 95, resetsAt: iso(T + 2 * D), limited: false }], until: iso(T + 2 * D) })
    })

    it('percent缺漏或非數字不擋(null、undefined、NaN、Infinity、布林、文字、物件); 數字字串轉換後判定; max為null不判', function() {
        for (let bad of [null, undefined, NaN, Infinity, -Infinity, true, false, 'abc', '', {}, [], '0x60']) {
            assert.strict.deepEqual(judgeWindowItems([it1(bad)]).blocked, false, String(bad))
        }
        assert.strict.deepEqual(judgeWindowItems([it1(' 96 ')]).windows[0].percent, 96)
        assert.strict.deepEqual(judgeWindowItems([it1(100, null)]).blocked, false)
        assert.strict.deepEqual(judgeWindowItems([]), { blocked: false, windows: [], until: null })
    })

    it('limited為true即擋(percent缺漏則percent為null); 缺resetsAt或無法解析 → until null、仍blocked', function() {
        let j = judgeWindowItems([it1(null, 95, { limited: true })])
        assert.strict.deepEqual([j.blocked, j.windows[0].percent, j.windows[0].limited], [true, null, true])
        for (let rs of [undefined, null, '', 'not a date', 5]) {
            let r = judgeWindowItems([it1(99, 95, { resetsAt: rs })])
            assert.strict.deepEqual([r.blocked, r.until, r.windows[0].resetsAt === null || typeof r.windows[0].resetsAt === 'string'], [true, null, true], String(rs))
        }
        //任一被擋視窗缺resetsAt即整體null
        assert.strict.deepEqual(judgeWindowItems([it1(99), it1(99, 95, { resetsAt: null })]).until, null)
    })

    it('Go與訂閱類對同一組視窗得同一判定(共用判定件): judgeGoUsage與itemsOf→judgeWindowItems', function() {
        let A = iso(T + H)
        let B = iso(T + 3 * D)
        let goUsage = { ok: true, usage: { rolling: { status: 'ok', percent: 96, resetsAt: A }, weekly: { status: 'ok', percent: 50, resetsAt: iso(T + 2 * D) }, monthly: { status: 'ok', percent: 97, resetsAt: B } } }
        let go = judgeGoUsage(goUsage, { rolling: 95, weekly: 95, monthly: 95 })
        let sq = resolveSubQuotaGate(true, { kind: 'claude' }, 0, 'c', true)
        let sub = judgeWindowItems(itemsOf(sq, [win('rolling', 96, A), win('weekly', 50, iso(T + 2 * D)), win('monthly', 97, B)]))
        assert.strict.deepEqual([sub.blocked, sub.windows, sub.until], [go.blocked, go.windows, go.until])
        assert.strict.deepEqual(go.until, B)
    })
})


describe('cachedQuery: 快取與並行共用(Go與訂閱類共用)', function() {

    let mk = (cacheMs = 1000) => {
        let clock = { t: 0 }
        return { st: createQuotaGateState(), cfg: { now: () => clock.t, cacheMs }, clock, calls: [] }
    }

    it('cacheMs內不重查(cached true)、到期重查、回撥視為過期、失敗結果亦快取', async function() {
        let m = mk(1000)
        let produce = async () => {
            m.calls.push(m.clock.t)
            return { v: m.calls.length }
        }
        let a = await cachedQuery(m.st, 'k', m.cfg, produce)
        m.clock.t = 999
        let b = await cachedQuery(m.st, 'k', m.cfg, produce)
        m.clock.t = 1000
        let c = await cachedQuery(m.st, 'k', m.cfg, produce)
        m.clock.t = 500 //回撥: 與上次查詢時刻(1000)差為負 → 過期
        let d = await cachedQuery(m.st, 'k', m.cfg, produce)
        assert.strict.deepEqual([a, b, c, d], [{ v: 1, cached: false }, { v: 1, cached: true }, { v: 2, cached: false }, { v: 3, cached: false }])
    })

    it('並行共用進行中之查詢; 不同鍵各自查', async function() {
        let m = mk()
        let produce = () => new Promise((resolve) => setTimeout(() => resolve({ n: m.calls.push(1) }), 20))
        let [x, y, z] = await Promise.all([cachedQuery(m.st, 'k', m.cfg, produce), cachedQuery(m.st, 'k', m.cfg, produce), cachedQuery(m.st, 'k2', m.cfg, produce)])
        assert.strict.deepEqual([x.cached, y.cached, z.cached, m.calls.length], [false, true, false, 2])
    })

    it('stateOf: 設定給了state即用之, 否則為模組層共用狀態', function() {
        let st = createQuotaGateState()
        assert.strict.deepEqual(stateOf({ state: st }) === st, true)
        let m1 = stateOf({ state: null })
        let m2 = stateOf({ state: null })
        assert.strict.deepEqual([m1 === m2, m1 === st], [true, false])
    })
})


describe('resolveSubQuotaGate: 適用範圍與選項', function() {

    let r = (raw, opt, nk = 0, id = 'e', idExplicit = true) => resolveSubQuotaGate(raw, opt, nk, id, idExplicit)

    it('四種kind: claude(無金鑰)／codex／antigravity回設定, opencode／api-*／未知kind／無kind回null', function() {
        assert.strict.deepEqual([r(undefined, { kind: 'claude' }).family, r(undefined, { kind: 'codex' }).family, r(undefined, { kind: 'antigravity' }).family], ['claude', 'codex', 'antigravity'])
        for (let kind of ['opencode', 'api-anthropic', 'api-openai-compat', 'api-openai-responses', 'api-typesafe-systemone', 'x', undefined, null]) {
            assert.strict.deepEqual(r(true, { kind }), null, String(kind))
        }
    })

    it('帶金鑰者不適用: nk>0、opt.key、env.ANTHROPIC_API_KEY有效字串(codex／antigravity之nk>0亦不適用); 空字串env鍵不算', function() {
        assert.strict.deepEqual(r(true, { kind: 'claude' }, 1), null)
        assert.strict.deepEqual(r(true, { kind: 'claude', key: 'sk-ant-api03-xxxxxxxxxxxxxxxx' }), null)
        assert.strict.deepEqual(r(true, { kind: 'claude', env: { ANTHROPIC_API_KEY: 'sk-ant-api03-xxxxxxxxxxxxxxxx' } }), null)
        assert.strict.deepEqual(r(true, { kind: 'codex' }, 2), null)
        assert.strict.deepEqual(r(true, { kind: 'antigravity' }, 1), null)
        assert.strict.deepEqual(r(true, { kind: 'claude', env: { ANTHROPIC_API_KEY: '' } }).family, 'claude')
    })

    it('false關閉; true／物件為明給; undefined／null／非物件(5、字串、陣列)視為未給(K3)', function() {
        assert.strict.deepEqual(r(false, { kind: 'claude' }), null)
        for (let raw of [true, {}, { claudeMax: 80 }, undefined, null, 5, 'x', [], () => {}]) {
            assert.strict.deepEqual(r(raw, { kind: 'claude' }).family, 'claude', String(raw))
        }
    })

    it('預設(未明給)只作用於真的該CLI: exe未給、claude／codex／agy(含目錄與副檔名、不分大小寫)作用; 其他名稱不作用; 明給則一律作用', function() {
        for (let kind of ['claude', 'codex', 'antigravity']) {
            let base = EXE[kind]
            assert.strict.deepEqual(r(undefined, { kind }).family, kind)
            for (let exe of [base, `${base}.cmd`, `${base}.exe`, `C:\\tools\\${base.toUpperCase()}.EXE`, `/usr/local/bin/${base}`]) {
                assert.strict.deepEqual(r(undefined, { kind, exe }).family, kind, exe)
            }
            for (let exe of ['fake-cli.cmd', `${base}-wrapper`, 'node', 'C:\\x\\run.bat']) {
                assert.strict.deepEqual(r(undefined, { kind, exe }), null, exe)
                assert.strict.deepEqual(r(true, { kind, exe }).family, kind, exe)
                assert.strict.deepEqual(r({}, { kind, exe }).family, kind, exe)
            }
        }
    })

    it('門檻: 預設各95; claudeMax／codexMax／antigravityMax可調(0~100之數字、數字字串), false關閉該家, 非預期之值(0、101、負、NaN、文字)取預設95', function() {
        let max = (raw, kind = 'claude') => r(raw, { kind }).max
        assert.strict.deepEqual([max({}), max({ claudeMax: 80 }), max({ claudeMax: ' 80 ' }), max({ claudeMax: false })], [95, 80, 80, null])
        for (let bad of [0, 101, -1, NaN, 'abc', null, {}, true]) {
            assert.strict.deepEqual(max({ claudeMax: bad }), 95, String(bad))
        }
        assert.strict.deepEqual([max({ codexMax: 70 }, 'codex'), max({ claudeMax: 70 }, 'codex'), max({ antigravityMax: 60 }, 'antigravity'), max({ codexMax: 60 }, 'antigravity')], [70, 95, 60, 95])
    })

    it('windowMax: label → 數字或false; 非預期之值略過; 不可讀之物件視為未給', function() {
        let sq = r({ windowMax: { '5小時': false, '7天': '90', 'bad': 0, 'bad2': 'x', 'bad3': null } }, { kind: 'claude' })
        assert.strict.deepEqual(sq.windowMax, { '5小時': null, '7天': 90 })
        assert.strict.deepEqual(r({ windowMax: 5 }, { kind: 'claude' }).windowMax, {})
        let hostile = new Proxy({}, {
            ownKeys() {
                throw new Error('x')
            }
        })
        assert.strict.deepEqual(r({ windowMax: hostile }, { kind: 'claude' }).windowMax, {})
    })

    it('快取與逾時預設: claude／codex 60000／15000、antigravity 300000／60000; 各鍵可覆寫; 非正數值取預設', function() {
        let c = r({}, { kind: 'claude' })
        let a = r({}, { kind: 'antigravity' })
        assert.strict.deepEqual([c.cacheMs, c.timeoutMs, a.cacheMs, a.timeoutMs], [60000, 15000, 300000, 60000])
        let c2 = r({ cacheMs: 1234, timeoutMs: 4321, antigravityCacheMs: 11, antigravityTimeoutMs: 22 }, { kind: 'codex' })
        let a2 = r({ cacheMs: 1234, timeoutMs: 4321, antigravityCacheMs: 11, antigravityTimeoutMs: 22 }, { kind: 'antigravity' })
        assert.strict.deepEqual([c2.cacheMs, c2.timeoutMs, a2.cacheMs, a2.timeoutMs], [1234, 4321, 11, 22])
        let c3 = r({ cacheMs: 0, timeoutMs: -5, antigravityCacheMs: 'x' }, { kind: 'claude' })
        assert.strict.deepEqual([c3.cacheMs, c3.timeoutMs], [60000, 15000])
    })

    it('讀者: 預設為三家既有讀者之包裝; 注入者(readers.<family>為函數)優先, 非函數者忽略', function() {
        let f = () => ({})
        assert.strict.deepEqual(r({ readers: { claude: f } }, { kind: 'claude' }).reader === f, true)
        assert.strict.deepEqual(r({ readers: { claude: f } }, { kind: 'codex' }).reader === f, false)
        assert.strict.deepEqual(typeof r({ readers: { claude: 'x' } }, { kind: 'claude' }).reader, 'function')
        assert.strict.deepEqual(r({ readers: { claude: 'x' } }, { kind: 'claude' }).reader === f, false)
    })

    it('讀者選項: claude帶profileFallback:false; codex／agy僅在exe為真的CLI時帶exe; timeoutMs依家族', function() {
        assert.strict.deepEqual(r({}, { kind: 'claude' }).readerOpt, { timeoutMs: 15000, profileFallback: false })
        assert.strict.deepEqual(r({}, { kind: 'codex', exe: 'C:\\bin\\codex.cmd' }).readerOpt, { timeoutMs: 15000, exe: 'C:\\bin\\codex.cmd' })
        assert.strict.deepEqual(r({}, { kind: 'codex', exe: 'wrapper.cmd' }).readerOpt, { timeoutMs: 15000 })
        assert.strict.deepEqual(r({}, { kind: 'antigravity' }).readerOpt, { timeoutMs: 60000 })
    })

    it('條目env: CLAUDE_CONFIG_DIR令讀者以該環境查且快取／帳鍵含雜湊; CODEX_HOME與本行程不同者codex不適用(相同則適用)', function() {
        let plain = r({}, { kind: 'claude' })
        let dir = r({}, { kind: 'claude', env: { CLAUDE_CONFIG_DIR: 'D:\\cfgA' } })
        let dir2 = r({}, { kind: 'claude', env: { CLAUDE_CONFIG_DIR: 'D:\\cfgB' } })
        assert.strict.deepEqual([plain.cacheKey, plain.familyKey], ['sub:claude', 'claude'])
        assert.strict.deepEqual([/^sub:claude@[0-9a-f]{8}$/.test(dir.cacheKey), /^claude@[0-9a-f]{8}$/.test(dir.familyKey), dir.cacheKey !== dir2.cacheKey, dir.readerOpt.env.CLAUDE_CONFIG_DIR], [true, true, true, 'D:\\cfgA'])
        assert.strict.deepEqual(JSON.stringify([dir.cacheKey, dir.familyKey]).includes('cfgA'), false) //路徑不入鍵
        assert.strict.deepEqual(r({}, { kind: 'codex', env: { CODEX_HOME: 'D:\\other-codex-home-xyz' } }), null)
        let same = process.env.CODEX_HOME
        if (typeof same === 'string' && same !== '') {
            assert.strict.deepEqual(r({}, { kind: 'codex', env: { CODEX_HOME: same } }).family, 'codex')
        }
        assert.strict.deepEqual(r({}, { kind: 'codex', env: { OTHER: 'x' } }).family, 'codex')
        //env不可讀: 視為未給
        let hostile = new Proxy({}, {
            ownKeys() {
                throw new Error('x')
            },
            get() {
                throw new Error('x')
            },
            getOwnPropertyDescriptor() {
                throw new Error('x')
            }
        })
        assert.strict.deepEqual(r({}, { kind: 'claude', env: hostile }).family, 'claude')
    })

    it('條目env為呼叫端物件: 本層只以屬性描述子讀資料屬性, 不執行getter、不展開整個env(env由轉接器物化讀一次, 不得多讀)', function() {
        let reads = 0
        let env = {
            get ANTHROPIC_BASE_URL() {
                reads++
                return 'https://example.invalid'
            },
            get ANTHROPIC_API_KEY() {
                reads++
                return 'sk-ant-api03-xxxxxxxxxxxxxxxx'
            },
            get CLAUDE_CONFIG_DIR() {
                reads++
                return 'D:\\x'
            },
            get CODEX_HOME() {
                reads++
                return 'D:\\y'
            },
        }
        assert.strict.deepEqual([r({}, { kind: 'claude', env }).family, r({}, { kind: 'codex', env }).family, r({}, { kind: 'antigravity', env }).family], ['claude', 'codex', 'antigravity'])
        assert.strict.deepEqual(reads, 0)
    })

    it('帳鍵: 家族(claude／codex／antigravity:<群組|*>)與entry:<id>(僅明給id者)', function() {
        assert.strict.deepEqual([r({}, { kind: 'claude' }).familyKey, r({}, { kind: 'codex' }).familyKey], ['claude', 'codex'])
        assert.strict.deepEqual([r({}, { kind: 'antigravity', model: 'gemini-3.8-flash-high' }).familyKey, r({}, { kind: 'antigravity', model: 'gemini-4-argon-high' }).familyKey, r({}, { kind: 'antigravity', model: 'x' }).familyKey, r({}, { kind: 'antigravity' }).familyKey], ['antigravity:Gemini Models', 'antigravity:Gemini 4 Argon', 'antigravity:*', 'antigravity:*'])
        assert.strict.deepEqual([r({}, { kind: 'claude' }, 0, 'claude:sonnet', true).entryKey, r({}, { kind: 'claude' }, 0, '0', false).entryKey], ['entry:claude:sonnet', null])
    })
})


describe('agyGroupOf／itemsOf: 群組對應與視窗挑選', function() {

    it('agyGroupOf: gemini-4-argon*→Gemini 4 Argon、gemini-*→Gemini Models、claude-*／gpt-oss-*→Claude and GPT models(忽略大小寫)、其餘與非字串→null', function() {
        let g = agyGroupOf
        assert.strict.deepEqual([g('gemini-4-argon-high'), g('Gemini-4-Argon'), g('gemini-3.8-flash-high'), g('gemini-3.1-pro'), g('claude-opus-5-5-high'), g('gpt-oss-120b'), g('GPT-OSS-20B')], ['Gemini 4 Argon', 'Gemini 4 Argon', 'Gemini Models', 'Gemini Models', 'Claude and GPT models', 'Claude and GPT models', 'Claude and GPT models'])
        for (let v of ['gpt-5', 'sonnet', '', 'x', null, undefined, 5, {}]) {
            assert.strict.deepEqual(g(v), null, String(v))
        }
    })

    it('itemsOf(antigravity): 對到群組只取該群組之視窗(scope優先, 無scope時看label); 對不到取全部; 對到但方案無該群組 → 空(不擋)', function() {
        let ws = [win('7天(Gemini Models)', 1, null, 'Gemini Models'), win('5小時(Claude and GPT models)', 2, null, 'Claude and GPT models'), win('7天(Gemini 4 Argon)', 3, null, 'Gemini 4 Argon'), win('7天(Claude and GPT models)', 4, null, '')]
        let sq = (model) => resolveSubQuotaGate(true, { kind: 'antigravity', model }, 0, 'a', true)
        assert.strict.deepEqual(itemsOf(sq('gemini-3.8-flash-high'), ws).map((x) => x.percent), [1])
        assert.strict.deepEqual(itemsOf(sq('gemini-4-argon-high'), ws).map((x) => x.percent), [3])
        assert.strict.deepEqual(itemsOf(sq('claude-opus-5-5-high'), ws).map((x) => x.percent), [2, 4])
        assert.strict.deepEqual(itemsOf(sq('zzz'), ws).map((x) => x.percent), [1, 2, 3, 4])
        assert.strict.deepEqual(itemsOf(sq(undefined), ws).map((x) => x.percent), [1, 2, 3, 4])
        assert.strict.deepEqual(itemsOf(sq('gemini-4-argon-high'), [ws[0]]), [])
    })

    it('itemsOf(claude／codex): scope為空一律計入; scope非空只在model含該scope(忽略大小寫與非英數)時計入; model未給則scope視窗不計; 逐視窗門檻(windowMax)套用', function() {
        let ws = [win('7天', 10, null), win('7天(Fable)', 20, null, 'Fable'), win('7天(Opus)', 30, null, 'Opus'), win('Codex-Spark', 40, null, 'GPT-5.3-Codex-Spark')]
        let pick = (opt, raw = {}) => itemsOf(resolveSubQuotaGate(raw, { kind: 'claude', ...opt }, 0, 'c', true), ws).map((x) => x.percent)
        assert.strict.deepEqual(pick({ model: 'sonnet' }), [10])
        assert.strict.deepEqual(pick({ model: 'fable' }), [10, 20])
        assert.strict.deepEqual(pick({ model: 'claude-opus-5-5' }), [10, 30])
        assert.strict.deepEqual(pick({}), [10])
        assert.strict.deepEqual(pick({ model: 'gpt-5.3-codex-spark' }), [10, 40])
        let its = itemsOf(resolveSubQuotaGate({ claudeMax: 90, windowMax: { '7天': 50, '7天(Fable)': false } }, { kind: 'claude', model: 'fable' }, 0, 'c', true), ws)
        assert.strict.deepEqual(its.map((x) => [x.name, x.max]), [['7天', 50], ['7天(Fable)', null]])
    })
})


describe('toSnapshot: 讀者回應正規化(永不拋錯; 不可用者ok false)', function() {

    it('成功: 取label(無label退key)、scope、usedPercent原值、resetAt(非字串為null); 略過非物件視窗', function() {
        let s = toSnapshot({ ok: true, windows: [{ label: 'A', scope: 'S', usedPercent: 5, resetAt: '2026-01-01T00:00:00.000Z' }, { key: 'k', usedPercent: 'x', resetAt: 5 }, null, 'x', 3] })
        assert.strict.deepEqual(s, { ok: true, errorType: '', windows: [{ label: 'A', scope: 'S', usedPercent: 5, resetAt: '2026-01-01T00:00:00.000Z' }, { label: 'k', scope: '', usedPercent: 'x', resetAt: null }] })
    })

    it('失敗: ok非true帶errorType(非字串退other)、windows非陣列為shape、null／字串／不可讀物件為other', function() {
        assert.strict.deepEqual(toSnapshot({ ok: false, errorType: 'auth', windows: [{ label: 'a', usedPercent: 100 }] }), { ok: false, windows: [], errorType: 'auth' })
        assert.strict.deepEqual(toSnapshot({ ok: false, errorType: 5 }).errorType, 'other')
        assert.strict.deepEqual(toSnapshot({ ok: true, windows: 'x' }), { ok: false, windows: [], errorType: 'shape' })
        assert.strict.deepEqual(toSnapshot({ ok: true }), { ok: false, windows: [], errorType: 'shape' })
        for (let bad of [null, undefined, 'x', 5, [], new Proxy({}, {
            get() {
                throw new Error('x')
            },
            getPrototypeOf() {
                throw new Error('x')
            }
        })]) {
            assert.strict.deepEqual(toSnapshot(bad).ok, false)
        }
    })
})


describe('quotaLedger: 額度帳讀寫', function() {

    let rec = (untilMs, extra = {}) => ({ until: iso(untilMs), at: iso(T), source: 'usage-api', ...extra })

    it('ledgerPut建立quota欄(可JSON序列化); quota型別不符者重置; 凍結之state回false不拋錯', function() {
        let st = { cursors: {}, cooling: {} }
        assert.strict.deepEqual(ledgerPut(st, 'claude', rec(T + D)), true)
        assert.strict.deepEqual(JSON.parse(JSON.stringify(st)).quota.claude.until, iso(T + D))
        let st2 = { quota: 'oops' }
        assert.strict.deepEqual([ledgerPut(st2, 'k', rec(T + D)), Object.keys(st2.quota)], [true, ['k']])
        assert.strict.deepEqual(ledgerPut(Object.freeze({}), 'k', rec(T + D)), false)
    })

    it('ledgerFind: 依鍵序取第一個有效帳; null／不存在之鍵略過; until恰等於now視為過期並清除(dirty)', function() {
        let st = { quota: { a: rec(T + H), b: rec(T + 2 * H) } }
        let f = ledgerFind(st, [null, 'zz', 'a', 'b'], T)
        assert.strict.deepEqual([f.hit.key, f.hit.until, f.hit.source, f.dirty], ['a', iso(T + H), 'usage-api', false])
        let g = ledgerFind(st, ['a', 'b'], T + H) //a恰到期
        assert.strict.deepEqual([g.hit.key, g.dirty, Object.keys(st.quota)], ['b', true, ['b']])
    })

    it('ledgerFind: 形狀不符／until無法解析／已過期／遠超上限者作廢並清除; 無quota或quota非物件回null、不dirty', function() {
        let st = { quota: { n: null, s: 'x', u: { until: 'x' }, o: rec(T - H), far: rec(T + 100 * D), ok: rec(T + H) } }
        let f = ledgerFind(st, ['n', 's', 'u', 'o', 'far', 'ok'], T)
        assert.strict.deepEqual([f.hit.key, f.dirty, Object.keys(st.quota)], ['ok', true, ['ok']])
        assert.strict.deepEqual(ledgerFind({}, ['a'], T), { hit: null, dirty: false })
        assert.strict.deepEqual(ledgerFind({ quota: [] }, ['a'], T), { hit: null, dirty: false })
        assert.strict.deepEqual(ledgerFind({ quota: 5 }, ['a'], T), { hit: null, dirty: false })
        assert.strict.deepEqual(ledgerFind(null, ['a'], T), { hit: null, dirty: false })
        //原型鍵不誤命中
        assert.strict.deepEqual(ledgerFind({ quota: {} }, ['toString', 'constructor', '__proto__'], T), { hit: null, dirty: false })
    })

    it('ledgerFind: 帶windows者以recheck重判——對本條目不擋時略過該帳但不刪(他條目或他設定可能仍適用, 待到期自然清除); 仍擋時until取重判結果與帳內until之較小者; 無windows者不重判', function() {
        let st = { quota: { a: rec(T + 2 * D, { windows: [{ name: 'w', percent: 96, resetsAt: iso(T + 2 * D) }] }), t: { until: iso(T + 3 * D), at: iso(T), source: 'limit-text' } } }
        let f = ledgerFind(st, ['a'], T, () => ({ blocked: false, until: null }))
        assert.strict.deepEqual([f.hit, f.dirty, Object.keys(st.quota)], [null, false, ['a', 't']])
        //略過該帳後續鍵仍可命中
        assert.strict.deepEqual(ledgerFind(st, ['a', 't'], T, (ws) => ({ blocked: false, until: null })).hit.key, 't')
        let st2 = { quota: { a: rec(T + 2 * D, { windows: [{ name: 'w', percent: 96, resetsAt: iso(T + 2 * D) }] }) } }
        assert.strict.deepEqual(ledgerFind(st2, ['a'], T, () => ({ blocked: true, until: iso(T + H) })).hit.until, iso(T + H))
        assert.strict.deepEqual(ledgerFind(st2, ['a'], T, () => ({ blocked: true, until: iso(T + 30 * D) })).hit.until, iso(T + 2 * D))
        assert.strict.deepEqual(ledgerFind(st2, ['a'], T, () => ({ blocked: true, until: null })).hit.until, iso(T + 2 * D))
        let calls = 0
        assert.strict.deepEqual(ledgerFind(st, ['t'], T, () => {
            calls++; return { blocked: false }
        }).hit.key, 't')
        assert.strict.deepEqual(calls, 0)
    })

    it('toMs／clampUntilMs: Date／ISO字串／毫秒數可轉, 其餘NaN; 截斷於now+8天', function() {
        assert.strict.deepEqual([toMs(new Date(T)), toMs(iso(T)), toMs(T), toMs(''), toMs('x'), toMs(null), toMs(NaN), toMs({}), toMs(Infinity)].map((v) => (Number.isNaN(v) ? 'NaN' : v)), [T, T, T, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN'])
        assert.strict.deepEqual([clampUntilMs(T + 9 * D, T), clampUntilMs(T + D, T), UNTIL_CAP_MS], [T + 8 * D, T + D, 8 * D])
    })
})


describe('subGateDecide／learnQuotaFromFailure: 直呼(假讀者)', function() {

    let mkSq = (readerFn, extra = {}, opt = {}) => resolveSubQuotaGate({ readers: { claude: readerFn }, state: createQuotaGateState(), now: () => T, ...extra }, { kind: 'claude', model: 'sonnet', ...opt }, 0, 'claude:sonnet', true)
    let ok = (windows) => ({ ok: true, windows })

    it('讀者拋出同步錯誤、reject、永不回: 皆回reason error(不擋), 不入帳', async function() {
        let state = {}
        let saves = 0
        for (let fn of [() => {
            throw new Error('x')
        }, () => Promise.reject(new Error('x')), () => new Promise(() => {})]) {
            let sq = mkSq(fn, { timeoutMs: 10 })
            let d = await subGateDecide(sq, state, () => {
                saves++
            })
            assert.strict.deepEqual([d.blocked, d.reason, typeof d.errorType], [false, 'error', 'string'])
        }
        assert.strict.deepEqual([saves, state.quota], [0, undefined])
    })

    it('blocked且until可解析: 入帳並saveState一次; 第二次(同state)走帳不呼叫讀者', async function() {
        let state = {}
        let saves = 0
        let n = 0
        let sq = mkSq(() => {
            n++; return ok([win('7天', 99, iso(T + D))])
        })
        let d1 = await subGateDecide(sq, state, () => {
            saves++
        })
        assert.strict.deepEqual([d1.blocked, d1.source, d1.until, saves, n], [true, 'usage-api', iso(T + D), 1, 1])
        let sq2 = mkSq(() => {
            n++; return ok([])
        })
        let d2 = await subGateDecide(sq2, state, () => {
            saves++
        })
        assert.strict.deepEqual([d2.blocked, d2.source, d2.cached, n], [true, 'ledger', true, 1])
    })

    it('learnQuotaFromFailure: 索引式id(entryKey null)、validation失敗、無時刻、時刻已過 → null; saveState僅在入帳時呼叫', function() {
        let TEXT = 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)'
        let state = {}
        let saves = 0
        let sv = () => {
            saves++
        }
        let sq = mkSq(() => ok([]))
        assert.strict.deepEqual(learnQuotaFromFailure(sq, state, sv, { ok: false, stdout: TEXT, errorType: 'validation' }, null), null)
        assert.strict.deepEqual(learnQuotaFromFailure(sq, state, sv, { ok: false, stdout: 'nothing' }, null), null)
        assert.strict.deepEqual(learnQuotaFromFailure(sq, state, sv, { ok: false, stdout: TEXT }, () => T - H), null) //注入回有效但已過去之時刻: 代表「已重置」, 不入帳且不退回內建字樣
        assert.strict.deepEqual([saves, state.quota], [0, undefined])
        let noId = resolveSubQuotaGate({ readers: { claude: () => ok([]) }, now: () => T }, { kind: 'claude' }, 0, '0', false)
        assert.strict.deepEqual(learnQuotaFromFailure(noId, {}, sv, { ok: false, stdout: TEXT }, null), null)
    })

    it('learnQuotaFromFailure: 內建字樣(僅claude)入帳entry:<id>; 字樣出現在error／stderr／stdout任一欄皆可; 注入有效值優先; 注入拋錯／回Promise退回內建', function() {
        let TEXT = 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)'
        for (let field of ['error', 'stderr', 'stdout']) {
            let state = {}
            let lt = learnQuotaFromFailure(mkSq(() => ok([])), state, () => {}, { ok: false, [field]: `x ${TEXT} y` }, null)
            assert.strict.deepEqual([lt.until, state.quota['entry:claude:sonnet'].source], ['2026-11-09T09:00:00.000Z', 'limit-text'], field)
        }
        let s2 = {}
        learnQuotaFromFailure(mkSq(() => ok([])), s2, () => {}, { ok: false, stdout: TEXT }, () => new Date(T + H))
        assert.strict.deepEqual(s2.quota['entry:claude:sonnet'].until, iso(T + H))
        for (let hook of [() => {
            throw new Error('x')
        }, () => Promise.resolve(new Date(T + H)), () => null]) {
            let s3 = {}
            learnQuotaFromFailure(mkSq(() => ok([])), s3, () => {}, { ok: false, stdout: TEXT }, hook)
            assert.strict.deepEqual(s3.quota['entry:claude:sonnet'].until, '2026-11-09T09:00:00.000Z')
        }
        //codex不內建字樣
        let sc = resolveSubQuotaGate({ readers: { codex: () => ok([]) }, now: () => T }, { kind: 'codex' }, 0, 'codex:x', true)
        let s4 = {}
        assert.strict.deepEqual(learnQuotaFromFailure(sc, s4, () => {}, { ok: false, stdout: TEXT }, null), null)
        assert.strict.deepEqual(s4.quota, undefined)
    })

    it('state不可寫(凍結): 入帳回null／不擋之判定仍回傳, 不拋錯', async function() {
        let d = await subGateDecide(mkSq(() => ok([win('7天', 99, iso(T + D))])), Object.freeze({}), () => {})
        assert.strict.deepEqual([d.blocked, d.source], [true, 'usage-api'])
        assert.strict.deepEqual(learnQuotaFromFailure(mkSq(() => ok([])), Object.freeze({}), () => {}, { ok: false, stdout: 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)' }, null), null)
    })
})


describe('createAiEventLogger: 額度帳命中行(R-SPAWNGATE-6 C)', function() {

    let mkLog = () => {
        let lines = []
        return { lines, logger: { logWarn: (m) => lines.push(['warn', m]), log: (m) => lines.push(['info', m]) } }
    }
    let ev = (extra = {}) => ({ type: 'quota-skip', providerId: 'claude:sonnet', keyIndex: null, keyId: 'claude:sonnet', windows: [], until: '2026-11-09T09:00:00.000Z', cached: true, source: 'ledger', error: 'x', ...extra })

    beforeEach(function() {
        resetLedgerNotice()
    })
    after(function() {
        resetLedgerNotice()
    })

    it('source為ledger之quota-skip: WARN一行「額度帳：<id> 至 <until> 略過」, 同條目同重置時刻每行程只一次(跨記錄器實例); 不同條目或不同重置時刻再記', function() {
        let a = mkLog()
        let la = createAiEventLogger({ log: a.logger, tag: '步驟6：' })
        la(ev())
        la(ev())
        createAiEventLogger({ log: a.logger })(ev())
        assert.strict.deepEqual(a.lines.length, 1)
        assert.strict.deepEqual(a.lines[0][0], 'warn')
        assert.strict.deepEqual(/^步驟6：額度帳：claude:sonnet 至 2026-11-09T09:00:00\.000Z 略過/.test(a.lines[0][1]), true)
        la(ev({ providerId: 'codex:terra' }))
        la(ev({ until: '2026-11-10T09:00:00.000Z' }))
        assert.strict.deepEqual(a.lines.length, 3)
    })

    it('其他quota-skip(usage-api、limit-text、Go無source)與其他事件不記; cooled事件照舊', function() {
        let a = mkLog()
        let l = createAiEventLogger({ log: a.logger })
        l(ev({ source: 'usage-api' }))
        l(ev({ source: 'limit-text' }))
        l(ev({ source: undefined }))
        l({ type: 'try', providerId: 'x' })
        l({ type: 'quota-gate-error', providerId: 'x' })
        assert.strict.deepEqual(a.lines.length, 0)
        l({ type: 'cooled', providerId: 'p', error: 'HTTP 429', cooldownMs: 900000 })
        assert.strict.deepEqual(a.lines.length, 1)
    })

    it('until缺漏仍記一行(?); 記錄器拋錯不外洩', function() {
        let a = mkLog()
        createAiEventLogger({ log: a.logger })(ev({ until: undefined }))
        assert.strict.deepEqual(/至 \? 略過/.test(a.lines[0][1]), true)
        resetLedgerNotice()
        assert.doesNotThrow(() => createAiEventLogger({
            log: {
                logWarn: () => {
                    throw new Error('x')
                }
            }
        })(ev()))
    })
})
