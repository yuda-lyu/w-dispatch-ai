import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DIAG_PATTERNS as DIAG_PATTERNS_FD } from '../src/failureDiag.mjs'
import { API_KEY_PATTERN, DIAG_PATTERNS } from '../src/redactText.mjs'


// unit-redactSites.test.mjs — 全庫遮罩站點之盤點式測試(2026-11-24 tdai4、tdai4b; 帳本R-REDACT-1、R-REDACT-2、R-REDACT-3)
//
// 規格: 全庫之遮罩字樣統一為'***', 單一實作(dspec〈診斷輸出與遮罩〉D1)——
//   S1 src內不得殘留自行以[REDACTED]或自訂遮罩字取代機密值之站點(split/join、REDACT_MASK等常數);
//   S2 只有src/redactText.mjs(單一入口)與src/failureDiag.mjs(宣告本套件樣式交maskDiagText)可直接引用wsemi之遮罩函數;
//   S3 全庫經單一入口遮蔽之站點全集(12檔含入口; tdai4b起含dispatchOpencode.mjs)固定, 新增或移除站點須同步改本表(防止新站點自寫遮罩、或舊站點被改回自寫);
//   S4 金鑰樣式集只有一份定義(redactText.mjs之DIAG_PATTERNS, 首項為sk-ant-之API_KEY_PATTERN), failureDiag.mjs與診斷家族共用同一個陣列; 其餘檔不另寫金鑰樣式。
// 盤點方法為文字掃描(去掉行註解與區塊註解後), 掃描範圍壞掉(檔數過少)時以防空集合斷言先失敗。
// 重跑: npx mocha --no-parallel test/unit-redactSites.test.mjs


let SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

//全庫經單一入口(redactText.mjs)遮蔽之站點全集(相對src之路徑; 不含redactText.mjs本身)
let SITES = [
    'dispatchApiAnthropic.mjs',
    'dispatchApiOpenaiCompat.mjs',
    'dispatchApiOpenaiResponses.mjs',
    'dispatchApiTypesafeSystemone.mjs',
    'dispatchClaude.mjs',
    'dispatchOpencode.mjs',
    'failureDiag.mjs',
    'opencodeGoUsage.mjs',
    'probeAnthropicKeys.mjs',
    'quota/fetchQuotaJson.mjs',
    'wkf/logAiOutcome.mjs',
]

//直接引用wsemi遮罩函數者(相對src之路徑)
let WSEMI_MASK_USERS = ['failureDiag.mjs', 'redactText.mjs']

let walk = (dir) => {
    let r = []
    for (let e of fs.readdirSync(dir, { withFileTypes: true })) {
        let p = path.join(dir, e.name)
        if (e.isDirectory()) {
            r.push(...walk(p))
        }
        else if (e.name.endsWith('.mjs')) {
            r.push(p)
        }
    }
    return r
}

//去區塊註解與行註解(行註解須前為行首或空白, 以免誤切網址之//); 字串內之//不在本專案遮罩相關字樣中
let stripComments = (s) => {
    return s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
        .join('\n')
}

let files = walk(SRC).map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join('/'), code: stripComments(fs.readFileSync(p, 'utf8')) }))
let rels = files.map((f) => f.rel)


describe('redactSites(全庫遮罩站點盤點)', function() {

    it('防空集合: 掃描範圍涵蓋src全部.mjs(檔數、關鍵檔皆在), 否則下列盤點之空結果不算數', function() {
        assert.strict.deepEqual(
            [files.length >= 60, SITES.every((s) => rels.includes(s)), rels.includes('redactText.mjs'), SITES.length],
            [true, true, true, 11],
        )
    })

    it('S1 src內無殘留之[REDACTED]字樣、REDACT_MASK常數、自行split/join取代機密值之站點(盤點命中須為空; failureDiag.mjs之BRACKET_IGNORE之redacted為辨識外來文字之雜訊詞, 單列允許)', function() {
        let hits = []
        for (let f of files) {
            for (let [i, l] of f.code.split('\n').entries()) {
                if (/REDACT_MASK|\[REDACTED\]/.test(l)) {
                    hits.push([f.rel, i + 1, l.trim()])
                }
                if (/\bredacted\b/i.test(l) && !(f.rel === 'failureDiag.mjs' && l.includes('BRACKET_IGNORE'))) {
                    hits.push([f.rel, i + 1, l.trim()])
                }
            }
            //split(…).join(…)鏈: 以整檔掃描(含跨行與一層巢狀括號, 如split(String(k)))
            for (let m of f.code.matchAll(/\.split\((?:[^()]|\([^()]*\))*\)\s*\.join\(/g)) {
                hits.push([f.rel, f.code.slice(0, m.index).split('\n').length, m[0].slice(0, 60)])
            }
        }
        assert.strict.deepEqual(hits, [])
    })

    it('S1 src內之***字面值只有failureDiag.mjs(maskDiag失敗之fail-closed回傳)一處, 其餘站點之遮罩字樣皆來自wsemi', function() {
        let hits = []
        for (let f of files) {
            for (let l of f.code.split('\n')) {
                if (/['"`]\*\*\*['"`]/.test(l)) {
                    hits.push(f.rel)
                }
            }
        }
        assert.strict.deepEqual(hits, ['failureDiag.mjs'])
    })

    it('S2 直接引用wsemi遮罩函數(maskDiag*、genDiag*Masker)者只有redactText.mjs與failureDiag.mjs', function() {
        let users = files.filter((f) => /from\s+['"]wsemi\/src\/(?:maskDiag\w*|genDiagStreamMasker)\.mjs['"]/.test(f.code)).map((f) => f.rel).sort()
        assert.strict.deepEqual(users, WSEMI_MASK_USERS)
    })

    it('S3 引用單一入口(redactText.mjs)之站點全集固定(11檔), 且各站點皆實際呼叫其匯出之函數(非僅匯入)', function() {
        let users = files.filter((f) => f.rel !== 'redactText.mjs' && /from\s+['"](?:\.\/|\.\.\/)redactText\.mjs['"]/.test(f.code))
        let rel = users.map((f) => f.rel).sort()
        let notCalled = users
            .filter((f) => !/\b(?:redactText|redactApiKeyText|maskApiKeys|createStreamRedactor|maskStreamCallbacks|redactResult)\(|\bDIAG_PATTERNS\b/.test(f.code.replace(/^import .*$/gm, '')))
            .map((f) => f.rel)
        assert.strict.deepEqual([rel, notCalled], [[...SITES].sort(), []])
    })

    it('S4 金鑰樣式集只有一份定義: failureDiag.DIAG_PATTERNS即redactText.DIAG_PATTERNS(同一陣列), 首項為API_KEY_PATTERN; src內其餘檔不另寫sk-ant-、sk-／oc_sk_、AIza、ghp_、github_pat_、JWT(eyJ)、wrk_樣式', function() {
        let other = files
            .filter((f) => f.rel !== 'redactText.mjs' && /sk-ant-\[|AIza\[|\bgh\[|github_pat_\[|\beyJ\[|\bwrk_\[|\(\?:sk\|/.test(f.code))
            .map((f) => f.rel)
        assert.strict.deepEqual(
            [DIAG_PATTERNS_FD === DIAG_PATTERNS, DIAG_PATTERNS[0].re === API_KEY_PATTERN, other],
            [true, true, []],
        )
    })

})
