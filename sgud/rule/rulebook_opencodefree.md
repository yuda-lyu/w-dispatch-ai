# 規則帳本(類型:opencode 免費條目之漂移)

> 類型說明:內建 `providers` 中 opencode 免費條目(`oc:opencode/*`,id 或 model 含 `free`,另有 `big-pickle`)會日日漂移;本檔記「何時下架、如何收錄」之判準(R-OCFREE-2)與工具 `filterOpencodeFree` 之規則(R-OCFREE-1).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:主控任務 20261030054322 之 run01(2026-10-30);建議檔 = Gitea issue #25(提出端 tai-kns-trade,2026-10-29).

## opencode 免費條目漂移:判準與過濾工具(2026-10-30 立)

### 軸

- 條目:`kind: 'opencode'` 且 `model` 以 `opencode/` 開頭、id 或 model 含 `free`(不分大小寫)或 `big-pickle`;`unchecked` 類:含 free 字樣但不屬此範圍者(`zen:jev-1.13-free` 為 REST、第三方 provider 之條目須注入 config 才會被 `opencode models` 列出).
- 事實來源:①`opencode models`(及 `--refresh`、`models opencode --verbose`)——**有本機快取**,不帶 `--refresh` 之連續兩次查詢曾得不同清單(2026-10-30);②依條目呼叫(`dispatchOpencode`,匿名 `useStoredAuth:false`)之結果.「有列」≠「能用」;「不在清單」＝下架之必要條件.
- 查詢結局:成功(解析出 ≥1 個 id)／`notfound`(spawn 失敗)／`timeout`／`exit`(非零離開)／`empty`(成功但解析不出任何 id)／`query`(注入之函數出錯或回畸形值)／`params`(輸入不合規)／`other`(內部未預期).

### R-OCFREE-1 `filterOpencodeFree` 之規則

- 規則:①免費之判定單一來源為 `src/filterOpencodeFree.mjs` 之 `isFreeText`(`/free|big-pickle/i`,套於條目之 id 與 model);②只判 `kind === 'opencode'` 且 `model` 以 `opencode/` 開頭者(清單中在/不在 → `available`／`removed`);其餘免費字樣者列 `unchecked`,**不判下架**;③**查詢失敗(含空輸出)回 `ok: false` 與 `errorType`,`available`／`removed`／`unchecked`／`uncatalogued`／`listed` 一律為 `null` 而非 `[]`**(不得被誤讀為「全部下架」;讀取時當場 TypeError);④解析 `opencode models` 之 stdout:去 ANSI、逐行 trim、僅取 `provider/model` 形狀(無空白、至少兩段)、去重保序;⑤注入之 `query` 經 `awaitUserFn`(帳本 R-USERFN-1:拋錯→`query`、永不落定→`timeout`),回傳字串或 execCli 形狀之結果物件,失敗分流沿用 `getErrorType`(spawn→`notfound`、TIMEOUT→`timeout`、其餘→`exit`);⑥輸入之 providers 查詢前先驗(非陣列、條目非物件或不可讀 → `params`,不啟動子進程),回傳條目為淺層副本;⑦`refresh: true`(僅布林 `true`)附 `--refresh`,失敗結果亦記 `refreshed`;⑧本函數不 reject(最後防線 `other`);⑨`uncatalogued`＝清單有列之 `opencode/` 免費 id 而輸入之任一條目 model 未涵蓋者(供提示新增,不判缺陷).
- 已知限制:①只查「目錄清單」,不呼叫模型,故無法判定「列了但上游故障」(如 glm-5.3-flash-free 之上游不穩);②`--refresh` 須連網且更新本機快取(有本機副作用);③免費判定為字樣啟發式(id/model 含 `free` 即算),付費模型若恰含 `free` 字樣會被算進(2026-10-30 之 opencode 目錄無此例);④未對 Windows 以外平台實測(假 CLI 單元測試於 POSIX 走 sh 啟動器,未實跑).
- 盤點指令:`Grep "filterOpencodeFree" src README.md test`(匯出於 `src/WDispatchAi.mjs`;文件:README Functions 表、行為變更紀錄第 56 條、「免費條目漂移檢查」段;JSDoc 見 `src/filterOpencodeFree.mjs`);`Grep "isFreeText" src test`(判定單一來源,不得另寫第二份正規表示式).
- 判準:已套＝上列①～⑨皆合;未套＝失敗時回空陣列、免費判定散落多處、`zen:` 類條目被判 removed、注入之函數出錯致 reject、輸入不合規仍啟動子進程;刻意不套＝無.
- 對應測試:`test/unit-filterOpencodeFree.test.mjs`(31 條:過濾 9／查詢失敗 12／介面與旗標 4／輸出解析 2／預設查詢路徑 4〔假 opencode 執行檔,不連網〕);`test/unit-WDispatchAi.test.mjs`(匯出).
- 變異驗證(2026-10-30,`tmp/run01/mutate.mjs`,副本上套用):F1～F22 共 22 個皆被抓到——空輸出不擋、失敗清單改回 `[]`(原缺陷形狀)、免費判定漏 `big-pickle`、不限定 opencode 自家 CLI 條目、refresh 不附旗標、spawn 失敗歸 `exit`、不去 ANSI、`uncatalogued` 含非免費、失敗被吞、注入 query 逾時歸 `query`、available/removed 判反、refresh 以真值判定、不檢條目為物件、回傳條目非副本、不檢 providers 為陣列、不經 `awaitUserFn`、不檢 stdout 型別、預設逾時改 300000、id 行判定放寬、不去重、拿掉最後防線、失敗時不記 `refreshed`;W1(漏匯出)亦被抓到.
- 指令:`npx mocha --no-parallel test/unit-filterOpencodeFree.test.mjs test/unit-WDispatchAi.test.mjs --timeout 180000`.

### R-OCFREE-2 免費條目之下架與收錄判準;連網守門

- 規則:①**下架**(自 `providers.mjs` 移除並記於檔頭漂移紀錄)須「已自 CLI 清單消失(以 `opencode models` 加 `--refresh` 查)」**且**「依條目呼叫約 2s 即回 UnknownError」兩條件同時滿足(檔頭先例:fledge-alpha、ling-3.1-flash、cat-jam、step-5-preview、space-bunny、muse-spark-1.3、minimax-m3.1-flash、longcat-2.5-preview、nemotron-3-ultra);只滿足一條者(如清單仍列但呼叫失敗)不下架,以檔頭「暫時失敗保留」哲學處理;②**收錄**依既有條目慣例實測後才收:匿名 CLI 簡答、推理題、read 工具讀相對路徑、寫檔金絲雀(須被 `OC_READONLY` 擋下未落地)、CLI 目錄欄位(`opencode models opencode --verbose` 之 context／output／輸入模態／檔位／release_date)、REST 匿名可用性(含同時段已收錄條目之對照組)、脈絡長度(針在乾草堆,至少一次接近型錄上限;不寫成「已二分逼近」若未做);有 `high` 檔位者帶 `extraArgs: OC_EFFORT`,無則不帶;無 `zen:` REST 版時於註解載明原因;③**日期漂移要留證據**:註解與檔頭記日期、opencode 版本、次數與原始耗時;④**`opencode models` 有本機快取**:判「清單有無」時以 `--refresh` 為準,並至少查兩次;⑤連網守門 `test/api-providersOpencodeFree.test.mjs`:目錄免費條目之 model 集合 ⊆ `opencode models --refresh` 之輸出(`removed` 須為空);環境不足(opencode 不存在、離線、空輸出)時 `this.skip()` 並印原因,**不得當成通過**;守門紅燈＝目錄收了已不被供應之 id,依①下架,不是程式缺陷.
- 現況(2026-10-30,opencode 1.19.5):`oc:opencode/*` 依序 big-pickle、mimo-v2.6-flash-free、beam-free、deepseek-v4.1-flash-free、glm-5.3-flash-free、flint-40b-free、nemotron-3.5-lightning-free、nemotron-3.5-super-vl-free(8 條);已下架:minimax-m3.1-flash-free、longcat-2.5-preview-free、nemotron-3-ultra-free;內建 providers 共 29 條.
- 盤點指令:`opencode models` 與 `opencode models opencode --refresh`(取當日清單);`Grep "id: 'oc:opencode/" src/providers.mjs`(站點全集);`node --input-type=module` 只讀印 `providers.length` 與 id 清單.
- 判準:已套＝目錄免費 opencode 條目 ⊆ 當日清單(守門綠);新條目有完整實測註解與檔頭紀錄;未套＝收了不在清單且呼叫即失敗之 id、新條目無實測註解、守門被略過而未察覺;刻意不套＝只列在清單、呼叫失敗但不符兩條件者(暫時失敗保留).
- 對應測試:`test/unit-providersOpencodeFreeEntries.test.mjs`(5 條,純單元:三條已下架不在目錄／舊 id `pick` 落入 `missing`／flint 欄位／`oc:opencode/*` 順序／相鄰);`test/api-providersOpencodeFree.test.mjs`(**連網**,2 條:⊆ 當日清單／比對對象非空);`test/unit-providers.test.mjs`(全條目防寫與強度通則).修前紅(HEAD 之 providers 搭本輪測試):守門 `removed` 恰為三個下架 id,純單元 4 條失敗;變異 P1～P8(回收三個下架 id 各一、新增不存在之免費 id、flint 漏 `--variant high`／`useStoredAuth` 改 true／漏唯讀鎖／漏收)皆被抓到.
- 指令:`npx mocha --no-parallel test/unit-providersOpencodeFreeEntries.test.mjs test/api-providersOpencodeFree.test.mjs test/unit-providers.test.mjs --timeout 180000`(後者連網需 opencode).
- 文件同步點:`README.md` 行為變更紀錄第 54～56 條與「量級感受」條數(29);`src/providers.mjs` 檔頭 2026-10-30 漂移紀錄、flint 條目註解、「各條目之思考強度」註解;`src/resolveProviders.mjs` JSDoc 範例條數;下游全域技能 dispatch-opencode 之參考表與提出端之預設免費名單由主控／提出端同步(本輪不改他 repo).
