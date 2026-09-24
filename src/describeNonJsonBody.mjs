import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'


// describeNonJsonBody.mjs — REST轉接器「HTTP 200但本體非JSON」之錯誤訊息(單一來源, 三個REST轉接器與遞補層共用)
//
// 【為何需要(2026-09-24安裝方建議C2)】舊版各REST轉接器之JSON.parse失敗被吞掉, 與「是JSON但缺欄位」回同一句
//   INVALID_RESPONSE(如missing choices[0].message.content), stderr又只有解碼後之前500字——本體若是壓縮位元組
//   只剩亂碼, 安裝方為此直接重打才查出是brotli漏標Content-Encoding。本訊息附原始位元組數、前16位元組之hex
//   (gzip以1f8b開頭等特徵可一眼辨認)、content-encoding與content-type, 令此類故障不必重打即可定位。
//
// 【分流】本體非JSON屬傳輸或閘道狀態, 同一請求換金鑰必然再敗一次, 遞補層以BODY_NOT_JSON前綴判為與金鑰無關
//   而整組跳過(安裝方實例: 換第二把金鑰只是以剩餘預算重打至逾時); 「JSON缺欄位」則維持換金鑰——
//   部分閘道以200回帳號層級之錯誤JSON, 換金鑰可能有效。errorType一律仍為invalid-response(字彙不增)。


//錯誤訊息前綴, dispatchAiFallback據此判定整組跳過
let BODY_NOT_JSON = 'INVALID_RESPONSE: body is not JSON'


/**
 * 組出「HTTP 200但本體非JSON」之錯誤訊息
 *
 * @param {Uint8Array} bytes 輸入回應本體之原始位元組(未解碼)
 * @param {Headers|Object} headers 輸入回應標頭(fetch之Headers，或具get方法之物件)
 * @returns {String} 回傳錯誤訊息字串，以BODY_NOT_JSON開頭，附位元組數、前16位元組hex、content-encoding與content-type
 * @example
 *
 * import describeNonJsonBody from './src/describeNonJsonBody.mjs'
 *
 * let h = new Headers({ 'content-type': 'application/json' })
 * console.log(describeNonJsonBody(new Uint8Array([0x8b, 0xef, 0x02]), h))
 * // => 'INVALID_RESPONSE: body is not JSON (3 bytes, first bytes 8bef02, content-encoding=none, content-type=application/json)'
 *
 */
function describeNonJsonBody(bytes, headers) {
    let u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(0)
    let hex = Array.from(u8.subarray(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('')
    let getH = (k) => {
        let fn = get(headers, 'get', null)
        let v = (typeof fn === 'function') ? headers.get(k) : null
        return isestr(v) ? v : 'none'
    }
    let more = u8.length > 16 ? '...' : ''
    return `${BODY_NOT_JSON} (${u8.length} bytes, first bytes ${hex || '(none)'}${more}, content-encoding=${getH('content-encoding')}, content-type=${getH('content-type')})`
}


export default describeNonJsonBody
export { BODY_NOT_JSON }
