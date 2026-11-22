import fs from 'fs'
import path from 'path'


// hostileValuesForTest.mjs — 測試用之敵意輸入值產生器與PATH守門(單一定義; unit-safeOpts、unit-opencodeAuthOpts、unit-envExesReject共用)
//
// 全部測試不實際呼叫外部AI服務: CLI一律假執行檔; 修前之無效exe會退回PATH上之真CLI, 故測試於執行期間改用pathWithoutRealCli()之PATH並於after還原(自包含, 不依賴外部包裝)


//SENT, 輸入值中之標記字串: 任何錯誤訊息不得出現(K9不回顯)
let SENT = 'SECRET-SENTINEL-9f3a7c'


//revoked, 已撤銷之Proxy(任何讀取皆拋錯)
function revoked() {
    let r = Proxy.revocable({}, {})
    r.revoke()
    return r.proxy
}


//hostile, 敵意物件(轉原始值時回標記字串)
function hostile() {
    return {
        toString: () => SENT,
        valueOf: () => SENT,
        [Symbol.toPrimitive]: () => SENT,
    }
}


//pathWithoutRealCli, 自PATH移除含真CLI(claude、opencode、codex、agy)之資料夾後之PATH字串
function pathWithoutRealCli() {
    let exts = ['', '.exe', '.cmd', '.bat']
    let keep = []
    for (let d of String(process.env.PATH || '').split(path.delimiter)) {
        let has = false
        for (let n of ['claude', 'opencode', 'codex', 'agy']) {
            for (let e of exts) {
                try {
                    if (d !== '' && fs.existsSync(path.join(d, n + e))) {
                        has = true
                    }
                }
                catch {}
            }
        }
        if (!has) {
            keep.push(d)
        }
    }
    return keep.join(path.delimiter)
}


export { SENT, revoked, hostile, pathWithoutRealCli }
