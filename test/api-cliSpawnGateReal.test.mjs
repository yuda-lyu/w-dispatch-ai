import assert from 'assert'
import cliSpawnGate, { createCountCli, createGateState } from '../src/cliSpawnGate.mjs'


// 規格來源: Gitea #67 §4(實機驗證: 數機器上實際存在之行程)、主控派工單〈必要之測試〉。
//   本檔不注入任何探針: 以本機真實之tasklist(Windows)或ps(其他)數「本測試行程自己(node)」, 驗預設實作確實能數到真實行程、RAM與CPU取樣在0~1之間。
//   為api-層(接縫: 真實外部指令); 環境無tasklist／ps時略過(守門本身於該情形為fail-open, 見unit-cliSpawnGate)。


let NODE_IMAGE = process.platform === 'win32' ? 'node.exe' : 'node'


describe('cliSpawnGate之預設探針(真實tasklist／ps)', function() {

    this.timeout(60000)

    it('createCountCli預設實作: 數得到本測試行程自己(node image至少1個); 不存在之image為0', async function() {
        let count = createCountCli()
        let n = 0
        try {
            n = await count([NODE_IMAGE])
        }
        catch (err) {
            if (err && err.code === 'ENOENT') {
                this.skip() //環境無tasklist／ps
            }
            throw err
        }
        let none = await count(['definitely-not-a-process-xyz'])
        assert.strict.deepEqual([Number.isInteger(n) && n >= 1, none], [true, 0])
    })

    it('真實行程數達maxCli 1而被擋, 逾時fail-open放行(real timers小值; 以onTrace事件判定首次檢查之內容)', async function() {
        let events = []
        let r = await cliSpawnGate({
            kind: 'opencode',
            spawnGate: { images: [NODE_IMAGE], maxCli: 1, ramUsedMax: false, cpuMax: false, pollMs: 30, gateWaitMaxMs: 120, state: createGateState(), ticketDir: false, onTrace: (e) => events.push(e) },
        })
        let first = events.find((e) => e.type === 'check')
        if (events.some((e) => e.type === 'probe-fail')) {
            this.skip() //環境無tasklist／ps: 探針失敗已fail-open(見unit-cliSpawnGate)
        }
        assert.strict.deepEqual([first.pass, first.blockedBy, first.visible >= 1, r.outcome, r.failOpen], [false, 'count', true, 'fail-open', true])
    })

    it('image不存在時行程數為0, 直接放行', async function() {
        let events = []
        let r = await cliSpawnGate({
            kind: 'opencode',
            spawnGate: { images: ['definitely-not-a-process-xyz'], maxCli: 1, ramUsedMax: false, cpuMax: false, state: createGateState(), ticketDir: false, onTrace: (e) => events.push(e) },
        })
        if (events.some((e) => e.type === 'probe-fail')) {
            this.skip()
        }
        assert.strict.deepEqual([r.outcome, r.snapshot.cli], ['pass', 0])
    })

    it('預設RAM與CPU取樣皆回0~1之數值(門檻設為1使其不擋), 首次CPU取樣付約1秒', async function() {
        let r = await cliSpawnGate({
            kind: 'opencode',
            spawnGate: { maxCli: false, ramUsedMax: 1, cpuMax: 1, state: createGateState() },
        })
        let okRatio = (v) => typeof v === 'number' && v >= 0 && v <= 1
        assert.strict.deepEqual([r.outcome, okRatio(r.snapshot.ram), okRatio(r.snapshot.cpu)], ['pass', true, true])
    })
})
