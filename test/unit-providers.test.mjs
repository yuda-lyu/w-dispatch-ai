import assert from 'assert'
import keys from 'lodash-es/keys.js'
import providers from '../src/providers.mjs'
import adapters from '../src/adapters.mjs'


describe('providers', function() {

    it('預設匯出為非空條目陣列', function() {
        let r = [Array.isArray(providers), providers.length > 0]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('各條目皆有非空字串之id、model、kind', function() {
        let r = providers.map((p) => [typeof p.id === 'string' && p.id !== '', typeof p.model === 'string' && p.model !== '', typeof p.kind === 'string' && p.kind !== ''])
        let rr = providers.map(() => [true, true, true])
        assert.strict.deepEqual(r, rr)
    })

    it('各條目之kind皆為有效供應商種類', function() {
        let ks = keys(adapters)
        let r = providers.map((p) => [p.id, ks.includes(p.kind)])
        let rr = providers.map((p) => [p.id, true])
        assert.strict.deepEqual(r, rr)
    })

    it('id不重複且皆符合「路徑:模型」命名(含冒號)', function() {
        let ids = providers.map((p) => p.id)
        let r = [new Set(ids).size === ids.length, ids.every((id) => id.includes(':'))]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('api-openai-compat條目皆有baseURL', function() {
        let apis = providers.filter((p) => p.kind === 'api-openai-compat')
        let r = [apis.length > 0, apis.every((p) => typeof p.baseURL === 'string' && p.baseURL.startsWith('http'))]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('opencode條目皆有provider(金鑰注入所需之配對)', function() {
        let ocs = providers.filter((p) => p.kind === 'opencode')
        let r = [ocs.length > 0, ocs.every((p) => typeof p.provider === 'string' && p.provider !== '')]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('envVar命名皆為大寫底線格式, 訂閱登入態條目(claude/codex)無envVar', function() {
        let withVar = providers.filter((p) => p.envVar !== undefined)
        let subs = providers.filter((p) => ['claude', 'codex'].includes(p.kind))
        let r = [
            withVar.every((p) => /^[A-Z][A-Z0-9_]*$/.test(p.envVar)),
            subs.every((p) => p.envVar === undefined),
        ]
        let rr = [true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('條目不自帶timeoutMs(由上層依任務型態統一給定)', function() {
        let r = providers.every((p) => p.timeoutMs === undefined)
        let rr = true
        assert.strict.deepEqual(r, rr)
    })

    it('CLI條目皆自帶機械防寫(內建清單定位為唯讀調用, 新增CLI條目時必附防寫欄位)', function() {
        //各kind之防寫機制不同(對照表見README); 曾因agy條目獨漏防寫,
        //照內建清單原樣使用時canary實測要求建檔會真的落地(2026-08-15使用端回報+本機復測)
        let hasLock = (p) => {
            if (p.kind === 'opencode') {
                let perm = p.config && p.config.permission
                return !!perm && perm.edit === 'deny' && perm.write === 'deny' && perm.bash === 'deny'
            }
            if (p.kind === 'claude') {
                return Array.isArray(p.extraArgs) && p.extraArgs.includes('--disallowedTools')
            }
            if (p.kind === 'codex') {
                return p.sandbox === 'read-only'
            }
            if (p.kind === 'antigravity') {
                return p.skipPermissions === false //保留agy權限閘門
            }
            return true //api類純文字生成天然無寫檔能力
        }
        let r = providers.map((p) => [p.id, hasLock(p)])
        let rr = providers.map((p) => [p.id, true])
        assert.strict.deepEqual(r, rr)
    })

})
