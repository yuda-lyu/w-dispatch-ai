# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

> 2026-10-25 整理(檔過長,約 37KB):2026-10-14～16 之舊經驗(Windows 執行檔錯誤碼、依賴新舊版比對、審計／實作流程、agy、wsemi 1.9.17)已抽出至 `experience_20261025.md`(逐字搬移,節號與標題不變);需要久遠經驗時再調閱.

> 2026-11-03 再整理(檔約 45KB,超過約 30KB 門檻):2026-10-24～28 之 Anthropic API 金鑰計費、failureKind、codex 型號條目,與 2026-11-01～02 之自專案端移入 AI 件(da40／da42)、`createAiCaller` 逐次預算(da52)、`oneline` 與 `strTruncate` 站點(r3da)之經驗,已抽出至 `experience_20261103.md`(逐字搬移,節號與標題不變);需要時再調閱.

> 2026-11-07 再整理(檔約 34KB,超過約 30KB 門檻;第 325 項):2026-10-23～11-03 之 opencode 免費模型脈絡長度、免費條目漂移與 `filterOpencodeFree`(R-OCFREE-1～2)、OpenCode Zen 改名 Console 與額度用盡下的收錄判斷(R-CONSOLE-1)、OpenCode Go 月費訂閱之 provider 分流／金鑰／用量端點／實測法(R-OCGO-1～3)等四節,已抽出至 `experience_20261107.md`(逐字搬移,節號與標題不變);需要時再調閱.

> 2026-11-08 再整理(檔約 34KB,超過約 30KB 門檻):2026-10-23～11-05 之遞補與錯誤型別、CLI spawn 守門與 Go 用量冷卻(da67)、opencode 單次輸出上限與截斷偵測(da78)、放行最小間隔與暫時性重試(da320)等四節,已抽出至 `experience_20261108.md`(逐字搬移,節號與標題不變);需要時再調閱.

> 2026-11-19 再整理(檔約 51KB,超過約 30KB 門檻):2026-11-07～11-11 之免費期 Go 條目下架連網守門紅燈(da405)、OpenCode Go 型錄漂移對齊與 crouton-alpha-free(ke339)、訂閱類條目用量門檻與額度帳(ke340)、agy 提示詞走 stdin(ke342)、CLI 失敗帶回原因(da110)、額度帳帳號識別與重探(da116)、冷卻／健康／預算語意邊界(di402)、呼叫端期限與遞補層期限取早(d417)共八節,已抽出至 `experience_20261119.md`(逐字搬移,節號與標題不變);需要時再調閱.

> 2026-11-24 再整理(檔約 54KB,超過約 30KB 門檻;tdai4b):2026-11-13～11-21 之 Poolside 下架(dl583)、可讀性探針與金鑰型 opt 收嚴(dai492i2)、訂閱 `opencode-go` 到頂(wda158)、免費池用盡／免費層 429(wda156)、`timeoutMs` 判定單一來源與 Hydrogen 條目(da-hy)、連網守門紅燈(wda530)共六節,已逐字抽出至 `experience_20261124.md`;2026-11-19～11-23 之 tdai1、tdai1b、wsemi 1.9.69(dai492i)、tdai2、tdai2b 共五節,已逐字抽出至 `experience_20261124b.md`(節號與標題不變,只搬移,不刪內容).主檔留 tdai3 以後各節;需要久遠經驗時再調閱.

## 2026-11-24 tdai3:免費池重新盤點與 agy 真防寫(排程第 341、445 項;帳本 `rulebook_opencodefree.md` R-OCFREE-2⑦、`rulebook_agy.md` R-AGY-5)

- **有限度外部呼叫之作法(opencode 免費模型 ≤ 30、agy ≤ 15 次)**:先備好「證據檔＋次數守門」再呼叫——`./tmp/tdai3/lib.mjs` 之 `guard(svc)` 於每次呼叫前讀證據 JSONL 計次、達上限即拋錯,`record()` 追加一行(模型、目的、結果、耗時、檔案是否落地);所有呼叫一律經本套件之 `dispatchOpencode`／`dispatchAntigravity`(生產路徑,附帶 `--print-logs` 額度偵測與 `denied` 判別)而非手組命令列;目錄查詢與官方文件 GET 不計次但以 `counted:false` 備註.額度字樣(`quota`／`rate-limit`、agy 之 `RESOURCE_EXHAUSTED`)出現即以離開碼 3 停.失敗之呼叫(agy 第 1 次因 OAuth 刷新網路逾時)照算次數.
- **先讀官方 Privacy 再決定能送什麼**:`tidepool-alpha-free` 之 CLI 四項實測送完後才讀到官方〈Zen〉Privacy 載明「collected data is retained and used to improve the model」(iceman 同),已無法補救(所送皆為無害固定提示詞,但違反「訓練類只送回覆」之界線精神).**下次順序:查目錄 → 讀官方 Privacy／Free models 段(`curl -sL https://opencode.ai/docs/zen/` 以 `html2txt` 去標籤後 Grep 模型名) → 才決定每個候選可送之提示詞範圍**.官方文字:hy4 為零保留不訓練;beam 保留 30 天不訓練;deepseek 零保留不訓練;其餘 stealth／NVIDIA 試用者皆為「改進模型」類.
- **脈絡長度校準:字元／token 比隨文字而異**:本輪偽隨機英文常用字句 120 萬字元 → 伺服器回報 278235 token(扣系統提示約 3.5 萬 ≈ 4.9 字元/token);先前 OpenCode Go 實測偽隨機句約 2.96、舊測資約 2.2.**不可沿用舊比值**,先以約 1/4 上限之小尺寸呼叫校準再換算目標;`--format json` 之 `step_finish.part.tokens.total` 為伺服器回報之總 token(含系統提示).450 萬字元 → 950292(型錄上限 1048576 之 90.6%),一次命中、未需第二次修正.覆寫 `limit{context:1048576, output:8000}` 並 `outputTokenMax` 8000 令本機不先壓縮.
- **新版 opencode 寫檔金絲雀之形狀**:1.0.109 起 `ask` 被自動拒絕回 `errorType 'denied'`(`ok:false`、stdout 空),不再是舊條目註解之「回空字串而 `ok:true`」;新條目註解與測試依新形狀記(舊條目註解未改,屬歷史實測).
- **agy 權限引擎(官方〈Agent permissions〉頁)**:`write_file`、工作區內 `command`(終端機沙箱內)預設為「Ask(工作區內自動允許)」,headless 下 Ask 一律自動拒絕——故 `skipPermissions:false` 只擋**工作區外**;deny 優先於 ask／allow、任何模式皆擋(含 `--dangerously-skip-permissions`,實測);**只 deny `write_file` 不夠**,模型改走 shell 繞過(實測 70s 落地),`command(*)` 缺一不可.`--settings` 接內聯 JSON(本次工作階段限定、不存檔),Node `spawn` 於 Windows 傳含雙引號之 JSON 實測無須額外跳脫.被擋時模型回說明文字、`ok:true`、stdout 非空(與工作區外自動拒絕之空輸出不同)——判被擋用「檔案是否落地」.`--mode plan` 只在提示詞前加 `/plan`,不是防線.
- **agy 登入權杖過期之診斷**:第 1 次呼叫回「Authentication required … Waiting for authentication (timeout 60s)」,`~/.gemini/antigravity-cli/cli.log` 見 `keyringAuth: loaded token … expired=true` 與 `token refresh failed due to network error: Post "https://oauth2.googleapis.com/token": dial tcp … connectex`(瞬時網路逾時,非需重新登入);數十秒後(期間 `quota-agy` 之 `/usage` 成功)重試即成.遇此訊息先看 `cli.log` 是否為網路刷新逾時,不要當成須互動登入.
- **OS 層唯讀工作區之實驗**:`icacls <夾> /deny "<使用者>:(OI)(CI)(WD,AD,DC)"` 令本使用者無法新增／寫入／刪除,`icacls <夾> /remove:d <使用者>` 還原;**重建夾具(`rmSync`)前必先還原 ACL**,否則刪除失敗;腳本內以 `writeFileSync` 自測拒絕(`EPERM`)/還原後成功.
- **任務書版號與實況不符**:任務書稱「完成後發布 1.0.111」,但 `npm view w-dispatch-ai time` 顯示 1.0.111 已於 2026-11-23 21:10(+8)發布、`package.json` 亦為 1.0.111;README「未發布」標題依 `unit-readmeVersions` 之提示規則須寫大於 `package.json` 版號者,故寫「預計 1.0.112」並請主控裁示.派工前以 `npm view <pkg> time` 核對最新版號.
- **新增內建條目前先 Grep 條數字面**:條數 35 散落於 `unit-providersOpencodeFreeEntries`、`unit-providersOpencodeGoDocs`(README／`resolveProviders` JSDoc 字面)、`unit-providersOpencodeGoEntries`、`unit-patchCatalogueConfig`(`[35, []]` 形狀,`\b35\b` 才抓得到)與 README 量級感受(35／27／175／135／8.75／6.75);另有結構斷言釘條目鍵集合(`unit-agyFailShapes` 之 `Object.keys(...)`):改條目欄位前先搜.
- **守門攔截**:`echo … >` 寫自測檔被 `bash-write` 擋、`sed -i` 被擋——改把自測寫進 `.mjs` 內、以 Edit `replace_all` 取代 `sed -i`.

## 2026-11-24 tdai4:全庫遮罩改用 wsemi 共用遮罩、字樣 `***`(排程第 625 項,第 486 項之使用端;帳本 `rulebook_redact.md` R-REDACT-1～2)

- **`maskDiagText` 不能直接當「全文遮罩」用**:對超過 20000 字元者只輸出前 20000 字元並接 `…(len=原長)`.成功之 `stdout` 是模型輸出(可達數萬字元),且下游 `strTruncate` 以遮蔽後長度標註原始總長,故非串流入口須用 `genDiagStreamMasker` 整段 `push` 一次再 `flush`(每列之結果等於 `maskDiagText(該列)`,輸出全文).長度案要把機密值放在 15990／16000／19990／20000／20005 等分段邊界附近測(`unit-redactText` S4、S5),變異「改用 `maskDiagText`」才轉紅(R09).
- **區間合併取代與「先精確後樣式依序取代」不同**:wsemi 於原文上求全部規則之命中區間、相交者合併一次取代.`echo-<金鑰>-tail` 在診斷家族由 `echo-[REDACTED]-tail` 變為 `echo-***`(`-tail` 屬 `sk-ant-` 樣式字元集而併入);精確家族不套樣式,仍是 `echo-***-tail`.改期望時不是放寬——斷言仍是「金鑰任何片段不在輸出」,多遮是 wsemi 設計.
- **兩個家族不是同一個設定**:`credPatterns: false` 只遮已登錄機密值(模型輸出、串流 stdout);預設含內建憑證樣式(`password=`、`user:pass@`、`Bearer`).成功之 `stdout` 套診斷家族會破壞模型輸出裡合法之 `password=…` 範例字樣——須有「三條成功路徑(正常、validate、max_tokens 放行)皆保留範例字樣」之案才殺得掉 A06／A07 變異(原測試只有一條路徑,另兩處存活).
- **變異存活要分「最後防線 = 冪等再遮」與「沒測到」**:`dispatchClaude` 之 `errorDetail` 再遮為冪等(`runExecCli` 已用 `maskDiag`,其機密值與樣式為超集),無輸入可區分,判等價(D06);其餘存活(Go 用量最後防線、探測最後防線、`apiErrorType`、`fetchQuotaJson` 讀本文失敗、`error` 欄位)皆為「該站點從未被測過」——補:`baseURL` getter 於金鑰通過後拋夾帶金鑰之例外、回應物件 `headers` getter 拋錯、`error.type` 回顯金鑰、替身 `fetch` 令串流讀取拋錯、`exe` 名含金鑰令 `ENOENT: spawn <exe> ENOENT`.
- **修前紅之作法**:`git archive HEAD src package.json` 解到 `./tmp/tdai4/pre/`、疊上工作樹全部測試,以 `node ../../../node_modules/mocha/bin/mocha.js` 跑(鏡像含 `package.json` 時 `npx mocha` 會當成獨立專案而找不到本地 mocha);47 項失敗.變異鏡像同法(只複製檔案,無目錄連結),錨點須恰出現一次否則報 `ANCHOR_ERROR`,通過＋失敗為 0 判無法判定.
- **「PATH 移除真 CLI」包裝**:`withPath.mjs` 過濾含 `claude`／`codex`／`opencode`／`agy` 之 PATH 目錄後再起 mocha(印出各 CLI 解析結果以證明確實移除),另以 `--real` 單跑 5 個 `api-` 測試;全套 13 pending 皆為預期略過(opencode 相關與免費清單比對、非 win32 專屬案),真 PATH 單跑 19 passing 0 pending.
- **盤點式測試要防空集合**:`unit-redactSites` 先斷言掃描檔數與站點全集(10＋入口),再斷言「無殘留自寫遮罩」;`split(…).join(` 之樣式須含巢狀括號與跨行(獨立複審指出單行 `[^)]*` 會漏掃).
- **獨立複審(sonnet,唯讀)之價值**:找出 3 條「既有而未動」之未涵蓋路徑(只給 `opt.env.ANTHROPIC_API_KEY`、另三家 REST 之錯誤本體、`dispatchOpencode` 之 stdout/stderr)與 README 敘述不符處(受影響欄位只有 `api-anthropic` 全套、精確家族不併 `-tail`、延遲描述漏單列分段);程式面無外洩.
- **工具殼陷阱**:此工具殼之 Bash 把 `grep -c $'\r'` 之 `$'\r'` 吃成空樣式(計出全部行數而誤判 CRLF),判行尾改用 `git ls-files --eol`;`decision-log.mjs` 之任務資料夾路徑須以單引號包(反斜線會被吃掉);Bash 守門擋 `cd`,改用 `npm --prefix`、`--cwd`、絕對路徑.

## 2026-11-24 tdai4b:補齊四條未涵蓋之金鑰外洩路徑(三家 REST、`dispatchOpencode`、`dispatchClaude` 之 env 金鑰、樣式集收斂;帳本 `rulebook_redact.md` R-REDACT-2～3)

- **遮蔽改成「全站點同一套清單」後,測試之「回聲取證」會被遮掉**:`dispatchOpencode` 注入金鑰後,結果 `stdout` 之 `OPENCODE_AUTH_CONTENT` 回聲也被遮蔽,14 個既有測試(`unit-dispatchOpencode` 5、`unit-dispatchAi` 1、`unit-dispatchAiFallback` 3、`unit-goQuotaGate` 2、`unit-opencodeAuthOpts` 1、`unit-providersOpencodeGoEntries` 2;前 9 個於受影響檔之試跑即現形,後 5 個要到全套才現形——改輸出遮罩後須跑全套而非只跑受影響檔)讀 `JSON.parse(stdout).env.OPENCODE_AUTH_CONTENT` 驗「本次注入了哪把金鑰」而轉紅——不是遮蔽有誤,是驗證通道被自己的修正封住.解法:假 CLI 另寫側通道報告(`fakeCliForTest` 於結束前寫 `<fd>/last-report.json`,`createFakeCli().lastReport()` 讀回,須於下一次呼叫前取),測試改讀側通道;不得把測試金鑰改短(<6)來躲遮蔽.遇「改了輸出內容之遮罩」先 Grep 測試是否以輸出回聲當證據.
- **獨立複審找到之「第二層」漏洞**:①`failureDetail`／`deniedRule`／上游原因用之 `secrets` 仍只含 `key`(不含自 `OPENCODE_AUTH_CONTENT` 解出之金鑰)——結果欄位與回調都遮了,而判中分支(免費池用盡、429、ask 被拒)另有欄位走另一份清單;②`ANTHROPIC_API_KEY` 在 Windows 不分大小寫,`opt.env` 同時有兩種大小寫名稱時只遮蔽第一個相符者,子進程實際用另一個;③key 帶頭尾空白(自檔案讀入未 `trim`)時 fetch 送出前去空白、伺服器回顯去空白者,遮蔽集合含原值而比對不到——機密值須展開變體(原值、去頭尾空白、去 `Bearer ` 前綴);④Responses 之 `INCOMPLETE_RESPONSE`／截斷裁定 `error` 含伺服器回傳之 status 與原因;⑤Typesafe 之 `modelResolved` 取自回應.教訓:**以「欄位全集」而非「站點」盤點**——列出結果物件每個欄位之來源(固定字串、外來文字、透傳),外來文字欄位逐一確認經遮蔽.
- **過度遮蔽之權衡**:`secretHeaderValues` 原只排除 Content-Type／Accept-Encoding,錯誤路徑全面遮蔽後,呼叫端自給之 `Accept`、`HTTP-Referer`、`X-Title` 之值出現於錯誤本體時被遮成 `***` 而無從診斷;加「已知非憑證標頭」排除表(預設仍拒絕:表外一律視為機密).樣式集(`sk-`／`pk_` 後接 12 字元以上等)為子字串規則,誤遮 SQL 約束名之類一般文字——屬 `failureDiag.maskDiag` 修前即有之取捨,README 明載.
- **互為備援之冗餘遮蔽,變異判等價之辨識**:S05(`redactResult` 之 `errorDetail` 再遮)、C08／X02(`diagSecrets`)、O03(`authSecretsOf` 另收 `key` 參數)皆為「下層遮蔽＋上層以同一清單再遮」或「注入內容必含 key」之冗餘,拿掉任一道都有另一道擋住;判等價之依據須寫明「無輸入可區分」並說明兩道使用同一清單.與之對照:O10(走訪略過屬性名 `type` 之整個子樹)初次存活是因 `key` 參數備援,補「只靠解析 auth 內容(env 自給、不給 key)且 provider 名稱恰為 `type`」之案(只有它抓得到)後轉殺死.
- **內部監看與呼叫端回調之包裝順序**:`dispatchOpencode` 之事件流累積、限額監看、ask 被拒監看都以 `userOnStdout`／`userOnStderr` 轉交呼叫端回調;遮蔽包裝須先於這些包裝(`optCli = omit(...)` 之後立即),內部判讀才仍收原文、只有呼叫端回調收遮蔽文字(`dispatchClaude` 之 `tap` 同).`authSecretsOf` 以「子進程實際收到之值」為準:`opt.env` 內名稱不分大小寫、`undefined` 表移除(不取本行程環境之值)、未給則取 `process.env`.
- **經驗檔整理**:`experience.md` 54KB→11.8KB,第 0～5 節抽至 `experience_20261124.md`(23.6KB)、第 6～10 節抽至 `experience_20261124b.md`(20.2KB);腳本自驗「抽出之檔去標頭＋主檔去註記後串回等於原檔」(逐字);同時 `rulebook_spawn.md` 逾 30KB(35KB)而把 R-REDACT 區段抽至 `rulebook_redact.md`(自驗同法);抽出後逐一更新引用該節之 `state_tdai*.md` 與帳本內之指標.
