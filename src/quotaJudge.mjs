import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isenum from 'wsemi/src/isenum.mjs'


// quotaJudge.mjs — 用量門檻之共用判定件(內部模組; OpenCode Go〔goQuotaGate.mjs〕與訂閱類〔subQuotaGate.mjs〕共用; Gitea #93; 帳本R-SPAWNGATE-6)
//
// 【為何抽出】Go與訂閱類(claude／codex／antigravity)之「視窗用量達門檻即略過」語意相同——任一視窗percent為有效數字且≥該視窗門檻、或該視窗被明說限制即擋;
//   percent缺漏或非數字不擋; until取被擋視窗resetsAt之最晚者(任一缺漏或無法解析為null)。兩處各寫一份會在日後單邊修改而分岐(同一規則手寫≥2處即補丁訊號),
//   故判定與快取各收斂於此, 兩家只負責把各自的回應形狀轉成共同的「視窗項」。
//
// 【視窗項】{ name, percent, max, limited, resetsAt }: name視窗名(Go為rolling／weekly／monthly, 訂閱類為窗口標籤); percent已用百分比(任意型別, 此處判有效性);
//   max該視窗門檻(0~100之數字; null代表不判此視窗); limited來源是否明說此視窗被限(Go之status 'rate-limited'; 訂閱類恆false); resetsAt重置時刻字串(缺漏或非字串視為null)。
//
// 【快取】cachedQuery為「快取、並行共用進行中之查詢、失敗亦快取同長度」之單一實作: 以字串鍵存於狀態物件之cache(Map); 命中進行中之查詢者共用其結果(cached true);
//   t − 查詢時刻 < cacheMs內不重查; 時鐘回撥(差為負)視為過期。Go以金鑰指紋為鍵、訂閱類以「讀者家族」為鍵(sub:前綴, 與指紋〔16碼十六進位〕不衝突)。


/**
 * 依視窗項判定是否該擋(純函數)
 *
 * 只有percent為有效數字(數字或數字字串)且≥該視窗門檻、或limited為true才擋；其餘(percent缺漏、非數字、max為null且未被明說限制)一律不擋
 *
 * @param {Array} items 輸入視窗項陣列[{ name, percent, max, limited, resetsAt }]
 * @returns {Object} 回傳判定物件，內含blocked(是否該擋)、windows(被擋視窗陣列[{ name, percent(有效數字或null), resetsAt(字串或null), limited }])、until(被擋視窗resetsAt之最晚者原字串，任一缺漏或無法解析為null)
 */
function judgeWindowItems(items) {
    let windows = []
    for (let it of items) {
        let m = get(it, 'max', null)
        let pct = get(it, 'percent', null)
        let hasPct = pct !== null && pct !== undefined && isenum(pct)
        let overLimit = m !== null && hasPct && Number(typeof pct === 'string' ? pct.trim() : pct) >= m
        let stated = get(it, 'limited', false) === true
        if (overLimit || stated) {
            let rs = get(it, 'resetsAt', null)
            windows.push({
                name: it.name,
                percent: hasPct ? Number(typeof pct === 'string' ? pct.trim() : pct) : null,
                resetsAt: isestr(rs) ? rs : null,
                limited: stated,
            })
        }
    }
    let until = null
    if (windows.length > 0) {
        let ts = windows.map((x) => (isestr(x.resetsAt) ? Date.parse(x.resetsAt) : NaN))
        if (ts.every((t) => Number.isFinite(t))) {
            until = windows[ts.indexOf(Math.max(...ts))].resetsAt
        }
    }
    return { blocked: windows.length > 0, windows, until }
}


/**
 * 帶快取與並行共用之查詢(永不reject，produce須自行吞錯並回傳判定物件)
 *
 * @param {Object} st 輸入狀態物件(內含cache為Map)
 * @param {String} key 輸入快取鍵
 * @param {Object} cfg 輸入設定物件，內含now(函數，回傳毫秒時刻)與cacheMs(快取毫秒)
 * @param {Function} produce 輸入非同步查詢函數()=>Promise，resolve回傳判定物件
 * @returns {Promise} 回傳Promise，resolve回傳判定物件(同produce之結果，另帶cached：是否取自快取或他呼叫進行中之查詢)
 */
async function cachedQuery(st, key, cfg, produce) {
    let t = cfg.now()
    let hit = st.cache.get(key)
    if (hit !== undefined) {
        if (hit.pending) {
            return { ...(await hit.pending), cached: true }
        }
        if (t - hit.t >= 0 && t - hit.t < cfg.cacheMs) {
            return { ...hit.decision, cached: true }
        }
    }
    let pending = produce()
    st.cache.set(key, { t, pending })
    let decision = await pending
    st.cache.set(key, { t: cfg.now(), decision })
    return { ...decision, cached: false }
}


export { judgeWindowItems, cachedQuery }
