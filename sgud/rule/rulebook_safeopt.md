# 規則帳本(類型:safeopt 安全相關純量 opt)

> 2026-11-22 tdai1(排程第 553 項)立.類型說明:影響安全或計費之純量 opt「給了而無效即拒絕」之判定單一來源 `readSafeOpt`(R-SAFEOPT-1);金鑰型 opt(`key`／`keys`)之同類規則見 `rulebook_anthropic.md` R-KEYOPT-1(`readKeyOpt.mjs`).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:跨套件規格〈輸入參數之檢測機制〉§11〈安全相關 opt 為 K3 之例外〉(使用者 2026-11-16「W-08、W-09:照建議」:影響演算法、校驗、是否連網、下載來源、取哪些檔之 opt 給了而無效即拒絕〔fail-closed〕,不改用預設;2026-11-17 影響下單數量或金額者視同)、K9(訊息不回顯輸入值);dai492i2 報告 R4(codex `sandbox`、claude／agy `skipPermissions`、agy `addDirs`、REST `baseURL`、各家 `exe`／`cwd`)與 R5(A3、B2、C1、A5、A7);主控裁示(排程第 553 項):照辦.

## R-SAFEOPT-1 影響安全或計費之純量 opt 給了而無效即以 `params` 拒絕,不退回較寬或官方之預設

### 軸

- 參數:`dispatchCodex.sandbox`;`dispatchClaude`／`dispatchAntigravity` 之 `skipPermissions`;`dispatchAntigravity.addDirs`;`dispatchApiAnthropic`／`dispatchApiTypesafeSystemone` 之 `baseURL`(`OpenaiCompat`／`Responses` 之 `baseURL` 本就必填而拒絕);`probeAnthropicKey(s)`／`opencodeGoUsage` 之 `baseURL`(金鑰送往該網址,同形);CLI 四家之 `exe`、`cwd`;`getQuotaClaude`／`getQuotaCodex` 之 `env`;(2026-11-23 tdai1b 加)四家 CLI／`runExecCli`／`filterOpencodeFree` 之 `env`、`resolveProviders`／`resolveCatalogue` 之 `env`／`exes`(規則 10)、`dispatchOpencode` 之 `provider`(僅 `key` 有效時)與 `useStoredAuth`(規則 9).
- 輸入值類別:未給(`undefined`、`null`)、有效、空字串(`''`)、非原始字串(數字、布林、物件、陣列、函數、`String` 包裝物件、敵意物件〔`toString`／`valueOf`／`Symbol.toPrimitive` 回標記字串〕、已撤銷之 `Proxy`)、非原始布林(`'false'`、`0`、`1`、`''`、物件、包裝物件)、`addDirs` 之陣列變體(空陣列、混合、全無效、`length` 拋錯之 `Proxy`、已撤銷之陣列 `Proxy`、元素為包裝物件／已撤銷之 `Proxy`)、`env` 之非一般物件(陣列、字串、數字、`Map`、`String`、函數、拋錯之 getter、已撤銷之 `Proxy`).

### 規則

1. **判定**(`src/readSafeOpt.mjs`,單一份;訊息格式同 `readKeyOpt.mjs`):`readStrOpt`(非空原始字串)、`readBoolOpt`(原始布林)、`readDirsOpt`(陣列)、`readEnvOpt`(可讀之一般物件,回物化之淺層副本;亦供 `exes`)、`checkObjOpt`(其形狀判定:只經探針與內部標籤、不展開、不執行 getter;`readEnvOpt`／`assertObjOpt`／`checkSafeOpts` 之 env 同源)、`assertObjOpt`(給了而無效即同步 throw,供無 `params` 通道之 `resolveProviders`／`resolveCatalogue`)、`readProviderOpt`(`dispatchOpencode` 之 `provider`:僅 `key` 有效時才判).**未給＝`undefined`、`null`(用預設);其餘無效者回 `err`**,轉接器以 `getErrorResult(err)`(`errorType: 'params'`、`attempts: 0`)回報,不起子進程、不送請求;`dispatchAiFallback` 對 `params` 整組跳過、續試下一組.
2. **空字串(`''`)視為給了而無效**(與金鑰型 opt 不同):金鑰常取自環境變數、空字串＝缺值而預設為登入態;本批各 opt 之空字串退回預設即悄悄改用預設值(`exe` 換成 PATH 上之預設執行檔、`cwd` 換成 `process.cwd()`、`baseURL` 換成官方端點、`sandbox` 換成 `workspace-write`).
3. **`addDirs`**:空陣列 `[]` 為合法(明示不揭露任何目錄,既有行為);含有效字串者無效元素照舊略過(同 `readKeys`,既有案「`addDirs` 逐項展開並濾除非有效字串」);非空元素全無效者、非陣列之定義值、不可讀者(已撤銷之 `Proxy`、`length` 拋錯、`length` 非整數／負數)、元素數逾 10000 者拒絕.
4. **訊息(K9)**:只寫參數名、期望之種類、`typeof` 與「rejected instead of silently falling back to the default」,不回顯值;外來例外訊息(不可讀)取 `errMsg`(同 `readKeyOpt`).
5. **站點全集**(`Grep "readStrOpt\(|readBoolOpt\(|readDirsOpt\(|readEnvOpt\(" src`,排除 `readSafeOpt.mjs`):
   | 檔 | 參數 | 判定 |
   |---|---|---|
   | `dispatchCodex.mjs` | `exe`、`sandbox`、`cwd` | `readStrOpt`×3 |
   | `dispatchClaude.mjs` | `exe`、`skipPermissions`、`cwd` | `readStrOpt`×2、`readBoolOpt` |
   | `dispatchAntigravity.mjs` | `exe`、`cwd`、`skipPermissions`、`addDirs` | `readStrOpt`×2、`readBoolOpt`、`readDirsOpt`(`addDirs` 未給時 `[cwd]`;`checkAgyStdinSupport` 取同一 `cwd`) |
   | `dispatchOpencode.mjs` | `exe`、`cwd` | `readStrOpt`×2(`PWD` 同步取同一 `cwd`) |
   | `dispatchApiAnthropic.mjs`、`dispatchApiTypesafeSystemone.mjs` | `baseURL` | `readStrOpt`(未給用官方端點) |
   | `probeAnthropicKeys.mjs` | `baseURL`(`probeOnce` 與 `probeAnthropicKeys` 兩處) | `readStrOpt`(單把:該把回 `kind: 'other'`＋`detail` 不送請求;多把:整體回 params 結果) |
   | `quota/getQuotaClaude.mjs` | `env`、`homeDir`、`configDir` | `readEnvOpt`(`env` 為 `process.env` 本身者原樣,免淺層副本失去 Windows 大小寫不分查找)、`readStrOpt`×2(回 `toQuotaResult` 之 `errorType: 'params'`) |
   | `quota/getQuotaCodex.mjs` | `env`、`exe`、`homeDir`、`codexHome` | `readEnvOpt`、`readStrOpt`×3(Codex 之 HTTP 備援取同一物化之 `env`;`exe` 以驗後之值交 `viaAppServer`) |
   | `quota/getQuotaAntigravity.mjs` | `exe`、`cwd` | `readStrOpt`×2 |
   | `filterOpencodeFree.mjs` | `exe` | `readStrOpt`(回 `fail('params', …)`) |
   | `dispatchCodex.mjs` | `cleanCodexRefs`(破壞性開關:刪 `refs/codex/*`) | `readBoolOpt`(給了而非布林拒絕,不退回「開」) |
   | `dispatchAiFallback.mjs` | (遞補層於發 `try` 之前) | `checkSafeOpts(kind, entryAttemptOpt, { keyed: nk > 0 })`(`env` 只經 `checkObjOpt` 驗形狀、不展開、不執行呼叫端 getter,既有契約 `unit-dispatchAiFallbackKinds`「範圍檢查不執行條目 env 內之 getter」):依 kind 表(`SAFE_SPEC`:claude `exe／cwd／skipPermissions／env`、codex `exe／cwd／sandbox／cleanCodexRefs／env`、opencode `exe／cwd／useStoredAuth／provider／env`、antigravity `exe／cwd／skipPermissions／addDirs／env`、api-anthropic／api-typesafe-systemone `baseURL`)判定,與轉接器共用同一判定,失敗者以 `entryErr` 走條目層 `params`(不發 `try`) |
   | `runExecCli.mjs` | `env` | `readEnvOpt`(四家 CLI 共同入口;給了而非物件回 `params`,可讀者以物化副本交 `execCli`) |
   | `dispatchClaude.mjs` | `env`(未給 key 與 key 模式兩路) | `readEnvOpt`(key 模式之訊息仍遮蔽 key) |
   | `dispatchCodex.mjs`、`dispatchAntigravity.mjs` | `env` | `readEnvOpt`(於起任何子行程〔git 基準列舉、`agy --version` 探測〕之前判;物化副本回填 `optCli.env`) |
   | `dispatchOpencode.mjs` | `env`、`provider`(key 有效時)、`useStoredAuth` | `readEnvOpt`、`readProviderOpt`、`readBoolOpt` |
   | `filterOpencodeFree.mjs` | `env` | `readEnvOpt`(回 `fail('params', …)`) |
   | `resolveProviders.mjs`、`resolveCatalogue.mjs` | `env`、`exes` | `assertObjOpt`(同步 throw) |
   (複審〔自派 sonnet,唯讀〕建議補之站點:額度讀者之 `exe`／`cwd`／`homeDir`／`configDir`／`codexHome`、`filterOpencodeFree` 之 `exe`、`cleanCodexRefs`、`try` 事件之轉接器層 `params`——皆已補,見上列.)
   不經 `readSafeOpt` 而同規則者:`dispatchApiOpenaiCompat`／`OpenaiResponses` 之 `baseURL`(必填,`!isestr` 即 `baseURL must be a non-empty string`)、`opencodeGoUsage`(`baseURL` 非 http(s) 網址即 `fail('params', 'invalid opt.baseURL: must be an http(s) URL string')`,訊息依 V19).
6. **併處之 R5 各子項**(dai492i2 複審):A3(`getQuotaClaude`／`Codex` 之不可讀 `env`)＝規則 5;**B2**:`resolveProviders` 條目帶 `envVar` 而 `keys` 給了無效(字串、物件、數字、元素全無效)時,修前以環境變數之金鑰取代(`isearr` 判「已自帶」),現以 `readKeys` 判定(與 `dispatchAiFallback` 同源),給了而無效者原樣通過、留待遞補層以 `params` 拒絕,未給(`undefined`／`null`／`[]`／元素全空)才依 `envVar` 展開;**C1**:`dispatchAiFallback` 條目層 `params` 失敗(`entryErr` 非空:不可讀之條目、`keys`／`key` 給了而無效,及**轉接器之安全相關 opt 給了而無效,於發 `try` 前以 `checkSafeOpts` 判**)不再發 `try` 事件(`onUsage`／`createUsageCounter` 於 `try` 入帳,修前未送出之嘗試亦入帳;失敗仍進 `tried` 與後續事件);轉接器自身才得知之其他 `params` 檢核(如 `model` 缺漏、`config` 不可序列化)發生於 `dispatchAi` 內、`try` 之後,**已知不在此列**(結果帶 `attempts: 0` 可辨);**A5**:`probeAnthropicKeys` 之 `keys`／`opt` 不可讀、`keys` 陣列 `length` 讀取拋錯或元素數逾 10000,修前回空結果或 reject,現回 `{ model, results: [], summary: { total: 0 }, error, errorType: 'params' }`;**A7**:`createAiCaller` 之 `callAI(prompt, o)` 之 `o` 不可讀(修前當 `{}`,逐次之 `budgetMs`／`validate` 被靜默略過)回 `params` 失敗結果(不 reject,`providersSkipped`／`providersMissing` 照附),`makeArrayCoverageValidator` 之 `contentFields`／`maxLengths` 不可讀即同步 `TypeError`(同 `indices`).
7. **刻意不套**(2026-11-23 tdai1b 依主控裁示②縮小範圍;理由):①`dispatchOpencode` 之 `config` 為非物件非字串之定義值(沿用使用者既有設定檔)、`agent` 給了無效(退回 `build`)、`provider: ''`:屬文件載明之預設／常見值,逕改會拒絕既有呼叫,維持現狀(**`provider` 給了無效而 `key` 有效、`useStoredAuth` 非布林已於規則 9 套用;四家 CLI 與 `resolveProviders`／`resolveCatalogue` 之 `env`／`exes` 非物件已於規則 10 套用**);②`exes` 之各 kind 值為非字串(`{ claude: 123 }` 照舊略過,條目之 `exe` 維持未給)、`env` 之各變數值為非字串(原樣交子行程)、`resolveProviders` 之 `pick`／`patch` 給了非預期型別(視同未給,`pick` 為字串即全取含付費條目):屬規則 10 範圍外之同形項,列裁示;③`model`／`effort`／`outputTokenMax` 等有計費影響之一般 K3 項(不在本批).
8. **複審(自派 sonnet,唯讀)之處置**:屬實並已改——額度讀者與 `filterOpencodeFree` 之路徑／`exe`、`cleanCodexRefs` 給了無效、`try` 事件涵蓋轉接器層之安全 opt、事件流 `denied` 之同步驟有文字(R-OCDENY-1)、`removeNewCodexRefs` 缺基準不刪、git 子行程環境、批次刪除(R-CODEX-3)、`createUsageCounter.bump` 之 `n`(R-COUNT-1)、`readEnvOpt` 對 `process.env` 本身原樣、`dispatchCodex` 之 `extraArgs` 只讀一次;屬實而列待辦／限制——預設格式下已有文字才被拒(R-OCDENY-1)、並行時刪到他人剛建之 ref(R-CODEX-3)、不可讀路徑之訊息含對象自己拋出之 `Error.message`(同 `readKeyOpt` 既有政策).
9. **`dispatchOpencode` 之計費路徑與權限相關 opt**(排程第 553 項主控裁示②;2026-11-23 tdai1b):①`provider` 給了而非原始非空字串**且 `key` 有效**→ `params` 拒絕(`readProviderOpt`:未給〔`undefined`、`null`〕與 `''` 為未給、維持現狀;`provider` 無效而未給 `key` 不影響計費路徑,維持現狀;有效字串照用)——修前 `provider` 無效即不注入 `OPENCODE_AUTH_CONTENT`,`key` 被悄悄捨棄而改用 `auth.json` 既有登入(與 R-KEYOPT-1 同形);②`useStoredAuth` 給了而非原始布林 → `params` 拒絕(`readBoolOpt`;修前視為 `true` 沿用登入);`true`、`false`、未給照舊.遞補層於發 `try` 之前以 `checkSafeOpts('opencode', entryAttemptOpt, { keyed: nk > 0 })` 同源判定(`keyed`:條目有有效 `keys`;單一 `opt.key` 由 `opt` 自身判).訊息不回顯 provider 與 key.
10. **四家 CLI 與目錄展開之 `env`／`exes`**(排程第 553 項主控裁示②;2026-11-23 tdai1b):①`dispatchClaude`(未給 key 與 key 模式兩路)、`dispatchCodex`、`dispatchOpencode`、`dispatchAntigravity`、`runExecCli`、`filterOpencodeFree` 之 `env` 給了而非物件(`readEnvOpt`:可讀之一般物件才收;字串〔含 `''`〕、數字、布林、陣列、`Map`、函數、包裝物件、`Symbol`、`BigInt` 皆拒)→ `params`(`attempts 0`)、**於起任何子行程之前判**(`dispatchCodex` 於派工前 git 基準列舉之前、`dispatchAntigravity` 於 stdin 路徑 `--version` 探測之前);可讀之物件以物化之淺層副本交下游(只讀一次,K4;`process.env` 本身原樣);②`resolveProviders`、`resolveCatalogue`(`createAiCaller` 建構時經之)之 `env`、`exes` 給了而非物件 → 同步 throw(`assertObjOpt`,經 `checkObjOpt` 驗形狀〔`readEnvOpt` 同源〕、不執行 getter;無 `params` 通道,同不可讀者之處置;`env` 之原物件原樣使用,不複製);③`checkSafeOpts` 四家 CLI 之 `env` 同源(遞補層於發 `try` 前判);未給(`undefined`、`null`)、一般物件(含空物件)、`process.env` 照舊.訊息不回顯值.

### 盤點指令與判準

- `Grep "get\(opt, '(exe|cwd|sandbox|skipPermissions|addDirs|baseURL)'" src`:每筆須緊接 `readStrOpt`／`readBoolOpt`／`readDirsOpt` 之結果判定(已套)或屬規則 5 末之不經 `readSafeOpt` 者(已套)或規則 7 之刻意不套;其餘(`isestr(exe)` 後退回預設者)為未套.
- 已套＝給了而無效回 `params`(`attempts 0`);未套＝仍退回預設;刻意不套＝規則 7.

### 對應測試

- `test/unit-safeOpts.test.mjs`(28 案:CLI 四家 `exe`／`cwd` 各 2、`sandbox`、`skipPermissions`×2、`addDirs`、REST 四家 `baseURL`＋探測／用量之 `baseURL`、A3 與額度讀者路徑各案、B2、C1、A5 兩案〔不可讀設定、`length` 非合法長度與逾 10000 把〕、A7 兩案、`checkSafeOpts` 一案等);假 CLI、全域 `fetch` 換為記錄替身、額度讀者指向空之暫存目錄,**不呼叫任何外部服務**;`before` 把 PATH 換成移除真 CLI(claude、opencode、codex、agy)資料夾者、`after` 還原(修前之無效 `exe` 會退回 PATH 上之真 CLI;自包含,不依賴外部包裝).
- 修前紅:HEAD 快照(`git archive HEAD`)上 28 案中 26 failing／2 passing(後者為 `OpenaiCompat`／`Responses` 之 `baseURL` 保持案;`checkSafeOpts` 案於案內動態匯入新模組).
- 既有三案因契約改變而改寫(舊斷言「給了而無效退回預設」):`test/unit-dispatchCodex.test.mjs`「sandbox…」、`test/unit-dispatchClaude.test.mjs`「skipPermissions…」、`test/unit-opencodeGoUsage.test.mjs`「baseURL…」;其餘既有案未因本規則而改.

- (2026-11-23 tdai1b 補)`test/unit-opencodeAuthOpts.test.mjs`(7 案:規則 9 之 provider／useStoredAuth、`checkSafeOpts('opencode', …, ctx)`、遞補層不發 `try`;含保持案)、`test/unit-envExesReject.test.mjs`(25 案:規則 10 之 E1～E7,四家 CLI ＋ `runExecCli` ＋ `filterOpencodeFree` ＋ `resolveProviders`／`resolveCatalogue`／`createAiCaller`;含「零次啟動」〔記號假執行檔、`GIT_TRACE` 觀察 git 是否被啟動〕與「env 只讀一次」〔getter 計數〕).共用之敵意值與 PATH 守門在 `test/tools/hostileValuesForTest.mjs`(單一定義,`unit-safeOpts` 同用).既有契約案改寫兩案:`unit-dispatchOpencode`「useStoredAuth…」(`'false'` 由「不注入」改為 `params` 拒絕)、`unit-probeSites`「resolveProviders…」(`env: 123`／`exes: 7` 由「視同未給」改為 throw).
- 修前紅:規則 9、10 之新案於未改 `src` 之版本上 17 failing／10 passing(後者全為保持案);其後新增之 E7 案(零次啟動、git 基準、只讀一次)與 filterOpencodeFree 之 env 交付案之紅由變異證明(E01、E07、E08、E15～E21 等).

### 變異驗證

見 `sgud/state/state_tdai1.md`〈驗證〉(S 系列 41 項;變異腳本為一次性、不入庫).tdai1b 之 P 系列 14 項(規則 9)、E 系列 28 項(規則 10,含 3 組互為備援之成對變異)見 `sgud/state/state_tdai1b.md`.
