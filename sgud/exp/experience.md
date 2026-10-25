# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

> 2026-10-25 整理(檔過長,約 37KB):2026-10-14～16 之舊經驗(Windows 執行檔錯誤碼、依賴新舊版比對、審計／實作流程、agy、wsemi 1.9.17)已抽出至 `experience_20261025.md`(逐字搬移,節號與標題不變);需要久遠經驗時再調閱.

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

## Anthropic API 金鑰計費(2026-10-24～25 dispatch-run01／run02;帳本 `rulebook_anthropic.md`)

- **「給 key」不等於「走 API 金鑰」**:Claude Code 同時有多種憑證時依序擇一,`CLAUDE_CODE_USE_*` 與 `ANTHROPIC_AUTH_TOKEN` 的序位**高於** `ANTHROPIC_API_KEY`(官方 authentication 文件),父環境殘留這兩類時只設 key 會被蓋過而悄悄走別條路.故子進程須移除而不是只加.`-p` 模式下 `ANTHROPIC_API_KEY`「一律使用」(互動模式才需核可),所以不必處理核可清單.
- **判讀用 init 事件而非設定**:`--output-format stream-json --verbose` 的首個 `system/init` 事件之 `apiKeySource`(官方四值 `ANTHROPIC_API_KEY`｜`apiKeyHelper`｜`/login managed key`｜`none`).環境變數處理不到而仍可能蓋過者(`settings.json` 的 `env`、gateway 登入、`ANTHROPIC_BASE_URL`)只能靠這個事件發現.
- **全域 `ANTHROPIC_API_KEY` 是計費陷阱**:設了就是本機全部 Claude Code(含訂閱條目)改走 API;所以 `.env` 變數名固定 `ANTHROPIC_KEYS`,測試守門「任何條目 `envVar` 不得為 `ANTHROPIC_API_KEY`」.
- **遮蔽要分「精確 key」與「樣式」兩層**:精確 key 遮蔽不到被 `strTruncate` 截斷後只剩前段的殘段,也遮蔽不到他把金鑰;所以失敗路徑加 `sk-ant-[A-Za-z0-9_-]{4,}` 樣式.但**成功之 stdout 是模型輸出**,合法內容可含 `sk-ant-api03-…` 範例字樣,只遮蔽 key 本身.
- **假伺服器自帶把關才能讓「缺標頭」變異現形**:`fakeServerForAnthropicTest` 缺 `x-api-key` 回 401、缺 `anthropic-version` 回 400、缺 `max_tokens` 回 400,則任一成功路徑測試都同時守住標頭——變異 M3(缺 `anthropic-version`)令 23 條失敗.只在單一請求形狀測試斷言標頭,別的測試改動時不會發現.
- **fetch 對大小寫不同的同名標頭會合併成逗號串**:`opt.headers` 的 `X-API-KEY` 與預設 `x-api-key` 並存時送出 `a, b`;所以 `dispatchApiAnthropic` 組標頭時同名(不分大小寫)先刪預設再設.另兩個 REST 轉接器(`Authorization`)未處理此點,屬既有行為未改.
- **工具與環境的坑**:①Windows 的 tar 把 `C:` 當遠端主機,`tar -xf C:\…` 失敗,須 `cwd` 加相對路徑;②工作區檔案行尾可能是 CRLF(`providers.mjs`),以字串比對的變異腳本須先偵測並轉換 `\n`;③假伺服器在**同一行程**時,不可用 `spawnSync` 啟動會呼叫它的子行程(封鎖事件迴圈致死結),要用非同步 `spawn`;④Edit 工具對 CRLF 檔寫入多行文字仍維持全檔 CRLF(實測 713/713).
- **全取遞補與計費條目**:計費條目集中於清單末端(先 CLI 後 REST)才使「全取」時最後才耗用 API 額度;仍建議使用端 `pick`.
- **不能發真實請求時的驗證法**:假 `.env`＋假 Anthropic 伺服器＋假 claude(依環境輸出 `apiKeySource`)跑同一支實測腳本(離線乾跑),驗腳本邏輯、判讀與遮蔽;真實呼叫留給持有金鑰者.

## 在 Claude Code 工作階段內呼叫 `claude`:繼承之父 session 連結變數(2026-10-25 dispatch-run03)

- **現象**(主控以 Claude Code 2.1.302 實測,離線測試抓不到):呼叫端自己跑在 Claude Code 工作階段內(agent 派工、hook、`!` 指令)時,`dispatchClaude` 給 key 後子 `claude` 的 `apiKeySource` 仍是 `none`——子進程繼承了父 session 注入之 `CLAUDE_CODE_*`／`CLAUDE_AGENT_SDK_VERSION`／`CLAUDE_PID`／`CLAUDE_EFFORT` 等連結變數,沿用父登入而無視 `ANTHROPIC_API_KEY`.移除繼承之這些變數後才是 `ANTHROPIC_API_KEY`.run02 的 key 入環境測試、遮蔽測試、假 CLI 驗收全綠,卻沒覆蓋「呼叫端環境本身是 Claude Code 工作階段」這個輸入軸——**憑證/優先序類修正,輸入空間表必須含「呼叫端所處環境」(裸終端機 vs. Claude Code 工作階段內 vs. CI)**,且假 CLI 要能模擬「某變數在場即改判」才測得出.
- **父 session 注入哪些變數**(本機實測名單,並非 Windows 登錄檔使用者／機器變數):`CLAUDECODE`、`CLAUDE_AGENT_SDK_VERSION`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_CODE_EMIT_STARTUP_TIMING`、`CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`、`CLAUDE_CODE_ENABLE_TASKS`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_EXECPATH`、`CLAUDE_CODE_MESSAGING_SOCKET`、`CLAUDE_CODE_MESSAGING_TOKEN`、`CLAUDE_CODE_QUESTION_PREVIEW_FORMAT`、`CLAUDE_CODE_SESSION_ATTENDED`、`CLAUDE_CODE_SESSION_ID`、`CLAUDE_EFFORT`、`CLAUDE_PID`(另有 `MCP_CONNECTION_NONBLOCKING`,非 `CLAUDE` 前綴,不處理).判定法:列出 `Object.keys(process.env)` 中 `CLAUDE*`，再查登錄檔 `HKCU\Environment` 與 `HKLM\...\Environment` 排除使用者自設者.
- **官方文件的缺口**(env-vars 頁):逐項只說明各變數用途與「Set by Claude Code」,**沒有任何一句說明巢狀 session 會沿用父登入**,也沒指出元兇;文件上 `CLAUDE_CODE_*` 另有一大批使用者設定(`TMPDIR`、`SHELL`、`USE_POWERSHELL_TOOL`、`EFFORT_LEVEL`、`SUBAGENT_MODEL`、`PLUGIN_*`、`GIT_BASH_PATH`…).所以只能以「前綴整批移除＋保留清單」處理,不能窮舉;元兇未隔離前不要宣稱知道是哪個.
- **移除規則的取捨**:要移除的是**繼承自 `process.env`**者,不是呼叫端 `opt.env` 明確傳入者(後者代表呼叫端的意圖,如 `CLAUDE_CODE_EFFORT_LEVEL`);保留清單只放「缺了子進程可能無法啟動」者(Windows 的 `CLAUDE_CODE_GIT_BASH_PATH`),行為偏好類缺了只是回預設.判定「呼叫端已傳入」用「同名含大小寫已在 env 物件內」——wsemi `execCli` 在 Windows 對 `envExtra` 與繼承值做不分大小寫的同名覆蓋(`buildSpawnEnv`),值為 `undefined` 者展開後由 Node `spawn` 略過,故以 `undefined` 標記即移除繼承值.
- **測試與工具的坑**:①`withEnv` 還原順序:Windows 的 `process.env` 不分大小寫,同一 patch 內 `CLAUDE_CODE_SESSION_ID`(cleanParent 先刪)與 `claude_code_session_id`(後設)是同一個變數,**必須逆序還原**,否則先還原真實值又被後者的 `delete` 抹掉(會把測試行程自己的 session 變數永久刪掉);②`this.skip()` 在 `it(function(){})` 內可用(非 arrow);③變異工具 `mutate.mjs` 的 `from` 樣式遇多行須用 `\n`,CRLF 檔由工具自行轉換;④實測腳本若要印環境變數**只印名稱不印值**(`CLAUDE_CODE_MESSAGING_TOKEN` 是權杖),離線驗收以「輸出不含假權杖值」守門.
- **離線驗收法**(不發真實請求):假 claude 設定「作祟變數在場即 `apiKeySource=none`」,跑實測腳本的 `--control`(不給 key,應仍見全部連結變數)與 `--bisect`(逐一傳回單一變數,應只有作祟者翻回 `none`),即驗了腳本判讀與 `--bisect` 邏輯;真實元兇由主控以真實 `claude` 跑 `--bisect` 取得.

## 失敗細分類 `failureKind` 與遞補處置(2026-10-25 dispatch-run01 修正輪;帳本 `rulebook_failurekind.md` R-ANTHROPIC-5)

- **問題的形狀**:CLI 回「Credit balance is too low」**不等於**沒額度(主控重現:`env:{ANTHROPIC_API_KEY}`＋`--bare` 時 CLI 稱沒額度,同金鑰經 `key` 參數與 REST 皆正常),子代理據此誤判「API 額度用盡」.教訓:**單一來源的失敗字樣不足以判額度**,須用另一條獨立路徑(REST 極小請求)交叉確認;REST 成功就是「呼叫方式或環境錯誤」,不是額度.同理「沒額度」與「脈絡過長」同為 HTTP 400,只靠 `errorType` 分不出,遞補層一律換金鑰會把所有金鑰輪過一遍(誤判用盡)或對必然相同的結果空耗.
- **`execCli` 失敗時 stdout 只留前 500 字元**(`strTruncate` 取頭,wsemi `execCli.mjs`:306)——stream-json 輸出的 result 事件在**尾端**,failure 結果裡看不到;所以 CLI 分類要靠 `onStdout`／`onStderr` 另錄尾段(分類用,不外送).寫 CLI 失敗分類前先看失敗結果實際保留什麼,別假設 `r.stdout` 是完整輸出.
- **官方依據的取得法**(不發請求):`WebFetch` 官方頁——errors(HTTP 碼與 `error.type`)、rate-limits(花費上限:自設=400「You have reached your specified … API usage limits」,月上限=429＋`error.details.error_code: enforced_spend_limit_reached`＋無 `retry-after`;限額標頭 `anthropic-ratelimit-*`)、context-windows(輸入本身超過視窗=400「prompt is too long」;4.5 以後「輸入＋max_tokens 超過」不是錯誤,`stop_reason: model_context_window_exceeded`)、agent-sdk/typescript(`SDKAssistantMessage.error` 十二值、`SDKResultMessage.api_error_status`;頁面長,`WebFetch` 要分段 `offset` 讀).「Your credit balance is too low to access the Anthropic API」官方 errors 頁**未逐字載明**,只能標註為第三方回報.
- **CLI 字樣取得法**:`grep -a -o -E "Credit balance is too low[^\"]{0,120}" ~/.local/bin/claude.exe`(290MB 原生執行檔,單次約數十秒).取得的是「程式內含之字串」(含 `Prompt is too long`、`Invalid API key`、`Unable to connect to API (${…})`、`Repeated 529 Overloaded errors`、`Server is temporarily limiting requests (not your usage limit)`、`You've hit your limit` 等),**不等於各情境實際輸出**;文件須標明哪些經實測(僅「Credit balance is too low」)、哪些未實測.Claude Code 自己的分類正則含 `credit balance (is )?too low|usage limit reached`.
- **額度池跨條目共享**:`claude-api:` 與 `anthropic:` 共用同一組 `ANTHROPIC_KEYS` 與同一 Console 額度,所以「某把沒額度」是**金鑰層級**事實而非條目層級——游標與條目冷卻(以 id 為鍵)表達不了,故用金鑰指紋(sha256 前 16 碼;**store 不存金鑰本體**)做本次呼叫內 `deadKeys` 與 `cooldownMs>0` 時的跨呼叫 `keyCooling`.範圍限「官方端點」(`kind` 為 `api-anthropic`／`claude` 且未自訂 `baseURL`),因為自訂閘道的額度與該把金鑰未必同池.
- **注入 `fetch` 讓 CLI 條目也可離線測交叉確認**:條目的 `fetch` 鍵經遞補層原樣轉傳 `dispatchClaude`(`OWN_KEYS` 含它,不外傳 execCli)與 `dispatchApiAnthropic`;測試用 `fetch: (url, init) => fetch(`${srv.url}/v1/messages`, init)` 把請求轉向本機假伺服器,假伺服器 `by-key` 路由依金鑰字樣給不同結果,配合 `crossCheckModel: 'by-key'` 即可同時模擬「CLI 稱沒額度,REST 確認／否認」.條目不能設 `baseURL`(會被視為自訂端點而不屬官方範圍),所以改用注入的 `fetch`.
- **測試一次全綠要懷疑**:新測試第一次跑 211 條全過,必須做「修前紅」(`git archive HEAD src` 解到 `./tmp/…/red/src`,疊上新測試與 `test/tools`,逐檔跑:92 條 failing,通過者皆為「不得改變」守門)與變異驗證(`tmp/dispatch-run01/mutate.mjs`,於副本套變異、須至少一條 failing);變異工具要先跑基準(未變異須全綠),`find` 須恰出現一次否則標 BAD_MUTANT.`runTests.mjs` 逐檔跑 mocha(模組不存在時整檔 failing 為 0 但 exit 1,需標 MODULE_NOT_FOUND).
- **與鎖共處**:`quiet-run --lock` 在他套件長時間持鎖時會等很久(本輪等 8 分 20 秒);等待期間做文件、不要輪詢;摘要若報他套件之殘留鎖(持有者 pid 已不存在)只回報主控,不處理.
- **分隔符處置的取捨**:使用者以分號分隔 `ANTHROPIC_KEYS` 致整串當成一把(得到 401 而非明顯的設定錯誤).選「`*_KEYS` 遇分號視同逗號＋warning」而非只警告:內建供應商金鑰字元不含分號,自動拆開貼近意圖,warning 避免靜默;只作用於複數形 `_KEYS` 以保相容,並留 `splitSemicolon: false` 出口.
- **外審(sol,gpt-6.1-sol max,唯讀沙箱,16 分鐘)二十條,逐條讀碼核對後 18 條屬實或部分屬實並已修**——自審與測試全綠漏掉的共通形狀:①**把「條目欄位」當成「實際行為」**:以 `baseURL` 判官方端點,但 CLI 經 `ANTHROPIC_BASE_URL`(條目 env／process.env)改端點、REST 的 `headers` 可覆寫 `x-api-key`,金鑰指紋因而代表了未實際使用的金鑰→範圍判定要看**實際生效的端點與認證**,看不到者(settings.json 的 env)寫成已知限制;②**新分類器的輸入證據邊界**:全文搜尋關鍵字會把「提到關鍵字的短模型回答」(離開碼非零)誤判成 API 錯誤——純文字須**以已知錯誤訊息開頭、只取末行**;同理 execCli 重試時多次嘗試的輸出**累積在同一份** stdout,只有最後一次嘗試決定分類(stream-json 取最後一個 `init` 之後);③**一律歸類的捷徑會推翻舊行為**:`fetch` 例外一律歸 `network` 令「金鑰含換行」(須換把)變成整組跳過、有效金鑰永遠不試——改為有 `cause.code`＝network、標頭非法＝key-invalid、其餘＝other(維持既有);④**新增的旁路請求要共用同一個期限**:交叉確認原本重新拿完整 timeout,突破遞補層 `budgetMs` 契約——扣掉 CLI 已耗時並併入 `durationMs`;⑤**新 helper 的錯誤處理本身也要防禦**:探測的 catch 內用 `get(err,'name')` 遇拋錯 getter 會 reject——一律 `errField`／`errMsg`＋最後防線;⑥**兩條路對稱**:REST 的月花費上限 429 因原始 `code===429` 提前冷卻條目,CLI 路徑不會——有 `failureKind` 者只認 `rate-limit`;⑦**測試要隔離證據來源**:純分類器測過 `error_code`,轉接器是否接線須另以「訊息 opaque、只有 error_code」案例驗(假伺服器新增 `err-spend-cap-opaque-429`);變異驗證當初的 `lastResult = dead` 變異存活,即因為所有測試的情境讓「新舊 lastResult 恰好相同」.
- **第二輪外審(同一審查者,針對修正)九條,七條屬實並已修**,教訓:①**修正本身要被再審**——「stdout 無證據時才取 stderr」漏算了「只有結構化欄位(HTTP 狀態、assistant.error)而無文字」也是證據,stderr 的 `Prompt is too long` 字樣因優先序較高而蓋過 429;②**不要用「累積串流」判定「最後一次嘗試」**:`execCli` 失敗結果的 `stdout`／`stderr` 本來就只屬最後一次嘗試(每次嘗試各自累積、只留前 500／1000 字元),`onStdout` 才是跨嘗試累積;所以未被截斷時直接用結果的 stdout,被截斷(長輸出)才改用累積尾段(靠 stream-json 的 `init` 分段),別靠「輸出有換行」這個沒保證的格式;③**新增的前置檢查也受「呼叫端物件只讀一次」契約約束**:範圍檢查讀 `env.ANTHROPIC_BASE_URL` 多執行了一次 getter——改用屬性描述子判讀(存取子保守視為範圍外);④**「不共享」與「不累計」是兩件事**:`headers` 覆寫認證時雖已不共享略過,失敗仍被算在 `keys[]` 每一把頭上而報出 `QUOTA_EXHAUSTED`——要另設「keys[] 即實際認證」旗標(`trusted`),與「官方端點」(`scoped`)分開;⑤**提前返回的路徑要和主路徑一樣彙總**(脈絡過長提前返回遺失先前已確認的 `quotaExhausted`);⑥**測試的標題與實際案例要一致**(標題寫 `x-api-key／authorization` 卻只測前者,且覆寫值恰為 `keys[0]` 而抓不到錯誤累計)——凍結 state 的防線同理,要有真的凍結案例才算被守住.
- **未驗證(待主控實測)**:真實 CLI 額度不足時之實際輸出與離開碼(假設非零;若為 0 則 `execCli` 回 `ok: true`,本套件不會把它當失敗,屬既有行為)、`max_tokens: 1` 於 `claude-haiku-5-5`(自適應思考)之接受度、「credit balance is too low」之真實 HTTP 碼與 `error.type`、真實 `prompt is too long` 逐字格式.實測腳本 `agent-out/dispatch-run01-evidence/dispatch-run01-real-check.mjs`.
