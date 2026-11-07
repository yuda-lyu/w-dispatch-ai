# 現況(state)(類型:codex 條目(wda-run01))

本檔自 `state.md` 依功能類型拆出(2026-11-07,全域 §14;逐字搬移,節號與標題不變);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- (2026-10-28,主控任務 20261028054319 之 wda-run01 修正輪)**內建 providers 新增 `codex:gpt-6.1-terra`**(使用者 2026-10-27 把外審由 gpt-6.1-sol 改為 gpt-6.1-terra max;帳本 `rulebook_codex.md` R-CODEX-1):①`src/providers.mjs` 新增條目,`sandbox: 'read-only'` 與強度 `CODEX_EFFORT`(high,不另寫 max)比照 sol,註解載明型錄預設 effort 為 low 故必傳強度、主控 2026-10-27 之實測(Codex 0.163.0)與 `patch` 覆寫 max 之用法;codex 群組順序為 `luna → terra → sol`(luna 維持最前、terra 在 sol 之前;與 HEAD 逐條比對,其餘 30 條之順序與欄位完全不變),內建條目 30 → 31;②`dispatchCodex.mjs` 之 `model` JSDoc 例示補列 terra(列舉用,sol 保留);③README 行為變更紀錄第 53 條與「量級感受」條數(24 → 31);④新測試 `test/unit-providersCodexEntries.test.mjs`(10 條,全程假 codex,無真實 AI 請求);⑤`resolveProviders.mjs` JSDoc 範例條數(22 → 31)與 README 條目覆寫敘述(codex 之防寫為獨立 `sandbox` 欄位)同步.**待主控裁示**:任務書只寫「terra 排在 sol 之前」,採最小解讀(luna 仍最前);若要 terra 排在整個 codex 群組最前,把條目移到 luna 之前並改該測試之群組順序斷言.
- 驗證(2026-10-28,wda-run01):全套 `npm test`(`quiet-run --lock`)最終程式 **782 passing**、0 failing(開工時 772,新增 10);eslint 0 錯;修前紅:HEAD 之 `src` 上新測試(外審前之 9 條)全 failing;12 個變異全數被抓到;`ordercheck.mjs` 比對 HEAD 與現況,除 terra 外 30 條之順序與全部欄位(JSON 深比對)完全相同;外審 terra(gpt-6.1-terra max)14 條(缺陷 10、意見 4),#1～#12 屬實或部分屬實、其中 9 條已修改,3 條(2 條設計意見、1 條既有「最壞」措辭)未改;未發任何真實 AI 請求(外審派工除外,該次為使用者指定之外審).**既有偶發失敗**:三次全套中有一次(同程式碼)`unit-dispatchClaudeFailureKind`「交叉確認之耗時併入durationMs」失敗(比較兩次子進程耗時差 >350ms,推測為平行負載下兩次子進程耗時起伏,未查根因);該檔單獨連跑 8 次 0 失敗;非本輪改動所致(未改動該檔與其被測碼)、未修(不得放寬容差或掩蓋),列為已知偶發,失敗率:全套 1/3、單檔 0/8.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 |
|---|---|---|
| codex 條目(luna／terra／sol)欄位比照、強度必傳、terra 在 sol 之前 | `rulebook_codex.md` R-CODEX-1 | `test/unit-providersCodexEntries.test.mjs`、`test/unit-providers.test.mjs`(通則) |

## 三、已知待辦

- **terra 條目已知缺口(wda-run01)**:①唯讀沙箱之寫檔金絲雀(要求寫檔須被擋)未對 terra 重測,沿用 sol 條目之實測(本輪不得呼叫 AI 服務);②terra 之實跑紀錄來自主控 2026-10-27(`-m gpt-6.1-terra -c model_reasoning_effort="max"`、`dispatchCodex`＋`workspace-write` 讀中文檔寫檔),本套件側只驗到「假 codex 收到的 argv」;③全域技能 dispatch-codex 之「條目表」敘述由主控同步.
