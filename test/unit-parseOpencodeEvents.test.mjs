import assert from 'assert'
import os from 'os'
import parseOpencodeEvents, { errorMessageOf } from '../src/parseOpencodeEvents.mjs'


// unit-parseOpencodeEvents.test.mjs — `opencode run --format json`事件流之解析(2026-11-04 da78, Gitea #78; 帳本R-OCGO-4)
//
// 對應規格句(parseOpencodeEvents.mjs檔頭):
//   E1 stdout重建: 每個text事件取part.text去頭尾空白, 非空者接os.EOL(與預設格式輸出逐位元相同, 形狀取自opencode 1.19.5實測)
//   E2 終止原因取「最後一個step_finish」之reason(正規化小寫、連字號改底線); length與content_filter屬截斷, stop與tool_calls不屬
//   E3 錯誤事件還原為`Error: 訊息`之stderr文字(訊息取error.data.message, 否則error.name; 去ANSI與開頭之Error: )
//   E4 非JSON行原樣保留於stdout; 無任何事件時hasEvents為false; 永不拋錯
//   E5 lastSessionOnly只取最後一個sessionID之事件


let EOL = os.EOL
let line = (o) => JSON.stringify(o)
let text = (t, sid = 's1') => line({ type: 'text', sessionID: sid, part: { type: 'text', text: t, time: { start: 1, end: 2 } } })
let fin = (reason, tokens, sid = 's1') => line({ type: 'step_finish', sessionID: sid, part: { type: 'step-finish', reason, tokens } })


describe('parseOpencodeEvents', function() {

    it('E1: text事件去頭尾空白後各接EOL; 空白text略過; 多個text依序串接', function() {
        let s = [text('  hello \n'), text('   \n'), text('two'), fin('stop', { total: 3, input: 1, output: 2, reasoning: 0 })].join('\n')
        let p = parseOpencodeEvents(s)
        let r = [p.hasEvents, p.stdout, p.stderr]
        let rr = [true, `hello${EOL}two${EOL}`, '']
        assert.strict.deepEqual(r, rr)
    })

    it('E1: 行尾為CRLF亦可解析; 內文換行與中文原樣保留', function() {
        let s = [text('line1\nline2\n第三行 ✓')].join('\r\n') + '\r\n'
        let p = parseOpencodeEvents(s)
        assert.strict.deepEqual(p.stdout, `line1\nline2\n第三行 ✓${EOL}`)
    })

    it('E2: stop不是截斷, finishReason為stop, tokens取最後一步', function() {
        let tk = { total: 11, input: 10, output: 1, reasoning: 0 }
        let p = parseOpencodeEvents([text('OK'), fin('stop', tk)].join('\n'))
        let r = [p.finishReason, p.truncated, p.tokens, p.steps]
        let rr = ['stop', false, tk, 1]
        assert.strict.deepEqual(r, rr)
    })

    it('E2: length屬截斷, 帶出reasoning/output token', function() {
        let tk = { total: 32010, input: 10, output: 0, reasoning: 32000 }
        let p = parseOpencodeEvents(fin('length', tk))
        let r = [p.finishReason, p.truncated, p.tokens.reasoning, p.tokens.output, p.stdout]
        let rr = ['length', true, 32000, 0, '']
        assert.strict.deepEqual(r, rr)
    })

    it('E2: 連字號改底線並正規化大小寫: content-filter → content_filter屬截斷; tool-calls不屬', function() {
        let a = parseOpencodeEvents(fin(' Content-Filter ', {}))
        let b = parseOpencodeEvents(fin('tool-calls', {}))
        let c = parseOpencodeEvents(fin('other', {}))
        let r = [[a.finishReason, a.truncated], [b.finishReason, b.truncated], [c.finishReason, c.truncated]]
        let rr = [['content_filter', true], ['tool_calls', false], ['other', false]]
        assert.strict.deepEqual(r, rr)
    })

    it('E2: 只認最後一個step_finish: 中間步length後續跑成功 → 不截斷; 最後一步length → 截斷', function() {
        let a = parseOpencodeEvents([fin('length', {}), text('recovered'), fin('stop', {})].join('\n'))
        let b = parseOpencodeEvents([text('first'), fin('stop', {}), fin('length', {})].join('\n'))
        let r = [[a.truncated, a.finishReason, a.steps], [b.truncated, b.finishReason, b.steps]]
        let rr = [[false, 'stop', 2], [true, 'length', 2]]
        assert.strict.deepEqual(r, rr)
    })

    it('E2: 無step_finish(例如被逾時殺掉的半截串流)時finishReason為空且不判截斷', function() {
        let p = parseOpencodeEvents(text('partial'))
        let r = [p.hasEvents, p.finishReason, p.truncated, p.tokens, p.steps]
        let rr = [true, '', false, null, 0]
        assert.strict.deepEqual(r, rr)
    })

    it('E3: 錯誤事件還原為Error: 訊息(取data.message; 去ANSI與重複之Error: 前綴; 無訊息用name)', function() {
        let s = [
            line({ type: 'error', error: { name: 'APIError', data: { message: 'bad request' } } }),
            line({ type: 'error', error: { name: 'APIError', data: { message: '\u001b[91mError: wrapped\u001b[0m' } } }),
            line({ type: 'error', error: { name: 'UnknownError' } }),
            line({ type: 'error' }),
        ].join('\n')
        let p = parseOpencodeEvents(s)
        assert.strict.deepEqual(p.stderr, `Error: bad request${EOL}Error: wrapped${EOL}Error: UnknownError${EOL}Error: unknown error${EOL}`)
    })

    it('E3: errorMessageOf對非物件輸入不拋錯', function() {
        let r = [null, undefined, 'x', 5, [], { data: null }].map(errorMessageOf)
        assert.strict.deepEqual(r, r.map(() => 'unknown error'))
    })

    it('E4: 非JSON行原樣保留於stdout, 順序與事件交錯', function() {
        let s = ['WARN something', text('a'), 'not json {', text('b')].join('\n')
        let p = parseOpencodeEvents(s)
        assert.strict.deepEqual(p.stdout, `WARN something${EOL}a${EOL}not json {${EOL}b${EOL}`)
    })

    it('E4: 非字串、空字串、純非JSON輸入不拋錯且hasEvents為false', function() {
        let r = [null, undefined, 5, {}, '', '   \n', 'plain text', '{"type":5}', '[1,2]'].map((x) => {
            let p = parseOpencodeEvents(x)
            return [p.hasEvents, p.truncated, p.finishReason]
        })
        assert.strict.deepEqual(r, r.map(() => [false, false, '']))
    })

    it('E4: 缺part/tokens之畸形事件不拋錯', function() {
        let p = parseOpencodeEvents([line({ type: 'text' }), line({ type: 'step_finish' }), line({ type: 'step_finish', part: { reason: 5, tokens: 'x' } })].join('\n'))
        let r = [p.hasEvents, p.stdout, p.finishReason, p.truncated, p.tokens, p.steps]
        let rr = [true, '', '', false, null, 2]
        assert.strict.deepEqual(r, rr)
    })

    it('E5: lastSessionOnly只取最後一個sessionID之事件(execCli內部重試後stdout含多次嘗試)', function() {
        let s = [text('old', 'sA'), fin('length', { reasoning: 32000 }, 'sA'), text('latest', 'sB'), fin('stop', { reasoning: 0 }, 'sB')].join('\n')
        let all = parseOpencodeEvents(s)
        let last = parseOpencodeEvents(s, { lastSessionOnly: true })
        let r = [[all.stdout, all.truncated, all.finishReason], [last.stdout, last.truncated, last.finishReason, last.sessionID]]
        let rr = [[`old${EOL}latest${EOL}`, false, 'stop'], [`latest${EOL}`, false, 'stop', 'sB']]
        assert.strict.deepEqual(r, rr)
    })

    it('E5: 最後一個session為截斷時以最後一個為準', function() {
        let s = [text('ok', 'sA'), fin('stop', {}, 'sA'), fin('length', { reasoning: 32000 }, 'sB')].join('\n')
        let p = parseOpencodeEvents(s, { lastSessionOnly: true })
        let r = [p.truncated, p.stdout, p.sessionID]
        let rr = [true, '', 'sB']
        assert.strict.deepEqual(r, rr)
    })

    it('E6: 只認已知事件類型: 全是未知類型(日後改名)時hasEvents為false, 不重建成空回應; 未知類型混在已知事件中被略過', function() {
        let unknown = [line({ type: 'message_part', part: { text: 'x' } }), line({ type: 'finish', part: { reason: 'length' } })].join('\n')
        let a = parseOpencodeEvents(unknown)
        let b = parseOpencodeEvents([line({ type: 'usage', n: 1 }), text('ok'), fin('stop', {})].join('\n'))
        let r = [[a.hasEvents, a.stdout, a.truncated], [b.hasEvents, b.stdout, b.finishReason]]
        let rr = [[false, '', false], [true, `ok${EOL}`, 'stop']]
        assert.strict.deepEqual(r, rr)
    })

    it('reasoning事件重建為Thinking: 行(僅帶--thinking時opencode才會輸出)', function() {
        let p = parseOpencodeEvents(line({ type: 'reasoning', part: { text: ' hmm ' } }))
        assert.strict.deepEqual(p.stdout, `Thinking: hmm${EOL}`)
    })

})
