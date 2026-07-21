const fs = require('fs');
const path = require('path');

let acorn = null;
try { acorn = require('acorn'); } catch {}

const TARGET = 'citizen.cjs';

fs.mkdirSync('backups', { recursive: true });
fs.mkdirSync('piano_v3/tests', { recursive: true });
fs.mkdirSync('logs', { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.writeFileSync(file, text);
}

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }

    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      collectFiles(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

function scoreCitizenFile(file) {
  let s = '';
  try { s = read(file); } catch { return null; }

  let score = 0;
  const reasons = [];

  if (/mineflayer\.createBot/.test(s)) {
    score += 120;
    reasons.push('mineflayer.createBot');
  }

  if (/function\s+createCitizen\b|createCitizen\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)|module\.exports\s*=\s*\{[^}]*createCitizen|module\.exports\.createCitizen\s*=\s*createCitizen/.test(s)) {
    score += 100;
    reasons.push('createCitizen');
  }

  if (/async\s+function\s+liveLoop\b|function\s+liveLoop\b|liveLoop\s*=/.test(s)) {
    score += 40;
    reasons.push('liveLoop');
  }

  if (/async\s+function\s+thinkAndAct\b|function\s+thinkAndAct\b|thinkAndAct\s*=/.test(s)) {
    score += 35;
    reasons.push('thinkAndAct');
  }

  if (/performBuiltinAction/.test(s)) {
    score += 25;
    reasons.push('performBuiltinAction');
  }

  if (/module\.exports/.test(s)) {
    score += 20;
    reasons.push('module.exports');
  }

  if (/__ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__/.test(s)) {
    score -= 80;
    reasons.push('has V3.2 bridge penalty');
  }

  if (!/mineflayer\.createBot/.test(s) && /__ADAM_PIANO|PIANO V3/.test(s)) {
    score -= 200;
    reasons.push('patch-only-looking penalty');
  }

  score += Math.min(30, Math.floor(s.length / 20000));

  return { file, score, size: s.length, reasons };
}

function ensurePackageScript() {
  let pkg = {};
  try {
    if (fs.existsSync('package.json')) pkg = JSON.parse(read('package.json'));
  } catch {}

  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:piano'] = 'node piano_v3/tests/pressure_test.cjs';

  if (!pkg.scripts.test || /no test specified/i.test(pkg.scripts.test)) {
    pkg.scripts.test = 'npm run test:piano';
  }

  write('package.json', JSON.stringify(pkg, null, 2));
}

function ensurePressureTest() {
  if (fs.existsSync('piano_v3/tests/pressure_test.cjs')) return;

  write('piano_v3/tests/pressure_test.cjs', `
const assert = require('assert');
const { computePressures } = require('../pressure.cjs');

let cfg = {};
try {
  const c = require('../config.cjs');
  cfg = typeof c.defaultConfig === 'function' ? c.defaultConfig() : {};
} catch {}

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

function ensureInitConfig() {
  if (!fs.existsSync('piano_v3/init-config.cjs')) {
    write('piano_v3/init-config.cjs', `#!/usr/bin/env node
const fs = require('fs');
const { defaultConfig } = require('./config.cjs');

const name = String(process.argv[2] || 'Adam').replace(/[^\\w.-]/g, '_');
const overwrite = process.argv.includes('--overwrite');
const file = 'piano_config_' + name + '.json';

if (fs.existsSync(file) && !overwrite) {
  console.log('exists ' + file + ' (use --overwrite to replace)');
} else {
  fs.writeFileSync(file, JSON.stringify(defaultConfig(), null, 2));
  console.log('created ' + file);
}
`);
  }
}

function sanitizePianoIndex() {
  const file = 'piano_v3/index.cjs';
  if (!fs.existsSync(file)) return;

  let s = read(file);
  let changed = false;

  // V3.2에서 append한 wrapper 제거. 이게 AdamPiano를 무조건 되살리던 문제.
  const marker = '/* __PIANO_V32_INSTALL_WRAPPER__ */';
  const idx = s.indexOf(marker);
  if (idx !== -1) {
    fs.copyFileSync(file, path.join('backups', 'piano_v3_index.cjs.bak-remove-v32-' + stamp));
    s = s.slice(0, idx).trimEnd() + '\n';
    changed = true;
  }

  // config 자동 생성 부수효과 줄이기.
  s = s.replace(
    /const config = loadConfig\(configFile\);/g,
    "const config = loadConfig(configFile, { createIfMissing: false });"
  );

  if (changed || !s.includes('{ createIfMissing: false }')) {
    write(file, s);
  }
}

function restoreCitizenIfNeeded() {
  const current = fs.existsSync(TARGET) ? scoreCitizenFile(TARGET) : null;
  const files = [
    ...collectFiles('backups'),
    ...fs.readdirSync('.').filter(f => /^citizen.*\.cjs/.test(f))
  ];

  const candidates = files
    .map(scoreCitizenFile)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  console.log('\nTop citizen candidates:');
  for (const c of candidates.slice(0, 8)) {
    console.log(`${c.score.toString().padStart(4)}  ${c.size.toString().padStart(8)}  ${c.file}  :: ${c.reasons.join(', ')}`);
  }

  const currentScore = current ? current.score : -999;
  const best = candidates[0];

  if (!best || best.score < 180) {
    console.error('\n정상 citizen 백업을 못 찾음.');
    console.error('필요 조건: mineflayer.createBot + createCitizen + module.exports 포함 백업.');
    process.exit(1);
  }

  if (currentScore < 180 || !current || best.file !== TARGET) {
    if (fs.existsSync(TARGET)) {
      fs.copyFileSync(TARGET, path.join('backups', 'citizen.cjs.corrupt-before-restore-' + stamp));
    }

    fs.copyFileSync(best.file, TARGET);
    console.log('\nRestored citizen.cjs from:', best.file);
  } else {
    console.log('\ncitizen.cjs already looks valid. No restore needed.');
  }
}

function removeBlockByMarker(src, marker) {
  const idx = src.indexOf(marker);
  if (idx === -1) return src;

  const end = src.indexOf('\n})();', idx);
  if (end === -1) {
    return src.slice(0, idx).trimEnd() + '\n';
  }

  return src.slice(0, idx).trimEnd() + '\n' + src.slice(end + '\n})();'.length);
}

function parse(src) {
  if (!acorn) return null;
  try {
    return acorn.parse(src, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: true,
      locations: true
    });
  } catch {
    return null;
  }
}

function walk(node, cb) {
  if (!node || typeof node.type !== 'string') return;
  cb(node);

  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const child of v) if (child && typeof child.type === 'string') walk(child, cb);
    } else if (v && typeof v.type === 'string') {
      walk(v, cb);
    }
  }
}

function patchLiveLoopRoute(src) {
  if (src.includes('__ADAM_PIANO_V33_LIVELOOP_ROUTE__')) return src;
  if (!acorn) {
    console.warn('acorn 없음: liveLoop AST route patch skip');
    return src;
  }

  const ast = parse(src);
  if (!ast) {
    console.warn('AST parse 실패: liveLoop route patch skip');
    return src;
  }

  let liveLoop = null;
  walk(ast, node => {
    if (liveLoop) return;
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === 'liveLoop') {
      liveLoop = node;
    }
  });

  if (!liveLoop) {
    console.warn('liveLoop 함수 못 찾음: scheduler runtime은 동작하지만 old think 루프가 남을 수 있음');
    return src;
  }

  let route = null;
  walk(liveLoop, node => {
    if (route) return;
    if (node.type !== 'IfStatement') return;

    const text = src.slice(node.start, node.end);
    if (
      text.includes('reactToChat') && text.includes('thinkAndAct') ||
      text.includes('AdamPianoV3.tick') ||
      text.includes('__pianoRuntime.tick')
    ) {
      route = node;
    }
  });

  if (!route) {
    console.warn('liveLoop 내부 route if 못 찾음: route patch skip');
    return src;
  }

  const replacement = `/* __ADAM_PIANO_V33_LIVELOOP_ROUTE__ */
      if (self.__pianoRuntime && typeof self.__pianoRuntime.tick === 'function') {
        await self.__pianoRuntime.tick(self.pendingChat.length > 0 ? 'chat_or_social' : 'life_loop');
      } else if (bot.__pianoRuntime && typeof bot.__pianoRuntime.tick === 'function') {
        await bot.__pianoRuntime.tick(self.pendingChat.length > 0 ? 'chat_or_social' : 'life_loop');
      } else if (self.pendingChat.length > 0) await reactToChat(bot, self);
      else await thinkAndAct(bot, self);`;

  return src.slice(0, route.start) + replacement + src.slice(route.end);
}

function patchCitizen() {
  let src = read(TARGET);

  src = removeBlockByMarker(src, '/* __ADAM_PIANO_V32_NO_ANCHOR_BRIDGE__ */');

  // 오래된 Agency/Piano V2 IIFE 실행 차단. 파일 최상단이어야 함.
  if (!src.includes('__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V33__')) {
    src = `/* __ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V33__ */
globalThis.__ADAM_AGENCY_CORE_V1_INSTALLED__ = true;
globalThis.__ADAM_PIANO_CORE_V2_INSTALLED__ = true;

` + src;
  }

  // liveLoop는 재할당하지 않고 내부 route만 바꿈.
  src = patchLiveLoopRoute(src);

  // export wrapper만 사용. thinkAndAct/reactToChat 재할당 안 함.
  if (!src.includes('__ADAM_PIANO_V33_EXPORT_BRIDGE__')) {
    src += `

/* __ADAM_PIANO_V33_EXPORT_BRIDGE__ */
(function adamPianoV33ExportBridge() {
  if (globalThis.__ADAM_PIANO_V33_EXPORT_BRIDGE_INSTALLED__) return;
  globalThis.__ADAM_PIANO_V33_EXPORT_BRIDGE_INSTALLED__ = true;

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
        return (typeof BUILTIN_ACTIONS !== 'undefined' && Array.isArray(BUILTIN_ACTIONS)) ? BUILTIN_ACTIONS : [];
      },

      performBuiltinAction: async function (botArg, selfArg, action, target, label) {
        if (typeof performBuiltinAction !== 'function') return 'performBuiltinAction missing';
        return await performBuiltinAction(botArg, selfArg, action, target, label);
      },

      executeDecision: async function (botArg, selfArg, item) {
        if (typeof executeDecision !== 'function') return 'executeDecision missing';
        return await executeDecision(botArg, selfArg, item);
      },

      executeAction: async function (botArg, selfArg, item) {
        if (typeof executeWithAwareness === 'function') return await executeWithAwareness(botArg, selfArg, item);
        if (typeof executeDecision === 'function') return await executeDecision(botArg, selfArg, item);
        if (typeof performBuiltinAction === 'function') {
          return await performBuiltinAction(botArg, selfArg, item.action, item.target, item.label);
        }
        return 'no executor available';
      }
    };
  }

  function findSelfStrict(bot, opts) {
    const name = String((opts && opts.name) || (bot && bot.username) || 'Adam');

    try {
      if (
        globalThis.__ADAM_CITIZENS__ &&
        globalThis.__ADAM_CITIZENS__[name] &&
        globalThis.__ADAM_CITIZENS__[name].self
      ) {
        return globalThis.__ADAM_CITIZENS__[name].self;
      }
    } catch {}

    // 중요: globalThis.self 폴백 안 함. 멀티봇 오염 방지.
    return null;
  }

  function attachWhenReady(bot, opts, reason) {
    let tries = 0;

    function attempt() {
      tries += 1;

      const self = findSelfStrict(bot, opts);
      if (!self) {
        if (tries < 40) return setTimeout(attempt, 500);
        console.warn('⚠️ [PIANO V3.3] self registry not found. Runtime not attached.', {
          bot: bot && bot.username,
          name: opts && opts.name,
          reason
        });
        return;
      }

      if (self.__pianoRuntime && bot.__pianoRuntime) return;

      try {
        const rt = require('./piano_v3').install({
          bot,
          self,
          deps: getDeps()
        });

        self.__pianoRuntime = rt;
        bot.__pianoRuntime = rt;

        if (process.env.ADAM_ENABLE_LEGACY_GLOBAL !== '1') {
          try { delete globalThis.AdamPiano; } catch {}
        }

        console.log('🎼 [PIANO V3.3] runtime attached:', reason, 'bot=' + (bot && bot.username));
      } catch (e) {
        console.error('❌ [PIANO V3.3] runtime attach failed:', e && e.stack ? e.stack : e);
      }
    }

    setTimeout(attempt, 0);
  }

  if (
    module.exports &&
    typeof module.exports.createCitizen === 'function' &&
    !module.exports.createCitizen.__pianoV33Wrapped
  ) {
    const originalCreateCitizen = module.exports.createCitizen;

    const wrappedCreateCitizen = function pianoV33CreateCitizenWrapper(opts) {
      const bot = originalCreateCitizen.apply(this, arguments);
      attachWhenReady(bot, opts || {}, 'module.exports.createCitizen');
      return bot;
    };

    wrappedCreateCitizen.__pianoV33Wrapped = true;
    module.exports.createCitizen = wrappedCreateCitizen;

    console.log('🎼 [PIANO V3.3] createCitizen export wrapper installed');
  } else {
    console.warn('⚠️ [PIANO V3.3] module.exports.createCitizen missing. Export keys:', Object.keys(module.exports || {}));
  }
})();
`;
  }

  write(TARGET, src);
}

ensurePackageScript();
ensurePressureTest();
ensureInitConfig();
sanitizePianoIndex();
restoreCitizenIfNeeded();
patchCitizen();

console.log('\\nRepair complete.');
console.log('Now run:');
console.log('  node --check citizen.cjs');
console.log('  node --check piano_v3/index.cjs');
console.log('  npm run test:piano');
