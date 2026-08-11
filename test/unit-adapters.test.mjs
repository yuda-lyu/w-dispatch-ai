import assert from 'assert'
import keys from 'lodash-es/keys.js'
import map from 'lodash-es/map.js'
import adapters from '../src/adapters.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'


describe('adapters', function() {

    it('對照表鍵名即為可用之供應商種類', function() {
        let r = keys(adapters)
        let rr = ['opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat']
        assert.strict.deepEqual(r, rr)
    })

    it('各鍵值皆為函數', function() {
        let r = map(keys(adapters), (k) => typeof adapters[k])
        let rr = ['function', 'function', 'function', 'function', 'function']
        assert.strict.deepEqual(r, rr)
    })

    it('各鍵值即為對應模組之預設匯出', function() {
        let r = [
            adapters.opencode === dispatchOpencode,
            adapters.claude === dispatchClaude,
            adapters.codex === dispatchCodex,
            adapters.antigravity === dispatchAntigravity,
            adapters['api-openai-compat'] === dispatchApiOpenaiCompat,
        ]
        let rr = [true, true, true, true, true]
        assert.strict.deepEqual(r, rr)
    })

})
