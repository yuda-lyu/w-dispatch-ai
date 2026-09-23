// providers.mjs — 預設providers定義檔(實測可用之供應商條目, 開發端可直接全用或自選)
//
// 【性質】純資料檔, 不讀環境變數。金鑰以envVar間接引用(機密不落設定檔),
//   使用前須經resolveProviders展開(envVar → keys, 缺變數者自動停用並回報);
//   展開後之陣列可直接餵dispatchAiFallback, table可直接餵dispatchAiWkf。
//
// 【id命名】依「路徑:模型」規則(詳dispatchAiFallback.mjs檔頭之id設計規則):
//   oc:＝經opencode CLI(有工具、較慢) / agy:＝antigravity CLI / claude:/codex:＝訂閱登入態CLI
//   zen:/agnes:/poolside:＝REST直呼(免CLI免登入、快, 純文字生成)
//   typesafe:＝REST直呼之決策模型(非文字生成, 須給questions, 見該條註解)
//   同一模型之CLI版與REST版屬不同供應商(能力與額度池皆不同), 故各為一條。
//
// ══════════════════════════════════════════════════════════════════════════════
// 【OpenCode Zen 接入方式——動 zen:條目前必讀, 免得又把「打錯端點」誤判成「模型壞了」】
// ══════════════════════════════════════════════════════════════════════════════
//
//   權威來源(有疑問先查, 不要憑既有條目推論; 2026-09-22改以v2為主, 因opencode已發布v2(2.0.6)且v1文件日後將移除):
//     https://opencode.ai/v2/docs/console/models/  ← 【主】v2之Zen資料改名置於Console區塊, 含端點欄與計價表
//     https://opencode.ai/zen/v1/models            ← 【可用性之唯一事實】當前可用model id清單(需Bearer金鑰)
//     `opencode models opencode --refresh`         ← CLI側之同一事實(CLI catalog, 匿名亦可查)
//     https://opencode.ai/docs/zen/                ← v1文件, 過渡參考(將移除, 勿長期依賴)
//
//   ★ 兩份文件之模型集不一致, 且皆不等於可用性(2026-09-22逐一實測) ★
//     v2頁列為Free但實測全不可用(CLI回UnknownError、REST回400 Upstream request failed: Model is unavailable):
//       deepseek-v4-flash-free / laguna-s-2.1-free / ling-3.0-tiny-free / longcat-2.0-free / north-mini-code-free
//     v1頁有而v2頁未列, 但實測可用: mimo-v2.6-flash-free / jev-1.13-free / muse-spark-1.2與1.3 / nemotron-3.5-lightning-free
//     兩頁皆列且實測可用: big-pickle(CLI 7.1s) / mimo-v2.5-free / nemotron-3-ultra-free
//     故判準固定為: 文件只用於「端點種類與計價」, 「能不能用」一律以/zen/v1/models或`opencode models`加實測為準。
//
//   ★ 核心事實: zen「不是」單一OpenAI相容端點, 端點依模型家族而異 ★
//     依官方文件之端點欄(2026-09-22以v2 Console/Models頁複查, 分佈與v1一致):
//       /zen/v1/chat/completions   @ai-sdk/openai-compatible  ← 本套件api-openai-compat僅支援此種
//         mimo-v2.5-free / ling-3.0-flash-fin-free / nemotron-3-ultra-free /
//         nemotron-3.5-lightning-free / big-pickle / glm-* / kimi-* / minimax-* / deepseek-v4-*
//       /zen/v1/responses          @ai-sdk/openai        (OpenAI Responses API, 非chat/completions)
//         muse-spark-1.2-contributor-free / muse-spark-1.3-contributor-free / GPT系 / Grok系
//       /zen/v1/messages           @ai-sdk/anthropic     Claude系 / Qwen系(qwen3.5~3.7-plus/max)
//       /zen/v1/models/<model-id>  @ai-sdk/google        Gemini系
//       /zen/v1/systemone          (TypeSafe System One)  ← 本套件api-typesafe-systemone
//         jev-1.13-free / jev-1.13 (2026-09-22查證; 非文字生成之決策模型, 須給questions)
//
//   ★ 因此: 模型出現在/models清單 ≠ 可用kind:'api-openai-compat'收錄 ★
//     dispatchApiOpenaiCompat固定POST至<baseURL>/chat/completions(那是它的定義, 非bug),
//     對走/responses或/messages的模型必然失敗, 且失敗碼是HTTP 500(不是404/400),
//     極易被誤讀為「模型故障, 等一下就好」而反覆重試——實際上再等一年也不會通。
//     殷鑑(2026-09-03): muse-spark-1.2/1.3走/chat/completions連續10次500,
//     同金鑰同模型改打/responses立即200且正常作答;
//     且1.2於2026-08-21曾以/chat/completions實測3.9s成功——即opencode「事後改過路由」,
//     故「以前能用」不構成「現在該能用」的證據, 一律回頭查文件端點欄。
//
//   ★ 收錄zen:條目前之檢核(缺一不可) ★
//     ① 該model id在 /zen/v1/models 清單內;
//     ② 依官方文件端點欄挑對kind: /chat/completions → api-openai-compat;
//        /responses → api-openai-responses; /systemone → api-typesafe-systemone(須給questions);
//        /messages與/models/<id> 本套件尚無對應kind,
//        不得硬收為既有kind(必失敗), 需要時改收其opencode CLI版(oc:);
//     ③ 實測至少連續數次200(端點時斷時續者仍可收, 但須於條目註解記錄可用率, 見ling條)。
//
//   ★ 診斷流程(收到失敗時先分類, 不要直接歸咎模型) ★
//     HTTP 500  → 先驗端點: 查文件端點欄; 該走/responses卻打了/chat/completions即為此症。
//                 驗法: curl -X POST https://opencode.ai/zen/v1/responses \
//                        -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
//                        -d '{"model":"<id>","input":"hi"}'   → 200即證明是端點問題非模型問題
//     HTTP 503  → 上游時斷時續(server_error: Upstream request failed: Endpoint is unavailable),
//                 暫時性, 遞補層換家即可; 判別法: 同時段打另一免費模型作對照組。
//     HTTP 429  → 閘道容量型限流(FreeUsageLimitError), 與金鑰無關(換金鑰照樣429), 暫時性。
//     HTTP 403 FreeTierError(free tier can only be used from within OpenCode)
//               → 該免費模型只開放opencode客戶端, REST直呼被刻意擋下(2026-09-17 union-alpha實測), 屬政策非故障,
//                 只能收oc:版。另401 Model is disabled＝該金鑰所屬工作區未開此模型, 換工作區或於後台開啟
//                 (未注入金鑰時opencode會沿用本機auth.json之登入, 故此症亦見於「不帶key」之呼叫;
//                  要以匿名免費存取呼叫, 於條目加useStoredAuth:false, 見dispatchOpencode.mjs檔頭)。
//     HTTP 401/400 → 額度/促銷結束或模型暫時下架(訊息如Free promotion has ended、
//                 Upstream request failed: Model is unavailable), 屬服務端狀態非設定錯誤。
//     任一碼皆非「條目寫錯」之證據——model id寫錯時閘道回的是其他4xx且訊息明指model。
//
//   ★ Zen免費層閘門(2026-09-17起, 維護者rekram1-node於issue #49580明示: 免費層只准在opencode本體內使用,
//     屬刻意之反濫用政策; 付費模型不受限) ★
//     症狀: 403 FreeTierError「OpenCode's free tier can only be used from within OpenCode」。
//     判定依據(2026-09-18本機矩陣實測, opencode 1.18.31):
//       - REST直呼(任何金鑰): /chat/completions與/responses之免費模型一律403 → 該類zen:條目自此為政策性失效。
//         例外(2026-09-22實測): /systemone之jev-1.13-free不受此閘門, 帶金鑰或匿名皆200(0.6~1.2s)——
//         閘門只套在對話型免費模型, 故zen:jev-1.13-free之REST條目可用(見該條)。
//       - opencode CLI匿名或帶金鑰: 通過; 但注入的設定若把bash工具deny掉(permission.bash:'deny'、
//         舊式tools.bash:false、agent覆寫deny)即被判非opencode而403; 只deny edit、或改為ask則通過。
//         即閘門以「請求之工具清單是否含bash」為指紋之一(另一指紋為User-Agent之版本字串, 非正式版build被拒)。
//       - 帶金鑰時另受該金鑰所屬工作區之模型開關影響(第1把金鑰對免費模型回Model access is disabled且耗76s)。
//     處置: oc:opencode/*免費條目改匿名(useStoredAuth:false, 不帶envVar), 防寫改為OC_READONLY(見該常數註解)。
//     使用者側若另注入config, 切勿deny bash; 需要更緊之鎖請改用付費模型或其他CLI。
//
//   ★ 走不通REST時的替代路徑: 同模型改用oc:(opencode CLI) ★
//     opencode CLI內建各模型正確的端點與AI SDK, 故REST不通的模型走CLI往往正常
//     (實測: muse-spark 1.2/1.3之REST 500而CLI皆秒級成功)。CLI版模型id為
//     `opencode/<model-id>`, 可用 `opencode models` 列出; 兩者屬不同供應商條目(見id命名)。
//
// 【zen免費模型清單為「更新日快照」, 不保證即為當前狀態】zen:系收錄截至2026-08-21
//   經GET https://opencode.ai/zen/v1/models 查得之免費模型(*-free), 不做好用篩選——
//   新模型會上線、舊模型可能下架或限流, 且各模型能力/速度/輸出習慣差異極大
//   (各條目註解記錄已測特性), 由呼叫端自行評估選用; 要查當前清單, 以OPENCODE_KEYS
//   打上述/models端點即可。暫時打不通的條目(限流/額度/上游中斷)依本套件哲學保留不移除:
//   恢復的偵測就是下次再打一次, 代價僅一次快速失敗(fallback/cooldownMs即為此而生);
//   但「端點種類不符」(如上述muse-spark走/responses)屬結構性錯配而非暫時失敗, 不適用此哲學。
//   2026-09-03複查之漂移: 新增muse-spark-1.3-contributor-free(端點為/responses,
//   同日新增api-openai-responses轉接器後已收錄zen:版, 另亦收其opencode CLI版)
//   與ling-3.0-flash-fin-free(已收錄, 上游時斷時續詳見該條); zen:x-preview-f-free與zen:hy3-free已自本檔移除——兩者同時滿足
//   「不在/models清單」與「實測回401」兩條件, 屬服務端已下架而非暫時限流,
//   留著只會讓全取者每輪空耗兩次快速失敗。
//   2026-09-17~18之漂移(union-alpha, 收錄後隔日即移除, 記此以免下次又走一遍):
//     17日官方文件列Union Alpha Free(限時免費之stealth模型, 端點/messages), opencode CLI清單有
//     opencode/union-alpha, 以匿名免費存取實測6.8~7.0s成功, 故收oc:版(REST因403 FreeTierError不收);
//     18日該模型揭曉為Pareto 26.9並提前結束免費測試、轉付費接入, 同日複查: zen /models與
//     `opencode models opencode --refresh`皆已無此id, 匿名呼叫連3次回UnknownError(Unexpected server error),
//     同時滿足「不在清單」與「實測失敗」兩條件(同x-preview-f-free/hy3-free之先例), 故自本檔移除。
//     日後若要接其付費版, 須另備付費金鑰並確認端點(/messages為本套件尚無之kind)。
//   2026-09-22之漂移: 新增oc:opencode/mimo-v2.6-flash-free(CLI清單已有, 匿名實測7.0s)
//     與zen:jev-1.13-free(端點/systemone, 詳該條); jev無法經CLI呼叫(非對話模型, 不在opencode models清單,
//     實測UnknownError)。
//   big-pickle之收錄經過(2026-09-22, 記此以免再繞一圈): 先因「id不帶*-free後綴」被判為付費而不收,
//     後以原始HTML逐列核對v1與v2文件之〈Pricing〉表, 兩份皆列「Big Pickle | Free | Free | Free | -」,
//     說明亦為「Big Pickle is a stealth model that's free on OpenCode for a limited time」, 同日匿名CLI
//     實測7.1s可用, 據此收錄oc:版。教訓: 〈Models〉表(名稱/id/端點/SDK)不含價格欄, 只看該表看不出免費;
//     *-free命名並非可靠之免費判準(big-pickle即反例), 判免費一律看〈Pricing〉表。
//     另官方〈Privacy〉載明big-pickle與各*-free模型於免費期間所收資料可能用於改進模型, 敏感內容勿走免費模型。
//   2026-09-22移除deepseek-v4-flash-free之兩條目(oc:與zen:, 使用者指示): v1文件已無此id(僅列付費版
//     deepseek-v4-flash $0.14/$0.28、v4-pro、v4.1-flash、v4-flash-vision-exp); v2文件雖仍列其為Free,
//     但zen /models與CLI catalog皆無, 實測CLI回UnknownError、REST回400「Model is unavailable.」
//     ——即v2頁該列為過期資料, 免費變體已終止而非暫時限流。
//   2026-09-22移除zen:laguna-s-2.1-free(同上兩條件: 不在/models清單且實測400 Model is unavailable;
//     v2文件仍列其為Free亦屬過期)。註: poolside之兩條目(oc:poolside/與poolside:)走Poolside官方端點,
//     與此zen轉售條目無關, 實測仍可用故保留。
//   2026-09-22移除全部「對話型免費模型之zen:REST條目」共6條(使用者指示): zen:muse-spark-1.2與1.3
//     (/responses)、zen:mimo-v2.5-free、zen:ling-3.0-flash-fin-free、zen:nemotron-3-ultra-free、
//     zen:nemotron-3.5-lightning-free(/chat/completions)。理由: 自2026-09-17之免費層閘門起,
//     此6條當日逐條實測一律403 FreeTierError(每條兩把金鑰各試一次, 全取遞補每輪多耗5.05s),
//     且維護者已明示為刻意政策而非故障, 故不適用「暫時失敗保留」之哲學。同模型之CLI版(oc:opencode/*)
//     不受影響且已收錄, 能力覆蓋相同。日後政策放寬時, 依檔頭收錄檢核重新收錄即可(端點種類見端點表)。
//     副作用: 移除後預設清單已無api-openai-responses之條目(該kind仍受支援, 僅無預設條目)。
//
// 【使用方式】
//   import providers from 'w-dispatch-ai/src/providers.mjs'
//   import resolveProviders from 'w-dispatch-ai/src/resolveProviders.mjs'
//   import readEnvFile from 'w-dispatch-ai/src/readEnvFile.mjs'
//   let env = readEnvFile('./.env') //OPENCODE_KEYS/AGNES_KEYS/POOLSIDE_KEYS/TYPESAFE_KEYS, 逗號分隔多把; 不污染process.env
//   let { providers: ps, table, skipped } = resolveProviders(providers, { env }) //全取
//   let r2 = resolveProviders(providers, { env, pick: ['agnes:agnes-3.0-flash', 'claude:sonnet'] }) //自選, pick順序即遞補優先序
//   let r3 = resolveProviders(providers, { env, pick: ['typesafe:jev-latest'] }) //決策模型單獨取出
//   await dispatchAiFallback(state, { providers: r3.providers, questions }) //questions置呼叫層
//
// 【timeout規劃】各條目刻意不帶timeoutMs, 由上層依任務型態統一給定、條目僅於特例覆寫:
//   簡單任務(秒級~分鐘級): 沿用套件統一預設即可(全轉接器一律300000＝5分鐘, 見dfTimeoutMs.mjs)。
//   複雜任務(單一AI工作約15分鐘、fallback須能走到最末):
//     timeoutMs:    1200000 (20min＝15min工作＋33%餘裕, 單次嘗試上限)
//     minAttemptMs: 1200000 (剩餘預算不足完整視窗即不開工——開了也不可能完成, 純浪費)
//     budgetMs:     鏈長K×timeoutMs (逾時型失敗每組只燒一次timeout即跳組, 故K×20min
//                   保證能走到最末; 例K=4 → 4800000＝80min。無外部排程時限則可null＝不限)
//     agy之printTimeout由timeoutMs自動推導(−30s), 無須另設。
//   工作流層總時長: RolePipeline為各階段序列相加(M階段≈M×名額預算);
//   Fanout各名額並行(≈單一名額預算＋整合名額預算), 外部排程上限須據此預留。
//   外部調整四層(細者覆蓋粗者): dispatchAiWkf之defaults(全域) → 各工作流callOpt
//   → 各階段/名額規格 → 各provider條目。


//opencode條目共用之機械防寫(單一來源, 各oc:條目引用而不手寫):
//  edit:'deny' 擋write/edit/patch(opencode之edit涵蓋三者, 無獨立write鍵);
//  bash:'ask'  而非'deny'——2026-09-18實測: Zen免費層閘門以「bash工具是否存在」判定是否為opencode本體,
//              deny會把bash自工具清單移除而被判非opencode(403 FreeTierError), ask則工具仍在;
//              而`opencode run`為非互動, ask一律自動拒絕(stderr: The user rejected permission),
//              金絲雀實測寫檔與shell建檔皆未落地, 故仍為機械鎖。注意呼叫端勿另傳--auto(會把ask放行)。
//  agnes/poolside走opencode但非Zen免費層, 不受閘門影響, 為對稱亦用同一鎖(bash:ask之拒絕行為相同)。
let OC_READONLY = { edit: 'deny', bash: 'ask' }


//claude條目共用之機械防寫(單一來源): 白名單而非黑名單。
//  原為黑名單['--disallowedTools','Write,Edit,NotebookEdit,Bash'], 2026-09-23金絲雀實測已失效——
//  Windows版Claude Code(2.1.280)另有PowerShell工具不在黑名單內, opus-5.5與sonnet皆改用
//  PowerShell之Set-Content寫檔落地(以--output-format stream-json之tool_use確認); 此外工具清單尚含
//  Workflow/Task/Cron/SendMessage/Artifact等35項及claude.ai連接器之MCP工具(含create/update/delete,
//  可寫入外部服務)。黑名單每逢CLI新增工具即破, 故改白名單:
//  --tools Read,Glob,Grep  只開放讀檔三工具(內建工具之白名單);
//  --strict-mcp-config     排除所有MCP工具(--tools不管MCP, 單用時claude.ai Docs之寫入工具仍在)。
//  同日實測: 工具清單恰為Glob,Grep,Read; 要求寫檔(含指明可用PowerShell)未落地; 讀檔正常作答。
//  代價: 失去WebFetch/WebSearch等網路讀取工具; 需要時於條目覆寫extraArgs自行加入。
let CLAUDE_READONLY = ['--tools', 'Read,Glob,Grep', '--strict-mcp-config']


let providers = [

    //cli版
    //agnes: 2026-09-14以2.5→3.0(官方2026-09-11發布, /models已列; 五題探測3.0答對推理題而2.5答錯,
    //3.0總耗時41s對2.5之281s; 3.0僅「三點條列」未加項目符號), 兩條目同步改, 舊版2.5仍在/models但不再收錄
    {
        id: 'oc:agnes-ai/agnes-3.0-flash',
        model: 'agnes-ai/agnes-3.0-flash',
        kind: 'opencode',
        envVar: 'AGNES_KEYS',
        provider: 'agnes-ai',
        config: {
            provider: {
                'agnes-ai': {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Agnes',
                    options: { baseURL: 'https://apihub.agnes-ai.com/v1' },
                    models: { 'agnes-3.0-flash': { name: 'Agnes 3.0 Flash' } },
                },
            },
            permission: OC_READONLY,
        },
    },
    {
        id: 'oc:poolside/poolside/laguna-s-2.1',
        model: 'poolside/poolside/laguna-s-2.1',
        kind: 'opencode',
        envVar: 'POOLSIDE_KEYS',
        provider: 'poolside',
        config: {
            provider: {
                'poolside': {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Poolside',
                    options: { baseURL: 'https://inference.poolside.ai/v1' },
                    models: { 'poolside/laguna-s-2.1': { name: 'Laguna S 2.1' } },
                },
            },
            permission: OC_READONLY,
        },
    },
    //oc:opencode/*免費模型: 2026-09-18起改為匿名免費存取(不帶envVar、useStoredAuth:false), 理由見檔頭
    //【Zen免費層閘門】——帶金鑰反而依該金鑰所屬工作區之模型開關而異(第1把實測Model access is disabled)
    {
        id: 'oc:opencode/muse-spark-1.2-contributor-free',
        model: 'opencode/muse-spark-1.2-contributor-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        //2026-09-03實測8.1s(opencode CLI 1.18.27); 同模型另有zen:REST版, 額度池與故障域各自獨立
    },
    {
        id: 'oc:opencode/muse-spark-1.3-contributor-free',
        model: 'opencode/muse-spark-1.3-contributor-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        //2026-09-03實測6.1s(opencode CLI 1.18.27)。註: 同日同模型走zen REST回HTTP 500,
        //僅CLI路徑可用——同模型不同路徑屬不同供應商之實例(故未增zen:對應條目)
    },
    {
        id: 'oc:opencode/big-pickle',
        model: 'opencode/big-pickle',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        //Big Pickle: id不帶*-free後綴但官方確為免費——v1與v2文件之〈Pricing〉同列「Free|Free|Free|-」,
        //說明為限時免費之stealth模型。2026-09-22匿名CLI實測7.1s成功(REST為403免費層閘門故不收zen:版)。
        //注意官方〈Privacy〉載明: 免費期間所收資料可能用於改進模型(各*-free模型亦同), 敏感內容勿走此條
    },
    {
        id: 'oc:opencode/mimo-v2.6-flash-free',
        model: 'opencode/mimo-v2.6-flash-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        //2026-09-22新增(官方文件與CLI清單皆有, 端點/chat/completions): 匿名CLI實測7.0s成功;
        //REST不收zen:版——同日實測403 FreeTierError(對話型免費模型之閘門, 見檔頭)
    },
    {
        id: 'agy:gemini-3.8-flash-high',
        model: 'gemini-3.8-flash-high', //2026-09-03自3.7升版(agy 1.1.25): 實測12.5s vs 3.7之62.2s, 讀檔14.6s vs 57.6s
        kind: 'antigravity',
        addDirs: ['.'],
        //保留CLI權限閘門(條目自帶防寫, 與其餘三家CLI條目一致): canary實測(2026-08-15)
        //無此鎖時要求建檔會真的落地(12.5s); false之下寫入被擋且不卡逾時(6.4s正常返回)、
        //唯讀工具照常(8.0s讀檔答對)。注意被擋時agy回ok:true且stdout為空(靜默拒絕非報錯),
        //工作流層無害(空回覆過不了validate而自動遞補); 需要寫入能力請於條目覆寫為true
        skipPermissions: false,
    },
    //claude/codex各兩條: 在前者為預設(全取遞補時先試), 在後者為較強之新模型(2026-09-23使用者指示)
    {
        id: 'claude:sonnet',
        model: 'sonnet',
        kind: 'claude',
        extraArgs: CLAUDE_READONLY,
    },
    {
        id: 'claude:opus-5.5',
        model: 'claude-opus-5-5',
        kind: 'claude',
        extraArgs: CLAUDE_READONLY,
        //2026-09-23新增Opus 5.5(官方2026-09-22發布, API id claude-opus-5-5): Claude Code 2.1.280實測4.9~5.1s,
        //以--output-format json之modelUsage確認實際服務模型為claude-opus-5-5。
        //刻意寫全名而非別名'opus': 別名當下雖同樣指向5.5(同日實測), 但日後新版Opus發布時會無聲切換,
        //全名可令條目行為固定。註: 走訂閱登入態, Opus之單次耗用額度高於Sonnet, 故排在sonnet之後
    },
    {
        id: 'codex:gpt-5.6-luna',
        model: 'gpt-5.6-luna',
        kind: 'codex',
        sandbox: 'read-only',
    },
    {
        id: 'codex:gpt-6-sol',
        model: 'gpt-6-sol',
        kind: 'codex',
        sandbox: 'read-only',
        //2026-09-23新增GPT-6 Sol(官方定位複雜程式與agentic工作): Codex CLI 0.156.1(穩定版)實測6.3~6.9s,
        //該帳號之app-server model/list已列gpt-6-sol/gpt-6-luna/gpt-6-astra; 金絲雀實測唯讀沙箱擋下寫檔。
        //openai/codex issue #47420稱「僅alpha版可用」係0.154.0使用者之回報, 0.156.1已不成立;
        //若本機為較舊之codex而清單無此模型, 先執行`codex update`。推理強度沿用使用者config(實測為high)
    },

    //api版
    {
        id: 'typesafe:jev-latest',
        model: 'jev-latest',
        kind: 'api-typesafe-systemone',
        envVar: 'TYPESAFE_KEYS',
        //TypeSafe之jev為決策模型(非文字生成): prompt為被評估之state, 呼叫時須給questions, 回型別化答案。
        //2026-09-17實測0.3~1.0s(實際版本jev-1.13.0); 官方無CLI故僅此API條目。用法: 以pick單獨取出,
        //questions置dispatchAiFallback呼叫層(詳dispatchApiTypesafeSystemone.mjs檔頭)。
        //混入文字遞補鏈(全取)時: 因無questions而以params錯誤0ms失敗(逐把金鑰各一次)後換下一家, 不影響他家(2026-09-17實測);
        //刻意不放清單末端——前面全敗時fallback回傳最後一筆失敗, 放末端會以「questions必填」掩蓋真正原因
    },
    {
        id: 'zen:jev-1.13-free',
        model: 'jev-1.13-free',
        kind: 'api-typesafe-systemone',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        //TypeSafe之jev經OpenCode Zen轉售(端點/zen/v1/systemone, 故用同一kind), 決策模型非文字生成:
        //用法與typesafe:jev-latest相同(pick單獨取出、questions置呼叫層, 詳dispatchApiTypesafeSystemone.mjs檔頭)。
        //2026-09-22實測: 連3次200(0.66~1.24s), 答案與TypeSafe官方端點一致(同題category相同、noul差0.01);
        //不帶金鑰亦200(0.57s), 即Zen對話型免費模型之403閘門不套用於/systemone; 壞金鑰回401 AuthError。
        //付費版jev-1.13未收: 同日以第1把金鑰實測403(Upstream request failed: Model access is disabled),
        //屬該金鑰工作區未開此模型; 要收須先於Zen後台開啟並確認計費($0.042/1M輸入)。
    },
    //zen:系為2026-08-21快照(檔頭聲明), 各條註記當日以「請只回覆兩個字：完成」實測之結果
    {
        id: 'agnes:agnes-3.0-flash',
        model: 'agnes-3.0-flash',
        kind: 'api-openai-compat',
        envVar: 'AGNES_KEYS',
        baseURL: 'https://apihub.agnes-ai.com/v1',
        body: { max_tokens: 8192 },
    },
    {
        id: 'poolside:laguna-s-2.1',
        model: 'poolside/laguna-s-2.1',
        kind: 'api-openai-compat',
        envVar: 'POOLSIDE_KEYS',
        baseURL: 'https://inference.poolside.ai/v1',
        body: {
            max_tokens: 8192,
            chat_template_kwargs: { enable_thinking: false },
        },
    },

]


export default providers
