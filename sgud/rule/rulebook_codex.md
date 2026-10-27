# 規則帳本(類型:codex 條目)

> 類型說明:內建 `providers` 中 kind 為 `codex` 之條目(`codex:gpt-5.6-luna`、`codex:gpt-6.1-terra`、`codex:gpt-6.1-sol`)之欄位、強度與順序規則(R-CODEX-1).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:主控任務 20261028054319 之 wda-run01(2026-10-28;使用者 2026-10-27 把外審由 gpt-6.1-sol 改為 gpt-6.1-terra max,全域技能 dispatch-codex 預設模型同改).

## codex 條目:欄位比照、強度必傳、新首選排在舊首選之前(2026-10-28 立)

### 軸

- 條目:`id`、`model`、`kind`、`sandbox`(唯讀檔位)、`extraArgs`(強度)、`envVar`(訂閱登入態無).
- 模型型錄預設強度:`codex debug models` 之 `default_reasoning_level`、app-server `model/list` 之 `defaultReasoningEffort`(兩處欄位名不同;terra、sol 皆為 low);未明給時先沿用 `~/.codex/config.toml` 之 `model_reasoning_effort`(隨安裝機而異),再無才回退型錄預設.
- 位置:codex 群組在 `claude:` 之後、api 版(`typesafe:`)之前;群組內順序.
- 呼叫端覆寫:`resolveProviders` 之 `patch`(淺合併,逐 id)覆寫 `extraArgs`;`sandbox` 為獨立欄位.

### R-CODEX-1 codex 條目之欄位、強度與順序

- 規則:①每個 `kind: 'codex'` 條目必帶 `sandbox: 'read-only'`(內建清單為唯讀調用)與 `extraArgs: CODEX_EFFORT`(`['--config', 'model_reasoning_effort="high"']`;單一來源為 `providers.mjs` 之 `EFFORT` 常數,**不為個別型號另寫強度**);型錄預設為 low 之型號(terra、sol)未明給且執行機 `config.toml` 未設定時即跑最淺,故強度必傳;②新增 codex 型號時,欄位比照現有型號(除 `id`、`model` 外深相等),既有型號條目與 id **不刪不改**(下游以 id 引用),新首選排在舊首選之前、`codex:gpt-5.6-luna` 維持群組最前;③codex 條目連續成一段,不落入他群組,其他群組之相對順序不動;④呼叫端要更高強度(如外審之 max)走 `patch` 覆寫 `extraArgs`,不改內建常數;`sandbox` 在獨立欄位,覆寫 `extraArgs` 不解除唯讀;⑤條目註解載明該型號之型錄預設強度與實測紀錄(日期、CLI 版本、是否實跑),未實測者明寫「未實測」.
- 現況(2026-10-28):`codex:gpt-5.6-luna` → `codex:gpt-6.1-terra` → `codex:gpt-6.1-sol`;terra 實測由主控 2026-10-27 於 Codex CLI 0.163.0 完成(`-m gpt-6.1-terra -c model_reasoning_effort="max"` 與 `dispatchCodex`＋`workspace-write` 讀中文檔寫檔);本套件測試全程假 codex,**唯讀沙箱寫檔金絲雀未對 terra 重測**.
- 盤點指令:`Grep "id: 'codex:" src/providers.mjs`(站點全集:應為上列三條,依序);`Grep "kind: 'codex'" src/providers.mjs`(每筆須有 `sandbox: 'read-only'` 與 `extraArgs: CODEX_EFFORT`);文件站點:`Grep "gpt-6.1-(terra|sol)" src README.md`(列舉可用模型者保留 sol、不得把 sol 寫成「預設／首選」).
- 判準:已套＝上列①～⑤皆合;未套＝任一規則未符合(代表例:有 codex 條目缺 `sandbox` 或 `extraArgs`、值非 `read-only`／非統一強度常數、欄位未比照、新首選排在舊首選之後、codex 條目被拆散或落入他群組、註解缺型錄預設強度或實測紀錄);刻意不套＝無.
- 對應測試:`test/unit-providersCodexEntries.test.mjs`(10 條:存在且唯一／唯讀與強度／欄位比照 sol／codex 群組順序與相鄰／群組(id 前綴)順序不動／`pick` 自選／全取順序／經假 codex 之 argv／`patch` 覆寫 max 不解除唯讀／terra 失敗換 sol;12 個變異〔欄位改壞、移位、落入他群組、整段移位、刪除等〕全數被抓到);`test/unit-providers.test.mjs`(全條目之防寫與強度 high 通則).
- 指令:`npx mocha --no-parallel test/unit-providersCodexEntries.test.mjs test/unit-providers.test.mjs --timeout 180000`.
- 文件同步點:`README.md` 行為變更紀錄第 53 條與「量級感受」條數;`src/providers.mjs` 條目註解與「各條目之思考強度」註解;`src/dispatchCodex.mjs` 之 `model` JSDoc.
