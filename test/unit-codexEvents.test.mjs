import assert from 'assert'
import fs from 'fs'
import path from 'path'
import dispatchCodex from '../src/dispatchCodex.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// unit-codexEvents.test.mjs — codex帶`--json`時結果保留命令事件(raw、commands; 比照agy之raw)(排程第448項③; 帳本R-CODEX-2)
//
// 規格來源: 技能dispatch-codex〈輸出〉〈中文檔案〉節(0.167.0實測)與主控裁示(第448項③): 派工加`--json`時, 事件流之`item.completed`(command_execution)之`aggregated_output`
//   即Codex實際收到之命令輸出; 審查回覆之引用與原文不符時須能據以分辨「讀檔失真」或「模型引用錯」。
//   S1 帶--json(extraArgs)時結果另帶raw(該次嘗試之完整事件流文字)與commands(各命令完成事件: id、command、exitCode、status、output、outputTruncated); stdout本身不改(既有JSONL之使用者不受影響)。
//   S2 失敗結果(離開碼非0, stdout被execCli裁到500字元)亦帶完整raw與commands。
//   S3 未帶--json、或stdout非事件流者不加raw與commands(結果形狀同修前)。
//   S4 只取item.completed之command_execution(item.started之輸出為空、agent_message等略過); 非JSON行略過; 中文與換行原樣保留。
//   S5 execCli依maxRetries內部重試(各次嘗試之輸出累積在同一份stdout)時, raw為累積全文、commands只取最後一次嘗試(以thread.started為界); 呼叫端自給之onStdout照常收到全部輸出。
// 假CLI: 依--scn=<名>與是否帶--json輸出; --counter=<檔>記呼叫次數。


let ENTRY = `
import fs from 'node:fs'
let args = process.argv.slice(2)
let arg = (p) => {
    let a = args.find((x) => x.startsWith(p))
    return a ? a.slice(p.length) : ''
}
let scn = arg('--scn=')
let counter = arg('--counter=')
let json = args.includes('--json')
let n = 0
if (counter) {
    try {
        n = Number(fs.readFileSync(counter, 'utf8'))
    }
    catch {}
    fs.writeFileSync(counter, String(n + 1))
}
let line = (o) => JSON.stringify(o)
let cmdStart = (id, command) => line({ type: 'item.started', item: { id, type: 'command_execution', command, aggregated_output: '', exit_code: null, status: 'in_progress' } })
let cmdDone = (id, command, output, code) => line({ type: 'item.completed', item: { id, type: 'command_execution', command, aggregated_output: output, exit_code: code, status: code === 0 ? 'completed' : 'failed' } })
let msg = (id, text) => line({ type: 'item.completed', item: { id, type: 'agent_message', text } })
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    let out = []
    let code = 0
    if (scn === 'eventlike') {
        out.push(line({ type: 'thread.started', thread_id: 't1' }), cmdDone('i0', 'echo not-a-real-event-stream', 'x', 0)) //不論有無--json皆輸出事件形狀之行(模型之最終答案恰為JSONL之情形)
    }
    else if (!json) {
        out.push('final answer text')
    }
    else if (scn === 'two-cmds') {
        out.push(line({ type: 'thread.started', thread_id: 't1' }), line({ type: 'turn.started' }))
        out.push(cmdStart('i0', 'rg -n "" a.txt'), cmdDone('i0', 'rg -n "" a.txt', '1:第一行中文\\n2:second line\\n', 0))
        out.push(cmdStart('i1', 'cmd /c type b.txt'), cmdDone('i1', 'cmd /c type b.txt', '', 1))
        out.push(msg('i2', 'the answer'), line({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }))
    }
    else if (scn === 'fail-long') {
        out.push(line({ type: 'thread.started', thread_id: 't1' }), cmdDone('i0', 'rg -n x big.txt', 'X'.repeat(3000) + '-END', 0))
        code = 1
    }
    else if (scn === 'retry') {
        if (n === 0) {
            out.push(line({ type: 'thread.started', thread_id: 'first' }), cmdDone('first', 'first attempt cmd', 'old output', 0))
            code = 1
        }
        else {
            out.push(line({ type: 'thread.started', thread_id: 'second' }), cmdDone('second', 'second attempt cmd', 'new output', 0), msg('m', 'ok'))
        }
    }
    else if (scn === 'twice') {
        let who = n === 0 ? 'first' : 'second'
        out.push(line({ type: 'thread.started', thread_id: who }), cmdDone(who, who + ' attempt cmd', n === 0 ? 'old output' : 'new output', 0))
    }
    else if (scn === 'noise') {
        out.push('not json at all', '{"type":"unknown.kind"}', '[1,2]', '{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}')
    }
    else {
        out.push('plain text, not an event stream')
    }
    if (out.length > 0) {
        process.stdout.write(out.join('\\n') + '\\n')
    }
    process.exit(code)
})
`


describe('codex --json 時結果保留命令事件(排程第448項③)', function() {

    this.timeout(60000)

    let fake = null
    let seq = 0
    before(function() {
        fake = createFakeCli('fake-codex-events', ENTRY)
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let call = (scn, opt = {}, extra = []) => dispatchCodex('abc', { exe: fake.exe, extraArgs: [...extra, `--scn=${scn}`], ...opt })

    it('S1 帶--json: 結果另帶raw(完整事件流)與commands(僅item.completed之command_execution; item.started、agent_message等略過); stdout不改; 中文與換行原樣保留; 修前無raw與commands', async function() {
        let r = await call('two-cmds', {}, ['--json'])
        assert.strict.deepEqual(r.ok, true)
        assert.strict.deepEqual(r.raw, r.stdout) //成功時stdout即整串JSONL(未改), raw與其逐字相同
        assert.strict.deepEqual(r.commands, [
            { id: 'i0', command: 'rg -n "" a.txt', exitCode: 0, status: 'completed', output: '1:第一行中文\n2:second line\n', outputTruncated: false },
            { id: 'i1', command: 'cmd /c type b.txt', exitCode: 1, status: 'failed', output: '', outputTruncated: false },
        ])
    })

    it('S2 失敗(離開碼1, stdout被execCli裁到500字元): 仍帶完整raw與commands(輸出3000字元不被裁)', async function() {
        let r = await call('fail-long', {}, ['--json'])
        assert.strict.deepEqual([r.ok, r.stdout.length < 700, r.raw.length > 3000, r.raw.endsWith('\n'), r.commands.length, r.commands[0].output.length], [false, true, true, true, 1, 3004])
        assert.strict.deepEqual([r.commands[0].command, r.commands[0].exitCode], ['rg -n x big.txt', 0])
    })

    it('S3 未帶--json、或stdout非事件流者不加raw與commands(結果形狀同修前)', async function() {
        let a = await call('two-cmds')
        let b = await call('plain', {}, ['--json'])
        assert.strict.deepEqual([a.ok, 'raw' in a, 'commands' in a, a.stdout.trim()], [true, false, false, 'final answer text'])
        assert.strict.deepEqual([b.ok, 'raw' in b, 'commands' in b], [true, false, false])
        let c = await call('eventlike') //未帶--json: 即使stdout恰為事件形狀之文字(最終答案本身是JSONL)亦完全不介入(結果形狀同修前; 變異X06: 不論有無--json一律介入而存活之補測)
        assert.strict.deepEqual([c.ok, c.stdout.includes('thread.started'), 'raw' in c, 'commands' in c], [true, true, false, false])
    })

    it('S4 非JSON行、未知類型、非物件行略過; 事件流僅含非命令事件者commands為空陣列(仍帶raw)', async function() {
        let r = await call('noise', {}, ['--json'])
        assert.strict.deepEqual([r.ok, r.commands, r.raw.includes('not json at all')], [true, [], true])
    })

    it('S5 重試(execCli依maxRetries內部重試, 輸出累積在同一份stdout): commands只取最後一次嘗試(以thread.started為界), raw為累積全文; 呼叫端自給之onStdout照常收到全部輸出(兩次嘗試之文字皆經過)', async function() {
        let counter = path.join(fake.fd, `counter-${++seq}.txt`)
        let seen = ''
        let onStdout = (s) => {
            seen += s
        }
        let r = await call('retry', { maxRetries: 1, retryDelayMs: 1, onStdout }, ['--json', `--counter=${counter}`])
        assert.strict.deepEqual([r.ok, r.attempts, r.commands.map((c) => c.command), r.raw.includes('old output'), r.raw.includes('new output')], [true, 2, ['second attempt cmd'], true, true])
        assert.strict.deepEqual([seen.includes('old output'), seen.includes('new output')], [true, true])
        assert.strict.deepEqual(Number(fs.readFileSync(counter, 'utf8')), 2)
    })

    it('S6 驗證不過而由本層重新呼叫execCli(每次呼叫各有獨立之stdout): raw與commands只含最後一次呼叫之事件流(前次之累積不混入; 變異X05: 未於每次結果後重置累積器而存活)', async function() {
        let counter = path.join(fake.fd, `counter-${++seq}.txt`)
        let r = await call('twice', { maxRetries: 1, retryDelayMs: 1, validate: (s) => s.includes('"second"') }, ['--json', `--counter=${counter}`])
        assert.strict.deepEqual([r.ok, Number(fs.readFileSync(counter, 'utf8'))], [true, 2])
        assert.strict.deepEqual([r.commands.map((c) => c.command), r.raw.includes('old output'), r.raw.includes('new output'), r.raw === r.stdout], [['second attempt cmd'], false, true, true])
    })

})
