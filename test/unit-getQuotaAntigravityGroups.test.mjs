import assert from 'assert'
import getQuotaAntigravity from '../src/quota/getQuotaAntigravity.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//帳本: CLAUDE_rulebook.md「agy型錄與額度結構變動之適應…」R-QUOTA-1、R-QUOTA-2
//假agy: --version回1.4.0; -p /usage回給定之command.data(夾具為agy 1.4.0於2026-10-16實測形狀去識別後之結構; 含「假設」者非實測)
let codeAgyData = (data) => `
import fs from 'fs'
let args = process.argv.slice(2)
if (args.includes('--version')) {
    process.stdout.write('1.4.0\\n')
    process.exit(0)
}
let iLog = args.indexOf('--log-file')
if (iLog >= 0) {
    fs.writeFileSync(args[iLog + 1], '[info] applyAuthResult: email=agy-user@example.com, authMethod=consumer\\n', 'utf8')
}
let cmd = args[args.indexOf('-p') + 1]
if (cmd === '/credits') {
    process.stdout.write('{"status":"SUCCESS","num_turns":0,"command":{"name":"credits","data":{"remaining_credits":42,"upgrade_uri":"https://x"}}}\\n')
    process.exit(0)
}
let data = ${JSON.stringify(typeof data === 'string' ? data : JSON.stringify(data))}
process.stdout.write('{"conversation_id":"","status":"SUCCESS","response":"x","num_turns":0,"usage":{},"command":{"name":"usage","data":' + data + '}}\\n')
process.exit(0)
`

let T = '2099-01-03T00:00:00Z'
let bk = (id, window, rf, extra = {}) => ({ id, name: `${id}-name`, window, remaining_fraction: rf, reset_time: T, ...extra })
let gemini = () => ({ name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', buckets: [bk('gemini-weekly', 'weekly', 1), bk('gemini-5h', '5h', 1)] })
let thirdParty = () => ({ name: 'Claude and GPT models', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS', buckets: [bk('3p-weekly', 'weekly', 1), bk('3p-5h', '5h', 1)] })
let argon = () => ({
    name: 'Gemini 4 Argon',
    description: 'For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.',
    buckets: [bk('gemini-argon-wtu-weekly', 'weekly', 0.9888737201690674, { description: 'You have used some of your weekly limit, it will fully refresh in 6 days, 23 hours.' })],
})
let oneBucket = (rf, window = 'weekly') => ({ groups: [{ name: 'G', buckets: [{ id: 'b', name: 'B', window, remaining_fraction: rf, reset_time: T }] }] })


describe('getQuotaAntigravity(群組與桶結構隨agy型錄變動)', function() {

    let fakes = []
    let n = 0
    let query = async (data, opt = {}) => {
        let f = createFakeCli(`fake-agy-grp-${process.pid}-${n++}`, codeAgyData(data))
        fakes.push(f)
        return getQuotaAntigravity('', { exe: f.exe, timeoutMs: 20000, ...opt })
    }
    let rowsOf = (r) => r.windows.map((w) => `${w.key}|${w.label}|${w.windowSeconds}|${w.usedPercent}|${w.remainingPercent}|${w.scope}|${w.severity}`)

    after(function() {
        for (let f of fakes) {
            f.clean()
        }
    })

    it('Pro實測形狀(三群組, Argon群組只有7天窗口且桶自帶description): 每個桶各產一個窗口, 不補造不存在之5小時窗口, 群組與桶之description不進窗口信封而留在raw.usage', async function() {
        //規格: README額度段「群組與窗口由agy依方案決定」(每個有id之桶產出一個窗口; 群組可只有單一窗口, 不補造)與
        //「群組與桶之description不進窗口信封, 於raw.usage.command.data.groups[]取得」
        let r = await query({ description: 'd', groups: [gemini(), thirdParty(), argon()] })
        let w = r.windows.find((x) => x.scope === 'Gemini 4 Argon')
        let rr = [
            r.ok,
            rowsOf(r),
            r.windows.filter((x) => x.scope === 'Gemini 4 Argon').length,
            Object.keys(w).sort(),
            r.raw.usage.command.data.groups[2].description.startsWith('For paid Pro plans'),
            r.raw.usage.command.data.groups[2].buckets[0].description.startsWith('You have used some'),
        ]
        assert.strict.deepEqual(rr, [
            true,
            [
                'gemini-weekly|7天(Gemini Models)|604800|0|100|Gemini Models|normal',
                'gemini-5h|5小時(Gemini Models)|18000|0|100|Gemini Models|normal',
                '3p-weekly|7天(Claude and GPT models)|604800|0|100|Claude and GPT models|normal',
                '3p-5h|5小時(Claude and GPT models)|18000|0|100|Claude and GPT models|normal',
                'gemini-argon-wtu-weekly|7天(Gemini 4 Argon)|604800|1.11|98.89|Gemini 4 Argon|normal',
            ],
            1,
            ['active', 'key', 'label', 'remainingPercent', 'resetAfterSeconds', 'resetAt', 'scope', 'severity', 'usedPercent', 'windowSeconds'],
            true,
            true,
        ])
    })

    it('群組有增減或形狀不一時依實際群組產出窗口, 不回錯: Argon群組缺席(Ultra結構之假設夾具)、群組數增加、只有5小時之群組、無name之群組、含空buckets之群組、groups含null、groups為空陣列、所有群組buckets皆空陣列', async function() {
        //規格: README額度段「某群組缺席不是錯誤; 呼叫端以scope(群組顯示名)尋找所需群組, 找不到須視為未知而非有額度」與
        //「groups為空陣列或所有群組buckets皆空陣列＝agy未回報任何限額(ok、windows為空; 各scope皆缺席＝未知)」
        let cells = [
            [{ groups: [gemini(), thirdParty()] }, 4, ['Gemini Models', 'Claude and GPT models']], //Argon缺席(假設夾具, 非實測Ultra回應)
            [{ groups: [gemini(), thirdParty(), argon(), { name: 'Future X', buckets: [bk('fx-weekly', 'weekly', 0.1)] }, { name: 'Future Y', buckets: [bk('fy-5h', '5h', 0.7), bk('fy-weekly', 'weekly', 0.8)] }] }, 8, ['Gemini Models', 'Claude and GPT models', 'Gemini 4 Argon', 'Future X', 'Future Y']],
            [{ groups: [{ name: 'OnlyFive', buckets: [bk('o-5h', '5h', 0.3)] }] }, 1, ['OnlyFive']],
            [{ groups: [{ buckets: [bk('n-weekly', 'weekly', 0.6)] }] }, 1, null], //無name之群組: 只驗窗口照出, 不比較其scope
            [{ groups: [{ name: 'Empty', buckets: [] }, gemini()] }, 2, ['Gemini Models']],
            [{ groups: [null, gemini()] }, 2, ['Gemini Models']],
            [{ groups: [] }, 0, []],
            [{ groups: [{ name: 'Empty1', buckets: [] }, { name: 'Empty2', buckets: [] }] }, 0, []], //結構完整、與groups空陣列同為「未回報限額」
        ]
        let rr = []
        for (let [data] of cells) {
            let r = await query(data)
            rr.push([r.ok, r.errorType, r.windows.length, r.windows.map((w) => w.scope).filter((s, i, a) => a.indexOf(s) === i)])
        }
        assert.strict.deepEqual(rr.map((x) => x.slice(0, 3)), cells.map((c) => [true, '', c[1]]))
        assert.strict.deepEqual(rr.map((x, i) => (cells[i][2] === null ? null : x[3])), cells.map((c) => c[2]))
    })

    it('格式漂移(無groups陣列、無任何群組帶buckets陣列、或有桶卻一個窗口也讀不出, 如groups/buckets/id改名)時回ok:false且errorType為parse並附診斷訊息, 不靜默回ok:true與0個窗口; withCredits時已查得之點數仍保留', async function() {
        //規格: README額度段「回應無groups陣列、有群組卻無任何群組帶buckets陣列、或有桶卻一個窗口也讀不出, 視為格式已變, errorType為parse」; 帳本R-QUOTA-2(以結構辨識與否判, 不釘錯誤訊息片語)
        let rr = []
        for (let data of [
            { description: 'no groups key' },
            { groups: {} },
            { quota_groups: [gemini()] }, //groups改名
            { groups: [{ name: 'G', limits: [bk('x', 'weekly', 0.5)] }] }, //buckets改名
            { groups: [{ name: 'G', buckets: {} }] }, //buckets型別變了
            { groups: [{ name: 'G', buckets: [{ bucket_id: 'x', window: 'weekly', remaining_fraction: 0.5 }] }] }, //id改名
            { groups: [null] },
        ]) {
            let r = await query(data)
            rr.push([r.ok, r.errorType, r.windows.length, typeof r.error === 'string' && r.error !== ''])
        }
        assert.strict.deepEqual(rr, Array(7).fill([false, 'parse', 0, true]))

        //withCredits: /credits已於漂移判定前查得, parse結果仍帶credits與raw.credits
        let rc = await query({ groups: {} }, { withCredits: true })
        assert.strict.deepEqual([rc.ok, rc.errorType, rc.credits, rc.raw.credits !== null && rc.raw.credits !== undefined], [false, 'parse', { remainingCredits: 42, upgradeUri: 'https://x' }, true])
    })

    it('remaining_fraction無法解讀(非數值字串、非十進位字串、null、缺鍵、Infinity字串、JSON之1e400與-1e400)時usedPercent與remainingPercent為null、severity為空字串, 不假造「剩餘100%」「已用100%」也不標normal; disabled:true者仍為disabled', async function() {
        //規格: toQuotaWindow檔頭「未知時兩者皆為null(不假造100)」與severity「usedPercent未知則空字串」; README額度段severity句「用罄exhausted／其餘normal／usedPercent未知則空字串; 桶disabled:true為disabled」; 帳本R-QUOTA-2
        let rr = []
        for (let data of [oneBucket('abc'), oneBucket('50%'), oneBucket(null), oneBucket(''), oneBucket('Infinity'), oneBucket('NaN'), oneBucket('0x10'), oneBucket('0o7'), oneBucket('0b1'), '{"groups":[{"name":"G","buckets":[{"id":"b","window":"weekly","remaining_fraction":1e400}]}]}', '{"groups":[{"name":"G","buckets":[{"id":"b","window":"weekly","remaining_fraction":-1e400}]}]}', { groups: [{ name: 'G', buckets: [{ id: 'b', window: 'weekly' }] }] }]) {
            let r = await query(data)
            let w = r.windows[0]
            rr.push([w.usedPercent, w.remainingPercent, w.severity])
        }
        assert.strict.deepEqual(rr, Array(12).fill([null, null, '']))

        //停用優先於未知與用罄
        let rd = []
        for (let rf of [null, 'Infinity', 0, 0.5]) {
            let r = await query({ groups: [{ name: 'G', buckets: [{ id: 'b', window: 'weekly', remaining_fraction: rf, disabled: true }] }] })
            rd.push(r.windows[0].severity)
        }
        assert.strict.deepEqual(rd, ['disabled', 'disabled', 'disabled', 'disabled'])
    })

    it('remaining_fraction越界夾至0~100(1.7→剩餘100%、1e306→剩餘100%而非溢位成未知、-0.2→已用100%且exhausted); 剩餘0→exhausted, 字串型比例亦可', async function() {
        //規格: toQuotaWindow檔頭「usedPercent夾至0~100」; severity「用罄為exhausted」
        let rr = []
        for (let rf of [1.7, 1e306, -1e306, -0.2, 0, '0.25']) {
            let r = await query(oneBucket(rf))
            let w = r.windows[0]
            rr.push([w.usedPercent, w.remainingPercent, w.severity])
        }
        assert.strict.deepEqual(rr, [[0, 100, 'normal'], [0, 100, 'normal'], [100, 0, 'exhausted'], [100, 0, 'exhausted'], [100, 0, 'exhausted'], [75, 25, 'normal']])
    })

    it('window字串無法推得秒數(monthly、1w、空、null)時windowSeconds為null、標籤退回桶名; 可推得者(weekly、5h、7d、168h)照推', async function() {
        //規格: README額度段「window字串可解析為秒數者推得windowSeconds與標籤, 否則windowSeconds為null、標籤退回桶name」
        let rr = []
        for (let win of ['monthly', '1w', '', null, 'weekly', '5h', '7d', '168h']) {
            let r = await query(oneBucket(0.5, win))
            rr.push([r.windows[0].windowSeconds, r.windows[0].label])
        }
        assert.strict.deepEqual(rr, [
            [null, 'B(G)'], [null, 'B(G)'], [null, 'B(G)'], [null, 'B(G)'],
            [604800, '7天(G)'], [18000, '5小時(G)'], [604800, '7天(G)'], [604800, '7天(G)'],
        ])
    })

})
