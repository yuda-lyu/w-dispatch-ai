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

## R-CODEX-2 帶 `--json` 時結果保留命令事件(raw、commands;排程第 448 項③,2026-11-22 tdai1 立)

- 來源:全域技能 dispatch-codex〈輸出〉〈中文檔案〉節(0.167.0 實測):`--json` 之事件流 `item.completed`(`command_execution`)之 `aggregated_output` 即 Codex 實際收到之命令輸出(同命令另有 `item.started`,輸出為空);審查回覆之引用與原文不符時,須能分辨「讀檔時內容已失真」或「模型引用錯」.修前結果只有 `stdout`(整串 JSONL,失敗時被 `execCli` 裁到 500 字元)與 stderr,無逐命令之結構化輸出.
- 規則:①`extraArgs` 含 `--json`(`getCliArgs` 展開後逐項相等)時,`dispatchCodex` 以 `onStdout` 累積該次呼叫之 stdout 全文(上限 32 MiB),`reshapeResult` 於 `execCli` 結果出來後(成功與失敗皆然)補 `raw`(累積全文)與 `commands`(`parseCodexEvents` 解出,**只取最後一次嘗試**——每遇 `thread.started` 重置,`execCli` 依 `maxRetries` 內部重試時各次嘗試之事件流累積在同一份 stdout);②`commands` 各項:`id`、`command`、`exitCode`(數字或 `null`)、`status`、`output`(`aggregated_output`,單筆上限 2 MiB,超過截斷並標 `outputTruncated`)、`outputTruncated`;只認 `item.completed` 之 `command_execution`(`item.started`、`agent_message` 等略過);③`stdout` 不改(既有以 JSONL 為 stdout 之呼叫端不受影響;與 agy 之 `raw` 不同:agy 之 stdout 改為純回覆,codex 未改以免破壞既有契約);④事件流無任何已知事件(`hasEvents` 為假)者不加 `raw`／`commands`;未帶 `--json` 者完全不介入(結果形狀同修前);⑤呼叫端自給之 `onStdout`／`reshapeResult` 照常(後者於本層之後套用);非 JSON 行、未知類型、非物件行略過、不拋錯.
- 盤點指令:`Grep "parseCodexEvents" src`(應為 `dispatchCodex.mjs` 與其自身);判準:已套＝帶 `--json` 之成功與失敗結果皆有 `raw`／`commands`;未套＝缺;刻意不套＝未帶 `--json`、無已知事件.
- 對應測試:`test/unit-codexEvents.test.mjs`(6 案:成功帶 `raw` 與 `commands`〔含中文與換行、`item.started` 略過〕、失敗(離開碼 1、stdout 被裁)仍帶完整 `raw` 與 `commands`、未帶 `--json` 或非事件流不加〔含未帶 `--json` 而 stdout 恰為事件形狀者亦不介入〕、非 JSON／未知類型略過且僅非命令事件者 `commands` 為空陣列、`execCli` 內部重試只取最後一次嘗試之 `commands` 而 `raw` 為累積全文且 `onStdout` 收全部、驗證不過而由本層重新呼叫 `execCli` 者 `raw`／`commands` 只含最後一次呼叫);修前紅:HEAD 快照上 5 failing／1 passing.
- 文件同步點:`README.md` 行為變更第 80 條;`src/dispatchCodex.mjs` 之 `extraArgs` JSDoc;全域技能 dispatch-codex(`--json` 驗收法可直讀 `commands`,由主控同步).

## R-CODEX-3 派工結束後清除 Codex 新留下之 `refs/codex/*`(排程第 388 項②,2026-11-22 tdai1 立)

- 來源:使用端連動提交時(2026-11-10),Codex 於目標 repo 留下 `refs/codex/turn-diffs/checkpoints/*`(loose ref),其中有指向不存在物件者,使該 repo 之 auto gc 報 `fatal: bad object …`、`failed to run repack`、`task 'gc' failed`(不影響提交與推送).
- **擇一與理由**:查「關閉設定」或「收尾清除」——2026-11-22 以 Codex 0.167.1 查證:①`codex features list` 無任何關閉 turn-diff 檢查點之旗標(僅 `cwd_relative_turn_diffs`〔顯示路徑,預設關〕、`shell_snapshot` 等無關者);②`codex.exe` 字串中無 `refs/codex/turn-diffs`(僅 `refs/codex/curated-sync`,屬外掛同步),該檢查點 ref 之寫入者(或其他版本／介面)與開關無從在本機確認——**故採收尾清除**,不依賴 Codex 設定.
- 規則:①`dispatchCodex` 預設(`opt.cleanCodexRefs` 未給或 `true`)於派工前以 `git for-each-ref refs/codex/` 取基準、派工後(成功與失敗皆然)再取一次,**只刪「基準中不存在」且前綴恰為 `refs/codex/` 者**(`git update-ref --stdin` 之 `delete <ref>` 一次交易,交易失敗退回逐一 `git update-ref -d`);派工前即存在者(使用者自己或其他進行中之 Codex 工作階段所建)不動;`refs/codex-other/`、`refs/codexx`、`refs/heads/codex/…`、`refs/remotes/…/codex/…`、tags 皆不在前綴內、不動;**缺基準(非 Set)者一律不刪**;**指向不存在物件之壞 ref 亦列出並可刪**(2026-11-22 以 git 2.53.0 實測:手寫 loose ref 指向不存在物件後 `git gc` 報 `error: <ref> does not point to a valid object!`、`fatal: bad object <ref>`、`fatal: failed to run repack`;`git for-each-ref refs/codex/` 仍列出、`git update-ref -d` 可刪;`git show-ref` 則報 bad ref 而中止,故不用);②有清除者結果帶 `codexRefsRemoved`(個數),無則形狀不變;③最佳努力:git 不存在、`cwd` 不是 git repo／不存在、命令逾時(列舉 5 秒、刪除 15 秒)或失敗一律略過、不影響結果、不拋錯;git 子行程一律 `windowsHide: true`、環境移除 `GIT_DIR`／`GIT_WORK_TREE`／`GIT_INDEX_FILE`(於 git hook 內執行時其令 git 作用於 hook 所屬 repo);一次至多刪 2000 個;派工前之基準列舉在 `runExecCli` 之前、不計入該次之 `timeoutMs`／`budgetMs`(故列舉逾時取短);④`cleanCodexRefs` 為轉接器自用鍵(`OWN_KEYS`),不轉傳 `execCli`;**給了而非布林以 `params` 拒絕**(破壞性開關不退回「開」;`checkSafeOpts` 表內);⑤`cwd` 取已判定之有效 `cwd`(`readStrOpt`,未給為 `process.cwd()`).
- **已知限制**:①其他 Codex 工作階段於同一 repo、同一時段新建之 `refs/codex/*` 亦會被刪(基準只含派工前者;`runFanout` 於同 `cwd` 並行多個 codex 名額時互刪);預設開啟之取捨——該 ref 為檢查點(turn-diff)而非提交,刪除之代價為該工作階段之 turn-diff 顯示;需保留者給 `cleanCodexRefs: false`;②`extraArgs` 帶 `-C`／`--cd` 令 Codex 作用於他目錄者,清除之 repo 仍為 `cwd` 所在者;③預設是否改關列需裁示(`state_tdai1.md`).
- 盤點指令:`Grep "refs/codex" src` → `cleanCodexRefs.mjs`(常數 `REF_PREFIX`)與註解;`Grep "windowsHide" src/cleanCodexRefs.mjs`.
- 對應測試:`test/unit-codexRefsClean.test.mjs`(9 案:新 ref 刪除而舊 ref 與他類 ref 不動、失敗結果亦清、`cleanCodexRefs:false`／無新 ref 不改形狀／非布林 `params`、**壞 ref 刪除後 `git gc` 成功**、**批次交易失敗(其一被鎖)退回逐一刪除**、缺基準不刪與 `GIT_DIR` 環境移除、非 repo／不存在之 `cwd` 不報錯、自用鍵不轉傳〔含 `OWN_KEYS` 列入〕與 `windowsHide`、`listCodexRefs`／`removeNewCodexRefs` 單元);修前紅:HEAD 快照上 8 failing／1 passing;真實 git(暫存 repo 落 `test/_tmp/codexRefsClean/`)＋假 codex,不呼叫真 codex.
- 文件同步點:`README.md` 行為變更第 80 條、「Options only for dispatchCodex」之 `cleanCodexRefs` 列;`src/cleanCodexRefs.mjs` 檔頭.
