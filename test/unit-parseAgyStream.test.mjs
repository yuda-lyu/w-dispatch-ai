import assert from 'assert'
import parseAgyStream from '../src/parseAgyStream.mjs'


//帳本: sgud/rule/rulebook_agy.md「R-AGY-4」; 事件形狀為agy 1.5.2於2026-11-07之實測形狀(init、step_update、末行result)
describe('parseAgyStream', function() {

    let ev = (o) => JSON.stringify(o)
    let init = (cid = 'c1') => ev({ event: 'init', conversation_id: cid, init: { model: 'gemini-3.8-flash-low' } })
    let step = () => ev({ event: 'step_update', step_type: 'model_response' })
    let res = (status, response, extra = {}) => ev({ event: 'result', result: { conversation_id: 'c1', status, response, num_turns: 1, ...extra } })
    let pick = (p) => [p.hasEvents, p.hasResult, p.status, p.ok, p.response, p.error]

    it('標準成功流(init、step_update、result SUCCESS): 取result.response', function() {
        let p = parseAgyStream([init(), step(), step(), res('SUCCESS', '完成\n')].join('\n') + '\n')
        assert.strict.deepEqual(pick(p), [true, true, 'SUCCESS', true, '完成\n', ''])
        assert.strict.deepEqual(p.conversationId, 'c1')
    })

    it('只有init(agy忽略不認得之輸入事件): hasEvents true、hasResult false、ok false', function() {
        assert.strict.deepEqual(pick(parseAgyStream(init() + '\n')), [true, false, '', false, '', ''])
    })

    it('空字串、非字串、無任何帶event欄之行: 皆無事件', function() {
        let r = [undefined, null, 123, {}, [], '', '   \n  ', 'hello', '[1,2]', '{"a":1}', '{"event":1}', 'not json\n{bad'].map((t) => pick(parseAgyStream(t)))
        assert.strict.deepEqual(r, new Array(12).fill([false, false, '', false, '', '']))
    })

    it('夾雜非JSON行、JSON陣列、無event欄物件、CRLF換行: 略過不拋錯, 有效事件照取', function() {
        let t = ['garbage', '[1]', '{"a":1}', init(), '', step(), res('SUCCESS', 'ok')].join('\r\n')
        assert.strict.deepEqual(pick(parseAgyStream(t)), [true, true, 'SUCCESS', true, 'ok', ''])
    })

    it('多個result: 取最後一個', function() {
        let t = [init(), res('ERROR', '', { error: 'first' }), res('SUCCESS', 'second')].join('\n')
        assert.strict.deepEqual(pick(parseAgyStream(t)), [true, true, 'SUCCESS', true, 'second', ''])
    })

    it('多段session(重試累積於同一stdout): 前一段之result不屬於最後一段; 最後一段無result即無result', function() {
        let t1 = [init('a'), res('SUCCESS', 'old'), init('b')].join('\n')
        assert.strict.deepEqual(pick(parseAgyStream(t1)), [true, false, '', false, '', ''])
        let t2 = [init('a'), res('SUCCESS', 'old'), init('b'), res('SUCCESS', 'new')].join('\n')
        assert.strict.deepEqual(pick(parseAgyStream(t2)), [true, true, 'SUCCESS', true, 'new', ''])
    })

    it('status不是SUCCESS(ERROR、缺、非字串): ok false; error字串保留、物件轉JSON、超長截500', function() {
        assert.strict.deepEqual(pick(parseAgyStream([init(), res('ERROR', '', { error: 'quota exceeded' })].join('\n'))), [true, true, 'ERROR', false, '', 'quota exceeded'])
        assert.strict.deepEqual(pick(parseAgyStream([init(), ev({ event: 'result', result: { response: 'x' } })].join('\n'))), [true, true, '', false, 'x', ''])
        assert.strict.deepEqual(pick(parseAgyStream([init(), ev({ event: 'result', result: { status: 5, response: 'x' } })].join('\n'))), [true, true, '', false, 'x', ''])
        let po = parseAgyStream([init(), res('ERROR', '', { error: { code: 429, message: 'RESOURCE_EXHAUSTED' } })].join('\n'))
        assert.strict.deepEqual(JSON.parse(po.error), { code: 429, message: 'RESOURCE_EXHAUSTED' })
        let pl = parseAgyStream([init(), res('ERROR', '', { error: 'e'.repeat(900) })].join('\n'))
        assert.strict.deepEqual(pl.error.length, 500)
    })

    it('result事件之result欄不是物件: 不算result; response非字串視為空字串', function() {
        assert.strict.deepEqual(pick(parseAgyStream([init(), ev({ event: 'result', result: 'x' })].join('\n'))), [true, false, '', false, '', ''])
        assert.strict.deepEqual(pick(parseAgyStream([init(), res('SUCCESS', null)].join('\n'))), [true, true, 'SUCCESS', true, '', ''])
    })

})
