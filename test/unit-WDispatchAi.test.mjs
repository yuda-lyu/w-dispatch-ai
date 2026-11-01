import assert from 'assert'
import keys from 'lodash-es/keys.js'
import map from 'lodash-es/map.js'
import wi from '../src/WDispatchAi.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import probeAnthropicKeys from '../src/probeAnthropicKeys.mjs'
import filterOpencodeFree from '../src/filterOpencodeFree.mjs'
import providers from '../src/providers.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import resolveCatalogue from '../src/resolveCatalogue.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import logAiOutcome, { createAiEventLogger, OUTCOME_TEXT } from '../src/wkf/logAiOutcome.mjs'
import parseJsonArray from '../src/wkf/parseJsonArray.mjs'
import parseIndexList from '../src/wkf/parseIndexList.mjs'
import makeArrayCoverageValidator from '../src/wkf/makeArrayCoverageValidator.mjs'
import getQuotaClaude from '../src/quota/getQuotaClaude.mjs'
import getQuotaCodex from '../src/quota/getQuotaCodex.mjs'
import getQuotaAntigravity from '../src/quota/getQuotaAntigravity.mjs'


describe('WDispatchAi', function() {

    it('對外提供KINDS與各dispatch函數與工具', function() {
        let r = keys(wi)
        let rr = [
            'KINDS',
            'NO_SIDE_EFFECT',
            'dispatchAi',
            'dispatchAiFallback',
            'dispatchAiWkf',
            'dispatchOpencode',
            'dispatchClaude',
            'dispatchCodex',
            'dispatchAntigravity',
            'dispatchApiOpenaiCompat',
            'dispatchApiOpenaiResponses',
            'dispatchApiAnthropic',
            'dispatchApiTypesafeSystemone',
            'probeAnthropicKeys', //2026-10-25新增(dispatch-run01): 金鑰探測
            'filterOpencodeFree', //2026-10-30新增(run01): 以opencode models過濾目錄之免費條目
            'providers',
            'resolveProviders',
            'resolveCatalogue', //2026-11-01新增(da40, Gitea #40): 目錄展開
            'readEnvFile',
            'budgetFor',
            'createAiCaller', //同上: 原始遞補呼叫器
            'createFileStore',
            'createUsageCounter',
            'logAiOutcome', //同上: 結果日誌
            'createAiEventLogger',
            'OUTCOME_TEXT',
            'salvageTruncatedArray',
            'parseJsonArray', //同上: 嚴格解析與涵蓋率驗證
            'parseIndexList',
            'makeArrayCoverageValidator',
            'getQuotaClaude',
            'getQuotaCodex',
            'getQuotaAntigravity',
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('KINDS為可用之供應商種類字串陣列', function() {
        let r = wi.KINDS
        let rr = ['opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat', 'api-openai-responses', 'api-anthropic', 'api-typesafe-systemone']
        assert.strict.deepEqual(r, rr)
    })

    it('各鍵值型別正確(KINDS、providers與OUTCOME_TEXT為物件, NO_SIDE_EFFECT為字串, 其餘為函數)', function() {
        let r = map(keys(wi), (k) => typeof wi[k])
        let fn = (n) => Array(n).fill('function')
        let rr = [
            'object', 'string', //KINDS, NO_SIDE_EFFECT
            ...fn(13), //dispatchAi ~ filterOpencodeFree
            'object', //providers
            ...fn(9), //resolveProviders ~ createAiEventLogger
            'object', //OUTCOME_TEXT
            ...fn(7), //salvageTruncatedArray ~ getQuotaAntigravity
        ]
        assert.strict.deepEqual(r, rr)
    })

    it('各鍵值即為對應模組之預設匯出', function() {
        let r = [
            wi.dispatchAi === dispatchAi,
            wi.dispatchAiFallback === dispatchAiFallback,
            wi.dispatchAiWkf === dispatchAiWkf,
            wi.dispatchOpencode === dispatchOpencode,
            wi.dispatchClaude === dispatchClaude,
            wi.dispatchCodex === dispatchCodex,
            wi.dispatchAntigravity === dispatchAntigravity,
            wi.dispatchApiOpenaiCompat === dispatchApiOpenaiCompat,
            wi.dispatchApiOpenaiResponses === dispatchApiOpenaiResponses,
            wi.dispatchApiAnthropic === dispatchApiAnthropic,
            wi.dispatchApiTypesafeSystemone === dispatchApiTypesafeSystemone,
            wi.providers === providers,
            wi.resolveProviders === resolveProviders,
            wi.getQuotaClaude === getQuotaClaude,
            wi.getQuotaCodex === getQuotaCodex,
            wi.getQuotaAntigravity === getQuotaAntigravity,
            wi.probeAnthropicKeys === probeAnthropicKeys,
            wi.filterOpencodeFree === filterOpencodeFree,
            wi.resolveCatalogue === resolveCatalogue,
            wi.createAiCaller === createAiCaller,
            wi.logAiOutcome === logAiOutcome,
            wi.createAiEventLogger === createAiEventLogger,
            wi.OUTCOME_TEXT === OUTCOME_TEXT,
            wi.parseJsonArray === parseJsonArray,
            wi.parseIndexList === parseIndexList,
            wi.makeArrayCoverageValidator === makeArrayCoverageValidator,
        ]
        let rr = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('KINDS各項皆可由dispatchAi分派', async function() {
        let r = []
        for (let kind of wi.KINDS) {
            let t = await wi.dispatchAi(kind, '')
            r.push(t.error)
        }
        let rr = ['prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string', 'prompt must be a non-empty string']
        assert.strict.deepEqual(r, rr)
    })

    it('可由WDispatchAi呼叫dispatchAi', async function() {
        let t = await wi.dispatchAi('gemini', 'abc')
        let r = [t.ok, t.error]
        let rr = [false, 'unknown ai kind: "gemini" (available: opencode, claude, codex, antigravity, api-openai-compat, api-openai-responses, api-anthropic, api-typesafe-systemone)']
        assert.strict.deepEqual(r, rr)
    })

    it('可由WDispatchAi呼叫各轉接器', async function() {
        let r = []
        for (let fn of [wi.dispatchOpencode, wi.dispatchClaude, wi.dispatchCodex, wi.dispatchAntigravity, wi.dispatchApiOpenaiCompat, wi.dispatchApiOpenaiResponses, wi.dispatchApiAnthropic, wi.dispatchApiTypesafeSystemone]) {
            let t = await fn('')
            r.push([t.ok, t.error])
        }
        let rr = [
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
            [false, 'prompt must be a non-empty string'],
        ]
        assert.strict.deepEqual(r, rr)
    })

})
