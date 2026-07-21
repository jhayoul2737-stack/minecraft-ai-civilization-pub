'use strict';

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
