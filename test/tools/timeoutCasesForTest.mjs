// timeoutCasesForTest.mjs — timeoutMs輸入表(測試與子行程探針共用)
//
// 規格(2026-11-13 da-hy, 排程第438項; 帳本G17與dspec〈輸入參數之檢測機制〉§11第19～21項; wsemi 1.9.59起execCli之timeoutMs以iseint之timer判定):
//   timeoutMs為「可計算之正整數且不超過計時器上限2147483647」(數字或可無損轉數字之十進位字串)才採用, 其餘(含Infinity、小數、0、負數、超過上限、
//   '0x10'、包裝物件、陣列、BigInt、布林、null、未給)一律視為未給、改用各入口自己之預設(轉接器與遞補層為全套件統一之300000), 不夾至上限、不報錯。
//   wsemi execCli對非預期值改用「它自己的」預設120000, 故本套件須於入口先判定, 令外層不會落到120000(兩層預設不一致)。


//全套件統一預設(dfTimeoutMs.mjs之值, 規格字面寫死, 不由src匯入以免測試跟著被測物改變)
export let DF = 300000

//計時器上限(setTimeout之極限, wsemi execCli之timeoutMs上限)
export let TIMER_MAX = 2147483647


//PAIRS, 遞補層逐層判定用: [條目自帶之timeoutMs, 共用opt之timeoutMs](undefined代表未給)
export let PAIRS = [[5000, 9000], [3000000000, 9000], [Infinity, 9000], ['0x10', 9000], [undefined, 9000], [1.5, '7000'], [3000000000, 3000000000], [undefined, undefined], [5000, 3000000000]]


//CASES, v為輸入值, want為「有效時之採用值」(無效者為null, 採用各入口自己之預設)
export let CASES = [
    { label: '1', v: 1, want: 1 },
    { label: '999', v: 999, want: 999 },
    { label: '1001', v: 1001, want: 1001 },
    { label: '5000', v: 5000, want: 5000 },
    { label: '39999', v: 39999, want: 39999 }, //--print-timeout推導之邊界: floor(39.999)+30＝69s(舊推導timeoutMs減30秒之關鍵格鄰近)
    { label: '40000', v: 40000, want: 40000 },
    { label: '40001', v: 40001, want: 40001 },
    { label: '300000', v: 300000, want: 300000 },
    { label: '\'5000\'(數字字串)', v: '5000', want: 5000 },
    { label: '\' 12 \'(含空白之數字字串)', v: ' 12 ', want: 12 },
    { label: '2147483647(計時器上限)', v: 2147483647, want: TIMER_MAX },
    { label: '2147483648(超過上限1)', v: 2147483648, want: null },
    { label: '3000000000', v: 3000000000, want: null },
    { label: '9223372007000', v: 9223372007000, want: null },
    { label: 'Number.MAX_SAFE_INTEGER', v: Number.MAX_SAFE_INTEGER, want: null },
    { label: 'Number.MAX_VALUE', v: Number.MAX_VALUE, want: null },
    { label: 'Infinity', v: Infinity, want: null },
    { label: '\'Infinity\'', v: 'Infinity', want: null },
    { label: '-Infinity', v: -Infinity, want: null },
    { label: 'NaN', v: NaN, want: null },
    { label: '0', v: 0, want: null },
    { label: '-1', v: -1, want: null },
    { label: '1.5', v: 1.5, want: null },
    { label: '40000.5', v: 40000.5, want: null },
    { label: '\'0x10\'', v: '0x10', want: null },
    { label: '\'abc\'', v: 'abc', want: null },
    { label: '\'\'', v: '', want: null },
    { label: 'null', v: null, want: null },
    { label: 'undefined(未給)', v: undefined, want: null },
    { label: 'true', v: true, want: null },
    { label: '[5000]', v: [5000], want: null },
    { label: '{}', v: {}, want: null },
    //包裝物件為刻意之輸入(ispint為真、iseint為假)
    // eslint-disable-next-line no-new-wrappers
    { label: 'new Number(5000)(包裝物件)', v: new Number(5000), want: null },
    { label: '5000n(BigInt)', v: 5000n, want: null },
]
