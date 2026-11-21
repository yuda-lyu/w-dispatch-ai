# 規則帳本(類型:內建 providers 條目因上游結構性失效而下架)

> 類型說明:內建 `providers`(`src/providers.mjs`)之條目,在上游**結構性失效**(現有金鑰實打一律失敗,非暫時限流)時之下架處置、同步站點全集與守門測試(R-PROVIDERS-1).主檔索引見 `sgud/rule/rulebook.md`.opencode 免費條目之下架判準另見 `rulebook_opencodefree.md`(R-OCFREE-1～2),OpenCode Go 條目另見 `rulebook_opencodego.md`(R-OCGO-1⑩),本規則補其不涵蓋之供應商(如 Poolside 官方端點).
> 來源:主控任務 20261121154013 之 dl583(2026-11-21;使用者指示移除 Poolside laguna 兩條目;主控以 `.env` 之 `POOLSIDE_KEYS` 兩把金鑰直呼官方端點之查證).

## 內建條目之結構性失效下架:判準、處置與同步站點(2026-11-21 立)

### 軸

- 條目:`id`、`model`、`envVar`、`baseURL`／`config`.
- 證據:①清單端點(`GET /models`)是否仍列;②實際請求端點(`POST /chat/completions` 或 CLI 呼叫)之結果——**以②為準**,①仍列不等於可用(同 `providers.mjs` 檔頭「文件與目錄皆列不等於可用」);③失效之持續時間與是否為本帳號層(轉售管道仍列、上游無公開公告者,不論帳號層或全域,對現有金鑰皆必失敗).
- 後果:全取遞補時每輪白耗每條一格(含逐把金鑰重試);屬結構性失效,不適用檔頭「暫時打不通者保留」之哲學.

### R-PROVIDERS-1 結構性失效之內建條目須下架並同步全部站點

- 規則:①以現有金鑰實打(最小請求與條目原樣之 body 皆試、每把金鑰各試)一律失敗且訊息為停用／下架／不可用類(如 HTTP 400「Model version … is deactivated」),不論清單端點是否仍列,依使用者指示或本規則自目錄移除;②移除時於 `providers.mjs` 檔頭漂移紀錄新增一則:日期、起因與提出端、實測端點與金鑰把數(**不寫金鑰值**)、清單端點與請求端點之差、訊息全文、前例、條目數前後(37 → 35)、群組順序之變化、對其餘條目之影響(id、內容、順序零改動)、日後恢復時之收錄條件與原條目欄位(含其實測),並在條目原位留一行註解指向該紀錄;歷史紀錄(含較早日期之「實測仍可用故保留」)保留其日期與當時事實,只於句末加「自某日起不成立」之註記;③對應之金鑰變數(`envVar`)若已無內建條目使用,自「內建供應商之金鑰變數」之列舉移除(README `.env` 範例、`providers.mjs`〈使用方式〉、`splitKeys.mjs` 已知供應商說明),但**通用機制不改**:`readEnvFile`、`resolveProviders`、`splitKeys` 仍接受使用端自訂條目之任意 `envVar`;④以該條目為例之說明(`id` 命名規則範例、`pick` 打錯字範例、`resolveProviders` JSDoc)改用仍存在之條目,不留懸空之例;⑤條目數、群組順序與量級感受(條數×300s,未設 `OPENCODE_GO_KEYS` 者之條數)同步;⑥README 行為變更紀錄新增一條(未發布;含移除之 id、依據、`pick` 落入 `missing`、`patch` 無作用、全取遞補鏈少幾條、金鑰變數已無內建條目使用、下游名單與文件須同步);⑦不動 `.env`(金鑰屬使用者).
- 現況(2026-11-21):`oc:poolside/poolside/laguna-s-2.1`、`poolside:laguna-s-2.1` 已移除(內建 37 → 35 條;`POOLSIDE_KEYS` 已無內建條目使用);群組順序 `oc`→`ocgo`→`agy`→`claude`→`codex`→`typesafe`→`zen`→`agnes`→`claude-api`→`anthropic`.
- 盤點指令:`Grep "laguna|poolside|POOLSIDE" src test README.md sgud`(站點全集見下表);條目數:`Grep "3[0-9] ?條|// => 3[0-9] \[\]" README.md src test`.
- 站點全集與判準(2026-11-21 逐處):

| 站點 | 處置 | 判準 |
|---|---|---|
| `src/providers.mjs` 兩條目區塊 | 刪除,原位留註解 | 已套 |
| `src/providers.mjs` 檔頭 id 命名行、〈使用方式〉`.env` 範例、思考強度與 opencode 檔位註解、`OC_READONLY` 註解、REST 區段標題 | 改寫(移除 poolside 字樣或註明已移除) | 已套 |
| `src/providers.mjs` 2026-09-22 漂移紀錄之「poolside…實測仍可用故保留」 | 保留,句末註「2026-11-21 起不成立」 | 刻意不套(歷史事實) |
| `src/providers.mjs` 檔頭之 `zen:laguna-s-2.1-free`(2026-09-22 移除;Zen 轉售,非 Poolside 官方端點) | 不動 | 刻意不套(不同供應商) |
| `src/resolveProviders.mjs` JSDoc(條目數 37→35、`pick` 打錯字範例)與 `hints` 註解 | 改寫 | 已套 |
| `src/splitKeys.mjs` 已知內建供應商列舉 | 移除 POOLSIDE | 已套 |
| `src/dispatchAiFallback.mjs` `id` 命名規則範例(檔頭與 `opt.providers[].id` JSDoc) | 改用 `claude:sonnet`／`claude-api:sonnet-5.5`／`anthropic:sonnet-5.5` | 已套 |
| `README.md` 行為變更第 10、44 條 | 保留,加註已移除並指向第 78 條 | 刻意不套(歷史紀錄) |
| `README.md` 行為變更第 78 條 | 新增 | 已套 |
| `README.md` `id` 命名規則表、`.env` 範例、`pick` 打錯字範例、量級感受、思考強度段、`max_tokens` 說明 | 改寫 | 已套 |
| `test/unit-providersPoolsideRemoved.test.mjs` | 新增(守門,13 條) | 已套 |
| `test/unit-providersCodexEntries.test.mjs`(群組順序)、`unit-providersOpencodeFreeEntries`(條目數 35)、`unit-providersOpencodeGoDocs`(條目數、README／JSDoc 錨點)、`unit-providersOpencodeGoEntries`(條目數)、`unit-resolveProviders`(模擬 env 不再含 `POOLSIDE_KEYS`) | 依內建條目更新 | 已套 |
| `test/unit-resolveProviders.test.mjs` 之自建 `defs`(`poolside:laguna-s-2.1` 字面)、`test/unit-filterOpencodeFree.test.mjs` 之 CLI 輸出解析樣本(`poolside/poolside/laguna-s-2.1`) | 保留並於案內註明 | 刻意不套(輸入為自建樣本,非斷言內建條目) |
| 下游全域技能 `dispatch-opencode`(條目表、條目數、`POOLSIDE_KEYS`) | 本套件不改,於報告列出須同步處,由主控於發布後改 | 刻意不套(他處) |

- 對應測試:`test/unit-providersPoolsideRemoved.test.mjs`(13 條:無 `poolside:`／`oc:poolside/` 前綴條目與已移除 id／以欄位查無任何指向 Poolside 之條目與 `POOLSIDE_KEYS`／全取之 `skipped` 不含 `POOLSIDE_KEYS` 且不給該變數時無條目被停用／`pick` 落入 `missing` 且 `patch` 無作用／群組順序與六條計費條目仍在末端;**通用機制不改**:自訂條目 `envVar: 'POOLSIDE_KEYS'` 仍展開、`readEnvFile` 仍讀出且不污染 `process.env`〔此 2 案修前後皆綠〕;文件同步:`providers.mjs` 檔頭漂移紀錄與條目已移除、src 說明、`dispatchAiFallback` 範例、README 第 78 條、README 現行說明無 laguna 與 `POOLSIDE_KEYS`;修前〔HEAD 之 `src` 與 README〕11 紅、修後全綠).
- 指令:`npx mocha --no-parallel test/unit-providersPoolsideRemoved.test.mjs test/unit-providersCodexEntries.test.mjs test/unit-providersOpencodeFreeEntries.test.mjs test/unit-providersOpencodeGoDocs.test.mjs test/unit-providersOpencodeGoEntries.test.mjs test/unit-resolveProviders.test.mjs test/unit-providers.test.mjs --timeout 180000`.
- 日後恢復收錄:Poolside 之 `POST /chat/completions` 回 200 時,依 `providers.mjs` 檔頭收錄檢核重新收錄,原條目欄位與思考開關實測見 2026-11-21 漂移紀錄末段與 git 歷史;收錄時須同步本規則之站點(條目數、群組順序、量級感受、`.env` 範例、守門測試改為欄位斷言).
