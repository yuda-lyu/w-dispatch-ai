# 規則帳本(類型:count 次數類參數)

> 2026-11-22 tdai1(排程第 446 項)立.類型說明:次數類設定(`maxRetries` 等)之判定單一來源 `castCountOr`(R-COUNT-1).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:主控帳本 G17(opt 之數值以 `ise*` 判定「可計算」,`is*` 只作數學定義之判斷)、跨套件規格〈輸入參數之檢測機制〉K3(非預期之值視為未給)、K4(檢測之值即使用之值)、wsemi `iseint` 之 `count` 用途(0～4294967295);承 `rulebook_timeout.md` R-TIMEOUT-1 規則 5「次數／索引類(本輪不動)」之待辦.

## R-COUNT-1 次數類參數一律以 `castCountOr`(`iseint` 之 `count`)判定並用轉換值,所有入口一致

### 軸

- 輸入值類別(測試表 `test/unit-castCountOr.test.mjs`「輸入表」38 格):有效(0、1、2、數字字串、含空白之數字字串、`'2e0'`、`'+2'`、恰 4294967295)、超過 count 上限(4294967296、1e10、`Number.MAX_SAFE_INTEGER`、`Number.MAX_VALUE`)、非有限(`Infinity`、`'Infinity'`、`-Infinity`、`NaN`)、非正或非整(`-1`、`-0.5`、`1.5`、`'1.5'`)、非十進位字串(`'0x10'`、`'0o7'`、`'0b1'`、`'abc'`、`''`、`' '`、`'1,000'`)、非原始數值(包裝物件、布林、`null`、未給、陣列、物件、BigInt、函數);另有 min 1 之下界(0 與 `'0'` 無效)與取值即拋錯之物件(不 throw).
- 入口:REST 四家 `maxRetries`、`runExecCli` 之 `maxRetries`(CLI 四家經此)、`dispatchAiFallback` 之 `coolAfterFails`、遞補層游標(索引類)、金鑰冷卻時間戳(時間戳類)、`appliedTimeoutMs`(轉接器內部結果值)、工作流之 `keepDays`／`maxLengths`／`minCandidates`／`topN`／`min`／`max`、驗證規則 `min:N`.

### 規則

1. **判定**(`src/castCountOr.mjs`,單一份):`iseint(v, { use: 'count', min })` 為真才採用(0 或 1 至 4294967295 之整數,數字或可無損轉數字之十進位字串),回 `Number(trim 後之值)`(K4);其餘一律回呼叫端給之預設(K3),**不夾上限、不報錯**.與 wsemi `execCli` 之 `maxRetries` 判定逐案相同(其無效時用 0).
2. **為何不用舊判定(`isp0int`／`ispint`／`isint` 通過後 `cint`)**:舊判定為數學定義之「是否整數」,`Infinity` 為真而 `cint` 得 `1.7976931348623157e308`、`'0x1'` 為真而得 1、超過 4294967295 者原樣通過.後果(實測,修前紅):`runExecCli` 之驗證重試迴圈以本層之 `maxRetries`(1.8e308)判「是否用完」而 `execCli` 對同值用 0,`maxRetries: Infinity` 使驗證不過者近乎無限重試;`minCandidates: Infinity` 使整合永不發生;金鑰冷卻時間戳為 `Infinity` 使該把金鑰永遠冷卻.
3. **站點**(單一來源 `castCountOr`):
   | 站點 | 參數 | 下界 | 預設 |
   |---|---|---|---|
   | `dispatchApiAnthropic`／`OpenaiCompat`／`OpenaiResponses`／`TypesafeSystemone` | `maxRetries` | 0 | 0 |
   | `runExecCli`(CLI 四家經此;並以採用值轉交 `execCli`,K4) | `maxRetries` | 0 | 0 |
   | `dispatchAiFallback` | `coolAfterFails` | 1 | 0(不計數) |
   | `wkf/createUsageCounter` | `keepDays` | 1 | 14 |
   | `wkf/makeArrayCoverageValidator` | `maxLengths[欄]` | 1 | 略過該欄之上限 |
   | `wkf/runFanout` | `minCandidates` | 1 | 2 |
   | `wkf/parseIndexList` | `topN` | 1 | `Infinity`(不限) |
   | `wkf/createUsageCounter` | `bump(key, n)` 之 `n` | 0 | 1(複審補:修前不判型,數字字串串接成 `'02'`、`Infinity` 寫檔變 `null`) |
   | `buildValidator` | 規則 `min:N` 之 N | 0 | 規則無效＝驗證失敗(同 `min:abc`) |
   就地以 `iseint` 判定者(非 `castCountOr`,因種類不同):`dispatchAiFallback` 游標(`use: 'index'`,無效從第一把起)、金鑰冷卻時間戳(`use: 'timestamp', min: 1`,無效視為無效紀錄)、`parseIndexList` 之 `min`／`max`(安全整數,無效用 1／不限);`appliedTimeoutMs` 改 `castTimerMs`(同 `timeoutMs`).
4. **刻意不改**(量級型、已為 `iseint` 之安全整數判定):`castPintOr` 之各毫秒設定(R-TIMEOUT-1 規則 6)、`outputTokenMax`(token 數)、`maxBodyBytes`(位元組);`cooldownGrowth`(倍率,非次數)、`cliSpawnGate` 之 `maxCli`／`pid`(已 `iseint` `count`);`parseIndexList` 之 `min`／`max` 為編號界限非次數(用安全整數);持久 store 內之計數(`cooling.mjs`、`dispatchAiFallback` 讀回之計數欄,以 `Number.isInteger` 判)為內部值而非呼叫端設定(自派複審所提;值來自本套件自己寫入,不在入口檢測之列).

### 盤點指令

- `Grep "\b(ispint|isp0int|isint|cint)\(" src`(排除註解)→ 0 筆;`Grep "import (ispint|isp0int|isint|cint) from" src` → 0 筆(`test/unit-castCountOr.test.mjs`「src 內無…」兩案).
- `Grep "castCountOr\(" src`(排除 `castCountOr.mjs`)→ 11 檔各 1 站(同檔「站點全集」);`Grep "get\([^)]*'maxRetries'" src` → 5 筆且皆為 `let maxRetries = castCountOr(get(opt, 'maxRetries', null), 0)`(同檔);`runExecCli` 以 `base.maxRetries = maxRetries` 轉交採用值.
- `castTimerMs` 站點全集因 `appliedTimeoutMs` 增 1(`dispatchAiFallback.mjs` 由 2 變 3,共 33 站,`test/unit-castTimerMs.test.mjs` 同步).

### 對應測試

- `test/unit-castCountOr.test.mjs`(判定件 3 案 + 站點盤點 6 案;判定件以動態匯入被測件,修前模組不存在時只使該 3 案紅)、`test/unit-countParams.test.mjs`(25 案:REST 四家各 2、`runExecCli` 驗證路徑 2 與期限接管路徑 2、CLI 四家各 1、遞補層游標 2 與金鑰冷卻時間戳 1、工作流 6).
- 修前紅:HEAD 快照上 `test/unit-castCountOr.test.mjs` 9 案全 failing(判定件 3 案因模組不存在、盤點 6 案因站點表不符);`test/unit-countParams.test.mjs` 為 18 failing／7 passing(後者為「修前即無效者仍不重試」與「合法值照用」之保持案).

### 變異驗證

見 `sgud/state/state_tdai1.md`〈驗證〉(C 系列 21 項;變異腳本為一次性、不入庫,該節記各系列之項數、結果與等價者).
