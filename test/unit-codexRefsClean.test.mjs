import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync, spawnSync } from 'child_process'
import dispatchCodex from '../src/dispatchCodex.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-codexRefsClean.test.mjs — 派工結束後清除Codex於目標repo新留下之refs/codex/*(排程第388項②; 帳本R-CODEX-3)
//
// 規格來源: 主控裁示(第388項②): 派工結束後清Codex於目標repo留下之refs/codex/*(收尾之一部分; 只刪refs/codex/之下, 不碰其他ref), 或若Codex有關閉turn-diff檢查點之設定則以設定處理;
//   2026-11-22以Codex 0.167.1查證無此設定(見cleanCodexRefs.mjs檔頭), 採清除。
//   S1 派工期間新出現於refs/codex/下之ref於結束後刪除(成功與失敗皆然), 結果另帶codexRefsRemoved(個數); 派工前已存在者不動(含使用者自己或他工作階段之ref)。
//   S2 只刪前綴為`refs/codex/`者: refs/heads、refs/tags、refs/remotes、refs/codex-other/、refs/heads/codex/皆不動。
//   S3 opt.cleanCodexRefs為false不清; 沒有新ref時結果形狀不變(無codexRefsRemoved); cwd不是git repo、不存在者不報錯、結果不受影響。
//   S4 本選項不轉傳execCli(為轉接器自用鍵); git子行程一律windowsHide。
// 全部走真實git(暫存repo落test/_tmp/)與假CLI(不呼叫真codex): 假CLI依--mk-refs=<逗號分隔ref名>在cwd以git update-ref建立ref。


let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'codexRefsClean')

let ENTRY = `
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
let args = process.argv.slice(2)
let arg = (p) => {
    let a = args.find((x) => x.startsWith(p))
    return a ? a.slice(p.length) : ''
}
let refs = arg('--mk-refs=').split(',').filter(Boolean)
if (refs.length > 0) {
    let oid = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
    for (let r of refs) {
        execFileSync('git', ['update-ref', r, oid], { windowsHide: true })
    }
}

//--mk-broken=<ref名>: 手寫loose ref指向不存在之物件(Codex留下之壞ref之形狀, 令git gc報bad object)
let broken = arg('--mk-broken=')
if (broken !== '') {
    let gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8', windowsHide: true }).trim()
    let fp = path.join(gitDir, ...broken.split('/'))
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, '1111111111111111111111111111111111111111\\n')
}

//--mk-lock=<ref名>: 於該ref旁建立.lock檔(git無法鎖定該ref: 含它之批次交易整筆失敗, 逐一刪除時只有它刪不掉)
let lock = arg('--mk-lock=')
if (lock !== '') {
    let gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8', windowsHide: true }).trim()
    fs.writeFileSync(path.join(gitDir, ...lock.split('/')) + '.lock', '')
}
let code = Number(arg('--fake-exit=') || 0)
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ args }))
    process.exit(code)
})
`

let git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', windowsHide: true }).trim()
let refsOf = (cwd) => git(cwd, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean).sort()


describe('codex派工結束後清除refs/codex/*(排程第388項②)', function() {

    this.timeout(60000)

    let fake = null
    let seq = 0

    //newRepo: 每案獨立之暫存git repo(含1個提交, 及一批「不得被碰」之其他ref)
    let newRepo = () => {
        let d = path.join(FD, `repo-${++seq}`)
        fs.mkdirSync(d, { recursive: true })
        git(d, 'init', '-q')
        git(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x')
        let oid = git(d, 'rev-parse', 'HEAD')
        for (let r of ['refs/tags/t1', 'refs/remotes/origin/codex/z', 'refs/codex-other/x', 'refs/heads/codex/y', 'refs/codexx']) {
            git(d, 'update-ref', r, oid)
        }
        return d
    }
    let call = (cwd, mk, opt = {}, extra = []) => dispatchCodex('abc', { exe: fake.exe, cwd, extraArgs: [`--mk-refs=${mk.join(',')}`, ...extra], ...opt })

    before(function() {
        fs.mkdirSync(FD, { recursive: true })
        fake = createFakeCli('fake-codex-refs', ENTRY)
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch {}
    })

    it('S1 派工期間新出現於refs/codex/下之ref於結束後刪除(結果帶codexRefsRemoved); 派工前已存在者不動; 修前全數殘留', async function() {
        let d = newRepo()
        git(d, 'update-ref', 'refs/codex/keep-before', git(d, 'rev-parse', 'HEAD'))
        let others = refsOf(d).filter((x) => !x.startsWith('refs/codex/'))
        let r = await call(d, ['refs/codex/turn-diffs/checkpoints/a1', 'refs/codex/turn-diffs/checkpoints/a2', 'refs/codex/foo'])
        assert.strict.deepEqual([r.ok, r.codexRefsRemoved], [true, 3])
        assert.strict.deepEqual(refsOf(d).filter((x) => x.startsWith('refs/codex/')), ['refs/codex/keep-before'])
        assert.strict.deepEqual(refsOf(d).filter((x) => !x.startsWith('refs/codex/')), others) //S2: 其他ref(含refs/codex-other/x、refs/heads/codex/y、refs/codexx、refs/tags、refs/remotes)一個不少
        assert.strict.deepEqual(others.includes('refs/codex-other/x') && others.includes('refs/heads/codex/y') && others.includes('refs/codexx') && others.includes('refs/tags/t1') && others.includes('refs/remotes/origin/codex/z'), true)
    })

    it('S1 失敗結果(離開碼1)亦清除; 結果仍為失敗且帶codexRefsRemoved', async function() {
        let d = newRepo()
        let r = await call(d, ['refs/codex/turn-diffs/checkpoints/b1'], {}, ['--fake-exit=1'])
        assert.strict.deepEqual([r.ok, r.codexRefsRemoved, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [false, 1, []])
    })

    it('S3 opt.cleanCodexRefs為false不清(結果不帶codexRefsRemoved); 沒有新ref時結果形狀不變(無codexRefsRemoved)', async function() {
        let d = newRepo()
        let r1 = await call(d, ['refs/codex/c1'], { cleanCodexRefs: false })
        assert.strict.deepEqual([r1.ok, 'codexRefsRemoved' in r1, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [true, false, ['refs/codex/c1']])
        let r2 = await call(d, [])
        assert.strict.deepEqual([r2.ok, 'codexRefsRemoved' in r2, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [true, false, ['refs/codex/c1']]) //上一案留下者視為派工前既有, 不動
        let r3 = await call(d, [], { cleanCodexRefs: 'no' }) //給了而非布林: params拒絕(破壞性開關不退回「開」; 排程第553項複審)、不起子行程
        assert.strict.deepEqual([r3.ok, r3.errorType, r3.attempts], [false, 'params', 0])
        let r4 = await call(d, ['refs/codex/c2'], { cleanCodexRefs: true })
        assert.strict.deepEqual([r4.ok, r4.codexRefsRemoved, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [true, 1, ['refs/codex/c1']])
    })

    it('S1 指向不存在物件之ref(使git gc報bad object之實況)亦被列出並刪除: 派工期間留下此類ref, 結束後git gc成功; 修前git gc失敗(fatal: bad object … failed to run repack)', async function() {
        let d = newRepo()
        let r = await call(d, [], {}, ['--mk-broken=refs/codex/turn-diffs/checkpoints/broken1'])
        assert.strict.deepEqual([r.ok, r.codexRefsRemoved, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [true, 1, []])
        let gc = spawnSync('git', ['gc', '-q'], { cwd: d, encoding: 'utf8', windowsHide: true })
        assert.strict.deepEqual([gc.status, gc.stderr], [0, ''])
    })

    it('S1 批次交易失敗(其中一個ref被鎖而刪不掉)時退回逐一刪除: 其餘ref照刪、被鎖者留下, codexRefsRemoved為實際刪除個數(變異: 批次失敗即放棄全部而存活之補測)', async function() {
        let d = newRepo()
        let r = await call(d, ['refs/codex/l1', 'refs/codex/l2', 'refs/codex/l3'], {}, ['--mk-lock=refs/codex/l2'])
        assert.strict.deepEqual([r.ok, r.codexRefsRemoved, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [true, 2, ['refs/codex/l2']])
    })

    it('S3 基準非Set(缺基準)者一律不刪(removed 0); 子行程環境移除GIT_DIR／GIT_WORK_TREE(於git hook內執行時不致作用於hook所屬repo)', async function() {
        let { listCodexRefs, removeNewCodexRefs } = await import('../src/cleanCodexRefs.mjs')
        let d = newRepo()
        git(d, 'update-ref', 'refs/codex/keep/1', git(d, 'rev-parse', 'HEAD'))
        let rm = [await removeNewCodexRefs(d, null), await removeNewCodexRefs(d, undefined), await removeNewCodexRefs(d, ['refs/codex/keep/1']), await removeNewCodexRefs(d, {})]
        assert.strict.deepEqual([rm.map((x) => x.removed), refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [[0, 0, 0, 0], ['refs/codex/keep/1']])
        let saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE }
        process.env.GIT_DIR = path.join(FD, 'no-such-git-dir')
        process.env.GIT_WORK_TREE = path.join(FD, 'no-such-worktree')
        let l = null
        try {
            l = await listCodexRefs(d)
        }
        finally {
            for (let [k, v] of Object.entries(saved)) {
                if (v === undefined) {
                    delete process.env[k]
                }
                else {
                    process.env[k] = v
                }
            }
        }
        assert.strict.deepEqual([l.ok, [...l.refs]], [true, ['refs/codex/keep/1']])
    })

    it('S3 cwd不是git repo、不存在: 不報錯、結果不受影響(無codexRefsRemoved)', async function() {
        let plain = path.join(FD, 'not-a-repo')
        fs.mkdirSync(plain, { recursive: true })
        let r1 = await dispatchCodex('abc', { exe: fake.exe, cwd: plain })
        let r2 = await dispatchCodex('abc', { exe: fake.exe, cwd: path.join(FD, 'no-such-dir') })
        assert.strict.deepEqual([r1.ok, 'codexRefsRemoved' in r1, r2.ok, 'codexRefsRemoved' in r2], [true, false, false, false])
        assert.strict.deepEqual(r2.errorType, 'spawn')
    })

    it('S4 cleanCodexRefs為轉接器自用鍵, 不轉傳execCli(假CLI之args不含); git子行程windowsHide', async function() {
        let d = newRepo()
        let r = await call(d, [], { cleanCodexRefs: true })
        assert.strict.deepEqual(JSON.parse(r.stdout).args.some((a) => /clean/i.test(a)), false)
        let src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cleanCodexRefs.mjs'), 'utf8').split(/\r?\n/).map((ln) => ln.replace(/\/\/.*$/, '')).join('\n')
        assert.strict.deepEqual([/execFile\(/.test(src), /windowsHide:\s*true/.test(src), /execSync|exec\(|spawnSync|\bspawn\(/.test(src)], [true, true, false])

        //自用鍵須列入OWN_KEYS(execCli對未知鍵不報錯, 行為上無從觀察, 故以原始碼判: 不列則該鍵隨optCli原樣轉傳execCli; 變異R06)
        let cx = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'dispatchCodex.mjs'), 'utf8').split(/\r?\n/).map((ln) => ln.replace(/\/\/.*$/, '')).join('\n')
        assert.strict.deepEqual(/let OWN_KEYS = \[[^\]]*'cleanCodexRefs'[^\]]*\]/.test(cx), true)
    })

    it('listCodexRefs／removeNewCodexRefs: 只列、只刪前綴refs/codex/者; 空基準(Set)刪全部新出現者仍只限前綴; 非字串cwd回ok false', async function() {
        let { listCodexRefs, removeNewCodexRefs } = await import('../src/cleanCodexRefs.mjs') //動態匯入: 修前此模組不存在時只使本案紅燈(其餘案以行為斷言紅燈)
        let d = newRepo()
        git(d, 'update-ref', 'refs/codex/x/1', git(d, 'rev-parse', 'HEAD'))
        git(d, 'update-ref', 'refs/codex/x/2', git(d, 'rev-parse', 'HEAD'))
        let l = await listCodexRefs(d)
        assert.strict.deepEqual([l.ok, [...l.refs].sort()], [true, ['refs/codex/x/1', 'refs/codex/x/2']])
        let rm = await removeNewCodexRefs(d, new Set(['refs/codex/x/1']))
        assert.strict.deepEqual([rm.removed, refsOf(d).filter((x) => x.startsWith('refs/codex/'))], [1, ['refs/codex/x/1']])
        let rm2 = await removeNewCodexRefs(d, new Set()) //空基準(Set): 刪全部新出現者, 仍只限前綴
        assert.strict.deepEqual([rm2.removed, refsOf(d).filter((x) => x.startsWith('refs/codex/')), refsOf(d).includes('refs/tags/t1'), refsOf(d).includes('refs/codex-other/x')], [1, [], true, true])
        assert.strict.deepEqual([(await listCodexRefs(123)).ok, (await listCodexRefs(path.join(FD, 'no-such'))).ok, (await removeNewCodexRefs(path.join(FD, 'no-such'), new Set())).removed], [false, false, 0])
    })

})
