import assert from 'assert'
import getQuotaAntigravity from '../src/quota/getQuotaAntigravity.mjs'
import createFakeCli, { createUnstartableExe } from './tools/fakeCliForTest.mjs'


//假agy: 依MODE決定--version與-p /usage之行為; 帶--log-file時寫入含applyAuthResult之log
//(模擬2026-09-05實測agy 1.1.27之print模式JSON形狀)
let codeAgy = (mode) => `
import fs from 'fs'
let args = process.argv.slice(2)
let mode = '${mode}'
let say = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o)) + '\\n')
if (args.includes('--version')) {
    if (mode === 'verhang') {
        setInterval(() => {}, 1000) //保持事件迴圈存活, 直到被逾時樹殺
        await new Promise(() => {})
    }
    if (mode === 'verexit3') {
        process.exit(3)
    }
    say(mode === 'old' ? '1.1.10' : '1.1.27')
    process.exit(0)
}
let iLog = args.indexOf('--log-file')
if (iLog >= 0) {
    fs.writeFileSync(args[iLog + 1], '[info] boot\\n[info] applyAuthResult: email=agy-user@example.com, authMethod=consumer\\n', 'utf8')
}
let cmd = args[args.indexOf('-p') + 1]
if (mode === 'prompt') {
    say({ status: 'SUCCESS', num_turns: 1, response: 'I treated it as a prompt' })
    process.exit(0)
}
if (mode === 'fail') {
    say({ status: 'ERROR', num_turns: 0, response: 'backend down', command: { name: 'usage' } })
    process.exit(0)
}
if (cmd === '/usage') {
    say('noise line before json')
    say({ status: 'SUCCESS', num_turns: 0, usage: {}, command: { name: 'usage', data: { description: 'd', groups: [
        { name: 'Gemini Models', buckets: [
            { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.7852, reset_time: '2099-01-03T00:00:00Z' },
            { id: 'gemini-5h', window: '5h', remaining_fraction: '0.9829', reset_time: '2099-01-01T05:00:00Z' },
        ] },
        { name: 'Claude and GPT models', buckets: [
            { id: '3p-5h', window: '5h', remaining_fraction: 0, reset_time: '2099-01-01T05:00:00Z' },
            { id: '3p-x', window: '3d', remaining_fraction: 1, disabled: true },
            { window: '5h', remaining_fraction: 1 },
        ] },
    ] } } })
    process.exit(0)
}
if (cmd === '/credits') {
    say({ status: 'SUCCESS', num_turns: 0, command: { name: 'credits', data: { remaining_credits: 123, upgrade_uri: 'https://x' } } })
    process.exit(0)
}
say({})
process.exit(0)
`


describe('getQuotaAntigravity', function() {

    let fakes = []
    let mkFake = (mode) => {
        let f = createFakeCli(`fake-agy-${mode}`, codeAgy(mode))
        fakes.push(f)
        return f.exe
    }

    after(function() {
        for (let f of fakes) {
            f.clean()
        }
    })

    it('成功: 版本把關通過, 自log取得email, 各群組桶正規化(剩餘比例反推已用, 字串型比例亦可), 停用/用罄之severity明示, 無id之桶略過', async function() {
        let r = await getQuotaAntigravity('', { exe: mkFake('ok'), timeoutMs: 20000 })
        let rr = [
            r.ok, r.matched, r.provider, r.email, r.plan, r.source, r.raw.version, r.raw.authMethod,
            r.windows.map((w) => `${w.key}|${w.label}|${w.usedPercent}|${w.scope}|${w.severity}`),
            r.credits,
        ]
        assert.strict.deepEqual(rr, [
            true, null, 'antigravity', 'agy-user@example.com', '', 'agy-print-usage', '1.1.27', 'consumer',
            [
                'gemini-weekly|7天(Gemini Models)|21.48|Gemini Models|normal',
                'gemini-5h|5小時(Gemini Models)|1.71|Gemini Models|normal',
                '3p-5h|5小時(Claude and GPT models)|100|Claude and GPT models|exhausted',
                '3p-x|3天(Claude and GPT models)|0|Claude and GPT models|disabled',
            ],
            null,
        ])
    })

    it('帳號比對相符與不符', async function() {
        let exe = mkFake('ok2')
        let r1 = await getQuotaAntigravity('AGY-User@example.com', { exe, timeoutMs: 20000 })
        let r2 = await getQuotaAntigravity('other@example.com', { exe, timeoutMs: 20000 })
        let rr = [[r1.ok, r1.matched], [r2.ok, r2.matched, r2.errorType, r2.windows.length]]
        assert.strict.deepEqual(rr, [[true, true], [false, false, 'account', 4]])
    })

    it('withCredits時另執行/credits取得點數', async function() {
        let r = await getQuotaAntigravity('', { exe: mkFake('ok3'), withCredits: true, timeoutMs: 20000 })
        let rr = [r.ok, r.credits, r.raw.credits !== null]
        assert.strict.deepEqual(rr, [true, { remainingCredits: 123, upgradeUri: 'https://x' }, true])
    })

    it('版本低於門檻→unsupported且不執行/usage(舊版會把它當prompt跑而耗額度); checkVersion關閉則照跑', async function() {
        let exe = mkFake('old')
        let r1 = await getQuotaAntigravity('', { exe, timeoutMs: 20000 })
        let r2 = await getQuotaAntigravity('', { exe, checkVersion: false, timeoutMs: 20000 })
        let rr = [[r1.ok, r1.errorType, /1\.1\.10.*below 1\.1\.11/.test(r1.error), r1.raw.version], [r2.ok, r2.windows.length, r2.raw.version]]
        assert.strict.deepEqual(rr, [[false, 'unsupported', true, '1.1.10'], [true, 4, '']])
    })

    it('agy把指令當prompt執行(num_turns>0)→unsupported防呆; status非SUCCESS→exit', async function() {
        let r1 = await getQuotaAntigravity('', { exe: mkFake('prompt'), timeoutMs: 20000 })
        let r2 = await getQuotaAntigravity('', { exe: mkFake('fail'), timeoutMs: 20000 })
        let rr = [[r1.ok, r1.errorType, /num_turns=1/.test(r1.error)], [r2.ok, r2.errorType, /status=ERROR/.test(r2.error)]]
        assert.strict.deepEqual(rr, [[false, 'unsupported', true], [false, 'exit', true]])
    })

    it('exe不存在→notfound且附安裝指引', async function() {
        let r = await getQuotaAntigravity('', { exe: 'agy-no-such-exe-xyz', timeoutMs: 20000 })
        let rr = [r.ok, r.errorType, /antigravity\.google\/docs\/cli/.test(r.error)]
        assert.strict.deepEqual(rr, [false, 'notfound', true])
    })

    it('子進程未能啟動(存在但無法執行之執行檔、名稱查無、入口缺失之npm shim[Windows])時: 版本把關與略過把關皆歸notfound且不reject', async function() {
        //規格: README額度errorType之notfound(憑證或執行檔不存在)與行為變更紀錄1.0.48(帳本R-SPAWN-1); npm shim入口缺失於wsemi>=1.9.17為spawn而歸notfound(1.9.16為Exit code 1而歸exit, 帳本R-USERFN-3)
        let bad = createUnstartableExe('bad-quota-agy')
        try {
            let r = []
            let cases = [[bad.exe, true], [bad.exe, false], ['agy-no-such-exe-xyz', false]]
            if (bad.shimNoEntryExe !== '') {
                cases.push([bad.shimNoEntryExe, true], [bad.shimNoEntryExe, false]) //npm shim解析為Windows特有
            }
            for (let [exe, checkVersion] of cases) {
                let t = await getQuotaAntigravity('', { exe, checkVersion, timeoutMs: 20000 })
                r.push([t.ok, t.errorType])
            }
            let rr = cases.map(() => [false, 'notfound'])
            assert.strict.deepEqual(r, rr)
        }
        finally {
            bad.clean()
        }
    })

    it('版本把關: agy --version逾時→timeout、非零離開→exit(已啟動者不歸notfound), 訊息附安裝指引', async function() {
        //規格: README額度errorType之timeout/exit與行為變更紀錄1.0.48(已啟動者不歸notfound, 訊息附安裝指引; 帳本R-SPAWN-1)
        let t1 = await getQuotaAntigravity('', { exe: mkFake('verhang'), timeoutMs: 3000 })
        let t2 = await getQuotaAntigravity('', { exe: mkFake('verexit3'), timeoutMs: 20000 })
        let r = [[t1.ok, t1.errorType, t1.error.indexOf('agy --version failed') === 0], [t2.ok, t2.errorType, /antigravity\.google\/docs\/cli/.test(t2.error)]]
        let rr = [[false, 'timeout', true], [false, 'exit', true]]
        assert.strict.deepEqual(r, rr)
    })

})
