const fs = require('fs');
const path = require('path');

let acorn;
try {
  acorn = require('acorn');
} catch (e) {
  console.error('Missing dependency: acorn');
  console.error('Run: npm i -D acorn');
  process.exit(1);
}

const target = process.argv[2] || 'citizen_8730.cjs';

if (!fs.existsSync(target)) {
  console.error('File not found:', target);
  process.exit(1);
}

if (!fs.existsSync('piano_v3/index.cjs')) {
  console.error('piano_v3/index.cjs not found. Apply Piano V3 first.');
  process.exit(1);
}

fs.mkdirSync('backups', { recursive: true });
fs.mkdirSync('piano_v3', { recursive: true });
fs.mkdirSync('logs', { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join('backups', path.basename(target) + '.bak-piano-v31-' + stamp);
fs.copyFileSync(target, backup);

function write(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content);
}

function parse(src) {
  return acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowHashBang: true
  });
}

function walk(node, cb, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') walk(child, cb, node);
      }
    } else if (value && typeof value.type === 'string') {
      walk(value, cb, node);
    }
  }
}

function applyEdits(src, edits) {
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    src = src.slice(0, e.start) + e.text + src.slice(e.end);
  }
  return src;
}

/* 1. config.cjs: no implicit file creation at runtime */
write('piano_v3/config.cjs', String.raw`
const fs = require('fs');

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function defaultConfig() {
  return {
    version: 3,

    intervals: {
      schedulerMs: 1000,
      perceptionMs: 2000,
      needsMs: 3000,
      affordanceMs: 9000,
      memoryMs: 45000,
      statusWriteMs: 3000
    },

    executive: {
      minIntervalMs: 18000,
      highPressureIntervalMs: 12000,
      normalIntervalMs: 35000,
      lowPressureIntervalMs: 80000,
      maxIntervalMs: 120000,
      maxActions: 2,
      maxPromptChars: 5200,
      maxTokens: 420,
      temperature: 0.45,
      apiRetries: 2,
      apiInitialBackoffMs: 1200,
      jsonRepair: true,
      fallbackOldThink: false
    },

    modelPolicy: {
      cheapModel: process.env.ADAM_CHEAP_MODEL || 'gpt-4o-mini',
      smartModel: process.env.ADAM_SMART_MODEL || 'gpt-4o',
      forceCheap: process.env.ADAM_FORCE_CHEAP === '1',
      allowSmart: process.env.ADAM_ALLOW_SMART_IN_MAX === '1',
      smartWhenSurvivalAbove: 0.75,
      smartWhenSocialAbove: 0.80,
      smartWhenFailureAbove: 0.55
    },

    pressure: {
      survival: {
        healthStart: 12,
        hungerStart: 14,
        threatBase: 0.25
      },
      queue: {
        baseWhenQueued: 0.38,
        diligence: 0.034,
        pragmatism: 0.018,
        failurePenalty: 0.45,
        surprisePenalty: 0.12,
        survivalPenalty: 0.28
      },
      selfDirection: {
        base: 0.18,
        idle: 0.24,
        observation: 0.09,
        surprise: 0.18,
        curiosity: 0.035,
        creativity: 0.025,
        survivalPenalty: 0.52,
        failurePenalty: 0.10
      },
      social: {
        recentSocial: 0.20,
        observation: 0.08,
        sociability: 0.035
      },
      exploration: {
        idle: 0.30,
        curiosity: 0.04,
        survivalPenalty: 0.55,
        cautionPenalty: 0.015
      },
      craft: {
        pragmatism: 0.05,
        shortage: 0.12,
        survivalPenalty: 0.25
      }
    },

    logging: {
      level: process.env.ADAM_PIANO_LOG_LEVEL || 'info',
      console: true,
      dir: 'logs'
    }
  };
}

function loadConfig(file, options = {}) {
  const base = defaultConfig();
  const createIfMissing = !!options.createIfMissing;

  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return deepMerge(base, raw || {});
    }

    if (createIfMissing) {
      fs.writeFileSync(file, JSON.stringify(base, null, 2));
    }
  } catch (e) {
    console.warn('⚠️ [PIANO V3] config load failed, using defaults:', e.message);
  }

  return base;
}

function initConfig(file, options = {}) {
  const overwrite = !!options.overwrite;
  const cfg = defaultConfig();

  if (fs.existsSync(file) && !overwrite) {
    return { created: false, file };
  }

  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return { created: true, file };
}

module.exports = { loadConfig, initConfig, defaultConfig, deepMerge };
`.trimStart());

/* 2. explicit config CLI */
write('piano_v3/init-config.cjs', String.raw`
#!/usr/bin/env node
const { initConfig } = require('./config.cjs');

const name = String(process.argv[2] || 'Adam').replace(/[^\w.-]/g, '_');
const overwrite = process.argv.includes('--overwrite');
const file = 'piano_config_' + name + '.json';

const result = initConfig(file, { overwrite });
console.log(result.created ? 'created ' + file : 'exists ' + file + ' (use --overwrite to replace)');
`.trimStart());

/* 3. patch piano_v3/index.cjs itself */
let index = fs.readFileSync('piano_v3/index.cjs', 'utf8');

index = index.replace(
  "const config = loadConfig(configFile);",
  "const config = loadConfig(configFile, { createIfMissing: false });"
);

if (!index.includes('__PIANO_V31_DEP_VALIDATION__')) {
  index = index.replace(
    `function install(opts) {
  opts = opts || {};
  const bot = opts.bot;
  const self = opts.self;
  const deps = opts.deps || {};`,
    `function install(opts) {
  opts = opts || {};
  const bot = opts.bot;
  const self = opts.self;
  const deps = opts.deps || {};

  /* __PIANO_V31_DEP_VALIDATION__ */
  const depWarnings = [];
  if (!deps.openai) depWarnings.push('openai client missing');
  if (!deps.performBuiltinAction && !deps.executeDecision && !deps.executeAction) {
    depWarnings.push('no action executor injected');
  }
  if (!deps.addMemory) depWarnings.push('addMemory missing');
  if (!deps.retrieveMemories) depWarnings.push('retrieveMemories missing');
  if (depWarnings.length) {
    console.warn('⚠️ [PIANO V3.1] dependency warnings:', depWarnings.join(' / '));
  }`
  );
}

if (!index.includes('__PIANO_V31_CONSECUTIVE_BACKOFF__')) {
  index = index.replace(
    `this.apiBackoffUntil = 0;
    this.timers = [];`,
    `this.apiBackoffUntil = 0;
    /* __PIANO_V31_CONSECUTIVE_BACKOFF__ */
    this.consecutiveApiFailures = 0;
    this.timers = [];`
  );

  index = index.replace(
    `this.state.stats.executiveCalls += 1;`,
    `this.consecutiveApiFailures = 0;
      this.apiBackoffUntil = 0;
      this.state.stats.executiveCalls += 1;`
  );

  index = index.replace(
    `this.state.stats.apiFailures += 1;
      this.apiBackoffUntil = Date.now() + Math.min(120000, Number(this.config.executive.apiInitialBackoffMs || 1200) * Math.pow(2, this.state.stats.apiFailures));`,
    `this.state.stats.apiFailures += 1;
      this.consecutiveApiFailures = (this.consecutiveApiFailures || 0) + 1;
      this.apiBackoffUntil = Date.now() + Math.min(
        120000,
        Number(this.config.executive.apiInitialBackoffMs || 1200) * Math.pow(2, this.consecutiveApiFailures)
      );`
  );
}

if (!index.includes('__PIANO_V31_ATTACH_RUNTIME__')) {
  index = index.replace(
    `rt.install();`,
    `rt.install();

  /* __PIANO_V31_ATTACH_RUNTIME__ */
  try {
    bot.__pianoRuntime = rt;
    self.__pianoRuntime = rt;
  } catch {}`
  );
}

/* Replace ambiguous global manager block */
if (!index.includes('__PIANO_V31_MANAGER__')) {
  const start = index.indexOf('  globalThis.AdamPianoV3 = {');
  const end = start === -1 ? -1 : index.indexOf('\n  return rt;', start);

  if (start !== -1 && end !== -1) {
    const manager = String.raw`
  /* __PIANO_V31_MANAGER__ */
  const manager = globalThis.AdamPianoV3 || {};

  Object.assign(manager, {
    version: '3.1.0',
    runtimes,

    names: function () {
      return Array.from(runtimes.keys());
    },

    runtime: function (name) {
      if (!name && runtimes.size === 1) return Array.from(runtimes.values())[0];
      return runtimes.get(name);
    },

    state: function (name) {
      if (!name && runtimes.size !== 1) {
        return { error: 'runtime name required when multiple runtimes exist', names: Array.from(runtimes.keys()) };
      }
      const r = !name && runtimes.size === 1 ? Array.from(runtimes.values())[0] : runtimes.get(name);
      return r ? r.state : null;
    },

    tick: async function (arg1, arg2, arg3) {
      // tick(bot, self, reason)
      if (arg1 && arg1.entity) {
        const r = runtimes.get(botKey(arg1, arg2));
        if (!r) throw new Error('Piano runtime not found for bot');
        return await r.tick(arg3 || 'manual');
      }

      // tick('Adam', reason)
      if (typeof arg1 === 'string' && runtimes.has(arg1)) {
        const r = runtimes.get(arg1);
        return await r.tick(arg2 || 'manual');
      }

      // tick(reason) only allowed when single runtime exists
      if (runtimes.size === 1) {
        const r = Array.from(runtimes.values())[0];
        return await r.tick(arg1 || 'manual');
      }

      throw new Error('AdamPianoV3.tick requires bot/self or runtime name when multiple runtimes exist');
    }
  });

  globalThis.AdamPianoV3 = manager;

  // Remove ambiguous V2 compatibility alias unless explicitly requested.
  if (process.env.ADAM_ENABLE_LEGACY_GLOBAL === '1') {
    globalThis.AdamPiano = {
      state: function (name) { return manager.state(name); },
      tick: async function (nameOrReason) {
        if (runtimes.size !== 1 && !runtimes.has(nameOrReason)) {
          throw new Error('Legacy AdamPiano.tick is ambiguous; use AdamPianoV3.tick(name, reason)');
        }
        return await manager.tick(nameOrReason);
      }
    };
  } else {
    try { delete globalThis.AdamPiano; } catch {}
  }

`;
    index = index.slice(0, start) + manager + index.slice(end);
  } else {
    console.warn('Could not find global manager block in piano_v3/index.cjs; skipping manager rewrite.');
  }
}

fs.writeFileSync('piano_v3/index.cjs', index);

/* 4. AST patch target file: explicit runtime install + direct runtime liveLoop route */
let src = fs.readFileSync(target, 'utf8');

const proseMarker = '\n4. 자유도를 높이는 명령';
const proseIdx = src.indexOf(proseMarker);
if (proseIdx !== -1) src = src.slice(0, proseIdx).trimEnd() + '\n';

let ast = parse(src);
const edits = [];

if (!src.includes('__ADAM_PIANO_V31_EXPLICIT_INSTALL__')) {
  let insertPos = null;

  walk(ast, (node) => {
    if (insertPos !== null) return;
    if (node.type !== 'ExpressionStatement') return;
    const ex = node.expression;
    if (!ex || ex.type !== 'AssignmentExpression') return;

    const left = src.slice(ex.left.start, ex.left.end);
    if (left.includes('globalThis.__ADAM_CITIZENS__') && left.includes('[name]')) {
      insertPos = node.end;
    }
  });

  if (insertPos === null) {
    throw new Error('AST anchor not found: globalThis.__ADAM_CITIZENS__[name] assignment');
  }

  const installCode = String.raw`

  /* __ADAM_PIANO_V31_EXPLICIT_INSTALL__ */
  try {
    const __pianoRt = require('./piano_v3').install({
      bot,
      self,
      deps: {
        openai,
        getDetailedInventory,
        getEnvironmentReport,
        retrieveMemories,
        addMemory,
        sanitize,
        loadPersonalityV2: (typeof loadPersonalityV2 === 'function') ? loadPersonalityV2 : null,
        scanCurrentPossibilities: (typeof scanCurrentPossibilities === 'function') ? scanCurrentPossibilities : null,
        scanFutureAffordances: (typeof scanFutureAffordances === 'function') ? scanFutureAffordances : null,
        looksLikeFailure: (typeof looksLikeFailure === 'function') ? looksLikeFailure : null,
        getBuiltinActions: function () {
          return (typeof BUILTIN_ACTIONS !== 'undefined' && Array.isArray(BUILTIN_ACTIONS)) ? BUILTIN_ACTIONS : [];
        },
        performBuiltinAction: async function (botArg, selfArg, action, target, label) {
          return await performBuiltinAction(botArg, selfArg, action, target, label);
        },
        executeDecision: async function (botArg, selfArg, item) {
          return await executeDecision(botArg, selfArg, item);
        },
        executeAction: async function (botArg, selfArg, item) {
          if (typeof executeWithAwareness === 'function') return await executeWithAwareness(botArg, selfArg, item);
          if (typeof executeDecision === 'function') return await executeDecision(botArg, selfArg, item);
          return await performBuiltinAction(botArg, selfArg, item.action, item.target, item.label);
        }
      }
    });
    self.__pianoRuntime = __pianoRt;
    bot.__pianoRuntime = __pianoRt;
  } catch (e) {
    console.error('❌ [PIANO V3.1] explicit install failed:', e && e.stack ? e.stack : e);
  }
`;

  edits.push({ start: insertPos, end: insertPos, text: installCode });
}

if (!src.includes('__ADAM_PIANO_V31_LIVELOOP_ROUTE__')) {
  let liveLoopNode = null;

  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === 'liveLoop') {
      liveLoopNode = node;
    }
  });

  if (!liveLoopNode) throw new Error('AST anchor not found: function liveLoop');

  let routeNode = null;

  walk(liveLoopNode, (node) => {
    if (routeNode) return;
    if (node.type !== 'IfStatement') return;

    const text = src.slice(node.start, node.end);
    const isOldRoute = text.includes('reactToChat') && text.includes('thinkAndAct');
    const isV3Route = text.includes('AdamPianoV3.tick');

    if (isOldRoute || isV3Route) routeNode = node;
  });

  if (!routeNode) {
    throw new Error('AST anchor not found: liveLoop think/react route');
  }

  const route = String.raw`/* __ADAM_PIANO_V31_LIVELOOP_ROUTE__ */
      if (self.__pianoRuntime && typeof self.__pianoRuntime.tick === 'function') {
        await self.__pianoRuntime.tick(self.pendingChat.length > 0 ? 'chat_or_social' : 'life_loop');
      } else if (bot.__pianoRuntime && typeof bot.__pianoRuntime.tick === 'function') {
        await bot.__pianoRuntime.tick(self.pendingChat.length > 0 ? 'chat_or_social' : 'life_loop');
      } else if (self.pendingChat.length > 0) await reactToChat(bot, self);
      else await thinkAndAct(bot, self);`;

  edits.push({ start: routeNode.start, end: routeNode.end, text: route });
}

src = applyEdits(src, edits);
fs.writeFileSync(target, src);

/* 5. package scripts */
const pkgFile = 'package.json';
let pkg = {};
try {
  if (fs.existsSync(pkgFile)) pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
} catch {
  pkg = {};
}

pkg.scripts = pkg.scripts || {};
pkg.scripts['test:piano'] = 'node piano_v3/tests/pressure_test.cjs';

if (!pkg.scripts.test || /no test specified/i.test(pkg.scripts.test)) {
  pkg.scripts.test = 'npm run test:piano';
}

fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));

console.log('Backup:', backup);
console.log('Patched target:', target);
console.log('Patched piano_v3/config.cjs');
console.log('Patched piano_v3/index.cjs');
console.log('Added piano_v3/init-config.cjs');
console.log('Added npm script: test:piano');
