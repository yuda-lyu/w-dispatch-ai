# 現況(state)(類型:CLI 失敗診斷 errorDetail、opencode 日誌對時擷取、成功結果 finish／outputChars(da110,Gitea #110))

本檔自 2026-11-08 da110 起單列(全域 §14:依功能類型分檔);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 2026-11-08 da110(Gitea #110,使用端建議;**未發布**,版本號與發布由主控處理;`package.json` 仍 1.0.80,其 `wsemi` `^1.9.52` 為主控升版所致):
  - 新增內部模組 `src/failureDiag.mjs`(`maskDiag`／`tailOf`／`baseErrorOf`／`upstreamClassOf`／`composeError`／`addErrorDetail`／`addUpstream`／`finishOf`／`withOutputInfo`／`createTailCapture`)、`src/opencodeUpstream.mjs`(`getOpencodeLogPath`／`pickUpstream`／`readOpencodeUpstream`);**未新增對外匯出**(`WDispatchAi` 鍵數不變).
  - `runExecCli` 於最終結果統一補 `errorDetail`＋error 文字尾段(失敗)與 `finish`／`outputChars`(成功);`dispatchOpencode` 新增選項 `opencodeLog`、失敗後日誌對時擷取、`reshapeResult` 帶 `finish` 與 `diagStderr`／`diagStdout` 提示;`dispatchClaude` 傳 `diagSecrets` 並對 `errorDetail` 再遮蔽;`dispatchAi` 對 REST 成功結果補 `finish`／`outputChars`;`getErrorType`／`isKeyIndependentFail`／`learnQuotaFromFailure` 改讀 `baseErrorOf(error)`.
  - README 行為變更第 69 條、Options 表 `opencodeLog` 列、Result 範例;JSDoc(四家 CLI 轉接器 `@returns`、`dispatchOpencode` `opt.opencodeLog`).
  - 測試:新增 `test/unit-failureDiag.test.mjs`、`test/unit-failureDiagCli.test.mjs`;更新 6 案既有斷言(`error` 期望值隨尾段改變,見 `rulebook_failurediag.md` R-FAILDIAG-5).

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| 失敗結果 `errorDetail`＋`Exit code N: <尾段>`(四家 CLI;exec／timeout;尾段取真正尾端) | R-FAILDIAG-1 | `unit-failureDiag`(addErrorDetail)、`unit-failureDiagCli`(四家×5 案＋各 CLI 形態＋重試／回調) | 完成;本機真 CLI 實跑(不呼叫 AI)驗過 opencode／claude／codex／agy 之形態 |
| 診斷遮罩(沿用 `redactApiKeyText`＋wsemi `maskDiagText`,宣告金鑰樣式) | R-FAILDIAG-2 | `unit-failureDiag`(maskDiag／tailOf) | 完成;`PWD` 過度遮蔽為已知限制 |
| opencode 日誌對時擷取(`errorDetail.upstream`＋error 分類) | R-FAILDIAG-3 | `unit-failureDiag`(opencodeUpstream)、`unit-failureDiagCli`(日誌對時擷取) | 完成;以本機真實日誌驗過格式與時窗(單次讀取約 9ms) |
| 成功 `finish`／`outputChars` | R-FAILDIAG-4 | `unit-failureDiagCli`(成功結果…)、`unit-failureDiag`(finish) | 完成;CLI 僅 opencode 開 `detectTruncation` 有真值 |
| 既有分類不變(`baseErrorOf` 三站點) | R-FAILDIAG-5 | `unit-failureDiag`(不改變既有分類)、`unit-failureDiagCli`(遞補層) | 完成;16 個變異全殺 |

## 三、已知待辦

- **codex／agy／claude 之 `finish`**:輸出格式不揭露終止原因,恆 `unknown`;各 CLI 之 JSON／stream-json 輸出模式(codex `--json`、claude `--output-format json`、agy stream-json)可能可得,**未驗證**,要取得需另案(會改變 stdout 形狀,須如 opencode 之 `detectTruncation` 做還原).
- **agy Usage 傾印**:agy 參數錯誤時錯誤行在第一行、其後整份 Usage,尾段落在 Usage 末端;若日後需要可改為「stderr 長於 N 字元且第一行像錯誤時另帶 `stderrHead`」,現不做(固定旗標不會觸發).
- **同模型並行同時失敗之日誌歸屬**:日誌行無呼叫識別可與子進程關聯,同一時窗內同模型多筆 ERROR 只能取最晚之非 title 者;需要精確歸屬須 opencode 在日誌帶 run／session 與子進程對應(上游).
- **`finish`／`outputChars` 於直呼 `dispatchApi*`**:不帶(由 `dispatchAi` 補);若使用端直呼 REST 轉接器要此二欄,需另案在各轉接器 `mkResult` 補.
- **知識套件之 WARN 字面連動**(帶 `finish=… chars=…`、`health.lastError` 帶原因)不在本案,由主控連動;全域設定庫 `dispatch-*` 技能中關於 `error === 'Exit code N'` 與 `coolDetect` 讀 `r.error` 之敘述須同步(主控處理,見修正報告).
- sgud 檔案大小:`experience.md` 2026-11-08 已再整理(舊節抽至 `experience_20261108.md`,主檔約 17KB);`rulebook_*.md` 中 `rulebook_opencodego.md`(約 36KB)、`rulebook_spawngate.md`(約 36KB)仍逾約 30KB 門檻,屬既有,見 `state_general.md` 待辦.
