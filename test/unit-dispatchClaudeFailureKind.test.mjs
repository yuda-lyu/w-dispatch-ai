import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchClaude from '../src/dispatchClaude.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-dispatchClaudeFailureKind.test.mjs — dispatchClaude(API金鑰在場)之失敗細分類與「沒額度」REST交叉確認(2026-10-25 dispatch-run01)
//
// 規格來源: 任務書範圍一(2)、README「失敗細分類(failureKind)」「CLI『沒額度』之交叉確認」、帳本R-ANTHROPIC-5:
//   主控重現(2026-10-25, Claude Code 2.1.302): 於Claude Code工作階段內以 env:{ANTHROPIC_API_KEY}＋--bare 呼叫claude-opus-5-5, init之apiKeySource為ANTHROPIC_API_KEY,
//   assistant與result卻皆為「Credit balance is too low」(is_error: true、費用0); 同一把金鑰經key參數(不加--bare)正常回覆並扣費, REST亦正常。
//   故CLI回「Credit balance is too low」等字樣時, 須以REST對同一把金鑰做極小請求(max_tokens: 1, haiku)確認——REST亦沒額度才判no-credit; REST成功判env-error(呼叫方式或環境錯誤), 不得當成沒額度。
//   交叉確認預設開(opt.crossCheck), fetch可注入。
// 全部以假CLI與注入之fetch驗證, 不發出任何Anthropic請求, 不讀任何.env。


//假CLI本體: 依參數決定stdout／stderr／離開碼; --fake-stream-*輸出stream-json(超長init事件＋assistant＋result, 令execCli只留前500字元時result事件被截掉)
let ENTRY = `
import fs from 'fs'
let args = process.argv.slice(2)
let opt = (name) => {
    let a = args.find((x) => x.startsWith('--' + name + '='))
    return a ? a.slice(name.length + 3) : null
}
let chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
    let rp = opt('fake-report')
    if (rp) {
        fs.writeFileSync(rp, JSON.stringify({ args, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY === undefined ? null : process.env.ANTHROPIC_API_KEY, FAKE_ENV: process.env.FAKE_ENV === undefined ? null : process.env.FAKE_ENV } }), 'utf8')
    }
    let seq = opt('fake-seq')
    if (seq !== null) {
        let texts = (opt('fake-seq-texts') || '').split('||')
        let n = fs.existsSync(seq) ? Number(fs.readFileSync(seq, 'utf8')) : 0
        fs.writeFileSync(seq, String(n + 1))
        process.stdout.write(texts[Math.min(n, texts.length - 1)] + (opt('fake-seq-nonl') ? '' : '\\n'))
        process.exit(1)
    }
    let out = opt('fake-out')
    if (out !== null) {
        process.stdout.write(out)
    }
    let err = opt('fake-err')
    if (err !== null) {
        process.stderr.write(err)
    }
    let st = opt('fake-stream-text')
    if (st !== null) {
        let ae = opt('fake-stream-ae')
        let status = opt('fake-stream-status')
        let lines = []
        lines.push(JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY', tools: 'x'.repeat(4000) }))
        lines.push(JSON.stringify({ type: 'assistant', ...(ae ? { error: ae } : {}), message: { content: [{ type: 'text', text: st }] } }))
        lines.push(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, ...(status ? { api_error_status: Number(status) } : {}), result: st, total_cost_usd: 0 }))
        process.stdout.write(lines.join('\\n') + '\\n')
    }
    let sleep = opt('fake-sleep')
    let ex = opt('fake-exit')
    setTimeout(() => process.exit(ex ? Number(ex) : 0), sleep ? Number(sleep) : 0)
})
`

let KEY = 'sk-ant-api03-CCKEY-AAAA1111BBBB2222cccc3333'
let CREDIT = 'Credit balance is too low'


//mkFetch, 注入用fetch: spec為 { status, body } 或Error(拋出); calls記下收到之請求
let mkFetch = (spec) => {
    let calls = []
    let f = async (url, init) => {
        calls.push({ url, key: init.headers['x-api-key'], version: init.headers['anthropic-version'], body: JSON.parse(init.body) })
        if (spec instanceof Error) {
            throw spec
        }
        return new Response(JSON.stringify(spec.body), { status: spec.status, headers: { 'content-type': 'application/json' } })
    }
    f.calls = calls
    return f
}
let REST_NOCREDIT = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }
let REST_OK = { status: 200, body: { id: 'msg_x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'h' }], stop_reason: 'max_tokens', usage: { input_tokens: 8, output_tokens: 1 } } }
let REST_429 = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } }
let REST_401 = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }
//netErr, 連線層錯誤(fetch例外帶cause.code): 判network
let netErr = (msg) => {
    let e = new TypeError(msg)
    e.cause = { code: 'ECONNRESET' }
    return e
}
let REST_400_OTHER = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: must be greater than or equal to 1' } } }


describe('dispatchClaude failureKind与「沒額度」交叉確認', function() {

    let fake = null
    let fd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'dispatchClaudeFailureKind')
    let seq = 0
    let seq0 = 0

    before(function() {
        fake = createFakeCli('fake-claude-fk', ENTRY)
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
        fs.rmSync(fd, { recursive: true, force: true })
    })

    //run, 呼叫dispatchClaude(假CLI)並讀回子進程收到之argv／env
    let run = async (opt = {}, args = []) => {
        let rp = path.join(fd, `rep-${process.pid}-${seq++}.json`)
        let r = await dispatchClaude('abc', { exe: fake.exe, ...opt, extraArgs: [`--fake-report=${rp}`, ...args] })
        let rep = fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, 'utf8')) : null
        return { r, rep }
    }

    describe('「沒額度」交叉確認(純文字輸出，同內建claude-api:條目)', function() {

        it('CLI稱沒額度、REST對同一把金鑰亦沒額度 → no-credit(已確認)，crossCheck記REST結果', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual(
                [r.ok, r.failureKind, r.crossCheck, f.calls.length],
                [false, 'no-credit', { done: true, restKind: 'no-credit', restStatus: 400 }, 1],
            )
        })

        it('CLI稱沒額度、REST極小請求成功 → env-error(呼叫方式或環境錯誤)，不得當成沒額度', async function() {
            //規格: 任務書「REST 成功則判為『呼叫方式或環境錯誤』(不得當成沒額度)」; 主控2026-10-25重現的正是此情形
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual(
                [r.ok, r.failureKind, r.crossCheck, f.calls.length],
                [false, 'env-error', { done: true, restKind: 'ok', restStatus: 200 }, 1],
            )
            assert.ok(r.failureDetail.includes('call method or environment error'), r.failureDetail)
            assert.ok(r.failureDetail.includes('--bare'), r.failureDetail)
        })

        it('REST交叉確認為其他結果(限流、金鑰無效、一般400、網路失敗)→ other(無法確認，不判額度)', async function() {
            let r = []
            for (let spec of [REST_429, REST_401, REST_400_OTHER, netErr('network down')]) {
                let f = mkFetch(spec)
                let t = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
                r.push([t.r.failureKind, t.r.crossCheck.done, t.r.crossCheck.restKind])
            }
            assert.strict.deepEqual(r, [
                ['other', true, 'rate-limit'],
                ['other', true, 'key-invalid'],
                ['other', true, 'other'],
                ['other', true, 'network'],
            ])
        })

        it('交叉確認的請求: 官方端點POST /v1/messages、x-api-key為同一把金鑰、max_tokens為1、模型claude-haiku-5-5、帶anthropic-version', async function() {
            let f = mkFetch(REST_NOCREDIT)
            await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            let c = f.calls[0]
            assert.strict.deepEqual(
                [c.url, c.key, c.version, c.body.max_tokens, c.body.model],
                ['https://api.anthropic.com/v1/messages', KEY, '2023-06-01', 1, 'claude-haiku-5-5'],
            )
        })

        it('crossCheckBaseURL與crossCheckModel可改端點與模型', async function() {
            let f = mkFetch(REST_NOCREDIT)
            await run({ key: KEY, fetch: f, crossCheckBaseURL: 'http://gateway.invalid/v1/', crossCheckModel: 'claude-sonnet-5-5' }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([f.calls[0].url, f.calls[0].body.model], ['http://gateway.invalid/v1/messages', 'claude-sonnet-5-5'])
        })

        it('crossCheck: false → 不做交叉確認(不呼叫fetch)，只憑CLI字樣判no-credit，crossCheck.done為false', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f, crossCheck: false }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([r.failureKind, r.crossCheck, f.calls.length], ['no-credit', { done: false }, 0])
        })

        it('crossCheck預設開: 只有明給false才關閉(undefined、null、0、空字串皆維持開)', async function() {
            let r = []
            for (let v of [undefined, null, 0, '', true]) {
                let f = mkFetch(REST_NOCREDIT)
                await run({ key: KEY, fetch: f, crossCheck: v }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
                r.push(f.calls.length)
            }
            assert.strict.deepEqual(r, [1, 1, 1, 1, 1])
        })

        it('沒額度字樣在stderr亦判之並交叉確認', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-err=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([r.failureKind, f.calls.length], ['no-credit', 1])
        })

    })

    describe('stream-json輸出(execCli失敗時stdout只留前500字元，result事件在尾端)', function() {

        it('以輸出尾段分類: assistant.error=billing_error＋「Credit balance is too low」，經REST確認 → no-credit', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-stream-text=${CREDIT}`, '--fake-stream-ae=billing_error', '--fake-exit=1'])
            //結果之stdout確實被execCli截成前500字元(result事件不在其中)——分類不是靠它
            assert.strict.deepEqual(
                [r.stdout.includes('"type":"result"'), r.stdout.includes('(truncated'), r.failureKind, f.calls.length],
                [false, true, 'no-credit', 1],
            )
        })

        it('同上但REST成功 → env-error', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-stream-text=${CREDIT}`, '--fake-stream-ae=billing_error', '--fake-exit=1'])
            assert.strict.deepEqual([r.failureKind, r.crossCheck.restKind], ['env-error', 'ok'])
        })

        it('result.api_error_status優先換算: 429→rate-limit、529→overloaded、401→key-invalid，皆不交叉確認(不呼叫fetch)', async function() {
            let r = []
            for (let st of [429, 529, 401, 403]) {
                let f = mkFetch(REST_OK)
                let t = await run({ key: KEY, fetch: f }, [`--fake-stream-text=opaque failure`, `--fake-stream-status=${st}`, '--fake-exit=1'])
                r.push([t.r.failureKind, f.calls.length])
            }
            assert.strict.deepEqual(r, [['rate-limit', 0], ['overloaded', 0], ['key-invalid', 0], ['no-permission', 0]])
        })

        it('「Prompt is too long」(invalid_request＋文字) → context-too-long，不交叉確認', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f }, ['--fake-stream-text=Prompt is too long', '--fake-stream-ae=invalid_request', '--fake-stream-status=400', '--fake-exit=1'])
            assert.strict.deepEqual([r.failureKind, f.calls.length, r.crossCheck], ['context-too-long', 0, undefined])
        })

    })

    describe('其他失敗類別(純文字，內建字樣)與不交叉確認', function() {

        let cases = [
            ['Prompt is too long', 'context-too-long'],
            ['Invalid API key · Please run /login', 'key-invalid'],
            ['API Error: 403 permission_error', 'no-permission'],
            ['API Error: 429 rate_limit_error', 'rate-limit'],
            ['Repeated 529 Overloaded errors', 'overloaded'],
            ['Unable to connect to API (ECONNREFUSED)', 'network'],
            ['something unexpected happened', 'other'],
        ]
        for (let [text, want] of cases) {
            it(`「${text}」→ ${want}，不呼叫fetch(非額度類不交叉確認)`, async function() {
                let f = mkFetch(REST_OK)
                let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${text}`, '--fake-exit=1'])
                assert.strict.deepEqual([r.ok, r.failureKind, f.calls.length, 'crossCheck' in r], [false, want, 0, false])
            })
        }

        it('逾時 → network，不呼叫fetch', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f, timeoutMs: 400 }, ['--fake-sleep=5000'])
            assert.strict.deepEqual([r.errorType, r.failureKind, f.calls.length], ['timeout', 'network', 0])
        })

        it('子進程未能啟動(spawn)→ other，不呼叫fetch', async function() {
            let f = mkFetch(REST_OK)
            let r = await dispatchClaude('abc', { exe: path.join(fd, 'no-such-claude'), key: KEY, fetch: f })
            assert.strict.deepEqual([r.errorType, r.failureKind, f.calls.length], ['spawn', 'other', 0])
        })

        it('輸出未過驗證(stdout是模型輸出，即使含額度字樣)→ other，不呼叫fetch', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f, validate: () => false }, [`--fake-out=${CREDIT}`])
            assert.strict.deepEqual([r.errorType, r.failureKind, f.calls.length], ['validation', 'other', 0])
        })

        it('離開碼0之成功結果不帶failureKind、不呼叫fetch', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`])
            assert.strict.deepEqual([r.ok, 'failureKind' in r, 'failureDetail' in r, 'crossCheck' in r, f.calls.length], [true, false, false, false, 0])
        })

        it('key含NUL字元 → INVALID_KEY，failureKind為key-invalid(與金鑰相依)', async function() {
            let r = await dispatchClaude('abc', { exe: fake.exe, key: 'sk-ant-bad\u0000key' })
            assert.strict.deepEqual([r.errorType, r.failureKind], ['exec', 'key-invalid'])
        })

    })

    describe('不得改變: 訂閱路徑(未給金鑰)', function() {

        it('未給key且env無ANTHROPIC_API_KEY: 失敗結果不帶failureKind／failureDetail／crossCheck，不呼叫fetch(即使stdout含額度字樣)', async function() {
            let f = mkFetch(REST_OK)
            let { r } = await run({ fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([r.ok, r.errorType, 'failureKind' in r, 'failureDetail' in r, 'crossCheck' in r, f.calls.length], [false, 'exec', false, false, false, 0])
        })

        it('未給key之env原樣交給子進程(物件仍只讀一次)', async function() {
            let reads = 0
            let env = { FAKE_ENV: 'keep-me' }
            let counted = () => {
                reads++
                return 'v'
            }
            Object.defineProperty(env, 'COUNTED', { enumerable: true, get: counted })
            let { r, rep } = await run({ env })
            assert.strict.deepEqual([r.ok, rep.env.FAKE_ENV, reads], [true, 'keep-me', 1])
        })

    })

    describe('opt.env.ANTHROPIC_API_KEY(不建議; 主控重現之路徑: env傳金鑰＋--bare)', function() {

        it('env傳金鑰＋--bare，CLI稱沒額度而REST成功 → env-error；交叉確認用的是env中那把金鑰；env原樣交給子進程', async function() {
            let f = mkFetch(REST_OK)
            let { r, rep } = await run({ env: { ANTHROPIC_API_KEY: KEY }, fetch: f }, ['--bare', `--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual(
                [r.failureKind, r.crossCheck.restKind, f.calls.map((c) => c.key), rep.env.ANTHROPIC_API_KEY, rep.args.includes('--bare')],
                ['env-error', 'ok', [KEY], KEY, true],
            )
            assert.ok(r.failureDetail.includes('--bare'))
        })

        it('env傳金鑰、REST亦沒額度 → no-credit；env鍵名在Windows不分大小寫', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let name = process.platform === 'win32' ? 'anthropic_api_key' : 'ANTHROPIC_API_KEY'
            let { r } = await run({ env: { [name]: KEY }, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([r.failureKind, f.calls.length], ['no-credit', 1])
        })

        it('env中ANTHROPIC_API_KEY非有效字串（空字串、數字、含NUL）→ 不視為金鑰在場，不分類', async function() {
            let r = []
            for (let v of ['', 123, 'a\u0000b']) {
                let f = mkFetch(REST_OK)
                let t = await run({ env: { ANTHROPIC_API_KEY: v }, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1']).catch(() => ({ r: { ok: false, error: 'threw' } }))
                r.push(['failureKind' in t.r, f.calls.length])
            }
            assert.strict.deepEqual(r, [[false, 0], [false, 0], [false, 0]])
        })

    })

    describe('外審回饋(2026-10-25)', function() {

        //外審#4: 以長度認定失敗文字、對全文搜尋關鍵字，會把「提到關鍵字的短模型回答」誤當API錯誤
        it('短模型回答提到關鍵字且離開碼非零 → other(純文字須以Claude Code錯誤訊息開頭)，不呼叫fetch', async function() {
            let f = mkFetch(REST_OK)
            let r = []
            for (let text of ['The phrase "Prompt is too long" means the input exceeds the window.', 'Note: Credit balance is too low is shown when funds run out.']) {
                let t = await run({ key: KEY, fetch: f }, [`--fake-out=${text}`, '--fake-exit=1'])
                r.push(t.r.failureKind)
            }
            assert.strict.deepEqual([r, f.calls.length], [['other', 'other'], 0])
        })

        //外審#5: maxRetries重試時多次嘗試之輸出累積在同一份stdout，只有最後一次嘗試決定最終分類
        it('maxRetries重試: 第一次稱限流、第二次連線失敗 → 依最後一次嘗試判network（不被先前輸出蓋過）', async function() {
            let seq = path.join(fd, `seq-${process.pid}-${seq0++}.txt`)
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f, maxRetries: 1, retryDelayMs: 1 }, [`--fake-seq=${seq}`, '--fake-seq-texts=API Error: 429 rate_limit_error||Unable to connect to API (ECONNREFUSED)'])
            assert.strict.deepEqual([r.attempts, fs.readFileSync(seq, 'utf8'), r.failureKind, f.calls.length], [2, '2', 'network', 0])
        })

        //外審二#3: 重試之輸出若沒有尾端換行，累積之串流會把兩次嘗試黏成一行; 分類改採「最後一次嘗試」之原始stdout(execCli失敗結果之stdout屬最後一次嘗試)
        it('maxRetries重試且輸出無尾端換行: 第一次「Prompt is too long」、第二次「Invalid API key」 → 依最後一次判key-invalid(不被黏在前面的前次輸出蓋過)', async function() {
            let seq = path.join(fd, `seq-${process.pid}-${seq0++}.txt`)
            let f = mkFetch(REST_OK)
            let { r } = await run({ key: KEY, fetch: f, maxRetries: 1, retryDelayMs: 1 }, [`--fake-seq=${seq}`, '--fake-seq-nonl=1', '--fake-seq-texts=Prompt is too long||Invalid API key'])
            assert.strict.deepEqual([r.attempts, r.stdout, r.failureKind, f.calls.length], [2, 'Invalid API key', 'key-invalid', 0])
        })

        //外審#8: 交叉確認與CLI共用同一次嘗試之期限，不得重新取得完整timeout
        it('交叉確認只用剩餘時間: timeoutMs 3000、CLI耗約1.5秒後稱沒額度、REST永不回應 → 整體約3秒內回傳(而非1.5+3秒)，restKind為network', async function() {
            let hang = async (url, init) => new Promise((resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    let e = new Error('aborted')
                    e.name = 'AbortError'
                    reject(e)
                })
            })
            let t0 = Date.now()
            let { r } = await run({ key: KEY, fetch: hang, timeoutMs: 3000 }, [`--fake-out=${CREDIT}`, '--fake-sleep=1500', '--fake-exit=1'])
            let ms = Date.now() - t0
            assert.strict.deepEqual([r.failureKind, r.crossCheck.restKind, ms < 3900, r.durationMs >= 1500 && r.durationMs < 3600], ['other', 'network', true, true])
        })

        it('交叉確認之耗時併入durationMs', async function() {
            let slowOk = async (url, init) => {
                await new Promise((resolve) => setTimeout(resolve, 600))
                return new Response(JSON.stringify(REST_NOCREDIT.body), { status: 400, headers: { 'content-type': 'application/json' } })
            }
            let off = await run({ key: KEY, crossCheck: false }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            let on = await run({ key: KEY, fetch: slowOk }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([on.r.failureKind, on.r.durationMs - off.r.durationMs > 350], ['no-credit', true])
        })

        //外審#10: 探測不得使dispatchClaude reject
        it('REST交叉確認之fetch拋出讀取即拋錯之物件 → other(無法確認)，不reject', async function() {
            let thrower = {
                get name() {
                    throw new Error('boom')
                },
                get message() {
                    throw new Error('boom')
                },
                get cause() {
                    throw new Error('boom')
                },
            }
            let bad = async () => {
                throw thrower
            }
            let { r } = await run({ key: KEY, fetch: bad }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([r.failureKind, r.crossCheck.restKind], ['other', 'other'])
        })

        //外審#9: 未給key時env不可讀者於啟動前以params回報，不得交下層重讀而放行
        it('未給key且env內屬性第一次讀取拋錯、第二次回傳字串 → 回params(只讀一次，不重讀放行)', async function() {
            let reads = 0
            let env = {}
            let flaky = () => {
                reads++
                if (reads === 1) {
                    throw new Error('first read fails')
                }
                return 'v'
            }
            Object.defineProperty(env, 'FLAKY', { enumerable: true, get: flaky })
            let { r } = await run({ env })
            assert.strict.deepEqual([r.ok, r.errorType, r.error.startsWith('env is not readable'), r.attempts, reads], [false, 'params', true, 0, 1])
        })

    })

    describe('金鑰不外洩與回調', function() {

        it('結果物件(含failureDetail、crossCheck)序列化後不含金鑰；CLI輸出夾帶之金鑰被遮蔽', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT} key=${KEY}`, `--fake-err=also ${KEY}`, '--fake-exit=1'])
            let json = JSON.stringify(r)
            assert.strict.deepEqual([json.includes(KEY), r.failureKind], [false, 'no-credit'])
        })

        it('failureDetail遮蔽夾帶之金鑰(失敗文字回顯金鑰時)', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}: ${KEY}`, '--fake-exit=1'])
            // 純文字須夠短; 命中文字含金鑰, failureDetail須遮蔽之
            assert.strict.deepEqual([r.failureDetail.includes(KEY), r.failureDetail.includes('[REDACTED]')], [false, true])
        })

        it('注入之fetch收到金鑰屬預期(送往Anthropic端點)，但失敗之交叉確認過程不寫入結果', async function() {
            let f = mkFetch(netErr(`failed ${KEY}`))
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual([JSON.stringify(r).includes(KEY), r.crossCheck.restKind], [false, 'network'])
        })

        it('呼叫端onStdout／onStderr回調照常收到輸出(分類用之尾段記錄不影響回調)，key模式下為已遮蔽文字', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let got = { out: '', err: '' }
            let onStdout = (c) => {
                got.out += c
            }
            let onStderr = (c) => {
                got.err += c
            }
            let { r } = await run({ key: KEY, fetch: f, onStdout, onStderr }, [`--fake-out=${CREDIT} ${KEY}`, '--fake-err=warn', '--fake-exit=1'])
            assert.strict.deepEqual([got.out.includes(CREDIT), got.out.includes(KEY), got.err, r.failureKind], [true, false, 'warn', 'no-credit'])
        })

        it('未給回調時內部記錄不外洩副作用: 結果只多failureKind／failureDetail／crossCheck三欄', async function() {
            let f = mkFetch(REST_NOCREDIT)
            let { r } = await run({ key: KEY, fetch: f }, [`--fake-out=${CREDIT}`, '--fake-exit=1'])
            assert.strict.deepEqual(Object.keys(r).filter((k) => ['failureKind', 'failureDetail', 'crossCheck'].includes(k)).sort(), ['crossCheck', 'failureDetail', 'failureKind'])
        })

    })

})
