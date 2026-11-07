# 現況(state)(類型:套件通則(已發布版本、sgud 遷移、規則帳本拆檔、遮蔽單一來源、子進程啟動分流／userfn／agy 之既有測試))

本檔自 `state.md` 依功能類型拆出(2026-11-07,全域 §14;逐字搬移,節號與標題不變);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 已發布:1.0.55(`99a33bc`,2026-10-20).
- **工作區未發布之改動**,下次發布時一併帶出(使用者指示「更新 w-dispatch-ai 等下次再發布」):
  - (2026-10-23,主控直辦)指引要求文件遷移為 sgud 配置(`CLAUDE_experience.md` → `sgud/exp/experience.md`、`CLAUDE_rulebook.md` → `sgud/rule/rulebook.md`;`.gitignore` 調整、新建 `.npmignore`);`src/providers.mjs`:`oc:opencode/beam-free` 加脈絡長度實測註記(完整 1,048,576,不覆寫)、`oc:opencode/nemotron-3.5-super-vl-free` 覆寫 `limit`(context 1000000、input 950000、output 131072)並加實測註記.
  - 2026-10-25 規則帳本依全域 sgud 規則拆檔(`rulebook.md` 只留索引;內容逐字搬移,節號與標題不變).

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 |
|---|---|---|
| 遮蔽單一來源 | R-REDACT-1(`rulebook_spawn.md`)、R-ANTHROPIC-1 | `test/unit-redactText.test.mjs` |
| 子進程啟動分流、validate、注入函數、agy | `rulebook_spawn.md`／`rulebook_userfn.md`／`rulebook_agy.md` | 既有測試(全綠) |

## 三、已知待辦

- `sgud/exp/experience.md` 已於 2026-11-03(da65)依全域設定 §14 整理:舊經驗抽出為 `experience_20261103.md`(逐字搬移,節號與標題不變),主檔約 14KB(加 da65 一節後約 18KB).
- **sgud 檔案大小**(2026-11-07 盤點,全域 §14 約 30KB 門檻):`sgud/rule/rulebook_spawngate.md`(約 35KB)、`sgud/rule/rulebook_opencodego.md`(約 34KB,本輪加入 ke339 後)、`sgud/exp/experience_20261103.md`(約 31.5KB)已逾門檻;第 325 項僅要求整理 `state.md`／`experience.md`,上列三檔未動,是否依類型再拆待主控安排.
