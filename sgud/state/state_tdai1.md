# 現況(state)(類型:2026-11-22 tdai1 維護批次:次數類、安全 opt、守門取嚴、ask 被拒、codex 事件與 refs、README 版號)

本檔自 2026-11-22 tdai1 起單列(全域 §14:依功能類型分檔);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience_20261124b.md`〈tdai1 批次〉;2026-11-24 自 `experience.md` 抽出).

## 一、版本與未發布之改動

基準 1.0.108(`792ae9b`);**未發布**(版本號與發布由主控處理,README 新條標題為「未發布（預計 1.0.109）」).本批各項(排程第 446、553、386、422、454、448③、388②、345 項):

| 項 | 現況核實(動工前) | 處置 | 帳本 | 主要檔 |
|---|---|---|---|---|
| 446 次數類 | 屬實:REST 四家 `dispatchApi*.mjs` 與 `runExecCli.mjs` 之 `maxRetries` 以 `isp0int`＋`cint`;`keepDays`／`maxLengths`／`minCandidates`／`topN`／`parseIndexList` 之 `min`／`max`／驗證規則 `min:N`／遞補層游標與金鑰冷卻時間戳／`appliedTimeoutMs` 同形 | 新單一來源 `castCountOr.mjs`(`iseint` 之 `count`);站點 11 檔各 1,另游標(index)、時間戳(timestamp)、`parseIndexList` 之 `min`／`max`(safe)就地 `iseint`,`appliedTimeoutMs` 用 `castTimerMs`;`runExecCli` 刪除 `mrCliOk`、以採用值轉交 `execCli` | R-COUNT-1(`rulebook_count.md`) | `src/castCountOr.mjs`、`dispatchApi*.mjs`、`runExecCli.mjs`、`dispatchAiFallback.mjs`、`buildValidator.mjs`、`wkf/*` |
| 553 安全 opt | 屬實(dai492i2 報告 R4、R5):`sandbox`／`skipPermissions`／`addDirs`／`baseURL`／`exe`／`cwd`／額度讀者 `env` 給了無效皆退回預設;B2、C1、A5、A7 屬實 | 新單一來源 `readSafeOpt.mjs`;給了而無效以 `params` 拒絕(`''` 亦拒);併 `probeAnthropicKey(s)`／`opencodeGoUsage` 之 `baseURL`;B2 `resolveProviders` 改 `readKeys` 判;C1 條目層 `params` 失敗不發 `try`;A5 `probeAnthropicKeys`;A7 `callAI` 之 `o` 與 `makeArrayCoverageValidator`;既有三案契約改寫 | R-SAFEOPT-1(`rulebook_safeopt.md`) | `src/readSafeOpt.mjs`、四家 CLI 轉接器、`dispatchApiAnthropic.mjs`／`TypesafeSystemone.mjs`、`probeAnthropicKeys.mjs`、`opencodeGoUsage.mjs`、`quota/getQuota*.mjs`、`resolveProviders.mjs`、`createAiCaller.mjs`、`dispatchAiFallback.mjs` |
| 386 `unit-dispatchAntigravity` 偶紅 | **已於 1.0.108 處理(da-hy,排程第 438 項,`dffeffa`)**:原案以 `timeoutMs` 1、999、1001 等實起假執行檔(其 `--print-timeout` 推導改由 `unit-timeoutEntrances` 參數層驗);現案只剩 ≥ 40000 之格與無效值(回退預設 300000),無子行程於極短逾時前須完成之依賴 | **不重做**;以負載重跑證明(見〈驗證〉);另掃全測試目錄「極短 `timeoutMs` 且實起子行程」者 | R-AGY-2 對應測試註記;R-TIMEOUT-1 | `test/unit-dispatchAntigravity.test.mjs`(未動) |
| 422 守門其餘同形 | 屬實(R-COOL-5 第 5、6 點):`shouldStop`／`minAttemptMs` 物件優先、判型不一;探針與互斥鎖等待不受期限約束 | 新單一來源 `gateHints.mjs`(`orStop`、`maxMinAttemptMs`);探針逾時與排鎖等待受期限約束;既有三案(`unit-cliSpawnGate`、`unit-spawnGateDeadlineEarlier` S5、`unit-opencodeTransientRetry` 案名)契約改寫 | R-COOL-5 追加(`rulebook_cooling.md`) | `src/gateHints.mjs`、`cliSpawnGate.mjs`、`runExecCli.mjs` |
| 454 ask 被拒 | 屬實(技能 dispatch-opencode 2026-11-13 實測):修前回 `ok: true` 或 `validation` | `errorType 'denied'`(事件流或預設格式 stderr 簽章＋stdout 空)、`opt.continueLoopOnDeny`(預設不開;唯讀與內建條目不帶);遞補層整組跳過 | R-OCDENY-1(`rulebook_ocdeny.md`) | `src/opencodeDeny.mjs`、`parseOpencodeEvents.mjs`、`dispatchOpencode.mjs`、`dispatchAiFallback.mjs`、`getErrorType.mjs` |
| 448③ codex 命令事件 | 屬實:結果無逐命令之結構化輸出 | 帶 `--json` 時結果另帶 `raw`、`commands`;`stdout` 不改 | R-CODEX-2 | `src/parseCodexEvents.mjs`、`dispatchCodex.mjs` |
| 388② `refs/codex/*` | 屬實(使用端 2026-11-10);Codex 0.167.1 查證無關閉設定 | 收尾清除(派工前基準、只刪新出現且前綴恰為 `refs/codex/`);`cleanCodexRefs: false` 關閉 | R-CODEX-3 | `src/cleanCodexRefs.mjs`、`dispatchCodex.mjs` |
| 345 README 版號 | 屬實:22 個標題皆「未發布」 | 以各 npm 版本之 README 對照補實際版號(1.0.56 起至 1.0.108);新條標題「未發布（預計 1.0.109）」;檢查工具 `test/tools/readmeVersionsForTest.mjs`＋`test/unit-readmeVersions.test.mjs`(結構嚴格、過期標題提示) | (文件) | `README.md`、`test/*readmeVersions*` |

README 行為變更新增第 79～84 條(標題「未發布（預計 1.0.109）」);公開 API 無改名;新增:選項 `continueLoopOnDeny`、`cleanCodexRefs`,結果欄 `raw`／`commands`(codex)、`codexRefsRemoved`、`deniedTool`／`deniedRule`,`errorType 'denied'`,`parseOpencodeEvents` 之 `denied`;內部新模組 `castCountOr`、`readSafeOpt`、`gateHints`、`opencodeDeny`、`parseCodexEvents`、`cleanCodexRefs`(皆不經主入口匯出).

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| 次數類 `castCountOr` | R-COUNT-1 | `test/unit-castCountOr.test.mjs`、`test/unit-countParams.test.mjs` | 完成 |
| 安全相關純量 opt 給了無效即拒絕 | R-SAFEOPT-1 | `test/unit-safeOpts.test.mjs` | 完成 |
| 守門兩來源取嚴、探針與排鎖受期限約束 | R-COOL-5 追加 | `test/unit-gateHintsMerge.test.mjs` | 完成 |
| opencode `denied` 與 `continueLoopOnDeny` | R-OCDENY-1 | `test/unit-opencodeDeny.test.mjs` | 完成 |
| codex `raw`／`commands` | R-CODEX-2 | `test/unit-codexEvents.test.mjs` | 完成 |
| codex 清 `refs/codex/*` | R-CODEX-3 | `test/unit-codexRefsClean.test.mjs` | 完成 |
| README 標題版號檢查 | (文件) | `test/unit-readmeVersions.test.mjs` | 完成 |

## 三、已知待辦

- **需主控裁示**:①~~額度讀者 `exe`／`cwd` 與 `dispatchOpencode` 之 `provider`／`useStoredAuth`、四家 CLI 與 `resolveProviders` 之 `env`／`exes`~~(額度讀者之 `exe`／`cwd` 已於本批複審後改;`provider`／`useStoredAuth`／`env`／`exes` 已於 2026-11-23 tdai1b 依主控裁示②套用,見 `state_tdai1b.md`);`dispatchOpencode` 之 `config`／`agent`／`provider: ''` 維持現狀(文件載明之預設／常見值);②`cleanCodexRefs` 預設開(收尾清除新出現之 `refs/codex/*`;已知限制:同 repo 同時段他工作階段新建者亦被刪)是否改預設關;③預設格式下「已有文字輸出才被拒」之 opencode 結果無從確認續跑,仍回 `ok: true`(須開 `detectTruncation` 以事件流判讀),是否於技能與 README 以「被拒敏感之派工一律開 `detectTruncation`」明列.
- **下游全域技能須同步**(主控改 AI 設定庫):dispatch-opencode(`ask` 被拒段改記 `errorType 'denied'`／`continueLoopOnDeny`)、dispatch-codex(`--json` 驗收法直讀 `commands`;`refs/codex/*` 收尾清除與 `cleanCodexRefs`)、dispatch-claude／dispatch-antigravity(`skipPermissions`／`addDirs`／`exe`／`cwd` 給了無效即拒絕)、四技能之 `maxRetries` 說明(0～4294967295)——逐條列於本輪修正報告.
- 轉接器自身之 `params` 檢核(`dispatchAi` 內才得知)仍發生於 `try` 事件之後(`onUsage` 入帳);僅條目層 `params` 失敗已不發 `try`(R-SAFEOPT-1 規則 6 之 C1).
- `dist/` 為發布時自動產製(全域 §5.1),未隨本批更新.

## 四、驗證(2026-11-22 tdai1;基準 1.0.108)

### 全套與靜態檢查

- **全套**(`--parallel "test/*.test.mjs"`,PATH 已移除真 CLI):**2051 passing／13 pending／0 failing**;並行 6 次(含全部改動後之最終版一次)與序列(`--no-parallel`)1 次結果完全相同(pending 13 於各次一致).另於 PATH 上真 CLI 在場之環境以 `npx mocha --parallel` 跑一次:2063 passing／1 pending／0 failing(多出之 12 案為 `api-opencodeOutputCap` 在真 `opencode` 在場時不略過,打本機假服務).發布包解開目錄之配置**未跑**(本批不動打包內容;`dist/` 發布時自動產製).
- **eslint**(`src`、`test`):3 個錯誤,皆在本批未動之檔(`test/unit-agyFailShapes.test.mjs` 101 行 `brace-style`×2、`test/unit-toQuotaWindow.test.mjs` 25 行 `no-loss-of-precision`);本批動過之檔 0 錯.
- **公開庫守門**(private-guard)CLEAN.

### 修前紅／修後綠(HEAD 快照 `git archive HEAD` 上跑現行測試檔;全部不呼叫真 CLI 與外部服務)

| 項 | 測試檔(案數) | 修前(HEAD) | 修後 |
|---|---|---|---|
| 446 | `unit-castCountOr`(9) | 0 passing／9 failing(判定件 3 案因模組不存在、盤點 6 案因站點表不符) | 全綠 |
| 446 | `unit-countParams`(25) | 7 passing／18 failing(7 為保持案) | 全綠 |
| 553 | `unit-safeOpts`(28) | 2 passing／26 failing(2 為 `OpenaiCompat`／`Responses` 之 `baseURL` 保持案) | 全綠 |
| 422 | `unit-gateHintsMerge`(11) | 1 passing／10 failing(1 為無期限對照) | 全綠 |
| 454 | `unit-opencodeDeny`(15) | 4 passing／11 failing | 全綠 |
| 448③ | `unit-codexEvents`(6) | 1 passing／5 failing | 全綠 |
| 388② | `unit-codexRefsClean`(9) | 1 passing／8 failing | 全綠 |
| 345 | `unit-readmeVersions`(3) | 2 passing／1 failing(標題仍寫未發布) | 全綠 |
| 契約改寫 | `unit-castTimerMs`、`unit-cliSpawnGate`、`unit-dispatchClaude`、`unit-dispatchCodex`、`unit-filterOpencodeFree`、`unit-opencodeGoUsage`、`unit-spawnGateDeadlineEarlier`(各 1 案改寫) | 各 1 failing(新契約斷言於舊碼不成立) | 全綠 |
| 契約改寫 | `unit-opencodeTransientRetry`(僅案名) | 0 failing | 全綠 |

386:`unit-dispatchAntigravity` 已於 1.0.108 處理(不重做);現行測試檔於 5 個低優先權 CPU 壓力行程(8 邏輯核)下連跑 20 次 20/20 通過(各 23 passing／0 failing);修前版(`dffeffa^`)同負載亦 20/20 通過——該偶紅**無法以 CPU 壓力重現**(計時器規格 P7:須併用事件迴圈阻塞;本批未做),故不以負載紅燈入檔.新增之守門期限案(`unit-gateHintsMerge`,含真時間裕度)同負載連跑 20 次 20/20 通過(各 11 passing).

### 變異驗證(115 項,於鏡像副本逐一套用單點變異、跑對應測試;最終版測試上全部重跑)

| 系列 | 對象 | 項數 | 殺死 | 存活 |
|---|---|---|---|---|
| C | 次數類判定件與全部站點(REST 四家、`runExecCli`、遞補層、工作流、`buildValidator`) | 21 | 20 | 1(C03,等價) |
| S | 安全 opt 單一來源與全部站點(含 `checkSafeOpts`、額度讀者、`probeAnthropicKeys`) | 41 | 41 | 0 |
| G | 守門兩來源取嚴、探針與互斥鎖受期限約束 | 13 | 13 | 0 |
| D | opencode `denied` 判讀、`continueLoopOnDeny`、遞補層整組跳過 | 17 | 16 | 1(D14,等價) |
| X | codex `raw`／`commands` | 6 | 6 | 0 |
| R | `refs/codex/*` 清除與 `cleanCodexRefs` | 13 | 11 | 2(R01、R11,等價) |
| V | README 版號檢查工具 | 4 | 4 | 0 |
| 合計 | | 115 | 111 | 4(皆等價) |

首輪 10 項存活、3 項錨點因改碼失效(報錯而非略過):其中 6 項為**缺口**(補測後殺死:S29 `probeAnthropicKeys` 之 `length` 守門、G13 因截止而 fail-open 時預約重複登記、D02 終止原因須為 `tool-calls`、D03 訊息須含 `rejected permission`、X05 驗證重試時累積器須重置、R06 `OWN_KEYS` 須列 `cleanCodexRefs`),錨點失效 3 項(D05、X06、R02)更正錨點後 D05、R02 殺死、X06 為缺口(補「未帶 `--json` 而 stdout 恰為事件形狀」案後殺死);另補「批次交易失敗退回逐一刪除」案(新增 R13 殺死).**等價 4 項之判定**:
- C03(`min < 0 ||`):站點全集之 `min` 只有 0 或 1,該分支不可達;
- R01(`refs/codex/` 去掉尾斜線):`git for-each-ref` 之 pattern 以斜線為界,`refs/codex` 與 `refs/codex/` 列出之 ref 相同(以含 `refs/codexx`、`refs/codex-other/x` 之真 repo 實測),程式之前綴過濾只看得到 git 已篩過者;
- R11(批次 `update-ref --stdin` 改為恆失敗):結果層與退回逐一刪除相同,批次僅為效能(退回路徑已有案);
- D14(`denied === null` 守門):`addErrorDetail` 只對 `errorType` 為 `exec`／`timeout` 者加 `errorDetail`,`denied` 結果不帶,該分支前之 `isobj(r.errorDetail)` 已擋;守門留作日後 `errorDetail` 變動之防線,外顯行為(被拒者不帶上游日誌原因)由案「被拒而結束者不讀日誌檔」釘住.

### 自派複審(sonnet 唯讀,一位;只給任務書與新舊碼、不給結論)

屬實者已改:額度讀者與 `filterOpencodeFree` 之 `exe`／`cwd`／`homeDir`／`configDir`／`codexHome`、`cleanCodexRefs` 非布林、`try` 事件涵蓋轉接器層安全 opt(`checkSafeOpts`)、事件流 `denied` 同步驟有文字不判、`removeNewCodexRefs` 缺基準不刪、git 子行程環境、批次刪除、`bump` 之 `n`、`process.env` 原樣、`extraArgs` 只讀一次、壞 ref 之真 git 實測;屬實而列限制或裁示:見〈三、已知待辦〉與 `rulebook_safeopt.md` 規則 7、8.
