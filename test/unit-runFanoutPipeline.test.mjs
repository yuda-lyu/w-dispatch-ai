import assert from 'assert'
import runFanoutPipeline from '../src/wkf/runFanoutPipeline.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('runFanoutPipeline', function() {

    let fake = null
    let providers = null
    let callOpt = { promptPrefix: '' }

    before(function() {
        fake = createFakeCli('fake-wkf-fp')
        providers = {
            'p-a': { kind: 'claude', exe: fake.exe, model: 'sonnet' },
            'p-b': { kind: 'codex', exe: fake.exe, model: 'gpt-5.6-luna' },
            'p-int': { kind: 'opencode', exe: fake.exe, model: 'opencode/free' },
            'p-dead': { kind: 'claude', exe: fake.exe, extraArgs: ['--fake-exit=1'] },
        }
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('前段多開整合, 後段以前段成果為input執行角色鏈', async function() {
        let t = await runFanoutPipeline({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int' },
            stages: [
                { id: 'audit', use: 'p-b', prompt: (ctx) => `audit ${ctx.input.args[0]}` }, //input為整合者echo物件
            ],
            callOpt,
        })
        let r = [
            t.ok,
            t.A.ok,
            t.A.integrated,
            t.B.ok,
            t.B.order,
            t.result.stdin, //後段最末階段之echo, 其stdin含前段成果之args[0](整合者為opencode轉接器故為run)
        ]
        let rr = [true, true, true, true, ['audit'], 'audit run']
        assert.strict.deepEqual(r, rr)
    })

    it('前段失敗即回, 後段不執行', async function() {
        let t = await runFanoutPipeline({
            providers,
            task: 'abc',
            agents: [{ use: 'p-dead' }, { use: 'p-dead' }],
            integrate: { use: 'p-int' },
            stages: [{ id: 's1', use: 'p-a', prompt: () => 'x' }],
            callOpt,
        })
        let r = [t.ok, t.A.ok, t.B, t.error.indexOf('A failed:') === 0]
        let rr = [false, false, null, true]
        assert.strict.deepEqual(r, rr)
    })

    it('後段失敗時前段成果仍完整回傳, 可只重跑後段', async function() {
        let t = await runFanoutPipeline({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int' },
            stages: [{ id: 's1', use: 'p-dead', prompt: () => 'x' }],
            callOpt,
        })
        let r = [
            t.ok,
            t.A.ok,
            t.A.result !== null,
            t.B.ok,
            t.B.failedStage,
            t.error.indexOf('B failed:') === 0,
        ]
        let rr = [false, true, true, false, 's1', true]
        assert.strict.deepEqual(r, rr)
    })

})
