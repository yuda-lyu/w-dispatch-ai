import assert from 'assert'
import fs from 'fs'
import path from 'path'
import http from 'http'
import { fileURLToPath } from 'url'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { readKey, readKeys } from '../src/readKeyOpt.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { revoked } from './tools/userFnFormsForTest.mjs'


// unit-keyOptReject.test.mjs — 金鑰型opt(key、keys)「給了而無效即拒絕」之規格測試(帳本R-KEYOPT-1)
//
// 規格: 金鑰屬影響計費之opt, 比照dspec〈輸入參數之檢測機制〉§11「影響下單數量或金額之opt視同安全相關opt」——給了而無效即拒絕, 不靜默改走另一種計費:
//   ①keys(陣列)含「非空且非原始字串」之元素(數字、物件、包裝物件、已撤銷之Proxy等)且濾後無有效字串者 → 該條目回params失敗, 不起子進程、不送請求; key(dispatchClaude等單一金鑰)給了非字串之值同此;
//   ②視為未給(維持現行之登入態／預設認證): keys為undefined、null、[]; key為undefined、null、''; 陣列內之''、null、undefined元素略過;
//   ③keys含有效字串者, 無效元素照舊略過(混合不拒絕)。
// 觀察面: 子進程是否被起(假CLI寫標記檔)、HTTP請求數(計數伺服器)、結果之ok／errorType／attempts、訊息不回顯金鑰值。


let SECRET = 'sk-ant-api03-SECRETVALUE-0123456789abcdef'

//敵意與無效之「單一金鑰值」(每次回新物件): label → 產生函數
let BAD_KEY = {
    'number': () => 123,
    'zero': () => 0,
    'NaN': () => NaN,
    'true': () => true,
    'false': () => false,
    'object': () => ({ key: SECRET }),
    'empty-object': () => ({}),
    'array': () => [SECRET],
    'empty-array': () => [],
    'String-wrapper': () => Object(SECRET),
    'empty-String-wrapper': () => Object(''),
    'revoked-Proxy': () => revoked(),
    'function': () => () => SECRET,
    'symbol': () => Symbol('k'),
    'bigint': () => 10n,
}

let ABSENT_KEY = [undefined, null, '']


//usageGate, 訂閱類用量門檻設定(只注入claude之讀者, 每次被查詢即呼叫onRead): 觀察「用量查詢是否被起」
function usageGate(onRead) {
    return {
        readers: {
            claude: async () => {
                onRead()
                return { ok: true, windows: [] }
            },
        },
    }
}


//markerEntry, 假CLI(npm shim形狀): 啟動即把一行寫入標記檔(證明子進程被起)，再回'OK'
function markerEntry(markFile) {
    return `
import fs from 'fs'
fs.appendFileSync(${JSON.stringify(markFile)}, 'spawned\\n')
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stdout.write('OK')
    process.exit(0)
})
`
}


//countServer, 計數用本機伺服器: 每個請求記下(路徑、x-api-key、authorization)後依端點回該協定之成功本體(內容不重要, 只需成功以便驗遞補與keyIndex)
async function countServer() {
    let requests = []
    let srv = http.createServer((req, res) => {
        req.resume()
        req.on('end', () => {
            requests.push({ url: req.url, apiKey: req.headers['x-api-key'], auth: req.headers['authorization'] })
            let body = {}
            if (req.url.endsWith('/messages')) {
                body = { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
            }
            else if (req.url.endsWith('/chat/completions')) {
                body = { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }
            }
            else if (req.url.endsWith('/responses')) {
                body = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }
            }
            else if (req.url.endsWith('/systemone')) {
                body = { answers: [{ type: 'noul', noul: 0.5 }] }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(body))
        })
    })
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    return {
        url: `http://127.0.0.1:${srv.address().port}`,
        requests,
        close: () => new Promise((resolve) => {
            srv.closeAllConnections()
            srv.close(resolve)
        }),
    }
}


describe('readKey／readKeys(金鑰型opt之判定單一來源; 帳本R-KEYOPT-1)', function() {

    it('readKey: 未給(undefined、null、\'\')回空金鑰無錯; 非空原始字串回原字串; 其餘(給了而無效)回錯誤訊息且訊息不回顯值', function() {
        //規格: R2——key為undefined、null、''視為未給; 給了非字串之值即拒絕; 訊息只寫型別不寫值
        let rows = []
        for (let v of ABSENT_KEY) {
            let r = readKey(v)
            rows.push(['absent', r.key, r.err])
        }
        for (let v of ['sk-x', ' ', 'k']) {
            let r = readKey(v)
            rows.push(['valid', r.key, r.err])
        }
        for (let label of Object.keys(BAD_KEY)) {
            let r = readKey(BAD_KEY[label](), 'key')
            rows.push([label, r.key, /^key must be a non-empty string when given \(got [a-z]+\); an invalid key is rejected/.test(r.err), r.err.includes('SECRET')])
        }
        let rr = [
            ['absent', '', ''], ['absent', '', ''], ['absent', '', ''],
            ['valid', 'sk-x', ''], ['valid', ' ', ''], ['valid', 'k', ''],
            ...Object.keys(BAD_KEY).map((label) => [label, '', true, false]),
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('readKeys: 未給(undefined、null、[]、陣列內全為\'\'／null／undefined)回空陣列無錯; 有效字串保留順序、無效元素略過(混合不拒絕)', function() {
        //規格: R2②③——keys為undefined、null、[]視為未給; 陣列內之''、null、undefined元素略過; 含有效字串者無效元素照舊略過
        let wrap = Object('sk-wrap')
        let rows = [
            [undefined, null, [], [''], [null], [undefined], ['', null, undefined], [, ,]], // eslint-disable-line no-sparse-arrays
            [['a'], ['a', 'b']],
            [['', 'a', null, 'b', undefined]],
            [[wrap, 'good'], [123, 'good'], [{}, 'good'], [revoked(), 'good'], [[], 'good'], [true, 'good']],
        ].map((group) => group.map((v) => {
            let r = readKeys(v)
            return [r.keys, r.err]
        }))
        let rr = [
            [[[], ''], [[], ''], [[], ''], [[], ''], [[], ''], [[], ''], [[], ''], [[], '']],
            [[['a'], ''], [['a', 'b'], '']],
            [[['a', 'b'], '']],
            [[['good'], ''], [['good'], ''], [['good'], ''], [['good'], ''], [['good'], ''], [['good'], '']],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('readKeys: 元素數恰10000之陣列仍有效(全數保留); 上限之外與非整數length見下案', function() {
        //規格: 帳本R-KEYOPT-1——元素數上限10000(超過視為給了而無效, 避免巨大／稀疏陣列卡住事件迴圈)
        let r = readKeys(new Array(10000).fill('sk-a'))
        assert.strict.deepEqual([r.keys.length, r.err], [10000, ''])
    })

    it('readKeys: 給了而無效且無任何有效字串(含數字、物件、包裝物件、已撤銷之Proxy元素)回「has no valid key」、非陣列回「must be an array」、不可讀(含length非整數、偽造標籤)回「is not readable」、過大回「too many elements」; 訊息不回顯值', function() {
        //規格: R2①——keys含非空且非原始字串之元素且濾後無有效字串者即拒絕; 非陣列之定義值(字串、數字、物件)與不可讀之陣列同為給了而無效
        let revokedArr = Proxy.revocable([], {})
        revokedArr.revoke()
        let ownKeysBoom = new Proxy([], {
            ownKeys: () => {
                throw new Error('ownKeys-boom')
            },
        })
        let tagBoom = Object.defineProperty([], Symbol.toStringTag, {
            get: () => {
                throw new Error('tag-boom')
            },
        })
        let lengthBoom = new Proxy([], {
            get: (t, k) => {
                if (k === 'length') {
                    throw new Error('length-boom')
                }
                return t[k]
            },
        })
        let cases = [
            ['number-element', [123], /^keys has no valid key: 1 element\(s\) are not non-empty strings/],
            ['object-element', [{ k: SECRET }], /^keys has no valid key: 1 element/],
            ['String-wrapper', [Object(SECRET)], /^keys has no valid key: 1 element/],
            ['revoked-element', [revoked()], /^keys has no valid key: 1 element/],
            ['nested-array', [[SECRET]], /^keys has no valid key: 1 element/],
            ['bool-with-absent', ['', true, null], /^keys has no valid key: 1 element/],
            ['many-bad', [1, 2, Object('x')], /^keys has no valid key: 3 element/],
            ['string-not-array', SECRET, /^keys must be an array of non-empty strings \(got string\)/],
            ['empty-string-not-array', '', /^keys must be an array of non-empty strings \(got string\)/],
            ['number-not-array', 7, /^keys must be an array of non-empty strings \(got number\)/],
            ['object-not-array', { 0: SECRET }, /^keys must be an array of non-empty strings \(got object\)/],
            ['String-wrapper-not-array', Object(SECRET), /^keys must be an array of non-empty strings \(got object\)/],
            ['spoofed-toStringTag-Array', { [Symbol.toStringTag]: 'Array', length: 1, 0: SECRET }, /^keys must be an array of non-empty strings \(got object\)/],
            ['length-undefined', new Proxy(['sk-a'], { get: (t, k) => (k === 'length' ? undefined : Reflect.get(t, k)) }), /^keys is not readable: length is not a valid array length/],
            ['length-negative', new Proxy(['sk-a'], { get: (t, k) => (k === 'length' ? -1 : Reflect.get(t, k)) }), /^keys is not readable: length is not a valid array length/],
            ['length-NaN', new Proxy(['sk-a'], { get: (t, k) => (k === 'length' ? NaN : Reflect.get(t, k)) }), /^keys is not readable: length is not a valid array length/],
            ['length-Infinity', new Proxy(['sk-a'], { get: (t, k) => (k === 'length' ? Infinity : Reflect.get(t, k)) }), /^keys is not readable: length is not a valid array length/],
            ['sparse-huge', new Array(2 ** 32 - 1), /^keys has too many elements \(more than 10000\)/],
            ['too-many-10001', new Array(10001).fill('sk-a'), /^keys has too many elements \(more than 10000\)/],
            ['revoked-array', revokedArr.proxy, /^keys is not readable: /],
            ['ownKeys-trap-boom', ownKeysBoom, /^keys is not readable: ownKeys-boom/],
            ['toStringTag-boom', tagBoom, /^keys is not readable: tag-boom/],
            ['length-getter-boom', lengthBoom, /^keys is not readable: length-boom/],
        ]
        let rows = cases.map(([label, v, re]) => {
            let r = readKeys(v)
            return [label, r.keys, re.test(r.err), r.err.includes('SECRET')]
        })
        let rr = cases.map(([label]) => [label, [], true, false])
        assert.strict.deepEqual(rows, rr)
    })

})


describe('單一金鑰key給了而無效: 六個轉接器皆以params拒絕, 不起子進程、不送請求(帳本R-KEYOPT-1)', function() {

    let fake = null
    let svr = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', `kor-${process.pid}`)
    let mark = path.join(fdTmp, 'spawned.txt')
    let spawnedCount = () => (fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').split('\n').filter(Boolean).length : 0)

    before(async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        fake = createFakeCli(`fake-kor-${process.pid}`, markerEntry(mark))
        svr = await countServer()
    })

    after(async function() {
        if (fake) {
            fake.clean()
        }
        if (svr) {
            await svr.close()
        }
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    let adapters = () => ({
        'claude': (key) => dispatchClaude('abc', { exe: fake.exe, key }),
        'opencode': (key) => dispatchOpencode('abc', { exe: fake.exe, provider: 'p1', key }),
        'api-openai-compat': (key) => dispatchApiOpenaiCompat('abc', { baseURL: `${svr.url}/v1`, model: 'm', key }),
        'api-openai-responses': (key) => dispatchApiOpenaiResponses('abc', { baseURL: `${svr.url}/v1`, model: 'm', key }),
        'api-anthropic': (key) => dispatchApiAnthropic('abc', { baseURL: svr.url, model: 'm', key }),
        'api-typesafe-systemone': (key) => dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, model: 'm', questions: { q1: { type: 'noul', instructions: 'x?' } }, key }),
    })

    it('給了非字串之key(數字、布林、物件、陣列、包裝物件、已撤銷之Proxy、函數、symbol、bigint): ok為false、errorType為params、attempts為0、訊息載明key須為非空字串且不回顯值; 子進程0個、HTTP請求0個', async function() {
        //規格: R2①——key(dispatchClaude等單一金鑰)給了非字串之值即params拒絕, 不起子進程、不送請求; 不靜默改走登入態或不帶認證之請求
        let rows = []
        for (let [name, fn] of Object.entries(adapters())) {
            for (let label of Object.keys(BAD_KEY)) {
                let r = await fn(BAD_KEY[label]())
                rows.push([name, label, r.ok, r.errorType, r.attempts, /^key must be a non-empty string when given/.test(r.error), JSON.stringify(r).includes('SECRETVALUE')])
            }
        }
        let rr = []
        for (let name of Object.keys(adapters())) {
            for (let label of Object.keys(BAD_KEY)) {
                rr.push([name, label, false, 'params', 0, true, false])
            }
        }
        assert.strict.deepEqual(rows, rr)
        assert.strict.deepEqual([spawnedCount(), svr.requests.length], [0, 0])
    })

    it('對照: key為undefined、null、\'\'(視為未給)時六個轉接器照舊執行(子進程各2個、HTTP請求各4個), 不因本規則被誤擋', async function() {
        //規格: R2②——key為undefined、null、''視為未給, 維持現行之登入態／預設認證(不帶金鑰)
        let rows = []
        for (let [name, fn] of Object.entries(adapters())) {
            for (let v of ABSENT_KEY) {
                let r = await fn(v)
                rows.push([name, r.errorType === 'params'])
            }
        }
        let rr = []
        for (let name of Object.keys(adapters())) {
            rr.push([name, false], [name, false], [name, false])
        }
        assert.strict.deepEqual(rows, rr)
        let spawned = spawnedCount()
        let reqs = svr.requests.length
        //CLI兩家(claude、opencode)各3次未給 → 6個子進程(前一案為0); REST四家各3次 → 12個請求
        assert.strict.deepEqual([spawned, reqs], [6, 12])
        //未給者不帶金鑰: REST請求不帶x-api-key與authorization(對照本機計數伺服器所見)
        assert.strict.deepEqual(svr.requests.filter((q) => q.apiKey !== undefined || q.auth !== undefined).length, 0)
    })

})


describe('dispatchAiFallback條目之keys／key給了而無效: 該條目params失敗(整組跳過)、不起子進程、不送請求、不起用量查詢; 其後條目照常(帳本R-KEYOPT-1)', function() {

    let fake = null
    let svr = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', `kof-${process.pid}`)
    let mark = path.join(fdTmp, 'spawned.txt')
    let spawnedCount = () => (fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').split('\n').filter(Boolean).length : 0)

    before(async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        fake = createFakeCli(`fake-kof-${process.pid}`, markerEntry(mark))
        svr = await countServer()
    })

    after(async function() {
        if (fake) {
            fake.clean()
        }
        if (svr) {
            await svr.close()
        }
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //BAD_KEYS, 各種「給了而無效且無有效字串」之keys值
    let BAD_KEYS = {
        'number-element': () => [123],
        'object-element': () => [{ k: SECRET }],
        'String-wrapper': () => [Object(SECRET)],
        'all-String-wrappers': () => [Object(SECRET), Object(`${SECRET}2`)],
        'revoked-element': () => [revoked()],
        'bool-with-absent': () => ['', true, null],
        'string-not-array': () => SECRET,
        'empty-string-not-array': () => '',
        'number-not-array': () => 7,
        'object-not-array': () => ({ 0: SECRET }),
        'revoked-array': () => {
            let p = Proxy.revocable([], {})
            p.revoke()
            return p.proxy
        },
    }

    //kinds, 各kind之條目建構(尾隨一個可成交之條目驗證遞補)
    let entryOf = (kind, keys) => {
        if (kind === 'claude') {
            return { id: `bad-${kind}`, kind, exe: fake.exe, keys }
        }
        if (kind === 'opencode') {
            return { id: `bad-${kind}`, kind, exe: fake.exe, provider: 'p1', keys }
        }
        if (kind === 'api-anthropic') {
            return { id: `bad-${kind}`, kind, baseURL: svr.url, model: 'm', keys }
        }
        if (kind === 'api-typesafe-systemone') {
            return { id: `bad-${kind}`, kind, baseURL: svr.url, model: 'm', questions: { q1: { type: 'noul', instructions: 'x?' } }, keys }
        }
        return { id: `bad-${kind}`, kind, baseURL: `${svr.url}/v1`, model: 'm', keys }
    }
    let KINDS = ['claude', 'opencode', 'api-openai-compat', 'api-openai-responses', 'api-anthropic', 'api-typesafe-systemone']

    it('keys給了而無效(11種)× 六種kind: 首條目以params整組跳過(skip-group)、keyIndex為null、不送請求、不起子進程; 次條目(原始字串金鑰之claude)照常成交', async function() {
        //規格: R2①——keys含非空且非原始字串之元素且濾後無有效字串者, 該條目回params失敗; 修前: 視同未給(claude起不帶金鑰之子進程成功; REST送不帶認證之請求)
        let rows = []
        for (let kind of KINDS) {
            for (let label of Object.keys(BAD_KEYS)) {
                let before = [spawnedCount(), svr.requests.length]
                let r = await dispatchAiFallback('abc', { providers: [entryOf(kind, BAD_KEYS[label]()), { id: 'good', kind: 'claude', exe: fake.exe, keys: ['sk-ant-api03-GOODKEY-0123456789'] }] })
                let after = [spawnedCount() - before[0], svr.requests.length - before[1]]
                rows.push([kind, label, r.ok, r.providerId, r.tried.map((t) => [t.providerId, t.outcome, t.errorType || null, t.keyIndex]), after])
            }
        }
        let rr = []
        for (let kind of KINDS) {
            for (let label of Object.keys(BAD_KEYS)) {
                rr.push([kind, label, true, 'good', [[`bad-${kind}`, 'skip-group', 'params', null], ['good', 'ok', null, undefined]].map(([id, o, et]) => [id, o, et, id === 'good' ? 0 : null]), [1, 0]])
            }
        }
        assert.strict.deepEqual(rows, rr)
    })

    it('條目keys為未給(undefined、null、[]、[\'\']、[null]、[\'\',null,undefined])時照舊以登入態(單一虛擬金鑰, keyIndex為null)執行, 不被誤擋', async function() {
        //規格: R2②——keys為undefined、null、[]視為未給; 陣列內之''、null、undefined元素略過
        let rows = []
        for (let keys of [undefined, null, [], [''], [null], [undefined], ['', null, undefined]]) {
            let before = spawnedCount()
            let r = await dispatchAiFallback('abc', { providers: [{ id: 'login', kind: 'claude', exe: fake.exe, keys }] })
            rows.push([r.ok, r.keyIndex, r.tried.map((t) => [t.outcome, t.keyIndex]), spawnedCount() - before])
        }
        let rr = [1, 2, 3, 4, 5, 6, 7].map(() => [true, null, [['ok', null]], 1])
        assert.strict.deepEqual(rows, rr)
    })

    it('混合: keys含有效字串者無效元素略過、有效字串照用(keyIndex依濾後陣列, 不拒絕整組)', async function() {
        //規格: R2③——混合不拒絕(同dai492i之包裝金鑰案: 包裝金鑰被濾除而原始字串金鑰成交)
        let rows = []
        for (let keys of [[Object('sk-wrap'), 'sk-ant-api03-GOODKEY-0123456789'], [123, null, '', 'sk-ant-api03-GOODKEY-0123456789', {}], [revoked(), 'sk-ant-api03-GOODKEY-0123456789']]) {
            svr.requests.length = 0
            let r = await dispatchAiFallback('abc', { providers: [{ id: 'mix', kind: 'api-anthropic', baseURL: svr.url, model: 'm', keys }] })
            rows.push([r.keyIndex, svr.requests.map((q) => q.apiKey)])
        }
        let rr = [1, 2, 3].map(() => [0, ['sk-ant-api03-GOODKEY-0123456789']])
        assert.strict.deepEqual(rows, rr)
    })

    it('條目層或共用層之單一key給了而無效(無keys時): 吃key之kind(claude、opencode、api-*)以params整組跳過且不起用量查詢; codex、antigravity無金鑰概念不受影響', async function() {
        //規格: R2①(key)——單一金鑰同keys; 條目已判params失敗者不起訂閱類用量查詢(不送請求); 有keys時各把金鑰覆寫opt.key故不判
        let usage = 0
        let quotaGate = usageGate(() => {
            usage++
        })
        let rows = []
        for (let kind of ['claude', 'opencode', 'api-openai-compat', 'api-anthropic']) {
            for (let label of ['number', 'String-wrapper', 'revoked-Proxy', 'object']) {
                let before = [spawnedCount(), svr.requests.length, usage]
                let r = await dispatchAiFallback('abc', { quotaGate, providers: [{ ...entryOf(kind, undefined), key: BAD_KEY[label]() }, { id: 'good', kind: 'claude', exe: fake.exe, key: 'sk-ant-api03-GOODKEY-0123456789', quotaGate: false }] })
                rows.push([kind, label, r.providerId, r.tried[0].outcome, r.tried[0].errorType, spawnedCount() - before[0], svr.requests.length - before[1], usage - before[2]])
            }
        }
        let rr = []
        for (let kind of ['claude', 'opencode', 'api-openai-compat', 'api-anthropic']) {
            for (let label of ['number', 'String-wrapper', 'revoked-Proxy', 'object']) {
                rr.push([kind, label, 'good', 'skip-group', 'params', 1, 0, 0])
            }
        }
        assert.strict.deepEqual(rows, rr)

        //有keys時opt.key被各把金鑰覆寫, 不因opt.key無效而拒絕
        let r2 = await dispatchAiFallback('abc', { providers: [{ id: 'k', kind: 'api-anthropic', baseURL: svr.url, model: 'm', key: 123, keys: ['sk-ant-api03-GOODKEY-0123456789'] }] })
        assert.strict.deepEqual([r2.ok, r2.keyIndex], [true, 0])

        //codex無金鑰概念: key給任何值皆不拒絕(照舊忽略)
        let r3 = await dispatchAiFallback('abc', { providers: [{ id: 'cx', kind: 'codex', exe: fake.exe, key: 123 }] })
        assert.strict.deepEqual(r3.tried.map((t) => t.errorType || null).includes('params'), false)
    })

    it('claude訂閱類用量查詢: keys給了而無效之條目不起用量讀者(讀者0次); 未給之登入態條目照舊查詢(讀者1次)', async function() {
        //規格: R2①「不起子進程、不送請求」之一部分——用量查詢亦為請求, 條目已判params失敗者不查; 對照: 未給時查詢照舊
        let usage = 0
        let quotaGate = usageGate(() => {
            usage++
        })
        await dispatchAiFallback('abc', { quotaGate, providers: [{ id: 'bad', kind: 'claude', exe: fake.exe, keys: [123] }] })
        let afterBad = usage
        await dispatchAiFallback('abc', { quotaGate, providers: [{ id: 'login', kind: 'claude', exe: fake.exe, keys: [] }] })
        assert.strict.deepEqual([afterBad, usage], [0, 1])
    })

})
