// readmeVersionsForTest.mjs — README〈行為變更紀錄〉各條標題之版號檢查(測試與提示共用; 排程第345項)
//
// 標題行形式: 以`**`起頭、其後為版號(`1.0.N`, 已發布)或`未發布（預計 1.0.N …`(尚未發布, 須寫明預計之版號)。
// 歷來標題皆寫「未發布」而發布流程不回填版號(2026-11-22 排程第345項前), 故加此檢查:
//   ①結構(嚴格): 寫「未發布」者須帶`預計 1.0.N`(令發布時知道該回填何版);
//   ②提示(不使測試失敗): 標題仍寫「未發布」而預計版號已不大於package.json之version(即已發布或正在發布), 或標題之版號大於package.json之version, 皆列出。


let RE_HEAD = /^\*\*(未發布|\d+\.\d+\.\d+)/


/**
 * 解析README〈行為變更紀錄〉各條標題
 *
 * @param {String} text 輸入README全文
 * @returns {Array} 回傳標題陣列，各項為{ line(行號)、kind('released'|'unreleased')、version(標題之版號或預計版號字串，無則空字串)、text(行首90字元) }
 */
export function parseReadmeHeads(text) {
    let out = []
    let inSec = false
    String(text).split(/\r?\n/).forEach((ln, i) => {
        if (/^#{1,4} 行為變更紀錄/.test(ln)) {
            inSec = true
            return
        }
        if (inSec && /^#{1,4} /.test(ln)) {
            inSec = false
        }
        if (!inSec) {
            return
        }
        let m = RE_HEAD.exec(ln)
        if (m === null) {
            return
        }
        if (m[1] === '未發布') {
            let p = /預計\s*(\d+\.\d+\.\d+)/.exec(ln.slice(0, 120))
            out.push({ line: i + 1, kind: 'unreleased', version: p ? p[1] : '', text: ln.slice(0, 90) })
        }
        else {
            out.push({ line: i + 1, kind: 'released', version: m[1], text: ln.slice(0, 90) })
        }
    })
    return out
}


/**
 * 比較兩個x.y.z版號(只比數字)
 *
 * @param {String} a 輸入版號
 * @param {String} b 輸入版號
 * @returns {Number} 回傳負、0、正(a小於、等於、大於b)
 */
export function cmpVer(a, b) {
    let x = String(a).split('.').map(Number)
    let y = String(b).split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) !== (y[i] || 0)) {
            return (x[i] || 0) - (y[i] || 0)
        }
    }
    return 0
}


/**
 * 檢查各條標題之版號，回傳結構錯誤與提示
 *
 * @param {String} text 輸入README全文
 * @param {String} pkgVersion 輸入package.json之version
 * @returns {Object} 回傳{ errors(結構錯誤字串陣列), hints(提示字串陣列), heads }
 */
export function checkReadmeHeads(text, pkgVersion) {
    let heads = parseReadmeHeads(text)
    let errors = []
    let hints = []
    for (let h of heads) {
        if (h.kind === 'unreleased') {
            if (h.version === '') {
                errors.push(`README:${h.line} 標題寫「未發布」而未寫預計版號(須為「未發布（預計 1.0.N …」): ${h.text}`)
            }
            else if (cmpVer(h.version, pkgVersion) <= 0) {
                hints.push(`README:${h.line} 標題仍寫「未發布」而預計版號 ${h.version} 不大於 package.json 之 ${pkgVersion}(已發布或正在發布): 請改為「**${h.version}（…」`)
            }
        }
        else if (cmpVer(h.version, pkgVersion) > 0) {
            hints.push(`README:${h.line} 標題版號 ${h.version} 大於 package.json 之 ${pkgVersion}(尚未發布?): ${h.text}`)
        }
    }
    return { errors, hints, heads }
}
