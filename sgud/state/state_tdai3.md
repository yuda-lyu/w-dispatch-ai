# 現況(state)(類型:2026-11-24 tdai3——免費池重新盤點與收錄 `hy4-flash-free`(排程第 341 項)、agy 真防寫 `readOnly`(排程第 445 項))

本檔自 2026-11-24 tdai3 起單列(全域 §14:依功能類型分檔);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md` 2026-11-24 tdai3 節).

## 一、版本與未發布之改動

- 2026-11-24 tdai3(主控任務 20261124014253;**未發布**,版號與發布由主控處理):
  - **版號註記**:任務書稱「完成後發布 1.0.111」,但 `npm view w-dispatch-ai time` 顯示 1.0.111 已於 2026-11-23 21:10(+8)發布、`package.json` 版號亦為 1.0.111;README 新節標題寫「未發布（預計 1.0.112」,README 舊節「預計 1.0.110」亦已過時(`unit-readmeVersions` 有提示),均待主控裁示.
  - **第 341 項**:免費池重新盤點(`opencode models opencode --refresh --verbose`,10 個、單價皆 0);目錄 7 個 `oc:opencode/*` 皆在清單、無下架無單價改變;**新增 `oc:opencode/hy4-flash-free`**(R-OCFREE-2② 七項全過);**不收 `tidepool-alpha-free`、`iceman-free`**(官方 Privacy:資料保留並用於改進模型;缺項見帳本).內建 providers 35 → 36 條.README 第 89 條;帳本 R-OCFREE-2 之 2026-11-24 盤點與 ⑦ 隱私判準.
  - **第 445 項**:`dispatchAntigravity` 新增 `readOnly`(預設 `false`)——`true` 加 `--settings '{"permissions":{"deny":["write_file(*)","command(*)"]}}'`;**內建 5 個 agy 條目皆自帶 `readOnly:true`**(行為變更:工作區內寫入由放行落地改為被擋);`SAFE_SPEC.antigravity` 加 `readOnly`(給了而非布林 `params` 拒絕).README 第 90 條;帳本 R-AGY-5.
  - 外部呼叫:opencode 免費模型 15 次(CLI 11、匿名 REST 4)、agy 13 次(含 1 次 OAuth 刷新網路逾時之失敗呼叫);證據檔為任務夾 `agent-out/tdai3-外部呼叫證據.jsonl`.

- **驗證(2026-11-24,修前紅／變異／全套)**:修前紅——HEAD 之 `src`／`README.md`／`test` 搭本輪 6 個測試檔 25 failing／80 passing,修後該 6 檔全綠;變異 29 個(agy A1～A15 含 A8b、hy4 B1～B13)全數殺死;`eslint --ext .mjs` 改動檔 exit 0;`audit-own-pkg` 掃描 93 檔必修 0、待判讀 0。全套(自 PATH 移除真 CLI,以 `where` 確認 agy／opencode／claude／codex 皆 absent 後執行,`quiet-run --lock`):並行 `--jobs 4` **2179 passing／13 pending／0 failing**、依序 **2179／13／0**(8m17s)、發布包解開目錄(`npm pack` 後解開,並行)**2179／13／0**(3m48s);pending 13 逐檔核對:`api-providersOpencodeFree` 2 與 `api-opencodeOutputCap` 10 以真 PATH 單獨跑 **12 passing**(後者只連本機 127.0.0.1 假服務,前者為目錄查詢)、`S5` 1 為非 win32 專屬;兩個新測試檔(31 案)連跑 10 次皆綠。

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| `oc:opencode/hy4-flash-free` 條目(欄位、排序、註解證據、檔頭漂移紀錄、README 第 89 條)與 tidepool／iceman 不收 | `rulebook_opencodefree.md` R-OCFREE-2(2026-11-24 盤點、⑦) | `test/unit-providersOpencodeFreeEntries.test.mjs`(新 describe 6 案;順序案、條數案改);`test/unit-providersOpencodeGoDocs.test.mjs`／`unit-providersOpencodeGoEntries.test.mjs`／`unit-patchCatalogueConfig.test.mjs`(條數 35 → 36) | 完成;連網守門 `api-providersOpencodeFree`(真 PATH 單獨跑)綠 |
| agy `readOnly` 真防寫(旗標、順序、兩路徑、無效值、`extraArgs` 衝突、遞補層、內建條目、README／註解文件守門) | `rulebook_agyreadonly.md` R-AGY-5;`rulebook_safeopt.md` R-SAFEOPT-1(`readOnly` 列入站點表) | `test/unit-dispatchAntigravityReadOnly.test.mjs`(13 案);`test/unit-agyFailShapes.test.mjs`(Hydrogen 條目鍵集合含 `readOnly`) | 完成;真 agy 1.5.12 實測見帳本 R-AGY-5 實測表 |

## 三、已知待辦

- **待裁示(見任務報告)**:①發布版號(1.0.111 已發布);②直接呼叫 `dispatchAntigravity` 之 `readOnly` 預設是否改為 `skipPermissions:false` 時自動開(本輪不改,理由見 R-AGY-5 判準);③`tidepool-alpha-free`／`iceman-free` 是否授權補測後收錄(須對訓練類模型送合成填充字,或接受缺項收錄);④下游全域技能 `dispatch-antigravity`／`dispatch-opencode` 之同步清單(見回饋檔 2026-11-24 列).
- **未驗證(明標)**:Claude 兩個 agy 條目(`agy:claude-sonnet-5-5-high`、`agy:claude-opus-5-5-high`)於 `readOnly:true` 下之實測(額度群組用量近滿未呼叫);舊版 agy 之 `--settings` 最低版本(changelog 只含近期版本);`agentMode:""` 路徑之 shell 繞過;Windows 以外平台;使用者自設 MCP 工具／外掛 hook 之寫入不在 deny 規則內.
- 已知限制:被 deny 擋下時 agy 回 `ok:true` 與非空說明文字,呼叫端須以檔案是否落地判是否被擋(與工作區外自動拒絕之空輸出不同);`extraArgs` 自帶 `--settings` 時不能與 `readOnly:true` 並用.
- `deepseek-v4.1-flash-free` 之 CLI 目錄 release_date 已由條目註解之 2026-09-10 變為 2026-10-17(僅記錄,未改條目;context、輸出上限不變).
