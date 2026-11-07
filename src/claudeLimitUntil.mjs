import isestr from 'wsemi/src/isestr.mjs'


// claudeLimitUntil.mjs — 由Claude Code官方額度訊息解析重置時刻(內部模組; Gitea #93; 帳本R-SPAWNGATE-6)
//
// 【只認實見字樣, 不猜】Claude Code訂閱撞額度時回: `You've hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)`
//   (使用端2026-11-06日誌實見; 分隔符為U+00B7, 日期為`月縮寫 日`, 時間為`h(am|pm)`或`h:mm(am|pm)`, 括號內為IANA時區名)。
//   本檔只解析這一形式(含`hit your <任意詞> limit`之詞變化); 無時區、無resets、無日期、無法解析之時區名一律回null(不入帳、回到逐次查詢)。
//   codex／antigravity之額度字樣本套件未見過, 不內建(由呼叫端經opt.quotaUntilOf注入, 見dispatchAiFallback.mjs)。
//   此為與failureKind.mjs「對claude官方字樣之例外」同理之唯一內建字樣: 官方字串、版本間穩定度未知, 解析不到時只是少一次入帳。
//
// 【時間推算】括號內時區以Intl推算偏移(含夏令時間, 二次迭代並回驗牆上時間; 不存在或有歧義之本地時刻回null)。
//   年份未載: 在{本年前一年, 本年, 次年}中取「不早於現在(減約兩天寬限)」之最近年份, 以跨年(12月底讀到1月初)正確; 年份只憑日期粗算選定, 不因該年該時刻不存在(夏令間隙)而改推次年;
//   若所載時刻精確換算後落在現在之前(剛過去約兩天內的過時文字或時鐘誤差)或不存在, 回null(不往次年推, 免把已過期的訊息變成封鎖約一年再被截斷為8天的帳)。
// 【上限】回傳值最晚為現在加capMs(預設8天; 週額度重置最遠7天), 逾者截斷。


//月縮寫(取前3碼小寫)對照月份(1起)
let MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

//實見字樣: hit your <詞> limit · resets <Mon D>, <h[:mm]am|pm> (<IANA tz>)
let LIMIT_RE = /hit your [^·∙\n]*?limit[^·∙\n]*[·∙]\s*resets\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)\s*\(([^)\n]+)\)/i

//預設上限與過時容忍(粗算選年時對「牆上時間當UTC」之寬限: 36小時加時區最大偏移14小時, 約兩天)
let DEFAULT_CAP_MS = 8 * 86400000
let STALE_MS = 50 * 3600000


/**
 * 取某絕對時刻在某時區之牆上時間與UTC之差(毫秒; 牆上時間當UTC算減去實際時刻)
 *
 * @param {Number} utcMs 輸入絕對時刻毫秒
 * @param {String} tz 輸入IANA時區名(無效時Intl拋RangeError)
 * @returns {Object} 回傳物件{ offset, wall }，offset為偏移毫秒，wall為牆上時間欄位{ y, mo, d, h, mi }
 */
function zoneWall(utcMs, tz) {
    let dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    let p = {}
    for (let x of dtf.formatToParts(new Date(utcMs))) {
        p[x.type] = x.value
    }
    let y = Number(p.year)
    let mo = Number(p.month)
    let d = Number(p.day)
    let h = Number(p.hour) % 24
    let mi = Number(p.minute)
    let s = Number(p.second)
    let asUtc = Date.UTC(y, mo - 1, d, h, mi, s)
    return { offset: asUtc - Math.floor(utcMs / 1000) * 1000, wall: { y, mo, d, h, mi } }
}


/**
 * 某時區之牆上時間轉絕對時刻(不存在或有歧義之本地時刻回NaN)
 *
 * @param {Number} y 輸入年
 * @param {Number} mo 輸入月(1起)
 * @param {Number} d 輸入日
 * @param {Number} h 輸入時(0~23)
 * @param {Number} mi 輸入分
 * @param {String} tz 輸入IANA時區名
 * @returns {Number} 回傳絕對時刻毫秒，無法換算回傳NaN
 */
function wallToUtc(y, mo, d, h, mi, tz) {
    let guess = Date.UTC(y, mo - 1, d, h, mi, 0)
    let probe = new Date(guess)
    if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
        return NaN //如2月30日
    }
    let t1 = guess - zoneWall(guess, tz).offset
    let t2 = guess - zoneWall(t1, tz).offset
    let w = zoneWall(t2, tz).wall
    if (w.y !== y || w.mo !== mo || w.d !== d || w.h !== h || w.mi !== mi) {
        return NaN //夏令時間間隙等: 該牆上時間不存在
    }
    return t2
}


/**
 * 由Claude Code官方額度訊息文字解析重置時刻
 *
 * @param {String} text 輸入文字(失敗結果之error／stderr／stdout串接)
 * @param {Number|Date} [now=Date.now()] 輸入「現在」(毫秒或Date)，供年份推定與上限截斷
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Number} [opt.capMs=691200000] 輸入上限毫秒(8天)，逾者截斷為現在加上限
 * @returns {String|null} 回傳重置時刻ISO字串；不符實見字樣、時區無效、時刻不存在、落在剛過去36小時內時回傳null
 * @example
 *
 * import claudeLimitUntilOf from './src/claudeLimitUntil.mjs'
 *
 * console.log(claudeLimitUntilOf('You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)', Date.UTC(2026, 10, 6, 4, 0, 0)))
 * // => 2026-11-09T09:00:00.000Z
 *
 */
function claudeLimitUntilOf(text, now = Date.now(), opt = {}) {
    if (!isestr(text)) {
        return null
    }
    let nowMs = now instanceof Date ? now.getTime() : Number(now)
    if (!Number.isFinite(nowMs)) {
        return null
    }
    let capMs = Number.isFinite(opt?.capMs) && opt.capMs > 0 ? opt.capMs : DEFAULT_CAP_MS

    let m = LIMIT_RE.exec(text)
    if (!m) {
        return null
    }
    let mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    let d = Number(m[2])
    let h12 = Number(m[3])
    let mi = m[4] === undefined ? 0 : Number(m[4])
    if (mo === undefined || h12 < 1 || h12 > 12 || mi > 59) {
        return null
    }
    let h = (h12 % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0)
    let tz = m[6].trim()

    try {
        //年份: 先以「牆上時間當UTC」粗算選年(不依賴時區換算是否成功, 免因夏令間隙等使該年失效而被推到次年), 取不早於「現在減容忍」之最近年份, 再精確換算
        let y0 = new Date(nowMs).getUTCFullYear()
        let y = [y0 - 1, y0, y0 + 1].find((yy) => Date.UTC(yy, mo - 1, d, h, mi) >= nowMs - STALE_MS)
        if (y === undefined) {
            return null
        }
        let t = wallToUtc(y, mo, d, h, mi, tz)
        if (!Number.isFinite(t) || t < nowMs) {
            return null //時刻不存在, 或落在剛過去(過時文字／時鐘誤差): 不猜
        }
        return new Date(Math.min(t, nowMs + capMs)).toISOString()
    }
    catch {
        return null //時區名無效(Intl拋RangeError)等
    }
}


export default claudeLimitUntilOf
export { LIMIT_RE, DEFAULT_CAP_MS }
