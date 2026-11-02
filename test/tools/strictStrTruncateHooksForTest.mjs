// strictStrTruncateHooksForTest.mjs — module.register用之resolve hook: 把wsemi之strTruncate.mjs換成嚴格版替身
//
// 以「解析後之URL」比對(而非import字串), 故src內以'wsemi/src/strTruncate.mjs'引入, 或wsemi內部以'./strTruncate.mjs'引入, 皆被替換;
// 替身本身(parentURL為替身)不重導, 避免自我循環。src與wsemi之原始碼一概不改。


let STUB = new URL('./strictStrTruncateForTest.mjs', import.meta.url).href


export async function resolve(specifier, context, nextResolve) {
    let r = await nextResolve(specifier, context)
    if (/\/wsemi\/src\/strTruncate\.mjs$/.test(r.url) && context.parentURL !== STUB) {
        return { url: STUB, format: 'module', shortCircuit: true }
    }
    return r
}
