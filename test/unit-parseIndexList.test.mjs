import assert from 'assert'
import parseIndexList from '../src/wkf/parseIndexList.mjs'


// unit-parseIndexList.test.mjs — 編號清單解析(2026-11-01 da40, Gitea #40; 帳本R-PARSE-1)
//
// 規格來源: 建議檔§4: parseIndexList(text, { max=Infinity, min=1, topN=Infinity }):
//   取「數字個數最多的那一串」(逗號／頓號分隔)為答案(模型偶把推理混進輸出: 實測`5,6,15,16,28 Wait, let me reconsider…`;
//   提示詞含數量上限時模型複述極易帶出該數字), 同長度取最先; 單一個0約定為空集合→{ isZero:true, indices:[] };
//   其餘依min／max過濾、topN截取。


describe('parseIndexList', function() {

    // 規格句: 實測案例, 取數字個數最多的那一串
    it('推理文字混入輸出: 取數字個數最多之串（實測 5,6,15,16,28 Wait, let me reconsider…）', function() {
        assert.strict.deepEqual(parseIndexList('5,6,15,16,28 Wait, let me reconsider…'), { isZero: false, indices: [5, 6, 15, 16, 28] })
        assert.strict.deepEqual(parseIndexList('Let me think about 12 and 7.\nFinal: 3,9,14'), { isZero: false, indices: [3, 9, 14] })
    })

    // 規格句: 提示詞含數量上限時複述數字, 取最長串而非最先出現之數字
    it('提示詞數量上限之複述（最多選5則）不當答案：最長串勝出', function() {
        assert.strict.deepEqual(parseIndexList('最多選 5 則，我選: 3、7、9'), { isZero: false, indices: [3, 7, 9] })
    })

    // 規格句: 逗號／頓號分隔
    it('分隔符: 半形逗號、全形逗號、頓號，兩側容許空白', function() {
        assert.strict.deepEqual(parseIndexList('1,2,3').indices, [1, 2, 3])
        assert.strict.deepEqual(parseIndexList('1，2，3').indices, [1, 2, 3])
        assert.strict.deepEqual(parseIndexList('1、2、3').indices, [1, 2, 3])
        assert.strict.deepEqual(parseIndexList('4, 5 ,6 、 7').indices, [4, 5, 6, 7])
        assert.strict.deepEqual(parseIndexList('1 2 3').indices, [1]) //空白不是分隔符: 三個單一數字, 取最先
        assert.strict.deepEqual(parseIndexList('1,\n2').indices, [1]) //換行不是分隔符
    })

    // 規格句: 同長度取最先
    it('同長度取最先出現者', function() {
        assert.strict.deepEqual(parseIndexList('8,9 然後 1,2').indices, [8, 9])
        assert.strict.deepEqual(parseIndexList('7 然後 3').indices, [7])
    })

    // 規格句: 單一個0約定為空集合
    it('單一個0 → isZero為true、indices為空', function() {
        for (let t of ['0', ' 0 ', '0。', '沒有入選: 0', '00']) {
            assert.strict.deepEqual(parseIndexList(t), { isZero: true, indices: [] })
        }
    })

    it('0混在較長串或兩個以上之0 → 不是空集合約定（依min過濾）', function() {
        assert.strict.deepEqual(parseIndexList('0,3,5'), { isZero: false, indices: [3, 5] })
        assert.strict.deepEqual(parseIndexList('0,0'), { isZero: false, indices: [] })
        assert.strict.deepEqual(parseIndexList('0,3', { min: 0 }), { isZero: false, indices: [0, 3] })
    })

    it('單一個0與另一單一數字同長度: 取最先（先0者為空集合、先數字者取該數字）', function() {
        assert.strict.deepEqual(parseIndexList('0 或者 7'), { isZero: true, indices: [] })
        assert.strict.deepEqual(parseIndexList('7 或者 0'), { isZero: false, indices: [7] })
    })

    // 規格句: 依min／max過濾
    it('min／max過濾（含端點）；保持原順序、不去重不排序', function() {
        assert.strict.deepEqual(parseIndexList('1,5,10,20,5', { max: 10 }).indices, [1, 5, 10, 5])
        assert.strict.deepEqual(parseIndexList('1,5,10,20', { min: 5 }).indices, [5, 10, 20])
        assert.strict.deepEqual(parseIndexList('9,3,6', { min: 3, max: 6 }).indices, [3, 6])
        assert.strict.deepEqual(parseIndexList('30,2,1').indices, [30, 2, 1])
    })

    // 規格句: topN截取
    it('topN截取前N個（過濾之後）', function() {
        assert.strict.deepEqual(parseIndexList('1,2,3,4,5', { topN: 2 }).indices, [1, 2])
        assert.strict.deepEqual(parseIndexList('50,1,2,3', { max: 10, topN: 2 }).indices, [1, 2])
        assert.strict.deepEqual(parseIndexList('1,2', { topN: 5 }).indices, [1, 2])
    })

    it('找不到數字: isZero為false、indices為空（呼叫端可據以判定未回答）', function() {
        for (let t of ['', '無', 'none', '  ']) {
            assert.strict.deepEqual(parseIndexList(t), { isZero: false, indices: [] })
        }
    })

    // 規格句（K3）: opt各鍵無效視為未給; 輸入非字串視為空
    it('opt非物件或各鍵無效改用預設不throw；數字字串之鍵值轉為數字使用', function() {
        let base = { isZero: false, indices: [1, 2, 3] }
        for (let o of [undefined, null, 'x', 5, [], { min: 'a', max: null, topN: -1 }, { topN: 0 }, { min: 1.5 }, { max: true }]) {
            assert.strict.deepEqual(parseIndexList('1,2,3', o), base)
        }
        assert.strict.deepEqual(parseIndexList('1,2,3', { max: '2' }).indices, [1, 2])
        assert.strict.deepEqual(parseIndexList('1,2,3', { topN: '1' }).indices, [1])
        for (let t of [null, undefined, 123, {}, []]) {
            assert.strict.deepEqual(parseIndexList(t), { isZero: false, indices: [] })
        }
    })

    it('超出安全整數範圍之數字略過', function() {
        assert.strict.deepEqual(parseIndexList('1,99999999999999999999,3').indices, [1, 3])
        assert.strict.deepEqual(parseIndexList('99999999999999999999'), { isZero: false, indices: [] })
    })

})
