import assert from 'assert'
import getCliArgs from '../src/getCliArgs.mjs'


describe('getCliArgs', function() {

    it('字串與陣列混合輸入可展平為一維陣列', function() {
        let r = getCliArgs('run', ['--agent', 'build'], ['-m', 'opencode/abc'])
        let rr = ['run', '--agent', 'build', '-m', 'opencode/abc']
        assert.strict.deepEqual(r, rr)
    })

    it('空陣列不產生任何參數', function() {
        let r = getCliArgs('-p', [], '--verbose')
        let rr = ['-p', '--verbose']
        assert.strict.deepEqual(r, rr)
    })

    it('非有效字串之參數一律濾除', function() {
        let r = getCliArgs('-p', undefined, null, 123, true, {}, '', '--verbose')
        let rr = ['-p', '--verbose']
        assert.strict.deepEqual(r, rr)
    })

    it('僅濾除非有效字串, 不判斷旗標配對, 故可選旗標須由呼叫端整段給或不給', function() {
        let r = [
            getCliArgs('-p', ['--model', undefined]),
            getCliArgs('-p', []),
        ]
        let rr = [
            ['-p', '--model'],
            ['-p'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('僅展開一層, 巢狀陣列內之陣列視為非字串而濾除', function() {
        let r = getCliArgs('a', ['b', ['c', 'd'], 'e'])
        let rr = ['a', 'b', 'e']
        assert.strict.deepEqual(r, rr)
    })

    it('未給任何參數回傳空陣列', function() {
        let r = getCliArgs()
        let rr = []
        assert.strict.deepEqual(r, rr)
    })

    it('保留參數原有順序與重複值', function() {
        let r = getCliArgs('--config', 'a=1', ['--config', 'a=1'])
        let rr = ['--config', 'a=1', '--config', 'a=1']
        assert.strict.deepEqual(r, rr)
    })

})
