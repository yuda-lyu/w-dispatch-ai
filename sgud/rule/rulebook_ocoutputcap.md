# 規則帳本(類型:OpenCode 單次回應輸出上限(OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX)與截斷偵測(Gitea #78))

> 自 `rulebook_opencodego.md` 抽出(2026-11-25 t628 依全域 sgud 規則整理:`rulebook_opencodego.md` 逾約 30KB 門檻,過長即依類型拆檔;節號與標題不變,不刪內容,只搬移).本檔收:R-OCGO-4(單次回應輸出上限與截斷偵測).主檔索引見 `sgud/rule/rulebook.md`.

## R-OCGO-4 單次回應輸出上限(`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`)與截斷偵測(Gitea #78,2026-11-04 da78)

> 來源:issue #78(提出端使用端;自述「Go 單次回應 reasoning＋output 合計上限 32,000 token,建議 `ocgo:` 五條推理模型改 `--variant low`,並把診斷法寫進檔頭;未查證 32,000 是閘道還是 CLI 端」).**issue 只作參考**,以下事實皆為本機實測(opencode 1.19.5;證據夾 `agent-out/da78-evidence/`;不印金鑰).標記:〔假服務〕＝自建 127.0.0.1 OpenAI 相容服務攔截 CLI 實送之請求(不花額度,`test/api-opencodeOutputCap.test.mjs` 可重跑);〔Go實測〕＝以已訂閱 Go 之本機金鑰實呼(共 6 次;opencode 事件之 `cost` 欄合計約 US$0.14;Go 用量 rolling 3%→4%、weekly 39%、monthly 19%〔整數百分比,他人同時使用亦會混入,不作歸因〕).

**提案主張對照**

| 提案主張 | 判定 | 證據 |
|---|---|---|
| 失敗者 `finish=length`,reasoning＋output 恰 32,000,stdout 空或截斷,日誌無 ERROR | **成立** | 〔Go實測〕預設上限:glm-5.3-flash 365s、deepseek-v4.1-flash 410s 皆 `finish=length`、reasoning 恰 32000、output 0、`ok:true`、離開碼 0、stdout 空、stderr 無內容(json 模式下 stderr 本無標頭) |
| 32,000 是「OpenCode Go 閘道（或 opencode 端）」上限,與型錄 `limit.output` 無關 | **部分推翻**:是 **opencode CLI 端預設**,**不是閘道**;與型錄 `limit.output` 的關係是取小者 | 〔假服務〕請求之欄位為 `max_tokens`＝`min(型錄 limit.output, 環境變數或 32000)`(13 案見下);〔Go實測〕上限設 3000 → `finish=length`、reasoning 恰 3000(閘道照單全收),設 128000 → 兩模型皆 `finish=stop` |
| 建議一:五條推理模型檔位改 `low` | **不採用**(主控已定:主修法是調高上限,「一律 high」維持) | 同一提示詞、同一檔位 high、只調上限即可完成:glm 32768＋1137 token、deepseek 70358＋964 token |
| 建議二:條目加 `variant` 欄位 | 不需要(覆寫 `extraArgs` 之舊坑與本案無關) | — |
| §3 讀取 session 之 `finish` 回報 `truncated` | **可行,且不必讀內部儲存**:`opencode run --format json` 之 `step_finish` 事件穩定帶 `part.reason`(`length`／`stop`／`tool-calls`)與 `part.tokens`;預設格式下完全不可見 | 〔假服務〕與〔Go實測〕事件皆含;`opencode export <id>` 之 `finish`／`tokens` 與事件逐案相同 |
| 診斷法:session 在 `~/.local/share/opencode/storage/session/` | **過時**:1.19.5 以 `opencode session list --format json`＋`opencode export <id>` 取 | 本機實測二指令可用(隔離 `XDG_DATA_HOME` 下亦然) |

**假服務 13 案(`max_tokens`)**:未設變數:型錄 output 384000→32000、131072→32000、8000→8000;設 64000:384000→64000、8000→8000、131072→64000;設 200000＋型錄 131072→131072;`'abc'`、`'0'`、`'-5'`、`''`、`'64000.5'`→32000(靜默忽略);`'1e5'`→100000.即取小者規則,無效值被 CLI 靜默忽略.

**Go 真實模型前後對照(3 萬字元合成提示詞〔24 站之算術統計,明令不得用工具〕、`--variant high`;opencode 1.19.5)**

| 呼叫 | 上限 | 耗時 | finish | reasoning | output | 備註 |
|---|---|---|---|---|---|---|
| glm-5.3-flash | 預設(32000) | 365s | **length** | 32000 | 0 | stdout 空,`ok:true` |
| glm-5.3-flash | 128000 | 382s | stop | 32768 | 1137 | JSON 24 筆可解析 |
| deepseek-v4.1-flash | 預設(32000) | 410s | **length** | 32000 | 0 | stdout 空,`ok:true` |
| deepseek-v4.1-flash | 128000 | 511s | stop | 70358 | 964 | JSON 24 筆可解析 |
| deepseek-v4.1-flash | 3000 | 45s | **length** | 3000 | 0 | 證明閘道照單全收 CLI 的 `max_tokens` |
| deepseek-v4.1-flash(首呼叫) | 3000 | 12s | tool-calls | 281 | 38 | 模型改叫 bash 被唯讀鎖自動拒絕而結束;提示詞補「禁用工具」後重跑上列 3000 案(計入 6 次) |

**規則**:①**根因**＝CLI 端預設輸出上限;②`dispatchOpencode` 預設注入 `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=128000`(取值依據:deepseek 實測最大量 71322 token 之 1.8 倍;實際上限仍取型錄 `limit.output` 較小者);`opt.outputTokenMax` 可覆寫;優先序＝opt 有效值 ＞ 呼叫端環境(`opt.env`〔Windows 不分大小寫〕、本行程 `process.env`)已設有效值〔保留不改〕 ＞ 套件預設;**(2026-11-23 tdai2 改:`opt.outputTokenMax` 給了而無效〔非正整數、`0`、負數、小數、非數字、`''`、`Infinity`、布林、包裝物件〕以 `params` 拒絕、不起子行程,依 dspec §11「影響下單數量或金額之 opt 視同安全相關 opt」,見 R-SAFEOPT-1 規則 11;未給〔`undefined`、`null`〕才依下列取值優先序;環境內之無效值仍視為未給、不報錯〔dspec〈輸入參數之檢測機制〉K3〕)**。修前原文:無效值(非正整數、`0`、負數、小數、非數字、`Infinity`、布林、包裝物件)視為未給、不報錯(dspec〈輸入參數之檢測機制〉K3),環境內之無效值等同 CLI 本就忽略者,以預設覆蓋;給 `32000` 即回修前行為;單一來源 `src/outputTokenMax.mjs`;③**不以降檔位當解法**;④context 262144 級且型錄輸出上限逾 32000 之三條(`oc:flint-40b-free`、`oc:nemotron-3.5-lightning-free`、`ocgo:iceman-contributor-free`)明給 `outputTokenMax: 32000`——伺服器以「輸入＋max_tokens ≤ context」驗請求,上限每調高 N 可用輸入約少 N,這三條註解之輸入上限數字以 32000 預留計;⑤**截斷偵測** `opt.detectTruncation`(預設 `false`):加 `--format json`、`parseOpencodeEvents` 重建 stdout(text 事件去頭尾空白＋EOL;未截斷時與預設路徑逐位元相同)、取**最後一個** `step_finish.part.reason`(`length`／`content_filter` 屬截斷;只認已知事件類型,整串皆未識別〔例如日後改名〕時沿用原輸出、不重建成空回應),`runExecCli` 以 `judgeTruncated`(與 REST 轉接器同規則)於驗證與重試之前裁定:預設失敗 `errorType:'incomplete'`、`truncated:true`、`finishReason`、`tokens`,**不驗證不重試**;`acceptTruncated:true` 放行有可見輸出之 `length`;失敗路徑以 `onStdout` 自行累積事件流全文(`execCli` 失敗時 stdout 只留前 500 字元)還原 stderr 之 `Error: 訊息`;自給 `--format json` 者不改寫 stdout;⑥`dispatchAiFallback` 既有 `truncated===true` 為與金鑰無關之失敗→整組跳過(不逐把換金鑰),`tried[]` 經 `finOf` 帶 `truncated`／`finishReason`,無需改碼;⑦內建 `ocgo:` 8 條 `detectTruncation: true`(`oc:` 不開,行為不變;2026-11-07 曾增為 9 條,2026-11-10 回到 8 條,皆開);⑧文件:`providers.mjs` 檔頭【輸出上限與截斷診斷】、`dispatchOpencode.mjs` 檔頭兩段、`outputTokenMax.mjs`／`parseOpencodeEvents.mjs` 檔頭、README(Options 表三列、行為變更第 64 條、診斷小節、Result 範例).
- **errorType 選用 `'incomplete'` 而非任務書字面之 `'truncated'`**:`getErrorType.mjs` 一覽已有 `incomplete`(REST 截斷同名同欄 `truncated:true`),`dispatchAiFallback` 與呼叫端皆已依 `truncated` 旗標分流;另立 `truncated` 會分裂同一概念(呼叫端須兩種字樣皆認).**待主控裁示**是否仍要字面 `'truncated'`(改動點:`runExecCli.mjs` 一處與測試斷言).
- **`ocgo:` 條目之可觀察變化(須知)**:①argv 多 `--format json`;②stderr 不再含 `> agent · model` 標頭與工具進度行(錯誤仍以 `Error: 訊息` 在 stderr);③stdout 與修前逐位元相同(假服務逐案比對);④修前截斷回 `ok:true`＋空 stdout,修後回 `incomplete` 失敗.
- 已知限制／**未實測**:①minimax-m3.1-flash、qwen3.8-flash、mimo-v2.6-flash、muse-spark-1.3-contributor、beam-free 於 128000 之接受度與耗時(僅 glm、deepseek 實測);②`oc:` 免費池條目調高後之行為(型錄上限內之 `max_tokens` 理應被接受);③耗時:上列 382～511 秒,預設 `timeoutMs` 300000 不夠,呼叫端須自行給足;④`content_filter` 本機以假服務確認 opencode 轉為 error 事件＋離開碼 1(不以 `step_finish` 呈現),故不會被判截斷;⑤`--format json` 之 stdout 重建以**真實 opencode＋假服務**驗證了:純文字、前後空白、多行與中文、被唯讀鎖拒絕之工具呼叫、`length`、錯誤事件(HTTP 400)、`content_filter`——stdout 逐位元相同於預設格式(錯誤案為訊息等價);**多步工具迴圈(工具成功後再回答)與同一回應內多個 text 事件僅以自製假 opencode 依源碼規則驗證,未以真實多步迴圈驗證**(真實 Go 呼叫皆為單步純文字);⑥數字為單一合成提示詞之量級,隨提示詞與模型版本而異;⑦opencode v2 之事件格式未驗證(檔頭「僅驗證 v1」限制仍在).
- 盤點指令:`Grep "outputTokenMax|detectTruncation" src`(站點:`outputTokenMax.mjs`、`dispatchOpencode.mjs`、`providers.mjs`〔8＋3〕、`runExecCli.mjs`、`parseOpencodeEvents.mjs`);`Grep "reshapeResult" src`(僅 `dispatchOpencode.mjs`、`runExecCli.mjs`);重跑攔截:`npx mocha --no-parallel test/api-opencodeOutputCap.test.mjs`.
- 判準:已套＝每個 `dispatchOpencode` 呼叫之子進程環境皆有有效之上限變數(預設／opt／呼叫端),三條 26 萬級 pin 在位,`ocgo:` 8 條(2026-11-07～10 曾為 9 條)`detectTruncation: true`,截斷不驗證不重試;未套＝傳無效值卻原樣交 CLI(靜默 32000)、環境已設有效值被覆蓋、`oc:` 條目誤開偵測、截斷被當成功／重試;刻意不套＝降檔位、`oc:` 條目預設開偵測(行為不變)、REST 轉接器(自帶 `max_tokens`).
- 對應測試:`test/unit-outputTokenMax.test.mjs`(14＋1 pending)、`test/unit-parseOpencodeEvents.test.mjs`(16)、`test/unit-opencodeTruncation.test.mjs`(31;自製假 opencode `test/tools/fakeOpencodeEventsForTest.mjs`,含 fallback 走向)、`test/api-opencodeOutputCap.test.mjs`(真實 opencode＋假 OpenAI 服務,10;環境不足略過;**改動 `outputTokenMax`、`env`、`config` 等相關 opt 之判定時,須以真 PATH〔不移除本機已安裝之 `opencode`〕單獨跑過此檔**:自 PATH 移除真 CLI 之全套會使它整檔 pending 而掩蓋紅燈〔2026-11-23 tdai2c:A2「無效值」案仍釘 1.0.109 之「opt 無效 ⇒ 預設」,tdai2 起 opt 給了而無效為 `params`,於發布閘門才紅;已改寫〕。此檔只把請求打到自建之 `127.0.0.1` 假服務、`useStoredAuth: false`、不花額度)、`test/unit-providersOutputCap.test.mjs`(4)、`test/unit-opencodeOutputCapDocs.test.mjs`(文字守門)、`test/unit-providersOpencodeGoEntries.test.mjs`／`unit-providersOpencodeFreeEntries.test.mjs`(欄位改動).
- 修前紅(HEAD 之 `src` 僅補兩個獨立新模組、搭本輪新測試):`unit-opencodeTruncation` 15 failing／14 passing、`api-opencodeOutputCap` 7／3、`unit-providersOutputCap` 3／1、Go 條目 3／14、免費條目 1／6、文字守門 12／0(passing 者為「不得改變」守門).
- 變異驗證(`tmp/da78/mutate.mjs`,副本上套用,45 個):43 個被抓到、2 個等價變異(M08:`castOutputTokenMax` 之 `iseint` min 與其後 `n > 0` 重複把關;M25:`reshapeResult` 轉傳 `execCli` 無害);涵蓋預設值／優先序／無效值／大小寫(M01～M09)、事件解析(最後 `step_finish`、trim、EOL、session 過濾、連字號、錯誤還原、未知類型,M10～M18、M43～M45)、`runExecCli` 裁定(M19～M25)、`dispatchOpencode` 接縫(`--format json`、預設關、環境注入、累積全文、失敗路徑,M26～M37)、目錄欄位(M38～M41)、遞補整組跳過(M42);首輪存活者 M30（只取最後 session）、M33（失敗結果誤帶 `truncated`）已補測試後 killed.
- 教訓:變異腳本對 CRLF 檔(`providers.mjs`、`README.md`)之多行字串須依檔案實際行尾轉換,否則整批「找到 0 處」成無效變異.
- 指令:`npx mocha --no-parallel test/unit-outputTokenMax.test.mjs test/unit-parseOpencodeEvents.test.mjs test/unit-opencodeTruncation.test.mjs test/api-opencodeOutputCap.test.mjs test/unit-providersOutputCap.test.mjs test/unit-opencodeOutputCapDocs.test.mjs --timeout 180000`(`api-` 需本機有 opencode,首次可能連網安裝 provider 套件).
