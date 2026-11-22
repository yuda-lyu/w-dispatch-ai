/* eslint-disable no-new-wrappers */
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


//loadCastCountOr, 動態匯入被測件: 修前此模組不存在時只使判定件之3案紅燈(站點盤點之案讀原始碼檔而以斷言紅燈, 可逐案統計且有摘要行)
let loadCastCountOr = async () => (await import('../src/castCountOr.mjs')).default

// unit-castCountOr.test.mjs — castCountOr(次數類設定之單一判定件)與src內次數類判定站點之盤點(2026-11-22 排程第446項; 帳本R-COUNT-1、G17)
//
// 規格: 帳本G17與dspec〈輸入參數之檢測機制〉§11、K3(非預期之值視為未給用預設)、K4(檢測之值即使用之值)——次數類參數以wsemi iseint之use:'count'判定
// (0～4294967295之整數，數字或可無損轉數字之十進位字串)，其餘(Infinity、'0x10'、小數、負數、超過上限、包裝物件、布林、null、未給)視為未給用預設，不夾上限、不報錯。
// 不得再以ispint／isp0int／isint通過後cint(Infinity變1.79e308而近乎無限重試、'0x10'變16、超過上限者原樣通過)。


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


//codeOf, 去註解後之原始碼(整行註解與行尾註解; 字串內之//極少, 本盤點只比對識別字)
function codeOf(f) {
    return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((ln) => ln.replace(/\/\/.*$/, ''))
}


describe('castCountOr', function() {

    //規格句: 有效(0～4294967295之整數或其十進位數字字串, 不小於min)回該數值(number), 其餘回預設
    it('輸入表(min 0): 有效者回number、其餘回預設', async function() {
        let castCountOr = await loadCastCountOr()
        let wrapped = new Number(2)
        let cases = [
            [0, 0], [1, 1], [2, 2], ['2', 2], [' 2 ', 2], ['2e0', 2], ['+2', 2], [4294967295, 4294967295], ['4294967295', 4294967295],
            [4294967296, 'd'], [1e10, 'd'], [Number.MAX_SAFE_INTEGER, 'd'], [Number.MAX_VALUE, 'd'],
            [Infinity, 'd'], ['Infinity', 'd'], [-Infinity, 'd'], [NaN, 'd'], [-1, 'd'], [-0.5, 'd'], [1.5, 'd'], ['1.5', 'd'],
            ['0x10', 'd'], ['0o7', 'd'], ['0b1', 'd'], ['abc', 'd'], ['', 'd'], [' ', 'd'], ['1,000', 'd'],
            [wrapped, 'd'], [true, 'd'], [false, 'd'], [null, 'd'], [undefined, 'd'], [[], 'd'], [[2], 'd'], [{}, 'd'], [5n, 'd'], [() => 2, 'd'],
        ]
        let r = cases.map(([v]) => castCountOr(v, 'd'))
        assert.strict.deepEqual(r, cases.map(([, want]) => want))
        assert.strict.deepEqual(r.map((x) => typeof x), cases.map(([, want]) => typeof want))
    })

    it('min 1(至少1之次數): 0與負數回預設, 其餘同上; 預設可為任意值(含null、Infinity)', async function() {
        let castCountOr = await loadCastCountOr()
        let r = [castCountOr(0, 14, 1), castCountOr('0', 14, 1), castCountOr(1, 14, 1), castCountOr('3', 14, 1), castCountOr(undefined, null, 1), castCountOr(Infinity, Infinity, 1), castCountOr(2, 0, 1)]
        assert.strict.deepEqual(r, [14, 14, 1, 3, null, Infinity, 2])
    })

    it('取值即拋錯之物件不throw而回預設(判斷函數只收原始值)', async function() {
        let castCountOr = await loadCastCountOr()
        let bad = {
            valueOf() {
                throw new Error('x')
            },
            toString() {
                throw new Error('x')
            },
        }
        let proxy = new Proxy({}, {})
        let revoked = Proxy.revocable({}, {})
        revoked.revoke()
        assert.strict.doesNotThrow(() => castCountOr(bad, 7))
        assert.strict.deepEqual([castCountOr(bad, 7), castCountOr(proxy, 7), castCountOr(revoked.proxy, 7)], [7, 7, 7])
    })

})


describe('src內次數類判定站點之盤點(R-COUNT-1)', function() {

    //舊判定(數學定義之整數, 通過後cint)不得存在於src: 次數類一律castCountOr或就地iseint(count／index／timestamp)
    it('src內無ispint(／isp0int(／isint(／cint( 之呼叫(舊判定: Infinity變1.79e308、\'0x10\'變16、超過上限者原樣通過)', function() {
        let hits = []
        for (let f of listSrc()) {
            codeOf(f).forEach((ln, i) => {
                if (/\b(ispint|isp0int|isint|cint)\(/.test(ln) && !/import /.test(ln)) {
                    hits.push(`${path.relative(SRC, f).replace(/\\/g, '/')}:${i + 1}`)
                }
            })
        }
        assert.strict.deepEqual(hits, [])
    })

    it('src內無import ispint／isp0int／isint／cint(wsemi之數學定義判斷與cint不得再作為次數類之判定)', function() {
        let hits = []
        for (let f of listSrc()) {
            codeOf(f).forEach((ln, i) => {
                if (/import\s+(ispint|isp0int|isint|cint)\s+from/.test(ln)) {
                    hits.push(`${path.relative(SRC, f).replace(/\\/g, '/')}:${i + 1}`)
                }
            })
        }
        assert.strict.deepEqual(hits, [])
    })

    //站點全集(以 castCountOr( 呼叫計, 排除castCountOr.mjs自身): 盤點時之基準, 新增或移除站點須先檢查再於帳本R-COUNT-1登記並改此表
    it('castCountOr站點全集(createUsageCounter 2站: keepDays與bump之n): 各檔站點數與帳本R-COUNT-1之盤點表一致(新增站點須先檢查再登記)', function() {
        let counts = {}
        for (let f of listSrc()) {
            let n = (codeOf(f).join('\n').match(/castCountOr\(/g) || []).length
            if (n > 0 && !f.endsWith('castCountOr.mjs')) {
                counts[path.relative(SRC, f).replace(/\\/g, '/')] = n
            }
        }
        let want = {
            'buildValidator.mjs': 1, //驗證規則min:N
            'dispatchAiFallback.mjs': 1, //coolAfterFails
            'dispatchApiAnthropic.mjs': 1, //maxRetries
            'dispatchApiOpenaiCompat.mjs': 1,
            'dispatchApiOpenaiResponses.mjs': 1,
            'dispatchApiTypesafeSystemone.mjs': 1,
            'runExecCli.mjs': 1, //maxRetries(CLI四家經此入口)
            'wkf/createUsageCounter.mjs': 2, //keepDays、bump之n
            'wkf/makeArrayCoverageValidator.mjs': 1, //maxLengths之各欄上限
            'wkf/parseIndexList.mjs': 1, //topN
            'wkf/runFanout.mjs': 1, //minCandidates
        }
        assert.strict.deepEqual(counts, want)
    })

    //maxRetries之讀取: 凡讀取opt.maxRetries之值者(get(…, 'maxRetries', …))一律為castCountOr(…), 不得另有判定
    it('maxRetries之讀取站點固定為castCountOr(get(opt, \'maxRetries\', null), 0)(REST四家與runExecCli; CLI四家經runExecCli)', function() {
        let reads = []
        for (let f of listSrc()) {
            codeOf(f).forEach((ln, i) => {
                if (/get\([^)]*'maxRetries'/.test(ln)) {
                    reads.push([`${path.relative(SRC, f).replace(/\\/g, '/')}`, ln.trim()])
                }
            })
        }
        let one = 'let maxRetries = castCountOr(get(opt, \'maxRetries\', null), 0)'
        let want = [
            ['dispatchApiAnthropic.mjs', one],
            ['dispatchApiOpenaiCompat.mjs', one],
            ['dispatchApiOpenaiResponses.mjs', one],
            ['dispatchApiTypesafeSystemone.mjs', one],
            ['runExecCli.mjs', one],
        ]
        assert.strict.deepEqual(reads, want)
    })

    //runExecCli轉交execCli之maxRetries為採用值(K4): base.maxRetries
    it('runExecCli以採用值(而非呼叫端原值)轉交execCli之maxRetries(K4: 檢測之值即使用之值)', function() {
        let code = codeOf(path.join(SRC, 'runExecCli.mjs')).join('\n')
        assert.strict.deepEqual(/base\.maxRetries\s*=\s*maxRetries\b/.test(code), true)
    })

    //游標與時間戳: 以就地iseint(index／timestamp)判定並用轉換值
    it('遞補層之游標與金鑰冷卻時間戳為就地iseint(index／timestamp)判定', function() {
        let code = codeOf(path.join(SRC, 'dispatchAiFallback.mjs')).join('\n')
        assert.strict.deepEqual([
            /iseint\(c, \{ use: 'index' \}\)/.test(code),
            /iseint\(ts, \{ use: 'timestamp', min: 1 \}\)/.test(code),
            /castTimerMs\(r\.appliedTimeoutMs, null\)/.test(code),
        ], [true, true, true])
    })

})
