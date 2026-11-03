// spawnGateWorldForTest.mjs — cliSpawnGate測試用之離散事件模擬世界(假時鐘＋假機器＋假sleep)
//
// 守門之等待、輪詢、預約過期皆與時間有關; 測試以「事件」同步而不以延時: 世界持有假時鐘, 守門之sleep只登記計時器,
// 由測試驅動者(settleAll)在所有呼叫都卡在sleep時才把時鐘推進到最早之計時器——全程不用真實等待, 結果與機器負載無關。
// 假機器: 每次spawn產生一個行程, visibleLagMs之後才「出現在tasklist」(模擬子行程尚未出現之瞬間), lifeMs之後結束;
// maxConcurrent記錄「真實併發」(含尚未出現者)之最大值, 即守門要約束之量。


/**
 * 讓出事件迴圈直到所有微任務清空
 *
 * @returns {Promise} 回傳Promise，於下一個macrotask resolve
 */
function flush() {
    return new Promise((resolve) => setImmediate(resolve))
}


/**
 * 建立模擬世界
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Number} [opt.visibleLagMs=1000] 輸入行程spawn後多久才出現在計數之毫秒數，Infinity代表永不出現
 * @param {Number} [opt.lifeMs=20000] 輸入行程存活毫秒數，Infinity代表永不結束
 * @param {Number} [opt.t0=1000000] 輸入假時鐘起點
 * @returns {Object} 回傳世界物件(now、sleep、countCli、spawn、step、events、stats)
 */
function createWorld(opt = {}) {
    let visibleLagMs = opt.visibleLagMs ?? 1000
    let lifeMs = opt.lifeMs ?? 20000
    let t = opt.t0 ?? 1000000
    let timers = []
    let procs = []
    let world = {
        events: [], //[{ type, id, t }]
        stats: { maxConcurrent: 0, spawned: 0, countCalls: 0 },
        now: () => t,
        sleep: (ms) => new Promise((resolve) => {
            timers.push({ at: t + ms, resolve, seq: timers.length })
        }),
        countCli: async () => {
            world.stats.countCalls++
            return procs.filter((p) => p.visibleAt <= t && p.endAt > t).length
        },
        spawn: (id) => {
            procs.push({ visibleAt: t + visibleLagMs, endAt: t + lifeMs })
            world.stats.spawned++
            let live = procs.filter((p) => p.endAt > t).length
            world.stats.maxConcurrent = Math.max(world.stats.maxConcurrent, live)
            world.events.push({ type: 'spawn', id, t })
        },
        step: () => {
            if (timers.length === 0) {
                return false
            }
            timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
            let x = timers.shift()
            t = Math.max(t, x.at)
            x.resolve()
            return true
        },
        pendingTimers: () => timers.length,
    }
    return world
}


/**
 * 驅動世界直到所有promise落定：每輪先讓出(令微任務清空)，仍有未落定者則把假時鐘推進到最早之計時器；無計時器可推進而仍未落定即為死鎖(拋錯)
 *
 * @param {Object} world 輸入createWorld之回傳
 * @param {Array} promises 輸入待落定之promise陣列(不得reject)
 * @returns {Promise} 回傳Promise，全部落定後resolve
 */
async function settleAll(world, promises) {
    let done = 0
    for (let p of promises) {
        p.then(() => {
            done++
        })
    }
    for (let guard = 0; guard < 100000; guard++) {
        await flush()
        await flush()
        if (done === promises.length) {
            return
        }
        if (!world.step()) {
            throw new Error(`deadlock: ${promises.length - done} promise(s) pending and no timers to advance`)
        }
    }
    throw new Error('settleAll: too many steps')
}


export { createWorld, settleAll, flush }
