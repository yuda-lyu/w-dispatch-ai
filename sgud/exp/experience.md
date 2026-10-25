# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## Windows 上各種「執行檔無法執行」之實際錯誤碼(2026-10-14 實測,node v24.19.0、Windows 11、wsemi 1.9.15)

| 情形 | node 之回報 | 同步/非同步 | execCli 結果 |
| --- | --- | --- | --- |
| 名稱不在 PATH、絕對路徑不存在(.exe 或無副檔名) | ENOENT | 非同步 'error' 事件 | code null、pid undefined、attempts 1 |
| 路徑是資料夾 | ENOENT(不是 EACCES) | 非同步 | 同上 |
| cwd 不存在 | ENOENT,訊息卻是「spawn <執行檔> ENOENT」(誤指執行檔);**wsemi 1.9.16 起訊息為 `ENOENT: cwd is not an existing folder: <cwd>`** | 非同步 | 同上 |
| 內容非 PE 之 .exe | UNKNOWN | 同步拋錯 | 1.9.15 起回結果物件,同上;1.9.12 會 reject |
| 零位元組 .exe、.ps1 | **EFTYPE**(易漏) | 同步 | 同上 |
| icacls 拒絕 X／R／RX／RD／F | 一律 EPERM(Windows 上重現不出 EACCES) | 同步 | 同上 |
| 命令列超過 32767 字元(含轉義膨脹) | ENAMETOOLONG | 同步 | 同上 |
| 參數或環境變數含空字元 | ERR_INVALID_ARG_VALUE(訊息尾段「. Received 值」會帶出內容;wsemi 1.9.15 已去除) | 同步 | 同上 |
| 不存在之 .cmd 絕對路徑(經 wsemi) | 1.9.15:走 cmd.exe 退路:離開碼 1、stderr 為 Big5 經 UTF-8 解碼之亂碼、會被重試;**1.9.16 起(絕對、相對、只給檔名、.bat 皆然)為 `ENOENT: spawn <路徑> ENOENT`、不重試** | — | 1.9.15:code 1、pid 有值 → exec;1.9.16:code null、pid 鍵 undefined → spawn |
| npm shim 形狀之 .cmd 存在而入口缺失(經 wsemi) | 1.9.16:仍走 cmd.exe 退路,node 報 Cannot find module、離開碼 1、**依 maxRetries 重試**;**1.9.17 起為 `ENOENT: spawn <入口> ENOENT`(`<入口>` 為 shim 指向之 JS 入口,非 .cmd 本身)、不重試**(2026-10-16 實測四家轉接器、getQuotaCodex、getQuotaAntigravity) | — | 1.9.16:code 1、pid 有值 → exec(attempts 隨 maxRetries,實測 3);1.9.17:code null、pid 鍵 undefined、attempts 1 → spawn;遞補層由 `next-key`／`exec` 變 `skip-group`／`spawn`;quota 由 `exit` 變 `notfound` |
| env 物件之 getter 拋錯(wsemi 1.9.16) | claude/codex/antigravity:`UNKNOWN: <訊息>` 結果物件;opencode 自行展開 env 故仍 reject;**本套件 1.0.49 起於啟動前以 `readCallerObj` 物化,四家一律 `params`(`env is not readable: …`、attempts 0),不到達 wsemi** | 同步 | wsemi 直呼:code null、pid undefined → spawn;env 為已撤銷 Proxy 時 wsemi 1.9.16 直呼仍 reject(`execCli.mjs:485-486`);**1.9.17 起兩者皆回結果物件(`UNKNOWN: <訊息>`、code null、pid 鍵 undefined、attempts 1)**,本層前置判讀仍須保留,否則被誤歸 spawn(實測:移除後 4 案轉紅,見帳本 R-SPAWN-3) |
| 直接 `spawn('<不存在>.cmd')`(不經 wsemi) | EINVAL(node 對 .cmd/.bat 之 CVE-2024-27980 防護) | 同步 | — |
| 4 萬字元之環境變數值 | 可正常啟動(故金鑰過長不會造成 spawn 失敗) | — | 成功 |

教訓:「無法啟動」之錯誤碼隨平台與成因而異,列舉必漏(建議書所列清單即漏 EFTYPE);判定一律用結構(execCli 結果之 code 為 null 且 pid 為 undefined)。

## 比對依賴之新舊版行為:用模組解析掛鉤,不動 repo

- `npm pack wsemi@<舊版> --pack-destination ./tmp/<案名>` 後 `tar -xzf … -C …` 解開;寫一支 `register()` 之 resolve hook,把 `wsemi/src/execCli.mjs` 等指定 specifier 導向舊版副本;以 `node --import ./tmp/<案名>/hook-old.mjs <探測腳本>` 執行。舊版副本內之相對 import 自然走舊版,其外部依賴(lodash-es、tree-kill)沿目錄上溯取 repo 之 node_modules。
- 探測腳本先自證版本(如檢查 `execCli.toString()` 是否含新版才有之識別字),避免掛鉤未生效而誤判。
- 審計時之「提議修正」放 `./tmp/<案名>/proto/{src,test}` 副本,`npx mocha --parallel "tmp/<案名>/proto/test/*.test.mjs" --timeout 180000` 驗綠;再把同一份新測試搭現行 src 跑一次驗紅(紅轉綠才算重現測試)。fakeCliForTest 之夾具落點由檔案位置衍生,副本內自會落在副本之 test/tmp。

## 本套件之遞補與錯誤型別

- `getErrorType` 與 `dispatchAiFallback.isKeyIndependentFail` 原為兩份各自手寫之字樣規則,已不同步(ENAMETOOLONG 在前者為 spawn、在後者不跳組);同類規則要收斂成單一來源,遞補層消費 errorType。
- claude／codex／antigravity 條目通常無金鑰(nk=0),整組跳過與換下一把只差事件型別;實際「逐把空耗」只發生在多金鑰之 opencode 與 REST 條目——評估遞補缺陷之代價時先看金鑰數。
- REST 之 fetch 錯誤不可一律跳組:金鑰含換行等非法標頭字元時,錯誤發生在送出前且只與該把金鑰有關(實測次把成功)。
- 自訂 validate 在 CLI 類原交給 wsemi execCli 於 close 事件內呼叫,拋錯會變成未捕捉例外(行程崩潰);REST 類有 safeValidate。寫測試時 mocha 會把它報成「Uncaught Error」並歸到當前測試。**2026-10-16(1.0.49)起 CLI 類之 validate 改由 `runExecCli` 自判(不交 wsemi),REST 類改用 `safeValidateAsync`,兩者皆經 `src/callUserFn.mjs`(帳本 R-USERFN-2)**。
- 下游 w-knowledge-extract(`src/ai/providerHealth.mjs`)消費 `errorType` 與 `group-exhausted`:只排除 `params`;逐次事件 `next-key`／`skip-group` 會累計 `fail[型別]` 與 params 之 `mismatch`,遞補分流改變會改變這些數字。
- 結構判定「code 為 null 且 pid 為 undefined」必須再加「帶自有 pid 鍵」:REST 結果與 `getErrorResult` 物件也是 code null 且無 pid,否則會被誤判為 spawn(獨立複審 R12 抓到;execCli 兩條失敗路徑皆明給 pid 鍵)。
- undici 對非法標頭值之例外訊息會原文引用整個標頭值(`Headers.append: "Bearer <金鑰>" is an invalid header value.`),且無 cause.code;REST 轉接器以 `cause.code || err.message` 組錯誤字串時即把金鑰帶進 tried、事件與日誌。遮蔽一律走 `src/redactText.mjs`(1.0.48 已實作:`redactText` + `secretHeaderValues`,REST 三家與 fetchQuotaJson 共用)。
- 「呼叫無法開始」不只發生在 spawn:轉接器組參數(opencode 之 `JSON.stringify(config)`)、呼叫端回調(validate、onStdout)、工作流組 prompt(runRolePipeline／runFanout 之 prompt 函式、null 名額)都會讓呼叫在送出前就失敗;盤點時把「失敗發生點」當成一軸逐一列,不要只看 execCli 內部(初版漏此軸,複審補出 4 個成員)。

## 審計流程之經驗(2026-10-14 run01)

- 獨立複審值得做:自審自認完整之 251 格矩陣,交子代理(opus,能自行讀檔與實跑,prompt 明定「先挑戰表之完整性、再審對標與對稱、最後才審方案」)後又找出 16 項(含金鑰外洩與 3 種 reject),逐項開檔核對後 14 項全採。派工前先寫好表與證據檔,子代理才有東西可挑戰。
- 本 session 為主控以 `claude -p --output-format json` 派發(print 模式):結束本輪即輸出結果並退出,背景子代理會被一併結束。等待背景子代理改以前景、有上限出口之檢查迴圈(`node ./tmp/<案名>/wait-file.mjs <檔> 540`,單次 ≤ 540 秒)在本輪內等待;先以行程命令列確認模式(`Get-CimInstance Win32_Process` 篩 session id)。
- 假 CLI 要「卡住不結束」時,單寫 `await new Promise(() => {})` 不夠——事件迴圈沒有計時器時 node 立即以離開碼 13 結束;須另掛 `setInterval(() => {}, 1000)`。
- 以 Bash 之雙引號包 `node -e` 改檔時,內文之反引號會被 shell 當成指令替換而靜默吞掉(產生缺字之檔案);含反引號之改檔一律用 Edit 工具。另:交給 node 之路徑一律用 `C:/…` 形式,Git Bash 之 `/c/…` 會被 node 解讀為 `C:\c\…`。
- 實體檢查腳本(自交付文件抽 `檔案:行號` 並印出所引行)能抓到「行號指到 `}`」這類偏移;抓到一例後依同類判準(所引首行為收尾符號)全文掃描。

## 實作流程之經驗(2026-10-14 run02)

- **fetch 之禁用埠不是「連線拒絕」**:node 內建 fetch(undici)依 Fetch 規範之 bad port 清單(1、7、9、…)在連線前即拋 `fetch failed`,`cause.message` 為 `bad port`、**無 `cause.code`**。要測 ECONNREFUSED 須連一個真的沒人監聽之一般埠——本套件用 8651(測試保留段 8650–8699、只連線不監聽)。既有測試 `test/unit-fetchQuotaJson.test.mjs:53`、`test/unit-dispatchApiTypesafeSystemone.test.mjs:144`(埠 9)、`test/unit-dispatchApiOpenaiCompat.test.mjs:150`(埠 1)標題寫連線拒絕/失敗,實為 bad port(斷言只驗類別,仍成立)。
- **不用 stash/checkout 取得修前紅**:`./tmp/<案名>/make-pre.mjs` 以 `git show HEAD:<路徑>` 寫出 HEAD 版 src、再複製現行 test 到 `./tmp/<案名>/run02-pre/`,於其內跑 mocha。注意:測試檔 import 新匯出(如 `isSpawnFail`)時,整檔 import 失敗,mocha 報一條「Uncaught error outside test suite」且**該檔所有測試(含舊的)都不註冊**——計數時「已註冊 = 總數 − 該檔測試數」;要證斷言層也紅,另用 HEAD 版模組直跑同一組案例。
- **測試要守住依賴下限**:移除轉接器自建 try/catch 之前提是 wsemi ≥1.9.15;以 run01 之 resolve hook 跑真測試檔 `node --import ./tmp/<案名>/hook-old.mjs node_modules/mocha/bin/mocha.js test/<檔>`,1.9.12 下 T1/T2 為紅(reject),證明測試能抓到依賴被降版。
- **移除防禦性 catch 後要重跑「它原本吸收的路徑」**:antigravity 之 try/catch 移除後,病態 env(getter 拋錯)由 resolve 變 reject(與另三家一致,屬 wsemi)。靠重跑獨立複審 harness 並逐欄比對新舊輸出才看到;已補記 README 1.0.48 第 17 條之已知例外。不寫「斷言 reject」之測試(那是把缺陷凍結成規格)。
- **README 為 CRLF、src/test 為 LF**:改 README 用 node 腳本(每個錨點斷言恰出現 1 次、新增換行一律 `\r\n`),改後以 node 數位元組驗 CR 數 = LF 數;Git Bash 之 `grep -c $'\r$'` 數 CRLF 不可靠。
- **原型與定稿之比對要去掉易變欄**:比對腳本以 JSON replacer 剔除 `durationMs`、`ms`;複審 harness 有把毫秒嵌在字串內者(`fetch/att3/336ms`),逐欄比對時人工判讀為「只差毫秒」。
- 本環境之權限設定會擋下含 `git stash`、`git tag` 字樣之指令(即使唯讀之 `git stash list`);要證明未 commit 改用 `git log -1` 比對 HEAD。

## 審計流程之經驗(2026-10-14 asyncval run01:注入函數之回傳形態)

- **回呼類問題以「站點 × 回傳形態」逐格子行程實測**:`tmp/asyncval-20261014/cell.mjs`(一格一子行程,guard 模式掛 unhandledRejection 記錄、有記錄者再以 raw 模式(不掛)取離開碼;6 秒看門狗＋keep-alive 計時器判永不落定)＋`run-matrix.mjs`(並行 6、各用一埠)＋`gen-matrix.mjs`(由實測 JSON 與應然規則產表並核對原型)。390 格約 4 分鐘;應然規則寫成函數,原型改完重跑即得「原型符合 N/390」。
- **回傳形態要含惡意拋出值與 thenable**:已撤銷 Proxy 會讓 catch 內之 `get(err,'message')`/`String(err)` 再拋(REST 與 prompt 因而 reject);then 會拋錯之自訂 thenable、晚於上限才 reject 之 Promise 都要列。
- **mocha `--parallel` 之假綠**:測試期間之未處理 rejection 若交 mocha,mocha 先判該測試失敗、測試之斷言再判一次 → `ERR_MOCHA_MULTIPLE_DONE`,多檔並行時主行程**不印摘要且離開碼 0**(單檔或 `--no-parallel` 正常)。修前紅之測試要自行收集 rejection(暫移既有監聽、finally 復原,見原型 `test/tools/userFnFormsForTest.mjs` 之 `captureUnhandled`);判讀 mocha 結果一律確認摘要行存在。
- **改「內部」匯出前先查下游深層匯入**:w-knowledge-extract 以 `w-dispatch-ai/src/checkTruncation.mjs` 之 `safeValidate(ev, s).pass` 同步取用;改 async 會使其條目驗證恆失敗。改簽章前以子代理掃 C:\opensrc 全部 repo 與技能根(`rg --hidden --no-ignore` 補查),相容則新增函數而不改舊者。
- **以 git archive 取依賴舊版做降版守門**:`git -C <wsemi repo> archive <舊版commit> src | tar -x -C ./tmp/<案名>/w15` 後以 resolve hook 導向,證明新增之依賴下限測試在舊版為紅(不必 npm pack)。

## 實作流程之經驗(2026-10-16 asyncval run03)

- **修前紅不必另建副本即可先跑一次**:測試先搬入 `test/`、src 尚未動時直接 `npm test`(經 quiet-run)即為「新測試配現行 src」;之後要補驗新增之案例,以 `git archive HEAD src | tar -x -C ./tmp/<案名>/run03-pre` 取 HEAD 之 src、複製 `test/` 過去,單檔跑 mocha(`-g` 篩案例)。
- **以 Bash 之 `node -e "…"` 改檔時,內文之反引號與 `${}` 仍會被 shell 吃掉**(本次踩了三次:①模板字串被替換成空白,產生語法錯誤之 `{ ok:  }`;②③反引號內之檔名被 bash 當指令執行——src 檔、log 檔、JSON 檔被當腳本跑(皆於第 1 行語法錯誤而止,未造成損害)、`git status` 被執行)。**含反引號之內容一律用 Edit／Write,或把改檔腳本寫成 `.mjs` 檔再 `node <檔>` 執行**;不要心存「這次只有一兩個反引號」之僥倖。
- **下游相容驗證(不改下游 repo)**:複製下游之 `src`、`test`、`package.json` 至 `./tmp/wke-copy`,以 `fs.symlinkSync(<下游 node_modules>, <副本>/node_modules, 'junction')` 掛相依(cmd 之 `mklink /J` 遇中文路徑會亂碼失敗);以 resolve hook 把 `w-dispatch-ai/<路徑>` 導向本 repo,`NODE_OPTIONS="--import=<hook 之 file URL>"` 令 mocha `--parallel` 之 worker 一併生效;hook 每次導向寫一行 marker 檔,以「導向筆數與 PID 數」證明生效(本次 110 筆、7 個行程)。基準同指令不掛 hook。**用完立刻以 `fs.unlinkSync` 移除 junction 並驗目標仍在**——留著的 junction 會讓日後 `rm -rf tmp/` 有穿透刪除下游 node_modules 之風險。
- **釘住「自上游複製之公式」之測試**:以上游函數原生跑同一情境、與本層逐欄比對(鍵集合、截斷後之 stdout／stderr、code、error、attempts),重試間隔則由子進程把啟動時刻寫檔、比較相鄰間隔(兩者相差 <400ms 且不短於公式值);上游改公式或形狀即紅。降版(wsemi 1.9.15)時此案亦紅(1.9.15 之 execCli 不承接同步拋錯之 validate)——屬預期。**但該次未捕捉例外使測試之 finally 未執行,殘留之時刻檔令下一次全套跑出假紅**(多一行時刻);寫檔型測試一律「開頭先清空自己的暫存夾、夾名帶 pid」。

## agy(Antigravity)非成功結局、額度結構與逾時(2026-10-16 Argon 審計 run01/run02)

- **agy 1.4.0 的非成功結局多為 exit 0**:自身 `--print-timeout` 到時(`[agy] print timeout after Ns with turn in progress; returning partial output`,stdout 為部分輸出、可能為空)、權限閘門擋下(stdout 空、stderr `jetski: no output produced — …`)皆 `ok:true`;只有未知模型是 exit 1(`error: invalid model selection`)。驗遞補層逾時路徑時,假 CLI 必須理會 `--print-timeout` 且 `timeoutMs`>30s,否則會誤得「冷卻有效」(「卡住」假 CLI 配 `timeoutMs` ≤30s 恰落在外層先殺之唯一區間)。真 agy 實證:`timeoutMs: 8000`、長輸出提示詞 → `TIMEOUT after 8s`、`skip-group/timeout`、已冷卻,`tasklist` 無殘留 agy 行程。
- **描述行為變更時,受影響區間要用會理會旗標的假 CLI 實跑出來,不能只推論**:我寫的行為變更紀錄把受影響區間寫反(原寫「耗時介於 T−30 與 T 者改為 TIMEOUT」,實為「介於舊內層截止點與 T 者由截斷改為完整成功;達 T 者由部分輸出 ok:true 改為 TIMEOUT」),opus 與 sol 兩位外審各自獨立抓到。測試用 T=40000 的假 agy:自然 35 秒者修前於 30 秒截斷(stdout 止於 `29`)、修後完整;自然 50 秒者修前 ok:true、修後 TIMEOUT(約 40 秒的慢測試,列入 `unit-agyFailShapes`)。
- **推導出來給外部 CLI 的數值要封頂到它能解析的範圍**:agy 拒收超出 Go duration 範圍之 `--print-timeout`(`9007199254770s`、`9223372037s` → exit 2 `invalid duration`;`2147513s` 正常);execCli 計時器上限 2147483647 ms,推導同樣封頂。新公式把原可解析之 `timeoutMs≈9.223e12` 推過邊界(sol F01),這種「加常數」的改動要掃兩端邊界。
- **`/usage` 讀數閒置時會在兩個值之間跳動**(同帳號 50 秒內:gemini-weekly 0.93→0.07→0.93、Argon 3.91→3.39→3.91;幅度可達 0.5~0.9 個百分點,先前以為 ±0.2),且未動用窗口之 `reset_time`=查詢時刻+窗口(隨查詢漂移)、已動用者固定。耗用量只可作量級參考;Argon 與 Gemini 群組額度池互相獨立(4 次呼叫前後對照),但**額度池獨立不等於故障域獨立**(CLI、登入、網路共用)。`/quota` 為 `/usage` 別名;`agy models` 無 JSON、需 `< /dev/null`;未給 `--model` 時預設 Gemini 4 Argon (Medium);基礎 slug(`gemini-4-argon`+`effort`)可生成。
- **非有限數:`isnum`/`cdbl`(= `toFinite`)組合會把 `Infinity`/`'1e400'` 換成 `MAX_VALUE`,算式再溢位成 `-Infinity`,夾值後假造成 100%**;十進位以外之字串(`'0x10'`、`'0o7'`、`'0b1'`)經 `Number` 也被當成數值。判有限一律用原值 `Number(v)`,字串另驗十進位;越界值先夾到 [0,1] 再換算,免極大值溢位使結果與 1.7 不一致。共享層 `toQuotaWindow` 亦需同樣判,否則三家對非有限值不一致。
- **格式漂移要以「結構辨識得到與否」判,不要以窗口數判**:`buckets` 全為空陣列(結構完整)與 `groups:[]` 同屬「agy 未回報限額」,不得誤判 `parse`;parse 結果仍須保留已查得之獨立資料(`withCredits`)——早退路徑容易丟掉先前步驟的結果。
- **外審流程**:prompt 範本與派工腳本參數化(`tmp/<案名>/review/prompt-base.md`、`dispatch-review.mjs <opus|sol|muse>`);opus 的 `--allowedTools Read,Glob,Grep,Write,Bash --setting-sources project`、sol 的 `workspace-write`+讀檔用 `rg -n '^' -- <檔>`、muse 的 `useStoredAuth:false`+`config.permission {edit:'allow', bash:'ask'}`(bash 不可 deny,否則觸發免費層閘門 403);派工前後以 `manifest.mjs` 對 src/test/README/package/帳本/toolg 雜湊比對,偵測審查者是否改動既有檔。Git Bash 前景 `sleep` 被擋,但前景 `until [ 條件 ] || [ $SECONDS -gt N ]; do sleep 10; done`(單次 ≤540 秒)可用;Monitor 上限約 10 分鐘且需重掛。
- 修前紅的取得:規則→測試→(src 未動)直接 `npm test` 即得修前紅;需 HEAD 對照時 `git archive HEAD src | tar -x -C ./tmp/<案名>/pre` 配新測試單檔跑 mocha。慢測試(約 40 秒)與全套 `--parallel` 並行,全套 wall 時間仍約 46 秒。
- 流程自省:①曾因 `cd ./tmp/…` 污染後續相對路徑(第一次審計),一律絕對路徑;②「已證」只標在已存在的產物上;③下游搜尋工具失敗(`timeout rg` 因 `rg` 是 shell 函式而無輸出)要檢查 stderr 檔,不可把空結果當無用法。

## wsemi 1.9.17 連動(2026-10-16 第47項 run03)

- **「只在某平台才成立」的情境用夾具回傳空字串來守門**:npm shim 解析是 Windows 專有(POSIX 的 sh 啟動器不經 `parseJsEntryFromCmd`),故 `createUnstartableExe` 回 `shimNoEntryExe`(POSIX 為 `''`),各列舉測試以 `!== ''` 才納入;`spawnFailCases` 同。不在測試內寫 `process.platform` 分支散落各處。
- **取舊版 wsemi 做修前紅,`npm pack wsemi@<版> --pack-destination ./tmp/<案名>` 最省事**(免找 wsemi repo 之 commit):`tar -xzf <tgz> -C ./tmp/<案名>/w16 package/src package/package.json`,resolve hook 導向 `w16/package/src`(`execCli`、`execCliJsonRpc` 兩個 specifier 足矣,其餘相對 import 自走舊版副本)。實測 1.9.16 下新增 7 案恰紅、其餘 126 案綠。
- **「建議保留」類結論要用 mutation 實證**:對 `runExecCli` 之 env 前置判讀,於 `./tmp` 副本把它改成直通,跑現有 env 測試,紅 4 案(3 家轉接器 + `unit-userFnValidate` 表);即現有測試已釘住,不需新增測試。副本放 `./tmp/<案名>/mut/{src,test}`(test 須含 `test/tools`),從 repo 根跑 mocha 即可解析 node_modules。
- 探測腳本放 `./tmp/<案名>/probe*.mjs`,用相對 import 指到 `../../src`,同一支腳本以 `node --import hook` 切換 wsemi 版本,同欄位並排對照(`errorType`、`code`、`attempts`、有無 pid 鍵、`isSpawnFail`)。

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
