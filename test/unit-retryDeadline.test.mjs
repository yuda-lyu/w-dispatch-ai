import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-retryDeadline — 期限約束一切重試(REST四家與CLI之無驗證／有驗證兩路徑)
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-6、§5.2〈DA〉DA-6; 帳本 sgud/rule/rulebook_cooling.md R-COOL-4; 探測P7)
//
// 【真時間(計時器規格P6), 集中於本檔】情境: 首次請求快速失敗(500／離開碼1, 可重試), 之後之請求不回應(由轉接器逾時);
//   預算1500、minAttemptMs 200、retryDelayMs 100、maxRetries 2、條目逾時5000。
//   修前: 重試不看期限(第二次以1500逾時、跑到期限之後, 第三次照送)→ 收件3(探測P7: 預算1500、牆鐘3327、3次請求)。
//   修後: 第二次之逾時以剩餘預算封頂, 其後「剩餘 − 退避 < minAttemptMs」不再重試 → 收件≤2, 且被封頂之末次判為budget-cut(appliedTimeoutMs < 條目逾時)。
//   斷言以收件數(REST)與spawn事件數(CLI)之上界與因果判定, 不以牆鐘; 負載只使首次更晚結束(剩餘更少、重試更少), 不使上界被突破。


describe('[真時間] 期限約束重試(da402 DA-6)', function() {

    let srv = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'di402-retrydeadline')
    let fake = null
    before(async function() {
        srv = await fakeServerForDeadlineTest()
        fs.mkdirSync(fdTmp, { recursive: true })

        //假CLI: 首次(標記檔不存在)建立標記後快速結束——預設以離開碼1(非驗證之失敗), --first=bad 則印出bad並以離開碼0(供驗證失敗); 之後(標記檔存在)睡8秒(由逾時結束)
        fake = createFakeCli('fake-di402-retrydeadline', `
import fs from 'fs'
let argv = process.argv.slice(2)
let a = argv.map((x) => /^--marker=(.+)$/.exec(x)).find((m) => !!m)
let mk = a ? a[1] : ''
let firstBad = argv.includes('--first=bad')
process.stdin.resume()
process.stdin.on('end', () => {})
if (mk !== '' && !fs.existsSync(mk)) {
    fs.writeFileSync(mk, '1')
    if (firstBad) {
        process.stdout.write('bad')
        process.exit(0)
    }
    process.stderr.write('transient failure')
    process.exit(1)
}
setTimeout(() => {
    process.stdout.write('late')
    process.exit(0)
}, 8000)
`)
    })
    let fakeEcho = null
    before(function() {
        fakeEcho = createFakeCli('fake-di402-retrydeadline-echo') //預設回聲假CLI(支援--fake-exit、--fake-stderr)
    })
    after(async function() {
        await srv.close()
        fake.clean()
        fakeEcho.clean()
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(fdTmp)) //test/_tmp已空才移除(並行之他測試仍在用時失敗即忽略)
        }
        catch {}
    })

    let common = { budgetMs: 1500, minAttemptMs: 200, maxRetries: 2, retryDelayMs: 100, timeoutMs: 5000 }

    let restCases = [
        { kind: 'api-openai-compat', base: () => srv.url, extra: {} },
        { kind: 'api-openai-responses', base: () => srv.url, extra: {} },
        { kind: 'api-anthropic', base: () => srv.root, extra: {} },
        { kind: 'api-typesafe-systemone', base: () => srv.url, extra: { questions: { q1: { type: 'noul' } } } },
    ]
    for (let c of restCases) {
        it(`REST ${c.kind}: 收件≤2(修前3), 末次被封頂判為budget-cut(appliedTimeoutMs < 條目逾時)`, async function() {
            let model = `fail-then-hang:${c.kind}`
            let r = await dispatchAiFallback('abc', {
                ...common,
                providers: [{ id: `rd:${c.kind}`, kind: c.kind, baseURL: c.base(), model, keys: ['sk-ant-api03-di402-test-key'], ...c.extra }],
            })
            let n = srv.requests[model] || 0
            let last = r.tried[r.tried.length - 1]
            assert.strict.deepEqual([n >= 1 && n <= 2, r.errorType, last.outcome, last.appliedTimeoutMs < 5000], [true, 'budget', 'budget-cut', true], JSON.stringify({ n, tried: r.tried.map((t) => [t.outcome, t.error]) }))
        })
    }

    for (let v of [{ name: '無驗證路徑', validate: undefined }, { name: '有驗證路徑', validate: 'nonempty' }]) {
        it(`CLI ${v.name}: spawn事件≤2(修前3), 末次被封頂判為budget-cut`, async function() {
            let spawns = 0
            let marker = path.join(fdTmp, `${v.validate ? 'v' : 'nv'}.marker`)
            let r = await dispatchAiFallback('abc', {
                ...common,
                ...(v.validate ? { validate: v.validate } : {}),
                providers: [{
                    id: `rd:cli:${v.validate ? 'v' : 'nv'}`,
                    kind: 'claude',
                    exe: fake.exe,
                    extraArgs: [`--marker=${marker}`],
                    onTrace: (e) => {
                        if (e.type === 'spawn') {
                            spawns++
                        }
                    },
                }],
            })
            let last = r.tried[r.tried.length - 1]
            assert.strict.deepEqual([spawns >= 1 && spawns <= 2, r.errorType, last.outcome, last.appliedTimeoutMs < 5000], [true, 'budget', 'budget-cut', true], JSON.stringify({ spawns, tried: r.tried.map((t) => [t.outcome, t.error]) }))
        })
    }

    //驗證失敗後之重試亦受期限約束(外審terra T03): 首次輸出不過驗證(約0.2秒), 重試延遲1000而剩餘 − 1000 < minAttemptMs 600 → 不重試(修前照重試)
    it('CLI 有驗證路徑之驗證重試: 剩餘 − 退避 < minAttemptMs → 不重試(spawn 1), 以驗證失敗收場', async function() {
        let spawns = 0
        let r = await dispatchAiFallback('abc', {
            ...common,
            minAttemptMs: 600,
            retryDelayMs: 1000,
            validate: (s) => s === 'GOOD',
            providers: [{
                id: 'rd:cli:vbad',
                kind: 'claude',
                exe: fake.exe,
                extraArgs: [`--marker=${path.join(fdTmp, 'vbad.marker')}`, '--first=bad'],
                onTrace: (e) => {
                    if (e.type === 'spawn') {
                        spawns++
                    }
                },
            }],
        })
        assert.strict.deepEqual([spawns, r.errorType], [1, 'validation'], JSON.stringify({ spawns, tried: r.tried.map((t) => [t.outcome, t.error]) }))
    })

    //接管重試時呼叫端之觀察回調所見之事件序列同execCli自身之重試迴圈(外審terra F13): attempt n累計、重試前retry、done只一則且n為總次數
    it('CLI 無驗證路徑接管重試: 觀察事件為 attempt 1 → retry 2 → attempt 2 → done(n 2), 不重複attempt n=1、不多發done', async function() {
        let seq = []
        await dispatchAiFallback('abc', {
            ...common,
            providers: [{
                id: 'rd:cli:trace',
                kind: 'claude',
                exe: fake.exe,
                extraArgs: [`--marker=${path.join(fdTmp, 'trace.marker')}`],
                onTrace: (e) => {
                    if (['attempt', 'retry', 'done'].includes(e.type)) {
                        seq.push(`${e.type}:${e.n}`)
                    }
                },
            }],
        })
        assert.strict.deepEqual(seq, ['attempt:1', 'retry:2', 'attempt:2', 'done:2'])
    })

    //opencode之暫時性錯誤重試亦受期限約束, 守門關閉(無spawnGateHints)時亦然(外審terra F01): 剩餘 − 重試延遲 < minAttemptMs → 不重試
    it('opencode暫時性錯誤重試(守門關閉): 剩餘預算不足一次重試延遲加最低嘗試 → 不重試(spawn 1)', async function() {
        let spawns = 0
        let r = await dispatchAiFallback('abc', {
            budgetMs: 1500,
            minAttemptMs: 600,
            providers: [{
                id: 'rd:oc:locked',
                kind: 'opencode',
                exe: fakeEcho.exe,
                spawnGate: false,
                extraArgs: ['--fake-exit=1', '--fake-stderr=Error: database is locked'],
                transientRetry: { delayMs: 1000, fastMs: 15000 },
                onTrace: (e) => {
                    if (e.type === 'spawn') {
                        spawns++
                    }
                },
            }],
        })
        assert.strict.deepEqual([spawns, r.ok], [1, false])
    })

    //轉接器層(直呼, 帶內部鍵attemptHints): 修前之REST迴圈不讀期限; 以attempts(轉接器實際送出之次數, 含逾時1ms而未達伺服器者)與末次逾時值斷言,
    //令「重試不看期限」與「重試逾時不封頂」兩種改回皆可分辨(變異M14／M15)
    for (let c of restCases) {
        it(`轉接器層 ${c.kind}: attempts≤2(修前3)、末次逾時值以期限封頂(< 給定之timeoutMs 1500)、標記cutByDeadline`, async function() {
            let model = `fail-then-hang:direct-${c.kind}`
            let r = await dispatchAi(c.kind, 'abc', {
                baseURL: c.base(),
                model,
                key: 'sk-ant-api03-di402-test-key',
                ...c.extra,
                timeoutMs: 1500,
                maxRetries: 2,
                retryDelayMs: 100,
                attemptHints: { deadlineAt: Date.now() + 1500, minAttemptMs: 200, entryTimeoutMs: 5000 },
            })
            assert.strict.deepEqual([r.attempts >= 1 && r.attempts <= 2, r.cutByDeadline, r.appliedTimeoutMs < 1500], [true, true, true], JSON.stringify({ attempts: r.attempts, applied: r.appliedTimeoutMs, error: r.error }))
        })
    }

    it('無期限(未給budgetMs)時重試照舊: REST收件3(maxRetries 2, 首次500後皆不回應, 條目逾時300)', async function() {
        let model = 'fail-then-hang:nobudget'
        let r = await dispatchAiFallback('abc', { maxRetries: 2, retryDelayMs: 50, timeoutMs: 300, providers: [{ id: 'rd:nb', kind: 'api-openai-compat', baseURL: srv.url, model, keys: ['sk-x'] }] })
        assert.strict.deepEqual([srv.requests[model], r.errorType, r.tried[0].outcome], [3, 'timeout', 'skip-group'])
    })

})
