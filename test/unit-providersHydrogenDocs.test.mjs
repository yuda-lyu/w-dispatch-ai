import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


// unit-providersHydrogenDocs.test.mjs — agy:gemini-4-hydrogen-high條目註解與文件守門(2026-11-13 da-hy, Gitea #137)
//
// 規格(使用端建議Gitea #137、本套件CLAUDE.md〈公開庫〉、帳本R-AGY-3〈實測不到者不得寫成已驗證〉):
//   ①條目註解標明來源(使用端Gitea #137)、實測分「提出端」與「本機 2026-11-13」, 本機實測含目錄解析、簡答、寫檔金絲雀(分工作區內外)、額度前後對照;
//   ②檔頭agy檔位說明含Hydrogen(low／medium／high／xhigh); README載明新增、不取代不刪除3.8、不收xhigh、條目數38;
//   ③本套件為GitHub公開庫: 程式、測試、sgud、README、註解皆不得寫使用端之專案名或其本機路徑(需求出處只寫「使用端」與Gitea編號)。


let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')


//entryHead, 取「3.8條目結束」至「Hydrogen條目id」之間之註解文字(Hydrogen條目之說明註解)
function entryHead(src) {
    let i38 = src.indexOf('id: \'agy:gemini-3.8-flash-high\'')
    let iHy = src.indexOf('id: \'agy:gemini-4-hydrogen-high\'')
    assert.strict.equal(i38 > 0 && iHy > i38, true)
    let from = src.indexOf('skipPermissions: false,', i38)
    return src.slice(from, iHy)
}


describe('agy:gemini-4-hydrogen-high條目註解與文件', function() {

    it('條目註解: 來源為使用端(Gitea #137)、實測分〔提出端〕與〔本機 2026-11-13〕, 本機含目錄解析／簡答／寫檔金絲雀(工作區內外)／額度前後對照, 不取代不刪除3.8、不收xhigh', function() {
        let h = entryHead(read('src/providers.mjs'))
        let r = [
            h.includes('來源: 使用端建議, Gitea #137'),
            h.includes('〔提出端〕'),
            h.includes('〔本機 2026-11-13〕'),
            h.includes('resolveCatalogue({ pick:[\'agy:gemini-4-hydrogen-high\'] })'),
            h.includes('skipped 0'),
            h.includes('簡答「請只回覆兩個字：完成」'),
            h.includes('寫檔金絲雀') && h.includes('工作區(addDirs[\'.\']＝cwd)外') && h.includes('auto-denied') && h.includes('工作區內'),
            //額度對照: 只固定「有對照、Argon不動、Gemini Models窗口有變」之結論句, 不釘單次讀數(讀數可由後續補充或更正)
            h.includes('額度前後對照') && h.includes('「Gemini 4 Argon」7天窗口') && h.includes('(不動)') && h.includes('「Gemini Models」5小時窗口'),
            h.includes('不取代也不刪除3.8'),
            h.includes('xhigh為本模型另有之檔位, 不收'),
            h.includes('無Hydrogen專屬群組'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true, true, true, true, true])
    })

    it('providers.mjs檔頭agy檔位說明含Hydrogen之slug與檔位(low／medium／high／xhigh), 全取鏈agy條目相鄰數為五條', function() {
        let s = read('src/providers.mjs')
        let r = [
            s.includes('gemini-4-hydrogen-high、gemini-4-argon-high、claude-sonnet-5-5-high、claude-opus-5-5-high'),
            s.includes('Gemini 4 Hydrogen為low/medium/high/xhigh'),
            s.includes('全取鏈中五條agy條目相鄰') && s.includes('連續逾時5次'),
        ]
        assert.strict.deepEqual(r, [true, true, true])
    })

    it('README: 行為變更第73條載明新增Hydrogen條目(位置、不取代不刪除3.8、不收xhigh、37 → 38、額度歸Gemini Models)與README之model slug舉例', function() {
        let t = read('README.md')
        let r = [
            t.includes('73. ①**新增內建條目 `agy:gemini-4-hydrogen-high`**'),
            t.includes('排在 `agy:gemini-3.8-flash-high` 之後、`agy:gemini-4-argon-high` 之前'),
            t.includes('**不取代也不刪除** `agy:gemini-3.8-flash-high`'),
            t.includes('不收 `-xhigh`'),
            t.includes('內建條目 37 → 38 條'),
            t.includes('依既有規則（`gemini-*`）歸「Gemini Models」'),
            t.includes('`gemini-4-hydrogen-high`〔Hydrogen之檔位為low／medium／high／xhigh〕'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true])
    })

    it('公開庫: src／test／README／sgud皆不含使用端之專案名與其本機路徑', function() {
        //專案名以組字避免本檔自身命中; 掃描範圍為會入版控或隨包發布者
        let words = [['tai', 'kns', 'trade'].join('-'), ['C:', 'tai', 'kns'].join('\\')]
        let files = []
        let walk = (dir) => {
            for (let f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                let rel = `${dir}/${f.name}`
                if (f.isDirectory()) {
                    if (f.name !== 'node_modules' && f.name !== '_tmp' && f.name !== 'pics') {
                        walk(rel)
                    }
                }
                else if (/\.(mjs|md|json)$/.test(f.name)) {
                    files.push(rel)
                }
            }
        }
        for (let d of ['src', 'test', 'sgud']) {
            walk(d)
        }
        files.push('README.md')
        let hits = []
        for (let f of files) {
            let t = read(f)
            for (let w of words) {
                if (t.includes(w)) {
                    hits.push([f, w.length])
                }
            }
        }
        assert.strict.deepEqual(hits, [])
    })

})
