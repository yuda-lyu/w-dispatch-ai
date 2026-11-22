import assert from 'assert'
/* eslint-disable no-new-wrappers */
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { SENT, revoked, hostile, pathWithoutRealCli } from './tools/hostileValuesForTest.mjs'


// unit-opencodeAuthOpts.test.mjs — dispatchOpencode影響計費路徑或放寬權限之opt「給了而無效即拒絕」(排程第553項之裁示②; 帳本R-SAFEOPT-1規則9; dspec〈輸入參數之檢測機制〉§11、K9)
//
// 規格句(每案註解標明):
//   P1 provider給了而無效(非undefined、null、''之值, 且非原始非空字串)且key有效 → params拒絕(attempts 0、不起子行程): 否則key不注入、改用auth.json既有登入(計費路徑被悄悄改變)。
//   P2 provider為未給(undefined、null)或''(文件載明之預設／常見值), 或provider無效而未給key(不影響計費路徑) → 維持現狀(不拒絕、不注入OPENCODE_AUTH_CONTENT)。
//   P3 useStoredAuth給了而非原始布林(含'false'、0、1、''、物件、包裝物件) → params拒絕(修前視為true, 沿用auth.json之登入); true、false、未給(undefined、null)照舊。
//   P4 訊息不回顯輸入值(K9): 只含參數名、期望之種類與typeof; 不含金鑰與provider值。
//   P5 遞補層(dispatchAiFallback)於發try事件之前即判(checkSafeOpts, 與轉接器共用同一判定): 此類條目走條目層params、不發try事件。
//   config／agent／provider:''維持現狀(P2, 本檔以保持案釘住)。
//
// 安全: 不呼叫外部AI服務——假執行檔; before把PATH換成移除真CLI者、after還原。


let KEY = 'sk-oc-SECRET-key-5d2e'
let NUM = 123456789


//全部「給了而無效」之provider值(非undefined、null、''; 非原始非空字串)
let badProviders = () => [NUM, 0, 1, true, false, {}, [], [SENT], new String('opencode'), hostile(), revoked(), () => 1]

//全部非原始布林之useStoredAuth值
let badAuths = () => ['false', 'true', 0, 1, '', {}, [], new Boolean(false), hostile(), revoked(), () => 1]


let isParams = (t) => t.ok === false && t.errorType === 'params' && t.attempts === 0
let noEcho = (t) => {
    let s = String(t.error)
    return !s.includes(SENT) && !s.includes(KEY) && !s.includes(String(NUM))
}


describe('dispatchOpencode: provider無效而key有效、useStoredAuth非布林 → params拒絕(排程第553項裁示②)', function() {

    let fake = null
    let savedPath = null

    before(function() {
        savedPath = process.env.PATH === undefined ? null : process.env.PATH
        process.env.PATH = pathWithoutRealCli()
        fake = createFakeCli('fake-oc-auth-opts')
    })

    after(function() {
        if (savedPath !== null) {
            process.env.PATH = savedPath
        }
        if (fake) {
            fake.clean()
        }
    })

    it('P1 provider給了而無效且key有效: params拒絕、不起子行程、訊息不回顯provider與key', async function() {
        let r = []
        for (let v of badProviders()) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, provider: v, key: KEY })
            r.push([isParams(t), noEcho(t), /provider/.test(String(t.error)), t.stdout === undefined || t.stdout === ''])
        }
        assert.strict.deepEqual(r, badProviders().map(() => [true, true, true, true]))
    })

    it('P2 provider為未給／\'\'、或provider無效而未給key: 維持現狀(不拒絕、不注入OPENCODE_AUTH_CONTENT); provider與key皆有效照舊注入', async function() {
        let rows = []
        for (let [label, opt] of [
            ['provider undefined + key', { provider: undefined, key: KEY }],
            ['provider null + key', { provider: null, key: KEY }],
            ['provider \'\' + key', { provider: '', key: KEY }],
            ['provider 無效 + 無key', { provider: {} }],
            ['provider 數字 + key \'\'', { provider: NUM, key: '' }],
            ['provider 無效 + key null', { provider: true, key: null }],
        ]) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, ...opt })
            rows.push([label, t.ok, JSON.parse(t.stdout).env.OPENCODE_AUTH_CONTENT])
        }
        assert.strict.deepEqual(rows, [
            ['provider undefined + key', true, ''],
            ['provider null + key', true, ''],
            ['provider \'\' + key', true, ''],
            ['provider 無效 + 無key', true, ''],
            ['provider 數字 + key \'\'', true, ''],
            ['provider 無效 + key null', true, ''],
        ])
        let t = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key: KEY })
        assert.strict.deepEqual([t.ok, JSON.parse(JSON.parse(t.stdout).env.OPENCODE_AUTH_CONTENT)], [true, { opencode: { type: 'api', key: KEY } }])
    })

    it('P2 config／agent維持現狀: agent給了無效回退build、config為空字串或非物件非字串之定義值沿用既有設定(不拒絕)', async function() {
        let rows = []
        for (let opt of [{ agent: 123 }, { agent: '' }, { config: '' }, { config: 123 }, { config: true }]) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, ...opt })
            let o = JSON.parse(t.stdout)
            rows.push([t.ok, o.args[2], o.env.OPENCODE_CONFIG_CONTENT])
        }
        assert.strict.deepEqual(rows, [
            [true, 'build', ''],
            [true, 'build', ''],
            [true, 'build', ''],
            [true, 'build', ''],
            [true, 'build', ''],
        ])
    })

    it('P3 useStoredAuth給了而非原始布林: params拒絕、不起子行程(不視為true沿用auth.json); 與key／provider併用亦拒絕; 訊息不回顯', async function() {
        let r = []
        for (let v of badAuths()) {
            let t1 = await dispatchOpencode('abc', { exe: fake.exe, useStoredAuth: v })
            let t2 = await dispatchOpencode('abc', { exe: fake.exe, provider: 'opencode', key: KEY, useStoredAuth: v })
            r.push([isParams(t1), noEcho(t1), /useStoredAuth/.test(String(t1.error)), isParams(t2), noEcho(t2)])
        }
        assert.strict.deepEqual(r, badAuths().map(() => [true, true, true, true, true]))
    })

    it('P3 useStoredAuth為true、false、未給(undefined、null)照舊', async function() {
        let rows = []
        for (let v of [true, false, undefined, null]) {
            let t = await dispatchOpencode('abc', { exe: fake.exe, useStoredAuth: v })
            rows.push([t.ok, JSON.parse(t.stdout).env.OPENCODE_AUTH_CONTENT])
        }
        assert.strict.deepEqual(rows, [[true, ''], [true, '{}'], [true, ''], [true, '']])
    })

    it('P5 checkSafeOpts(opencode): provider無效且(opt.key有效或ctx.keyed為真)才回訊息; useStoredAuth非布林回訊息; 有效、未給、表外kind回空字串', async function() {
        let { checkSafeOpts } = await import('../src/readSafeOpt.mjs') //動態匯入: 本案以行為斷言逐項紅燈
        let rows = [
            checkSafeOpts('opencode', { provider: {}, key: KEY }),
            checkSafeOpts('opencode', { provider: {} }, { keyed: true }),
            checkSafeOpts('opencode', { provider: {} }),
            checkSafeOpts('opencode', { provider: '', key: KEY }),
            checkSafeOpts('opencode', { provider: undefined, key: KEY }),
            checkSafeOpts('opencode', { provider: 'opencode', key: KEY }),
            checkSafeOpts('opencode', { useStoredAuth: 'false' }),
            checkSafeOpts('opencode', { useStoredAuth: false }),
            checkSafeOpts('opencode', { useStoredAuth: true }),
            checkSafeOpts('claude', { provider: {}, key: KEY, useStoredAuth: 'x' }),
        ]
        assert.strict.deepEqual(rows.map((s) => s !== ''), [true, true, false, false, false, false, true, false, false, false])
        assert.strict.deepEqual(rows.every((s) => !s.includes(KEY) && !s.includes(SENT)), true)
    })

    it('P5 遞補層: 條目provider無效而有keys(或opt.key)、useStoredAuth非布林者走條目層params、不發try事件; provider無效而無金鑰者維持現狀(照發try)', async function() {
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [
                { id: 'bad:prov-keys', kind: 'opencode', exe: fake.exe, provider: {}, keys: [KEY] },
                { id: 'bad:prov-key', kind: 'opencode', exe: fake.exe, provider: NUM, key: KEY },
                { id: 'bad:auth', kind: 'opencode', exe: fake.exe, useStoredAuth: 'false' },
                { id: 'keep:prov-nokey', kind: 'opencode', exe: fake.exe, provider: {} },
                { id: 'ok:one', kind: 'opencode', exe: fake.exe, provider: 'opencode', keys: [KEY] },
            ],
            onEvent: (ev) => events.push(ev),
        })
        let tries = events.filter((e) => e.type === 'try').map((e) => e.providerId)
        assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.errorType]).slice(0, 3), [['bad:prov-keys', 'params'], ['bad:prov-key', 'params'], ['bad:auth', 'params']])
        assert.strict.deepEqual(tries, ['keep:prov-nokey'])
        assert.strict.deepEqual([r.ok, r.providerId], [true, 'keep:prov-nokey'])
    })

})
