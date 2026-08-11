import assert from 'assert'
import keys from 'lodash-es/keys.js'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import { NO_SIDE_EFFECT } from '../src/wkf/callAiWithFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('dispatchAiWkf', function() {

    let fake = null
    let providers = null

    before(function() {
        fake = createFakeCli('fake-wkf-factory')
        providers = {
            'p-a': { kind: 'claude', exe: fake.exe, model: 'sonnet' },
            'p-b': { kind: 'codex', exe: fake.exe, model: 'gpt-5.6-luna' },
            'p-int': { kind: 'opencode', exe: fake.exe, model: 'opencode/free' },
        }
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('providers無效時throw(設定錯誤於啟動期即失敗)', function() {
        let r = []
        for (let providers of [undefined, null, 'abc', 123, []]) {
            try {
                dispatchAiWkf({ providers })
                r.push('no-throw')
            }
            catch (err) {
                r.push(err.message.indexOf('dispatchAiWkf:') === 0)
            }
        }
        let rr = [true, true, true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('回傳綁定版API物件', function() {
        let wkf = dispatchAiWkf({ providers })
        let r = [
            keys(wkf),
            wkf.providers === providers,
            typeof wkf.callAi,
            typeof wkf.runFanout,
            typeof wkf.runRolePipeline,
            typeof wkf.runFanoutPipeline,
        ]
        let rr = [
            ['providers', 'callAi', 'runFanout', 'runRolePipeline', 'runFanoutPipeline'],
            true,
            'function',
            'function',
            'function',
            'function',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('callAi綁定providers, 以名稱宣告即可呼叫', async function() {
        let wkf = dispatchAiWkf({ providers, defaults: { promptPrefix: '' } })
        let t = await wkf.callAi('abc', { spec: { use: 'p-a' } })
        let r = [t.ok, t.providerId, t.json.stdin]
        let rr = [true, 'p-a', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('defaults為共用預設且呼叫時可逐項覆寫', async function() {
        let wkf = dispatchAiWkf({ providers, defaults: { promptPrefix: 'DEF:' } })
        let t1 = await wkf.callAi('abc', { spec: { use: 'p-a' } })
        let t2 = await wkf.callAi('abc', { spec: { use: 'p-a' }, promptPrefix: 'OVR:' })
        let r = [t1.json.stdin, t2.json.stdin]
        let rr = ['DEF:abc', 'OVR:abc']
        assert.strict.deepEqual(r, rr)
    })

    it('未給defaults時預設掛防寫檔前綴', async function() {
        let wkf = dispatchAiWkf({ providers })
        let t = await wkf.callAi('abc', { spec: { use: 'p-a' } })
        let r = t.json.stdin
        let rr = NO_SIDE_EFFECT + 'abc'
        assert.strict.deepEqual(r, rr)
    })

    it('runFanout綁定providers與defaults(defaults併入callOpt)', async function() {
        let wkf = dispatchAiWkf({ providers, defaults: { promptPrefix: '' } })
        let t = await wkf.runFanout({
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int' },
        })
        let r = [t.ok, t.integrated, t.result.stdin.includes('【候選 1】')]
        let rr = [true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('runRolePipeline與runFanoutPipeline皆已綁定可用', async function() {
        let wkf = dispatchAiWkf({ providers, defaults: { promptPrefix: '' } })
        let t1 = await wkf.runRolePipeline({
            input: 'x',
            stages: [{ id: 's1', use: 'p-a', prompt: (ctx) => `on ${ctx.input}` }],
        })
        let t2 = await wkf.runFanoutPipeline({
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int' },
            stages: [{ id: 's1', use: 'p-a', prompt: () => 'y' }],
        })
        let r = [t1.ok, t1.results.s1.stdin, t2.ok, t2.B.order]
        let rr = [true, 'on x', true, ['s1']]
        assert.strict.deepEqual(r, rr)
    })

})
