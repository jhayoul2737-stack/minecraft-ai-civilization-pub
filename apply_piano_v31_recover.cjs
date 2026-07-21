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
fs.mkdirSync('piano_v3', { recursive: true });
fs.mkdirSync('piano_v3/tests', { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join('backups', path.basename(target) + '.bak-piano-v31-recover-' + stamp);
fs.copyFileSync(target, backup);

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

function findFunction(ast, name) {
  let found = null;

  walk(ast, (node) => {
    if (found) return;

    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === name) {
      found = node;
      return;
    }

    if (
      node.type === 'VariableDeclarator' &&
      node.id &&
      node.id.name === name &&
      node.init &&
      (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression')
    ) {
      found = node.init;
      return;
    }

    if (
      node.type === 'AssignmentExpression' &&
      node.left &&
      node.left.type === 'Identifier' &&
      node.left.name === name &&
      node.right &&
      (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression')
    ) {
      found = node.right;
    }
  });

  return found;
}

function topLevelInsertBeforeSpawnOrReturn(fn, src) {
  const body = fn && fn.body && Array.isArray(fn.body.body) ? fn.body.body : [];

  for (const stmt of body) {
    const text = src.slice(stmt.start, stmt.end);
    if (/bot\s*\.\s*(once|on)\s*\(\s*['"]spawn['"]/.test(text)) {
      return stmt.start;
    }
  }

  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i].type === 'ReturnStatement') return body[i].start;
  }

  return fn.body.end - 1;
}

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

  if (fs.existsSync(file)) return;

  fs.writeFileSync(file, `#!/usr/bin/env node
const { initConfig } = require('./config.cjs');

const name = String(process.argv[2] || 'Adam').replace(/[^\\w.-]/g, '_');
const overwrite = process.argv.includes('--overwrite');
const file = 'piano_config_' + name + '.json';

const result = initConfig(file, { overwrite });
console.log(result.created ? 'created ' + file : 'exists ' + file + ' (use --overwrite to replace)');
`);
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

let src = fs.readFileSync(target, 'utf8');

// 혹시 파일 끝에 설명문 붙었으면 제거.
const proseMarker = '\n4. 자유도를 높이는 명령';
const proseIdx = src.indexOf(proseMarker);
if (proseIdx !== -1) {
  src = src.slice(0, proseIdx).trimEnd() + '\n';
}

// 기존 Agency/Piano V2 비활성화 플래그 보강.
if (src.includes('/* __ADAM_AGENCY_CORE_V1__ */') && !src.includes('__ADAM_AGENCY_CORE_V1_DISABLED_BY_V31__')) {
  src = src.replace(
    '/* __ADAM_AGENCY_CORE_V1__ */',
    "/* __ADAM_AGENCY_CORE_V1_DISABLED_BY_V31__ */\nglobalThis.__ADAM_AGENCY_CORE_V1_INSTALLED__ = true;\n\n/* __ADAM_AGENCY_CORE_V1__ */"
  );
}

if (src.includes('/* __ADAM_PIANO_CORE_V2__ */') && !src.includes('__ADAM_PIANO_CORE_V2_DISABLED_BY_V31__')) {
  src = src.replace(
    '/* __ADAM_PIANO_CORE_V2__ */',
    "/* __ADAM_PIANO_CORE_V2_DISABLED_BY_V31__ */\nglobalThis.__ADAM_PIANO_CORE_V2_INSTALLED__ = true;\n\n/* __ADAM_PIANO_CORE_V2__ */"
  );
}

let ast = parse(src);
const edits = [];

// 1) createCitizen 안에 V3.1 install 삽입.
// 예전처럼 globalThis.__ADAM_CITIZENS__ 라인에 의존하지 않고,
// createCitizen 내부의 bot.once('spawn') 앞 또는 return bot 앞에 삽입.
if (!src.includes('__ADAM_PIANO_V31_EXPLICIT_INSTALL__')) {
  const createCitizen = findFunction(ast, 'createCitizen');

  if (!createCitizen) {
    throw new Error('AST anchor not found: function createCitizen');
  }

  const insertPos = topLevelInsertBeforeSpawnOrReturn(createCitizen, src);

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

// 2) liveLoop가 전역 AdamPianoV3가 아니라 self.__pianoRuntime을 우선 쓰게 교체.
if (!src.includes('__ADAM_PIANO_V31_LIVELOOP_ROUTE__')) {
  const liveLoop = findFunction(ast, 'liveLoop');

  if (!liveLoop) {
    throw new Error('AST anchor not found: function liveLoop');
  }

  let routeNode = null;

  walk(liveLoop, (node) => {
    if (routeNode) return;
    if (node.type !== 'IfStatement') return;

    const text = src.slice(node.start, node.end);

    if (
      text.includes('AdamPianoV3.tick') ||
      (text.includes('reactToChat') && text.includes('thinkAndAct'))
    ) {
      routeNode = node;
    }
  });

  if (!routeNode) {
    throw new Error('AST anchor not found: liveLoop route if-statement');
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

// 3) package script / test / init-config 복구.
ensureInitConfig();
ensurePressureTest();
ensurePackageScript();

console.log('Backup:', backup);
console.log('Recovered target:', target);
console.log('Ensured package script: test:piano');
console.log('Ensured piano_v3/init-config.cjs');
console.log('Ensured piano_v3/tests/pressure_test.cjs');
