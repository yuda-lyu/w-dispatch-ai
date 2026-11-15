import assert from 'assert'
import { spawn } from 'child_process'
import killProcessTree, { descendantsOf } from '../src/killProcessTree.mjs'


// unit-killProcessTree.test.mjs — 樹狀終止子行程(wda156, Gitea #156; 帳本R-OCLIMIT-1)
//
// spec: 派工〈本輪範圍〉2「樹狀終止(Windows taskkill /F /T; 每一處child_process呼叫設windowsHide: true; 其他平台之作法與其限制寫明)」;
//   src/killProcessTree.mjs檔頭(Windows以execFile不經shell; 非Windows以execFile列舉ps後逐一SIGKILL, ps失敗只終止根且不崩潰; 永不reject)。


function alive(pid) {
    try {
        process.kill(pid, 0)
        return true
    }
    catch (e) {
        return e.code === 'EPERM'
    }
}


async function waitGone(pid, ms = 5000) {
    let t0 = Date.now()
    while (alive(pid)) {
        if (Date.now() - t0 > ms) {
            return false
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 50)
        })
    }
    return true
}


describe('killProcessTree', function() {

    it('Windows: 以execFile呼叫taskkill /F /T /PID <pid>, 選項windowsHide為true(不經shell); 成功回{ ok: true, how: \'taskkill\' }', async function() {
        //spec: 「Windows taskkill /F /T」「每一處child_process呼叫設windowsHide: true」
        let calls = []
        let fakeExecFile = (file, args, o, cb) => {
            calls.push([file, args, o.windowsHide, o.shell])
            cb(null, '', '')
        }
        let r = await killProcessTree(1234, { platform: 'win32', execFile: fakeExecFile })
        assert.strict.deepEqual([calls, r.ok, r.how], [[['taskkill', ['/F', '/T', '/PID', '1234'], true, undefined]], true, 'taskkill'])
    })

    it('Windows: taskkill失敗(行程已不存在等)回ok:false且不reject', async function() {
        //spec: 檔頭【永不reject】
        let r = await killProcessTree(1234, { platform: 'win32', execFile: (f, a, o, cb) => cb(new Error('not found')) })
        assert.strict.deepEqual([r.ok, r.how, r.msg], [false, 'taskkill', 'not found'])
    })

    it('非Windows: 以execFile(ps -A -o pid=,ppid=, windowsHide)列舉後由深至淺SIGKILL子孫、最後終止根; 成功回how \'ps-tree\'', async function() {
        //spec: 檔頭(其他平台之作法: 一次列舉父子關係、錯誤由callback承接)
        let calls = []
        let killed = []
        let ef = (file, args, o, cb) => {
            calls.push([file, args, o.windowsHide])
            cb(null, '  1     0\n 77     1\n 78    77\n 79    78\n 80    77\n 90     1\n', '')
        }
        let r = await killProcessTree(77, { platform: 'linux', execFile: ef, kill: (p, s) => killed.push([p, s]) })
        assert.strict.deepEqual([calls, killed.map((k) => k[0]), killed.every((k) => k[1] === 'SIGKILL'), r.ok, r.how], [[['ps', ['-A', '-o', 'pid=,ppid='], true]], [79, 80, 78, 77], true, true, 'ps-tree'])
    })

    it('非Windows: ps不存在(execFile回ENOENT錯誤)時不崩潰、不reject, 只終止根(how \'kill-root\'); 根亦終止失敗(ESRCH)時ok:false', async function() {
        //spec: 檔頭「ps失敗則只終止根」; tree-kill之spawn未監聽error會令呼叫端崩潰(外審terra #4)——本實作由callback承接
        let ef = (file, args, o, cb) => cb(Object.assign(new Error('spawn ps ENOENT'), { code: 'ENOENT' }))
        let killed = []
        let a = await killProcessTree(77, { platform: 'darwin', execFile: ef, kill: (p) => killed.push(p) })
        let b = await killProcessTree(78, {
            platform: 'linux',
            execFile: ef,
            kill: () => {
                throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
            },
        })
        assert.strict.deepEqual([killed, a.ok, a.how, [b.ok, b.how, b.msg]], [[77], true, 'kill-root', [false, 'kill-root', 'kill ESRCH']])
    })

    it('descendantsOf: 自根廣度優先收集子孫, 由深至淺回傳(不含根; 略過無法解析之行)', function() {
        //spec: 檔頭(由深至淺逐一終止)
        let rr = [descendantsOf('  1 0\n10 1\n11 10\n12 10\n13 11\nbad line\n20 1\n', 10), descendantsOf('', 5), descendantsOf('5 1\n', 5)]
        assert.strict.deepEqual(rr, [[13, 12, 11], [], []])
    })

    it('pid無效(0、負數、小數、非數字、null)回{ ok: false, how: \'none\' }, 不呼叫任何指令', async function() {
        //spec: 檔頭(防誤殺: 無效pid不送出指令)
        let calls = 0
        let ef = () => {
            calls++
        }
        let rr = []
        for (let p of [0, -1, 1.5, 'abc', null, undefined]) {
            let r = await killProcessTree(p, { platform: 'win32', execFile: ef })
            rr.push([r.ok, r.how])
        }
        assert.strict.deepEqual([rr, calls], [Array(6).fill([false, 'none']), 0])
    })

    it('實際終止: 以node起一個子行程(其下再起孫行程), 終止後兩者皆不在', async function() {
        //spec: 「樹狀終止」——子孫行程一併終止(真實行程, 不用替身)
        //子孫行程各自存活上限60秒(測試遠短於此; 防終止失敗時遺留孤兒)。孫行程detached: Windows之libuv把非detached子行程放進「父行程結束即殺」之job物件,
        //只殺根行程亦會連帶結束之(wda156變異M12實測), 須detached才分辨得出樹狀終止(/T)與只殺根行程
        let code = 'const { spawn } = require("child_process"); const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true, detached: true }); process.stdout.write(String(g.pid) + "\\n"); setTimeout(() => {}, 60000)'
        let child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
        let gpid = await new Promise((resolve) => {
            child.stdout.once('data', (b) => resolve(Number(String(b).trim())))
        })
        let before = [alive(child.pid), alive(gpid)]
        let r = await killProcessTree(child.pid)
        let rr = [before, r.ok, await waitGone(child.pid), await waitGone(gpid)]
        assert.strict.deepEqual(rr, [[true, true], true, true, true])
    })

})
