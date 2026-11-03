# 規則帳本(類型:CLI spawn 守門與 Go 用量冷卻)

> 類型說明:CLI 類轉接器(`opencode`／`claude`／`codex`／`antigravity`)每次 spawn 前之機器級守門 `cliSpawnGate`(R-SPAWNGATE-1)、遞補層對 OpenCode Go 條目之用量冷卻 `quotaGate`(R-SPAWNGATE-2)、與修前行為之逐位元比對及文字守門(R-SPAWNGATE-3).主檔索引見 `sgud/rule/rulebook.md`;Go 條目與 `opencodeGoUsage` 見 `rulebook_opencodego.md`.
> 來源:Gitea issue #67(提出端 tai-kns-trade,2026-11-04);主控任務 20261104001754 之 da67.**issue 之設計與預設值只作參考**,以下事實皆為 2026-11-04 當日讀碼與本機實測(證據夾 `agent-out/da67-evidence/`).

## 當日實測(2026-11-04;本機 8 核心、20 GB、Windows 11)

| 事項 | 實測 | 結論 |
|---|---|---|
| `tasklist /FO CSV /NH` 全列舉 | 15 次:min 632、p50 1012、max 1488、avg 1034 ms | 不可每次全列舉 |
| `tasklist … /FI "IMAGENAME eq <image>"` | 15 次:min 102、p50 118、max 187 ms(`measureOverhead` 內以 node 直呼為 68～74 ms) | 每個 image 各以篩選查詢 |
| `tasklist /V`(含 CPU Time) | 全列舉約 10 秒 | 僅供量測,不用於守門 |
| 1 秒 CPU 取樣(`os.cpus()` 差) | 牆鐘 1002～1012 ms;單次值 2%～42%(雜訊大) | 固定付 1 秒 → 取樣重用 |
| `opencode.exe` 單次短呼叫(`ocgo:opencode-go/beam-free`,6 字元提示詞) | 約 3 秒內占約 **110%** 單核(`tasklist /V` CPU Time 差,1 秒窗) | issue 所稱「opencode(bun)本身占核」屬實 |
| `opencode.exe` 於免費池用盡而卡住時(匿名 `opencode/beam-free`,75 秒逾時) | 啟動後前 4 秒約 89%～179% 單核,其後約 0%(卡住不占核) | 占核來自實際推理與工具迴圈,非行程存在本身 |
| 現役 `claude.exe`(2 個,含本 session) | 41 秒窗:0.0% 與 4.9% 單核 | 等候模型回應時幾乎不占 CPU |
| 現役 `codex.exe`(1 個) | 41 秒窗:0.0% 單核 | 同上 |
| `agy.exe` | 本機無行程,**未測** | 預設不限、列未測 |
| 真實 `claude -p`／`codex exec` 派工之 CPU | **未測**(會耗訂閱額度) | 僅以現役行程觀察為證 |
| 6 個 `opencode` 呼叫同一瞬間(同一 node 行程) | 不守門:`opencode.exe` 峰值 **6**、8.9 秒;`maxCli 2`:峰值 **2**、約 23 秒(≈2.6 倍)、6/6 成功、Go 用量三視窗前後不變 | 守門有效 |
| 2 個 node 行程同一瞬間各發 6 個(`maxCli 2`,`STARTAT` 對齊) | 無預約票:全機峰值 **3**;有預約票:峰值 **2**(各約 43～50 秒、12/12 成功) | 預約票消除跨行程同瞬間超放 |
| 守門自身成本(opencode 預設,RAM＋行程數＋CPU) | 連續 12 次:首次 1099 ms、其後中位 69 ms;閒置 5 秒後 74 ms;閒置 12 秒後 1079 ms;只查行程數平均 68 ms | 首次(或閒置 >10 秒後)約 1.1 秒、之後約 0.07 秒 |

## R-SPAWNGATE-1 CLI spawn 守門

- 規則:①每次 spawn 前於 `runExecCli`(四家共用單一入口)呼叫 `cliSpawnGate`;轉接器只傳 `spawnGateKind`(`opencode`／`claude`／`codex`／`antigravity`)與使用端之 `spawnGate`,二者與遞補層傳入之 `spawnGateHints` 皆為本層自用鍵、不轉傳 `execCli`;REST 類不經此門;②**預設只對 `opencode` 啟用**(只數 `opencode.exe`,`maxCli = max(1, 核心數−1)`,RAM 已用 >0.85、CPU >0.90 亦等,darwin 之 RAM 門檻預設關);`claude`／`codex`／`antigravity` **預設不限**(`resolveSpawnGate` 回 null,零成本:不查 `tasklist`、不取樣);要限者明給 `spawnGate: { maxCli, ramUsedMax, cpuMax }`,數該 CLI 之 image(與 issue 原案「四家合計共用 `cores−1`」不同:見上表實測與主控疑慮 1);③**只守「真的該 CLI」**:未給 `spawnGate` 時 exe(去目錄與副檔名)須等於該 kind 之 CLI 名,明給 `true`／物件不受限(令假 CLI、包裝腳本不被預設守門;亦令既有 1082 條測試不受影響);④判定:行程數 **≥ maxCli** 即擋,RAM／CPU **>** 門檻即擋;順序 RAM → 行程數 → CPU,RAM 或行程數已擋即不取 CPU 樣;⑤輸入檢測依 dspec〈輸入參數之檢測機制〉:`spawnGate` 本身與各鍵非預期之值**視為未給、改用預設而不報錯**(K3),`maxCli` 為有效正整數(數字字串轉換後使用,K4)、`ramUsedMax`／`cpuMax` 為 (0,1] 之有效數字、毫秒類為正數且 ≤2147483647、`images` 元素限 `[A-Za-z0-9._-]`(不經 shell)、`false` 關閉該項、`debug: true` 時警告不含傳入之值(K9)、`spawnGate` 為呼叫端物件故只讀一次之淺層副本、不可讀(拋錯 getter、已撤銷 Proxy)視為未給;⑥**fail-open**:等待逾 `gateWaitMaxMs`(預設 10 分鐘)放行;`countCli`／`sampleCpu`／`sampleRam` 拋錯、reject、逾時(`probeTimeoutMs`)、回傳非法值 → 該項視為通過(`probe-fail` 事件;失敗後 `probeFailCooldownMs` 內不再呼叫,`probe-skip`);守門未預期例外 → 放行;永不 reject;`runExecCli` 另以 try/catch 為最後防線;⑦**同一瞬間整批放行**:行程內 FIFO 互斥臨界區(檢查＋登記預約)、預約(時刻＋所見行程數,`settleMs` 內以「最舊預約當時行程數＋預約數」估入、取與所見較大者、過期剔除)、取新 CPU 樣(≥200 ms)後放行前再查一次行程數(`recount`)、跨行程預約票(`os.tmpdir()/w-dispatch-ai-spawngate/<imagesHash>.<pid>.<時刻>.<所見數或n>.<隨機>` 空檔案,他行程 `settleMs` 內之票併入估計,逾 60 秒者讀取時順手刪除,檔案系統錯誤靜默;只在 `maxCli` 啟用時寫);⑧**逾時歸屬**:等待不計入該次 `timeoutMs`(逾時自 spawn 起算;`durationMs` 不含等待);遞補層有 `budgetMs` 時傳 `deadlineAt`＋`minAttemptMs`:等待不超過「期限 − `minAttemptMs`」(到點 fail-open),守門運作過者放行後 `timeoutMs` 以剩餘預算封頂(守門未運作者原值不動);遞補層之 `shouldStop` 於等待中生效(`errorType: 'aborted'`、`ABORTED`,不當作一般失敗);⑨結果:實際等過或 fail-open 才加 `gateWaitedMs`(驗證重試為合計)、`gateFailOpen: true`,`tried` 各項同,未等待者不加欄位;⑩`onTrace`(dspec〈計時器相關函數之觀察回調與測試〉):`start`／`probe-fail`／`probe-skip`／`recount`／`check`／`wait`／`pass`／`fail-open`／`aborted`,凍結、同步、拋錯忽略、未給零成本;測試以事件同步,時間以假時鐘(`test/tools/spawnGateWorldForTest.mjs` 離散事件模擬器:假機器之行程於 spawn 後延遲才出現在計數、記錄真實併發最大值);⑪不新增 `WDispatchAi` 匯出。
- 已知限制:①`execCli` 自理之非驗證失敗重試(`maxRetries>0` 且未給 `validate`)不重新守門,整輪只守一次(驗證不過而重試者每次重守;測試「已知限制」案釘住現況);②預約票為提示非鎖,兩行程「讀票→寫票」落在同一毫秒內仍可能各放行;③預約為保守估計(假設放行後無行程結束),放行後 `settleMs` 內若他個行程恰好結束,空出之名額至多晚 `settleMs` 才被取用(實機:`pollMs 1000` 時約 3 秒;預設 `pollMs 10000` 下輪詢本身平均即晚 5 秒,此影響次要);④claude／codex 之真實派工 CPU 與 agy 之 CPU 未測;⑤非 Windows(`ps`)路徑只以夾具測試、未在實機驗;⑥守門只數 image 名稱:同機他人之同名行程亦計入(此為設計:機器級);⑦等待最長 `gateWaitMaxMs`(預設 10 分鐘)後放行,故機器持續滿載時上限形同「每個呼叫至多延後 10 分鐘」而非拒絕;⑧預約票資料夾預設在 `os.tmpdir()`:Windows 為各使用者私有之 Temp,共用 `/tmp` 之多使用者機器上他人可寫入偽票令本機最長延後 `gateWaitMaxMs`(其後 fail-open 放行,他人本即能以多開 `opencode` 造成同樣延後),該情境請 `ticketDir: false` 或指向私有資料夾.
- 盤點指令:`Grep "spawnGateKind" src/`(站點全集 5:四個轉接器＋`runExecCli`);`Grep "cliSpawnGate" src/`;`Grep "spawnGate" README.md`;`node tmp/da67/diffBehavior.mjs`(與 HEAD 逐位元比對,收於證據夾 `scripts/`);`node tmp/da67/measureBaseline.mjs`、`measureOverhead.mjs`、`realBatch.mjs`、`realCross.mjs`(實測腳本).
- 判準:已套＝四個轉接器皆傳 `spawnGateKind` 且 `runExecCli` 於無 validate 路徑與驗證重試迴圈每次 spawn 前守門;未套＝轉接器漏傳 kind、`spawnGate` 被轉傳進 `execCli`、守門未運作時改動 `timeoutMs`、結果在未等待時多欄位;刻意不套＝REST 類、claude／codex／antigravity 預設限制、`execCli` 自理重試之逐次守門.
- 對應測試:`test/unit-cliSpawnGate.test.mjs`(解析與預設值、tasklist／ps 解析、`createCountCli`、`createCpuSampler`、守門行為〔issue §4 之行程數 3／2、CPU 0.95／0.5、RAM 0.9／0.5、逾時 fail-open〕、fail-open 各形、整批併發離散事件模擬、取樣後重查、跨行程預約票)、`test/unit-cliSpawnGateAdapters.test.mjs`(四家接點、每次驗證重試重守門、已知限制、`budgetMs` 計入與 `shouldStop` 中止、遞補層與 `createAiCaller` 傳遞)、`test/api-cliSpawnGateReal.test.mjs`(真實 `tasklist`／`ps` 與 RAM、CPU 取樣;環境不足略過)、`test/tools/spawnGateWorldForTest.mjs`.

## R-SPAWNGATE-2 OpenCode Go 用量冷卻(`quotaGate`)

- 規則:①遞補層選到 `kind: 'opencode'` 且 `provider: 'opencode-go'` 之條目(即 `ocgo:`)之某把金鑰前,先以 `opencodeGoUsage` 查**該金鑰所屬工作區**之三視窗用量(逐把金鑰查);任一視窗 `percent ≥ 門檻`(`rollingMax`／`weeklyMax`／`monthlyMax`,預設各 95,`false` 關閉該視窗)或該視窗 `status` 明確為 `rate-limited` → 略過該把金鑰、不派;②**不得誤判到頂**:端點失敗(逾時、網路、401／403／429／其他非 2xx、非 JSON、形狀不符)、視窗缺漏、`percent` 缺漏／非數字(`NaN`、`Infinity`、布林、文字、物件)、未知狀態字(percent 低時)一律不擋(fail-open),失敗發 `quota-gate-error` 事件;`percent` 為數字字串轉換後判定(K4);門檻非 0～100 之數字改用預設 95(K3);③快取 `cacheMs`(預設 60000,`t − 查詢時刻 < cacheMs` 內不重打)、以金鑰指紋(sha256 前 16 碼)為鍵、並行之多個呼叫共用同一次查詢、失敗亦快取同長度;快取到期重查,不盲信 `resetsAt` 直接冷卻到該時刻(滾動視窗逐步下降、使用者可能升級方案);`until`＝被擋視窗 `resetsAt` 最晚者(任一缺漏或無法解析為 null),僅供顯示;④略過之處置:事件 `quota-skip`、`tried[].outcome: 'quota-skip'`、合成失敗結果(`errorType: 'quota'`、`failureKind: 'no-credit'`、`error` 以 `QUOTA_COOLDOWN:` 開頭、不掛他家轉接器之 stdout／stderr／code／pid、`attempts: 0`),併入 `noCreditIdx`:組內每把皆略過即 `quotaExhausted`(`group-exhausted` 帶 `quotaExhausted: true`,`attempted` 不計略過者;`cooldownMs>0` 且有明給 id 時條目降至鏈尾,同既有沒額度處置),最終 `error` 為 `QUOTA_EXHAUSTED: provider "<id>" has no credit on all N key(s) (QUOTA_COOLDOWN: …)`;⑤`quotaGate` 為遞補層自用鍵(`FALLBACK_KEYS` 與 `ENTRY_KEYS`),不轉傳轉接器;條目同名鍵優先於呼叫層、`false` 關閉;`createAiCaller` 建構選項加 `spawnGate`、`quotaGate` 兩鍵;⑥預設開啟(有設 `OPENCODE_GO_KEYS` 者每把金鑰每 60 秒至多一次 `GET`,逾時 5 秒);查詢耗時發生在預算計算之前,自然計入 `budgetMs`;⑦金鑰不入事件、`tried`、快取內容、錯誤訊息(測試斷言);⑧為「到頂前即停」,不倚賴 Go 到頂時 `opencode run` 之行為(仍未查明)——**原 R-OCGO-1 之「遞補層不接用量」自此取代**,`providers.mjs`／`dispatchOpencode.mjs`／`opencodeGoUsage.mjs` 檔頭與 README 同步,文字守門測試 `unit-providersOpencodeGoDocs` 對應更新(改斷言新句、並斷言舊句已不存在).
- 已知限制:①端點官方文件未載、形狀曾變,`rate-limited` 狀態字與撞限後實際恢復時刻未實測(只見過 `ok`),故「明說被限即擋」之依據為端點語意推論;②`percent` 無金額、不分模型,95% 對不同模型意義不同(5 小時視窗＝月額 20%);③快取 60 秒內用量可能已超過門檻而仍派工(誤差上限＝快取長度);④略過後之 `QUOTA_EXHAUSTED` 與既有「沒額度」共用 `failureKind: 'no-credit'`,呼叫端若以 `failureKind` 區分「真沒額度」與「接近上限」須另看 `errorType: 'quota'`／`error` 前綴.
- 盤點指令:`Grep "quotaGate" src/`;`Grep "isGoEntry" src/`;`Grep "quota-skip" src/ test/ README.md`.
- 判準:已套＝Go 條目每把金鑰選用前皆經 `checkGoQuota`、判定只憑成功回應之 percent／status;未套＝端點失敗被當成到頂、percent 缺漏被當成 0 或 100、快取失效致每個呼叫都打端點;刻意不套＝非 Go 條目、REST 類.
- 對應測試:`test/unit-goQuotaGate.test.mjs`(解析、`judgeGoUsage` 邊界 94／95／96 三視窗各自、`until`、`rate-limited`、失敗各 errorType、欄位缺少各形、快取 59999／60000、並行共用、不同金鑰獨立、不存金鑰本體、遞補層整合〔略過後換鑰、全略過遞補下一條目、`QUOTA_EXHAUSTED`、`cooldownMs` 降序、`quotaGate:false`、只作用於 Go 條目、查詢失敗事件去重、欄位缺少、門檻覆寫與條目覆寫〕).

## R-SPAWNGATE-3 與修前行為之比對、文字守門

- 規則:①`spawnGate: false` 與「假 exe 之預設情形」下,四家轉接器與遞補層之結果須與修前逐位元相同:`tmp/da67/diffBehavior.mjs` 以 HEAD 之 `src`(`git archive HEAD`)與現況同跑 13 種情境(成功、非零離開、重試、離開碼 2、逾時、spawn 失敗、validate 規則／函式／拋錯／async、env、onTrace 轉傳、cwd)×四家,另遞補層 4 種鏈(成功、失敗換家、金鑰輪替、預算),共 56 組比對,**差異 0**;②守門未運作(`outcome: 'off'`)時 `timeoutMs` 不因 `deadlineAt` 提示而收緊(測試釘住);③文字守門:`unit-providersOpencodeGoDocs` 之「遞補層不接用量」兩處(`providers.mjs` 檔頭、README)改為斷言新句;README 行為變更第 63 條、「CLI spawn 守門」段、Options 表、Result 段同步(`Grep "spawnGate" README.md`).
- 對應:`tmp/da67/diffBehavior.mjs`(證據夾)、`test/unit-cliSpawnGateAdapters.test.mjs`(「spawnGate:false 與未給之假 exe 結果一致」「守門未運作時不收緊」)、`test/unit-providersOpencodeGoDocs.test.mjs`.

## 變異驗證(68 個;執行器 `tmp/da67/mutate.mjs`,收於證據夾;於副本套用、跑對應測試檔)

結果:**67 killed、1 等價變異**(Q16)。首輪 66 killed、2 存活:X07 補測試後重跑 killed;Q16 為等價變異(`Number(' 96 ')` 與 `Number('96')` 皆為 96——JS 之 `Number` 自帶去頭尾空白,`pct.trim()` 與否結果相同,見 `node -e "Number(' 96 ')"` 輸出 96).

| 群 | 變異 | 被抓到之測試數(failing) |
|---|---|---|
| 放行判定 | G01 行程數 `>=` 改 `>`(16)、G02 RAM `>` 改 `>=`(1)、G03 CPU `>` 改 `>=`(1)、G04 RAM 門檻不判(3)、G05 CPU 門檻不判(1)、G12 探針失敗視為擋(16)、G29 RAM／行程數已擋仍取 CPU 樣(1) | 全 killed |
| 整批放行 | G06 不登記預約(7)、G07 取消互斥(5)、G08 估計不加預約數(8)、G09 估計不含基準(1)、G10 預約永不過期(4)、G25 取新 CPU 樣後不重查(1)、G26 預約票不排除本行程(2)、G27 不寫票(2)、G28 過期票不清理(1)、G31 票之 settleMs 過濾失效(2) | 全 killed |
| fail-open | G11 等待逾時不放行(hang,以外部 `timeout` 判 killed)、G13 探針失敗冷卻失效(1)、G30 不標 `failOpen`(7)、G32 探針失敗不記冷卻(1)、G33 守門例外時 reject(1)、G14 `deadlineAt` 不封頂等待(3) | 全 killed |
| 預設與輸入 | G15 四個 kind 皆預設限制(5)、G16 預設不比對 exe(3)、G17／G18 `maxCli` 預設改 `cores`／`cores−2`(4／4)、G19 darwin RAM 預設不關(1)、G20 `shouldStop` 不生效(7)、G21 images 不過濾字元(2)、G22 tasklist 不加篩選(1)、G23 映像名稱比對分大小寫(1)、G24 CPU 取樣不重用短間隔(1) | 全 killed |
| 接點 | X01 無 validate 路徑不守門(24)、X02 驗證重試不重守(1)、X03 `timeoutMs` 不以 `deadlineAt` 封頂(1)、X04 守門未運作時亦封頂(1)、X05 結果恆帶 `gateWaitedMs`(5)、X06／X07 中止不生效(5／首輪存活→補「驗證重試時第二次守門被 `shouldStop` 中止」後 1)、A01～A04 轉接器 kind 錯或漏(1／5／5／1)、F01 遞補層不傳提示(2)、F02 守門中止不當 ABORTED(1)、F03 成交項不帶 `gateWaitedMs`(1) | 全 killed |
| Go 用量冷卻 | F10 達門檻不略過(6)、F11 略過不併入 `noCreditIdx`(3)、F12 條目 `quotaGate` 不優先(1)、F13 `attempted` 計入略過者(1)、F14 失敗事件不去重(1)、Q01 邊界 `>=` 改 `>`(1)、Q02／Q03 預設 95 改 96／90(3／3)、Q04 快取邊界 `<` 改 `<=`(1)、Q05 快取永不過期(1)、Q06 查詢失敗判為被擋(4)、Q07 明說被限不擋(1)、Q08 percent 不驗數字(1,僅 `Infinity` 案抓到)、Q09 `until` 取最早(1)、Q10 並行不共用(1)、Q11 快取鍵為金鑰本體(1)、Q12 `quotaGate:false` 不關閉(2)、Q13 Go 條目不比對 provider(2)、Q14／Q15 monthly／weekly 視窗不判(5／6) | 全 killed |
| 等價 | Q16 `percent` 數字字串不轉換(`Number(' 96 ')` 本即去空白) | 無法被抓到(等價) |

首輪存活之處置:X07 → 新增測試「驗證重試時第二次守門被 shouldStop 中止」(`unit-cliSpawnGateAdapters`)後重跑 `X0*` 7 個全 killed;Q16 → 判等價,不改測試.另有一項非變異之發現:`diffBehavior` 前先以變異 X04 + 專屬測試釘住「守門未運作時 `timeoutMs` 原值不動」(否則 `deadlineAt − Date.now()` 會使修前相同之結果差幾毫秒).
