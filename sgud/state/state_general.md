# 現況(state)(類型:套件通則(已發布版本、sgud 遷移、規則帳本拆檔、遮蔽單一來源、子進程啟動分流／userfn／agy 之既有測試))

本檔自 `state.md` 依功能類型拆出(2026-11-07,全域 §14;逐字搬移,節號與標題不變);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 已發布:1.0.55(`99a33bc`,2026-10-20).
- **工作區未發布之改動**,下次發布時一併帶出(使用者指示「更新 w-dispatch-ai 等下次再發布」):
  - (2026-10-23,主控直辦)指引要求文件遷移為 sgud 配置(`CLAUDE_experience.md` → `sgud/exp/experience.md`、`CLAUDE_rulebook.md` → `sgud/rule/rulebook.md`;`.gitignore` 調整、新建 `.npmignore`);`src/providers.mjs`:`oc:opencode/beam-free` 加脈絡長度實測註記(完整 1,048,576,不覆寫)、`oc:opencode/nemotron-3.5-super-vl-free` 覆寫 `limit`(context 1000000、input 950000、output 131072)並加實測註記.
  - 2026-10-25 規則帳本依全域 sgud 規則拆檔(`rulebook.md` 只留索引;內容逐字搬移,節號與標題不變).
  - (2026-11-19,dai492i 修正輪)`wsemi` 升至 `^1.9.69`(`isestr` 等判斷函數只收原始值:String 包裝物件為 `false`;判斷函數對任何輸入皆不拋錯,含已撤銷之 Proxy):`src/opencodeLimit.mjs`(`printLogsOn`、`logFlagsToAdd`)與 `src/dispatchAiFallback.mjs`(`keyFingerprint`)改為直接用原始字串、註解依新語意改寫;`unit-opencodeLimit`、`unit-dispatchAiFallbackKinds` 之包裝物件案依新語意改寫(包裝旗標／包裝金鑰視同未給);`asText`(轉型取文字,String 包裝物件仍拆包)行為未改.當時未完成者(全套 6 案紅:注入之物件已撤銷之 Proxy／toStringTag 拋錯之敵意輸入案,原靠判斷函數拋錯而轉 `params`;「keys 全為包裝物件」之 `claude` CLI 條目改走登入態計費)已由下一項(dai492i2)處理.
  - (2026-11-19,dai492i2 接續修正輪,同一工作樹未提交)**可讀性探針與金鑰型 opt 收嚴**:①新 `probeReadable`／`assertReadable`(`src/callUserFn.mjs`;帳本 `rulebook_userfn.md` R-USERFN-4,附站點表):呼叫端給的物件／陣列之「不可讀」先經明確探針(內部標籤＋`Reflect.ownKeys`),不再借 wsemi 判斷函數對敵意輸入拋錯;站點:`readCallerObj`(含函數型)、`dispatchAiFallback`(providers 陣列與條目、`initState`、`keysAreActualAuth`、`isOfficialAnthropicEntry`)、`callAiWithFallback`(`buildChain`、`spec.fallback`)、`dispatchOpencode` 之 `config`、`filterOpencodeFree` 之 `env`、`resolveProviders`／`resolveCatalogue`(同步 throw);原 6 案紅依原規格轉綠(期望未改).②新 `src/readKeyOpt.mjs`(R-KEYOPT-1,見 `state_anthropic.md`):`key`／`keys` 給了而無效即 `params`、不起子進程不送請求.③新測試 `unit-probeReadable`／`unit-probeSites`／`unit-keyOptReject`;改寫 `unit-dispatchClaudeKey` R03／R08、`unit-dispatchAiFallbackKinds`(keys 全為包裝物件);README 行為變更紀錄第 77 項.④`sgud/exp/experience.md` 逾 30KB,依 role-writer-sgud 逐字抽出八節至 `experience_20261119.md`(主檔約 25KB).**未改、待裁示**:契約外之純量設定值(`sandbox`／`skipPermissions`／`addDirs`／`baseURL`／`exe` 等)於敵意值時視同未給／預設(依 dspec §11 影響安全／計費者應拒絕),見 R-USERFN-4〈契約外之純量設定值〉.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 |
|---|---|---|
| 遮蔽單一來源 | R-REDACT-1(`rulebook_spawn.md`)、R-ANTHROPIC-1 | `test/unit-redactText.test.mjs` |
| 子進程啟動分流、validate、注入函數、agy | `rulebook_spawn.md`／`rulebook_userfn.md`／`rulebook_agy.md` | 既有測試(全綠) |
| 可讀性探針(不借判斷函數拋錯之防線;wsemi 1.9.69 下游) | R-USERFN-4(`rulebook_userfn.md`,含站點表) | `unit-probeReadable`、`unit-probeSites`、`unit-userFnHostile`／`unit-userFnValidate`／`unit-userFnWorkflow`(原 6 案) |
| 金鑰型 opt(`key`／`keys`)給了而無效即拒絕 | R-KEYOPT-1(`rulebook_anthropic.md`) | `unit-keyOptReject`、`unit-dispatchClaudeKey`(R03／R08)、`unit-dispatchAiFallbackKinds`(keys 全為包裝物件) |

## 三、已知待辦

- **(2026-11-19 dai492i2,待主控裁示)影響安全／計費之純量設定值「給了而無效」之處理**:codex `sandbox`(退回 `workspace-write`)、claude／agy `skipPermissions`(退回 true)、agy `addDirs`(退回 `[cwd]`)、REST `baseURL`(退回官方端點,金鑰改送官方)、各家 `exe`／`cwd`,於給了一般無效值(如數字)時修前即退回預設;1.9.69 起已撤銷之 Proxy 等敵意值亦同(修前為 reject)。依 dspec §11 應「給了而無效即拒絕」,本套件僅對 `key`／`keys` 落實(R-KEYOPT-1),其餘待裁示是否比照並另派。
- **(2026-11-19 dai492i2,已知、未改)**:`createAiCaller` 之 `onUsage` 於 `try` 事件入帳,條目因 params 失敗(無效 `kind`、不可讀條目、`keys`／`key` 給了而無效)未實際送出仍發 `try`(既有行為);`getQuotaClaude`／`getQuotaCodex` 之不可讀 `opt.env` 改查預設帳號;`probeAnthropicKeys` 之不可讀 `keys` 引數回空結果;`makeArrayCoverageValidator` 之不可讀 `contentFields`／`maxLengths` 放寬驗證器;`callAI(prompt, o)` 之不可讀 `o` 視同 `{}`;`dispatchClaude` 等之頂層 `opt` 為已撤銷之 Proxy 或 `opt.key` 為拋錯 getter 時於 try 外 reject(修前即有,契約外);`resolveProviders` 條目同時帶 `envVar` 與無效 `keys` 時以 env 金鑰覆蓋(`isearr` 與 `readKeys` 語意不同)。
- 2026-11-19(dai492i2):`sgud/exp/experience.md` 約 51KB 逾門檻,八節(da405、ke339、ke340、ke342、da110、da116、di402、d417)逐字抽出至 `experience_20261119.md`(約 33KB,**本檔亦已逾約 30KB 門檻**,是否再依類型拆分待主控安排),主檔約 25KB.

- `sgud/exp/experience.md` 已於 2026-11-03(da65)依全域設定 §14 整理:舊經驗抽出為 `experience_20261103.md`(逐字搬移,節號與標題不變),主檔約 14KB(加 da65 一節後約 18KB).
- 2026-11-08(da110):`sgud/exp/experience.md` 加 da110 一節後逾門檻(約 34KB),已把 2026-10-23～11-05 之四節逐字抽出至 `experience_20261108.md`(約 18KB),主檔約 17KB;上列三檔仍未動.
- **sgud 檔案大小**(2026-11-07 盤點,全域 §14 約 30KB 門檻):`sgud/rule/rulebook_spawngate.md`(約 35KB)、`sgud/rule/rulebook_opencodego.md`(約 34KB,本輪加入 ke339 後)、`sgud/exp/experience_20261103.md`(約 31.5KB)已逾門檻;第 325 項僅要求整理 `state.md`／`experience.md`,上列三檔未動,是否依類型再拆待主控安排.
