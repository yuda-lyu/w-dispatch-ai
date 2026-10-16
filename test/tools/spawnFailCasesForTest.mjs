import path from 'path'


// spawnFailCasesForTest.mjs — 「子進程未能啟動」之跨平台情境清單, 供四家CLI轉接器之測試共用(同一份情境, 對稱比對)
//
// 規格(README errorType表、getErrorType.mjs檔頭): 子進程未能啟動時結果ok為false、errorType為'spawn'、code為null、
//   attempts為1(execCli實際嘗試1次), 且不reject。錯誤碼隨平台與成因而異(UNKNOWN/EFTYPE/EPERM/EACCES/ENOENT/
//   ERR_INVALID_ARG_VALUE...), 故情境只斷言errorType與結構欄位, 不斷言錯誤碼。


/**
 * 產生子進程未能啟動之情境清單
 *
 * @param {Object} o 輸入設定物件
 * @param {String} o.kind 輸入轉接器種類字串，antigravity之prompt走命令列參數故空字元置於prompt，其餘置於extraArgs
 * @param {String} o.okExe 輸入可正常啟動之假CLI路徑字串(createFakeCli之exe)
 * @param {String} o.badExe 輸入存在但無法啟動之執行檔路徑字串(createUnstartableExe之exe)
 * @returns {Array} 回傳情境陣列，各元素為{label, prompt, opt}
 */
function spawnFailCases({ kind, okExe, badExe }) {
    let missingDir = path.join(path.dirname(badExe), 'no-such-dir-for-test')
    return [
        { label: 'unstartable-exe', prompt: 'abc', opt: { exe: badExe } },
        (kind === 'antigravity')
            ? { label: 'nul-in-arg', prompt: 'a\u0000b', opt: { exe: okExe } }
            : { label: 'nul-in-arg', prompt: 'abc', opt: { exe: okExe, extraArgs: ['--x=a\u0000b'] } },
        { label: 'nul-in-env', prompt: 'abc', opt: { exe: okExe, env: { FAKE_ENV: 'a\u0000b' } } },
        { label: 'cwd-missing', prompt: 'abc', opt: { exe: okExe, cwd: missingDir } },
        //不存在之.cmd(wsemi>=1.9.16: ENOENT、不經cmd.exe退路、不重試; 1.9.15為Exit code 1而歸exec)
        { label: 'cmd-missing', prompt: 'abc', opt: { exe: path.join(path.dirname(badExe), 'no-such-shim.cmd'), maxRetries: 2, retryDelayMs: 1 } },
    ]
}


/**
 * 產生env不可讀(自有可列舉屬性之getter拋錯)之設定物件, 供四家CLI轉接器之對稱測試
 *
 * @param {String} okExe 輸入可正常啟動之假CLI路徑字串
 * @returns {Object} 回傳設定物件
 */
function envUnreadableOpt(okExe) {
    let env = {}
    Object.defineProperty(env, 'BAD_ENV', {
        enumerable: true,
        get: () => {
            throw new Error('env getter boom')
        },
    })
    return { exe: okExe, env }
}


export default spawnFailCases
export { envUnreadableOpt }
