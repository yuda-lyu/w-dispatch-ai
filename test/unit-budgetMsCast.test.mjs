import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-budgetMsCast — budgetMs之兩類宣告經三入口之行為(執行期剩餘時間 vs 設定值)
// (2026-11-11 di402; 主控裁示D11甲; 設計 da402-審計報告 表T3、§4.2 DA-7、§5.2〈DA〉DA-7; 帳本R-CALLER-1-6〔改寫〕)
//
// 執行期之剩餘時間(dispatchAiFallback之budgetMs、createAiCaller之逐次值、工作流扣prompt等待後之值): ≤0為已無時間(不送出、budget-out)、小數取整;
// 設定值(createAiCaller之建構值): 非正整數依K3視為未給(不限)。判定以tried、errorType與替身伺服器之收件數為準。


describe('budgetMs之兩類宣告(D11甲, da402 DA-7)', function() {

    let srv = null
    before(async function() {
        srv = await fakeServerForDeadlineTest()
    })
    after(async function() {
        await srv.close()
    })

    let rest = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: [`sk-${id}`], ...extra })

    describe('dispatchAiFallback(執行期剩餘時間)', function() {

        it('0、負、0.5、-Infinity、"0" → 不送出、budget-out(修前0／負／小數皆為不限而照送)', async function() {
            let out = []
            for (let [i, b] of [0, -100, 0.5, -Infinity, '0'].entries()) {
                let model = `ok:fb-zero-${i}`
                let r = await dispatchAiFallback('abc', { budgetMs: b, providers: [rest(`z${i}`, model)] })
                out.push([r.errorType, r.tried.map((t) => t.outcome), srv.requests[model] || 0])
            }
            assert.strict.deepEqual(out, Array(5).fill(['budget', ['budget-out'], 0]))
        })

        it('未給、null、+Infinity、NaN、非數值字串 → 不限(照送成交)', async function() {
            let out = []
            for (let [i, b] of [undefined, null, Infinity, NaN, 'abc'].entries()) {
                let r = await dispatchAiFallback('abc', { budgetMs: b, providers: [rest(`u${i}`, `ok:fb-unl-${i}`)] })
                out.push(r.ok)
            }
            assert.strict.deepEqual(out, [true, true, true, true, true])
        })

        it('[真時間] 小數1200.5 → 取整封頂(條目3000之掛起被封頂為budget-cut; 修前小數為不限而跑滿3000)', async function() {
            let r = await dispatchAiFallback('abc', { budgetMs: 1200.5, minAttemptMs: 200, providers: [rest('dec', 'hang:fb-dec', { timeoutMs: 3000 })] })
            assert.strict.deepEqual([r.errorType, r.tried[0].outcome, r.tried[0].appliedTimeoutMs <= 1200], ['budget', 'budget-cut', true])
        })

        it('數字字串"1500"照用(與修前同)', async function() {
            let r = await dispatchAiFallback('abc', { budgetMs: '1500', minAttemptMs: 2000, providers: [rest('s', 'ok:fb-str')] })
            assert.strict.deepEqual([r.errorType, r.tried.map((t) => t.outcome)], ['budget', ['budget-out']]) //1500 < minAttemptMs 2000 → 有預算且不足一次嘗試
        })

    })

    describe('createAiCaller(建構值為設定值、逐次值為執行期剩餘時間)', function() {

        it('建構budgetMs為0／負／小數 → 視為未給(不限), 照送成交(K3; 不得被當成已無時間)', async function() {
            let out = []
            for (let [i, b] of [0, -5, 0.5, 'abc'].entries()) {
                let c = createAiCaller({ extraProviders: [rest(`cc${i}`, `ok:cc-cfg-${i}`)], pick: [`cc${i}`], budgetMs: b })
                let r = await c.callAI('go')
                out.push(r.ok)
            }
            assert.strict.deepEqual(out, [true, true, true, true])
        })

        it('逐次budgetMs為0／負 → 本次不送出、budget-out(修前視為未給而沿用建構值照送)', async function() {
            let out = []
            for (let [i, b] of [0, -1].entries()) {
                let model = `ok:cc-call-${i}`
                let c = createAiCaller({ extraProviders: [rest(`cd${i}`, model)], pick: [`cd${i}`], budgetMs: 60000 })
                let r = await c.callAI('go', { budgetMs: b })
                out.push([r.errorType, r.tried.map((t) => t.outcome), srv.requests[model] || 0])
            }
            assert.strict.deepEqual(out, [['budget', ['budget-out'], 0], ['budget', ['budget-out'], 0]])
        })

        it('逐次budgetMs為+Infinity、null、非數值 → 視為未給而沿用建構值(照送成交)', async function() {
            let c = createAiCaller({ extraProviders: [rest('ce', 'ok:cc-unl')], pick: ['ce'], budgetMs: 60000 })
            let out = []
            for (let b of [Infinity, null, 'abc']) {
                out.push((await c.callAI('go', { budgetMs: b })).ok)
            }
            assert.strict.deepEqual(out, [true, true, true])
        })

    })

    describe('工作流(扣prompt等待後之值)', function() {

        it('runRolePipeline: 階段budgetMs為0 → 不送出、該階段以budget失敗(修前0＝不限而照送)', async function() {
            let model = 'ok:wf-rp'
            let w = dispatchAiWkf({ providers: { m: rest('wf-rp', model) } })
            let r = await w.runRolePipeline({ stages: [{ id: 's1', use: 'm', prompt: () => 'x', rawText: true, budgetMs: 0 }] })
            assert.strict.deepEqual([r.ok, r.stages.s1.errorType, srv.requests[model] || 0], [false, 'budget', 0])
        })

        it('runRolePipeline: 階段budgetMs為0.9(取整為0) → 不送出、budget(修前小數為不限而照送)', async function() {
            let model = 'ok:wf-rp2'
            let w = dispatchAiWkf({ providers: { m: rest('wf-rp2', model) } })
            let r = await w.runRolePipeline({ stages: [{ id: 's1', use: 'm', prompt: () => 'x', rawText: true, budgetMs: 0.9 }] })
            assert.strict.deepEqual([r.ok, r.stages.s1.errorType, srv.requests[model] || 0], [false, 'budget', 0])
        })

        //prompt之等待上限＝min(timeoutMs, budgetMs)(帳本R-USERFN-1); 預算已為0(或取整為0)者不等待async之prompt(上限0, 以prompt逾時失敗)、不送出——
        //修前0／小數為不限而照等照送; 本案亦令「工作流層改回castPintOr、只靠遞補層兜底」之寫法可被分辨(變異M20／M21)
        it('runRolePipeline: 階段budgetMs為0.4且prompt為async → 不等待prompt(以prompt逾時失敗)、不送出', async function() {
            let model = 'ok:wf-rp3'
            let w = dispatchAiWkf({ providers: { m: rest('wf-rp3', model) } })
            let r = await w.runRolePipeline({ stages: [{ id: 's1', use: 'm', rawText: true, budgetMs: 0.4, prompt: () => new Promise((resolve) => setTimeout(() => resolve('x'), 50)) }] })
            assert.strict.deepEqual([r.ok, r.error.includes('prompt did not settle'), srv.requests[model] || 0], [false, true, 0])
        })

        //扣除prompt耗時後為0即已無時間(外審terra T04): 同步prompt耗時60ms而預算30 → 扣除後0 → 遞補層budget-out、不送出(修前夾至1而以1ms逾時開工)
        it('runRolePipeline: 同步prompt耗時超過預算(扣除後為0) → 遞補層budget-out、不送出', async function() {
            let model = 'ok:wf-rp4'
            let w = dispatchAiWkf({ providers: { m: rest('wf-rp4', model) } })
            let busy = () => {
                let t = Date.now()
                while (Date.now() - t < 60) {
                    //同步耗時(不讓出事件迴圈): prompt為同步函數時不受等待上限截斷, 其耗時照常自預算扣除
                }
                return 'x'
            }
            let r = await w.runRolePipeline({ stages: [{ id: 's1', use: 'm', rawText: true, budgetMs: 30, minAttemptMs: 1, prompt: busy }] })
            assert.strict.deepEqual([r.ok, r.stages.s1.errorType, r.stages.s1.tried.map((t) => t.outcome), srv.requests[model] || 0], [false, 'budget', ['budget-out'], 0])
        })

        it('runFanout之整合段: budgetMs為0且整合prompt為async → 不等待整合prompt(以prompt逾時失敗)、整合不送出', async function() {
            let w = dispatchAiWkf({ providers: { m: rest('wf-fo2-a', 'ok:wf-fo2-a'), n: rest('wf-fo2-i', 'ok:wf-fo2-i') } })
            let r = await w.runFanout({
                task: 'x',
                callOpt: { rawText: true },
                agents: [{ use: 'm' }, { use: 'm' }],
                integrate: { use: 'n', budgetMs: 0, prompt: () => new Promise((resolve) => setTimeout(() => resolve('merge'), 50)) },
            })
            assert.strict.deepEqual([r.candidates.length, r.integrated, r.error.includes('integrate prompt did not settle'), srv.requests['ok:wf-fo2-i'] || 0], [2, false, true, 0])
        })

        it('runFanout之整合段: budgetMs為0 → 整合不送出、以budget失敗(候選照常成交)', async function() {
            let w = dispatchAiWkf({ providers: { m: rest('wf-fo-a', 'ok:wf-fo-a'), n: rest('wf-fo-i', 'ok:wf-fo-i') } })
            let r = await w.runFanout({
                task: 'x',
                callOpt: { rawText: true },
                agents: [{ use: 'm' }, { use: 'm' }],
                integrate: { use: 'n', budgetMs: 0, prompt: () => 'merge' },
            })
            assert.strict.deepEqual([r.candidates.length, r.integrated, r.integrateDetail.errorType, srv.requests['ok:wf-fo-i'] || 0], [2, false, 'budget', 0])
        })

    })

})
