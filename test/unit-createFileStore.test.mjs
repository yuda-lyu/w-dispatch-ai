import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import createFileStore from '../src/wkf/createFileStore.mjs'


//產物落test/tmp/(同fakeCliForTest慣例), 測試結束清除
let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp', 'file-store')


describe('createFileStore', function() {

    before(function() {
        fs.mkdirSync(FD, { recursive: true })
    })

    after(function() {
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch (e) {}
    })

    it('file與dir皆缺時throw(組裝期設定錯誤fail fast)', function() {
        assert.throws(() => createFileStore(), { message: 'createFileStore: file or dir is required' })
    })

    it('dir+name組路徑, 檔案不存在時get回空物件(套件視為全新狀態)', function() {
        let store = createFileStore({ dir: FD, name: 'fresh.json' })
        let r = [store.file, store.get()]
        let rr = [path.join(FD, 'fresh.json'), {}]
        assert.strict.deepEqual(r, rr)
    })

    it('排除式passthrough: 未知欄位原封存還, 僅剔除自用欄位at(白名單丟棄cooling殷鑑)', function() {
        let store = createFileStore({ dir: FD, name: 'rt.json', stamp: () => 'T0' })
        //state含cursors/cooling與「套件未來新增的未知欄位」zz, 全數應原封回來
        store.set({ cursors: { a: 1 }, cooling: { b: 1234 }, zz: { future: true } })
        let onDisk = JSON.parse(fs.readFileSync(store.file, 'utf8'))
        let r = [store.get(), onDisk.at]
        let rr = [{ cursors: { a: 1 }, cooling: { b: 1234 }, zz: { future: true } }, 'T0']
        assert.strict.deepEqual(r, rr)
    })

    it('可直接作dispatchAiFallback之store(get/set契約), 跨store實例讀同一檔', function() {
        let fp = path.join(FD, 'shared.json')
        let s1 = createFileStore({ file: fp })
        s1.set({ cursors: { 'g-a': 2 } })
        let s2 = createFileStore({ file: fp }) //新實例(模擬下一次行程)
        let r = s2.get()
        let rr = { cursors: { 'g-a': 2 } }
        assert.strict.deepEqual(r, rr)
    })

    it('檔案內容非法JSON時get回空物件不throw', function() {
        let fp = path.join(FD, 'broken.json')
        fs.writeFileSync(fp, '{ not valid json', 'utf8')
        let store = createFileStore({ file: fp })
        let r = store.get()
        let rr = {}
        assert.strict.deepEqual(r, rr)
    })

})
