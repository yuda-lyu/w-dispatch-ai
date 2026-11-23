# 現況(state)(類型:2026-11-23 tdai2:`env`／`exes` 各值、`pick`／`patch`,與影響計費之 opt 盤點)

承 `state_tdai1b.md`(2026-11-23 tdai1b);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`〈tdai2〉).

## 一、版本與未發布之改動

基準 1.0.109(已發布);**未發布**(README 行為變更新增第 87、88 條,標題「未發布（預計 1.0.110）」;1.0.109 之標題已改為已發布).本輪處理 tdai1b 報告〈需裁示〉1、3 之主控裁定(裁示 2 `provider: ''` 維持現狀,不改碼):

| 項 | 處置 | 帳本 | 主要檔 |
|---|---|---|---|
| `env` 各變數之值、`exes` 各 kind 之值(裁示 1②) | `env` 之值須為字串:**`undefined` 合法**(實測 Node `spawn` 不傳該變數;wsemi `execCli` 載明為移除語意,非「視同未給」),`null`、數字、布林、物件、陣列、包裝物件、函數、`Symbol`、`BigInt` 拒絕;`exes` 之值須為非空字串(`undefined`／`null` 為未給該 kind);四家 CLI／`runExecCli`／`filterOpencodeFree`／額度讀者以 `params`(`attempts 0`,起子行程之前),`resolveProviders`／`resolveCatalogue`／`createAiCaller` 同步 throw | R-SAFEOPT-1 規則 11 | `src/readSafeOpt.mjs`(`checkObjValues`、`checkObjOpt(v, name, vals)`、`readEnvOpt`、`readExesOpt`)、`resolveProviders.mjs`、`resolveCatalogue.mjs` |
| `resolveProviders`／`resolveCatalogue` 之 `pick` 非陣列、`patch` 非物件(裁示 1②) | 同步 throw(修前視同未給:`pick` 為字串即全取含付費條目) | 規則 11 | `readSafeOpt.mjs`(`checkArrOpt`、`assertArrOpt`) |
| 影響計費之 opt 盤點與處置(裁示 3②) | 盤點見〈二〉;**7 個 opt、15 站點改為拒絕**(`model`〔四家 CLI 與 Typesafe,5 站點〕、agy `effort`、opencode `outputTokenMax`、Anthropic `effort`、四個 REST 之 `body`〔4 站點〕、`fetch`〔Anthropic 與 claude 交叉確認,2 站點〕、claude `crossCheck`);其餘維持 K3 | 規則 11 | `readSafeOpt.mjs`(`readNameOpt`、`readEnumOpt`、`readTokenMaxOpt`、`readFunOpt`、`checkReadObj`、`SAFE_SPEC`)、四家 CLI 與四個 REST 轉接器 |
| `provider: ''` 而 `key` 有效(裁示 2) | 維持現狀(不改碼) | 規則 7 | — |
| **tdai2b 收尾(主控對 tdai2〈需裁示〉之裁定)** | `patch` 內逐 id 之值給了而非一般物件、`resolveCatalogue.catalogue` 給了而非陣列 → 同步 throw;`dispatchOpencode.config` 給了而非字串亦非一般物件 → `params`;`env` 之 `undefined` 維持合法;`fetch`／`crossCheck` 保留;訊息家族不變 | 規則 11(tdai2b 補) | `readSafeOpt.mjs`(`readPatchOpt`、`readMapOpt`、`checkConfigOpt`、`SAFE_SPEC`)、`resolveProviders.mjs`、`resolveCatalogue.mjs`、`dispatchOpencode.mjs` |

公開 API 無改名、無新增匯出;內部 `readSafeOpt` 新增上述函數與 `ANTHROPIC_EFFORTS`(`dispatchApiAnthropic` 改自其取用);`dispatchAiFallback` 之 `checkSafeOpts` 之 `SAFE_SPEC` 擴及上列各 opt 與 `api-openai-compat`／`api-openai-responses` 之 `body`.

## 二、影響計費之 opt 盤點表(站點為本批改後之 `file:line`)

判準(主控 2026-11-23):給了而無效時**改變計費**(改用 CLI 預設模型、預設 effort、預設上限、實際發出請求)⇒ 拒絕;不改變計費 ⇒ 維持 K3.

| 站點 | opt | 現行處置(修前) | 無效時之計費後果 | 判定 | 改動 |
|---|---|---|---|---|---|
| `dispatchClaude.mjs:390` | `model` | 無效→不帶 `--model` | CLI 依方案決定(2.1.280 起 Pro／Team 亦預設 Opus) | 拒絕 | `readNameOpt` |
| `dispatchCodex.mjs:114` | `model` | 無效→不帶 `-m` | config.toml 之 model 或官方推薦預設 | 拒絕 | `readNameOpt` |
| `dispatchOpencode.mjs:322` | `model` | 無效→不帶 `-m` | opencode 設定之預設模型 | 拒絕 | `readNameOpt` |
| `dispatchAntigravity.mjs:275` | `model` | 無效→不帶 `--model` | agy 預設(1.4.0 實測 Gemini 4 Argon Medium,耗 Argon 額度) | 拒絕 | `readNameOpt` |
| `dispatchAntigravity.mjs:280` | `effort` | 無效→不帶 `--effort` | agy 預設檔位 | 拒絕 | `readNameOpt` |
| `dispatchOpencode.mjs:330` | `outputTokenMax` | 無效→呼叫端環境之值或預設 128000 | 單次輸出上限改變(CLI 原預設 32000,預設 128000 為其 4 倍) | 拒絕 | `readTokenMaxOpt` |
| `dispatchApiAnthropic.mjs:463` | `effort` | 無效→不送 | API 依模型預設(Opus／Haiku 5.5 為 medium、Sonnet 5.5 為 high) | 拒絕 | `readEnumOpt` |
| `dispatchApiTypesafeSystemone.mjs:327` | `model` | 無效→`jev-latest` | 官方預設模型 | 拒絕 | `readNameOpt` |
| `dispatchApiAnthropic.mjs:477`、`dispatchApiOpenaiCompat.mjs:395`、`dispatchApiOpenaiResponses.mjs:445`、`dispatchApiTypesafeSystemone.mjs:348` | `body` | 非物件→`{}` | 呼叫端以 `body` 給之 `max_tokens`／`max_output_tokens`／`thinking`／`reasoning` 等被丟棄,改用預設 `max_tokens`(Anthropic 16000)或伺服器預設 | 拒絕 | `checkReadObj` |
| `dispatchApiAnthropic.mjs:435` | `fetch` | 非函數→全域 `fetch` | 呼叫端要注入替身(零費用)卻發出真實請求 | 拒絕 | `readFunOpt` |
| `dispatchClaude.mjs:401` | `fetch`(交叉確認) | 非函數→全域 `fetch` | 同上(僅 API 金鑰在場且判為沒額度時) | 拒絕 | `readFunOpt` |
| `dispatchClaude.mjs:397` | `crossCheck` | 非布林→視為開 | 呼叫端要關卻多發 1 則 `max_tokens: 1` 之 REST 請求(費用極小,金鑰送往網路) | 拒絕 | `readBoolOpt` |
| `dispatchApiAnthropic.mjs:429`、`dispatchApiOpenaiCompat.mjs:372`、`dispatchApiOpenaiResponses.mjs:422` | `model` | 必填:未給或無效本就 `params` | — | 本就拒絕 | 不改 |
| `dispatchApiAnthropic`／三個 REST | `maxTokens` | **無此 opt**:輸出上限只經 `body.max_tokens`／`max_output_tokens`(見 `body` 列) | — | 併入 `body` | — |
| `dispatchOpencode.mjs:336` | `agent` | 無效→`build` | 非計費(權限／工具集);tdai1b 主控裁定維持 | 維持 | — |
| `dispatchOpencode.mjs:384` | `config` | 非字串非物件→沿用既有設定 | 設定內若載 model／provider 才間接改變計費路徑;tdai1b 主控裁定維持,**tdai2b 主控裁定改為拒絕** | **拒絕**(tdai2b;`''`、字串、一般物件、未給照舊) | `checkConfigOpt` |
| `dispatchOpencode.mjs:353` | `stopOnLimit` | 非 `false`→開 | 提早終止,不增計費 | 維持 | — |
| `dispatchOpencode.mjs:346、385`、三個 REST `acceptTruncated` | `detectTruncation`／`continueLoopOnDeny`／`acceptTruncated` | 非 `true`→關 | 關閉為較保守態,不增計費 | 維持 | — |
| 四個 REST 與 `runExecCli` | `maxRetries` | 無效→0(`castCountOr`) | 只會更少重試 | 維持 | — |
| 各轉接器 | `timeoutMs`、`retryDelayMs` | 無效→預設 | 時限;不改變單次請求內容 | 維持 | — |
| `dispatchAntigravity.mjs:241、297` | `promptVia`、`printTimeout` | 無效→`auto`／由 `timeoutMs` 導出 | 傳法與逾時,不改請求內容 | 維持 | — |
| 三個 REST | `system`、`headers` | 無效→不帶 | 少一段提示或標頭,不增計費 | 維持 | — |
| `dispatchClaude.mjs:541-542` | `crossCheckBaseURL`、`crossCheckModel` | 無效→`probeAnthropicKey` 內判:網址無效回 `params` 不送請求、模型無效改用 `claude-haiku-5-5`(最便宜) | 不增計費 | 維持 | — |
| `probeAnthropicKeys.mjs:154` | `model` | 無效→`claude-haiku-5-5`(最便宜) | 非派工函數;探測 `max_tokens: 1` | 維持 | — |
| 各 CLI | `extraArgs`、`spawnGate`、`quotaGate` | 使用端原樣旗標／守門設定 | 非 opt 有效性問題 | 不適用 | — |
| `resolveProviders.mjs:119,214`、`resolveCatalogue.mjs:218,241` | `patch` 內逐 id 之值 | 非物件值略過 | 覆寫之欄位(含 `model`)被丟掉,與 `exes` 各值同形 | **拒絕**(tdai2b) | `readPatchOpt` |
| `resolveCatalogue.mjs:211` | `catalogue` | 非陣列→改用含付費條目之內建目錄 | 與 `pick` 為字串而全取同形 | **拒絕**(tdai2b;未給才用內建目錄) | `assertArrOpt` |

## 三、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| `env` 各值、`exes` 各值、`pick`、`patch` 給了而無效即拒絕 | R-SAFEOPT-1 規則 11 | `test/unit-envExesValues.test.mjs`(34 案:V1～V7);改寫 `unit-envExesReject`(2 案調整)、`unit-probeSites`、`unit-resolveCatalogue` | 完成 |
| `patch` 逐 id 之值、`catalogue`、opencode `config` 給了而無效即拒絕(tdai2b) | 規則 11(tdai2b 補) | `test/unit-patchCatalogueConfig.test.mjs`(13 案:P1／C1／O1／O2);改寫 `unit-opencodeAuthOpts`(P2)、`unit-probeSites`、`unit-resolveCatalogue` | 完成 |
| 影響計費之 opt 給了而無效即拒絕 | 規則 11 | `test/unit-billingOpts.test.mjs`(30 案:B1～B9);改寫 `unit-dispatchApiAnthropic`、`unit-dispatchApiAnthropicFailureKind`、`unit-dispatchClaude`、`unit-dispatchCodex`、`unit-dispatchClaudeFailureKind`、`unit-opencodeTruncation` | 完成 |

## 四、已知待辦與裁定

**tdai2b(2026-11-23,排程第 601 項收尾;主控裁定)**:①`env` 值為 `undefined` 合法(移除該變數)維持;②`patch` 內逐 id 之值給了而非一般物件 → 同步 throw(`readPatchOpt`);③`resolveCatalogue.catalogue` 給了而非陣列 → 同步 throw(`mergeCatalogue` 單獨呼叫之行為不變);④`dispatchOpencode.config` 給了而非字串亦非一般物件 → `params`(`checkConfigOpt`,遞補層 `SAFE_SPEC` 同步),`agent` 維持退回 `build`;⑤`fetch`／`crossCheck` 保留拒絕;⑥訊息沿用本庫既有家族(全庫統一 V19 字首另案);⑦README 1.0.109 標題改為已發布、新增 1.0.110 節;⑧發布包配置之全套本輪不做(發布閘門另於本庫跑全套).

仍開之項:
- `resolveProviders` 之 `env` 為存取器、未被取用且回傳非字串者不判(不執行 getter 之既有契約).
- `mergeCatalogue` 單獨呼叫(深層匯入)之 `catalogue` 非陣列仍用內建目錄(其匯出契約,既有測試釘住;`resolveCatalogue`／`createAiCaller` 已先拒絕).
- 全庫訊息字首統一為 dspec V19(`invalid <名稱>: must be …`)另案(破壞性,測試與文件須同改).
- 下游全域技能 dispatch-* 須同步升版須知(主控改 AI 設定庫;清單見修正報告).

## 五、驗證(2026-11-23 tdai2;基準 1.0.109 之 HEAD `ef4d7b2`)

- **修前紅**(HEAD 快照 `git archive HEAD` 解於 `./tmp/tdai2/pre/`,新測試檔 `readSafeOpt` 具名匯入改為命名空間匯入): `unit-billingOpts` 18 failing／12 passing(保持案)、`unit-envExesValues` 27 failing／7 passing(保持案)、9 案改寫之既有契約案 9 failing.
- **全套**(PATH 皆已移除真 CLI 並 `where` 確認):tdai2 最終並行 2144 passing／16 pending(其中 3 為離線之連網守門略過)／0 failing,依序 2147／13／0;**tdai2b 最終並行 2160 passing／13 pending／0 failing**(tdai2b 新增 13 案;首次全套紅 1 案為事前盤點漏掉簡寫形式 `{ exe, config }` 之既有案,改寫後綠).
- **tdai2c(2026-11-23,發布閘門紅 1 案)**:`test/api-opencodeOutputCap.test.mjs` A2「無效值」案仍釘 1.0.109 之「opt 無效 ⇒ 預設」,改寫為「opt 給了而無效 ⇒ `params`、假服務未收到請求;環境內之無效值 ⇒ 預設 128000」;真 PATH 下該檔 10 案全過(0 pending);修前(舊斷言於現行碼)紅 1 案(實測 `[[],[],[128000],[128000]]`),新斷言於 HEAD(1.0.109)碼上亦紅 1 案;哨兵全套確認整個測試目錄以預設名稱啟動真 CLI 僅 `opencode --version`(此檔)與 `opencode models --refresh`(`api-providersOpencodeFree`,連 models.dev)兩處;全套(自 PATH 移除真 CLI)見修正報告.帳本規則 11 補「需真 CLI＋本機假服務之 `api-` 測試於改動相關 opt 時須以真 PATH 跑過」.
- **tdai2b 修前紅**(工作樹快照 `./tmp/tdai2b/pre/`,即 tdai2 成果):新測試 `unit-patchCatalogueConfig` 13 案中 8 failing／5 passing(保持案);改寫之既有契約案 4 案(`unit-opencodeAuthOpts` P2、`unit-dispatchOpencode` config、`unit-probeSites`、`unit-resolveCatalogue`)4 failing.
- **tdai2b 變異**(鏡像 `./tmp/tdai2b/mut/`):25 項(MP01～10、MC01～10、MR01～07;含成對 MP10〔`resolveProviders`＋`resolveCatalogue` 皆忽略 patch 值錯誤〕、MC10〔轉接器＋`SAFE_SPEC` 皆不判 config〕及兩項「判定移到合併之後」之順序變異),**25 殺死、0 存活、0 等價**.
- **eslint**(`src test --ext .mjs,.js`):僅既有 3 個錯誤(`unit-agyFailShapes` 101 行 `brace-style`×2、`unit-toQuotaWindow` 25 行 `no-loss-of-precision`),本輪動過之檔 0 錯.
- **變異**(鏡像 `./tmp/tdai2/mut/`:只複製檔案、無目錄連結;錨點不存在或不唯一即報 `ANCHOR-FAIL`;檔案換行依鏡像檔 CRLF／LF 自適應):70 項,**終局全殺死**.首輪 3 項存活(RV07 取用變數值之 `null`、RC03 `resolveCatalogue` 之 `pick` 判定、RC05 `resolveCatalogue` 之 `env` 值判定)——RV07 缺「getter 回傳 `null`／布林／物件」之案、RC03／RC05 與 `resolveProviders` 同判定互為備援而缺「只有 `resolveCatalogue` 之檢核先於合併才抓得到」之案(`extraProviders` 不合規時之訊息先後);補案後轉紅,成對變異 PR01～PR03 亦殺死.另 5 項首輪因鏡像檔為 CRLF 而 `ANCHOR-FAIL`(腳本之錯,非存活),改為換行自適應後重跑全殺死.
