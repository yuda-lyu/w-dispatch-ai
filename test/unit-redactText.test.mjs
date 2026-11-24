import assert from 'assert'
import redactText, { secretHeaderValues, maskApiKeys, redactApiKeyText, createStreamRedactor, API_KEY_PATTERN, DIAG_PATTERNS } from '../src/redactText.mjs'


// unit-redactText.test.mjs — 本套件對wsemi共用遮罩之單一入口(src/redactText.mjs)之規格測試
//
// 規格來源(2026-11-24 tdai4):
//   S1 全庫遮罩字樣統一為'***'(各入口一致、單一實作; dspec〈診斷輸出與遮罩〉D1);
//   S2 兩個遮罩家族: 精確家族(redactText、串流stdout)只遮已登錄機密值; 診斷家族(redactApiKeyText、maskApiKeys、串流stderr)另遮sk-ant-樣式與wsemi內建憑證樣式;
//   S3 機密值長度下限6(由本檔之入口過濾, wsemi之遮罩器不設下限);
//   S4 非串流入口輸出全文不截斷(成功之stdout為模型輸出, 可達數萬字元);
//   S5 串流以列為單位(收到換行才交出該列、最後無換行之一段於flush交出), 輸出與切塊方式無關, 跨塊或跨列之機密值整段遮到;
//   S6 串流與非串流同一家族之輸出一致(同一段文字經回調與結果物件所見相同)。


let K = 'sk-ant-api03-STREAM-SECRET-0123456789'
let OTHER = 'sk-ant-api03-OTHER-1'

//串流之全部輸出(逐塊push後flush)
let streamAll = (rd, chunks) => {
    let o = ''
    for (let c of chunks) {
        o += rd.push(c)
    }
    return o + rd.flush()
}


describe('redactText', function() {

    //── 精確家族 ──

    it('S1 S2 redactText: 以***替換已登錄機密值(長度不足6者不處理); 不套任何樣式(sk-ant-、password=、網址帳密、Bearer皆保留)', function() {
        let r = [
            redactText('a sk-abc-123 b sk-abc-123', ['sk-abc-123']),
            redactText('token abc', ['abc']),
            redactText(`password=demo https://u1:pw1234@db:5432/a Bearer abc.def ${OTHER} MYSECRET-VALUE`, ['MYSECRET-VALUE']),
            redactText('Headers.append: "Bearer sk-abc\nX" is an invalid header value.', ['Bearer sk-abc\nX']), //含換行之機密值(undici對非法標頭值之訊息)
            redactText(null, ['x']),
            redactText('keep', 'not-an-array'),
            redactText('keep abcdef', [null, 123, '', { x: 1 }, 'abcdef']),
            redactText('keep', undefined), //機密值清單缺席或非陣列(不可迭代者不得拋錯)
            redactText('keep', 123),
            redactText('keep abcdef', 'abcdef'), //字串非陣列: 視為空(不當作可迭代之字元序列, 也不當作單一機密值)
        ]
        let rr = [
            'a *** b ***',
            'token abc',
            `password=demo https://u1:pw1234@db:5432/a Bearer abc.def ${OTHER} ***`,
            'Headers.append: "***" is an invalid header value.',
            'null',
            'keep',
            'keep ***',
            'keep',
            'keep',
            'keep abcdef',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('S3 機密值長度下限為6: 5字元不遮、6字元遮(精確家族、診斷家族、串流兩種皆然)', function() {
        let t = 'v=abcde w=abcdef\n'
        let r = [
            redactText(t, ['abcde', 'abcdef']),
            redactApiKeyText(t, ['abcde', 'abcdef']),
            streamAll(createStreamRedactor(['abcde', 'abcdef'], false), [t]),
            streamAll(createStreamRedactor(['abcde', 'abcdef'], true), [t]),
        ]
        let rr = Array(4).fill('v=abcde w=***\n')
        assert.strict.deepEqual(r, rr)
    })

    it('secretHeaderValues: 已知非憑證標頭(Content-Type、Accept-Encoding、Accept、User-Agent、Referer、HTTP-Referer、X-Title等)以外之標頭值視為機密(預設拒絕: 自訂標頭、Authorization、x-api-key皆是)', function() {
        let r = secretHeaderValues({ 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-api-key': 'sk-ant-api03-A', 'anthropic-version': '2023-06-01' })
        let rr = ['sk-ant-api03-A', '2023-06-01']
        assert.strict.deepEqual(r, rr)
        let r2 = secretHeaderValues({ 'Accept': 'application/json', 'User-Agent': 'x/1', 'HTTP-Referer': 'https://myapp.example', 'X-Title': 'MyApp', 'Referer': 'https://r.example', 'Authorization': 'Bearer KEYVALUE-1', 'X-Custom-Token': 'custom-1' })
        assert.strict.deepEqual(r2, ['Bearer KEYVALUE-1', 'custom-1'])
    })

    it('S9 機密值變體: 頭尾空白與換行去除後之本體、去Bearer前綴之本體亦遮蔽(各變體須達長度下限6); 變體不足下限者不處理', function() {
        let r = [
            redactText('echo KEYVALUE-1 end', ['KEYVALUE-1\n']),
            redactText('echo KEYVALUE-1 end', ['  KEYVALUE-1 ']),
            redactText('Authorization seen: Bearer   KEYVALUE-1 / KEYVALUE-1', ['Bearer   KEYVALUE-1\n']),
            redactApiKeyText('echo KEYVALUE-1', ['Bearer KEYVALUE-1']),
            redactText('echo abc end', ['Bearer abc']), //去前綴後僅3字元, 不處理
            redactText('echo ab end', ['  ab  ']),
            streamAll(createStreamRedactor(['KEYVALUE-1\n']), ['echo KEYVAL', 'UE-1 end\n']),
        ]
        let rr = [
            'echo *** end',
            'echo *** end',
            'Authorization seen: *** / ***',
            'echo ***',
            'echo abc end',
            'echo ab end',
            'echo *** end\n',
        ]
        assert.strict.deepEqual(r, rr)
    })

    //── 診斷家族 ──

    it('S1 S2 maskApiKeys: 遮蔽sk-ant-形式金鑰(含被截斷而只剩前綴之殘段), 長度不足(無實質內容)者保留', function() {
        let r = [
            maskApiKeys('key=sk-ant-api03-ABCDEF_123-xyz end'),
            maskApiKeys('cut sk-ant-api03-ABC'), //被strTruncate截斷之殘段仍含金鑰前段
            maskApiKeys('prefix sk-ant-'),
            maskApiKeys('sk-ant-ab'),
            maskApiKeys('sk-other-1234567890'), //2026-11-24 tdai4b: 診斷家族共用DIAG_PATTERNS, sk-後接12字元以上亦遮(此前只遮sk-ant-)
            maskApiKeys('sk-short-1'), //sk-後不足12字元: 保留
            maskApiKeys('A sk-ant-api03-AAAA B sk-ant-api03-BBBB C'),
        ]
        let rr = [
            'key=*** end',
            'cut ***',
            'prefix sk-ant-',
            'sk-ant-ab',
            '***',
            'sk-short-1',
            'A *** B *** C',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('S1 S2 redactApiKeyText: 先遮蔽指定機密值再遮蔽sk-ant-形式, 另遮蔽wsemi內建憑證樣式(password=鍵值對、網址帳密、Bearer)(單一入口)', function() {
        let r = [
            redactApiKeyText('a MYSECRET-VALUE b sk-ant-api03-OTHER-1 c', ['MYSECRET-VALUE']),
            redactApiKeyText('plain', []),
            redactApiKeyText(null, ['x']),
            redactApiKeyText(`password=demo https://u1:pw1234@db:5432/a Bearer abc.def ${OTHER}`, []),
            redactApiKeyText('token: t0k3n-value', []),
            redactApiKeyText(`echo-${K}-tail`, [K]), //機密值與樣式之命中區間於原文上合併一次取代: 與金鑰相接且屬樣式字元集之'-tail'併入同一個***(不再先精確後樣式依序取代而得echo-***-tail)
        ]
        let rr = [
            'a *** b *** c',
            'plain',
            'null',
            'password=*** https://***@db:5432/a Bearer *** ***',
            'token: ***',
            'echo-***',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('API_KEY_PATTERN為sk-ant-樣式之單一來源(DIAG_PATTERNS首項), 不帶g旗標(wsemi自行加旗標)', function() {
        assert.strict.deepEqual([API_KEY_PATTERN.source, API_KEY_PATTERN.global, DIAG_PATTERNS[0].re === API_KEY_PATTERN], ['sk-ant-[A-Za-z0-9_-]{4,}', false, true])
    })

    it('S8 診斷家族共用同一份金鑰樣式集DIAG_PATTERNS(tdai4b, 主控裁定(d)): sk-ant-／sk-／oc_sk_／AIza／ghp_／github_pat_／JWT／wrk_皆遮蔽, 非金鑰字樣原樣; 精確家族不套樣式; 三個診斷入口(非串流、maskApiKeys、串流)一致', function() {
        let keys = [
            'sk-ant-api03-ABCDEFG-123',
            'sk-projABCDEFGHIJKLMNOP',
            'oc_sk_ABCDEFGHIJKLMNOP1234',
            'AIzaSy0123456789abcdefghijklmnopqrstuv',
            'ghp_0123456789abcdefghijABCDEFGHIJ012345',
            'github_pat_0123456789abcdefghijABCDEF',
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij123456',
            'wrk_abcdef123456',
        ]
        let keep = 'task-abcdefghijklmnopq desk-ABCDEFGHIJKLMNOP sk-short wrk_ab12 ghp_short'
        let text = keys.map((k, i) => `k${i} ${k}`).join(' ') + ' ' + keep
        let want = keys.map((k, i) => `k${i} ***`).join(' ') + ' ' + keep
        assert.strict.deepEqual(
            [
                redactApiKeyText(text, []),
                maskApiKeys(text),
                streamAll(createStreamRedactor([], true), [text.slice(0, 50), text.slice(50)]),
                redactText(text, []),
                DIAG_PATTERNS.length,
            ],
            [want, want, want, text, 6],
        )
    })

    //── S4 全文不截斷 ──

    it('S4 非串流入口輸出全文不截斷(超過20000字元之模型輸出): 長度只減去機密值之差, 無「…(len=」截斷註記, 機密值落在16000／20000邊界附近皆遮到', function() {
        let S = 'SECRET-ABCDEFGH-12345678'
        let bad = []
        for (let p of [0, 15990, 15995, 19990, 20000, 20005, 31990, 44990]) {
            for (let mode of ['單列無空白', '多列']) {
                let body = mode === '單列無空白' ? 'a'.repeat(p) + S + 'b'.repeat(45000 - p) : ('line-x '.repeat(Math.floor(p / 7)) + S + '\n' + 'tail-y '.repeat(Math.floor((45000 - p) / 7)))
                let want = body.replace(S, '***')
                let o1 = redactText(body, [S])
                let o2 = redactApiKeyText(body, [S])
                if (o1 !== want || o2 !== want) {
                    bad.push([p, mode, o1.length, o2.length, want.length, o1.includes('…(len=')])
                }
            }
        }
        assert.strict.deepEqual(bad, [])
    })

    //── S5 串流 ──

    it('S5 createStreamRedactor: 機密值被切在任意位置的兩塊(或三塊)之間, 含跨列與結尾無換行, 合併輸出等同對整段文字一次遮蔽(S6)', function() {
        let text = `head ${K} mid\n${K}tail line2 ${K}\nlast ${K.slice(0, 10)}`
        let want = redactText(text, [K])
        let bad = []
        for (let i = 0; i <= text.length; i++) {
            for (let j = i; j <= text.length; j += 7) {
                let out = streamAll(createStreamRedactor([K]), [text.slice(0, i), text.slice(i, j), text.slice(j)])
                if (out !== want) {
                    bad.push([i, j, out])
                }
            }
        }
        assert.strict.deepEqual([bad.slice(0, 3), want], [[], `head *** mid\n***tail line2 ***\nlast ${K.slice(0, 10)}`])
    })

    it('S5 createStreamRedactor(診斷家族): sk-ant-樣式、網址帳密、password=鍵值對與Bearer被切在任意兩塊之間, 合併輸出等同整段遮蔽; 非金鑰文字(含「s」「sk」結尾)不被吞掉', function() {
        let text = `x sk-ant-api03-ABCDEFG-123 y sk-ant-zz z https://u1:pw1234@db:5432/a password=demo Bearer abc.def\nlast s sk`
        let want = redactApiKeyText(text, [])
        let bad = []
        for (let i = 0; i <= text.length; i++) {
            let out = streamAll(createStreamRedactor([], true), [text.slice(0, i), text.slice(i)])
            if (out !== want) {
                bad.push([i, out])
            }
        }
        assert.strict.deepEqual([bad.slice(0, 3), want], [[], 'x *** y sk-ant-zz z https://***@db:5432/a password=*** Bearer ***\nlast s sk'])
    })

    it('S2 S5 串流兩個家族: stdout家族只遮機密值(password=、網址帳密、Bearer、他把sk-ant-皆保留); stderr家族另遮sk-ant-樣式與內建憑證樣式', function() {
        let line = `password=demo https://u1:pw1234@db:5432/a Bearer abc.def ${OTHER} ${K}\n`
        let r = [
            streamAll(createStreamRedactor([K], false), [line]),
            streamAll(createStreamRedactor([K], true), [line]),
            streamAll(createStreamRedactor([K]), [line]), //pattern預設false: 精確家族
        ]
        let rr = [
            `password=demo https://u1:pw1234@db:5432/a Bearer abc.def ${OTHER} ***\n`,
            'password=*** https://***@db:5432/a Bearer *** *** ***\n',
            `password=demo https://u1:pw1234@db:5432/a Bearer abc.def ${OTHER} ***\n`,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('S5 串流以列為單位: 收到換行才交出該列, 結尾無換行之一段於flush交出, flush後可再push(視為新串流), 空串流flush為空', function() {
        let rd = createStreamRedactor([K])
        let r = [rd.push('abc'), rd.push(' def\nghi'), rd.push(' jkl'), rd.flush(), rd.flush(), rd.push('again\n'), rd.flush()]
        assert.strict.deepEqual(r, ['', 'abc def\n', '', 'ghi jkl', '', 'again\n', ''])
    })

    it('S5 含換行之機密值(跨列)整段遮到, 與切塊方式無關', function() {
        let K2 = 'line1-secret-value\nline2-secret-value'
        let text = `x ${K2} y\nz ${K2}`
        let want = 'x *** y\nz ***'
        let bad = []
        for (let step of [1, 2, 3, 5, 8, 13, text.length]) {
            let chunks = []
            for (let i = 0; i < text.length; i += step) {
                chunks.push(text.slice(i, i + step))
            }
            let out = streamAll(createStreamRedactor([K2]), chunks)
            if (out !== want) {
                bad.push([step, out])
            }
        }
        assert.strict.deepEqual([bad, redactText(text, [K2])], [[], want])
    })

    it('S5 長列(超過20000字元, 逐塊餵入): 輸出全文不截斷, 機密值落在分段邊界(16000／20000附近)皆遮到, 兩個家族皆然', function() {
        let S = 'SECRET-ABCDEFGH-12345678'
        let bad = []
        for (let p of [15990, 15995, 19990, 20000, 20005, 31990, 39995]) {
            let text = 'a'.repeat(p) + S + 'b'.repeat(45000 - p)
            let want = text.replace(S, '***')
            for (let pattern of [false, true]) {
                let chunks = []
                for (let i = 0; i < text.length; i += 4999) {
                    chunks.push(text.slice(i, i + 4999))
                }
                let out = streamAll(createStreamRedactor([S], pattern), chunks)
                if (out !== want) {
                    bad.push([p, pattern, out.length, want.length])
                }
            }
        }
        assert.strict.deepEqual(bad, [])
    })

    it('S5 二進位塊以UTF-8串流解碼(多位元組字元被切在兩塊之間亦正確); 非字串塊以String轉換', function() {
        let buf = Buffer.from(`中文${K}結尾`)
        let chunks = []
        for (let i = 0; i < buf.length; i += 5) {
            chunks.push(buf.subarray(i, i + 5))
        }
        let rd = createStreamRedactor(['abcdef', null, ''])
        let r = [
            streamAll(createStreamRedactor([K]), chunks),
            rd.push('abcabc') + rd.push(123) + rd.flush(),
            streamAll(createStreamRedactor('not-an-array'), ['x']),
        ]
        assert.strict.deepEqual(r, ['中文***結尾', 'abcabc123', 'x'])
    })

    it('S6 同一家族之串流輸出等於非串流輸出(同一段文字經回調與結果物件所見一致)', function() {
        let text = `err: ${K} password=demo ${OTHER}\nhttps://u1:pw1234@db:5432/a\nBearer abc.def tail`
        let r = [
            streamAll(createStreamRedactor([K], false), [text.slice(0, 40), text.slice(40)]) === redactText(text, [K]),
            streamAll(createStreamRedactor([K], true), [text.slice(0, 40), text.slice(40)]) === redactApiKeyText(text, [K]),
        ]
        assert.strict.deepEqual(r, [true, true])
    })

})
