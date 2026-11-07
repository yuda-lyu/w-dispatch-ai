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
| OpenCode Go 月費訂閱(條目與用量查詢)、單次輸出上限與截斷偵測、Go 型錄漂移對齊 | `sgud/state/state_opencodego.md` | 2026-11-03 da65(Gitea #65):OpenCode Go 8 條 `ocgo:`、`opencodeGoUsage`;2026-11-04 da78(Gitea #78):輸出上限與截斷偵測;2026-11-07 ke339(Gitea #92):Go 型錄漂移對齊、新增 `crouton-alpha-free`(38 條) |
| CLI spawn 守門、Go 用量冷卻、放行最小間隔與暫時性重試(da67／da320) | `sgud/state/state_spawngate.md` | 2026-11-04 da67(Gitea #67):`cliSpawnGate`、`quotaGate`;2026-11-05 da320(Gitea #85):`minGapMs` 與 `database is locked` 暫時性重試 |
| 自專案端執行殼移入之 AI 件(da40／da42／da52／r3da) | `sgud/state/state_aishell.md` | 2026-11-01 da40／da42(Gitea #40／#42):自專案端執行殼移入之 8 個匯出與契約字面;2026-11-02 da52:逐次 `budgetMs`;r3da:`oneline` 與 `strTruncate` 站點 |

## 二、功能現況(對應帳本與測試)

功能表(功能 → 帳本 → 測試)分列於各類型檔之 `## 二` 節:Anthropic／failureKind → `state_anthropic.md`;codex → `state_codex.md`;opencode 免費條目與 Console → `state_opencodefree.md`;OpenCode Go 條目／用量／輸出上限與截斷偵測／型錄漂移 → `state_opencodego.md`;spawn 守門／`quotaGate`／`minGapMs`／暫時性重試 → `state_spawngate.md`;執行殼移入之 AI 件(`resolveCatalogue`、`createAiCaller`、`logAiOutcome`、`oneline`、嚴格解析、契約字面) → `state_aishell.md`;遮蔽單一來源與既有子進程／userfn／agy → `state_general.md`.

## 三、已知待辦

待辦與已知缺口分列於各類型檔之 `## 三` 節(無者標「本類型無」):Anthropic 實測回填與已知限制 → `state_anthropic.md`;terra 條目缺口 → `state_codex.md`;免費條目缺口、待收錄 `pulse-alpha-free`、付費跨協定轉譯、`FreeUsageLimitError` 恢復時機、免費池未收之 3 個免費模型 → `state_opencodefree.md`;Go 與輸出上限待辦(含 ke339) → `state_opencodego.md`;spawnGate／quotaGate／minGapMs 待辦 → `state_spawngate.md`;da40／da42 待對照處 → `state_aishell.md`;experience 整理註記與 sgud 檔案大小盤點 → `state_general.md`.
