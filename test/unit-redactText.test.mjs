import assert from 'assert'
import redactText, { secretHeaderValues, maskApiKeys, redactApiKeyText, createStreamRedactor } from '../src/redactText.mjs'


describe('redactText', function() {

    it('redactText: 以遮蔽字替換機密值(長度不足6者不處理)', function() {
        let r = [
            redactText('a sk-abc-123 b sk-abc-123', ['sk-abc-123']),
            redactText('token abc', ['abc']),
        ]
        let rr = ['a [REDACTED] b [REDACTED]', 'token abc']
        assert.strict.deepEqual(r, rr)
    })

    it('secretHeaderValues: Content-Type與Accept-Encoding以外之標頭值視為機密', function() {
        let r = secretHeaderValues({ 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-api-key': 'sk-ant-api03-A', 'anthropic-version': '2023-06-01' })
        let rr = ['sk-ant-api03-A', '2023-06-01']
        assert.strict.deepEqual(r, rr)
    })

    it('maskApiKeys: 遮蔽sk-ant-形式金鑰(含被截斷而只剩前綴之殘段), 長度不足(無實質內容)者保留', function() {
        let r = [
            maskApiKeys('key=sk-ant-api03-ABCDEF_123-xyz end'),
            maskApiKeys('cut sk-ant-api03-ABC'), //被strTruncate截斷之殘段仍含金鑰前段
            maskApiKeys('prefix sk-ant-'),
            maskApiKeys('sk-ant-ab'),
            maskApiKeys('sk-other-1234567890'),
            maskApiKeys('A sk-ant-api03-AAAA B sk-ant-api03-BBBB C'),
        ]
        let rr = [
            'key=[REDACTED] end',
            'cut [REDACTED]',
            'prefix sk-ant-',
            'sk-ant-ab',
            'sk-other-1234567890',
            'A [REDACTED] B [REDACTED] C',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('createStreamRedactor: 機密值被切在任意位置的兩塊(或三塊)之間時, 合併輸出等同對整段文字一次遮蔽; flush補送保留尾端', function() {
        let K = 'sk-ant-api03-STREAM-SECRET-0123456789'
        let text = `head ${K} mid ${K}tail`
        let want = redactText(text, [K])
        let bad = []
        for (let i = 0; i <= text.length; i++) {
            for (let j = i; j <= text.length; j += 7) {
                let rd = createStreamRedactor([K])
                let out = rd.push(text.slice(0, i)) + rd.push(text.slice(i, j)) + rd.push(text.slice(j)) + rd.flush()
                if (out !== want) {
                    bad.push([i, j, out])
                }
            }
        }
        assert.strict.deepEqual(bad.slice(0, 3), [])
    })

    it('createStreamRedactor(pattern): sk-ant-樣式被切在兩塊之間時合併輸出等同整段遮蔽; 非金鑰文字(含「s」「sk」結尾)不被吞掉', function() {
        let text = 'x sk-ant-api03-ABCDEFG-123 y sk-ant-zz z s sk'
        let want = maskApiKeys(text)
        let bad = []
        for (let i = 0; i <= text.length; i++) {
            let rd = createStreamRedactor([], true)
            let out = rd.push(text.slice(0, i)) + rd.push(text.slice(i)) + rd.flush()
            if (out !== want) {
                bad.push([i, out])
            }
        }
        assert.strict.deepEqual([bad.slice(0, 3), want], [[], 'x [REDACTED] y sk-ant-zz z s sk'])
    })

    it('createStreamRedactor: 無機密值時原樣輸出; 長度不足6之機密值不處理; 非字串塊以String轉換; 結束後flush為空', function() {
        let rd = createStreamRedactor(['abc', null, ''])
        let out = rd.push('abcabc') + rd.push(123) + rd.flush()
        let rd2 = createStreamRedactor('not-an-array')
        assert.strict.deepEqual([out, rd.flush(), rd2.push('x') + rd2.flush()], ['abcabc123', '', 'x'])
    })

    it('redactApiKeyText: 先遮蔽指定機密值再遮蔽sk-ant-形式(單一入口)', function() {
        let r = [
            redactApiKeyText('a MYSECRET-VALUE b sk-ant-api03-OTHER-1 c', ['MYSECRET-VALUE']),
            redactApiKeyText('plain', []),
            redactApiKeyText(null, ['x']),
        ]
        let rr = ['a [REDACTED] b [REDACTED] c', 'plain', 'null']
        assert.strict.deepEqual(r, rr)
    })

})
