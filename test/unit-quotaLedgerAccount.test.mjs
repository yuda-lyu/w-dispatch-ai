import assert from 'assert'
import crypto from 'node:crypto'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { createQuotaGateState } from '../src/goQuotaGate.mjs'
import { resolveSubQuotaGate, subGateDecide, learnQuotaFromFailure } from '../src/subQuotaGate.mjs'
import { createAiEventLogger, resetLedgerNotice } from '../src/wkf/logAiOutcome.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// 規格來源: Gitea semi/opensrcOper#116(使用端建議: 訂閱額度帳在帳號切換後仍擋到原重置時刻)與主控派工單da116:
//   R1 入帳記account(取讀者回應之帳號識別, 無則null; 帳內存正規化後之雜湊, 不存email本文);
//   R2 讀帳命中且帳有account時, 與現行讀者之account比對, 不同即作廢該帳並改走讀者; 帳號識別null之舊項目不比對;
//   R3 重探節流: 有account之帳每accountCheckMs(預設30分鐘)、無account而until−now>6小時之帳每recheckEveryMs(預設6小時)才以讀者重探一次(節流時刻持久化於帳項目之rechecked, 跨行程有效);
//      重探時讀者顯示對本條目已低於門檻(有效percent且門檻啟用)或帳號改變即作廢;
//   R4 讀者失敗(逾時、拋錯、ok為false、取不到帳號、無可用視窗)時不作廢、維持帳(不擋亦不解擋), 失敗亦消耗重探間隔;
//   R5 舊格式帳項目(無account、無rechecked)讀取不拋錯, 維持現行行為, 只靠定期重探;
//   R6 作廢發quota-ledger-void事件(帶reason: account-changed／recheck-below), 字面不含帳號完整值(只帶雜湊前8碼); 既有訊息字面不變;
//   R7 三家(claude、codex、antigravity)與CLI文字入帳(limit-text)一致處理。
// 本檔全部以注入之讀者(quotaGate.readers)與假CLI執行, 不連網、不呼叫真實額度查詢、不呼叫任何模型。


let T = Date.UTC(2026, 10, 9, 4, 0, 0)
let MIN = 60000
let H = 3600000
let D = 86400000
let iso = (ms) => new Date(ms).toISOString()
let win = (label, usedPercent, resetAt, scope = '') => ({ label, scope, usedPercent, resetAt })
let ok = (windows, extra = {}) => ({ ok: true, windows, ...extra })

//帳號識別之正規化形狀(規格: 去空白、轉小寫後sha256取前16碼十六進位)
let acct = (email) => crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16)

//三家: key為帳鍵, scope為讀者視窗scope(agy依model對到群組, 視窗須帶該群組scope才適用)
let FAMS = [
    { family: 'claude', attempt: { kind: 'claude', model: 'sonnet' }, id: 'claude:sonnet', key: 'claude', scope: '' },
    { family: 'codex', attempt: { kind: 'codex', model: 'gpt-6.1-terra' }, id: 'codex:terra', key: 'codex', scope: '' },
    { family: 'antigravity', attempt: { kind: 'antigravity', model: 'gemini-3.8-flash-high' }, id: 'agy:flash', key: 'antigravity:Gemini Models', scope: 'Gemini Models' },
]

//mkSq, 組某家族之sq(每次全新快取狀態, 模擬新行程); nowMs為注入時鐘; calls為讀者呼叫計數
let mkSq = (f, readerFn, nowMs, extra = {}) => resolveSubQuotaGate({ readers: { [f.family]: readerFn }, state: createQuotaGateState(), now: () => nowMs, ...extra }, { ...f.attempt }, 0, f.id, true)

//mkReader, 組可計數之讀者
let mkReader = (resp) => {
    let r = { calls: 0 }
    r.fn = () => {
        r.calls++
        return typeof resp === 'function' ? resp() : resp
    }
    return r
}


describe('額度帳記帳號識別並於帳號改變時作廢(Gitea #116)', function() {

    describe('R1 入帳記account', function() {

        for (let f of FAMS) {
            it(`${f.family}: 入帳記正規化後之account(去空白、不分大小寫之雜湊), 帳內不含email本文; 無email者account為null`, async function() {
                let state = {}
                let rd = mkReader(ok([win('7天', 96, iso(T + 2 * D), f.scope)], { email: ' A@X.com ' }))
                let d = await subGateDecide(mkSq(f, rd.fn, T), state, () => {})
                assert.strict.deepEqual([d.blocked, d.source], [true, 'usage-api'])
                assert.strict.deepEqual(state.quota[f.key].account, acct('a@x.com'))
                assert.strict.deepEqual(JSON.stringify(state).toLowerCase().includes('a@x'), false)
                //無email
                let state2 = {}
                let rd2 = mkReader(ok([win('7天', 96, iso(T + 2 * D), f.scope)], { email: '' }))
                await subGateDecide(mkSq(f, rd2.fn, T), state2, () => {})
                assert.strict.deepEqual(state2.quota[f.key].account, null)
            })
        }

        it('帳號識別之取法: email優先, 其次account.email、字串account、accountId; 非字串或空白視為無', async function() {
            let cases = [
                [{ email: 'e@x' }, acct('e@x')],
                [{ account: { email: 'ae@x' } }, acct('ae@x')],
                [{ account: 'as@x' }, acct('as@x')],
                [{ accountId: 'id-1' }, acct('id-1')],
                [{ email: 'e@x', account: { email: 'ae@x' }, accountId: 'id-1' }, acct('e@x')],
                [{ email: '   ', accountId: 'id-1' }, acct('id-1')],
                [{ email: 5, account: 7, accountId: {} }, null],
                [{}, null],
            ]
            for (let [extra, want] of cases) {
                let state = {}
                await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + D))], extra)).fn, T), state, () => {})
                assert.strict.deepEqual(state.quota.claude.account, want, JSON.stringify(extra))
            }
        })

        it('帳號識別不影響既有欄位: until／at／source／windows照舊', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + D))], { email: 'a@x' })).fn, T), state, () => {})
            let q = state.quota.claude
            assert.strict.deepEqual([q.until, q.at, q.source, q.windows.map((w) => w.name)], [iso(T + D), iso(T), 'usage-api', ['7天']])
        })
    })

    describe('R2 帳號改變即作廢', function() {

        for (let f of FAMS) {
            it(`${f.family}: 帳號改變(新帳號1%) → 帳作廢、blocked false、發作廢資訊(reason account-changed); 讀者只被呼叫一次`, async function() {
                let state = {}
                await subGateDecide(mkSq(f, mkReader(ok([win('7天', 95, iso(T + 3 * D), f.scope)], { email: 'a@x' })).fn, T), state, () => {})
                assert.strict.deepEqual(state.quota[f.key].account, acct('a@x'))
                let rd = mkReader(ok([win('7天', 1, iso(T + 7 * D), f.scope)], { email: 'b@x' }))
                let d = await subGateDecide(mkSq(f, rd.fn, T + 31 * MIN), state, () => {})
                assert.strict.deepEqual([d.blocked, d.reason, rd.calls], [false, 'ok', 1])
                assert.strict.deepEqual(state.quota?.[f.key], undefined)
                assert.strict.deepEqual(d.ledgerVoided.length, 1)
                let v = d.ledgerVoided[0]
                assert.strict.deepEqual([v.key, v.reason, v.until, v.accountFrom, v.accountTo], [f.key, 'account-changed', iso(T + 3 * D), acct('a@x').slice(0, 8), acct('b@x').slice(0, 8)])
            })
        }

        it('帳號改變但新帳號同樣達門檻: 作廢舊帳、以新帳號重新入帳並照常略過(source usage-api)', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let rd = mkReader(ok([win('7天', 99, iso(T + 5 * D))], { email: 'b@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 31 * MIN), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, d.until, rd.calls, d.ledgerVoided.length], [true, 'usage-api', iso(T + 5 * D), 1, 1])
            assert.strict.deepEqual([state.quota.claude.account, state.quota.claude.until], [acct('b@x'), iso(T + 5 * D)])
        })

        it('帳號比對不分大小寫與前後空白: 同帳號不同寫法不視為改變', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x.com' })).fn, T), state, () => {})
            let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: ' A@X.COM ' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 31 * MIN), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, rd.calls, d.ledgerVoided], [true, 'ledger', 1, undefined])
            assert.strict.deepEqual(state.quota.claude.account, acct('a@x.com'))
        })

        it('帳號識別為null之舊項目不比對帳號: 帳號改變但新帳號仍達門檻時維持帳(只靠定期重探)', async function() {
            let state = { quota: { claude: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }] } } }
            let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'b@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 7 * H), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided], [true, 'ledger', undefined])
            assert.ok(state.quota.claude)
        })

        it('並行兩呼叫於重探時刻同時發現帳號改變: 讀者只被呼叫一次、帳作廢資訊只出現一次', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let rd = mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'b@x' }))
            let sq = mkSq(FAMS[0], rd.fn, T + 31 * MIN)
            let [d1, d2] = await Promise.all([subGateDecide(sq, state, () => {}), subGateDecide(sq, state, () => {})])
            assert.strict.deepEqual([d1.blocked, d2.blocked, rd.calls, (d1.ledgerVoided || []).length + (d2.ledgerVoided || []).length], [false, false, 1, 1])
        })
    })

    describe('R3 重探節流(不使每次派工都打讀者)', function() {

        it('有account之帳, 同帳號仍達門檻: accountCheckMs(30分鐘)內連續判定不呼叫讀者; 到期呼叫一次並維持(source ledger), 其後再於間隔內不再呼叫', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 95, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let rd = mkReader(ok([win('7天', 95, iso(T + 3 * D))], { email: 'a@x' }))
            for (let m of [0, 1, 5, 10, 20, 29]) {
                let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + m * MIN), state, () => {})
                assert.strict.deepEqual([d.blocked, d.source, d.cached], [true, 'ledger', true], `+${m}分`)
            }
            assert.strict.deepEqual(rd.calls, 0)
            let d30 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 30 * MIN), state, () => {})
            assert.strict.deepEqual([d30.blocked, d30.source, d30.ledgerVoided, rd.calls], [true, 'ledger', undefined, 1])
            assert.strict.deepEqual(state.quota.claude.rechecked, iso(T + 30 * MIN))
            //重探後之間隔以rechecked起算(跨行程, 每次皆全新快取)
            for (let m of [31, 45, 59]) {
                await subGateDecide(mkSq(FAMS[0], rd.fn, T + m * MIN), state, () => {})
            }
            assert.strict.deepEqual(rd.calls, 1)
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 60 * MIN), state, () => {})
            assert.strict.deepEqual(rd.calls, 2)
        })

        it('帳號改變之偵測延遲上限為accountCheckMs: 間隔內即使讀者已換帳號亦不呼叫(仍略過), 到期才偵測', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 95, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let rd = mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'b@x' }))
            let d1 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 29 * MIN), state, () => {})
            assert.strict.deepEqual([d1.blocked, d1.source, rd.calls], [true, 'ledger', 0])
            let d2 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 30 * MIN), state, () => {})
            assert.strict.deepEqual([d2.blocked, rd.calls, d2.ledgerVoided[0].reason], [false, 1, 'account-changed'])
        })

        it('accountCheckMs可調(quotaGate.accountCheckMs); 非正數、非數字取預設30分鐘', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 95, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let rd = mkReader(ok([win('7天', 95, iso(T + 3 * D))], { email: 'a@x' }))
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 4 * MIN, { accountCheckMs: 5 * MIN }), state, () => {})
            assert.strict.deepEqual(rd.calls, 0)
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 5 * MIN, { accountCheckMs: 5 * MIN }), state, () => {})
            assert.strict.deepEqual(rd.calls, 1)
            for (let bad of [0, -1, 'x', null, NaN]) {
                let sq = mkSq(FAMS[0], rd.fn, T, { accountCheckMs: bad })
                assert.strict.deepEqual(sq.accountCheckMs, 30 * MIN, String(bad))
            }
            assert.strict.deepEqual(mkSq(FAMS[0], rd.fn, T).recheckEveryMs, 6 * H)
            assert.strict.deepEqual(mkSq(FAMS[0], rd.fn, T, { recheckEveryMs: 'x' }).recheckEveryMs, 6 * H)
        })

        it('無account且until−now>6小時之帳(舊格式或CLI文字): 每recheckEveryMs(6小時)重探一次; 之前不呼叫讀者', async function() {
            let state = { quota: { claude: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }] } } }
            let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' }))
            let d1 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 6 * H - 1), state, () => {})
            assert.strict.deepEqual([d1.blocked, d1.source, rd.calls], [true, 'ledger', 0])
            let d2 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 6 * H), state, () => {})
            assert.strict.deepEqual([d2.blocked, d2.source, rd.calls, d2.ledgerVoided], [true, 'ledger', 1, undefined])
            assert.strict.deepEqual(state.quota.claude.rechecked, iso(T + 6 * H))
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 11 * H), state, () => {})
            assert.strict.deepEqual(rd.calls, 1)
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 12 * H), state, () => {})
            assert.strict.deepEqual(rd.calls, 2)
        })

        it('recheckEveryMs可調(quotaGate.recheckEveryMs): 無account之長視窗帳依自訂間隔重探', async function() {
            let state = { quota: { claude: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }] } } }
            let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' }))
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 2 * H - 1, { recheckEveryMs: 2 * H }), state, () => {})
            assert.strict.deepEqual(rd.calls, 0)
            await subGateDecide(mkSq(FAMS[0], rd.fn, T + 2 * H, { recheckEveryMs: 2 * H }), state, () => {})
            assert.strict.deepEqual(rd.calls, 1)
        })

        it('無account且until−now≤6小時之短視窗帳: 不重探(快到期, 不值得打讀者); 邊界: until−now恰6小時不重探、多1毫秒才重探', async function() {
            let state = { quota: { claude: { until: iso(T + 5 * H), at: iso(T), source: 'usage-api', windows: [{ name: '5小時', percent: 96, resetsAt: iso(T + 5 * H), scope: '' }] } } }
            let rd = mkReader(ok([win('5小時', 1, iso(T + 5 * H))], { email: 'a@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 1 * H), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, rd.calls], [true, 'ledger', 0])
            //入帳已逾recheckEveryMs(6小時)而until尚餘≤6小時: 仍不重探(須以until−now而非入帳時間判長視窗)
            let st2 = { quota: { claude: { until: iso(T + 8 * H), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 8 * H), scope: '' }] } } }
            let rd2 = mkReader(ok([win('7天', 1, iso(T + 9 * H))], { email: 'a@x' }))
            let d2 = await subGateDecide(mkSq(FAMS[0], rd2.fn, T + 7 * H), st2, () => {}) //age 7h≥6h, until−now 1h
            assert.strict.deepEqual([d2.blocked, d2.source, rd2.calls], [true, 'ledger', 0])
            //邊界: now=until−6h(恰6小時)不算長視窗; until−now=6h+1ms才算
            let st3 = { quota: { claude: { until: iso(T + 12 * H), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 12 * H), scope: '' }] } } }
            let rd3 = mkReader(ok([win('7天', 96, iso(T + 12 * H))], { email: 'a@x' }))
            await subGateDecide(mkSq(FAMS[0], rd3.fn, T + 6 * H), st3, () => {})
            assert.strict.deepEqual(rd3.calls, 0)
            await subGateDecide(mkSq(FAMS[0], rd3.fn, T + 6 * H - 1), st3, () => {}) //age<6h亦不到期
            assert.strict.deepEqual(rd3.calls, 0)
            let st4 = { quota: { claude: { until: iso(T + 12 * H + 1), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 12 * H + 1), scope: '' }] } } }
            let rd4 = mkReader(ok([win('7天', 96, iso(T + 12 * H + 1))], { email: 'a@x' }))
            await subGateDecide(mkSq(FAMS[0], rd4.fn, T + 6 * H), st4, () => {})
            assert.strict.deepEqual(rd4.calls, 1)
        })

        it('重探時讀者顯示對本條目已低於門檻: 帳作廢(reason recheck-below), 同一次判定改走讀者結果(不再多打一次)', async function() {
            for (let f of FAMS) {
                let state = { quota: { [f.key]: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: f.scope }] } } }
                let rd = mkReader(ok([win('7天', 3, iso(T + 7 * D), f.scope)], { email: 'a@x' }))
                let d = await subGateDecide(mkSq(f, rd.fn, T + 6 * H), state, () => {})
                assert.strict.deepEqual([d.blocked, d.reason, rd.calls, d.ledgerVoided.map((v) => v.reason)], [false, 'ok', 1, ['recheck-below']], f.family)
                assert.strict.deepEqual(state.quota?.[f.key], undefined, f.family)
            }
        })

        it('重探時讀者仍達門檻但until已變: 維持原帳(不改寫until／windows), 只更新rechecked', async function() {
            let rec = { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }] }
            let state = { quota: { claude: { ...rec } } }
            let rd = mkReader(ok([win('7天', 99, iso(T + 2 * D))], { email: 'a@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 6 * H), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, d.until], [true, 'ledger', iso(T + 3 * D)])
            assert.strict.deepEqual({ ...state.quota.claude, rechecked: undefined }, { ...rec, rechecked: undefined })
        })

        it('既有帳(帶windows)以現行門檻重判之行為不變: 調高門檻後帳不再擋(略過但不刪), 不觸發重探', async function() {
            let state = { quota: { claude: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', account: acct('a@x'), windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }] } } }
            let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 1 * MIN, { claudeMax: 99 }), state, () => {})
            assert.strict.deepEqual([d.blocked, d.reason, rd.calls], [false, 'ok', 1]) //帳被略過→走讀者(原有行為), 讀者呼叫為該路徑之查詢而非重探
            assert.ok(state.quota.claude) //略過不刪
        })
    })

    describe('R4 讀者失敗不作廢、維持帳', function() {

        let seed = async (f) => {
            let state = {}
            await subGateDecide(mkSq(f, mkReader(ok([win('7天', 96, iso(T + 3 * D), f.scope)], { email: 'a@x' })).fn, T), state, () => {})
            return state
        }

        for (let [name, fn] of [
            ['拋出同步錯誤', () => {
                throw new Error('x')
            }],
            ['reject', () => Promise.reject(new Error('x'))],
            ['永不回(逾時)', () => new Promise(() => {})],
            ['ok為false(未授權)', () => ({ ok: false, errorType: 'auth' })],
            ['回應形狀不符(windows缺漏)', () => ({ ok: true })],
        ]) {
            it(`${name}: 帳維持(source ledger)、不作廢、無作廢資訊; 失敗亦消耗重探間隔(下一個行程於間隔內不再呼叫)`, async function() {
                let state = await seed(FAMS[0])
                let n = 0
                let reader = () => {
                    n++
                    return fn()
                }
                let d = await subGateDecide(mkSq(FAMS[0], reader, T + 31 * MIN, { timeoutMs: 10 }), state, () => {})
                assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided, n], [true, 'ledger', undefined, 1])
                assert.strict.deepEqual(state.quota.claude.account, acct('a@x'))
                assert.strict.deepEqual(state.quota.claude.rechecked, iso(T + 31 * MIN))
                let d2 = await subGateDecide(mkSq(FAMS[0], reader, T + 40 * MIN, { timeoutMs: 10 }), state, () => {})
                assert.strict.deepEqual([d2.blocked, d2.source, n], [true, 'ledger', 1])
            })
        }

        it('三家各一: 讀者失敗皆維持帳', async function() {
            for (let f of FAMS) {
                let state = await seed(f)
                let d = await subGateDecide(mkSq(f, () => Promise.reject(new Error('x')), T + 31 * MIN), state, () => {})
                assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided, state.quota[f.key].account], [true, 'ledger', undefined, acct('a@x')], f.family)
            }
        })

        it('取不到現行帳號(讀者成功但無email), 用量仍達門檻: 維持帳(無從比對、用量未解)', async function() {
            let state = await seed(FAMS[0])
            let d = await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: '' })).fn, T + 31 * MIN), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided], [true, 'ledger', undefined])
            assert.strict.deepEqual(state.quota.claude.account, acct('a@x'))
        })

        it('取不到現行帳號但用量已低於門檻(有效percent): 以recheck-below作廢', async function() {
            let state = await seed(FAMS[0])
            let d = await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 2, iso(T + 7 * D))], { email: '' })).fn, T + 31 * MIN), state, () => {})
            assert.strict.deepEqual([d.blocked, d.ledgerVoided.map((v) => v.reason)], [false, ['recheck-below']])
        })

        it('無明確證據不解帳: 讀者成功但適用視窗為空、percent為null或非數字 → 維持帳', async function() {
            for (let resp of [
                ok([], { email: 'a@x' }),
                ok([win('7天', null, iso(T + 3 * D))], { email: 'a@x' }),
                ok([win('7天', 'n/a', iso(T + 3 * D))], { email: 'a@x' }),
            ]) {
                let state = await seed(FAMS[0])
                let d = await subGateDecide(mkSq(FAMS[0], mkReader(resp).fn, T + 31 * MIN), state, () => {})
                assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided], [true, 'ledger', undefined], JSON.stringify(resp.windows))
            }
        })

        it('無明確證據不解帳: 門檻被關閉(claudeMax false)時, CLI文字入帳之entry帳於重探到期時即使讀者顯示1%亦維持(門檻關閉＝讀者之用量不作證)', async function() {
            let state = {}
            learnQuotaFromFailure(mkSq(FAMS[0], mkReader(ok([])).fn, T, { claudeMax: false }), state, () => {}, { ok: false, stdout: 'x' }, () => T + 3 * D)
            let rd = mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'b@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 6 * H, { claudeMax: false }), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided, rd.calls], [true, 'ledger', undefined, 1])
            assert.ok(state.quota['entry:claude:sonnet'])
        })

        it('state不可寫(凍結)時重探不拋錯: 帳照維持(無法標記rechecked), 帳號改變時無法刪帳亦不拋錯且仍改走讀者', async function() {
            let seeded = await seed(FAMS[0])
            let frozen = Object.freeze({ quota: Object.freeze({ claude: Object.freeze({ ...seeded.quota.claude }) }) })
            let d1 = await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' })).fn, T + 31 * MIN), frozen, () => {})
            assert.strict.deepEqual([d1.blocked, d1.source], [true, 'ledger'])
            let d2 = await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'b@x' })).fn, T + 31 * MIN), frozen, () => {})
            assert.strict.deepEqual(d2.blocked, false)
        })
    })

    describe('R5 舊格式帳項目相容讀取', function() {

        it('無account、無rechecked、無source／windows之舊項目: 讀取不拋錯, 維持現行行為(now<until即略過, 帳訊息字面不變)', async function() {
            let state = { quota: { claude: { until: iso(T + 2 * D), at: iso(T) } } }
            let rd = mkReader(ok([], { email: 'a@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + H), state, () => {})
            assert.strict.deepEqual([d.blocked, d.source, d.cached, rd.calls], [true, 'ledger', true, 0])
            assert.strict.deepEqual(d.error, `QUOTA_COOLDOWN: Claude subscription quota recorded as exhausted until ${iso(T + 2 * D)} (ledger); entry skipped`)
        })

        it('account非字串(數字、物件、陣列)視為null; rechecked／at無法解析或在未來(時鐘回撥)視為到期而重探, 皆不拋錯', async function() {
            for (let extra of [{ account: 5 }, { account: {} }, { account: [] }, { rechecked: 'x' }, { rechecked: 5 }, { at: 'x' }, { at: iso(T + 100 * D) }, { at: undefined }]) {
                let state = { quota: { claude: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }], ...extra } } }
                let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' }))
                let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 7 * H), state, () => {})
                assert.strict.deepEqual([d.blocked, d.source, rd.calls], [true, 'ledger', 1], JSON.stringify(extra)) //到期而重探一次(account非字串視為null→長視窗6小時; 起點無法解析或在未來視為到期)
            }
        })

        it('舊項目於帳號識別null、重探時用量已低於門檻: 作廢(只靠定期重探解)', async function() {
            let state = { quota: { claude: { until: iso(T + 3 * D), at: iso(T), source: 'usage-api', windows: [{ name: '7天', percent: 96, resetsAt: iso(T + 3 * D), scope: '' }] } } }
            let d = await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'b@x' })).fn, T + 6 * H), state, () => {})
            assert.strict.deepEqual([d.blocked, d.ledgerVoided.map((v) => v.reason)], [false, ['recheck-below']])
        })

        it('新格式帳可JSON來回(跨行程): 序列化後再讀, account與rechecked保持', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let again = JSON.parse(JSON.stringify(state))
            let rd = mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 31 * MIN), again, () => {})
            assert.strict.deepEqual([d.blocked, rd.calls, JSON.parse(JSON.stringify(again)).quota.claude.rechecked], [true, 1, iso(T + 31 * MIN)])
        })
    })

    describe('R7 CLI文字入帳(limit-text)一致處理', function() {

        it('learnQuotaFromFailure入帳之entry帳account為null、帶family; 無account者依長視窗每6小時重探', async function() {
            let state = {}
            let sq = mkSq(FAMS[0], mkReader(ok([])).fn, T)
            learnQuotaFromFailure(sq, state, () => {}, { ok: false, stdout: 'x' }, () => T + 3 * D)
            let rec = state.quota['entry:claude:sonnet']
            assert.strict.deepEqual([rec.source, rec.account, rec.family], ['limit-text', null, 'claude'])
            //6小時內不呼叫讀者
            let rd = mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'b@x' }))
            let d1 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 6 * H - 1), state, () => {})
            assert.strict.deepEqual([d1.blocked, d1.source, rd.calls], [true, 'ledger', 0])
            //到期重探: 讀者顯示用量低(帳號已換) → 作廢
            let d2 = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 6 * H), state, () => {})
            assert.strict.deepEqual([d2.blocked, d2.ledgerVoided.map((v) => [v.key, v.reason])], [false, [['entry:claude:sonnet', 'recheck-below']]])
            assert.strict.deepEqual(state.quota['entry:claude:sonnet'], undefined)
        })

        it('家族帳作廢後, 同條目之entry帳仍獨立判定(於各自間隔重探): 家族帳因帳號改變作廢後entry帳未到期則仍擋', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            learnQuotaFromFailure(mkSq(FAMS[0], mkReader(ok([])).fn, T), state, () => {}, { ok: false, stdout: 'x' }, () => T + 3 * D)
            assert.strict.deepEqual(Object.keys(state.quota).sort(), ['claude', 'entry:claude:sonnet'])
            let rd = mkReader(ok([win('7天', 99, iso(T + 5 * D))], { email: 'b@x' }))
            let d = await subGateDecide(mkSq(FAMS[0], rd.fn, T + 31 * MIN), state, () => {})
            //家族帳(account a)因帳號改變作廢; entry帳(account null、長視窗)未到6小時 → 仍擋
            assert.strict.deepEqual([d.blocked, d.source, d.ledgerVoided.map((v) => v.reason), rd.calls], [true, 'ledger', ['account-changed'], 1])
            assert.strict.deepEqual(Object.keys(state.quota), ['entry:claude:sonnet'])
        })
    })

    describe('R6 事件與訊息: 不含帳號完整值', function() {

        it('作廢資訊只含雜湊前8碼與鍵／原因／until; 序列化後不含email本文與完整16碼雜湊', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 96, iso(T + 3 * D))], { email: 'Alice.Secret@example.com' })).fn, T), state, () => {})
            let d = await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 1, iso(T + 7 * D))], { email: 'bob.secret@example.com' })).fn, T + 31 * MIN), state, () => {})
            let text = JSON.stringify(d)
            for (let s of ['secret', 'example.com', acct('alice.secret@example.com'), acct('bob.secret@example.com')]) {
                assert.strict.deepEqual(text.toLowerCase().includes(s), false, s)
            }
            assert.strict.deepEqual(/^[0-9a-f]{8}$/.test(d.ledgerVoided[0].accountFrom), true)
            assert.strict.deepEqual(/^[0-9a-f]{8}$/.test(d.ledgerVoided[0].accountTo), true)
        })

        it('帳命中略過之訊息字面不變(含來源與視窗描述)', async function() {
            let state = {}
            await subGateDecide(mkSq(FAMS[0], mkReader(ok([win('7天', 95, iso(T + 3 * D))], { email: 'a@x' })).fn, T), state, () => {})
            let d = await subGateDecide(mkSq(FAMS[0], mkReader(ok([])).fn, T + 1 * MIN), state, () => {})
            assert.strict.deepEqual(d.error, `QUOTA_COOLDOWN: Claude subscription quota recorded as exhausted until ${iso(T + 3 * D)} (usage-api: 7天 95%); entry skipped`)
        })
    })
})


describe('遞補層整合: 帳號改變作廢事件(假CLI＋注入讀者)', function() {

    let fake = null
    before(function() {
        fake = createFakeCli('fake-acct116')
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let mkJsonStore = () => {
        let text = null
        return {
            get: () => (text === null ? null : JSON.parse(text)),
            set: (x) => {
                text = JSON.stringify(x)
            },
            text: () => text,
            state: () => (text === null ? null : JSON.parse(text)),
        }
    }
    let claudeE = (extra = {}) => ({ id: 'claude:sonnet', kind: 'claude', model: 'sonnet', exe: fake.exe, ...extra })
    let plainE = (extra = {}) => ({ id: 'oc:plain', kind: 'opencode', exe: fake.exe, ...extra })
    let mkGate = (resp, calls, nowMs) => ({
        state: createQuotaGateState(),
        readers: {
            claude: async () => {
                calls.push(1)
                return resp
            }
        },
        now: () => nowMs
    })
    let w = (pct, resetMs) => ({ key: '7天', label: '7天', windowSeconds: null, usedPercent: pct, resetAt: iso(resetMs), scope: '' })
    let okQ = (windows, email) => ({ ok: true, provider: 'fake', email, matched: null, plan: '', planTier: '', source: 'fake', windows, credits: null, raw: null, error: '', errorType: '', durationMs: 1 })

    it('換帳號: 重探到期之下一次派工發quota-ledger-void(帶providerId、reason、雜湊前8碼), 不發quota-skip, claude條目照常派工', async function() {
        let store = mkJsonStore()
        let prov = [claudeE(), plainE()]
        let c1 = []
        let r1 = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate(okQ([w(95, T + 3 * D)], 'a@x'), c1, T) })
        assert.strict.deepEqual([r1.providerId, c1.length, store.state().quota.claude.account], ['oc:plain', 1, acct('a@x')])
        //間隔內: 即使讀者已換帳號, 仍由帳略過、不查讀者
        let c2 = []
        let ev2 = []
        let r2 = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate(okQ([w(1, T + 7 * D)], 'b@x'), c2, T + 10 * MIN), onEvent: (e) => ev2.push(e) })
        assert.strict.deepEqual([r2.providerId, c2.length, ev2.some((e) => e.type === 'quota-ledger-void'), ev2.find((e) => e.type === 'quota-skip').source], ['oc:plain', 0, false, 'ledger'])
        //到期: 偵測帳號改變
        let c3 = []
        let ev3 = []
        let r3 = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate(okQ([w(1, T + 7 * D)], 'b@x'), c3, T + 31 * MIN), onEvent: (e) => ev3.push(e) })
        assert.strict.deepEqual([r3.ok, r3.providerId, c3.length], [true, 'claude:sonnet', 1])
        let voids = ev3.filter((e) => e.type === 'quota-ledger-void')
        assert.strict.deepEqual(voids.length, 1)
        assert.strict.deepEqual([voids[0].providerId, voids[0].reason, voids[0].key, voids[0].accountFrom, voids[0].accountTo], ['claude:sonnet', 'account-changed', 'claude', acct('a@x').slice(0, 8), acct('b@x').slice(0, 8)])
        assert.strict.deepEqual(ev3.some((e) => e.type === 'quota-skip'), false)
        assert.strict.deepEqual(JSON.stringify(ev3).includes('b@x'), false)
        assert.strict.deepEqual(store.state().quota?.claude, undefined)
    })

    it('同帳號重探通過: 不發作廢事件, 維持略過; rechecked持久化於store', async function() {
        let store = mkJsonStore()
        let prov = [claudeE(), plainE()]
        await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate(okQ([w(95, T + 3 * D)], 'a@x'), [], T) })
        let c = []
        let ev = []
        let r = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate(okQ([w(95, T + 3 * D)], 'a@x'), c, T + 31 * MIN), onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual([r.providerId, c.length, ev.some((e) => e.type === 'quota-ledger-void'), ev.find((e) => e.type === 'quota-skip').source], ['oc:plain', 1, false, 'ledger'])
        assert.strict.deepEqual(store.state().quota.claude.rechecked, iso(T + 31 * MIN))
    })

    it('quotaGate:false: 不查讀者、不讀帳、不重探、不發作廢事件', async function() {
        let store = mkJsonStore()
        let prov = [claudeE()]
        await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate(okQ([w(95, T + 3 * D)], 'a@x'), [], T) })
        let before = JSON.stringify(store.state())
        let ev = []
        let r = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: false, onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual([r.ok, ev.some((e) => e.type === 'quota-ledger-void' || e.type === 'quota-skip')], [true, false])
        //不讀帳亦不寫帳: 帳原樣(含account, 無rechecked)
        assert.strict.deepEqual(JSON.stringify(store.state().quota), JSON.stringify(JSON.parse(before).quota))
    })
})


describe('createAiEventLogger: 額度帳作廢行(Gitea #116)', function() {

    let mkLog = () => {
        let lines = []
        return { lines, logger: { logWarn: (m) => lines.push(['warn', m]), log: (m) => lines.push(['info', m]) } }
    }
    let ev = (extra = {}) => ({ type: 'quota-ledger-void', providerId: 'claude:sonnet', keyIndex: null, keyId: 'claude:sonnet', key: 'claude', reason: 'account-changed', until: '2026-11-12T23:00:00.211Z', accountFrom: '1a2b3c4d', accountTo: '5e6f7a8b', ...extra })

    beforeEach(function() {
        resetLedgerNotice()
    })
    after(function() {
        resetLedgerNotice()
    })

    it('account-changed: WARN一行「額度帳：<id> 之帳因登入帳號改變（舊 → 新）而作廢」, 只含雜湊前8碼', function() {
        let a = mkLog()
        createAiEventLogger({ log: a.logger, tag: '步驟6：' })(ev())
        assert.strict.deepEqual(a.lines.length, 1)
        assert.strict.deepEqual(a.lines[0][0], 'warn')
        assert.strict.deepEqual(/^步驟6：額度帳：claude:sonnet 之帳因登入帳號改變（1a2b3c4d → 5e6f7a8b）而作廢/.test(a.lines[0][1]), true)
    })

    it('recheck-below: WARN一行「額度帳：<id> 之帳經重探確認用量已低於門檻而作廢」', function() {
        let a = mkLog()
        createAiEventLogger({ log: a.logger })(ev({ reason: 'recheck-below', accountFrom: null, accountTo: null }))
        assert.strict.deepEqual(a.lines.length, 1)
        assert.strict.deepEqual(/^額度帳：claude:sonnet 之帳經重探確認用量已低於門檻而作廢/.test(a.lines[0][1]), true)
    })

    it('同一事件每次皆記(帳作廢後即不存在, 無洗版疑慮), 缺欄位不拋錯、記錄器拋錯不外洩', function() {
        let a = mkLog()
        let l = createAiEventLogger({ log: a.logger })
        l(ev())
        l(ev())
        assert.strict.deepEqual(a.lines.length, 2)
        assert.doesNotThrow(() => l({ type: 'quota-ledger-void' }))
        assert.doesNotThrow(() => createAiEventLogger({
            log: {
                logWarn: () => {
                    throw new Error('x')
                }
            }
        })(ev()))
    })
})
