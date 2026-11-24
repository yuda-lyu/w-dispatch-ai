import assert from 'assert'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import createFakeOpencodeEvents from './tools/fakeOpencodeEventsForTest.mjs'


// unit-dispatchOpencodeRedact.test.mjs — dispatchOpencode之結果與回調遮蔽OPENCODE_AUTH_CONTENT所含之金鑰
//   (2026-11-24 tdai4b; 主控裁定(b), 帳本R-REDACT-3、R-REDACT-2: 同dispatchClaude之作法, 以列為單位)
//
// 規格(逐句對應下列各案):
//   S1 key與provider皆給(本轉接器注入OPENCODE_AUTH_CONTENT)時, 結果之stdout／stderr與onStdout／onStderr回調收到之文字遮蔽該金鑰(字樣***);
//      stdout為精確家族(只遮金鑰, password=與他把sk-ant-範例字樣原樣), stderr為診斷家族(另遮sk-ant-樣式與網址帳密、鍵值對、Bearer);
//   S2 回調以列為單位(收到換行才收到該列, 結尾無換行之一段於子進程結束後補送, 不以空字串呼叫), 與結果欄位所見一致;
//   S3 失敗結果(非零離開、逾時)之stdout改用診斷家族, 逾時被終止時回調仍補送結尾之一段;
//   S4 呼叫端以opt.env自給之OPENCODE_AUTH_CONTENT(不給key)所含之金鑰亦遮蔽;
//   S5 未注入任何金鑰時回調原樣(不以列為單位、不遮蔽), 行為與修前相同;
//   S6 開detectTruncation(事件流)時, 內部判讀仍見原文(finish照常), 呼叫端回調與結果stdout遮蔽。
// 假CLI只回顯其收到之OPENCODE_AUTH_CONTENT內之key, 不呼叫任何外部服務。
// 金鑰本體刻意不屬任何金鑰樣式(sk-、oc_sk_等), 令斷言只靠「已登錄之機密值」。


let ENTRY = `
let args = process.argv.slice(2)
let arg = (p) => {
    let a = args.find((x) => x.startsWith(p))
    return a ? a.slice(p.length) : ''
}
let key = ''
try {
    let j = JSON.parse(process.env.OPENCODE_AUTH_CONTENT || '{}')
    for (let p of Object.keys(j)) {
        if (j[p] && typeof j[p].key === 'string') {
            key = j[p].key
        }
    }
}
catch {}
let other = 'sk-ant-api03-OTHERLEAK1234567890abcdef'
let mode = arg('--fake-mode=')
let code = Number(arg('--fake-exit=') || 0)
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    if (mode === 'stream') {
        process.stdout.write('first ' + key.slice(0, 9))
        process.stderr.write('warn https://u1:pw12')
        setTimeout(() => {
            process.stdout.write(key.slice(9) + ' password=demo\\nsecond\\nlast-no-newline ' + key)
            process.stderr.write('34@db/a token=abc123 ' + other + '\\ntail password=zzz')
        }, 250)
        return
    }
    if (mode === 'raw') {
        process.stdout.write('part1')
        setTimeout(() => {
            process.stdout.write('part2\\n')
            process.exit(code)
        }, 250)
        return
    }
    if (mode === 'hang') {
        process.stdout.write('partial ' + key)
        process.stderr.write('perr token=abc123 ' + key)
        setInterval(() => {}, 1000)
        return
    }
    //免費池用盡／免費層429／ask被拒: 主要請求之ERROR列(--print-logs格式)或permission簽章行回顯金鑰, 令failureDetail、deniedRule等欄位帶出該文字
    let ts = new Date().toISOString()
    let logLine = (e) => 'timestamp=' + ts + ' level=ERROR run=abc123 message="stream error" providerID=opencode modelID=beam-free session.id=ses_fake small=false agent=build mode=primary error.error="' + e + '"\\n'
    if (mode === 'limit') {
        process.stderr.write(logLine('AI_APICallError: Free usage limit reached. echo ' + key + ' ok-fine'))
        setTimeout(() => process.exit(0), 60000)
        return
    }
    if (mode === 'rate') {
        process.stderr.write(logLine('AI_APICallError: Rate limit exceeded. echo ' + key))
        setTimeout(() => process.exit(0), 60000)
        return
    }
    if (mode === 'deny') {
        process.stderr.write('permission requested: external_directory (C:/x/' + key + '/*); auto-rejecting\\n')
        process.exit(0)
    }
    process.stdout.write('OK key=' + key + ' other=' + other)
    process.stderr.write(' key=' + key + ' other=' + other)
    process.exit(code)
})
process.stdin.resume()
`

let KEY = 'LEAKKEY-ocredact-0123456789'
let OTHER = 'sk-ant-api03-OTHERLEAK1234567890abcdef'


describe('dispatchOpencode之金鑰遮蔽(tdai4b)', function() {

    let fake = null
    let fakeEv = null

    before(function() {
        fake = createFakeCli('fake-oc-redact', ENTRY)
        fakeEv = createFakeOpencodeEvents('fake-oc-events-redact')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
        if (fakeEv) {
            fakeEv.clean()
        }
    })

    let run = async (opt = {}, args = []) => {
        let outChunks = []
        let errChunks = []
        let r = await dispatchOpencode('abc', {
            exe: fake.exe,
            onStdout: (c) => outChunks.push(c),
            onStderr: (c) => errChunks.push(c),
            ...opt,
            extraArgs: args,
        })
        return { r, outChunks, errChunks }
    }

    it('S1 結果之stdout／stderr遮蔽注入之金鑰(stdout只遮金鑰、stderr另遮sk-ant-樣式), 回調收到之合併文字與結果欄位一致', async function() {
        let { r, outChunks, errChunks } = await run({ key: KEY, provider: 'opencode' }, ['--fake-mode=leak'])
        assert.strict.deepEqual(
            [r.ok, r.stdout, r.stderr, outChunks.join(''), errChunks.join(''), JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [true, `OK key=*** other=${OTHER}`, ' key=*** other=***', `OK key=*** other=${OTHER}`, ' key=*** other=***', false],
        )
    })

    it('S2 回調以列為單位: 只收到完整之列、結尾無換行之一段於結束後補送、不以空字串呼叫; stdout家族保留password=、stderr家族另遮網址帳密／鍵值對／他把sk-ant-', async function() {
        let { r, outChunks, errChunks } = await run({ key: KEY, provider: 'opencode' }, ['--fake-mode=stream'])
        let so = outChunks.join('')
        let se = errChunks.join('')
        let isLines = (cs) => cs.slice(0, -1).every((c) => c.endsWith('\n')) && !cs[cs.length - 1].endsWith('\n')
        assert.strict.deepEqual(
            [r.ok, so, se, outChunks.every((c) => c !== ''), errChunks.every((c) => c !== ''), isLines(outChunks), isLines(errChunks), r.stdout === so, r.stderr === se],
            [
                true,
                'first *** password=demo\nsecond\nlast-no-newline ***',
                'warn https://***@db/a token=*** ***\ntail password=***',
                true,
                true,
                true,
                true,
                true,
                true,
            ],
        )
    })

    it('S3 失敗結果(非零離開)之stdout改用診斷家族(他把sk-ant-亦遮), error與errorDetail不含金鑰', async function() {
        let { r, outChunks, errChunks } = await run({ key: KEY, provider: 'opencode' }, ['--fake-mode=leak', '--fake-exit=1'])
        assert.strict.deepEqual(
            [r.ok, r.errorType, r.stdout, r.stderr, outChunks.join(''), JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [false, 'exec', 'OK key=*** other=***', ' key=*** other=***', `OK key=*** other=${OTHER}`, false],
        )
    })

    it('S3 子進程被逾時終止時, 回調仍補送結尾無換行之一段(已遮蔽)', async function() {
        let { r, outChunks, errChunks } = await run({ key: KEY, provider: 'opencode', timeoutMs: 2500 }, ['--fake-mode=hang'])
        assert.strict.deepEqual(
            [r.ok, r.errorType, outChunks.join(''), errChunks.join(''), JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [false, 'timeout', 'partial ***', 'perr token=*** ***', false],
        )
    })

    it('S4 呼叫端以opt.env自給OPENCODE_AUTH_CONTENT(不給key)時, 其所含之金鑰亦遮蔽(結果與回調)', async function() {
        let env = { OPENCODE_AUTH_CONTENT: JSON.stringify({ opencode: { type: 'api', key: KEY } }) }
        let { r, outChunks, errChunks } = await run({ env }, ['--fake-mode=leak'])
        assert.strict.deepEqual(
            [r.ok, r.stdout, r.stderr, outChunks.join(''), errChunks.join(''), JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [true, `OK key=*** other=${OTHER}`, ' key=*** other=***', `OK key=*** other=${OTHER}`, ' key=*** other=***', false],
        )
    })

    it('S4 只靠opt.env自給OPENCODE_AUTH_CONTENT(不給key)時, 免費池用盡／免費層429／ask被拒之判中結果之failureDetail、error、errorDetail、deniedRule亦遮蔽該金鑰(獨立複審: 這些欄位原只遮key參數)', async function() {
        let env = { OPENCODE_AUTH_CONTENT: JSON.stringify({ opencode: { type: 'api', key: KEY, note: 'ok' } }) } //note為過短之字串(不達長度下限, 不得登錄為機密值而把診斷文字中之'ok'遮掉)
        let a = await run({ env, timeoutMs: 8000 }, ['--fake-mode=limit'])
        let b = await run({ env, timeoutMs: 8000 }, ['--fake-mode=rate'])
        let c = await run({ env, timeoutMs: 8000 }, ['--fake-mode=deny'])
        let all = (x) => JSON.stringify({ r: x.r, o: x.outChunks, e: x.errChunks })
        assert.strict.deepEqual(
            [
                [a.r.ok, a.r.errorType, a.r.failureKind, a.r.failureDetail.includes('echo *** ok-fine'), all(a).includes(KEY)],
                [b.r.ok, b.r.failureKind, b.r.failureDetail.includes('echo ***'), all(b).includes(KEY)],
                [c.r.ok, c.r.errorType, c.r.deniedRule, all(c).includes(KEY)],
            ],
            [
                [false, 'quota', 'no-credit', true, false],
                [false, 'rate-limit', true, false],
                [false, 'denied', 'external_directory (C:/x/***/*)', false],
            ],
        )
    })

    it('S4 本行程環境所繼承之OPENCODE_AUTH_CONTENT(opt.env未給該變數)所含之金鑰亦遮蔽——遮蔽對象為子進程實際收到之值', async function() {
        let old = process.env.OPENCODE_AUTH_CONTENT
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ opencode: { type: 'api', key: KEY } })
        let got = null
        try {
            got = await run({}, ['--fake-mode=leak'])
        }
        finally {
            if (old === undefined) {
                delete process.env.OPENCODE_AUTH_CONTENT
            }
            else {
                process.env.OPENCODE_AUTH_CONTENT = old
            }
        }
        let { r, outChunks, errChunks } = got
        assert.strict.deepEqual(
            [r.ok, r.stdout, r.stderr, outChunks.join(''), errChunks.join(''), JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [true, `OK key=*** other=${OTHER}`, ' key=*** other=***', `OK key=*** other=${OTHER}`, ' key=*** other=***', false],
        )
    })

    it('S4 opt.env明示以undefined移除OPENCODE_AUTH_CONTENT(子進程不收到)時, 不取本行程環境之值(不為無關之值把回調改為以列為單位)', async function() {
        let old = process.env.OPENCODE_AUTH_CONTENT
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ opencode: { type: 'api', key: KEY } })
        let got = null
        try {
            got = await run({ env: { OPENCODE_AUTH_CONTENT: undefined } }, ['--fake-mode=raw'])
        }
        finally {
            if (old === undefined) {
                delete process.env.OPENCODE_AUTH_CONTENT
            }
            else {
                process.env.OPENCODE_AUTH_CONTENT = old
            }
        }
        assert.strict.deepEqual([got.r.ok, got.outChunks[0], got.outChunks.join('')], [true, 'part1', 'part1part2\n'])
    })

    it('S4 provider名稱恰為type(注入之auth內容為{"type":{"type":"api","key":…}})時, 其下之金鑰仍遮蔽(不因屬性名type略過整個子樹)', async function() {
        let { r, outChunks, errChunks } = await run({ key: KEY, provider: 'type' }, ['--fake-mode=leak'])
        assert.strict.deepEqual(
            [r.ok, r.stdout, JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [true, `OK key=*** other=${OTHER}`, false],
        )
    })

    it('S4 只靠解析auth內容取得金鑰(opt.env自給、不給key)且provider名稱恰為type時, 金鑰仍遮蔽(與key參數互為備援之另一道, 只有它抓得到)', async function() {
        let env = { OPENCODE_AUTH_CONTENT: JSON.stringify({ type: { type: 'api', key: KEY } }) }
        let { r, outChunks, errChunks } = await run({ env }, ['--fake-mode=leak'])
        assert.strict.deepEqual(
            [r.ok, r.stdout, JSON.stringify({ r, outChunks, errChunks }).includes(KEY)],
            [true, `OK key=*** other=${OTHER}`, false],
        )
    })

    it('S5 未注入任何金鑰時回調原樣(逐塊、不遮蔽), 結果原樣', async function() {
        let { r, outChunks } = await run({}, ['--fake-mode=raw'])
        assert.strict.deepEqual([r.ok, outChunks[0], outChunks.join('')], [true, 'part1', 'part1part2\n'])
    })

    it('S6 開detectTruncation(事件流): 內部判讀仍見原文(finish為stop), 結果stdout與呼叫端回調遮蔽金鑰', async function() {
        let outChunks = []
        let r = await dispatchOpencode('abc', {
            exe: fakeEv.exe,
            key: KEY,
            provider: 'opencode',
            detectTruncation: true,
            onStdout: (c) => outChunks.push(c),
            extraArgs: ['--fake-scenario=echo-args', `--secret=${KEY}`],
        })
        let arr = JSON.parse(r.stdout)
        assert.strict.deepEqual(
            [r.ok, r.finish, r.truncated, arr.includes('--secret=***'), JSON.stringify({ r, outChunks }).includes(KEY), outChunks.join('').includes('--secret=***')],
            [true, 'stop', undefined, true, false, true],
        )
    })

})
