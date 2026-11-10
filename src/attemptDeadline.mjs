import isobj from 'wsemi/src/isobj.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'


// attemptDeadline.mjs — 遞補層期限於轉接器內之執行(重試受期限約束、封頂之標記; 2026-11-11 da402／di402; 帳本 R-COOL-1、R-COOL-4)
//
// 【內部提示鍵attemptHints】dispatchAiFallback有期限(budgetMs)時, 對每次嘗試傳{ deadlineAt, minAttemptMs, entryTimeoutMs }給所有轉接器
//   (CLI四家經runExecCli、REST四家於各自之重試迴圈); 本鍵為本套件內部鍵, 各轉接器不轉傳execCli／HTTP請求。直呼轉接器而未給本鍵者行為與修前相同。
//   deadlineAt   遞補層之整輪期限(時刻毫秒);
//   minAttemptMs 遞補層之單次最低剩餘預算;
//   entryTimeoutMs 條目自己之逾時(未被期限封頂前之值), 供判定「本次逾時是否由期限決定」。
//
// 【期限約束一切重試(R-COOL-4)】有期限時, 每次重試之逾時以期限封頂(剩餘時間), 且「剩餘 − 退避 < minAttemptMs」即不再重試——
//   修前maxRetries之重試不看期限(探測P7: budgetMs 1500、牆鐘3327、3次請求)。
//
// 【封頂之標記(R-COOL-1)】由封頂發生處(轉接器之重試層)標記: 最後一次嘗試以逾時結束(TIMEOUT開頭, 或驗證等待逾時〔validate timed out, 該等待與嘗試共用被封頂之時限〕),
//   且該次之逾時由遞補層期限決定(逾時值 < entryTimeoutMs, 且非呼叫端自給之spawnGate.deadlineAt所致), 且同一嘗試內先前之重試沒有以足額(≥ entryTimeoutMs)逾時者,
//   結果加cutByDeadline: true與appliedTimeoutMs(該次之逾時值)。是否判為budget-cut(不記冷卻等)由遞補層再以「整鏈確已用盡」與「差額≥minAttemptMs」裁定。


let DEFAULT_MIN_ATTEMPT_MS = 20000


/**
 * 讀出遞補層之期限提示(無效回null)
 *
 * @param {Object} opt 輸入轉接器之opt
 * @returns {Object|null} 回傳{ deadlineAt, minAttemptMs, entryTimeoutMs(正整數或null) }或null
 */
function readAttemptHints(opt) {
    try {
        let h = opt?.attemptHints
        if (!isobj(h)) {
            return null
        }
        let d = h.deadlineAt
        if (!(typeof d === 'number' && Number.isFinite(d) && d > 0)) {
            return null
        }
        return {
            deadlineAt: d,
            minAttemptMs: ispint(h.minAttemptMs) ? cint(h.minAttemptMs) : DEFAULT_MIN_ATTEMPT_MS,
            entryTimeoutMs: ispint(h.entryTimeoutMs) ? cint(h.entryTimeoutMs) : null,
        }
    }
    catch {
        return null
    }
}


/**
 * 期限內之剩餘毫秒
 *
 * @param {Object} h 輸入readAttemptHints之結果(非null)
 * @returns {Number} 回傳剩餘毫秒(可為負)
 */
function remainingOf(h) {
    return h.deadlineAt - Date.now()
}


/**
 * 退避後之剩餘是否仍夠一次最低嘗試(無期限恆為true)
 *
 * @param {Object|null} h 輸入期限提示
 * @param {Number} delayMs 輸入重試前之退避毫秒
 * @returns {Boolean} 回傳是否可重試
 */
function retryFits(h, delayMs) {
    if (h === null) {
        return true
    }
    return remainingOf(h) - delayMs >= h.minAttemptMs
}


/**
 * 重試之逾時以期限封頂(無期限原值；至少1ms)
 *
 * @param {Number} tmo 輸入原逾時毫秒
 * @param {Object|null} h 輸入期限提示
 * @returns {Number} 回傳封頂後之逾時毫秒
 */
function capByHints(tmo, h) {
    if (h === null) {
        return tmo
    }
    return Math.max(Math.min(tmo, remainingOf(h)), 1)
}


/**
 * 結果是否為逾時類之失敗(TIMEOUT開頭，或驗證等待逾時)
 *
 * @param {Object} r 輸入結果物件
 * @returns {Boolean} 回傳是否逾時類
 */
function isTimeoutLike(r) {
    if (!isobj(r) || r.ok === true) {
        return false
    }
    let e = typeof r.error === 'string' ? r.error : ''
    if (e.indexOf('TIMEOUT') === 0) {
        return true
    }
    let se = typeof r.stderr === 'string' ? r.stderr : ''
    return e === 'OUTPUT_VALIDATION_FAILED' && se.indexOf('validate timed out') === 0
}


/**
 * 建立封頂標記器：每次嘗試後note，最後mark(符合條件者加cutByDeadline與appliedTimeoutMs)
 *
 * @param {Object|null} h 輸入期限提示
 * @returns {Object} 回傳{ note(tmo, r, callerBound=false), mark(r) }
 */
function createCutTracker(h) {
    let list = []
    let note = (tmo, r, callerBound = false) => {
        list.push({ tmo, timeoutLike: isTimeoutLike(r), callerBound: callerBound === true })
    }
    let mark = (r) => {
        if (h === null || h.entryTimeoutMs === null || list.length === 0 || !isTimeoutLike(r)) {
            return r
        }
        let last = list[list.length - 1]
        let bound = !last.callerBound && last.tmo < h.entryTimeoutMs
        let fullBefore = list.slice(0, -1).some((x) => x.timeoutLike && x.tmo >= h.entryTimeoutMs)
        if (!bound || fullBefore) {
            return r
        }
        return { ...r, cutByDeadline: true, appliedTimeoutMs: last.tmo }
    }
    return { note, mark }
}


export { readAttemptHints, remainingOf, retryFits, capByHints, isTimeoutLike, createCutTracker }
