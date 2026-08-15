import assert from 'assert'
import runRolePipeline from '../src/wkf/runRolePipeline.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('runRolePipeline', function() {

    let fake = null
    let providers = null
    let callOpt = { promptPrefix: '' }

    before(function() {
        fake = createFakeCli('fake-wkf-role')
        providers = {
            'p-a': { kind: 'claude', exe: fake.exe, model: 'sonnet' },
            'p-b': { kind: 'codex', exe: fake.exe, model: 'gpt-5.6-luna' },
            'p-dead': { kind: 'claude', exe: fake.exe, extraArgs: ['--fake-exit=1'] },
        }
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('stages無效時回傳錯誤結果物件', async function() {
        let t = await runRolePipeline({ providers, stages: null, callOpt })
        let r = [t.ok, t.error, t.order]
        let rr = [false, 'stages must be a non-empty array', []]
        assert.strict.deepEqual(r, rr)
    })

    it('各階段依序執行, ctx傳遞input與prev與results', async function() {
        let ctxSeen = []
        let t = await runRolePipeline({
            providers,
            input: 'INPUT-MARK',
            stages: [
                {
                    id: 'draft',
                    use: 'p-a',
                    prompt: (ctx) => {
                        ctxSeen.push(['draft', ctx.input, ctx.prev, ctx.index])
                        return `draft on ${ctx.input}`
                    },
                },
                {
                    id: 'review',
                    use: 'p-b',
                    prompt: (ctx) => {
                        ctxSeen.push(['review', ctx.input, ctx.prev === ctx.results.draft, ctx.index])
                        return `review ${ctx.prev.stdin}` //prev為draft階段之echo物件
                    },
                },
            ],
            callOpt,
        })
        let r = [
            t.ok,
            t.order,
            t.failedStage,
            ctxSeen,
            t.results.draft.stdin,
            t.results.review.stdin,
            t.result === t.results.review, //最末階段成果即工作流成果
        ]
        let rr = [
            true,
            ['draft', 'review'],
            null,
            [['draft', 'INPUT-MARK', null, 0], ['review', 'INPUT-MARK', true, 1]],
            'draft on INPUT-MARK',
            'review draft on INPUT-MARK',
            true,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('某階段失敗即中止, 已完成階段成果保留且failedStage標明斷點', async function() {
        let t = await runRolePipeline({
            providers,
            stages: [
                { id: 's1', use: 'p-a', prompt: () => 'stage1' },
                { id: 's2', use: 'p-dead', prompt: () => 'stage2' },
                { id: 's3', use: 'p-a', prompt: () => 'stage3' },
            ],
            callOpt,
        })
        let r = [
            t.ok,
            t.failedStage,
            t.order,
            t.results.s1.stdin,
            t.results.s2,
            t.error.indexOf('stage[s2] failed:') === 0,
        ]
        let rr = [false, 's2', ['s1', 's2'], 'stage1', undefined, true]
        assert.strict.deepEqual(r, rr)
    })

    it('prompt非函數或回傳空值時回報該階段錯誤', async function() {
        let t1 = await runRolePipeline({ providers, stages: [{ id: 'x', use: 'p-a', prompt: 'not-fn' }], callOpt })
        let t2 = await runRolePipeline({ providers, stages: [{ id: 'y', use: 'p-a', prompt: () => '' }], callOpt })
        let r = [
            [t1.ok, t1.failedStage, t1.error],
            [t2.ok, t2.failedStage, t2.error],
        ]
        let rr = [
            [false, 'x', 'stage[x].prompt must be a function'],
            [false, 'y', 'stage[y].prompt returned empty'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('未給id之階段自動命名stageN', async function() {
        let t = await runRolePipeline({
            providers,
            stages: [{ use: 'p-a', prompt: () => 'abc' }],
            callOpt,
        })
        let r = [t.ok, t.order]
        let rr = [true, ['stage1']]
        assert.strict.deepEqual(r, rr)
    })

    it('階段可自帶fallback, 主模型失敗自動遞補', async function() {
        let t = await runRolePipeline({
            providers,
            stages: [{ id: 's1', use: 'p-dead', fallback: ['p-b'], prompt: () => 'abc' }],
            callOpt,
        })
        let r = [t.ok, t.stages.s1.providerId]
        let rr = [true, 'p-b']
        assert.strict.deepEqual(r, rr)
    })

    it('rawText階段之成果為文字並可傳遞至下一階段', async function() {
        let t = await runRolePipeline({
            providers,
            stages: [
                { id: 's1', use: 'p-a', rawText: true, prompt: () => 'abc' },
                { id: 's2', use: 'p-b', prompt: (ctx) => `got ${typeof ctx.prev}` },
            ],
            callOpt,
        })
        let r = [t.ok, typeof t.results.s1, t.results.s2.stdin]
        let rr = [true, 'string', 'got string']
        assert.strict.deepEqual(r, rr)
    })

    it('階段check未過視為該階段失敗', async function() {
        let t = await runRolePipeline({
            providers,
            stages: [{ id: 's1', use: 'p-a', prompt: () => 'abc', check: () => false }],
            callOpt,
        })
        let r = [t.ok, t.failedStage]
        let rr = [false, 's1']
        assert.strict.deepEqual(r, rr)
    })

    it('meta為保留鍵: 階段規格掛meta(如draft/audit分類)不影響呼叫行為', async function() {
        let t = await runRolePipeline({
            providers,
            stages: [{ id: 's1', use: 'p-a', prompt: () => 'abc', meta: { stage: 'draft' } }],
            callOpt,
        })
        //假CLI收到之args與未掛meta時完全一致(meta未被轉傳成未知旗標)
        let r = [t.ok, t.result.args, t.result.stdin]
        let rr = [true, ['-p', '--dangerously-skip-permissions', '--model', 'sonnet'], 'abc']
        assert.strict.deepEqual(r, rr)
    })

})
