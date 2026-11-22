import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseReadmeHeads, cmpVer, checkReadmeHeads } from './tools/readmeVersionsForTest.mjs'


// unit-readmeVersions.test.mjs — README〈行為變更紀錄〉各條標題之版號檢查(排程第345項)
//
// 規格(主控裁示第345項): README〈行為變更紀錄〉各條標題原皆寫「未發布」、未填實際版號(歷來皆然; 發布流程不回填)——
//   S1 已發布之條目標題寫實際版號(`**1.0.N（…`); 尚未發布者寫「未發布（預計 1.0.N …」。
//   S2 檢查工具對仍寫「未發布」之標題加提示: ①結構(嚴格, 使測試失敗): 寫「未發布」而無預計版號; ②提示(不使測試失敗, 輸出[提示]供發布時回填):
//      「未發布」之預計版號不大於package.json之version、或標題版號大於package.json之version。
//   實際README之提示於測試輸出可見(console.warn, 前綴[提示])。


let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')


describe('README行為變更紀錄之標題版號(排程第345項)', function() {

    it('S2 工具: 解析標題(已發布／未發布含預計版號)、結構錯誤與提示之判定(以夾具驗證, 不依真實README)', function() {
        let fx = [
            '## 其他',
            '**未發布（預計 9.9.9）**（不在節內）',
            '#### 行為變更紀錄（依賴方升版前請檢查）:',
            '**1.0.37 起**（既有）：',
            '1. 條目',
            '**1.0.105（wsemi）**：',
            '**未發布（預計 1.0.109；排程）**：',
            '**未發布（預計 1.0.108）**：',
            '**未發布（同批次）**：',
            '**1.0.200（超前）**：',
            '#### 下一節',
            '**未發布（預計 8.8.8）**（不在節內）',
        ].join('\n')
        let heads = parseReadmeHeads(fx)
        assert.strict.deepEqual(heads.map((h) => [h.kind, h.version]), [['released', '1.0.37'], ['released', '1.0.105'], ['unreleased', '1.0.109'], ['unreleased', '1.0.108'], ['unreleased', ''], ['released', '1.0.200']])
        let c = checkReadmeHeads(fx, '1.0.108')
        assert.strict.deepEqual(c.errors.length, 1) //「未發布（同批次）」無預計版號
        assert.strict.deepEqual(c.hints.map((s) => /預計版號 1\.0\.108 不大於/.test(s) || /標題版號 1\.0\.200 大於/.test(s)), [true, true]) //預計108不大於現行108; 200大於現行108; 預計109大於108不提示
        assert.strict.deepEqual([cmpVer('1.0.9', '1.0.10') < 0, cmpVer('1.0.10', '1.0.10'), cmpVer('1.1.0', '1.0.99') > 0], [true, 0, true])
    })

    it('S1 實際README: 各條標題皆為版號或「未發布（預計 1.0.N …」(結構無誤); 不再有未寫版號之「未發布」標題; 仍寫「未發布」者列出提示', function() {
        let pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
        let text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
        let c = checkReadmeHeads(text, pkg.version)
        for (let h of c.hints) {
            console.warn(`[提示] ${h}`)
        }
        assert.strict.deepEqual(c.errors, [])
        assert.strict.deepEqual(c.heads.length > 20, true) //節內標題確實被解析到(防解析範圍壞掉而空過)
        let unreleased = c.heads.filter((h) => h.kind === 'unreleased')
        assert.strict.deepEqual(unreleased.every((h) => /^\d+\.\d+\.\d+$/.test(h.version)), true)
    })

    it('S1 實際README: 已發布標題之版號皆為實際存在之格式(1.0.N)且不重複倒退(同節內依序不減)', function() {
        let text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
        let rel = parseReadmeHeads(text).filter((h) => h.kind === 'released').map((h) => h.version)
        assert.strict.deepEqual(rel.every((v, i) => i === 0 || cmpVer(rel[i - 1], v) <= 0), true)
    })

})
