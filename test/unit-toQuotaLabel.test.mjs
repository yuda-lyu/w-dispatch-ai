import assert from 'assert'
import toQuotaLabel from '../src/quota/toQuotaLabel.mjs'
import toQuotaScopedLabel from '../src/quota/toQuotaScopedLabel.mjs'


describe('toQuotaLabel', function() {

    it('由窗口秒數推導中文標籤: 整除者取最大單位(天>小時>分鐘), 皆不整除則秒', function() {
        let r = [toQuotaLabel(604800), toQuotaLabel(18000), toQuotaLabel(900), toQuotaLabel(90), toQuotaLabel(86400), toQuotaLabel(3600)]
        let rr = ['7天', '5小時', '15分鐘', '90秒', '1天', '1小時']
        assert.strict.deepEqual(r, rr)
    })

    it('無效或非正數回傳空字串(呼叫端據此判斷供應商未提供窗口長度)', function() {
        let r = [toQuotaLabel(null), toQuotaLabel(undefined), toQuotaLabel(0), toQuotaLabel(-5), toQuotaLabel('abc'), toQuotaLabel({})]
        let rr = ['', '', '', '', '', '']
        assert.strict.deepEqual(r, rr)
    })

    it('數值字串亦可推導(供應商可能回字串型秒數)', function() {
        let r = toQuotaLabel('18000')
        let rr = '5小時'
        assert.strict.deepEqual(r, rr)
    })

})


describe('toQuotaScopedLabel', function() {

    it('有範圍時為「基底(範圍)」, 基底取自toQuotaLabel(單一來源, 窗口變動標籤自動正確)', function() {
        let r = [toQuotaScopedLabel(604800, 'Fable'), toQuotaScopedLabel(18000, 'Gemini Models')]
        let rr = ['7天(Fable)', '5小時(Gemini Models)']
        assert.strict.deepEqual(r, rr)
    })

    it('有範圍但窗口秒數無效時僅以範圍為標籤; 無範圍回傳空字串令toQuotaWindow自行推導', function() {
        let r = [toQuotaScopedLabel(null, 'codex-spark'), toQuotaScopedLabel(18000, ''), toQuotaScopedLabel(18000, null)]
        let rr = ['codex-spark', '', '']
        assert.strict.deepEqual(r, rr)
    })

})
