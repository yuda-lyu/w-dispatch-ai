// recordExecCliHooksForTest.mjs — module.register用之resolve hook: 把wsemi之execCli.mjs換成記錄替身
//
// 以「解析後之URL」比對(src以'wsemi/src/execCli.mjs'引入者皆被替換); 替身本身(parentURL為替身)不重導。src與wsemi之原始碼一概不改。


let STUB = new URL('./recordExecCliForTest.mjs', import.meta.url).href


export async function resolve(specifier, context, nextResolve) {
    let r = await nextResolve(specifier, context)
    if (/\/wsemi\/src\/execCli\.mjs$/.test(r.url) && context.parentURL !== STUB) {
        return { url: STUB, format: 'module', shortCircuit: true }
    }
    return r
}
