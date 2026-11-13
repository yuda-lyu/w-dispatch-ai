# 現況(state)

本檔記本套件**目前已開發功能之最新狀態**之**索引**;接續工作時先讀此檔,依類型開對應 `state_<類型>.md`,與規則帳本(`sgud/rule/rulebook.md` 索引 → 各 `rulebook_<類型>.md`)比對即知尚未做到者.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

> 2026-11-07 整理(第 325 項;本檔約 55KB,超過全域 §14 約 30KB 門檻):依功能類型拆為下列 `state_<類型>.md`,逐字搬移,節號與標題不變,不刪內容;本檔只留索引.每個類型檔皆保留 `## 一、版本與未發布之改動`／`## 二、功能現況(對應帳本與測試)`／`## 三、已知待辦` 三節.

> 版本註記:`state_general.md` 所載「已發布:1.0.55(2026-10-20)」為 2026-10-23 前後之記載,**已過時**(現 `package.json` 之 `version` 為 1.0.77);實際發布狀態以 npm 與 `package.json` 為準,本檔不代為更新.

## 一、版本與未發布之改動

| 類型 | 檔 | 內容(依時序之任務輪次) |
|---|---|---|
| 套件通則(已發布版本、sgud 遷移、規則帳本拆檔、遮蔽單一來源、子進程啟動分流／userfn／agy 之既有測試) | `sgud/state/state_general.md` | 已發布版本(1.0.55)與「工作區未發布之改動」總則、2026-10-23 sgud 遷移、2026-10-25 規則帳本拆檔;功能表:遮蔽單一來源、子進程啟動分流／userfn／agy;待辦:sgud 檔案大小盤點 |
| Anthropic API 金鑰計費與失敗細分類(dispatch-run01／run02／run03) | `sgud/state/state_anthropic.md` | 2026-10-24～25 dispatch-run01／run02／run03:Anthropic Console API 金鑰計費、`api-anthropic`、父 session 變數移除、`failureKind`、CLI「沒額度」REST 交叉確認、金鑰探測、`*_KEYS` 分號;尚未驗證項;待主控實測回填之待辦 |
| codex 條目(wda-run01) | `sgud/state/state_codex.md` | 2026-10-28 wda-run01:內建 `codex:gpt-6.1-terra`(luna → terra → sol) |
| opencode 免費條目漂移與 `filterOpencodeFree`、OpenCode Console(原 Zen)端點與文件對齊 | `sgud/state/state_opencodefree.md` | 2026-10-30 run01(Gitea #25):免費條目漂移與 `filterOpencodeFree`;2026-11-03 da63(Gitea #63):OpenCode Console 端點與文件對齊;待辦:免費池 3 個未收之免費模型 |
| OpenCode Go 月費訂閱(條目與用量查詢)、單次輸出上限與截斷偵測、Go 型錄漂移對齊 | `sgud/state/state_opencodego.md` | 2026-11-03 da65(Gitea #65):OpenCode Go 8 條 `ocgo:`、`opencodeGoUsage`;2026-11-04 da78(Gitea #78):輸出上限與截斷偵測;2026-11-07 ke339(Gitea #92):Go 型錄漂移對齊、新增 `crouton-alpha-free`(38 條);2026-11-10 da405:該條因上游下架移除(37 條,`ocgo:` 8 條) |
| CLI spawn 守門、Go 用量冷卻、放行最小間隔與暫時性重試、訂閱類用量門檻與額度帳(da67／da320／ke340／da116) | `sgud/state/state_spawngate.md` | 2026-11-04 da67(Gitea #67):`cliSpawnGate`、`quotaGate`;2026-11-05 da320(Gitea #85):`minGapMs` 與 `database is locked` 暫時性重試;2026-11-07 ke340(Gitea #93):`quotaGate` 擴及 claude 無金鑰者／codex／antigravity(預設開啟)、額度帳 `store.quota`、`quota-skip` 加 `source`、與 Go 共用判定件;2026-11-09 da116(Gitea #116):額度帳記帳號識別 `account`(email 雜湊)、帳命中後依節流判準定期重探、帳號改變或用量已低於門檻即作廢(`quota-ledger-void` 事件)、`forgetQuota` 明示清帳;待辦:無 CLI 入口、`account` 雜湊之待裁示、真實換帳號端到端待使用端觀察 |
| agy 提示詞傳法 `promptVia` 與 stdin 路徑(stream-json)(ke342);Gemini 4 Hydrogen 條目(da-hy,Gitea #137) | `sgud/state/state_agy.md` | 2026-11-13 da-hy(Gitea #137):內建新增 `agy:gemini-4-hydrogen-high`(37 → 38 條),本機實測(簡答、寫檔金絲雀分工作區內外、額度對照)寫入條目註解,未發布;2026-11-07 ke342(Gitea #94):`dispatchAntigravity` 新增 `promptVia`(argv／stdin／auto,預設 auto)與結果欄 `raw`;stdin 路徑只看 `result` 事件判成敗、無 result 一律失敗、extraArgs 衝突旗標拒絕、agy 最低版本 1.1.15 與舊版明確錯誤;待辦:是否改預設 stdin、未驗證形狀、用量欄位 |
| CLI 失敗診斷 errorDetail、opencode 日誌對時擷取、成功結果 finish／outputChars(da110) | `sgud/state/state_diag.md` | 2026-11-08 da110(Gitea #110):四家 CLI 失敗結果加 `errorDetail` 與 `Exit code N: <尾段>`、opencode 失敗讀日誌對時擷取 `errorDetail.upstream`(`opencodeLog`)、成功結果 `finish`／`outputChars`、`baseErrorOf` 守住既有分類;待辦:codex／agy／claude 之 `finish` 恆 unknown、agy Usage 傾印、並行歸屬、直呼 REST 無此二欄、知識套件 WARN 連動(主控) |
| 冷卻、健康與預算之語意邊界(排程第 402 項、併 Gitea #130;di402) | `sgud/state/state_cooling.md` | 2026-11-11 di402(+ di402b:`envDown` 等待不以剩餘預算封頂、`callAiWithFallback` 帶出 `envDown`):封頂逾時 `budget-cut`、冷卻紀錄 `{at,n,reason}` 與加長(#130)、持久連敗與 `envDown`、期限約束一切重試、`castBudgetMs`(D11 甲)、`createFileStore` 同檔共用物件、匯出 `coolEntry`／`coolingOf`／`streakOf`;未發布,須與 CA 階段同一發布窗 |
| `timeoutMs` 與其餘毫秒設定之判定單一來源 `castTimerMs`／`castPintOr`(排程第 438 項;da-hy) | `sgud/state/state_timeout.md` | 2026-11-13 da-hy:32 站點(27 檔)由 `castPintOr` 改 `castTimerMs`(1～2147483647 之整數才採用,其餘用各入口預設,不夾上限;與 wsemi 1.9.59 `execCli` 判定一致);`castPintOr` 內部改 `iseint`(其餘毫秒設定同判定);由期限導出之逾時取整;`--print-timeout` 推導不再封頂;`unit-dispatchAntigravity` 之 printTimeout 案不再依賴子進程啟動速度;未發布;待辦:次數類(`maxRetries` 等)G17② 順改、僅盤點固定之站點 |
| 自專案端執行殼移入之 AI 件(da40／da42／da52／r3da) | `sgud/state/state_aishell.md` | 2026-11-01 da40／da42(Gitea #40／#42):自專案端執行殼移入之 8 個匯出與契約字面;2026-11-02 da52:逐次 `budgetMs`;r3da:`oneline` 與 `strTruncate` 站點 |

## 二、功能現況(對應帳本與測試)

功能表(功能 → 帳本 → 測試)分列於各類型檔之 `## 二` 節:`timeoutMs` 判定單一來源 → `state_timeout.md`;Anthropic／failureKind → `state_anthropic.md`;codex → `state_codex.md`;opencode 免費條目與 Console → `state_opencodefree.md`;OpenCode Go 條目／用量／輸出上限與截斷偵測／型錄漂移 → `state_opencodego.md`;spawn 守門／`quotaGate`／`minGapMs`／暫時性重試 → `state_spawngate.md`;執行殼移入之 AI 件(`resolveCatalogue`、`createAiCaller`、`logAiOutcome`、`oneline`、嚴格解析、契約字面) → `state_aishell.md`;agy `promptVia`／stdin 路徑 → `state_agy.md`;CLI 失敗診斷／日誌對時擷取／`finish`／`outputChars` → `state_diag.md`;封頂逾時／冷卻加長／持久連敗／期限約束重試／`castBudgetMs` → `state_cooling.md`;遮蔽單一來源與既有子進程／userfn／agy → `state_general.md`.

## 三、已知待辦

待辦與已知缺口分列於各類型檔之 `## 三` 節(無者標「本類型無」):次數類(`maxRetries` 等)G17② 順改、僅盤點固定之站點(da-hy)→ `state_timeout.md`;agy 工作區內寫入未被「防寫」擋下(Hydrogen、3.8、Argon 一致,待裁示;da-hy)→ `state_agy.md`;Anthropic 實測回填與已知限制 → `state_anthropic.md`;terra 條目缺口 → `state_codex.md`;免費條目缺口、待收錄 `pulse-alpha-free`、付費跨協定轉譯、`FreeUsageLimitError` 恢復時機、免費池未收之 3 個免費模型 → `state_opencodefree.md`;Go 與輸出上限待辦(含 ke339) → `state_opencodego.md`;spawnGate／quotaGate／minGapMs 待辦與訂閱類用量門檻待辦(ke340;含 Go 免費期條目連坐未處理之待實證條件) → `state_spawngate.md`;da40／da42 待對照處 → `state_aishell.md`;agy 預設是否改 stdin、stdin 路徑未驗證形狀、agy 用量欄位(ke342) → `state_agy.md`;codex／agy／claude `finish` 恆 unknown、agy Usage 傾印尾段、同模型並行日誌歸屬、直呼 REST 無 `finish`／`outputChars`、知識套件 WARN 連動(da110) → `state_diag.md`;CA 階段之同一發布窗、額度閘等候截斷後之背景查詢、CLI 接管重試不重新守門(di402) → `state_cooling.md`;experience 整理註記與 sgud 檔案大小盤點 → `state_general.md`.
