import assert from 'assert'
import logAiOutcome, { createAiEventLogger } from '../src/wkf/logAiOutcome.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import makeArrayCoverageValidator from '../src/wkf/makeArrayCoverageValidator.mjs'


// unit-execShellContract.test.mjs — 與執行殼(w-task-runner 0.1.0)原行為契約之字面對照(2026-11-01 da42, Gitea #42; 帳本R-AISHELL-5)
//
// 規格來源: 建議檔§1～§5與§7(使用端 2026-11-01), 主控裁定「行為與契約隨件移動、不改語意」, 五處皆改回原契約:
//   §1 tag原樣接在每行之前(不加[ ]與空白; 非字串視為''), 原契約core/ai/logAiOutcome.mjs:51-53,114;
//   §2 「使用 AI」行以providerId有值為準, 不要求ok===true, 原契約core/ai/logAiOutcome.mjs:56;
//   §3 遞補歷程耗時toFixed(1), 冷卻分鐘數Math.round(cooldownMs / 60000), 原契約core/ai/logAiOutcome.mjs:75,117;
//   §4 createAiCaller.callAI零供應商之error: `無可用的 AI 供應商`後接`（<skipped以、相接>）`, 無skipped則無括號, missing不進error, 原契約core/ai/caller.mjs:97;
//   §5 makeArrayCoverageValidator之indices非陣列之TypeError訊息為`makeArrayCoverageValidator 之 indices 須為陣列`, 原契約core/ai/parsers.mjs:118。
// 期望輸出之字面逐字取自建議檔所引之執行殼測試斷言(test/unit-runner.test.mjs:263-297,359-384; test/unit-check-ai.test.mjs:44-97)與§7驗證案;
// 輸入物件則依建議檔對各斷言之描述重建(執行殼原始碼本機無複本)。
// 全部為純函數測試（記錄器為測試替身）, 零供應商案不送任何請求。


//mkLog, 每行記為`<等級> <訊息>`
let mkLog = () => {
    let lines = []
    return {
        lines,
        log: (m) => lines.push(`INFO ${m}`),
        logWarn: (m) => lines.push(`WARN ${m}`),
        logError: (m) => lines.push(`ERROR ${m}`),
    }
}


describe('§1 tag原樣接在每行之前', function() {

    // 建議檔§1: test/unit-runner.test.mjs:263-286
    it('tag: \'步驟6：\' → 四行皆以「步驟6：」起頭（不加括號與空白）', function() {
        let lg = mkLog()
        logAiOutcome({
            tag: '步驟6：',
            log: lg,
            result: {
                providerId: 'p',
                kind: 'k',
                model: 'm',
                tried: [{ providerId: 'zen:x', outcome: 'skip-group', errorType: 'http', error: 'HTTP 403 FreeTierError\nline2', durationMs: 1234 }],
                providersSkipped: ['s（S_KEYS 無金鑰）'],
                providersMissing: ['bad-id'],
            },
        })
        assert.strict.deepEqual(lg.lines, [
            'INFO 步驟6：使用 AI p（k／m）',
            'WARN 步驟6：AI 遞補歷程 → zen:x（整組跳過：http／HTTP 403 FreeTierError line2，1.2s）', //§3: unit-runner.test.mjs:283
            'WARN 步驟6：AI 供應商未納入 → s（S_KEYS 無金鑰）',
            'ERROR 步驟6：providerPick 有無效 id → bad-id（請對照供應商目錄）',
        ])
    })

    // 建議檔§1: test/unit-runner.test.mjs:288-292
    it('createAiEventLogger tag: \'步驟8b：\' → /^WARN 步驟8b：AI 供應商進入冷卻 → agy:x（TIMEOUT after 300000ms，15 分鐘內降至鏈尾/', function() {
        let lg = mkLog()
        createAiEventLogger({ log: lg, tag: '步驟8b：' })({ type: 'cooled', providerId: 'agy:x', error: 'TIMEOUT after 300000ms', cooldownMs: 900000 })
        assert.strict.equal(lg.lines.length, 1)
        assert.strict.match(lg.lines[0], /^WARN 步驟8b：AI 供應商進入冷卻 → agy:x（TIMEOUT after 300000ms，15 分鐘內降至鏈尾/)
    })

    // 建議檔§2: test/unit-check-ai.test.mjs:72-74 的 tag 部分
    it('tag: \'[fake]\' → /^\\[fake\\]使用 AI p/（分隔符由呼叫端自帶）', function() {
        let lg = mkLog()
        logAiOutcome({ tag: '[fake]', log: lg, result: { providerId: 'p', kind: 'k', model: 'm' } })
        assert.strict.match(lg.lines[0], /^INFO \[fake\]使用 AI p/)
    })

    it('tag非字串或空字串視為\'\'（無前綴）', function() {
        for (let tag of [undefined, null, '', 5, true, {}, [], ['x']]) {
            let lg = mkLog()
            logAiOutcome({ tag, log: lg, result: { providerId: 'p', kind: 'k', model: 'm' } })
            assert.strict.deepEqual(lg.lines, ['INFO 使用 AI p（k／m）'])
        }
    })

})


describe('§2 「使用 AI」行以providerId有值為準', function() {

    // 建議檔§2: test/unit-runner.test.mjs:293-295（result無ok）
    it('result為 { providerId:\'p\', kind:\'k\', model:\'m\' }（無ok）→ [\'使用 AI p（k／m）\']', function() {
        let lg = mkLog()
        logAiOutcome({ log: lg, result: { providerId: 'p', kind: 'k', model: 'm' } })
        assert.strict.deepEqual(lg.lines, ['INFO 使用 AI p（k／m）'])
    })

    // 建議檔§2: test/unit-check-ai.test.mjs:72-74
    it('同形輸入（tag [fake]）→ /^\\[fake\\]使用 AI p/', function() {
        let lg = mkLog()
        logAiOutcome({ log: lg, tag: '[fake]', result: { providerId: 'p', kind: 'k', model: 'm' } })
        assert.strict.match(lg.lines[0].slice('INFO '.length), /^\[fake\]使用 AI p/)
    })

    // 原契約 core/ai/logAiOutcome.mjs:56: if (r?.providerId) 即記, 不看ok
    it('ok為false或其他值而providerId有值: 照記「使用 AI」；providerId缺或為空字串: 不記', function() {
        for (let ok of [false, 'yes', 0, null, undefined]) {
            let lg = mkLog()
            logAiOutcome({ log: lg, result: { ok, providerId: 'p', kind: 'k', model: 'm' } })
            assert.strict.deepEqual(lg.lines, ['INFO 使用 AI p（k／m）'])
        }
        for (let providerId of [undefined, null, '']) {
            let lg = mkLog()
            logAiOutcome({ log: lg, result: { ok: true, providerId, kind: 'k', model: 'm' } })
            assert.strict.deepEqual(lg.lines, [])
        }
    })

    // 建議檔§2附帶: kind／model皆缺時省略括號為1.0.63寫法, 專案方不要求改回（避免印出undefined）
    it('kind與model皆缺: 括號省略且不印undefined（保留1.0.63寫法）', function() {
        for (let result of [{ providerId: 'p' }, { ok: true, providerId: 'p' }]) {
            let lg = mkLog()
            logAiOutcome({ log: lg, result })
            assert.strict.deepEqual(lg.lines, ['INFO 使用 AI p'])
            assert.strict.equal(lg.lines.join('').includes('undefined'), false)
        }
    })

})


describe('§3 遞補歷程耗時toFixed(1)與冷卻分鐘數Math.round', function() {

    // 建議檔§7-2逐字
    it('§7-2: logAiOutcome({ log, tag: \'步驟6：\', result: { providerId:\'p\', kind:\'k\', model:\'m\', tried:[{ providerId:\'z\', outcome:\'skip-group\', errorType:\'http\', error:\'e\', durationMs: 1234 }] } }) → 兩行恰為所列', function() {
        let lg = mkLog()
        logAiOutcome({
            log: lg,
            tag: '步驟6：',
            result: { providerId: 'p', kind: 'k', model: 'm', tried: [{ providerId: 'z', outcome: 'skip-group', errorType: 'http', error: 'e', durationMs: 1234 }] },
        })
        assert.strict.deepEqual(lg.lines, [
            'INFO 步驟6：使用 AI p（k／m）',
            'WARN 步驟6：AI 遞補歷程 → z（整組跳過：http／e，1.2s）',
        ])
    })

    // 原契約 core/ai/logAiOutcome.mjs:75: (t.durationMs / 1000).toFixed(1)
    it('耗時一律一位小數: 1234→1.2s、2000→2.0s、20→0.0s、300000→300.0s（不是1.234s、2s、0.02s、300s）', function() {
        let cases = [[1234, '1.2s'], [2000, '2.0s'], [20, '0.0s'], [300000, '300.0s'], [1960, '2.0s'], [0, '0.0s']]
        for (let [ms, s] of cases) {
            let lg = mkLog()
            logAiOutcome({ log: lg, result: { tried: [{ providerId: 'z', outcome: 'skip-group', errorType: 'http', error: 'e', durationMs: ms }] } })
            assert.strict.deepEqual(lg.lines, [`WARN AI 遞補歷程 → z（整組跳過：http／e，${s}）`])
        }
    })

    // 原契約 core/ai/logAiOutcome.mjs:117: Math.round(cooldownMs / 60000); 現有執行殼測試只用900000
    it('冷卻分鐘數Math.round: 900000→15、90000→2、600000→10、30000→1、149999→2（不是1.5）', function() {
        let cases = [[900000, '15'], [90000, '2'], [600000, '10'], [30000, '1'], [149999, '2']]
        for (let [ms, m] of cases) {
            let lg = mkLog()
            createAiEventLogger({ log: lg })({ type: 'cooled', providerId: 'agy:x', error: 'e', cooldownMs: ms })
            assert.strict.deepEqual(lg.lines, [`WARN AI 供應商進入冷卻 → agy:x（e，${m} 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）`])
        }
    })

    // 1.0.63新增之擴充, 專案方不反對, 保留
    it('保留之擴充: scope為key之金鑰冷卻行與cooldownMs無效時「冷卻視窗內」字樣', function() {
        let lg = mkLog()
        createAiEventLogger({ log: lg })({ type: 'cooled', scope: 'key', providerId: 'p', keyIndex: 0, error: 'no credit', cooldownMs: 600000 })
        createAiEventLogger({ log: lg })({ type: 'cooled', providerId: 'p', error: 'e' })
        assert.strict.deepEqual(lg.lines, [
            'WARN AI 金鑰進入冷卻 → p／key#1（no credit，10 分鐘內降至組內最後；只降序不移除，仍會被嘗試以偵測恢復）',
            'WARN AI 供應商進入冷卻 → p（e，冷卻視窗內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）',
        ])
    })

})


describe('§4 createAiCaller.callAI零供應商之error字面', function() {

    //kStub, 缺金鑰之條目（env全空）
    let kStub = { id: 'k:needs-key', kind: 'api-openai-compat', envVar: 'K_KEYS', model: 'm', baseURL: 'https://x.invalid/v1' }

    // 建議檔§4: test/unit-runner.test.mjs:371-377
    it('pick:[\'k:needs-key\']、env:{} → error符合/無可用的 AI 供應商（k:needs-key（K_KEYS 無金鑰））/；providersSkipped、tried、attempts如所列', async function() {
        let c = createAiCaller({ catalogue: [kStub], pick: ['k:needs-key'], env: {} })
        let r = await c.callAI('hi')
        assert.strict.match(r.error, /無可用的 AI 供應商（k:needs-key（K_KEYS 無金鑰））/)
        assert.strict.deepEqual(r.providersSkipped, ['k:needs-key（K_KEYS 無金鑰）'])
        assert.strict.deepEqual(r.tried, [])
        assert.strict.equal(r.attempts, 0)
    })

    // 建議檔§7-3逐字
    it('§7-3: catalogue 為 [{ id:\'k\', kind:\'api-openai-compat\', envVar:\'K_KEYS\', model:\'m\', baseURL:\'https://x.invalid/v1\' }]、pick:[\'k\']、env:{} → error === \'無可用的 AI 供應商（k（K_KEYS 無金鑰））\'', async function() {
        let r = await createAiCaller({ catalogue: [{ id: 'k', kind: 'api-openai-compat', envVar: 'K_KEYS', model: 'm', baseURL: 'https://x.invalid/v1' }], pick: ['k'], env: {} }).callAI('hi')
        assert.strict.equal(r.error, '無可用的 AI 供應商（k（K_KEYS 無金鑰））')
    })

    it('§7-3: pick:[] 且 catalogue 為 [] → error === \'無可用的 AI 供應商\'（無括號）', async function() {
        let r = await createAiCaller({ catalogue: [], pick: [], env: {} }).callAI('hi')
        assert.strict.equal(r.error, '無可用的 AI 供應商')
    })

    // 原契約 core/ai/caller.mjs:97: 括號內只有skipped以「、」相接, 無skipped則無括號
    it('多筆skipped以「、」相接; 只有missing（pick查無）時error無括號、不含missing', async function() {
        let cat = [{ id: 'a', kind: 'claude', envVar: 'A_KEYS' }, { id: 'b', kind: 'claude', envVar: 'B_KEYS' }]
        let r = await createAiCaller({ catalogue: cat, env: {} }).callAI('hi')
        assert.strict.equal(r.error, '無可用的 AI 供應商（a（A_KEYS 無金鑰）、b（B_KEYS 無金鑰））')
        let m = await createAiCaller({ catalogue: cat, pick: ['no-such-id'], env: {} }).callAI('hi')
        assert.strict.equal(m.error, '無可用的 AI 供應商')
        assert.strict.deepEqual([m.providersSkipped, m.providersMissing], [[], ['no-such-id']])
    })

    // missing由providersMissing與logAiOutcome之ERROR行表達（原契約檔頭core/ai/caller.mjs:18-20）
    it('skipped與missing並存: error只列skipped; missing由providersMissing與logAiOutcome之ERROR行表達', async function() {
        let r = await createAiCaller({ catalogue: [kStub], pick: ['k:needs-key', 'zz'], env: {} }).callAI('hi')
        assert.strict.equal(r.error, '無可用的 AI 供應商（k:needs-key（K_KEYS 無金鑰））')
        assert.strict.equal(r.error.includes('zz'), false)
        assert.strict.deepEqual(r.providersMissing, ['zz'])
        let lg = mkLog()
        logAiOutcome({ log: lg, result: r })
        assert.strict.deepEqual(lg.lines, [
            'WARN AI 供應商未納入 → k:needs-key（K_KEYS 無金鑰）',
            'ERROR providerPick 有無效 id → zz（請對照供應商目錄）',
        ])
    })

})


describe('§5 makeArrayCoverageValidator之indices非陣列之TypeError訊息', function() {

    // 建議檔§5: test/unit-check-ai.test.mjs:96 以 /makeArrayCoverageValidator 之 indices 須為陣列/ 比對
    it('indices給了但非陣列: 拋TypeError, 訊息符合/makeArrayCoverageValidator 之 indices 須為陣列/', function() {
        for (let indices of [null, 'x', 5, true, {}, { length: 1 }]) {
            assert.throws(() => makeArrayCoverageValidator({ indices }), (err) => {
                assert.strict.equal(err instanceof TypeError, true)
                assert.strict.match(err.message, /makeArrayCoverageValidator 之 indices 須為陣列/)
                assert.strict.equal(err.message, 'makeArrayCoverageValidator 之 indices 須為陣列')
                return true
            })
        }
    })

})
