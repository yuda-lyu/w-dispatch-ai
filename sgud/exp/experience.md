# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

> 2026-10-25 整理(檔過長,約 37KB):2026-10-14～16 之舊經驗(Windows 執行檔錯誤碼、依賴新舊版比對、審計／實作流程、agy、wsemi 1.9.17)已抽出至 `experience_20261025.md`(逐字搬移,節號與標題不變);需要久遠經驗時再調閱.

> 2026-11-03 再整理(檔約 45KB,超過約 30KB 門檻):2026-10-24～28 之 Anthropic API 金鑰計費、failureKind、codex 型號條目,與 2026-11-01～02 之自專案端移入 AI 件(da40／da42)、`createAiCaller` 逐次預算(da52)、`oneline` 與 `strTruncate` 站點(r3da)之經驗,已抽出至 `experience_20261103.md`(逐字搬移,節號與標題不變);需要時再調閱.

## 本套件之遞補與錯誤型別

- `getErrorType` 與 `dispatchAiFallback.isKeyIndependentFail` 原為兩份各自手寫之字樣規則,已不同步(ENAMETOOLONG 在前者為 spawn、在後者不跳組);同類規則要收斂成單一來源,遞補層消費 errorType。
- claude／codex／antigravity 條目通常無金鑰(nk=0),整組跳過與換下一把只差事件型別;實際「逐把空耗」只發生在多金鑰之 opencode 與 REST 條目——評估遞補缺陷之代價時先看金鑰數。
- REST 之 fetch 錯誤不可一律跳組:金鑰含換行等非法標頭字元時,錯誤發生在送出前且只與該把金鑰有關(實測次把成功)。
- 自訂 validate 在 CLI 類原交給 wsemi execCli 於 close 事件內呼叫,拋錯會變成未捕捉例外(行程崩潰);REST 類有 safeValidate。寫測試時 mocha 會把它報成「Uncaught Error」並歸到當前測試。**2026-10-16(1.0.49)起 CLI 類之 validate 改由 `runExecCli` 自判(不交 wsemi),REST 類改用 `safeValidateAsync`,兩者皆經 `src/callUserFn.mjs`(帳本 R-USERFN-2)**。
- 下游 w-knowledge-extract(`src/ai/providerHealth.mjs`)消費 `errorType` 與 `group-exhausted`:只排除 `params`;逐次事件 `next-key`／`skip-group` 會累計 `fail[型別]` 與 params 之 `mismatch`,遞補分流改變會改變這些數字。
- 結構判定「code 為 null 且 pid 為 undefined」必須再加「帶自有 pid 鍵」:REST 結果與 `getErrorResult` 物件也是 code null 且無 pid,否則會被誤判為 spawn(獨立複審 R12 抓到;execCli 兩條失敗路徑皆明給 pid 鍵)。
- undici 對非法標頭值之例外訊息會原文引用整個標頭值(`Headers.append: "Bearer <金鑰>" is an invalid header value.`),且無 cause.code;REST 轉接器以 `cause.code || err.message` 組錯誤字串時即把金鑰帶進 tried、事件與日誌。遮蔽一律走 `src/redactText.mjs`(1.0.48 已實作:`redactText` + `secretHeaderValues`,REST 三家與 fetchQuotaJson 共用)。
- 「呼叫無法開始」不只發生在 spawn:轉接器組參數(opencode 之 `JSON.stringify(config)`)、呼叫端回調(validate、onStdout)、工作流組 prompt(runRolePipeline／runFanout 之 prompt 函式、null 名額)都會讓呼叫在送出前就失敗;盤點時把「失敗發生點」當成一軸逐一列,不要只看 execCli 內部(初版漏此軸,複審補出 4 個成員)。

## opencode 免費模型之實際脈絡長度(2026-10-23 主控實測;證據 opensrcOper `dhist/20261023185913`)

- **型錄值不等於伺服器上限,要實測**:`opencode models opencode --verbose` 之 `limit.context` 是宣告值.10-19 deepseek-v4.1-flash 型錄 200K、實測約 239K;10-23 nemotron-3.5-super-vl 型錄 1,048,576、實測約 1,000,000;beam 型錄與實測皆 1,048,576.
- **測法**:針在乾草堆(暗號在開頭、問題在結尾),以條目之 `config` 覆寫 `provider.opencode.models.<id>.limit`(`context` 拉大、`output` 降為 8000)令本機不先壓縮、由伺服器自判;`--format json` 取伺服器回報之 token(`part.tokens`,含 `cache.read`).先以兩個小尺寸校正「固定開銷」(opencode 系統提示約 3.2～3.8 萬 token)與字元/token 比(本測資料約 2.2),再換算目標尺寸,遇失敗即停、再於邊界二分.
- **溢位之訊息因家而異**:beam 明回「maximum context length is 1048576 tokens…」;nemotron 只回 `AI_APICallError: Bad Request`(6～7 秒即回),要靠二分定出上限,不可把 Bad Request 當成其他錯誤而重試.
- **覆寫 limit 之取捨**:伺服器上限低於型錄時(nemotron),覆寫為實測值較好——否則多步對話長到兩值之間時 opencode 不先壓縮而直接失敗;伺服器上限高於型錄時(deepseek)維持型錄值,免伺服器日後下調時由壓縮變為溢位.opencode 之壓縮為事後觸發(某步用量超過門檻後、下一步前),單則即超過上限之提示詞仍會送出被拒.

## opencode 免費條目漂移與 `filterOpencodeFree`(2026-10-30 run01;帳本 `rulebook_opencodefree.md` R-OCFREE-1～2)

- **`opencode models` 有本機快取,不帶 `--refresh` 之連續兩次查詢可得不同清單**:2026-10-30 本輪第 1 次查詢仍列已下架之 `nemotron-3-ultra-free`,約 25 秒後之兩次(未 refresh)與 `--refresh` 後皆不列,而依條目呼叫在第 1 次列出後約 1 分鐘內即回 UnknownError.教訓:①建議檔「請於處理當日重查」要查**至少兩次且含 `--refresh`**,單次結果不可當真;②「有列」≠「能用」、「不在清單」才是下架之必要條件,所以下架判準仍是兩條件(清單消失＋依條目呼叫約 2s UnknownError);③連網守門用 `--refresh` 取當日事實.
- **失敗不得回空清單**(全域 §12 與任務書):過濾函式遇 `opencode` 不存在／非零離開／逾時／空輸出,回 `ok:false`＋`errorType` 且各清單為 **`null`**(不是 `[]`)——呼叫端若漏判 `ok` 而直接 `.map`,當場 TypeError,不會靜默得到「全部下架」.空輸出（查詢成功但解析不出 id）是獨立之失敗類 `empty`,不是「全部不在清單」.輸入目錄本身無免費條目則是合法之空(`ok:true`,清單為 `[]`)——兩者要有測試區分.
- **免費判定的範圍要先劃**:`zen:jev-1.13-free`(REST)id 含 `free` 但不在 `opencode models`(CLI 目錄之 provider 為 `opencode/`),若一律「不在清單＝下架」會誤判;故只判 `kind:'opencode'` 且 model 以 `opencode/` 開頭者,其餘含 free 字樣者列 `unchecked`.另 `big-pickle` 無 free 字樣,判定要明列(`isFreeText` 單一來源).
- **新增條目之實測紀錄格式**(沿用既有條目):匿名 CLI 簡答、推理題、read 工具讀相對路徑(cwd 指向探針目錄,內有 `MARKER.txt`)、寫檔金絲雀(須被 `OC_READONLY` 擋下:檢查檔案未落地)、`opencode models opencode --verbose` 取 context／output／輸入模態／檔位／release_date、REST 匿名(含同時段已收錄條目之對照組,以區分「該模型被擋」與「閘門整體行為變了」)、針在乾草堆脈絡測試(`--format json` 取伺服器回報之 token).**2026-10-30 之新事實**:匿名 REST 對所有免費模型現回 429 `FreeUsageLimitError`(「Free usage limit reached. Free models work in OpenCode」),不再是先前記載之 403 `FreeTierError`;下架之 minimax 之 REST 為 400「Model is unavailable」.
- **脈絡上限之「含 completion 預留」**:伺服器訊息「maximum context length is 262144 tokens. You requested a total of N tokens: X from the input messages and 32000 for the completion」——上限是輸入＋completion 預留之和,opencode 預設預留 32000,故輸入實際上限 ≈ 型錄值 − 32000.測 ContextOverflow 時行程可能比事件晚很久才結束(本次事件約 5s、行程 66s).`--format json` 之 `step_finish.part.tokens` 可得伺服器回報之總 token.
- **變異驗證用副本目錄**:`./tmp/run01/mut/` 放 `src` 與相關 `test` 之副本,逐一套用單行或多行變異後跑 mocha、還原,不動 repo 之 `src`/`test`;副本位於 repo 之 `tmp` 下,`node_modules` 由上層解析,不需 junction.整批變異於同一次 `quiet-run --lock` 取鎖內跑完(31 個約 82 秒).providers.mjs 為 CRLF,變異腳本讀入時先正規化為 LF 再比對(副本不回寫 repo).
- **工具/守門的坑**:①`quiet-run.mjs` 在 `C:/opensrcOper/tools/`(不是 `C:/opensrc/tools/`);②`npx eslint src test` 須加 `--ext .mjs`;③Bash 內 `grep -c -v $'\r$'` 在本環境不可靠(全部回 0),查行尾改用 node 讀檔計 `\r\n`(原因未查,2026-10-30 實測 `git ls-files --eol` 與 `grep -c` 結果相矛盾).

## OpenCode Zen 改名 Console:路徑對齊與免費額度用盡下的收錄判斷(2026-11-03 da63,Gitea #63;帳本 `rulebook_console.md` R-CONSOLE-1、`rulebook_opencodefree.md` R-OCFREE-2⑥)

- **issue 草案的數字與結論先自己重查,但別推翻整份**:當日重查(官方四頁＋匿名/帶金鑰清單＋假金鑰探測)與提出端 9 成相符(79/9/79 個、`MissingSessionID`、`/messages` 假金鑰回 401、三路徑 jev 皆 200、舊網址 302),不同處只有:提出端稱 `pulse-alpha-free` 匿名簡答「首輪 12.1s 成功」,本機當日第 1 次就逾時並見 `Free usage limit`——**他人的成功數據不可作為本機收錄依據**.
- **官方文件用 WebFetch 摘要再以原始 HTML 去標籤核對**:摘要模型可能漏項(如把 `systemone` 路徑所在頁說成沒列;實際它只在〈Models〉端點欄,不在 api/inference 頁).做法:`curl -s -L` 下載到 `./tmp/<案>/`,用小 `.mjs` 去 `<script>/<style>/標籤`(`</td>`→` | `)成純文字,再用 Grep/Read 取證;表格列變成 `名稱 | id | 端點 | SDK |`,可直接用正規表示式對 `| <model> | (https://…)` 取端點欄——連網守門就是這樣寫的.
- **假金鑰探測是零費用的診斷工具**:`oc_sk_fake` 打各路徑可分辨路由、憑證標頭是否被辨識、先後檢查次序(`MissingSessionID` 先於金鑰檢查;`x-api-key` 與 `Bearer` 在 `/messages` 皆回 `Invalid credential`、不帶憑證回 `Missing API key`),不會成功故不計費;**成功路徑(付費模型)一律標「未實測」**.
- **免費額度用盡時:CLI 與 REST 共用同一額度**,`opencode run` 不結束、只到逾時(必須加 `--print-logs --log-level ERROR` 才看得到 `Free usage limit reached`),匿名與兩把金鑰直呼免費對話模型皆 429 `FreeUsageLimitError`.推論:此時「改走 `oc:`」不是處置,遞補層應整組換付費/Go;何時恢復未驗證.**逾時＋該字樣不是「約 2s 回 UnknownError」,不得據以下架**(`nemotron-3.5-super-vl-free` 保留之依據).偵測一次即停,不要為了「再試一次」反覆耗時(每次 45～120s).
- **收錄實測做不完就不收**(R-OCFREE-2⑥):第 1 項簡答就失敗時,其餘六項(推理題、read、寫檔金絲雀、REST 對照組、目錄欄位、脈絡長度)都不必也不能硬湊;把「缺哪項、重測條件、欄位與排序」寫進帳本與 state 待辦,下次額度恢復直接照做.
- **文件列了≠可用的又一例**:官方〈Models〉頁 2026-11-03 仍列 `nemotron-3-ultra-free`,但清單與 CLI 皆無且已於 10-30 下架;故連網守門只核對「條目是否與端點欄一致」,不以此判可用性.
- **模型清單 `/inference/v1/models` 隨金鑰縮減**:第 1 把只見 9 個免費、第 2 把 79 個;判「模型是否下架」要用實際要用的那把金鑰查,匿名清單是初判.`jev-1.13-free` 不在任一清單卻可用,收錄檢核①因而記為例外(其餘 model 不適用).
- **不改條目 id 前綴**:`zen:` 是 `pick`、遞補游標、冷卻狀態之鍵;改名＝破壞性變更且無對應收益(提出端兩個下游皆未選用此條,但套件對外契約仍在).
- **兩份官方文件看似矛盾時,先找能讓兩說並存的解讀再決定改不改結論**:「每個模型只屬一種 API 家族」(原生)與「付費與 Go 文字模型可經任一協定、非原生者轉譯」(額外)並存,且 09-03 殷鑑是免費模型,與「轉譯只適用付費與 Go」不衝突——故結論限定為免費模型,付費跨協定標「待重驗」,不為此花費用.
- **測試設計**:①檔頭/文件文字守門以「區段切片＋必含/必不含」寫,切片錨點(`★ 診斷流程`、`★ Zen免費層閘門` 等)本身就是被測契約,改標題要同步改測試;②讀 src/README 用 `fileURLToPath(new URL('../x', import.meta.url))`,使變異副本(`tmp/da63/mut/`)不需改 cwd;③變異副本放 repo 內 `tmp/<案>/mut/`,node 沿祖先目錄取 repo 之 `node_modules`,免 junction;④src 為 CRLF,變異的多行 `from` 要寫 `\r\n`,另以 `NOAPPLY` 狀態防「變異沒套上卻當成被抓到」.
- **文字守門的斷言要錨定在目標句,不能只查字樣存在**:首輪變異 M19(刪「`x-api-key` 假金鑰探測結果」句)存活,因為斷言只查檔頭該區段含 `x-api-key`,而②條原文本來就有一般性之 `x-api-key` 字樣;改成須命中「2026-11-03以假金鑰探測…x-api-key…Invalid credential」後才被抓.凡以文字存在性守門,先問「刪掉目標句後,同一字樣會不會在別處仍出現」.
- **測試鎖排隊可能長達數十分鐘到數小時,先備好所有驗證再一次送出**:2026-11-03 三個鎖槽被他套件長測試占住、又有 `exclusive` 申請排在最前面,本套件單案排了 12 與 19 分鐘才取得一次;**背景指令之 `timeout`(含排鎖等待)到期會被收掉並自佇列移除、失去排位**(da63 的變異與全套兩個排隊指令因 `timeout: 3600000` 在排 60 分鐘後被終止).對策:①修前紅用 `git archive HEAD` 解到 `tmp/<案>/head/` 的副本跑(與主樹之後續修改互不影響,可先排隊);②預期要排久的測試以 `nohup … > tmp/<案>/x.out 2>&1 &` 分離執行並把 `quiet-run --timeout` 放大(秒),再用輪詢小腳本等輸出檔變非空,別掛在工具呼叫上;③同一輪的變異與全套盡量連續送出(同套件的第二個排隊指令在第一個釋放後即輪到);④不要為了趕時間不加 `--lock`.
- **Git Bash 的 `curl -w "…\n"`**:格式字串以 `/` 開頭會被 MSYS 路徑轉換改寫(輸出出現 `C:/Program Files/Git/…`),`\n` 也可能原樣輸出;印結果改在 `.mjs` 內做.

## OpenCode Go 月費訂閱:provider 分流、金鑰、用量端點、實測法(2026-11-03 da65,Gitea #65;帳本 `rulebook_opencodego.md` R-OCGO-1～3)

- **同一把工作區金鑰兩個 provider id、兩個額度池**:`opencode/<id>`(免費池或按量)與 `opencode-go/<id>`(Go 月費額度).`dispatchOpencode` 以 `opt.provider` 為鍵注入 `OPENCODE_AUTH_CONTENT`,故**加 Go 條目不必改轉接器**,只要條目的 `provider` 與 `model` 前綴同名.免費池用盡時(`Free usage limit reached…subscribe to OpenCode Go to keep going`,`run` 不結束)同一模型走 Go 路徑照常(beam-free 實測 6.1s)——這是已訂閱者的出路,也是該字樣的來歷.
- **「這把金鑰有沒有 Go 訂閱」用用量端點判,不要打模型**:`GET …/go/v1/usage` 已訂閱 200、未訂閱 403 `EntitlementError`,唯讀不耗額度;打模型則未訂閱者要 77 秒(CLI 內部重試)才失敗.本機同一份 `OPENCODE_KEYS` 就混有兩種金鑰,所以 Go 條目另立 `OPENCODE_GO_KEYS`.探測腳本挑金鑰時一律先用這招,輸出只印狀態碼與百分比.
- **用量端點是未文件化的**:官方 Go 頁與 Console API 頁全文無此端點;上游 PR #16513 的回應形狀(`useBalance`／`rollingUsage`…)與今日實測(`usage.rolling…`)不同——形狀會變,函數對形狀逐項驗證、不符即失敗,不猜.上游原始碼(`packages/console/...`)於 dev 分支路徑 404,查不到到頂時的錯誤型別,**Go 到頂時 CLI 的行為與字樣至今未知**,遞補層因此不接用量.
- **`nextResetAt` 取被限視窗之最晚者**:issue 寫「最早者」,但同時被限的多視窗須全部重置才恢復,取最早者會在其餘視窗仍被限時誤判可用;被限視窗缺 `resetsAt` 時回 `null` 而非以其餘視窗充數(變異 U8～U10 證明).`status` 只見過 `ok`,`rate-limited` 與撞限後行為皆未實測——這是推論,報告與帳本都標明.
- **用量百分比不能證明「單次計入」**:整數百分比,單次簡答($0.0002 量級)不足以令其變動,且該工作區有他人同時在用(rolling 10→11 無法歸因於我那 1 次);要驗計入須用多次或 `opencode.allowance`(推論回應內欄位,CLI 內部取不到).不要把「前後差 1」寫成已證.
- **字元/token 校準用被拒回應最準**:伺服器拒收時回「236233 tokens from the input messages」,對應 70 萬字元的英文偽隨機句 → 約 2.96 字元/token(先前經驗值 2.2 是另一種文字).iceman-contributor-free 伺服器上限 262139、opencode 預設預留 32000 給 completion,輸入實際上限約 23 萬 token;超過時 CLI 會**自動壓縮脈絡**後以 exit 1 結束,stdout 是摘要文字而非答案(同 10-19 deepseek 的「事後壓縮」現象).
- **測試設計教訓(變異揭露)**:①`fail()` 的預設值只在「呼叫處不傳該欄」時生效,測試只斷言 401 時 `noGoSubscription=false` 抓不到「預設改為真」(U25 首輪存活)——要對**每一類**失敗斷言預設欄位;②註解標記「〔本機實測〕」若只查條目內任一處出現,刪掉一處仍綠(D7 首輪存活)——標記須錨定在**緊接實測結果的證據句**;③**變異不可改判定基準(測試)本身**:D16 改的是 `unit-providers` 的例外表,測試不可能抓自己,屬無效變異,改以 src 端變異(他條改成 xhigh,C5／C14／C15)證明「例外只限 qwen」;④守門測試(`goEntries.map(…)` 對空集合恆綠)要加 `goEntries.length` 斷言,否則條目全被刪時仍綠.
- **既有測試跟著條數／群組變動**:新增條目令 `unit-providersCodexEntries`(群組順序)與 `unit-resolveProviders`(模擬 env 須備齊所有 envVar)失敗,屬預期的連帶修改,跑全套才會發現——新增 provider 條目前先 Grep 測試中的條數與群組前綴清單.
- **工具與環境的坑**:①守門下 `grep -c $'\r'` 的 `$'\r'` 展開為空,會把「所有行」當 CR 行——檢查行尾改用 `git ls-files --eol` 或 node 計數;Write 新建檔為 LF,Edit 保持原檔行尾(`providers.mjs` 等為 CRLF),變異腳本的多行字串須依檔案實際行尾;②守門 `bash-write` 會把含 `->` 的 `echo` 當成重導向擋下,說明文字寫進 `.mjs` 內印;③上游倉庫改名:`sst/opencode` → `anomalyco/opencode`,GitHub API 會 301,`curl -L` 才取得.
