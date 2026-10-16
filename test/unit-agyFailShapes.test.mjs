import assert from 'assert'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import providers from '../src/providers.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//帳本: CLAUDE_rulebook.md「agy型錄與額度結構變動之適應…」R-AGY-1、R-AGY-3
//假agy: 重現agy 1.4.0於2026-10-16本機實測之非成功結局形狀(皆為實測形狀, 非臆造; 額度用罄之輸出未能觸發, 不在此列)
//  perm     權限閘門擋下寫入: exit 0、stdout空、stderr為「jetski: no output produced — ...」
//  badmodel 未知模型: exit 1、stderr為「error: invalid model selection ...」
//  ok       正常: exit 0、stdout有內容
let codeAgy = (mode) => `
let mode = '${mode}'
if (mode === 'perm') {
    process.stderr.write('jetski: no output produced \\u2014 a tool required the "write_file" permission that headless mode cannot prompt for, so it was auto-denied.\\n')
    process.exit(0)
}
if (mode === 'badmodel') {
    process.stderr.write('error: invalid model selection (--model "x" --effort ""): model x is not recognized as a known model or custom model in settings\\nAvailable models:\\n  Gemini 4 Argon (Medium)\\n')
    process.exit(1)
}
if (mode === 'slow') {
    //理會--print-timeout之假agy(重現agy 1.4.0自身逾時: exit 0、stdout為已產出之部分、stderr為說明); 自然耗時由提示詞之natural=<秒>給定
    let args = process.argv.slice(2)
    let P = Number(String(args[args.indexOf('--print-timeout') + 1]).replace(/s$/, ''))
    let D = Number((String(args[args.indexOf('--print') + 1]).match(/natural=(\\d+)/) || [0, 0])[1])
    let k = 0
    let tick = setInterval(() => { k++; process.stdout.write(k + '\\n') }, 1000)
    setTimeout(() => { clearInterval(tick); process.stdout.write('DONE\\n'); process.exit(0) }, D * 1000)
    setTimeout(() => { clearInterval(tick); process.stderr.write('[agy] print timeout after ' + P + 's with turn in progress; returning partial output\\n'); process.exit(0) }, P * 1000)
}
else {
    process.stdout.write('OK-FROM-NEXT\\n')
    process.exit(0)
}
`


describe('agy條目之非成功結局形狀(agy 1.4.0實測)與內建條目規則', function() {

    let fakes = {}
    before(function() {
        for (let m of ['perm', 'badmodel', 'ok', 'slow']) {
            fakes[m] = createFakeCli(`fake-agy-shape-${process.pid}-${m}`, codeAgy(m))
        }
    })
    after(function() {
        for (let m of Object.keys(fakes)) {
            fakes[m].clean()
        }
    })

    let chain = (mode) => [
        { id: 'agy:first', kind: 'antigravity', exe: fakes[mode].exe, model: 'x', skipPermissions: false, addDirs: ['.'] },
        { id: 'agy:next', kind: 'antigravity', exe: fakes.ok.exe, model: 'y', skipPermissions: false, addDirs: ['.'] },
    ]

    it('權限閘門擋下寫入(ok:true且stdout空): 無validate時視為成功不遞補, stderr保留agy之說明; 帶validate:nonempty時整組跳過(errorType validation)而由下一家接手', async function() {
        //規格: README防寫機制段「被權限閘門擋下寫入時回ok: true且stdout為空」「工作流層無害(空回覆過不了validate而自動遞補)」與「agy 1.4.0起stderr帶說明」
        let r0 = await dispatchAiFallback('x', { providers: chain('perm'), timeoutMs: 20000 })
        let r1 = await dispatchAiFallback('x', { providers: chain('perm'), timeoutMs: 20000, validate: 'nonempty' })
        let d = await dispatchAntigravity('x', { exe: fakes.perm.exe, skipPermissions: false, timeoutMs: 20000 })
        let rr = [
            [r0.ok, r0.providerId, r0.stdout, r0.tried.map((t) => t.outcome)],
            [r1.ok, r1.providerId, r1.stdout.trim(), r1.tried.map((t) => `${t.providerId}/${t.outcome}/${t.errorType || ''}`)],
            [d.ok, d.code, d.stdout, /^jetski: no output produced/.test(d.stderr)],
        ]
        assert.strict.deepEqual(rr, [
            [true, 'agy:first', '', ['ok']],
            [true, 'agy:next', 'OK-FROM-NEXT', ['agy:first/skip-group/validation', 'agy:next/ok/']],
            [true, 0, '', true],
        ])
    })

    it('未知模型(exit 1, stderr為error: invalid model selection): errorType為exec、code為1, 由下一家接手', async function() {
        //規格: README errorType表exec列(CLI已啟動而非零離開)
        let d = await dispatchAntigravity('x', { exe: fakes.badmodel.exe, skipPermissions: false, timeoutMs: 20000 })
        let r = await dispatchAiFallback('x', { providers: chain('badmodel'), timeoutMs: 20000 })
        let rr = [
            [d.ok, d.code, d.errorType, /^error: invalid model selection/.test(d.stderr)],
            [r.ok, r.providerId, r.tried.map((t) => `${t.providerId}/${t.outcome}/${t.errorType || ''}`)],
        ]
        assert.strict.deepEqual(rr, [
            [false, 1, 'exec', true],
            [true, 'agy:next', ['agy:first/next-key/exec', 'agy:next/ok/']],
        ])
    })

    it('慢回合(timeoutMs=40000, 假agy理會--print-timeout): 自然耗時35秒者完整成功(不被agy自身逾時截斷); 自然耗時50秒者由外層先逾時, 為TIMEOUT失敗、整組跳過並寫入冷卻', async function() {
        //規格: README行為變更紀錄1.0.50起第32條(自然耗時介於舊內層截止點與timeoutMs者由部分輸出改為完整成功; 達timeoutMs者由「部分輸出ok:true」改為TIMEOUT失敗)與
        //printTimeout列(自動＝timeoutMs＋30s, 令外層先逾時; 有明給id且cooldownMs>0才記冷卻); 帳本R-AGY-2。
        //修前(推導為max(30, timeoutMs/1000−30)＝30秒): 兩者皆於30秒被agy自身截斷而回ok:true之部分輸出
        this.timeout(120000)
        let run = async (natural) => {
            let store = { s: { cursors: {}, cooling: {} } }
            let r = await dispatchAiFallback(`natural=${natural}`, {
                providers: [{ id: 'agy:slow', kind: 'antigravity', exe: fakes.slow.exe, model: 'x', skipPermissions: false, addDirs: ['.'] }],
                timeoutMs: 40000,
                cooldownMs: 60000,
                store: { get: () => store.s, set: (s) => { store.s = s } },
            })
            return { r, cooling: Object.keys(store.s.cooling) }
        }
        let [a, b] = await Promise.all([run(35), run(50)])
        let rr = [
            [a.r.ok, a.r.stdout.trim().split('\n').pop(), a.r.tried.map((t) => t.outcome), a.cooling],
            [b.r.ok, b.r.errorType, b.r.tried.map((t) => `${t.outcome}/${t.errorType || ''}`), b.cooling],
        ]
        assert.strict.deepEqual(rr, [
            [true, 'DONE', ['ok'], []],
            [false, 'timeout', ['skip-group/timeout'], ['agy:slow']],
        ])
    })

    it('內建agy條目之id為「agy:」加model(id命名規則), 含Gemini 4 Argon條目且排在Gemini 3.8條目之後、claude條目之前, 自帶防寫與addDirs', function() {
        //規格: providers.mjs檔頭【id命名】與README行為變更紀錄1.0.50起第31條(新增agy:gemini-4-argon-high, 排在agy:gemini-3.8-flash-high之後, 不取代)
        let ids = providers.map((p) => p.id)
        let agy = providers.filter((p) => p.kind === 'antigravity')
        let iArgon = ids.indexOf('agy:gemini-4-argon-high')
        let rr = [
            agy.every((p) => p.id === `agy:${p.model}`),
            ids.includes('agy:gemini-3.8-flash-high'), //下游w-knowledge-extract以此id引用, 不得刪除
            iArgon > ids.indexOf('agy:gemini-3.8-flash-high'),
            iArgon < ids.indexOf('agy:claude-sonnet-5-5-high'),
            iArgon >= 0 ? [providers[iArgon].model, providers[iArgon].skipPermissions, providers[iArgon].addDirs] : null,
        ]
        assert.strict.deepEqual(rr, [true, true, true, true, ['gemini-4-argon-high', false, ['.']]])
    })

})
