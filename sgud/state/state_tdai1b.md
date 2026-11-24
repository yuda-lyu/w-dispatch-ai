# 現況(state)(類型:2026-11-23 tdai1b 修正輪:opencode 計費與權限相關 opt、四家 CLI 與目錄展開之 env／exes)

承 `state_tdai1.md`(2026-11-22 tdai1);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience_20261124b.md`〈tdai1b〉;2026-11-24 自 `experience.md` 抽出).

## 一、版本與未發布之改動

基準 1.0.108(`792ae9b`);**未發布**(與 tdai1 同一發布窗,README 行為變更新增第 85、86 條,標題仍為「未發布（預計 1.0.109）」).本輪只處理 tdai1 報告〈需裁示〉經主控裁定之項目:

| 項 | 處置 | 帳本 | 主要檔 |
|---|---|---|---|
| `dispatchOpencode` 計費路徑與權限相關 opt(裁示②) | `provider` 給了而非原始非空字串**且 `key` 有效** → `params` 拒絕(`readProviderOpt`;未給與 `''`、無 key 者維持現狀);`useStoredAuth` 給了而非布林 → `params` 拒絕;遞補層 `checkSafeOpts(kind, opt, { keyed })` 於發 `try` 前同源判定 | R-SAFEOPT-1 規則 9 | `src/readSafeOpt.mjs`(`readProviderOpt`、`SAFE_SPEC`)、`dispatchOpencode.mjs`、`dispatchAiFallback.mjs` |
| 四家 CLI 與目錄展開之 `env`／`exes`(裁示②) | CLI 四家／`runExecCli`／`filterOpencodeFree` 之 `env` 給了而非物件 → `params`(起任何子行程之前判;可讀者物化副本只讀一次);`resolveProviders`／`resolveCatalogue`(`createAiCaller` 建構經之)之 `env`／`exes` 給了而非物件 → 同步 throw;遞補層 `checkSafeOpts` 四家 CLI 加 `env`(只驗形狀、不執行 getter,`checkObjOpt`) | R-SAFEOPT-1 規則 10 | `src/readSafeOpt.mjs`(`checkObjOpt`、`assertObjOpt`、`readEnvOpt`)、`runExecCli.mjs`、`dispatchClaude.mjs`／`dispatchCodex.mjs`／`dispatchOpencode.mjs`／`dispatchAntigravity.mjs`、`filterOpencodeFree.mjs`、`resolveProviders.mjs`、`resolveCatalogue.mjs` |
| 發布包配置之全套(裁示③) | `npm pack` 解開於 `./tmp/`、`npm ci --min-release-age=0` 後全套;另本庫 `--parallel` 全套(PATH 皆已移除真 CLI) | (測試配置,無新規則) | — |

README 行為變更新增第 85、86 條;公開 API 無改名、無新增匯出;內部 `readSafeOpt` 新增 `readProviderOpt`、`checkObjOpt`、`assertObjOpt`.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| opencode `provider`(key 有效時)與 `useStoredAuth` 給了無效即拒絕 | R-SAFEOPT-1 規則 9 | `test/unit-opencodeAuthOpts.test.mjs`(7 案);改寫 `unit-dispatchOpencode`「useStoredAuth…」 | 完成 |
| `env`／`exes` 給了而非物件即拒絕 | R-SAFEOPT-1 規則 10 | `test/unit-envExesReject.test.mjs`(25 案:四家 CLI＋`runExecCli` 各 E1／E2,E3 目錄展開、E5 遞補層與不執行 getter、E6 `filterOpencodeFree`、E7 零次啟動與只讀一次);改寫 `unit-probeSites`「resolveProviders…」 | 完成 |
| 測試共用之敵意值與 PATH 守門 | (測試工具) | `test/tools/hostileValuesForTest.mjs`(`unit-safeOpts` 同用) | 完成 |

## 三、已知待辦

- **(2026-11-23 tdai2 已處理:①②③ 依主控裁定採②、④維持現狀,見 `state_tdai2.md`;以下為 tdai1b 當時之待裁示原文)** **需主控裁示**(同形項,本輪範圍外):①`exes` 之各 kind 值為非字串(`{ claude: 123 }` 照舊略過)、`env` 之各變數值為非字串;②`resolveProviders` 之 `pick`／`patch` 給了非預期型別(視同未給,`pick` 為字串即全取含付費條目);③`model`／`effort`／`outputTokenMax` 等有計費影響之一般 K3 項;④`dispatchOpencode` 之 `provider` 為 `''` 而 `key` 有效時 `key` 不被注入(維持現狀,文件載明之預設值).
- **下游全域技能須同步**(主控改 AI 設定庫):四家 dispatch 技能之 `env`／`exes`／`useStoredAuth`／`provider` 說明(兩輪合併之升版須知見本輪修正報告).
- 同 tdai1:`dist/` 為發布時自動產製;轉接器自身才得知之 `params`(`dispatchAi` 內)仍發生於 `try` 事件之後.

## 四、驗證(2026-11-23 tdai1b;基準 1.0.108 + tdai1 成果)

- **修前紅**(於未改 `src` 之版本上跑新測試檔):`unit-opencodeAuthOpts` + `unit-envExesReject`(首版 27 案)10 passing／17 failing(10 為保持案);其後新增之案之紅由變異證明.
- **全套**(PATH 皆已移除真 CLI,`where` 確認):本庫 `--parallel`(`--jobs 6`)×3、`--no-parallel`×1、發布包解開目錄(`npm pack`→`npm ci --min-release-age=0`〔`wsemi@1.9.71` 於預設 `min-release-age` 下 ETARGET,本機 `~/.npmrc` 之 `min-release-age-exclude` 未生效〕)`--parallel`×1:各 **2083 passing／13 pending／0 failing**(pending 數與 tdai1 一致).首版(尚未改為只驗形狀之 `checkSafeOpts`)之第一次全套紅 1 案(`unit-dispatchAiFallbackKinds`「範圍檢查不執行條目 env 內 getter」),已改 `checkObjOpt` 並補案,見經驗.
- **eslint**:3 個既有錯誤(`unit-agyFailShapes`、`unit-toQuotaWindow`,本輪未動之檔);本輪動過之檔 0 錯.
- **變異**(鏡像:發布包解開並 `npm ci` 之目錄;P 系列 14、E 系列 25、C 系列 5〔`checkObjOpt` 形狀判定〕、成對 3 = 47):42 殺死(新測試)、1 項僅既有測試殺死(E12:key 模式訊息遮蔽,既有 `unit-dispatchClaudeKey` 類)、**4 存活皆判等價**:P14(`provider` 用原值:`readProviderOpt` 回傳值只在 `isestr` 時等於原值,消費端只用 `isestr(provider)`)、E14(`dispatchClaude` 非 key 之 env 判定:與 `runExecCli` 同一判定互為備援,成對移除〔E26〕即紅)、E25(`resolveCatalogue` 之 exes 判定:與 `resolveProviders` 互為備援,成對移除〔E27〕即紅)、C05(`checkObjOpt` 對 `process.env` 之特判:其內部標籤即 `[object Object]`,特判只省探針).
- **公開庫守門**(private-guard)見修正報告.
