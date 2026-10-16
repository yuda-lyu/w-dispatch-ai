// userFnFormsForTest.mjs — 呼叫端注入函數之回傳形態清單(單一來源), 供validate、check、parse、prompt、控制類回調之測試共用
//
// 規格(帳本R-USERFN-1、R-USERFN-2): 內容類回調(validate/check/parse/prompt)支援非同步並以timeoutMs為等待上限,
//   同步拋錯、reject與逾時視同失敗; 控制類回調(shouldStop/coolDetect/onEvent/store)為同步契約, 回傳Promise視同失敗且不使行程崩潰。
//   形態依「同步/非同步 × 真/假/拋錯/永不落定/逾時」與惡意拋出值(null、已撤銷Proxy、20萬字訊息)列舉, 不依需求文字。


//revoked, 已撤銷之Proxy(讀取任何屬性皆拋TypeError)
function revoked() {
    let p = Proxy.revocable({}, {})
    p.revoke()
    return p.proxy
}


/**
 * 產生回傳形態清單
 *
 * @param {*} T 輸入該站點「通過」之值(validate/check為true、parse為物件、prompt為字串等)
 * @param {*} F 輸入該站點「不通過」之值(validate/check為false、parse為null、prompt為''等)
 * @param {Number} slowMs 輸入慢速形態之resolve延遲毫秒(須大於受測之timeoutMs)
 * @returns {Array} 回傳形態陣列，各元素為{ label, kind, fn }，kind為'pass'、'fail'、'threw'、'timeout'之一
 */
function userFnForms(T, F, slowMs) {
    return [
        { label: 'sync-true', kind: 'pass', fn: () => T },
        { label: 'sync-false', kind: 'fail', fn: () => F },
        {
            label: 'sync-throw',
            kind: 'threw',
            fn: () => {
                throw new Error('boom-sync')
            }
        },
        {
            label: 'throw-null',
            kind: 'threw',
            fn: () => {
                throw null // eslint-disable-line no-throw-literal
            }
        },
        {
            label: 'throw-revoked',
            kind: 'threw',
            fn: () => {
                throw revoked()
            }
        },
        { label: 'async-true', kind: 'pass', fn: async () => T },
        { label: 'async-false', kind: 'fail', fn: async () => F },
        {
            label: 'async-reject',
            kind: 'threw',
            fn: async () => {
                throw new Error('boom-async')
            }
        },
        {
            label: 'reject-revoked',
            kind: 'threw',
            fn: async () => {
                throw revoked()
            }
        },
        {
            label: 'thenable-throws',
            kind: 'threw',
            fn: () => ({
                then() {
                    throw new Error('boom-then')
                },
            })
        },
        { label: 'never', kind: 'timeout', fn: () => new Promise(() => {}) },
        { label: 'slow-true', kind: 'timeout', fn: () => new Promise((resolve) => setTimeout(() => resolve(T), slowMs)) },
    ]
}


/**
 * 監看本行程之未處理rejection(測試期間), 回傳停止監看並取回紀錄之函數
 *
 * 監看期間暫時移除既有之unhandledRejection監聽(含mocha者), 停止時原樣復原。
 * 為何: 修前(紅燈)之未處理rejection若交mocha處理, mocha先以之判該測試失敗, 測試本身之斷言隨後再判一次而成
 * 「done() called multiple times」, 於--parallel且多檔時令worker崩潰、主行程不印摘要而以離開碼0結束(2026-10-14實測,
 * mocha 11.8.0), 紅燈被誤讀為綠燈; 改由本函數收集並交斷言比對, 紅燈即以一般斷言失敗回報。呼叫端須於finally內呼叫stop。
 *
 * @returns {Function} 回傳stop函數(async)，呼叫後復原監聽並回傳紀錄字串陣列
 */
function watchUnhandled() {
    let seen = []
    let saved = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    let onRej = (e) => {
        let s = ''
        try {
            s = String((e && e.message) || e)
        }
        catch {
            s = '[unprintable]'
        }
        seen.push(`unhandledRejection: ${s}`)
    }
    process.on('unhandledRejection', onRej)
    return async () => {
        await new Promise((resolve) => setTimeout(resolve, 50)) //令已排入之rejection事件觸發
        process.off('unhandledRejection', onRej)
        for (let h of saved) {
            process.on('unhandledRejection', h)
        }
        return seen
    }
}


/**
 * 執行fn並收集其期間之未處理rejection(以finally復原監聽, fn拋錯時照常外拋)
 *
 * @param {Function} fn 輸入async函數
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含value(fn之回傳值)與seen(未處理rejection紀錄字串陣列)
 */
async function captureUnhandled(fn) {
    let stop = watchUnhandled()
    let value = null
    let seen = []
    try {
        value = await fn()
    }
    finally {
        seen = await stop()
    }
    return { value, seen }
}


export default userFnForms
export { revoked, watchUnhandled, captureUnhandled }
