import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import resolveCatalogue, { mergeCatalogue, timeoutPatch } from '../src/resolveCatalogue.mjs'
import providersAll from '../src/providers.mjs'


// unit-resolveCatalogue.test.mjs — 目錄展開(mergeCatalogue／timeoutPatch／resolveCatalogue; 2026-11-01 da40, Gitea #40)
//
// 規格來源: 建議檔§1(自srcRunner移入之行為契約)與帳本R-CATALOGUE-1:
//   mergeCatalogue: 新id追加、同id逐欄覆蓋(淺合併)、不改動輸入; extraProviders為undefined／null視為[],給了但非陣列拋'ai.extraProviders 須為陣列',
//     條目非物件或缺id(非空字串)拋'ai.extraProviders[i] 須為含 id 之條目物件'; catalogue非陣列用內建目錄。
//   timeoutPatch: 逐id取providerTimeouts[id] → 條目自帶timeoutMs → 全域timeoutMs, 只收正整數; pick省略或空陣列對全目錄;
//     merged非陣列拋'timeoutPatch 需要 merged（條目陣列）'。
//   resolveCatalogue: env物件優先, 否則envFile, 皆無交resolveProviders預設; 逾時patch與呼叫端patch逐id淺合併且後者優先;
//     回{ merged, env, resolved }, resolved即resolveProviders原始回傳。
// 全部為純函數測試(envFile案以test/_tmp/resolveCatalogue/下的暫存.env, 測完即刪)。


let TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'resolveCatalogue')


describe('mergeCatalogue', function() {

    // 規格句: extraProviders為undefined／null視為[]
    it('extraProviders為undefined或null視為空陣列(回傳等同目錄之新陣列)', function() {
        let base = [{ id: 'a', kind: 'claude' }]
        let r1 = mergeCatalogue(base, undefined)
        let r2 = mergeCatalogue(base, null)
        let r3 = mergeCatalogue(base)
        assert.strict.deepEqual([r1, r2, r3], [base, base, base])
        assert.strict.deepEqual([r1 !== base, r2 !== base, r3 !== base], [true, true, true])
    })

    // 規格句: 給了但非陣列拋'ai.extraProviders 須為陣列'; 條目非物件或缺id(非空字串)拋含索引之訊息
    it('extraProviders非陣列、條目非物件或缺id一律拋錯(訊息附索引、不回顯值)', function() {
        let msgs = []
        let run = (extra) => {
            try {
                mergeCatalogue([{ id: 'a' }], extra)
                msgs.push(null)
            }
            catch (err) {
                msgs.push(err.message)
            }
        }
        run('abc')
        run({ id: 'x' })
        run(123)
        run([{ id: 'ok' }, 'str-secret-value'])
        run([{ id: 'ok' }, null])
        run([{ id: 'ok' }, { kind: 'claude' }])
        run([{ id: 'ok' }, { id: '' }])
        run([{ id: 'ok' }, { id: 5 }])
        run([[1, 2]])
        assert.strict.deepEqual(msgs, [
            'ai.extraProviders 須為陣列',
            'ai.extraProviders 須為陣列',
            'ai.extraProviders 須為陣列',
            'ai.extraProviders[1] 須為含 id 之條目物件',
            'ai.extraProviders[1] 須為含 id 之條目物件',
            'ai.extraProviders[1] 須為含 id 之條目物件',
            'ai.extraProviders[1] 須為含 id 之條目物件',
            'ai.extraProviders[1] 須為含 id 之條目物件',
            'ai.extraProviders[0] 須為含 id 之條目物件',
        ])
        assert.strict.equal(msgs.some((m) => String(m).includes('secret')), false)
    })

    // 規格句: 同id逐欄覆蓋、新id追加、不改動輸入
    it('同id逐欄覆蓋(淺合併)、新id追加於末端，且不改動輸入之陣列與條目', function() {
        let base = [{ id: 'a', kind: 'claude', model: 'sonnet', cfg: { x: 1 } }, { id: 'b', kind: 'codex' }]
        let extra = [{ id: 'a', model: 'opus' }, { id: 'c', kind: 'opencode' }]
        let baseSnap = JSON.stringify(base)
        let extraSnap = JSON.stringify(extra)
        let r = mergeCatalogue(base, extra)
        assert.strict.deepEqual(r, [
            { id: 'a', kind: 'claude', model: 'opus', cfg: { x: 1 } },
            { id: 'b', kind: 'codex' },
            { id: 'c', kind: 'opencode' },
        ])
        assert.strict.equal(JSON.stringify(base), baseSnap)
        assert.strict.equal(JSON.stringify(extra), extraSnap)
        assert.strict.notEqual(r[0], base[0]) //被覆蓋之條目為新物件
        assert.strict.notEqual(r[2], extra[1]) //追加之條目為副本
    })

    it('extra內同id多筆依序逐欄覆蓋(後者優先)', function() {
        let r = mergeCatalogue([{ id: 'a', model: 'm0' }], [{ id: 'a', model: 'm1', kind: 'k1' }, { id: 'a', model: 'm2' }, { id: 'n', v: 1 }, { id: 'n', v: 2 }])
        assert.strict.deepEqual(r, [{ id: 'a', model: 'm2', kind: 'k1' }, { id: 'n', v: 2 }])
    })

    // 規格句: catalogue非陣列用內建目錄
    it('catalogue非陣列時用內建目錄(providers.mjs)', function() {
        let r1 = mergeCatalogue(undefined, [])
        let r2 = mergeCatalogue(null, null)
        let r3 = mergeCatalogue('abc', [])
        let r4 = mergeCatalogue({ id: 'a' }, [])
        assert.strict.deepEqual([r1, r2, r3, r4], [providersAll, providersAll, providersAll, providersAll])
        assert.strict.equal(r1 !== providersAll, true) //新陣列, 不是內建目錄本身
        let r5 = mergeCatalogue([], [{ id: 'z' }])
        assert.strict.deepEqual(r5, [{ id: 'z' }]) //空陣列是陣列, 不退回內建目錄
    })

})


describe('timeoutPatch', function() {

    // 規格句: merged非陣列拋'timeoutPatch 需要 merged（條目陣列）'
    it('merged非陣列拋錯', function() {
        for (let v of [undefined, null, 'abc', {}, 5]) {
            assert.throws(() => timeoutPatch(v, {}), { message: 'timeoutPatch 需要 merged（條目陣列）' })
        }
    })

    // 規格句: opts非物件仍用條目自帶值
    it('opts非物件或各鍵無效時仍用條目自帶timeoutMs，無自帶者不寫入', function() {
        let merged = [{ id: 'a', timeoutMs: 1000 }, { id: 'b' }]
        for (let o of [undefined, null, 'x', 5, [], {}]) {
            assert.strict.deepEqual(timeoutPatch(merged, o), { a: { timeoutMs: 1000 } })
        }
    })

    // 規格句: pick過濾且逐id覆寫優先(providerTimeouts > 條目自帶 > 全域)
    it('pick過濾，逐id覆寫(providerTimeouts)優先於條目自帶，條目自帶優先於全域timeoutMs', function() {
        let merged = [{ id: 'a', timeoutMs: 1000 }, { id: 'b', timeoutMs: 2000 }, { id: 'c' }, { id: 'd' }]
        let r = timeoutPatch(merged, { pick: ['a', 'c', 'zzz'], providerTimeouts: { a: 5000 }, timeoutMs: 300000 })
        assert.strict.deepEqual(r, { a: { timeoutMs: 5000 }, c: { timeoutMs: 300000 } })
        let r2 = timeoutPatch(merged, { providerTimeouts: { d: 7000 }, timeoutMs: 300000 })
        assert.strict.deepEqual(r2, { a: { timeoutMs: 1000 }, b: { timeoutMs: 2000 }, c: { timeoutMs: 300000 }, d: { timeoutMs: 7000 } })
    })

    // 規格句: pick省略或空陣列時對全目錄
    it('pick為空陣列或非陣列時對全目錄', function() {
        let merged = [{ id: 'a', timeoutMs: 1 }, { id: 'b', timeoutMs: 2 }]
        let all = { a: { timeoutMs: 1 }, b: { timeoutMs: 2 } }
        assert.strict.deepEqual(timeoutPatch(merged, { pick: [] }), all)
        assert.strict.deepEqual(timeoutPatch(merged, { pick: null }), all)
        assert.strict.deepEqual(timeoutPatch(merged, { pick: 'a' }), all)
    })

    // 規格句: 只收正整數(K4: 數字字串轉為數字後使用; 無效層視為未給落到下一層)
    it('只收正整數: 數字字串轉為數字；0、負數、小數、非數字之層視為未給而落到下一層', function() {
        let merged = [{ id: 'a', timeoutMs: '2000' }, { id: 'b', timeoutMs: 1000 }, { id: 'c', timeoutMs: -1 }, { id: 'd' }]
        let r = timeoutPatch(merged, {
            providerTimeouts: { b: 0, c: 'abc', d: 1.5 },
            timeoutMs: '300000',
        })
        assert.strict.deepEqual(r, {
            a: { timeoutMs: 2000 }, //條目自帶字串轉為數字
            b: { timeoutMs: 1000 }, //逐id為0(無效)落到條目自帶
            c: { timeoutMs: 300000 }, //逐id與條目自帶皆無效, 落到全域(字串轉數字)
            d: { timeoutMs: 300000 }, //逐id為小數(無效)
        })
        assert.strict.equal(typeof r.a.timeoutMs, 'number')
        let r2 = timeoutPatch(merged, { timeoutMs: 'x' })
        assert.strict.deepEqual(r2, { a: { timeoutMs: 2000 }, b: { timeoutMs: 1000 } }) //全域無效且條目無有效者不寫入
    })

    it('providerTimeouts只認自有屬性(id為Object.prototype成員時不誤取)，條目非物件或缺id者略過', function() {
        let merged = [{ id: 'toString' }, null, 'x', { id: '' }, { model: 'no-id' }, { id: 'ok' }]
        let r = timeoutPatch(merged, { providerTimeouts: {}, timeoutMs: 9 })
        assert.strict.deepEqual(r, { toString: { timeoutMs: 9 }, ok: { timeoutMs: 9 } })
    })

})


describe('resolveCatalogue', function() {

    before(function() {
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // 規格句: opt非物件時回傳形狀不變
    it('opt非物件或省略時回傳形狀不變(merged、env、resolved含providers／table／skipped／missing／hints／warnings)', function() {
        let shapes = []
        for (let o of [undefined, null, 'x', 5, [], {}]) {
            let r = resolveCatalogue(o)
            shapes.push([Object.keys(r), Object.keys(r.resolved), Array.isArray(r.merged), r.merged.length === providersAll.length])
        }
        let one = [['merged', 'env', 'resolved'], ['providers', 'table', 'skipped', 'missing', 'hints', 'warnings'], true, true]
        assert.strict.deepEqual(shapes, [one, one, one, one, one, one])
    })

    // 建議檔§7-2: 逐id優先於條目自帶; pick打錯字→missing含之且hints指向最接近id
    it('逐id逾時優先於條目自帶(extraProviders覆蓋同id)；pick打錯字列入missing並附hints', function() {
        let r = resolveCatalogue({ extraProviders: [{ id: 'claude:sonnet', timeoutMs: 1 }], pick: ['claude:sonnet'], providerTimeouts: { 'claude:sonnet': 360000 } })
        assert.strict.equal(r.resolved.table['claude:sonnet'].timeoutMs, 360000)
        assert.strict.equal(r.resolved.providers[0].timeoutMs, 360000) //陣列版與table版同源
        let r2 = resolveCatalogue({ pick: ['claude/sonnet'] })
        assert.strict.deepEqual(r2.resolved.missing, ['claude/sonnet'])
        assert.strict.equal(r2.resolved.hints['claude/sonnet'], 'claude:sonnet')
        assert.strict.deepEqual(r2.resolved.providers, [])
    })

    // 規格句: 逾時patch與呼叫端opt.patch逐id淺合併且後者優先
    it('呼叫端patch與逾時patch逐id淺合併，呼叫端優先；patch其他欄位一併生效', function() {
        let r = resolveCatalogue({
            pick: ['claude:sonnet', 'claude:opus-5.5'],
            timeoutMs: 300000,
            providerTimeouts: { 'claude:sonnet': 360000 },
            patch: { 'claude:sonnet': { timeoutMs: 111, effort: 'high' }, 'claude:opus-5.5': { model: 'opus-x' } },
        })
        let t = r.resolved.table
        assert.strict.equal(t['claude:sonnet'].timeoutMs, 111) //呼叫端優先
        assert.strict.equal(t['claude:sonnet'].effort, 'high')
        assert.strict.equal(t['claude:opus-5.5'].timeoutMs, 300000) //patch未給timeoutMs者保留逾時三層結果
        assert.strict.equal(t['claude:opus-5.5'].model, 'opus-x')
    })

    it('呼叫端patch中非物件之值略過；patch非物件整份略過', function() {
        let a = resolveCatalogue({ pick: ['claude:sonnet'], timeoutMs: 5, patch: { 'claude:sonnet': 'bad' } })
        let b = resolveCatalogue({ pick: ['claude:sonnet'], timeoutMs: 5, patch: 'bad' })
        assert.strict.equal(a.resolved.table['claude:sonnet'].timeoutMs, 5)
        assert.strict.equal(b.resolved.table['claude:sonnet'].timeoutMs, 5)
    })

    // 規格句: exes逐kind注入、條目自帶exe不覆寫、陣列版與table版同源
    it('exes逐kind注入執行檔路徑(條目自帶exe者不覆寫)，providers與table同源', function() {
        let r = resolveCatalogue({
            catalogue: [{ id: 'c1', kind: 'claude' }, { id: 'c2', kind: 'claude', exe: 'own.exe' }, { id: 'x1', kind: 'codex' }],
            exes: { claude: 'C:/bin/claude.exe' },
        })
        assert.strict.deepEqual(r.resolved.providers.map((p) => p.exe), ['C:/bin/claude.exe', 'own.exe', undefined])
        assert.strict.deepEqual(r.resolved.providers.map((p) => p.exe), Object.values(r.resolved.table).map((p) => p.exe))
    })

    // 規格句: env為物件則用之(回傳之env即該物件); 缺對應環境變數者列入skipped
    it('env物件優先: 依其展開envVar → keys，缺變數者列入skipped；回傳之env即傳入物件', function() {
        let env = { AGNES_KEYS: 'k1,k2' }
        let r = resolveCatalogue({
            env,
            extraProviders: [{ id: 'my:model', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1/v1', model: 'm', envVar: 'MY_KEYS' }],
            pick: ['agnes:agnes-3.0-flash', 'my:model'],
        })
        assert.strict.equal(r.env, env)
        assert.strict.deepEqual(r.resolved.providers.map((p) => [p.id, p.keys]), [['agnes:agnes-3.0-flash', ['k1', 'k2']]])
        assert.strict.deepEqual(r.resolved.skipped, [{ id: 'my:model', envVar: 'MY_KEYS' }])
    })

    // 規格句: env非物件時envFile有給才readEnvFile; env與envFile二擇一(env優先)
    it('envFile: env未給時讀檔(不污染process.env)；env與envFile並給以env為準；檔不存在視同空環境', function() {
        let f = path.join(TMP, 'a.env')
        fs.writeFileSync(f, 'AGNES_KEYS=f1,f2\n')
        let r1 = resolveCatalogue({ envFile: f, pick: ['agnes:agnes-3.0-flash'] })
        assert.strict.deepEqual(r1.resolved.providers[0].keys, ['f1', 'f2'])
        assert.strict.deepEqual(r1.env, { AGNES_KEYS: 'f1,f2' })
        assert.strict.equal(process.env.AGNES_KEYS === 'f1,f2', false)
        let r2 = resolveCatalogue({ env: { AGNES_KEYS: 'e1' }, envFile: f, pick: ['agnes:agnes-3.0-flash'] })
        assert.strict.deepEqual(r2.resolved.providers[0].keys, ['e1'])
        let r3 = resolveCatalogue({ envFile: path.join(TMP, 'none.env'), pick: ['agnes:agnes-3.0-flash'] })
        assert.strict.deepEqual([r3.env, r3.resolved.providers, r3.resolved.skipped], [{}, [], [{ id: 'agnes:agnes-3.0-flash', envVar: 'AGNES_KEYS' }]])
    })

    // 規格句: env與envFile皆無交resolveProviders預設(process.env), 回傳之env為null
    it('env與envFile皆未給: 交resolveProviders預設(process.env)，回傳之env為null', function() {
        let k = 'DA40_TEST_KEYS'
        process.env[k] = 'p1'
        try {
            let r = resolveCatalogue({
                catalogue: [{ id: 'q', kind: 'api-openai-compat', baseURL: 'http://127.0.0.1:1/v1', model: 'm', envVar: k }],
            })
            assert.strict.equal(r.env, null)
            assert.strict.deepEqual(r.resolved.providers[0].keys, ['p1'])
        }
        finally {
            delete process.env[k]
        }
    })

    // 規格句: extraProviders不合規時throw(隨mergeCatalogue)
    it('extraProviders不合規時拋錯(同mergeCatalogue)', function() {
        assert.throws(() => resolveCatalogue({ extraProviders: 'x' }), { message: 'ai.extraProviders 須為陣列' })
        assert.throws(() => resolveCatalogue({ extraProviders: [{}] }), { message: 'ai.extraProviders[0] 須為含 id 之條目物件' })
    })

    it('不改動輸入: catalogue、extraProviders、patch、providerTimeouts', function() {
        let catalogue = [{ id: 'a', kind: 'claude' }]
        let extraProviders = [{ id: 'a', model: 'm' }]
        let patch = { a: { effort: 'x' } }
        let providerTimeouts = { a: 5 }
        let snap = JSON.stringify([catalogue, extraProviders, patch, providerTimeouts])
        resolveCatalogue({ catalogue, extraProviders, patch, providerTimeouts, timeoutMs: 9, pick: ['a'] })
        assert.strict.equal(JSON.stringify([catalogue, extraProviders, patch, providerTimeouts]), snap)
    })

})
