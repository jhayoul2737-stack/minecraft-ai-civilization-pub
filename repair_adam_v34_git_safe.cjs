#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const EXPORT_MARK = '__ADAM_PIANO_V34_EXPORT_BRIDGE__';
const LIVE_MARK = '__ADAM_PIANO_V34_LIVELOOP_HOOK__';
const DISABLE_MARK = '__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V34__';
const INDEX_GUARD_MARK = '__PIANO_V34_LEGACY_GLOBAL_GUARD__';

const rawArgs = process.argv.slice(2);
const opts = {
  listGit: false,
  restoreGit: null,
  restoreFile: null,
  patchCurrent: false,
  allowUnpatchedLiveLoop: false,
};
let target = 'citizen.cjs';

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--list-git') opts.listGit = true;
  else if (a === '--patch-current') opts.patchCurrent = true;
  else if (a === '--allow-unpatched-liveLoop' || a === '--allow-unpatched-liveloop') {
    opts.allowUnpatchedLiveLoop = true;
  } else if (a === '--restore-git') {
    opts.restoreGit = rawArgs[++i];
  } else if (a.startsWith('--restore-git=')) {
    opts.restoreGit = a.slice('--restore-git='.length);
  } else if (a === '--restore-file') {
    opts.restoreFile = rawArgs[++i];
  } else if (a.startsWith('--restore-file=')) {
    opts.restoreFile = a.slice('--restore-file='.length);
  } else if (!a.startsWith('--')) {
    target = a;
  }
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeIfChanged(file, data) {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === data) return false;
  fs.writeFileSync(file, data);
  return true;
}

function runGit(args, allowFail = false) {
  try {
    return cp.execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

function isGitRepo() {
  const r = runGit(['rev-parse', '--is-inside-work-tree'], true);
  return !!r && r.trim() === 'true';
}

function gitHead() {
  const r = runGit(['rev-parse', '--short', 'HEAD'], true);
  return r ? r.trim() : null;
}

function gitDirty() {
  const r = runGit(['status', '--porcelain'], true);
  return r ? r.trim() : '';
}

function analyzeSource(src) {
  const flags = {
    hasCreateExport: /module\.exports\.createCitizen\s*=|exports\.createCitizen\s*=/.test(src),
    hasMineflayer: /mineflayer\.createBot|createBot\s*\(/.test(src),
    hasLiveLoop: /\bliveLoop\b/.test(src),
    hasThinkAndAct: /\bthinkAndAct\b/.test(src),
    hasReactToChat: /\breactToChat\b/.test(src),
    hasV32: /__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__|pianoV32ThinkBridge|pianoV32ReactBridge|__PIANO_V32_INSTALL_WRAPPER__/.test(src),
    hasV33: /__ADAM_PIANO_V33_EXPORT_BRIDGE__/.test(src),
    hasV34: new RegExp(EXPORT_MARK).test(src),
    size: src.length,
  };

  let score = 0;
  if (flags.hasMineflayer) score += 100;
  if (flags.hasCreateExport) score += 90;
  if (flags.hasLiveLoop) score += 60;
  if (flags.hasThinkAndAct) score += 25;
  if (flags.hasReactToChat) score += 25;
  if (flags.size > 20000) score += 20;
  if (flags.size > 40000) score += 10;
  if (flags.hasV32) score -= 200;
  if (flags.hasV34) score -= 20;

  flags.score = score;
  return flags;
}

function listGitCandidates(file) {
  if (!isGitRepo()) return [];

  const out = runGit([
    'log',
    '--format=%H%x09%h%x09%ad%x09%s',
    '--date=short',
    '--',
    file,
  ], true);

  if (!out || !out.trim()) return [];

  const lines = out.trim().split('\n').slice(0, 40);
  const candidates = [];

  for (const line of lines) {
    const [hash, short, date, ...subjectParts] = line.split('\t');
    const subject = subjectParts.join('\t');
    let src = '';
    let analysis = null;

    try {
      src = runGit(['show', hash + ':' + file], false);
      analysis = analyzeSource(src);
    } catch (_) {
      analysis = { score: -999, error: 'git show failed' };
    }

    candidates.push({ hash, short, date, subject, analysis });
  }

  return candidates;
}

function printCandidates(cands) {
  console.log('');
  console.log('=== git candidates for citizen restore ===');
  if (!cands.length) {
    console.log('(no git candidates found)');
    return;
  }

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const a = c.analysis || {};
    const flags = [
      a.hasMineflayer ? 'mineflayer' : null,
      a.hasCreateExport ? 'export' : null,
      a.hasLiveLoop ? 'liveLoop' : null,
      a.hasV32 ? 'V32_BAD' : null,
      a.hasV34 ? 'V34' : null,
    ].filter(Boolean).join(',');

    console.log(
      String(i + 1).padStart(2, ' ') +
      '  ' +
      c.short +
      '  ' +
      c.date +
      '  score=' +
      String(a.score).padStart(4, ' ') +
      '  [' +
      flags +
      ']  ' +
      c.subject
    );
  }

  console.log('');
  console.log('복구는 자동으로 하지 않습니다.');
  console.log('원하는 커밋을 고른 뒤:');
  console.log('  node repair_adam_v34_git_safe.cjs --restore-git <HASH> citizen.cjs');
  console.log('');
}

function backupCurrent(file) {
  if (!fs.existsSync(file)) return null;
  ensureDir('backups');
  const dst = path.join(
    'backups',
    path.basename(file).replace(/\.cjs$/, '') + '.before-v34.' + nowStamp() + '.cjs'
  );
  fs.copyFileSync(file, dst);
  return dst;
}

const BRIDGE_CJS = String.raw`'use strict';

/**
 * Piano V3.4 bridge.
 *
 * Rules:
 * - Never reassign thinkAndAct/reactToChat.
 * - Never fall back to globalThis.self or globalThis.__ADAM_LAST_SELF__.
 * - Delete legacy globalThis.AdamPiano unless ADAM_ENABLE_LEGACY_GLOBAL=1.
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

function cleanupLegacyGlobal() {
  if (process.env.ADAM_ENABLE_LEGACY_GLOBAL === '1') return;
  try {
    delete globalThis.AdamPiano;
  } catch (_) {
    try { globalThis.AdamPiano = undefined; } catch (_) {}
  }
}

function inferSelfAndBot(result, args) {
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
    if (isBotLike(x) && !isObject(x.bot)) {
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
    if (x.bot || x.__pianoRuntime !== undefined || x.self === x) {
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

  return { self, bot };
}

function runtimeName(bot, self) {
  return (
    self && (self.name || self.username || self.id)
  ) || (
    bot && (bot.username || bot.name)
  ) || process.env.ADAMS_NAME || process.env.BOT_NAME || 'Adam';
}

function callInstall(piano, bot, self, source) {
  if (!piano || typeof piano.install !== 'function') {
    throw new Error('piano_v3/index.cjs does not export install()');
  }

  const name = runtimeName(bot, self);
  const before = (self && self.__pianoRuntime) || (bot && bot.__pianoRuntime);
  if (before) return before;

  const attempts = [
    () => piano.install({ bot, self, name, source }),
    () => piano.install(bot, self, { name, source }),
    () => piano.install(bot, self),
  ];

  let lastErr = null;

  for (const fn of attempts) {
    try {
      const rt = fn();
      const attached = (self && self.__pianoRuntime) || (bot && bot.__pianoRuntime);
      if (rt || attached) return rt || attached;
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

function attachPianoRuntime(input) {
  const result = input && input.result;
  const args = input && input.args;
  const piano = input && input.piano;
  const source = (input && input.source) || 'v34-bridge';
  const logger = (input && input.logger) || console;

  const found = inferSelfAndBot(result, args || []);
  const self = found.self;
  const bot = found.bot;

  if (!self && !bot) {
    if (logger && logger.warn) {
      logger.warn('[PIANO V3.4] runtime attach skipped: cannot infer self/bot without global fallback');
    }
    cleanupLegacyGlobal();
    return null;
  }

  const existing = (self && self.__pianoRuntime) || (bot && bot.__pianoRuntime);
  if (existing) {
    cleanupLegacyGlobal();
    return existing;
  }

  let rt = null;

  try {
    rt = callInstall(piano || require('./index.cjs'), bot, self, source);
  } finally {
    cleanupLegacyGlobal();
  }

  if (!rt) {
    if (logger && logger.warn) {
      logger.warn('[PIANO V3.4] runtime attach returned no runtime');
    }
    return null;
  }

  try {
    if (self && !self.__pianoRuntime) {
      Object.defineProperty(self, '__pianoRuntime', {
        value: rt,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  } catch (_) {
    if (self) self.__pianoRuntime = rt;
  }

  try {
    if (bot && !bot.__pianoRuntime) {
      Object.defineProperty(bot, '__pianoRuntime', {
        value: rt,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  } catch (_) {
    if (bot) bot.__pianoRuntime = rt;
  }

  if (logger && logger.log) {
    logger.log('[PIANO V3.4] runtime attached: ' + runtimeName(bot, self) + ' via ' + source);
  }

  cleanupLegacyGlobal();
  return rt;
}

function wrapCreateCitizenExport(original, options) {
  if (typeof original !== 'function') {
    throw new TypeError('createCitizen export is not a function');
  }

  if (original.__pianoV34Wrapped) return original;

  const opts = options || {};

  function wrappedCreateCitizenV34() {
    const args = Array.from(arguments);
    const out = original.apply(this, args);

    const attach = (result) => {
      attachPianoRuntime({
        result,
        args,
        piano: opts.piano,
        source: opts.source || 'createCitizen-export-v34',
        logger: opts.logger || console,
      });
      return result;
    };

    if (out && typeof out.then === 'function') {
      return out.then(attach);
    }

    return attach(out);
  }

  Object.defineProperty(wrappedCreateCitizenV34, '__pianoV34Wrapped', {
    value: true,
    enumerable: false,
  });

  return wrappedCreateCitizenV34;
}

module.exports = {
  cleanupLegacyGlobal,
  inferSelfAndBot,
  attachPianoRuntime,
  wrapCreateCitizenExport,
};
`;

const BRIDGE_TEST_CJS = String.raw`'use strict';

const assert = require('assert');
const {
  inferSelfAndBot,
  wrapCreateCitizenExport,
  cleanupLegacyGlobal,
} = require('../bridge.cjs');

let installCount = 0;
const mockPiano = {
  install(input) {
    installCount++;
    const bot = input.bot;
    const self = input.self;
    const rt = {
      name: input.name,
      bot,
      self,
      source: input.source,
      tickCalls: [],
      tick(reason) { this.tickCalls.push(reason); },
    };
    return rt;
  },
};

(function testInferNoGlobalFallback() {
  const bad = { name: 'BAD', bot: { username: 'BADBOT', emit() {} } };
  globalThis.__ADAM_LAST_SELF__ = bad;

  const bot = { username: 'A', emit() {}, once() {} };
  const self = { name: 'A', bot };

  const found = inferSelfAndBot(self, []);
  assert.strictEqual(found.self, self);
  assert.strictEqual(found.bot, bot);
  assert.strictEqual(bad.__pianoRuntime, undefined);
})();

(function testWrapSyncMultiBot() {
  installCount = 0;

  const botA = { username: 'A', emit() {}, once() {} };
  const botB = { username: 'B', emit() {}, once() {} };
  const selfA = { name: 'A', bot: botA };
  const selfB = { name: 'B', bot: botB };

  const wrappedA = wrapCreateCitizenExport(() => selfA, { piano: mockPiano, source: 'testA' });
  const wrappedB = wrapCreateCitizenExport(() => selfB, { piano: mockPiano, source: 'testB' });

  const outA = wrappedA();
  const outB = wrappedB();

  assert.strictEqual(outA, selfA);
  assert.strictEqual(outB, selfB);
  assert.ok(selfA.__pianoRuntime);
  assert.ok(selfB.__pianoRuntime);
  assert.notStrictEqual(selfA.__pianoRuntime, selfB.__pianoRuntime);
  assert.strictEqual(botA.__pianoRuntime, selfA.__pianoRuntime);
  assert.strictEqual(botB.__pianoRuntime, selfB.__pianoRuntime);
  assert.strictEqual(installCount, 2);
})();

(async function testWrapAsync() {
  const bot = { username: 'ASYNC', emit() {}, once() {} };
  const self = { name: 'ASYNC', bot };

  const wrapped = wrapCreateCitizenExport(async () => self, { piano: mockPiano, source: 'asyncTest' });
  const out = await wrapped();

  assert.strictEqual(out, self);
  assert.ok(self.__pianoRuntime);
})().then(() => {
  globalThis.AdamPiano = { legacy: true };
  process.env.ADAM_ENABLE_LEGACY_GLOBAL = '0';
  cleanupLegacyGlobal();
  assert.strictEqual(globalThis.AdamPiano, undefined);

  console.log('bridge tests passed');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
`;

const PRESSURE_TEST_CJS = String.raw`'use strict';

const assert = require('assert');
const mod = require('../pressure.cjs');

assert.strictEqual(typeof mod.computePressures, 'function', 'pressure.cjs must export computePressures');

const input = {
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
};

const config = {
  pressure: {
    coefficients: {},
  },
};

const out = mod.computePressures(input, config);

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

const INIT_CONFIG_CJS = String.raw`#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const name = process.argv[2] || 'Adam';
const overwrite = process.argv.includes('--overwrite');
const file = path.resolve(process.cwd(), 'piano_config_' + name + '.json');

let cfg = null;

try {
  const c = require('./config.cjs');
  if (typeof c.defaultConfig === 'function') {
    try {
      cfg = c.defaultConfig(name);
    } catch (_) {
      cfg = c.defaultConfig();
    }
  }
} catch (_) {}

if (!cfg || typeof cfg !== 'object') {
  cfg = {
    version: 3,
    botName: name,
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
      normalIntervalMs: 35000,
      lowPressureIntervalMs: 80000,
      highPressureIntervalMs: 12000,
      maxPromptChars: 5200,
      maxTokens: 420,
      apiRetries: 2
    }
  };
}

if (fs.existsSync(file) && !overwrite) {
  console.log(file + ' already exists. Use --overwrite to replace.');
  process.exit(0);
}

fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
console.log('created ' + file);
`;

function ensureSupportFiles(report) {
  ensureDir('piano_v3');
  ensureDir('piano_v3/tests');
  ensureDir('logs');

  report.files = report.files || {};

  report.files.bridge = writeIfChanged('piano_v3/bridge.cjs', BRIDGE_CJS);
  report.files.bridgeTest = writeIfChanged('piano_v3/tests/bridge_test.cjs', BRIDGE_TEST_CJS);

  if (!fs.existsSync('piano_v3/tests/pressure_test.cjs')) {
    report.files.pressureTest = writeIfChanged('piano_v3/tests/pressure_test.cjs', PRESSURE_TEST_CJS);
  } else {
    report.files.pressureTest = false;
  }

  if (!fs.existsSync('piano_v3/init-config.cjs')) {
    report.files.initConfig = writeIfChanged('piano_v3/init-config.cjs', INIT_CONFIG_CJS);
  } else {
    report.files.initConfig = false;
  }

  ensurePackageScripts(report);
  ensureIndexLegacyGlobalGuard(report);
}

function ensurePackageScripts(report) {
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

  report.files.packageJson = writeIfChanged(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}

function ensureIndexLegacyGlobalGuard(report) {
  const file = 'piano_v3/index.cjs';

  if (!fs.existsSync(file)) {
    report.warnings.push('piano_v3/index.cjs missing; cannot install legacy-global guard');
    return;
  }

  let src = read(file);

  const legacyAssignments = (src.match(/globalThis\.AdamPiano\s*=/g) || []).length;
  const hasV32Index = /__PIANO_V32_INSTALL_WRAPPER__|pianoV32/.test(src);

  report.index = {
    legacyAdamPianoAssignments: legacyAssignments,
    hasV32Markers: hasV32Index,
    guardInstalled: src.includes(INDEX_GUARD_MARK),
  };

  if (hasV32Index) {
    report.warnings.push(
      'piano_v3/index.cjs still has V3.2 markers. V3.4 will not cut IIFE blocks automatically; restore index.cjs from git if you want full cleanup.'
    );
  }

  if (src.includes(INDEX_GUARD_MARK)) return;

  const guard = `

/* ${INDEX_GUARD_MARK} */
;(() => {
  function __pianoV34DeleteLegacyGlobal() {
    if (process.env.ADAM_ENABLE_LEGACY_GLOBAL === '1') return;
    try {
      delete globalThis.AdamPiano;
    } catch (_) {
      try { globalThis.AdamPiano = undefined; } catch (_) {}
    }
  }

  try {
    const __origInstall = module.exports && module.exports.install;
    if (typeof __origInstall === 'function' && !__origInstall.__pianoV34GlobalGuarded) {
      const __wrappedInstall = function pianoV34InstallGlobalGuard() {
        const rt = __origInstall.apply(this, arguments);
        __pianoV34DeleteLegacyGlobal();
        return rt;
      };

      Object.defineProperty(__wrappedInstall, '__pianoV34GlobalGuarded', {
        value: true,
        enumerable: false,
      });

      module.exports.install = __wrappedInstall;
    }

    __pianoV34DeleteLegacyGlobal();
  } catch (e) {
    console.warn('[PIANO V3.4] legacy global guard failed:', e && e.message ? e.message : e);
  }
})();
`;

  src += guard;
  writeIfChanged(file, src);
  report.index.guardInstalled = true;
}

function requireAcorn() {
  try {
    return require('acorn');
  } catch (_) {
    console.error('');
    console.error('acorn is missing. Run:');
    console.error('  npm i -D acorn');
    console.error('');
    process.exit(1);
  }
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
  if (!node || node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property && node.property.type === 'Identifier') {
    return node.property.name;
  }
  if (node.computed && node.property && node.property.type === 'Literal') {
    return String(node.property.value);
  }
  return null;
}

function isIdent(node, name) {
  return node && node.type === 'Identifier' && node.name === name;
}

function isModuleExports(node) {
  return (
    node &&
    node.type === 'MemberExpression' &&
    propName(node) === 'exports' &&
    isIdent(node.object, 'module')
  );
}

function isCreateCitizenExportLeft(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (propName(node) !== 'createCitizen') return false;

  if (isModuleExports(node.object)) return true;
  if (isIdent(node.object, 'exports')) return true;

  return false;
}

function leftName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return propName(node);
  return null;
}

function parseSource(src) {
  const acorn = requireAcorn();
  return acorn.parse(src, {
    ecmaVersion: 2024,
    sourceType: 'script',
    ranges: true,
    allowHashBang: true,
  });
}

function findCreateCitizenExport(ast) {
  let found = null;

  walk(ast, (node) => {
    if (found) return;
    if (
      node.type === 'AssignmentExpression' &&
      isCreateCitizenExportLeft(node.left)
    ) {
      found = node;
    }
  });

  return found;
}

function findLiveLoopFunction(ast) {
  let found = null;

  walk(ast, (node) => {
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
    }
  });

  return found;
}

function disableOldBlock() {
  return `/* ${DISABLE_MARK} */
globalThis.__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V33__ = true;
globalThis.__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V34__ = true;
if (process.env.ADAM_ENABLE_LEGACY_GLOBAL !== '1') {
  try { delete globalThis.AdamPiano; } catch (_) { try { globalThis.AdamPiano = undefined; } catch (_) {} }
}

`;
}

function exportBridgeBlock() {
  return `

/* ${EXPORT_MARK} */
;(() => {
  try {
    const { wrapCreateCitizenExport } = require('./piano_v3/bridge.cjs');
    const piano = require('./piano_v3/index.cjs');

    if (module.exports && typeof module.exports.createCitizen === 'function') {
      module.exports.createCitizen = wrapCreateCitizenExport(module.exports.createCitizen, {
        piano,
        source: 'citizen-export-v34',
        logger: console,
      });
      console.log('[PIANO V3.4] createCitizen export bridge installed');
    } else {
      console.warn('[PIANO V3.4] module.exports.createCitizen not found at bridge install time');
    }

    if (process.env.ADAM_ENABLE_LEGACY_GLOBAL !== '1') {
      try { delete globalThis.AdamPiano; } catch (_) { try { globalThis.AdamPiano = undefined; } catch (_) {} }
    }
  } catch (e) {
    console.error('[PIANO V3.4] createCitizen export bridge failed:', e && e.stack ? e.stack : e);
  }
})();
`;
}

function liveLoopHookBlock() {
  return `
  /* ${LIVE_MARK} */
  try {
    const __pianoRt =
      ((typeof self !== 'undefined' && self && self.__pianoRuntime) ? self.__pianoRuntime : null) ||
      ((typeof bot !== 'undefined' && bot && bot.__pianoRuntime) ? bot.__pianoRuntime : null);

    if (__pianoRt && typeof __pianoRt.tick === 'function') {
      const __pianoTick = Promise.resolve(__pianoRt.tick('liveLoop_hook')).catch((e) => {
        console.warn('[PIANO V3.4] liveLoop tick failed:', e && e.message ? e.message : e);
      });

      if (process.env.ADAM_PIANO_LIVELOOP_MODE === 'replace') {
        return __pianoTick;
      }
    }
  } catch (e) {
    console.warn('[PIANO V3.4] liveLoop hook skipped:', e && e.message ? e.message : e);
  }
`;
}

function patchCitizen(file, report) {
  if (!fs.existsSync(file)) {
    throw new Error(file + ' not found');
  }

  const src0 = read(file);
  const analysis = analyzeSource(src0);
  report.citizenBefore = analysis;

  if (analysis.hasV32) {
    throw new Error(
      'citizen.cjs still contains V3.2 bridge markers. Restore a clean git commit first. ' +
      'Run: node repair_adam_v34_git_safe.cjs --list-git citizen.cjs'
    );
  }

  const ast = parseSource(src0);
  const createExport = findCreateCitizenExport(ast);
  if (!createExport) {
    throw new Error('AST anchor not found: module.exports.createCitizen assignment');
  }

  const liveLoop = findLiveLoopFunction(ast);

  const insertions = [];
  const alreadyExportBridge = src0.includes(EXPORT_MARK);
  const alreadyLiveHook = src0.includes(LIVE_MARK);
  const alreadyDisable = src0.includes(DISABLE_MARK);

  if (!alreadyDisable) {
    const shebangPos = src0.startsWith('#!') ? src0.indexOf('\n') + 1 : 0;
    insertions.push({ pos: shebangPos, text: disableOldBlock() });
  }

  if (!alreadyExportBridge) {
    insertions.push({ pos: src0.length, text: exportBridgeBlock() });
  }

  let liveLoopFound = !!liveLoop;
  let liveLoopHooked = alreadyLiveHook;

  if (!alreadyLiveHook && liveLoop && liveLoop.body && typeof liveLoop.body.start === 'number') {
    insertions.push({ pos: liveLoop.body.start + 1, text: liveLoopHookBlock() });
    liveLoopHooked = true;
  }

  if (!liveLoopFound) {
    report.warnings.push(
      'liveLoop function not found. Runtime scheduler may still pulse, but liveLoop/chat trigger is not connected.'
    );
  }

  insertions.sort((a, b) => b.pos - a.pos);

  let out = src0;
  for (const ins of insertions) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }

  writeIfChanged(file, out);

  report.patch = {
    createCitizenExportFound: true,
    exportBridgeInstalled: true,
    liveLoopFound,
    liveLoopHooked,
    alreadyExportBridge,
    alreadyLiveHook,
    alreadyDisable,
  };

  report.citizenAfter = analyzeSource(out);

  return report.patch;
}

function nodeCheck(file) {
  if (!fs.existsSync(file)) {
    return { file, ok: false, output: 'missing' };
  }

  const r = cp.spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    file,
    ok: r.status === 0,
    output: (r.stderr || r.stdout || '').trim(),
  };
}

function printSummary(report) {
  console.log('');
  console.log('=== PIANO V3.4 REPAIR SUMMARY ===');
  console.log('target:', report.target);
  console.log('git repo:', report.git.isRepo ? 'yes' : 'no');
  console.log('git head:', report.git.head || '(none)');
  console.log('git dirty:', report.git.dirty ? 'yes' : 'no');
  console.log('backup:', report.backup || '(none)');
  console.log('restore:', report.restore ? JSON.stringify(report.restore) : 'none');

  if (report.patch) {
    console.log('createCitizen export:', report.patch.createCitizenExportFound ? 'OK' : 'NO');
    console.log('export bridge:', report.patch.exportBridgeInstalled ? 'OK' : 'NO');
    console.log('liveLoop found:', report.patch.liveLoopFound ? 'YES' : 'NO');
    console.log('liveLoop hooked:', report.patch.liveLoopHooked ? 'YES' : 'NO');
  }

  if (report.index) {
    console.log('index AdamPiano assignments:', report.index.legacyAdamPianoAssignments);
    console.log('index V3.2 markers:', report.index.hasV32Markers ? 'YES' : 'NO');
    console.log('index global guard:', report.index.guardInstalled ? 'YES' : 'NO');
  }

  if (report.checks) {
    console.log('');
    console.log('syntax checks:');
    for (const c of report.checks) {
      console.log('  ' + (c.ok ? 'OK ' : 'BAD') + ' ' + c.file);
      if (!c.ok && c.output) console.log(c.output);
    }
  }

  if (report.warnings && report.warnings.length) {
    console.log('');
    console.log('warnings:');
    for (const w of report.warnings) console.log('  - ' + w);
  }

  console.log('');
  console.log('report: piano_v34_report.json');
  console.log('');
}

function main() {
  const report = {
    timestamp: new Date().toISOString(),
    target,
    git: {
      isRepo: isGitRepo(),
      head: null,
      dirty: '',
    },
    warnings: [],
  };

  if (report.git.isRepo) {
    report.git.head = gitHead();
    report.git.dirty = gitDirty();
  }

  if (opts.listGit) {
    printCandidates(listGitCandidates(target));
    return;
  }

  ensureDir('backups');
  ensureDir('logs');

  if (fs.existsSync(target)) {
    report.backup = backupCurrent(target);
  }

  if (opts.restoreGit) {
    if (!report.git.isRepo) {
      throw new Error('--restore-git requires a git repository');
    }

    const restored = runGit(['show', opts.restoreGit + ':' + target], false);
    fs.writeFileSync(target, restored);
    report.restore = { mode: 'git', commit: opts.restoreGit };
  } else if (opts.restoreFile) {
    if (!fs.existsSync(opts.restoreFile)) {
      throw new Error('--restore-file not found: ' + opts.restoreFile);
    }

    fs.copyFileSync(opts.restoreFile, target);
    report.restore = { mode: 'file', file: opts.restoreFile };
  } else {
    if (!fs.existsSync(target)) {
      throw new Error(target + ' not found');
    }

    const cur = read(target);
    const a = analyzeSource(cur);

    if ((a.hasV32 || !a.hasCreateExport) && !opts.patchCurrent) {
      printCandidates(listGitCandidates(target));
      throw new Error(
        'current citizen.cjs looks unsafe to patch directly. ' +
        'Choose a clean commit and rerun with --restore-git <HASH>, ' +
        'or pass --patch-current only if you intentionally want to patch current file.'
      );
    }
  }

  ensureSupportFiles(report);

  const patch = patchCitizen(target, report);

  report.checks = [
    nodeCheck(target),
    nodeCheck('piano_v3/index.cjs'),
    nodeCheck('piano_v3/bridge.cjs'),
    nodeCheck('piano_v3/init-config.cjs'),
    nodeCheck('piano_v3/tests/pressure_test.cjs'),
    nodeCheck('piano_v3/tests/bridge_test.cjs'),
  ];

  writeIfChanged('piano_v34_report.json', JSON.stringify(report, null, 2) + '\n');
  printSummary(report);

  const failedCheck = report.checks.find((c) => !c.ok);
  if (failedCheck) {
    console.error('Syntax check failed. Fix the file above before running index.cjs.');
    process.exit(1);
  }

  if (!patch.liveLoopHooked && !opts.allowUnpatchedLiveLoop) {
    console.error('');
    console.error('ERROR: liveLoop was not hooked.');
    console.error('PIANO scheduler may still run, but liveLoop/chat trigger is not connected.');
    console.error('If this is intentional, rerun with:');
    console.error('  --allow-unpatched-liveLoop');
    console.error('');
    process.exit(2);
  }

  console.log('Repair complete.');
  console.log('');
  console.log('Next:');
  console.log('  npm run test:piano');
  console.log('  node index.cjs');
}

try {
  main();
} catch (e) {
  console.error('');
  console.error('V3.4 repair failed:');
  console.error(e && e.stack ? e.stack : e);
  console.error('');
  process.exit(1);
}
