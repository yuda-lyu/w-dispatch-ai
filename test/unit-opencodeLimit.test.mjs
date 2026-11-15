import assert from 'assert'
import { parseLogFields, classifyLimitLine, printLogsOn, logFlagsToAdd, createLimitWatch, upstreamFromLines, LINE_MAX, KEEP_LINES } from '../src/opencodeLimit.mjs'


// unit-opencodeLimit.test.mjs — opencode免費池用盡／免費層429之錯誤列判讀(wda156, Gitea #156; 帳本R-OCLIMIT-1)
//
// spec: src/opencodeLimit.mjs檔頭【判準】(①level=ERROR ②agent存在且非title ③providerID為opencode ④原因含Free usage limit reached為quota、Rate limit exceeded為rate-limit)、
//   【逐行】(只判完整行、跨區塊、每次嘗試至多一次、reset); 字樣取自本機opencode.log之實際列(見檔頭)。


//本機opencode.log之實際列形狀(session與run以假值代替)
let L = (o) => `timestamp=2026-11-15T01:00:00.000Z level=${o.level || 'ERROR'} run=ab12cd34 message="${o.msg || 'stream error'}" providerID=${o.p || 'opencode'} modelID=${o.m || 'beam-free'} session.id=ses_x small=${o.small || 'false'} agent=${o.agent || 'build'} mode=${o.mode || 'primary'} error.error="${o.e}"`
let QUOTA = 'AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go'
let QUOTA2 = 'AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go'
let QUOTA_TITLE = 'AI_RetryError: Failed after 3 attempts. Last error: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go'
let RATE = 'AI_APICallError: Rate limit exceeded. Please try again later.'


describe('opencodeLimit', function() {

    it('classifyLimitLine: 主要請求之免費池用盡(兩種實際字樣)為quota、Rate limit exceeded為rate-limit, 帶原因原文與agent／modelID', function() {
        //spec: 判準①～④
        let rr = [L({ e: QUOTA }), L({ e: QUOTA2 }), L({ e: RATE }), L({ e: QUOTA, agent: 'plan', m: 'big-pickle' })].map((l) => {
            let c = classifyLimitLine(l)
            return [c.kind, c.text, c.agent, c.modelID]
        })
        assert.strict.deepEqual(rr, [
            ['quota', QUOTA, 'build', 'beam-free'],
            ['quota', QUOTA2, 'build', 'beam-free'],
            ['rate-limit', RATE, 'build', 'beam-free'],
            ['quota', QUOTA, 'plan', 'big-pickle'],
        ])
    })

    it('classifyLimitLine: 不判者——agent=title、無agent、providerID非opencode(opencode-go等)、非ERROR級、其他原因、舊格式、非字串', function() {
        //spec: 判準②(title附帶請求不算)、③(訂閱opencode-go不臆測)、①、④; 其餘一律不判(退回修前行為)
        let cases = [
            L({ e: QUOTA_TITLE, agent: 'title', small: 'true' }),
            L({ e: QUOTA, agent: 'title' }),
            L({ e: QUOTA }).replace(' agent=build', ''),
            L({ e: QUOTA, p: 'opencode-go', m: 'glm-5.3-flash' }),
            L({ e: RATE, p: 'opencode-go' }),
            L({ e: RATE, p: 'agnes-ai' }),
            L({ e: RATE, m: 'big-pickle' }), //429只認-free模型(按量模型與無後綴者不臆測; 外審terra #18)
            L({ e: RATE, m: 'gpt-6-luna' }),
            L({ e: QUOTA, mode: 'subagent', agent: 'explore' }), //mode非primary(子agent)不算主要請求(外審terra #17)
            L({ e: QUOTA_TITLE, agent: 'title', msg: 'x agent=build x' }), //引號內之agent=build不得被當成欄位(外審terra #16)
            L({ e: QUOTA, level: 'WARN' }),
            L({ e: 'AI_APICallError: Upstream request failed: [overloaded]' }),
            'ERROR 2026-09-23T07:00:00 +12ms service=session.processor stream error AI_APICallError: Rate limit exceeded',
            `x ${L({ e: QUOTA }).replace('level=ERROR', 'level=ERRORS')}`,
            null,
            123,
        ]
        assert.strict.deepEqual(cases.map((c) => classifyLimitLine(c)), cases.map(() => null))
    })

    it('parseLogFields: 頂層key=value(引號內文字不當欄位、反斜線跳脫、同名取第一個、非key=value之詞略過); 無mode欄者不受mode限制', function() {
        //spec: 檔頭【判準】頂層解析(外審terra #16)與③「mode欄若存在須為primary」
        let f = parseLogFields('ERROR level=ERROR message="a \\"q\\" agent=build b" agent=title agent=build x error.error="e=1 f"')
        let noMode = classifyLimitLine(L({ e: QUOTA }).replace(' mode=primary', ''))
        assert.strict.deepEqual([f.level, f.message, f.agent, f['error.error'], 'x' in f, noMode && noMode.kind], ['ERROR', 'a "q" agent=build b', 'title', 'e=1 f', false, 'quota'])
    })

    it('classifyLimitLine: 去ANSI色碼與行尾CR後判讀; 原因缺error.error時退用error鍵', function() {
        //spec: 檔頭【判準】「去ANSI色碼與行尾CR後」、原因取error.error其次error
        let a = classifyLimitLine(`\u001b[91m${L({ e: QUOTA })}\u001b[0m\r`)
        let b = classifyLimitLine(L({ e: RATE }).replace('error.error=', 'error='))
        assert.strict.deepEqual([a.kind, b.kind, b.text], ['quota', 'rate-limit', RATE])
    })

    it('logFlagsToAdd: 未給任何--print-logs形式者補--print-logs(未給--log-level時另補--log-level ERROR); 已給任一形式者一律不補', function() {
        //spec: 派工〈本輪範圍〉2「呼叫端不必知道旗標、呼叫端自帶之旗標不重複」; 已給--print-logs者其層級原樣保留
        let rr = [
            [],
            ['--variant', 'high'],
            ['--log-level', 'DEBUG'],
            ['--log-level=WARN'],
            ['--print-logs'],
            ['--print-logs', '--log-level', 'INFO'],
            ['--print-logs=true'],
            ['--print-logs=false'],
            ['--no-print-logs'],
            null,
            [1, null, '--print-logs'],
            [Object('--print-logs')], //字串包裝物件亦視為已給(外審terra #15)
            [Object('--log-level=WARN')],
        ].map((a) => logFlagsToAdd(a))
        assert.strict.deepEqual(rr, [
            ['--print-logs', '--log-level', 'ERROR'],
            ['--print-logs', '--log-level', 'ERROR'],
            ['--print-logs'],
            ['--print-logs'],
            [],
            [],
            [],
            [],
            [],
            ['--print-logs', '--log-level', 'ERROR'],
            [],
            [],
            ['--print-logs'],
        ])
    })

    it('printLogsOn: --print-logs／--print-logs=true為是, --print-logs=false／--no-print-logs為否, 以最後一個為準; 皆無為否', function() {
        //spec: 檔頭(日誌列印到stderr之判定, 決定是否監看與上游原因之來源)
        let rr = [[], ['--print-logs'], ['--print-logs=true'], ['--print-logs=false'], ['--no-print-logs'], ['--print-logs', '--no-print-logs'], ['--print-logs=false', '--print-logs'], null, [Object('--print-logs=true')], ['--print-logs=TRUE']].map((a) => printLogsOn(a))
        assert.strict.deepEqual(rr, [false, true, true, false, false, false, true, false, true, false])
    })

    it('createLimitWatch: 跨區塊之行於收到換行時才判(前段不觸發); 每次嘗試至多觸發一次onHit; reset後可再觸發', function() {
        //spec: 檔頭【逐行】
        let hits = []
        let w = createLimitWatch({ onHit: (h) => hits.push(h.kind) })
        let line = `${L({ e: QUOTA })}\n`
        let k = line.indexOf('Free usage li') + 'Free usage li'.length
        w.push('> build · beam-free\r\n')
        w.push(line.slice(0, k))
        let before = [w.hit(), hits.length]
        w.push(line.slice(k))
        let after = [w.hit().kind, hits.length]
        w.push(`${L({ e: RATE })}\n`)
        let once = hits.slice()
        w.reset()
        let afterReset = [w.hit(), w.errorLines().length]
        w.push(`${L({ e: RATE })}\n`)
        assert.strict.deepEqual([before, after, once, afterReset, hits], [[null, 0], ['quota', 1], ['quota'], [null, 0], ['quota', 'rate-limit']])
    })

    it('createLimitWatch: 先見title列不觸發, 其後之主要請求列才觸發; errorLines保留本次嘗試之ERROR列(去色碼)且至多KEEP_LINES行', function() {
        //spec: 判準②; 檔頭【逐行】之errorLines
        let hits = []
        let w = createLimitWatch({ onHit: (h) => hits.push(h.agent) })
        w.push(`${L({ e: QUOTA_TITLE, agent: 'title', small: 'true' })}\n`)
        let a = hits.length
        w.push(`\u001b[91m${L({ e: QUOTA })}\u001b[0m\n`)
        let lines = w.errorLines()
        let w2 = createLimitWatch()
        for (let i = 0; i < KEEP_LINES + 5; i++) {
            w2.push(`${L({ e: `other ${i}` })}\n`)
        }
        let l2 = w2.errorLines()
        assert.strict.deepEqual([a, hits, lines.length, lines[1].includes('\u001b'), l2.length, l2[0].includes('other 5"')], [0, ['build'], 2, false, KEEP_LINES, true])
    })

    it('createLimitWatch: 色碼插在level=與ERROR之間者, 先去色碼再判讀(判中並收入errorLines)', function() {
        //spec: 檔頭【判準】「去ANSI色碼與行尾CR後」(外審agy-hydrogen #10)
        let w = createLimitWatch()
        w.push(`${L({ e: QUOTA }).replace('level=ERROR', 'level=\u001b[31mERROR\u001b[0m')}\n`)
        assert.strict.deepEqual([w.hit() && w.hit().kind, w.errorLines().length, w.errorLines()[0].includes('\u001b')], ['quota', 1, false])
    })

    it('createLimitWatch: 超過LINE_MAX之未完行捨棄至下一個換行(不判、不留), 其後之行照常判讀; 非字串區塊忽略', function() {
        //spec: 檔頭【逐行】「未完之行至多保留LINE_MAX字元(超過即捨棄該行, 不判)」
        let w = createLimitWatch()
        w.push('level=ERROR agent=build providerID=opencode error.error="Free usage limit reached ')
        w.push('x'.repeat(LINE_MAX + 10))
        w.push(' end"\n')
        let a = [w.hit(), w.errorLines().length]
        w.push(null)
        w.push(`${L({ e: RATE })}\n`)
        //同一超長行以單一區塊(含換行)送達亦捨棄(判定不隨區塊切法而異; 外審terra #9)
        let w2 = createLimitWatch()
        w2.push(`${L({ e: `${QUOTA} ${'y'.repeat(LINE_MAX)}` })}\n`)
        assert.strict.deepEqual([a, w.hit().kind, w2.hit(), w2.errorLines().length], [[null, 0], 'rate-limit', null, 0])
    })

    it('upstreamFromLines: 優先agent非title者、其次最後一筆; model為provider/model時只取相符者; 遮蔽金鑰並折為單行', function() {
        //spec: dispatchOpencode檔頭【免費池用盡與免費層429】之上游原因(日誌印到stderr時由stderr之ERROR列取, 擇一規則同opencodeUpstream之pickUpstream)
        let lines = [
            L({ e: 'first build' }),
            L({ e: QUOTA_TITLE, agent: 'title' }),
            L({ e: 'second build with key oc_sk_abcdefghijklmnop1234' }),
            L({ e: 'other model', m: 'big-pickle' }),
        ]
        let a = upstreamFromLines(lines, { model: 'opencode/beam-free' })
        let b = upstreamFromLines([lines[1]], { model: 'opencode/beam-free' })
        let c = upstreamFromLines(lines, { model: 'opencode/big-pickle' })
        let d = upstreamFromLines(lines, {})
        let e = upstreamFromLines([], { model: 'opencode/beam-free' })
        assert.strict.deepEqual([a, b.agent, c.upstream, d.upstream, e], [
            { upstream: 'second build with key ***', agent: 'build' },
            'title',
            'other model',
            'other model',
            null,
        ])
    })

})
