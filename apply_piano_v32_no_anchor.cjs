const fs = require('fs');
const path = require('path');

const target = process.argv[2] || 'citizen.cjs';

if (!fs.existsSync(target)) {
  console.error('File not found:', target);
  process.exit(1);
}

if (!fs.existsSync('piano_v3/index.cjs')) {
  console.error('piano_v3/index.cjs not found. Apply Piano V3 first.');
  process.exit(1);
}

fs.mkdirSync('backups', { recursive: true });
fs.mkdirSync('piano_v3/tests', { recursive: true });
fs.mkdirSync('logs', { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join('backups', path.basename(target) + '.bak-piano-v32-no-anchor-' + stamp);
fs.copyFileSync(target, backup);

function ensurePackageScript() {
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
}

function ensureInitConfig() {
  const file = 'piano_v3/init-config.cjs';

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `#!/usr/bin/env node
const { initConfig, defaultConfig } = require('./config.cjs');
const fs = require('fs');

const name = String(process.argv[2] || 'Adam').replace(/[^\\w.-]/g, '_');
const overwrite = process.argv.includes('--overwrite');
const file = 'piano_config_' + name + '.json';

if (typeof initConfig === 'function') {
  const result = initConfig(file, { overwrite });
  console.log(result.created ? 'created ' + file : 'exists ' + file + ' (use --overwrite to replace)');
} else {
  if (fs.existsSync(file) && !overwrite) {
    console.log('exists ' + file + ' (use --overwrite to replace)');
  } else {
    fs.writeFileSync(file, JSON.stringify(defaultConfig(), null, 2));
    console.log('created ' + file);
  }
}
`);
  }

  // config.cjs가 initConfig를 export하지 않는 오래된 버전이면 보강.
  const cfgFile = 'piano_v3/config.cjs';
  if (fs.existsSync(cfgFile)) {
    let cfg = fs.readFileSync(cfgFile, 'utf8');

    if (!cfg.includes('initConfig')) {
      cfg += `

/* __PIANO_V32_INIT_CONFIG_EXPORT__ */
function initConfig(file, options = {}) {
  const overwrite = !!options.overwrite;
  const cfg = defaultConfig();

  if (fs.existsSync(file) && !overwrite) {
    return { created: false, file };
  }

  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return { created: true, file };
}

module.exports.initConfig = initConfig;
`;
      fs.writeFileSync(cfgFile, cfg);
    }
  }
}

function ensurePressureTest() {
  const file = 'piano_v3/tests/pressure_test.cjs';

  if (fs.existsSync(file)) return;

  fs.writeFileSync(file, `const assert = require('assert');
const { computePressures } = require('../pressure.cjs');
const { defaultConfig } = require('../config.cjs');

const cfg = defaultConfig();

const safe = computePressures({
  health: 20,
  food: 20,
  queueLen: 1,
  failRatio: 0,
  recentSocial: 0,
  recentObservation: 0,
  recentSurprise: 0,
  idleMs: 0,
  shortages: [],
  personality: { diligence: 8, pragmatism: 8, curiosity: 4 }
}, cfg);

assert(safe.survival < 0.1, 'safe survival should be low');
assert(safe.queue > 0.4, 'queued diligent agent should value queue');

const danger = computePressures({
  health: 5,
  food: 5,
  closeHostileDistance: 3,
  queueLen: 1,
  failRatio: 0,
  recentSocial: 0,
  recentObservation: 0,
  recentSurprise: 0,
  idleMs: 0,
  shortages: ['food'],
  personality: { diligence: 8, pragmatism: 8, curiosity: 4 }
}, cfg);

assert(danger.survival > 0.7, 'danger survival should be high');
assert(danger.queue < safe.queue, 'danger should reduce queue pressure');

console.log('pressure tests passed');
`);
}

function patchPianoIndex() {
  const file = 'piano_v3/index.cjs';
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes('__PIANO_V32_INSTALL_WRAPPER__')) return;

  src += `

/* __PIANO_V32_INSTALL_WRAPPER__ */
(function pianoV32InstallWrapper() {
  if (module.exports.__pianoV32Wrapped) return;
  module.exports.__pianoV32Wrapped = true;

  const originalInstall = module.exports.install;
  const runtimes = module.exports.runtimes;

  if (typeof originalInstall !== 'function') {
    console.warn('⚠️ [PIANO V3.2] module.exports.install missing');
    return;
  }

  module.exports.install = function pianoV32Install(opts = {}) {
    const rt = originalInstall(opts);

    try {
      if (opts.bot) opts.bot.__pianoRuntime = rt;
      if (opts.self) opts.self.__pianoRuntime = rt;
    } catch {}

    const manager = {
      version: '3.2.0',
      runtimes,

      names() {
        return runtimes && typeof runtimes.keys === 'function'
          ? Array.from(runtimes.keys())
          : [];
      },

      runtime(name) {
        if (!runtimes) return null;
        if (!name && runtimes.size === 1) return Array.from(runtimes.values())[0];
        return runtimes.get(name) || null;
      },

      state(name) {
        if (!runtimes) return null;

        if (!name && runtimes.size !== 1) {
          return {
            error: 'runtime name required when multiple runtimes exist',
            names: Array.from(runtimes.keys())
          };
        }

        const rt = !name && runtimes.size === 1
          ? Array.from(runtimes.values())[0]
          : runtimes.get(name);

        return rt ? rt.state : null;
      },

      async tick(arg1, arg2, arg3) {
        if (!runtimes) throw new Error('runtimes unavailable');

        // tick(bot, self, reason)
        if (arg1 && arg1.entity) {
          const bot = arg1;
          const self = arg2;
          const name = String((self && self.name) || bot.username || 'Adam').replace(/[^\\w.-]/g, '_');
          const rt = runtimes.get(name) || bot.__pianoRuntime || (self && self.__pianoRuntime);
          if (!rt) throw new Error('Piano runtime not found for bot');
          return await rt.tick(arg3 || 'manual');
        }

        // tick('Adam', reason)
        if (typeof arg1 === 'string' && runtimes.has(arg1)) {
          return await runtimes.get(arg1).tick(arg2 || 'manual');
        }

        // tick(reason) only if exactly one runtime
        if (runtimes.size === 1) {
          return await Array.from(runtimes.values())[0].tick(arg1 || 'manual');
        }

        throw new Error('AdamPianoV3.tick requires bot/self or runtime name when multiple runtimes exist');
      }
    };

    globalThis.AdamPianoV3 = manager;

    // cost optimizer 호환성 때문에 AdamPiano는 유지하되, 멀티봇에서는 애매하면 에러/상태객체 반환.
    globalThis.AdamPiano = {
      state(name) {
        return manager.state(name);
      },
      async tick(nameOrReason, maybeReason) {
        return await manager.tick(nameOrReason, maybeReason);
      }
    };

    return rt;
  };
})();
`;

  fs.writeFileSync(file, src);
}

// 먼저 script/test부터 보장. target patch가 실패해도 npm run test:piano는 생겨야 함.
ensurePackageScript();
ensureInitConfig();
ensurePressureTest();
patchPianoIndex();

let src = fs.readFileSync(target, 'utf8');

// 파일 끝에 설명문 붙은 경우 제거.
const proseMarker = '\n4. 자유도를 높이는 명령';
const proseIdx = src.indexOf(proseMarker);
if (proseIdx !== -1) {
  src = src.slice(0, proseIdx).trimEnd() + '\n';
}

// Agency V1 / Piano V2는 파일 로드 초기에 비활성화.
// append가 아니라 top에 넣어야 IIFE 실행 전에 막힘.
if (!src.includes('__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V32__')) {
  src = `/* __ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V32__ */
globalThis.__ADAM_AGENCY_CORE_V1_INSTALLED__ = true;
globalThis.__ADAM_PIANO_CORE_V2_INSTALLED__ = true;

` + src;
}

// createCitizen 함수 선언을 찾지 않는다.
// module.exports.createCitizen를 감싸는 방식이라 원본 함수 형태가 바뀌어도 export만 있으면 됨.
if (!src.includes('__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__')) {
  src += `

/* __ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__ */
(function adamPianoV32NoAnchorBridge() {
  if (globalThis.__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE_INSTALLED__) return;
  globalThis.__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE_INSTALLED__ = true;

  function getDeps() {
    return {
      openai: (typeof openai !== 'undefined') ? openai : null,

      getDetailedInventory: (typeof getDetailedInventory !== 'undefined') ? getDetailedInventory : null,
      getEnvironmentReport: (typeof getEnvironmentReport !== 'undefined') ? getEnvironmentReport : null,
      retrieveMemories: (typeof retrieveMemories !== 'undefined') ? retrieveMemories : null,
      addMemory: (typeof addMemory !== 'undefined') ? addMemory : null,
      sanitize: (typeof sanitize !== 'undefined') ? sanitize : null,

      loadPersonalityV2: (typeof loadPersonalityV2 !== 'undefined') ? loadPersonalityV2 : null,
      scanCurrentPossibilities: (typeof scanCurrentPossibilities !== 'undefined') ? scanCurrentPossibilities : null,
      scanFutureAffordances: (typeof scanFutureAffordances !== 'undefined') ? scanFutureAffordances : null,
      looksLikeFailure: (typeof looksLikeFailure !== 'undefined') ? looksLikeFailure : null,

      getBuiltinActions: function () {
        return (typeof BUILTIN_ACTIONS !== 'undefined' && Array.isArray(BUILTIN_ACTIONS))
          ? BUILTIN_ACTIONS
          : [];
      },

      performBuiltinAction: async function (botArg, selfArg, action, target, label) {
        const fn = (typeof performBuiltinAction !== 'undefined') ? performBuiltinAction : null;
        if (typeof fn !== 'function') return 'performBuiltinAction missing';
        return await fn(botArg, selfArg, action, target, label);
      },

      executeDecision: async function (botArg, selfArg, item) {
        const fn = (typeof executeDecision !== 'undefined') ? executeDecision : null;
        if (typeof fn !== 'function') return 'executeDecision missing';
        return await fn(botArg, selfArg, item);
      },

      executeAction: async function (botArg, selfArg, item) {
        if (typeof executeWithAwareness === 'function') {
          return await executeWithAwareness(botArg, selfArg, item);
        }
        if (typeof executeDecision === 'function') {
          return await executeDecision(botArg, selfArg, item);
        }
        if (typeof performBuiltinAction === 'function') {
          return await performBuiltinAction(botArg, selfArg, item.action, item.target, item.label);
        }
        return 'no executor available';
      }
    };
  }

  function findSelf(bot, opts) {
    try {
      const name = (opts && opts.name) || (bot && bot.username) || 'Adam';

      if (
        globalThis.__ADAM_CITIZENS__ &&
        globalThis.__ADAM_CITIZENS__[name] &&
        globalThis.__ADAM_CITIZENS__[name].self
      ) {
        return globalThis.__ADAM_CITIZENS__[name].self;
      }
    } catch {}

    return globalThis.__ADAM_LAST_SELF__ || globalThis.self || null;
  }

  function attachPianoRuntime(bot, opts, reason) {
    if (!bot) return null;

    const self = findSelf(bot, opts);
    if (!self) return null;

    if (self.__pianoRuntime && bot.__pianoRuntime) {
      return self.__pianoRuntime;
    }

    try {
      const rt = require('./piano_v3').install({
        bot,
        self,
        deps: getDeps()
      });

      self.__pianoRuntime = rt;
      bot.__pianoRuntime = rt;

      console.log('🎼 [PIANO V3.2] runtime attached via no-anchor bridge:', reason || 'unknown');
      return rt;
    } catch (e) {
      console.error('❌ [PIANO V3.2] attach failed:', e && e.stack ? e.stack : e);
      return null;
    }
  }

  function scheduleAttach(bot, opts, reason) {
    let tries = 0;

    function attempt() {
      tries += 1;
      const rt = attachPianoRuntime(bot, opts, reason + '/try' + tries);
      if (rt) return;

      if (tries < 30) {
        setTimeout(attempt, 500);
      } else {
        console.warn('⚠️ [PIANO V3.2] runtime attach gave up after 30 tries');
      }
    }

    setTimeout(attempt, 0);
  }

  if (
    module.exports &&
    typeof module.exports.createCitizen === 'function' &&
    !module.exports.createCitizen.__pianoV32Wrapped
  ) {
    const originalCreateCitizen = module.exports.createCitizen;

    const wrappedCreateCitizen = function pianoV32CreateCitizenWrapper(opts) {
      const bot = originalCreateCitizen.apply(this, arguments);
      scheduleAttach(bot, opts || {}, 'createCitizen-export-wrapper');
      return bot;
    };

    wrappedCreateCitizen.__pianoV32Wrapped = true;
    module.exports.createCitizen = wrappedCreateCitizen;

    console.log('🎼 [PIANO V3.2] module.exports.createCitizen wrapper installed');
  } else {
    console.warn('⚠️ [PIANO V3.2] module.exports.createCitizen not found. Export keys:', Object.keys(module.exports || {}));
  }

  if (typeof thinkAndAct === 'function' && !thinkAndAct.__pianoV32Bridge) {
    const oldThinkAndAct = thinkAndAct;

    thinkAndAct = async function pianoV32ThinkBridge(botArg, selfArg) {
      const rt =
        (selfArg && selfArg.__pianoRuntime) ||
        (botArg && botArg.__pianoRuntime) ||
        attachPianoRuntime(botArg, { name: selfArg && selfArg.name }, 'thinkAndAct-bridge');

      if (rt && typeof rt.tick === 'function') {
        return await rt.tick('thinkAndAct_bridge');
      }

      return await oldThinkAndAct.apply(this, arguments);
    };

    thinkAndAct.__pianoV32Bridge = true;
    console.log('🎼 [PIANO V3.2] thinkAndAct bridge installed');
  }

  if (typeof reactToChat === 'function' && !reactToChat.__pianoV32Bridge) {
    const oldReactToChat = reactToChat;

    reactToChat = async function pianoV32ReactBridge(botArg, selfArg) {
      const rt =
        (selfArg && selfArg.__pianoRuntime) ||
        (botArg && botArg.__pianoRuntime) ||
        attachPianoRuntime(botArg, { name: selfArg && selfArg.name }, 'reactToChat-bridge');

      if (rt && typeof rt.tick === 'function') {
        return await rt.tick('chat_or_social_bridge');
      }

      return await oldReactToChat.apply(this, arguments);
    };

    reactToChat.__pianoV32Bridge = true;
    console.log('🎼 [PIANO V3.2] reactToChat bridge installed');
  }
})();
`;
}

fs.writeFileSync(target, src);

console.log('Backup:', backup);
console.log('Patched target:', target);
console.log('Ensured package script: test:piano');
console.log('Ensured piano_v3/init-config.cjs');
console.log('Ensured piano_v3/tests/pressure_test.cjs');
console.log('Patched piano_v3/index.cjs with V3.2 install wrapper');
