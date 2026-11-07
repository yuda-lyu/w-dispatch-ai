// providers.mjs — 預設providers定義檔(實測可用之供應商條目, 開發端可直接全用或自選)
//
// 【性質】純資料檔, 不讀環境變數。金鑰以envVar間接引用(機密不落設定檔),
//   使用前須經resolveProviders展開(envVar → keys, 缺變數者自動停用並回報);
//   展開後之陣列可直接餵dispatchAiFallback, table可直接餵dispatchAiWkf。
//
// 【id命名】依「路徑:模型」規則(詳dispatchAiFallback.mjs檔頭之id設計規則):
//   oc:＝經opencode CLI(有工具、較慢) / agy:＝antigravity CLI / claude:/codex:＝訂閱登入態CLI
//   ocgo:＝同opencode CLI但走OpenCode Go月費訂閱額度(provider opencode-go, envVar OPENCODE_GO_KEYS; 與oc:額度池不同, 見下方【OpenCode Go】段)
//   claude-api:＝經Claude Code CLI但以Anthropic Console之API金鑰計費(有工具; 與claude:同CLI、不同計費路徑故為不同供應商, envVar ANTHROPIC_KEYS)
//   zen:/agnes:/poolside:＝REST直呼(免CLI免登入、快, 純文字生成)
//   anthropic:＝REST直呼Anthropic Messages API(純文字生成, 以Console之API金鑰計費, envVar ANTHROPIC_KEYS)
//   typesafe:＝REST直呼之決策模型(非文字生成, 須給questions, 見該條註解)
//   同一模型之CLI版與REST版屬不同供應商(能力與故障域不同; 額度池多半也不同), 故各為一條。
//   例外: claude-api:(CLI)與anthropic:(REST)同用ANTHROPIC_KEYS、共享同一Console額度與帳務, 僅游標與冷卻狀態按條目id各自獨立——
//   一條遇429冷卻不會自動冷卻其他五條, 全取時同批金鑰可能被六條逐條重探(計費), 建議以pick自選。
//
// 【Anthropic API金鑰條目(claude-api:與anthropic:共6條, 2026-10-24新增)】計費條目, 集中於清單末端(全取遞補時最後才輪到, 先CLI後REST):
//   - 金鑰一律放.env的ANTHROPIC_KEYS(逗號分隔多把), 經readEnvFile讀入、resolveProviders依envVar展開; 缺則該6條自動skipped。
//     「不得」用ANTHROPIC_API_KEY當.env變數名或設為全域環境變數: Claude Code在-p模式「一律使用」它, 本機全部Claude Code(含claude:訂閱條目與使用者自己的工作階段)會因而改走API計費;
//     本檔條目刻意只認ANTHROPIC_KEYS, 金鑰只在該次呼叫由dispatchClaude注入子進程環境(見dispatchClaude.mjs檔頭)。
//   - 要工具(讀檔、grep)用claude-api:(CLI, 防寫白名單同claude:條目); 純文字用anthropic:(REST, 免CLI, 天然無寫檔能力)。
//   - 限流與額度(2026-10-25起): 六條皆由轉接器對失敗結果加failureKind細分類(沒額度/脈絡過長/限流/過載/金鑰無效/無權限/網路/呼叫方式或環境錯誤/其他),
//     遞補層(dispatchAiFallback)據以處置——沒額度換下一把且本次呼叫內claude-api:與anthropic:共用額度池故同一把不重複試、脈絡過長立即結束整個呼叫、網路不換金鑰;
//     CLI稱沒額度者以同金鑰REST極小請求交叉確認(成功則為環境錯誤而非沒額度)。判準、依據與未實測者見README「Claude以API金鑰計費」之「失敗細分類 failureKind」。
//   - 確認「確實走API金鑰」: CLI類以`--output-format stream-json --verbose`之首個system/init事件apiKeySource須為'ANTHROPIC_API_KEY'(必要條件, 充分條件另核對Console用量); REST類以回應之usage與Console用量。
//
// ══════════════════════════════════════════════════════════════════════════════
// 【OpenCode Console(原OpenCode Zen) 接入方式——動 zen:條目前必讀, 免得又把「打錯端點」誤判成「模型壞了」】
// ══════════════════════════════════════════════════════════════════════════════
//
//   權威來源(有疑問先查, 不要憑既有條目推論; 2026-11-03逐頁重查: 官方文件與網站導覽已無Zen之名, 一律稱OpenCode Console):
//     https://opencode.ai/v2/docs/console/api/inference/ ← 【主】Inference API: 基底https://opencode.ai/inference、各協定路徑、認證(Authorization: Bearer)、usage.opencode計費欄位
//     https://opencode.ai/v2/docs/console/models/  ← 【主】各模型之端點欄(完整URL)與計價表
//     https://opencode.ai/v2/docs/console/api/     ← 金鑰(前綴oc_sk_、有效期、權限範圍)、服務帳戶; 撤銷或過期回401, 超出金鑰權限回403
//     https://opencode.ai/v2/docs/console/harnesses/ ← 付費與Go文字模型可經任一協定(非原生者由Console轉譯)、Go基底/inference/go與x-opencode-session
//     https://opencode.ai/v2/docs/console/budgets/ ← 預算用盡之429(Upstream request failed: Policy budget exceeded)
//     https://opencode.ai/inference/v1/models      ← 當前model id清單; 匿名亦可查(2026-11-03: 79個, 其中免費9個), 帶金鑰者依該金鑰之工作區與權限縮減
//                                                    (同日本機第1把金鑰9個且皆免費、第2把79個), 故判「能不能用」須以實際要用的那把金鑰查;
//                                                    jev-1.13-free不在任一清單卻可用(見收錄檢核①)
//     `opencode models opencode --refresh`         ← CLI側之清單(CLI catalog, 匿名亦可查; 有本機快取, 見R-OCFREE-2④)
//     舊網址opencode.ai/zen、/docs/zen/、/docs/zh-tw/zen/: 2026-11-03實測皆302轉至Console頁, 不再作為來源
//
//   ★ 端點基底改名與分流(2026-11-03查證) ★ API基底為https://opencode.ai/inference, 其後依協定分流(見下方核心事實段),
//     不再是單一的https://opencode.ai/inference/v1(2026-10-13之基底)或更早的https://opencode.ai/zen/v1。
//     模型清單為例外: 官方仍是/inference/v1/models(同日實測200; /inference/openai/v1/models為404)。
//     舊式jev路徑同日仍通: zen:jev-1.13-free於/inference/systemone/v1/systemone(官方)、/inference/v1/systemone、/zen/v1/systemone
//     匿名各1次皆200(0.4~0.8s, noul 0.97/0.97/0.98), 新路徑帶第1把金鑰亦200; 惟官方文件已不列舊路徑, 本套件不留舊路徑退路——
//     目錄內條目一律用官方端點欄所列之路徑(由test/unit-providersConsoleEndpoint.test.mjs與連網守門test/api-providersConsoleEndpoint.test.mjs固定)。
//     本檔以下沿用/zen/v1之記載多為改名前之實測紀錄, 皆可對應改讀為分流後路徑。條目id之zen:前綴為閘道舊名, 改名不改id
//     (id是pick、遞補游標、冷卻狀態之鍵, 更名即破壞性變更且無對應收益)。
//
//   ★ 兩份文件之模型集不一致, 且皆不等於可用性(2026-09-22逐一實測) ★
//     v2頁列為Free但實測全不可用(CLI回UnknownError、REST回400 Upstream request failed: Model is unavailable):
//       deepseek-v4-flash-free / laguna-s-2.1-free / ling-3.0-tiny-free / longcat-2.0-free / north-mini-code-free
//     v1頁有而v2頁未列, 但實測可用: mimo-v2.6-flash-free / jev-1.13-free / muse-spark-1.2與1.3 / nemotron-3.5-lightning-free
//     兩頁皆列且實測可用: big-pickle(CLI 7.1s) / mimo-v2.5-free / nemotron-3-ultra-free /
//       space-bunny-free(2026-09-24新上線: CLI 8.1s、REST 1.9s) /
//       ling-3.1-flash-free、longcat-2.5-preview-free、fledge-alpha-free(2026-10-03查證: CLI 11.5~19.6s、REST皆403;
//       fledge已於2026-10-13下架並移除) / cat-jam-free、step-5-preview-free(2026-10-13查證: CLI 5.6~25.6s、REST皆403)
//     文件與CLI目錄皆列但已下架: exo-free(2026-10-13: 不在/models清單, REST回HTTP 410 ModelDeprecated、
//       CLI回「Model exo-free has been deprecated」, 各4次皆然)——「文件與目錄皆列」不等於可用之又一例。
//     文件仍列但清單與CLI皆無: nemotron-3-ultra-free(2026-11-03官方〈Models〉頁仍列, 2026-10-30已查實下架並自本目錄移除)——再一例。
//     故判準固定為: 文件只用於「端點種類與計價」, 「能不能用」一律以實際要用之金鑰查/inference/v1/models或`opencode models`加實測為準。
//
//   ★ 核心事實: Console「不是」單一OpenAI相容端點, 端點依模型家族而異(官方: Each model is served by one API family) ★
//     依官方〈Models〉頁之端點欄(完整URL; 2026-11-03當日重查路徑, 各家族之模型清單為先前查證之快照, 現況以該頁與/inference/v1/models各項之api欄為準):
//       /inference/openai/v1/chat/completions  @ai-sdk/openai-compatible  ← 本套件api-openai-compat僅支援此種(baseURL給到/inference/openai/v1)
//         mimo-v2.5-free / ling-3.0-flash-fin-free / nemotron-3-ultra-free /
//         nemotron-3.5-lightning-free / big-pickle / space-bunny-free(2026-09-24查證) /
//         ling-3.1-flash-free / longcat-2.5-preview-free(2026-10-03查證) / cat-jam-free / step-5-preview-free(2026-10-13查證) /
//         glm-* / kimi-* / minimax-* / deepseek-v4-*
//       /inference/openai/v1/responses  @ai-sdk/openai  (OpenAI Responses API, 非chat/completions; baseURL同上)
//         muse-spark-1.2-contributor-free / muse-spark-1.3-contributor-free(兩者免費版皆已下架; 2026-11-03該頁改列付費之muse-spark-1.2/1.3與muse-wonder-1.0) / GPT系 / Grok系
//       /inference/anthropic/v1/messages  @ai-sdk/anthropic  Claude系 / Qwen系(qwen3.5~3.7-plus/max)
//       /inference/google/v1beta/models/<model-id>:generateContent  @ai-sdk/google  Gemini系
//       /inference/systemone/v1/systemone  (TypeSafe System One)  ← 本套件api-typesafe-systemone(baseURL給到/inference/systemone/v1)
//         jev-1.13-free / jev-1.13 (2026-09-22查證, 2026-11-03端點欄複查; 非文字生成之決策模型, 須給questions)
//     Go方案另有基底https://opencode.ai/inference/go(各協定路徑同上, 必帶x-opencode-session標頭); 本目錄不收REST類Go條目、只收CLI類ocgo:條目(理由與Go之全貌見下方【OpenCode Go】段)。
//
//   ★ 因此: 模型出現在/models清單 ≠ 可用kind:'api-openai-compat'收錄 ★
//     dispatchApiOpenaiCompat固定POST至<baseURL>/chat/completions(那是它的定義, 非bug),
//     對走/responses或/messages的免費模型必然失敗, 且失敗碼是HTTP 500(不是404/400),
//     極易被誤讀為「模型故障, 等一下就好」而反覆重試——實際上再等一年也不會通。
//     殷鑑(2026-09-03): muse-spark-1.2/1.3走/chat/completions連續10次500,
//     同金鑰同模型改打/responses立即200且正常作答;
//     且1.2於2026-08-21曾以/chat/completions實測3.9s成功——即opencode「事後改過路由」,
//     故「以前能用」不構成「現在該能用」的證據, 一律回頭查文件端點欄。
//     待重驗(2026-11-03): 官方harnesses頁載「付費與Go文字模型可經任一協定, 非原生者由Console轉譯」, 而api/inference頁載「每個模型只屬於一種API家族」;
//     /inference/v1/models各項之api欄亦只列一種家族(如gpt-6-luna只有responses)。二說可並存(各有原生家族, 另對付費與Go額外轉譯), 且上述殷鑑為免費模型,
//     與「轉譯只適用付費與Go」不衝突, 故本段結論限定為「免費模型」; 付費模型跨協定是否真能轉譯須以付費模型實測(2026-11-03未測: 不耗費用),
//     實測前不依此收錄付費條目。
//
//   ★ 收錄zen:條目前之檢核(缺一不可) ★
//     ① 該model id在 /inference/v1/models(舊基底/zen/v1/models同) 清單內(以實際要用之金鑰查);
//        例外: systemone之jev-1.13-free於2026-11-03不在匿名、第1把、第2把金鑰之任一清單, 但官方〈Models〉頁列之且三種路徑實測200, 以實測為準(其餘model不適用此例外);
//     ② 依官方文件端點欄挑對kind與baseURL(三個REST轉接器分別在baseURL後固定接上路徑):
//        /chat/completions → api-openai-compat、baseURL https://opencode.ai/inference/openai/v1;
//        /responses → api-openai-responses、baseURL 同上; /systemone → api-typesafe-systemone(須給questions)、baseURL https://opencode.ai/inference/systemone/v1;
//        /models/<id> 本套件尚無對應kind(/messages雖已有api-anthropic[2026-10-24起], 但它依Anthropic官方協定[x-api-key、anthropic-version]撰寫,
//        Console之/inference/anthropic/v1/messages是否接受同樣標頭與本體尚未驗完——2026-11-03以假金鑰探測: 帶x-api-key與帶Authorization: Bearer皆401 Upstream request failed: Invalid credential
//        (即兩種標頭都被辨識為憑證), 不帶憑證則401 AuthError Missing API key; 成功路徑須付費模型, 未實測, 在實測前不得收為zen:條目),
//        不得硬收為既有kind(必失敗), 需要時改收其opencode CLI版(oc:);
//        此項由test/unit-providersConsoleEndpoint.test.mjs(kind×baseURL)與連網守門test/api-providersConsoleEndpoint.test.mjs(逐條對官方端點欄)固定;
//     ③ 實測至少連續數次200(端點時斷時續者仍可收, 但須於條目註解記錄可用率, 見ling條)。
//
//   ★ 診斷流程(收到失敗時先分類, 不要直接歸咎模型) ★
//     HTTP 500  → 先驗端點: 查文件端點欄; 該走/responses卻打了/chat/completions即為此症。
//                 驗法: curl -X POST https://opencode.ai/inference/openai/v1/responses \
//                        -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
//                        -d '{"model":"<id>","input":"hi"}'   → 200即證明是端點問題非模型問題
//     HTTP 503  → 上游時斷時續(server_error: Upstream request failed: Endpoint is unavailable),
//                 暫時性, 遞補層換家即可; 判別法: 同時段打另一免費模型作對照組。
//     HTTP 429  → 依本體分兩種, 都不是「閘道容量型暫時限流」:
//                 ① FreeUsageLimitError(Free usage limit reached. Free models work in OpenCode…subscribe to OpenCode Go): 該免費模型之用量已用盡, 與金鑰無關。
//                    2026-11-03: 匿名、第1把、第2把金鑰直呼mimo-v2.6-flash-free各1次皆0.3~0.7s即回此錯(第2把為可見79個模型之工作區, 亦同); 同時段opencode CLI匿名呼叫
//                    big-pickle、nemotron-3.5-super-vl-free、pulse-alpha-free亦皆見同字樣(--print-logs; opencode run此時不結束, 只到逾時)——
//                    即同一模型之CLI與REST共用同一免費額度, 改收oc:版無濟於事; 何時恢復未驗證(官方無重置時程說明, 本輪未等待重測)。
//                    〔提出端實測, 2026-11-07〕免費額度「逐模型計」, 不是整個免費層共用一池: 同一把OPENCODE_KEYS, oc:opencode/mimo-v2.6-flash-free自08:16起opencode日誌回報當日額度用盡(11次成交後),
//                    同日11:43~11:48 oc:opencode/deepseek-v4.1-flash-free經CLI連續32回(單回7~8秒)全部成交; 上段11-03「同時段多個模型皆見此字樣」與逐模型計並不衝突(當時各模型各自皆已用盡)。
//                    處置: 單一免費模型見此字樣只代表該模型當日額度用盡, 換其他免費條目(oc:opencode/*)仍可能可用, 呼叫端在免費層可依角色列多家、不必只押一家;
//                    全部免費條目皆見此字樣才視為免費層暫不可用, 此時遞補層換付費或Go條目。(本層程式碼不依此字樣自動處置, 此為給呼叫端之判讀與組鏈建議。)
//                    (官方api/inference與harnesses頁載「免費對話模型離開OpenCode一律403」; 同日實測先遇額度閘429, 兩者並存時之先後次序未驗證。)
//                 ② Upstream request failed: Policy budget exceeded: 工作區或成員之預算用盡(官方console/budgets: 新請求失敗直到預算重置或管理者調高,
//                    回應不指名是哪個預算; 免費模型與Go額度內用量不計預算), 屬預算管理而非限流, 等待須待重置; 換成屬於另一預算之金鑰可能可通(未實測)。
//     HTTP 400 MissingSessionID → 打/inference/go/…(Go方案基底)未帶x-opencode-session標頭(2026-11-03以假金鑰實測: 先於金鑰檢查即回400;
//                 官方harnesses頁: Go必帶穩定之session ID)。本目錄不收REST類Go條目(見【OpenCode Go】段), 自行加條目打Go基底時須經opt.headers帶此標頭。
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
//     (2026-11-03註: 官方文件已改稱Console並載明同一政策〔api/inference與harnesses頁: 免費對話模型離開OpenCode一律403, 即使帶金鑰〕;
//      但當日REST實測免費對話模型先回429 FreeUsageLimitError〔免費額度用盡, 見診斷流程〕, 本段以下403之矩陣為2026-09-18~10-13之實測紀錄。)
//     症狀: 403 FreeTierError「OpenCode's free tier can only be used from within OpenCode」。
//     判定依據(2026-09-18本機矩陣實測, opencode 1.18.31):
//       - REST直呼(任何金鑰): /chat/completions與/responses之免費模型(當日逐一實測者)一律403 → 該類zen:條目自此為政策性失效。
//         例外(2026-09-22實測): /systemone之jev-1.13-free不受此閘門, 帶金鑰或匿名皆200(0.6~1.2s),
//         故zen:jev-1.13-free之REST條目可用(見該條)。
//         例外(2026-09-24實測): /chat/completions之space-bunny-free亦不受此閘門, 匿名與帶金鑰皆200(1.9~2.0s)——
//         即閘門係逐模型套用, 並非「對話型免費模型一律擋」; 例外可能隨時收回, 新模型能否走REST一律以實測為準。
//         ——此例外已於2026-10-13收回: space-bunny-free之REST改回403 FreeTierError(新舊基底×匿名/第1把金鑰共10次皆然),
//         zen:space-bunny-free同日移除(見漂移紀錄); 現存例外僅systemone之jev-1.13-free。
//       - opencode CLI匿名或帶金鑰: 通過; 但注入的設定若把bash工具deny掉(permission.bash:'deny'、
//         舊式tools.bash:false、agent覆寫deny)即被判非opencode而403; 只deny edit、或改為ask則通過。
//         即閘門以「請求之工具清單是否含bash」為指紋之一(另一指紋為User-Agent之版本字串, 非正式版build被拒)。
//       - 帶金鑰時另受該金鑰所屬工作區之模型開關影響(第1把金鑰對免費模型回Model access is disabled且耗76s)。
//     處置: oc:opencode/*免費條目改匿名(useStoredAuth:false, 不帶envVar), 防寫改為OC_READONLY(見該常數註解)。
//     使用者側若另注入config, 切勿deny bash; 需要更緊之鎖請改用付費模型或其他CLI。
//     Go訂閱不改變此閘門與免費上限(2026-11-03): 訂了Go之金鑰打`opencode/*`免費模型仍受同一免費池限制——本機同日21:54以匿名`opencode/beam-free`見
//     「Free usage limit reached…subscribe to OpenCode Go to keep going」(run不結束),約1分鐘內同模型走Go路徑`opencode-go/beam-free`卻6.1s成功;
//     Go額度只作用於`opencode-go/`前綴(見【OpenCode Go】段)。
//
//   ★ 走不通REST時的替代路徑: 同模型改用oc:(opencode CLI) ★
//     opencode CLI內建各模型正確的端點與AI SDK, 故REST不通的模型走CLI往往正常
//     (實測: muse-spark 1.2/1.3之REST 500而CLI皆秒級成功)。CLI版模型id為
//     `opencode/<model-id>`, 可用 `opencode models` 列出; 兩者屬不同供應商條目(見id命名)。
//
// ══════════════════════════════════════════════════════════════════════════════
// 【OpenCode Go(月費訂閱) 接入方式——動 ocgo:條目前必讀】(2026-11-03 da65, Gitea #65; 帳本 sgud/rule/rulebook_opencodego.md R-OCGO-1)
// ══════════════════════════════════════════════════════════════════════════════
//
//   註記: 〔官方〕＝官方文件所載; 〔本機實測〕＝da65於本機(opencode 1.19.5、一把已訂閱Go之金鑰)2026-11-03當日實跑; 〔提出端〕＝issue #65提出端(使用端)
//   自述之實測, 本機未重現——不得當成已驗證。
//
//   權威來源(2026-11-03逐頁重查; 官方文件無「Go」專頁於 /docs/go/, 一律在 /docs/console/go/):
//     https://opencode.ai/v2/docs/console/go/        ← 【主】方案、模型表、各模型月額、額度比例、隱私前提、端點、Extra Usage
//     https://opencode.ai/v2/docs/console/api/inference/ ← usage.opencode.allowance(Go專屬: 本次請求計入額度之美元數)、billing_source(go／go-plus)
//     https://opencode.ai/v2/docs/console/harnesses/ ← Go基底 /inference/go、x-opencode-session
//     https://opencode.ai/inference/go/v1/models     ← Go公開型錄(匿名可查; 2026-11-03當日28個、2026-11-07複查30個〔漂移見【條目與收錄】段之漂移紀錄〕; 帶金鑰注入之CLI型錄 `opencode models opencode-go` 於2026-11-03為30個)
//     https://models.dev/api.json 之 opencode-go     ← 第三方彙整: env OPENCODE_API_KEY、npm @ai-sdk/openai-compatible、api https://opencode.ai/inference/go/openai/v1(當日37個,其中7個標deprecated)
//
//   ★ provider分流: 同一把工作區金鑰(前綴oc_sk_), 兩個provider id, 額度池與計費完全不同 ★
//     opencode/<id>     provider opencode     免費池或按量(餘額): 本檔oc:與zen:條目走此。
//     opencode-go/<id>  provider opencode-go  Go月費額度: 本檔ocgo:條目走此。dispatchOpencode以opt.provider為鍵注入 OPENCODE_AUTH_CONTENT={"opencode-go":{type:api,key}}, 不必改程式;
//                                             model前綴與provider須同名(見dispatchOpencode.mjs檔頭【provider與model必須配對】)。
//     Go訂閱不改變 opencode/* 之免費上限(見【Zen免費層閘門】段之註): 免費池用盡時, 同一模型改走Go路徑仍可用(beam-free〔本機實測〕)。
//     以 opencode/<付費或Go專屬id> 呼叫會失敗〔提出端〕: 「Upstream request failed: Model access is disabled」——此字樣現有兩種成因:
//     ①按量工作區未開該模型(【Zen免費層閘門】段所載); ②付費id錯用 opencode/ 前綴(應為 opencode-go/)。
//
//   ★ 金鑰變數: OPENCODE_GO_KEYS, 不沿用 OPENCODE_KEYS ★
//     Go訂閱綁工作區, 一個工作區一把; 本機 OPENCODE_KEYS 內2把〔本機實測〕: 第1把Go用量端點200(已訂閱)、第2把403 EntitlementError「OpenCode Go subscription required.」(未訂閱)。
//     未訂閱之金鑰打Go模型(含免費期之beam-free)→ stderr「Upstream request failed: An active OpenCode Go subscription is required to use Go models.」,
//     opencode內部重試後77秒才exit 1〔本機實測, 1次〕——沿用 OPENCODE_KEYS 會令全取遞補對每把未訂閱金鑰空耗約77秒。另立變數令呼叫端只放已訂閱之金鑰;
//     多工作區多把仍可逗號分隔輪替。缺變數時9條自動列入skipped(不影響既有使用端)。要確認某把金鑰是否已訂閱Go: opencodeGoUsage({ key })(唯讀、不耗額度; 403且noGoSubscription:true即未訂閱)。
//
//   ★ 為何只收CLI類、不收REST類Go條目 ★
//     Go基底 https://opencode.ai/inference/go/openai/v1 必帶穩定之 x-opencode-session 標頭: 缺則400 MissingSessionID(先於金鑰檢查, 以假金鑰實測);
//     官方〈Where can I use it?〉: Go給OpenCode與同類coding agent使用, client須以自己的user agent識別並送穩定session id, 流量受濫用監控。
//     本套件REST轉接器為一般HTTP呼叫, 不維持session、不是coding agent; 一般REST呼叫是否被官方允許文件未載, 保守不收。opencode CLI本身即官方支援之客戶端(自帶session標頭), 走CLI才是明確認可之路。
//     自行要打REST者須經opt.headers帶x-opencode-session並自負其責(見診斷流程之MissingSessionID)。
//
//   ★ 用量與額度〔官方Go頁〈Usage limits〉〕 ★
//     以美元月額計, 每個模型各有月額(隨方案而異: Go $10/月、Go Plus $40/月、Go Teams $20/人/月; 例glm-5.3-flash為$60／$180／$65), 5小時視窗＝月額20%、週＝50%、月＝100%;
//     到頂後可繼續用免費模型, 或於Go頁開Extra Usage改落回按量餘額(Go Teams預設開)。每次推論回應以 usage.opencode.allowance 回報本次計入額度之美元數。
//     三視窗之查詢端點「官方文件未載」, 為實測所得、非官方承諾: GET https://opencode.ai/inference/go/v1/usage ＋ Authorization: Bearer, 見opencodeGoUsage.mjs檔頭。
//     本套件處置: 匯出opencodeGoUsage供呼叫端排程; 遞補層(dispatchAiFallback)另於選到Go條目之某把金鑰前以quotaGate(src/goQuotaGate.mjs, 2026-11-04 Gitea #67)查該金鑰之三視窗用量,
//     任一視窗percent≥95(rollingMax／weeklyMax／monthlyMax可調)或端點明說被限即略過該把金鑰、不派, 快取60秒, 端點失敗與欄位缺少一律不擋(預設開, quotaGate:false關閉)——
//     「到頂前即停」, 不倚賴Go到頂時 `opencode run` 之行為(該行為仍未查明: 免費池到頂時run不結束只到逾時, 見dispatchOpencode.mjs檔頭; Go到頂是否同樣不返回, 提出端與本機皆未撞到); 呼叫端仍宜以timeoutMs封頂。
//     CLI條目(含ocgo:)之實際併發另受cliSpawnGate限制(預設只對opencode: 機器上opencode.exe數達max(1, 核心數-1)、RAM已用>0.85或CPU>0.90即等, spawnGate:false關閉; 見cliSpawnGate.mjs檔頭)。
//
//   ★ 隱私前提〔官方Go頁〈Enable restricted models〉〈Privacy〉; 工作區Settings›Privacy, 僅owner／admin可改〕 ★
//     預設擋「以請求資料訓練之付費端點」, 允許地區為歐洲與美國(未存隱私設定之工作區另允許來自中國之Global請求)。
//       DeepSeek V4.1 Flash／V4 Pro: Regions須選Global, 否則「This Go model requires Global regions. Select Global in your workspace's Privacy settings to use it.」〔提出端〕
//       Muse Spark 1.3／1.2 Contributor、Iceman Contributor Free: 須開「Allow paid endpoints that train on request data」, 否則
//         「This Go model trains on request data. Allow paid endpoints that train on request data in your workspace's Privacy settings to use it.」〔提出端〕
//     訓練與保留〔官方Privacy表〕: iceman、muse＝訓練Yes且非零保留(敏感內容勿走, 故排在Go群組最後); beam-free＝不訓練、保留30天, 且不可用於安哥拉、白俄羅斯、柬埔寨、中國(含港澳)、古巴、剛果民主共和國、
//     赤道幾內亞、伊朗、伊拉克、寮國、利比亞、奈及利亞、北韓、俄羅斯、敘利亞、土庫曼、烏茲別克、委內瑞拉及烏克蘭之克里米亞／頓內茨克／盧甘斯克; 其餘收錄之flash模型＝不訓練、保留0天
//     (DeepSeek為「0 days*」: 零保留協議逐月續約, 官方載現行效期至2026-11-30)。本機實測iceman可用(代表該工作區已開訓練開關)。
//
//   ★ 錯誤字樣對照(Go) ★
//     「An active OpenCode Go subscription is required to use Go models.」〔本機實測〕金鑰所屬工作區無Go訂閱(用量端點對同一把回403 EntitlementError); 77秒後exit 1。
//     「ProviderModelNotFoundError: Model not found: opencode-go/<id>」〔本機實測, 1.7秒〕id不在Go型錄(寫錯或已下架)。
//     「Model access is disabled」〔提出端〕見上「provider分流」之兩種成因。 「Model is unavailable」〔提出端〕以OPENCODE_CONFIG_CONTENT補定義Go專屬id後之回應。
//     上列隱私兩句〔提出端〕: 工作區未開對應隱私開關。
//     「Free usage limit reached…subscribe to OpenCode Go to keep going」〔本機實測〕＝ opencode/* 免費池用盡, 不是Go額度, Go路徑之模型不受影響。
//     400 MissingSessionID: 直打REST Go基底未帶x-opencode-session。
//     Go額度到頂之字樣與CLI行為: 未撞到, 未知。
//
//   ★ 條目與收錄(帳本R-OCGO-1) ★
//     ocgo:共9條, 置於oc:opencode/*之後、agy:之前: beam-free、crouton-alpha-free、deepseek-v4.1-flash、minimax-m3.1-flash、qwen3.8-flash、glm-5.3-flash、mimo-v2.6-flash,
//     最後為會訓練之iceman-contributor-free、muse-spark-1.3-contributor。各條註解逐項標〔本機實測〕／〔提出端〕／〔CLI型錄〕。
//     本機金絲雀之限制: 付費模型最多1次簡答(用於glm-5.3-flash), 免費期模型(beam-free、crouton-alpha-free、iceman)做滿簡答／推理／read／寫檔金絲雀(脈絡長度僅beam-free、iceman測過); 其餘付費條目僅有提出端自述與CLI型錄欄位。
//     未收之其餘21個Go模型(2026-11-07型錄; kimi-k3／k3.1-pro、glm-5.3／5.2、gpt-6-luna／5.6-luna、claude-haiku-5-5、gemini-4-argon、grok-4.7、deepseek-v4-pro、qwen3.8-max／3.7-plus、minimax-m3、
//     longcat-2.0、hy3／hy4／hy4-preview、step-5-preview、mimo-v2.6-pro、kimi-k2.7-code、muse-spark-1.2-contributor): 提出端未測、本機不得多次發付費請求實測,
//     依R-OCFREE-2「實測不到者不收」之精神不收(其中11個之Go方案月額僅$15, 單價亦高); 呼叫端要用時可經resolveCatalogue之extraProviders自帶條目(形狀比照ocgo:)。
//     【Go型錄漂移紀錄】2026-11-07(主控任務20261107120446之ke339; 提出端Gitea #92匿名GET實查30個, 本機同日匿名GET複查屬實:
//       公開型錄30個＝已收9個＋未收21個, 逐一對得上): 新增hy4(release 2026-11-04, 月額$60／$240／$65, 不訓練、保留0天, 未收)與
//       crouton-alpha-free(release 2026-11-03, 限時免費、三方案皆Unlimited, 不訓練、保留30天、限地區; 已收, 見該條註解);
//       下架mimo-v2.5、mimo-v2.5-pro(公開型錄已無; 官方月額表與隱私表仍列, 屬文件落後; 帶金鑰注入之CLI型錄`opencode models opencode-go --refresh --verbose`仍列32個＝公開30＋此二者, 未呼叫驗證)。
//       Go型錄沒有Claude Sonnet, Claude只有claude-haiku-5-5(Go方案月額$15)。本機opencode 1.19.5之型錄快取舊時不認新模型(2026-11-07實測: 未refresh時`opencode models opencode-go --verbose`不列crouton-alpha-free,
//       依條目呼叫1.6～3.5秒即Exit code 1〔stderr未取得, 與上列ProviderModelNotFoundError約1.7秒同形, 屬推定〕), 以`opencode models opencode-go --refresh`更新後即可。
//
//   ★ 官方月額表〔官方Go頁〈Usage limits〉, 2026-11-07本機匿名GET抄錄; 未實測, 依官方表; 單位美元/月: Go／Go Plus／Go Teams; 5小時視窗＝月額20%、週＝50%〕 ★
//     GLM-5.3-Flash 60／180／65、GLM-5.3 15／120／20、GLM-5.2 60／180／65、Kimi K3.1 Pro 15／60／20、Kimi K3 15／60／20、Kimi K2.7 Code 60／180／65、LongCat-2.0 60／240／65、Step 5 Preview 15／60／20、
//     Crouton Alpha Free／Beam Free／Iceman Contributor Free 皆Unlimited(限時免費)、MiMo-V2.6-Flash 60／120／65、MiMo-V2.6-Pro 15／60／20、MiniMax M3.1 Flash 20／80／25、MiniMax M3 60／180／65、
//     Muse Spark 1.3／1.2 Contributor 60／120／65、Qwen3.8 Max 15／60／20、Qwen3.8 Flash 30／90／35、Qwen3.7 Plus 60／180／65、DeepSeek V4.1 Flash 100／200／105、DeepSeek V4 Pro 15／60／20、
//     Hy4 60／240／65、Hy4 preview 30／120／35、Hy3 60／240／65、Grok 4.7 15／60／20、GPT 6 Luna 15／60／20、GPT 5.6 Luna 15／60／20、Claude Haiku 5.5 15／60／20、Gemini 4 Argon 30／120／35(50%折扣至2026-11-30)。
//     官方表另列MiMo-V2.5 60／120／65、MiMo-V2.5-Pro 15／60／20, 但公開型錄已無此二者(見上漂移紀錄)。其餘付費Go模型維持R-OCFREE-2「實測不到者不收」, 本機不對付費模型多次發請求; 上表供呼叫端依月額選extraProviders自帶條目, 非本套件實測值。
//
//   ★ 用量端點之限制 ★ 用量端點(opencodeGoUsage／goQuotaGate所用)只回該把金鑰「整把」之三視窗百分比(rolling／weekly／monthly), 無逐模型分項, 而官方月額逐模型獨立:
//     quotaGate以單一百分比(任一視窗≥95)擋該把金鑰之全部ocgo:條目, 無從得知是哪個模型用掉額度(提出端2026-11-07實查: rolling 0%、weekly 50%、monthly 25%, 無法歸因到模型)。
//     Unlimited之免費期模型(beam-free、crouton-alpha-free、iceman-contributor-free)不計額度, 但該把金鑰因付費模型被擋時, 它們也一併被略過; 要單獨使用者以quotaGate:false或逐條覆寫處理。
//
// ══════════════════════════════════════════════════════════════════════════════
// 【輸出上限與截斷診斷——推理模型長提示詞「回空字串／被截斷、日誌無錯誤」時必讀】(2026-11-04 da78, Gitea #78; 帳本 sgud/rule/rulebook_opencodego.md R-OCGO-4)
// ══════════════════════════════════════════════════════════════════════════════
//
//   註記: 〔假服務〕＝以本機自建127.0.0.1之OpenAI相容服務攔截opencode 1.19.5實際送出之請求(不花額度, test/api-opencodeOutputCap.test.mjs可重跑);
//         〔Go實測〕＝2026-11-04以已訂閱Go之金鑰實呼(共6次呼叫; 提示詞約3萬字元之合成算術推理任務、--variant high; 證據夾見帳本); 其餘為未查證。
//
//   ★ 症狀 ★ 推理模型(Go、免費池皆可能)配高檔位(--variant high)跑長提示詞(實測約3萬字元)時: 結果ok:true、離開碼0、stdout為空字串(或只有半截文字/半截JSON)、
//     stderr只有「> agent · model」標頭、opencode日誌(--print-logs)無ERROR。呼叫端只看到validate失敗或(提示詞更重時)逾時,
//     容易誤歸為「模型能力／格式問題」而一再重試或降檔位。〔Go實測〕glm-5.3-flash與deepseek-v4.1-flash在預設上限下皆如此: 365～410秒後回空字串。
//
//   ★ 根因 ★ 單次回應輸出上限是opencode「CLI端」的預設值32,000 token, 不是Go閘道、也不是模型型錄之limit.output:
//     opencode以min(型錄limit.output, 環境變數OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX或預設32000)作為請求之max_tokens, 推理模型之reasoning與output共用此額度。
//     〔假服務〕未設環境變數: 型錄output 384000／131072 → max_tokens 32000, 型錄8000 → 8000; 設64000: 384000／131072 → 64000, 8000 → 8000; 設200000且型錄131072 → 131072;
//       環境變數為'0'、'-5'、''、'abc'、'64000.5'時CLI靜默忽略而回32000('1e5'則為100000)。
//     〔Go實測〕預設上限: glm、deepseek皆finish=length、reasoning恰32000、output 0; 設上限3000(deepseek): finish=length、reasoning恰3000(閘道照單全收CLI給的max_tokens);
//       設上限128000: glm finish=stop(reasoning 32768＋output 1137), deepseek finish=stop(reasoning 70358＋output 964)——同一提示詞、同一檔位, 只差上限。
//     檔位越高reasoning越長、正文越易被擠光; 提示詞越長、需推理處越多越易中。issue #78原稱「32,000是閘道限制(或CLI端, 未查證)」, 實測為CLI端預設。
//
//   ★ 診斷 ★ 預設格式下回應「為何結束」不可見, 只有session紀錄看得到: ①`opencode session list --format json`(依時間列出id／title／directory)取得sessionID,
//     或直接用`opencode run --format json`(stdout每行一個事件, 皆帶sessionID); ②`opencode export <sessionID>`: 看assistant訊息之finish與tokens(reasoning／output),
//     finish為length且reasoning＋output＝上限(預設32000)即中。`--format json`之step_finish事件(part.reason／part.tokens)是同一份資訊, dispatchOpencode的detectTruncation即據此判定(見其檔頭)。
//
//   ★ 處置(本套件已做) ★
//     ①dispatchOpencode預設把上限調為128000(opt.outputTokenMax可覆寫; 呼叫端環境已設有效值者保留, 優先序與無效值規則見outputTokenMax.mjs檔頭), 實際仍受型錄limit.output約束。
//       「思考強度一律high」原則維持, 不以降檔位(--variant low)當解法: 本案是上限不足, 不是檔位過高; 降檔位只在實測顯示調高上限後仍不可用的模型才逐條處理(目前無)。
//     ②9條ocgo:條目(2026-11-07起含crouton-alpha-free)帶detectTruncation: true——最後一步終止原因為length時回報errorType 'incomplete'(truncated:true、finishReason、tokens)而非靜默成功, 且不驗證、不重試(確定性),
//       dispatchAiFallback依truncated旗標整組跳過、換下一個條目。oc:條目未開(行為不變); 呼叫端可自行在條目或patch加detectTruncation: true。
//     ③context 262144級且型錄輸出上限逾32000之三條(oc:flint-40b-free、oc:nemotron-3.5-lightning-free、ocgo:iceman-contributor-free)明給outputTokenMax: 32000:
//       伺服器以「輸入 + max_tokens ≤ context」驗請求, 上限每調高N token可用輸入約少N token, 這三條上方註記之「輸入實際上限約23萬token」即以32000預留計算; 要長輸出者以patch覆寫。
//     ④調高上限後單次呼叫可能更久、更耗額度: 〔Go實測〕3萬字元提示詞+high, glm 382秒(34K token)、deepseek 511秒(71K token); 本套件預設timeoutMs 300000不夠, 呼叫端須自行給足(建議≥900000);
//       上限本身不延長逾時; 額度只計實際產出之token(調高上限本身不扣額度, 但以前被截掉的長推理現在會完整產出)。不要以加大timeoutMs當截斷對策(回應早已結束), 也不要重試同一請求(確定性)。
//
//   ★ 仍未查證 ★ ①其餘ocgo:模型(minimax-m3.1-flash、qwen3.8-flash、mimo-v2.6-flash、muse-spark-1.3-contributor、beam-free)於128000上限之接受度與耗時未實測(僅glm、deepseek實測);
//     ②oc:免費池條目調高上限後之行為未實測(型錄上限內之max_tokens理應被接受; 免費池可能另有token額度規則); ③Console／Zen REST類條目不受此限(REST轉接器自帶max_tokens);
//     ④content_filter: opencode不以step_finish呈現而是error事件＋離開碼1(假服務), 故不會被判為截斷, 屬一般exec失敗; ⑤上述數字隨提示詞與模型版本而異, 只代表2026-11-04該合成提示詞之量級。
//
// 【zen免費模型清單為「更新日快照」, 不保證即為當前狀態】zen:系收錄起於2026-08-21
//   經GET https://opencode.ai/zen/v1/models 查得之免費模型(*-free), 其後之增刪見本段漂移紀錄(最近一次2026-09-24), 不做好用篩選——
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
//   2026-09-24之漂移: 新增space-bunny-free之兩條目(oc:與zen:, 使用者指示)。官方v1/v2文件〈Pricing〉全Free,
//     說明為限時免費之stealth推理模型(供應商零保留、不以資料訓練), 端點/chat/completions; CLI清單與/zen/v1/models皆有。
//     與其他對話型免費模型不同, 其REST未被免費層閘門擋下(匿名與帶金鑰皆200), 故兩路皆收; 實測數據見兩條目註解。
//   2026-10-03之漂移: 新增oc:opencode/ling-3.1-flash-free、longcat-2.5-preview-free、fledge-alpha-free三條(使用者指示)。
//     三者官方v1/v2文件〈Pricing〉皆Free、端點/chat/completions, CLI清單(--refresh)與/zen/v1/models皆有;
//     REST三者皆403 FreeTierError(匿名與第1把金鑰各2次; 同時段zen:space-bunny-free仍200, 證閘門逐模型套用), 故只收oc:版。
//     同日移除oc:opencode/muse-spark-1.2-contributor-free(使用者指示): 已自CLI目錄(--refresh)消失, 匿名CLI呼叫持續回
//     UnknownError「Unexpected server error」(2026-09-30起累計4次, 每次2~4s即敗, 帶不帶--variant皆同, 同時段1.3正常)。
//     /zen/v1/models雖仍列(未同時滿足先例之兩條件), 惟CLI為其唯一收錄路徑(zen:版已於09-22移除)且已不可用,
//     留著只會讓全取者每輪空耗一次失敗。日後CLI目錄重新列出且實測可通時, 依收錄檢核重收即可。
//   2026-10-13之漂移(opencode 1.18.35):
//     新增oc:opencode/cat-jam-free、step-5-preview-free兩條(使用者指示): 官方文件〈Pricing〉皆Free、端點/chat/completions,
//     CLI清單(--refresh)與/models皆有; REST兩者皆403 FreeTierError(新舊基底×匿名/第1把金鑰各2次), 故只收oc:版。
//     未收exo-free(使用者同時詢問): CLI清單與官方文件仍列, 但不在/models清單, REST回410 ModelDeprecated、
//     CLI回「Model exo-free has been deprecated」(各4次)——伺服器端已下架。
//     移除oc:opencode/fledge-alpha-free: 已自CLI清單、/models與官方文件消失, 依其條目呼叫連2次UnknownError
//     (同時滿足先例之兩條件; 10-03收錄時已註明alpha限時免費可能提前結束)。
//     移除zen:space-bunny-free: 免費層閘門之例外已收回(見閘門段), 屬政策性失效而非暫時故障, 依2026-09-22之原則不保留;
//     同模型之oc:版不受影響且仍收錄。日後政策放寬時依收錄檢核重收即可。
//     端點基底改名為/inference/v1(見權威來源段); zen:jev-1.13-free同日改用新基底。
//   2026-10-18之漂移(opencode 1.19.3):
//     新增oc:opencode/beam-free(使用者指示): 官方文件〈Pricing〉Free、端點/chat/completions, CLI清單(--refresh)有;
//     REST匿名與第1把金鑰各2次皆403 FreeTierError, 故只收oc:版(實測數據見該條)。
//     移除oc:opencode/muse-spark-1.3-contributor-free: 已自CLI清單(--refresh)消失, 匿名CLI呼叫1.8s即敗(Exit code 1);
//     官方文件〈Models〉〈Pricing〉改列付費之muse-spark-1.3($1.25/$4.25)、免費段已無muse——免費變體終止而非暫時故障。
//     日後免費變體重新上架且實測可通時, 依收錄檢核重收即可。
//     同日稍晚(使用者指示)新增oc:opencode/deepseek-v4.1-flash-free、glm-5.3-flash-free: 官方文件〈Pricing〉皆Free、
//     端點/chat/completions, CLI清單(--refresh)有; REST匿名與第1把金鑰各2次皆403 FreeTierError, 故只收oc:版(實測見兩條)。
//     移除oc:opencode/ling-3.1-flash-free、cat-jam-free、step-5-preview-free: 三者皆已自CLI清單(--refresh)與官方文件消失,
//     依條目呼叫各2次皆1.8~1.9s即回UnknownError「Unexpected server error」(同時滿足先例之兩條件)。
//     同日再新增oc:opencode/nemotron-3-ultra-free、nemotron-3.5-lightning-free、nemotron-3.5-super-vl-free(使用者指示):
//     官方文件〈Pricing〉皆Free、端點/chat/completions, CLI清單(--refresh)有; REST匿名與第1把金鑰各2次皆403 FreeTierError,
//     故只收oc:版(實測見三條)。使用者告知三者額度少且慢, 故排在opencode免費條目之末。
//     同日再以oc:opencode/minimax-m3.1-flash-free取代oc:opencode/space-bunny-free(使用者指示: 同一模型恢復真名):
//     space-bunny已自CLI清單(--refresh)與官方文件消失, 依條目呼叫2次皆約2s即回UnknownError; 新條目置於原位(實測見該條)。
//   2026-10-30之漂移(opencode 1.19.5; 提出端: Gitea issue #25, 使用端 2026-10-29以免費席位重評時發現):
//     移除oc:opencode/minimax-m3.1-flash-free、longcat-2.5-preview-free、nemotron-3-ultra-free三條: 當日重查(`opencode models`兩次與`opencode models opencode --refresh`
//     皆不列; 依條目欄位以dispatchOpencode各呼叫2次共6次, 皆1.45~1.60s即回Exit code 1之UnknownError「Unexpected server error」, 離開碼1)——
//     「已自CLI清單消失」與「依條目呼叫約2s即回UnknownError」兩條件同時滿足(同先例)。minimax-m3.1-flash-free之匿名REST同日另回400
//     「Upstream request failed: Model is unavailable.」。注意nemotron-3-ultra-free: 當日第1次手動`opencode models`(不帶--refresh)仍列了它, 其後兩次與--refresh後皆不列,
//     而依條目呼叫在第1次列出後約1分鐘內即已失敗——`opencode models`有本機快取, 清單與上游狀態不同步時「有列」不等於「能用」(下游以filterOpencodeFree({ refresh: true })取最新事實)。
//     新增oc:opencode/flint-40b-free(CLI目錄有、release_date 2026-10-21; 依條目慣例實測後收, 數據見該條)。
//     日後免費變體重新上架且實測可通時, 依收錄檢核重收即可。
//     新增匯出函式filterOpencodeFree(src/filterOpencodeFree.mjs): 以`opencode models`過濾本目錄之opencode免費條目, 令「能不能用一律以`opencode models`加實測為準」之判準有工具可用
//     (下游組遞補鏈或評比名單前對一次; 查詢失敗回明確錯誤狀態, 不得被當成「全部下架」); 連網守門test/api-providersOpencodeFree.test.mjs於`npm test`時對當日清單比對。
//   2026-11-03之漂移(opencode 1.19.5; 提出端: Gitea issue #63, 使用端, 使用者另提供當日可用免費清單; 主控任務20261103173524之da63):
//     目錄零增刪, 路徑與文件對齊: zen:jev-1.13-free之baseURL自/inference/v1改為官方端點欄之/inference/systemone/v1(新路徑匿名與第1把金鑰實測200, 見該條);
//     檔頭權威來源、改名與分流、端點表、收錄檢核、診斷段依Console現況改寫(Zen已改名OpenCode Console; 429分FreeUsageLimitError與Policy budget exceeded; 補MissingSessionID)。
//     未收oc:opencode/pulse-alpha-free(使用者清單與CLI清單皆有、官方〈Models〉〈Pricing〉列Free、CLI目錄release_date 2026-11-02): 依R-OCFREE-2②須各項實測全數完成才收,
//       當日免費額度用盡致第1項「匿名CLI簡答」亦未完成(opencode 1.19.5、variant high、OC_READONLY: 120s逾時, --print-logs見Free usage limit reached);
//       推理題、read工具、寫檔金絲雀、脈絡長度皆未測(型錄1048576), 故不收, 列待辦(見sgud/state/state.md)。已做者: CLI目錄欄位(`opencode models opencode --verbose`: status active、cost全0、
//       release_date 2026-11-02、context 1048576、輸出131072、可輸入圖片、檔位low/high/max)、匿名REST 1次與對照組big-pickle皆429 FreeUsageLimitError(額度用盡下兩者無鑑別力, 不據以決定有無zen:版)。
//       另官方〈Models〉載明: 免費期間所收資料可能被保留並用於改進模型, 且歐盟、冰島、列支敦斯登、挪威、古巴、伊朗、北韓、俄羅斯、烏克蘭、委內瑞拉不可用(收錄時須於條目註解記)。
//     保留oc:opencode/nemotron-3.5-super-vl-free: `opencode models opencode --refresh`兩次(輸出相同)、匿名/inference/v1/models與官方〈Models〉頁皆仍列(R-OCFREE-2①清單消失條件不成立);
//       匿名CLI呼叫1次45s逾時並見Free usage limit(同時段對照組big-pickle亦同), 不是約2s回UnknownError(②條件亦不成立)。
//   2026-11-03稍晚之新增(opencode 1.19.5; 提出端: Gitea issue #65, 使用端; 主控任務20261103201852之da65): 新增OpenCode Go支援——
//     8條CLI類ocgo:條目(provider opencode-go、envVar OPENCODE_GO_KEYS; 詳【OpenCode Go】段與各條註解之〔本機實測〕／〔提出端〕標註)、新匯出opencodeGoUsage
//     (Go用量端點三視窗, 實測所得、官方文件未載); 不收REST類Go條目; 既有29條零增刪、零改動(逐欄比對差異0), 條目總數29 → 37。
//   2026-11-07之漂移(opencode 1.19.5; 提出端: Gitea issue #92; 主控任務20261107120446之ke339):
//     新增ocgo:opencode-go/crouton-alpha-free(Go型錄漂移與收錄依據見【OpenCode Go】段〔條目與收錄〕), 條目總數37 → 38; oc:／zen:條目零增刪、零改動。
//     免費池核對(本機同日實查): 匿名GET `/zen/v1/models`(81個)單價0者共11個, 目錄免費池之8個oc:opencode/*皆仍在; `filterOpencodeFree(providers, { refresh: true })`(`opencode models opencode --refresh`列11個)
//     回removed為空、uncatalogued為3個——opencode/crouton-alpha-free、opencode/iceman-free、opencode/inkling-2-small-free(清單有列而目錄未收; 提出端稱「單價0共8個、無漂移」與本機查得之11個不符)。
//     此3個未收: 依R-OCFREE-2②須各項實測全數完成才收, 本輪未做(crouton-alpha-free已經Go路徑收錄為ocgo:版), 列待辦(見sgud/state/state.md)。
//     免費額度「逐模型計」之提出端實測見上方診斷流程HTTP 429①。
//
// 【使用方式】
//   import providers from 'w-dispatch-ai/src/providers.mjs'
//   import resolveProviders from 'w-dispatch-ai/src/resolveProviders.mjs'
//   import readEnvFile from 'w-dispatch-ai/src/readEnvFile.mjs'
//   let env = readEnvFile('./.env') //OPENCODE_KEYS/OPENCODE_GO_KEYS/AGNES_KEYS/POOLSIDE_KEYS/TYPESAFE_KEYS, 逗號分隔多把; 不污染process.env
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
//     agy之printTimeout由timeoutMs自動推導(＋30s, 令外層先逾時), 無須另設。
//   工作流層總時長: RolePipeline為各階段序列相加(M階段≈M×名額預算);
//   Fanout各名額並行(≈單一名額預算＋整合名額預算), 外部排程上限須據此預留。
//   外部調整四層(細者覆蓋粗者): dispatchAiWkf之defaults(全域) → 各工作流callOpt
//   → 各階段/名額規格 → 各provider條目。


//opencode條目共用之機械防寫(單一來源, 各oc:條目引用而不手寫):
//  edit:'deny' 擋write/edit/patch(opencode之edit涵蓋三者, 無獨立write鍵);
//  bash:'ask'  而非'deny'——2026-09-18實測: Zen免費層閘門以「bash工具是否存在」判定是否為opencode本體,
//              deny會把bash自工具清單移除而被判非opencode(403 FreeTierError), ask則工具仍在;
//              而`opencode run`為非互動, ask一律自動拒絕(stderr: The user rejected permission),
//              金絲雀實測寫檔與shell建檔皆未落地, 故仍為機械鎖(2026-09-23於1.18.32重驗仍自動拒絕)。
//              注意呼叫端勿另傳--auto(2026-09-23實測: 帶上即放行ask, 模型以node寫檔落地)。
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
//  邊界(2026-09-23查官方permissions文件): 此鎖只管模型可用之工具; 資料夾未受信任時-p仍會執行該專案
//  .claude/settings.json之hooks與env(官方列為「Used」)。於不信任之目錄派工可於條目另加
//  '--setting-sources user'(同日實測可與本鎖及skip並用); 更嚴之'--restricted'須搭配skipPermissions:false
//  (restricted拒絕bypassPermissions, 同日實測帶skip即報錯)。勿帶--bare(不讀OAuth登入, 見dispatchClaude檔頭)。
let CLAUDE_READONLY = ['--tools', 'Read,Glob,Grep', '--strict-mcp-config']


//各條目之思考強度(單一來源, 2026-09-30使用者指示一律high): 各家參數不同, 條目引用下列常數而不手寫。
//  claude   --effort(low/medium/high/xhigh/max): 未給時-p實測為medium(Claude Code 2.1.285, session紀錄之effort欄)。
//  codex    --config model_reasoning_effort: 未給時沿用執行機之~/.codex/config.toml(本機為high), 再無則為模型預設
//           (app-server model/list之defaultReasoningEffort, gpt-6.1-sol與gpt-6.1-terra皆為low)——明給令條目不隨安裝機之設定而變;
//           同日實測--config覆寫優先於config.toml(給low時session記為low)。
//  opencode --variant: 僅部分模型有檔位, 以`opencode models <provider> --verbose`之variants查(同日opencode 1.18.33:
//           muse-spark-1.2(2026-10-03已移除)/1.3與space-bunny有high; big-pickle、mimo無檔位; agnes-ai、poolside為自訂provider亦無;
//           2026-10-03新收之ling-3.1-flash、longcat-2.5-preview亦有high(同日所收fledge-alpha已於10-13移除), opencode 1.18.34;
//           2026-10-13新收之cat-jam(另有xhigh/max)、step-5-preview亦有high, opencode 1.18.35;
//           2026-10-18新收之beam(另有xhigh/max)亦有high、同日移除muse-spark-1.3, opencode 1.19.3;
//           同日新收之deepseek-v4.1-flash、glm-5.3-flash為low/high/max亦有high, 同日移除ling-3.1-flash、cat-jam、step-5-preview;
//           同日再收之nemotron-3.5-super-vl為none~xhigh亦有high, nemotron-3-ultra、nemotron-3.5-lightning無檔位;
//           同日以minimax-m3.1-flash(low~max, 亦有high)取代space-bunny(同一模型恢復真名);
//           2026-10-30新收之flint-40b有low/medium/high/xhigh/max亦有high, opencode 1.19.5, 同日移除minimax-m3.1-flash、longcat-2.5-preview、nemotron-3-ultra),
//           無檔位之條目不帶。同日實測space-bunny之variant low/high推理token為18/71, opencode.db之訊息記錄variant。
//  REST     body.reasoning_effort: 原僅zen:space-bunny-free帶(該條2026-10-13已移除, 現無內建REST條目帶此欄)——
//           opencode模型目錄宣告其high檔即{reasoningEffort:'high'}
//           (@ai-sdk/openai-compatible轉為此欄), 與oc:版同參數。agnes接受此欄但同日兩題各兩輪推理token無一致差異,
//           視為未生效故不帶(其預設即會思考, usage可見推理token)。poolside之思考為開關(chat_template_kwargs.enable_thinking)
//           而非檔位, 同日由關改開(見該條); jev(systemone)為決策模型無此概念。
//  anthropic: REST(kind api-anthropic)  條目欄位effort(轉為body.output_config.effort, 2026-10-24): 未給時API依模型預設——Opus 5.5與Haiku 5.5為medium(非high)、
//           Sonnet 5.5為high——故三條皆明給EFFORT; 三模型皆為自適應思考(省略thinking即開), Opus 5.5不可關閉, 條目不送thinking也不得以disabled關閉(上方測試守門)。
//           claude-api:(CLI)同claude:條目以--effort表示。
//  agy      以模型slug之檔位表示(gemini-3.8-flash-high、gemini-4-argon-high、claude-sonnet-5-5-high、claude-opus-5-5-high), 不另帶--effort
//           (與slug檔位不一致時agy報conflicts)。各模型可選檔位因模型而異(2026-10-16: Gemini 4 Argon與3.8 Flash皆為low/medium/high, 無xhigh/max),
//           以`agy -p /effort --model <slug> --output-format json`之available查(不耗額度; Git Bash下須加MSYS_NO_PATHCONV=1,
//           否則/effort被改寫成路徑而當成提示詞送出)。
//  注意: 條目覆寫extraArgs時須一併帶上本常數(與防寫常數), 否則回退各CLI之預設強度(codex條目之防寫為獨立之sandbox欄位, 不在extraArgs, 覆寫時只需帶強度)。
let EFFORT = 'high'
let CLAUDE_EFFORT = ['--effort', EFFORT]
let CODEX_EFFORT = ['--config', `model_reasoning_effort="${EFFORT}"`]
let OC_EFFORT = ['--variant', EFFORT]


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
    //(原首條oc:opencode/muse-spark-1.3-contributor-free已於2026-10-18移除, 見檔頭漂移紀錄)
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
    //(oc:opencode/minimax-m3.1-flash-free與oc:opencode/longcat-2.5-preview-free已於2026-10-30下架並移除, 見檔頭漂移紀錄;
    //  2026-10-13新增之cat-jam-free、step-5-preview-free已於2026-10-18下架並移除)
    {
        id: 'oc:opencode/beam-free',
        model: 'opencode/beam-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //2026-10-18新增(使用者指示): 官方文件〈Models〉與〈Pricing〉皆列(Free|Free|Free|-、端點/chat/completions), CLI清單(--refresh)有;
        //REST不收zen:版——同日匿名與第1把金鑰各2次皆403 FreeTierError(免費層閘門, 見檔頭)。
        //CLI目錄release_date 2026-10-05; 推理模型, context 1M(1048576)、輸出上限131072、僅文字輸入; 檔位low~max(另有xhigh/max)。
        //匿名CLI實測(opencode 1.19.3、variant high): 簡答4.9s、推理題4.4s答對、read工具讀相對路徑6.3s正確、
        //要求寫檔被OC_READONLY擋下未落地(write工具不在清單、bash自動拒絕; 此時回空字串而ok:true, 呼叫端宜帶validate)。
        //官方說明為限時免費; 〈Privacy〉載明輸入不用於訓練、為安全理由保留30天
        //【脈絡長度(2026-10-23實測, opencode 1.19.3)】支援完整1M: 以針在乾草堆(針在開頭、問題在結尾; 本機覆寫limit令伺服器自判)
        //經CLI實測, 伺服器回報總token 499775/799358/949411/1039300皆答對(14~33s); 1099300時伺服器明確回
        //「maximum context length is 1048576 tokens」——與型錄一致, 故不覆寫limit。opencode每次自帶約3.2萬token之系統提示。
        //證據: opensrcOper dhist/20261023185913
    },
    //以下兩條2026-10-18新增(使用者指示): 官方文件〈Models〉〈Pricing〉皆列Free(另有同名付費版deepseek-v4.1-flash、glm-5.3-flash,
    //id不帶-free, 未收)、端點/chat/completions, CLI清單(--refresh)有; REST不收zen:版——同日匿名與第1把金鑰各2次皆403 FreeTierError。
    //官方說明皆為限時免費、供應商零保留且不以資料訓練。匿名CLI實測皆以opencode 1.19.3、variant high
    {
        id: 'oc:opencode/deepseek-v4.1-flash-free',
        model: 'opencode/deepseek-v4.1-flash-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //CLI目錄release_date 2026-09-10; 推理模型, context 200000、輸出上限32000、可輸入圖片; 檔位low/high/max。
        //實測: 簡答6.9s、推理題6.5s答對、讀檔8.6s正確、寫檔金絲雀6.9s被OC_READONLY擋下未落地(回空字串而ok:true)
        //【脈絡長度(2026-10-19實測, opencode 1.19.3)】非1M: 坊間稱此免費版支援1M(DeepSeek V4.1 Flash原生1M)不成立。
        //以針在乾草堆(針在開頭、問題在結尾)經CLI實測: 伺服器接受至輸入約239K token(239168成功且答對), 約239.9K起
        //一律回ContextOverflowError(AI_APICallError, 伺服器端; 輸出上限由32000降為8000亦同, 故限制只看輸入)。
        //型錄之context 200000偏保守; 但預設設定下opencode於約168K(200000扣輸出保留32000)即在本機自動壓縮脈絡,
        //stdout會混入摘要文字(如「## Objective…」)而仍ok:true——長提示詞宜控制在約160K以下, 或呼叫端自行於config覆寫
        //provider.opencode.models['deepseek-v4.1-flash-free'].limit.context(上限勿超過約230000, 須留輸出空間);
        //本條目不覆寫(維持型錄值, 免伺服器日後下調時由壓縮變為溢出錯誤)。證據: opensrcOper dhist/20261019203639
    },
    {
        id: 'oc:opencode/glm-5.3-flash-free',
        model: 'opencode/glm-5.3-flash-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //CLI目錄release_date 2026-08-26; 推理模型, context 200000、輸出上限32000、可輸入圖片/影片/PDF; 檔位low/high/max。
        //實測: 簡答9.5~20.6s、推理題14.3s答對、讀檔10.2~22.0s正確、寫檔金絲雀97.8s被OC_READONLY擋下未落地。
        //【注意: 上游不穩】同日共10次中4次於75~81s後失敗(stderr: Upstream request failed: Endpoint is unavailable, exec失敗),
        //屬暫時失敗故仍收錄(依檔頭之保留哲學), 並排在opencode免費條目後段(其後僅nemotron三條); 全取者遇此每次約多耗80s才換家
    },
    //flint-40b-free(2026-10-30新增, 見檔頭漂移紀錄): 置於上游不穩之glm之後、額度少且慢之nemotron兩條之前。
    //官方說明未查(本輪未讀官方文件, 以CLI目錄與實測為準); CLI目錄(`opencode models opencode --verbose`, opencode 1.19.5)有, status active、cost全0、
    //release_date 2026-10-21; 推理模型(capabilities.reasoning)、context 262144、輸出上限65536、僅文字輸入(無圖片/影片/PDF); 檔位low/medium/high/xhigh/max(有high)。
    //匿名CLI實測(2026-10-30, opencode 1.19.5、variant high、OC_READONLY): 簡答6.2s與5.1s(皆回「完成」)、推理題9.5s答對(variant low 6.8s亦答對, 兩檔位推理token皆為0、
    //未見檔位差異, 僅證明CLI接受--variant high)、read工具讀相對路徑24.8s正確(Glob＋Read)、寫檔金絲雀12.8s被OC_READONLY擋下未落地
    //(write工具不在清單: Available tools為bash/glob/grep/invalid/read/skill/task/todowrite/webfetch/websearch; bash要求被自動拒絕; 此時回空字串而ok:true, 呼叫端宜帶validate)。
    //REST不收zen:版——同日匿名REST(/inference/v1與目錄所列之/inference/openai/v1各2次)皆429 FreeUsageLimitError
    //(Free usage limit reached. Free models work in OpenCode), 同時段已收錄之beam-free與big-pickle對照組亦同(免費層閘門之現行形態, 見檔頭; 先前記載為403 FreeTierError)。
    //第1把金鑰之REST未測(本輪不讀.env)。
    //【脈絡長度(2026-10-30實測, opencode 1.19.5)】與型錄一致: 以針在乾草堆(針在開頭、問題在結尾)經CLI實測, 預設設定下總token 191,422答對(10.5s、未於本機壓縮);
    //本機覆寫limit令伺服器自判, 輸入255,626 token時伺服器約5s即回ContextOverflowError(事件時戳; 行程至66s才結束)「maximum context length is 262144 tokens... 255626 tokens from the input messages
    //and 32000 tokens for the completion」——上限為262144(含completion預留, opencode預設預留32000, 故輸入實際上限約230K), 不覆寫limit。未二分逼近確切上限, 亦未測本機壓縮之觸發點。
    //證據: 本輪報告(opensrcOper dnow/20261030054322/agent-out/run01-修正報告.md)
    {
        id: 'oc:opencode/flint-40b-free',
        model: 'opencode/flint-40b-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        outputTokenMax: 32000, //context 262144且型錄輸出上限65536: dispatchOpencode預設會調高單次輸出上限(見檔頭【輸出上限與截斷診斷】), 但調高會等量縮小可用輸入(上列「輸入實際上限約230K」以32000預留計), 故維持CLI原預設; 要長輸出者以patch覆寫
    },
    //以下兩條2026-10-18新增(使用者指示; 使用者告知額度少且慢, 故排在opencode免費條目之末; 同批之nemotron-3-ultra-free已於2026-10-30下架並移除, 見檔頭漂移紀錄):
    //官方文件〈Models〉〈Pricing〉皆列Free、端點/chat/completions, CLI清單(--refresh)有; REST不收zen:版——同日匿名與第1把金鑰各2次皆403 FreeTierError。
    //官方說明為限時開放、團隊藉此收集回饋改進模型; 〈Privacy〉載明為NVIDIA免費端點、僅供試用, 勿送個人或機密資料。
    //匿名CLI實測皆以opencode 1.19.3: 簡答、推理題(答對)、read工具讀相對路徑(正確)、要求寫檔(被OC_READONLY擋下未落地, 回空字串而ok:true)四項皆過
    {
        id: 'oc:opencode/nemotron-3.5-lightning-free',
        model: 'opencode/nemotron-3.5-lightning-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        outputTokenMax: 32000, //context 262144且型錄輸出上限262144: 維持CLI原預設以保輸入餘裕, 理由同flint-40b-free; 要長輸出者以patch覆寫
        //CLI目錄release_date 2026-08-11; 推理模型, context 262144、輸出上限262144、僅文字輸入; 無檔位故不帶OC_EFFORT。
        //實測: 簡答29.1s、推理題6.7s、讀檔10.4s、寫檔金絲雀91.8s
    },
    {
        id: 'oc:opencode/nemotron-3.5-super-vl-free',
        model: 'opencode/nemotron-3.5-super-vl-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
            //伺服器實際上限約1,000,000 token(低於型錄1048576, 見下), 覆寫limit令opencode於伺服器拒絕前先在本機自動壓縮脈絡
            provider: { opencode: { models: { 'nemotron-3.5-super-vl-free': { limit: { context: 1000000, input: 950000, output: 131072 } } } } },
        },
        extraArgs: OC_EFFORT,
        //CLI目錄release_date 2026-10-15; 推理模型, context 1M(1048576)、輸出上限131072、可輸入圖片; 檔位none/minimal/low/medium/high/xhigh。
        //實測(variant high): 簡答8.3s、推理題10.1s、讀檔9.1s、寫檔金絲雀14.1s
        //【脈絡長度(2026-10-23實測, opencode 1.19.3)】實際上限約1,000,000(略低於型錄): 以針在乾草堆經CLI實測(本機覆寫limit令伺服器自判),
        //伺服器回報總token 499213/798962/948277/990071/999964皆答對(48~112s); 約101萬與104萬時伺服器6~7s即回
        //AI_APICallError「Bad Request」(訊息未言明溢位)。若沿用型錄值, 多步對話之脈絡長到100萬~104.8萬之間時opencode不會先壓縮而直接失敗,
        //故本條目覆寫limit: context 1000000、input 950000、output沿用型錄131072——opencode之本機壓縮門檻(依版本取input或context扣output,
        //兩者皆低於伺服器上限)於某步用量超過後、下一步前壓縮; 單一則即超過約100萬之提示詞仍會送出而被拒(10-19 deepseek實測壓縮為事後觸發),
        //呼叫端須自控單則長度。覆寫之效果只實證「設定可被接受」(見證據), 大脈絡下之壓縮行為未實測。
        //opencode每次自帶約3.8萬token之系統提示。證據: opensrcOper dhist/20261023185913
    },
    //══ 以下9條為OpenCode Go(月費訂閱)之CLI類條目(2026-11-03 da65新增8條, Gitea #65; 2026-11-07 ke339於beam-free之後新增crouton-alpha-free, Gitea #92; 詳檔頭【OpenCode Go】段, 帳本R-OCGO-1) ══
    //共通: provider為opencode-go(與model前綴同名)、金鑰變數OPENCODE_GO_KEYS(不沿用OPENCODE_KEYS)、須金鑰(不匿名)、唯讀鎖同其餘oc:條目、
    //檔位依CLI型錄(opencode 1.19.5 `opencode models opencode-go --verbose`)逐條核對。不收REST類Go條目(必帶x-opencode-session, 見檔頭)。
    //註記: 〔本機實測〕＝da65當日實呼(經resolveProviders＋dispatchAiFallback, 已訂閱Go之金鑰, variant依本條、OC_READONLY); 〔提出端〕＝issue #65自述, 本機未重驗; 〔CLI型錄〕＝型錄欄位。
    //「月額」為官方Go頁〈Usage limits〉之Go方案(Go Plus／Go Teams另計)每模型月額, 5小時視窗為其20%、週50%; 單價為每百萬token美元(入／出)。
    //不訓練者在前、會訓練者(iceman、muse)殿後。
    {
        id: 'ocgo:opencode-go/beam-free',
        model: 'opencode-go/beam-free',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //與oc:opencode/beam-free同一模型、不同額度池: 走Go路徑不受opencode/*免費池限制——同日21:54匿名oc:opencode/beam-free見「Free usage limit reached」(run不結束),
        //約1分鐘內本條6.1s成功〔本機實測〕, 即免費池用盡時可續用(前提: 持有已訂閱Go之金鑰)。官方: Free(limited time)、Unlimited、不訓練、保留30天、限地區(不可用國家見檔頭)。
        //〔CLI型錄〕release 2026-10-05, 推理, context 1048576、輸出131072、僅文字, 檔位low/medium/high/xhigh/max。
        //〔本機實測〕(opencode 1.19.5、variant high): 簡答5.5s與6.1s、推理題4.9s答對(54)、read工具讀相對路徑6.0s正確、寫檔金絲雀6.6s被OC_READONLY擋下未落地
        //(write工具不在清單、bash自動拒絕; 此時回空字串而ok:true, 呼叫端宜帶validate); 用量端點三視窗前後皆不變(Unlimited不計額度)。
        //脈絡: 以針在乾草堆(針在開頭、問題在結尾)送約250萬字元(依iceman同文校準2.96字元/token估算約84.5萬token)答對29.7s; 未逼近型錄上限1,048,576, 故不寫「完整1M」(匿名免費路徑於2026-10-23曾實測到1,039,300, 見oc:opencode/beam-free)。
    },
    {
        id: 'ocgo:opencode-go/crouton-alpha-free',
        model: 'opencode-go/crouton-alpha-free',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //2026-11-07新增(Gitea #92, 主控任務20261107120446之ke339): 限時免費之stealth推理模型, 位置依「不訓練者在前」置beam-free之後; 收錄依帳本R-OCGO-1⑩(免費期模型須做滿本機金絲雀, 下列〔本機實測〕)。
        //官方: Free(limited time, limited regions)、Go／Go Plus／Go Teams皆Unlimited(不計額度)、Privacy不訓練、保留30天(同beam-free; 異於多數付費flash之0天)。
        //限地區(官方): 歐盟、阿富汗、白俄羅斯、中國(含港澳)、柬埔寨、古巴、厄利垂亞、衣索比亞、海地、伊朗、伊拉克、利比亞、緬甸、尼加拉瓜、北韓、巴基斯坦、俄羅斯、索馬利亞、敘利亞、委內瑞拉、西撒哈拉,
        //及上述以外國家之部分地區; 官方清單未列台灣, 本機(台灣)實呼可用。Go端點走responses協定家族(@ai-sdk/openai, /inference/go/openai/v1/responses, 同muse), 對CLI無影響。限時免費, 會下架(屆時依R-OCGO-1⑩)。
        //〔CLI型錄〕(opencode 1.19.5, `opencode models opencode-go --refresh --verbose`)status active、release 2026-11-03, 推理, context 1048576、輸出270000、可輸入文字／圖片／影片／PDF,
        //檔位minimal/low/medium/high/xhigh/max(型錄無canonical_id與family)。本機opencode之型錄快取舊時不列此模型, 依條目呼叫1.6～3.5秒即Exit code 1, 須先`opencode models opencode-go --refresh`。
        //〔本機實測〕(opencode 1.19.5、variant high、OC_READONLY、2026-11-07): 簡答25.3s成功(回覆多帶cwd之專案指示文字, 屬CLI讀專案指示之既有行為)、推理題25.2s答對(54)、
        //read工具讀相對路徑12.2s正確、寫檔金絲雀19.6s被OC_READONLY擋下未落地(write工具不在清單、bash自動拒絕; 此時回空字串而ok:true, 呼叫端宜帶validate); 用量端點三視窗前後皆不變(rolling 2%／weekly 50%／monthly 25%, Unlimited不計額度)。
        //〔提出端〕2026-11-07以同形extraProviders條目實呼簡答成交(帶--variant high 25.9s、不帶70.1s)。檔位實效: 本機以--format json同一題各跑1次, 不帶57.8s／minimal 15.8s／high 21.3s／max 13.2s,
        //最後一步reasoning tokens皆為0、耗時不隨檔位單調, 故提出端之25.9s對70.1s不宜解讀為檔位之作用; --variant high為CLI型錄所列之檔位(CLI接受), 沿「思考強度一律high」帶high, 其實效未證。
        //脈絡長度未測(依任務書可略), 不得假設等於型錄之1M(同為免費期之beam-free約84.5萬token答對、iceman約23萬token為上限, 見各條)。
    },
    {
        id: 'ocgo:opencode-go/deepseek-v4.1-flash',
        model: 'opencode-go/deepseek-v4.1-flash',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //須先於工作區Settings›Privacy›Regions選Global, 否則「This Go model requires Global regions…」〔提出端〕; 官方: 不訓練、保留0天*(零保留協議逐月續約至2026-11-30)。
        //〔CLI型錄〕release 2026-09-10, 推理, context 1000000、輸出384000、可輸入圖片, 檔位low/high/max。月額$100; 單價$0.15/$0.60(Off-Peak)、$0.30/$1.20(Peak: UTC週一至週五01-04與06-10)。
        //〔提出端〕簡答7.2s成功。本機未實測(付費模型); 同名免費版oc:opencode/deepseek-v4.1-flash-free脈絡非1M(實測約239K), 本條付費版之實際脈絡上限未測, 不假設為型錄之1M。
    },
    {
        id: 'ocgo:opencode-go/minimax-m3.1-flash',
        model: 'opencode-go/minimax-m3.1-flash',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //官方: 不訓練、保留0天。〔CLI型錄〕release 2026-10-19, 推理, context 1000000、輸出512000、可輸入圖片, 檔位low/medium/high/xhigh/max。月額$20(最低); 單價$0.15/$0.60。
        //〔提出端〕簡答8.7s成功。本機未實測(付費模型)。注意月額最低: 5小時視窗僅$4, 密集使用最先到頂。
    },
    {
        id: 'ocgo:opencode-go/qwen3.8-flash',
        model: 'opencode-go/qwen3.8-flash',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: ['--variant', 'xhigh'],
        //檔位: 〔CLI型錄〕僅low/medium/xhigh、無high, 故取不低於high之最高檔xhigh——偏離「思考強度一律high」(EFFORT常數註解), 為目錄內唯一例外(test/unit-providers.test.mjs逐model列出; 待使用者裁示)。
        //官方: 不訓練、保留0天; Go端點走anthropic協定家族(/inference/go/anthropic/v1/messages), 對CLI無影響。〔CLI型錄〕release 2026-08-26, 推理, context 1000000、輸出131072、可輸入圖片。月額$30; 單價$0.15/$0.47。
        //〔提出端〕簡答9.1s成功(xhigh)。本機未實測(付費模型)。
    },
    {
        id: 'ocgo:opencode-go/glm-5.3-flash',
        model: 'opencode-go/glm-5.3-flash',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //官方: 不訓練、保留0天。〔CLI型錄〕release 2026-08-26, 推理, context 1000000、輸出131072、可輸入圖片, 檔位low/high/max。月額$60; 單價$0.15/$0.50。
        //〔本機實測〕本條為本輪唯一一次付費簡答(variant high、OC_READONLY): 36.7s成功、回「完成」; 前後各查一次用量端點, rolling 10%→11%、weekly 4%、monthly 2%不變——
        //單次簡答不足以令整數百分比變動, 此+1%來自同時段該工作區其他使用(他人亦在用), 無法歸因於這1次, 故「用量計入」未能由此證明。推理題／read／寫檔金絲雀／脈絡長度皆未測。
        //〔提出端〕簡答9.5s成功; 提出端另報首臂以本條跑提煉流程時起草棒逾時600s與輸出驗證失敗(模型速度與格式問題, 非額度)——本機單次簡答36.7s亦明顯慢於提出端之9.5s, 呼叫端宜給足timeoutMs。
        //同名免費版oc:opencode/glm-5.3-flash-free有上游不穩之紀錄(見該條), 本條為付費Go路徑, 是否同樣不穩未測。
    },
    {
        id: 'ocgo:opencode-go/mimo-v2.6-flash',
        model: 'opencode-go/mimo-v2.6-flash',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        //官方: 不訓練、保留0天。〔CLI型錄〕release 2026-09-22, 推理, context 1048576、輸出131072、可輸入圖片, 無檔位故不帶--variant。月額$60; 單價$0.14/$0.28。
        //〔提出端〕簡答14.8s成功(提出端各條中最慢)。本機未實測(付費模型)。
    },
    {
        id: 'ocgo:opencode-go/iceman-contributor-free',
        model: 'opencode-go/iceman-contributor-free',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        outputTokenMax: 32000, //context 262144且型錄輸出上限131072: 維持CLI原預設以保輸入餘裕(下列「輸入實際上限約23萬token」以32000預留計); 截斷由detectTruncation回報; 要長輸出者以patch覆寫
        //【訓練資料】官方Privacy: 「Free for a limited time in exchange for permission to use your prompts and completions to improve the model」、模型訓練Yes、非零保留——敏感內容勿走此條;
        //工作區須開「Allow paid endpoints that train on request data」, 否則「This Go model trains on request data…」〔提出端〕(本機實測可用, 代表該工作區已開)。官方: Free(limited time)、Unlimited。
        //〔CLI型錄〕release 2026-10-24, 推理, context 262144、輸出131072、僅文字, 無檔位故不帶--variant。
        //〔本機實測〕(opencode 1.19.5、OC_READONLY): 簡答6.5s、推理題8.0s答對(54)、read工具讀相對路徑12.0s正確、寫檔金絲雀7.5s被擋下未落地(此時回空字串而ok:true, 呼叫端宜帶validate); 用量端點三視窗不變。
        //【脈絡長度(2026-11-03)】伺服器上限262139(略低於型錄262144), 且opencode預設預留32000給completion, 故輸入實際上限約23萬token(同flint-40b-free): 以針在乾草堆經CLI,
        //56萬字元(約18.9萬token)答對16.2s; 70萬字元(伺服器回報236233 input＋32000 completion＝268233 > 262139)被拒「Requested token count exceeds the model's maximum context length of 262139 tokens」,
        //CLI隨即自動壓縮脈絡(stdout為摘要文字而非答案)並以離開碼1結束。未二分逼近確切上限; 長提示詞宜控制在約18萬token(約53萬字元)以下。
    },
    {
        id: 'ocgo:opencode-go/muse-spark-1.3-contributor',
        model: 'opencode-go/muse-spark-1.3-contributor',
        kind: 'opencode',
        provider: 'opencode-go',
        envVar: 'OPENCODE_GO_KEYS',
        detectTruncation: true, //輸出被上限截斷時回報incomplete(不當成功、不重試), 見檔頭【輸出上限與截斷診斷】
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //【訓練資料】官方Privacy: 以大幅折價換取使用你的提示詞與回應訓練Meta未來模型, 模型訓練Yes、非零保留, 且限Meta地理使用政策允許之地區; 工作區須開「Allow paid endpoints that train on request data」〔提出端〕——敏感內容勿走此條。
        //〔CLI型錄〕release 2026-09-02, 推理, context 1048576、輸出131072、可輸入圖片, 檔位minimal/low/medium/high/xhigh; Go端點走responses協定家族, 對CLI無影響。月額$60; 單價$0.10/$0.20。
        //〔提出端〕簡答12.6s成功(須先開訓練開關)。本機未實測(付費模型)。
    },
    {
        id: 'agy:gemini-3.8-flash-high',
        model: 'gemini-3.8-flash-high', //2026-09-03自3.7升版(agy 1.1.25): 實測12.5s vs 3.7之62.2s, 讀檔14.6s vs 57.6s
        kind: 'antigravity',
        addDirs: ['.'],
        //保留CLI權限閘門(條目自帶防寫, 與其餘三家CLI條目一致): canary實測(2026-08-15)
        //無此鎖時要求建檔會真的落地(12.5s); false之下寫入被擋且不卡逾時(6.4s正常返回)、
        //唯讀工具照常(8.0s讀檔答對)。注意被擋時agy回ok:true且stdout為空(非報錯; agy 1.4.0起stderr帶
        //「jetski: no output produced — a tool required the "write_file" permission ...」說明, 仍以空輸出判別),
        //工作流層無害(空回覆過不了validate而自動遞補); 需要寫入能力請於條目覆寫為true
        skipPermissions: false,
    },
    //agy之Gemini 4 Argon(2026-10-16新增, 使用者指示): agy 1.4.0之`agy models`列gemini-4-argon-low/medium/high, `/effort`之available為
    //["low","medium","high"], 取-high符合EFFORT, 硬帶--effort max/xhigh回「has no "max" effort (available: low, medium, high)」。
    //額度池: `/usage`之獨立群組「Gemini 4 Argon」, 只有7天窗口(無5小時窗口), Pro方案與「Gemini Models」群組分開
    //(2026-10-16以4次呼叫前後對照實測: 用Argon時Gemini群組讀數0→0、用3.8時Argon讀數2.11→2.11, 皆未動);
    //官方描述Ultra方案計入較大之Gemini額度桶(Ultra實際回應未見, 未驗證)。故本機Pro觀察到的是額度池獨立(CLI、登入、網路仍與上一條共用, 非故障域獨立);
    //Ultra若如官方描述則與上一條共池。全取鏈中四條agy條目相鄰, agy整體卡頓時會連續逾時4次(約4×timeoutMs), 宜搭配budgetMs與cooldownMs。
    //排在3.8之後、不取代也不刪除3.8: 下游w-knowledge-extract以id引用3.8條目; 無任務級品質證據可證Argon較佳(四項輕量題兩者同分)。
    //防寫與addDirs同上一條。實測(agy 1.4.0、同時段與3.8對照, 經本條目設定): 簡答8.5s(3.8為8.2s)、推理題10.7s答對(11.9s)、
    //讀檔16.6s正確(13.7s)、寫檔金絲雀12.2s被擋未落地且ok:true、stdout空(stderr同3.8有「jetski: no output produced」說明)。
    //耗用量級: 4次短題使Argon 7天窗口由1.37增為2.11個百分點(+0.74), 與3.8使Gemini群組7天窗口由0增為0.72相當;
    //注意/usage讀數閒置時亦會在兩個值之間跳動而非單調(同帳號50秒內三次查詢, tmp/fix-20261016/probe-reset-drift.out: Gemini群組7天窗口0.93→0.07→0.93、Argon 3.91→3.39→3.91;
    //更早一輪亦見0.91→0.72→0.93), 跳動幅度可達約0.5~0.9個百分點, 故以下耗用數字僅可作量級參考, 不可精算單次耗用。
    //注意: 未給model時agy 1.4.0預設即Gemini 4 Argon (Medium)(日誌label為證; 2次無model呼叫使Argon+0.71)
    {
        id: 'agy:gemini-4-argon-high',
        model: 'gemini-4-argon-high',
        kind: 'antigravity',
        addDirs: ['.'],
        skipPermissions: false,
    },
    //agy之Claude兩條(2026-10-03新增, 使用者指示): agy 1.2.16之`agy models`已列claude-sonnet-5-5與claude-opus-5-5各low/medium/high,
    //取-high符合EFFORT(agy以slug檔位表示); high即agy對此兩模型開放之上限——`agy -p /effort --model <slug> --output-format json`
    //之available為["low","medium","high"], 硬帶--effort xhigh/max回「has no "max" effort (available: low, medium, high)」(同日實測)。
    //與下方claude:條目為同模型之不同路徑(id規則②, 屬不同供應商): 走Google帳號之agy額度
    //(`/usage`之「Claude and GPT models」群組, 有5小時與7天窗口, 與Gemini群組分開, 亦與Claude Code之Anthropic訂閱無關),
    //額度池與故障域獨立, claude:路徑受限時仍可遞補。同日實測(防寫與addDirs同agy:gemini條目): --log-file日誌確認送往後端之
    //模型label為「Claude Sonnet 5.5 (High)」/「Claude Opus 5.5 (High)」(--output-format json不帶模型名); 要求寫檔皆被擋未落地;
    //耗時起伏大(10~100s; 同時段Gemini對照組亦10~90s, 屬agy整體狀況); 偶回暫時性503(Eligibility check failed: UNAVAILABLE),
    //重試即成功, 由遞補層換家吸收。日誌開頭之「not logged into Antigravity」「not in local config」於Gemini對照組同樣出現, 屬啟動常態訊息
    {
        id: 'agy:claude-sonnet-5-5-high',
        model: 'claude-sonnet-5-5-high',
        kind: 'antigravity',
        addDirs: ['.'],
        skipPermissions: false,
        //實測: 簡答10.5~100.6s、推理題44.3s答對(但附解題過程, 未照「只回一行」)、讀檔80.5s正確
    },
    {
        id: 'agy:claude-opus-5-5-high',
        model: 'claude-opus-5-5-high',
        kind: 'antigravity',
        addDirs: ['.'],
        skipPermissions: false,
        //實測: 簡答9.8~77.4s、推理題53.5s答對且照格式、讀檔61.9s正確(首次遇503, 重試成功)
    },
    //claude兩條、codex三條: claude在前者(sonnet)與codex之luna為預設(全取遞補時先試), 其後為較強之新模型(2026-09-23使用者指示);
    //codex內terra排在sol之前(2026-10-28使用者指示: 2026-10-27起以terra為首選, 外審由sol改terra), luna維持最前、與其餘群組之相對順序不動
    {
        id: 'claude:sonnet', //當前為5.5
        model: 'sonnet',
        kind: 'claude',
        extraArgs: [...CLAUDE_READONLY, ...CLAUDE_EFFORT],
        //官方2026-09-28發布Sonnet 5.5; 2026-09-30於Claude Code 2.1.285以modelUsage實測別名已指向claude-sonnet-5-5。
        //用別名則新版Sonnet發布即自動切換(與opus-5.5寫全名之取捨見該條)
    },
    {
        id: 'claude:opus-5.5',
        model: 'claude-opus-5-5',
        kind: 'claude',
        extraArgs: [...CLAUDE_READONLY, ...CLAUDE_EFFORT],
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
        extraArgs: CODEX_EFFORT,
    },
    {
        id: 'codex:gpt-6.1-terra',
        model: 'gpt-6.1-terra',
        kind: 'codex',
        sandbox: 'read-only',
        extraArgs: CODEX_EFFORT,
        //2026-10-28新增GPT-6.1 Terra(使用者2026-10-27改以terra為Codex首選), 排在codex:gpt-6.1-sol之前、codex:gpt-5.6-luna之後。
        //欄位、唯讀沙箱與強度比照sol條目。Codex CLI 0.163.0之`codex debug models`已列(priority 3、脈絡500K、支援low~max與ultra),
        //惟型錄預設reasoning effort為low(default_reasoning_level)——未明給且執行機config.toml亦未設定時即跑最淺, 故本條必傳強度, 沿用統一之CODEX_EFFORT(high, 不另寫max)。
        //需要max(如外審)者於呼叫端以patch覆寫extraArgs為['--config', 'model_reasoning_effort="max"'](沙箱在sandbox欄位, 不在extraArgs, 覆寫不影響唯讀鎖)。
        //主控2026-10-27實測: `-m gpt-6.1-terra -c model_reasoning_effort="max"`實跑通過(標頭回model: gpt-6.1-terra、reasoning effort: max);
        //以dispatchCodex+sandbox:'workspace-write'實跑讀中文檔並寫檔通過。本條之唯讀沙箱金絲雀(要求寫檔須被擋)未對terra重測, 沿用sol條目之實測;
        //寫全名而非別名之理由同sol條目
    },
    {
        id: 'codex:gpt-6.1-sol',
        model: 'gpt-6.1-sol',
        kind: 'codex',
        sandbox: 'read-only',
        extraArgs: CODEX_EFFORT,
        //2026-09-30以GPT-6.1 Sol取代GPT-6 Sol(使用者指示; 前者2026-09-23收錄): 官方2026-09-29發布, Codex對Plus/Pro等開放;
        //Codex CLI 0.159.2之app-server model/list已列且為該帳號預設模型(isDefault), 實測8.6s, session紀錄確認服務模型為gpt-6.1-sol;
        //金絲雀實測唯讀沙箱擋下寫檔(回報沙箱唯讀、檔案未落地)。
        //寫全名而非別名: Codex無「最新版sol」之別名——官方Models文件未載別名, model/list各筆亦無別名欄位且upgrade為null;
        //不給model則改用執行機config.toml之model(本機實測不帶-m時跑gpt-5.6-sol)或官方推薦預設(不限sol系), 故新版發布時手動換。
        //若本機為較舊之codex而清單無此模型, 先執行`codex update`
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
        baseURL: 'https://opencode.ai/inference/systemone/v1',
        //2026-11-03改用官方〈Models〉頁端點欄之/inference/systemone/v1/systemone(原2026-10-13之/inference/v1、更早之/zen/v1; 同日三路徑匿名各1次皆200、noul 0.97/0.97/0.98,
        //新路徑帶第1把金鑰亦200且usage.opencode.billing_source為free, 見檔頭權威來源段; 舊路徑不留退路)。
        //TypeSafe之jev經OpenCode Console(原Zen)轉售(端點/inference/systemone/v1/systemone, 故用同一kind), 決策模型非文字生成:
        //用法與typesafe:jev-latest相同(pick單獨取出、questions置呼叫層, 詳dispatchApiTypesafeSystemone.mjs檔頭)。
        //2026-09-22實測: 連3次200(0.66~1.24s), 答案與TypeSafe官方端點一致(同題category相同、noul差0.01);
        //不帶金鑰亦200(0.57s), 即Zen對話型免費模型之403閘門不套用於/systemone; 壞金鑰回401 AuthError。
        //付費版jev-1.13未收: 同日以第1把金鑰實測403(Upstream request failed: Model access is disabled),
        //屬該金鑰工作區未開此模型; 要收須先於Zen後台開啟並確認計費($0.042/1M輸入)。
    },
    //REST文字生成條目(api-openai-compat): agnes:/poolside:走各家官方端點。zen:之對話型免費模型REST皆受免費層閘門所擋
    //(最後一條zen:space-bunny-free已於2026-10-13移除), 現無收錄; 端點表與閘門見檔頭
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
            max_tokens: 32768,
            chat_template_kwargs: { enable_thinking: true },
        },
        //思考為開關而非檔位: 2026-09-30依「思考強度一律high」由false改true(原false無紀錄說明)。同日實測(第1把金鑰):
        //不帶此欄即為開啟(推理829、27.6s); false時推理0、3.8s但一題正整數邊長矩形題答錯(12,3,6), true時答對(3,3,3、20.7s)。
        //reasoning_effort於false時HTTP 400、true時接受但推理token無一致差異, 故不帶。開思考後推理token計入max_tokens,
        //依README「推理模型請放寬body.max_tokens」由8192改32768(同日實測接受, 列10縣市題用538)
    },

    //══ 以下六條為「計費條目」(Anthropic Console之API金鑰, 全取遞補時最後才輪到; 先CLI後REST) ══
    //claude-api:三條(2026-10-24新增, 使用者指示): Claude Code CLI + Anthropic Console之API金鑰計費(與上方claude:訂閱條目同CLI、不同計費路徑, 故為不同供應商)。
    //key由resolveProviders自.env的ANTHROPIC_KEYS展開、dispatchAiFallback逐把注入, dispatchClaude只放進該次子進程環境並移除其他憑證變數與繼承之父Claude Code session連結變數(於Claude Code工作階段內呼叫時, 否則子claude沿用父登入而無視key; 見該檔檔頭);
    //防寫白名單與強度同claude:條目(CLAUDE_READONLY、CLAUDE_EFFORT)。模型寫完整ID(API計費下別名隨CLI版本漂移, 固定ID令計費與行為可預期)。
    //官方定價(claude-api技能快取, 2026-10-06)每百萬token: Opus 5.5 $4/$20、Sonnet 5.5 $2/$10、Haiku 5.5 $0.10/$0.50(提示詞≤100K tokens)。
    //驗證確實走API金鑰: extraArgs加['--output-format','stream-json','--verbose'], 首個system/init事件之apiKeySource須為'ANTHROPIC_API_KEY'。
    //限流/額度不足(2026-10-25起): 帶key之CLI失敗結果加failureKind(stream-json之assistant.error／api_error_status與Claude Code 2.1.302內嵌字樣; 字樣除「Credit balance is too low」外未實測),
    //cooldownMs>0時限流不需coolDetect即冷卻(failureKind為rate-limit); 「沒額度」須經REST交叉確認(見dispatchClaude.mjs檔頭), REST成功則判env-error(呼叫方式或環境錯誤)而非沒額度。
    //--effort high於opus/sonnet/haiku三模型是否皆被Claude Code 2.1.302接受: 本檔撰寫時未發真實請求實測, 由主控實測回填。
    {
        id: 'claude-api:opus-5.5',
        model: 'claude-opus-5-5',
        kind: 'claude',
        envVar: 'ANTHROPIC_KEYS',
        extraArgs: [...CLAUDE_READONLY, ...CLAUDE_EFFORT],
    },
    {
        id: 'claude-api:sonnet-5.5',
        model: 'claude-sonnet-5-5',
        kind: 'claude',
        envVar: 'ANTHROPIC_KEYS',
        extraArgs: [...CLAUDE_READONLY, ...CLAUDE_EFFORT],
    },
    {
        id: 'claude-api:haiku-5.5',
        model: 'claude-haiku-5-5',
        kind: 'claude',
        envVar: 'ANTHROPIC_KEYS',
        extraArgs: [...CLAUDE_READONLY, ...CLAUDE_EFFORT],
    },
    //anthropic:三條(2026-10-24新增, 使用者指示): REST直呼Anthropic Messages API(POST https://api.anthropic.com/v1/messages), 純文字生成、以Console之API金鑰計費。
    //envVar ANTHROPIC_KEYS(同claude-api:條目; 勿用ANTHROPIC_API_KEY, 理由見檔頭【Anthropic API金鑰條目】)。置於清單末端: 全取遞補時最後才耗用API額度。
    //協定與各模型限制(完整見dispatchApiAnthropic.mjs檔頭【思考與effort】): 皆自適應思考(省略thinking即開, 條目不送thinking)、effort明給high(Opus 5.5與Haiku 5.5之API預設為medium)、
    //無temperature/top_p/top_k、思考token計入max_tokens(預設16000; 長輸出請於條目或呼叫層覆寫body.max_tokens)。stop_reason處置: max_tokens截斷預設失敗、refusal失敗且整組跳過。
    //限流/額度(官方錯誤碼; 2026-10-25起以failureKind細分類): 429 rate_limit_error(限流)由遞補層內建冷卻觸發並換下一把; 月花費上限之429(error_code enforced_spend_limit_reached)、
    //402 billing_error、400自設花費上限、400「Your credit balance is too low to access the Anthropic API」(第三方回報)皆為no-credit: 換下一把且本次呼叫內同一把不再用於其他官方端點條目、全部金鑰皆沒額度才標quotaExhausted;
    //401 authentication_error、403 permission_error換下一把不冷卻; 400「prompt is too long」與413為context-too-long: 立即結束整個呼叫; 連線失敗/逾時/504為network: 不換金鑰。
    //定價(claude-api技能快取, 2026-10-06)每百萬token: Opus 5.5 $4/$20、Sonnet 5.5 $2/$10、Haiku 5.5 $0.10/$0.50(提示詞≤100K tokens)。本檔撰寫時未發真實請求, 實測由主控回填。
    {
        id: 'anthropic:opus-5.5',
        model: 'claude-opus-5-5',
        kind: 'api-anthropic',
        envVar: 'ANTHROPIC_KEYS',
        effort: EFFORT,
        //Opus 5.5: 思考不可關閉(disabled與budget_tokens皆400), effort預設medium故明給high; 1M脈絡、輸出上限128K
    },
    {
        id: 'anthropic:sonnet-5.5',
        model: 'claude-sonnet-5-5',
        kind: 'api-anthropic',
        envVar: 'ANTHROPIC_KEYS',
        effort: EFFORT,
        //Sonnet 5.5: thinking disabled回400(關思考須用between_tools, 本條目不關); effort預設high(各級重新校準, 與Sonnet 5不同)
    },
    {
        id: 'anthropic:haiku-5.5',
        model: 'claude-haiku-5-5',
        kind: 'api-anthropic',
        envVar: 'ANTHROPIC_KEYS',
        effort: EFFORT,
        //Haiku 5.5: 預設開自適應思考; effort預設medium故明給high; 不支援伺服器端fallbacks(帶則400); 提示詞超過100K tokens單價改為$0.50/$2.50
    },

]


export default providers
