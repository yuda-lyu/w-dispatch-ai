import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { callHookSync } from './callUserFn.mjs'
import { ledgerForget } from './quotaLedger.mjs'


// forgetQuota.mjs — 明示清除額度帳(Gitea #116 建議4)
//
// 【為何需要】額度帳(state.quota)記載「某家族(或某條目)至某時刻額度用盡」, 於重置前直接略過、不派。使用端換了訂閱帳號後,
//   新帳號之額度本是閒置的, 但舊帳號之帳仍在: 套件會於下一次帳號比對或定期重探(見subQuotaGate.mjs; 預設有帳號識別者每30分鐘、
//   無帳號識別而長視窗者每6小時)時自行作廢, 使用端若不想等, 以本函數明示清帳, 下一次派工即改查用量讀者。
//   (套件本身不提供命令列入口, 使用端以一行呼叫本函數即可, 見下方範例。)
//
// 【失敗通道】本函數為「同步且有副作用」之對外入口: 一般參數(state、familyKey)必給且須有效, 無效即同步throw Error、先於任何副作用
//   (輸入參數之檢測機制 K2、§5.1; 與createFileStore於組裝期對缺漏設定throw同一取向——傳錯參數卻靜默回[]會讓使用端以為已清帳)。
//   參數有效但「清不掉」(state凍結、store.get拋錯或回傳非物件、store.set拋錯)不是輸入錯誤: 如實回傳實際清除之鍵(通常為[]), 不throw。


/**
 * 明示清除額度帳：換訂閱帳號後供使用端立即讓該家族之條目重新判定(改查用量讀者)，而不等帳號比對或定期重探
 *
 * 只動額度帳(state.quota)，不動游標(cursors)、冷卻(cooling)與其他欄位。
 * familyKey為家族名('claude'、'codex'、'antigravity')時涵蓋該家族全部帳：讀者家族鍵(含claude之`claude@<雜湊>`設定目錄鍵、antigravity之各`antigravity:<群組>`鍵)
 * 與帶family欄為該家族之entry帳(CLI文字入帳；2026-11-09前入帳之舊entry帳無family欄，不被家族名涵蓋，以`entry:<條目id>`精確鍵或'*'清除)；
 * 為'*'時清全部帳；為其他字串時只清該精確鍵(如`entry:claude:sonnet`、`antigravity:Gemini Models`)。
 * 第一個參數可為state物件，或store(含get、set兩個同步函數；經store.get讀出、清除後有清除才store.set寫回一次，與dispatchAiFallback之store契約相同，如createFileStore之回傳)。
 * 本函數不清行程內之讀者快取(該快取只存用量讀者之回應，不是帳)。
 * state非物件或不可讀、familyKey非有效字串時同步throw Error(先於任何副作用)；參數有效但清不掉(state凍結、store.get拋錯或回傳非物件、store.set拋錯)時不throw，回傳實際清除之鍵(通常為[])
 *
 * @param {Object} state 輸入遞補層狀態物件(含quota欄)或store{get,set}
 * @param {String} familyKey 輸入家族名('claude'、'codex'、'antigravity')、精確帳鍵或'*'(全部)，須為非空字串
 * @returns {Array} 回傳確實被清除之帳鍵陣列(無此帳、清不掉皆回傳[])
 * @example
 *
 * import createFileStore from './src/wkf/createFileStore.mjs'
 * import forgetQuota from './src/forgetQuota.mjs'
 *
 * //換了Claude訂閱帳號後, 清除該家族之額度帳(狀態檔須為dispatchAiFallback使用之同一檔)
 * let store = createFileStore({ dir: './state' })
 * let removed = forgetQuota(store, 'claude')
 * console.log(removed)
 * // => [ 'claude' ]
 *
 */
function forgetQuota(state, familyKey) {

    //一般參數檢測(先於任何副作用)
    if (!isestr(familyKey)) {
        throw new Error('forgetQuota: invalid familyKey: must be a non-empty string')
    }
    let kind = callHookSync(() => ({ obj: isobj(state), store: isobj(state) && isfun(state.get) && isfun(state.set) }))
    if (kind.state !== 'value' || kind.value.obj !== true) {
        throw new Error('forgetQuota: invalid state: must be a state object or a store with get and set')
    }

    //state物件: 直接清(凍結等清不掉者ledgerForget回[]、不throw)
    if (kind.value.store !== true) {
        return ledgerForget(state, familyKey)
    }

    //store: get為同步契約(拋錯、回傳Promise或非物件皆清不掉, 回[]); 有清除才set, set拋錯視為未寫回(回[])
    let g = callHookSync(() => state.get())
    if (g.state !== 'value' || !isobj(g.value)) {
        return []
    }
    let removed = ledgerForget(g.value, familyKey)
    if (removed.length > 0) {
        let s = callHookSync(() => state.set(g.value)) //回傳Promise者其rejection被承接而靜默(同步契約)
        if (s.state === 'threw') {
            return []
        }
    }
    return removed
}


export default forgetQuota
