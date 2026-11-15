# 現況(state)(類型:opencode 免費池用盡／免費層 429／訂閱到頂即時終止(wda156,Gitea #156;wda158,Gitea #158))

本檔自 2026-11-15 wda156 起單列(全域 §14:依功能類型分檔);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 2026-11-16 wda158(Gitea #158,使用端回報並附修改版;**未發布**,`package.json` 仍 1.0.95,版本號與發布由主控處理;採納修改版之判準、`parseGoLimit`、四欄、遮蔽,另增遞補層分流):
  - `opencodeLimit.mjs`:`classifyLimitLine` 認 `providerID=opencode-go` 且原因含 `OpenCode Go usage limit reached` ⇒ `quota`＋`scope: 'key'`＋`parseGoLimit` 可解析之 `window`／`resetsInMs`;新匯出 `GO_PROVIDER`、`parseGoLimit`(內部模組,`WDispatchAi` 鍵數不變).
  - `dispatchOpencode`:判中時刻 `hitAt`(每次 spawn 重置);訂閱到頂之結果另帶 `limitScope`／`limitWindow`／`limitResetsInMs`／`limitUntil`(解析不到者不帶);免費池用盡之形狀不變.
  - `failureDiag`:`DIAG_PATTERNS` 加 `wrk_`＋8 碼以上英數(工作區代號)、`UPSTREAM_CLASSES` 加 `Go usage limit`.
  - `dispatchAiFallback`:結果帶 `limitScope 'key'` 且條目有金鑰(`trusted`)者 ⇒ 走既有 no-credit 換鑰(`next-key`),不整組跳過、不單獨寫條目冷卻、不經 `coolDetect`;組內每把皆到頂 ⇒ 同既有整組沒額度(`quotaExhausted`、`reason 'quota'` 條目冷卻、`QUOTA_EXHAUSTED`).免費池用盡與無金鑰條目維持整組跳過.
  - 檔頭:`opencodeLimit`【訂閱(opencode-go)到頂】、`dispatchOpencode`【免費池用盡與免費層429】③④與【OpenCode Go】段、`dispatchAiFallback`【轉接器回報之額度用盡】例外、`providers`／`goQuotaGate`／`opencodeGoUsage` 之「Go 到頂未知」敘述改為實例;README 行為變更第 75 條、`stopOnLimit` 列、第 62 條註記.
  - **額度帳(`store.quota`)入帳未做**(派工裁定(b)核實為須新設計,見下〈三、已知待辦〉).

- 2026-11-15 wda156(Gitea #156,使用端回報;**未發布**,`package.json` 仍 1.0.94,版本號與發布由主控處理):
  - 新增內部模組 `src/opencodeLimit.mjs`(`classifyLimitLine`／`printLogsOn`／`logFlagsToAdd`／`createLimitWatch`／`upstreamFromLines`)、`src/killProcessTree.mjs`;**未新增對外匯出**(`WDispatchAi` 鍵數不變);`src/opencodeUpstream.mjs` 多匯出 `logValueOf`(內部用).
  - `dispatchOpencode`:新選項 `stopOnLimit`(預設 true)、預設補 `--print-logs --log-level ERROR`、逐行監看 stderr、判中即 `limit-stop` 事件＋樹狀終止、結果改標(`quota`／`no-credit`、`rate-limit`;子行程先自行以 0 結束者亦回失敗)、上游原因改取 stderr(判中者取該列);`runExecCli`:內部鍵 `stopRetryIf`(命中不重試、不驗證;`maxRetries>0` 時接管,無期限時逐項比照修前之 execCli 內部重試;無效 `maxRetries` 不接管;暫時性判定不看日誌列);`dispatchAiFallback`:轉接器 `quota`(不論有無金鑰)以 `reason 'quota'` 冷卻、整組跳過改派、不計連敗、不判 budget-cut;`killProcessTree` 非 Windows 改自寫 `ps` 列舉(不用 tree-kill).
  - 外審:agy-hydrogen(12 條)與 terra 第二審(19 條)之屬實項已修(見修正報告〈外審評分表〉).
  - 檔頭:`dispatchOpencode`【免費池用盡與免費層429】(取代原【Zen免費層429限流時run不會結束】)與【OpenCode Go】段、`runExecCli`【命中即不重試】、`dispatchAiFallback`【轉接器回報之額度用盡】、`getErrorType`／`failureKind` 一覽之例外、`providers.mjs` 診斷段註記.
  - README 行為變更第 74 條、Options 表 `stopOnLimit` 列、`opencodeLog`／`cooldownMs` 列補註.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| 旗標補齊(未給才補、已給不補不覆寫、`stopOnLimit:false` 不補) | R-OCLIMIT-1 第 1、10 點 | `unit-dispatchOpencodeLimit`(旗標、stopOnLimit:false)、`unit-opencodeLimit`(logFlagsToAdd、printLogsOn) | 完成;本機真實 opencode 1.19.5 接受旗標(匿名 beam-free 成功,stderr 僅標頭,日誌檔 0 位元組) |
| 判準(agent 非 title、providerID=opencode、兩種字樣)、逐行跨區塊 | 第 2、3 點 | `unit-opencodeLimit`(9)、`unit-dispatchOpencodeLimit`(quota、429、跨區塊、title、opencode-go、其他上游錯誤) | 完成;字樣取自本機 opencode.log 實際列 |
| 樹狀終止(Windows taskkill /F /T＋windowsHide;POSIX tree-kill)、等終止完成才回 | 第 4 點 | `unit-killProcessTree`(5,含實際樹殺)、`unit-dispatchOpencodeLimit`(子孫行程不在) | 完成;POSIX 未實測 |
| 結果分類、failureDetail、upstream、error 分類 | 第 5、7 點 | `unit-dispatchOpencodeLimit`、`unit-failureDiagCli`(預設不讀日誌檔) | 完成 |
| 不重試(maxRetries、驗證路徑、暫時性重試、遞補期限) | 第 6 點 | `unit-dispatchOpencodeLimit`(不重試、不做暫時性重試、一般失敗序列同修前)、`unit-dispatchAiFallbackOpencodeLimit`(有期限) | 完成 |
| 遞補層冷卻改派、不計連敗、有金鑰沿 no-credit、coolDetect 之後 | 第 8 點 | `unit-dispatchAiFallbackOpencodeLimit`(7) | 完成(免費池用盡;訂閱到頂見下列) |
| 訂閱(opencode-go)到頂:判準(專屬字樣、非 title、mode primary)、`parseGoLimit`、結果四欄、工作區代號遮蔽、上游分類 | R-OCLIMIT-2 第 1～4 點 | `unit-opencodeLimit`(+4)、`unit-dispatchOpencodeLimit`(+4)、`unit-failureDiag`(+1) | 完成;字樣取自使用端真實 CLI 實測(週視窗),非真實呼叫 |
| 訂閱到頂之遞補層分流:換組內下一把、每把皆到頂＝整組沒額度、部分到頂計連敗、免費池／無金鑰／未給 provider 維持整組跳過、終止失敗(TIMEOUT 開頭)仍換鑰、`quota-skip` 與到頂併入同一組盡、與 `quotaGate` 合成 | R-OCLIMIT-2 第 5 點 | `unit-dispatchAiFallbackOpencodeLimit`(+10) | 完成(假 CLI＋真實 `dispatchAiFallback`／`dispatchOpencode`);外審 terra 11 條已處理(見修正報告) |

修前紅／修後綠(修前＝`git archive HEAD src` 搭本輪新測試):`unit-dispatchOpencodeLimit` 18 案(red3 時)13 failing／5 passing(皆為「不變」守門案:title、opencode-go、一般失敗重試序列、暫時性重試順序、stopOnLimit:false);遞補 7/7 failing;兩新模組之單元測試修前無法載入.其後依 terra 第二審再增之案(自行以 0 結束有輸出、判中列之 upstream、暫時性重試輪後不接管、無效 maxRetries、日誌列不算暫時性)以變異證明.新測試共 48 案(23＋7＋11＋7)＋`unit-failureDiagCli` 1 案,修後全綠;全套(`npm test`)1886 passing、1 pending(既有)、0 failing(開工時 1823 passing/1 pending).

變異驗證(`tmp/wda156/mutate.mjs`,一次性;每次改後還原並以 sha256 回驗):31 個變異全數被抓到(清單見 `rulebook_oclimit.md`).M12「只殺根行程」初版存活(Windows libuv 之 job 物件令根行程結束即連帶結束非 detached 子行程),測試之孫行程改 detached 後被抓到.

## 三、已知待辦

- **真實 CLI 之免費池用盡／免費層 429 未能於本機重現**(2026-11-15 實呼 4 次匿名 beam-free 皆成功);判準依本機 opencode.log 既有之實際錯誤列與使用端實測(帶旗標後 stderr 約 3.1 秒出現 agent=build 列)。下次本機或使用端遇到時,宜確認 stderr 印出之列形狀與日誌檔相同(`level=ERROR … providerID=… agent=… error.error="…"`).
- **`--print-logs` 時日誌檔不寫入**:本機只以成功路徑實測(0 位元組 vs 17490 位元組);失敗路徑為同一日誌初始化,推定相同、未以失敗實例實測.
- **POSIX 之樹殺**:自寫 `ps -A -o pid=,ppid=` 列舉(不用 tree-kill,其 ps 不存在時令呼叫端崩潰),只以注入之 execFile／kill 單元測試,未於真實 Linux／macOS 實測;脫離父子關係者為已知限制.
- **終止失敗**(taskkill 回錯)之整合路徑未測:須等 execCli 逾時(分類仍依錯誤列;遞補層不判 budget-cut);其後若重試,舊行程遲到之 stderr 仍進監看(execCli 之 onStderr 不分嘗試)——皆須終止失敗在先,未處理(外審 terra #2／#3).
- **429 之即時終止只認 `-free` 模型**:無後綴之免費模型(如 big-pickle)與按量模型之 429 不判(退回修前);見到實例後再擴充(待裁示).
- **opencode-go 到頂(週視窗)已有使用端實例**(2026-11-16,#158):判準已採;**其他視窗(5 小時、月)到頂之字樣、`opencode-go` 之 429 與免費池字樣仍無實例,不判**(見到實際錯誤列再擴充).
- **訂閱到頂之真實呼叫本輪未做**:使用端已以真實到頂金鑰實測修改版(約 5 秒回 `quota`、`limitScope 'key'`、`limitUntil` 與用量端點 `resetsAt` 差 35 秒);本庫只以假 CLI 驗證(字樣取自該實測),非 Windows 平台之終止路徑未測.
- **額度帳(`store.quota`)對 Go 金鑰入帳:未做,須新設計**:現無 Go 金鑰之帳鍵(帳鍵只有讀者家族與 `entry:<id>`,`quotaLedger.mjs`;`learnQuotaFromFailure` 只處理 claude／codex／antigravity),`goQuotaGate` 之快取為行程內記憶體且不盲信 `resetsAt`.若要做:Go 金鑰之帳鍵(指紋,不存金鑰本體)、讀帳先於用量查詢、帳號比對與作廢(升級／Extra Usage 令金鑰於重置前復用)、`forgetQuota` 涵蓋、`quota-skip` 事件 source 語意、與 `quotaGate` 預設共存;收益僅省重置前每次之用量查詢(端點即時反映).待使用端有實需再議.
- **金鑰層級之跨條目共享略過／金鑰冷卻對 Go 未做**:同一把 Go 金鑰於同一呼叫內到頂後,後續其他 `ocgo:` 條目仍會試該把(預設由 `quotaGate` 查用量端點略過;快取 `cacheMs` 預設 60 秒內可能仍視為未到頂而多送一次、約數秒);Go 到頂時其他 `ocgo:` 模型是否亦不可用無實證(`goQuotaGate.mjs` 檔頭),金鑰指紋亦與 `opencode/` 條目共用同一把金鑰而額度池不同,須另立命名空間.
- **訂閱到頂之合成輸入(外審 terra,推測、未見真實實例,與免費池用盡同為既有行為)**:①`detectTruncation: true` 且子行程於印出到頂列後自行以 0 結束並帶 `step_finish reason=length` 時,結果為 `incomplete` 形狀改標 `errorType 'quota'`,仍帶 `truncated: true`、無 `errorDetail`／Go 分類(遞補層已因 `isKeyQuota` 先於 `isKeyIndependentFail` 而仍換鑰);②原因文字含方括號詞(如 `[upstream] OpenCode Go usage limit reached …`)時 `error` 之分類詞取方括號詞(`upstreamClassOf` 之既有優先序),非 `[Go usage limit]`;真實錯誤列無此二形.
- **訂閱到頂且終止失敗(等到逾時)**:`isKeyQuota` 先於 `isKeyIndependentFail`,仍換下一把、不以 `timeout` 冷卻(測試以假 CLI `go-limit-orphan`:根行程先結束、孫行程後印到頂列,令 taskkill 打在已不存在之 pid 上);真實 `taskkill` 失敗(權限、行程已消失以外之成因)未實測.
- `experience.md` 約 41KB,超過約 30KB 門檻(既有,本輪只追加一節),整理留待下次(見 `state_general.md` 待辦).
