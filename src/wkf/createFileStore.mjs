import path from 'path'
import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import fsReadJson from 'wsemi/src/fsReadJson.mjs'
import fsWriteJson from 'wsemi/src/fsWriteJson.mjs'


// createFileStore.mjs — dispatchAiFallback之store的檔案持久化實作
//
// 【為何需要】dispatchAiFallback只定義store契約{get,set}, 預設用行程內記憶體——
//   排程任務每次執行都是獨立行程, 記憶體狀態每次歸零: 金鑰輪替游標永遠從第一把開始,
//   跨次輪替形同失效、額度無法均攤; 供應商冷卻亦然(上一輪已測得失效者, 本輪照樣先踩)。
//   每個跨行程消費端都得重寫這份檔案實作, 收斂於此。
//
// 【採排除式而非白名單式——本設計最重要的一條】本函數只負責「把套件給的state
//   原封不動存下、再原封不動拿回來」, 不理解state內有哪些欄位。使用端殷鑑:
//   曾以白名單只取cursors, 於套件1.0.7新增cooling(供應商冷卻)時被靜默丟棄,
//   cooldownMs形同未啟用——且不會有任何錯誤訊息, 只會「功能沒作用」。
//   排除式(僅剔除本層自用欄位)使日後state再擴充欄位即自動相容。
//
// 【併發假定】與dispatchAiFallback之store文件一致: 假定單行程序列調用,
//   並行執行同一任務請自行加鎖, 否則兩行程互相覆蓋游標。
//
// 【本工廠為同步函數會throw】file與dir皆缺屬設定錯誤, 應於組裝期即失敗(fail fast),
//   與dispatchAiWkf工廠同一約定; 執行期之get/set則不throw(讀壞回空、寫失敗靜默)。


/**
 * 建立dispatchAiFallback之store的檔案持久化(游標與冷卻跨行程有效)
 *
 * 特點：
 * 採排除式passthrough——state原封存還，僅剔除本層自用欄位(預設只有at：人讀的最後更新時間戳)，
 * 日後套件擴充state欄位(如cooling)即自動相容，不需改本函數；
 * 檔案不存在或非法JSON時get回空物件(套件視為全新狀態)；
 * stamp可注入時間戳函數(排程環境建議注入時區錨定者)，寫入時補進at欄位供人工debug
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.file=null] 輸入狀態檔完整路徑字串，與dir/name二擇一
 * @param {String} [opt.dir=null] 輸入狀態目錄字串，與name組成檔案路徑
 * @param {String} [opt.name='ai-cursor.json'] 輸入狀態檔名字串，預設'ai-cursor.json'
 * @param {Array} [opt.ownKeys=['at']] 輸入本層自用、不屬於套件狀態之欄位名字串陣列，get時剔除set時補回，預設['at']
 * @param {Function} [opt.stamp=ISO時間戳] 輸入時間戳函數()=>String，寫入at欄位用，預設回傳new Date().toISOString()
 * @returns {Object} 回傳store物件，內含get、set(可直接餵dispatchAiFallback之store)與file(狀態檔路徑)
 * @example
 *
 * import createFileStore from './src/wkf/createFileStore.mjs'
 * import dispatchAiFallback from './src/dispatchAiFallback.mjs'
 *
 * let store = createFileStore({ dir: './state' })
 * //let r = await dispatchAiFallback(prompt, { providers, store, cooldownMs: 3600000 })
 *
 */
function createFileStore(opt = {}) {
    let file = get(opt, 'file', null)
    if (!isestr(file)) {
        let dir = get(opt, 'dir', null)
        if (!isestr(dir)) {
            throw new Error('createFileStore: file or dir is required')
        }
        let name = get(opt, 'name', null)
        file = path.join(dir, isestr(name) ? name : 'ai-cursor.json')
    }

    let ownKeys = get(opt, 'ownKeys', null)
    if (!isearr(ownKeys)) {
        ownKeys = ['at']
    }

    let stamp = get(opt, 'stamp', null)
    if (!isfun(stamp)) {
        stamp = () => new Date().toISOString()
    }

    return {

        file,

        get: () => {
            let r = fsReadJson(file)
            let j = (get(r, 'error', undefined) !== undefined) ? null : get(r, 'success', null)
            if (!isobj(j)) {
                return {}
            }
            let state = { ...j }
            for (let k of ownKeys) {
                delete state[k]
            }
            return state
        },

        set: (state) => {
            let out = { ...(isobj(state) ? state : {}), at: stamp() }
            fsWriteJson(file, out, { useFormat: true })
        },

    }
}


export default createFileStore
