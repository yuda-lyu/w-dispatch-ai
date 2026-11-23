# 規則帳本(類型:safeopt 安全相關純量 opt)

> 2026-11-22 tdai1(排程第 553 項)立.類型說明:影響安全或計費之純量 opt「給了而無效即拒絕」之判定單一來源 `readSafeOpt`(R-SAFEOPT-1);金鑰型 opt(`key`／`keys`)之同類規則見 `rulebook_anthropic.md` R-KEYOPT-1(`readKeyOpt.mjs`).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:跨套件規格〈輸入參數之檢測機制〉§11〈安全相關 opt 為 K3 之例外〉(使用者 2026-11-16「W-08、W-09:照建議」:影響演算法、校驗、是否連網、下載來源、取哪些檔之 opt 給了而無效即拒絕〔fail-closed〕,不改用預設;2026-11-17 影響下單數量或金額者視同)、K9(訊息不回顯輸入值);dai492i2 報告 R4(codex `sandbox`、claude／agy `skipPermissions`、agy `addDirs`、REST `baseURL`、各家 `exe`／`cwd`)與 R5(A3、B2、C1、A5、A7);主控裁示(排程第 553 項):照辦.

## R-SAFEOPT-1 影響安全或計費之純量 opt 給了而無效即以 `params` 拒絕,不退回較寬或官方之預設

### 軸

- 參數:`dispatchCodex.sandbox`;`dispatchClaude`／`dispatchAntigravity` 之 `skipPermissions`;`dispatchAntigravity.addDirs`;`dispatchApiAnthropic`／`dispatchApiTypesafeSystemone` 之 `baseURL`(`OpenaiCompat`／`Responses` 之 `baseURL` 本就必填而拒絕);`probeAnthropicKey(s)`／`opencodeGoUsage` 之 `baseURL`(金鑰送往該網址,同形);CLI 四家之 `exe`、`cwd`;`getQuotaClaude`／`getQuotaCodex` 之 `env`;(2026-11-23 tdai1b 加)四家 CLI／`runExecCli`／`filterOpencodeFree` 之 `env`、`resolveProviders`／`resolveCatalogue` 之 `env`／`exes`(規則 10)、`dispatchOpencode` 之 `provider`(僅 `key` 有效時)與 `useStoredAuth`(規則 9);(2026-11-23 tdai2 加,規則 11)`env` 各變數之值、`exes` 各 kind 之值、`resolveProviders`／`resolveCatalogue` 之 `pick`／`patch`、影響計費之 opt(四家 CLI 與 `dispatchApiTypesafeSystemone` 之 `model`、`dispatchAntigravity.effort`、`dispatchOpencode.outputTokenMax`、`dispatchApiAnthropic` 之 `effort`／`fetch`、四個 REST 之 `body`、`dispatchClaude` 之 `crossCheck`／`fetch`).
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
7. **刻意不套**(2026-11-23 tdai1b 依主控裁示②縮小範圍;理由):①`dispatchOpencode` 之 `config` 為非物件非字串之定義值(沿用使用者既有設定檔)、`agent` 給了無效(退回 `build`)、`provider: ''`:屬文件載明之預設／常見值,逕改會拒絕既有呼叫,維持現狀(**`provider` 給了無效而 `key` 有效、`useStoredAuth` 非布林已於規則 9 套用;四家 CLI 與 `resolveProviders`／`resolveCatalogue` 之 `env`／`exes` 非物件已於規則 10 套用**);②`exes` 之各 kind 值為非字串、`env` 之各變數值為非字串、`resolveProviders` 之 `pick`／`patch` 給了非預期型別:**已於規則 11 套用(2026-11-23 tdai2)**;③`model`／`effort`／`outputTokenMax` 等有計費影響之一般 K3 項:**已於規則 11 盤點並依判準處置(2026-11-23 tdai2)**;**tdai2 仍維持**:`dispatchOpencode` 之 `agent`(退回 `build`,權限面而非計費;`config` 已於 tdai2b〔規則 11〕改為拒絕)、`provider: ''` 而 `key` 有效(主控 2026-11-23 定維持);**tdai2b 又套用**:`patch` 內逐 id 之值、`resolveCatalogue.catalogue`、`dispatchOpencode.config`(規則 11 之 tdai2b 補).
8. **複審(自派 sonnet,唯讀)之處置**:屬實並已改——額度讀者與 `filterOpencodeFree` 之路徑／`exe`、`cleanCodexRefs` 給了無效、`try` 事件涵蓋轉接器層之安全 opt、事件流 `denied` 之同步驟有文字(R-OCDENY-1)、`removeNewCodexRefs` 缺基準不刪、git 子行程環境、批次刪除(R-CODEX-3)、`createUsageCounter.bump` 之 `n`(R-COUNT-1)、`readEnvOpt` 對 `process.env` 本身原樣、`dispatchCodex` 之 `extraArgs` 只讀一次;屬實而列待辦／限制——預設格式下已有文字才被拒(R-OCDENY-1)、並行時刪到他人剛建之 ref(R-CODEX-3)、不可讀路徑之訊息含對象自己拋出之 `Error.message`(同 `readKeyOpt` 既有政策).
9. **`dispatchOpencode` 之計費路徑與權限相關 opt**(排程第 553 項主控裁示②;2026-11-23 tdai1b):①`provider` 給了而非原始非空字串**且 `key` 有效**→ `params` 拒絕(`readProviderOpt`:未給〔`undefined`、`null`〕與 `''` 為未給、維持現狀;`provider` 無效而未給 `key` 不影響計費路徑,維持現狀;有效字串照用)——修前 `provider` 無效即不注入 `OPENCODE_AUTH_CONTENT`,`key` 被悄悄捨棄而改用 `auth.json` 既有登入(與 R-KEYOPT-1 同形);②`useStoredAuth` 給了而非原始布林 → `params` 拒絕(`readBoolOpt`;修前視為 `true` 沿用登入);`true`、`false`、未給照舊.遞補層於發 `try` 之前以 `checkSafeOpts('opencode', entryAttemptOpt, { keyed: nk > 0 })` 同源判定(`keyed`:條目有有效 `keys`;單一 `opt.key` 由 `opt` 自身判).訊息不回顯 provider 與 key.
10. **四家 CLI 與目錄展開之 `env`／`exes`**(排程第 553 項主控裁示②;2026-11-23 tdai1b):①`dispatchClaude`(未給 key 與 key 模式兩路)、`dispatchCodex`、`dispatchOpencode`、`dispatchAntigravity`、`runExecCli`、`filterOpencodeFree` 之 `env` 給了而非物件(`readEnvOpt`:可讀之一般物件才收;字串〔含 `''`〕、數字、布林、陣列、`Map`、函數、包裝物件、`Symbol`、`BigInt` 皆拒)→ `params`(`attempts 0`)、**於起任何子行程之前判**(`dispatchCodex` 於派工前 git 基準列舉之前、`dispatchAntigravity` 於 stdin 路徑 `--version` 探測之前);可讀之物件以物化之淺層副本交下游(只讀一次,K4;`process.env` 本身原樣);②`resolveProviders`、`resolveCatalogue`(`createAiCaller` 建構時經之)之 `env`、`exes` 給了而非物件 → 同步 throw(`assertObjOpt`,經 `checkObjOpt` 驗形狀〔`readEnvOpt` 同源〕、不執行 getter;無 `params` 通道,同不可讀者之處置;`env` 之原物件原樣使用,不複製);③`checkSafeOpts` 四家 CLI 之 `env` 同源(遞補層於發 `try` 前判);未給(`undefined`、`null`)、一般物件(含空物件)、`process.env` 照舊.訊息不回顯值.

11. **影響計費之 opt 與 `env`／`exes`／`pick`／`patch` 之值**(排程第 553 項主控裁定;2026-11-23 tdai2;dspec §11〈安全相關 opt 為 K3 之例外〉之「影響下單數量或金額之 opt 視同安全相關 opt」):
    - **判準**:給了而無效時**會改變計費**(改用 CLI 預設模型、預設 effort、預設輸出上限、預設 `max_tokens`、實際發出請求)者 ⇒ 給了而無效即以 `params` 拒絕(`attempts 0`、起子行程／送請求之前、訊息不回顯值);不改變計費者 ⇒ 維持 K3(視為未給).未給＝`undefined`／`null`;`model`／`effort`(名稱型)與 Anthropic `effort`(列舉型)之 `''` 為文件載明之預設,亦視為未給(`readNameOpt`、`readEnumOpt`);`outputTokenMax`、`body`、`fetch`、`crossCheck` 之 `''` 為給了而無效.
    - **判定單一來源**(`src/readSafeOpt.mjs`):`readNameOpt`(`model`、agy `effort`)、`readEnumOpt`＋`ANTHROPIC_EFFORTS`(Anthropic `effort`;不經原型鏈判定)、`readTokenMaxOpt`(委派 `castOutputTokenMax`,回傳之值即使用之值)、`readFunOpt`(`fetch`)、`readBoolOpt`(`crossCheck`,既有)、`checkReadObj`(四個 REST 之 `body`,對 `readCallerObj` 已物化之值判一般物件)、`checkObjOpt(v, name, vals)`(形狀;`vals` 為 `'env'`／`'exe'` 時另驗**資料屬性**之值,**存取器不執行**)、`readEnvOpt`(形狀後物化一次、於副本上驗全部值)、`readExesOpt`(同,回物化副本)、`checkArrOpt`／`assertArrOpt`(`pick`).`checkSafeOpts` 之 `SAFE_SPEC` 加 `name`／`enum`／`tokmax`／`fun`／`obj` 五種判定(含 `api-openai-compat`／`api-openai-responses` 之 `body`),遞補層於發 `try` 之前同源判定.
    - **`env` 之值**:須為原始字串;**`undefined` 合法**——實測(Node 24,Windows)`spawn` 之 `env` 值為 `undefined` 者子行程不收到該變數(`has: false`),`null`→`'null'`、數字→`'123'`、布林→`'true'`、物件→`'[object Object]'`、陣列→`'1,2'`、函數→其原始碼、`BigInt`→`'10'`、`String` 包裝物件→原字串、`Symbol`→拋 `TypeError`;wsemi `execCli` 文件載明「值為 `undefined` 代表移除該變數(可遮蔽繼承值),值為 `null` 會成為字面字串 `'null'` 故建議勿傳」,`dispatchClaude` key 模式自身即以 `undefined` 遮蔽繼承之憑證變數.故 `undefined` **不是「視同未給」**(未給該變數＝繼承 `process.env`,`undefined`＝移除),維持原樣照傳(合法輸入行為不變);其餘非字串(含 `null`)拒絕.空字串為合法之字串值.`process.env` 本身不驗(值恆為字串).`resolveProviders`／`resolveCatalogue` 之 `env`(金鑰來源)只驗資料屬性之值與**被取用之變數值**(getter 於取值處讀一次再判),未被取用之 getter 不執行(既有契約).
    - **`exes` 之值**:各 kind 之值須為非空字串;`undefined`／`null` 為未給該 kind(照舊略過);`''`、數字、布林、物件、陣列、包裝物件、函數、`Symbol`、`BigInt` 同步 throw.`exes` 物化一次(getter 只讀一次,檢查之值即注入之值),`resolveCatalogue` 將副本交 `resolveProviders`.
    - **`pick`**:給了而非陣列(含 `''`)同步 throw(修前視同未給而全取、含付費條目);空陣列、未給照舊(全取);元素非字串列入 `missing`(不 throw,既有).**`patch`**:給了而非物件(含陣列、`Map`)同步 throw(修前整份略過);逐 id 之非物件值仍略過(**未改,列裁示**).
    - **盤點表**(站點為 2026-11-23 本批改後之 `file:line`;全表含無效時之計費後果見 `sgud/state/state_tdai2.md`):
      | 站點 | opt | 修前處置 | 判定 | 判定函數 |
      |---|---|---|---|---|
      | `dispatchClaude.mjs:390` | `model` | 無效→不帶 `--model`,CLI 預設模型 | **拒絕** | `readNameOpt` |
      | `dispatchCodex.mjs:114` | `model` | 無效→不帶 `-m` | **拒絕** | `readNameOpt` |
      | `dispatchOpencode.mjs:322` | `model` | 無效→不帶 `-m` | **拒絕** | `readNameOpt` |
      | `dispatchAntigravity.mjs:275` | `model` | 無效→不帶 `--model`(agy 預設 Argon Medium) | **拒絕** | `readNameOpt` |
      | `dispatchAntigravity.mjs:280` | `effort` | 無效→不帶 `--effort` | **拒絕** | `readNameOpt` |
      | `dispatchOpencode.mjs:330` | `outputTokenMax` | 無效→預設 128000／呼叫端環境 | **拒絕** | `readTokenMaxOpt` |
      | `dispatchApiAnthropic.mjs:463` | `effort` | 無效→不送,API 依模型預設 | **拒絕** | `readEnumOpt` |
      | `dispatchApiTypesafeSystemone.mjs:327` | `model` | 無效→`jev-latest` | **拒絕** | `readNameOpt` |
      | `dispatchApiAnthropic.mjs:477`、`dispatchApiOpenaiCompat.mjs:395`、`dispatchApiOpenaiResponses.mjs:445`、`dispatchApiTypesafeSystemone.mjs:348` | `body` | 非物件→`{}`,預設 `max_tokens` | **拒絕** | `checkReadObj` |
      | `dispatchApiAnthropic.mjs:435` | `fetch` | 非函數→全域 `fetch`(真實請求) | **拒絕** | `readFunOpt` |
      | `dispatchClaude.mjs:401` | `fetch`(交叉確認) | 非函數→全域 `fetch` | **拒絕** | `readFunOpt` |
      | `dispatchClaude.mjs:397` | `crossCheck` | 非布林→視為開(多發請求) | **拒絕** | `readBoolOpt` |
      | `dispatchApiAnthropic.mjs:429`、`dispatchApiOpenaiCompat.mjs:372`、`dispatchApiOpenaiResponses.mjs:422` | `model` | 必填,未給或無效本就 `params` | 本就拒絕(不改) | `isestr` |
      | `resolveProviders.mjs:110-118`、`resolveCatalogue.mjs:210-216` | `env`(值)、`exes`(值)、`pick`、`patch` | 見上 | **拒絕** | `assertObjOpt(…,'env')`、`readExesOpt`、`assertArrOpt`、`assertObjOpt` |
      | `readSafeOpt.mjs:151`(`readEnvOpt`)經 `runExecCli`、四家 CLI、`filterOpencodeFree`、額度讀者 | `env`(值) | 非字串原樣交子行程(轉成字面字串) | **拒絕** | `readEnvOpt` |
      | `dispatchOpencode.mjs:336` | `agent` | 無效→`build` | **維持**(權限面而非計費;主控 tdai1b、tdai2b 裁定) | — |
      | `dispatchOpencode.mjs:384`(`checkConfigOpt`;判定在 `readSafeOpt.mjs:496`) | `config` | 非字串非物件→略過而沿用使用者既有設定(其內可載 model、provider 之預設) | **拒絕**(tdai2b 主控裁定;`''`、字串、一般物件、未給照舊) | `checkConfigOpt`(`SAFE_SPEC` opencode 加 `config`) |
      | `resolveProviders.mjs:119,214`、`resolveCatalogue.mjs:218,241`(判定在 `readSafeOpt.mjs:207,221`) | `patch` 內逐 id 之值 | 非物件值略過(丟掉覆寫之欄位如 `model`) | **拒絕**(tdai2b;`undefined`／`null` 為未給該 id) | `readPatchOpt` |
      | `resolveCatalogue.mjs:211` | `catalogue` | 非陣列→改用含付費條目之內建目錄 | **拒絕**(tdai2b;未給才用內建目錄、`[]` 合法) | `assertArrOpt` |
      | `maxRetries`、`timeoutMs`、`retryDelayMs`、`promptVia`、`printTimeout`、`stopOnLimit`、`detectTruncation`、`continueLoopOnDeny`、`acceptTruncated`、`system`、`headers`、`crossCheckModel`、`crossCheckBaseURL`、`spawnGate`、`extraArgs`、`probeAnthropicKeys.model`(非派工) | — | 無效→視為未給 | **維持 K3**(不改變計費:只會更少重試、更短逾時、更保守之旗標、或更便宜之探測) | — |
    - **訊息(K9)**:名稱型 `<name> must be a non-empty string when given (got <typeof>); …`、列舉型 `effort must be one of low, medium, high, xhigh, max when given (got <typeof>); …`、輸出上限型 `outputTokenMax must be a positive integer (number or numeric string) when given (got <typeof>); …`、函數型 `fetch must be a function when given (got <typeof>); …`、物件型 `body must be an object when given (got <typeof>); …`、`pick must be an array when given (…)`、值型 `env values must be strings when given (<n> invalid, first got <typeof>); …`／`exes values must be non-empty strings when given (…)`;皆不含值本身、變數名與 kind 名.
    - **刻意不套**:`providerTimeouts`(逾時,不改變計費);`mergeCatalogue` 單獨呼叫之 `catalogue` 非陣列仍用內建目錄(其自身之匯出契約,測試釘住;`resolveCatalogue`／`createAiCaller` 已先拒絕);`resolveProviders` 之 `env` 其未被取用且為存取器之值(不執行 getter,無從判).(2026-11-23 tdai2b 前列於此之 `patch` 內逐 id 之非物件值、`resolveCatalogue.catalogue` 為非陣列、`dispatchOpencode.config` 已套用,見下條.)
    - **tdai2b 補**(排程第 601 項主控裁定 2、3、4;與上列同一單一來源):①`patch` 內逐 id 之值給了而非一般物件(字串、數字、布林、陣列、`Map`、函數、包裝物件、`Symbol`、`BigInt`、`''`、已撤銷之 `Proxy`)同步 throw,`undefined`／`null` 為未給該 id,未列之 id 照舊:`readPatchOpt`(與 `readExesOpt` 同源之 `readMapOpt`,物化一次、於副本上驗全部值;`checkObjValues` 加 `'obj'` 種類),訊息 `patch values must be objects when given (N invalid, first got <typeof>)…`,不含 id 與值;`resolveProviders` 與 `resolveCatalogue` 皆用其副本(getter 只讀一次,K4);②`resolveCatalogue`(及經之之 `createAiCaller`)之 `catalogue` 給了而非陣列同步 throw(`assertArrOpt`,訊息 `catalogue must be an array when given…`),先於合併與讀 `envFile`;未給(`undefined`／`null`)才用內建目錄,`[]` 為合法之空目錄;③`dispatchOpencode.config` 給了而非字串亦非一般物件(數字、布林、陣列、`Map`、函數、包裝物件、`Symbol`、`BigInt`)→ `params`(`attempts 0`、不起子行程):`checkConfigOpt`(`''`、字串、一般物件、未給有效;不可讀者之訊息同修前 `config is not JSON-serializable: …`;可序列化與否仍由轉接器於序列化時判),遞補層 `SAFE_SPEC` opencode 加 `['config', 'config']`(發 `try` 之前判).事前盤點(任務書指定):README、測試與內建條目內 `config` 之既有用法——內建 `oc:`／`ocgo:` opencode 條目之 `config` 皆為物件字面量(`{ permission: { edit: 'deny', bash: 'ask' } }` 等),README 範例為物件(`configAgnes`)與 JSON 字串,測試有物件、JSON 字串、非 JSON 字串(`continueLoopOnDeny` 案)、`''`、不可序列化物件(`{ x: 10n }`)、已撤銷之 `Proxy`:合法形態皆不受影響(內建 35 條目逐條 `checkSafeOpts` 皆回空字串).

### 盤點指令與判準

- `Grep "get\(opt, '(exe|cwd|sandbox|skipPermissions|addDirs|baseURL)'" src`:每筆須緊接 `readStrOpt`／`readBoolOpt`／`readDirsOpt` 之結果判定(已套)或屬規則 5 末之不經 `readSafeOpt` 者(已套)或規則 7 之刻意不套;其餘(`isestr(exe)` 後退回預設者)為未套.
- 已套＝給了而無效回 `params`(`attempts 0`);未套＝仍退回預設;刻意不套＝規則 7.

### 對應測試

- `test/unit-safeOpts.test.mjs`(28 案:CLI 四家 `exe`／`cwd` 各 2、`sandbox`、`skipPermissions`×2、`addDirs`、REST 四家 `baseURL`＋探測／用量之 `baseURL`、A3 與額度讀者路徑各案、B2、C1、A5 兩案〔不可讀設定、`length` 非合法長度與逾 10000 把〕、A7 兩案、`checkSafeOpts` 一案等);假 CLI、全域 `fetch` 換為記錄替身、額度讀者指向空之暫存目錄,**不呼叫任何外部服務**;`before` 把 PATH 換成移除真 CLI(claude、opencode、codex、agy)資料夾者、`after` 還原(修前之無效 `exe` 會退回 PATH 上之真 CLI;自包含,不依賴外部包裝).
- 修前紅:HEAD 快照(`git archive HEAD`)上 28 案中 26 failing／2 passing(後者為 `OpenaiCompat`／`Responses` 之 `baseURL` 保持案;`checkSafeOpts` 案於案內動態匯入新模組).
- 既有三案因契約改變而改寫(舊斷言「給了而無效退回預設」):`test/unit-dispatchCodex.test.mjs`「sandbox…」、`test/unit-dispatchClaude.test.mjs`「skipPermissions…」、`test/unit-opencodeGoUsage.test.mjs`「baseURL…」;其餘既有案未因本規則而改.

- (2026-11-23 tdai1b 補)`test/unit-opencodeAuthOpts.test.mjs`(7 案:規則 9 之 provider／useStoredAuth、`checkSafeOpts('opencode', …, ctx)`、遞補層不發 `try`;含保持案)、`test/unit-envExesReject.test.mjs`(25 案:規則 10 之 E1～E7,四家 CLI ＋ `runExecCli` ＋ `filterOpencodeFree` ＋ `resolveProviders`／`resolveCatalogue`／`createAiCaller`;含「零次啟動」〔記號假執行檔、`GIT_TRACE` 觀察 git 是否被啟動〕與「env 只讀一次」〔getter 計數〕).共用之敵意值與 PATH 守門在 `test/tools/hostileValuesForTest.mjs`(單一定義,`unit-safeOpts` 同用).既有契約案改寫兩案:`unit-dispatchOpencode`「useStoredAuth…」(`'false'` 由「不注入」改為 `params` 拒絕)、`unit-probeSites`「resolveProviders…」(`env: 123`／`exes: 7` 由「視同未給」改為 throw).
- 修前紅:規則 9、10 之新案於未改 `src` 之版本上 17 failing／10 passing(後者全為保持案);其後新增之 E7 案(零次啟動、git 基準、只讀一次)與 filterOpencodeFree 之 env 交付案之紅由變異證明(E01、E07、E08、E15～E21 等).

- (2026-11-23 tdai2 補)`test/unit-billingOpts.test.mjs`(30 案:規則 11 之 B1～B9——四家 CLI 與 Typesafe 之 `model`、agy `effort`、opencode `outputTokenMax`、Anthropic `effort`、四個 REST 之 `body`、`fetch`、`crossCheck`、`checkSafeOpts` 與遞補層〔不發 `try`〕、維持 K3 之保持案、各 reader 單元)、`test/unit-envExesValues.test.mjs`(34 案:V1～V7——`exes` 各值、`env` 各值〔含實測語意:`undefined` 為移除、`null` 拒絕、零次啟動、只讀一次〕、額度讀者、目錄展開之 `env`、`pick`、`patch`、`checkObjOpt`／`checkArrOpt`).既有契約案改寫 9 案:`unit-dispatchApiAnthropic`「effort…」、`unit-dispatchApiAnthropicFailureKind`「opt.fetch…」、`unit-dispatchClaude`／`unit-dispatchCodex`「model…」、`unit-dispatchClaudeFailureKind`「crossCheck預設開…」、`unit-envExesReject`(E3 之 `exes` 保持案移除、E5 getter 計數案分 env／exes)、`unit-opencodeTruncation`(D1「非預期輸入…」)、`unit-probeSites`(pick／patch)、`unit-resolveCatalogue`(patch).
- 修前紅:以 HEAD 快照(`git archive HEAD`)為修前碼,新測試 `unit-billingOpts` 30 案中 18 failing／12 passing(後者為保持案)、`unit-envExesValues` 34 案中 27 failing／7 passing(保持案:六個 CLI 入口之「env 值為字串照舊」與「`pick` 空陣列／未給全取」),9 案改寫既有契約案 9 failing(皆於 `./tmp/tdai2/pre/` 之 HEAD 快照上實跑,新測試檔之 `readSafeOpt` 具名匯入改為命名空間匯入以逐項紅燈).

- (2026-11-23 tdai2b 補)`test/unit-patchCatalogueConfig.test.mjs`(13 案:P1 patch 逐 id 之值×4〔含 getter 只讀一次、檢核先於合併、`readPatchOpt`〕、C1 `catalogue`×2、O1／O2 opencode `config`×7〔含不可讀之訊息同修前、`continueLoopOnDeny` 並用、`checkSafeOpts`、遞補層不發 `try`、內建 35 條目皆通過〕).既有契約案改寫 4 案:`unit-opencodeAuthOpts`(P2 之 `config: 123`／`true` 改為拒絕)、`unit-dispatchOpencode`(「config非有效物件或字串時不注入」之 `123`／`[]` 改為拒絕;**事前以 `Grep` 盤點漏了簡寫形式 `{ exe, config }`,首次全套才抓到此案**)、`unit-probeSites`(`catalogue: 123` 改為 throw)、`unit-resolveCatalogue`(`patch` 內逐 id 之值);`unit-billingOpts` 之 B8 移除 `config` 之保持斷言.
- 修前紅(tdai2b):以 tdai2 成果之工作樹快照(`./tmp/tdai2b/pre/`)為修前碼,新測試 13 案中 8 failing／5 passing(保持案:有效之 `patch`／`catalogue`／`config`、`agent`、內建條目),4 案改寫之既有契約案 4 failing.

- (2026-11-23 tdai2c 補)**需真 CLI＋本機假服務之 `api-` 測試,於改動相關 opt(`outputTokenMax`、`env`、`config`、`model` 等經轉接器送往該 CLI 者)時,須以真 PATH 跑過**(`test/api-opencodeOutputCap.test.mjs`:`node node_modules/mocha/bin/mocha.js test/api-opencodeOutputCap.test.mjs --no-parallel --timeout 180000`,經 `quiet-run --lock`):前三輪(tdai2、tdai2b 及其前)全套皆自 PATH 移除真 CLI(以免誤呼外部服務),此檔整檔 pending 而其 A2 之舊斷言(opt 無效 ⇒ 預設)未被跑到,至發布閘門(真 PATH)才紅 1 案;tdai2c 已改寫(opt 給了而無效 ⇒ `params`、假服務未收到請求;環境內之無效值仍 ⇒ 預設),並以哨兵全套(真 CLI 以記錄用之 `.cmd` 取代)確認整個測試目錄「以預設名稱啟動真 CLI」僅 2 處:此檔之 `opencode --version` 與 `api-providersOpencodeFree` 之 `opencode models --refresh`(後者連 models.dev 更新型錄快取,非 AI 推論;不單獨於真 PATH 跑).

### 變異驗證

見 `sgud/state/state_tdai2.md`〈驗證〉(tdai2:70 項單點變異,終局全殺死;含互為備援者之成對變異;tdai2b:25 項〔MP／MC／MR 系列,含成對 MP10、MC10〕全殺死);

見 `sgud/state/state_tdai1.md`〈驗證〉(S 系列 41 項;變異腳本為一次性、不入庫).tdai1b 之 P 系列 14 項(規則 9)、E 系列 28 項(規則 10,含 3 組互為備援之成對變異)見 `sgud/state/state_tdai1b.md`.
