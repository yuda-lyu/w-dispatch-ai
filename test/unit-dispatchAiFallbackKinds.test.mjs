import assert from 'assert'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import callAiWithFallback from '../src/wkf/callAiWithFallback.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-dispatchAiFallbackKinds.test.mjs — dispatchAiFallback依failureKind之處置(2026-10-25 dispatch-run01)
//
// 規格來源: 任務書範圍二(遞補之處置表)、README「遞補層依failureKind之處置」、帳本R-ANTHROPIC-5:
//   沒額度: 該把金鑰冷卻(或本次執行內不再用)換下一把; 全部金鑰皆沒額度才回報該供應商額度用盡。
//   脈絡過長: 不換金鑰、不換同脈絡上限之條目, 立即結束並回明確之錯誤。
//   限流、過載: 依既有冷卻與重試規則。金鑰無效／無權限: 換下一把, 不冷卻他把。
//   網路: 依maxRetries重試, 不換金鑰、不判額度。呼叫方式或環境錯誤: 不換金鑰、不判額度, 回明確錯誤。
//   未給coolDetect之呼叫端亦適用(內建); 既有coolDetect注入照舊可覆寫或疊加。
// 全部打本機假伺服器(經注入之fetch轉向)與假CLI, 不發出任何Anthropic請求, 不讀任何.env。


//假CLI: 依ANTHROPIC_API_KEY內含字樣模擬Claude Code之失敗輸出(純文字, 同內建claude-api:條目); 每次被呼叫把金鑰尾6碼追加到--fake-log
let ENTRY = `
import fs from 'fs'
let args = process.argv.slice(2)
let opt = (name) => {
    let a = args.find((x) => x.startsWith('--' + name + '='))
    return a ? a.slice(name.length + 3) : null
}
let key = process.env.ANTHROPIC_API_KEY || ''
let chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
    let log = opt('fake-log')
    if (log) {
        fs.appendFileSync(log, key.slice(-6) + '\\n')
    }
    let fail = (text) => {
        process.stdout.write(text)
        process.exit(1)
    }
    if (key.includes('nocredit') || key.includes('envbug') || args.includes('--fake-always-credit')) {
        fail('Credit balance is too low')
    }
    if (key.includes('ratelimited')) {
        fail('API Error: 429 rate_limit_error')
    }
    if (key.includes('overloaded')) {
        fail('Repeated 529 Overloaded errors')
    }
    if (key.includes('ctx')) {
        fail('Prompt is too long')
    }
    if (key.includes('badkey')) {
        fail('Invalid API key · Please run /login')
    }
    if (key.includes('forbidden')) {
        fail('API Error: 403 permission_error')
    }
    if (key.includes('netdown')) {
        fail('Unable to connect to API (ECONNREFUSED)')
    }
    process.stdout.write('OK ' + key.slice(-6))
    process.exit(0)
})
`


describe('dispatchAiFallback failureKind處置', function() {

    let srv = null
    let fake = null
    let fd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'dispatchAiFallbackKinds')
    let seq = 0

    //官方端點範圍判定會看process.env.ANTHROPIC_BASE_URL(CLI經它改端點): 測試期間清掉，結束還原
    let savedBaseUrl

    before(async function() {
        savedBaseUrl = process.env.ANTHROPIC_BASE_URL
        delete process.env.ANTHROPIC_BASE_URL
        srv = await fakeServerForAnthropicTest()
        fake = createFakeCli('fake-claude-fbk', ENTRY)
        fs.mkdirSync(fd, { recursive: true })
    })

    after(async function() {
        if (savedBaseUrl !== undefined) {
            process.env.ANTHROPIC_BASE_URL = savedBaseUrl
        }
        if (srv) {
            await srv.close()
        }
        if (fake) {
            fake.clean()
        }
        fs.rmSync(fd, { recursive: true, force: true })
    })

    //toSrv, 注入用fetch: 把請求轉向本機假伺服器(實際端點網址被忽略)
    let toSrv = (url, init) => fetch(`${srv.url}/v1/messages`, init)

    //mkStore, 每次呼叫用全新store(避免行程內共用狀態互相污染)
    let mkStore = (init = {}) => {
        let state = { cursors: {}, cooling: {}, ...init }
        let set = (s) => {
            state = s
        }
        return { get: () => state, set, peek: () => state }
    }

    //REST條目與CLI條目(皆無baseURL: 屬Anthropic官方端點金鑰範圍; fetch轉向假伺服器; CLI之交叉確認用by-key路由)
    let rest = (id, keys, extra = {}) => ({ id, kind: 'api-anthropic', model: 'by-key', keys, fetch: toSrv, ...extra })
    let cli = (id, keys, logFile, extra = {}) => ({ id, kind: 'claude', exe: fake.exe, keys, fetch: toSrv, crossCheckModel: 'by-key', extraArgs: [`--fake-log=${logFile}`], ...extra })
    let newLog = () => path.join(fd, `cli-${process.pid}-${seq++}.log`)
    let readLog = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []

    //call, 呼叫dispatchAiFallback並收集事件
    let call = async (providers, opt = {}) => {
        let events = []
        let store = opt.store || mkStore()
        let r = await dispatchAiFallback('abc', { providers, store, onEvent: (ev) => events.push(ev), ...opt })
        return { r, events, store }
    }
    let outcomes = (r) => r.tried.map((t) => t.outcome)
    let reqKeys = () => srv.requests.map((q) => q.headers['x-api-key'])

    beforeEach(function() {
        srv.requests.length = 0
    })

    describe('沒額度(no-credit)', function() {

        it('REST: 前兩把沒額度 → 逐把換下一把，第三把成功；tried帶failureKind', async function() {
            let { r } = await call([rest('anthropic:t1', ['sk-ant-nocredit-111111', 'sk-ant-nocredit-222222', 'sk-ant-good-333333'])])
            assert.strict.deepEqual(
                [r.ok, r.keyIndex, outcomes(r), r.tried.map((t) => t.failureKind), reqKeys().length],
                [true, 2, ['next-key', 'next-key', 'ok'], ['no-credit', 'no-credit', undefined], 3],
            )
        })

        it('REST: 全部金鑰皆沒額度 → 每把恰試一次，組盡事件quotaExhausted，最終error為QUOTA_EXHAUSTED並列出額度用盡之供應商', async function() {
            let { r, events } = await call([rest('anthropic:t2', ['sk-ant-nocredit-111111', 'sk-ant-nocredit-222222', 'sk-ant-nocredit-333333'])])
            let ge = events.find((e) => e.type === 'group-exhausted')
            assert.strict.deepEqual(
                [r.ok, r.failureKind, r.errorType, r.quotaExhausted, r.error.startsWith('QUOTA_EXHAUSTED: provider "anthropic:t2" has no credit on all 3 key(s)'), reqKeys().length, ge.quotaExhausted, ge.attempted, ge.failureKinds],
                [false, 'no-credit', 'http', ['anthropic:t2'], true, 3, true, 3, ['no-credit', 'no-credit', 'no-credit']],
            )
        })

        it('部分沒額度（其餘為限流）不算額度用盡：不帶quotaExhausted，error維持原樣', async function() {
            let { r, events } = await call([rest('anthropic:t3', ['sk-ant-nocredit-111111', 'sk-ant-ratelimited-22222', 'sk-ant-nocredit-333333'])])
            let ge = events.find((e) => e.type === 'group-exhausted')
            assert.strict.deepEqual(
                [r.ok, 'quotaExhausted' in r, r.error, 'quotaExhausted' in ge, ge.failureKinds],
                [false, false, 'HTTP 400', false, ['no-credit', 'rate-limit', 'no-credit']],
            )
        })

        it('CLI: 稱沒額度且經REST交叉確認 → 換下一把；全部確認沒額度 → 額度用盡', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t4a', ['sk-ant-nocredit-111111', 'sk-ant-nocredit-222222'], log)])
            assert.strict.deepEqual(
                [r.ok, r.failureKind, r.quotaExhausted, r.error.startsWith('QUOTA_EXHAUSTED'), readLog(log).length, srv.requests.length, srv.requests.every((q) => q.body.max_tokens === 1)],
                [false, 'no-credit', ['claude-api:t4a'], true, 2, 2, true],
            )
        })

        it('跨條目: CLI(claude-api:)已證實沒額度之金鑰，REST(anthropic:)同金鑰直接略過(skip-key，不送請求)——不把所有金鑰在每個條目都輪過一遍', async function() {
            let log = newLog()
            let keys = ['sk-ant-nocredit-111111', 'sk-ant-nocredit-222222']
            let { r, events } = await call([cli('claude-api:t4b', keys, log), rest('anthropic:t4b', keys)])
            let skips = events.filter((e) => e.type === 'skip-key')
            let geRest = events.find((e) => e.type === 'group-exhausted' && e.providerId === 'anthropic:t4b')
            assert.strict.deepEqual(
                [
                    r.ok,
                    skips.map((e) => [e.providerId, e.keyIndex, e.failureKind]),
                    srv.requests.filter((q) => q.body.max_tokens !== 1).length, //REST正式請求0次(只有CLI交叉確認的2次)
                    readLog(log).length,
                    r.tried.filter((t) => t.outcome === 'skip-key').length,
                    [geRest.attempted, geRest.quotaExhausted, geRest.errorTypes],
                    r.quotaExhausted,
                    r.providerId,
                    r.error.startsWith('QUOTA_EXHAUSTED: provider "anthropic:t4b"'),
                ],
                [false, [['anthropic:t4b', 0, 'no-credit'], ['anthropic:t4b', 1, 'no-credit']], 0, 2, 2, [0, true, []], ['claude-api:t4b', 'anthropic:t4b'], 'anthropic:t4b', true],
            )
        })

        it('跨條目: 中間夾一個其他原因失敗之條目、末條目金鑰全被略過 → 最終結果指向末條目之沒額度(providerId、failureKind、error三者一致，不殘留中間條目之失敗)', async function() {
            let log = newLog()
            let keys = ['sk-ant-nocredit-111111']
            let { r } = await call([
                cli('claude-api:t4m1', keys, log),
                rest('anthropic:t4m2', ['sk-ant-good-222222'], { model: 'err-500' }),
                rest('anthropic:t4m3', keys),
            ])
            assert.strict.deepEqual(
                [r.providerId, r.failureKind, r.error.startsWith('QUOTA_EXHAUSTED: provider "anthropic:t4m3"'), r.quotaExhausted, r.tried.map((t) => t.outcome)],
                ['anthropic:t4m3', 'no-credit', true, ['claude-api:t4m1', 'anthropic:t4m3'], ['next-key', 'next-key', 'skip-key']],
            )
            //外審#12: 略過時最終結果為合成之失敗結果，不把他家(CLI)之code／pid／stdout／stderr掛到未執行之REST條目上; skippedFrom標明證據來源
            assert.strict.deepEqual(
                [r.code, r.pid, r.stdout, r.stderr, r.attempts, r.skippedFrom, r.tried[2].evidenceFrom],
                [null, undefined, '', '', 0, 'claude-api:t4m1', 'claude-api:t4m1'],
            )
        })

        it('官方端點範圍: 顯式給官方baseURL(https://api.anthropic.com)視同官方，仍共享沒額度紀錄', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let { events } = await call([rest('anthropic:t4n1', keys, { baseURL: 'https://api.anthropic.com' }), rest('anthropic:t4n2', keys, { baseURL: 'https://api.anthropic.com/v1/' })])
            assert.strict.deepEqual([srv.requests.length, events.filter((e) => e.type === 'skip-key').length], [1, 1])
        })

        //外審#3: headers可覆寫認證標頭，實際認證身分不是keys[]所示，以keys[]推導之指紋不可靠
        it('範圍外: headers覆寫認證標頭(x-api-key)之條目不共享沒額度紀錄，也不把失敗算在keys[]頭上(外審二#4: keys[]皆有額度但覆寫之身分沒額度時，不得報額度用盡，後續條目可用其中一把成交)', async function() {
            let a = rest('anthropic:t4o1', ['sk-ant-good-aaaaaa', 'sk-ant-good-cccccc'], { headers: { 'X-API-KEY': 'sk-ant-nocredit-bbbbbb' } })
            let b = rest('anthropic:t4o2', ['sk-ant-good-aaaaaa'])
            let { r, events } = await call([a, b])
            assert.strict.deepEqual(
                [r.ok, r.providerId, r.tried.map((t) => t.outcome), 'quotaExhausted' in r, events.filter((e) => e.type === 'skip-key').length, events.find((e) => e.type === 'group-exhausted').quotaExhausted],
                [true, 'anthropic:t4o2', ['next-key', 'next-key', 'ok'], false, 0, undefined],
            )
        })

        it('範圍外: headers覆寫authorization之條目亦不累計額度紀錄(僅此一條失敗時也不報quotaExhausted)', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let a = rest('anthropic:t4o3', keys, { headers: { Authorization: 'Bearer other-account' } })
            let { r } = await call([a, rest('anthropic:t4o4', keys)])
            assert.strict.deepEqual([r.ok, srv.requests.length, r.quotaExhausted], [false, 2, ['anthropic:t4o4']]) //僅無覆寫之條目被判額度用盡
        })

        //外審二#2: 範圍檢查不得多讀一次呼叫端物件(只讀一次契約)；env內ANTHROPIC_BASE_URL為存取子屬性者保守視為範圍外
        it('範圍檢查不執行條目env內ANTHROPIC_BASE_URL之getter(只由dispatchClaude物化讀一次)，存取子屬性視為範圍外', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let reads = 0
            let env = {}
            let official = () => {
                reads++
                return 'https://api.anthropic.com'
            }
            Object.defineProperty(env, 'ANTHROPIC_BASE_URL', { enumerable: true, get: official })
            let { events } = await call([cli('claude-api:t4u', keys, newLog(), { env }), rest('anthropic:t4u2', keys)])
            assert.strict.deepEqual([reads, events.filter((e) => e.type === 'skip-key').length], [1, 0])
        })

        //外審#2: CLI經ANTHROPIC_BASE_URL改端點時，其額度結論不等於官方端點
        it('範圍外: CLI導向自訂端點(條目env.ANTHROPIC_BASE_URL、crossCheckBaseURL、process.env.ANTHROPIC_BASE_URL)者不與官方REST條目共享沒額度紀錄', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let r = []
            let variants = [
                (log) => cli('claude-api:t4p1', keys, log, { env: { ANTHROPIC_BASE_URL: 'http://gateway.invalid' } }),
                (log) => cli('claude-api:t4p2', keys, log, { crossCheckBaseURL: 'http://gateway.invalid' }),
            ]
            for (let mk of variants) {
                srv.requests.length = 0
                let { events } = await call([mk(newLog()), rest('anthropic:t4p9', keys)])
                r.push([srv.requests.length, events.filter((e) => e.type === 'skip-key').length]) //1次交叉確認＋1次REST正式請求，無略過
            }
            process.env.ANTHROPIC_BASE_URL = 'http://gateway.invalid'
            try {
                srv.requests.length = 0
                let { events } = await call([cli('claude-api:t4p3', keys, newLog()), rest('anthropic:t4p9b', keys)])
                r.push([srv.requests.length, events.filter((e) => e.type === 'skip-key').length])
            }
            finally {
                delete process.env.ANTHROPIC_BASE_URL
            }
            assert.strict.deepEqual(r, [[2, 0], [2, 0], [2, 0]])
        })

        it('官方端點的CLI條目(env.ANTHROPIC_BASE_URL為官方網址)仍共享沒額度紀錄', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let { events } = await call([cli('claude-api:t4q', keys, newLog(), { env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }), rest('anthropic:t4q2', keys)])
            assert.strict.deepEqual([srv.requests.length, events.filter((e) => e.type === 'skip-key').length], [1, 1])
        })

        //外審#14: isestr接受String包裝物件，指紋計算不得因型別而拋錯
        it('keys內含String包裝物件: 指紋計算不拋錯，照常成交；與同內容之原始字串金鑰指紋一致(仍共享沒額度紀錄)', async function() {
            let ok = await call([rest('anthropic:t4r', [Object('sk-ant-good-111111')])]) //Object('x')為String包裝物件
            srv.requests.length = 0
            let { events } = await call([rest('anthropic:t4r1', [Object('sk-ant-nocredit-111111')]), rest('anthropic:t4r2', ['sk-ant-nocredit-111111'])])
            assert.strict.deepEqual([ok.r.ok, ok.r.keyIndex, srv.requests.length, events.filter((e) => e.type === 'skip-key').length], [true, 0, 1, 1])
        })

        //外審#13: shouldStop於每次嘗試邊界檢查，全部略過之條目亦須遵守
        it('shouldStop為true時，即使後續條目的金鑰全被略過，也回ABORTED而非額度用盡', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let stop = false
            let shouldStop = () => stop
            let onEvent = (ev) => {
                if (ev.type === 'next-key') {
                    stop = true
                }
            }
            let { r } = await call([rest('anthropic:t4s1', keys), rest('anthropic:t4s2', keys)], { shouldStop, onEvent })
            assert.strict.deepEqual([r.errorType, r.error, r.tried.map((t) => t.outcome)], ['aborted', 'ABORTED', ['next-key', 'aborted']])
        })

        //外審#11: 月花費上限之429是沒額度不是限流，不得因原始HTTP 429而提前冷卻整個條目(與CLI路徑對稱)
        it('月花費上限429(僅error_code)＋另一把無權限: 不觸發條目冷卻；金鑰冷卻只記沒額度那把', async function() {
            let keys = ['sk-ant-spendcap-111111', 'sk-ant-forbidden-222222']
            let fp = crypto.createHash('sha256').update(keys[0]).digest('hex').slice(0, 16)
            let { r, store } = await call([rest('anthropic:t4t', keys)], { cooldownMs: 600000 })
            let st = store.peek()
            assert.strict.deepEqual(
                [r.tried.map((t) => t.failureKind), st.cooling['anthropic:t4t'], Object.keys(st.keyCooling)],
                [['no-credit', 'no-permission'], undefined, [fp]],
            )
        })

        it('跨條目略過只對「沒額度之那把」: 另一把有額度的金鑰在後續條目照常使用', async function() {
            let log = newLog()
            let keys = ['sk-ant-nocredit-111111', 'sk-ant-good-222222']
            let { r } = await call([cli('claude-api:t4c', [keys[0]], log), rest('anthropic:t4c', keys)])
            assert.strict.deepEqual(
                [r.ok, r.providerId, r.keyIndex, r.tried.map((t) => t.outcome), reqKeys().filter((k, i) => srv.requests[i].body.max_tokens !== 1)],
                [true, 'anthropic:t4c', 1, ['next-key', 'skip-key', 'ok'], ['sk-ant-good-222222']],
            )
        })

        it('自訂baseURL之條目不屬官方端點金鑰範圍: 不共享沒額度紀錄(同金鑰在其條目仍會送請求)', async function() {
            let keys = ['sk-ant-nocredit-111111']
            let a = rest('anthropic:t4d1', keys, { fetch: undefined, baseURL: srv.url })
            let b = rest('anthropic:t4d2', keys, { fetch: undefined, baseURL: srv.url })
            let { r, events } = await call([a, b])
            assert.strict.deepEqual([r.ok, srv.requests.length, events.filter((e) => e.type === 'skip-key').length, r.quotaExhausted], [false, 2, 0, ['anthropic:t4d1', 'anthropic:t4d2']])
        })

        it('cooldownMs>0: 沒額度之金鑰記入store.keyCooling(只存指紋sha256前16碼，不存金鑰本體)，並發cooled事件(scope: key)；整組沒額度之條目另記條目冷卻', async function() {
            let key = 'sk-ant-nocredit-111111'
            let { r, events, store } = await call([rest('anthropic:t4e', [key])], { cooldownMs: 600000 })
            let st = store.peek()
            let fp = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
            let cooled = events.filter((e) => e.type === 'cooled')
            assert.strict.deepEqual(
                [Object.keys(st.keyCooling), typeof st.keyCooling[fp], JSON.stringify(st).includes(key), cooled.map((e) => [e.scope, e.failureKind]), typeof st.cooling['anthropic:t4e'], r.quotaExhausted],
                [[fp], 'number', false, [['key', 'no-credit'], ['entry', 'no-credit']], 'number', ['anthropic:t4e']],
            )
        })

        it('cooldownMs未啟用: 不寫keyCooling、不發cooled事件、store形狀與此前相同', async function() {
            let { events, store } = await call([rest('anthropic:t4f', ['sk-ant-nocredit-111111'])])
            let st = store.peek()
            assert.strict.deepEqual([Object.keys(st).sort(), events.filter((e) => e.type === 'cooled').length], [['cooling', 'cursors'], 0])
        })

        it('跨次呼叫(cooldownMs>0): 冷卻中之金鑰降至組內最後(只降序不移除)——游標本應先試它，現改先試其他把', async function() {
            let keys = ['sk-ant-nocredit-bbbbbb', 'sk-ant-good-cccccc', 'sk-ant-good-aaaaaa']
            let fp = crypto.createHash('sha256').update(keys[0]).digest('hex').slice(0, 16)
            let store = mkStore({ cursors: { 'anthropic:t4g': 0 }, keyCooling: { [fp]: Date.now() } })
            let { r } = await call([rest('anthropic:t4g', keys)], { store, cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, r.keyIndex, reqKeys()], [true, 1, ['sk-ant-good-cccccc']])
        })

        it('跨次呼叫: 未啟用冷卻(cooldownMs未給)時不理keyCooling，照游標先試第一把', async function() {
            let keys = ['sk-ant-nocredit-bbbbbb', 'sk-ant-good-cccccc']
            let fp = crypto.createHash('sha256').update(keys[0]).digest('hex').slice(0, 16)
            let store = mkStore({ cursors: { 'anthropic:t4h': 0 }, keyCooling: { [fp]: Date.now() } })
            let { r } = await call([rest('anthropic:t4h', keys)], { store })
            assert.strict.deepEqual([r.ok, reqKeys()], [true, ['sk-ant-nocredit-bbbbbb', 'sk-ant-good-cccccc']])
        })

        it('全部金鑰皆在冷卻中仍會被嘗試(不移除，恢復即可偵測)', async function() {
            let keys = ['sk-ant-good-aaaaaa', 'sk-ant-good-bbbbbb']
            let fpOf = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 16)
            let store = mkStore({ keyCooling: { [fpOf(keys[0])]: Date.now(), [fpOf(keys[1])]: Date.now() } })
            let { r } = await call([rest('anthropic:t4i', keys)], { store, cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, reqKeys().length], [true, 1])
        })

        it('冷卻中之金鑰這次成功 → 立即解除其金鑰冷卻(恢復即復位)，其他把之冷卻不受影響', async function() {
            let keys = ['sk-ant-good-aaaaaa', 'sk-ant-good-bbbbbb']
            let fpOf = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 16)
            let store = mkStore({ keyCooling: { [fpOf(keys[0])]: Date.now(), [fpOf(keys[1])]: Date.now() } })
            let { r } = await call([rest('anthropic:t4l', keys)], { store, cooldownMs: 600000 })
            let kc = store.peek().keyCooling
            assert.strict.deepEqual([r.ok, r.keyIndex, kc[fpOf(keys[0])], typeof kc[fpOf(keys[1])]], [true, 0, undefined, 'number'])
        })

        it('過期之金鑰冷卻被清除並寫回store', async function() {
            let key = 'sk-ant-good-aaaaaa'
            let fp = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
            let store = mkStore({ keyCooling: { [fp]: Date.now() - 700000 } })
            let { r } = await call([rest('anthropic:t4j', [key])], { store, cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, store.peek().keyCooling[fp]], [true, undefined])
        })

        //外審二#7: 凍結(不可寫)的state不得使呼叫reject，新增的冷卻寫入一律退化為不記冷卻
        it('凍結的cooling物件或凍結的整個state(整組沒額度、cooldownMs>0)不使呼叫reject，仍回失敗結果並完成後續遞補', async function() {
            let key = 'sk-ant-nocredit-111111'
            let r = []
            for (let mk of [
                () => ({ cursors: {}, cooling: Object.freeze({}) }),
                () => Object.freeze({ cursors: {}, cooling: {} }),
                () => Object.freeze({ cursors: {}, cooling: Object.freeze({}), keyCooling: Object.freeze({}) }),
            ]) {
                let state = mk()
                let store = { get: () => state, set: () => {} }
                let { r: t } = await call([rest('anthropic:t4v1', [key]), rest('anthropic:t4v2', ['sk-ant-good-222222'])], { store, cooldownMs: 600000 })
                r.push([t.ok, t.providerId])
            }
            assert.strict.deepEqual(r, [[true, 'anthropic:t4v2'], [true, 'anthropic:t4v2'], [true, 'anthropic:t4v2']])
        })

        it('凍結state下全部沒額度仍回QUOTA_EXHAUSTED(不reject)', async function() {
            let state = Object.freeze({ cursors: {}, cooling: Object.freeze({}) })
            let store = { get: () => state, set: () => {} }
            let { r } = await call([rest('anthropic:t4w', ['sk-ant-nocredit-111111'])], { store, cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, r.error.startsWith('QUOTA_EXHAUSTED'), r.quotaExhausted], [false, true, ['anthropic:t4w']])
        })

        it('不屬官方端點金鑰範圍之kind(如api-openai-compat)不受影響: 不記keyCooling', async function() {
            let { store } = await call([{ id: 'oai:t4k', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1', model: 'x', keys: ['sk-1111111'] }], { cooldownMs: 1000, timeoutMs: 500 })
            assert.strict.equal(store.peek().keyCooling, undefined)
        })

    })

    describe('脈絡過長(context-too-long)', function() {

        it('REST: 第一把即脈絡過長 → 立即結束整個呼叫(不換金鑰、不試後續條目)，回CONTEXT_TOO_LONG並含token數', async function() {
            let { r, events } = await call([
                rest('anthropic:t5a', ['sk-ant-ctx-111111', 'sk-ant-good-222222']),
                rest('anthropic:t5a2', ['sk-ant-good-333333']),
            ])
            assert.strict.deepEqual(
                [
                    r.ok,
                    r.failureKind,
                    r.error.startsWith('CONTEXT_TOO_LONG: prompt is too long: 250000 tokens > 200000 maximum'),
                    reqKeys(),
                    r.tried.map((t) => [t.outcome, t.failureKind]),
                    r.providerId,
                    events.map((e) => e.type),
                ],
                [false, 'context-too-long', true, ['sk-ant-ctx-111111'], [['context-too-long', 'context-too-long']], 'anthropic:t5a', ['try', 'context-too-long']],
            )
        })

        it('REST: 先有沒額度之金鑰、再遇脈絡過長 → 在脈絡過長處立即結束', async function() {
            let { r } = await call([rest('anthropic:t5b', ['sk-ant-nocredit-111111', 'sk-ant-ctx-222222', 'sk-ant-good-333333'])])
            assert.strict.deepEqual([r.failureKind, r.tried.map((t) => t.outcome), reqKeys().length], ['context-too-long', ['next-key', 'context-too-long'], 2])
        })

        //外審二#5: 提前返回不得遺失先前已確認額度用盡之供應商
        it('先有供應商整組沒額度、後續條目脈絡過長 → 最終結果仍帶quotaExhausted(先前供應商)，並保留CONTEXT_TOO_LONG', async function() {
            let { r } = await call([rest('anthropic:t5g1', ['sk-ant-nocredit-111111']), rest('anthropic:t5g2', ['sk-ant-ctx-222222'])])
            assert.strict.deepEqual([r.failureKind, r.error.startsWith('CONTEXT_TOO_LONG'), r.quotaExhausted, r.providerId], ['context-too-long', true, ['anthropic:t5g1'], 'anthropic:t5g2'])
        })

        it('REST: 413(請求過大)同為脈絡過長', async function() {
            let { r } = await call([rest('anthropic:t5c', ['sk-ant-good-111111'], { model: 'err-413' }), rest('anthropic:t5c2', ['sk-ant-good-222222'])])
            assert.strict.deepEqual([r.failureKind, r.error.startsWith('CONTEXT_TOO_LONG'), reqKeys().length], ['context-too-long', true, 1])
        })

        it('CLI: 「Prompt is too long」→ 立即結束，不交叉確認(不呼叫fetch)、不換金鑰、不試後續條目', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t5d', ['sk-ant-ctx-111111', 'sk-ant-good-222222'], log), rest('anthropic:t5d', ['sk-ant-good-333333'])])
            assert.strict.deepEqual([r.ok, r.failureKind, r.error.startsWith('CONTEXT_TOO_LONG'), readLog(log).length, srv.requests.length], [false, 'context-too-long', true, 1, 0])
        })

        it('結束後不寫游標、不記冷卻(脈絡過長不是供應商或金鑰的狀態)', async function() {
            let { store } = await call([rest('anthropic:t5e', ['sk-ant-ctx-111111'])], { cooldownMs: 600000 })
            let st = store.peek()
            assert.strict.deepEqual([st.cursors, st.cooling, st.keyCooling], [{}, {}, undefined])
        })

        it('經工作流callAiWithFallback: 結果帶failureKind與CONTEXT_TOO_LONG錯誤，遞補鏈提前結束', async function() {
            let providers = {
                'anthropic:t5f': { kind: 'api-anthropic', model: 'by-key', keys: ['sk-ant-ctx-111111'], fetch: toSrv },
                'anthropic:t5f2': { kind: 'api-anthropic', model: 'by-key', keys: ['sk-ant-good-222222'], fetch: toSrv },
            }
            let r = await callAiWithFallback('abc', { providers, spec: { use: 'anthropic:t5f', fallback: ['anthropic:t5f2'] }, rawText: true, store: mkStore() })
            assert.strict.deepEqual([r.ok, r.failureKind, r.errorType, r.error.startsWith('CONTEXT_TOO_LONG'), r.tried.length, reqKeys().length], [false, 'context-too-long', 'http', true, 1, 1])
        })

    })

    describe('限流(rate-limit)、過載(overloaded)', function() {

        it('限流: 換下一把(既有規則)；cooldownMs>0且全部限流 → 條目冷卻(內建429觸發)', async function() {
            let { r, store } = await call([rest('anthropic:t6a', ['sk-ant-ratelimited-11111', 'sk-ant-ratelimited-22222'])], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.failureKind, outcomes(r), typeof store.peek().cooling['anthropic:t6a'], store.peek().keyCooling], ['rate-limit', ['next-key', 'next-key'], 'number', undefined])
        })

        it('CLI限流字樣(未給coolDetect): 內建依failureKind觸發條目冷卻', async function() {
            let log = newLog()
            let { r, store } = await call([cli('claude-api:t6b', ['sk-ant-ratelimited-11111', 'sk-ant-ratelimited-22222'], log)], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.failureKind, readLog(log).length, typeof store.peek().cooling['claude-api:t6b'], srv.requests.length], ['rate-limit', 2, 'number', 0])
        })

        it('CLI限流: 未啟用冷卻(cooldownMs未給)則不冷卻', async function() {
            let log = newLog()
            let { store } = await call([cli('claude-api:t6c', ['sk-ant-ratelimited-11111'], log)])
            assert.strict.equal(store.peek().cooling['claude-api:t6c'], undefined)
        })

        it('過載: 換下一把(既有規則)、不冷卻', async function() {
            let { r, store } = await call([rest('anthropic:t7a', ['sk-ant-overloaded-1111', 'sk-ant-good-222222'])], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, outcomes(r), r.tried[0].failureKind, store.peek().cooling['anthropic:t7a']], [true, ['next-key', 'ok'], 'overloaded', undefined])
        })

        it('CLI過載: 換下一把、不冷卻', async function() {
            let log = newLog()
            let { r, store } = await call([cli('claude-api:t7b', ['sk-ant-overloaded-1111', 'sk-ant-good-222222'], log)], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, outcomes(r), store.peek().cooling['claude-api:t7b']], [true, ['next-key', 'ok'], undefined])
        })

        it('coolDetect與內建為「或」(疊加): coolDetect回false不能否決內建觸發；coolDetect回true可增加觸發', async function() {
            let a = await call([rest('anthropic:t7c', ['sk-ant-ratelimited-11111'])], { cooldownMs: 600000, coolDetect: () => false })
            let b = await call([rest('anthropic:t7d', ['sk-ant-good-11111'], { model: 'err-500' })], { cooldownMs: 600000, coolDetect: () => true })
            let c = await call([rest('anthropic:t7e', ['sk-ant-good-11111'], { model: 'err-500' })], { cooldownMs: 600000, coolDetect: () => false })
            assert.strict.deepEqual(
                [typeof a.store.peek().cooling['anthropic:t7c'], typeof b.store.peek().cooling['anthropic:t7d'], c.store.peek().cooling['anthropic:t7e']],
                ['number', 'number', undefined],
            )
        })

    })

    describe('金鑰無效(key-invalid)、無權限(no-permission)', function() {

        it('REST: 401 → 換下一把，其餘金鑰照常；不冷卻（含條目與金鑰）', async function() {
            let { r, store } = await call([rest('anthropic:t8a', ['sk-bad-111111', 'sk-ant-good-222222'])], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, outcomes(r), r.tried[0].failureKind, store.peek().cooling['anthropic:t8a'], store.peek().keyCooling], [true, ['next-key', 'ok'], 'key-invalid', undefined, undefined])
        })

        it('REST: 全部金鑰無效 → 每把試一次，不冷卻，不算額度用盡', async function() {
            let { r, store } = await call([rest('anthropic:t8b', ['sk-bad-111111', 'sk-bad-222222'])], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.failureKind, outcomes(r), store.peek().cooling['anthropic:t8b'], 'quotaExhausted' in r], ['key-invalid', ['next-key', 'next-key'], undefined, false])
        })

        it('REST: 403 → 換下一把、不冷卻他把', async function() {
            let { r, store } = await call([rest('anthropic:t8c', ['sk-ant-forbidden-1111', 'sk-ant-good-222222'])], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, r.tried[0].failureKind, store.peek().cooling['anthropic:t8c'], store.peek().keyCooling], [true, 'no-permission', undefined, undefined])
        })

        it('CLI: Invalid API key / API Error: 403 → 換下一把，不交叉確認', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t8d', ['sk-ant-badkey-111111', 'sk-ant-forbidden-2222', 'sk-ant-good-333333'], log)])
            assert.strict.deepEqual([r.ok, r.tried.map((t) => t.failureKind), srv.requests.length], [true, ['key-invalid', 'no-permission', undefined], 0])
        })

        it('某把沒額度不牽連他把: 後續有額度之金鑰不被略過', async function() {
            let { r } = await call([rest('anthropic:t8e', ['sk-ant-nocredit-111111', 'sk-ant-good-222222', 'sk-ant-good-333333'])], { cooldownMs: 600000 })
            assert.strict.deepEqual([r.ok, r.keyIndex, reqKeys()], [true, 1, ['sk-ant-nocredit-111111', 'sk-ant-good-222222']])
        })

    })

    describe('網路(network)', function() {

        it('REST: 連不上 → 不換金鑰、整組跳過；轉接器內依maxRetries重試', async function() {
            let n = 0
            let down = async () => {
                n++
                let e = new TypeError('fetch failed')
                e.cause = { code: 'ECONNRESET' }
                throw e
            }
            let { r } = await call([rest('anthropic:t9a', ['sk-ant-good-111111', 'sk-ant-good-222222', 'sk-ant-good-333333'], { fetch: down, maxRetries: 2, retryDelayMs: 1 })])
            assert.strict.deepEqual([r.ok, r.failureKind, outcomes(r), n], [false, 'network', ['skip-group'], 3])
        })

        it('REST: 連不上後遞補下一個條目（整組跳過而非整體結束）', async function() {
            let down = async () => {
                let e = new TypeError('fetch failed')
                e.cause = { code: 'ECONNREFUSED' }
                throw e
            }
            let { r } = await call([rest('anthropic:t9b', ['sk-ant-good-111111', 'sk-ant-good-222222'], { fetch: down }), rest('anthropic:t9b2', ['sk-ant-good-333333'])])
            assert.strict.deepEqual([r.ok, r.providerId, outcomes(r)], [true, 'anthropic:t9b2', ['skip-group', 'ok']])
        })

        //外審#7: 非法金鑰(標頭值含換行)是金鑰層問題，須換把而不是整組跳過，有效金鑰不得永遠不試
        it('REST: 第一把金鑰含非法標頭字元(fetch在送出前拋出) → 視為key-invalid換下一把，有效金鑰照常成交', async function() {
            let inner = toSrv
            let picky = (url, init) => {
                if (String(init.headers['x-api-key']).includes('\n')) {
                    return Promise.reject(new TypeError('Headers.append: "bad key" is an invalid header value'))
                }
                return inner(url, init)
            }
            let { r } = await call([rest('anthropic:t9e', ['sk-ant-bad\nkey-111111', 'sk-ant-good-222222'], { fetch: picky })])
            assert.strict.deepEqual([r.ok, r.keyIndex, r.tried.map((t) => [t.outcome, t.failureKind])], [true, 1, [['next-key', 'key-invalid'], ['ok', undefined]]])
        })

        it('REST: 無法判定之fetch例外(無cause.code、非標頭問題) → other，維持既有處置(逐把換金鑰，不整組跳過)', async function() {
            let weird = async () => {
                throw new Error('something odd')
            }
            let { r } = await call([rest('anthropic:t9f', ['sk-ant-good-111111', 'sk-ant-good-222222'], { fetch: weird })])
            assert.strict.deepEqual([r.failureKind, outcomes(r)], ['other', ['next-key', 'next-key']])
        })

        it('REST: 504 timeout_error → 網路類，整組跳過', async function() {
            let { r } = await call([rest('anthropic:t9c', ['sk-ant-gwtimeout-11111', 'sk-ant-good-222222'])])
            assert.strict.deepEqual([r.failureKind, outcomes(r), reqKeys().length], ['network', ['skip-group'], 1])
        })

        it('CLI: Unable to connect to API → 不換金鑰、整組跳過、不判額度', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t9d', ['sk-ant-netdown-111111', 'sk-ant-good-222222'], log)])
            assert.strict.deepEqual([r.failureKind, outcomes(r), readLog(log).length, 'quotaExhausted' in r], ['network', ['skip-group'], 1, false])
        })

    })

    describe('呼叫方式或環境錯誤(env-error)', function() {

        it('CLI稱沒額度但同金鑰REST成功 → 不換金鑰、不判額度、整組跳過，最終error為ENV_ERROR', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t10a', ['sk-ant-envbug-111111', 'sk-ant-good-222222'], log)])
            assert.strict.deepEqual(
                [r.ok, r.failureKind, outcomes(r), readLog(log).length, 'quotaExhausted' in r, r.error.startsWith('ENV_ERROR: CLI reported no credit')],
                [false, 'env-error', ['skip-group'], 1, false, true],
            )
        })

        it('env-error之金鑰不記為沒額度: 後續條目照常使用同一把金鑰', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t10b', ['sk-ant-envbug-111111'], log), rest('anthropic:t10b', ['sk-ant-envbug-111111'])])
            assert.strict.deepEqual([r.ok, r.providerId, outcomes(r)], [true, 'anthropic:t10b', ['skip-group', 'ok']])
        })

        it('環境錯誤與無額度並存: 有額度之金鑰在其後條目仍可成交', async function() {
            let log = newLog()
            let { r } = await call([cli('claude-api:t10c', ['sk-ant-envbug-111111'], log), rest('anthropic:t10c', ['sk-ant-good-222222'])])
            assert.strict.deepEqual([r.ok, r.providerId, r.keyIndex], [true, 'anthropic:t10c', 0])
        })

    })

    describe('其他(other)與不得改變', function() {

        it('REST 500 → 既有規則: 逐把換金鑰，無quotaExhausted', async function() {
            let { r } = await call([rest('anthropic:t11a', ['sk-ant-good-111111', 'sk-ant-good-222222'], { model: 'err-500' })])
            assert.strict.deepEqual([r.failureKind, outcomes(r), 'quotaExhausted' in r], ['other', ['next-key', 'next-key'], false])
        })

        it('REST 拒答(refusal，failureKind other) → 既有規則: 整組跳過', async function() {
            let { r } = await call([rest('anthropic:t11b', ['sk-ant-good-111111', 'sk-ant-good-222222'], { model: 'refusal' })])
            assert.strict.deepEqual([r.errorType, outcomes(r)], ['refusal', ['skip-group']])
        })

        it('訂閱條目(claude無keys)失敗(即使輸出為沒額度字樣): 無failureKind、不交叉確認，tried與事件不帶此欄', async function() {
            let log = newLog()
            let { r, events } = await call([{ id: 'claude:t11c', kind: 'claude', exe: fake.exe, fetch: toSrv, extraArgs: [`--fake-log=${log}`, '--fake-always-credit'] }])
            assert.strict.deepEqual(
                [r.ok, 'failureKind' in r, r.tried.some((t) => 'failureKind' in t), events.some((e) => 'failureKind' in e), srv.requests.length, outcomes(r)],
                [false, false, false, false, 0, ['next-key']],
            )
        })

        it('一般kind(api-openai-compat)連線失敗: 維持逐把換金鑰，tried不帶failureKind', async function() {
            let { r } = await call([{ id: 'oai:t11d', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1/v1', model: 'x', keys: ['sk-aaaaaaaa', 'sk-bbbbbbbb'] }], { timeoutMs: 2000 })
            assert.strict.deepEqual([outcomes(r), r.tried.some((t) => 'failureKind' in t)], [['next-key', 'next-key'], false])
        })

        it('group-exhausted事件在無failureKind時維持舊形狀(不多failureKinds／quotaExhausted鍵)', async function() {
            let { events } = await call([{ id: 'oai:t11e', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1/v1', model: 'x', keys: ['sk-aaaaaaaa'] }], { timeoutMs: 2000 })
            let ge = events.find((e) => e.type === 'group-exhausted')
            assert.strict.deepEqual(Object.keys(ge).sort(), ['attempted', 'by', 'error', 'errorTypes', 'keyId', 'keyIndex', 'keys', 'providerId', 'type'])
        })

        it('成功不帶任何新欄位', async function() {
            let { r } = await call([rest('anthropic:t11f', ['sk-ant-good-111111'])])
            assert.strict.deepEqual([r.ok, 'failureKind' in r, 'quotaExhausted' in r, r.tried[0].outcome], [true, false, false, 'ok'])
        })

    })

})
