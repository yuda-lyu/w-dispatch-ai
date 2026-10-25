# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

## 索引(哪類規則查哪個檔;2026-10-25 起主檔只留索引,節號與標題不變)

| 類型 | 檔 | 規則編號 | 一句話 |
|---|---|---|---|
| 子進程啟動與回報分流 | `sgud/rule/rulebook_spawn.md` | R-SPAWN-1～3、R-VALIDATE-1、R-REDACT-1、R-NOREJECT-1 | `isSpawnFail` 結構判定、遞補之「與金鑰無關」分流、CLI 單一入口 `runExecCli`、validate、錯誤訊息遮蔽單一來源 `redactText`、永不 reject |
| 呼叫端注入之函數與物件 | `sgud/rule/rulebook_userfn.md` | R-USERFN-1～3 | 注入之函數與物件只經 `callUserFn.mjs`;validate 之判定(CLI、REST、遞補、工作流同規則);wsemi 1.9.16／1.9.17 連動 |
| agy 型錄、額度與逾時 | `sgud/rule/rulebook_agy.md` | R-QUOTA-1～2、R-AGY-1～3 | `/usage` 群組與窗口由 agy 決定、格式漂移不得靜默成功、內建 agy 條目與型錄對齊、逾時階梯、非成功結局分流 |
| Anthropic API 金鑰計費 | `sgud/rule/rulebook_anthropic.md` | R-ANTHROPIC-1～4 | CLI 帶 `key`(子進程環境、移除優先憑證、遮蔽)、kind `api-anthropic`(請求形狀、stop_reason、HTTP 錯誤)、providers 六條與 `ANTHROPIC_KEYS`、CLI key 模式移除繼承之父 Claude Code session 連結變數(R-ANTHROPIC-4)、變異驗證表(M1～M40) |
| Anthropic 失敗細分類與遞補處置 | `sgud/rule/rulebook_failurekind.md` | R-ANTHROPIC-5 | `failureKind` 細分類(REST／CLI)、CLI「沒額度」REST 交叉確認、遞補依分類處置(沒額度跨條目略過／脈絡過長立即結束／網路與環境錯誤整組跳過／金鑰冷卻)、金鑰探測 `probeAnthropicKeys`、`*_KEYS` 分號處置、94 個變異驗證表 |

引用說明:程式碼註解與測試中之「帳本R-XXX-N」仍指上表對應檔內同編號之節.
