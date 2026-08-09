import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


// fakeCliForTest.mjs — 測試用的假CLI
//
// 各dispatch函數之可觀察行為為「以什麼參數、什麼stdin、什麼環境變數啟動子進程」，
// 故產生一支會把args／stdin／env原樣印回stdout(JSON)的假CLI，即可對規格逐條斷言，
// 而無須真的呼叫claude／codex／opencode(耗時、需登入、輸出不決定性)。
//
// 【為何要做成npm shim形狀】Windows下wsemi之execCli遇.cmd會先解析出JS入口再直接以node執行，
//   解析不到才退回cmd.exe。做成npm全域安裝之shim形狀(入口置於node_modules下)即走前者，
//   可完全避開cmd.exe之編碼與跳脫問題，令中文與多行參數皆可正確傳遞。
//
// 【產物落點】產物落在本檔所在之test資料夾下(test/tmp/)，不落主cwd根目錄，
//   避免與專案根之./tmp/混用而難以清理；測試結束由clean()逐一清除。
//   路徑由本檔位置衍生而非cwd-relative，故不論由何處啟動mocha皆落在同一處。


//fdBase, 由本檔位置衍生(test/tools/ → test/tmp/), 屬「產物落在腳本所在資料夾」之情境
//URL轉實體路徑只可用fileURLToPath, 不可用new URL(...).pathname(會回URL-encoded字串)
let FD_BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tmp')


//假CLI本體, 由node執行
let CODE_ENTRY = `
let args = process.argv.slice(2)

//--fake-exit=N, 令假CLI以指定離開碼結束, 供測試失敗與重試路徑
let mExit = args.map((a) => /^--fake-exit=(\\d+)$/.exec(a)).find((m) => !!m)
let exitCode = mExit ? Number(mExit[1]) : 0

//--fake-stderr=XXX, 令假CLI輸出指定文字至stderr
let mErr = args.map((a) => /^--fake-stderr=(.*)$/.exec(a)).find((m) => !!m)
if (mErr) {
    process.stderr.write(mErr[1])
}

//--fake-sleep=N, 令假CLI延遲N毫秒才結束, 供測試逾時路徑
let mSleep = args.map((a) => /^--fake-sleep=(\\d+)$/.exec(a)).find((m) => !!m)

let chunks = []
process.stdin.on('data', (c) => {
    chunks.push(c)
})
process.stdin.on('end', () => {
    let r = {
        args,
        stdin: Buffer.concat(chunks).toString('utf8'),
        cwd: process.cwd(),
        env: {
            OPENCODE_AUTH_CONTENT: process.env.OPENCODE_AUTH_CONTENT || '',
            OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT || '',
            FAKE_ENV: process.env.FAKE_ENV || '',
        },
    }
    let end = () => {
        process.stdout.write(JSON.stringify(r))
        process.exit(exitCode)
    }
    if (mSleep) {
        setTimeout(end, Number(mSleep[1]))
    }
    else {
        end()
    }
})
`


/**
 * 產生一支測試用的假CLI，回傳其執行檔路徑與清除函數
 *
 * @param {String} name 輸入假CLI名稱字串，各測試檔須給予不同名稱，避免mocha並行執行時互相干擾
 * @returns {Object} 回傳物件，內含exe(假CLI執行檔絕對路徑字串)、fd(產物資料夾絕對路徑字串)、clean(清除產物之函數)
 */
function createFakeCli(name) {

    //fd, 印出absolute路徑供除錯驗收
    let fd = path.resolve(FD_BASE, name)

    //fdEntry, 做成npm shim形狀, 入口須置於node_modules下才會被execCli解析出來
    let fdEntry = path.join(fd, 'node_modules', name)
    fs.mkdirSync(fdEntry, { recursive: true })

    //entry
    let fpEntry = path.join(fdEntry, 'entry.mjs')
    fs.writeFileSync(fpEntry, CODE_ENTRY, 'utf8')

    //exe
    let exe = ''
    if (process.platform === 'win32') {

        //Windows, npm全域安裝之.cmd shim形狀
        exe = path.join(fd, `${name}.cmd`)
        let code = [
            '@ECHO off',
            'SETLOCAL',
            'CALL :find_dp0',
            'SET "_prog=node"',
            `"%_prog%"  "%dp0%\\node_modules\\${name}\\entry.mjs" %*`,
            'ENDLOCAL',
            'EXIT /b %errorlevel%',
            ':find_dp0',
            'SET dp0=%~dp0',
            'EXIT /b',
            '',
        ].join('\r\n')
        fs.writeFileSync(exe, code, 'utf8')
    }
    else {

        //POSIX, sh啟動器, node以絕對路徑給予避免PATH差異
        exe = path.join(fd, name)
        let code = [
            '#!/bin/sh',
            `exec "${process.execPath}" "$(dirname "$0")/node_modules/${name}/entry.mjs" "$@"`,
            '',
        ].join('\n')
        fs.writeFileSync(exe, code, 'utf8')
        fs.chmodSync(exe, 0o755)
    }

    //clean, 一併嘗試移除已空之上層資料夾, 令測試結束後test/tmp/不留殘跡
    //上層可能仍有其他測試檔並行中之產物, 故rmdir失敗即忽略
    let clean = () => {
        fs.rmSync(fd, { recursive: true, force: true })
        try {
            fs.rmdirSync(FD_BASE)
        }
        catch {}
    }

    return { exe, fd, clean }
}


export default createFakeCli
