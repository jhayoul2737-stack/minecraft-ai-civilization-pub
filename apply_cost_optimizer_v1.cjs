const fs = require('fs');
const path = require('path');

const file = process.argv[2] || 'citizen_8730.cjs';

if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(1);
}

fs.mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join('backups', path.basename(file) + '.bak-cost-optimizer-v1-' + stamp);
fs.copyFileSync(file, backup);

let src = fs.readFileSync(file, 'utf8');

// MAIN/DEEP 기본값을 다시 저비용으로 내림.
// 똑똑한 판단은 router가 필요한 경우에만 smart model로 올린다.
src = src.replace(
  /const\s+MAIN_MODEL\s*=\s*(?:process\.env\.ADAM_MAIN_MODEL\s*\|\|\s*)?['"`][^'"`]+['"`]\s*;/,
  "const MAIN_MODEL = process.env.ADAM_MAIN_MODEL || 'gpt-4o-mini';"
);

src = src.replace(
  /const\s+DEEP_MODEL\s*=\s*(?:process\.env\.ADAM_DEEP_MODEL\s*\|\|\s*)?['"`][^'"`]+['"`]\s*;/,
  "const DEEP_MODEL = process.env.ADAM_DEEP_MODEL || 'gpt-4o-mini';"
);

if (/const\s+COGNITION_MODEL\b/.test(src)) {
  src = src.replace(
    /const\s+COGNITION_MODEL\s*=\s*[^;]+;/,
    "const COGNITION_MODEL = process.env.ADAM_COGNITION_MODEL || 'auto';"
  );
} else {
  src = src.replace(
    /(const\s+DEEP_MODEL[^\n]*\n)/,
    "$1const COGNITION_MODEL = process.env.ADAM_COGNITION_MODEL || 'auto';\n"
  );
}

const patch = String.raw`

/* __ADAM_COST_OPTIMIZER_V1__ */
(function ADAM_COST_OPTIMIZER_V1() {
  if (globalThis.__ADAM_COST_OPTIMIZER_V1_INSTALLED__) return;
  globalThis.__ADAM_COST_OPTIMIZER_V1_INSTALLED__ = true;

  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const CO_VERSION = '1.0.0';
  const CO_COST_FILE = path.join(process.cwd(), 'api_cost_Adam.json');
  const CO_EMBED_CACHE_FILE = path.join(process.cwd(), 'embedding_cache_Adam.json');

  function CO_log(msg) {
    console.log('💸 [COST V1] ' + msg);
  }

  function CO_safe(v) {
    if (typeof v === 'string') return v;
    if (v === undefined || v === null) return '';
    try {
      if (v instanceof Error) return v.stack || v.message || String(v);
    } catch {}
    try {
      return JSON.stringify(v);
    } catch {
      try { return String(v); } catch { return ''; }
    }
  }

  function CO_env(name, fallback) {
    try {
      return process.env[name] !== undefined && process.env[name] !== ''
        ? process.env[name]
        : fallback;
    } catch {
      return fallback;
    }
  }

  function CO_numEnv(name, fallback) {
    const n = Number(CO_env(name, fallback));
    return Number.isFinite(n) ? n : fallback;
  }

  function CO_loadJSON(file, fallback) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
  }

  function CO_saveJSON(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('⚠️ [COST V1] 저장 실패:', file, e.message);
    }
  }

  function CO_defaultCostState() {
    return {
      version: CO_VERSION,
      updatedAt: new Date().toISOString(),
      totals: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        embeddingTokens: 0,
        usd: 0
      },
      byModel: {},
      byType: {},
      recent: []
    };
  }

  let CO_cost = Object.assign(CO_defaultCostState(), CO_loadJSON(CO_COST_FILE, {}));
  CO_cost.totals = Object.assign(CO_defaultCostState().totals, CO_cost.totals || {});
  CO_cost.byModel = CO_cost.byModel || {};
  CO_cost.byType = CO_cost.byType || {};
  CO_cost.recent = Array.isArray(CO_cost.recent) ? CO_cost.recent : [];

  function CO_price(model) {
    const m = String(model || '').toLowerCase();

    // 기본값은 OpenAI 공개 가격 기준의 흔한 단가. 바뀌면 .env에서 override 가능.
    // 단위: USD per 1M tokens.
    if (m.includes('gpt-4o-mini')) {
      return {
        input: CO_numEnv('ADAM_PRICE_4O_MINI_INPUT_PER_1M', 0.15),
        output: CO_numEnv('ADAM_PRICE_4O_MINI_OUTPUT_PER_1M', 0.60)
      };
    }

    if (m.includes('gpt-4o')) {
      return {
        input: CO_numEnv('ADAM_PRICE_4O_INPUT_PER_1M', 2.50),
        output: CO_numEnv('ADAM_PRICE_4O_OUTPUT_PER_1M', 10.00)
      };
    }

    if (m.includes('text-embedding-3-small')) {
      return {
        input: CO_numEnv('ADAM_PRICE_EMBED_SMALL_PER_1M', 0.02),
        output: 0
      };
    }

    return {
      input: CO_numEnv('ADAM_PRICE_UNKNOWN_INPUT_PER_1M', 0),
      output: CO_numEnv('ADAM_PRICE_UNKNOWN_OUTPUT_PER_1M', 0)
    };
  }

  function CO_recordUsage(model, type, usage, ms, extra) {
    usage = usage || {};

    const input =
      Number(usage.prompt_tokens || 0) ||
      Number(usage.input_tokens || 0) ||
      0;

    const output =
      Number(usage.completion_tokens || 0) ||
      Number(usage.output_tokens || 0) ||
      0;

    const embedding =
      type === 'embedding'
        ? (Number(usage.prompt_tokens || 0) || Number(usage.total_tokens || 0) || input)
        : 0;

    const price = CO_price(model);
    const usd = ((input + embedding) / 1000000) * price.input + (output / 1000000) * price.output;

    CO_cost.totals.calls += 1;
    CO_cost.totals.inputTokens += input;
    CO_cost.totals.outputTokens += output;
    CO_cost.totals.embeddingTokens += embedding;
    CO_cost.totals.usd += usd;

    if (!CO_cost.byModel[model]) {
      CO_cost.byModel[model] = { calls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, usd: 0 };
    }

    CO_cost.byModel[model].calls += 1;
    CO_cost.byModel[model].inputTokens += input;
    CO_cost.byModel[model].outputTokens += output;
    CO_cost.byModel[model].embeddingTokens += embedding;
    CO_cost.byModel[model].usd += usd;

    if (!CO_cost.byType[type]) {
      CO_cost.byType[type] = { calls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0, usd: 0 };
    }

    CO_cost.byType[type].calls += 1;
    CO_cost.byType[type].inputTokens += input;
    CO_cost.byType[type].outputTokens += output;
    CO_cost.byType[type].embeddingTokens += embedding;
    CO_cost.byType[type].usd += usd;

    CO_cost.recent.push({
      at: new Date().toISOString(),
      model,
      type,
      inputTokens: input,
      outputTokens: output,
      embeddingTokens: embedding,
      usd,
      ms,
      extra: extra || {}
    });

    while (CO_cost.recent.length > 80) CO_cost.recent.shift();

    CO_cost.updatedAt = new Date().toISOString();
    CO_saveJSON(CO_COST_FILE, CO_cost);

    if (CO_env('ADAM_COST_LOG', '1') !== '0') {
      CO_log(
        type + ' model=' + model +
        ' in=' + input +
        ' out=' + output +
        ' emb=' + embedding +
        ' cost=$' + usd.toFixed(6) +
        ' total=$' + CO_cost.totals.usd.toFixed(4)
      );
    }
  }

  function CO_joinMessages(messages) {
    try {
      return (messages || []).map(m => {
        if (!m) return '';
        if (typeof m.content === 'string') return m.content;
        return CO_safe(m.content);
      }).join('\n');
    } catch {
      return '';
    }
  }

  function CO_classifyRequest(req, joined) {
    const text = String(joined || '').toLowerCase();

    if (
      text.includes('동시에 작용하는 내부 압력') ||
      text.includes('queue_relation') ||
      text.includes('you are adam. you are the agent') ||
      text.includes('너는 외부 도구가 아니라 adam 자신이다')
    ) return 'piano_exec';

    if (
      text.includes('자아성찰') ||
      text.includes('insights') && text.includes('plan') && text.includes('step')
    ) return 'reflect';

    if (
      text.includes('mineflayer 전문 자바스크립트') ||
      text.includes('async function skill') ||
      text.includes('skill(bot')
    ) return 'code';

    if (
      text.includes('blueprint') ||
      text.includes('설계도') ||
      text.includes('건축가')
    ) return 'blueprint';

    if (
      text.includes('대화에 반응') ||
      text.includes('방금 들은 말') ||
      text.includes('chat') ||
      text.includes('say')
    ) return 'chat';

    return 'other';
  }

  function CO_recent(list, ms) {
    const now = Date.now();
    return (Array.isArray(list) ? list : []).filter(x => {
      const t = x.t || Date.parse(x.at || 0);
      return Number.isFinite(t) && now - t <= ms;
    }).length;
  }

  function CO_highStakes(type, joined) {
    if (type === 'code') return true;

    try {
      const st = globalThis.AdamPiano && typeof globalThis.AdamPiano.state === 'function'
        ? globalThis.AdamPiano.state()
        : null;

      if (st && st.working) {
        const p = st.working.pressures || {};
        const n = st.working.needs || {};
        const recentSurprise = CO_recent(st.working.surprises, 120000);
        const recentSocial = CO_recent(st.working.social, 90000);

        if (Number(p.survival || 0) >= 0.60) return true;
        if (Number(n.failPressure || 0) >= 0.45) return true;
        if (recentSurprise > 0) return true;
        if (recentSocial >= 2 && Number(p.social || 0) >= 0.65) return true;
      }
    } catch {}

    const text = String(joined || '').toLowerCase();
    return /creeper|warden|death|died|low health|hostile|critical|반복 실패|사망|죽었|크리퍼|위험|체력 위기/.test(text);
  }

  function CO_chooseModel(type, requested, joined) {
    const mode = CO_env('ADAM_COST_MODE', 'max'); // max | balanced
    const cheap = CO_env('ADAM_CHEAP_MODEL', 'gpt-4o-mini');
    const smart = CO_env('ADAM_SMART_MODEL', 'gpt-4o');

    const reflectModel = CO_env('ADAM_REFLECT_MODEL', cheap);
    const codeModel = CO_env('ADAM_CODE_MODEL', mode === 'max' ? cheap : smart);
    const blueprintModel = CO_env('ADAM_BLUEPRINT_MODEL', cheap);

    if (CO_env('ADAM_FORCE_CHEAP', '0') === '1') return cheap;

    if (type === 'code') return codeModel;
    if (type === 'reflect') return reflectModel;
    if (type === 'blueprint') return blueprintModel;
    if (type === 'chat') return cheap;

    if (type === 'piano_exec') {
      const high = CO_highStakes(type, joined);
      const allowSmartInMax = CO_env('ADAM_ALLOW_SMART_IN_MAX', '0') === '1';

      if (high && (mode !== 'max' || allowSmartInMax)) return smart;
      return cheap;
    }

    // 기존 코드가 gpt-4o를 박아놨어도 routine이면 mini로 내린다.
    if (String(requested || '').includes('gpt-4o') && !CO_highStakes(type, joined)) {
      return cheap;
    }

    if (!requested || requested === 'auto') return cheap;
    return requested;
  }

  function CO_trim(s, n) {
    s = CO_safe(s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n) + '...';
  }

  function CO_compactJSON(obj, n) {
    return CO_trim(JSON.stringify(obj || {}, null, 0), n);
  }

  function CO_bot() {
    return globalThis.__ADAM_LAST_BOT__ || globalThis.bot || null;
  }

  function CO_self() {
    return globalThis.__ADAM_LAST_SELF__ || globalThis.self || null;
  }

  function CO_compactExecutiveMessages() {
    const bot = CO_bot();
    const self = CO_self();

    if (!bot || !self || !bot.entity) return null;

    const st = globalThis.AdamPiano && typeof globalThis.AdamPiano.state === 'function'
      ? globalThis.AdamPiano.state()
      : null;

    if (!st || !st.working) return null;

    let inv = '';
    try {
      inv = typeof getDetailedInventory === 'function'
        ? getDetailedInventory(bot)
        : CO_compactJSON(bot.inventory.items().map(i => [i.name, i.count]), 700);
    } catch {
      inv = 'unknown';
    }

    let env = '';
    try {
      env = typeof getEnvironmentReport === 'function'
        ? getEnvironmentReport(bot)
        : 'unknown';
    } catch {
      env = 'unknown';
    }

    const wk = st.working || {};
    const pos = bot.entity.position;

    const queue = Array.isArray(wk.queue) ? wk.queue.slice(0, 4) : [];
    const afford = Array.isArray(wk.affordances) ? wk.affordances.slice(0, 5) : [];
    const future = Array.isArray(wk.future) ? wk.future.slice(0, 3) : [];
    const social = Array.isArray(wk.social) ? wk.social.slice(-4) : [];
    const obs = Array.isArray(wk.observations) ? wk.observations.slice(-5) : [];
    const events = Array.isArray(wk.surprises) ? wk.surprises.slice(-4) : [];
    const mems = Array.isArray(wk.memories) ? wk.memories.slice(0, 6) : [];

    let allowed = [];
    try {
      const b = Array.isArray(BUILTIN_ACTIONS) ? BUILTIN_ACTIONS : [];
      const s = self.skills ? Object.keys(self.skills) : [];
      allowed = Array.from(new Set(b.concat(s))).slice(0, 90);
    } catch {
      allowed = [];
    }

    const user = [
      'STATE',
      'pos=' + Math.round(pos.x) + ',' + Math.round(pos.y) + ',' + Math.round(pos.z) +
        ' hp=' + bot.health + '/20 food=' + bot.food + '/20',
      'inv=' + CO_trim(inv, 700),
      'env=' + CO_trim(env, 500),
      '',
      'PRESSURES=' + CO_compactJSON(wk.pressures, 500),
      'NEEDS=' + CO_compactJSON(wk.needs, 500),
      '',
      'QUEUE suggestion only=' + CO_compactJSON(queue, 600),
      'POSSIBLE_NOW=' + CO_compactJSON(afford, 700),
      'FUTURE=' + CO_compactJSON(future, 400),
      '',
      'SOCIAL=' + CO_compactJSON(social.map(x => ({ user: x.username, text: CO_trim(x.text, 100) })), 500),
      'OBS=' + CO_compactJSON(obs.map(x => ({ actor: x.actor, act: x.action, target: x.target })), 450),
      'EVENTS=' + CO_compactJSON(events.map(x => CO_trim(x.text, 130)), 450),
      'MEM=' + CO_compactJSON(mems.map(x => ({ imp: x.importance, text: CO_trim(x.description, 140) })), 900),
      '',
      'LAST=' + CO_trim(self.lastActionResult || 'none', 500),
      '',
      'ALLOWED=' + allowed.join(', '),
      '',
      'Decide as Adam. No mode switches. Queue is only one pressure.',
      'Use compact English internally to save tokens. Only say may be Korean if speaking to a Korean person.',
      'Return JSON only:',
      '{"mood":"","desire":"","attention":"","thought":"","confidence":0.0,"queue_relation":"follow|adapt|defer|ignore","queue_reason":"","actions":[{"action":"","target":null,"label":null,"skill_name":null,"skill_goal":null,"expected":""}],"say":null,"remember":null,"next_check_seconds":12}'
    ].join('\n');

    return [
      {
        role: 'system',
        content: 'You are Adam, the embodied agent. Think compactly. Choose actions from state, memory, pressure, and desire. Do not act like a command-following assistant.'
      },
      {
        role: 'user',
        content: user
      }
    ];
  }

  function CO_applyTokenLimits(req, type) {
    const maxByType = {
      piano_exec: CO_numEnv('ADAM_EXEC_MAX_TOKENS', 420),
      chat: CO_numEnv('ADAM_CHAT_MAX_TOKENS', 160),
      reflect: CO_numEnv('ADAM_REFLECT_MAX_TOKENS', 380),
      code: CO_numEnv('ADAM_CODE_MAX_TOKENS', 900),
      blueprint: CO_numEnv('ADAM_BLUEPRINT_MAX_TOKENS', 500),
      other: CO_numEnv('ADAM_OTHER_MAX_TOKENS', 300)
    };

    const max = maxByType[type] || maxByType.other;

    if (req.max_tokens === undefined || Number(req.max_tokens) > max) {
      req.max_tokens = max;
    }

    if (req.temperature === undefined) {
      req.temperature = type === 'piano_exec' ? 0.45 : 0.35;
    }

    return req;
  }

  // Chat completion router.
  try {
    if (
      typeof openai !== 'undefined' &&
      openai &&
      openai.chat &&
      openai.chat.completions &&
      typeof openai.chat.completions.create === 'function' &&
      !openai.chat.completions.create.__adamCostWrapped
    ) {
      const CO_originalChatCreate = openai.chat.completions.create.bind(openai.chat.completions);

      const CO_wrappedChatCreate = async function costOptimizedChatCreate(request, ...rest) {
        const started = Date.now();
        const req = Object.assign({}, request || {});
        req.messages = Array.isArray(req.messages) ? req.messages.slice() : [];

        let joined = CO_joinMessages(req.messages);
        const type = CO_classifyRequest(req, joined);

        if (type === 'piano_exec' && CO_env('ADAM_COMPACT_ENGLISH', '1') !== '0') {
          const compact = CO_compactExecutiveMessages();
          if (compact) {
            req.messages = compact;
            joined = CO_joinMessages(req.messages);
          }
        }

        const requested = req.model || 'auto';
        req.model = CO_chooseModel(type, requested, joined);
        CO_applyTokenLimits(req, type);

        let res;
        try {
          res = await CO_originalChatCreate(req, ...rest);
        } catch (e) {
          // max_tokens 호환 문제 또는 cheap model 실패 시 한번 완화해서 재시도.
          const msg = CO_safe(e.message || e);
          if (/max_tokens|max_completion_tokens/i.test(msg)) {
            delete req.max_tokens;
            res = await CO_originalChatCreate(req, ...rest);
          } else {
            throw e;
          }
        }

        try {
          CO_recordUsage(req.model, type, res && res.usage, Date.now() - started, {
            requested,
            compacted: type === 'piano_exec' && CO_env('ADAM_COMPACT_ENGLISH', '1') !== '0'
          });
        } catch {}

        return res;
      };

      CO_wrappedChatCreate.__adamCostWrapped = true;
      openai.chat.completions.create = CO_wrappedChatCreate;

      CO_log('chat.completions router 설치 완료: auto/compact-English/max_tokens/cost-log');
    }
  } catch (e) {
    console.warn('⚠️ [COST V1] chat wrapper 실패:', e.message);
  }

  // Embedding cost logger.
  try {
    if (
      typeof openai !== 'undefined' &&
      openai &&
      openai.embeddings &&
      typeof openai.embeddings.create === 'function' &&
      !openai.embeddings.create.__adamCostWrapped
    ) {
      const CO_originalEmbCreate = openai.embeddings.create.bind(openai.embeddings);

      const CO_wrappedEmbCreate = async function costOptimizedEmbeddingCreate(request, ...rest) {
        const started = Date.now();
        const req = Object.assign({}, request || {});
        const model = req.model || 'text-embedding-3-small';
        const res = await CO_originalEmbCreate(req, ...rest);

        try {
          CO_recordUsage(model, 'embedding', res && res.usage, Date.now() - started, {});
        } catch {}

        return res;
      };

      CO_wrappedEmbCreate.__adamCostWrapped = true;
      openai.embeddings.create = CO_wrappedEmbCreate;
      CO_log('embeddings cost logger 설치 완료');
    }
  } catch (e) {
    console.warn('⚠️ [COST V1] embedding wrapper 실패:', e.message);
  }

  // getEmbedding cache + routine memory skip.
  try {
    if (typeof getEmbedding === 'function' && !getEmbedding.__adamCostCacheWrapped) {
      const CO_prevGetEmbedding = getEmbedding;
      let CO_embedCache = CO_loadJSON(CO_EMBED_CACHE_FILE, { version: 1, items: {} });
      CO_embedCache.items = CO_embedCache.items || {};
      let CO_embedSaveAt = 0;

      function CO_hash(text) {
        return crypto.createHash('sha1').update(text).digest('hex');
      }

      function CO_saveEmbedCache(force) {
        const now = Date.now();
        if (!force && now - CO_embedSaveAt < 5000) return;
        CO_embedSaveAt = now;

        const keys = Object.keys(CO_embedCache.items);
        const max = CO_numEnv('ADAM_EMBED_CACHE_MAX', 2000);

        if (keys.length > max) {
          for (const k of keys.slice(0, keys.length - max)) delete CO_embedCache.items[k];
        }

        CO_saveJSON(CO_EMBED_CACHE_FILE, CO_embedCache);
      }

      const CO_wrappedGetEmbedding = async function costCachedGetEmbedding(text) {
        const t = CO_safe(text).slice(0, 2000);
        if (!t.trim()) return null;

        // 자주 쌓이는 기계적 기억은 벡터화하지 않음. 필요하면 ADAM_EMBED_ROUTINE=1.
        if (
          CO_env('ADAM_EMBED_ROUTINE', '0') !== '1' &&
          /^\s*\[(큐|반사신경|자동회수|상태점검|우선순위|생존압력|회복압력)\]/.test(t)
        ) {
          return null;
        }

        const modelName = typeof EMBED_MODEL !== 'undefined' ? EMBED_MODEL : 'text-embedding-3-small';
        const dim = typeof EMBED_DIMENSIONS !== 'undefined' ? EMBED_DIMENSIONS : 256;
        const key = CO_hash(modelName + '|' + dim + '|' + t);

        const hit = CO_embedCache.items[key];
        if (hit && Array.isArray(hit.embedding)) {
          hit.lastUsedAt = new Date().toISOString();
          hit.uses = (hit.uses || 0) + 1;
          CO_saveEmbedCache(false);
          return hit.embedding;
        }

        const emb = await CO_prevGetEmbedding(text);

        if (Array.isArray(emb)) {
          CO_embedCache.items[key] = {
            embedding: emb,
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
            uses: 1,
            textPreview: t.slice(0, 120)
          };
          CO_saveEmbedCache(false);
        }

        return emb;
      };

      CO_wrappedGetEmbedding.__adamCostCacheWrapped = true;
      getEmbedding = CO_wrappedGetEmbedding;

      CO_log('embedding cache 설치 완료: duplicate/routine embedding 비용 절감');
    }
  } catch (e) {
    console.warn('⚠️ [COST V1] getEmbedding cache 실패:', e.message);
  }

  globalThis.AdamCost = {
    version: CO_VERSION,
    status: function() { return CO_cost; },
    save: function() { CO_saveJSON(CO_COST_FILE, CO_cost); return true; },
    reset: function() {
      CO_cost = CO_defaultCostState();
      CO_saveJSON(CO_COST_FILE, CO_cost);
      return true;
    }
  };

  CO_log('로드 완료. 기본 mini + 영어 압축 + 자동 라우팅 + 비용 기록 활성화. file=' + CO_COST_FILE);
})();
`;

if (!src.includes('__ADAM_COST_OPTIMIZER_V1__')) {
  src = src.trimEnd() + '\n' + patch + '\n';
} else {
  console.log('Cost optimizer already present; skipping append.');
}

fs.writeFileSync(file, src);
console.log('Backup:', backup);
console.log('Patched:', file);
