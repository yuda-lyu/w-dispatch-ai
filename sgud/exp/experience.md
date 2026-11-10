# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

> 2026-10-25 整理(檔過長,約 37KB):2026-10-14～16 之舊經驗(Windows 執行檔錯誤碼、依賴新舊版比對、審計／實作流程、agy、wsemi 1.9.17)已抽出至 `experience_20261025.md`(逐字搬移,節號與標題不變);需要久遠經驗時再調閱.

> 2026-11-03 再整理(檔約 45KB,超過約 30KB 門檻):2026-10-24～28 之 Anthropic API 金鑰計費、failureKind、codex 型號條目,與 2026-11-01～02 之自專案端移入 AI 件(da40／da42)、`createAiCaller` 逐次預算(da52)、`oneline` 與 `strTruncate` 站點(r3da)之經驗,已抽出至 `experience_20261103.md`(逐字搬移,節號與標題不變);需要時再調閱.

> 2026-11-07 再整理(檔約 34KB,超過約 30KB 門檻;第 325 項):2026-10-23～11-03 之 opencode 免費模型脈絡長度、免費條目漂移與 `filterOpencodeFree`(R-OCFREE-1～2)、OpenCode Zen 改名 Console 與額度用盡下的收錄判斷(R-CONSOLE-1)、OpenCode Go 月費訂閱之 provider 分流／金鑰／用量端點／實測法(R-OCGO-1～3)等四節,已抽出至 `experience_20261107.md`(逐字搬移,節號與標題不變);需要時再調閱.

> 2026-11-08 再整理(檔約 34KB,超過約 30KB 門檻):2026-10-23～11-05 之遞補與錯誤型別、CLI spawn 守門與 Go 用量冷卻(da67)、opencode 單次輸出上限與截斷偵測(da78)、放行最小間隔與暫時性重試(da320)等四節,已抽出至 `experience_20261108.md`(逐字搬移,節號與標題不變);需要時再調閱.

## 免費期 Go 條目下架:連網守門紅燈的處置(2026-11-10 da405;帳本 `rulebook_opencodego.md` R-OCGO-1⑩ 與〈型錄漂移紀錄〉2026-11-10)

- **連網守門的紅燈是漂移訊號,不是程式缺陷**:`api-providersOpencodeGo` 在 2026-11-07 收錄當天綠,三天後由主控跟跑測試才現紅(缺 `crouton-alpha-free`)——限時免費模型會下架(⑩ 早預告),首例就是它.處置順序:①自己重取官方型錄確認(不信轉述):匿名 GET Go 型錄、Zen 型錄、官方 Go 頁(`https://opencode.ai/v2/docs/console/go/` 去標籤純文字);②三處交叉:Go 型錄 30 個無、Zen 型錄 84 個無、官方頁〈Usage limits〉表無(`alpha` 僅出現在頁內 CSS 變數,別被 grep 誤導);③找後繼者:同日新增的是 `longcat-2.5-free`,release 日期與名稱皆與 crouton 無承襲關係,**名稱無對應者不以推測當改名**,新出現的同類模型一律走⑩ 金絲雀才收;④移除條目與所有說明;⑤測試跟著改「目錄與官方型錄一致」,不放寬守門.
- **Zen 型錄的價格結構**:`/zen/v1/models` 每個 model 的 `cost.text.input.price`／`cost.text.output.price` 皆為 0 即免費(含 `big-pickle`);用此欄位比 `*-free` 命名準.2026-11-10 共 12 個,目錄 `oc:` 8 個皆在,未收 4 個(`longcat-2.5-free` 新、`iceman-free`、`inkling-2-small-free`、`minimax-m3.1-flash-free` 為 10-30 移除後重現).**已移除的條目可能重現於清單**——「下架」不是單向,未收清單不能當一次性結論.
- **以 `git archive HEAD` 取舊版重現紅,不 stash**:`git archive HEAD src test/api-…test.mjs package.json | tar -x -C ./tmp/<任務>/orig` 後以 `node ./node_modules/mocha/bin/mocha.js --no-parallel ./tmp/<任務>/orig/test/…` 跑(bare import 往上層解析到 repo 的 `node_modules`),3 秒內得到與主控跟跑相同的 `[true, ['ocgo:opencode-go/crouton-alpha-free']]` 紅.
- **移除一條 `ocgo:` 條目要同步的計數**(ke339 新增清單的逆向;變異 18 個全抓到,可當清單):測試 4 檔(GoEntries 的 `GO_IDS`／`VARIANTS`／各處 9→8／38→37／`rr` 期望陣列少一項,GoDocs 的 LOCAL 表／收錄範圍／未收 21→22／38→37／README 錨點,OutputCap P3 9→8,FreeEntries 38→37)、README 5 處(Go 段標題、表列、未收個數、量級感受〔37×300s＝185min,3 階段 9.3 小時原本即以 37 算,ke339 當時只改了第一個數字〕、Options 表 `ocgo:` 條數)＋行為變更紀錄新增一條、`resolveProviders.mjs` JSDoc、`providers.mjs` 檔頭(條目與收錄、缺變數 skipped 條數、輸出上限段條數、條目區段標題、Unlimited 清單、官方月額表 Unlimited 句)、`goQuotaGate.mjs` 兩處.盤點指令:`Grep "crouton" src test README.md sgud`,目標是「只剩下架紀錄」;再 `Grep "38|9條|9 條|21 個" src README.md`.
- **「移除」也要有守門**:新增「已下架」專案——目錄無任何 id／model 含該字樣、`resolveCatalogue({ pick:[該id] })` 即使備齊金鑰也回 `missing`(不拋)、全取時 `ocgo:` 恰為清單;使用端以 `pick` 指名舊 id 的行為(列入 `missing`、`patch` 靜默無作用)寫入 README 行為變更.變異首輪 README 敘述(第 66 條改回「新增」)存活——README 長敘述若是承諾的一部分就要有錨定句的測試,否則靜默回退.

## OpenCode Go 型錄漂移對齊與 crouton-alpha-free 收錄(2026-11-07 ke339,Gitea #92;〔2026-11-10 該條目已因上游下架移除,見上節〕帳本 `rulebook_opencodego.md` R-OCGO-1、`rulebook_opencodefree.md` R-OCFREE-2)

- **提出端的結論先自己重查,常是對一半**:提出端稱「zen 單價 0 共 8 個、免費池無漂移」;本機同日匿名 GET `/zen/v1/models`(81 個)單價 0 者是 **11 個**,`filterOpencodeFree(providers,{refresh:true})` 亦回 `removed` 為空、`uncatalogued` 3 個(`opencode/crouton-alpha-free`、`iceman-free`、`inkling-2-small-free`)——8 個既收的確實沒漂移,但多了 3 個未收.Go 型錄 30 個、新增 2／下架 2 則完全屬實.與 da63 同形(他人數據不可直接當本機結論),差別是這次提出端的 Go 部分全對、免費部分漏看.
- **本機 opencode 型錄有快取,新模型要先 `--refresh`**:未 refresh 時 `opencode models opencode-go --verbose` 只列 31 個(缺 crouton-alpha-free),依新條目呼叫 1.6～3.5 秒即 `Exit code 1`(stderr 沒取;與 ProviderModelNotFoundError 約 1.7 秒同形,屬推定);`--refresh` 後列 32 個(＝公開 30＋`mimo-v2.5`／`v2.5-pro`,CLI 仍列、公開型錄已無).**收錄新 Go 條目的順序**:公開型錄確認 → `opencode models opencode-go --refresh --verbose`(帶金鑰注入)取檔位 → 才跑金絲雀;否則「條目壞了」會是假象.
- **`--variant` 實效不能靠單次耗時判斷**:提出端以「帶 high 25.9s、不帶 70.1s」推測檔位有作用;本機同一推理題以 `--format json` 各跑 1 次(不帶 57.8s／minimal 15.8s／high 21.3s／max 13.2s),最後 `step_finish.part.tokens.reasoning` 皆為 0、耗時不隨檔位單調——單次耗時是雜訊.要比檔位實效至少看 reasoning token 量(且需會產生 reasoning 的題目);查不出就寫「實效未證」,維持「一律 high」.
- **哪把金鑰是 Go 已訂閱**:`.env` 沒有 `OPENCODE_GO_KEYS`,只有 `OPENCODE_KEYS`(兩把,第 1 把已訂閱、第 2 把 403);金絲雀腳本以 `opencodeGoUsage` 逐把查(唯讀、不耗額度)取第一把 200 者,只在記憶體內映為 `OPENCODE_GO_KEYS`,輸出只印序號與狀態.用量前後 rolling 2%／weekly 50%／monthly 25% 完全不變(Unlimited 不計額度).
- **金絲雀的 cwd 會污染 stdout**:簡答在 repo 根跑,回覆多帶「需你決定／執行狀態」(CLI 讀 cwd 的專案指示),提出端同見;read／寫檔金絲雀用空的 `work/` 夾才乾淨.驗「回覆含『完成』」時要用 includes 而非全等.
- **官方 Go 頁可匿名 GET 後去標籤成純文字逐項核對**(月額表三方案、隱私表、端點表、地區限制全在同一頁,`#privacy` 是頁內錨點不是別頁):比對提出端抄錄(Crouton／Hy4／MiMo 等)可重跑,不必靠 WebFetch.核對結果:月額、隱私、地區清單與提出端所抄逐項相符;官方表仍列已下架的 MiMo-V2.5／V2.5-Pro(文件落後).
- **新增一條 `ocgo:` 條目要同步的計數**(變異驗證 20 個全抓到,可當清單):測試 4 檔(GoEntries 的 `GO_IDS`／`VARIANTS`／各處 8→9／37→38,GoDocs 的 LOCAL 表／未收 22→21／37→38／README 錨點,OutputCap P3,FreeEntries 條目數)、README 3 處(量級感受、Go 段標題與表、Options 表 `ocgo:` 條數)＋行為變更紀錄、`resolveProviders.mjs` JSDoc、`providers.mjs` 檔頭(條目與收錄、缺變數 skipped 條數、輸出上限段條數、條目區段標題).盤點指令:`Grep "37|8 條|22 個|共8|以下8條"` 於 `src`／`test`／`README.md`.
- **用量端點無逐模型分項的後果**:`quotaGate` 以單一百分比擋該把金鑰全部 `ocgo:` 條目,包含 Unlimited 的 beam-free／crouton-alpha-free／iceman——該把金鑰因付費模型 weekly≥95% 被擋時,免費期模型也一併被略過(本機 weekly 已 50%,離門檻尚遠).只是檔頭註明,未改行為;要單獨放行者以條目或呼叫層 `quotaGate:false`.

## 訂閱類條目之用量門檻與額度帳(Gitea #93,2026-11-07 ke340;帳本 R-SPAWNGATE-6,見 `rulebook_quotagate.md`)

- **預設開啟的新門檻,第一個要擋的是自己的測試**:`quotaGate` 預設對 claude／codex／antigravity 生效後,凡以假 exe 跑這三種 kind 之既有測試都會去呼叫**真讀者**(讀本機登入態、打 OAuth usage API、起 `codex app-server`／`agy -p "/usage"`).解法照 `spawnGate` 的先例:**未明給時只作用於 exe 為 claude／codex／agy 或未給 exe 者**(`exeStem` 與 `KIND_CLI` 沿用);明給 `true`/物件才不論 exe.這同時是語意上正確的——包裝腳本用的未必是本機登入的那個帳號.新增「預設會碰外部(網路、登入態、子進程)」之功能,先問「既有測試與假 CLI 會不會被打到」.
- **不展開呼叫端的 `env`**:全套綠燈前唯一的紅燈是 `範圍檢查不執行條目env內ANTHROPIC_BASE_URL之getter(只由dispatchClaude物化讀一次)`——我在 `resolveSubQuotaGate` 用 `readCallerObj(env)`(展開 `{...v}`)判斷 `ANTHROPIC_API_KEY`／`CLAUDE_CONFIG_DIR`／`CODEX_HOME`,把 getter 多執行了一次.改為 `Object.getOwnPropertyDescriptor` 只讀資料屬性(同 `isOfficialAnthropicEntry`);單元測試用計數 getter 釘住「讀 0 次」.呼叫端物件(`env`、`headers`、`spawnGate`…)本層若不是轉接器,就不要展開.
- **「模型別視窗」要在帳裡也守住**:claude 的 `limits[]` 有 `scope.model`(如 `7天(Fable)`),codex 亦有 per-model 視窗.字面「任一視窗 ≥95% 即略過」會讓 Fable 週限額到頂時連 sonnet 條目一起被擋(建議檔草案 `pickWindows: (w) => w` 即如此).本輪採「scope 非空之視窗只在條目 model 含該 scope 時計入」;**入帳時視窗須帶 scope**,讀帳重判同一個適用判定,否則 Fable 條目寫的家族帳會擋掉 sonnet(見 R-SPAWNGATE-6 ⑥).
- **年份推定不可靠「可轉換」來選年**:草案「取使 until ≥ now 之最近年份」若以精確換算結果選年,夏令間隙內不存在之本地時刻(如 2027-03-14 2:30am America/New_York)會被當成「這年不行」而推到次年再被 8 天上限截斷——把一個不存在的時刻變成封鎖 8 天的帳.改為:先以「牆上時間當 UTC」粗算選年(寬限約兩天),再精確換算;不存在或已過去回 null.(單元測試的夏令案抓到的,不是讀碼.)
- **本機三家讀者唯讀實跑(各 1 次,2026-11-07)**:claude 1.4 秒、codex 4.6 秒、agy 9.5 秒;回傳鍵 `ok,provider,email,matched,plan,planTier,source,windows,credits,raw,error,errorType,durationMs`,視窗鍵 `key,label,windowSeconds,usedPercent,remainingPercent,resetAt,resetAfterSeconds,scope,active,severity`.agy 的 5 小時「Claude and GPT models」窗已 93.79%(離 95 很近,agy 的 Claude／GPT 共用額度小,見 dispatch 技能所述),實務上這條門檻會被碰到.
- **變異腳本與單檔多行字串**:`find` 含換行者,依檔案實際行尾轉換(本套件 `src/*.mjs` 為 LF);腳本對「找到 0 或 >1 處」須報 NOAPPLY 而非當成 killed(本輪腳本如此).跑變異時**不可在其進行中改 `src/`**(腳本每個變異都重讀 `src/` 為還原基準,中途改檔會讓副本混入新舊碼).
- **v1 發布後待查**:①下一次 Claude 週額度到頂時段,日誌應只見每輪每條目一行「額度帳：<id> 至 <until> 略過」,不再有 `claude:sonnet:exec … hit your weekly limit` 之重複嘗試;②是否見到 `quota-gate-error`(`unsupported`／`auth`)過多——若使用端慣用 `ANTHROPIC_API_KEY` 於環境變數,讀者回 `unsupported`,每 60 秒一次事件;③agy `/usage` 逾 60 秒者(實測 9.5 秒,建議檔稱最長 60 秒).

## agy 提示詞走 stdin(stream-json)解除命令列上限(2026-11-07 ke342,Gitea #94;帳本 `rulebook_agy.md` R-AGY-4)

- **建議檔所述全數屬實**(本機 agy 1.5.2):`--input-format stream-json` 不帶 `--print`、搭 `--output-format stream-json`,stdin 一行 `{"event":"user","message":{"role":"user","content":…}}`,37504 字元(原始協定)與 36060 字元(經 `dispatchAntigravity`)皆 `result:SUCCESS`(約 5.9 秒,`gemini-3.8-flash-low`).陷阱逐一以**不耗額度**之案驗過:無 `event` 欄 → 離開碼 1「stream input message is missing the "event" field」;`event:"user"` 缺 `message` → 離開碼 1;未知 event(`user_message`)→ **離開碼 0、stdout 只有 `init`、stderr 為 warning**;`-p` 併 `--input-format` → 離開碼 2「a prompt given on the command line would be ignored」(約 0.17 秒);未知旗標 → 離開碼 2「flags provided but not defined: -<旗標>」(Go flag 套件,**複數 flags**).
- **建議檔未載、實測才知**:①`/usage` 等斜線指令在 stream-json 輸入下被拒(離開碼 2「is answered by the CLI itself and is unavailable with --input-format stream-json」),故**無法用 `/usage` 當不耗額度的協定探針**,不耗額度之探測只能靠錯誤輸入形狀;②**自寫 `spawn` 並等 `close` 事件的探針曾卡住超過 3 分鐘**(`noevent` 案;原因未查證,推測為 agy 結束後仍有行程持有 stdout 管線),改經 wsemi `execCli` 後各案皆約 0.2～2.7 秒結束——agy 探針一律經 `execCli`;③失敗結果之 `stdout` 被 execCli 裁到 500 字元,而 `init` 事件行約 1700 字元(含工具清單),**`result` 在最後一行必被裁掉**——要從失敗結果取錯誤說明須用 `onStdout` 自行累積全文(同 `dispatchOpencode.detectTruncation`);④agy changelog 載明 `--input-format stream-json` 自 1.1.15 起(`agy changelog` 本機只列到 1.2.16,晚於此的版本須另查).
- **設計決定**:預設 `'auto'`(理由與何時改 `'stdin'` 見帳本規則 1);extraArgs 衝突旗標**明確拒絕**而非合流(重複旗標 last-wins 未實測,`-p`／`-i` 併用會結束或卡互動);agy 用量不放結果之 `usage` 欄(`tried[].usage` 與工作流以 API 類形狀消費);「無 result 事件」於 execCli 回報成功之後才判定,故不被 `maxRetries` 重試.
- **測試法**:假 agy 以輸入內容開頭之 `[[mode]]` 標記決定回應,並以 `calls.log` 記錄被呼叫之階段(`version`／`stdin`／`argv`)來斷言「未 spawn 實際呼叫」;額度門檻之測試必須給每次呼叫獨立之 `store`(否則 quota-skip 入帳殘留於行程內記憶體,影響下一案).變異以複製 `src` 與測試到 `./tmp/<案名>/mut<X>` 後逐一 Edit 副本,不動 repo 內檔案.
- **v1 發布後待查**:①使用端升版後,>30000 字元提示詞原本被遞補層整組跳過的 agy 條目會被實際嘗試(耗額度、耗時),確認符合預期;②agy 1.1.15～1.5.1 之輸入訊息形狀是否與 1.5.2 相同(舊機若遇「no result event」或 exit 1 之 event 欄錯誤,就是形狀差異,應升級 agy);③agy 自身 `--print-timeout` 到時、權限閘門擋下在 stdin 路徑下之事件形狀.

## CLI 失敗帶回原因:errorDetail、opencode 日誌對時擷取、finish／outputChars(2026-11-08 da110,Gitea #110;帳本 `rulebook_failurediag.md` R-FAILDIAG-1～5)

- **實查建議檔再動手(不呼叫 AI 之法)**:opencode 用不存在之 `-m nosuchprov/nosuchmodel`(送請求前即 `UnknownError`);claude 用假 `sk-ant-…` key＋`ANTHROPIC_BASE_URL=http://127.0.0.1:9`＋`CLAUDE_CODE_MAX_RETRIES=0`＋`API_TIMEOUT_MS=8000`(連線被拒,3 秒內離開碼 1);codex 給不合法 `--sandbox`(clap 參數錯誤,離開碼 2);agy 給未知旗標(離開碼 2).探測腳本放 `./tmp/da110/`.建議檔三處與實況不同:①日誌原因鍵是 `error.error` 不是 `error=`;②日誌是單一累積檔 `opencode.log`(非分檔);③失敗訊息不一定在 stderr(claude 在 stdout、opencode `--format json` 在 stdout 事件).
- **execCli 失敗結果的 stderr 不是尾端**:`stderr` 欄位失敗時只留前 1000 字元(逾時前 500),長輸出之錯誤行在末端會被丟掉——要「尾段」必須自己擷取:包 `onStdout`／`onStderr`,並用 `onTrace` 的 `spawn` 事件在每次嘗試(含 execCli 內部重試)重置,否則前次嘗試輸出混入.包回調時保持語意:非函數視同未給、回傳值原樣交 execCli.
- **claude 的 stderr 可能只有無關警告**:給 `ANTHROPIC_API_KEY` 時 stderr 有 `⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY…`,真正錯誤在 stdout——「stderr 優先、空才退用 stdout」對 claude 會把警告當原因,故 claude 取 stdout 優先(依 `spawnGateKind`).這是實跑才發現的,單元測試用假 CLI 時若 stderr 留空會漏掉.
- **error 文字加了原因,所有「以 error 字樣判定」之站點都會被改判**:`getErrorType`(`includes('ENOENT')` → 尾段含 ENOENT 即誤歸 spawn,連帶 `isKeyIndependentFail` 整組跳過)、`isKeyIndependentFail` 自身之 `includes('ENOENT')`、`learnQuotaFromFailure` 把 `[error, stderr, stdout]` 串接找額度字樣.解法是 `baseErrorOf`(只認 execCli 原生三形狀,其餘原樣)＋站點全集表(帳本 R-FAILDIAG-5);**日後新增任何以 error 字樣判定之處必須讀原始部分或讀 stdout／stderr 欄位**.前綴比對(`TIMEOUT`)與相等比對(`OUTPUT_VALIDATION_FAILED`)對尾段安全.
- **因此更動的既有測試要分清「放寬」與「期望值隨規格更新」**:6 案原斷言 `error === 'Exit code 1'`,新斷言仍釘 `code`／`errorType`／原始部分(`baseErrorOf`)／完整新字面,不是改成 `includes`.D7(預設格式 vs json 格式的 error 比較)原本假設兩路 error 相同,新規格下尾段不同(預設格式含 `> build · 模型` 標頭)——改為斷言原始部分相同、兩路各自完整字面.
- **日誌時窗**:建議檔寫「失敗時刻 ±60 秒」,但慢失敗(逾時;免費層 429 令 `opencode run` 不結束,原因行在起點後約 1 秒、失敗在 `timeoutMs` 後才回報)的原因行落在時窗外,故下界取 `min(tFail−60s, 起點)`(起點＝`tFail − durationMs`),另留 2 秒寬限.多筆相符時優先 `agent` 非 `title`(標題小模型的附帶請求),其次時戳最晚;行序不可假設有序(實查有數百毫秒倒序).只讀檔尾 2MiB、單次約 9ms(本機 6MB 日誌).
- **遮罩不另寫**(dspec〈診斷輸出與遮罩〉D1):wsemi 1.9.52 有 `maskDiagText`(`opt.patterns` 可宣告樣式),金鑰樣式(`sk-ant-`〔沿用 `redactText.mjs` 匯出之 `API_KEY_PATTERN`〕、`sk-`／`oc_sk_`／`AIza`／`ghp_`／JWT)以 `DIAG_PATTERNS` 宣告.**首版曾先過本套件 `redactApiKeyText` 再過 `maskDiagText`,輸出 `[REDACTED]` 與 `***` 並存,被共用語料(D5)之 wire 案 T01 抓到(期望 `***`)**——改為全交 `maskDiagText`.教訓:有共用語料就以其 wire 案重跑自己的呼叫點,別只憑自寫測試.遮蔽先於截尾(否則被尾段邊界切開的金鑰前段會殘留).`maskDiagText` 以子字串比對鍵名,`PWD` 被當 `pwd` 遮成 `***`(假 CLI 回聲 env 時會看到).
- **變異驗證**(法:複製 `src` 與兩個新測試檔到 `./tmp/da110/mut/<id>/`,單點改動後跑,見 `tmp/da110/mutate.mjs`,不入庫):16 個變異首輪 15 殺 1 活——活下來的是「時窗上界不 +60 秒」(測試直接餵 `pickUpstream` 的 `toMs`,繞過了 `readOpencodeUpstream` 組窗邏輯),補「+30／−50 秒內取得、+90／−90 秒外不取」邊界案後全殺.教訓:測純函數時,組參數的上一層函數要有自己的邊界案.
- **修前紅**:新案對未接線之現況碼 35 過／39 敗(`runExecCli` 等未改);全套接線後只剩 6 案舊斷言須更新(見上).
- **待驗**:codex／agy／claude 之 JSON 輸出模式是否可得 `finish`(現恆 `unknown`);agy 失敗之真實額度字樣在尾段是否夠用(`AGY_ERROR`／`Individual quota reached` 在 stderr 末端,依既有紀錄,未於本案重現).

## 額度帳之帳號識別、定期重探與明示清帳(2026-11-09 da116,Gitea #116;帳本 `rulebook_quotagate.md` R-SPAWNGATE-7)

- **帳是快取,快取要有「失效條件」而不只有「到期時刻」**:ke340 之帳只認 `until`,其前提是「讀者回應不會變」;使用端換訂閱帳號即推翻此前提(3 天內新額度用不到、流量全落遞補)。凡以「某時刻前不再查」為目的之持久化快取,都該問:什麼外部事件會令它失效(換帳號、升級方案、補額度),並給一條「低成本偵測」之路(帳號識別比對、定期以事實來源重探)及一條「明示清除」之路(`forgetQuota`)。
- **節流起點要持久化,行程內快取擋不住跨行程**:家族快取(`cachedQuery`)只在同行程內擋重複查詢;排程環境每個行程全新,若「有帳就探」,每個新行程第一次判定都打一次讀者(agy 約 10 秒、逾時 60 秒)。故節流起點(`rechecked`,無則 `at`)寫在帳項目上、隨 store 持久化,間隔以帳為準;重探仍經 `querySnapshot`(同行程不多打)。**失敗亦記 `rechecked`**,否則壞掉之讀者會被每次派工重打。
- **只在有正面證據時解帳**:讀者失敗、取不到帳號、適用視窗為空、percent 缺漏／非數字、門檻被關閉(`claudeMax: false`)皆「無證據」,維持帳;解帳須「帳號確實不同」或「對本條目之適用視窗有有效 percent 且全未達門檻」。fail-open 的方向是**不擋**,但「解帳」是放行方向,證據不足時維持原判才不會讓壞掉之讀者把帳全清掉。
- **新欄位加在快照層而不改 `toSnapshot`**:`account` 由 `querySnapshot` 於成功時補入(`accountIdOf`),`toSnapshot` 形狀不變,既有三條 `deepEqual` 斷言(`ok/errorType/windows` 之完整形狀)一字不改。帳項目之新欄(`account`／`rechecked`／`family`)皆可選,`ledgerFind` 之 hit 補預設值,舊格式免遷移。
- **帳內存雜湊而非 email 本文**:主控定事件與訊息字面不含帳號完整值,帳亦同(狀態檔常被附進日誌或備份);sha256(去空白、小寫)前 16 碼足以比對,事件只帶前 8 碼。既有測試 `/sk-|token|email/i.test(store.text())` 對 `account` 欄安全(十六進位不含 `sk-`)。
- **測試設計**:①每個案例以**全新 sq(全新快取)＋同一個 `state` 物件**模擬「下一個行程」,才測得到持久化之節流;②時間全由注入之 `now` 控制,邊界取 `interval − 1ms`／`interval`;③「帳號改變作廢」三家各一案、`limit-text` 帳與家族帳並存一案(家族帳作廢後條目帳仍判定);④**踩到之測試錯誤**:以 `claudeMax: false` 配「帶 windows 之帳」測「門檻關閉不解帳」不成立——`ledgerFind` 之既有重判先因門檻關閉略過該帳、改走讀者(R-SPAWNGATE-6 既有行為),要測門檻關閉之無證據情形須用無 windows 之 `entry:` 帳;⑤R5 舊格式案原只斷言 `blocked/source`,變異 M19(時鐘回撥不視為到期)存活之風險,補斷言「重探恰一次」(讀者呼叫計數)。
- **變異驗證**(法:複製 `src` 與六個測試檔到 `./tmp/da116/mut/`,單點改動後跑,見 `tmp/da116/mutate.mjs`,不入庫;單次約 15 秒,36 個共約 10 分鐘,須排 `quiet-run --lock` 並給足 `--timeout`;`mutate.mjs` 可由環境變數 `ONLY=M07,M35` 只重跑指定變異):41 個變異 40 killed／1 等價(帳本 R-SPAWNGATE-7)。首輪存活 3 個:M07(短視窗亦重探)——短視窗案之時間點未超過 6 小時間隔,mutant 與原碼同樣不重探,須造「入帳已逾間隔、until 尚餘 ≤6 小時」之案才分得出「以 until−now 而非入帳時間判長視窗」;M35(`recheckEveryMs` 不可調)——只測預設與無效值回預設,沒測有效自訂值;兩者補測後 killed。M16(作廢後不沿用快照)判為等價——同 sq 之 `querySnapshot` 有家族快取,不會多打一次,只改 `cached` 旗標。教訓:**對「預設值＋非預期值取預設」型選項,必須另有「有效自訂值確實生效」之案**,否則「選項被寫死」之變異活得下來。
- **失敗通道要對照〈輸入參數之檢測機制〉§5.1**:首版 `forgetQuota` 沿用本套件「永不拋錯、fail-open」之習慣,無效參數靜默回 `[]`;讀 dspec 後改為「同步且有副作用之入口,無效一般參數同步 throw、先於副作用」(`createFileStore` 對缺漏設定於組裝期 throw 為本套件先例),「參數有效但清不掉」才如實回 `[]`。fail-open 屬派工熱路徑(讀者、帳),**明示之管理動作傳錯參數靜默成功會讓使用端以為已清帳**。`callHookSync` 之狀態字為 `'value'`／`'threw'`／`'async'`(非 `'error'`),判斷 set 失敗用 `=== 'threw'`。
- **套件無命令列入口**:建議 4 提「CLI 子命令」,但 `package.json` 無 `bin`、`src` 無 argv 入口;新增 `bin` 屬打包面變更(`package.json`／`toolg`),不在修正輪授權內,以可 import 之 `forgetQuota`(接受 state 或 store)代替,列待裁示。
- **真實換帳號未實測**:本輪禁止呼叫真實用量 API;讀者回應之 `email` 欄位形狀依 `getQuota*` 既有單元測試與 ke340 本機實跑記錄(claude 讀 `~/.claude.json` 之 `oauthAccount.emailAddress`、codex 取 app-server `account/read`、agy 取 `--log-file` 內 `applyAuthResult: email=`),端到端待使用端發布後觀察。

## 冷卻／健康／預算之語意邊界實作(2026-11-11 di402,排程第 402 項併 Gitea #130;帳本 `rulebook_cooling.md` R-COOL-1～4、R-CALLER-1-6 改寫)

- **修前紅要分「被改回之行為」與「新欄位」**:以 `git archive HEAD` 解至 `./tmp/` 之快照跑新測試(node 自 `tmp/` 往上解析得 repo 之 `node_modules`),新模組不存在之檔整檔載入失敗(函數不存在亦算紅);為免整檔因命名匯出不存在而連結失敗,測試對新增之命名匯出改用命名空間取用(`import * as ns`),令只有該案紅。保持案(邊界不得過度判定、未給新選項時行為同修前)修前即綠,報告須逐案標明「保持案」而不是硬湊紅。
- **預寫之 store 紀錄要落在「過期但未逾清除門檻」**:冷卻紀錄之清除門檻為「有效視窗＋`cooldownMaxMs`」,測試把 `cooldownMaxMs` 設小(30 分)時預寫「2 小時前」之紀錄會先被掃表清掉、變成新建(n 1)——斷言 n 2 失敗而誤以為接線沒生效。選預寫時刻時先算兩個門檻。
- **`budget-cut` 改變了既有測試之預期**:凡「條目逾時遠大於預算」之既有案(剩餘預算壓進 timeoutMs、守門＋預算、逐次預算整合、驗證等待逾時)都會由 `skip-group／timeout` 變為 `budget-cut／budget`;全套跑一次即可撈齊,逐案註明設計出處改寫,不放寬斷言。
- **重試之「不重試判準」取自 execCli 之觀察事件**:`execCli` 之 `kNoRetry` 是模組內 WeakSet、外部看不到;本層接管重試時改讀 `onTrace` 之 `done.reason`(`spawn`／`enoent`／`code2`／`exhausted`),與 execCli 自身之判準逐字同源,不另以結構判定(`isSpawnFail` 會把非 ENOENT 之非同步啟動錯誤也算進去,比 execCli 嚴)。
- **變異在副本上做**:外審進行中不要動 repo 之 src(審查者正在讀);`tmp/di402/mut` 複製 src 與 test 後逐一套用變異、跑對應測試,repo 不受影響,也不必事後比對 sha256。
- **REST 之「多送一次」不一定到得了伺服器**:重試不看期限之變異下,第三次請求之逾時被夾成 1ms,fetch 尚未送達即中止,替身之收件數仍為 2——收件數斷言抓不到;改於轉接器層直呼(帶內部鍵)斷言 `attempts` 與末次逾時值才分得出。下游已有同一正規化時(工作流之 `castBudgetMs` 被遞補層兜底),要找「只有本層看得到」之觀察點(prompt 等待上限)才能證明本層之改動有作用。
- **「不落定」要以增量還原,不以舊值覆寫**:`envDown` 等待期間並行之他呼叫可能已改動或刪除同一條目(成交刪除連敗),以快照之舊值寫回會復活已刪紀錄;還原改為「減去本次增量、紀錄不在即略過」,並以事件閘門(等 `group-exhausted` 後再跑另一呼叫、再放行 envDown)寫成可重現之測試。
- **新增之重試路徑要逐一盤查**:「期限約束一切重試」除 `maxRetries` 外,還有 opencode 之暫時性錯誤重試(其期限判斷只讀守門提示,守門關閉時即不看期限)與驗證不過之重試;以 `rg "delay\(|retry"` 列出所有重試與退避點再對表,外審(terra)仍找出前者。
- **`envDown` 之等待不得以剩餘預算封頂(di402b 修正)**:呼叫端預算恆為各條目逾時之和或更小,斷網時條目等滿逾時、整鏈結束時剩餘 ≈ 0,封頂等於只等約 1 毫秒,呼叫端之真實探測(數十毫秒至數秒)來不及回覆即視同「通」,斷網被計為條目故障。初版(外審 terra F17 亦要求封頂,理由為免永不落定之 envDown 使呼叫超出預算約 5 秒)方向相反——環境歸因屬結束後之記帳,5 秒上限即是對「永不落定」之保護。測「剩餘 ≈ 0」之案用「條目逾時 = 預算」(真時間 400 毫秒)製造,並在 `envDown` 被詢問時自證「距期限 < `minAttemptMs`」,不以牆鐘斷言;延遲 d 與 5000(及與 1 毫秒)之裕度各 ≥ 3 秒(≥ 49 毫秒),負載不改判定。
- **回傳形狀之帶出要在每一層查**:遞補層結果有 `envDown`,但 `callAiWithFallback` 重建回傳物件而丟失(只列 `tried`、`usage`、`quotaExhausted` 等已知鍵),`createAiCaller.callAI` 以展開則原已帶出。新增遞補層結果鍵時用 `rg "quotaExhausted" src` 之類既有鍵為線索找所有重建回傳之站點。
