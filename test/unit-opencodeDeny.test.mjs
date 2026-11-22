import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import parseOpencodeEvents from '../src/parseOpencodeEvents.mjs'
import providers from '../src/providers.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-opencodeDeny.test.mjs — opencode `ask`被自動拒絕而結束工作階段(離開碼仍為0)之專用errorType與continue_loop_on_deny注入選項(排程第454項; 帳本R-OCDENY-1)
//
// 規格來源: 技能dispatch-opencode〈`ask`被自動拒絕＝整個工作階段結束，離開碼仍是0〉(2026-11-13實測, opencode 1.19.5)與主控裁示(第454項):
//   S1 被拒而結束(事件流: 最後一筆為step_finish且reason為tool-calls、該步內有status為error且訊息含`rejected permission`之tool_use)者, 失敗結果回errorType 'denied'(error以PERMISSION_DENIED:開頭、failureDetail、deniedTool); 不再回ok:true或validation。
//   S2 預設輸出格式(無事件流): stderr見`permission requested: <類別> (<樣式>); auto-rejecting`簽章行且stdout為空才判定(deniedRule); validate:'nonempty'擋下之validation失敗亦改標denied。
//   S3 不誤判: 續跑之工作階段(最後一步為stop)、規則明訂deny之錯誤(訊息'The user has specified a rule…')、離開碼非0之失敗、預設格式下stdout非空者。
//   S4 遞補層: errorType 'denied'與金鑰無關, 整組跳過、改派下一條目。
//   S5 opt.continueLoopOnDeny為true才把experimental.continue_loop_on_deny:true併入注入之config(物件、JSON字串、未給config皆可; 保留其餘鍵與experimental下其他鍵); 預設不開; 非true視為未給; config字串非JSON物件以params回報(不回顯內容)。
//   S6 內建條目(含唯讀條目)一律不帶continueLoopOnDeny。
// 全部走假CLI(不呼叫真opencode); 假CLI依--scn=<名>與是否帶`--format json`輸出。


//假CLI本體
//denied: 被拒而結束(json: step_start → tool_use(write, error rejected permission) → step_finish(tool-calls), 其後無事件; 預設格式: stdout空, stderr三行)
//denied-then-stop: 被拒後續跑並收尾(json: 兩步, 最後一步stop; 預設格式: stdout 'recovered')
//denied-text-default: 預設格式下已有文字輸出才被拒(stdout 'partial text', stderr簽章行)——限制案
//deny-rule: 規則明訂deny之錯誤(訊息不含rejected permission)且續跑
//denied-exit1: 簽章行但離開碼1(一般失敗)
//plain: 正常結束(text 'ok-text', reason stop)
//echo-config: text為OPENCODE_CONFIG_CONTENT(JSON字串或空)
let ENTRY = `
let args = process.argv.slice(2)
let arg = (p) => {
    let a = args.find((x) => x.startsWith(p))
    return a ? a.slice(p.length) : ''
}
let scn = arg('--scn=')
let iFmt = args.indexOf('--format')
let json = iFmt >= 0 && args[iFmt + 1] === 'json'
let sid = 'ses_x'
let ev = (type, extra) => JSON.stringify({ type, timestamp: 1, sessionID: sid, ...extra })
let stepStart = () => ev('step_start', { part: { type: 'step-start' } })
let stepFinish = (reason) => ev('step_finish', { part: { type: 'step-finish', reason, tokens: { total: 1, input: 1, output: 0, reasoning: 0 } } })
let text = (t) => ev('text', { part: { type: 'text', text: t, time: { start: 1, end: 2 } } })
let toolErr = (msg) => ev('tool_use', { part: { type: 'tool', tool: 'write', state: { status: 'error', error: msg, input: { filePath: 'C:/outside/a.txt' } } } })
let REJ = 'The user rejected permission to use this specific tool call.'
let RULE = 'The user has specified a rule which prevents you from using this specific tool call.'
let SIG = 'permission requested: external_directory (C:/outside/*); auto-rejecting'
let out = []
let err = []
let code = 0
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    if (scn === 'denied') {
        err.push(SIG)
        if (json) {
            out.push(stepStart(), toolErr(REJ), stepFinish('tool-calls'))
        }
        else {
            err.push('✗ write C:/outside/a.txt failed', 'Error: ' + REJ)
        }
    }
    else if (scn === 'denied-then-stop') {
        err.push(SIG)
        if (json) {
            out.push(stepStart(), toolErr(REJ), stepFinish('tool-calls'), stepStart(), text('recovered'), stepFinish('stop'))
        }
        else {
            out.push('recovered')
        }
    }
    else if (scn === 'denied-text-default') {
        err.push(SIG)
        out.push(json ? text('partial text') : 'partial text')
        if (json) {
            out.push(stepFinish('tool-calls'))
        }
    }
    else if (scn === 'deny-rule') {
        if (json) {
            out.push(stepStart(), toolErr(RULE), stepFinish('tool-calls'), stepStart(), text('went on'), stepFinish('stop'))
        }
        else {
            out.push('went on')
        }
    }
    else if (scn === 'denied-exit1') {
        err.push(SIG, 'Error: boom')
        code = 1
    }
    else if (scn === 'echo-config') {
        let c = process.env.OPENCODE_CONFIG_CONTENT || ''
        out.push(json ? text(c) : c)
        if (json) {
            out.push(stepFinish('stop'))
        }
    }
    else {
        out.push(json ? text('ok-text') : 'ok-text')
        if (json) {
            out.push(stepFinish('stop'))
        }
    }
    if (out.length > 0) {
        process.stdout.write(out.join('\\n') + '\\n')
    }
    if (err.length > 0) {
        process.stderr.write(err.join('\\n') + '\\n')
    }
    process.exit(code)
})
`


describe('opencode ask被自動拒絕而結束(排程第454項)', function() {

    this.timeout(60000)

    let fake = null
    before(function() {
        fake = createFakeCli('fake-oc-deny', ENTRY)
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let call = (scn, opt = {}) => dispatchOpencode('abc', { exe: fake.exe, extraArgs: [`--scn=${scn}`], opencodeLog: false, ...opt })

    describe('parseOpencodeEvents之denied判讀', function() {

        let ev = (type, extra) => JSON.stringify({ type, sessionID: 's', ...extra })
        let rej = (msg) => ev('tool_use', { part: { type: 'tool', tool: 'bash', state: { status: 'error', error: msg } } })
        let fin = (reason) => ev('step_finish', { part: { reason } })

        it('最後一筆為step_finish(tool-calls)且該步內有rejected permission之tool_use → denied { tool }; 被拒者不一定是該步最後一筆tool_use', function() {
            let ok = ev('tool_use', { part: { type: 'tool', tool: 'read', state: { status: 'completed' } } })
            let p1 = parseOpencodeEvents([ev('step_start', {}), rej('The user rejected permission to use this specific tool call.'), fin('tool-calls')].join('\n'))
            let p2 = parseOpencodeEvents([ev('step_start', {}), rej('The user rejected permission to use this specific tool call.'), ok, fin('tool-calls')].join('\n'))
            assert.strict.deepEqual([p1.denied, p2.denied], [{ tool: 'bash' }, { tool: 'bash' }])
        })

        it('不誤判: 續跑(最後一步stop)、規則deny之訊息、被拒之後仍有事件、狀態completed、無工具名者以unknown', function() {
            let msg = 'The user rejected permission to use this specific tool call.'
            let cont = parseOpencodeEvents([ev('step_start', {}), rej(msg), fin('tool-calls'), ev('step_start', {}), ev('text', { part: { text: 'x', time: {} } }), fin('stop')].join('\n'))
            let rule = parseOpencodeEvents([ev('step_start', {}), rej('The user has specified a rule which prevents you from using this specific tool call.'), fin('tool-calls')].join('\n'))
            let trailing = parseOpencodeEvents([ev('step_start', {}), rej(msg), fin('tool-calls'), ev('text', { part: { text: 'late', time: {} } })].join('\n'))
            let completed = parseOpencodeEvents([ev('step_start', {}), ev('tool_use', { part: { tool: 'bash', state: { status: 'completed', error: msg } } }), fin('tool-calls')].join('\n'))
            let noTool = parseOpencodeEvents([ev('step_start', {}), ev('tool_use', { part: { state: { status: 'error', error: msg } } }), fin('tool-calls')].join('\n'))
            assert.strict.deepEqual([cont.denied, rule.denied, trailing.denied, completed.denied, noTool.denied], [null, null, null, null, { tool: 'unknown' }])
        })

        it('被拒之同一步已有可見文字(模型已交出答案, 被拒者為附帶之工具呼叫)不判denied; 前一步有文字而最後一步無文字者仍判(工作未完成)', function() {
            let msg = 'The user rejected permission to use this specific tool call.'
            let txt = (t) => ev('text', { part: { text: t, time: {} } })
            let sameStep = parseOpencodeEvents([ev('step_start', {}), txt('完整答案'), rej(msg), fin('tool-calls')].join('\n'))
            let sameStepRejFirst = parseOpencodeEvents([ev('step_start', {}), rej(msg), txt('完整答案'), fin('tool-calls')].join('\n'))
            let prevStepText = parseOpencodeEvents([ev('step_start', {}), txt('我將寫檔'), fin('tool-calls'), ev('step_start', {}), rej(msg), fin('tool-calls')].join('\n'))
            let emptyText = parseOpencodeEvents([ev('step_start', {}), txt('  '), rej(msg), fin('tool-calls')].join('\n'))
            assert.strict.deepEqual([sameStep.denied, sameStepRejFirst.denied, prevStepText.denied, emptyText.denied], [null, null, { tool: 'bash' }, { tool: 'bash' }])
        })

        //規格(檔頭S1): 判準為「最後一筆為step_finish且reason為tool-calls、該步內有status為error且訊息含rejected permission之tool_use」; 逐項取反(複審補: 變異D02、D03、D05存活)
        it('不誤判(終止原因、訊息、跨步): 被拒之步以stop／length收尾(模型自行結束, 非被拒而斷)、錯誤訊息只含permission而非rejected permission(如檔案系統權限錯誤)、前一步被拒而最後一步無拒絕(被拒標記不跨步外溢)', function() {
            let msg = 'The user rejected permission to use this specific tool call.'
            let ok = ev('tool_use', { part: { type: 'tool', tool: 'read', state: { status: 'completed' } } })
            let pDenied = parseOpencodeEvents([ev('step_start', {}), rej(msg), fin('tool-calls')].join('\n'))
            let stopRej = parseOpencodeEvents([ev('step_start', {}), rej(msg), fin('stop')].join('\n'))
            let lengthRej = parseOpencodeEvents([ev('step_start', {}), rej(msg), fin('length')].join('\n'))
            let fsErr = parseOpencodeEvents([ev('step_start', {}), rej('EACCES: permission denied, open C:/x/a.txt'), fin('tool-calls')].join('\n'))
            let leak = parseOpencodeEvents([ev('step_start', {}), rej(msg), fin('tool-calls'), ev('step_start', {}), ok, fin('tool-calls')].join('\n'))
            assert.strict.deepEqual([pDenied.denied, stopRej.denied, lengthRej.denied, fsErr.denied, leak.denied], [{ tool: 'bash' }, null, null, null, null])
        })

        it('只取最後一個session(lastSessionOnly)與預設值: 無事件或非事件流為null', function() {
            let a = [ev('step_start', {}), rej('The user rejected permission to use this specific tool call.'), fin('tool-calls')].map((s) => s.replace('"s"', '"s1"')).join('\n')
            let b = [ev('step_start', {}), ev('text', { part: { text: 'fine', time: {} } }), fin('stop')].map((s) => s.replace('"s"', '"s2"')).join('\n')
            assert.strict.deepEqual([parseOpencodeEvents(`${a}\n${b}`, { lastSessionOnly: true }).denied, parseOpencodeEvents(`${a}\n${b}`).denied, parseOpencodeEvents('plain text').denied, parseOpencodeEvents('').denied], [null, null, null, null])
        })

    })

    describe('dispatchOpencode: errorType denied', function() {

        it('S1 事件流(detectTruncation): 被拒而結束 → ok:false、errorType denied、error以PERMISSION_DENIED:開頭、deniedTool、failureDetail; 不帶finish／outputChars; attempts 1(修前ok:true、finish tool_calls)', async function() {
            let r = await call('denied', { detectTruncation: true })
            assert.strict.deepEqual(
                [r.ok, r.errorType, r.error.startsWith('PERMISSION_DENIED:'), r.deniedTool, r.deniedRule, r.failureDetail, 'finish' in r, 'outputChars' in r, r.attempts, r.code],
                [false, 'denied', true, 'write', '', 'tool write rejected permission', false, false, 1, 0],
            )
        })

        it('S2 預設輸出格式: stderr簽章行且stdout為空 → denied(deniedRule為類別與樣式; 帶validate nonempty者原為validation亦改標denied); 修前ok:true或validation', async function() {
            let a = await call('denied')
            let b = await call('denied', { validate: 'nonempty' })
            let c = await call('denied', { stopOnLimit: false })
            assert.strict.deepEqual(
                [a, b, c].map((r) => [r.ok, r.errorType, r.deniedRule, r.deniedTool, r.failureDetail]),
                [a, b, c].map(() => [false, 'denied', 'external_directory (C:/outside/*)', '', 'permission requested: external_directory (C:/outside/*); auto-rejecting']),
            )
        })

        it('S2 被拒而結束者不讀opencode日誌檔取上游原因(原因已明為權限規則, 不被日誌中他行程之無關列取代); 對照: 同條件之離開碼1失敗照讀日誌檔(證明日誌檔確會被讀; 註: 目前denied結果不帶errorDetail, 日誌讀取分支本就不會進入, 此案與該分支之denied守門互為備援, 鎖住「denied不帶上游日誌原因」之外顯行為)', async function() {
            let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'opencodeDenyLog')
            fs.mkdirSync(dir, { recursive: true })
            try {
                let f = path.join(dir, 'opencode.log')
                fs.writeFileSync(f, `timestamp=${new Date().toISOString()} level=ERROR run=ab12cd message="stream error" providerID=opencode-go modelID=deepseek-v4-pro agent=build error.error="FROM-LOG-FILE [overloaded]"\n`, 'utf8')
                let opt = { model: 'opencode-go/deepseek-v4-pro', opencodeLog: f, stopOnLimit: false }
                let d = await call('denied', opt)
                let x = await call('denied-exit1', opt)
                assert.strict.deepEqual(
                    [d.errorType, 'upstream' in (d.errorDetail || {}), x.errorType, (x.errorDetail || {}).upstream],
                    ['denied', false, 'exec', 'FROM-LOG-FILE [overloaded]'],
                )
            }
            finally {
                fs.rmSync(dir, { recursive: true, force: true })
                try {
                    fs.rmdirSync(path.dirname(dir))
                }
                catch {}
            }
        })

        it('S3 不誤判: 續跑之工作階段(事件流與預設格式)、規則deny、預設格式下已有文字輸出者(限制: 只在stdout為空時採信stderr簽章)、離開碼非0之失敗(維持exec)、正常結束', async function() {
            let cont = await call('denied-then-stop', { detectTruncation: true })
            let contDef = await call('denied-then-stop')
            let rule = await call('deny-rule', { detectTruncation: true })
            let textDef = await call('denied-text-default')
            let exit1 = await call('denied-exit1')
            let plain = await call('plain', { detectTruncation: true })
            assert.strict.deepEqual(
                [cont, contDef, rule, textDef, exit1, plain].map((r) => [r.ok, r.errorType]),
                [[true, undefined], [true, undefined], [true, undefined], [true, undefined], [false, 'exec'], [true, undefined]],
            )
            assert.strict.deepEqual([cont.finish, plain.finish], ['stop', 'stop'])
        })

        it('S3 事件流可讀者只信事件流(不另看stderr): 事件流顯示續跑而stderr有簽章行 → 不判denied', async function() {
            let r = await call('denied-then-stop', { detectTruncation: true })
            assert.strict.deepEqual([r.ok, r.stdout.trim()], [true, 'recovered'])
        })

        it('S4 遞補層: errorType denied與金鑰無關 → 整組跳過(skip-group)、改派下一條目; tried帶errorType denied', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [
                    { id: 'oc:denied', kind: 'opencode', exe: fake.exe, extraArgs: ['--scn=denied'], keys: ['k1', 'k2'], provider: 'p', opencodeLog: false },
                    { id: 'oc:plain', kind: 'opencode', exe: fake.exe, extraArgs: ['--scn=plain'], opencodeLog: false },
                ],
            })
            assert.strict.deepEqual(
                [r.ok, r.providerId, r.tried.map((t) => [t.providerId, t.outcome, t.errorType])],
                [true, 'oc:plain', [['oc:denied', 'skip-group', 'denied'], ['oc:plain', 'ok', undefined]]],
            )
        })

    })

    describe('opt.continueLoopOnDeny: 併入注入之config', function() {

        let cfgOf = async (opt) => {
            let r = await call('echo-config', opt)
            return r.stdout.trim() === '' ? null : JSON.parse(r.stdout.trim())
        }

        it('S5 恰為true才併入: 未給config → 單獨注入; config物件、JSON字串 → 保留其餘鍵與experimental下其他鍵並加continue_loop_on_deny:true; 未給／false／\'true\'／1 → 不注入(維持沿用使用者既有設定檔)', async function() {
            let on = { experimental: { continue_loop_on_deny: true } }
            assert.strict.deepEqual(await cfgOf({ continueLoopOnDeny: true }), on)
            assert.strict.deepEqual(await cfgOf({ continueLoopOnDeny: true, config: { permission: { edit: 'allow' }, experimental: { other: 1 } } }), { permission: { edit: 'allow' }, experimental: { other: 1, continue_loop_on_deny: true } })
            assert.strict.deepEqual(await cfgOf({ continueLoopOnDeny: true, config: JSON.stringify({ model: 'm', experimental: { continue_loop_on_deny: false } }) }), { model: 'm', experimental: { continue_loop_on_deny: true } })
            let off = []
            for (let v of [undefined, false, 'true', 1, null, {}]) {
                off.push(await cfgOf({ continueLoopOnDeny: v }))
            }
            assert.strict.deepEqual(off, [null, null, null, null, null, null])
            assert.strict.deepEqual(await cfgOf({ config: { permission: { edit: 'allow' } } }), { permission: { edit: 'allow' } }) //未開時config原樣, 不加experimental
        })

        it('S5 config為字串而非JSON物件(含陣列、非JSON)且continueLoopOnDeny為true → params, 不起子行程、訊息不回顯config內容; 未開時字串config照舊原樣注入', async function() {
            let secret = 'SECRET-IN-CONFIG-77'
            let r = []
            for (let c of [secret, `[${JSON.stringify(secret)}]`, `"${secret}"`, '123']) {
                let t = await call('plain', { continueLoopOnDeny: true, config: c })
                r.push([t.ok, t.errorType, t.attempts, t.error.includes(secret)])
            }
            assert.strict.deepEqual(r, [[false, 'params', 0, false], [false, 'params', 0, false], [false, 'params', 0, false], [false, 'params', 0, false]])
            let raw = await call('echo-config', { config: '{"a":1}' })
            assert.strict.deepEqual(raw.stdout.trim(), '{"a":1}')
        })

        it('S5 開啟後被拒之工作階段由假CLI續跑時行為不變(本套件只注入config, 不改權限規則): 結果ok:true並帶續跑之文字', async function() {
            let r = await call('denied-then-stop', { continueLoopOnDeny: true, detectTruncation: true })
            assert.strict.deepEqual([r.ok, r.stdout.trim(), r.finish], [true, 'recovered', 'stop'])
        })

        it('S6 內建條目(含OC_READONLY唯讀條目)一律不帶continueLoopOnDeny(加了會使被鎖擋下之回覆變成看似成功而遞補鏈不換家)', function() {
            let withKey = providers.filter((p) => Object.prototype.hasOwnProperty.call(p, 'continueLoopOnDeny')).map((p) => p.id)
            let text = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'providers.mjs'), 'utf8')
            let ro = providers.filter((p) => p.kind === 'opencode' && p.config && p.config.permission && p.config.permission.edit === 'deny').length
            assert.strict.deepEqual([withKey, /continueLoopOnDeny/.test(text), ro > 0], [[], false, true])
        })

    })

})
