import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { OUTPUT_TOKEN_MAX_ENV, DEFAULT_OUTPUT_TOKEN_MAX } from '../src/outputTokenMax.mjs'
import createFakeOpencodeEvents from './tools/fakeOpencodeEventsForTest.mjs'


// unit-opencodeTruncation.test.mjs — dispatchOpencode之輸出上限注入與截斷偵測(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 對應規格句(dispatchOpencode.mjs檔頭【單次回應輸出上限】【截斷偵測】、outputTokenMax.mjs檔頭、runExecCli.mjs檔頭【輸出重整與截斷】):
//   D1 輸出上限: 子進程環境之OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX預設為DEFAULT_OUTPUT_TOKEN_MAX; opt.outputTokenMax有效者蓋過; 呼叫端環境(opt.env、process.env)已設有效值者保留; 無效值視為未給
//   D2 預設不偵測: 未開detectTruncation時不加--format、輸出不改寫、不判截斷(行為同修前)
//   D3 開偵測: 加`--format json`; 未截斷時stdout與預設路徑逐位元相同且結果不多任何欄位
//   D4 截斷(最後一步reason為length): 失敗, errorType 'incomplete', error以INCOMPLETE_RESPONSE開頭, 帶truncated、finishReason、tokens, stdout保留已產出之部分文字, 不驗證、不重試
//   D5 acceptTruncated: length且有可見輸出者放行(標truncated:true); 可見輸出為空者仍失敗
//   D6 中間步length但最後一步stop → 不截斷; 最後一步length → 截斷
//   D7 錯誤: 離開碼與errorType同預設路徑, 錯誤訊息還原於stderr
//   D8 dispatchAiFallback遇確定性截斷: 不逐把換金鑰、不重試, 直接換下一個條目, tried記錄帶truncated


let FD_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'opencodeTruncation')


describe('dispatchOpencode之輸出上限注入與截斷偵測', function() {

    let fake = null
    let savedEnv

    before(function() {
        fake = createFakeOpencodeEvents('fake-oc-events')
        fs.mkdirSync(FD_TMP, { recursive: true })

        //本行程環境若已設該變數會干擾D1, 暫時移除並於after還原
        savedEnv = process.env[OUTPUT_TOKEN_MAX_ENV]
        delete process.env[OUTPUT_TOKEN_MAX_ENV]
    })

    after(function() {
        if (savedEnv !== undefined) {
            process.env[OUTPUT_TOKEN_MAX_ENV] = savedEnv
        }
        if (fake) {
            fake.clean()
        }
        fs.rmSync(FD_TMP, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD_TMP))
        }
        catch {}
    })

    let run = (scen, opt = {}) => dispatchOpencode('say OK', {
        exe: fake.exe,
        model: 'fake/m',
        ...opt,
        extraArgs: [`--fake-scenario=${scen}`, ...(opt.extraArgs || [])],
    })
    let EOL = os.EOL

    describe('D1 輸出上限環境變數', function() {

        let max = async (opt) => JSON.parse((await run('echo-env', opt)).stdout.trim()).max

        it('未給任何設定 → 預設值', async function() {
            assert.strict.deepEqual(await max({}), String(DEFAULT_OUTPUT_TOKEN_MAX))
        })

        it('opt.outputTokenMax有效 → 採用(數字、數字字串), 蓋過opt.env', async function() {
            let r = [
                await max({ outputTokenMax: 128000 }),
                await max({ outputTokenMax: '96000' }),
                await max({ outputTokenMax: 32000 }),
                await max({ outputTokenMax: 128000, env: { [OUTPUT_TOKEN_MAX_ENV]: '50000' } }),
            ]
            assert.strict.deepEqual(r, ['128000', '96000', '32000', '128000'])
        })

        it('opt.env已設有效值 → 保留', async function() {
            assert.strict.deepEqual(await max({ env: { [OUTPUT_TOKEN_MAX_ENV]: '50000' } }), '50000')
        })

        it('process.env已設有效值 → 保留(子進程繼承)', async function() {
            process.env[OUTPUT_TOKEN_MAX_ENV] = '48000'
            try {
                let r = [await max({}), await max({ outputTokenMax: 100000 }), await max({ env: { [OUTPUT_TOKEN_MAX_ENV]: '50000' } })]
                assert.strict.deepEqual(r, ['48000', '100000', '50000'])
            }
            finally {
                delete process.env[OUTPUT_TOKEN_MAX_ENV]
            }
        })

        it('非預期輸入視為未給: opt.outputTokenMax無效、環境內無效值 → 預設; 不報錯', async function() {
            let r = []
            for (let bad of [0, -1, 1.5, 'abc', '', null, true, Infinity, {}, []]) {
                r.push(await max({ outputTokenMax: bad }))
            }
            for (let bad of ['abc', '0', '-5', '', '64000.5']) {
                r.push(await max({ env: { [OUTPUT_TOKEN_MAX_ENV]: bad } }))
            }
            let v = String(DEFAULT_OUTPUT_TOKEN_MAX)
            assert.strict.deepEqual(r, r.map(() => v))
        })

        it('不改寫呼叫端之env物件與process.env', async function() {
            let env = { FAKE_ENV: 'x' }
            await run('stop', { env, outputTokenMax: 128000 })
            let r = [JSON.stringify(env), process.env[OUTPUT_TOKEN_MAX_ENV]]
            assert.strict.deepEqual(r, [JSON.stringify({ FAKE_ENV: 'x' }), undefined])
        })

    })

    describe('D2/D3 偵測開關與未截斷時之結構', function() {

        let argsOf = async (opt) => JSON.parse((await run('echo-args', opt)).stdout.trim())

        it('D2: 預設不加--format; detectTruncation非true值(字串、1、物件)一律視為未開', async function() {
            let r = []
            for (let v of [undefined, false, 'true', 1, {}, null]) {
                let a = await argsOf({ detectTruncation: v })
                r.push(a.includes('--format'))
            }
            assert.strict.deepEqual(r, r.map(() => false))
        })

        it('D3: detectTruncation:true → 在-m之後、extraArgs之前加--format json', async function() {
            let a = await argsOf({ detectTruncation: true })
            let i = a.indexOf('--format')
            let r = [a.slice(0, 5), a[i + 1], i < a.indexOf('--fake-scenario=echo-args')]
            let rr = [['run', '--agent', 'build', '-m', 'fake/m'], 'json', true]
            assert.strict.deepEqual(r, rr)
        })

        it('D3: 呼叫端自給--format(json或其他)時不重複加', async function() {
            //自給json時stdout為原始事件, 由text事件取出假CLI回聲之參數
            let rawArgs = async (opt) => {
                let t = await run('echo-args', opt)
                let ev = t.stdout.split('\n').map((x) => x.trim()).filter((x) => x.startsWith('{')).map((x) => JSON.parse(x)).find((e) => e.type === 'text')
                return JSON.parse(ev.part.text)
            }
            let a = await rawArgs({ detectTruncation: true, extraArgs: ['--format', 'json'] })
            let b = await argsOf({ detectTruncation: true, extraArgs: ['--format=default'] })
            let n = (x) => x.filter((s) => s.startsWith('--format')).length
            assert.strict.deepEqual([n(a), n(b)], [1, 1])
        })

        it('D3: 未截斷(stop)時stdout與預設路徑逐位元相同, 結果欄位集合不變(不多任何欄位)', async function() {
            let off = await run('stop')
            let on = await run('stop', { detectTruncation: true })
            let keys = (x) => Object.keys(x).sort()
            let r = [on.stdout, on.ok, on.code, on.error, keys(on)]
            let rr = [off.stdout, off.ok, off.code, off.error, keys(off)]
            assert.strict.deepEqual(r, rr)
            assert.strict.deepEqual(on.stdout, `hello world${EOL}`)
        })

        it('D3: 多個text、含雜訊行、工具步驟後再回答 → 與預設路徑之stdout逐位元相同', async function() {
            let r = []
            let rr = []
            for (let scen of ['multi-text', 'noise', 'tool-then-stop', 'length-then-stop']) {
                let off = await run(scen)
                let on = await run(scen, { detectTruncation: true })
                //雜訊行僅出現在事件流中之位置不同(預設路徑為stdout直出), 只比文字部分: 預設路徑之雜訊行同樣在stdout
                r.push([scen, on.ok, on.stdout])
                rr.push([scen, off.ok, off.stdout])
            }
            assert.strict.deepEqual(r, rr)
        })

        it('D3: 事件類型全未識別(日後改名)時沿用原輸出(原始事件行), 不重建成空回應、不判截斷', async function() {
            let on = await run('unknown-events', { detectTruncation: true })
            let r = [on.ok, on.stdout.includes('"type":"message_part"'), on.stdout.trim() === '', on.truncated]
            assert.strict.deepEqual(r, [true, true, false, undefined])
        })

        it('D3: 無輸出(none)時沿用原結果不拋錯', async function() {
            let on = await run('none', { detectTruncation: true })
            assert.strict.deepEqual([on.ok, on.stdout, on.truncated], [true, '', undefined])
        })

        it('D3: 呼叫端自給之onStdout仍收到串流(原始事件文字)', async function() {
            let got = ''
            let on = await run('stop', {
                detectTruncation: true,
                onStdout: (s) => {
                    got += s
                },
            })
            assert.strict.deepEqual([on.ok, got.includes('"type":"step_finish"')], [true, true])
        })

        it('呼叫端傳入之reshapeResult被剔除, 不影響結果(內部接縫不開放)', async function() {
            let on = await run('stop', { reshapeResult: () => ({ ok: true, stdout: 'HACK' }) })
            assert.strict.deepEqual(on.stdout, `hello world${EOL}`)
        })

    })

    describe('D4/D5/D6 截斷判定', function() {

        it('D4: length(有部分文字) → 失敗incomplete, 帶truncated/finishReason/tokens, 保留部分文字', async function() {
            let t = await run('length-text', { detectTruncation: true })
            let r = [t.ok, t.errorType, t.error.startsWith('INCOMPLETE_RESPONSE: finish_reason=length'), t.truncated, t.finishReason, t.tokens.reasoning, t.tokens.output, t.stdout, t.code, t.attempts]
            let rr = [false, 'incomplete', true, true, 'length', 20000, 12000, `partial {"a":${EOL}`, 0, 1]
            assert.strict.deepEqual(r, rr)
        })

        it('D4: length且無可見輸出 → 失敗, 錯誤訊息標明推理耗盡與reasoning_tokens', async function() {
            let t = await run('length-empty', { detectTruncation: true })
            let r = [t.ok, t.errorType, t.truncated, t.stdout, t.error]
            let rr = [false, 'incomplete', true, '', 'INCOMPLETE_RESPONSE: finish_reason=length; no visible output (reasoning may have used up the output token limit, reasoning_tokens=32000)']
            assert.strict.deepEqual(r, rr)
        })

        it('修前行為對照: 未開偵測時同一截斷被當成功(ok:true, 無任何截斷標記) —— 此即本案要修之靜默成功', async function() {
            let a = await run('length-text')
            let b = await run('length-empty')
            let r = [a.ok, a.truncated, a.errorType, b.ok, b.stdout, b.truncated]
            let rr = [true, undefined, undefined, true, '', undefined]
            assert.strict.deepEqual(r, rr)
        })

        it('D5: acceptTruncated:true → length有文字者放行並標truncated; 無可見輸出者仍失敗', async function() {
            let a = await run('length-text', { detectTruncation: true, acceptTruncated: true })
            let b = await run('length-empty', { detectTruncation: true, acceptTruncated: true })
            let r = [[a.ok, a.truncated, a.finishReason, a.stdout, a.error], [b.ok, b.errorType, b.truncated]]
            let rr = [[true, true, 'length', `partial {"a":${EOL}`, ''], [false, 'incomplete', true]]
            assert.strict.deepEqual(r, rr)
        })

        it('D5: acceptTruncated放行後照常驗證; 驗證不過者仍標truncated', async function() {
            let t = await run('length-text', { detectTruncation: true, acceptTruncated: true, validate: 'json' })
            let r = [t.ok, t.error, t.errorType, t.truncated, t.finishReason]
            let rr = [false, 'OUTPUT_VALIDATION_FAILED', 'validation', true, 'length']
            assert.strict.deepEqual(r, rr)
        })

        it('D5: acceptTruncated非true值(字串、1)視為未開', async function() {
            let a = await run('length-text', { detectTruncation: true, acceptTruncated: 'true' })
            let b = await run('length-text', { detectTruncation: true, acceptTruncated: 1 })
            assert.strict.deepEqual([a.ok, b.ok], [false, false])
        })

        it('D6: 只認最後一步: 中間length後recovered → 成功不截斷; stop後最後一步length → 截斷; tool-calls不屬截斷', async function() {
            let a = await run('length-then-stop', { detectTruncation: true })
            let b = await run('stop-then-length', { detectTruncation: true })
            let c = await run('tool-then-stop', { detectTruncation: true })
            let r = [[a.ok, a.stdout, a.truncated], [b.ok, b.errorType, b.truncated, b.stdout], [c.ok, c.stdout, c.truncated]]
            let rr = [[true, `recovered${EOL}`, undefined], [false, 'incomplete', true, `first${EOL}`], [true, `final answer${EOL}`, undefined]]
            assert.strict.deepEqual(r, rr)
        })

        it('D6: 同串流含多次嘗試(重試各開新session)時只看最後一個session: 舊session之文字與length不混入', async function() {
            let t = await run('two-sessions', { detectTruncation: true })
            assert.strict.deepEqual([t.ok, t.stdout, t.truncated], [true, `latest${EOL}`, undefined])
        })

        it('D6: 離開碼非0者不判截斷(即使最後一步為length): 回一般exec失敗, 不帶truncated, 錯誤訊息在stderr', async function() {
            let off = await run('length-then-error')
            let on = await run('length-then-error', { detectTruncation: true })
            let r = [on.ok, on.code, on.errorType, on.error, on.truncated, on.finishReason, on.stdout, on.stderr.includes('Error: boom after length')]
            let rr = [false, 1, 'exec', 'Exit code 1', undefined, undefined, off.stdout, true]
            assert.strict.deepEqual(r, rr)

            //自給--format json(原始事件)之路徑亦同: 失敗結果不帶truncated／finishReason
            let raw = await run('length-then-error', { detectTruncation: true, extraArgs: ['--format', 'json'] })
            assert.strict.deepEqual([raw.ok, raw.code, raw.errorType, raw.truncated, raw.finishReason], [false, 1, 'exec', undefined, undefined])
        })

        it('D4: 截斷不重試(確定性): validate+maxRetries下子進程只被呼叫1次, validate不被呼叫; 修前(未開偵測)則逐次重試', async function() {
            let cf = path.join(FD_TMP, 'count-retry.txt')
            fs.rmSync(cf, { force: true })
            let called = 0
            let on = await run('length-text', {
                detectTruncation: true,
                maxRetries: 2,
                retryDelayMs: 10,
                validate: () => {
                    called++
                    return false
                },
                extraArgs: [`--fake-count-file=${cf}`],
            })
            let n1 = fs.readFileSync(cf, 'utf8').split('\n').filter((x) => x !== '').length
            fs.rmSync(cf, { force: true })
            let off = await run('length-text', {
                maxRetries: 2,
                retryDelayMs: 10,
                validate: () => false,
                extraArgs: [`--fake-count-file=${cf}`],
            })
            let n2 = fs.readFileSync(cf, 'utf8').split('\n').filter((x) => x !== '').length
            let r = [[on.errorType, on.attempts, n1, called], [off.errorType, off.attempts, n2]]
            let rr = [['incomplete', 1, 1, 0], ['validation', 3, 3]]
            assert.strict.deepEqual(r, rr)
        })

        it('呼叫端自給--format json: stdout不改寫(原始事件), 仍判截斷', async function() {
            let ok = await run('stop', { detectTruncation: true, extraArgs: ['--format', 'json'] })
            let tr = await run('length-text', { detectTruncation: true, extraArgs: ['--format', 'json'] })
            let r = [ok.ok, ok.stdout.includes('"type":"step_finish"'), ok.truncated, tr.ok, tr.errorType, tr.truncated, tr.stdout.includes('"type"')]
            let rr = [true, true, undefined, false, 'incomplete', true, true]
            assert.strict.deepEqual(r, rr)
        })

        it('呼叫端自給其他格式(--format default): 無從偵測, 行為同未開', async function() {
            let t = await run('length-text', { detectTruncation: true, extraArgs: ['--format', 'default'] })
            assert.strict.deepEqual([t.ok, t.truncated], [true, undefined])
        })

    })

    describe('D7 錯誤路徑', function() {

        it('離開碼、errorType同預設路徑, 錯誤訊息還原於stderr, stdout為空', async function() {
            let off = await run('error')
            let on = await run('error', { detectTruncation: true })
            let r = [on.ok, on.code, on.errorType, on.error, on.stdout, on.stderr.includes('Error: boom from fake'), on.truncated]
            let rr = [off.ok, off.code, off.errorType, off.error, '', true, undefined]
            assert.strict.deepEqual(r, rr)
            assert.strict.deepEqual(off.stderr.includes('Error: boom from fake'), true)
        })

        it('事件流長於500字元而失敗(execCli失敗時stdout只留前500字元): 錯誤訊息仍還原於stderr, stdout與預設路徑同形(裁500、標明總長)', async function() {
            let off = await run('long-then-error')
            let on = await run('long-then-error', { detectTruncation: true })
            let r = [on.ok, on.code, on.stderr.includes('Error: boom from fake'), on.stdout.startsWith('xxxx'), on.stdout.includes('(truncated, total'), on.stdout.length <= off.stdout.length + 8]
            assert.strict.deepEqual(r, [false, 1, true, true, true, true])
            assert.strict.deepEqual(off.stdout.includes('(truncated, total'), true)
        })

    })

    describe('D8 dispatchAiFallback對確定性截斷之處置', function() {

        it('截斷條目不逐把換金鑰、不重試, 直接換下一個條目; tried記錄帶truncated', async function() {
            let cfA = path.join(FD_TMP, 'count-fb-a.txt')
            let cfB = path.join(FD_TMP, 'count-fb-b.txt')
            fs.rmSync(cfA, { force: true })
            fs.rmSync(cfB, { force: true })
            let t = await dispatchAiFallback('say OK', {
                providers: [
                    {
                        id: 'a-trunc',
                        kind: 'opencode',
                        exe: fake.exe,
                        model: 'fake/m',
                        provider: 'opencode',
                        keys: ['k1', 'k2', 'k3'],
                        detectTruncation: true,
                        extraArgs: ['--fake-scenario=length-text', `--fake-count-file=${cfA}`],
                    },
                    {
                        id: 'b-ok',
                        kind: 'opencode',
                        exe: fake.exe,
                        model: 'fake/m',
                        extraArgs: ['--fake-scenario=stop', `--fake-count-file=${cfB}`],
                    },
                ],
                maxRetries: 2,
                retryDelayMs: 10,
                validate: 'nonempty',
                spawnGate: false,
            })
            let nA = fs.readFileSync(cfA, 'utf8').split('\n').filter((x) => x !== '').length
            let nB = fs.readFileSync(cfB, 'utf8').split('\n').filter((x) => x !== '').length
            let ta = t.tried.find((x) => x.providerId === 'a-trunc')
            let r = [t.ok, t.stdout, nA, nB, ta.outcome, ta.errorType, ta.truncated, ta.finishReason, t.tried.map((x) => `${x.providerId}:${x.outcome}`)]
            let rr = [true, `hello world${EOL}`, 1, 1, 'skip-group', 'incomplete', true, 'length', ['a-trunc:skip-group', 'b-ok:ok']]
            assert.strict.deepEqual(r, rr)
        })

        it('同一條目未開偵測時(修前形狀): 截斷被當成功而不換條目', async function() {
            let t = await dispatchAiFallback('say OK', {
                providers: [
                    {
                        id: 'a-trunc-off',
                        kind: 'opencode',
                        exe: fake.exe,
                        model: 'fake/m',
                        extraArgs: ['--fake-scenario=length-text'],
                    },
                    { id: 'b-ok', kind: 'opencode', exe: fake.exe, model: 'fake/m', extraArgs: ['--fake-scenario=stop'] },
                ],
                validate: 'nonempty',
                spawnGate: false,
            })
            assert.strict.deepEqual([t.ok, t.stdout, t.tried.length], [true, `partial {"a":${EOL}`, 1])
        })

    })

})
