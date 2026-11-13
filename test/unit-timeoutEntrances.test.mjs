import assert from 'assert'
import http from 'http'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import budgetFor from '../src/budgetFor.mjs'
import fetchQuotaJson from '../src/quota/fetchQuotaJson.mjs'
import { probeAnthropicKey } from '../src/probeAnthropicKeys.mjs'
import { timeoutPatch } from '../src/resolveCatalogue.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'
import delayProxyForTest from './tools/delayProxyForTest.mjs'
import { CASES, PAIRS, DF, TIMER_MAX } from './tools/timeoutCasesForTest.mjs'


// unit-timeoutEntrances.test.mjs — timeoutMs各入口之判定一致(2026-11-13 da-hy, 排程第438項; 帳本R-TIMEOUT-1、G17)
//
// 規格: timeoutMs為「可計算之正整數且不超過計時器上限2147483647」才採用, 其餘一律視為未給而用各入口自己之預設(轉接器與遞補層為全套件統一之300000), 不夾上限;
// wsemi 1.9.59起execCli之timeoutMs亦以iseint之timer判定、超上限者改用它自己之預設120000, 本套件若原樣轉交(舊以castPintOr通過再轉交)則外層實際為120秒而非300秒,
// 且REST類入口之setTimeout(timeoutMs)遇超過上限之值會溢位為1毫秒(立即逾時)——入口須先判定。
//
// 四組觀察:
//   ①子行程探針(test/tools/probeTimeoutSitesForTest.mjs): 把wsemi execCli換成記錄替身, 逐入口、逐輸入值觀察「實際交給execCli之timeoutMs」與agy之--print-timeout(不spawn, 與機器負載無關);
//   ②REST四家(真實走setTimeout與fetch, 經延遲代理令伺服器端固定延遲300毫秒): 超過上限等非預期值須採用預設、請求成功, 不得因計時器溢位而立即TIMEOUT;
//   ③額度與探測之fetch類讀者(fetchQuotaJson、probeAnthropicKey; 同樣經延遲代理);
//   ④純函數入口: budgetFor(各條目timeoutMs之總和須與實際採用值一致)、timeoutPatch(逐層判定, 無效層落到下一層)。
//   工作流三站(callAiWithFallback、runFanout、runRolePipeline之validate等待上限)與checkTruncation、filterOpencodeFree、opencodeGoUsage、getQuotaClaude、getQuotaCodex
//   僅由unit-castTimerMs之站點盤點固定(無行為測試, 見帳本R-TIMEOUT-1)。


let PROBE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'probeTimeoutSitesForTest.mjs')

//各入口自己之預設(無效值時採用): 轉接器與遞補層為全套件統一預設; agy版本探測上限15000; agy額度查詢預設60000(版本把關上限15000)
let AGY_QUOTA_DF = 60000
let PROBE_MAX = 15000


//runProbe, 啟動子行程探針並解析其單行JSON; 子行程失敗即fail
function runProbe() {
    let r = spawnSync(process.execPath, [PROBE], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
    assert.strict.equal(r.status, 0, `探針子行程離開碼${r.status}: ${r.stderr}`)
    let lastLine = r.stdout.trim().split('\n').pop()
    return JSON.parse(lastLine)
}


describe('timeoutMs各入口之判定一致(子行程探針: execCli記錄替身)', function() {

    let o = null

    before(function() {
        o = runProbe()
    })

    //expectOf, 依輸入表產生各入口之預期(格式與探針輸出對應)
    let expectOf = (fn) => CASES.map((c) => [c.label, fn(c)])
    let gotOf = (site, key = 'got') => o[site].map((x) => [x.label, x[key]])

    it('輸入表覆蓋: 有效與無效並有、含計時器上限與其+1、含Infinity／數字字串／十六進位字串／包裝物件／BigInt／未給', function() {
        let labels = CASES.map((c) => c.label)
        let r = [
            CASES.filter((c) => c.want !== null).length >= 8,
            CASES.filter((c) => c.want === null).length >= 20,
            labels.includes('2147483647(計時器上限)'),
            labels.includes('2147483648(超過上限1)'),
            labels.includes('Infinity'),
            labels.includes('\'5000\'(數字字串)'),
            labels.includes('\'0x10\''),
            labels.includes('new Number(5000)(包裝物件)'),
            labels.includes('5000n(BigInt)'),
            labels.includes('undefined(未給)'),
            Object.keys(o).length,
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true, true, true, true, 13])
    })

    //單次呼叫execCli之入口: 交給execCli者恆為「有效值或300000」
    for (let site of ['runExecCli', 'dispatchClaude', 'dispatchCodex', 'dispatchOpencode', 'dispatchAntigravity', 'dispatchAiFallback(條目)', 'dispatchAiFallback(共用)', 'createAiCaller(建構)', 'createAiCaller(逐次)']) {
        it(`${site}: 交給execCli之timeoutMs＝有效值(1～2147483647之正整數或其數字字串), 其餘一律300000(不夾上限、不轉交原值)`, function() {
            //規格: 可計算之正整數且不超過計時器上限者採用, 其餘用全套件統一預設300000(帳本G17; wsemi execCli對非預期值改用其自有預設120000, 故本層先判定)
            let want = expectOf((c) => [c.want === null ? DF : c.want])
            assert.strict.deepEqual(gotOf(site), want)
        })
    }

    it('checkAgyStdinSupport: 探測逾時＝有效值與15000取小, 無效一律15000(上限15000)', function() {
        let want = expectOf((c) => [c.want === null ? PROBE_MAX : Math.min(c.want, PROBE_MAX)])
        assert.strict.deepEqual(gotOf('checkAgyStdinSupport'), want)
    })

    it('getQuotaAntigravity: 版本把關＝有效值與15000取小、/usage呼叫＝有效值, 無效值之預設為60000', function() {
        let want = expectOf((c) => {
            let eff = c.want === null ? AGY_QUOTA_DF : c.want
            return [Math.min(eff, PROBE_MAX), eff]
        })
        assert.strict.deepEqual(gotOf('getQuotaAntigravity'), want)
    })

    //agy之--print-timeout: 由「生效之timeoutMs」推導, 恆大於它(外層先逾時); 參數層驗證(不spawn), 極短值(1、999毫秒)亦在此驗, 不依賴子進程啟動速度
    it('dispatchAntigravity之--print-timeout＝floor(生效timeoutMs/1000)+30秒(參數層, 不spawn): 含1、999、1001、39999、40001毫秒與超過上限者(改用預設而得330s)', function() {
        let want = expectOf((c) => [`${Math.floor((c.want === null ? DF : c.want) / 1000) + 30}s`])
        assert.strict.deepEqual(gotOf('dispatchAntigravity', 'pt'), want)
    })

    it('getQuotaAntigravity之/usage之--print-timeout＝max(5, ceil(生效timeoutMs/1000))秒, 恆≥生效timeoutMs(參數層)', function() {
        let want = expectOf((c) => [null, `${Math.max(5, Math.ceil((c.want === null ? AGY_QUOTA_DF : c.want) / 1000))}s`])
        assert.strict.deepEqual(gotOf('getQuotaAntigravity', 'pt'), want)
    })

    it('超過計時器上限者不被夾至上限: 2147483648與9223372007000之--print-timeout為330s(預設300000), 而非2147513s', function() {
        let pick = (label) => o.dispatchAntigravity.find((x) => x.label === label).pt
        assert.strict.deepEqual([pick('2147483647(計時器上限)'), pick('2147483648(超過上限1)'), pick('9223372007000'), pick('Number.MAX_SAFE_INTEGER')], [['2147513s'], ['330s'], ['330s'], ['330s']])
    })

    it('dispatchAiFallback逐層判定(條目 → 共用 → 預設300000): 條目有效者用條目; 條目無效(超過上限、Infinity、\'0x10\'、小數)或未給者落到有效之共用值; 皆無效用預設', function() {
        //規格: 無效值視為未給; 不得以條目自帶之無效值遮蔽有效之共用值(同resolveCatalogue之timeoutPatch逐層落下; 外審#5)
        //預期值之獨立算法(不呼叫被測物): 規格表——1～2147483647之整數(數字)或其純數字十進位字串才有效
        let valid = (v) => {
            if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= TIMER_MAX) {
                return v
            }
            if (typeof v === 'string' && /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= TIMER_MAX) {
                return Number(v)
            }
            return null
        }
        let want = PAIRS.map(([e, s]) => [`${String(e)}|${String(s)}`, [valid(e) ?? valid(s) ?? DF]])
        assert.strict.deepEqual(gotOf('dispatchAiFallback(條目×共用)'), want)
    })

    it('守門運作且呼叫端自給小數deadlineAt: 以剩餘預算封頂之timeoutMs為整數、在(0, 100000]內(小數之timeoutMs交execCli會被其判為無效而改用120000)', function() {
        let got = o['runExecCli(守門deadlineAt小數)'][0].got
        assert.strict.deepEqual([got.length, Number.isInteger(got[0]), got[0] > 0 && got[0] <= 100000], [1, true, true])
    })

    it('探針無入口拋錯(各入口不throw)', function() {
        let errs = []
        for (let [site, rows] of Object.entries(o)) {
            for (let x of rows) {
                if (x.err) {
                    errs.push([site, x.label, x.err])
                }
            }
        }
        assert.strict.deepEqual(errs, [])
    })

})


describe('REST四家之timeoutMs: 非預期值採用預設, 不因計時器溢位而立即逾時(真實setTimeout與fetch, 伺服器端延遲300毫秒)', function() {

    let svrApi = null
    let svrAnt = null
    let proxyApi = null
    let proxyAnt = null
    let urlApi = ''
    let urlAnt = ''
    let Q = { urgent: { type: 'noul', instructions: '是否急迫?' } }

    before(async function() {
        svrApi = await fakeServerForApiTest()
        svrAnt = await fakeServerForAnthropicTest()
        proxyApi = await delayProxyForTest(new URL(svrApi.url).origin, 300)
        proxyAnt = await delayProxyForTest(new URL(svrAnt.url).origin, 300)
        //代理只換origin, 路徑(如/v1)沿用假伺服器之baseURL; 路徑僅為根時不附加(免出現雙斜線)
        let pathOf = (u) => (new URL(u).pathname === '/' ? '' : new URL(u).pathname)
        urlApi = proxyApi.origin + pathOf(svrApi.url)
        urlAnt = proxyAnt.origin + pathOf(svrAnt.url)
    })

    after(async function() {
        for (let x of [proxyApi, proxyAnt, svrApi, svrAnt]) {
            if (x) {
                await x.close()
            }
        }
    })

    let KEY = 'sk-good-1'
    let AKEY = 'sk-ant-api03-TESTKEY-AAAA1111BBBB2222cccc3333'
    let SITES = {
        'dispatchApiOpenaiCompat': (tm) => dispatchApiOpenaiCompat('abc', { baseURL: urlApi, key: KEY, model: 'echo', maxRetries: 0, timeoutMs: tm }),
        'dispatchApiOpenaiResponses': (tm) => dispatchApiOpenaiResponses('abc', { baseURL: urlApi, key: KEY, model: 'echo', maxRetries: 0, timeoutMs: tm }),
        'dispatchApiTypesafeSystemone': (tm) => dispatchApiTypesafeSystemone('abc', { baseURL: urlApi, key: KEY, model: 'echo', questions: Q, maxRetries: 0, timeoutMs: tm }),
        'dispatchApiAnthropic': (tm) => dispatchApiAnthropic('abc', { baseURL: urlAnt, key: AKEY, model: 'ok', maxRetries: 0, timeoutMs: tm }),
    }

    for (let [site, call] of Object.entries(SITES)) {
        it(`${site}: 有效值60000與其數字字串成功(對照); 超過上限之值(2147483648、3000000000、MAX_SAFE_INTEGER)、Infinity、'0x10'、1.5皆改用預設300000而成功`, async function() {
            //規格: 非預期值視為未給、改用預設300000(不是「原值交給setTimeout而溢位為1毫秒」, 也不是夾至上限); 伺服器端固定延遲300毫秒, 逾時值若被誤採為1毫秒或16毫秒必TIMEOUT
            //(對照用有效值取60000而非5000: 免高負載下300毫秒之往返逼近有效值之逾時而誤紅, 此案只驗「值之採用」不驗負載容忍)
            let TMS = [60000, '60000', 2147483648, 3000000000, Number.MAX_SAFE_INTEGER, Infinity, '0x10', 1.5, undefined]
            let r = []
            for (let tm of TMS) {
                let t = await call(tm)
                r.push([String(tm), t.ok, t.ok ? null : t.error])
            }
            let rr = TMS.map((tm) => [String(tm), true, null])
            assert.strict.deepEqual(r, rr)
        })
    }

})


describe('額度與探測之fetch類讀者(fetchQuotaJson、probeAnthropicKey)之timeoutMs: 非預期值採用預設, 不因計時器溢位而立即逾時', function() {

    let target = null
    let proxy = null

    before(async function() {
        //目標伺服器: 對任何請求立即回200與{"ok":true}; 代理令其延遲300毫秒(誤採為1或16毫秒者必逾時中止)
        target = http.createServer((req, res) => {
            req.resume()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
        })
        await new Promise((resolve) => {
            target.listen(0, '127.0.0.1', resolve)
        })
        proxy = await delayProxyForTest(`http://127.0.0.1:${target.address().port}`, 300)
    })

    after(async function() {
        if (proxy) {
            await proxy.close()
        }
        if (target) {
            target.closeAllConnections()
            await new Promise((resolve) => {
                target.close(resolve)
            })
        }
    })

    let BAD = [2147483648, 3000000000, Number.MAX_SAFE_INTEGER, Infinity, '0x10', 1.5, undefined]

    it('fetchQuotaJson: 有效值60000成功(對照); 超過上限、Infinity、\'0x10\'、1.5皆改用預設20000而成功', async function() {
        let r = []
        for (let tm of [60000, ...BAD]) {
            let t = await fetchQuotaJson(`${proxy.origin}/usage`, { timeoutMs: tm })
            r.push([String(tm), t.ok, t.ok ? null : t.error])
        }
        assert.strict.deepEqual(r, [60000, ...BAD].map((tm) => [String(tm), true, null]))
    })

    it('probeAnthropicKey: 有效值60000成功(對照); 超過上限、Infinity、\'0x10\'、1.5皆改用預設20000而成功(kind ok)', async function() {
        let r = []
        for (let tm of [60000, ...BAD]) {
            let t = await probeAnthropicKey('sk-ant-api03-TESTKEY-AAAA1111BBBB2222cccc3333', { baseURL: proxy.origin, timeoutMs: tm })
            r.push([String(tm), t.kind, t.ok])
        }
        assert.strict.deepEqual(r, [60000, ...BAD].map((tm) => [String(tm), 'ok', true]))
    })

})


describe('budgetFor與timeoutPatch之timeoutMs判定與實際採用值一致', function() {

    it('budgetFor: 條目timeoutMs無效(超過上限、Infinity、\'0x10\'、小數、包裝物件)者以300000計(與轉接器實際採用值相同), 有效者原值', function() {
        //規格: budgetFor＝遞補鏈走滿所需預算＝各條目「實際採用之timeoutMs」之總和; 若判定與轉接器不一致, 預算會與實際最壞耗時不符
        let b = (tm) => budgetFor([{ timeoutMs: tm }, { timeoutMs: 1000 }])
        // eslint-disable-next-line no-new-wrappers
        let wrapped = new Number(5000) //包裝物件為刻意之輸入(ispint為真、iseint為假)
        let r = [b(5000), b('5000'), b(2147483647), b(2147483648), b(3000000000), b(Infinity), b('0x10'), b(1.5), b(wrapped), b(undefined), b(0)]
        let rr = [6000, 6000, 2147484647, 301000, 301000, 301000, 301000, 301000, 301000, 301000, 301000]
        assert.strict.deepEqual(r, rr)
    })

    it('timeoutPatch: 逐層(providerTimeouts → 條目 → 全域)判定, 無效層(超過上限、Infinity、\'0x10\'等)視為未給而落到下一層, 皆無效則該id不入patch', function() {
        let merged = [{ id: 'a', timeoutMs: 1000 }, { id: 'b' }, { id: 'c' }]
        let r = [
            timeoutPatch(merged, { providerTimeouts: { a: 3000000000, b: 'x' }, timeoutMs: 2147483648 }),
            timeoutPatch(merged, { providerTimeouts: { a: 2147483648 }, timeoutMs: 30000 }),
            timeoutPatch(merged, { providerTimeouts: { a: '0x10', b: Infinity }, timeoutMs: '40000' }),
            timeoutPatch(merged, { timeoutMs: 2147483647 }),
            timeoutPatch(merged, { timeoutMs: 1.5 }),
        ]
        let rr = [
            { a: { timeoutMs: 1000 } },
            { a: { timeoutMs: 1000 }, b: { timeoutMs: 30000 }, c: { timeoutMs: 30000 } },
            { a: { timeoutMs: 1000 }, b: { timeoutMs: 40000 }, c: { timeoutMs: 40000 } },
            { a: { timeoutMs: 1000 }, b: { timeoutMs: TIMER_MAX }, c: { timeoutMs: TIMER_MAX } },
            { a: { timeoutMs: 1000 } },
        ]
        assert.strict.deepEqual(r, rr)
    })

})
