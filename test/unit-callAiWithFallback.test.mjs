import assert from 'assert'
import callAiWithFallback, { buildChain, NO_SIDE_EFFECT } from '../src/wkf/callAiWithFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


describe('callAiWithFallback', function() {

    let fake = null
    let providers = null

    before(function() {
        fake = createFakeCli('fake-wkf-call')
        providers = {
            'p-claude': { kind: 'claude', exe: fake.exe, model: 'sonnet' },
            'p-codex': { kind: 'codex', exe: fake.exe, model: 'gpt-5.6-luna' },
            'p-oc': { kind: 'opencode', exe: fake.exe, model: 'opencode/free', provider: 'opencode', keys: ['sk-c0', 'sk-c1'] },
            'p-dead': { kind: 'claude', exe: fake.exe, model: 'sonnet', extraArgs: ['--fake-exit=1'] },
            'p-noexe': { kind: 'claude', exe: 'wkf-no-such-cli' },
        }
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('buildChain以名稱展開條目並回報查無定義之名稱', function() {
        let { chain, missing } = buildChain(providers, { use: 'p-claude', fallback: ['p-codex', 'p-typo'] })
        let r = [chain.map((x) => x.id), missing]
        let rr = [['p-claude', 'p-codex'], ['p-typo']]
        assert.strict.deepEqual(r, rr)
    })

    it('prompt非有效字串時回傳錯誤結果物件', async function() {
        let t = await callAiWithFallback('', { providers, spec: { use: 'p-claude' } })
        let r = [t.ok, t.json, t.error, t.tried]
        let rr = [false, null, 'prompt must be a non-empty string', []]
        assert.strict.deepEqual(r, rr)
    })

    it('providers或spec無效時回傳錯誤結果物件', async function() {
        let r = []
        for (let [p, s] of [[null, { use: 'x' }], [providers, null], [providers, 'abc']]) {
            let t = await callAiWithFallback('abc', { providers: p, spec: s })
            r.push([t.ok, t.error.indexOf('no valid provider') === 0])
        }
        let rr = [[false, true], [false, true], [false, true]]
        assert.strict.deepEqual(r, rr)
    })

    it('名稱查無定義時fail fast回報, 不靜默略過', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude', fallback: ['p-typo1', 'p-codex', 'p-typo2'] } })
        let r = [t.ok, t.error]
        let rr = [false, 'unknown provider name(s): p-typo1, p-typo2']
        assert.strict.deepEqual(r, rr)
    })

    it('成功時回傳解析後json與名稱式providerId', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, promptPrefix: '' })
        let r = [t.ok, t.providerId, t.keyIndex, t.keyId, t.json.args, t.json.stdin]
        let rr = [true, 'p-claude', null, 'p-claude', ['-p', '--dangerously-skip-permissions', '--model', 'sonnet'], 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('預設掛防寫檔前綴, promptPrefix傳空字串可關閉, 自訂前綴可覆寫', async function() {
        let t1 = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' } })
        let t2 = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, promptPrefix: '' })
        let t3 = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, promptPrefix: 'PREFIX:' })
        let r = [t1.json.stdin, t2.json.stdin, t3.json.stdin]
        let rr = [NO_SIDE_EFFECT + 'abc', 'abc', 'PREFIX:abc']
        assert.strict.deepEqual(r, rr)
    })

    it('check未過視為該家失敗, 遞補層自動換下一家', async function() {
        //check要求args含opencode之run旗標 → p-claude不合(換家) → p-oc合
        let t = await callAiWithFallback('abc', {
            providers,
            spec: { use: 'p-claude', fallback: ['p-oc'] },
            check: (j) => j.args[0] === 'run',
            promptPrefix: '',
        })
        let r = [t.ok, t.providerId, t.keyIndex, t.keyId, t.tried.map((x) => [x.providerId, x.outcome])]
        let rr = [true, 'p-oc', 0, 'p-oc#0', [['p-claude', 'skip-group'], ['p-oc', 'ok']]]
        assert.strict.deepEqual(r, rr)
    })

    it('CLI失敗(exit 1)時遞補至下一家', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-dead', fallback: ['p-codex'] }, promptPrefix: '' })
        let r = [t.ok, t.providerId, t.tried.map((x) => [x.providerId, x.outcome])]
        let rr = [true, 'p-codex', [['p-dead', 'next-key'], ['p-codex', 'ok']]]
        assert.strict.deepEqual(r, rr)
    })

    it('全數失敗時回傳error與完整tried', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-dead', fallback: ['p-noexe'] }, promptPrefix: '' })
        let r = [t.ok, t.json, t.error !== '', t.tried.length]
        let rr = [false, null, true, 2]
        assert.strict.deepEqual(r, rr)
    })

    it('rawText模式不解析JSON, json欄為修剪後文字', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, rawText: true, promptPrefix: '' })
        let r = [t.ok, typeof t.json, JSON.parse(t.json).stdin]
        let rr = [true, 'string', 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('rawText模式check收文字', async function() {
        let seen = []
        let t = await callAiWithFallback('abc', {
            providers,
            spec: { use: 'p-claude' },
            rawText: true,
            check: (s) => {
                seen.push(typeof s)
                return s.includes('"stdin"')
            },
            promptPrefix: '',
        })
        let r = [t.ok, seen.includes('string')]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('自訂parse可覆寫預設解析器', async function() {
        let t = await callAiWithFallback('abc', {
            providers,
            spec: { use: 'p-claude' },
            parse: (stdout) => ({ wrapped: JSON.parse(stdout).stdin }),
            promptPrefix: '',
        })
        let r = t.json
        let rr = { wrapped: 'abc' }
        assert.strict.deepEqual(r, rr)
    })

    it('minAttemptMs等fallback層設定可經工作流層原樣轉傳(曾因白名單漏鍵而失效)', async function() {
        //budgetMs=60000(高於預設門檻20000)+minAttemptMs=600000(遠大於budget):
        //minAttemptMs有被轉送才會立即budget exhausted; 漏鍵時會照樣執行並成功
        let t = await callAiWithFallback('abc', {
            providers,
            spec: { use: 'p-claude' },
            promptPrefix: '',
            budgetMs: 60000,
            minAttemptMs: 600000,
        })
        let r = [t.ok, t.error, t.tried.map((x) => x.outcome)]
        let rr = [false, 'budget exhausted', ['budget-out']]
        assert.strict.deepEqual(r, rr)
    })

    it('多金鑰條目經由keys輪替且keyId帶索引', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-oc' }, promptPrefix: '' })
        let auth = JSON.parse(t.json.env.OPENCODE_AUTH_CONTENT)
        let r = [t.ok, t.providerId, typeof t.keyIndex, t.keyId.indexOf('p-oc#') === 0, ['sk-c0', 'sk-c1'].includes(auth.opencode.key)]
        let rr = [true, 'p-oc', 'number', true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('shouldStop可經工作流層原樣轉傳, 中止時回報ABORTED', async function() {
        //中止後每個後續呼叫進門即回ABORTED, 整條工作流自然快速收束(檢查點只在遞補層一處)
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, promptPrefix: '', shouldStop: () => true })
        let r = [t.ok, t.error, t.tried.map((x) => x.outcome)]
        let rr = [false, 'ABORTED', ['aborted']]
        assert.strict.deepEqual(r, rr)
    })

    it('usage欄位: CLI路徑無可靠來源故為null; meta為保留鍵不影響行為', async function() {
        let t = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, promptPrefix: '', meta: { tag: 'draft' } })
        let r = [t.ok, t.usage, t.json.stdin]
        let rr = [true, null, 'abc']
        assert.strict.deepEqual(r, rr)
    })

    it('errorType經工作流層透出: 失敗帶類別, 成功無此欄', async function() {
        let t1 = await callAiWithFallback('abc', { providers, spec: { use: 'p-dead' }, promptPrefix: '' })
        let t2 = await callAiWithFallback('abc', { providers, spec: { use: 'p-typo' }, promptPrefix: '' })
        let t3 = await callAiWithFallback('abc', { providers, spec: { use: 'p-claude' }, promptPrefix: '' })
        let r = [[t1.ok, t1.errorType], [t2.ok, t2.errorType], [t3.ok, t3.errorType]]
        let rr = [[false, 'exec'], [false, 'params'], [true, undefined]]
        assert.strict.deepEqual(r, rr)
    })

})
