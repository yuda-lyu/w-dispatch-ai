// recordExecCliForTest.mjs — wsemi execCli之記錄替身(測試用, 不spawn子進程)
//
// 經module.register之resolve hook(recordExecCliHooksForTest.mjs)換入src內之execCli, 於子行程探針(probeTimeoutSitesForTest.mjs)使用:
// 每次被呼叫記錄「收到之opt.timeoutMs」與args(globalThis.__recordExecCli), 回傳一個成功結果令呼叫端流程走完。
// 目的: 觀察各入口「實際交給execCli之timeoutMs」(execCli真實之判定在wsemi內, 此處只記錄交來之值), 不必等逾時真的發生。


let state = globalThis.__recordExecCli ?? { calls: [] }
globalThis.__recordExecCli = state


async function execCli(exe, args, opt) {
    let has = opt !== null && opt !== undefined && Object.prototype.hasOwnProperty.call(opt, 'timeoutMs')
    state.calls.push({ exe, args: Array.isArray(args) ? args : null, has, timeoutMs: has ? opt.timeoutMs : null })
    //--version回合法版本字串(令版本把關通過, 流程走到實際呼叫處), 其餘回'x'
    let isVer = Array.isArray(args) && args.includes('--version')
    return { ok: true, stdout: isVer ? '1.5.7' : 'x', stderr: '', code: 0, durationMs: 1, pid: 1 }
}


export function getState() {
    return state
}


export default execCli
