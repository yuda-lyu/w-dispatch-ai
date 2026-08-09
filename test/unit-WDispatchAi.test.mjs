import assert from 'assert'
import keys from 'lodash-es/keys.js'
import map from 'lodash-es/map.js'
import wi from '../src/WDispatchAi.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchCodex from '../src/dispatchCodex.mjs'


describe('WDispatchAi', function() {

    it('對外提供KINDS與各dispatch函數', function() {
        let r = keys(wi)
        let rr = [
            'KINDS',
            'dispatchAi',
            'dispatchOpencode',
            'dispatchClaude',
            'dispatchCodex',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('KINDS為可用之供應商種類字串陣列', function() {
        let r = wi.KINDS
        let rr = ['opencode', 'claude', 'codex']
        assert.strict.deepEqual(r, rr)
    })

    it('除KINDS外各鍵值皆為函數', function() {
        let r = map(keys(wi), (k) => typeof wi[k])
        let rr = ['object', 'function', 'function', 'function', 'function']
        assert.strict.deepEqual(r, rr)
    })

    it('各鍵值即為對應模組之預設匯出', function() {
        let r = [
            wi.dispatchAi === dispatchAi,
            wi.dispatchOpencode === dispatchOpencode,
            wi.dispatchClaude === dispatchClaude,
            wi.dispatchCodex === dispatchCodex,
        ]
        let rr = [true, true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('KINDS各項皆可由dispatchAi分派', async function() {
        let r = []
        for (let kind of wi.KINDS) {
            let t = await wi.dispatchAi(kind, '')
            r.push(t.error)
        }
        let rr = ['prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string']
        assert.strict.deepEqual(r, rr)
    })

    it('可由WDispatchAi呼叫dispatchAi', async function() {
        let t = await wi.dispatchAi('gemini', 'abc')
        let r = [t.ok, t.error]
        let rr = [false, 'unknown ai kind: "gemini" (available: opencode, claude, codex)']
        assert.strict.deepEqual(r, rr)
    })

    it('可由WDispatchAi呼叫各轉接器', async function() {
        let r = []
        for (let fn of [wi.dispatchOpencode, wi.dispatchClaude, wi.dispatchCodex]) {
            let t = await fn('')
            r.push([t.ok, t.error])
        }
        let rr = [
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
        ]
        assert.strict.deepEqual(r, rr)
    })

})
