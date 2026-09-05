import get from 'lodash-es/get.js'
import isnum from 'wsemi/src/isnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import toQuotaLabel from './toQuotaLabel.mjs'


// toQuotaWindow.mjs — 將各家額度窗口正規化為統一結構
//
// 【為何要正規化】三家回傳形狀互異：Claude給utilization(已用百分比)與ISO字串resets_at，
//   Codex給usedPercent與unix秒數resetsAt外加windowDurationMins，
//   Antigravity給remaining_fraction(剩餘比例)與ISO字串reset_time；
//   呼叫端若直接吃原始形狀，每加一家就要改一次判斷。統一於此後，
//   呼叫端只認一組欄位，各家差異收斂在各自的轉接器內。
//
// 【為何同時給resetAt與resetAfterSeconds】前者適合顯示絕對時間，後者適合倒數與排程判斷；
//   兩者能互推，故任一有值即補算另一，令呼叫端不必自行換算。
//
// 【label由誰決定】未給label時由windowSeconds經toQuotaLabel推導；轉接器需要帶範圍之標籤
//   (如「7天(Fable)」)時, 亦應以toQuotaLabel取基底再拼接, 不得手寫「7天」字串。
//
// 【key是供應商原生識別, 刻意不統一; 跨家比較用windowSeconds+scope】統一的是信封(上列欄位),
//   key則原樣透傳各家自己的窗口識別——Claude為limits[].kind(session/weekly_all/weekly_scoped;
//   回退舊欄位時為five_hour/seven_day_opus等欄位名)、Codex為rateLimits之primary/secondary物件名、
//   agy為buckets[].id(gemini-5h/gemini-weekly/3p-5h/3p-weekly); 僅巢狀限額需組唯一鍵時
//   由轉接器以「<識別>:primary|secondary」複合(如code_review:primary)。保留原生值可回溯raw,
//   也不必為求一致把agy之4桶2群組硬壓成2個。故呼叫端要「跨家找5小時窗口」請以
//   windowSeconds===18000(7天為604800)配scope判斷, 不得比對key字串。


/**
 * 將各家額度窗口正規化為統一結構
 *
 * resetAt可給ISO字串或unix秒數(整數)，一律轉為ISO字串；
 * resetAt與resetAfterSeconds任一有值即自動補算另一；
 * usedPercent夾至0~100，remainingPercent由其推得，未知時兩者皆為null(不假造100)；
 * label未給時由windowSeconds推導，故供應商調整窗口長度時標籤自動跟著正確
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.key=''] 輸入窗口之機器可讀鍵字串，為供應商原生識別原樣透傳(Claude之limits[].kind如'session'、Codex之'primary'/'secondary'、agy之buckets[].id如'gemini-5h')，各家不同且刻意不統一；跨家比較請用windowSeconds配scope而非key，預設''
 * @param {String} [opt.label=''] 輸入窗口之人類可讀標籤字串，預設''代表由windowSeconds推導
 * @param {Number} [opt.windowSeconds=null] 輸入窗口長度秒數，預設null代表供應商未提供
 * @param {Number} [opt.usedPercent=null] 輸入已用百分比數值(0~100)，預設null代表未知
 * @param {String|Number} [opt.resetAt=''] 輸入窗口重置時刻，可為ISO字串或unix秒數整數，預設''
 * @param {Number} [opt.resetAfterSeconds=null] 輸入距重置之剩餘秒數，預設null代表由resetAt推算
 * @param {String} [opt.scope=''] 輸入窗口適用範圍字串，例如模型名稱或群組名稱，預設''代表全域
 * @param {Boolean} [opt.active=false] 輸入是否為當前生效(最先觸頂)窗口布林值，預設false
 * @param {String} [opt.severity=''] 輸入嚴重度字串，例如'normal'、'warning'、'exhausted'，預設''代表由usedPercent推導(用罄為'exhausted'、其餘'normal'、usedPercent未知則'')
 * @returns {Object} 回傳窗口物件，內含key(供應商原生識別，各家不同)、label、windowSeconds(跨家比較之正規化維度：18000＝5小時、604800＝7天)、usedPercent、remainingPercent、resetAt(ISO字串)、resetAfterSeconds、scope、active、severity
 * @example
 *
 * import toQuotaWindow from './src/quota/toQuotaWindow.mjs'
 *
 * let w = toQuotaWindow({ key: 'five_hour', windowSeconds: 18000, usedPercent: 11 })
 * console.log(w.label, w.remainingPercent)
 * // => 5小時 89
 *
 */
function toQuotaWindow(opt = {}) {

    //key
    let key = get(opt, 'key', '')
    if (!isestr(key)) {
        key = ''
    }

    //windowSeconds, 無效視為供應商未提供
    let windowSeconds = get(opt, 'windowSeconds', null)
    if (!isnum(windowSeconds)) {
        windowSeconds = null
    }
    else {
        windowSeconds = cdbl(windowSeconds)
    }

    //label, 未給時由windowSeconds推導
    let label = get(opt, 'label', '')
    if (!isestr(label)) {
        label = toQuotaLabel(windowSeconds)
    }

    //usedPercent, 無效視為未知; 有效則夾至0~100避免供應商回傳越界值污染剩餘量
    let usedPercent = get(opt, 'usedPercent', null)
    if (!isnum(usedPercent)) {
        usedPercent = null
    }
    else {
        usedPercent = Math.min(100, Math.max(0, cdbl(usedPercent)))
    }

    //remainingPercent, 由usedPercent推得, 未知時同為未知
    let remainingPercent = null
    if (usedPercent !== null) {
        remainingPercent = Math.round((100 - usedPercent) * 100) / 100
    }

    //resetAt, 接受ISO字串或unix秒數, 一律轉ISO字串
    let resetAt = get(opt, 'resetAt', '')
    if (isnum(resetAt) && cdbl(resetAt) > 0) {
        resetAt = new Date(cdbl(resetAt) * 1000).toISOString()
    }
    else if (isestr(resetAt)) {
        let d = new Date(resetAt)
        resetAt = isNaN(d.getTime()) ? '' : d.toISOString()
    }
    else {
        resetAt = ''
    }

    //resetAfterSeconds, 無效時由resetAt推算, 令呼叫端不論供應商給哪一種都拿得到倒數
    let resetAfterSeconds = get(opt, 'resetAfterSeconds', null)
    if (!isnum(resetAfterSeconds)) {
        resetAfterSeconds = null
        if (resetAt !== '') {
            let dt = Math.round((new Date(resetAt).getTime() - Date.now()) / 1000)
            resetAfterSeconds = Math.max(0, dt)
        }
    }
    else {
        resetAfterSeconds = Math.max(0, Math.round(cdbl(resetAfterSeconds)))
    }

    //resetAt, 供應商只給倒數秒數時反推絕對時刻
    if (resetAt === '' && resetAfterSeconds !== null) {
        resetAt = new Date(Date.now() + resetAfterSeconds * 1000).toISOString()
    }

    //scope, 例如僅適用某模型或某群組之窗口
    let scope = get(opt, 'scope', '')
    if (!isestr(scope)) {
        scope = ''
    }

    //active
    let active = get(opt, 'active', null)
    if (!isbol(active)) {
        active = false
    }

    //severity, 供應商有給(如Claude之limits[].severity)即用之; 未給則由usedPercent推導——
    //用罄為'exhausted'、其餘'normal'、usedPercent未知則''。三家對稱: 曾因codex路徑未給而為空字串,
    //與claude/agy之'normal'不對稱, 呼叫端得分家判斷; 收斂於此後任一家未給皆有一致預設
    let severity = get(opt, 'severity', '')
    if (!isestr(severity)) {
        severity = ''
        if (usedPercent !== null) {
            severity = usedPercent >= 100 ? 'exhausted' : 'normal'
        }
    }

    return {
        key,
        label,
        windowSeconds,
        usedPercent,
        remainingPercent,
        resetAt,
        resetAfterSeconds,
        scope,
        active,
        severity,
    }
}


export default toQuotaWindow
