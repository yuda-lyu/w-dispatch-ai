# 現況(state)(類型:agy 提示詞傳法 promptVia 與 stdin 路徑(ke342,Gitea #94))

本檔自 2026-11-07 ke342 起單列(全域 §14:依功能類型分檔);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 2026-11-07 ke342(Gitea #94,使用端建議;**未發布**,版本號與發布由主控處理):`dispatchAntigravity` 新增選項 `promptVia`(`'argv'`／`'stdin'`／`'auto'`,預設 `'auto'`)與結果欄 `raw`;新增內部模組 `src/parseAgyStream.mjs`(解析 `--output-format stream-json` 之 NDJSON)、`src/checkAgyStdinSupport.mjs`(`agy --version` 探測,門檻 1.1.15,只快取已確認支援者);`MAX_PROMPT_LENGTH`(30000)只在 argv 路徑檢查.README 行為變更第 68 條.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| `promptVia` 分流(argv／stdin／auto,無效值回退 auto) | R-AGY-4 規則 1～3(`rulebook_agy.md`) | `test/unit-dispatchAntigravityStdin.test.mjs` A 節(6 案) | 完成;`argv` 路徑逐位元不變(既有 `unit-dispatchAntigravity` 全綠,僅 `prompt too long` 案改帶 `promptVia:'argv'`) |
| stdin 單行 NDJSON、輸出解析、判成敗(只看 `result`;無 `result` 一律失敗;validate 在改寫後) | R-AGY-4 規則 3～5、8～9 | 同檔 B、C 節(10 案)＋`test/unit-parseAgyStream.test.mjs`(8 案) | 完成;經遞補層驗過(`next-key/exec` 換下一條目) |
| `extraArgs` 衝突旗標拒絕 | R-AGY-4 規則 6 | 同檔 D 節(3 案) | 完成 |
| agy 最低版本 1.1.15、舊版明確錯誤、探測快取與 fail-open、未知旗標錯誤改寫 | R-AGY-4 規則 7 | 同檔 E 節(5 案) | 完成;門檻出自 `agy changelog` 1.1.15,輸入訊息形狀僅 1.5.2 實測 |
| `quotaGate`(#93)在兩路徑相同 | R-AGY-4 規則 10、R-SPAWNGATE-6 | 同檔 F 節(1 案) | 完成 |
| 本機真 agy 驗證(2026-11-07,agy 1.5.2,`gemini-3.8-flash-low`) | R-AGY-4「對應測試」末項 | `tmp/` 腳本(不入庫):stdin 短提示詞、預設 auto 之 36060 字元、argv 短提示詞各 1 次皆 SUCCESS;原始協定 37504 字元 1 次 SUCCESS | 已驗 |

## 三、已知待辦

- **是否把預設改為 `'stdin'`**(與其餘三家 CLI 轉接器一致、並消除「含大量引號而長度未過 30000」的轉義膨脹 `ENAMETOOLONG` 漏網):待使用者確認各機 agy ≥1.1.15 且接受行為變更(`extraArgs` 自帶輸出旗標者衝突、輸出由純文字改為 NDJSON 解析、舊版 agy 上原本可用者變錯誤).改預設時須同步改既有以 argv 為前提之測試(假 agy 須改為 stream-json 形狀).
- **未驗證形狀**:stdin 路徑下權限閘門擋下(`skipPermissions:false`)、agy 自身 `--print-timeout` 到時、額度用盡之事件形狀;1.1.15～1.5.1 之輸入訊息形狀;`message.content` 陣列形式;重複 `--output-format` 之 last-wins.
- **用量**:agy 之 `usage` 目前只留在 `raw`,未進結果之 `usage` 欄(該欄在遞補層與工作流以 API 類形狀消費);要供 `createUsageCounter` 需另案定欄位與消費端.
- 他套件之上限(例如呼叫端調度層對 agy 提示詞長度的一致性檢查)不在本套件,由主控另案通知.
