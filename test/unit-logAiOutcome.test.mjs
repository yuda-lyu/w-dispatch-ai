import assert from 'assert'
import logAiOutcome, { createAiEventLogger, OUTCOME_TEXT } from '../src/wkf/logAiOutcome.mjs'


// unit-logAiOutcome.test.mjs — 結果日誌渲染(logAiOutcome／createAiEventLogger／OUTCOME_TEXT; 2026-11-01 da40, Gitea #40; 帳本R-LOG-1)
//
// 規格來源: 建議檔§3:
//   OUTCOME_TEXT = { 'next-key':'換金鑰', 'skip-group':'整組跳過' };
//   logAiOutcome({ result, log, tag='' }): log須為物件(否則拋'logAiOutcome 需要 log（記錄器）'), 接受log／logWarn／logError或info／warn／error兩種介面,
//     渲染四行: ①使用 AI(INFO) ②AI 遞補歷程(WARN; 濾掉ok) ③AI 供應商未納入(WARN; providersSkipped) ④providerPick 有無效 id(ERROR; providersMissing);
//     一律以成員呼叫形式觸發記錄器(class-based logger之this不可失);
//   createAiEventLogger({ log, tag }): cooled事件時WARN'AI 供應商進入冷卻 → …'。
// 2026-11-01 da42(Gitea #42)改回srcRunner原契約: tag原樣接在每行之前、「使用 AI」以providerId有值為準(不看ok)、遞補歷程耗時toFixed(1)、冷卻分鐘數Math.round;
//   原契約字面逐字對照見unit-srcRunnerContract.test.mjs。
// 另依診斷輸出與遮罩規格(D3/D4): 日誌不含金鑰、記錄器自身失敗不影響呼叫端。
// 全部為純函數測試（記錄器為測試替身）。


//mkLog, 介面A: log／logWarn／logError
let mkLog = () => {
    let lines = []
    return {
        lines,
        log: (m) => lines.push(['INFO', m]),
        logWarn: (m) => lines.push(['WARN', m]),
        logError: (m) => lines.push(['ERROR', m]),
    }
}


//mkLogB, 介面B: info／warn／error
let mkLogB = () => {
    let lines = []
    return {
        lines,
        info: (m) => lines.push(['INFO', m]),
        warn: (m) => lines.push(['WARN', m]),
        error: (m) => lines.push(['ERROR', m]),
    }
}


//ClassLogger, class-based logger: 方法依賴this（脫離物件呼叫即失敗）
class ClassLogger {
    constructor() {
        this.buf = []
    }

    info(m) {
        this.buf.push(['INFO', m])
    }

    warn(m) {
        this.buf.push(['WARN', m])
    }

    error(m) {
        this.buf.push(['ERROR', m])
    }
}


//full, 一個含四行內容之結果
let full = () => ({
    ok: true,
    providerId: 'agnes:agnes-3.0-flash',
    keyIndex: 1,
    kind: 'api-openai-compat',
    model: 'agnes-3.0-flash',
    usage: { prompt_tokens: 120, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 30 } },
    stdout: 'MODEL-OUTPUT-SHOULD-NOT-BE-LOGGED',
    tried: [
        { providerId: 'agnes:agnes-3.0-flash', keyIndex: 0, outcome: 'next-key', errorType: 'http', error: 'HTTP 429 quota\nexceeded', durationMs: 1200 },
        { providerId: 'agnes:agnes-3.0-flash', keyIndex: 1, outcome: 'ok', durationMs: 3400 },
    ],
    providersSkipped: ['my:model（MY_KEYS 無金鑰）'],
    providersMissing: ['claude/sonnet'],
})


describe('OUTCOME_TEXT', function() {

    it('next-key譯為換金鑰、skip-group譯為整組跳過（凍結）', function() {
        assert.strict.deepEqual({ ...OUTCOME_TEXT }, { 'next-key': '換金鑰', 'skip-group': '整組跳過' })
        assert.strict.equal(Object.isFrozen(OUTCOME_TEXT), true)
    })

})


describe('logAiOutcome', function() {

    // 規格句: 渲染四行, 等級依序 INFO、WARN、WARN、ERROR
    it('四行各自觸發: 使用 AI／AI 遞補歷程／AI 供應商未納入／providerPick 有無效 id（等級 INFO、WARN、WARN、ERROR）', function() {
        let lg = mkLog()
        logAiOutcome({ result: full(), log: lg })
        assert.strict.deepEqual(lg.lines, [
            ['INFO', '使用 AI agnes:agnes-3.0-flash／key#2（api-openai-compat／agnes-3.0-flash，tokens 120+80（含思考 30））'],
            ['WARN', 'AI 遞補歷程 → agnes:agnes-3.0-flash／key#1（換金鑰：http／HTTP 429 quota exceeded，1.2s）'],
            ['WARN', 'AI 供應商未納入 → my:model（MY_KEYS 無金鑰）'],
            ['ERROR', 'providerPick 有無效 id → claude/sonnet（請對照供應商目錄）'],
        ])
    })

    it('不輸出stdout（模型輸出）與其他欄位', function() {
        let lg = mkLog()
        logAiOutcome({ result: full(), log: lg })
        assert.strict.equal(JSON.stringify(lg.lines).includes('MODEL-OUTPUT'), false)
    })

    // 規格句: 介面B
    it('介面B（info／warn／error）與介面A行為一致', function() {
        let a = mkLog()
        let b = mkLogB()
        logAiOutcome({ result: full(), log: a })
        logAiOutcome({ result: full(), log: b })
        assert.strict.deepEqual(b.lines, a.lines)
    })

    // 規格句: 一律以成員呼叫形式觸發
    it('class-based logger: 成員呼叫形式使this不失（四行皆寫入）', function() {
        let lg = new ClassLogger()
        logAiOutcome({ result: full(), log: lg })
        assert.strict.deepEqual(lg.buf.map((x) => x[0]), ['INFO', 'WARN', 'WARN', 'ERROR'])
    })

    it('console風格（log／warn／error，另有info）: INFO走log、WARN走warn、ERROR走error', function() {
        let calls = []
        let lg = {
            log: (m) => calls.push(['log', m]),
            info: (m) => calls.push(['info', m]),
            warn: (m) => calls.push(['warn', m]),
            error: (m) => calls.push(['error', m]),
        }
        logAiOutcome({ result: full(), log: lg })
        assert.strict.deepEqual(calls.map((x) => x[0]), ['log', 'warn', 'warn', 'error'])
    })

    it('逐等級擇一: 半套介面（只有logWarn與info）各取其有者', function() {
        let calls = []
        let lg = {
            info: (m) => calls.push(['info', m]),
            logWarn: (m) => calls.push(['logWarn', m]),
            error: (m) => calls.push(['error', m]),
        }
        logAiOutcome({ result: full(), log: lg })
        assert.strict.deepEqual(calls.map((x) => x[0]), ['info', 'logWarn', 'logWarn', 'error'])
    })

    it('WARN／ERROR無專屬方法時退用INFO之方法（設定錯誤不得消失）；全無方法則靜默不throw', function() {
        let calls = []
        logAiOutcome({ result: full(), log: { log: (m) => calls.push(m) } })
        assert.strict.equal(calls.length, 4)
        assert.strict.equal(calls[3], 'providerPick 有無效 id → claude/sonnet（請對照供應商目錄）')
        assert.strict.doesNotThrow(() => logAiOutcome({ result: full(), log: {} }))
    })

    // 規格句: log須為物件(否則拋)
    it('log缺或非物件拋錯（opt非物件亦同）', function() {
        let bad = [undefined, null, 'x', 5, true, {}, { result: full() }, { result: full(), log: null }, { result: full(), log: 'console' }, { result: full(), log: 5 }]
        for (let o of bad) {
            assert.throws(() => logAiOutcome(o), { message: 'logAiOutcome 需要 log（記錄器）' })
        }
    })

    it('result非物件: 無事可記（不throw、不寫日誌）', function() {
        for (let result of [undefined, null, 'x', 5, []]) {
            let lg = mkLog()
            assert.strict.doesNotThrow(() => logAiOutcome({ result, log: lg }))
            assert.strict.deepEqual(lg.lines, [])
        }
    })

    // 第①行
    it('①使用 AI: 無keyIndex（訂閱登入態CLI）無key#；無usage無tokens；思考為0或缺則不加含思考', function() {
        let cases = [
            [{ ok: true, providerId: 'claude:sonnet', keyIndex: null, kind: 'claude', model: 'sonnet' }, '使用 AI claude:sonnet（claude／sonnet）'],
            [{ ok: true, providerId: 'p', keyIndex: 0, kind: 'api-openai-compat', model: 'm', usage: { prompt_tokens: 5, completion_tokens: 7 } }, '使用 AI p／key#1（api-openai-compat／m，tokens 5+7）'],
            [{ ok: true, providerId: 'p', keyIndex: 2, kind: 'k', model: 'm', usage: { prompt_tokens: 5, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 0 } } }, '使用 AI p／key#3（k／m，tokens 5+7）'],
            [{ ok: true, providerId: 'p', kind: 'k', usage: { prompt_tokens: 'x' } }, '使用 AI p（k）'],
            [{ ok: true, providerId: 'p' }, '使用 AI p'],
        ]
        for (let [result, expected] of cases) {
            let lg = mkLog()
            logAiOutcome({ result, log: lg })
            assert.strict.deepEqual(lg.lines, [['INFO', expected]])
        }
    })

    it('①Anthropic形狀之usage（input_tokens／output_tokens）亦顯示tokens', function() {
        let lg = mkLog()
        logAiOutcome({ result: { ok: true, providerId: 'anthropic:haiku-5.5', keyIndex: 0, kind: 'api-anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 20 } }, log: lg })
        assert.strict.deepEqual(lg.lines, [['INFO', '使用 AI anthropic:haiku-5.5／key#1（api-anthropic／claude-haiku-5-5，tokens 10+20）']])
    })

    // 規格句: 截斷內容放行加註
    it('①截斷內容放行加註（含finish_reason）；未截斷不加', function() {
        let base = { ok: true, providerId: 'p', keyIndex: 0, kind: 'api-openai-compat', model: 'm' }
        let lg = mkLog()
        logAiOutcome({ result: { ...base, truncated: true, finishReason: 'length' }, log: lg })
        logAiOutcome({ result: { ...base, truncated: true }, log: lg })
        logAiOutcome({ result: { ...base, truncated: false, finishReason: 'stop' }, log: lg })
        logAiOutcome({ result: { ok: true, providerId: 'p', truncated: true, finishReason: 'length' }, log: lg })
        assert.strict.deepEqual(lg.lines.map((x) => x[1]), [
            '使用 AI p／key#1（api-openai-compat／m；截斷內容放行（finish_reason=length））',
            '使用 AI p／key#1（api-openai-compat／m；截斷內容放行）',
            '使用 AI p／key#1（api-openai-compat／m）',
            '使用 AI p（截斷內容放行（finish_reason=length））',
        ])
    })

    it('①token與截斷並存: tokens之後以「；」接截斷加註', function() {
        let lg = mkLog()
        logAiOutcome({ result: { ok: true, providerId: 'p', keyIndex: 0, kind: 'k', model: 'm', usage: { prompt_tokens: 1, completion_tokens: 2 }, truncated: true, finishReason: 'length' }, log: lg })
        assert.strict.deepEqual(lg.lines, [['INFO', '使用 AI p／key#1（k／m，tokens 1+2；截斷內容放行（finish_reason=length））']])
    })

    // 原契約 core/ai/logAiOutcome.mjs:56: 以providerId有值為準, 不看ok（Gitea #42 §2）
    it('①providerId有值即寫「使用 AI」，不看ok（ok為false亦寫），再寫遞補歷程；providerId缺或空字串不寫', function() {
        let lg = mkLog()
        logAiOutcome({
            result: {
                ok: false,
                providerId: 'p',
                keyIndex: 0,
                tried: [{ providerId: 'p', keyIndex: 0, outcome: 'skip-group', errorType: 'timeout', error: 'TIMEOUT 300000ms', durationMs: 300000 }],
            },
            log: lg,
        })
        assert.strict.deepEqual(lg.lines, [
            ['INFO', '使用 AI p／key#1'],
            ['WARN', 'AI 遞補歷程 → p／key#1（整組跳過：timeout／TIMEOUT 300000ms，300.0s）'],
        ])
        let lg2 = mkLog()
        logAiOutcome({ result: { ok: true, tried: [{ providerId: 'p', outcome: 'skip-group', errorType: 'timeout' }] }, log: lg2 })
        logAiOutcome({ result: { ok: true, providerId: '' }, log: lg2 })
        assert.strict.deepEqual(lg2.lines.map((x) => x[0]), ['WARN'])
    })

    it('①無ok之結果（{ providerId, kind, model }）照記「使用 AI」（srcRunner契約）', function() {
        let lg = mkLog()
        logAiOutcome({ result: { providerId: 'p', kind: 'k', model: 'm' }, log: lg })
        assert.strict.deepEqual(lg.lines, [['INFO', '使用 AI p（k／m）']])
    })

    // 第②行
    it('②只有ok嘗試或無tried: 不寫遞補歷程', function() {
        let lg = mkLog()
        logAiOutcome({ result: { ok: true, providerId: 'p', tried: [{ providerId: 'p', keyIndex: 0, outcome: 'ok', durationMs: 5 }] }, log: lg })
        logAiOutcome({ result: { ok: true, providerId: 'p', tried: [] }, log: lg })
        logAiOutcome({ result: { ok: true, providerId: 'p' }, log: lg })
        logAiOutcome({ result: { ok: true, providerId: 'p', tried: 'x' }, log: lg })
        assert.strict.deepEqual(lg.lines.map((x) => x[0]), ['INFO', 'INFO', 'INFO', 'INFO'])
    })

    it('②多筆以「、」相接；outcome人話（next-key／skip-group），未收錄者原樣顯示；key#從1起、無keyIndex省略', function() {
        let lg = mkLog()
        logAiOutcome({
            result: {
                ok: false,
                tried: [
                    { providerId: 'a', keyIndex: 0, outcome: 'next-key', errorType: 'http', error: 'e1', durationMs: 1000 },
                    { providerId: 'b', keyIndex: null, outcome: 'skip-group', errorType: 'spawn', error: 'ENOENT', durationMs: 20 },
                    { providerId: 'c', keyIndex: 3, outcome: 'budget-out' },
                    { providerId: 'd', keyIndex: 0, outcome: 'skip-key', errorType: 'http', error: 'HTTP 400' },
                    { providerId: 'e', outcome: 'constructor', error: 'x' },
                ],
            },
            log: lg,
        })
        assert.strict.deepEqual(lg.lines, [['WARN', [
            'AI 遞補歷程 → a／key#1（換金鑰：http／e1，1.0s）',
            'b（整組跳過：spawn／ENOENT，0.0s）',
            'c／key#4（budget-out）',
            'd／key#1（skip-key：http／HTTP 400）',
            'e（constructor：x）',
        ].join('、')]])
    })

    it('②原因: reason優先於error；多行壓成單行；超過80字截斷補刪節號；errorType與error皆缺時只有outcome', function() {
        let lg = mkLog()
        let long = 'x'.repeat(100)
        logAiOutcome({
            result: {
                ok: false,
                tried: [
                    { providerId: 'a', keyIndex: 0, outcome: 'next-key', errorType: 'validation', reason: '回覆缺欄位', error: '不應顯示' },
                    { providerId: 'b', keyIndex: 0, outcome: 'next-key', errorType: 'exec', error: 'line1\n\n   line2\tline3' },
                    { providerId: 'c', keyIndex: 0, outcome: 'next-key', errorType: 'exec', error: long },
                    { providerId: 'd', keyIndex: 0, outcome: 'next-key' },
                ],
            },
            log: lg,
        })
        assert.strict.deepEqual(lg.lines[0][1], [
            'AI 遞補歷程 → a／key#1（換金鑰：validation／回覆缺欄位）',
            'b／key#1（換金鑰：exec／line1 line2 line3）',
            `c／key#1（換金鑰：exec／${'x'.repeat(80)}...）`,
            'd／key#1（換金鑰）',
        ].join('、'))
    })

    // 第③④行
    it('③④: 只有providersSkipped寫WARN、只有providersMissing寫ERROR；多筆以「、」相接；空陣列或非字串不寫', function() {
        let lg = mkLog()
        logAiOutcome({ result: { ok: false, providersSkipped: ['a（A_KEYS 無金鑰）', 'b（B_KEYS 無金鑰）'], providersMissing: [] }, log: lg })
        logAiOutcome({ result: { ok: false, providersSkipped: [], providersMissing: ['x', 'y'] }, log: lg })
        logAiOutcome({ result: { ok: false, providersSkipped: [5, null, ''], providersMissing: 'x' }, log: lg })
        assert.strict.deepEqual(lg.lines, [
            ['WARN', 'AI 供應商未納入 → a（A_KEYS 無金鑰）、b（B_KEYS 無金鑰）'],
            ['ERROR', 'providerPick 有無效 id → x、y（請對照供應商目錄）'],
        ])
    })

    // 規格句: tag原樣接在每行之前（Gitea #42 §1; 原契約 core/ai/logAiOutcome.mjs:51-53）
    it('tag: 原樣接在每行之前（不加括號與空白，分隔符由呼叫端自帶）；空字串或非字串視為空', function() {
        let lg = mkLog()
        logAiOutcome({ result: full(), log: lg, tag: 'news：' })
        assert.strict.deepEqual(lg.lines.map((x) => x[1].slice(0, 'news：'.length + 2)), ['news：使用', 'news：AI', 'news：AI', 'news：pr'])
        let lg3 = mkLog()
        logAiOutcome({ result: full(), log: lg3, tag: 'a ' })
        assert.strict.equal(lg3.lines.every((x) => x[1].startsWith('a ')), true) //尾端空白為呼叫端自帶, 原樣保留
        let lg4 = mkLog()
        logAiOutcome({ result: full(), log: lg4, tag: 'x' })
        assert.strict.equal(lg4.lines.every((x) => x[1].startsWith('x') && !x[1].includes('[x]')), true) //不加括號與空白
        assert.strict.equal(lg4.lines[0][1].startsWith('x使用 AI '), true)
        let base = mkLog()
        logAiOutcome({ result: full(), log: base })
        for (let tag of ['', 5, null, undefined, true, {}, []]) {
            let lg2 = mkLog()
            logAiOutcome({ result: full(), log: lg2, tag })
            assert.strict.deepEqual(lg2.lines, base.lines)
        }
    })

    // 診斷輸出與遮罩D3: 日誌不含憑證
    it('日誌不含Anthropic金鑰: tried之error與reason內sk-ant-樣式（含被截斷之殘段）遮蔽', function() {
        let lg = mkLog()
        logAiOutcome({
            result: {
                ok: false,
                tried: [
                    { providerId: 'a', keyIndex: 0, outcome: 'next-key', errorType: 'http', error: 'bad key sk-ant-api03-SECRETSECRET1234 rejected' },
                    { providerId: 'b', keyIndex: 0, outcome: 'next-key', errorType: 'http', reason: 'tail sk-ant-api03-ABCD' },
                ],
            },
            log: lg,
        })
        let all = JSON.stringify(lg.lines)
        assert.strict.equal(all.includes('SECRETSECRET'), false)
        assert.strict.equal(all.includes('sk-ant-api03'), false)
        assert.strict.equal(all.includes('[REDACTED]'), true)
    })

    it('日誌不含金鑰: pick誤填金鑰字串（出現於providersMissing、providersSkipped、providerId、kind／model）時整行遮蔽', function() {
        let lg = mkLog()
        let key = 'sk-ant-api03-SECRETSECRET1234'
        logAiOutcome({
            result: { ok: true, providerId: `p-${key}`, keyIndex: 0, kind: `k-${key}`, model: `m-${key}`, providersSkipped: [`s-${key}`], providersMissing: [key] },
            log: lg,
        })
        assert.strict.equal(lg.lines.length, 3)
        assert.strict.equal(JSON.stringify(lg.lines).includes('SECRETSECRET'), false)
        assert.strict.equal(JSON.stringify(lg.lines).includes('sk-ant-'), false)
    })

    // 診斷輸出與遮罩D4: 記錄器自身失敗不影響
    it('記錄器拋錯或回傳rejected Promise: 吞掉不throw、不產生unhandledRejection、其餘行照寫', async function() {
        let unhandled = []
        let h = (e) => unhandled.push(e)
        process.on('unhandledRejection', h)
        try {
            let seen = []
            let lg = {
                log: () => {
                    throw new Error('logger boom')
                },
                logWarn: async (m) => {
                    seen.push(m)
                    throw new Error('async boom')
                },
                logError: (m) => seen.push(m),
            }
            assert.strict.doesNotThrow(() => logAiOutcome({ result: full(), log: lg }))
            await new Promise((resolve) => setTimeout(resolve, 20))
            assert.strict.equal(seen.length, 3) //兩行WARN＋一行ERROR都寫到
        }
        finally {
            process.off('unhandledRejection', h)
        }
        assert.strict.deepEqual(unhandled, [])
    })

    it('不改動輸入result', function() {
        let r = full()
        let snap = JSON.stringify(r)
        logAiOutcome({ result: r, log: mkLog() })
        assert.strict.equal(JSON.stringify(r), snap)
    })

})


describe('createAiEventLogger', function() {

    // 規格句: cooled事件 → WARN
    it('cooled事件: WARN一行（供應商、錯誤壓單行、分鐘數、降至鏈尾說明）', function() {
        let lg = mkLog()
        let onEvent = createAiEventLogger({ log: lg })
        onEvent({ type: 'cooled', providerId: 'agnes:agnes-3.0-flash', error: 'HTTP 429', cooldownMs: 600000 })
        assert.strict.deepEqual(lg.lines, [['WARN', 'AI 供應商進入冷卻 → agnes:agnes-3.0-flash（HTTP 429，10 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）']])
    })

    it('其餘事件（try、ok、next-key、skip-group…）與非物件事件忽略，不throw', function() {
        let lg = mkLog()
        let onEvent = createAiEventLogger({ log: lg })
        for (let ev of [{ type: 'try' }, { type: 'ok' }, { type: 'next-key' }, { type: 'skip-group' }, { type: 'group-exhausted' }, {}, null, undefined, 'cooled', 5]) {
            assert.strict.doesNotThrow(() => onEvent(ev))
        }
        assert.strict.deepEqual(lg.lines, [])
    })

    it('錯誤壓單行並以60字截斷（補刪節號）；分鐘數為Math.round整數（90000→2、30000→1）；cooldownMs無效不寫分鐘數', function() {
        let lg = mkLog()
        let onEvent = createAiEventLogger({ log: lg })
        onEvent({ type: 'cooled', providerId: 'p', error: 'a\n b\t' + 'y'.repeat(100), cooldownMs: 90000 })
        onEvent({ type: 'cooled', providerId: 'p', error: '', cooldownMs: 'x' })
        onEvent({ type: 'cooled', providerId: 'p', cooldownMs: 30000 })
        onEvent({ type: 'cooled', providerId: 'p', cooldownMs: 70000 }) //1.17分鐘: round得1（非ceil之2、非一位小數之1.2）
        assert.strict.deepEqual(lg.lines.map((x) => x[1]), [
            `AI 供應商進入冷卻 → p（a b ${'y'.repeat(56)}...，2 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）`,
            'AI 供應商進入冷卻 → p（冷卻視窗內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）',
            'AI 供應商進入冷卻 → p（1 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）',
            'AI 供應商進入冷卻 → p（1 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）',
        ])
    })

    it('scope為key之金鑰冷卻: 如實寫「降至組內最後」（含key#），不誤稱降至鏈尾', function() {
        let lg = mkLog()
        createAiEventLogger({ log: lg })({ type: 'cooled', scope: 'key', providerId: 'anthropic:haiku-5.5', keyIndex: 1, error: 'no credit', cooldownMs: 600000 })
        assert.strict.deepEqual(lg.lines, [['WARN', 'AI 金鑰進入冷卻 → anthropic:haiku-5.5／key#2（no credit，10 分鐘內降至組內最後；只降序不移除，仍會被嘗試以偵測恢復）']])
    })

    it('scope為entry之條目冷卻（整組沒額度）與無scope同寫法', function() {
        let a = mkLog()
        let b = mkLog()
        createAiEventLogger({ log: a })({ type: 'cooled', scope: 'entry', providerId: 'p', error: 'e', cooldownMs: 60000 })
        createAiEventLogger({ log: b })({ type: 'cooled', providerId: 'p', error: 'e', cooldownMs: 60000 })
        assert.strict.deepEqual(a.lines, b.lines)
    })

    // 規格句: log缺拋錯; 成員呼叫; tag
    it('opt非物件或log缺拋錯（於建立時）', function() {
        for (let o of [undefined, null, 'x', 5, {}, { log: null }, { log: 'x' }]) {
            assert.throws(() => createAiEventLogger(o), { message: 'createAiEventLogger 需要 log（記錄器）' })
        }
    })

    it('class-based logger與介面B: 成員呼叫形式（this不失）；tag原樣接在行首', function() {
        let lg = new ClassLogger()
        createAiEventLogger({ log: lg, tag: 'news：' })({ type: 'cooled', providerId: 'p', error: 'e', cooldownMs: 60000 })
        assert.strict.deepEqual(lg.buf, [['WARN', 'news：AI 供應商進入冷卻 → p（e，1 分鐘內降至鏈尾；只降序不移除，前面全敗時仍會被嘗試）']])
        let lg2 = mkLogB()
        createAiEventLogger({ log: lg2 })({ type: 'cooled', providerId: 'p', cooldownMs: 60000 })
        assert.strict.equal(lg2.lines[0][0], 'WARN')
    })

    it('事件回調可直接掛進dispatchAiFallback之onEvent（回傳函數、同步、不throw）', function() {
        let onEvent = createAiEventLogger({ log: mkLog() })
        assert.strict.equal(typeof onEvent, 'function')
        assert.strict.equal(onEvent({ type: 'cooled', providerId: 'p', cooldownMs: 1 }), undefined)
    })

    it('錯誤中的Anthropic金鑰樣式遮蔽；記錄器拋錯吞掉', function() {
        let lg = mkLog()
        createAiEventLogger({ log: lg })({ type: 'cooled', providerId: 'p', error: 'x sk-ant-api03-SECRETSECRET1234 y', cooldownMs: 60000 })
        assert.strict.equal(JSON.stringify(lg.lines).includes('SECRETSECRET'), false)
        let bad = createAiEventLogger({
            log: {
                logWarn: () => {
                    throw new Error('boom')
                }
            }
        })
        assert.strict.doesNotThrow(() => bad({ type: 'cooled', providerId: 'p', cooldownMs: 60000 }))
    })

})
