#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--')) || 'citizen.cjs';
const keepLiveMode = args.includes('--keep-live-mode');

const V34_LIVE_MARK = '__ADAM_PIANO_V34_LIVELOOP_HOOK__';
const V35_LIVE_MARK = '__ADAM_PIANO_V35_LIVELOOP_HOOK__';
const V36_LIVE_MARK = '__ADAM_PIANO_V36_LIVELOOP_HOOK__';

const V34_EXPORT_MARK = '__ADAM_PIANO_V34_EXPORT_BRIDGE__';
const V35_EXPORT_MARK = '__ADAM_PIANO_V35_EXPORT_BRIDGE__';
const V36_EXPORT_MARK = '__ADAM_PIANO_V36_EXPORT_BRIDGE__';

const V36_DEPS_MARK = '__ADAM_PIANO_V36_DEPS_HELPER__';

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function read(f) {
  return fs.readFileSync(f, 'utf8');
}

function writeIfChanged(f, s) {
  ensureDir(path.dirname(f));
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === s) return false;
  fs.writeFileSync(f, s);
  return true;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backup(f) {
  if (!fs.existsSync(f)) return null;
  ensureDir('backups');
  const dst = path.join(
    'backups',
    path.basename(f).replace(/\.cjs$/, '') + '.before-v36.' + stamp() + '.cjs'
  );
  fs.copyFileSync(f, dst);
  return dst;
}

function nodeCheck(f) {
  if (!fs.existsSync(f)) return { file: f, ok: false, out: 'missing' };
  const r = cp.spawnSync(process.execPath, ['--check', f], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    file: f,
    ok: r.status === 0,
    out: (r.stderr || r.stdout || '').trim(),
  };
}

function requireAcorn() {
  try {
    return require('acorn');
  } catch (_) {
    console.error('acorn missing. Run: npm i -D acorn');
    process.exit(1);
  }
}

function parse(src) {
  const acorn = requireAcorn();
  return acorn.parse(src, {
    ecmaVersion: 2024,
    sourceType: 'script',
    allowHashBang: true,
  });
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);

  for (const k of Object.keys(node)) {
    const v = node[k];
    if (!v) continue;

    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x.type === 'string') walk(x, fn);
      }
    } else if (v && typeof v.type === 'string') {
      walk(v, fn);
    }
  }
}

function propName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return null;
}

function memberPropName(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (!node.computed) return propName(node.property);
  return propName(node.property);
}

function isCreateCitizenExportLeft(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (memberPropName(node) !== 'createCitizen') return false;

  const obj = node.object;
  if (!obj) return false;

  if (obj.type === 'Identifier' && obj.name === 'exports') return true;

  if (
    obj.type === 'MemberExpression' &&
    memberPropName(obj) === 'exports' &&
    obj.object &&
    obj.object.type === 'Identifier' &&
    obj.object.name === 'module'
  ) {
    return true;
  }

  return false;
}

function findCreateCitizenExport(ast) {
  let found = null;
  walk(ast, node => {
    if (found) return;
    if (node.type === 'AssignmentExpression' && isCreateCitizenExportLeft(node.left)) {
      found = node;
    }
  });
  return found;
}

function keyIsLiveLoop(key) {
  if (!key) return false;
  if (key.type === 'Identifier') return key.name === 'liveLoop';
  if (key.type === 'Literal') return String(key.value) === 'liveLoop';
  return false;
}

function leftName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return memberPropName(node);
  return null;
}

function findLiveLoopFunction(ast) {
  let found = null;

  walk(ast, node => {
    if (found) return;

    if (
      node.type === 'FunctionDeclaration' &&
      node.id &&
      node.id.name === 'liveLoop' &&
      node.body &&
      node.body.type === 'BlockStatement'
    ) {
      found = node;
      return;
    }

    if (
      node.type === 'VariableDeclarator' &&
      node.id &&
      node.id.name === 'liveLoop' &&
      node.init &&
      (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression') &&
      node.init.body &&
      node.init.body.type === 'BlockStatement'
    ) {
      found = node.init;
      return;
    }

    if (
      node.type === 'AssignmentExpression' &&
      leftName(node.left) === 'liveLoop' &&
      node.right &&
      (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression') &&
      node.right.body &&
      node.right.body.type === 'BlockStatement'
    ) {
      found = node.right;
      return;
    }

    if (
      node.type === 'Property' &&
      keyIsLiveLoop(node.key) &&
      node.value &&
      (node.value.type === 'FunctionExpression' || node.value.type === 'ArrowFunctionExpression') &&
      node.value.body &&
      node.value.body.type === 'BlockStatement'
    ) {
      found = node.value;
      return;
    }

    if (
      node.type === 'MethodDefinition' &&
      keyIsLiveLoop(node.key) &&
      node.value &&
      node.value.body &&
      node.value.body.type === 'BlockStatement'
    ) {
      found = node.value;
    }
  });

  return found;
}

function findTryAfterMarker(src, markerIndex) {
  const ast = parse(src);
  let best = null;

  walk(ast, node => {
    if (node.type !== 'TryStatement') return;
    if (node.start < markerIndex) return;
    if (node.start - markerIndex > 2500) return;
    if (!best || node.start < best.start) best = node;
  });

  return best;
}

function findExprAfterMarker(src, markerIndex) {
  const ast = parse(src);
  let best = null;

  walk(ast, node => {
    if (node.type !== 'ExpressionStatement') return;
    if (node.start < markerIndex) return;
    if (node.start - markerIndex > 2500) return;
    if (!best || node.start < best.start) best = node;
  });

  return best;
}

function findFunctionAfterMarker(src, markerIndex) {
  const ast = parse(src);
  let best = null;

  walk(ast, node => {
    if (node.type !== 'FunctionDeclaration') return;
    if (node.start < markerIndex) return;
    if (node.start - markerIndex > 2500) return;
    if (!best || node.start < best.start) best = node;
  });

  return best;
}

function removeTryByMarker(src, marker) {
  let changed = false;

  while (true) {
    const idx = src.indexOf(marker);
    if (idx < 0) break;

    const tr = findTryAfterMarker(src, idx);
    if (!tr) throw new Error('cannot remove marked try block: ' + marker);

    const start = src.lastIndexOf('\n', idx) + 1;
    let end = tr.end;
    if (src[end] === '\n') end += 1;

    src = src.slice(0, start) + src.slice(end);
    changed = true;
  }

  return { src, changed };
}

function removeIifeByMarker(src, marker) {
  let changed = false;

  while (true) {
    const idx = src.indexOf(marker);
    if (idx < 0) break;

    const expr = findExprAfterMarker(src, idx);
    if (!expr) throw new Error('cannot remove marked IIFE: ' + marker);

    const start = src.lastIndexOf('\n', idx) + 1;
    let end = expr.end;
    if (src[end] === '\n') end += 1;

    src = src.slice(0, start) + src.slice(end);
    changed = true;
  }

  return { src, changed };
}

function removeFunctionByMarker(src, marker) {
  let changed = false;

  while (true) {
    const idx = src.indexOf(marker);
    if (idx < 0) break;

    const fn = findFunctionAfterMarker(src, idx);
    if (!fn) throw new Error('cannot remove marked function: ' + marker);

    const start = src.lastIndexOf('\n', idx) + 1;
    let end = fn.end;
    if (src[end] === '\n') end += 1;

    src = src.slice(0, start) + src.slice(end);
    changed = true;
  }

  return { src, changed };
}

function collectParamNames(param, out) {
  if (!param) return;

  if (param.type === 'Identifier') {
    out.add(param.name);
    return;
  }

  if (param.type === 'AssignmentPattern') {
    collectParamNames(param.left, out);
    return;
  }

  if (param.type === 'RestElement') {
    collectParamNames(param.argument, out);
  }
}

function getParamNames(fn) {
  const out = new Set();
  for (const p of fn.params || []) collectParamNames(p, out);
  return Array.from(out).filter(x => /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(x));
}

function directiveInsertPos(src) {
  let pos = 0;

  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n');
    pos = nl >= 0 ? nl + 1 : src.length;
  }

  const rest = src.slice(pos);
  const m = rest.match(/^(\s*(?:'use strict'|"use strict");?\s*)/);
  if (m) pos += m[0].length;

  return pos;
}

function depsCollectorCode(varName, indent) {
  return `
${indent}const ${varName} = (() => {
${indent}  const __get = (name) => {
${indent}    try { return eval(name); } catch (_) { return null; }
${indent}  };
${indent}  const __isFn = (v) => typeof v === 'function';
${indent}  const __isOpenAI = (v) => !!(
${indent}    v &&
${indent}    typeof v === 'object' &&
${indent}    (
${indent}      (v.chat && v.chat.completions && typeof v.chat.completions.create === 'function') ||
${indent}      (v.responses && typeof v.responses.create === 'function') ||
${indent}      (v.embeddings && typeof v.embeddings.create === 'function')
${indent}    )
${indent}  );
${indent}  const __first = (...names) => {
${indent}    for (const name of names) {
${indent}      const v = __get(name);
${indent}      if (v !== null && v !== undefined) return v;
${indent}    }
${indent}    return null;
${indent}  };
${indent}  const __firstFn = (...names) => {
${indent}    for (const name of names) {
${indent}      const v = __get(name);
${indent}      if (__isFn(v)) return v;
${indent}    }
${indent}    return null;
${indent}  };
${indent}  const __firstOpenAI = (...names) => {
${indent}    for (const name of names) {
${indent}      const v = __get(name);
${indent}      if (__isOpenAI(v)) return v;
${indent}    }
${indent}    return null;
${indent}  };
${indent}  const __openai = __firstOpenAI(
${indent}    'openai',
${indent}    'openaiClient',
${indent}    'openAIClient',
${indent}    'llmClient',
${indent}    'aiClient',
${indent}    'client'
${indent}  );
${indent}  const __deps = {
${indent}    openai: __openai,
${indent}    openaiClient: __openai,
${indent}    performBuiltinAction: __firstFn('performBuiltinAction', 'runBuiltinAction', 'performAction'),
${indent}    executeDecision: __firstFn('executeDecision', 'runDecision'),
${indent}    executeAction: __firstFn('executeAction', 'runAction'),
${indent}    executeActions: __firstFn('executeActions', 'runActions'),
${indent}    addMemory: __firstFn('addMemory', 'remember', 'storeMemory'),
${indent}    remember: __firstFn('remember', 'addMemory', 'storeMemory'),
${indent}    retrieveMemories: __firstFn('retrieveMemories', 'retrieveMemory', 'searchMemories', 'recallMemories'),
${indent}    retrieveMemory: __firstFn('retrieveMemory', 'retrieveMemories', 'searchMemories'),
${indent}    searchMemories: __firstFn('searchMemories', 'retrieveMemories', 'retrieveMemory'),
${indent}    sanitize: __firstFn('sanitize', 'sanitizeText', 'safeText'),
${indent}    loadPersonalityV2: __firstFn('loadPersonalityV2', 'loadPersonality'),
${indent}    loadPersonality: __firstFn('loadPersonality', 'loadPersonalityV2'),
${indent}    scanCurrentPossibilities: __firstFn('scanCurrentPossibilities', 'scanPossibilities'),
${indent}    scanFutureAffordances: __firstFn('scanFutureAffordances', 'scanAffordances'),
${indent}    getBuiltinActions: __firstFn('getBuiltinActions', 'listBuiltinActions'),
${indent}    maybeInjectTechTasks: __firstFn('maybeInjectTechTasks'),
${indent}    buildTechTreeQueue: __firstFn('buildTechTreeQueue'),
${indent}    thinkAndAct: __firstFn('thinkAndAct'),
${indent}    reactToChat: __firstFn('reactToChat'),
${indent}    safeChat: __firstFn('safeChat', 'botChat'),
${indent}    chat: __firstFn('chat', 'safeChat', 'botChat'),
${indent}    sleep: __firstFn('sleep', 'delay'),
${indent}    Vec3: __first('Vec3'),
${indent}    GoalBlock: __first('GoalBlock'),
${indent}    GoalNear: __first('GoalNear'),
${indent}    Movements: __first('Movements')
${indent}  };
${indent}  for (const [k, v] of Object.entries(__deps)) {
${indent}    if (v === null || v === undefined) delete __deps[k];
${indent}  }
${indent}  if (process.env.ADAM_PIANO_LOG_DEPS === '1') {
${indent}    const __summary = {
${indent}      openai: !!__deps.openai,
${indent}      executor: !!(__deps.performBuiltinAction || __deps.executeDecision || __deps.executeAction || __deps.executeActions),
${indent}      memory: !!(__deps.addMemory || __deps.retrieveMemories || __deps.retrieveMemory || __deps.searchMemories)
${indent}    };
${indent}    console.log('[PIANO V3.6] deps summary', __summary);
${indent}  }
${indent}  return __deps;
${indent}})();
`;
}

function depsHelperBlock() {
  return `/* ${V36_DEPS_MARK} */
function __adamPianoGetDepsV36() {
  const __get = (name) => {
    try { return eval(name); } catch (_) { return null; }
  };
  const __isFn = (v) => typeof v === 'function';
  const __isOpenAI = (v) => !!(
    v &&
    typeof v === 'object' &&
    (
      (v.chat && v.chat.completions && typeof v.chat.completions.create === 'function') ||
      (v.responses && typeof v.responses.create === 'function') ||
      (v.embeddings && typeof v.embeddings.create === 'function')
    )
  );
  const __firstFn = (...names) => {
    for (const name of names) {
      const v = __get(name);
      if (__isFn(v)) return v;
    }
    return null;
  };
  const __firstOpenAI = (...names) => {
    for (const name of names) {
      const v = __get(name);
      if (__isOpenAI(v)) return v;
    }
    return null;
  };

  const __openai = __firstOpenAI('openai', 'openaiClient', 'openAIClient', 'llmClient', 'aiClient', 'client');

  const __deps = {
    openai: __openai,
    openaiClient: __openai,
    performBuiltinAction: __firstFn('performBuiltinAction', 'runBuiltinAction', 'performAction'),
    executeDecision: __firstFn('executeDecision', 'runDecision'),
    executeAction: __firstFn('executeAction', 'runAction'),
    executeActions: __firstFn('executeActions', 'runActions'),
    addMemory: __firstFn('addMemory', 'remember', 'storeMemory'),
    retrieveMemories: __firstFn('retrieveMemories', 'retrieveMemory', 'searchMemories', 'recallMemories'),
    sanitize: __firstFn('sanitize', 'sanitizeText', 'safeText'),
    loadPersonalityV2: __firstFn('loadPersonalityV2', 'loadPersonality'),
    scanCurrentPossibilities: __firstFn('scanCurrentPossibilities', 'scanPossibilities'),
    scanFutureAffordances: __firstFn('scanFutureAffordances', 'scanAffordances'),
    getBuiltinActions: __firstFn('getBuiltinActions', 'listBuiltinActions'),
    maybeInjectTechTasks: __firstFn('maybeInjectTechTasks'),
    thinkAndAct: __firstFn('thinkAndAct'),
    reactToChat: __firstFn('reactToChat')
  };

  for (const [k, v] of Object.entries(__deps)) {
    if (v === null || v === undefined) delete __deps[k];
  }

  return __deps;
}

`;
}

function liveLoopHookBlock(fn) {
  const params = getParamNames(fn);
  const paramPushLines = params.map(
    name => `    try { __pushCandidate(${name}); } catch (_) {}`
  ).join('\n');

  return `
  /* ${V36_LIVE_MARK} */
  try {
    const __pianoBridge = require('./piano_v3/bridge.cjs');
    const __pianoModule = require('./piano_v3/index.cjs');
${depsCollectorCode('__pianoDeps', '    ')}
    const __pianoCandidates = [];
    const __pushCandidate = (v) => {
      if (v && typeof v === 'object' && !__pianoCandidates.includes(v)) {
        __pianoCandidates.push(v);
      }
    };

    try { if (typeof bot !== 'undefined') __pushCandidate(bot); } catch (_) {}
    try { if (typeof self !== 'undefined') __pushCandidate(self); } catch (_) {}
    try { if (typeof citizen !== 'undefined') __pushCandidate(citizen); } catch (_) {}
    try { if (typeof agent !== 'undefined') __pushCandidate(agent); } catch (_) {}
    try { if (typeof ctx !== 'undefined') __pushCandidate(ctx); } catch (_) {}

${paramPushLines || '    // no simple identifier params detected'}

    try { __pushCandidate(this); } catch (_) {}
    try { if (this && this.bot) __pushCandidate(this.bot); } catch (_) {}
    try { if (this && this.self) __pushCandidate(this.self); } catch (_) {}

    const __pianoRt = __pianoBridge.attachPianoRuntime({
      result: null,
      args: __pianoCandidates,
      piano: __pianoModule,
      source: 'liveLoop-hook-v36',
      logger: console,
      allowSyntheticSelf: true,
      requireDeps: true,
      deferIfDepsMissing: false,
      deps: __pianoDeps
    });

    if (__pianoRt && typeof __pianoRt.tick === 'function') {
      const __pianoTick = Promise.resolve(__pianoRt.tick('liveLoop_hook_v36')).catch((e) => {
        console.warn('[PIANO V3.6] liveLoop tick failed:', e && e.message ? e.message : e);
      });

      const __mode = String(process.env.ADAM_PIANO_LIVELOOP_MODE || 'replace').toLowerCase();
      if (__mode !== 'parallel') {
        return __pianoTick;
      }
    } else if (process.env.ADAM_PIANO_STRICT_LIVELOOP === '1') {
      throw new Error('PIANO V3.6 liveLoop hook could not attach/tick runtime');
    }
  } catch (e) {
    console.warn('[PIANO V3.6] liveLoop hook skipped:', e && e.message ? e.message : e);
    if (process.env.ADAM_PIANO_STRICT_DEPS === '1' || process.env.ADAM_PIANO_STRICT_LIVELOOP === '1') throw e;
  }
`;
}

function exportBridgeBlock() {
  return `

/* ${V36_EXPORT_MARK} */
;(() => {
  try {
    const { wrapCreateCitizenExport } = require('./piano_v3/bridge.cjs');
    const piano = require('./piano_v3/index.cjs');

    if (module.exports && typeof module.exports.createCitizen === 'function') {
      module.exports.createCitizen = wrapCreateCitizenExport(module.exports.createCitizen, {
        piano,
        source: 'citizen-export-v36',
        logger: console,
        deferIfDepsMissing: true,
        getDeps: () => {
          try {
            return typeof __adamPianoGetDepsV36 === 'function' ? __adamPianoGetDepsV36() : {};
          } catch (_) {
            return {};
          }
        }
      });
      console.log('[PIANO V3.6] createCitizen export bridge installed');
    } else {
      console.warn('[PIANO V3.6] module.exports.createCitizen not found at bridge install time');
    }

    if (process.env.ADAM_ENABLE_LEGACY_GLOBAL !== '1') {
      try { delete globalThis.AdamPiano; } catch (_) { try { globalThis.AdamPiano = undefined; } catch (_) {} }
    }
  } catch (e) {
    console.error('[PIANO V3.6] createCitizen export bridge failed:', e && e.stack ? e.stack : e);
  }
})();
`;
}

const BRIDGE_CJS = String.raw`'use strict';

/**
 * Piano V3.6 bridge.
 *
 * Fixes:
 * - install() is called as install({ bot, self, deps, ... }) first.
 * - deps are accepted and merged into existing runtime.
 * - export-time install can defer if deps are unavailable.
 * - synthetic self upgrades to real self even when bot.__pianoRuntime already exists.
 * - no globalThis.self / __ADAM_LAST_SELF__ fallback.
 */

function isObject(v) {
  return !!v && typeof v === 'object';
}

function isBotLike(v) {
  return isObject(v) && (
    typeof v.chat === 'function' ||
    typeof v.once === 'function' ||
    typeof v.emit === 'function' ||
    typeof v.loadPlugin === 'function' ||
    typeof v.username === 'string' ||
    !!v.entity
  );
}

function isOpenAIClient(v) {
  return !!(
    v &&
    typeof v === 'object' &&
    (
      (v.chat && v.chat.completions && typeof v.chat.completions.create === 'function') ||
      (v.responses && typeof v.responses.create === 'function') ||
      (v.embeddings && typeof v.embeddings.create === 'function')
    )
  );
}

function warn(logger, msg, err) {
  const detail = err ? (err && err.message ? err.message : String(err)) : '';
  const text = detail ? msg + ': ' + detail : msg;
  if (logger && typeof logger.warn === 'function') logger.warn(text);
}

function log(logger, msg) {
  if (logger && typeof logger.log === 'function') logger.log(msg);
}

function defineHidden(obj, key, val) {
  if (!obj) return;
  try {
    Object.defineProperty(obj, key, {
      value: val,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch (_) {
    try { obj[key] = val; } catch (_) {}
  }
}

function cleanupLegacyGlobal() {
  if (process.env.ADAM_ENABLE_LEGACY_GLOBAL === '1') return;
  try {
    delete globalThis.AdamPiano;
  } catch (_) {
    try { globalThis.AdamPiano = undefined; } catch (_) {}
  }
}

function runtimeName(bot, self, args) {
  if (self && (self.name || self.username || self.id)) {
    return String(self.name || self.username || self.id);
  }

  if (bot && (bot.username || bot.name)) {
    return String(bot.username || bot.name);
  }

  for (const a of args || []) {
    if (typeof a === 'string' && a.trim()) return a.trim();
    if (isObject(a) && (a.name || a.username || a.id)) {
      return String(a.name || a.username || a.id);
    }
  }

  return process.env.ADAMS_NAME || process.env.BOT_NAME || 'Adam';
}

function mergeDeps(base, incoming) {
  const out = isObject(base) ? base : {};
  if (!isObject(incoming)) return out;

  for (const [k, v] of Object.entries(incoming)) {
    if (v !== null && v !== undefined) out[k] = v;
  }

  return out;
}

function depSummary(deps) {
  deps = deps || {};
  const hasOpenAI = isOpenAIClient(deps.openai || deps.openaiClient);
  const hasExecutor = !!(
    deps.performBuiltinAction ||
    deps.executeDecision ||
    deps.executeAction ||
    deps.executeActions
  );
  const hasMemory = !!(
    deps.addMemory ||
    deps.remember ||
    deps.retrieveMemories ||
    deps.retrieveMemory ||
    deps.searchMemories
  );

  return {
    hasOpenAI,
    hasExecutor,
    hasMemory,
    critical: hasOpenAI && hasExecutor,
  };
}

function collectDeps(opts, logger) {
  const out = {};

  if (opts && typeof opts.getDeps === 'function') {
    try {
      mergeDeps(out, opts.getDeps());
    } catch (e) {
      warn(logger, '[PIANO V3.6] getDeps failed', e);
      if (process.env.ADAM_PIANO_STRICT_DEPS === '1' && opts.requireDeps) throw e;
    }
  }

  mergeDeps(out, opts && opts.deps);

  return out;
}

function validateDeps(deps, logger, source, requireDeps) {
  const s = depSummary(deps);

  if (process.env.ADAM_PIANO_LOG_DEPS === '1') {
    log(
      logger,
      '[PIANO V3.6] deps source=' + source +
      ' openai=' + s.hasOpenAI +
      ' executor=' + s.hasExecutor +
      ' memory=' + s.hasMemory
    );
  }

  const missing = [];
  if (!s.hasOpenAI) missing.push('openai');
  if (!s.hasExecutor) missing.push('action executor');

  if (missing.length) {
    warn(logger, '[PIANO V3.6] deps missing at ' + source + ' => ' + missing.join(', '));
    if (process.env.ADAM_PIANO_STRICT_DEPS === '1' && requireDeps) {
      throw new Error('PIANO V3.6 required deps missing: ' + missing.join(', '));
    }
  }

  return s;
}

function synthesizeSelfForBot(bot, args, source) {
  if (!bot) return null;
  if (process.env.ADAM_PIANO_ALLOW_SYNTHETIC_SELF === '0') return null;

  if (bot.__pianoSyntheticSelf) return bot.__pianoSyntheticSelf;

  const name = runtimeName(bot, null, args);

  const self = {
    name,
    username: name,
    bot,
    createdAt: Date.now(),
    __pianoSyntheticSelf: true,
    __pianoSyntheticSource: source || 'unknown',
  };

  defineHidden(bot, '__pianoSyntheticSelf', self);
  return self;
}

function inferSelfAndBot(result, args, options) {
  const opts = options || {};
  const list = [];

  const push = (v) => {
    if (isObject(v) && !list.includes(v)) list.push(v);
  };

  push(result);

  if (isObject(result)) {
    push(result.self);
    push(result.citizen);
    push(result.agent);
    push(result.bot);
  }

  for (const a of args || []) {
    push(a);
    if (isObject(a)) {
      push(a.self);
      push(a.citizen);
      push(a.agent);
      push(a.bot);
    }
  }

  let bot = null;

  for (const x of list) {
    if (isBotLike(x) && !(x.bot && isBotLike(x.bot))) {
      bot = x;
      break;
    }
  }

  if (!bot) {
    for (const x of list) {
      if (isObject(x) && isBotLike(x.bot)) {
        bot = x.bot;
        break;
      }
    }
  }

  let self = null;

  // Prefer real self candidates over synthetic ones.
  for (const x of list) {
    if (!isObject(x) || x === bot) continue;
    if (x.__pianoSyntheticSelf) continue;

    if (x.bot && isBotLike(x.bot)) {
      self = x;
      break;
    }

    if (x.__pianoRuntime !== undefined || x.self === x) {
      self = x;
      break;
    }
  }

  if (!self) {
    for (const x of list) {
      if (!isObject(x) || x === bot) continue;
      if (x.__pianoSyntheticSelf) {
        self = x;
        break;
      }
    }
  }

  if (!self && isObject(result) && result !== bot && !isBotLike(result)) {
    self = result;
  }

  if (!bot && self && isBotLike(self.bot)) {
    bot = self.bot;
  }

  if (!self && bot && opts.allowSyntheticSelf !== false) {
    self = synthesizeSelfForBot(bot, args, opts.source || 'inferSelfAndBot');
  }

  return { self, bot };
}

function attachExisting(rt, bot, self, deps, logger, source) {
  if (!rt) return null;

  if (self) defineHidden(self, '__pianoRuntime', rt);
  if (bot) defineHidden(bot, '__pianoRuntime', rt);

  try {
    if (
      self &&
      !self.__pianoSyntheticSelf &&
      rt.self &&
      rt.self.__pianoSyntheticSelf
    ) {
      rt.self = self;
      log(logger, '[PIANO V3.6] runtime self upgraded synthetic -> real via ' + source);
    }
  } catch (_) {}

  try {
    if (!rt.deps || typeof rt.deps !== 'object') rt.deps = {};
    mergeDeps(rt.deps, deps);
  } catch (_) {}

  return rt;
}

function callInstall(piano, bot, self, source, logger, args, deps) {
  if (!piano || typeof piano.install !== 'function') {
    const e = new Error('piano_v3/index.cjs does not export install()');
    if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') throw e;
    warn(logger, '[PIANO V3.6] attach skipped', e);
    return null;
  }

  if (!bot || !self) {
    const e = new Error('bot/self not available');
    if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') throw e;
    warn(logger, '[PIANO V3.6] attach skipped', e);
    return null;
  }

  const name = runtimeName(bot, self, args);

  const opts = {
    bot,
    self,
    name,
    source,
    bridgeVersion: '3.6',
    deps: deps || {},
  };

  const attempts = [
    {
      name: 'install(opts)',
      fn: () => piano.install(opts),
    },
    {
      name: 'install(bot,self,opts)',
      fn: () => piano.install(bot, self, opts),
    },
    {
      name: 'install(bot,self)',
      fn: () => piano.install(bot, self),
    },
  ];

  let lastErr = null;

  for (const a of attempts) {
    try {
      const rt = a.fn();
      const attached =
        (self && self.__pianoRuntime) ||
        (bot && bot.__pianoRuntime) ||
        rt;

      if (attached) {
        return attachExisting(attached, bot, self, deps, logger, source);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') {
    throw lastErr || new Error('piano install failed');
  }

  warn(logger, '[PIANO V3.6] piano install failed', lastErr);
  return null;
}

function attachPianoRuntime(input) {
  const opts = input || {};
  const result = opts.result;
  const args = opts.args || [];
  const source = opts.source || 'v36-bridge';
  const logger = opts.logger || console;
  const allowSyntheticSelf = opts.allowSyntheticSelf !== false;

  let piano = opts.piano;
  if (!piano) {
    try {
      piano = require('./index.cjs');
    } catch (e) {
      if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') throw e;
      warn(logger, '[PIANO V3.6] cannot require piano index', e);
      return null;
    }
  }

  const deps = collectDeps(opts, logger);
  const depInfo = validateDeps(deps, logger, source, !!opts.requireDeps);

  const found = inferSelfAndBot(result, args, {
    allowSyntheticSelf,
    source,
  });

  let self = found.self;
  let bot = found.bot;

  if (!bot && self && isBotLike(self.bot)) bot = self.bot;
  if (!self && bot && allowSyntheticSelf) {
    self = synthesizeSelfForBot(bot, args, source);
  }

  const existing =
    (self && self.__pianoRuntime) ||
    (bot && bot.__pianoRuntime);

  if (existing) {
    cleanupLegacyGlobal();
    return attachExisting(existing, bot, self, deps, logger, source);
  }

  if (opts.deferIfDepsMissing && !depInfo.critical) {
    warn(logger, '[PIANO V3.6] runtime attach deferred until liveLoop because deps are incomplete at ' + source);
    cleanupLegacyGlobal();
    return null;
  }

  if (self && self.__pianoSyntheticSelf) {
    warn(logger, '[PIANO V3.6] using synthetic self for bot-only attach: ' + runtimeName(bot, self, args));
  }

  const rt = callInstall(piano, bot, self, source, logger, args, deps);
  cleanupLegacyGlobal();

  if (!rt) return null;

  attachExisting(rt, bot, self, deps, logger, source);
  log(logger, '[PIANO V3.6] runtime attached: ' + runtimeName(bot, self, args) + ' via ' + source);

  return rt;
}

function wrapCreateCitizenExport(original, options) {
  if (typeof original !== 'function') {
    throw new TypeError('createCitizen export is not a function');
  }

  if (original.__pianoV36Wrapped) return original;

  const opts = options || {};

  function wrappedCreateCitizenV36() {
    const callArgs = Array.from(arguments);
    const out = original.apply(this, callArgs);

    const attach = (result) => {
      attachPianoRuntime({
        result,
        args: callArgs,
        piano: opts.piano,
        source: opts.source || 'createCitizen-export-v36',
        logger: opts.logger || console,
        allowSyntheticSelf: true,
        requireDeps: false,
        deferIfDepsMissing: opts.deferIfDepsMissing !== false,
        deps: opts.deps,
        getDeps: opts.getDeps,
      });

      return result;
    };

    if (out && typeof out.then === 'function') {
      return out.then(attach);
    }

    return attach(out);
  }

  defineHidden(wrappedCreateCitizenV36, '__pianoV36Wrapped', true);
  return wrappedCreateCitizenV36;
}

module.exports = {
  cleanupLegacyGlobal,
  inferSelfAndBot,
  synthesizeSelfForBot,
  attachPianoRuntime,
  wrapCreateCitizenExport,
  depSummary,
};
`;

const BRIDGE_TEST_CJS = String.raw`'use strict';

const assert = require('assert');

process.env.ADAM_PIANO_ALLOW_SYNTHETIC_SELF = '1';
process.env.ADAM_PIANO_STRICT_ATTACH = '0';
process.env.ADAM_ENABLE_LEGACY_GLOBAL = '0';

const {
  inferSelfAndBot,
  attachPianoRuntime,
  wrapCreateCitizenExport,
  cleanupLegacyGlobal,
  depSummary,
} = require('../bridge.cjs');

function fakeOpenAI() {
  return {
    chat: {
      completions: {
        create() {},
      },
    },
  };
}

function fakeDeps(extra) {
  return Object.assign({
    openai: fakeOpenAI(),
    performBuiltinAction() {},
  }, extra || {});
}

let installCount = 0;

const mockPiano = {
  install(opts) {
    assert.strictEqual(arguments.length, 1, 'object install signature should be tried first');
    assert.ok(opts.bot, 'install opts.bot required');
    assert.ok(opts.self, 'install opts.self required');
    assert.ok(opts.deps, 'install opts.deps required');
    assert.ok(opts.deps.openai, 'install deps.openai required');

    installCount++;

    const rt = {
      name: opts.name || opts.self.name || opts.bot.username,
      bot: opts.bot,
      self: opts.self,
      source: opts.source,
      deps: Object.assign({}, opts.deps),
      tickCalls: [],
      tick(reason) {
        this.tickCalls.push(reason);
      },
    };

    return rt;
  },
};

(function testDepSummary() {
  const s = depSummary(fakeDeps());
  assert.strictEqual(s.hasOpenAI, true);
  assert.strictEqual(s.hasExecutor, true);
  assert.strictEqual(s.critical, true);
})();

(function testNoGlobalFallback() {
  const badBot = { username: 'BADBOT', emit() {}, once() {} };
  const badSelf = { name: 'BAD', bot: badBot };
  globalThis.__ADAM_LAST_SELF__ = badSelf;

  const bot = { username: 'A', emit() {}, once() {} };
  const self = { name: 'A', bot };

  const found = inferSelfAndBot(self, [], { allowSyntheticSelf: true });
  assert.strictEqual(found.self, self);
  assert.strictEqual(found.bot, bot);
  assert.strictEqual(badSelf.__pianoRuntime, undefined);
})();

(function testBotOnlyCreateCitizenWithDepsInstalls() {
  installCount = 0;

  const bot = { username: 'BOTONLY', emit() {}, once() {} };
  const wrapped = wrapCreateCitizenExport(() => bot, {
    piano: mockPiano,
    source: 'botOnlyTest',
    logger: { log() {}, warn() {} },
    getDeps: () => fakeDeps(),
  });

  const out = wrapped();

  assert.strictEqual(out, bot);
  assert.ok(bot.__pianoSyntheticSelf, 'synthetic self should be attached to bot');
  assert.ok(bot.__pianoRuntime, 'runtime should be attached to bot');
  assert.ok(bot.__pianoSyntheticSelf.__pianoRuntime, 'runtime should be attached to synthetic self');
  assert.strictEqual(installCount, 1);
})();

(function testCreateCitizenNoDepsDefersInsteadOfDeadInstall() {
  installCount = 0;

  const bot = { username: 'DEFER', emit() {}, once() {} };
  const wrapped = wrapCreateCitizenExport(() => bot, {
    piano: mockPiano,
    source: 'deferTest',
    logger: { log() {}, warn() {} },
    getDeps: () => ({}),
    deferIfDepsMissing: true,
  });

  const out = wrapped();

  assert.strictEqual(out, bot);
  assert.strictEqual(bot.__pianoRuntime, undefined, 'runtime should defer when deps incomplete');
  assert.strictEqual(installCount, 0);
})();

(function testSyntheticSelfUpgradesToRealSelfAndMergesDeps() {
  installCount = 0;

  const bot = { username: 'UPGRADE', emit() {}, once() {} };

  const rt1 = attachPianoRuntime({
    result: bot,
    args: [bot],
    piano: mockPiano,
    source: 'initialSynthetic',
    logger: { log() {}, warn() {} },
    deps: fakeDeps({ addMemory() {} }),
    allowSyntheticSelf: true,
  });

  assert.ok(rt1);
  assert.ok(rt1.self.__pianoSyntheticSelf);

  const realSelf = {
    name: 'UPGRADE',
    bot,
    state: { taskQueue: ['wood'] },
    actionHistory: [{ ok: true }],
  };

  const rt2 = attachPianoRuntime({
    result: realSelf,
    args: [realSelf, bot],
    piano: mockPiano,
    source: 'realSelfLiveLoop',
    logger: { log() {}, warn() {} },
    deps: fakeDeps({ executeDecision() {}, retrieveMemories() {} }),
    allowSyntheticSelf: true,
  });

  assert.strictEqual(rt2, rt1, 'same runtime should be reused');
  assert.strictEqual(rt1.self, realSelf, 'runtime self should upgrade to real self');
  assert.strictEqual(realSelf.__pianoRuntime, rt1);
  assert.strictEqual(bot.__pianoRuntime, rt1);
  assert.ok(rt1.deps.executeDecision, 'new deps should merge into runtime');
  assert.ok(rt1.deps.retrieveMemories, 'memory deps should merge into runtime');
})();

(function testUndefinedCreateCitizenDoesNotThrow() {
  installCount = 0;

  const wrapped = wrapCreateCitizenExport(() => undefined, {
    piano: mockPiano,
    source: 'undefinedTest',
    logger: { log() {}, warn() {} },
    getDeps: () => fakeDeps(),
  });

  assert.doesNotThrow(() => wrapped());
})();

(function testLegacyGlobalCleanup() {
  globalThis.AdamPiano = { legacy: true };
  cleanupLegacyGlobal();
  assert.strictEqual(globalThis.AdamPiano, undefined);
})();

console.log('bridge tests passed');
`;

const PRESSURE_TEST_CJS = String.raw`'use strict';

const assert = require('assert');
const mod = require('../pressure.cjs');

assert.strictEqual(typeof mod.computePressures, 'function', 'pressure.cjs must export computePressures');

const out = mod.computePressures({
  health: 8,
  food: 5,
  hostileDistance: 4,
  queueLength: 3,
  failRatio: 0.2,
  recentSocialCount: 1,
  recentObservationCount: 2,
  recentSurpriseCount: 1,
  idleMs: 60000,
  shortages: ['wood'],
  personality: { curiosity: 0.7, diligence: 0.6 },
}, { pressure: { coefficients: {} } });

assert.ok(out && typeof out === 'object', 'computePressures must return object');

let numericCount = 0;
for (const [k, v] of Object.entries(out)) {
  if (typeof v === 'number') {
    numericCount++;
    assert.ok(Number.isFinite(v), k + ' must be finite');
  }
}

assert.ok(numericCount > 0, 'pressure output should contain numeric values');

console.log('pressure tests passed');
`;

function ensureSupportFiles() {
  ensureDir('piano_v3');
  ensureDir('piano_v3/tests');
  ensureDir('logs');

  writeIfChanged('piano_v3/bridge.cjs', BRIDGE_CJS);
  writeIfChanged('piano_v3/tests/bridge_test.cjs', BRIDGE_TEST_CJS);

  if (!fs.existsSync('piano_v3/tests/pressure_test.cjs')) {
    writeIfChanged('piano_v3/tests/pressure_test.cjs', PRESSURE_TEST_CJS);
  }

  const pkgFile = 'package.json';
  let pkg = { scripts: {} };

  if (fs.existsSync(pkgFile)) {
    pkg = JSON.parse(read(pkgFile));
  }

  if (!pkg.scripts) pkg.scripts = {};

  pkg.scripts['test:piano'] =
    'node piano_v3/tests/pressure_test.cjs && node piano_v3/tests/bridge_test.cjs';

  if (!pkg.scripts.test || /no test specified|exit 1/.test(pkg.scripts.test)) {
    pkg.scripts.test = 'npm run test:piano';
  }

  writeIfChanged(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureEnv() {
  const file = '.env';
  let s = fs.existsSync(file) ? read(file) : '';

  function setEnv(key, value, force) {
    const re = new RegExp('^\\s*(?:export\\s+)?' + escapeRegExp(key) + '\\s*=.*$', 'm');
    if (re.test(s)) {
      if (force) s = s.replace(re, key + '=' + value);
    } else {
      if (s && !s.endsWith('\n')) s += '\n';
      s += key + '=' + value + '\n';
    }
  }

  setEnv('ADAM_PIANO_LIVELOOP_MODE', 'replace', !keepLiveMode);
  setEnv('ADAM_PIANO_ALLOW_SYNTHETIC_SELF', '1', false);

  writeIfChanged(file, s);
}

function patchCitizen(file) {
  if (!fs.existsSync(file)) {
    throw new Error(file + ' not found');
  }

  let src = read(file);

  if (/pianoV32ThinkBridge|pianoV32ReactBridge|__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__/.test(src)) {
    throw new Error('V3.2 bridge remnants found. Restore clean git commit first.');
  }

  for (const marker of [V34_LIVE_MARK, V35_LIVE_MARK, V36_LIVE_MARK]) {
    const r = removeTryByMarker(src, marker);
    src = r.src;
  }

  for (const marker of [V34_EXPORT_MARK, V35_EXPORT_MARK, V36_EXPORT_MARK]) {
    const r = removeIifeByMarker(src, marker);
    src = r.src;
  }

  if (src.includes(V36_DEPS_MARK)) {
    const r = removeFunctionByMarker(src, V36_DEPS_MARK);
    src = r.src;
  }

  const helperPos = directiveInsertPos(src);
  src = src.slice(0, helperPos) + depsHelperBlock() + src.slice(helperPos);

  let ast = parse(src);
  const liveLoop = findLiveLoopFunction(ast);

  if (!liveLoop) {
    throw new Error('liveLoop function not found; refusing silent scheduler-only mode');
  }

  src = src.slice(0, liveLoop.body.start + 1) + liveLoopHookBlock(liveLoop) + src.slice(liveLoop.body.start + 1);

  ast = parse(src);
  const createExport = findCreateCitizenExport(ast);

  if (!createExport) {
    throw new Error('module.exports.createCitizen assignment not found');
  }

  src += exportBridgeBlock();

  const bad = [];
  for (const marker of [V34_LIVE_MARK, V35_LIVE_MARK, V34_EXPORT_MARK, V35_EXPORT_MARK]) {
    if (src.includes(marker)) bad.push(marker);
  }
  if (/pianoV32ThinkBridge|pianoV32ReactBridge/.test(src)) bad.push('V32 bridge assignment');

  if (bad.length) {
    throw new Error('old markers still remain after patch: ' + bad.join(', '));
  }

  writeIfChanged(file, src);

  return {
    liveLoopHooked: src.includes(V36_LIVE_MARK),
    exportBridgeInstalled: src.includes(V36_EXPORT_MARK),
    depsHelperInstalled: src.includes(V36_DEPS_MARK),
  };
}

function main() {
  const report = {
    timestamp: new Date().toISOString(),
    target,
    backup: backup(target),
    patch: null,
    checks: [],
  };

  ensureSupportFiles();
  ensureEnv();

  report.patch = patchCitizen(target);

  report.checks = [
    nodeCheck(target),
    nodeCheck('piano_v3/index.cjs'),
    nodeCheck('piano_v3/bridge.cjs'),
    nodeCheck('piano_v3/config.cjs'),
    nodeCheck('piano_v3/tests/bridge_test.cjs'),
  ];

  writeIfChanged('piano_v36_report.json', JSON.stringify(report, null, 2) + '\n');

  console.log('');
  console.log('=== PIANO V3.6 DEPS UPGRADE SUMMARY ===');
  console.log('target:', target);
  console.log('backup:', report.backup);
  console.log('deps helper:', report.patch.depsHelperInstalled ? 'YES' : 'NO');
  console.log('liveLoop hook:', report.patch.liveLoopHooked ? 'YES' : 'NO');
  console.log('export bridge:', report.patch.exportBridgeInstalled ? 'YES' : 'NO');
  console.log('liveLoop mode default: replace');
  console.log('');

  let failed = false;
  for (const c of report.checks) {
    console.log((c.ok ? 'OK  ' : 'BAD ') + c.file);
    if (!c.ok) {
      failed = true;
      if (c.out) console.log(c.out);
    }
  }

  console.log('');
  console.log('report: piano_v36_report.json');
  console.log('');

  if (failed) process.exit(1);

  console.log('V3.6 patch complete.');
  console.log('');
  console.log('Next:');
  console.log('  npm run test:piano');
  console.log('  ADAM_PIANO_LOG_DEPS=1 ADAM_PIANO_STRICT_DEPS=1 ADAM_PIANO_LIVELOOP_MODE=replace node index.cjs');
}

try {
  main();
} catch (e) {
  console.error('');
  console.error('V3.6 patch failed:');
  console.error(e && e.stack ? e.stack : e);
  console.error('');
  process.exit(1);
}
