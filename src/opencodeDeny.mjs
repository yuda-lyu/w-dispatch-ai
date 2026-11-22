import isestr from 'wsemi/src/isestr.mjs'


// opencodeDeny.mjs — opencode之`ask`權限被自動拒絕(整個工作階段結束、離開碼仍為0)之判讀(2026-11-22 排程第454項; 帳本R-OCDENY-1)
//
// 【現象(2026-11-13實測, 技能dispatch-opencode〈ask被自動拒絕＝整個工作階段結束〉; opencode 1.19.5)】`opencode run`未加--auto時, 收到權限詢問(ask)即自動拒絕,
//   stderr印`permission requested: <類別> (<樣式>); auto-rejecting`, 工具端得`PermissionRejectedError`('The user rejected permission to use this specific tool call.');
//   工作階段處理器於該步驟結束後即停止(不再進下一步), 模型沒機會回最後一句話, 離開碼0——轉接器修前多半回ok:true(空回覆被validate:'nonempty'擋下者為validation),
//   與「權限不足是exit 0之假成功」同型。規則明訂deny者之錯誤為另一種(PermissionDeniedError, 訊息'The user has specified a rule…'), 不設blocked、工作階段續跑, 不屬此類。
//   `config.experimental.continue_loop_on_deny: true`可令被拒只把錯誤交回模型、工作階段續跑(本套件opt.continueLoopOnDeny併入注入之config, 預設不開)。
//
// 【兩種判讀來源(皆不執行任何外部程式、不讀日誌檔)】
//   ①事件流(`--format json`, opt.detectTruncation時由轉接器自加或呼叫端自給): 最後一筆事件為step_finish、其reason為tool-calls、該步內有status為error且訊息含`rejected permission`之tool_use——
//      精確(自行續跑者之最後一步為stop, 不誤判); 判讀見parseOpencodeEvents.mjs之denied欄。
//   ②stderr之簽章行(本檔createDenyWatch): 預設輸出格式下由stderr逐行判讀; 只在「stdout為空」時採信(模型沒機會回話)——stdout非空者可能是續跑(如使用者自己之opencode設定已開continue_loop_on_deny)而不誤判。
//
// 【處置】判定被拒結束者, 失敗結果改標errorType 'denied'(error以'PERMISSION_DENIED:'開頭, 另帶failureDetail與deniedTool／deniedRule): 屬規則決定(同規則下模型再發同樣之呼叫必被拒),
//   與金鑰無關、同一請求換金鑰必然再被拒——遞補層整組跳過、改派下一條目。唯讀條目(OC_READONLY: edit deny、bash ask)不加continueLoopOnDeny:
//   加了則被鎖擋下之回覆變成「看似成功」而遞補鏈不換家(技能所載之實測)。


//簽章行: `permission requested: <類別> (<樣式>); auto-rejecting`(類別為英數與底線; 樣式可含括號)
let RE_DENY_LINE = /permission requested:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\((.*)\)\s*;\s*auto-rejecting/

//ANSI色碼(刻意比對控制字元ESC以去除色碼)
// eslint-disable-next-line no-control-regex
let RE_ANSI = /\u001b\[[0-9;]*m/g

//單行與緩衝上限(逐行判讀, 超長行不判)
let LINE_MAX = 4000


/**
 * 判讀單一行是否為「ask被自動拒絕」之簽章行
 *
 * @param {String} line 輸入一行文字(可含ANSI色碼)
 * @returns {Object|null} 回傳{ category, pattern }(類別與樣式字串)，非簽章行回傳null
 * @example
 *
 * import { parseDenyLine } from './src/opencodeDeny.mjs'
 *
 * console.log(parseDenyLine('permission requested: external_directory (C:/x/*); auto-rejecting'))
 * // => { category: 'external_directory', pattern: 'C:/x/*' }
 *
 * console.log(parseDenyLine('Error: something else'))
 * // => null
 *
 */
function parseDenyLine(line) {
    if (!isestr(line) || line.length > LINE_MAX) {
        return null
    }
    let m = RE_DENY_LINE.exec(line.replace(RE_ANSI, ''))
    if (m === null) {
        return null
    }
    return { category: m[1], pattern: m[2].trim() }
}


/**
 * 建立stderr簽章監看器：逐區塊餵入(push)，跨區塊之行於收到換行時才判；結束時(hit)並判殘留之末行
 *
 * 只記第一個簽章行；reset於每次嘗試(spawn)前呼叫
 *
 * @returns {Object} 回傳物件，內含push(str)、reset()、hit()(回傳{ category, pattern }或null)
 */
function createDenyWatch() {
    let buf = ''
    let found = null
    let feed = (line) => {
        if (found === null) {
            found = parseDenyLine(line)
        }
    }
    return {
        push: (str) => {
            if (!isestr(str) || found !== null) {
                return
            }
            buf += str
            let i = buf.search(/\r?\n/)
            while (i >= 0) {
                let p = parseDenyLine(buf.slice(0, i))
                buf = buf.slice(buf.indexOf('\n', i) + 1)
                if (p !== null) {
                    found = p
                    break
                }
                i = buf.search(/\r?\n/)
            }
            if (buf.length > LINE_MAX) {
                buf = buf.slice(-LINE_MAX) //未換行之超長殘留只留尾端, 不無限累積
            }
        },
        reset: () => {
            buf = ''
            found = null
        },
        hit: () => {
            if (found === null && buf !== '') {
                feed(buf)
            }
            return found
        },
    }
}


export { parseDenyLine, createDenyWatch }
