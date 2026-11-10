import fs from 'fs'
import path from 'path'
import get from 'lodash-es/get.js'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import fsReadJson from 'wsemi/src/fsReadJson.mjs'
import fsWriteJson from 'wsemi/src/fsWriteJson.mjs'
import { callHookSync } from '../callUserFn.mjs'


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
// 【同一行程同一檔案共用一個狀態物件(2026-11-11 da402 DA-10)】修前每次get皆讀檔回新物件, 同一行程內並行之呼叫(如runFanout之各席位、
//   多個createAiCaller共用同一狀態檔)各持舊快照整份寫回: 冷卻加長之n、持久連敗會遺失, 已刪之紀錄會被後寫者復活。
//   改為以檔案絕對路徑為鍵之行程內共用物件: get恆回同一物件(並行之呼叫就地修改), set把外來副本之鍵併入該物件(不整份取代)後寫檔。
//   檔案於本行程之外被改動或刪除(以最後一次讀寫後之mtime與大小比對)時, 下一次get重讀並就地換掉該物件之內容(持有者看到新內容)。
//   跨行程仍為上述之「單行程」假設(兩行程同時寫同一檔仍互相覆蓋)。已知限制: 行程外之改寫若恰與本行程最後一次寫入之mtime與大小皆相同則察覺不到;
//   set收到「非get所回之物件」(呼叫端自行複製之副本)時以其頂層鍵併入共用物件, 副本缺少之頂層鍵不刪除, 副本若帶舊之巢狀物件(如整份cooling)則以之取代該鍵。
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
 * @param {Function} [opt.stamp=ISO時間戳] 輸入時間戳函數()=>String，寫入at欄位用，須為同步函數且回傳可JSON序列化之值(拋錯、回傳Promise或不可序列化時退用預設，不外拋)，預設回傳new Date().toISOString()
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

    //shared, 本行程內同一檔案(絕對路徑)之共用狀態(見檔頭【同一行程同一檔案共用一個狀態物件】)
    let fileKey = path.resolve(file)
    if (!SHARED.has(fileKey)) {
        SHARED.set(fileKey, { state: null, sig: null })
    }
    let shared = SHARED.get(fileKey)

    //readFile, 讀檔並剔除本層自用欄位(檔案不存在或非法JSON回空物件)
    let readFile = () => {
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
    }

    return {

        file,

        get: () => {
            let sig = sigOf(fileKey)
            if (shared.state !== null && sig === shared.sig) {
                return shared.state
            }

            //首次讀取, 或檔案於本行程之外被改動或刪除: 重讀並就地換掉共用物件之內容(持有者看到新內容)
            let fresh = readFile()
            if (shared.state === null) {
                shared.state = fresh
            }
            else {
                for (let k of Object.keys(shared.state)) {
                    delete shared.state[k]
                }
                Object.assign(shared.state, fresh)
            }
            shared.sig = sig
            return shared.state
        },

        set: (state) => {
            if (shared.state === null) {
                shared.state = isobj(state) ? state : {}
            }
            else if (isobj(state) && state !== shared.state) {
                Object.assign(shared.state, state) //外來副本之頂層鍵併入共用物件, 不整份取代(副本缺少之頂層鍵不刪除; 同知識管線之共享store作法)
            }
            for (let k of ownKeys) {
                delete shared.state[k] //本層自用欄位不留在共用物件(get之契約: 不含自用欄位——外審terra F14)
            }
            state = shared.state
            //stamp為同步契約: 拋錯或回傳Promise(承接其rejection)皆退用預設時間戳——檔頭「執行期之get/set不throw」;
            //回傳值不可序列化(BigInt、循環參照、已撤銷之Proxy)者亦退用預設, 否則整份寫檔靜默失敗(游標與冷卻遺失)
            let h = callHookSync(() => stamp())
            let at = new Date().toISOString()
            if (h.state === 'value') {
                try {
                    if (JSON.stringify(h.value) !== undefined) {
                        at = h.value
                    }
                }
                catch {}
            }
            let out = { ...(isobj(state) ? state : {}), at }
            fsWriteJson(file, out, { useFormat: true })
            shared.sig = sigOf(fileKey) //本行程自己之寫入不觸發重讀
        },

    }
}


//SHARED, 行程內各狀態檔(絕對路徑)之共用狀態{ state, sig }
let SHARED = new Map()


/**
 * 檔案之簽章(mtime與大小; 不存在或讀不到回'none')，供判斷檔案是否於本行程之外被改動
 *
 * @param {String} fp 輸入檔案絕對路徑
 * @returns {String} 回傳簽章字串
 */
function sigOf(fp) {
    try {
        let s = fs.statSync(fp)
        return `${s.mtimeMs}:${s.size}`
    }
    catch {
        return 'none'
    }
}


export default createFileStore
