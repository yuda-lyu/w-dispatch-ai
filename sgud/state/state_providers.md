# 現況(state)(類型:內建 providers 條目因上游結構性失效而下架(dl583))

本檔依功能類型自 `state.md` 之索引分出;索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- (2026-11-21,主控任務 20261121154013 之 dl583 修正輪,排程第 583 項,使用者指示;帳本 `rulebook_providers.md` R-PROVIDERS-1;**未發布**,版本號與發布由主控處理)**移除內建條目 `oc:poolside/poolside/laguna-s-2.1` 與 `poolside:laguna-s-2.1`**:主控以 `.env` 之 `POOLSIDE_KEYS` 兩把金鑰直呼 Poolside 官方端點,`GET /models` 仍列 laguna 兩型號,但 `POST /chat/completions` 一律 HTTP 400「Model version … is deactivated」(使用端 2026-11-01 已記同一現象),以現有金鑰兩條目必失敗.①內建 providers 37 → 35 條(`oc:` 群組少 1、REST 群組少 1;其餘條目之 id、內容、順序零改動;群組順序 `oc`→`ocgo`→`agy`→`claude`→`codex`→`typesafe`→`zen`→`agnes`→`claude-api`→`anthropic`);②`providers.mjs` 檔頭新增 2026-11-21 漂移紀錄(訊息全文、前後條目數、恢復條件與原條目欄位、原 REST 條目之思考開關實測),2026-09-22 紀錄之「實測仍可用故保留」註記自 2026-11-21 起不成立;③`POOLSIDE_KEYS` 已無內建條目使用:自 README `.env` 範例、`providers.mjs`〈使用方式〉、`splitKeys.mjs` 已知供應商說明移除,**`readEnvFile`／`resolveProviders`／`splitKeys` 通用機制不改**(自訂條目仍可用任意 `envVar`),`.env` 不動;④以 laguna 為例之說明改用仍存在之條目(`dispatchAiFallback` 與 README 之 `id` 命名規則改 `claude:sonnet`／`claude-api:sonnet-5.5`／`anthropic:sonnet-5.5`、`resolveProviders` 範例改 `agnes/agnes-3.0-flash` → `agnes:agnes-3.0-flash`);⑤README 行為變更第 78 條、量級感受(35 條／27 條;175／135 分鐘;8.75／6.75 小時);⑥新測試 `test/unit-providersPoolsideRemoved.test.mjs`(13 條,修前〔HEAD 之 `src` 與 README〕11 紅、修後全綠),並更新斷言內建條目之 `unit-providersCodexEntries`(群組順序)、`unit-providersOpencodeFreeEntries`／`unit-providersOpencodeGoDocs`／`unit-providersOpencodeGoEntries`(條目數)、`unit-resolveProviders`(模擬 env 不含 `POOLSIDE_KEYS`).驗證結果與外審見 `agent-out/dl583-修正報告.md`.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 |
|---|---|---|
| 內建條目因上游結構性失效而下架:清單端點仍列不等於可用;下架時檔頭漂移紀錄、金鑰變數列舉、範例、條目數與群組順序、README 同步;通用機制不改 | `rulebook_providers.md` R-PROVIDERS-1 | `test/unit-providersPoolsideRemoved.test.mjs`、`test/unit-providersCodexEntries.test.mjs`(群組順序)、`test/unit-providersOpencodeGoDocs.test.mjs`／`unit-providersOpencodeGoEntries.test.mjs`／`unit-providersOpencodeFreeEntries.test.mjs`(條目數 35) |

## 三、已知待辦

- **下游同步(主控,發布後)**:全域技能 `dispatch-opencode`(`SKILL.md` 之條目表與條目數／byKind、`.env` 範例之 `POOLSIDE_KEYS`、`poolside:` 前綴與 Poolside 自訂 provider 範例;`references/opencode-flags.md` 之條目表與說明)尚列已移除之條目,須由主控同步(逐處清單見 dl583 報告);本套件不改他處.
- **恢復條件**:Poolside 之 `POST /chat/completions` 回 200 時依檔頭收錄檢核重收(原欄位見 2026-11-21 漂移紀錄);是否為本帳號層之停用未證實(無公開公告),不論何者現有金鑰皆必失敗.
