# 規則帳本(類型:金鑰型 opt(`key`、`keys`)給了而無效即拒絕(R-KEYOPT-1))

> 自 `rulebook_anthropic.md` 抽出(2026-11-25 t628 依全域 sgud 規則整理:`rulebook_anthropic.md` 逾約 30KB 門檻,過長即依類型拆檔;節號與標題不變,不刪內容,只搬移).本檔收:R-KEYOPT-1(金鑰型 opt 給了而無效即拒絕,不靜默改走另一種計費).主檔索引見 `sgud/rule/rulebook.md`.

### R-KEYOPT-1 金鑰型 opt(`key`、`keys`)給了而無效即拒絕,不靜默改走另一種計費(2026-11-19,wsemi 1.9.69 下游配合;dspec〈輸入參數之檢測機制〉§11)

- 規則(判定單一來源 `src/readKeyOpt.mjs` 之 `readKey`／`readKeys`;訊息只寫型別與個數,不回顯值):
  - **未給(維持現行之登入態／預設認證)**:`key` 為 `undefined`、`null`、`''`;`keys` 為 `undefined`、`null`、`[]`;`keys` 陣列內之 `''`、`null`、`undefined` 元素略過(陣列內全為此類者同 `[]`)。
  - **給了而無效 → `params` 失敗,不起子進程、不送請求、不起用量查詢**:`key` 為非字串(數字、布林、物件、陣列、`String` 包裝物件、函數、symbol、bigint、已撤銷之 Proxy);`keys` 為**非陣列之定義值**(含字串 `'sk-…'`、`''`、數字、物件)、**不可讀之陣列**(已撤銷之 Proxy、內部標籤／`ownKeys`／`length` 拋錯)、或**含「非空且非原始字串」之元素而濾後無有效字串者**(數字、物件、包裝物件、已撤銷之 Proxy 等)。
  - **混合不拒絕**:`keys` 含至少一個有效字串者,無效元素照舊略過(`keyIndex` 依濾後陣列)——與 dai492i 之「包裝金鑰被濾除而原始字串金鑰成交」一致。
  - 站點:`dispatchClaude:415`、`dispatchOpencode:381`、`dispatchApiOpenaiCompat:378`／`dispatchApiOpenaiResponses:428`／`dispatchApiAnthropic:450`／`dispatchApiTypesafeSystemone:332`(單一 `key`,`getErrorResult(err)`,`errorType 'params'`、`attempts 0`);`dispatchAiFallback:886`(條目 `keys`,以 `entryErr` 走既有「條目整組 params 跳過」通道)與 `:919`(無 `keys` 時之條目層／共用層單一 `key`,只判吃 key 之 kind:`KEY_KINDS`;有 `keys` 時各把金鑰覆寫 `opt.key` 故不判);條目已 `entryErr` 者不起訂閱類用量查詢(`sq = null`)。`codex`、`antigravity` 無金鑰概念,不判。
  - 不在本規則之內:`opt.env.ANTHROPIC_API_KEY`(環境變數字串,另見 R-ANTHROPIC-1)、`probeAnthropicKeys`(診斷探測,逐把回 `invalid key`)、`opencodeGoUsage`／`getQuota*`(用量查詢,無計費)。
- 為何:金鑰屬影響計費之 opt。修前 `key`／`keys` 給了非字串而濾後無有效字串者視同未給——`claude` CLI 條目起一個不帶 `ANTHROPIC_API_KEY` 之子進程且回成功(改走登入態／訂閱,或繼承之環境值),REST 條目送出不帶認證標頭之請求(得 401);原本指定「以該 API 金鑰計費」之意圖被悄悄改成他種計費(實測見 `experience.md` 2026-11-19 節)。
- 來源盤點(有無合法用法被誤擋;2026-11-19 以 Grep 盤點,見報告來源表):依賴本庫之各自有套件(`w-knowledge-capture`／`extract`／`relate`／`summarize`)皆經 `resolveCatalogue` 展開 `envVar → keys`(缺環境變數之條目列 skipped、不進可用表、不產生 `keys` 欄),`src` 內未見直接組 `keys`／`key` 之呼叫;主控派工腳本以 `...(key ? { key } : {})` 傳入(空值不傳);全域技能文件範例(`key: process.env.X`／`agnesKeys[0]`)缺值為 `undefined`,屬未給。**未見「環境變數缺值時傳非空之無效值」之用法**;`''`、`[]`、`undefined`、`null` 皆屬未給,不受影響。盤點限於上列來源,他使用端自行確認。
- 盤點指令:`Grep "readKey\(|readKeys\(" src`——預期:`dispatchClaude`／`dispatchOpencode`／REST 四家各 1、`dispatchAiFallback` 2(readKeys 1、readKey 1)、`readKeyOpt.mjs` 定義;`Grep "get\(opt, 'key'|isarr\(keysRaw|filter\(isestr\)" src`——預期 0(不得再有未經 `readKey`／`readKeys` 之 `key`／`keys` 讀取)。
- 對應測試:`test/unit-keyOptReject.test.mjs`(`readKey`／`readKeys` 判定表(未給、有效、混合、給了而無效含 `length` 非整數／過大／偽造標籤)、六個轉接器 × 15 種無效 key 之 params／零子進程／零請求、對照未給之三值、`dispatchAiFallback` 11 種無效 keys × 六種 kind 之整組跳過並由次條目成交、未給七種、混合三種、條目層單一 key 與用量查詢零次);`test/unit-dispatchClaudeKey.test.mjs` R03／R08(未給三值;給了無效四值 params 且無報告檔)、`test/unit-dispatchAiFallbackKinds.test.mjs`(keys 全為包裝物件 → params 跳過、不送請求)。
- **變異驗證**(2026-11-19;`./tmp/` 副本逐一施加,須轉紅;14 個全數被抓到,括號為轉紅案數):K1 條目 `keys` 無效不拒絕(退回視同未給=改走登入態)(3)、K2 `dispatchClaude` 之 key 無效退回視同未給(3)、K3／K4／K5／K6／K7 `dispatchApiOpenaiCompat`／`dispatchApiAnthropic`／`dispatchOpencode`／`dispatchApiOpenaiResponses`／`dispatchApiTypesafeSystemone` 之 key 無效退回不帶認證／沿用登入狀態(各 2)、K8 條目已 params 失敗者仍起訂閱類用量查詢(2)、K9 條目層／共用層單一 key 無效不判(2)、K10 `readKeys`「含非空非字串元素而濾後無有效字串」不拒絕(3)、K11 非陣列之定義值不拒絕(2)、K12 以內部標籤判陣列(偽造 `Symbol.toStringTag` 之物件被當陣列)(1)、K13 不驗 `length`(1)、K14 元素數上限放寬(1)。**等價變異之一類**:K9 去掉後 opencode／REST 三種 kind 仍綠(轉接器層同樣回 params),只有 claude 之「用量查詢計數」分辨得出,故該案以用量讀者計數為斷言。
- **修前紅**:`unit-dispatchClaudeKey` R03(給了無效 key 不再視同未給)與 `unit-dispatchAiFallbackKinds`(keys 全為包裝物件)各 1 案紅;`unit-keyOptReject` 因 import 新模組而整檔不註冊(紅);修後全綠。
