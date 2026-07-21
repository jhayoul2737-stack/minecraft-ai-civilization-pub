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
const V35_EXPORT_MARK = '__ADAM_PIANO_V35_EXPORT_BRIDGE__';

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
    path.basename(f).replace(/\.cjs$/, '') + '.before-v35.' + stamp() + '.cjs'
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
    if (node.start - markerIndex > 800) return;
    if (!best || node.start < best.start) best = node;
  });

  return best;
}

function removeHookByMarker(src, marker) {
  let changed = false;

  while (true) {
    const idx = src.indexOf(marker);
    if (idx < 0) break;

    const tr = findTryAfterMarker(src, idx);
    if (!tr) {
      const lineStart = src.lastIndexOf('\n', idx) + 1;
      const lineEndRaw = src.indexOf('\n', idx);
      const lineEnd = lineEndRaw < 0 ? src.length : lineEndRaw + 1;
      src = src.slice(0, lineStart) + src.slice(lineEnd);
      changed = true;
      continue;
    }

    const start = src.lastIndexOf('\n', idx) + 1;
    let end = tr.end;
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
    return;
  }

  // ObjectPattern / ArrayPattern은 안전하게 생략.
}

function getParamNames(fn) {
  const out = new Set();
  for (const p of fn.params || []) collectParamNames(p, out);
  return Array.from(out).filter(x => /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(x));
}

function liveLoopHookBlock(fn) {
  const params = getParamNames(fn);
  const paramPushLines = params.map(
    name => `    try { __pushCandidate(${name}); } catch (_) {}`
  ).join('\n');

  return `
  /* ${V35_LIVE_MARK} */
  try {
    const __pianoBridge = require('./piano_v3/bridge.cjs');
    const __pianoModule = require('./piano_v3/index.cjs');
    const __pianoCandidates = [];
    const __pushCandidate = (v) => {
      if (v && typeof v === 'object' && !__pianoCandidates.includes(v)) {
        __pianoCandidates.push(v);
      }
    };

    // Common local names, all guarded.
    try { if (typeof bot !== 'undefined') __pushCandidate(bot); } catch (_) {}
    try { if (typeof self !== 'undefined') __pushCandidate(self); } catch (_) {}
    try { if (typeof citizen !== 'undefined') __pushCandidate(citizen); } catch (_) {}
    try { if (typeof agent !== 'undefined') __pushCandidate(agent); } catch (_) {}
    try { if (typeof ctx !== 'undefined') __pushCandidate(ctx); } catch (_) {}

    // Actual liveLoop parameter names detected by AST.
${paramPushLines || '    // no simple identifier params detected'}

    // Method-style liveLoop support.
    try { __pushCandidate(this); } catch (_) {}
    try { if (this && this.bot) __pushCandidate(this.bot); } catch (_) {}
    try { if (this && this.self) __pushCandidate(this.self); } catch (_) {}

    const __found = __pianoBridge.inferSelfAndBot(null, __pianoCandidates, {
      allowSyntheticSelf: true,
    });

    let __pianoRt =
      ((__found.self && __found.self.__pianoRuntime) ? __found.self.__pianoRuntime : null) ||
      ((__found.bot && __found.bot.__pianoRuntime) ? __found.bot.__pianoRuntime : null);

    if (!__pianoRt) {
      __pianoRt = __pianoBridge.attachPianoRuntime({
        result: __found.self || __found.bot || null,
        args: __pianoCandidates,
        piano: __pianoModule,
        source: 'liveLoop-hook-v35',
        logger: console,
        allowSyntheticSelf: true,
      });
    }

    if (__pianoRt && typeof __pianoRt.tick === 'function') {
      const __pianoTick = Promise.resolve(__pianoRt.tick('liveLoop_hook_v35')).catch((e) => {
        console.warn('[PIANO V3.5] liveLoop tick failed:', e && e.message ? e.message : e);
      });

      // V3.5 default is replace. Parallel must be explicit.
      const __mode = String(process.env.ADAM_PIANO_LIVELOOP_MODE || 'replace').toLowerCase();
      if (__mode !== 'parallel') {
        return __pianoTick;
      }
    } else if (process.env.ADAM_PIANO_STRICT_LIVELOOP === '1') {
      throw new Error('PIANO V3.5 liveLoop hook could not attach/tick runtime');
    }
  } catch (e) {
    console.warn('[PIANO V3.5] liveLoop hook skipped:', e && e.message ? e.message : e);
    if (process.env.ADAM_PIANO_STRICT_LIVELOOP === '1') throw e;
  }
`;
}

const BRIDGE_CJS = String.raw`'use strict';

/**
 * Piano V3.5 bridge.
 *
 * Fixes:
 * - createCitizen returning only bot no longer crashes install.
 * - No globalThis.self / __ADAM_LAST_SELF__ fallback.
 * - Synthetic self is per-bot: bot.__pianoSyntheticSelf.
 * - Legacy globalThis.AdamPiano is deleted unless ADAM_ENABLE_LEGACY_GLOBAL=1.
 * - attach failures are warnings by default, strict only with ADAM_PIANO_STRICT_ATTACH=1.
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

function warn(logger, msg, err) {
  const detail = err ? (err && err.message ? err.message : String(err)) : '';
  const text = detail ? msg + ': ' + detail : msg;
  if (logger && typeof logger.warn === 'function') logger.warn(text);
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

  for (const x of list) {
    if (!isObject(x) || x === bot) continue;

    if (x.bot && isBotLike(x.bot)) {
      self = x;
      break;
    }

    if (x.__pianoRuntime !== undefined || x.self === x || x.__pianoSyntheticSelf) {
      self = x;
      break;
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

function attachExisting(rt, bot, self) {
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
    }
  } catch (_) {}

  return rt;
}

function callInstall(piano, bot, self, source, logger, args) {
  if (!piano || typeof piano.install !== 'function') {
    const e = new Error('piano_v3/index.cjs does not export install()');
    if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') throw e;
    warn(logger, '[PIANO V3.5] attach skipped', e);
    return null;
  }

  if (!bot || !self) {
    const e = new Error('bot/self not available');
    if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') throw e;
    warn(logger, '[PIANO V3.5] attach skipped', e);
    return null;
  }

  const name = runtimeName(bot, self, args);

  const attempts = [
    {
      name: 'install(bot,self,opts)',
      fn: () => piano.install(bot, self, { name, source, bridgeVersion: '3.5' }),
    },
    {
      name: 'install(bot,self)',
      fn: () => piano.install(bot, self),
    },
    {
      name: 'install({bot,self,...})',
      fn: () => piano.install({ bot, self, name, source, bridgeVersion: '3.5' }),
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
        return attachExisting(attached, bot, self);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') {
    throw lastErr || new Error('piano install failed');
  }

  warn(logger, '[PIANO V3.5] piano install failed', lastErr);
  return null;
}

function attachPianoRuntime(input) {
  const opts = input || {};
  const result = opts.result;
  const args = opts.args || [];
  const source = opts.source || 'v35-bridge';
  const logger = opts.logger || console;
  const allowSyntheticSelf = opts.allowSyntheticSelf !== false;

  let piano = opts.piano;
  if (!piano) {
    try {
      piano = require('./index.cjs');
    } catch (e) {
      if (process.env.ADAM_PIANO_STRICT_ATTACH === '1') throw e;
      warn(logger, '[PIANO V3.5] cannot require piano index', e);
      return null;
    }
  }

  let found = inferSelfAndBot(result, args, {
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
    return attachExisting(existing, bot, self);
  }

  if (self && self.__pianoSyntheticSelf && logger && typeof logger.warn === 'function') {
    logger.warn('[PIANO V3.5] using synthetic self for bot-only createCitizen result: ' + runtimeName(bot, self, args));
  }

  const rt = callInstall(piano, bot, self, source, logger, args);
  cleanupLegacyGlobal();

  if (!rt) return null;

  attachExisting(rt, bot, self);

  if (logger && typeof logger.log === 'function') {
    logger.log('[PIANO V3.5] runtime attached: ' + runtimeName(bot, self, args) + ' via ' + source);
  }

  return rt;
}

function wrapCreateCitizenExport(original, options) {
  if (typeof original !== 'function') {
    throw new TypeError('createCitizen export is not a function');
  }

  if (original.__pianoV35Wrapped || original.__pianoV34Wrapped) return original;

  const opts = options || {};

  function wrappedCreateCitizenV35() {
    const callArgs = Array.from(arguments);
    const out = original.apply(this, callArgs);

    const attach = (result) => {
      attachPianoRuntime({
        result,
        args: callArgs,
        piano: opts.piano,
        source: opts.source || 'createCitizen-export-v35',
        logger: opts.logger || console,
        allowSyntheticSelf: true,
      });

      return result;
    };

    if (out && typeof out.then === 'function') {
      return out.then(attach);
    }

    return attach(out);
  }

  defineHidden(wrappedCreateCitizenV35, '__pianoV35Wrapped', true);
  return wrappedCreateCitizenV35;
}

module.exports = {
  cleanupLegacyGlobal,
  inferSelfAndBot,
  synthesizeSelfForBot,
  attachPianoRuntime,
  wrapCreateCitizenExport,
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
} = require('../bridge.cjs');

let installCount = 0;

const mockPiano = {
  install(bot, self, opts) {
    assert.ok(bot, 'install bot required');
    assert.ok(self, 'install self required');

    installCount++;

    const rt = {
      name: (opts && opts.name) || self.name || bot.username,
      bot,
      self,
      source: opts && opts.source,
      tickCalls: [],
      tick(reason) {
        this.tickCalls.push(reason);
      },
    };

    return rt;
  },
};

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

(function testBotOnlyCreateCitizenDoesNotCrash() {
  installCount = 0;

  const bot = { username: 'BOTONLY', emit() {}, once() {} };
  const wrapped = wrapCreateCitizenExport(() => bot, {
    piano: mockPiano,
    source: 'botOnlyTest',
    logger: { log() {}, warn() {} },
  });

  const out = wrapped();

  assert.strictEqual(out, bot);
  assert.ok(bot.__pianoSyntheticSelf, 'synthetic self should be attached to bot');
  assert.ok(bot.__pianoRuntime, 'runtime should be attached to bot');
  assert.ok(bot.__pianoSyntheticSelf.__pianoRuntime, 'runtime should be attached to synthetic self');
  assert.strictEqual(installCount, 1);
})();

(function testUndefinedCreateCitizenDoesNotThrow() {
  installCount = 0;

  const wrapped = wrapCreateCitizenExport(() => undefined, {
    piano: mockPiano,
    source: 'undefinedTest',
    logger: { log() {}, warn() {} },
  });

  assert.doesNotThrow(() => wrapped());
  assert.strictEqual(installCount, 0);
})();

(function testMultiBotSeparation() {
  installCount = 0;

  const botA = { username: 'A', emit() {}, once() {} };
  const botB = { username: 'B', emit() {}, once() {} };
  const selfA = { name: 'A', bot: botA };
  const selfB = { name: 'B', bot: botB };

  const outA = attachPianoRuntime({
    result: selfA,
    args: [],
    piano: mockPiano,
    source: 'multiA',
    logger: { log() {}, warn() {} },
  });

  const outB = attachPianoRuntime({
    result: selfB,
    args: [],
    piano: mockPiano,
    source: 'multiB',
    logger: { log() {}, warn() {} },
  });

  assert.ok(outA);
  assert.ok(outB);
  assert.notStrictEqual(outA, outB);
  assert.strictEqual(selfA.__pianoRuntime, outA);
  assert.strictEqual(selfB.__pianoRuntime, outB);
  assert.strictEqual(botA.__pianoRuntime, outA);
  assert.strictEqual(botB.__pianoRuntime, outB);
})();

(function testLegacyGlobalCleanup() {
  globalThis.AdamPiano = { legacy: true };
  cleanupLegacyGlobal();
  assert.strictEqual(globalThis.AdamPiano, undefined);
})();

console.log('bridge tests passed');
`;

function ensureSupportFiles() {
  ensureDir('piano_v3');
  ensureDir('piano_v3/tests');
  ensureDir('logs');

  writeIfChanged('piano_v3/bridge.cjs', BRIDGE_CJS);
  writeIfChanged('piano_v3/tests/bridge_test.cjs', BRIDGE_TEST_CJS);

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

function ensureEnv() {
  const file = '.env';
  let s = fs.existsSync(file) ? read(file) : '';

  function setEnv(key, value, force) {
    const re = new RegExp('^\\s*(?:export\\s+)?' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=.*$', 'm');
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

function exportBridgeBlock() {
  return `

/* ${V35_EXPORT_MARK} */
;(() => {
  try {
    const { wrapCreateCitizenExport } = require('./piano_v3/bridge.cjs');
    const piano = require('./piano_v3/index.cjs');

    if (module.exports && typeof module.exports.createCitizen === 'function') {
      module.exports.createCitizen = wrapCreateCitizenExport(module.exports.createCitizen, {
        piano,
        source: 'citizen-export-v35',
        logger: console,
      });
      console.log('[PIANO V3.5] createCitizen export bridge installed');
    } else {
      console.warn('[PIANO V3.5] module.exports.createCitizen not found at bridge install time');
    }

    if (process.env.ADAM_ENABLE_LEGACY_GLOBAL !== '1') {
      try { delete globalThis.AdamPiano; } catch (_) { try { globalThis.AdamPiano = undefined; } catch (_) {} }
    }
  } catch (e) {
    console.error('[PIANO V3.5] createCitizen export bridge failed:', e && e.stack ? e.stack : e);
  }
})();
`;
}

function patchCitizen(file) {
  if (!fs.existsSync(file)) {
    throw new Error(file + ' not found');
  }

  let src = read(file);

  if (/pianoV32ThinkBridge|pianoV32ReactBridge|__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__/.test(src)) {
    throw new Error('V3.2 bridge remnants found. Restore clean git commit first.');
  }

  // Remove old V3.4/V3.5 liveLoop hooks to avoid double tick.
  let r = removeHookByMarker(src, V34_LIVE_MARK);
  src = r.src;
  r = removeHookByMarker(src, V35_LIVE_MARK);
  src = r.src;

  let ast = parse(src);
  const liveLoop = findLiveLoopFunction(ast);

  if (!liveLoop) {
    throw new Error('liveLoop function not found; refusing silent scheduler-only mode');
  }

  const hook = liveLoopHookBlock(liveLoop);
  src = src.slice(0, liveLoop.body.start + 1) + hook + src.slice(liveLoop.body.start + 1);

  ast = parse(src);
  const createExport = findCreateCitizenExport(ast);

  if (!createExport) {
    throw new Error('module.exports.createCitizen assignment not found');
  }

  if (
    !src.includes('__ADAM_PIANO_V34_EXPORT_BRIDGE__') &&
    !src.includes(V35_EXPORT_MARK)
  ) {
    src += exportBridgeBlock();
  }

  writeIfChanged(file, src);

  return {
    liveLoopHooked: true,
    createCitizenExportFound: true,
    hasV34ExportBridge: src.includes('__ADAM_PIANO_V34_EXPORT_BRIDGE__'),
    hasV35ExportBridge: src.includes(V35_EXPORT_MARK),
  };
}

function main() {
  const report = {
    timestamp: new Date().toISOString(),
    target,
    backup: backup(target),
    supportFiles: {},
    env: {},
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
    nodeCheck('piano_v3/tests/bridge_test.cjs'),
  ];

  writeIfChanged('piano_v35_report.json', JSON.stringify(report, null, 2) + '\n');

  console.log('');
  console.log('=== PIANO V3.5 RUNTIME FIX SUMMARY ===');
  console.log('target:', target);
  console.log('backup:', report.backup);
  console.log('liveLoop hook: V3.5 replace-by-default');
  console.log('createCitizen export found:', report.patch.createCitizenExportFound ? 'YES' : 'NO');
  console.log('V3.4 export bridge present:', report.patch.hasV34ExportBridge ? 'YES' : 'NO');
  console.log('V3.5 export bridge present:', report.patch.hasV35ExportBridge ? 'YES' : 'NO');
  console.log('env ADAM_PIANO_LIVELOOP_MODE:', keepLiveMode ? 'kept existing value' : 'replace');
  console.log('env ADAM_PIANO_ALLOW_SYNTHETIC_SELF: 1');
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
  console.log('report: piano_v35_report.json');
  console.log('');

  if (failed) process.exit(1);

  console.log('V3.5 patch complete.');
  console.log('');
  console.log('Next:');
  console.log('  npm run test:piano');
  console.log('  ADAM_PIANO_LIVELOOP_MODE=replace node index.cjs');
}

try {
  main();
} catch (e) {
  console.error('');
  console.error('V3.5 patch failed:');
  console.error(e && e.stack ? e.stack : e);
  console.error('');
  process.exit(1);
}
