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
//     https://opencode.ai/inference/v1/models      ← 【可用性之唯一事實】當前可用model id清單(需Bearer金鑰)
//     `opencode models opencode --refresh`         ← CLI側之同一事實(CLI catalog, 匿名亦可查)
//     https://opencode.ai/docs/zen/                ← v1文件網址, 2026-10-13起內容與v2頁位元組完全相同(已併入v2)
//
//   ★ 端點基底改名(2026-10-13查證) ★ 官方文件與CLI目錄之端點基底已由https://opencode.ai/zen/v1改為
//     https://opencode.ai/inference/v1(其後路徑不變: /chat/completions、/responses、/systemone…)。同日實測舊基底仍可用
//     (/models清單、systemone作答、免費層閘門之回應皆與新基底相同); zen:jev-1.13-free已改用新基底。本檔以下沿用/zen/v1
//     之記載多為改名前之實測紀錄, 皆可對應改讀為/inference/v1。條目id之zen:前綴為閘道名(OpenCode Zen), 不隨網址改。
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
//     故判準固定為: 文件只用於「端點種類與計價」, 「能不能用」一律以/inference/v1/models或`opencode models`加實測為準。
//
//   ★ 核心事實: zen「不是」單一OpenAI相容端點, 端點依模型家族而異 ★
//     依官方文件之端點欄(2026-09-22以v2 Console/Models頁複查, 分佈與v1一致; 2026-10-13起基底為/inference/v1, 下列以舊基底記載):
//       /zen/v1/chat/completions   @ai-sdk/openai-compatible  ← 本套件api-openai-compat僅支援此種
//         mimo-v2.5-free / ling-3.0-flash-fin-free / nemotron-3-ultra-free /
//         nemotron-3.5-lightning-free / big-pickle / space-bunny-free(2026-09-24查證) /
//         ling-3.1-flash-free / longcat-2.5-preview-free(2026-10-03查證) / cat-jam-free / step-5-preview-free(2026-10-13查證) /
//         glm-* / kimi-* / minimax-* / deepseek-v4-*
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
//     ① 該model id在 /inference/v1/models(舊基底/zen/v1/models同) 清單內;
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
//
//   ★ 走不通REST時的替代路徑: 同模型改用oc:(opencode CLI) ★
//     opencode CLI內建各模型正確的端點與AI SDK, 故REST不通的模型走CLI往往正常
//     (實測: muse-spark 1.2/1.3之REST 500而CLI皆秒級成功)。CLI版模型id為
//     `opencode/<model-id>`, 可用 `opencode models` 列出; 兩者屬不同供應商條目(見id命名)。
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
//           (app-server model/list之defaultReasoningEffort, gpt-6.1-sol為low)——明給令條目不隨安裝機之設定而變;
//           同日實測--config覆寫優先於config.toml(給low時session記為low)。
//  opencode --variant: 僅部分模型有檔位, 以`opencode models <provider> --verbose`之variants查(同日opencode 1.18.33:
//           muse-spark-1.2(2026-10-03已移除)/1.3與space-bunny有high; big-pickle、mimo無檔位; agnes-ai、poolside為自訂provider亦無;
//           2026-10-03新收之ling-3.1-flash、longcat-2.5-preview亦有high(同日所收fledge-alpha已於10-13移除), opencode 1.18.34;
//           2026-10-13新收之cat-jam(另有xhigh/max)、step-5-preview亦有high, opencode 1.18.35;
//           2026-10-18新收之beam(另有xhigh/max)亦有high、同日移除muse-spark-1.3, opencode 1.19.3;
//           同日新收之deepseek-v4.1-flash、glm-5.3-flash為low/high/max亦有high, 同日移除ling-3.1-flash、cat-jam、step-5-preview;
//           同日再收之nemotron-3.5-super-vl為none~xhigh亦有high, nemotron-3-ultra、nemotron-3.5-lightning無檔位;
//           同日以minimax-m3.1-flash(low~max, 亦有high)取代space-bunny(同一模型恢復真名)),
//           無檔位之條目不帶。同日實測space-bunny之variant low/high推理token為18/71, opencode.db之訊息記錄variant。
//  REST     body.reasoning_effort: 原僅zen:space-bunny-free帶(該條2026-10-13已移除, 現無內建REST條目帶此欄)——
//           opencode模型目錄宣告其high檔即{reasoningEffort:'high'}
//           (@ai-sdk/openai-compatible轉為此欄), 與oc:版同參數。agnes接受此欄但同日兩題各兩輪推理token無一致差異,
//           視為未生效故不帶(其預設即會思考, usage可見推理token)。poolside之思考為開關(chat_template_kwargs.enable_thinking)
//           而非檔位, 同日由關改開(見該條); jev(systemone)為決策模型無此概念。
//  agy      以模型slug之檔位表示(gemini-3.8-flash-high、gemini-4-argon-high、claude-sonnet-5-5-high、claude-opus-5-5-high), 不另帶--effort
//           (與slug檔位不一致時agy報conflicts)。各模型可選檔位因模型而異(2026-10-16: Gemini 4 Argon與3.8 Flash皆為low/medium/high, 無xhigh/max),
//           以`agy -p /effort --model <slug> --output-format json`之available查(不耗額度; Git Bash下須加MSYS_NO_PATHCONV=1,
//           否則/effort被改寫成路徑而當成提示詞送出)。
//  注意: 條目覆寫extraArgs時須一併帶上本常數(與防寫常數), 否則回退各CLI之預設強度。
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
    {
        id: 'oc:opencode/minimax-m3.1-flash-free',
        model: 'opencode/minimax-m3.1-flash-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //2026-10-19新增(使用者指示): 即原stealth模型space-bunny-free恢復真名(space-bunny已自CLI清單與官方文件消失, 呼叫回
        //UnknownError; 本條置於其原位, 全取者遞補順序不變)。官方文件〈Models〉〈Pricing〉列MiniMax M3.1 Flash Free(Free|Free|Free|-、
        //端點/chat/completions), 說明為限時免費、供應商零保留且不以資料訓練; CLI清單(--refresh)有; REST匿名與第1把金鑰各2次皆403
        //FreeTierError, 故只收oc:版。CLI目錄release_date 2026-10-19; 推理模型, context 1000000、輸出上限512000、可輸入圖片與影片;
        //檔位low~max。匿名CLI實測(opencode 1.19.3、variant high): 簡答6.5s、推理題6.7s答對、read工具讀相對路徑9.4s正確、
        //要求寫檔被OC_READONLY擋下未落地(回空字串而ok:true)。
        //【脈絡長度(同日實測)】確為約1M: 針在乾草堆以預設設定實測至949,360 token仍答對且未於本機壓縮(299K/479K/599K/899K/949K皆過)
    },
    //以下一條2026-10-03新增(使用者指示; 原三條, fledge-alpha-free已於2026-10-13、ling-3.1-flash-free已於2026-10-18下架並移除,
    //見檔頭漂移紀錄): 官方v1/v2文件、CLI清單(--refresh)與/zen/v1/models皆有, 〈Pricing〉全Free,
    //端點/chat/completions; REST不收zen:版——同日匿名與第1把金鑰各2次皆403 FreeTierError(免費層閘門, 見檔頭)。
    //匿名CLI實測皆以opencode 1.18.34、variant high(opencode.db記錄確認): 簡答、推理題(答對)、read工具讀相對路徑(正確)、
    //要求寫檔(被OC_READONLY擋下未落地)四項皆過
    {
        id: 'oc:opencode/longcat-2.5-preview-free',
        model: 'opencode/longcat-2.5-preview-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        extraArgs: OC_EFFORT,
        //CLI目錄release_date 2026-09-25; 推理模型, context 1M、輸出上限131072、可輸入圖片。
        //實測: 簡答12.0s、推理題13.1s、讀檔21.6s、寫檔金絲雀16.1s。
        //官方〈Privacy〉載明其供應商零保留且不以資料訓練(同space-bunny)
    },
    //(2026-10-13新增之oc:opencode/cat-jam-free、step-5-preview-free已於2026-10-18下架並移除, 見檔頭漂移紀錄)
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
    //以下三條2026-10-18新增(使用者指示; 使用者告知額度少且慢, 故排在opencode免費條目之末): 官方文件〈Models〉〈Pricing〉皆列Free、
    //端點/chat/completions, CLI清單(--refresh)有; REST不收zen:版——同日匿名與第1把金鑰各2次皆403 FreeTierError。
    //官方說明為限時開放、團隊藉此收集回饋改進模型; 〈Privacy〉載明為NVIDIA免費端點、僅供試用, 勿送個人或機密資料。
    //匿名CLI實測皆以opencode 1.19.3: 簡答、推理題(答對)、read工具讀相對路徑(正確)、要求寫檔(被OC_READONLY擋下未落地, 回空字串而ok:true)四項皆過
    {
        id: 'oc:opencode/nemotron-3-ultra-free',
        model: 'opencode/nemotron-3-ultra-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
        //CLI目錄release_date 2026-06-04; 推理模型, context 1000000、輸出上限128000、僅文字輸入; 無檔位故不帶OC_EFFORT。
        //實測: 簡答7.9s、推理題9.0s、讀檔12.7s、寫檔金絲雀9.3s
    },
    {
        id: 'oc:opencode/nemotron-3.5-lightning-free',
        model: 'opencode/nemotron-3.5-lightning-free',
        kind: 'opencode',
        provider: 'opencode',
        useStoredAuth: false,
        config: {
            permission: OC_READONLY,
        },
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
        },
        extraArgs: OC_EFFORT,
        //CLI目錄release_date 2026-10-15; 推理模型, context 1M(1048576)、輸出上限131072、可輸入圖片; 檔位none/minimal/low/medium/high/xhigh。
        //實測(variant high): 簡答8.3s、推理題10.1s、讀檔9.1s、寫檔金絲雀14.1s
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
    //claude/codex各兩條: 在前者為預設(全取遞補時先試), 在後者為較強之新模型(2026-09-23使用者指示)
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
        baseURL: 'https://opencode.ai/inference/v1',
        //2026-10-13改用官方新基底/inference/v1(原/zen/v1; 同日新舊基底皆實測200且答案相同, 見檔頭權威來源段)。
        //TypeSafe之jev經OpenCode Zen轉售(端點/zen/v1/systemone, 故用同一kind), 決策模型非文字生成:
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

]


export default providers
