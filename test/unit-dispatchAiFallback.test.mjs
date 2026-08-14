import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//assertKey, 由假CLI回聲之OPENCODE_AUTH_CONTENT解出本次注入之金鑰
let getInjectedKey = (stdout) => {
    let o = JSON.parse(stdout)
    let auth = o.env.OPENCODE_AUTH_CONTENT
    if (auth === '') {
        return ''
    }
    let j = JSON.parse(auth)
    return Object.values(j)[0].key
}


describe('dispatchAiFallback', function() {

    let fake = null

    before(function() {
        fake = createFakeCli('fake-fallback')
    })

    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    it('prompt非有效字串時回傳錯誤結果物件且tried為空', async function() {
        let t = await dispatchAiFallback('', { providers: [{ kind: 'claude' }] })
        let r = [t.ok, t.error, t.tried]
        let rr = [false, 'prompt must be a non-empty string', []]
        assert.strict.deepEqual(r, rr)
    })

    it('providers非有效陣列時回傳錯誤結果物件', async function() {
        let r = []
        for (let providers of [null, undefined, [], {}, 'abc', [null, 'x', 123]]) {
            let t = await dispatchAiFallback('abc', { providers })
            r.push([t.ok, t.error])
        }
        let rr = [
            [false, 'providers must be a non-empty array'],
            [false, 'providers must be a non-empty array'],
            [false, 'providers must be a non-empty array'],
            [false, 'providers must be a non-empty array'],
            [false, 'providers must be a non-empty array'],
            [false, 'providers must be a non-empty array'],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('某把金鑰失敗自動換組內下一把並成功', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                {
                    id: 'g-rotate',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'opencode',
                    keys: ['sk-bad-aaa', 'sk-good-bbb'],
                    extraArgs: ['--fake-fail-key=sk-bad'],
                },
            ],
        })
        let r = [
            t.ok,
            t.providerId,
            t.keyIndex,
            getInjectedKey(t.stdout),
            t.tried.map((x) => [x.keyId, x.outcome]),
        ]
        let rr = [
            true,
            'g-rotate',
            1,
            'sk-good-bbb',
            [['g-rotate#0', 'next-key'], ['g-rotate#1', 'ok']],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('成功亦推進游標, 多把金鑰跨次呼叫輪替均攤', async function() {
        let providers = [{
            id: 'g-cursor',
            kind: 'opencode',
            exe: fake.exe,
            provider: 'opencode',
            keys: ['sk-k0', 'sk-k1', 'sk-k2'],
        }]
        let r = []
        for (let i = 0; i < 4; i++) {
            let t = await dispatchAiFallback('abc', { providers })
            r.push(getInjectedKey(t.stdout))
        }
        let rr = ['sk-k0', 'sk-k1', 'sk-k2', 'sk-k0']
        assert.strict.deepEqual(r, rr)
    })

    it('store注入時游標經store持久化, 各群組游標互不干擾', async function() {
        let stored = { cursors: {} }
        let store = {
            get: () => stored,
            set: (s) => {
                stored = s
            },
        }
        let providers = [{
            id: 'g-store-a',
            kind: 'opencode',
            exe: fake.exe,
            provider: 'opencode',
            keys: ['sk-a0', 'sk-a1'],
        }]
        let t1 = await dispatchAiFallback('abc', { providers, store })
        let t2 = await dispatchAiFallback('abc', { providers, store })
        let r = [
            getInjectedKey(t1.stdout),
            getInjectedKey(t2.stdout),
            stored.cursors['g-store-a'],
            stored.cursors['g-store-b'],
        ]
        let rr = ['sk-a0', 'sk-a1', 0, undefined]
        assert.strict.deepEqual(r, rr)
    })

    it('整組金鑰用盡時遞補下一組', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                {
                    id: 'g-dead',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'opencode',
                    keys: ['sk-bad-1', 'sk-bad-2'],
                    extraArgs: ['--fake-fail-key=sk-bad'],
                },
                { id: 'g-alive', kind: 'claude', exe: fake.exe },
            ],
        })
        let o = JSON.parse(t.stdout)
        let r = [
            t.ok,
            t.providerId,
            t.keyIndex,
            o.args[0], //claude轉接器之固定首旗標
            t.tried.map((x) => [x.providerId, x.outcome]),
        ]
        let rr = [
            true,
            'g-alive',
            null,
            '-p',
            [['g-dead', 'next-key'], ['g-dead', 'next-key'], ['g-alive', 'ok']],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('逾時為與金鑰無關之失敗, 一把即整組跳過不逐把空耗', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                {
                    id: 'g-hang',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'opencode',
                    keys: ['sk-h0', 'sk-h1', 'sk-h2'],
                    extraArgs: ['--fake-sleep=10000'],
                    timeoutMs: 1000,
                },
                { id: 'g-next', kind: 'claude', exe: fake.exe },
            ],
        })
        let r = [
            t.ok,
            t.providerId,
            t.tried.length, //hang組僅1筆而非3筆
            t.tried[0].outcome,
            t.tried[0].error.indexOf('TIMEOUT') === 0,
        ]
        let rr = [true, 'g-next', 2, 'skip-group', true]
        assert.strict.deepEqual(r, rr)
    })

    it('參數錯誤(code=2)整組跳過', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                {
                    id: 'g-arg',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'opencode',
                    keys: ['sk-x0', 'sk-x1'],
                    extraArgs: ['--fake-exit=2'],
                },
                { id: 'g-ok', kind: 'codex', exe: fake.exe },
            ],
        })
        let r = [t.ok, t.providerId, t.tried.map((x) => x.outcome)]
        let rr = [true, 'g-ok', ['skip-group', 'ok']]
        assert.strict.deepEqual(r, rr)
    })

    it('輸出未過驗證整組跳過, 條目validate覆寫共用預設', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                {
                    id: 'g-badout',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'opencode',
                    keys: ['sk-v0', 'sk-v1'],
                    validate: 'min:100000',
                },
                { id: 'g-anyout', kind: 'claude', exe: fake.exe },
            ],
        })
        let r = [
            t.ok,
            t.providerId,
            t.tried.map((x) => [x.outcome, x.error || null]),
        ]
        let rr = [
            true,
            'g-anyout',
            [['skip-group', 'OUTPUT_VALIDATION_FAILED'], ['ok', null]],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('執行檔不存在(ENOENT)整組跳過', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                { id: 'g-noexe', kind: 'claude', exe: 'no-such-cli-for-test', keys: ['sk-n0', 'sk-n1'] },
                { id: 'g-hasexe', kind: 'claude', exe: fake.exe },
            ],
        })
        let r = [t.ok, t.providerId, t.tried.map((x) => x.outcome)]
        let rr = [true, 'g-hasexe', ['skip-group', 'ok']]
        assert.strict.deepEqual(r, rr)
    })

    it('kind無效之條目整組跳過, 不中斷後續遞補', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                { id: 'g-unknown', kind: 'gemini' },
                { id: 'g-known', kind: 'claude', exe: fake.exe },
            ],
        })
        let r = [
            t.ok,
            t.providerId,
            t.tried[0].outcome,
            t.tried[0].error.indexOf('unknown ai kind') === 0,
        ]
        let rr = [true, 'g-known', 'skip-group', true]
        assert.strict.deepEqual(r, rr)
    })

    it('全數供應商失敗時回傳最後一筆失敗結果與完整歷程', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [
                { id: 'g-f1', kind: 'claude', exe: fake.exe, extraArgs: ['--fake-exit=1'] },
                { id: 'g-f2', kind: 'codex', exe: fake.exe, extraArgs: ['--fake-exit=1'] },
            ],
        })
        let r = [
            t.ok,
            t.code,
            t.error,
            t.providerId,
            t.tried.map((x) => [x.providerId, x.outcome]),
        ]
        let rr = [
            false,
            1,
            'Exit code 1',
            'g-f2',
            [['g-f1', 'next-key'], ['g-f2', 'next-key']],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('預算不足一次最低嘗試時停止並回報budget exhausted', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [{ id: 'g-nobudget', kind: 'claude', exe: fake.exe }],
            budgetMs: 50,
            minAttemptMs: 100,
        })
        let r = [t.ok, t.error, t.tried.map((x) => x.outcome)]
        let rr = [false, 'budget exhausted', ['budget-out']]
        assert.strict.deepEqual(r, rr)
    })

    it('剩餘預算會壓進attempt之timeoutMs', async function() {
        let t = await dispatchAiFallback('abc', {
            providers: [{
                id: 'g-clamp',
                kind: 'claude',
                exe: fake.exe,
                extraArgs: ['--fake-sleep=10000'], //timeoutMs未給, 預設120000, 應被預算4000封頂
            }],
            budgetMs: 4000,
            minAttemptMs: 100,
        })
        let r = [
            t.ok,
            t.tried[0].outcome,
            t.error.indexOf('TIMEOUT') === 0,
            t.durationMs < 9000, //遠小於fake-sleep之10000, 證明timeout被封頂
        ]
        let rr = [false, 'skip-group', true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('cooldownMs啟用時, 逾時觸發冷卻且次輪該條目降至鏈尾(只降序不移除)', async function() {
        let stored = { cursors: {}, cooling: {} }
        let store = {
            get: () => stored,
            set: (s) => {
                stored = s
            }
        }
        let pHang = { id: 'cd-hang', kind: 'claude', exe: fake.exe, extraArgs: ['--fake-sleep=9000'], timeoutMs: 500 }
        let pOk = { id: 'cd-ok', kind: 'claude', exe: fake.exe }
        //第1輪: hang在鏈首 → 逾時跳組並觸發冷卻 → ok遞補
        let r1 = await dispatchAiFallback('abc', { providers: [pHang, pOk], store, cooldownMs: 300000 })
        //第2輪: hang冷卻中 → 降至鏈尾, ok先上且成功, hang完全未被嘗試
        let r2 = await dispatchAiFallback('abc', { providers: [pHang, pOk], store, cooldownMs: 300000 })
        let r = [
            r1.providerId,
            r1.tried.map((x) => x.providerId),
            typeof stored.cooling['cd-hang'],
            r2.providerId,
            r2.tried.map((x) => x.providerId), //只有cd-ok, 未浪費一次逾時
        ]
        let rr = ['cd-ok', ['cd-hang', 'cd-ok'], 'number', 'cd-ok', ['cd-ok']]
        assert.strict.deepEqual(r, rr)
    })

    it('冷卻中的條目於前面全敗時仍會被嘗試, 且成功即解除冷卻', async function() {
        let stored = { cursors: {}, cooling: { 'cd2-a': Date.now() } } //預置: a冷卻中
        let store = {
            get: () => stored,
            set: (s) => {
                stored = s
            }
        }
        let r1 = await dispatchAiFallback('abc', {
            providers: [
                { id: 'cd2-a', kind: 'claude', exe: fake.exe }, //冷卻中 → 降至鏈尾
                { id: 'cd2-b', kind: 'claude', exe: fake.exe, extraArgs: ['--fake-exit=1'] }, //鏈首但必敗
            ],
            store,
            cooldownMs: 300000,
        })
        let r = [
            r1.ok,
            r1.providerId, //b先上失敗 → 降序後的a仍被嘗試且成功
            r1.tried.map((x) => x.providerId),
            stored.cooling['cd2-a'], //成功即解除
        ]
        let rr = [true, 'cd2-a', ['cd2-b', 'cd2-a'], undefined]
        assert.strict.deepEqual(r, rr)
    })

    it('冷卻過期後恢復原順序並清除過期紀錄', async function() {
        let stored = { cursors: {}, cooling: { 'cd3-a': Date.now() - 1000 } } //1秒前觸發
        let store = {
            get: () => stored,
            set: (s) => {
                stored = s
            }
        }
        let r1 = await dispatchAiFallback('abc', {
            providers: [
                { id: 'cd3-a', kind: 'claude', exe: fake.exe },
                { id: 'cd3-b', kind: 'claude', exe: fake.exe },
            ],
            store,
            cooldownMs: 500, //視窗0.5秒, 已過期
        })
        let r = [r1.providerId, stored.cooling['cd3-a']]
        let rr = ['cd3-a', undefined] //恢復鏈首, 過期紀錄被清除
        assert.strict.deepEqual(r, rr)
    })

    it('cooldownMs未啟用(預設)時不重排也不寫入cooling', async function() {
        let stored = { cursors: {}, cooling: { 'cd4-a': Date.now() } }
        let store = {
            get: () => stored,
            set: (s) => {
                stored = s
            }
        }
        let r1 = await dispatchAiFallback('abc', {
            providers: [
                { id: 'cd4-a', kind: 'claude', exe: fake.exe, extraArgs: ['--fake-sleep=9000'], timeoutMs: 500 },
                { id: 'cd4-b', kind: 'claude', exe: fake.exe },
            ],
            store,
        })
        let r = [
            r1.tried.map((x) => x.providerId), //cooling有預置紀錄仍不重排(未啟用)
            typeof stored.cooling['cd4-a'] === 'number' && stored.cooling['cd4-b'] === undefined, //逾時亦不新增紀錄
        ]
        let rr = [['cd4-a', 'cd4-b'], true]
        assert.strict.deepEqual(r, rr)
    })

    it('失敗事件與tried帶被拒回覆(stdout)與錯誤輸出(stderr)供診斷', async function() {
        let evs = []
        let t = await dispatchAiFallback('abc', {
            providers: [
                //驗證失敗(skip-group): 被拒的回覆內容應可於事件與tried取得
                { id: 'g-diag-v', kind: 'claude', exe: fake.exe, validate: 'min:100000' },
                //exit 1(next-key): stderr之錯誤訊息應可於事件與tried取得
                { id: 'g-diag-e', kind: 'claude', exe: fake.exe, extraArgs: ['--fake-exit=1', '--fake-stderr=Invalid API key.'] },
                { id: 'g-diag-ok', kind: 'claude', exe: fake.exe },
            ],
            onEvent: (ev) => evs.push(ev),
        })
        let evV = evs.find((x) => x.type === 'skip-group')
        let evE = evs.find((x) => x.type === 'next-key')
        let r = [
            t.ok,
            evV.stdout.includes('"stdin"'), //被拒回覆即假CLI之echo JSON
            t.tried[0].stdout.includes('"stdin"'),
            evE.stderr,
            t.tried[1].stderr,
        ]
        let rr = [true, true, true, 'Invalid API key.', 'Invalid API key.']
        assert.strict.deepEqual(r, rr)
    })

    it('onEvent依序回報事件, 回調拋出例外不影響主流程', async function() {
        let evs = []
        let t = await dispatchAiFallback('abc', {
            providers: [{
                id: 'g-ev',
                kind: 'opencode',
                exe: fake.exe,
                provider: 'opencode',
                keys: ['sk-bad-e0', 'sk-good-e1'],
                extraArgs: ['--fake-fail-key=sk-bad'],
            }],
            onEvent: (ev) => {
                evs.push([ev.type, ev.providerId, ev.keyIndex])
                throw new Error('callback error should not break the loop')
            },
        })
        let r = [t.ok, evs]
        let rr = [
            true,
            [
                ['try', 'g-ev', 0],
                ['next-key', 'g-ev', 0],
                ['try', 'g-ev', 1],
                ['ok', 'g-ev', 1],
            ],
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('條目即opt, config與provider等鍵原樣透傳對應轉接器', async function() {
        let config = { provider: { 'agnes-ai': { npm: '@ai-sdk/openai-compatible' } } }
        let t = await dispatchAiFallback('abc', {
            providers: [{
                id: 'g-agnes',
                kind: 'opencode',
                exe: fake.exe,
                model: 'agnes-ai/agnes-2.0-flash',
                provider: 'agnes-ai',
                keys: ['sk-agnes-0'],
                config,
            }],
        })
        let o = JSON.parse(t.stdout)
        let r = [
            t.ok,
            JSON.parse(o.env.OPENCODE_CONFIG_CONTENT),
            JSON.parse(o.env.OPENCODE_AUTH_CONTENT),
            o.args.includes('agnes-ai/agnes-2.0-flash'),
        ]
        let rr = [
            true,
            config,
            { 'agnes-ai': { type: 'api', key: 'sk-agnes-0' } },
            true,
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('四層情境: 組內輪替與跨組遞補複合', async function() {
        //deepseek兩把全敗(額度型) → agnes第1把敗換第2把成功
        let t = await dispatchAiFallback('abc', {
            providers: [
                {
                    id: 'g-ds',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'opencode',
                    keys: ['sk-dsbad-0', 'sk-dsbad-1'],
                    extraArgs: ['--fake-fail-key=sk-dsbad'],
                },
                {
                    id: 'g-ag',
                    kind: 'opencode',
                    exe: fake.exe,
                    provider: 'agnes-ai',
                    keys: ['sk-agbad-0', 'sk-aggood-1'],
                    extraArgs: ['--fake-fail-key=sk-agbad'],
                },
                { id: 'g-cl', kind: 'claude', exe: fake.exe },
            ],
        })
        let r = [
            t.ok,
            t.providerId,
            t.keyIndex,
            getInjectedKey(t.stdout),
            t.tried.map((x) => [x.keyId, x.outcome]),
        ]
        let rr = [
            true,
            'g-ag',
            1,
            'sk-aggood-1',
            [
                ['g-ds#0', 'next-key'],
                ['g-ds#1', 'next-key'],
                ['g-ag#0', 'next-key'],
                ['g-ag#1', 'ok'],
            ],
        ]
        assert.strict.deepEqual(r, rr)
    })

})
