import fs from 'fs'


// readEnvFile.mjs — 讀.env為金鑰來源物件(不污染process.env)
//
// 【為何需要】resolveProviders之opt.env本為「不用process.env」而設計——多專案並行時
//   污染全域環境變數會互相覆蓋金鑰——但「env物件從哪來」套件原無答案, README舊教法
//   process.loadEnvFile('./.env')反而把金鑰塞進process.env, 與該設計目的自相矛盾。
//   兩個消費端專案已各寫一份解析器且行為不一致(2026-08-18使用端調研), 收斂於此。
//
// 【為何讀不到回空物件而非拋錯】金鑰缺失由resolveProviders之skipped機制回報
//   (缺金鑰停用該條目、不中斷), 此處拋錯反而讓「部分供應商無金鑰」升級成整體啟動失敗;
//   要fail-loud的呼叫端自行檢查回傳(如Object.keys(env).length)。
//
// 【只解析KEY=value最簡格式】不引入dotenv: 金鑰為單行純文字, 僅剝除成對之首尾引號,
//   不做跳脫與多行處理——加解析規則只會製造與其他.env工具的行為差異。


/**
 * 讀取.env檔為鍵值物件(金鑰來源, 不寫入process.env)
 *
 * 特點：
 * 只解析`KEY=value`形式(KEY限英數底線)，忽略空行、註解與無效行；
 * value修剪空白並剝除成對之首尾引號(單雙引號皆可)；
 * 檔案不存在或不可讀一律回空物件不throw(金鑰缺失交由resolveProviders之skipped回報)
 *
 * @param {String} file 輸入.env檔案路徑字串
 * @returns {Object} 回傳鍵值物件(變數名 → 字串值)，讀取失敗回空物件
 * @example
 *
 * import readEnvFile from './src/readEnvFile.mjs'
 * import resolveProviders from './src/resolveProviders.mjs'
 * import providersAll from './src/providers.mjs'
 *
 * //金鑰放.env(變數值以逗號分隔多把), 讀成物件交resolveProviders, 不污染process.env
 * let env = readEnvFile('./.env')
 * let { providers, skipped } = resolveProviders(providersAll, { env, pick: ['agnes:agnes-2.5-flash'] })
 *
 */
function readEnvFile(file) {
    let out = {}
    let text = ''
    try {
        text = fs.readFileSync(file, 'utf8')
    }
    catch (e) {
        return out //檔案不存在或不可讀, 回空由skipped機制回報
    }
    for (let line of text.split(/\r?\n/)) {
        let m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
        if (!m) {
            continue
        }
        out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2')
    }
    return out
}


export default readEnvFile
