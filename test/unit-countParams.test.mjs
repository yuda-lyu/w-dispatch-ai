/* eslint-disable no-new-wrappers */
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import runExecCli from '../src/runExecCli.mjs'
import buildValidator from '../src/buildValidator.mjs'
import createUsageCounter from '../src/wkf/createUsageCounter.mjs'
import makeArrayCoverageValidator from '../src/wkf/makeArrayCoverageValidator.mjs'
import parseIndexList from '../src/wkf/parseIndexList.mjs'
import runFanout from '../src/wkf/runFanout.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-countParams.test.mjs — 次數類參數(maxRetries、keepDays、maxLengths、minCandidates、parseIndexList之topN／min／max、
//   遞補層之cursor／keyCooling時間戳、驗證規則min:N)一律以wsemi iseint之count用途判定並用轉換值(排程第446項; 帳本G17、dspec〈輸入參數之檢測機制〉§11 K3／K4; 帳本R-COUNT-1)
//
// 規格句(每案註解標明):
//   S1 次數類參數有效值＝0(或1,依參數)至4294967295之整數或其十進位數字字串(iseint count), 用轉換後之值(K4)。
//   S2 其餘一律視為未給、改用該參數之既有預設(K3): Infinity、'Infinity'、'0x1'(非十進位)、4294967296(超過count上限)、小數、負數、包裝物件、布林、null。
//   S3 所有入口一致: REST四家、CLI四家(經runExecCli)、runExecCli、遞補層、工作流各站點。
//   S4 合法輸入之行為不變。


//無效之次數(S2): 修前isp0int／ispint／isint＋cint會把Infinity轉成1.8e308、'0x1'轉成1、4294967296原樣採用
let INVALID_COUNTS = [Infinity, 'Infinity', '0x1', 4294967296]

//修前即無效、之後仍無效之次數
let INVALID_COUNTS_STABLE = [1.5, -1, new Number(1), true, null, undefined]

//合法之1次重試(S4)
let VALID_ONE = [1, '1', ' 1 ', '1e0']


describe('次數類參數以iseint count判定(排程第446項)', function() {

    //---------- REST四家 ----------
    describe('REST四家之maxRetries', function() {

        let svrApi = null
        let svrAnthropic = null
        let seq = 0

        before(async function() {
            svrApi = await fakeServerForApiTest()
            svrAnthropic = await fakeServerForAnthropicTest()
        })

        after(async function() {
            if (svrApi) {
                await svrApi.close()
            }
            if (svrAnthropic) {
                await svrAnthropic.close()
            }
        })

        let Q = {
            category: { type: 'choice', instructions: '哪一類?', criteria: { '報修': '設備故障', '其他': null } },
            urgent: { type: 'noul', instructions: '是否急迫?' },
        }

        //flaky-429: 同一金鑰首次回429、其後成功, 故attempts為2代表「有重試」、1代表「未重試」
        let callers = {
            'anthropic': (maxRetries) => dispatchApiAnthropic('abc', { baseURL: svrAnthropic.url, key: `sk-ant-api03-count-${process.pid}-${seq++}`, model: 'flaky-429', retryDelayMs: 10, maxRetries }),
            'openai-compat': (maxRetries) => dispatchApiOpenaiCompat('abc', { baseURL: svrApi.url, key: `sk-good-count-${process.pid}-${seq++}`, model: 'flaky-429', retryDelayMs: 10, maxRetries }),
            'openai-responses': (maxRetries) => dispatchApiOpenaiResponses('abc', { baseURL: svrApi.url, key: `sk-good-count-${process.pid}-${seq++}`, model: 'flaky-429', retryDelayMs: 10, maxRetries }),
            'typesafe-systemone': (maxRetries) => dispatchApiTypesafeSystemone('abc', { baseURL: svrApi.url, key: `sk-good-count-${process.pid}-${seq++}`, model: 'flaky-429', questions: Q, retryDelayMs: 10, maxRetries }),
        }

        for (let [name, call] of Object.entries(callers)) {

            it(`${name}: 無效之maxRetries(S2: Infinity、'Infinity'、'0x1'、超過上限)視為未給＝不重試(attempts 1、429失敗); 修前Infinity轉1.8e308、'0x1'轉1而重試`, async function() {
                let r = []
                for (let v of INVALID_COUNTS) {
                    let t = await call(v)
                    r.push([t.ok, t.code, t.attempts])
                }
                let rr = INVALID_COUNTS.map(() => [false, 429, 1])
                assert.strict.deepEqual(r, rr)
            })

            it(`${name}: 修前即無效者(小數、負數、包裝物件、布林、null、未給)仍不重試; 合法之1(含數字字串、前後空白、'1e0')重試一次後成功(S4)`, async function() {
                let r = []
                for (let v of INVALID_COUNTS_STABLE) {
                    let t = await call(v)
                    r.push([t.ok, t.attempts])
                }
                let rr = INVALID_COUNTS_STABLE.map(() => [false, 1])
                let r2 = []
                for (let v of VALID_ONE) {
                    let t = await call(v)
                    r2.push([t.ok, t.attempts])
                }
                let rr2 = VALID_ONE.map(() => [true, 2])
                assert.strict.deepEqual([r, r2], [rr, rr2])
            })

        }

    })

    //---------- runExecCli與CLI四家 ----------
    describe('runExecCli與CLI四家之maxRetries', function() {

        let fake = null

        before(function() {
            fake = createFakeCli('fake-count-params')
        })

        after(function() {
            if (fake) {
                fake.clean()
            }
        })

        //firstFail: 驗證函數首次回false、其後回true: attempts 2代表「有驗證重試」, 1代表「未重試」(OUTPUT_VALIDATION_FAILED)
        let mkValidate = () => {
            let n = 0
            return () => {
                n++
                return n > 1
            }
        }

        it('runExecCli(驗證路徑): 無效之maxRetries視為未給＝不重試(attempts 1、OUTPUT_VALIDATION_FAILED); 修前Infinity與\'0x1\'使驗證重試', async function() {
            let r = []
            for (let v of INVALID_COUNTS) {
                let t = await runExecCli(fake.exe, [], { input: 'abc', validate: mkValidate(), maxRetries: v, retryDelayMs: 1 })
                r.push([t.ok, t.error, t.attempts])
            }
            let rr = INVALID_COUNTS.map(() => [false, 'OUTPUT_VALIDATION_FAILED', 1])
            assert.strict.deepEqual(r, rr)
        })

        it('runExecCli(驗證路徑): 修前即無效者不重試; 合法之1重試一次後成功(S4)', async function() {
            let r = []
            for (let v of INVALID_COUNTS_STABLE) {
                let t = await runExecCli(fake.exe, [], { input: 'abc', validate: mkValidate(), maxRetries: v, retryDelayMs: 1 })
                r.push([t.ok, t.attempts])
            }
            let r2 = []
            for (let v of VALID_ONE) {
                let t = await runExecCli(fake.exe, [], { input: 'abc', validate: mkValidate(), maxRetries: v, retryDelayMs: 1 })
                r2.push([t.ok, t.attempts])
            }
            let rr = INVALID_COUNTS_STABLE.map(() => [false, 1])
            let rr2 = VALID_ONE.map(() => [true, 2])
            assert.strict.deepEqual([r, r2], [rr, rr2])
        })

        it('runExecCli(期限接管路徑: 有attemptHints): 無效之maxRetries不重試(attempts 1); 修前Infinity使重試至期限用盡、\'0x1\'重試1次', async function() {
            let r = []
            for (let v of INVALID_COUNTS) {
                let t = await runExecCli(fake.exe, ['--fake-exit=1'], {
                    input: 'abc',
                    maxRetries: v,
                    retryDelayMs: 1,
                    attemptHints: { deadlineAt: Date.now() + 2500, minAttemptMs: 100 },
                })
                r.push([t.ok, t.attempts])
            }
            let rr = INVALID_COUNTS.map(() => [false, 1])
            assert.strict.deepEqual(r, rr)
        })

        it('runExecCli(期限接管路徑): 合法之1重試一次(attempts 2、仍失敗)(S4)', async function() {
            let t = await runExecCli(fake.exe, ['--fake-exit=1'], {
                input: 'abc',
                maxRetries: '1',
                retryDelayMs: 1,
                attemptHints: { deadlineAt: Date.now() + 60000, minAttemptMs: 100 },
            })
            assert.strict.deepEqual([t.ok, t.attempts], [false, 2])
        })

        //四家轉接器經runExecCli: 各家各驗「無效值不重試、合法值重試一次」
        let adapters = {
            'dispatchClaude': (opt) => dispatchClaude('abc', { exe: fake.exe, ...opt }),
            'dispatchCodex': (opt) => dispatchCodex('abc', { exe: fake.exe, ...opt }),
            'dispatchOpencode': (opt) => dispatchOpencode('abc', { exe: fake.exe, ...opt }),
            'dispatchAntigravity': (opt) => dispatchAntigravity('abc', { exe: fake.exe, ...opt }),
        }
        for (let [name, call] of Object.entries(adapters)) {
            it(`${name}: 無效之maxRetries(Infinity、'0x1')視為未給＝驗證不重試(attempts 1); 合法之1重試一次(attempts 2)`, async function() {
                let r = []
                for (let v of [Infinity, '0x1']) {
                    let t = await call({ validate: mkValidate(), maxRetries: v, retryDelayMs: 1 })
                    r.push([t.ok, t.attempts])
                }
                let t1 = await call({ validate: mkValidate(), maxRetries: 1, retryDelayMs: 1 })
                r.push([t1.ok, t1.attempts])
                assert.strict.deepEqual(r, [[false, 1], [false, 1], [true, 2]])
            })
        }

    })

    //---------- 遞補層(cursor、keyCooling時間戳、coolAfterFails) ----------
    describe('遞補層之內部狀態值', function() {

        let fake = null
        let svr = null

        before(async function() {
            fake = createFakeCli('fake-count-fallback')
            svr = await fakeServerForAnthropicTest()
        })

        after(async function() {
            if (fake) {
                fake.clean()
            }
            if (svr) {
                await svr.close()
            }
        })

        let mkStore = (init = {}) => {
            let state = { cursors: {}, cooling: {}, ...init }
            let set = (s) => {
                state = s
            }
            return { get: () => state, set, peek: () => state }
        }

        it('cursor(游標)為Infinity／\'Infinity\'／\'0x1\'／超過上限時視為未給(從第一把起試); 修前Infinity轉1.8e308後取模得非0(nk 3時為2)', async function() {
            let r = []
            for (let c of [Infinity, 'Infinity', '0x1', 4294967296 * 1e6]) {
                let tried = []
                let store = mkStore({ cursors: { 'cur-p': c } })
                await dispatchAiFallback('abc', {
                    providers: [{ id: 'cur-p', kind: 'claude', exe: fake.exe, keys: ['k0', 'k1', 'k2'] }],
                    store,
                    onEvent: (ev) => {
                        if (ev.type === 'try') {
                            tried.push(ev.keyIndex)
                        }
                    },
                })
                r.push(tried[0])
            }
            assert.strict.deepEqual(r, [0, 0, 0, 0])
        })

        it('cursor為合法之整數(數字或數字字串)時以其取模起試(S4)', async function() {
            let r = []
            for (let c of [1, '1', 4]) { //nk 3: 4取模為1
                let tried = []
                let store = mkStore({ cursors: { 'cur-q': c } })
                await dispatchAiFallback('abc', {
                    providers: [{ id: 'cur-q', kind: 'claude', exe: fake.exe, keys: ['k0', 'k1', 'k2'] }],
                    store,
                    onEvent: (ev) => {
                        if (ev.type === 'try') {
                            tried.push(ev.keyIndex)
                        }
                    },
                })
                r.push(tried[0])
            }
            assert.strict.deepEqual(r, [1, 1, 1])
        })

        it('keyCooling之時間戳為Infinity／\'Infinity\'時視為無效紀錄(該把金鑰不降序、照原序先試); 修前ispint(Infinity)為真而使其永遠冷卻', async function() {
            let keys = ['sk-ant-good-aaaaaa', 'sk-ant-good-bbbbbb']
            let fpOf = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 16)
            let toSrv = (url, init) => fetch(`${svr.url}/v1/messages`, init)
            let r = []
            for (let ts of [Infinity, 'Infinity']) {
                let store = mkStore({ keyCooling: { [fpOf(keys[0])]: ts } })
                let t = await dispatchAiFallback('abc', {
                    providers: [{ id: 'anthropic:cnt', kind: 'api-anthropic', model: 'by-key', keys, fetch: toSrv }],
                    store,
                    cooldownMs: 600000,
                })
                r.push([t.ok, t.keyIndex])
            }
            assert.strict.deepEqual(r, [[true, 0], [true, 0]])
        })

    })

    //---------- 工作流 ----------
    describe('工作流之次數類設定', function() {

        let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'countParams')
        let fake = null

        before(function() {
            fs.mkdirSync(FD, { recursive: true })
            fake = createFakeCli('fake-count-wkf')
        })

        after(function() {
            fs.rmSync(FD, { recursive: true, force: true })
            try {
                fs.rmdirSync(path.dirname(FD))
            }
            catch {}
            if (fake) {
                fake.clean()
            }
        })

        it('createUsageCounter之keepDays: 無效(\'0x1\'、Infinity、4294967296)視為未給＝預設14天(3天全留); 合法之2只留2天(S4)', function() {
            let r = []
            let n = 0
            for (let keepDays of ['0x1', Infinity, 4294967296, 2]) {
                let day = '2026-08-01'
                let usage = createUsageCounter({ dir: FD, name: `kd${n++}.json`, getDate: () => day, keepDays })
                usage.bump('k')
                day = '2026-08-02'
                usage.bump('k')
                day = '2026-08-03'
                usage.bump('k')
                r.push(Object.keys(JSON.parse(fs.readFileSync(usage.file, 'utf8'))).length)
            }
            assert.strict.deepEqual(r, [3, 3, 3, 2])
        })

        it('createUsageCounter之bump(key, n): n為count範圍之整數(含數字字串、0)照加; 無效(Infinity、NaN、小數、負數、\'0x2\'、null)視為未給用1(修前不判型: 數字字串串接成\'02\'、Infinity寫檔變null)', function() {
            let usage = createUsageCounter({ dir: FD, name: 'bump.json', getDate: () => '2026-08-18' })
            let seen = []
            for (let n of ['2', Infinity, 1.5, -3, NaN, '0x2', null, 0, 3]) {
                usage.bump('k', n)
                seen.push(usage.today().byKey.k)
            }
            assert.strict.deepEqual(seen, [2, 3, 4, 5, 6, 7, 8, 8, 11])
            assert.strict.deepEqual(typeof JSON.parse(fs.readFileSync(usage.file, 'utf8'))['2026-08-18'].k, 'number')
        })

        it('makeArrayCoverageValidator之maxLengths: 無效之上限(\'0x2\'、Infinity、4294967296、1.5、0)略過(不限); 合法之2字串數字亦採用(S4)', function() {
            let r = []
            for (let lim of ['0x2', Infinity, 4294967296, 1.5, 0]) {
                let v = makeArrayCoverageValidator({ indices: [1], contentFields: ['t'], maxLengths: { t: lim } })
                r.push(v('[{"index":1,"t":"abcd"}]'))
            }
            let v2 = makeArrayCoverageValidator({ indices: [1], contentFields: ['t'], maxLengths: { t: '2' } })
            r.push(v2('[{"index":1,"t":"abcd"}]'))
            assert.strict.deepEqual(r, [true, true, true, true, true, false])
        })

        it('parseIndexList之topN、min、max: 無效值(\'0x2\'、Infinity、4294967296…)視為未給(預設); 合法值照用(S4)', function() {
            let t = '1,2,3,4,5'
            let r = [
                parseIndexList(t, { topN: '0x2' }).indices,
                parseIndexList(t, { topN: Infinity }).indices,
                parseIndexList(t, { min: '0x3' }).indices,
                parseIndexList(t, { max: '0x3' }).indices,
                parseIndexList(t, { topN: '2' }).indices,
                parseIndexList(t, { min: 3 }).indices,
                parseIndexList(t, { max: '3' }).indices,
                parseIndexList('0,1,2', { min: 0 }).indices,
            ]
            let all = [1, 2, 3, 4, 5]
            assert.strict.deepEqual(r, [all, all, all, all, [1, 2], [3, 4, 5], [1, 2, 3], [0, 1, 2]])
        })

        it('runFanout之minCandidates: 無效(Infinity、\'0x3\'、4294967296)視為未給＝預設2(2份候選即整合); 合法之3使2份候選不整合(S4)', async function() {
            let providers = {
                'p-a': { kind: 'claude', exe: fake.exe, model: 'sonnet' },
                'p-b': { kind: 'codex', exe: fake.exe, model: 'gpt-5.6-luna' },
                'p-int': { kind: 'opencode', exe: fake.exe, model: 'opencode/free' },
            }
            let r = []
            for (let minCandidates of [Infinity, '0x3', 4294967296, 3]) {
                let t = await runFanout({
                    providers,
                    task: 'abc',
                    agents: [{ use: 'p-a' }, { use: 'p-b' }],
                    integrate: { use: 'p-int' },
                    minCandidates,
                    callOpt: { promptPrefix: '' },
                })
                r.push([t.ok, t.integrated])
            }
            assert.strict.deepEqual(r, [[true, true], [true, true], [true, true], [true, false]])
        })

        it('buildValidator之min:N規則: N須為count範圍之整數(含\'1e1\'), 否則規則無效而驗證失敗(不靜默放行、不當成極大值); 合法者行為不變(S4)', function() {
            let r = [
                buildValidator('min:3')('abcd'),
                buildValidator('min:5')('abcd'),
                buildValidator('min:0')('a'),
                buildValidator('min:1e1')('abcdefghijk'),
                buildValidator('min:0x2')('abcd'),
                buildValidator('min:-3')('abcd'),
                buildValidator('min:1.5')('abcd'),
                buildValidator('min:Infinity')('abcd'),
                buildValidator('min:abc')('abcd'),
            ]
            assert.strict.deepEqual(r, [true, false, true, true, false, false, false, false, false])
        })

    })

})
