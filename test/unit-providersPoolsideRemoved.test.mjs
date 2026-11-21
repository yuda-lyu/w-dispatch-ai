import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import readEnvFile from '../src/readEnvFile.mjs'


// unit-providersPoolsideRemoved.test.mjs — 內建providers移除Poolside laguna兩條目(2026-11-21, 主控任務20261121154013之dl583; 帳本R-PROVIDERS-1)
//
// 規格來源(使用者2026-11-21指示, 主控已定):
//   ①刪除oc:poolside/poolside/laguna-s-2.1與poolside:laguna-s-2.1兩條目(以現有金鑰兩者之POST /chat/completions一律HTTP 400
//     「Model version … is deactivated」, /models清單雖仍列, 全取遞補每輪白耗兩格); providers.mjs檔頭之漂移紀錄記本次;
//   ②POOLSIDE_KEYS已無內建條目使用, 自「內建供應商之金鑰變數」之列舉移除; 但readEnvFile／resolveProviders／splitKeys之通用機制不改
//     (使用端自訂條目仍可用任意envVar, 含POOLSIDE_KEYS);
//   ③README以laguna為例之處改用仍存在之條目。
// 全部不連網、不呼叫任何AI服務。


let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let OC_ID = 'oc:poolside/poolside/laguna-s-2.1'
let REST_ID = 'poolside:laguna-s-2.1'


describe('providers: 內建條目不含poolside(2026-11-21移除laguna兩條目)', function() {

    it('內建providers不含「poolside:」或「oc:poolside/」前綴之條目, 兩個已移除之id皆查無', function() {
        //規格: 使用者指示①「自內建providers移除Poolside laguna之兩條目」
        let ids = providers.map((p) => p.id)
        let r = [
            ids.filter((id) => id.startsWith('poolside:') || id.startsWith('oc:poolside/')),
            ids.includes(OC_ID),
            ids.includes(REST_ID),
        ]
        assert.strict.deepEqual(r, [[], false, false])
    })

    it('內建providers中無任何條目指向Poolside(model含laguna或poolside/、provider為poolside、baseURL為inference.poolside.ai、envVar為POOLSIDE_KEYS), 以欄位而非id查(防改id換皮)', function() {
        //規格: 使用者指示①＋②——POOLSIDE_KEYS已無內建條目使用
        let hit = providers.filter((p) => {
            let s = JSON.stringify(p).toLowerCase()
            return /laguna|poolside/.test(s)
        })
        let r = [
            hit.map((p) => p.id),
            providers.some((p) => p.envVar === 'POOLSIDE_KEYS'),
            providers.some((p) => p.provider === 'poolside'),
        ]
        assert.strict.deepEqual(r, [[], false, false])
    })

    it('全取時缺環境變數之skipped不含POOLSIDE_KEYS(內建條目已不使用該變數); 備齊其餘變數、刻意不給POOLSIDE_KEYS時無任何條目被停用(providers.length等於目錄條目數)', function() {
        //規格: 使用者指示②「內建條目不再使用POOLSIDE_KEYS」
        let none = resolveProviders(providers, { env: {} })
        let full = resolveProviders(providers, {
            env: { OPENCODE_KEYS: 'sk-1', OPENCODE_GO_KEYS: 'sk-2', AGNES_KEYS: 'sk-3', TYPESAFE_KEYS: 'apikey_4', ANTHROPIC_KEYS: 'sk-ant-5' }, //刻意不給POOLSIDE_KEYS
        })
        let r = [
            none.skipped.some((s) => s.envVar === 'POOLSIDE_KEYS'),
            full.skipped,
            full.providers.length === providers.length,
        ]
        assert.strict.deepEqual(r, [false, [], true])
    })

    it('以已移除之id做pick者落入missing(不拋錯、不靜默忽略)且不進providers, 並附hints; 以patch指名者靜默無作用', function() {
        //規格: README行為變更第78條「pick指名此兩id者列入missing; patch指名者靜默無作用」
        let t = resolveProviders(providers, { env: {}, pick: [REST_ID, OC_ID, 'claude:sonnet'] }) //claude:sonnet無envVar, 無金鑰環境下仍進providers
        let p = resolveProviders(providers, { env: {}, patch: { [REST_ID]: { timeoutMs: 1234 }, [OC_ID]: { timeoutMs: 1234 } } })
        let base = resolveProviders(providers, { env: {} })
        let r = [
            t.missing,
            t.providers.map((x) => x.id),
            Object.keys(t.hints),
            p.providers.map((x) => x.id).some((id) => id === REST_ID || id === OC_ID),
            p.providers.length === base.providers.length,
        ]
        assert.strict.deepEqual(r, [[REST_ID, OC_ID], ['claude:sonnet'], [REST_ID, OC_ID], false, true])
    })

    it('其餘條目之id與相對順序不動: 以id前綴分群之順序為oc→ocgo→agy→claude→codex→typesafe→zen→agnes→claude-api→anthropic, 且agnes群組之後即為claude-api(六條計費條目仍集中於清單末端)', function() {
        //規格: 使用者「不得改變」——其他條目之id、順序; 移除poolside後agnes:為REST群組之末, 其後緊接claude-api:
        let ids = providers.map((p) => p.id)
        let prefixes = ids.map((id) => id.split(':')[0])
        let runs = prefixes.filter((x, i) => i === 0 || x !== prefixes[i - 1])
        let iLastAgnes = ids.lastIndexOf('agnes:agnes-3.0-flash')
        let r = [runs, ids[iLastAgnes + 1], ids.slice(-6)]
        let rr = [
            ['oc', 'ocgo', 'agy', 'claude', 'codex', 'typesafe', 'zen', 'agnes', 'claude-api', 'anthropic'],
            'claude-api:opus-5.5',
            ['claude-api:opus-5.5', 'claude-api:sonnet-5.5', 'claude-api:haiku-5.5', 'anthropic:opus-5.5', 'anthropic:sonnet-5.5', 'anthropic:haiku-5.5'],
        ]
        assert.strict.deepEqual(r, rr)
    })

})


describe('通用機制不改: 使用端自訂條目仍可用任意envVar(含POOLSIDE_KEYS)', function() {

    let TMP = path.join(ROOT, 'test', '_tmp', 'providersPoolsideRemoved')

    before(function() {
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    it('自訂條目帶envVar: POOLSIDE_KEYS時, resolveProviders依env展開為keys並移除envVar; 缺變數者列skipped(與其他envVar同規則)', function() {
        //規格: 使用者指示②「通用機制不改(resolveProviders仍接受自訂條目之任意envVar)」; 本案修前修後皆綠(「不得改變」守門)
        let custom = [{ id: 'my:poolside-like', kind: 'api-openai-compat', model: 'm', baseURL: 'https://example.invalid/v1', envVar: 'POOLSIDE_KEYS' }]
        let a = resolveProviders(custom, { env: { POOLSIDE_KEYS: 'k1, k2' } })
        let b = resolveProviders(custom, { env: {} })
        let r = [
            a.providers.map((p) => [p.id, p.keys, p.envVar]),
            a.skipped,
            b.providers.length,
            b.skipped,
        ]
        let rr = [
            [['my:poolside-like', ['k1', 'k2'], undefined]],
            [],
            0,
            [{ id: 'my:poolside-like', envVar: 'POOLSIDE_KEYS' }],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('readEnvFile仍照常讀出POOLSIDE_KEYS(不依變數名白名單), 且不污染process.env', function() {
        //規格: 使用者指示②「readEnvFile…仍接受使用端自訂條目之任意envVar」; 本案修前修後皆綠
        let fp = path.join(TMP, 'poolside.env')
        fs.writeFileSync(fp, 'POOLSIDE_KEYS=pk-1,pk-2\nOTHER_KEYS=ok-1\n')
        let before = process.env.POOLSIDE_KEYS
        let env = readEnvFile(fp)
        let r = [env, process.env.POOLSIDE_KEYS === before]
        assert.strict.deepEqual(r, [{ POOLSIDE_KEYS: 'pk-1,pk-2', OTHER_KEYS: 'ok-1' }, true])
    })

})


describe('文件同步: providers.mjs檔頭漂移紀錄與README(2026-11-21)', function() {

    it('providers.mjs: 兩條目區塊已移除(無id字面), 檔頭有2026-11-21漂移紀錄(日期、/models仍列而POST一律400之訊息、兩個版本代號、使用者指示、37 → 35、POOLSIDE_KEYS已無內建條目使用)', function() {
        let s = read('src/providers.mjs')
        let r = [
            s.includes(`id: '${OC_ID}'`),
            s.includes(`id: '${REST_ID}'`),
            s.includes('//   2026-11-21之漂移(使用者指示; 主控任務20261121154013之dl583'),
            s.includes('GET /models仍列poolside/laguna-xs-2.1、poolside/laguna-s-2.1') && s.includes('POST /chat/completions'),
            s.includes('HTTP 400') && s.includes('Model version qvml0p9 is deactivated. It needs to be activated before running predictions'),
            s.includes('Model version wdlvmme is deactivated'),
            s.includes('內建providers 37 → 35條'),
            s.includes('POOLSIDE_KEYS已無內建條目使用'),
        ]
        assert.strict.deepEqual(r, [false, false, true, true, true, true, true, true])
    })

    it('providers.mjs: 不再把poolside列為REST直呼前綴或內建金鑰變數(檔頭id命名、使用方式之.env範例), 且2026-09-22「實測仍可用故保留」已註明自2026-11-21起不成立', function() {
        let s = read('src/providers.mjs')
        let useLine = s.split('\n').find((x) => x.includes('let env = readEnvFile(')) || ''
        let r = [
            s.includes('//   zen:/agnes:/poolside:＝REST直呼'),
            useLine.includes('POOLSIDE_KEYS'),
            useLine.includes('AGNES_KEYS') && useLine.includes('TYPESAFE_KEYS'),
            s.includes('實測仍可用故保留(2026-11-21起不成立, 見該日漂移紀錄'),
        ]
        assert.strict.deepEqual(r, [false, false, true, true])
    })

    it('其他src說明不再把POOLSIDE列為已知內建供應商: splitKeys.mjs、resolveProviders.mjs、readEnvFile.mjs皆無poolside字樣', function() {
        let r = ['src/splitKeys.mjs', 'src/resolveProviders.mjs', 'src/readEnvFile.mjs'].map((f) => /poolside|laguna/i.test(read(f)))
        assert.strict.deepEqual(r, [false, false, false])
    })

    it('src/dispatchAiFallback.mjs之id命名規則範例不以已移除之laguna／poolside條目為例(改用仍存在之條目)', function() {
        let s = read('src/dispatchAiFallback.mjs')
        assert.strict.deepEqual([/laguna|poolside/i.test(s), s.includes('\'claude:sonnet\' / \'claude-api:sonnet-5.5\' / \'anthropic:sonnet-5.5\'')], [false, true])
    })

    it('README: 行為變更第78條載明移除之兩個id、依據(兩個版本代號)、37 → 35、pick落入missing、patch無作用、POOLSIDE_KEYS已無內建條目使用、自訂條目不受影響', function() {
        let t = read('README.md')
        let r = [
            t.includes('78. ①**移除內建條目 `oc:poolside/poolside/laguna-s-2.1` 與 `poolside:laguna-s-2.1`**'),
            t.includes('Model version qvml0p9 is deactivated') && t.includes('Model version wdlvmme is deactivated'),
            t.includes('內建 providers 37 → 35 條'),
            t.includes('`pick` 指名此兩 id 者列入 `missing`') && t.includes('`patch` 指名者靜默無作用'),
            t.includes('`POOLSIDE_KEYS` 已無內建條目使用'),
            t.includes('`readEnvFile`／`resolveProviders`／`splitKeys` 仍接受自訂條目之任意 `envVar`'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true])
    })

    it('README: 現行說明不再以laguna為例或把POOLSIDE_KEYS列為內建金鑰變數(行為變更紀錄為歷史, 不在此列): .env範例、pick打錯字範例、id命名規則表、推理模型max_tokens說明', function() {
        let t = read('README.md')
        let idx = t.indexOf('#### Options shared by all dispatch functions:') //行為變更紀錄(歷史)止於此
        let current = t.slice(idx)
        let envLine = current.split('\n').find((x) => x.includes('金鑰放.env(')) || ''
        let r = [
            /laguna/i.test(current),
            /POOLSIDE_KEYS/.test(envLine),
            /POOLSIDE_KEYS/.test(current),
            current.includes('pick: [\'agnes/agnes-3.0-flash\']'),
        ]
        assert.strict.deepEqual(r, [false, false, false, true])
    })

})
