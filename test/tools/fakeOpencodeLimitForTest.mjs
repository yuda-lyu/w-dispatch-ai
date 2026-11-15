// fakeOpencodeLimitForTest.mjs — 測試用假opencode: 模擬「免費池用盡／免費層429之錯誤列印出後run不結束」(wda156, Gitea #156)
//
// 與真實opencode對齊之處(依據見src/opencodeLimit.mjs檔頭之本機實查):
//   ①日誌列只在命令列帶`--print-logs`時才印到stderr(真實opencode不帶時寫入日誌檔、stderr只有session標頭)——故修前之轉接器(不補旗標)看不到錯誤列, 只能等逾時;
//   ②錯誤列為key=value格式(level=ERROR … providerID=… modelID=… small=… agent=… error.error="…");
//   ③啟動一個繼承stdio之孫行程(對應npm包裝之node → opencode.exe), 令「只終止根行程」時管線不關閉而撐到逾時——驗證樹狀終止。
// 情境由`--fake-limit=<名>`選擇; `--fake-gate=<路徑>`為閘門檔(測試於收到前一段stderr後建立, 假CLI每20ms查一次), 用以確定性地切開區塊或排定先後:
//   quota       主要請求之免費池用盡列(先印一條title附帶請求之同字樣列), 其後不結束
//   rate        主要請求之免費層429列, 其後不結束
//   quota-exit  印免費池用盡列後子行程自行以1結束(對應日後opencode改為自行結束之情形)
//   quota-exit0 印免費池用盡列後子行程立即自行以0結束(無回覆; 先於終止)
//   quota-locked 先印`database is locked`字樣再印免費池用盡列, 其後不結束(暫時性重試不得觸發)
//   split       免費池用盡列切成兩段: 前段印出後等閘門, 再印後段與換行, 其後不結束
//   title       只印title附帶請求之免費池用盡列; 等閘門後於stdout印「完成」並以0結束(未帶--print-logs時不等閘門)
//   go          印providerID為opencode-go之429與免費池用盡字樣列; 等閘門後印`Error: go failed`並以1結束(未帶--print-logs時不等閘門)
//   go-limit    訂閱到頂(wda158, Gitea #158): 先印title附帶請求之`OpenCode Go usage limit reached`列, 再印主要請求之同字樣列(providerID=opencode-go; 字樣取自使用端真實CLI實測, 工作區代號為假值), 其後不結束
//   go-limit-keyed 訂閱到頂依金鑰而異: 注入之OPENCODE_AUTH_CONTENT含`--fake-limited-key=<子字串>`者同go-limit(不結束), 否則於stdout印「完成」並以0結束(多把金鑰換鑰之測試用);
//               注入之金鑰含`--fake-bad-key=<子字串>`者則印`Error: boom`並以1結束(一般失敗, 無錯誤列);
//               `--fake-go-text=<名>`可改字樣: weekly(預設)、monthly(`(monthly, resets in 17d 6h)`)、bare(無括號)
//   go-limit-orphan 終止失敗之情形: 注入之金鑰含`--fake-limited-key=<子字串>`者, 根行程於100毫秒後自行結束, 由detached之孫行程於600毫秒後才印出到頂列(繼承stdio, 存活15秒)——
//               到頂列判中時根行程之pid已不存在, 轉接器之樹狀終止無從生效而等到execCli之逾時(error以TIMEOUT開頭、errorType仍為quota); 其餘金鑰於stdout印「完成」並以0結束
//   other       印主要請求之一般上游錯誤列([overloaded])後印`Error: boom`並以1結束
//   locked      立即印`database is locked`並以1結束(暫時性錯誤; 無錯誤列)
//   locked2-then-boom 第1次以離開碼2含`database is locked`、第2次起以1(一般錯誤)結束(次數記於`--fake-count=<檔>`)
//   loglocked   日誌列(title)含`database is locked`, 主要失敗為一般錯誤以1結束
//   quota-then-other 同一區塊印免費池用盡列後緊接另一主要請求ERROR列([overloaded]), 其後不結束
//   quota-exit0-out 印免費池用盡列後立即以0結束且stdout有「完成」
//   other-then-quota 第1次嘗試一般失敗、第2次起免費池用盡不結束(次數記於`--fake-count=<檔>`)
//   ok          於stdout印「完成」並以0結束
// stdout第一行恆為`FAKE_GC=<孫行程pid>`(供測試確認孫行程已不在)。


let CODE_ENTRY_LIMIT = `
import fs from 'fs'
import { spawn } from 'child_process'

let args = process.argv.slice(2)
let pick = (re) => {
    let m = args.map((a) => re.exec(a)).find((x) => !!x)
    return m ? m[1] : ''
}
let scenario = pick(/^--fake-limit=(.*)$/)
let gate = pick(/^--fake-gate=(.*)$/)
let printLogs = args.includes('--print-logs')

//孫行程: 繼承stdio(同npm包裝之node → opencode.exe), 只終止根行程時管線不關閉; 存活上限60秒(測試遠短於此; 防變異「只殺根行程」等情形遺留孤兒)。
//detached: Windows之libuv把非detached子行程放進「父行程結束即殺」之job物件, 只殺根行程時孫行程亦隨之結束(wda156變異M12實測: 無/T亦全綠)——
//以detached令孫行程不在該job內(對應opencode.exe自行另起之子行程), 才分辨得出「樹狀終止(/T)」與「只殺根行程」
let gc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit', windowsHide: true, detached: true })
process.stdout.write('FAKE_GC=' + gc.pid + '\\n')

let finish = (code, out, err) => {
    try {
        gc.kill()
    }
    catch {}
    if (out) {
        process.stdout.write(out)
    }
    if (err) {
        process.stderr.write(err)
    }
    gc.on('exit', () => process.exit(code))
    setTimeout(() => process.exit(code), 3000).unref()
}
//不結束(模擬run收到錯誤後不退出); 存活上限120秒(遠大於測試之逾時, 防遺留)
let hang = () => {
    setTimeout(() => process.exit(0), 120000)
}
let waitGate = (cb) => {
    if (!gate) {
        cb()
        return
    }
    let t = setInterval(() => {
        if (fs.existsSync(gate)) {
            clearInterval(t)
            cb()
        }
    }, 20)
}

let ts = () => new Date().toISOString()
let line = (o) => 'timestamp=' + ts() + ' level=ERROR run=abc123 message="stream error" providerID=' + o.p + ' modelID=' + o.m + ' session.id=ses_fake small=' + o.small + ' agent=' + o.agent + ' mode=primary error.error="' + o.e + '"\\n'
let QUOTA = 'AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go'
let QUOTA_TITLE = 'AI_RetryError: Failed after 3 attempts. Last error: Free usage limit reached. Subscribe to OpenCode Go to keep going: https://opencode.ai/go'
let RATE = 'AI_APICallError: Rate limit exceeded. Please try again later.'
//訂閱(opencode-go)到頂之實際字樣(2026-11-16使用端實測; 工作區代號為假值)
let GO_WS = 'wrk_FAKE0WORKSPACE0ID0000000001'
let goText = pick(/^--fake-go-text=(.*)$/) || 'weekly'
let GO_HEADS = { weekly: ' (weekly, resets in 5h 3m)', monthly: ' (monthly, resets in 17d 6h)', bare: '' }
let GO_HEAD = Object.prototype.hasOwnProperty.call(GO_HEADS, goText) ? GO_HEADS[goText] : GO_HEADS.weekly
let GO_LIMIT = 'AI_APICallError: OpenCode Go usage limit reached' + GO_HEAD + '. To keep going now, turn on Extra Usage or upgrade to Go Plus at https://opencode.ai/console/' + GO_WS + '/go.'
let GO_LIMIT_TITLE = 'AI_RetryError: Failed after 3 attempts. Last error: OpenCode Go usage limit reached' + GO_HEAD + '. To keep going now, turn on Extra Usage or upgrade to Go Plus at https://opencode.ai/console/' + GO_WS + '/go.'
let goLimitLines = () => {
    process.stderr.write(line({ p: 'opencode-go', m: 'deepseek-v4.1-flash', small: 'true', agent: 'title', e: GO_LIMIT_TITLE }))
    process.stderr.write(line({ p: 'opencode-go', m: 'deepseek-v4.1-flash', small: 'false', agent: 'build', e: GO_LIMIT }))
}
let lineQuota = line({ p: 'opencode', m: 'beam-free', small: 'false', agent: 'build', e: QUOTA })
let lineTitle = line({ p: 'opencode', m: 'beam-free', small: 'true', agent: 'title', e: QUOTA_TITLE })
let lineRate = line({ p: 'opencode', m: 'beam-free', small: 'false', agent: 'build', e: RATE })

process.stdin.resume()
process.stdin.on('data', () => {})
process.stderr.write('\\u001b[0m\\r\\n> build · beam-free\\r\\n\\u001b[0m\\r\\n')

if (scenario === 'quota') {
    if (printLogs) {
        process.stderr.write(lineTitle)
        process.stderr.write(lineQuota)
    }
    hang()
}
else if (scenario === 'quota-exit') {
    if (printLogs) {
        process.stderr.write(lineQuota)
    }
    finish(1, '', 'Error: stream failed\\n')
}
else if (scenario === 'locked') {
    finish(1, '', 'Error: Unexpected error database is locked\\n')
}
else if (scenario === 'locked2-then-boom') {
    //第1次嘗試以離開碼2快速失敗且含database is locked(不可一般重試、可暫時性重試), 第2次起以1失敗(一般錯誤); 次數記於--fake-count=<檔>
    let cf = pick(/^--fake-count=(.*)$/)
    let n = (cf && fs.existsSync(cf)) ? Number(fs.readFileSync(cf, 'utf8')) || 0 : 0
    if (cf) {
        fs.writeFileSync(cf, String(n + 1))
    }
    if (n === 0) {
        finish(2, '', 'Error: Unexpected error database is locked\\n')
    }
    else {
        finish(1, '', 'Error: boom\\n')
    }
}
else if (scenario === 'loglocked') {
    //日誌列(僅--print-logs時)含database is locked, 但主要失敗為一般錯誤(以1快速結束)
    if (printLogs) {
        process.stderr.write(line({ p: 'opencode', m: 'beam-free', small: 'true', agent: 'title', e: 'SQLiteError: database is locked' }))
    }
    finish(1, '', 'Error: boom\\n')
}
else if (scenario === 'quota-then-other') {
    //同一區塊: 免費池用盡列之後緊接另一主要請求之ERROR列, 其後不結束
    if (printLogs) {
        process.stderr.write(lineQuota + line({ p: 'opencode', m: 'beam-free', small: 'false', agent: 'build', e: 'AI_APICallError: Upstream request failed: [overloaded]' }))
    }
    hang()
}
else if (scenario === 'quota-exit0-out') {
    //印免費池用盡列後立即自行以0結束, stdout有內容(無validate時修前會被當成功)
    if (printLogs) {
        process.stderr.write(lineQuota)
    }
    finish(0, '完成', '')
}
else if (scenario === 'other-then-quota') {
    //第1次嘗試為一般失敗(自行以1結束), 第2次起為免費池用盡(不結束); 次數記於--fake-count=<檔>
    let cf = pick(/^--fake-count=(.*)$/)
    let n = (cf && fs.existsSync(cf)) ? Number(fs.readFileSync(cf, 'utf8')) || 0 : 0
    if (cf) {
        fs.writeFileSync(cf, String(n + 1))
    }
    if (n === 0) {
        finish(1, '', 'Error: boom\\n')
    }
    else {
        if (printLogs) {
            process.stderr.write(lineQuota)
        }
        hang()
    }
}
else if (scenario === 'quota-exit0') {
    if (printLogs) {
        process.stderr.write(lineQuota)
    }
    finish(0, '', '')
}
else if (scenario === 'rate') {
    if (printLogs) {
        process.stderr.write(lineRate)
    }
    hang()
}
else if (scenario === 'quota-locked') {
    process.stderr.write('Error: Unexpected error database is locked (warn only)\\n')
    if (printLogs) {
        process.stderr.write(lineQuota)
    }
    hang()
}
else if (scenario === 'split') {
    if (printLogs) {
        let k = lineQuota.indexOf('Free usage li') + 'Free usage li'.length
        process.stderr.write(lineQuota.slice(0, k))
        waitGate(() => {
            process.stderr.write(lineQuota.slice(k))
            hang()
        })
    }
    else {
        hang()
    }
}
else if (scenario === 'title') {
    if (printLogs) {
        process.stderr.write(lineTitle)
        waitGate(() => finish(0, '完成', ''))
    }
    else {
        finish(0, '完成', '')
    }
}
else if (scenario === 'go-limit') {
    //訂閱到頂(真實CLI實測之行為): title附帶請求之列與主要請求之列, 其後不結束
    if (printLogs) {
        goLimitLines()
    }
    hang()
}
else if (scenario === 'go-limit-keyed') {
    //依金鑰而異: 注入之金鑰含--fake-limited-key之子字串者到頂(不結束), 其餘成功
    let limitedKey = pick(/^--fake-limited-key=(.*)$/)
    let badKey = pick(/^--fake-bad-key=(.*)$/)
    let auth = process.env.OPENCODE_AUTH_CONTENT || ''
    if (limitedKey && auth.includes(limitedKey)) {
        if (printLogs) {
            goLimitLines()
        }
        hang()
    }
    else if (badKey && auth.includes(badKey)) {
        finish(1, '', 'Error: boom\\n')
    }
    else {
        finish(0, '完成', '')
    }
}
else if (scenario === 'go-limit-orphan') {
    //終止失敗之情形(對應樹狀終止失敗而等到逾時): 注入之金鑰含--fake-limited-key之子字串者, 根行程先自行結束(其pid已不存在, taskkill失敗),
    //由detached之孫行程(繼承stdio, 令管線不關閉)於600毫秒後才印出到頂列、其後存活15秒; 其餘金鑰成功。到頂列判中時根行程已消失 ⇒ 轉接器之終止無從生效, 只能等execCli之逾時
    let limitedKey = pick(/^--fake-limited-key=(.*)$/)
    let auth = process.env.OPENCODE_AUTH_CONTENT || ''
    if (limitedKey && auth.includes(limitedKey)) {
        let lines = line({ p: 'opencode-go', m: 'deepseek-v4.1-flash', small: 'true', agent: 'title', e: GO_LIMIT_TITLE }) + line({ p: 'opencode-go', m: 'deepseek-v4.1-flash', small: 'false', agent: 'build', e: GO_LIMIT })
        let prog = 'setTimeout(() => { if (process.argv[1] === "print") { process.stderr.write(process.argv[2]) } }, 600); setTimeout(() => {}, 15000)'
        spawn(process.execPath, ['-e', prog, 'print', printLogs ? lines : ''], { stdio: 'inherit', windowsHide: true, detached: true })
        try {
            gc.kill()
        }
        catch {}
        setTimeout(() => process.exit(0), 100)
    }
    else {
        finish(0, '完成', '')
    }
}
else if (scenario === 'go') {
    if (printLogs) {
        process.stderr.write(line({ p: 'opencode-go', m: 'glm-5.3-flash', small: 'false', agent: 'build', e: RATE }))
        process.stderr.write(line({ p: 'opencode-go', m: 'glm-5.3-flash', small: 'false', agent: 'build', e: QUOTA }))
        waitGate(() => finish(1, '', 'Error: go failed\\n'))
    }
    else {
        finish(1, '', 'Error: go failed\\n')
    }
}
else if (scenario === 'other') {
    if (printLogs) {
        process.stderr.write(line({ p: 'opencode', m: 'beam-free', small: 'false', agent: 'build', e: 'AI_APICallError: Upstream request failed: [overloaded]' }))
    }
    finish(1, '', 'Error: boom\\n')
}
else {
    finish(0, '完成', '')
}
`


export default CODE_ENTRY_LIMIT
