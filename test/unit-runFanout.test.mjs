import assert from 'assert'
import runFanout, { defaultIntegratePrompt } from '../src/wkf/runFanout.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('runFanout', function() {

    let fake = null
    let providers = null
    let callOpt = { promptPrefix: '' }

    before(function() {
        fake = createFakeCli('fake-wkf-fanout')
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

    it('task或agents無效時回傳錯誤結果物件', async function() {
        let t1 = await runFanout({ providers, task: '', agents: [{ use: 'p-a' }], callOpt })
        let t2 = await runFanout({ providers, task: 'abc', agents: null, callOpt })
        let r = [[t1.ok, t1.error], [t2.ok, t2.error]]
        let rr = [
            [false, 'task must be a non-empty string'],
            [false, 'agents must be a non-empty array'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('候選達門檻時進整合, 整合提示詞含各候選', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int' },
            callOpt,
        })
        let r = [
            t.ok,
            t.integrated,
            t.candidates.length,
            t.agents.map((x) => x.providerId),
            t.result.args[0], //整合者為opencode轉接器
            t.result.stdin.includes('【候選 1】') && t.result.stdin.includes('【候選 2】'),
            t.integrateDetail.providerId,
        ]
        let rr = [true, true, 2, ['p-a', 'p-b'], 'run', true, 'p-int']
        assert.strict.deepEqual(r, rr)
    })

    it('個別名額失敗不炸整輪, 恰1份成功候選直接放行(integrated:false)', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-dead' }, { use: 'p-a' }],
            integrate: { use: 'p-int' },
            callOpt,
        })
        let r = [t.ok, t.integrated, t.candidates.length, t.result.args, t.agents[0].ok, t.agents[1].ok]
        let rr = [true, false, 1, ['-p', '--dangerously-skip-permissions', '--model', 'sonnet'], false, true]
        assert.strict.deepEqual(r, rr)
    })

    it('候選未達minCandidates時不硬整合, 以首位候選為成果', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int' },
            minCandidates: 3,
            callOpt,
        })
        let r = [t.ok, t.integrated, t.candidates.length, t.result === t.candidates[0], t.error]
        let rr = [true, false, 2, true, '']
        assert.strict.deepEqual(r, rr)
    })

    it('全數名額失敗時回傳all agents failed', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-dead' }, { use: 'p-dead' }],
            integrate: { use: 'p-int' },
            callOpt,
        })
        let r = [t.ok, t.result, t.candidates.length, t.error]
        let rr = [false, null, 0, 'all agents failed']
        assert.strict.deepEqual(r, rr)
    })

    it('達門檻但缺integrate規格時回報必要性', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            callOpt,
        })
        let r = [t.ok, t.error, t.candidates.length]
        let rr = [false, 'integrate spec (with use) is required', 2]
        assert.strict.deepEqual(r, rr)
    })

    it('整合失敗時成功候選仍完整回傳供接續重試', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-dead' },
            callOpt,
        })
        let r = [t.ok, t.integrated, t.candidates.length, t.error.indexOf('integrate failed:') === 0]
        let rr = [false, false, 2, true]
        assert.strict.deepEqual(r, rr)
    })

    it('integrate.prompt可自訂整合提示詞', async function() {
        let seen = null
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: {
                use: 'p-int',
                prompt: (candidates) => {
                    seen = candidates.length
                    return 'CUSTOM-INTEGRATE'
                },
            },
            callOpt,
        })
        let r = [t.ok, seen, t.result.stdin]
        let rr = [true, 2, 'CUSTOM-INTEGRATE']
        assert.strict.deepEqual(r, rr)
    })

    it('名額規格之額外鍵覆寫該名額呼叫設定', async function() {
        //p-a名額帶rawText覆寫 → 該名額json為文字, 候選為字串
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a', rawText: true }],
            integrate: { use: 'p-int' },
            callOpt,
        })
        let r = [t.ok, t.integrated, typeof t.result]
        let rr = [true, false, 'string']
        assert.strict.deepEqual(r, rr)
    })

    it('integrate可帶獨立check(終稿判準), 未給則沿用頂層check', async function() {
        //頂層check放行所有echo物件; integrate.check要求stdin含候選標記(僅整合者符合)
        let t1 = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int', check: (j) => j.stdin.includes('【候選 1】') },
            check: (j) => Array.isArray(j.args),
            callOpt,
        })
        //integrate.check不通過時整合失敗, 但候選不受影響(判準不再互相牽制)
        let t2 = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a' }, { use: 'p-b' }],
            integrate: { use: 'p-int', check: () => false },
            check: (j) => Array.isArray(j.args),
            callOpt,
        })
        let r = [
            [t1.ok, t1.integrated],
            [t2.ok, t2.integrated, t2.candidates.length, t2.error.indexOf('integrate failed:') === 0],
        ]
        let rr = [
            [true, true],
            [false, false, 2, true],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('名額規格可帶獨立check覆寫頂層(曾為被靜默覆蓋之死鍵)', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [
                { use: 'p-a', check: () => false }, //此名額專屬判準: 必不過
                { use: 'p-b' }, //沿用頂層(未給即預設放行)
            ],
            integrate: { use: 'p-int' },
            callOpt,
        })
        let r = [t.ok, t.integrated, t.agents[0].ok, t.agents[1].ok, t.candidates.length]
        let rr = [true, false, false, true, 1] //單稿放行(integrated:false)
        assert.strict.deepEqual(r, rr)
    })

    it('meta為保留鍵: 名額與integrate規格掛meta不影響呼叫行為', async function() {
        let t = await runFanout({
            providers,
            task: 'abc',
            agents: [{ use: 'p-a', meta: { stage: 'draft' } }],
            integrate: { use: 'p-int', meta: { stage: 'final' } },
            callOpt,
        })
        //單稿放行, 假CLI收到之args與未掛meta時完全一致(meta未被轉傳成未知旗標)
        let r = [t.ok, t.integrated, t.result.args]
        let rr = [true, false, ['-p', '--dangerously-skip-permissions', '--model', 'sonnet']]
        assert.strict.deepEqual(r, rr)
    })

    it('defaultIntegratePrompt嵌入候選數與schema', function() {
        let s = defaultIntegratePrompt([{ a: 1 }, { b: 2 }], { schema: '{"x":"..."}' })
        let r = [s.includes('2 個獨立執行'), s.includes('{"x":"..."}'), s.includes('【候選 2】')]
        let rr = [true, true, true]
        assert.strict.deepEqual(r, rr)
    })

})
