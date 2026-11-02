import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


// unit-strTruncateSites.test.mjs — src內對wsemi strTruncate之呼叫站點盤點(2026-11-02 r3da; 帳本R-LOG-2)
//
// 規格來源: 主控r3da提示詞〈本套件之站點〉: wsemi第3輪後strTruncate之maxLen為必須參數(iseint之count), 未給或非預期即拋錯;
//   逐處確認maxLen恆為有效值。本檔把「逐處確認」寫成可重跑之盤點:
//   ① 每個strTruncate(…)呼叫之第2引數(maxLen)須為非負整數字面(如500、1000), 字面恆為iseint之count有效值;
//   ② 唯一例外為wkf/logAiOutcome.mjs之oneline(第2引數Number(n)), 該檔須在同函數內先以iseint(n, { use: 'count' })把關(行為見unit-onelineStrictN);
//   ③ 新增站點若maxLen為變數或運算式, 本檔即失敗, 須補檢查並登記於此。
// 掃描器為簡易字元掃描(括號配平、字串、模板字串含${}、註解), 以合成片段自測其判斷力。


let SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')


//listMjs, 遞迴列出資料夾下全部.mjs(同步; src規模小)
function listMjs(dir) {
    let out = []
    for (let ent of fs.readdirSync(dir, { withFileTypes: true })) {
        let p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
            out.push(...listMjs(p))
        }
        else if (ent.isFile() && ent.name.endsWith('.mjs')) {
            out.push(p)
        }
    }
    return out
}


//skipStr, i指向引號, 回傳字串結尾之下一位置; 模板字串內${…}遞迴
function skipStr(src, i) {
    let q = src[i]
    i++
    while (i < src.length) {
        let ch = src[i]
        if (ch === '\\') {
            i += 2
            continue
        }
        if (q === '`' && ch === '$' && src[i + 1] === '{') {
            i = skipBalanced(src, i + 2, '}')
            continue
        }
        if (ch === q) {
            return i + 1
        }
        i++
    }
    throw new Error('unterminated string')
}


//skipBalanced, 自i(已在開括號之後)掃到對應之閉括號close, 回傳閉括號之下一位置
function skipBalanced(src, i, close) {
    let depth = 0
    while (i < src.length) {
        let ch = src[i]
        if (ch === '"' || ch === '\'' || ch === '`') {
            i = skipStr(src, i)
            continue
        }
        if (ch === '/' && src[i + 1] === '/') {
            i = src.indexOf('\n', i)
            if (i < 0) {
                throw new Error('unterminated comment')
            }
            continue
        }
        if (ch === '/' && src[i + 1] === '*') {
            i = src.indexOf('*/', i + 2) + 2
            continue
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++
        }
        else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) {
                if (ch !== close) {
                    throw new Error(`unbalanced ${ch}`)
                }
                return i + 1
            }
            depth--
        }
        i++
    }
    throw new Error('unterminated call')
}


//splitArgs, 自i(已在strTruncate(之後)取出頂層以逗號分隔之各引數文字
function splitArgs(src, i) {
    let args = []
    let start = i
    let depth = 0
    while (i < src.length) {
        let ch = src[i]
        if (ch === '"' || ch === '\'' || ch === '`') {
            i = skipStr(src, i)
            continue
        }
        if (ch === '/' && src[i + 1] === '/') {
            i = src.indexOf('\n', i)
            continue
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++
        }
        else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) {
                args.push(src.slice(start, i).trim())
                return args
            }
            depth--
        }
        else if (ch === ',' && depth === 0) {
            args.push(src.slice(start, i).trim())
            start = i + 1
        }
        i++
    }
    throw new Error('unterminated call')
}


/**
 * 掃出原始碼內全部strTruncate(…)呼叫(排除import宣告), 回傳各站點之引數文字
 *
 * @param {String} src 輸入原始碼
 * @returns {Array} 回傳[{ line, args }]
 */
function scanSites(src) {
    let sites = []
    let re = /\bstrTruncate\(/g
    let m = null
    while ((m = re.exec(src)) !== null) {
        let line = src.slice(0, m.index).split('\n').length
        sites.push({ line, args: splitArgs(src, m.index + m[0].length) })
    }
    return sites
}


//isLiteralCount, 第2引數是否為非負整數字面(十進位, 不含運算)
function isLiteralCount(a) {
    return typeof a === 'string' && /^\d+$/.test(a)
}


describe('scanSites（掃描器自測）', function() {

    it('取出頂層引數: 巢狀括號、字串內逗號、模板字串內${}與引號、註解皆不誤切', function() {
        let src = [
            'a = strTruncate(red(txt), 1000, optTruncate)',
            // eslint-disable-next-line no-template-curly-in-string
            'b = strTruncate((d.note ? `${d.note}\\n` : \'\') + txt, 500, optTruncate) //註解, 含 ) 與 ,',
            // eslint-disable-next-line no-template-curly-in-string
            'c = strTruncate(`${err}${tail !== \'\' ? ` | ${tail}` : \'\'}`, 500)',
            'd = strTruncate(red(JSON.stringify(stopDetails)), 500, optTruncate)',
            'e = strTruncate(line, Number(n))',
            'f = strTruncate(x, maxLen)',
            'g = strTruncate("a, b)", 7)',
        ].join('\n')
        let sites = scanSites(src)
        assert.strict.deepEqual(sites.map((s) => s.args.length), [3, 3, 2, 3, 2, 2, 2])
        assert.strict.deepEqual(sites.map((s) => s.args[1]), ['1000', '500', '500', '500', 'Number(n)', 'maxLen', '7'])
        assert.strict.deepEqual(sites.map((s) => isLiteralCount(s.args[1])), [true, true, true, true, false, false, true])
    })

    it('import宣告不計；非字面（變數、運算式、小數、負數、字串、缺引數）判為非字面count', function() {
        assert.strict.deepEqual(scanSites('import strTruncate from \'wsemi/src/strTruncate.mjs\''), [])
        for (let a of ['n', 'Number(n)', '500 + 1', '1.5', '-1', '\'500\'', '', undefined, '0x10']) {
            assert.strict.equal(isLiteralCount(a), false, String(a))
        }
        for (let a of ['0', '80', '1000']) {
            assert.strict.equal(isLiteralCount(a), true, a)
        }
        assert.strict.deepEqual(scanSites('x = strTruncate(s)')[0].args, ['s']) //缺maxLen: 只有1個引數
    })

})


describe('src內strTruncate呼叫站點盤點', function() {

    let files = listMjs(SRC)
    let sites = []
    for (let f of files) {
        let rel = path.relative(SRC, f).split(path.sep).join('/')
        for (let s of scanSites(fs.readFileSync(f, 'utf8'))) {
            sites.push({ file: rel, ...s })
        }
    }

    it('盤點非空，且掃描站點數 = 檔內「strTruncate(」出現次數（掃描器無遺漏）', function() {
        assert.strict.equal(sites.length > 0, true)
        let raw = 0
        for (let f of files) {
            raw += (fs.readFileSync(f, 'utf8').match(/\bstrTruncate\(/g) || []).length
        }
        assert.strict.equal(sites.length, raw)
    })

    it('每個站點的maxLen（第2引數）為非負整數字面（恆為iseint count有效值）；唯一例外為wkf/logAiOutcome.mjs之Number(n)', function() {
        let nonLiteral = sites.filter((s) => !isLiteralCount(s.args[1]))
        assert.strict.deepEqual(nonLiteral.map((s) => ({ file: s.file, maxLen: s.args[1] })), [{ file: 'wkf/logAiOutcome.mjs', maxLen: 'Number(n)' }])
    })

    it('唯一例外站點（oneline）前有iseint(n, { use: \'count\' })把關，無效n即return、不交給strTruncate', function() {
        let code = fs.readFileSync(path.join(SRC, 'wkf', 'logAiOutcome.mjs'), 'utf8')
        let body = code.slice(code.indexOf('function oneline('))
        body = body.slice(0, body.indexOf('\n}\n'))
        let iGuard = body.indexOf('if (!iseint(n, { use: \'count\' })) {')
        let iRet = body.indexOf('return line', iGuard)
        let iCall = body.indexOf('strTruncate(line, Number(n))')
        assert.strict.equal(iGuard >= 0 && iRet > iGuard && iCall > iRet, true)
    })

    it('每個站點的第1引數之後只有 maxLen 與（選用）optTruncate，無多餘引數', function() {
        for (let s of sites) {
            assert.strict.equal(s.args.length === 2 || (s.args.length === 3 && s.args[2] === 'optTruncate'), true, `${s.file}:${s.line} ${JSON.stringify(s.args.slice(1))}`)
        }
    })

})
