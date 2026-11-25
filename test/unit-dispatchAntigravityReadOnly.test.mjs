import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import providers from '../src/providers.mjs'
import { checkSafeOpts } from '../src/readSafeOpt.mjs'
import { clearAgyStdinSupportCache } from '../src/checkAgyStdinSupport.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//帳本: sgud/rule/rulebook_agyreadonly.md「R-AGY-5 agy 真防寫:readOnly 以 --settings 帶 permissions.deny」(排程第445項, 2026-11-24 tdai3)
//規格(皆為本機以 agy 1.5.12 實測 + 官方〈Agent permissions〉頁):
//  S1 agy 之 skipPermissions:false 只擋工作區外之寫入, 工作區內之寫入(write_file 與 shell 指令)皆自動放行而落地;
//  S2 `--settings '{"permissions":{"deny":["write_file(*)","command(*)"]}}'`(本次工作階段限定、不存檔)令工作區內寫入被擋(模型回「Permission denied … Matches user-configured deny rule」)、讀取照常;
//  S3 只 deny write_file 不夠: 模型改用 shell 繞過而落地, 故 command(*) 亦須 deny。
//本檔之假 agy 只重現旗標形狀(不啟動真 agy、不耗額度): argv 路徑把 args 印回, stdin 路徑(stream-json)回 result SUCCESS 且 response 為 args。
//真 agy 之實測(寫入被擋、讀取照常)見帳本 R-AGY-5 與 tdai3 報告, 不入 npm test。

let codeAgy = `
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
let here = path.dirname(fileURLToPath(import.meta.url))
let log = path.resolve(here, '..', '..', 'calls.log')
let args = process.argv.slice(2)
if (args[0] === '--version') {
    fs.appendFileSync(log, 'version\\n')
    process.stdout.write('1.5.12\\n')
    process.exit(0)
}
let chunks = []
process.stdin.on('data', (c) => {
    chunks.push(c)
})
process.stdin.on('end', () => {
    let stdin = Buffer.concat(chunks).toString('utf8')
    if (!args.includes('--input-format')) {
        fs.appendFileSync(log, 'argv\\n')
        process.stdout.write(JSON.stringify({ via: 'argv', args }))
        process.exit(0)
    }
    fs.appendFileSync(log, 'stdin\\n')
    let out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
    out({ event: 'init', conversation_id: 'c1', init: { model: 'x', tools: [] } })
    out({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: JSON.stringify({ via: 'stdin', args }), num_turns: 1 } })
    process.exit(0)
})
`

//本檔期望之 deny 設定(單一寫法, 與 src 之常數逐字比對於 R1)
let DENY = { permissions: { deny: ['write_file(*)', 'command(*)'] } }

//ROOT, 由本檔位置衍生(讀 src／README 供文件守門)
let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')


describe('dispatchAntigravity: readOnly(真防寫; 帳本 R-AGY-5, 排程第445項)', function() {

    let fake = null
    let logOf = () => {
        let f = path.join(fake.fd, 'calls.log')
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((s) => s !== '') : []
    }
    let call = async (prompt, opt = {}) => {
        fs.rmSync(path.join(fake.fd, 'calls.log'), { force: true })
        clearAgyStdinSupportCache()
        return dispatchAntigravity(prompt, { exe: fake.exe, timeoutMs: 30000, ...opt })
    }
    let argsOf = (t) => {
        let o = JSON.parse(t.stdout)
        return o.args
    }

    before(function() {
        fake = createFakeCli(`fake-agy-readonly-${process.pid}`, codeAgy)
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('R1 [修前紅] argv路徑: readOnly:true 令 --settings <JSON> 緊接於權限旗標位置之後, JSON 恰為 permissions.deny[write_file(*), command(*)](S2、S3: 兩條缺一不可)', async function() {
        //規格: S2、S3; skipPermissions:false 時 --settings 為第一個旗標, 其後為既有旗標(順序與修前相同)
        let t = await call('abc', { readOnly: true, skipPermissions: false })
        let a = argsOf(t)
        let r = [t.ok, a[0], JSON.parse(a[1]), a.slice(2)]
        assert.strict.deepEqual(r, [true, '--settings', DENY, ['--print-timeout', '60s', '--add-dir', process.cwd(), '--print', 'abc']])
    })

    it('R2 readOnly 與 skipPermissions 正交: skipPermissions 預設 true 時 --dangerously-skip-permissions 在前、--settings 緊隨其後(deny 規則不被 always-proceed 取代之實測見帳本)', async function() {
        let t = await call('abc', { readOnly: true })
        let a = argsOf(t)
        let r = [t.ok, a[0], a[1], JSON.parse(a[2]), a.slice(3)]
        assert.strict.deepEqual(r, [true, '--dangerously-skip-permissions', '--settings', DENY, ['--print-timeout', '60s', '--add-dir', process.cwd(), '--print', 'abc']])
    })

    it('R3 未給(undefined、null)與 false 時不帶 --settings, args 與 1.0.110 逐位相同(既有行為不變)', async function() {
        let r = []
        for (let v of [undefined, null, false]) {
            let t = await call('abc', { readOnly: v })
            r.push(argsOf(t))
        }
        let base = ['--dangerously-skip-permissions', '--print-timeout', '60s', '--add-dir', process.cwd(), '--print', 'abc']
        assert.strict.deepEqual(r, [base, base, base])
        let t = await call('abc', { skipPermissions: false })
        assert.strict.deepEqual(argsOf(t), ['--print-timeout', '60s', '--add-dir', process.cwd(), '--print', 'abc'])
    })

    it('R4 stdin路徑(promptVia stdin)同樣帶 --settings, 且位於固定之 --input-format／--output-format 之前、不帶 --print', async function() {
        let t = await call('abc', { readOnly: true, skipPermissions: false, promptVia: 'stdin' })
        let o = JSON.parse(t.stdout)
        let a = o.args
        let i = a.indexOf('--settings')
        let r = [t.ok, o.via, i, JSON.parse(a[i + 1]), a.slice(-4), a.includes('--print')]
        assert.strict.deepEqual(r, [true, 'stdin', 0, DENY, ['--input-format', 'stream-json', '--output-format', 'stream-json'], false])
    })

    it('R5 readOnly 給了而非布林(含 "true"、"false"、0、1、空字串、物件、陣列、包裝物件、函數)以 params 拒絕、不起子行程、attempts 0(不退回 false 而放寬、亦不退回 true)', async function() {
        let bad = ['true', 'false', 0, 1, '', {}, [], Object(true), () => 1] //Object(true)為Boolean包裝物件
        let r = []
        for (let v of bad) {
            let t = await call('abc', { readOnly: v })
            r.push([t.ok, t.errorType, t.attempts, /readOnly/.test(t.error), logOf()])
        }
        assert.strict.deepEqual(r, bad.map(() => [false, 'params', 0, true, []]))
    })

    it('R6 extraArgs 自帶 --settings(含 --settings=值、單橫線寫法)與 readOnly:true 並用時以 params 拒絕、不起子行程(不依賴 agy 對重複 --settings 之合併語意, 未實測); readOnly 未開時 extraArgs 之 --settings 照舊原樣轉傳', async function() {
        let r = []
        for (let ex of [['--settings', '{}'], ['--settings={}'], ['-settings', '{}']]) {
            let t = await call('abc', { readOnly: true, extraArgs: ex })
            r.push([t.ok, t.errorType, t.attempts, t.error.includes(`[${ex[0]}]`), logOf()])
        }
        assert.strict.deepEqual(r, [0, 1, 2].map(() => [false, 'params', 0, true, []]))
        let t = await call('abc', { extraArgs: ['--settings', '{"a":1}'] })
        let a = argsOf(t)
        assert.strict.deepEqual([t.ok, a[a.indexOf('--settings') + 1]], [true, '{"a":1}'])
    })

    it('R7 近似旗標不誤拒: extraArgs 帶 --setting-x、--mode 等不衝突之旗標時 readOnly:true 照常帶 --settings', async function() {
        let t = await call('abc', { readOnly: true, skipPermissions: false, extraArgs: ['--mode', 'plan', '--setting-x'] })
        let a = argsOf(t)
        assert.strict.deepEqual([t.ok, a[0], a.includes('--mode'), a.includes('--setting-x')], [true, '--settings', true, true])
    })

    it('R8 checkSafeOpts(遞補層於發 try 事件前之單一判定): agy 之 readOnly 給了而非布林即回錯誤、布林與未給回空字串', function() {
        let r = [
            checkSafeOpts('antigravity', { readOnly: 'true' }) !== '',
            checkSafeOpts('antigravity', { readOnly: 1 }) !== '',
            /readOnly/.test(checkSafeOpts('antigravity', { readOnly: 'x' })),
            checkSafeOpts('antigravity', { readOnly: true, skipPermissions: false }),
            checkSafeOpts('antigravity', { readOnly: false }),
            checkSafeOpts('antigravity', {}),
            checkSafeOpts('claude', { readOnly: 'x' }), //他 kind 不判
        ]
        assert.strict.deepEqual(r, [true, true, true, '', '', '', ''])
    })

    it('R9 經遞補層之條目 readOnly 無效: 不起子行程、不發 try 事件(tried 為空)', async function() {
        fs.rmSync(path.join(fake.fd, 'calls.log'), { force: true })
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [{ id: 'agy:ro-bad', kind: 'antigravity', exe: fake.exe, model: 'x', skipPermissions: false, addDirs: ['.'], readOnly: 'yes' }],
            timeoutMs: 30000,
            onEvent: (ev) => events.push(ev),
        })
        let tries = events.filter((e) => e.type === 'try')
        assert.strict.deepEqual([r.ok, r.tried.map((t) => [t.providerId, t.errorType]), logOf(), tries.length], [false, [['agy:ro-bad', 'params']], [], 0])
    })

    it('R10 內建 agy 條目(5 條)皆自帶 readOnly:true 與 skipPermissions:false、addDirs[.]; 其餘 kind 之內建條目不帶 readOnly', function() {
        let agy = providers.filter((p) => p.kind === 'antigravity')
        let others = providers.filter((p) => p.kind !== 'antigravity')
        let r = [
            agy.map((p) => p.id),
            agy.every((p) => p.readOnly === true && p.skipPermissions === false && Array.isArray(p.addDirs) && p.addDirs.join() === '.'),
            others.some((p) => Object.hasOwn(p, 'readOnly')),
        ]
        assert.strict.deepEqual(r, [[
            'agy:gemini-3.8-flash-high',
            'agy:gemini-4-hydrogen-high',
            'agy:gemini-4-argon-high',
            'agy:claude-sonnet-5-5-high',
            'agy:claude-opus-5-5-high',
        ], true, false])
    })

    it('R12 文件: README 載明 readOnly 選項列、第90條、防寫對照表之 antigravity 列與邊界段(只擋工作區外、真防寫之實測、command 缺一不可、需寫入者之覆寫); 不得再有「是否另收窄工作區待裁示」之過時敘述', function() {
        let t = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
        let r = [
            t.includes('| `readOnly` | Boolean | `false` | **真防寫**（排程第 445 項，第 90 條）：`true` 加 `--settings'),
            t.includes('90. ②**`dispatchAntigravity` 新增選項 `readOnly`（agy 真防寫），內建 5 個 agy 條目皆自帶 `readOnly: true`**'),
            t.includes('| `antigravity` | `readOnly: true`＋`skipPermissions: false` | `readOnly: true` 加 `--settings` 內聯 `permissions.deny: ["write_file(*)", "command(*)"]`'),
            t.includes('③**只 deny `write_file`**：模型改用 shell 繞過而**落地**，故 `command(*)` 缺一不可'),
            t.includes('⑤`readOnly: true` 併 `skipPermissions: true`：仍被擋'),
            t.includes('呼叫 `dispatchAntigravity` 時給 `readOnly: false`（及 `skipPermissions: true`）；內建條目以 `patch` 覆寫 `{ readOnly: false, skipPermissions: true }`'),
            t.includes('`skipPermissions: false` 只擋**工作區外**之寫入'),
            t.includes('是否另收窄工作區（如唯讀副本）待裁示'),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true, false])
    })

    it('R13 程式註解: dispatchAntigravity 檔頭【真防寫】段(只擋工作區外之官方依據、deny 兩條缺一不可、被擋時非空輸出、ACL 唯讀副本與 plan 模式之結論); providers 之 3.8 條目註解載明實測與覆寫方式; Hydrogen 條目 ③ 之「待辦」字樣已改指帳本', function() {
        let s = fs.readFileSync(path.join(ROOT, 'src/dispatchAntigravity.mjs'), 'utf8')
        let p = fs.readFileSync(path.join(ROOT, 'src/providers.mjs'), 'utf8')
        let r = [
            s.includes('【skipPermissions:false 只擋工作區外之寫入; 真防寫用 readOnly(2026-11-24 tdai3, 排程第445項, 帳本R-AGY-5)】'),
            s.includes('**只deny write_file而不deny command時模型改用shell繞過而落地**, 故兩條缺一不可'),
            s.includes('被擋時agy多以ok:true回覆(stdout為模型之說明文字, 非空)'),
            s.includes('已以OS層唯讀工作區(ACL拒絕寫入)驗證亦擋得住') && s.includes('`--mode plan`只於提示詞前加/plan指令'),
            p.includes('需要寫入能力請於條目覆寫skipPermissions為true並把readOnly覆寫為false'),
            p.includes('只deny write_file時模型改用shell繞過而落地(Hydrogen實測), 故command(*)缺一不可'),
            p.includes('2026-11-24起由readOnly:true補上真防寫') && !p.includes('見sgud/state/state_agy.md待辦)'),
            //readOnly須列入OWN_KEYS(execCli對未知鍵不報錯, 行為上無從觀察, 故以原始碼判: 不列則該鍵隨optCli原樣轉傳execCli)
            /let OWN_KEYS = \['exe', 'model', 'effort', 'skipPermissions', 'readOnly', 'printTimeout'/.test(s),
        ]
        assert.strict.deepEqual(r, [true, true, true, true, true, true, true, true])
    })

    it('R11 接縫(不用替身): 內建 agy 條目經 dispatchAiFallback 實際派到假 agy 時, 子行程收到 --settings 與 deny 規則(條目欄位 → 轉接器 → 旗標)', async function() {
        let r = []
        for (let id of ['agy:gemini-3.8-flash-high', 'agy:gemini-4-hydrogen-high', 'agy:gemini-4-argon-high', 'agy:claude-sonnet-5-5-high', 'agy:claude-opus-5-5-high']) {
            let p = providers.find((x) => x.id === id)
            clearAgyStdinSupportCache()
            let t = await dispatchAiFallback('abc', { providers: [{ ...p, exe: fake.exe }], timeoutMs: 30000 })
            let a = t.ok ? JSON.parse(t.stdout).args : []
            let i = a.indexOf('--settings')
            r.push([id, t.ok, a.includes('--dangerously-skip-permissions'), i >= 0 ? JSON.parse(a[i + 1]) : null])
        }
        assert.strict.deepEqual(r, [
            ['agy:gemini-3.8-flash-high', true, false, DENY],
            ['agy:gemini-4-hydrogen-high', true, false, DENY],
            ['agy:gemini-4-argon-high', true, false, DENY],
            ['agy:claude-sonnet-5-5-high', true, false, DENY],
            ['agy:claude-opus-5-5-high', true, false, DENY],
        ])
    })

})
