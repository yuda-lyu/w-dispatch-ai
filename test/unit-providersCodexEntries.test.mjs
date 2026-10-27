import assert from 'assert'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//規格(任務wda-run01, 2026-10-28): 內建providers新增codex:gpt-6.1-terra——
//  ①欄位、唯讀檔位(sandbox: 'read-only')、強度常數比照codex:gpt-6.1-sol條目(強度沿用統一之high, 不另寫max;
//    terra型錄預設reasoning effort為low, 故必傳強度);
//  ②codex群組內terra排在sol之前, 其他條目之相對順序不動;
//  ③不得實際呼叫任何AI服務: 以下全程只用假codex執行檔(test/tools/fakeCliForTest.mjs), 回聲收到之argv。
describe('providers: codex條目(terra／sol／luna)', function() {

    let TERRA = 'codex:gpt-6.1-terra'
    let SOL = 'codex:gpt-6.1-sol'
    let LUNA = 'codex:gpt-5.6-luna'
    let fake = null

    before(function() {
        fake = createFakeCli('fake-codex-entries')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let getEntries = (id) => providers.filter((p) => p.id === id)

    it('codex:gpt-6.1-terra條目存在且唯一, kind為codex、model為gpt-6.1-terra', function() {
        //規格: 任務1「新增codex:gpt-6.1-terra條目」
        let es = getEntries(TERRA)
        let e = es[0] || {}
        let r = [es.length, e.kind, e.model]
        let rr = [1, 'codex', 'gpt-6.1-terra']
        assert.strict.deepEqual(r, rr)
    })

    it('terra條目為唯讀檔位(sandbox: read-only)、不帶envVar(訂閱登入態), 強度必傳且為統一之high(不寫max)', function() {
        //規格: 任務1「唯讀檔位、強度常數比照sol」; terra型錄預設effort為low, 不傳即跑最淺, 故extraArgs不得缺
        let e = getEntries(TERRA)[0] || {}
        let r = [e.sandbox, e.envVar, e.extraArgs]
        let rr = ['read-only', undefined, ['--config', 'model_reasoning_effort="high"']]
        assert.strict.deepEqual(r, rr)
    })

    it('terra條目除id與model外之欄位與sol條目深相等(欄位比照sol)', function() {
        //規格: 任務1「欄位、唯讀檔位、強度常數等比照現有codex:gpt-6.1-sol條目」
        let strip = (p) => {
            let o = { ...p }
            delete o.id
            delete o.model
            return o
        }
        let terra = getEntries(TERRA)[0]
        let sol = getEntries(SOL)[0]
        assert.strict.deepEqual([!!terra, !!sol], [true, true])
        assert.strict.deepEqual(strip(terra), strip(sol))
    })

    it('codex群組順序: luna、terra、sol, 且三條相鄰成一段(terra在sol之前, 未落入他群組)', function() {
        //規格: 任務2「codex群組內terra排在sol之前; 其他群組之順序不動」; luna維持最前(既有相對順序不變)
        let ids = providers.map((p) => p.id)
        let codex = ids.filter((id) => id.startsWith('codex:'))
        let iLuna = ids.indexOf(LUNA)
        let iTerra = ids.indexOf(TERRA)
        let iSol = ids.indexOf(SOL)
        let r = [codex, iTerra < iSol, iLuna < iSol, iTerra - iLuna, iSol - iTerra, providers.filter((p) => p.kind === 'codex').length]
        let rr = [[LUNA, TERRA, SOL], true, true, 1, 1, 3]
        assert.strict.deepEqual(r, rr)
    })

    it('群組(id前綴)順序不動: oc→agy→claude→codex→typesafe→zen→agnes→poolside→claude-api→anthropic, 各群組各成一段(codex在claude之後、typesafe之前)', function() {
        //規格: 任務2「其他群組之順序不動」——基準為新增前(HEAD)之群組順序; terra只加入codex群組, 不得使codex段位移或拆散他群組
        let prefixes = providers.map((p) => p.id.split(':')[0])
        let runs = prefixes.filter((x, i) => i === 0 || x !== prefixes[i - 1])
        let r = [runs, new Set(runs).size === runs.length]
        let rr = [['oc', 'agy', 'claude', 'codex', 'typesafe', 'zen', 'agnes', 'poolside', 'claude-api', 'anthropic'], true]
        assert.strict.deepEqual(r, rr)
    })

    it('resolveProviders以pick自選terra與sol: 無envVar故不停用、依pick順序、missing為空、table含terra之唯讀與強度', function() {
        //規格: 任務2「resolveProviders之pick範例」——pick順序即遞補優先序
        let t = resolveProviders(providers, { env: {}, pick: [TERRA, SOL] })
        let r = [
            t.providers.map((p) => p.id),
            t.skipped,
            t.missing,
            Object.keys(t.table),
            [t.table[TERRA].model, t.table[TERRA].sandbox, t.table[TERRA].extraArgs],
        ]
        let rr = [
            [TERRA, SOL],
            [],
            [],
            [TERRA, SOL],
            ['gpt-6.1-terra', 'read-only', ['--config', 'model_reasoning_effort="high"']],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('全取(不給pick)時terra出現且位於sol之前', function() {
        //規格: 任務2「預設順序中terra排在sol之前」; 全取時缺envVar者被停用, codex類無envVar不受影響
        let t = resolveProviders(providers, { env: {} })
        let ids = t.providers.map((p) => p.id)
        let r = [ids.includes(TERRA), ids.indexOf(TERRA) < ids.indexOf(SOL)]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('經resolveProviders＋dispatchAiFallback送到(假)codex之argv: -m gpt-6.1-terra、--sandbox read-only、--config model_reasoning_effort="high"', async function() {
        //規格: 任務1「欄位、唯讀檔位、強度」之端到端——條目實際轉成子進程旗標; 假CLI回聲argv, 不呼叫AI服務
        let { providers: ps } = resolveProviders(providers, { env: {}, pick: [TERRA], exes: { codex: fake.exe } })
        let t = await dispatchAiFallback('abc', { providers: ps })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, t.providerId, o.args]
        let rr = [true, TERRA, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-m', 'gpt-6.1-terra', '--config', 'model_reasoning_effort="high"']]
        assert.strict.deepEqual(r, rr)
    })

    it('呼叫端以patch把terra強度覆寫為max(外審用法)時, 唯讀檔位不受影響(sandbox在欄位而非extraArgs)', async function() {
        //規格: 條目註解載明之覆寫用法——patch覆寫extraArgs不得連帶解除sandbox: read-only
        let { providers: ps } = resolveProviders(providers, {
            env: {},
            pick: [TERRA],
            exes: { codex: fake.exe },
            patch: { [TERRA]: { extraArgs: ['--config', 'model_reasoning_effort="max"'] } },
        })
        let t = await dispatchAiFallback('abc', { providers: ps })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, o.args]
        let rr = [true, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-m', 'gpt-6.1-terra', '--config', 'model_reasoning_effort="max"']]
        assert.strict.deepEqual(r, rr)
    })

    it('遞補: pick [terra, sol]中terra失敗時換sol成交, tried依序為terra失敗、sol成功', async function() {
        //規格: 任務2「遞補鏈／預設順序」——terra在前、sol在後, 前者失敗由後者遞補(假CLI以--fake-exit=1令terra失敗)
        let { providers: ps } = resolveProviders(providers, {
            env: {},
            pick: [TERRA, SOL],
            exes: { codex: fake.exe },
            patch: { [TERRA]: { extraArgs: ['--config', 'model_reasoning_effort="high"', '--fake-exit=1'] } },
        })
        let t = await dispatchAiFallback('abc', { providers: ps })
        let o = JSON.parse(t.stdout)
        let r = [t.ok, t.providerId, t.tried.map((x) => [x.providerId, x.outcome === 'ok']), o.args.includes('gpt-6.1-sol')]
        let rr = [true, SOL, [[TERRA, false], [SOL, true]], true]
        assert.strict.deepEqual(r, rr)
    })

})
