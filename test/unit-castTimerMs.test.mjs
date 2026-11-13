import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import castTimerMs from '../src/castTimerMs.mjs'
import { CASES, DF } from './tools/timeoutCasesForTest.mjs'


// unit-castTimerMs.test.mjs — castTimerMs(timeoutMs之單一判定件)與src內timeoutMs判定站點之盤點(2026-11-13 da-hy, 排程第438項; 帳本R-TIMEOUT-1、G17)
//
// 規格: 帳本G17與dspec〈輸入參數之檢測機制〉§11第19～21項——opt之毫秒數以ise*判定「可計算」: 有效整數且介於1～2147483647(wsemi iseint之use:'timer'、min:1,
// 與wsemi 1.9.59起execCli之timeoutMs判定相同), 非預期(含Infinity、小數、超過上限、'0x10'、包裝物件)視為未給、改用預設, 不夾上限、不報錯。
// 本套件各入口(轉接器、遞補層、工作流、額度查詢、REST)之timeoutMs一律經本件判定, 不得再以ispint通過後cint(Infinity變1.79e308、'0x10'變16、超過上限者原樣轉交)。


let SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')


//listSrc, src下全部.mjs檔(含子目錄)
function listSrc(dir = SRC) {
    let out = []
    for (let f of fs.readdirSync(dir, { withFileTypes: true })) {
        let p = path.join(dir, f.name)
        if (f.isDirectory()) {
            out.push(...listSrc(p))
        }
        else if (f.name.endsWith('.mjs')) {
            out.push(p)
        }
    }
    return out
}


describe('castTimerMs', function() {

    it('輸入表: 有效(1～2147483647之整數或其十進位數字字串)回該數值, 其餘回預設; 預設可為任意值(含null)', function() {
        let r = CASES.map((c) => [c.label, castTimerMs(c.v, DF)])
        let rr = CASES.map((c) => [c.label, c.want === null ? DF : c.want])
        assert.strict.deepEqual(r, rr)
        assert.strict.deepEqual([castTimerMs(Infinity, null), castTimerMs(3000000000, 'dflt'), castTimerMs(5000, null)], [null, 'dflt', 5000])
    })

    it('有效輸入回傳number(數字字串轉為數字, 含空白與科學記號之整數值); 無效輸入回呼叫端給之預設(型別不限)', function() {
        let r = [castTimerMs('5000', 1), castTimerMs(' 12 ', 1), castTimerMs('1e3', 1), castTimerMs('5.0', 1), castTimerMs('+7', 1)].map((x) => [typeof x, x])
        assert.strict.deepEqual(r, [['number', 5000], ['number', 12], ['number', 1000], ['number', 5], ['number', 7]])
    })

    it('不夾上限: 超過2147483647者回預設, 不回2147483647; 恰2147483647採用; 取值即拋錯之物件不throw而回預設', function() {
        let bad = {
            valueOf() {
                throw new Error('x')
            },
            toString() {
                throw new Error('x')
            },
        }
        assert.strict.deepEqual([castTimerMs(2147483647, DF), castTimerMs(2147483648, DF), castTimerMs(Number.MAX_SAFE_INTEGER, DF)], [2147483647, DF, DF])
        assert.strict.doesNotThrow(() => castTimerMs(bad, DF))
        assert.strict.deepEqual(castTimerMs(bad, DF), DF)
    })

})


describe('src內timeoutMs判定站點之盤點(R-TIMEOUT-1)', function() {

    //以ispint判定timeoutMs者(castPintOr(...timeoutMs...))不得存在: 一律castTimerMs
    it('src內無「castPintOr(… timeoutMs …)」站點(舊判定: ispint通過後cint, 不排除Infinity／超過計時器上限／十六進位字串)', function() {
        let hits = []
        for (let f of listSrc()) {
            let lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
            lines.forEach((ln, i) => {
                let code = ln.replace(/\/\/.*$/, '') //略過註解
                if (/castPintOr\([^)]*timeoutMs/.test(code)) {
                    hits.push(`${path.relative(SRC, f)}:${i + 1}`)
                }
            })
        }
        assert.strict.deepEqual(hits, [])
    })

    //站點全集(以 castTimerMs( 呼叫計): 盤點時之基準, 新增或移除站點須先檢查再於帳本R-TIMEOUT-1登記並改此表
    //無行為測試之站點(工作流三站之validate等待、checkTruncation、filterOpencodeFree、opencodeGoUsage、getQuotaClaude／Codex): 以「該行之完整運算式」固定,
    //只比站點數會被「保留一個無關之castTimerMs呼叫、實際改回castPintOr(raw, …)」繞過(外審#10)
    it('無行為測試之8個站點: timeoutMs之讀取運算式逐行固定為castTimerMs(讀取, 預設)(改回舊判定即紅)', function() {
        let want = [
            ['checkTruncation.mjs', 'castTimerMs(timeoutMs, dfTimeoutMs)'],
            ['filterOpencodeFree.mjs', 'let timeoutMs = castTimerMs(get(opt, \'timeoutMs\', null), DEFAULT_TIMEOUT_MS)'],
            ['opencodeGoUsage.mjs', 'let timeoutMs = castTimerMs(get(opt, \'timeoutMs\', null), DEFAULT_TIMEOUT_MS)'],
            ['quota/getQuotaClaude.mjs', 'let timeoutMs = castTimerMs(get(opt, \'timeoutMs\', null), dfQuotaTimeoutMs)'],
            ['quota/getQuotaCodex.mjs', 'let timeoutMs = castTimerMs(get(opt, \'timeoutMs\', null), dfQuotaTimeoutMs)'],
            ['wkf/callAiWithFallback.mjs', 'castTimerMs(get(opt, \'timeoutMs\', null), dfTimeoutMs)'],
            ['wkf/runFanout.mjs', 'let intTo = castTimerMs(get(intOpt, \'timeoutMs\', null), dfTimeoutMs)'],
            ['wkf/runRolePipeline.mjs', 'let stageTo = castTimerMs(get(stageOpt, \'timeoutMs\', null), dfTimeoutMs)'],
        ]
        let r = want.map(([f, expr]) => [f, fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/).some((ln) => ln.replace(/\/\/.*$/, '').includes(expr))])
        assert.strict.deepEqual(r, want.map(([f]) => [f, true]))
    })

    it('castTimerMs站點全集: 各檔站點數與帳本R-TIMEOUT-1之盤點表一致(新增站點須先檢查再登記)', function() {
        let counts = {}
        for (let f of listSrc()) {
            let code = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((ln) => ln.replace(/\/\/.*$/, '')).join('\n')
            let n = (code.match(/castTimerMs\(/g) || []).length
            if (n > 0 && !f.endsWith('castTimerMs.mjs')) {
                counts[path.relative(SRC, f).replace(/\\/g, '/')] = n
            }
        }
        let want = {
            'budgetFor.mjs': 1,
            'checkAgyStdinSupport.mjs': 1,
            'checkTruncation.mjs': 1,
            'createAiCaller.mjs': 1,
            'dispatchAiFallback.mjs': 2, //entryTimeout: 條目層與共用層逐層判定(各1)
            'dispatchAntigravity.mjs': 1,
            'dispatchApiAnthropic.mjs': 1,
            'dispatchApiOpenaiCompat.mjs': 1,
            'dispatchApiOpenaiResponses.mjs': 1,
            'dispatchApiTypesafeSystemone.mjs': 1,
            'dispatchClaude.mjs': 1,
            'dispatchCodex.mjs': 1,
            'dispatchOpencode.mjs': 1,
            'filterOpencodeFree.mjs': 1,
            'goQuotaGate.mjs': 1, //Go額度閘之讀者逾時
            'opencodeGoUsage.mjs': 1,
            'probeAnthropicKeys.mjs': 1,
            'quota/fetchQuotaJson.mjs': 1,
            'quota/getQuotaAntigravity.mjs': 1,
            'quota/getQuotaClaude.mjs': 1,
            'quota/getQuotaCodex.mjs': 1,
            'resolveCatalogue.mjs': 3,
            'runExecCli.mjs': 2, //timeoutMs與transientRetry.delayMs(交wsemi delay之計時器)
            'subQuotaGate.mjs': 2, //訂閱類額度閘之讀者逾時: timeoutMs(claude／codex)與antigravityTimeoutMs
            'wkf/callAiWithFallback.mjs': 1,
            'wkf/runFanout.mjs': 1,
            'wkf/runRolePipeline.mjs': 1,
        }
        assert.strict.deepEqual(counts, want)
    })

})
