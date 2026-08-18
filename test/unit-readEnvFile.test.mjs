import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import readEnvFile from '../src/readEnvFile.mjs'


//產物落test/tmp/(同fakeCliForTest慣例), 測試結束清除
let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp', 'read-env-file')


describe('readEnvFile', function() {

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

    it('解析KEY=value, 剝除成對引號, 忽略空行註解與無效行, 且不寫入process.env', function() {
        let fp = path.join(FD, 'a.env')
        fs.writeFileSync(fp, [
            '# comment',
            'AGNES_KEYS=sk-a,sk-b',
            'QUOTED_D="sk-dq"',
            'QUOTED_S=\'sk-sq\'',
            'SPACED =  sk-sp  ',
            'not a valid line',
            '',
            'EMPTY_VAL=',
        ].join('\n'), 'utf8')
        let r = [readEnvFile(fp), process.env.AGNES_KEYS === undefined || process.env.AGNES_KEYS !== 'sk-a,sk-b']
        let rr = [
            { AGNES_KEYS: 'sk-a,sk-b', QUOTED_D: 'sk-dq', QUOTED_S: 'sk-sq', SPACED: 'sk-sp', EMPTY_VAL: '' },
            true,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('檔案不存在回空物件不throw(金鑰缺失交由skipped機制回報)', function() {
        let r = readEnvFile(path.join(FD, 'no-such.env'))
        let rr = {}
        assert.strict.deepEqual(r, rr)
    })

})
