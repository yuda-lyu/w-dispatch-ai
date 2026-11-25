# 規則帳本(類型:R-REDACT 變異驗證紀錄)

> 自 `rulebook_redact.md` 抽出(2026-11-25 t628 依全域 sgud 規則整理:`rulebook_redact.md` 逾約 30KB 門檻,過長即依類型拆檔;節號與標題不變,不刪內容,只搬移).本檔收:「R-REDACT 變異驗證」(2026-11-24 tdai4＋tdai4b 合併,116 項)與「R-REDACT-4 變異驗證」(2026-11-25 t628,47 項)兩節之變異表.主檔索引見 `sgud/rule/rulebook.md`.

### R-REDACT 變異驗證(2026-11-24 tdai4＋tdai4b 合併,最終版;鏡像根逐項單點變異,各跑指定測試檔 `--bail`;116 項:108 殺死、8 項等價)

| 範圍 | 變異(每項一處) | 結果 |
|---|---|---|
| 入口 `redactText.mjs` R01～R19(19 項) | 長度下限 6→1／6→7;精確家族漏 `credPatterns:false`;診斷家族漏樣式集／關內建憑證樣式;串流恆精確／恆診斷;非串流漏 flush／改用 `maskDiagText`(截斷)／不轉字串／`secretList` 不濾非字串、不驗陣列;`{4,}`→`{1,}`;樣式帶 `g`;三個入口各改用另一家族;改回自寫 `split/join('[REDACTED]')`;串流不套長度下限 | 全殺死 |
| 金鑰樣式集 P01～P08(8 項) | 診斷家族退回只有 `sk-ant-`;樣式集漏 `wrk_`／`AIza`／`sk-`／GitHub 權杖／JWT;`maskApiKeys` 退回只有 `sk-ant-`;`failureDiag` 自寫樣式集 | 全殺死 |
| `redactResult`／`maskStreamCallbacks` S01～S12(12 項) | 成功 stdout 改診斷家族／失敗 stdout 改精確家族;stderr 改精確家族;`error` 不遮蔽;errorDetail 最後防線移除(S05);兩路家族對調;不包 onStdout／onStderr;flush 未轉交／空字串也轉交;機密值清單被忽略;補送迴圈不呼叫 | 11 殺死;**S05 等價**(`errorDetail` 於 `runExecCli` 已經 `failureDiag.maskDiag` 遮蔽〔同機密值、樣式集、內建憑證樣式〕,上層再遮為冪等之最後防線,無輸入可區分) |
| `dispatchClaude` D04～D05、C01～C08(10 項) | `failureDetail`／params 訊息不遮蔽;(c)只給 `opt.env` 金鑰時回調／結果不遮蔽;結束不補送;機密值清單為空;完全不包(改回自寫);只遮 env 第一個相符名稱;`diagSecrets` 為空(C08) | 9 殺死;**C08 等價**(`diagSecrets` 為下層遮蔽 `errorDetail`／`error`,上層 `redactResult` 以同一清單再遮,互為備援而無輸入可區分,同 S05) |
| `dispatchOpencode` O01～O10、X01～X02、X08(13 項) | (b)完全不遮蔽／不取 env 內之 auth 內容／不收 key 參數(O03)／結束不補送／結果不遮蔽／回調不遮蔽／不取繼承之環境值／明示 `undefined` 移除仍取／結果清單為空／走訪略過屬性名 `type` 之子樹(O10)／`failureDetail` 等之 `secrets` 只含 key(X01)／`diagSecrets` 只含 key(X02)／收過短字串(X08) | 11 殺死;**O03、X02 等價**(O03:`key` 與 `provider` 皆給時注入之 auth 內容已含 key,解析即得,`key` 參數為冗餘之備援;X02:同 C08 之 `diagSecrets` 備援) |
| REST 三家 A-compat／resp／sys1-1～9、A-compat-10、A-resp-10、A-resp-11、X03～X04、X09(33 項) | 錯誤路徑 `red` 改為不遮蔽;遮蔽集合漏 key 本身;params 訊息／非 JSON 診斷／validate 例外訊息／validate 失敗 stdout／HTTP 錯誤本體／fetch 例外訊息不遮蔽;`callOnce` 未傳機密值清單;截斷未放行 stdout／非 completed stderr／`INCOMPLETE_RESPONSE` error／截斷裁定 error／`modelResolved` 不遮蔽 | 29 殺死;**A-compat／resp／sys1-2(遮蔽集合漏 key 本身,3 項)與 X09 等價**:key 恆以 `Authorization: Bearer <key>` 送出,`secretList` 展開 `Bearer ` 前綴變體後即 key 本身,「另加 key」為冗餘之備援;X09:compat 之截斷裁定 label 只含 `length`／`content_filter`,不含伺服器自由文字 |
| 機密值變體與標頭 X05～X07(3 項) | 不展開變體／漏去 Bearer 前綴／非憑證標頭名單退回兩項 | 全殺死 |
| 既有站點 A01～A07(api-anthropic)、Q01～Q07(探測、額度查詢)、L01～L02、G01～G02(18 項) | 錯誤路徑漏樣式／不遮蔽;成功 stdout 不遮蔽或改診斷家族;探測四處、額度查詢三處、日誌兩處、Go 用量最後防線(不遮蔽／改回自寫) | 全殺死 |

修前紅:tdai4——`git archive HEAD` 之 `src` 疊上本輪全部測試,47 項失敗;tdai4b——tdai4 完成後之 `src` 快照疊上本輪新測試(四個可載入之測試檔),26 項失敗(三家 REST 17、`dispatchOpencode` 6、`dispatchClaude` env-only 與樣式集 2、日誌 1),另 `unit-redactText`／`unit-redactSites` 因快照無 `DIAG_PATTERNS` 匯出而載入即失敗;修後綠與全套見 `sgud/state/state_general.md`。

### R-REDACT-4 變異驗證(2026-11-25 t628;鏡像根逐項單點變異,各跑指定測試檔 `--bail`;47 項:45 殺死、2 等價)

| 範圍 | 變異(每項一處) | 結果 |
|---|---|---|
| `redactDeep` D01～D09(9 項) | 不遮屬性名／字串值;家族恆精確／恆診斷;過深子樹原樣放行／深度上限 64→1000／序列化失敗原樣放行;以賦值建屬性(`__proto__` 改動原型);陣列當物件走訪 | 全殺死(D09 首輪存活〔無不可序列化之深層輸入〕,補含 BigInt 之深層案後殺死) |
| compat C01～C08(8 項) | 成功 `stdout` 兩處〔一般、`acceptTruncated` 放行〕不遮;`usage` 不遮;`finishReason` 不遮／先正規化後遮;成功 `stdout` 誤用診斷家族;`usage` 誤用精確家族;遮蔽集合漏 key 本身(C08) | 7 殺死;**C08 等價**(同 R-REDACT-3 之 A-*-2:key 恆以 `Authorization: Bearer <key>` 送出,`secretList` 展開去 `Bearer ` 前綴之變體即 key 本身,「另加 key」為冗餘備援) |
| responses S01～S07(7 項) | 同 compat(`finishReason` 為 `finishOf(redS(…))` 與先正規化後遮之對照) | 全殺死 |
| typesafe T01～T06(6 項) | `answers` 不遮;`stdout` 由未遮之 `answers` 序列化;`usage` 不遮;`answers` 誤用診斷家族;`usage` 誤用精確家族;`stdout` 改對序列化文字再遮(`answers` 不遮) | 全殺死 |
| anthropic A01～A04(4 項) | `usage` 不遮;`finishReason` 不遮／先正規化後遮／只遮原值不再遮(A04,L2) | 全殺死(A03 首輪存活:測試金鑰屬 `sk-ant-` 樣式,診斷家族之樣式集於錯誤順序下仍遮到小寫殘段;改用不屬任何樣式之金鑰後殺死) |
| 獨立複審後之修正 J01～J06(6 項) | `secretList` 不展開 JSON 跳脫形(L1);compat／responses 之 `finishReason` 只遮原值、正規化後不再遮(L2);`secretHeaderValues` 登錄值為 `undefined`／`null` 之標頭值(M1);`redactDeep` 不包 `try/catch`／失敗時原樣放行(C3) | 全殺死 |
| `dispatchClaude` K01～K07(7 項) | 不收繼承值;不看 `opt.env` 是否已含該名稱(`undefined` 明示移除者仍收);漏長度下限(短繼承值亦包回調);繼承值併入 `ckKey`(參與失敗分類);`opt.key` 有效時亦收繼承值;取錯變數名;非字串檢查換為真值檢查(K07) | 6 殺死;**K07 等價**(`process.env` 之值恆為字串,`isestr(v)` 與 `v &&` 對任何環境變數值結果相同) |

修前紅:以本輪開始前之 `src`(`git archive HEAD`,須以 `core.autocrlf=false` 取出為 LF:預設之 `core.autocrlf=true` 使匯出檔為 CRLF,令 `unit-redactSites` S1 之逐列去註解失配而假紅)疊上本輪全部測試(9 檔,276 案)——**238 passing／38 failing**:`unit-dispatchApiRestRedact` 57 案中 30 紅(S12／S13／S14／S15／S17 各 3、S19～S22 各 1、S23／S24／S25 各 3、S26、S27;其餘 27 為原 21 案與保持案 S16×3、S18×3)、`unit-dispatchClaudeKey` R09 6 案中 5 紅(長度不足 6／無變數之保持案 1)、`unit-dispatchApiAnthropic` 2 紅(`echo-meta`、`echo-meta-upper`)、`unit-redactSites` S5 紅、`unit-redactText` 因該版無 `redactDeep` 匯出而載入即失敗;改讀取證通道之 12 案於該版皆綠(其斷言不依賴回聲)。另遮蔽改動後原測試轉紅 10 案(9 案取證通道、1 案 `redactSites` S1 字面值)見「既有測試之調整」。逐案追溯與全套結果見 `sgud/state/state_general.md`。
