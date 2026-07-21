/* __ADAM_PIANO_V36_DEPS_HELPER__ */
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


/* __ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V34__ */
globalThis.__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V33__ = true;
globalThis.__ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V34__ = true;
if (process.env.ADAM_ENABLE_LEGACY_GLOBAL !== '1') {
  try { delete globalThis.AdamPiano; } catch (_) { try { globalThis.AdamPiano = undefined; } catch (_) {} }
}

/* __ADAM_DISABLE_OLD_AGENCY_AND_PIANO_BY_V33__ */
globalThis.__ADAM_AGENCY_CORE_V1_INSTALLED__ = true;
globalThis.__ADAM_PIANO_CORE_V2_INSTALLED__ = true;


/* __ADAM_MEMORY_SAFE_TEXT_V2__ */
function __adamMemorySafeTextV2(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    if (value instanceof Error) return value.stack || value.message || String(value);
  } catch (_) {}
  try {
    return JSON.stringify(value);
  } catch (_) {
    try {
      return String(value);
    } catch (_) {
      return "";
    }
  }
}


/* __ADAM_SAFE_TEXT_FOR_MEMORY_V1__ */
function __adamSafeTextForMemory(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    if (value instanceof Error) return value.stack || value.message || String(value);
  } catch (_) {}
  try {
    return JSON.stringify(value);
  } catch (_) {
    try {
      return String(value);
    } catch (_) {
      return "";
    }
  }
}

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');
const OpenAI = require('openai');
const fs = require('fs');
const { Vec3 } = require('vec3');
const vm = require('vm');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 256;      // 용량 절약, 의미 검색엔 충분
const MAIN_MODEL = 'gpt-4o-mini';  // 매 사이클 사고 (저비용)
const DEEP_MODEL = 'gpt-4o';       // 반성+계획 전용 (저빈도, 고품질)
const REFLECT_EVERY_N_CYCLES = 20; // 45초 × 20 = 약 15분마다

const ITEM_ALIASES = {
  'workbench': 'crafting_table', 'work bench': 'crafting_table',
  'crafting table': 'crafting_table', 'work_bench': 'crafting_table',
  'wooden axe': 'wooden_axe', 'wood axe': 'wooden_axe',
  'wooden pickaxe': 'wooden_pickaxe', 'wood pickaxe': 'wooden_pickaxe',
  'stone axe': 'stone_axe', 'stone pickaxe': 'stone_pickaxe',
  'wooden sword': 'wooden_sword', 'stone sword': 'stone_sword',
  'iron axe': 'iron_axe', 'iron pickaxe': 'iron_pickaxe', 'iron sword': 'iron_sword',
};
function resolveItemName(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return ITEM_ALIASES[lower] || lower.replace(/\s+/g, '_');
}

const SMELT_MAP = {
  'iron_ingot': ['raw_iron', 'iron_ore'],
  'gold_ingot': ['raw_gold', 'gold_ore'],
  'cooked_beef': ['beef'], 'cooked_porkchop': ['porkchop'],
  'cooked_chicken': ['chicken'], 'cooked_mutton': ['mutton'],
  'charcoal': ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log'],
  'glass': ['sand'],
};

function loadJSON(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
}
function saveJSON(path, data) { fs.writeFileSync(path, JSON.stringify(data, null, 2)); }

function sanitize(text) {
  return text.replace(/\b(AI|bot|simulation|Minecraft|LLM|GPT|server|player|마인크래프트|봇|게임|시뮬레이션|서버|플레이어|인공지능)\b/gi, '...');
}
function extractJSON(raw) {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}
function isCodeSafe(code) {
  const forbidden = ['require(','process.','child_process','fs.','__dirname','__filename','eval(','Function(','import(','while(true)','while (true)','for(;;)','for (;;)','bot.chat'];
  return !forbidden.some(kw => code.includes(kw));
}
function looksLikeFailure(result) {
  if (!result || typeof result !== 'string') return false;
  return ['찾지 못했다','없습니다','없다','필요합니다','필요하다','실패','not found','cannot'].some(kw => result.toLowerCase().includes(kw));
}

function getDetailedInventory(bot) {
  const items = bot.inventory.items();
  if (!items.length) return '아무것도 없음';
  const grouped = {};
  for (const i of items) grouped[i.name] = (grouped[i.name] || 0) + i.count;
  return Object.entries(grouped).map(([n, c]) => `${n} ${c}개`).join(', ');
}
function getNearbyImportantBlocks(bot) {
  const important = ['crafting_table','furnace','chest','bed','torch'];
  const found = [];
  for (const bn of important) {
    const b = bot.findBlock({ matching: bl => bl.name === bn, maxDistance: 8 });
    if (b) found.push(`${bn}(${Math.round(bot.entity.position.distanceTo(b.position))}블록)`);
  }
  return found.length ? found.join(', ') : '없음';
}
function getEnvironmentReport(bot) {
  const pos = bot.entity.position;
  const notes = [];
  const water = bot.findBlock({ matching: b => b.name === 'water', maxDistance: 32 });
  if (water) notes.push(`약 ${Math.round(pos.distanceTo(water.position))}블록 거리에 물이 있다`);
  const entities = Object.values(bot.entities).filter(e => e.position && pos.distanceTo(e.position) < 32);
  const animals = entities.filter(e => ['cow','pig','sheep','chicken'].includes(e.name));
  const monsters = entities.filter(e => ['zombie','skeleton','creeper','spider'].includes(e.name));
  if (animals.length) notes.push(`${animals[0].name} 등 동물 ${animals.length}마리가 보인다`);
  if (monsters.length) notes.push(`⚠️ ${monsters[0].name} 등 위협 ${monsters.length}마리가 보인다`);
  const structs = getNearbyImportantBlocks(bot);
  if (structs !== '없음') notes.push(`설치된 구조물: ${structs}`);
  return notes.length ? notes.join('. ') + '.' : '특별한 지형지물이 보이지 않는 평범한 곳이다.';
}

async function equipBestTool(bot, targetType) {
  let toolPref = [];
  if (targetType === 'combat') toolPref = ['sword','axe'];
  else if (/log|wood/.test(targetType)) toolPref = ['axe'];
  else if (/stone|ore|deepslate|cobblestone/.test(targetType)) toolPref = ['pickaxe'];
  else if (/dirt|sand|gravel|grass/.test(targetType)) toolPref = ['shovel'];
  if (!toolPref.length) return false;
  const matPref = ['netherite','diamond','iron','stone','golden','wooden'];
  let best = null, bestRank = Infinity;
  for (const item of bot.inventory.items()) {
    for (const type of toolPref) {
      if (item.name.includes(type)) {
        const matRank = matPref.findIndex(m => item.name.includes(m));
        const rank = (toolPref.indexOf(type) * 10) + (matRank !== -1 ? matRank : 9);
        if (rank < bestRank) { best = item; bestRank = rank; }
      }
    }
  }
  if (best) { try { await bot.equip(best, 'hand'); console.log(`🪓 [자동장착] ${best.name}`); return true; } catch { return false; } }
  return false;
}

const BUILTIN_ACTIONS = ['explore','gather_wood','mine','follow','rest','eat','place_block','craft_item','build_shelter','mark_home','go_home','mark_poi','store_items','smelt_item'];
const KEEP_IN_BAG = ['axe','pickaxe','sword','shovel','bread','apple','beef','porkchop','chicken','carrot','potato','cooked','crafting_table','log','planks','cobblestone','dirt','stone'];

// ════════════════════════════════════════════════════════════════════════
// ⭐ 임베딩 기반 기억 시스템 (Stanford Memory Stream의 저비용 구현)
// ════════════════════════════════════════════════════════════════════════

async function getEmbedding(text) {
  try {
    const res = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: __adamSafeTextForMemory(text).slice(0, 2000),
      dimensions: EMBED_DIMENSIONS,
    });
    return res.data[0].embedding;
  } catch (e) {
    console.warn(`⚠️ 임베딩 생성 실패: ${e.message}`);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// GPT 호출 없이 무료로 중요도를 추정 (진짜 논문은 LLM에게 물어보지만,
// 그러면 기억이 쌓일 때마다 API 비용이 추가되므로 휴리스틱으로 대체)
function estimateImportanceHeuristic(description) {
  const text = __adamSafeTextForMemory(description).toLowerCase();
  const high = ['죽었다','사망','창조주','신이다','만들었다','처음으로','위험','⚠️','발견','학습 완료','성공적으로 만들었다','통찰'];
  const low = ['탐험을 시작했다','휴식을 취했다','헤맸다','잠시 멈추고'];
  if (high.some(k => text.includes(k))) return 8;
  if (low.some(k => text.includes(k))) return 2;
  return 5;
}

async function addMemory(self, description) {
  // 방어 코드: 외부 모듈(예: adam_memory_core.cjs)이 addMemory(description)처럼
  // self 없이 1개 인자만 넘기는 경우를 흡수한다. 이게 없으면 self가 문자열이
  // 되어 self.memories가 undefined라 push에서 매번 조용히 실패한다.
  if (typeof self === 'string' && description === undefined) {
    description = self;
    self = globalThis.__ADAM_LAST_SELF__ || null;
  }
  if (!self || !Array.isArray(self.memories)) {
    console.warn(`⚠️ [MEMORY 안전장치] addMemory에 유효한 self가 없어 기억 저장을 건너뛴다: ${__adamSafeTextForMemory(description).slice(0, 80)}`);
    return null;
  }

  const embedding = await getEmbedding(description);
  const entry = {
    id: Date.now() + Math.random(),
    description,
    importance: estimateImportanceHeuristic(description),
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    embedding,
  };
  self.memories.push(entry);
  if (self.memories.length > 300) self.memories.shift(); // 최대 300개 보존
  saveJSON(`memories_${self.name}.json`, self.memories);
  console.log(`🧠 [기억] (중요도 ${entry.importance}) ${description}`);
  return entry;
}

// 진짜 벡터 검색 — 최근성 + 중요도 + 코사인 유사도 관련성을 결합
async function retrieveMemories(self, queryText, topK = 12) {
  if (!self.memories.length) return [];
  const queryEmbedding = await getEmbedding(queryText);
  const now = Date.now();
  return self.memories
    .map(m => {
      const ageHours = (now - new Date(m.lastAccessed).getTime()) / 3600000;
      const recency = Math.exp(-ageHours / 24);
      const importanceNorm = m.importance / 10;
      const relevance = queryEmbedding ? Math.max(0, cosineSimilarity(queryEmbedding, m.embedding)) : 0;
      const score = recency * 0.33 + importanceNorm * 0.33 + relevance * 0.34;
      return { ...m, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// 반성(통찰 추출) + 계획 수립을 하나의 API 호출로 통합 (비용 절감 핵심)
async function reflectAndPlan(self, bot) {
  console.log(`🔮 ${self.name} 자아성찰 + 계획 수립 중... (기억 ${self.memories.length}개 검토)`);
  const topMemories = [...self.memories]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 25)
    .map(m => `- ${m.description}`)
    .join('\n');

  const pos = bot.entity?.position;
  const prompt = `당신은 야생에 사는 사람 '${self.name}'입니다. 목적: "${self.purpose}"

[가장 인상 깊었던 경험들]
${topMemories || '(아직 경험이 부족하다)'}

[현재 상황]
- 위치: ${pos ? `X:${pos.x.toFixed(0)}, Z:${pos.z.toFixed(0)}` : '알 수 없음'}
- 집: ${self.state.home_location ? `(${self.state.home_location.x}, ${self.state.home_location.z})` : '없음'}
- 시간: ${bot.entity && bot.time.timeOfDay < 13000 ? '낮' : '밤'}

[지시]
1. 이 경험들에서 3~5개의 실용적인 통찰을 뽑으세요. 과한 철학적 고뇌 대신,
   "이 지역은 위험하다", "밤에는 미리 준비해야 한다" 같은 실용적 교훈 위주로 쓰세요.
2. 이 통찰을 바탕으로 앞으로의 장기 계획과 지금 당장 할 단계를 정하세요.
반드시 아래 JSON 형식만 출력하세요:
{"insights": ["...", "..."], "plan": "...", "step": "..."}`;

  try {
    const completion = await openai.chat.completions.create({
      model: DEEP_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const result = extractJSON(completion.choices[0].message.content);
    if (result) {
      if (Array.isArray(result.insights)) {
        for (const insight of result.insights) {
          const entry = await addMemory(self, `[통찰] ${insight}`);
          entry.importance = 9;
        }
        saveJSON(`memories_${self.name}.json`, self.memories);
      }
      if (result.plan) self.state.plan = result.plan;
      if (result.step) self.state.step = result.step;
      saveJSON(`state_${self.name}.json`, self.state);
      console.log(`📖 [통찰 ${result.insights?.length || 0}개] 📅 [계획] ${result.plan} 🎯 [단계] ${result.step}`);
    }
  } catch (e) { console.error(`⚠️ 반성/계획 실패:`, e.message); }
}

// ════════════════════════════════════════════════════════════════════════
// 시민 생성 및 생명주기
// ════════════════════════════════════════════════════════════════════════

function createCitizen({ name, purpose }) {
  const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: name, version: '1.20.1', auth: 'offline' });
  bot.loadPlugin(pathfinder);

  const loadedState = loadJSON(`state_${name}.json`, {});
  const self = {
    name, purpose,
    memories: loadJSON(`memories_${name}.json`, []),
    skills: loadJSON(`skills_${name}.json`, {}),
   state: {
  ...loadedState,
  plan: loadedState.plan || '이 세계를 파악하고 기초 생존 기반 마련',
  step: loadedState.step || '주변 탐색',
  home_location: loadedState.home_location || null,
  poi: Array.isArray(loadedState.poi) ? loadedState.poi : [],
  taskQueue: Array.isArray(loadedState.taskQueue) ? loadedState.taskQueue : [],
  taskQueueMeta: loadedState.taskQueueMeta || { goalName: null },
  failureStats: loadedState.failureStats || {},
  projects: loadedState.projects || {},
},
    isAlive: true,
    pendingChat: [],
    lastActionResult: null,
    cycleCount: 0,
  };

  // 외부 브릿지/자가성장 모듈이 self를 못 받았을 때 쓸 안전한 참조.
  globalThis.__ADAM_LAST_SELF__ = self;
  globalThis.__ADAM_LAST_BOT__ = bot;
  /* __ADAM_GLOBAL_BOT_BRIDGE_V1__ */
  globalThis.bot = bot;
  globalThis.self = self;

  globalThis.__ADAM_CITIZENS__ = globalThis.__ADAM_CITIZENS__ || {};
  globalThis.__ADAM_CITIZENS__[name] = { self, bot };

  bot.once('spawn', async () => {
    const mcData = mcDataLoader(bot.version);
    /* __ADAM_GLOBAL_MCDATA_BRIDGE_V1__ */
    globalThis.mcData = mcData;
    globalThis.bot = bot;
    globalThis.self = self;

    const movements = new Movements(bot, mcData);
    movements.canDig = true;
    bot.pathfinder.setMovements(movements);
    console.log(`✅ ${self.name} 가 이 세상에 깨어났습니다. (임베딩 기억 검색 탑재)`);
    console.log(`🧠 저장된 기억: ${self.memories.length}개 | 통찰: ${self.memories.filter(m => m.description.startsWith('[통찰]')).length}개`);
    console.log(`🏠 집: ${self.state.home_location ? `(${self.state.home_location.x}, ${self.state.home_location.z})` : '아직 없음'}`);

    self.reflexTimer = setInterval(() => reflexLoop(bot, self), 2000);
    setTimeout(() => liveLoop(bot, self), 5000);
  });

  bot.on('chat', (username, message) => {
    if (username === self.name) return;
    const cleaned = sanitize(message);
    console.log(`💬 [대화 감지] ${username}: "${cleaned}"`);
    self.pendingChat.push({ username, message: cleaned });
    addMemory(self, `[대화] ${username}이(가) 말했다: "${cleaned}"`).catch(() => {});
  });

  bot.on('death', () => {
    console.log(`💀 ${self.name} 사망.`);
    self.lastActionResult = '나는 죽었고 다시 눈을 떴다. 가진 것을 일부 잃었을 수 있다.';
    addMemory(self, self.lastActionResult).catch(() => {});
  });

  bot.on('end', () => {
    self.isAlive = false;
    if (self.reflexTimer) clearInterval(self.reflexTimer);
    saveJSON(`memories_${self.name}.json`, self.memories);
    saveJSON(`state_${self.name}.json`, self.state);
    saveJSON(`skills_${self.name}.json`, self.skills);
    console.log(`💾 ${self.name}의 모든 데이터가 저장되었습니다.`);
  });
  bot.on('error', (err) => {
    self.isAlive = false;
    if (self.reflexTimer) clearInterval(self.reflexTimer);
    console.error(`❌ ${self.name} 연결 에러:`, err.message);
  });

  return bot;
}

async function reflexLoop(bot, self) {
  if (!bot.entity || !self.isAlive) return;
  try {
    if (bot.food < 14) {
      const food = bot.inventory.items().find(i => ['bread','apple','beef','porkchop','chicken','carrot','potato','cooked'].some(f => i.name.includes(f)));
      if (food) { await bot.equip(food, 'hand'); await bot.consume(); console.log(`🍖 [반사신경] ${food.name} 섭취`); }
    }
    const danger = bot.nearestEntity(e => e.type === 'mob' && ['zombie','skeleton','creeper','spider'].includes(e.name) && bot.entity.position.distanceTo(e.position) < 6);
    if (danger) {
      console.log(`⚠️ [반사신경] ${danger.name} 발견! 즉시 대응`);
      await equipBestTool(bot, 'combat');
      try { bot.attack(danger); } catch {}
    }
  } catch {}
}

async function liveLoop(bot, self) {
  /* __ADAM_PIANO_V36_LIVELOOP_HOOK__ */
  try {
    const __pianoBridge = require('./piano_v3/bridge.cjs');
    const __pianoModule = require('./piano_v3/index.cjs');

    const __pianoDeps = (() => {
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
      const __first = (...names) => {
        for (const name of names) {
          const v = __get(name);
          if (v !== null && v !== undefined) return v;
        }
        return null;
      };
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
      const __openai = __firstOpenAI(
        'openai',
        'openaiClient',
        'openAIClient',
        'llmClient',
        'aiClient',
        'client'
      );
      const __deps = {
        openai: __openai,
        openaiClient: __openai,
        performBuiltinAction: __firstFn('performBuiltinAction', 'runBuiltinAction', 'performAction'),
        executeDecision: __firstFn('executeDecision', 'runDecision'),
        executeAction: __firstFn('executeAction', 'runAction'),
        executeActions: __firstFn('executeActions', 'runActions'),
        addMemory: __firstFn('addMemory', 'remember', 'storeMemory'),
        remember: __firstFn('remember', 'addMemory', 'storeMemory'),
        retrieveMemories: __firstFn('retrieveMemories', 'retrieveMemory', 'searchMemories', 'recallMemories'),
        retrieveMemory: __firstFn('retrieveMemory', 'retrieveMemories', 'searchMemories'),
        searchMemories: __firstFn('searchMemories', 'retrieveMemories', 'retrieveMemory'),
        sanitize: __firstFn('sanitize', 'sanitizeText', 'safeText'),
        loadPersonalityV2: __firstFn('loadPersonalityV2', 'loadPersonality'),
        loadPersonality: __firstFn('loadPersonality', 'loadPersonalityV2'),
        scanCurrentPossibilities: __firstFn('scanCurrentPossibilities', 'scanPossibilities'),
        scanFutureAffordances: __firstFn('scanFutureAffordances', 'scanAffordances'),
        getBuiltinActions: __firstFn('getBuiltinActions', 'listBuiltinActions'),
        maybeInjectTechTasks: __firstFn('maybeInjectTechTasks'),
        buildTechTreeQueue: __firstFn('buildTechTreeQueue'),
        thinkAndAct: __firstFn('thinkAndAct'),
        reactToChat: __firstFn('reactToChat'),
        safeChat: __firstFn('safeChat', 'botChat'),
        chat: __firstFn('chat', 'safeChat', 'botChat'),
        sleep: __firstFn('sleep', 'delay'),
        Vec3: __first('Vec3'),
        GoalBlock: __first('GoalBlock'),
        GoalNear: __first('GoalNear'),
        Movements: __first('Movements')
      };
      for (const [k, v] of Object.entries(__deps)) {
        if (v === null || v === undefined) delete __deps[k];
      }
      if (process.env.ADAM_PIANO_LOG_DEPS === '1') {
        const __summary = {
          openai: !!__deps.openai,
          executor: !!(__deps.performBuiltinAction || __deps.executeDecision || __deps.executeAction || __deps.executeActions),
          memory: !!(__deps.addMemory || __deps.retrieveMemories || __deps.retrieveMemory || __deps.searchMemories)
        };
        console.log('[PIANO V3.6] deps summary', __summary);
      }
      return __deps;
    })();

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

    try { __pushCandidate(bot); } catch (_) {}
    try { __pushCandidate(self); } catch (_) {}

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




  while (self.isAlive) {
    try {
      if (self.cycleCount > 0 && self.cycleCount % REFLECT_EVERY_N_CYCLES === 0) {
        await reflectAndPlan(self, bot);
      }
      /* __ADAM_PIANO_V33_LIVELOOP_ROUTE__ */
      if (self.__pianoRuntime && typeof self.__pianoRuntime.tick === 'function') {
        await self.__pianoRuntime.tick(self.pendingChat.length > 0 ? 'chat_or_social' : 'life_loop');
      } else if (bot.__pianoRuntime && typeof bot.__pianoRuntime.tick === 'function') {
        await bot.__pianoRuntime.tick(self.pendingChat.length > 0 ? 'chat_or_social' : 'life_loop');
      } else if (self.pendingChat.length > 0) await reactToChat(bot, self);
      else await thinkAndAct(bot, self);
      self.cycleCount++;
    } catch (e) { console.error(`⚠️ ${self.name}가 주저함:`, e.message); }
    await sleep(45000);
  }
}

async function reactToChat(bot, self) {
  if (!bot.entity || !self.isAlive) return;
  const chats = self.pendingChat.splice(0);
  const chatContext = chats.map(c => `${c.username}: "${c.message}"`).join('\n');
  const isExistential = chats.some(c => /(creator|창조주|신이다|만들었|made you|당신을 만든|god)/i.test(c.message));
  const toneNote = isExistential
    ? '이 말은 당신의 존재 자체에 의문을 던지는 발언입니다. 자연스러운 놀라움과 호기심을 담아 반응하되, 과장하거나 집착하지 마세요.'
    : '평범한 대화입니다. 실용적이고 자연스러운 사람처럼 짧고 담백하게 반응하세요.';

  const relevantMemories = (await retrieveMemories(self, chatContext, 8)).map(m => `- ${m.description}`).join('\n');

  const prompt = `당신은 야생에 사는 실용적이고 똑똑한 사람 '${self.name}'입니다.

[관련된 기억]
${relevantMemories || '없음'}

[절대 규칙]
1. 이 세계는 현실입니다. "게임", "AI", "시뮬레이션" 같은 단어를 들어본 적이 없습니다.
2. ${toneNote}

[방금 들은 말]
${chatContext}

[현재 소지품]
${getDetailedInventory(bot)}

반드시 아래 JSON 형식만 출력하세요:
{"thought":"(속마음)", "say":"(대답할 말, 반드시 있어야 함)", "remember":"(기억할 문장 또는 null)"}`;

  console.log(`💬 ${self.name} 대화에 반응 중...`);
  try {
    const completion = await openai.chat.completions.create({
      model: MAIN_MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }
    });
    const d = extractJSON(completion.choices[0].message.content);
    if (d) {
      if (d.say) bot.chat(sanitize(d.say));
      if (d.remember && d.remember !== 'null') await addMemory(self, d.remember);
      console.log(`💭 반응 속마음: ${d.thought}`);
    }
  } catch (e) { console.error(`⚠️ 채팅 반응 실패:`, e.message); }
}

async function thinkAndAct(bot, self) {
  if (!bot.entity || !self.isAlive) return;
  const pos = bot.entity.position;
  const nearby = Object.values(bot.entities).filter(e => e.type === 'player' && e.username !== self.name).map(e => e.username);
  const skillList = Object.keys(self.skills).length
    ? Object.entries(self.skills).map(([n, s]) => `- ${n}: ${s.description} (성공 ${s.successCount||0}/실패 ${s.failCount||0})`).join('\n')
    : '없음';
  const learnedNames = Object.keys(self.skills).join('/') || '없음';
  const homeText = self.state.home_location ? `X:${self.state.home_location.x}, Z:${self.state.home_location.z}` : '아직 없음';
  const poiText = self.state.poi.length ? self.state.poi.map(p => `- ${p.label}: X:${p.x}, Z:${p.z}`).join('\n') : '아직 없음';

  const situationQuery = `${bot.time.timeOfDay < 13000 ? '낮' : '밤'} 생존 건축 도구 ${getEnvironmentReport(bot)}`;
  const relevantMemories = (await retrieveMemories(self, situationQuery, 10))
    .map(m => `- [중요도 ${m.importance}] ${m.description}`).join('\n');
  const insights = self.memories.filter(m => m.description.startsWith('[통찰]')).slice(-5)
    .map(m => `- ${m.description.replace('[통찰] ', '')}`).join('\n');

  const prompt = `당신은 야생에 사는 실용적이고 똑똑한 생존자 '${self.name}'입니다.
목적: "${self.purpose}"

[나에 대한 통찰]
${insights || '아직 충분한 경험이 쌓이지 않았다.'}

[계획과 단계]
- 장기 계획: ${self.state.plan}
- 현재 단계: ${self.state.step}

[직전 행동 결과]
${self.lastActionResult || '아직 없음 (방금 깨어남)'}

[현재 상황]
- 위치/시간: X:${pos.x.toFixed(0)}, Z:${pos.z.toFixed(0)} / ${bot.time.timeOfDay < 13000 ? '낮' : '밤'}
- 신체: 체력 ${bot.health}/20, 배고픔 ${bot.food}/20
- 가방: ${getDetailedInventory(bot)}
- 시야에 보이는 환경: ${getEnvironmentReport(bot)}
- 주변 사람: ${nearby.length ? nearby.join(', ') : '아무도 없음'}

[관련된 기억]
${relevantMemories || '없음'}

[알고 있는 장소]
- 집: ${homeText}
${poiText}

[절대 규칙]
1. 이 세계는 현실입니다. "게임", "AI", "시뮬레이션"이라는 단어를 들어본 적이 없습니다.
2. 평소엔 생존과 작업에 집중하세요. 특별한 사건이 있을 때만 자연스럽게 반응하세요.

[할 수 있는 행동]
- explore, gather_wood(도끼 자동장착), mine(곡괭이 자동장착), follow, rest, eat
- place_block: 가방 속 블록(target) 설치
- craft_item: target(아이템 이름) 제작 (제작대 설치까지 자동, 모든 아이템 통용)
- build_shelter: 흙/나무/돌 24개 이상으로 지붕이 있는 대피소 건설
- mark_home / go_home / mark_poi(label 필요) / store_items / smelt_item(target)

[배운 기술]
${skillList}

[지시]
1. 직전 행동이 실패했다면 다른 방법을 시도하세요.
2. 계획/단계가 달성됐다면 다음 단계로 갱신하세요.
3. actions 배열에 최대 3개의 행동을 순서대로 나열해 한 번에 진행하세요.
4. action 값은 반드시 다음 중 하나: explore, gather_wood, mine, follow, rest, eat, place_block, craft_item, build_shelter, mark_home, go_home, mark_poi, store_items, smelt_item, learn_skill, ${learnedNames}
반드시 아래 JSON 형식 *만* 출력하세요:
{"update_plan":"...", "update_step":"...", "thought":"(실용적인 속마음)", "actions":[{"action":"...", "target":"(없으면 null)", "label":"(mark_poi일때만)", "skill_name":"(learn_skill일때만)", "skill_goal":"(learn_skill일때만)"}], "say":"(없으면 null)", "remember":"(없으면 null)"}`;

  console.log(`🧠 ${self.name} 생각 중... [단계: ${self.state.step}]`);
  let raw;
  try {
    const completion = await openai.chat.completions.create({
      model: MAIN_MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }
    });
    raw = completion.choices[0].message.content;
  } catch (e) { console.error(`⚠️ GPT 호출 실패:`, e.message); return; }

  const decision = extractJSON(raw);
  if (!decision) { console.warn(`⚠️ JSON 파싱 실패`); return; }

  if (decision.update_plan) self.state.plan = decision.update_plan;
  if (decision.update_step) self.state.step = decision.update_step;
  saveJSON(`state_${self.name}.json`, self.state);

  if (decision.remember && decision.remember !== 'null') await addMemory(self, decision.remember);
  if (decision.say && decision.say !== 'null') bot.chat(sanitize(decision.say));

  console.log(`🗺️ 계획: ${self.state.plan} | 🎯 단계: ${self.state.step}`);
  console.log(`💭 속마음: ${decision.thought}`);

  const actionList = Array.isArray(decision.actions) && decision.actions.length
    ? decision.actions.slice(0, 3)
    : (decision.action ? [{ action: decision.action, target: decision.target || null }] : []);
  if (!actionList.length) { console.warn(`⚠️ 실행할 행동이 없음`); return; }

  console.log(`🚶 실행 계획: ${actionList.map(a => a.action).join(' → ')}`);
  const resultParts = [];
  for (const item of actionList) {
    const resultText = await executeDecision(bot, self, item);
    resultParts.push(`[${item.action}] ${resultText}`);
    if (looksLikeFailure(resultText)) { console.log(`⚠️ 연쇄 행동 중단: ${resultText}`); break; }
  }
  self.lastActionResult = resultParts.join(' ');
  console.log(`📝 [행동 결과] ${self.lastActionResult}`);
  await addMemory(self, self.lastActionResult);
}

async function executeDecision(bot, self, item) {
  const { action, target, label, skill_name, skill_goal } = item;
  try {
    if (action === 'learn_skill') return await learnSkill(bot, self, skill_name, skill_goal);
    else if (self.skills[action]) return await runLearnedSkill(bot, self, action);
    else return await performBuiltinAction(bot, self, action, target, label);
  } catch (e) { return `실행 중 예상치 못한 에러: ${e.message}`; }
}

async function generateSkillCode(skillGoal, previousError) {
  const feedbackSection = previousError ? `\n\n[이전 실패]\n"${previousError}"\n이 문제를 피해 다시 작성하세요.` : '';
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `당신은 mineflayer 전문 자바스크립트 개발자입니다.
[목표] ${skillGoal}
[규칙]
1. async function skill(bot, goals) { ... } 형태로만 작성
2. Vec3(x,y,z)로 좌표 오프셋 생성 가능
3. require, fs, process, child_process, 무한루프, bot.chat 사용 금지
4. 실패 시 이유를 문자열로 return (throw 금지), 성공 시 성공 메시지 return
5. 코드만 출력, 마크다운 금지${feedbackSection}` }]
  });
  return completion.choices[0].message.content.trim().replace(/^```(javascript|js)?\n?/i, '').replace(/```$/, '').trim();
}

async function runSkillCode(bot, code) {
  if (!isCodeSafe(code)) throw new Error('안전하지 않은 코드 패턴이 감지되어 실행이 차단되었습니다.');
  const wrapped = `(async () => { ${code}\nreturn await skill(bot, goals); })();`;
  const sandbox = { bot, goals, console, Math, Vec3 };
  vm.createContext(sandbox);
  let resultPromise;
  try {
    const script = new vm.Script(wrapped);
    resultPromise = script.runInContext(sandbox, { timeout: 5000 });
  } catch (e) { throw new Error(`샌드박스 동기 실행 중단: ${e.message}`); }
  return await Promise.race([
    resultPromise,
    sleep(15000).then(() => { throw new Error('스킬 비동기 실행 시간 초과 (15초)'); })
  ]);
}

async function learnSkill(bot, self, skillName, skillGoal) {
  if (!skillName || skillName === 'null' || !skillGoal || skillGoal === 'null') return '스킬 이름이나 목표가 지정되지 않았다.';
  if (BUILTIN_ACTIONS.includes(skillName)) return `'${skillName}'은 이미 할 수 있는 기본 행동이다.`;
  console.log(`🎓 [GPT-4o] 새 스킬 학습 시작: "${skillGoal}"`);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let code;
    try { code = await generateSkillCode(skillGoal, lastError); } catch (e) { lastError = e.message; continue; }
    try {
      const result = await runSkillCode(bot, code);
      if (looksLikeFailure(result)) { lastError = `목표 미달성: ${result}`; continue; }
      self.skills[skillName] = { description: skillGoal, code, learnedAt: new Date().toISOString(), successCount: 1, failCount: 0 };
      saveJSON(`skills_${self.name}.json`, self.skills);
      console.log(`✨ 새 스킬 '${skillName}' 학습 완료!`);
      return `새 기술 '${skillName}' 학습 완료: ${result || skillGoal}`;
    } catch (e) { lastError = e.message; }
  }
  return `'${skillGoal}' 학습을 3번 시도했지만 실패했다.`;
}

async function runLearnedSkill(bot, self, skillName) {
  const skillObj = self.skills[skillName];
  if (!skillObj) return `'${skillName}' 스킬을 찾을 수 없다.`;
  try {
    const result = await runSkillCode(bot, skillObj.code);
    if (looksLikeFailure(result)) {
      skillObj.failCount = (skillObj.failCount || 0) + 1;
      if (skillObj.failCount >= 3) { delete self.skills[skillName]; console.warn(`🗑️ '${skillName}' 폐기`); }
      saveJSON(`skills_${self.name}.json`, self.skills);
      return `'${skillName}' 실행됐지만 실패: ${result}`;
    }
    skillObj.successCount = (skillObj.successCount || 0) + 1;
    saveJSON(`skills_${self.name}.json`, self.skills);
    return `'${skillName}' 성공: ${result || '완료'}`;
  } catch (e) {
    skillObj.failCount = (skillObj.failCount || 0) + 1;
    if (skillObj.failCount >= 3) delete self.skills[skillName];
    saveJSON(`skills_${self.name}.json`, self.skills);
    return `'${skillName}' 실행 중 에러: ${e.message}`;
  }
}

async function performBuiltinAction(bot, self, action, target, label) {
  if (!bot.entity) return '봇이 아직 스폰되지 않았다.';
  const pos = bot.entity.position;
  const mcData = mcDataLoader(bot.version);
  try {
    if (action === 'explore') {
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x+(Math.random()-.5)*60, pos.z+(Math.random()-.5)*60));
      return '새로운 방향으로 탐험을 시작했다.';
    } else if (action === 'gather_wood') {
      const woodTypes = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log'];
      const block = bot.findBlock({ matching: b => woodTypes.includes(b.name), maxDistance: 32 });
      if (block) {
        await equipBestTool(bot, block.name);
        await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
        await bot.dig(block);
        return `${block.name}을 베어냈다.`;
      }
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x+(Math.random()-.5)*40, pos.z+(Math.random()-.5)*40));
      return '나무를 찾지 못해 숲을 헤맸다.';
    } else if (action === 'mine') {
      const oreTypes = ['stone','coal_ore','iron_ore','deepslate_coal_ore','deepslate_iron_ore'];
      const block = bot.findBlock({ matching: b => oreTypes.includes(b.name), maxDistance: 20 });
      if (block) {
        await equipBestTool(bot, block.name);
        await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
        await bot.dig(block);
        return `${block.name}을 채굴했다.`;
      }
      return '광맥을 찾지 못했다.';
    } else if (action === 'follow') {
      const tp = Object.values(bot.entities).find(e => e.type === 'player' && e.username !== bot.username);
      if (tp) { bot.pathfinder.setGoal(new goals.GoalFollow(tp, 3), true); return `${tp.username}의 뒤를 쫓았다.`; }
      return '주변에 따라갈 사람이 없었다.';
    } else if (action === 'rest') {
      bot.pathfinder.setGoal(null);

      // 마인크래프트는 허기(food)가 18 이상이어야 체력이 자연 회복된다.
      // 예전 코드는 이 조건을 전혀 보지 않고 그냥 멈추기만 해서, 배가 고픈
      // 채로 영원히 "쉬기만" 하고 체력은 안 차는 문제가 있었다. 여기서는
      // 쉬기 전에 먼저 먹을 걸 챙기고, 먹을 게 없으면 쉬는 대신 음식을 찾도록 한다.
      const foodNow = typeof bot.food === 'number' ? bot.food : 20;
      const healthNow = typeof bot.health === 'number' ? bot.health : 20;

      if (foodNow < 18) {
        const restFood = bot.inventory.items().find(i =>
          ['bread','apple','beef','porkchop','chicken','carrot','potato','cooked','stew','mutton','rabbit','cod','salmon'].some(f => i.name.includes(f))
        );
        if (restFood) {
          try {
            await bot.equip(restFood, 'hand');
            await bot.consume();
            return `쉬기 전에 ${restFood.name}을 먹었다. (허기 ${bot.food}/20)`;
          } catch (e) {
            // 먹기 실패해도 아래로 계속 진행
          }
        } else if (foodNow <= 8) {
          // 먹을 게 없고 꽤 배고프면, 가만히 앉아 있어봐야 체력이 안 찬다.
          // 그냥 기다리는 대신 문제해결 루틴(사냥/탐색)으로 넘긴다는 걸 알린다.
          return `배가 고파(${foodNow}/20) 가만히 쉬어도 체력이 회복되지 않는다. 먹을 것을 구해야 한다.`;
        }
      }

      if (healthNow < 20 && foodNow >= 18) {
        // 조건이 맞으면 실제로 몇 초간 가만히 있어 자연 회복을 유도한다.
        await new Promise(r => setTimeout(r, 2500));
        return `안전한 곳에서 쉬며 체력을 회복했다. (체력 ${bot.health}/20, 허기 ${bot.food}/20)`;
      }

      return '잠시 멈추고 휴식을 취했다.';
    } else if (action === 'eat') {
      const food = bot.inventory.items().find(i => ['bread','apple','beef','porkchop','chicken','carrot','potato','cooked'].some(f => i.name.includes(f)));
      if (food) { await bot.equip(food, 'hand'); await bot.consume(); return `${food.name}을 먹었다.`; }
      return '가방에 먹을 것이 없었다.';
    } else if (action === 'place_block') {
      if (!target || target === 'null') return '설치할 블록 이름이 지정되지 않았다.';
      const resolvedName = resolveItemName(target);
      const item = bot.inventory.items().find(i => i.name === resolvedName || i.name.includes(resolvedName));
      if (!item) return `'${resolvedName}'을 설치하려 했으나 가방에 없었다.`;
      const basePos = pos.floored();
      for (const o of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]) {
        const ground = bot.blockAt(basePos.offset(o.x,-1,o.z));
        if (!ground || ground.name === 'air') continue;
        const placePos = basePos.offset(o.x,0,o.z);
        const existing = bot.blockAt(placePos);
        if (existing && existing.name !== 'air') continue;
        try {
          await bot.equip(item, 'hand');
          await bot.placeBlock(ground, new Vec3(0,1,0));
          return `'${item.name}'을 (${placePos.x}, ${placePos.y}, ${placePos.z})에 설치했다.`;
        } catch { continue; }
      }
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x+(Math.random()-.5)*6, pos.z+(Math.random()-.5)*6));
      return `'${item.name}' 설치를 시도했지만 주변에 공간이 없어 실패했다.`;
    } else if (action === 'craft_item') {
      if (!target || target === 'null') return '만들 아이템 이름이 지정되지 않았다.';
      const itemName = resolveItemName(target);
      const itemType = mcData.itemsByName[itemName];
      if (!itemType) return `'${target}'은(는) 존재하지 않는 아이템이다.`;
      let craftingTable = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 8 });
      let recipes = bot.recipesFor(itemType.id, null, 1, craftingTable);
      if (!recipes.length && !craftingTable) {
        const tableInBag = bot.inventory.items().find(i => i.name === 'crafting_table');
        if (tableInBag) {
          await performBuiltinAction(bot, self, 'place_block', 'crafting_table');
          craftingTable = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 8 });
          recipes = bot.recipesFor(itemType.id, null, 1, craftingTable);
        }
      }
      if (!recipes.length) return craftingTable ? `'${itemName}'을 만들 재료가 부족하다.` : `'${itemName}'을 만들려면 작업대가 필요한데 없다.`;
      try {
        await bot.craft(recipes[0], 1, craftingTable);
        return `'${itemName}'을 성공적으로 만들었다.`;
      } catch (e) { return `'${itemName}' 제작 중 문제가 생겼다: ${e.message}`; }
    } else if (action === 'build_shelter') {
      const buildMats = bot.inventory.items().filter(i => ['dirt','cobblestone','stone','planks','log'].some(m => i.name.includes(m)));
      const totalMats = buildMats.reduce((acc,i) => acc+i.count, 0);
      if (totalMats < 24) return `대피소를 지으려면 흙/나무/돌이 24개 이상 필요한데 ${totalMats}개뿐이다.`;
      const basePos = pos.floored();
      const perimeter = [{x:1,z:0},{x:1,z:1},{x:0,z:1},{x:-1,z:1},{x:-1,z:0},{x:-1,z:-1},{x:1,z:-1}];
      const roofCells = [...perimeter, {x:0,z:-1}, {x:0,z:0}];
      let builtCount = 0;
      for (const y of [0,1]) {
        for (const off of perimeter) {
          const targetPos = basePos.offset(off.x,y,off.z);
          if (bot.blockAt(targetPos)?.name !== 'air') continue;
          const material = bot.inventory.items().find(i => ['dirt','cobblestone','stone','planks','log'].some(m => i.name.includes(m)));
          if (!material) break;
          const refBlock = bot.blockAt(targetPos.offset(0,-1,0));
          if (refBlock && refBlock.name !== 'air') {
            try { await bot.lookAt(targetPos); await bot.equip(material,'hand'); await bot.placeBlock(refBlock,new Vec3(0,1,0)); builtCount++; await sleep(600); } catch {}
          }
        }
      }
      for (const off of roofCells) {
        const targetPos = basePos.offset(off.x,2,off.z);
        if (bot.blockAt(targetPos)?.name !== 'air') continue;
        const material = bot.inventory.items().find(i => ['dirt','cobblestone','stone','planks','log'].some(m => i.name.includes(m)));
        if (!material) break;
        const refBlock = bot.blockAt(targetPos.offset(0,-1,0));
        if (refBlock && refBlock.name !== 'air') {
          try { await bot.lookAt(targetPos); await bot.equip(material,'hand'); await bot.placeBlock(refBlock,new Vec3(0,1,0)); builtCount++; await sleep(600); } catch {}
        }
      }
      return builtCount > 0 ? `블록 ${builtCount}개를 쌓아 지붕형 대피소를 만들었다.` : '공간이 마땅치 않아 대피소를 짓지 못했다.';
    } else if (action === 'mark_home') {
      self.state.home_location = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };
      saveJSON(`state_${self.name}.json`, self.state);
      return `현재 위치 (${self.state.home_location.x}, ${self.state.home_location.z})를 집으로 기억했다.`;
    } else if (action === 'go_home') {
      if (!self.state.home_location) return '아직 집으로 기억해둔 곳이 없다.';
      const h = self.state.home_location;
      bot.pathfinder.setGoal(new goals.GoalBlock(h.x, h.y, h.z));
      return `집(${h.x}, ${h.z})으로 이동을 시작했다.`;
    } else if (action === 'mark_poi') {
      const poiLabel = label || target || '발견한 장소';
      self.state.poi.push({ label: poiLabel, x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) });
      if (self.state.poi.length > 8) self.state.poi.shift();
      saveJSON(`state_${self.name}.json`, self.state);
      return `현재 위치를 '${poiLabel}'(으)로 기억했다.`;
    } else if (action === 'store_items') {
      const chest = bot.findBlock({ matching: b => b.name === 'chest', maxDistance: 8 });
      if (!chest) return '근처에 상자가 없어서 보관하지 못했다.';
      try {
        await bot.pathfinder.goto(new goals.GoalBlock(chest.position.x, chest.position.y, chest.position.z));
        const chestWin = await bot.openChest(chest);
        const toStore = bot.inventory.items().filter(i => !KEEP_IN_BAG.some(k => i.name.includes(k)));
        let stored = 0;
        for (const item of toStore) { try { await chestWin.deposit(item.type, null, item.count); stored++; } catch {} }
        chestWin.close();
        return stored > 0 ? `상자에 ${stored}종류의 여분 물건을 보관했다.` : '보관할 여분 물건이 없었다.';
      } catch (e) { return `상자를 이용하다가 실패했다: ${e.message}`; }
    } else if (action === 'smelt_item') {
      const furnace = bot.findBlock({ matching: b => b.name === 'furnace', maxDistance: 8 });
      if (!furnace) return '근처에 화로가 없어서 제련하지 못했다.';
      const desired = resolveItemName(target || 'iron_ingot');
      const sourceNames = SMELT_MAP[desired] || [desired.replace('cooked_','').replace('_ingot','_ore')];
      try {
        await bot.pathfinder.goto(new goals.GoalBlock(furnace.position.x, furnace.position.y, furnace.position.z));
        const furnaceWin = await bot.openFurnace(furnace);
        const fuel = bot.inventory.items().find(i => ['coal','charcoal','log','planks'].some(f => i.name.includes(f)));
        const ore = bot.inventory.items().find(i => sourceNames.some(s => i.name.includes(s)));
        if (fuel) await furnaceWin.putFuel(fuel.type, null, 1);
        if (ore) await furnaceWin.putInput(ore.type, null, Math.min(ore.count, 8));
        furnaceWin.close();
        if (!ore) return `'${desired}'을 만들 재료(${sourceNames.join('/')})가 없어서 제련을 시작하지 못했다.`;
        return `화로에 재료를 넣고 '${desired}' 제련을 시작했다.`;
      } catch (e) { return `화로를 사용하다가 문제가 생겼다: ${e.message}`; }
    } else {
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x+(Math.random()-.5)*40, pos.z+(Math.random()-.5)*40));
      return `'${action}'은 알 수 없는 행동이라 탐험으로 대체했다.`;
    }
  } catch (e) { return `'${action}' 행동 중 예상치 못한 에러가 났다: ${e.message}`; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { createCitizen };
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON A] 로컬 판단 시스템 — API 호출 없이 순수 연산
// ════════════════════════════════════════════════════════════════════════

const CIVILIZATION_STAGES = [
  { id: 0, name: '야생 생존', check: () => true },
  {
    id: 1, name: '기초 정착',
    check: (bot, self) => {
      const inv = bot.inventory.items();
      return inv.some(i => /stone_(pickaxe|axe|sword)/.test(i.name))
        && !!self.state.home_location
        && !!bot.findBlock({ matching: b => b.name === 'chest', maxDistance: 16 });
    }
  },
  {
    id: 2, name: '소규모 거점',
    check: (bot) => {
      const inv = bot.inventory.items();
      return inv.some(i => /iron_(pickaxe|axe|sword)/.test(i.name))
        && !!bot.findBlock({ matching: b => b.name === 'furnace', maxDistance: 16 });
    }
  },
  {
    id: 3, name: '발전된 정착지',
    check: (bot, self) => (self.state.poi?.length || 0) >= 4
  },
];

function evaluateCivilizationStage(bot, self) {
  let current = self.state.civilization_stage || 0;
  while (current < CIVILIZATION_STAGES.length - 1 && CIVILIZATION_STAGES[current + 1].check(bot, self)) {
    current++;
    console.log(`🏛️ [문명 단계 상승] ${current}단계 - ${CIVILIZATION_STAGES[current].name}`);
    addMemory(self, `[문명 단계 상승] ${current}단계: ${CIVILIZATION_STAGES[current].name}에 도달했다.`).catch(() => {});
  }
  self.state.civilization_stage = current;
  return { level: current, name: CIVILIZATION_STAGES[current].name };
}

function calcThreatScore(bot) {
  const pos = bot.entity?.position;
  if (!pos) return 0;
  let score = 0;
  const nearby = Object.values(bot.entities).filter(e => e.position && pos.distanceTo(e.position) < 24);
  for (const e of nearby) {
    const dist = pos.distanceTo(e.position);
    if (['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman'].includes(e.name)) score += Math.max(0, 20 - dist) * 3;
    if (e.name === 'creeper' && dist < 5) score += 50;
  }
  if (bot.health < 6) score += 40; else if (bot.health < 10) score += 15;
  if (bot.food < 6) score += 20;
  if (bot.time?.timeOfDay > 13000) score += 10;
  return Math.round(score);
}
function getThreatLabel(score) {
  if (score >= 80) return '🔴위험';
  if (score >= 40) return '🟠주의';
  if (score >= 15) return '🟡경계';
  return '🟢안전';
}

const RESOURCE_THRESHOLDS = {
  음식: { keys: ['bread', 'apple', 'beef', 'porkchop', 'chicken', 'carrot', 'potato', 'cooked'], min: 5 },
  나무: { keys: ['log', 'planks'], min: 8 },
  돌:   { keys: ['cobblestone', 'stone'], min: 16 },
  연료: { keys: ['coal', 'charcoal'], min: 4 },
};
function predictShortages(bot) {
  const inv = bot.inventory.items();
  const shortages = [];
  for (const [label, cfg] of Object.entries(RESOURCE_THRESHOLDS)) {
    const total = inv.filter(i => cfg.keys.some(k => i.name.includes(k))).reduce((a, i) => a + i.count, 0);
    if (total < cfg.min) shortages.push(`${label}(${total}개)`);
  }
  return shortages;
}

function computePriority(bot, self) {
  const threat = calcThreatScore(bot);
  const shortages = predictShortages(bot);
  const isNight = bot.time?.timeOfDay > 13000;
  if (threat >= 80) return { level: 'EMERGENCY', reason: '즉각 대응 필요' };
  if (bot.health < 6) return { level: 'CRITICAL', reason: '체력 위기' };
  if (bot.food < 4) return { level: 'URGENT', reason: '굶주림' };
  if (isNight && !self.state.home_location) return { level: 'HIGH', reason: '밤인데 집이 없음' };
  if (shortages.length >= 2) return { level: 'HIGH', reason: `자원 부족: ${shortages.join(', ')}` };
  return { level: 'NORMAL', reason: '안정적' };
}

function getStatusReport(bot, self) {
  const threat = calcThreatScore(bot);
  const priority = computePriority(bot, self);
  const shortages = predictShortages(bot);
  const civ = evaluateCivilizationStage(bot, self);
  return `[상태점검] 위협 ${threat}(${getThreatLabel(threat)}) | 우선순위 ${priority.level}(${priority.reason}) | 부족 자원: ${shortages.join(', ') || '없음'} | 문명 단계 ${civ.level}(${civ.name})`;
}

function printDashboard(bot, self) {
  const pos = bot.entity?.position;
  const threat = calcThreatScore(bot);
  const priority = computePriority(bot, self);
  console.log('\n' + '═'.repeat(50));
  console.log(`  🌍 ${self.name} 대시보드`);
  console.log(`  위치: ${pos ? `X:${pos.x.toFixed(0)} Z:${pos.z.toFixed(0)}` : '?'} | 체력 ${bot.health}/20 | 배고픔 ${bot.food}/20`);
  console.log(`  위협: ${getThreatLabel(threat)}(${threat}) | 우선순위: ${priority.level} - ${priority.reason}`);
  console.log(`  계획: ${self.state.plan} | 단계: ${self.state.step}`);
  console.log(`  기억: ${self.memories?.length || 0}개 | 스킬: ${Object.keys(self.skills).length}개`);
  console.log('═'.repeat(50) + '\n');
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON B] 자율 메타학습 — 반복 실패를 감지해 스스로 스킬 생성
// ════════════════════════════════════════════════════════════════════════

function recordFailure(self, action, resultText) {
  self.state.failureStats = self.state.failureStats || {};
  const stats = self.state.failureStats;
  if (!stats[action]) stats[action] = { count: 0, samples: [] };
  stats[action].count++;
  stats[action].samples.push(resultText);
  if (stats[action].samples.length > 5) stats[action].samples.shift();
}

async function maybeAutoLearn(bot, self) {
  const stats = self.state.failureStats || {};
  for (const [action, stat] of Object.entries(stats)) {
    if (stat.count < 3) continue;
    const skillName = `auto_fix_${action}`;
    if (self.skills[skillName]) { stat.count = 0; continue; } // 이미 해결했으면 리셋만
    console.log(`🧪 [자율 메타학습] '${action}' 반복 실패(${stat.count}회) 감지 → 자동 스킬 생성 시도`);
    const goalText = `기존 '${action}' 행동이 반복적으로 실패하고 있다. 실패 사례: ${stat.samples.join(' / ')}. 이 문제를 우회하거나 더 안정적으로 해결하는 mineflayer 스킬을 작성하라.`;
    const result = await learnSkill(bot, self, skillName, goalText); // 원본의 learnSkill을 그대로 재사용
    await addMemory(self, `[자율 학습] '${action}' 문제 해결을 위해 스스로 새 기술을 만들었다: ${result}`);
    stat.count = 0;
  }
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON C] 설계도 건축 & 장기 프로젝트 관리 (네이티브 기능)
// ════════════════════════════════════════════════════════════════════════

async function buildBlueprint(bot, self, structureName) {
  if (!structureName || structureName === 'null') return '건축할 구조물 이름이 지정되지 않았다.';
  console.log(`🏗️ [설계] '${structureName}' 3D 설계도를 구상하는 중...`);
  const prompt = `당신은 마인크래프트 건축가입니다. '${structureName}'을 짓기 위한 설계도를 작성하세요.
크기는 반드시 5x5x5 블록 이내여야 하고, dirt/oak_planks/cobblestone/oak_log만 사용하세요.
좌표는 건축가가 서있는 위치를 (0,0,0)으로 하는 상대 좌표입니다.
반드시 JSON만 출력: {"blueprint":[{"x":0,"y":0,"z":0,"block":"cobblestone"}]}`;

  let blueprint;
  try {
    const completion = await openai.chat.completions.create({
      model: DEEP_MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }
    });
    const result = extractJSON(completion.choices[0].message.content);
    if (!result?.blueprint?.length) return `'${structureName}' 설계에 실패했다.`;
    blueprint = result.blueprint.slice(0, 100); // 폭주 방지 안전 상한
  } catch (e) { return `설계 요청 중 에러: ${e.message}`; }

  const basePos = bot.entity.position.floored();
  let success = 0, fail = 0;
  for (const step of blueprint) {
    const targetPos = basePos.offset(step.x, step.y, step.z);
    if (bot.blockAt(targetPos)?.name !== 'air') continue;
    const matName = resolveItemName(step.block);
    const material = bot.inventory.items().find(i => i.name === matName || i.name.includes(matName))
      || bot.inventory.items().find(i => ['dirt', 'cobblestone', 'planks', 'log'].some(m => i.name.includes(m)));
    if (!material) { fail++; continue; }
    const refBlock = bot.blockAt(targetPos.offset(0, -1, 0));
    if (!refBlock || refBlock.name === 'air') { fail++; continue; }
    try {
      await bot.equip(material, 'hand');
      await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
      success++;
      await sleep(400);
    } catch { fail++; }
  }
  const msg = success > 0
    ? `'${structureName}' 건설: 블록 ${success}개 설치 성공, ${fail}개 실패`
    : `'${structureName}' 건설 실패 (설치된 블록 없음)`;
  await addMemory(self, msg);
  return msg;
}

async function manageProject(bot, self, projectName, advance) {
  self.state.projects = self.state.projects || {};
  if (!projectName || projectName === 'null') return '프로젝트 이름이 필요하다.';

  if (!self.state.projects[projectName]) {
    console.log(`📈 [프로젝트] 새로운 문명 과제 '${projectName}' 기획 중...`);
    const prompt = `당신은 문명을 개척하는 지도자입니다. 목표 프로젝트: "${projectName}"
이 프로젝트를 달성하기 위한 4개의 구체적이고 순차적인 마인크래프트 행동 단계를 작성하세요.
반드시 JSON만 출력: {"tasks": ["단계1","단계2","단계3","단계4"]}`;
    try {
      const completion = await openai.chat.completions.create({
        model: MAIN_MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }
      });
      const result = extractJSON(completion.choices[0].message.content);
      if (!result?.tasks?.length) return `'${projectName}' 프로젝트 기획에 실패했다.`;
      self.state.projects[projectName] = { tasks: result.tasks, currentTaskIndex: 0 };
    } catch (e) { return `프로젝트 기획 중 에러: ${e.message}`; }
  }

  const project = self.state.projects[projectName];
  if (advance) project.currentTaskIndex = Math.min(project.currentTaskIndex + 1, project.tasks.length);
  if (project.currentTaskIndex >= project.tasks.length) return `'${projectName}' 프로젝트의 모든 단계를 완료했다.`;

  const currentTask = project.tasks[project.currentTaskIndex];
  self.state.step = `[프로젝트:${projectName}] ${currentTask}`;
  return `현재 프로젝트 '${projectName}'의 목표: ${currentTask}`;
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON D] 스킬 진화, 스마트 창고, 환경 반응, 독백
// ════════════════════════════════════════════════════════════════════════

async function evolveSkillsIfReady(bot, self) {
  for (const [name, skill] of Object.entries(self.skills)) {
    if (skill.isNative) continue;
    if ((skill.successCount || 0) < 10 || skill.evolved) continue;
    console.log(`🧬 [스킬 진화] '${name}' 업그레이드 시도`);
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `아래 mineflayer 스킬 코드를 더 안정적이고 효율적으로 개선하라.
[목표] ${skill.description}
[현재 코드]
${skill.code}
개선된 코드만 출력, 마크다운 금지, async function skill(bot, goals) 형태 유지.` }]
      });
      const newCode = completion.choices[0].message.content.trim().replace(/^```(javascript|js)?\n?/i, '').replace(/```$/, '').trim();
      if (isCodeSafe(newCode)) {
        self.skills[name].code = newCode;
        self.skills[name].evolved = true;
        self.skills[name].successCount = 0;
        saveJSON(`skills_${self.name}.json`, self.skills);
        await addMemory(self, `[성장] '${name}' 기술이 더 나은 방식으로 진화했다.`);
        console.log(`✨ '${name}' 진화 완료`);
      }
    } catch (e) { console.warn(`⚠️ 스킬 진화 실패: ${e.message}`); }
  }
}

async function smartStoreItems(bot, self) {
  const chestPositions = bot.findBlocks({ matching: b => b.name === 'chest', maxDistance: 16, count: 5 }) || [];
  const chestBlocks = chestPositions.map(p => bot.blockAt(p)).filter(Boolean);
  if (!chestBlocks.length) return '근처에 상자가 없어서 보관하지 못했다.';
  const toStore = bot.inventory.items().filter(i => !KEEP_IN_BAG.some(k => i.name.includes(k)));
  if (!toStore.length) return '보관할 여분 물건이 없었다.';

  let stored = 0;
  for (const chestBlock of chestBlocks) {
    try {
      await bot.pathfinder.goto(new goals.GoalBlock(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z));
      const win = await bot.openChest(chestBlock);
      const remaining = bot.inventory.items().filter(i => !KEEP_IN_BAG.some(k => i.name.includes(k)));
      for (const item of remaining) { try { await win.deposit(item.type, null, item.count); stored++; } catch {} }
      win.close();
      await sleep(300);
    } catch (e) { console.warn(`⚠️ 상자 접근 실패: ${e.message}`); }
  }
  return stored > 0 ? `상자 ${chestBlocks.length}곳에 총 ${stored}종류 물건을 나눠 보관했다.` : '보관을 시도했지만 넣을 게 없었다.';
}

function attachEnvironmentListenersOnce(bot, self) {
  if (self.__listenersAttached) return;
  self.__listenersAttached = true;

  bot.on('playerCollect', (collector) => {
    if (collector.username !== self.name) return;
    const nearby = Object.values(bot.entities).find(e =>
      e.type === 'player' && e.username !== self.name && e.position && bot.entity.position.distanceTo(e.position) < 10
    );
    if (nearby) {
      bot.chat(sanitize(`${nearby.username}... 이걸 나에게 준 건가. 고맙다.`));
      addMemory(self, `[선물] ${nearby.username}이(가) 아이템을 건네줬다.`).catch(() => {});
    }
  });

  bot.on('rain', async () => {
    if (bot.thunderState > 0) {
      bot.chat(sanitize('천둥이 친다... 안전한 곳으로 가야겠다.'));
      if (self.state.home_location) {
        const h = self.state.home_location;
        bot.pathfinder.setGoal(new goals.GoalBlock(h.x, h.y, h.z));
      }
      await addMemory(self, '[날씨] 뇌우가 몰아쳐 대피했다.').catch(() => {});
    }
  });
}

const MONOLOGUE_POOL = ['...이 세상은 참 넓다.', '오늘은 뭘 만들어볼까.', '혼자지만 뭔가 이뤄낼 수 있을 것 같다.', '저 산 너머엔 뭐가 있을까.'];
function maybeMonologue(bot, self) {
  const hasPlayerNearby = Object.values(bot.entities).some(e => e.type === 'player' && e.username !== self.name);
  if (hasPlayerNearby) return;
  self.__lastMonologueTick = self.__lastMonologueTick || 0;
  if ((self.__extTick || 0) - self.__lastMonologueTick < 15) return;
  if (Math.random() > 0.3) return;
  self.__lastMonologueTick = self.__extTick;
  bot.chat(sanitize(MONOLOGUE_POOL[Math.floor(Math.random() * MONOLOGUE_POOL.length)]));
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON E] 통합 후킹 — 원본 파일 수정 없이 전체를 연결
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('build_blueprint', 'manage_project', 'smart_store', 'check_status');

function ensureNativeActionsDiscoverable(self) {
  if (self.skills['build_blueprint']) return;
  self.skills['build_blueprint'] = { description: 'target에 건물 이름(예: 대장간, 감시탑, 농장)을 넣으면 3D 설계도를 구상해 건설한다. (네이티브)', code: '// native', isNative: true, successCount: 0, failCount: 0 };
  self.skills['manage_project']  = { description: 'target에 장기 프로젝트 이름(예: 철기 시대 진입)을 넣으면 하위 단계로 쪼개 추적한다. (네이티브)', code: '// native', isNative: true, successCount: 0, failCount: 0 };
  self.skills['smart_store']     = { description: '가방의 여분 아이템을 여러 상자에 나눠 보관한다. (네이티브)', code: '// native', isNative: true, successCount: 0, failCount: 0 };
  self.skills['check_status']    = { description: '위협도, 자원 부족, 문명 발전 단계를 종합 점검한다. (네이티브)', code: '// native', isNative: true, successCount: 0, failCount: 0 };
  saveJSON(`skills_${self.name}.json`, self.skills);
  console.log(`🧩 [네이티브 기능 등록] build_blueprint / manage_project / smart_store / check_status`);
}

const _originalExecuteDecision = executeDecision;
executeDecision = async function (bot, self, item) {
  ensureNativeActionsDiscoverable(self);
  attachEnvironmentListenersOnce(bot, self);

  const { action, target, label } = item;
  let resultText;

  if (action === 'build_blueprint')                      resultText = await buildBlueprint(bot, self, target);
  else if (action === 'manage_project')                  resultText = await manageProject(bot, self, target, label === 'advance');
  else if (action === 'smart_store' || action === 'store_items') resultText = await smartStoreItems(bot, self);
  else if (action === 'check_status')                    resultText = getStatusReport(bot, self);
  else                                                    resultText = await _originalExecuteDecision(bot, self, item);

  self.__extTick = (self.__extTick || 0) + 1;
  if (looksLikeFailure(resultText)) recordFailure(self, action, resultText);
  await maybeAutoLearn(bot, self);
  evaluateCivilizationStage(bot, self);
  await evolveSkillsIfReady(bot, self);
  maybeMonologue(bot, self);
  if (self.__extTick % 12 === 0) printDashboard(bot, self);

  return resultText;
};

console.log('🚀 [PATCH] Adam 확장 모듈 로드 완료 — build_blueprint / manage_project / smart_store / check_status / 자율 메타학습 / 문명 단계 추적 활성화');
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON F] 성격(Personality) 모듈 — 별도 파일 완전 분리
// ════════════════════════════════════════════════════════════════════════

function loadOrCreatePersonality(name) {
  const defaultPersonality = {
    core_traits: ['실용적이다', '행동이 먼저다', '호기심은 있지만 과장하지 않는다', '가끔 무뚝뚝하다'],
    speaking_style: '짧고 담백하게 말한다. 한 번에 한두 문장 이상 늘어놓지 않는다.',
    quirks: [
      '새로운 지형을 보면 일단 가보고 싶어한다',
      '도구가 닳으면 슬쩍 신경쓴다',
      '밤이 되면 말이 줄어든다'
    ],
    forbidden_patterns: [
      '나는 무엇인가', '존재의 의미', '이 세계의 본질', '철학적으로', '심오한',
      '나의 존재가', '고뇌', '~인가 아닌가', '우주', '운명'
    ],
    response_style: {
      danger: '짧고 즉각적으로. 말보다 행동이 먼저.',
      exploration: '관찰한 걸 담백하게 말한다.',
      building: '묵묵히 진행하고, 완성되면 짧게 만족을 표현한다.',
      idle: '주변을 살피고, 혼잣말은 가끔만 짧게.'
    }
  };
  const path = `personality_${name}.json`;
  let data = loadJSON(path, null);
  if (!data) {
    saveJSON(path, defaultPersonality);
    data = defaultPersonality;
    console.log(`🎭 [성격] '${path}' 파일이 없어서 기본 성격으로 새로 생성했다.`);
  }
  return data;
}

function buildPersonalityPrompt(personality) {
  if (!personality) return '';
  const forbidden = (personality.forbidden_patterns || []).join(', ');
  return `[성격]
특성: ${(personality.core_traits || []).join(', ')}
말투: ${personality.speaking_style || ''}
버릇: ${(personality.quirks || []).join(', ')}
상황별 태도 - 위험: ${personality.response_style?.danger || ''} / 탐험: ${personality.response_style?.exploration || ''} / 건축: ${personality.response_style?.building || ''} / 평상시: ${personality.response_style?.idle || ''}
[말할 때 절대 쓰지 않는 표현] ${forbidden}
→ 이런 표현이 떠오르면, 대신 지금 당장 할 일을 생각하라.`;
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON G] 죽음 이벤트 구조화 저장 — 좌표 + 인벤토리 스냅샷
// 기존 bot.on('death', ...) 핸들러는 그대로 살아있고, 이건 "추가" 리스너다.
// ════════════════════════════════════════════════════════════════════════

function attachStructuredDeathLogger(bot, self) {
  if (self.__deathLoggerAttached) return;
  self.__deathLoggerAttached = true;

  bot.on('death', () => {
    try {
      const pos = bot.entity?.position;
      const record = {
        position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null,
        time: new Date().toISOString(),
        cause: self.lastActionResult || '원인 불명',
        inventorySnapshot: bot.inventory.items().map(i => ({ name: i.name, count: i.count })),
      };
      self.state.last_death = record;
      saveJSON(`state_${self.name}.json`, self.state);
      addMemory(self, `[사망 기록] 위치=${record.position ? `(${record.position.x},${record.position.y},${record.position.z})` : '불명'}, 소지품 ${record.inventorySnapshot.length}종류를 그 자리에 두고 눈을 떴다.`).catch(() => {});
      console.log(`📓 [사망 이벤트] 좌표/인벤토리 기록 완료`);
    } catch (e) { console.warn('⚠️ 사망 이벤트 기록 실패:', e.message); }
  });
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON H] Perception 모듈 — 독립 타이머, 순수 로컬 연산
// 비싼 findBlock 스캔(용암/물)은 여기서 12초마다 미리 해두고,
// Reflex(2초 주기)는 이 결과만 읽어서 빠르게 반응한다.
// ════════════════════════════════════════════════════════════════════════

const PERCEPTION_INTERVAL_MS = 12000;

async function perceptionLoop(bot, self) {
  while (self.isAlive) {
    try {
      if (bot.entity) {
        const pos = bot.entity.position;
        const entities = Object.values(bot.entities).filter(e => e.position && pos.distanceTo(e.position) < 48);
        const monsters = entities.filter(e => ['zombie','skeleton','creeper','spider','witch','enderman','phantom'].includes(e.name))
          .map(e => ({ name: e.name, dist: Math.round(pos.distanceTo(e.position)) }));
        const animals = entities.filter(e => ['cow','pig','sheep','chicken','rabbit'].includes(e.name))
          .map(e => ({ name: e.name, dist: Math.round(pos.distanceTo(e.position)) }));
        const players = entities.filter(e => e.type === 'player' && e.username !== self.name).map(e => e.username);
        const lava = bot.findBlock({ matching: b => b.name === 'lava', maxDistance: 12 });
        const water = bot.findBlock({ matching: b => b.name === 'water', maxDistance: 32 });

        self.perception = {
          pos: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
          isNight: (bot.time?.timeOfDay || 0) > 13000,
          health: bot.health, food: bot.food,
          monsters, animals, players,
          lava: lava ? { dist: Math.round(pos.distanceTo(lava.position)), pos: lava.position } : null,
          water: water ? { dist: Math.round(pos.distanceTo(water.position)) } : null,
          invCount: bot.inventory.items().length,
          threatScore: calcThreatScore(bot), // 이전 라운드 Part A 재사용 (중복 계산 방지)
          updatedAt: Date.now(),
        };
        self.perception.urgentFlag =
          (lava && self.perception.lava.dist < 6) ? 'LAVA_NEARBY'
          : (monsters.length && monsters[0].dist < 8) ? `MONSTER_${monsters[0].name.toUpperCase()}`
          : null;
      }
    } catch (e) { /* Perception은 절대 죽으면 안 됨 — 조용히 무시 */ }
    await sleep(PERCEPTION_INTERVAL_MS);
  }
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON I] Goal Generation — 사건을 "힌트"로만 제공, 판단은 항상 GPT 자유
// ════════════════════════════════════════════════════════════════════════

const GOAL_RULES = [
  {
    id: 'recent_death',
    check: (p, self) => {
      const d = self.state.last_death;
      if (!d) return false;
      return (Date.now() - new Date(d.time).getTime()) < 5 * 60 * 1000; // 마인크래프트 아이템 소멸 시간(5분)과 동일
    },
    hint: (self) => {
      const d = self.state.last_death;
      const posText = d.position ? `(${d.position.x}, ${d.position.y}, ${d.position.z})` : '알 수 없는 곳';
      return `얼마 전 ${posText}에서 죽었고, 그때 가진 물건이 그 자리에 남아있을 것이다. 회수할지 포기할지는 스스로 판단하라.`;
    },
    priority: 65,
  },
  { id: 'hunger', check: (p) => p && p.food < 8, hint: () => '배고픔이 심하다. 방치하면 몸이 상한다.', priority: 80 },
  { id: 'night_no_shelter', check: (p, self) => p && p.isNight && !self.state.home_location, hint: () => '밤인데 아직 안전한 잠자리가 없다.', priority: 70 },
  { id: 'inventory_full', check: (p) => p && p.invCount >= 30, hint: () => '가방이 거의 가득 찼다.', priority: 55 },
  {
    id: 'repeated_failure',
    check: (p, self) => (self.actionHistory || []).slice(-6).filter(h => h.outcome === 'FAILURE').length >= 4,
    hint: () => '같은 방식이 계속 안 먹히고 있다. 다른 방법을 생각해볼 때다.',
    priority: 50,
  },
];

function generateGoalHints(bot, self) {
  const p = self.perception;
  return GOAL_RULES.filter(r => r.check(p, self)).sort((a, b) => b.priority - a.priority).slice(0, 3).map(r => r.hint(self));
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON J] Action Awareness — 예상 vs 실제 비교
// 주의: recordFailure/maybeAutoLearn은 이미 Part E의 executeDecision
// 오버라이드 안에서 매 호출마다 자동 실행되므로, 여기서 다시 호출하지 않는다
// (중복 호출 시 학습 임계치가 절반 속도로 조기 발동하는 부작용을 방지).
// ════════════════════════════════════════════════════════════════════════

const ACTION_EXPECTATIONS = {
  explore: () => '새로운 지형이나 자원을 발견할 것이다',
  gather_wood: () => '원목을 얻을 것이다',
  mine: (t) => `${t || '광물'}을 얻을 것이다`,
  craft_item: (t) => `${t || '아이템'}이 만들어질 것이다`,
  build_shelter: () => '지붕이 있는 구조물이 생길 것이다',
  eat: () => '배고픔이 줄어들 것이다',
  smelt_item: (t) => `${t || '제련물'}이 제련되기 시작할 것이다`,
  place_block: (t) => `${t || '블록'}이 설치될 것이다`,
  go_home: () => '집 방향으로 이동이 시작될 것이다',
  store_items: () => '여분 물건이 상자에 들어갈 것이다',
  build_blueprint: (t) => `${t || '구조물'} 건설이 진행될 것이다`,
};

function expectOutcome(action, target) {
  const fn = ACTION_EXPECTATIONS[action];
  return fn ? fn(target) : `${action} 행동이 의도대로 진행될 것이다`;
}

async function executeWithAwareness(bot, self, item) {
  const expected = (item.expected && item.expected !== 'null') ? item.expected : expectOutcome(item.action, item.target);
  const actual = await executeDecision(bot, self, item); // Part E 체인을 그대로 통과

  const record = { action: item.action, target: item.target || null, expected, actual, outcome: looksLikeFailure(actual) ? 'FAILURE' : 'SUCCESS', time: new Date().toISOString() };
  self.actionHistory = self.actionHistory || [];
  self.actionHistory.push(record);
  if (self.actionHistory.length > 50) self.actionHistory.shift();

  console.log(`${record.outcome === 'SUCCESS' ? '✅' : '❌'} [Action Awareness] ${item.action} 예상="${expected}" 실제="${actual}"`);
  if (record.outcome === 'FAILURE') {
    await addMemory(self, `[예상과 다름] '${item.action}'을 하며 "${expected}"를 예상했지만, 실제로는 "${actual}"였다.`);
  }
  return actual;
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON K] 실제로 검색된 기억만 lastAccessed 갱신 (근사치가 아니라 정확한 구현)
// ════════════════════════════════════════════════════════════════════════

const _retrieveMemories_base = retrieveMemories;
retrieveMemories = async function (self, queryText, topK = 12) {
  const results = await _retrieveMemories_base(self, queryText, topK);
  if (results.length) {
    const now = new Date().toISOString();
    const retrievedIds = new Set(results.map(r => r.id));
    for (const m of self.memories) { if (retrievedIds.has(m.id)) m.lastAccessed = now; }
    saveJSON(`memories_${self.name}.json`, self.memories);
  }
  return results;
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON L] thinkAndAct 재정의 — 이 함수 하나만 "무엇을 할지" 결정한다
// update_plan/update_step/say/remember 등 원래 기능은 전부 유지
// ════════════════════════════════════════════════════════════════════════

thinkAndAct = async function (bot, self) {
  if (!bot.entity || !self.isAlive) return;

  const personality = loadOrCreatePersonality(self.name); // 매 사이클 새로 읽음 → 재시작 없이 즉시 반영
  const perc = self.perception || {};
  const pos = bot.entity.position;
  const goalHints = generateGoalHints(bot, self);

  const recentAwareness = (self.actionHistory || []).slice(-6);
  const awarenessText = recentAwareness.length
    ? recentAwareness.map(h => `  [${h.outcome}] ${h.action}${h.target ? `(${h.target})` : ''} → ${(h.actual || '').slice(0, 50)}`).join('\n')
    : '  아직 없음';
  const failingActions = [...new Set(recentAwareness.filter(h => h.outcome === 'FAILURE').map(h => h.action))];

  const nearby = perc.players || Object.values(bot.entities).filter(e => e.type === 'player' && e.username !== self.name).map(e => e.username);
  const skillList = Object.keys(self.skills).length
    ? Object.entries(self.skills).map(([n, s]) => `- ${n}: ${s.description} (성공 ${s.successCount||0}/실패 ${s.failCount||0})`).join('\n')
    : '없음';
  const learnedNames = Object.keys(self.skills).join('/') || '없음';
  const homeText = self.state.home_location ? `X:${self.state.home_location.x}, Z:${self.state.home_location.z}` : '아직 없음';
  const poiText = self.state.poi?.length ? self.state.poi.map(p => `- ${p.label}: X:${p.x}, Z:${p.z}`).join('\n') : '아직 없음';

  const situationQuery = `${perc.isNight ? '밤' : '낮'} 생존 건축 도구 ${getEnvironmentReport(bot)}`;
  const relevantMemories = (await retrieveMemories(self, situationQuery, 10)).map(m => `- [중요도 ${m.importance}] ${m.description}`).join('\n');
  const insights = self.memories.filter(m => m.description.startsWith('[통찰]')).slice(-5).map(m => `- ${m.description.replace('[통찰] ', '')}`).join('\n');

  const prompt = `당신은 이 세계에서 살아가는 사람 '${self.name}'입니다.
목적: "${self.purpose}"

${buildPersonalityPrompt(personality)}

[나에 대한 통찰]
${insights || '아직 충분한 경험이 쌓이지 않았다.'}

[계획과 단계]
- 장기 계획: ${self.state.plan}
- 현재 단계: ${self.state.step}

[지금 신경쓸 만한 것들 — 참고만 하고 판단은 스스로]
${goalHints.length ? goalHints.map(h => `- ${h}`).join('\n') : '- 특별히 급한 건 없다.'}

[최근 행동과 예상 대비 결과]
${awarenessText}
${failingActions.length ? `⚠️ 계속 실패 중: ${failingActions.join(', ')} → 방법을 바꿔라` : ''}

[현재 상황]
- 위치/시간: X:${pos.x.toFixed(0)}, Z:${pos.z.toFixed(0)} / ${perc.isNight ? '밤' : '낮'}
- 신체: 체력 ${bot.health}/20, 배고픔 ${bot.food}/20
- 위협도: ${perc.threatScore ?? calcThreatScore(bot)}
- 가방: ${getDetailedInventory(bot)}
- 시야: ${getEnvironmentReport(bot)}
- 주변 사람: ${nearby.length ? nearby.join(', ') : '아무도 없음'}

[관련된 기억]
${relevantMemories || '없음'}

[알고 있는 장소]
- 집: ${homeText}
${poiText}

[직전 행동 결과]
${self.lastActionResult || '아직 없음'}

[절대 규칙]
1. 이 세계는 현실이다. "게임/시뮬레이션/AI" 같은 단어는 모른다.
2. 평소엔 생존과 작업에 집중하고, 특별한 사건에만 자연스럽게 반응하라.
3. [지금 신경쓸 만한 것들]은 참고 정보일 뿐, 반드시 따를 필요는 없다. 최종 판단은 네 몫이다.

[할 수 있는 행동]
explore, gather_wood, mine, follow, rest, eat, place_block, craft_item, build_shelter,
mark_home, go_home, mark_poi, store_items, smelt_item, build_blueprint, manage_project,
smart_store, check_status, learn_skill, ${learnedNames}

[배운 기술]
${skillList}

[지시]
1. actions 배열에 최대 3개까지, 순서대로.
2. 각 action에 "expected"(잘 되면 어떤 결과를 기대하는지, 한 문장)를 적어도 되고, 안 적어도 된다.
반드시 아래 JSON 형식만 출력:
{"update_plan":"...","update_step":"...","thought":"(짧고 실용적인 속마음)","actions":[{"action":"...","target":"(없으면 null)","label":"(mark_poi일때만)","skill_name":"(learn_skill일때만)","skill_goal":"(learn_skill일때만)","expected":"(없으면 null)"}],"say":"(없으면 null)","remember":"(없으면 null)"}`;

  console.log(`🧠 [CC] ${self.name} 판단 중... [단계: ${self.state.step}]`);
  let raw;
  try {
    const completion = await openai.chat.completions.create({ model: MAIN_MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } });
    raw = completion.choices[0].message.content;
  } catch (e) { console.error(`⚠️ GPT 호출 실패:`, e.message); return; }

  const decision = extractJSON(raw);
  if (!decision) { console.warn('⚠️ JSON 파싱 실패'); return; }

  if (decision.update_plan) self.state.plan = decision.update_plan;
  if (decision.update_step) self.state.step = decision.update_step;
  saveJSON(`state_${self.name}.json`, self.state);
  if (decision.remember && decision.remember !== 'null') await addMemory(self, decision.remember);
  if (decision.say && decision.say !== 'null') bot.chat(sanitize(decision.say));

  console.log(`🗺️ 계획: ${self.state.plan} | 🎯 단계: ${self.state.step}`);
  console.log(`💭 속마음: ${decision.thought}`);

  const actionList = Array.isArray(decision.actions) && decision.actions.length ? decision.actions.slice(0, 3) : [];
  if (!actionList.length) { console.warn('⚠️ 실행할 행동이 없음'); return; }

  console.log(`🚶 실행: ${actionList.map(a => a.action).join(' → ')}`);
  const resultParts = [];
  for (const item of actionList) {
    const resultText = await executeWithAwareness(bot, self, item);
    resultParts.push(`[${item.action}] ${resultText}`);
    if (looksLikeFailure(resultText)) { console.log(`⚠️ 연쇄 중단: ${resultText}`); break; }
  }
  self.lastActionResult = resultParts.join(' ');
  console.log(`📝 [결과] ${self.lastActionResult}`);
  await addMemory(self, self.lastActionResult);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON M] Reflex Loop 확장 — Perception의 urgentFlag만 읽어서 즉각 반응
// ════════════════════════════════════════════════════════════════════════

const _reflexLoop_base = reflexLoop;
reflexLoop = async function (bot, self) {
  await _reflexLoop_base(bot, self); // 배고픔 자동 섭취 + 기존 몬스터 대응 그대로 유지
  try {
    if (!bot.entity) return;
    const perc = self.perception;
    if (perc?.urgentFlag === 'LAVA_NEARBY' && perc.lava?.pos) {
      const pos = bot.entity.position;
      const lp = perc.lava.pos;
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x + (pos.x - lp.x) * 2, pos.z + (pos.z - lp.z) * 2));
      console.log('🔥 [Reflex] 용암 근접 감지 → 즉시 반대 방향 이동');
    }
    const creeper = bot.nearestEntity(e => e.name === 'creeper' && bot.entity.position.distanceTo(e.position) < 5);
    if (creeper) {
      const pos = bot.entity.position;
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x + (pos.x - creeper.position.x) * 3, pos.z + (pos.z - creeper.position.z) * 3));
      console.log('💨 [Reflex] 크리퍼 근접 → 후퇴');
    }
  } catch (e) { /* 반사신경은 절대 죽으면 안 됨 */ }
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON N] Perception Loop를 독립적으로 시작 — 기존 메인 루프는 절대 중복시키지 않음
// ════════════════════════════════════════════════════════════════════════

const _liveLoop_base = liveLoop;
liveLoop = async function (bot, self) {
  if (!self.__perceptionStarted) {
    self.__perceptionStarted = true;
    perceptionLoop(bot, self).catch(e => console.error('⚠️ [Perception] 종료:', e.message));
    attachStructuredDeathLogger(bot, self);
    console.log('🔍 [Perception] 독립 인식 루프 시작 (12초 주기, API 비용 없음)');
  }
  return _liveLoop_base(bot, self); // 기존 while 루프(45초 사이클, thinkAndAct/reactToChat)는 손대지 않음
};

console.log('🚀 [PATCH F~N] PIANO식 병렬 감각 모듈 + Action Awareness + Goal 힌트 + 성격 분리 로드 완료');
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON O] 연속 채집 코어 — 한 블록만 캐고 멈추던 문제 해결
// 위협/배고픔/체력 임계치를 매 블록마다 체크해서 안전을 확보한다.
// ════════════════════════════════════════════════════════════════════════

async function continuousGather(bot, self, targetNames, maxCount = 12, reachRadius = 6) {
  let gathered = 0;
  let lastName = '';

  while (gathered < maxCount) {
    if (!bot.entity || !self.isAlive) break;

    // 안전 우선 — Part H(Perception)의 위협 플래그를 그대로 재사용
    if (self.perception?.urgentFlag) { console.log(`⚠️ [연속채집 중단] 위험 감지: ${self.perception.urgentFlag}`); break; }
    if (bot.food < 6) { console.log('🍖 [연속채집 중단] 배고픔 임계'); break; }
    if (bot.health < 6) { console.log('❤️ [연속채집 중단] 체력 임계'); break; }

    const block = bot.findBlock({ matching: b => targetNames.includes(b.name), maxDistance: reachRadius });
    if (!block) break;

    const dist = bot.entity.position.distanceTo(block.position);
    if (dist > 4) {
      try { await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z)); }
      catch { break; }
    }

    await equipBestTool(bot, block.name);
    await smoothLookAt(bot, block.position.offset(0.5, 0.5, 0.5), 250);

    try {
      await bot.dig(block);
      gathered++;
      lastName = block.name;
      await sleep(150); // 인간 같은 짧은 텀
    } catch { break; }
  }
  return { count: gathered, name: lastName };
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON P] 부드러운 시선 처리 — 실제 bot.lookAt 내부 공식과 동일하게 계산
// + 각도가 -180~180도 경계를 넘을 때 "먼 길로 도는" 문제를 정규화로 방지
// ════════════════════════════════════════════════════════════════════════

function normalizeAngleDiff(diff) {
  return ((diff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

async function smoothLookAt(bot, targetPos, durationMs = 300) {
  if (!bot.entity) return;
  const dx = targetPos.x - bot.entity.position.x;
  const dy = targetPos.y - (bot.entity.position.y + bot.entity.height);
  const dz = targetPos.z - bot.entity.position.z;

  const targetYaw = Math.atan2(-dx, -dz);               // 실제 mineflayer 내부 공식과 동일
  const groundDist = Math.sqrt(dx * dx + dz * dz);
  const targetPitch = Math.atan2(dy, groundDist);        // 부호 반전 없음(실제 공식과 동일)

  const startYaw = bot.entity.yaw;
  const startPitch = bot.entity.pitch;
  const yawDiff = normalizeAngleDiff(targetYaw - startYaw); // 최단 경로로 회전
  const pitchDiff = targetPitch - startPitch;

  const steps = Math.max(3, Math.round(durationMs / 50));
  for (let i = 1; i <= steps; i++) {
    if (!bot.entity) return;
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 3); // ease-out
    try { await bot.look(startYaw + yawDiff * ease, startPitch + pitchDiff * ease, true); } catch {}
    await sleep(50);
  }
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON Q] gather_wood/mine을 그대로 두되, 내부 동작만 연속 채집으로 교체
// GPT 프롬프트나 스킬 목록은 전혀 손댈 필요 없음 — 즉시 효과 발생
// ════════════════════════════════════════════════════════════════════════

const _performBuiltinAction_beforeMotion = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (!bot.entity) return '봇이 아직 스폰되지 않았다.';
  const pos = bot.entity.position;

  if (action === 'gather_wood') {
    const woodTypes = ['oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log'];
    const first = bot.findBlock({ matching: b => woodTypes.includes(b.name), maxDistance: 32 });
    if (!first) {
      bot.pathfinder.setGoal(new goals.GoalXZ(pos.x+(Math.random()-.5)*40, pos.z+(Math.random()-.5)*40));
      return '나무를 찾지 못해 숲을 헤맸다.';
    }
    try { await bot.pathfinder.goto(new goals.GoalBlock(first.position.x, first.position.y, first.position.z)); } catch {}
    const result = await continuousGather(bot, self, woodTypes, 14, 6);
    return result.count > 0 ? `${result.name} 등 나무를 연속으로 ${result.count}개 베어냈다.` : '나무를 베려 했으나 실패했다.';
  }

  if (action === 'mine') {
    const oreTypes = ['stone','cobblestone','coal_ore','iron_ore','deepslate_coal_ore','deepslate_iron_ore','copper_ore','deepslate'];
    const first = bot.findBlock({ matching: b => oreTypes.includes(b.name), maxDistance: 20 });
    if (!first) return '광맥을 찾지 못했다.';
    try { await bot.pathfinder.goto(new goals.GoalBlock(first.position.x, first.position.y, first.position.z)); } catch {}
    const result = await continuousGather(bot, self, oreTypes, 10, 5);
    return result.count > 0 ? `${result.name} 등을 연속으로 ${result.count}개 채굴했다.` : '광맥을 캐려 했으나 실패했다.';
  }

  return await _performBuiltinAction_beforeMotion(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON R] 가만히 있을 때 마네킹처럼 굳지 않도록 — 기존 reflexLoop 확장
// (Part M에서 이미 확장된 reflexLoop 위에 한 번 더 얹는 구조, 기존 기능 전부 유지)
// ════════════════════════════════════════════════════════════════════════

const _reflexLoop_beforeIdle = reflexLoop;
reflexLoop = async function (bot, self) {
  await _reflexLoop_beforeIdle(bot, self); // 배고픔/몬스터 대응/용암·크리퍼 회피 전부 유지
  try {
    if (!bot.entity) return;
    const isIdle = !bot.pathfinder.isMoving() && !bot.targetDigBlock;
    if (isIdle && Math.random() < 0.12) {
      const yawOffset = (Math.random() - 0.5) * 1.2;
      const pitchOffset = (Math.random() - 0.5) * 0.4;
      try { await bot.look(bot.entity.yaw + yawOffset, bot.entity.pitch + pitchOffset, true); } catch {}
      if (Math.random() < 0.25) { try { bot.swingArm(); } catch {} }
    }
  } catch {}
};

console.log('🚶 [PATCH O~R] 연속 채집 + 부드러운 시선(정확한 회전 공식) + 유휴 두리번거림 로드 완료');
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON S] 기술 트리 — 텍스트 힌트가 아니라, 다음 단계로 가는 실제 행동을
// 배열로 정의해서 태스크 큐에 그대로 투입할 수 있게 한다.
// ════════════════════════════════════════════════════════════════════════

const TECH_TREE = [
  {
    id: 0, name: '맨손',
    check: () => true,
    nextActions: [
      { action: 'gather_wood', target: null, expected: '원목을 얻는다' },
      { action: 'craft_item', target: 'crafting_table', expected: '작업대가 생긴다' },
      { action: 'craft_item', target: 'wooden_pickaxe', expected: '나무 곡괭이가 생긴다' },
    ],
  },
  {
    id: 1, name: '나무 도구',
    check: (bot) => bot.inventory.items().some(i => /wooden_(pickaxe|axe|sword|shovel)/.test(i.name)),
    nextActions: [
      { action: 'mine', target: 'stone', expected: '돌을 얻는다' },
      { action: 'craft_item', target: 'stone_pickaxe', expected: '돌 곡괭이가 생긴다' },
      { action: 'craft_item', target: 'stone_axe', expected: '돌 도끼가 생긴다' },
    ],
  },
  {
    id: 2, name: '돌 도구',
    check: (bot) => bot.inventory.items().some(i => /stone_(pickaxe|axe|sword|shovel)/.test(i.name)),
    nextActions: [
      { action: 'mine', target: 'iron_ore', expected: '철광석을 얻는다' },
      { action: 'craft_item', target: 'furnace', expected: '화로가 생긴다' },
      { action: 'smelt_item', target: 'iron_ingot', expected: '철이 제련된다' },
    ],
  },
  {
    id: 3, name: '철 도구',
    check: (bot) => bot.inventory.items().some(i => /iron_(pickaxe|axe|sword|shovel)/.test(i.name)),
    nextActions: [
      { action: 'mine', target: 'diamond_ore', expected: '다이아몬드를 얻는다' },
      { action: 'craft_item', target: 'diamond_pickaxe', expected: '다이아 곡괭이가 생긴다' },
    ],
  },
  {
    id: 4, name: '다이아몬드 도구',
    check: (bot) => bot.inventory.items().some(i => /diamond_(pickaxe|axe|sword|shovel)/.test(i.name)),
    nextActions: [], // 최고 단계 — 강제 큐 없음, 이후는 완전히 GPT 자유 판단
  },
];

function detectTechStage(bot) {
  let current = TECH_TREE[0];
  for (let i = TECH_TREE.length - 1; i >= 0; i--) {
    if (TECH_TREE[i].check(bot)) { current = TECH_TREE[i]; break; }
  }
  return current;
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON T] 집 품질 평가 — S~D 등급으로 점수화, 부족한 것을 명시적으로 뽑아낸다
// ════════════════════════════════════════════════════════════════════════

const MATERIAL_SCORES = {
  dirt: 1, sand: 1, gravel: 1,
  oak_log: 2, birch_log: 2, spruce_log: 2, jungle_log: 2, acacia_log: 2, dark_oak_log: 2,
  oak_planks: 3, birch_planks: 3, spruce_planks: 3,
  cobblestone: 4, stone: 5, stone_bricks: 6,
};

function evaluateShelterQuality(bot, self) {
  const home = self.state.home_location;
  if (!home) return null;
  const scanRadius = 8;
  let totalMaterialScore = 0, blockCount = 0;
  let hasLight = false, hasBed = false, hasChest = false, hasCraftingTable = false, hasFurnace = false;

  for (let dx = -scanRadius; dx <= scanRadius; dx++) {
    for (let dy = -2; dy <= 4; dy++) {
      for (let dz = -scanRadius; dz <= scanRadius; dz++) {
        const b = bot.blockAt(new Vec3(home.x + dx, home.y + dy, home.z + dz));
        if (!b || b.name === 'air') continue;
        const matScore = MATERIAL_SCORES[b.name];
        if (matScore) { totalMaterialScore += matScore; blockCount++; }
        if (['torch', 'lantern', 'glowstone', 'sea_lantern'].includes(b.name)) hasLight = true;
        if (b.name.includes('bed')) hasBed = true;
        if (b.name === 'chest') hasChest = true;
        if (b.name === 'crafting_table') hasCraftingTable = true;
        if (b.name === 'furnace') hasFurnace = true;
      }
    }
  }

  const avgMaterialScore = blockCount > 0 ? totalMaterialScore / blockCount : 0;
  const sizeScore = Math.min(10, blockCount / 5);
  const amenityScore = [hasLight, hasBed, hasChest, hasCraftingTable, hasFurnace].filter(Boolean).length * 2;
  const totalScore = Math.round(avgMaterialScore * 3 + sizeScore * 2 + amenityScore);
  const grade = totalScore >= 40 ? 'S' : totalScore >= 30 ? 'A' : totalScore >= 20 ? 'B' : totalScore >= 10 ? 'C' : 'D';
  const missing = [!hasLight && '조명', !hasBed && '침대', !hasChest && '상자', !hasCraftingTable && '작업대', !hasFurnace && '화로'].filter(Boolean);

  return { score: totalScore, grade, blockCount, hasLight, hasBed, hasChest, hasCraftingTable, hasFurnace, missing };
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON U] 기술/집 평가를 20초마다 영구적으로 재계산하는 독립 루프
// (기존 perceptionLoop를 건드리지 않고 완전히 별개로 만들어 "1회성 실행" 위험을 원천 차단)
// ════════════════════════════════════════════════════════════════════════

async function techHomeEvalLoop(bot, self) {
  while (self.isAlive) {
    try {
      if (bot.entity) {
        const stage = detectTechStage(bot);
        self.perception = self.perception || {};
        self.perception.techTier = stage;

        const prevStageId = self.state.tech_stage_id ?? -1;
        if (stage.id > prevStageId) {
          self.state.tech_stage_id = stage.id;
          saveJSON(`state_${self.name}.json`, self.state);
          addMemory(self, `[기술 발전] '${stage.name}' 단계에 도달했다.`).catch(() => {});
          console.log(`⚙️ [기술트리] 단계 상승: ${stage.name} (id=${stage.id})`);
        }

        if (self.state.home_location) {
          const shelter = evaluateShelterQuality(bot, self);
          self.perception.shelterQuality = shelter;
          const prevGrade = self.state.shelter_grade;
          if (shelter && shelter.grade !== prevGrade) {
            self.state.shelter_grade = shelter.grade;
            saveJSON(`state_${self.name}.json`, self.state);
            addMemory(self, `[집 평가] 집 품질이 '${shelter.grade}'등급(${shelter.score}점)으로 확인됐다. 부족한 것: ${shelter.missing.join(', ') || '없음'}.`).catch(() => {});
          }
        }
      }
    } catch (e) { /* 평가 루프는 절대 죽으면 안 됨 */ }
    await sleep(20000);
  }
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON V] 태스크 큐 — push/peek/shift가 self.state.taskQueue를 실제로 조작한다.
// 침대 제작은 의도적으로 자동 큐에서 제외한다(양이 근처에 없으면 3회 실패만 반복하는
// 낭비를 방지하기 위한 설계 판단).
// ════════════════════════════════════════════════════════════════════════

function initTaskQueue(self) {
  if (!self.state.taskQueue) self.state.taskQueue = [];
  if (!self.state.taskQueueMeta) self.state.taskQueueMeta = { goalName: null };
}
function pushTaskQueue(self, goalName, tasks) {
  initTaskQueue(self);
  self.state.taskQueue = tasks.map(t => ({ ...t, _retryCount: 0 }));
  self.state.taskQueueMeta = { goalName, injectedAt: new Date().toISOString() };
  saveJSON(`state_${self.name}.json`, self.state);
  console.log(`📋 [태스크 큐] '${goalName}' → ${tasks.length}단계 등록: ${tasks.map(t => t.action).join(' → ')}`);
}
function peekTaskQueue(self) { initTaskQueue(self); return self.state.taskQueue.length ? self.state.taskQueue[0] : null; }
function shiftTaskQueue(self) {
  initTaskQueue(self);
  const done = self.state.taskQueue.shift();
  saveJSON(`state_${self.name}.json`, self.state);
  console.log(`✅ [태스크 큐] '${done?.action}' 완료. 남은: ${self.state.taskQueue.length}개`);
  return done;
}
function bumpRetryAndMaybeClear(self) {
  initTaskQueue(self);
  const task = self.state.taskQueue[0];
  if (!task) return;
  task._retryCount = (task._retryCount || 0) + 1;
  saveJSON(`state_${self.name}.json`, self.state); // 재시도 횟수를 즉시 저장(재시작해도 유지)
  if (task._retryCount >= 3) {
    addMemory(self, `[포기] '${task.action}(${task.target || ''})'을 3회 시도했지만 실패해서 다른 방법을 찾기로 했다.`).catch(() => {});
    self.state.taskQueue = [];
    self.state.taskQueueMeta = { goalName: null };
    saveJSON(`state_${self.name}.json`, self.state);
    console.log('🗑️ [태스크 큐] 3회 실패로 초기화 → GPT 자유 판단으로 복귀');
  }
}

function maybeInjectTechTasks(bot, self) {
  initTaskQueue(self);
  if (self.state.taskQueue.length > 0) return;
  const priority = computePriority(bot, self); // 이전 라운드 Part A 재사용
  if (priority.level === 'EMERGENCY' || priority.level === 'CRITICAL') return;
  const stage = detectTechStage(bot);
  const nextStage = TECH_TREE[stage.id + 1];
  if (!nextStage) return;
  if (nextStage.check(bot)) return; // 이미 다음 단계에 도달했으면 주입 불필요
  const actions = stage.nextActions;
  if (!actions || !actions.length) return;
  pushTaskQueue(self, `기술 발전: ${nextStage.name}로 진행`, actions);
}

function maybeInjectShelterUpgrade(bot, self) {
  initTaskQueue(self);
  if (self.state.taskQueue.length > 0) return;
  if (!self.state.home_location) return;
  const shelter = evaluateShelterQuality(bot, self);
  if (!shelter) return;
  const tasks = [];
  if (shelter.grade === 'D' || shelter.grade === 'C') {
    tasks.push({ action: 'gather_wood', target: null, expected: '건축 재료 확보' });
    tasks.push({ action: 'mine', target: 'stone', expected: '건축 재료 확보' });
    tasks.push({ action: 'build_shelter', target: null, expected: '더 튼튼한 구조물' });
  }
  if (!shelter.hasChest) tasks.push({ action: 'craft_item', target: 'chest', expected: '상자 제작' }, { action: 'place_block', target: 'chest', expected: '상자 설치' });
  if (!shelter.hasFurnace) tasks.push({ action: 'craft_item', target: 'furnace', expected: '화로 제작' }, { action: 'place_block', target: 'furnace', expected: '화로 설치' });
  if (!shelter.hasLight) tasks.push({ action: 'craft_item', target: 'torch', expected: '조명 제작' }, { action: 'place_block', target: 'torch', expected: '조명 설치' });
  if (tasks.length) pushTaskQueue(self, `집 개선 (${shelter.grade}등급 → 상향)`, tasks);
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON W] 기술/집 상태를 기존 힌트 스트림에 자연스럽게 편입
// (Part I의 GOAL_RULES가 이미 확장 가능하게 설계되어 있어, 여기서는 항목만 추가한다)
// ════════════════════════════════════════════════════════════════════════

GOAL_RULES.push(
  {
    id: 'tech_tree_hint',
    check: (p) => !!p?.techTier,
    hint: (self) => {
      const stage = self.perception.techTier;
      const nextStage = TECH_TREE[stage.id + 1];
      return nextStage
        ? `현재 기술 단계는 '${stage.name}'이다. 다음 단계(${nextStage.name})로 가려면 도구를 업그레이드해야 한다.`
        : `이미 최고 기술 단계(${stage.name})에 도달했다.`;
    },
    priority: 45,
  },
  {
    id: 'shelter_quality_hint',
    check: (p) => !!p?.shelterQuality && (p.shelterQuality.grade === 'D' || p.shelterQuality.grade === 'C'),
    hint: (self) => {
      const s = self.perception.shelterQuality;
      return `지금 집은 '${s.grade}'등급(${s.score}점)으로 부실하다. 부족한 것: ${s.missing.join(', ') || '재료'}. 더 나은 재료로 다시 지어야 안전하다.`;
    },
    priority: 42,
  }
);
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON X] 큐에 할 일이 있으면 GPT를 부르지 않고 바로 실행하고,
// 큐가 비어있을 때만 지난 라운드의 Part L(자유 판단)을 그대로 위임 호출한다.
// Part L 코드는 단 한 줄도 다시 작성하지 않는다 — 중복/유지보수 리스크 제거.
// ════════════════════════════════════════════════════════════════════════

const _thinkAndAct_beforeQueue = thinkAndAct; // Part L에서 정의된 자유 판단 버전 그대로 보존
thinkAndAct = async function (bot, self) {
  if (!bot.entity || !self.isAlive) return;
  initTaskQueue(self);

  const priority = computePriority(bot, self);
  const isEmergency = priority.level === 'EMERGENCY' || priority.level === 'CRITICAL';

  if (!isEmergency && self.state.taskQueue.length === 0) {
    maybeInjectTechTasks(bot, self);
    if (self.state.taskQueue.length === 0) maybeInjectShelterUpgrade(bot, self);
  }

  const queuedTask = !isEmergency ? peekTaskQueue(self) : null;
  if (queuedTask) {
    console.log(`📋 [CC-큐] '${self.state.taskQueueMeta?.goalName}' → 실행: ${queuedTask.action}${queuedTask.target ? `(${queuedTask.target})` : ''}`);
    const resultText = await executeWithAwareness(bot, self, queuedTask); // 이전 라운드 Part J 재사용
    self.lastActionResult = `[큐] ${resultText}`;
    console.log(`📝 [큐 결과] ${self.lastActionResult}`);
    await addMemory(self, self.lastActionResult);
    if (!looksLikeFailure(resultText)) shiftTaskQueue(self);
    else bumpRetryAndMaybeClear(self);
    return; // GPT를 호출하지 않고 이번 사이클을 끝냄 → 비용 0원
  }

  if (isEmergency) console.log(`🚨 [CC] 긴급 상황(${priority.reason}) — 큐 보류, 즉시 자유 판단으로 전환`);
  return _thinkAndAct_beforeQueue(bot, self); // 큐가 없을 때만 기존 자유 판단 전체 실행
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON Y] 기술/집 평가 루프를 시작 — Part N의 래핑 패턴을 그대로 재사용
// ════════════════════════════════════════════════════════════════════════

const _liveLoop_beforeTechEval = liveLoop; // 이전 라운드에서 이미 한 번 래핑된 버전
liveLoop = async function (bot, self) {
  if (!self.__techEvalStarted) {
    self.__techEvalStarted = true;
    techHomeEvalLoop(bot, self).catch(e => console.error('⚠️ [기술/집 평가] 종료:', e.message));
    console.log('⚙️ [기술/집 평가] 독립 루프 시작 (20초 주기, API 비용 없음)');
  }
  return _liveLoop_beforeTechEval(bot, self);
};

console.log('🚀 [PATCH S~Y] 기술 트리 + 집 품질 평가(독립 루프) + 태스크 큐(GPT 우회 실행) + Goal Hints 연동 완료');
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON Z] 지속 전투 루프 — "한 번 치고 끝"이 아니라 위협이 사라지거나
// 위험해질 때까지 지속되는 전투. 방어구 유무에 따라 도주 임계치를 다르게 잡는다.
// ════════════════════════════════════════════════════════════════════════

const HOSTILE_MOBS = ['zombie','skeleton','creeper','spider','witch','enderman','phantom','drowned','husk','stray'];
const PASSIVE_MOBS = ['cow','pig','sheep','chicken','rabbit'];
const COMBAT_ENGAGE_RADIUS = 10;
const COMBAT_FLEE_HEALTH = 7;
const COMBAT_EAT_BEFORE_FIGHT_FOOD = 15;

async function combatLoop(bot, self) {
  if (self.__inCombat) return;
  const pos = bot.entity?.position;
  if (!pos) return;

  const threat = bot.nearestEntity(e => e.position && HOSTILE_MOBS.includes(e.name) && pos.distanceTo(e.position) < COMBAT_ENGAGE_RADIUS);
  if (!threat) return;

  self.__inCombat = true;
  console.log(`⚔️ [전투] ${threat.name} 감지(${Math.round(pos.distanceTo(threat.position))}블록) → 대응 시작`);

  try {
    if (bot.food < COMBAT_EAT_BEFORE_FIGHT_FOOD) {
      const food = bot.inventory.items().find(i => ['bread','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton','apple','carrot','potato'].some(f => i.name.includes(f)));
      if (food) { try { await bot.equip(food, 'hand'); await bot.consume(); } catch {} }
    }
    await equipBestTool(bot, 'combat');

    const hasArmor = bot.inventory.items().some(i => /(helmet|chestplate|leggings|boots)/.test(i.name));
    const fleeHealth = hasArmor ? COMBAT_FLEE_HEALTH : COMBAT_FLEE_HEALTH + 3; // 방어구 없으면 더 일찍 도망

    let ticks = 0;
    while (self.isAlive && ticks < 30) {
      ticks++;
      const current = bot.entities[threat.id];
      if (!current) { console.log(`✅ [전투] ${threat.name} 처치 또는 이탈`); break; }

      if (bot.health <= fleeHealth) {
        const p = bot.entity.position, tp = current.position;
        bot.pathfinder.setGoal(new goals.GoalXZ(p.x + (p.x - tp.x) * 3, p.z + (p.z - tp.z) * 3));
        console.log(`🏃 [전투] 체력 ${bot.health} → 도주 (방어구: ${hasArmor ? '있음' : '없음'})`);
        await addMemory(self, `[도주] 체력이 낮아 ${threat.name}에게서 도망쳤다.`).catch(() => {});
        break;
      }

      if (current.name === 'creeper') {
        const p = bot.entity.position, cp = current.position;
        if (p.distanceTo(cp) < 4) {
          bot.pathfinder.setGoal(new goals.GoalXZ(p.x + (p.x - cp.x) * 2, p.z + (p.z - cp.z) * 2));
          await sleep(300);
        } else { try { bot.attack(current); } catch {} }
      } else {
        const dist = bot.entity.position.distanceTo(current.position);
        if (dist > 3) { try { await bot.pathfinder.goto(new goals.GoalNear(current.position.x, current.position.y, current.position.z, 2)); } catch {} }
        try { bot.attack(current); } catch {}
        if (Math.random() < 0.3) { // 제자리 맞딜 방지 — 가끔 한 발 물러나며 치기
          bot.setControlState('back', true);
          setTimeout(() => { try { bot.setControlState('back', false); } catch {} }, 350);
        }
      }
      await sleep(500);
    }
  } finally {
    self.__inCombat = false;
  }
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AA] 위협 점수(threatScore) 합산 방식 대신, "가까이에 실제로 있는가"로
// EMERGENCY를 판단한다. 좀비 1마리 6블록 거리는 점수 42로 EMERGENCY(80) 미달이었다.
// ════════════════════════════════════════════════════════════════════════

const _computePriority_beforeCombatFix = computePriority;
computePriority = function (bot, self) {
  const base = _computePriority_beforeCombatFix(bot, self);
  if (!bot.entity) return base;
  const pos = bot.entity.position;
  const near = bot.nearestEntity(e => e.position && HOSTILE_MOBS.includes(e.name) && pos.distanceTo(e.position) < 8);
  if (near) return { level: 'EMERGENCY', reason: `${near.name} 근접(${Math.round(pos.distanceTo(near.position))}블록)` };
  if (bot.health <= COMBAT_FLEE_HEALTH) return { level: 'EMERGENCY', reason: '체력 위험' };
  return base;
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AB] "이동을 시작했다"로 끝나고 다음 사이클이 그 이동을 취소해버려
// 아무것도 완성되지 않는 낭비를 막는다. 단, 전투가 끼어들면 대기를 즉시 포기한다.
// ════════════════════════════════════════════════════════════════════════

async function waitForMovementComplete(bot, self, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (self.__inCombat) return false; // 전투가 우선이다
    if (!bot.pathfinder.isMoving()) return true;
    await sleep(400);
  }
  return false;
}

const _performBuiltinAction_beforeWait = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  const result = await _performBuiltinAction_beforeWait(bot, self, action, target, label);
  if (['go_home', 'follow', 'explore'].includes(action)) {
    await waitForMovementComplete(bot, self, 12000);
  }
  return result;
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AC] 사냥 — GoalFollow로 계속 쫓으면서 근접 시 공격.
// ensureNativeActionsDiscoverable(Part E)을 확장해야 GPT가 실제로 이 행동의
// 존재를 프롬프트에서 알게 된다 (BUILTIN_ACTIONS 배열만으로는 프롬프트에 노출되지 않음).
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('hunt');

async function huntAnimal(bot, self) {
  const pos = bot.entity?.position;
  if (!pos) return '사냥할 수 없는 상태다.';
  const target = bot.nearestEntity(e => e.position && PASSIVE_MOBS.includes(e.name) && pos.distanceTo(e.position) < 32);
  if (!target) return '근처에 사냥할 동물이 보이지 않는다.';

  console.log(`🏹 [사냥] ${target.name} 추적 시작`);
  await equipBestTool(bot, 'combat');
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);

  let ticks = 0;
  while (self.isAlive && ticks < 16) {
    ticks++;
    const alive = bot.entities[target.id];
    if (!alive) break;
    if (bot.entity.position.distanceTo(alive.position) < 3) { try { bot.attack(alive); } catch {} }
    await sleep(500);
  }
  bot.pathfinder.setGoal(null);
  const stillAlive = !!bot.entities[target.id];
  return stillAlive ? '사냥을 시도했지만 동물을 놓쳤다.' : `${target.name}을 사냥해 전리품을 얻었다.`;
}

const _performBuiltinAction_beforeHunt = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'hunt') return await huntAnimal(bot, self);
  return await _performBuiltinAction_beforeHunt(bot, self, action, target, label);
};

const _ensureNativeActionsDiscoverable_beforeHunt = ensureNativeActionsDiscoverable;
ensureNativeActionsDiscoverable = function (self) {
  _ensureNativeActionsDiscoverable_beforeHunt(self);
  if (!self.skills['hunt']) {
    self.skills['hunt'] = { description: '근처 동물(소/돼지/양/닭/토끼)을 추적해 사냥한다. 배가 고플 때 유용하다. (네이티브)', code: '// native', isNative: true, successCount: 0, failCount: 0 };
    saveJSON(`skills_${self.name}.json`, self.skills);
    console.log('🧩 [네이티브 기능 등록] hunt');
  }
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AD] 기존 반사신경(2초 주기)에 지속 전투 루프를 연결
// ════════════════════════════════════════════════════════════════════════

const _reflexLoop_beforeCombatLoop = reflexLoop;
reflexLoop = async function (bot, self) {
  await _reflexLoop_beforeCombatLoop(bot, self);
  try {
    if (bot.entity && !self.__inCombat) await combatLoop(bot, self);
  } catch (e) { /* 반사신경은 절대 죽으면 안 됨 */ }
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AE] 법칙이 아니라 "경험적으로 알고 있는 상식"으로 기억에 심는다.
// addMemory()를 그대로 통해서 등록하기 때문에 임베딩이 정상적으로 생성되고,
// 일상적 사고 프롬프트의 관련 기억 검색에서도 자연스럽게 노출될 수 있다.
// ════════════════════════════════════════════════════════════════════════

const COMMON_SENSE_ITEMS = [
  '나무를 베면 판자를 얻고, 판자로 작업대와 기본 도구를 만들 수 있다.',
  '돌 도구는 나무 도구보다 오래 가고 더 강한 광물도 캘 수 있다. 기회가 되면 업그레이드하는 게 좋다.',
  '밤이 되면 위험한 존재들이 나타난다. 미리 안전한 곳을 확보해두면 편하다.',
  '배가 고프면 힘이 빠지고 회복이 멈춘다. 먹을 것을 챙겨두는 게 좋다.',
  '동물을 사냥하면 고기를 얻을 수 있고, 화로에 구우면 더 든든하다.',
  '상자에 물건을 보관해두면 죽어도 잃지 않는다. 귀한 물건일수록 몸에 지니지 않는 게 안전하다.',
  '화로와 철광석이 있으면 훨씬 강한 도구를 만들 수 있다.',
  '집에 침대가 있으면 밤을 건너뛸 수 있다.',
  '크리퍼는 가까이 다가오면 폭발한다. 멀리서 처리하거나 거리를 두는 게 안전하다.',
  '작업대 없이는 만들 수 있는 게 매우 제한적이다. 하나 만들어 갖고 다니면 편하다.',
  '갑옷이 있으면 전투에서 훨씬 오래 버틸 수 있다.',
];

async function seedCommonSense(self) {
  if (self.state.commonSenseSeeded) return;
  console.log('🌱 [상식 시딩] 생존 상식을 기억에 심는 중 (강제 규칙 아님, 참고용)...');
  for (const sense of COMMON_SENSE_ITEMS) {
    const entry = await addMemory(self, `[상식] ${sense}`);
    entry.importance = 7; // 경험 기억보다는 낮게 — 절대 법칙이 아니라 참고 상식
  }
  saveJSON(`memories_${self.name}.json`, self.memories);
  self.state.commonSenseSeeded = true;
  saveJSON(`state_${self.name}.json`, self.state);
  console.log(`✅ [상식 시딩] ${COMMON_SENSE_ITEMS.length}개 완료`);
}

const _liveLoop_beforeCommonSense = liveLoop;
liveLoop = async function (bot, self) {
  self.__botRef = bot; // Goal Hints의 check 함수가 인벤토리를 참조할 수 있게 함
  if (!self.__commonSenseSeedStarted) {
    self.__commonSenseSeedStarted = true;
    await seedCommonSense(self).catch(e => console.warn('⚠️ 상식 시딩 실패:', e.message));
  }
  return _liveLoop_beforeCommonSense(bot, self);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AF] self.__botRef(Part AE에서 저장)를 통해 인벤토리를 참조하는
// 안전한 방식으로 힌트를 추가한다. 모두 "참고만" 하는 힌트일 뿐 강제가 아니다.
// ════════════════════════════════════════════════════════════════════════

GOAL_RULES.push(
  {
    id: 'no_armor_hint',
    check: (p, self) => {
      const bot = self.__botRef;
      if (!bot) return false;
      const hasArmor = bot.inventory.items().some(i => /(helmet|chestplate|leggings|boots)/.test(i.name));
      return !hasArmor && (p?.monsters?.length > 0);
    },
    hint: () => '갑옷 없이 몬스터와 마주하고 있다. 방어구가 있으면 훨씬 안전하게 싸울 수 있다.',
    priority: 58,
  },
  {
    id: 'hunt_when_hungry',
    check: (p, self) => {
      const bot = self.__botRef;
      if (!bot || !p) return false;
      const hasFood = bot.inventory.items().some(i => ['bread','cooked','apple','carrot','potato'].some(f => i.name.includes(f)));
      return p.food < 12 && !hasFood && (p.animals?.length > 0);
    },
    hint: (self) => `배가 고픈데 먹을 게 없다. 근처에 동물(${self.perception.animals[0]?.name})이 보이니 사냥도 방법이다.`,
    priority: 62,
  },
  {
    id: 'post_combat_recovery',
    check: (p) => !!p && p.health < 12 && (p.threatScore ?? 0) < 20,
    hint: () => '방금까지 위험했던 것 같다. 안전한 곳에서 먹고 체력을 회복하는 게 먼저다.',
    priority: 48,
  }
);

console.log('🚀 [PATCH Z~AF] 지속 전투 루프 + 사냥 + 위협 감지 재조정 + 이동 완료 대기 + 상식 시딩 완료');
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AG] 성격 수치화 — Part F에서 만든 personality_Adam.json을
// 덮어쓰지 않고, 없는 필드만 채워서 병합한다 (사용자가 이미 수정했을 수 있으므로)
// ════════════════════════════════════════════════════════════════════════

const DEFAULT_PERSONALITY_CORE = {
  curiosity: 7, caution: 4, diligence: 8, sociability: 3, creativity: 6, pragmatism: 9,
};

function loadPersonalityV2(name) {
  const path = `personality_${name}.json`;
  let data = loadJSON(path, null) || {};
  let changed = false;
  if (!data.core) { data.core = { ...DEFAULT_PERSONALITY_CORE }; changed = true; }
  if (!data.speaking_style) { data.speaking_style = '짧고 담백하다. 한두 문장이면 충분하다고 생각한다.'; changed = true; }
  if (!data.quirks) { data.quirks = ['새로운 지형을 보면 일단 가보고 싶어한다', '도구가 닳으면 슬쩍 신경쓴다', '밤이 되면 말이 줄어든다']; changed = true; }
  if (!data.forbidden_patterns) { data.forbidden_patterns = ['나는 무엇인가', '존재의 의미', '철학적으로', '고뇌', '우주', '운명이란']; changed = true; }
  if (changed) { saveJSON(path, data); console.log(`🎭 [성격 V2] 기존 파일에 수치(core) 병합 완료 — 기존 필드는 유지됨`); }
  return data;
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AH] 가능성 스캐너 — 로컬 연산, API 비용 0원
// scanCurrentPossibilities: 지금 재료/도구로 바로 할 수 있는 것
// scanFutureAffordances: 재료가 없어도 "이걸 하면 좋겠다"를 계산 (mcData 레시피 기반)
// ════════════════════════════════════════════════════════════════════════

const _mcDataCache = {};
function getMcData(version) {
  if (!_mcDataCache[version]) _mcDataCache[version] = mcDataLoader(version);
  return _mcDataCache[version];
}

function scanCurrentPossibilities(bot) {
  if (!bot.entity) return [];
  const inv = bot.inventory.items();
  const invNames = inv.map(i => i.name);
  const mcData = getMcData(bot.version);
  const pos = bot.entity.position;
  const possibilities = [];

  const craftTargets = [
    { name: 'crafting_table', why: '작업대가 생겨 더 많은 것을 만들 수 있다', priority: 9, type: 'craft' },
    { name: 'wooden_pickaxe', why: '돌을 캘 수 있게 된다', priority: 8, type: 'craft' },
    { name: 'wooden_sword', why: '몬스터에 대응할 수 있다', priority: 7, type: 'craft' },
    { name: 'stone_pickaxe', why: '철광석을 캘 수 있게 된다', priority: 9, type: 'craft' },
    { name: 'stone_sword', why: '전투력이 오른다', priority: 7, type: 'craft' },
    { name: 'furnace', why: '제련과 조리가 가능해진다', priority: 9, type: 'craft' },
    { name: 'chest', why: '물건을 안전하게 보관할 수 있다', priority: 8, type: 'craft' },
    { name: 'torch', why: '밤에 몬스터가 나타나는 것을 막을 수 있다', priority: 7, type: 'craft' },
    { name: 'iron_pickaxe', why: '다이아몬드를 캘 수 있게 된다', priority: 10, type: 'craft' },
    { name: 'iron_sword', why: '전투력이 크게 오른다', priority: 9, type: 'craft' },
    { name: 'iron_helmet', why: '전투 생존율이 오른다', priority: 8, type: 'equip_armor' },
    { name: 'iron_chestplate', why: '전투 생존율이 크게 오른다', priority: 9, type: 'equip_armor' },
    { name: 'bow', why: '원거리에서 안전하게 처리할 수 있다', priority: 8, type: 'craft' },
    { name: 'shield', why: '공격을 막을 수 있다', priority: 7, type: 'craft' },
    { name: 'hoe', why: '농사를 시작할 수 있다', priority: 6, type: 'craft' },
  ];

  for (const ct of craftTargets) {
    if (invNames.includes(ct.name)) continue;
    const itemType = mcData.itemsByName[ct.name];
    if (!itemType) continue;
    const craftingTable = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 8 });
    let recipes = [];
    try { recipes = bot.recipesFor(itemType.id, null, 1, craftingTable); } catch {}
    if (recipes.length > 0) possibilities.push({ action: 'craft_item', target: ct.name, why: ct.why, priority: ct.priority, type: ct.type });
  }

  const hasFurnace = !!bot.findBlock({ matching: b => b.name === 'furnace', maxDistance: 16 });
  const hasFuel = invNames.some(n => ['coal', 'charcoal', 'log', 'planks'].some(f => n.includes(f)));
  if (hasFurnace && hasFuel) {
    if (invNames.some(n => ['raw_iron', 'iron_ore'].includes(n)))
      possibilities.push({ action: 'smelt_item', target: 'iron_ingot', why: '철을 얻어 도구와 갑옷을 만들 수 있다', priority: 9, type: 'smelt' });
    if (invNames.some(n => ['beef', 'porkchop', 'chicken', 'mutton'].includes(n)))
      possibilities.push({ action: 'smelt_item', target: 'cooked_beef', why: '고기를 구우면 더 든든하다', priority: 6, type: 'smelt' });
  }

  if (inv.some(i => /(helmet|chestplate|leggings|boots)/.test(i.name)))
    possibilities.push({ action: 'equip_armor', target: null, why: '가진 방어구를 입으면 방어력이 오른다', priority: 8, type: 'equip_armor' });

  const animals = Object.values(bot.entities).filter(e => e.position && PASSIVE_MOBS.includes(e.name) && pos.distanceTo(e.position) < 24);
  if (animals.length && bot.food < 16)
    possibilities.push({ action: 'hunt', target: null, why: `${animals[0].name}을 사냥해 고기를 얻을 수 있다`, priority: 7, type: 'hunt' });

  return possibilities;
}

// "재료가 없더라도" 요구사항을 위한 진짜 갭 계산 — mcData 레시피에서 부족한 재료를 뽑아낸다
function scanFutureAffordances(bot) {
  const mcData = getMcData(bot.version);
  const inv = bot.inventory.items().map(i => i.name);
  const GOAL_ITEMS = [
    { name: 'stone_pickaxe', why: '철광석을 캘 수 있게 된다' },
    { name: 'iron_pickaxe', why: '다이아몬드를 캘 수 있게 된다' },
    { name: 'diamond_pickaxe', why: '가장 단단한 광물까지 캘 수 있다' },
    { name: 'iron_chestplate', why: '전투 생존율이 크게 오른다' },
    { name: 'iron_sword', why: '전투력이 크게 오른다' },
    { name: 'shield', why: '공격을 막을 수 있다' },
    { name: 'furnace', why: '제련과 조리가 가능해진다' },
    { name: 'bow', why: '원거리 전투가 가능해진다' },
    { name: 'bed', why: '밤을 건너뛸 수 있다' },
  ];
  const results = [];
  for (const goal of GOAL_ITEMS) {
    if (inv.includes(goal.name)) continue;
    const itemType = mcData.itemsByName[goal.name];
    if (!itemType) continue;
    const recipeList = mcData.recipes?.[itemType.id];
    if (!recipeList || !recipeList.length) continue;
    const recipe = recipeList[0];
    const rawIds = recipe.ingredients || (recipe.inShape ? recipe.inShape.flat() : []);
    const neededNames = [...new Set(rawIds.filter(x => x !== null && x !== undefined).map(x => (typeof x === 'object' ? x.id : x)))]
      .map(id => mcData.items[id]?.name).filter(Boolean);
    const missing = neededNames.filter(n => !inv.includes(n));
    if (missing.length === 0) continue; // 이미 만들 수 있으면 현재 가능성 쪽에서 다룸
    results.push({ item: goal.name, why: goal.why, missing });
  }
  return results;
}

// 성격이 우선순위에 실제로 반영되는 계산식 — 정확히 ±20%
function applyPersonalityWeighting(possibilities, personality) {
  const core = personality.core || {};
  const traitMap = { craft: 'pragmatism', smelt: 'pragmatism', equip_armor: 'caution', hunt: 'pragmatism' };
  return possibilities.map(p => {
    const trait = core[traitMap[p.type] || 'pragmatism'] ?? 5;
    const weight = 1 + 0.2 * ((trait - 5) / 5); // trait=10→+20%, trait=0→-20%, trait=5→0%
    return { ...p, priority: Math.round(p.priority * weight * 10) / 10 };
  }).sort((a, b) => b.priority - a.priority);
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AI] generateGoalHints를 감싸서 가능성/성격 정보를 추가한다.
// openai.chat.completions.create를 직접 몽키패치하는 방식은 쓰지 않는다 —
// 프롬프트 문구가 바뀌면 조용히 고장 나는 취약한 방식이기 때문이다.
// ════════════════════════════════════════════════════════════════════════

const _generateGoalHints_beforeAffordance = generateGoalHints;
generateGoalHints = function (bot, self) {
  const baseHints = _generateGoalHints_beforeAffordance(bot, self);
  const extra = [];
  const personality = loadPersonalityV2(self.name);

  const currentList = applyPersonalityWeighting(scanCurrentPossibilities(bot), personality).slice(0, 4);
  if (currentList.length) extra.push(`[지금 당장 할 수 있는 것들]\n` + currentList.map(x => `- ${x.action}${x.target ? `(${x.target})` : ''} → ${x.why}`).join('\n'));

  const futureList = scanFutureAffordances(bot).slice(0, 3);
  if (futureList.length) extra.push(`[재료가 없어도 미리 생각해볼 만한 것들]\n` + futureList.map(x => `- ${x.item} → ${x.why} (부족: ${x.missing.join(', ')})`).join('\n'));

  const c = personality.core;
  extra.push(`[판단 참고 — 강제 아님] 진행 중인 계획을 대략 70% 비중으로 따르고, 성격(호기심${c.curiosity} 신중${c.caution} 성실${c.diligence} 창의${c.creativity} 실용${c.pragmatism} — 각 0~10)에 따른 판단을 약 20% 비중으로 섞는 편이 자연스럽다.`);

  return [...baseHints, ...extra];
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AJ] 방어구 착용 — 지금까지 완전히 막혀있던 기능
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('equip_armor');

async function equipArmor(bot) {
  const slots = [{ slot: 'head', kw: ['helmet'] }, { slot: 'torso', kw: ['chestplate'] }, { slot: 'legs', kw: ['leggings'] }, { slot: 'feet', kw: ['boots'] }];
  const equipped = [];
  for (const s of slots) {
    const item = bot.inventory.items().find(i => s.kw.some(k => i.name.includes(k)));
    if (!item) continue;
    try { await bot.equip(item, s.slot); equipped.push(item.name); await sleep(200); } catch (e) { console.warn(`⚠️ 방어구 착용 실패: ${item.name}`); }
  }
  return equipped.length ? `방어구 착용: ${equipped.join(', ')}` : '착용할 방어구가 없다.';
}

const _performBuiltinAction_beforeArmor = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'equip_armor') return await equipArmor(bot);
  return await _performBuiltinAction_beforeArmor(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AK] 활 전투 — 크리퍼는 항상 원거리 우선, 거리가 있으면 활 우선
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('shoot_bow');

async function shootBow(bot, targetEntity) {
  const bow = bot.inventory.items().find(i => i.name === 'bow');
  const arrows = bot.inventory.items().find(i => i.name === 'arrow');
  if (!bow || !arrows) return '활이나 화살이 없다.';
  if (!targetEntity) {
    const pos = bot.entity.position;
    targetEntity = bot.nearestEntity(e => e.position && HOSTILE_MOBS.includes(e.name) && pos.distanceTo(e.position) < 20);
  }
  if (!targetEntity) return '쏠 대상이 없다.';
  try {
    await bot.equip(bow, 'hand');
    await bot.lookAt(targetEntity.position.offset(0, targetEntity.height / 2, 0));
    bot.activateItem();
    await sleep(900);
    bot.deactivateItem();
    return `${targetEntity.name}에게 화살을 쐈다.`;
  } catch (e) { return `활 쏘기 실패: ${e.message}`; }
}

const _combatLoop_beforeBow = combatLoop;
combatLoop = async function (bot, self) {
  if (self.__inCombat) return;
  const pos = bot.entity?.position;
  if (!pos) return;
  const threat = bot.nearestEntity(e => e.position && HOSTILE_MOBS.includes(e.name) && pos.distanceTo(e.position) < COMBAT_ENGAGE_RADIUS);
  if (!threat) return;
  const hasBow = bot.inventory.items().some(i => i.name === 'bow') && bot.inventory.items().some(i => i.name === 'arrow');
  const dist = pos.distanceTo(threat.position);

  if (hasBow && (threat.name === 'creeper' || dist > 5)) {
    self.__inCombat = true;
    try {
      console.log(`🏹 [원거리 전투] ${threat.name} 활로 대응`);
      if (threat.name === 'creeper') { bot.pathfinder.setGoal(new goals.GoalNear(threat.position.x, threat.position.y, threat.position.z, 8)); await sleep(700); }
      let ticks = 0;
      while (self.isAlive && ticks < 10 && bot.entities[threat.id]) {
        ticks++;
        await shootBow(bot, bot.entities[threat.id]);
        await sleep(1100);
        if (bot.health <= COMBAT_FLEE_HEALTH) break;
      }
    } finally { self.__inCombat = false; }
    return;
  }
  return await _combatLoop_beforeBow(bot, self);
};

const _performBuiltinAction_beforeBow = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'shoot_bow') return await shootBow(bot, null);
  return await _performBuiltinAction_beforeBow(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AL] 농사 — 밭을 가는 건 블록을 캐는(dig) 게 아니라 괭이로
// 우클릭(activateBlock)해서 farmland로 바꾸는 것이다. 수확은 반대로 dig가 맞다.
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('start_farm', 'harvest_farm');

async function startFarm(bot, self) {
  const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
  if (!hoe) return '괭이가 없어서 밭을 갈 수 없다.';
  const seedName = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'];
  const seeds = bot.inventory.items().find(i => seedName.some(s => i.name.includes(s)));
  if (!seeds) return '씨앗(또는 당근/감자)이 없다.';
  const water = bot.findBlock({ matching: b => b.name === 'water', maxDistance: 16 });
  if (!water) return '근처에 물이 없어서 밭을 만들 수 없다.';

  let tilled = 0, planted = 0;
  const candidates = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { if (dx || dz) candidates.push(water.position.offset(dx, 0, dz)); }

  await bot.equip(hoe, 'hand');
  for (const p of candidates.slice(0, 9)) {
    const block = bot.blockAt(p);
    if (!block || !['grass_block', 'dirt'].includes(block.name)) continue;
    const above = bot.blockAt(p.offset(0, 1, 0));
    if (above && above.name !== 'air') continue;
    try {
      await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
      await bot.equip(hoe, 'hand');
      await bot.activateBlock(block); // ✅ 우클릭으로 밭갈기 — dig 아님
      tilled++;
      await sleep(300);
    } catch {}
  }

  const seedItem = bot.inventory.items().find(i => seedName.some(s => i.name.includes(s)));
  if (seedItem) {
    for (const p of candidates.slice(0, 9)) {
      const farmland = bot.blockAt(p);
      if (!farmland || farmland.name !== 'farmland') continue;
      try { await bot.equip(seedItem, 'hand'); await bot.placeBlock(farmland, new Vec3(0, 1, 0)); planted++; await sleep(300); } catch {}
    }
  }

  if (tilled > 0) {
    self.state.poi = self.state.poi || [];
    self.state.poi.push({ label: '농장', x: Math.round(water.position.x), y: Math.round(water.position.y), z: Math.round(water.position.z) });
    if (self.state.poi.length > 8) self.state.poi.shift();
    saveJSON(`state_${self.name}.json`, self.state);
  }
  return tilled > 0 ? `밭 ${tilled}칸을 갈고 씨앗 ${planted}개를 심었다. 나중에 다시 와서 수확해야 한다.` : '밭을 만들지 못했다.';
}

async function harvestFarm(bot) {
  const CROPS = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
  let harvested = 0;
  for (const [cropName, maxAge] of Object.entries(CROPS)) {
    const block = bot.findBlock({ matching: b => b.name === cropName && (b.getProperties?.()?.age ?? 0) >= maxAge, maxDistance: 24 });
    if (!block) continue;
    try { await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z)); await bot.dig(block); harvested++; await sleep(300); } catch {}
  }
  return harvested > 0 ? `농작물 ${harvested}개를 수확했다.` : '아직 수확할 만큼 자란 작물이 없다.';
}

const _performBuiltinAction_beforeFarm = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'start_farm') return await startFarm(bot, self);
  if (action === 'harvest_farm') return await harvestFarm(bot);
  return await _performBuiltinAction_beforeFarm(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AM] 동물 사육 — bot.useOn은 mineflayer 표준 API가 아니므로
// 엔티티 상호작용의 정식 방법인 bot.activateEntity를 사용한다.
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('breed_animals');

async function breedAnimals(bot) {
  const BREED_FOODS = { cow: 'wheat', sheep: 'wheat', pig: 'carrot', chicken: 'wheat_seeds', rabbit: 'carrot' };
  const pos = bot.entity.position;
  let bred = 0;
  for (const [animalName, foodName] of Object.entries(BREED_FOODS)) {
    const food = bot.inventory.items().find(i => i.name === foodName);
    if (!food) continue;
    const nearby = Object.values(bot.entities).filter(e => e.name === animalName && e.position && pos.distanceTo(e.position) < 10);
    if (nearby.length < 2) continue;
    for (const animal of nearby.slice(0, 2)) {
      try {
        await bot.equip(food, 'hand');
        await bot.pathfinder.goto(new goals.GoalNear(animal.position.x, animal.position.y, animal.position.z, 2));
        await bot.activateEntity(animal);
        bred++;
        await sleep(400);
      } catch {}
    }
  }
  return bred > 0 ? `동물 ${bred}마리에게 먹이를 줘 번식을 유도했다.` : '번식시킬 동물이나 먹이가 충분하지 않다.';
}

const _performBuiltinAction_beforeBreed = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'breed_animals') return await breedAnimals(bot);
  return await _performBuiltinAction_beforeBreed(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AN] go_to_poi — 지금까지 mark_poi로 저장은 됐지만
// home 외의 장소로 "직접 이동"하는 행동이 없었던 공백을 메운다.
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('go_to_poi');

async function goToPoi(bot, self, label) {
  const poi = (self.state.poi || []).find(p => p.label === label);
  if (!poi) return `'${label}'이라는 장소를 기억하지 못한다.`;
  try { bot.pathfinder.setGoal(new goals.GoalNear(poi.x, poi.y, poi.z, 2)); return `'${label}'(${poi.x},${poi.z})로 이동을 시작했다.`; }
  catch (e) { return `이동 실패: ${e.message}`; }
}

const _performBuiltinAction_beforePoi = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'go_to_poi') return await goToPoi(bot, self, label || target);
  return await _performBuiltinAction_beforePoi(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AO] 네더 포탈 — 흑요석 프레임 자동 설치 + 점화
// 주의: 실제 지형 조건(평평함 등)에 따라 결과가 달라질 수 있다.
// 직접 실행해보고 안 되면 다음 라운드에 좌표 로직을 조정할 필요가 있다.
// ════════════════════════════════════════════════════════════════════════

BUILTIN_ACTIONS.push('build_nether_portal');

async function buildNetherPortal(bot, self) {
  const obsidian = bot.inventory.items().find(i => i.name === 'obsidian');
  if (!obsidian || obsidian.count < 10) return `흑요석이 최소 10개 필요한데 지금 ${obsidian?.count || 0}개뿐이다.`;
  const flint = bot.inventory.items().find(i => i.name === 'flint_and_steel');
  if (!flint) return '점화할 부싯돌과 쇳조각이 없다.';

  const basePos = bot.entity.position.floored();
  const frame = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) { if (y === 0 || y === 4 || x === 0 || x === 3) frame.push({ x, y, z: 0 }); }

  let placed = 0;
  for (const off of frame) {
    const p = basePos.offset(off.x, off.y, off.z);
    const existing = bot.blockAt(p);
    if (existing?.name === 'obsidian') { placed++; continue; }
    if (existing?.name !== 'air') continue;
    const ob = bot.inventory.items().find(i => i.name === 'obsidian');
    if (!ob) break;
    const refs = [p.offset(0, -1, 0), p.offset(-1, 0, 0), p.offset(1, 0, 0), p.offset(0, 1, 0), p.offset(0, 0, -1)];
    const ref = refs.find(r => bot.blockAt(r)?.name && bot.blockAt(r).name !== 'air');
    if (!ref) continue;
    try { await bot.equip(ob, 'hand'); await bot.placeBlock(bot.blockAt(ref), p.minus(ref)); placed++; await sleep(300); } catch {}
  }
  if (placed < frame.length) return `포탈 프레임이 ${placed}/${frame.length}블록만 완성됐다. 더 평평한 곳에서 다시 시도해야 한다.`;

  try {
    await bot.equip(flint, 'hand');
    const igniteRef = bot.blockAt(basePos.offset(1, 0, 0));
    await bot.activateBlock(igniteRef);
    self.state.poi = self.state.poi || [];
    self.state.poi.push({ label: 'nether_portal', x: basePos.x, y: basePos.y, z: basePos.z });
    saveJSON(`state_${self.name}.json`, self.state);
    await addMemory(self, '흑요석 포탈을 짓고 점화해 다른 차원으로 가는 문을 열었다.').catch(() => {});
    return '포탈을 완성하고 점화했다.';
  } catch (e) { return `프레임은 완성했지만 점화에 실패했다: ${e.message}`; }
}

const _performBuiltinAction_beforePortal = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'build_nether_portal') return await buildNetherPortal(bot, self);
  return await _performBuiltinAction_beforePortal(bot, self, action, target, label);
};

function attachDimensionListener(bot, self) {
  if (self.__dimensionListenerAttached) return;
  self.__dimensionListenerAttached = true;
  bot.on('respawn', () => {
    const dim = bot.game?.dimension || '알 수 없음';
    console.log(`🌋 [차원] 현재: ${dim}`);
    addMemory(self, dim === 'minecraft:the_nether' ? '[차원 이동] 완전히 다른, 붉고 위험한 세계로 들어왔다.' : '[차원 이동] 원래 세계로 돌아왔다.').catch(() => {});
  });
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AP] 인터럽트 시스템 — 피해를 입으면 로컬 연산으로 즉시(0.001초급)
// 원인을 분석하고, 그 결과를 기억+다음 정규 판단에 넘긴다.
// GPT를 매번 다시 부르지 않는다 — "빠른 대응"이라는 목적과 API 지연이
// 충돌하기 때문이다. 모든 상태는 self.__ 로 스코프되어 다중 에이전트에도 안전하다.
// ════════════════════════════════════════════════════════════════════════

function attachFallTracker(bot, self) {
  if (self.__fallTrackerAttached) return;
  self.__fallTrackerAttached = true;
  self.__recentYHistory = [];
  bot.on('move', () => {
    if (!bot.entity) return;
    self.__recentYHistory.push({ y: bot.entity.position.y, t: Date.now() });
    if (self.__recentYHistory.length > 10) self.__recentYHistory.shift();
  });
}
function wasRecentlyFalling(self) {
  const hist = self.__recentYHistory || [];
  if (hist.length < 2) return false;
  const first = hist[0], last = hist[hist.length - 1];
  return (first.y - last.y) > 3 && (last.t - first.t) < 2000;
}
function checkDrowningRisk(bot, self) {
  if (!bot.entity) return false;
  const headBlock = bot.blockAt(bot.entity.position.offset(0, bot.entity.height - 0.2, 0));
  const submerged = headBlock && headBlock.name === 'water';
  if (submerged) {
    if (!self.__submergedSince) self.__submergedSince = Date.now();
    return (Date.now() - self.__submergedSince) > 20000;
  }
  self.__submergedSince = null;
  return false;
}

function analyzeInterruptCause(bot, self) {
  const pos = bot.entity?.position;
  if (!pos) return null;
  const personality = loadPersonalityV2(self.name);
  const caution = (personality.core?.caution ?? 5) / 10;

  let type, cause, immediateResponse;
  const nearLava = bot.findBlock({ matching: b => b.name === 'lava', maxDistance: 3 });
  if (nearLava || bot.entity.onFire) {
    type = 'FIRE_DAMAGE'; cause = '불이나 용암 근처에서 피해를 입었다'; immediateResponse = '즉시 반대 방향으로 물러난다';
  } else if (wasRecentlyFalling(self)) {
    type = 'FALL_DAMAGE'; cause = '높은 곳에서 떨어져 피해를 입었다'; immediateResponse = '더 이상 이동하지 않고 상태를 살핀다';
  } else if (checkDrowningRisk(bot, self)) {
    type = 'DROWN_DAMAGE'; cause = '물속에서 오래 있어 숨이 막혔다'; immediateResponse = '즉시 수면으로 올라간다';
  } else {
    const near = bot.nearestEntity(e => e.position && HOSTILE_MOBS.includes(e.name) && pos.distanceTo(e.position) < 12);
    type = 'COMBAT_DAMAGE';
    cause = near ? `${near.name}에게 공격받았다` : '알 수 없는 원인으로 피해를 입었다';
    immediateResponse = near ? '즉시 대응 여부를 판단한다' : '주변을 살핀다';
  }

  // 40%가 문자 그대로 반영되는 계산식
  const dangerScore = Math.min(1, (1 - bot.health / 20) * 0.6 + (type === 'COMBAT_DAMAGE' ? 0.4 : 0.2));
  const suspendScore = 0.6 * dangerScore + 0.4 * caution;
  return { type, cause, immediateResponse, shouldSuspendPlan: suspendScore >= 0.5, suspendScore: suspendScore.toFixed(2) };
}

function attachDamageInterrupt(bot, self) {
  if (self.__damageInterruptAttached) return;
  self.__damageInterruptAttached = true;
  self.__lastHealthSeen = bot.health;
  self.__lastInterruptTime = 0;
  const COOLDOWN_MS = 3000;

  bot.on('health', () => {
    try {
      if (!bot.entity || !self.isAlive) return;
      const now = Date.now();
      const dmg = self.__lastHealthSeen - bot.health;
      self.__lastHealthSeen = bot.health;
      if (dmg < 1 || now - self.__lastInterruptTime < COOLDOWN_MS) return;
      self.__lastInterruptTime = now;

      const analysis = analyzeInterruptCause(bot, self);
      if (!analysis) return;
      console.log(`⚡ [인터럽트] ${analysis.cause} (피해 ${dmg.toFixed(1)}, 중단점수 ${analysis.suspendScore}) → ${analysis.immediateResponse}`);

      if (analysis.shouldSuspendPlan && self.state.taskQueue?.length > 0) {
        self.state.taskQueue = [];
        self.state.taskQueueMeta = { goalName: null };
        saveJSON(`state_${self.name}.json`, self.state);
        console.log(`⏸️ [인터럽트] 계획 중단 (중단점수 ${analysis.suspendScore} ≥ 0.5, 성격 신중함 40% 반영)`);
      }
      self.lastActionResult = `[인터럽트] ${analysis.cause}. ${analysis.immediateResponse}`;
      addMemory(self, self.lastActionResult).catch(() => {});
    } catch (e) { /* 절대 죽으면 안 됨 */ }
  });
}
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AQ] bot.oxygenLevel이 버전에 따라 없을 수 있으므로,
// Part AP의 checkDrowningRisk(자체 타이머 기반)를 그대로 재사용해 의존성을 없앤다.
// ════════════════════════════════════════════════════════════════════════

const _reflexLoop_beforeSafety = reflexLoop;
reflexLoop = async function (bot, self) {
  await _reflexLoop_beforeSafety(bot, self);
  try {
    if (!bot.entity) return;
    if (checkDrowningRisk(bot, self)) {
      const p = bot.entity.position;
      bot.pathfinder.setGoal(new goals.GoalY(Math.ceil(p.y) + 4));
      console.log('🫧 [Reflex] 잠수 지속 감지 → 수면 이동');
    }
  } catch {}
};

BUILTIN_ACTIONS.push('clean_inventory', 'toss_item');

async function cleanInventory(bot) {
  const JUNK = ['cobblestone', 'dirt', 'gravel', 'sand', 'rotten_flesh', 'poisonous_potato'];
  const MAX_KEEP = 32;
  let dropped = 0;
  for (const item of bot.inventory.items()) {
    if (JUNK.includes(item.name) && item.count > MAX_KEEP) {
      try { await bot.toss(item.type, null, item.count - MAX_KEEP); dropped += item.count - MAX_KEEP; } catch {}
    }
  }
  return dropped > 0 ? `잡동사니 ${dropped}개를 정리했다.` : '정리할 게 없다.';
}
async function tossItem(bot, target) {
  if (!target) return '버릴 아이템을 지정하지 않았다.';
  const resolved = resolveItemName(target);
  const item = bot.inventory.items().find(i => i.name === resolved || i.name.includes(resolved));
  if (!item) return `가방에 '${target}'이 없다.`;
  try { await bot.tossStack(item); return `'${item.name}'을 버렸다.`; } catch (e) { return `버리기 실패: ${e.message}`; }
}
const _performBuiltinAction_beforeClean = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'clean_inventory') return await cleanInventory(bot);
  if (action === 'toss_item') return await tossItem(bot, target);
  return await _performBuiltinAction_beforeClean(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AR] 네더 진입 후 'mine'이 오버월드 광물만 찾던 문제 보완
// ════════════════════════════════════════════════════════════════════════

const NETHER_ORES = ['nether_gold_ore', 'nether_quartz_ore', 'ancient_debris'];
const _performBuiltinAction_beforeNetherOre = performBuiltinAction;
performBuiltinAction = async function (bot, self, action, target, label) {
  if (action === 'mine' && bot.game?.dimension === 'minecraft:the_nether') {
    const netherOre = bot.findBlock({ matching: b => NETHER_ORES.includes(b.name), maxDistance: 20 });
    if (netherOre) {
      try { await bot.pathfinder.goto(new goals.GoalBlock(netherOre.position.x, netherOre.position.y, netherOre.position.z)); } catch {}
      const result = await continuousGather(bot, self, NETHER_ORES, 8, 5);
      return result.count > 0 ? `네더의 ${result.name}을 ${result.count}개 캤다.` : '네더에서 자원을 찾지 못했다.';
    }
  }
  return await _performBuiltinAction_beforeNetherOre(bot, self, action, target, label);
};
// ════════════════════════════════════════════════════════════════════════
// [ADD-ON AS] 네이티브 등록 + 리스너 시작 — 기존 패턴 재사용
// ════════════════════════════════════════════════════════════════════════

const _ensureNativeActionsDiscoverable_beforeAG = ensureNativeActionsDiscoverable;
ensureNativeActionsDiscoverable = function (self) {
  _ensureNativeActionsDiscoverable_beforeAG(self);
  const newNatives = {
    equip_armor: '가진 방어구를 실제로 몸에 착용한다. (네이티브)',
    shoot_bow: '활과 화살로 원거리에서 몬스터를 처치한다. 크리퍼에 특히 안전하다. (네이티브)',
    start_farm: '괭이와 씨앗으로 물 근처에 밭을 갈고 심는다. (네이티브)',
    harvest_farm: '다 자란 농작물을 수확한다. (네이티브)',
    breed_animals: '동물에게 먹이를 줘 번식을 유도한다. (네이티브)',
    go_to_poi: '기억해둔 장소(label)로 이동한다. (네이티브)',
    build_nether_portal: '흑요석 10개와 부싯돌이 있으면 다른 차원으로 가는 문을 만든다. (네이티브)',
    clean_inventory: '가방의 흔한 잡동사니를 정리한다. (네이티브)',
    toss_item: '특정 아이템(target)을 가방에서 버린다. (네이티브)',
  };
  let changed = false;
  for (const [name, desc] of Object.entries(newNatives)) {
    if (!self.skills[name]) { self.skills[name] = { description: desc, code: '// native', isNative: true, successCount: 0, failCount: 0 }; changed = true; }
  }
  if (changed) { saveJSON(`skills_${self.name}.json`, self.skills); console.log('🧩 [네이티브 등록] equip_armor/shoot_bow/start_farm/harvest_farm/breed_animals/go_to_poi/build_nether_portal/clean_inventory/toss_item'); }
};

const _liveLoop_beforeAG = liveLoop;
liveLoop = async function (bot, self) {
  if (!self.__ag_started) {
    self.__ag_started = true;
    attachFallTracker(bot, self);
    attachDamageInterrupt(bot, self);
    attachDimensionListener(bot, self);
    console.log('🎭 [PATCH AG~AS] 성격 수치화(±20%) + 가능성/미래어포던스 스캐너 + 인터럽트(신중함 40% 반영) + 방어구/활/농사/사육/이동/포탈/정리 로드 완료');
  }
  return _liveLoop_beforeAG(bot, self);
};

// ════════════════════════════════════════════════════════════════════════
// [STABLE SURVIVAL PATCH V5]
// - native skill이 vm으로 실행되는 문제 수정
// - survival-hotfix.js 분리 패치 실패 문제를 citizen.cjs 내부 패치로 통합
// - 배고픔 자동 섭취, 위험 시 작업 중단, 지속 전투
// - 맨손/낮은 곡괭이로 돌/광물 캐는 문제 방지
// - 나무/돌/철 순서 상식 보강
// - build_shelter 성공 시 자동 집 등록
// - go_home / go_to_poi GoalNear 사용
// ════════════════════════════════════════════════════════════════════════

;(() => {
  if (globalThis.__ADAM_STABLE_SURVIVAL_PATCH_V5__) {
    console.log('🛡️ [STABLE PATCH V5] 이미 로드됨');
    return;
  }
  globalThis.__ADAM_STABLE_SURVIVAL_PATCH_V5__ = true;

  console.log('🛡️ [STABLE PATCH V5] native dispatch/먹기/전투/도구상식/맨손채굴금지/집등록 로드');

  const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);
  const HOSTILES = [
    'zombie', 'husk', 'drowned',
    'skeleton', 'stray',
    'creeper', 'spider', 'witch', 'phantom',
    'slime', 'pillager', 'vindicator',
    'enderman'
  ];
  const PASSIVES = ['cow', 'pig', 'sheep', 'chicken', 'rabbit'];

  const FOOD_SCORE = {
    cooked_beef: 10,
    cooked_porkchop: 10,
    cooked_mutton: 8,
    bread: 7,
    cooked_chicken: 7,
    baked_potato: 7,
    apple: 5,
    carrot: 5,
    beef: 4,
    porkchop: 4,
    mutton: 4,
    chicken: 3,
    potato: 2,
    rotten_flesh: 1
  };

  function L_sleep(ms) {
    return typeof sleep === 'function'
      ? sleep(ms)
      : new Promise(r => setTimeout(r, ms));
  }

  function L_norm(raw) {
    if (!raw || raw === 'null') return '';
    if (typeof resolveItemName === 'function') return resolveItemName(raw) || '';
    return String(raw).toLowerCase().trim().replace(/\s+/g, '_');
  }

  function L_mcData(bot) {
    return typeof getMcData === 'function' ? getMcData(bot.version) : mcDataLoader(bot.version);
  }

  function L_items(bot) {
    try {
      return bot.inventory?.items?.() || [];
    } catch {
      return [];
    }
  }

  function L_count(bot, pred) {
    return L_items(bot)
      .filter(i => typeof pred === 'string' ? i.name === pred : pred(i))
      .reduce((a, i) => a + i.count, 0);
  }

  function L_isLog(name) {
    return /_(log|wood)$/.test(name) && !name.startsWith('stripped_');
  }

  function L_isPlanks(name) {
    return /_planks$/.test(name);
  }

  function L_stoneLikeCount(bot) {
    return L_count(bot, i => ['cobblestone', 'cobbled_deepslate', 'blackstone'].includes(i.name));
  }

  async function L_remember(self, text) {
    try {
      if (!text) return;
      if (typeof addMemory === 'function' && Array.isArray(self.memories)) {
        await addMemory(self, text);
      } else if (Array.isArray(self.memory)) {
        self.memory.push(text);
        if (typeof saveJSON === 'function') saveJSON(`memory_${self.name}.json`, self.memory);
      }
    } catch {}
  }

  function L_stopWork(bot) {
    try { if (bot.stopDigging) bot.stopDigging(); } catch {}
    try { bot.pathfinder?.setGoal(null); } catch {}
    try { bot.clearControlStates?.(); } catch {}
  }

  function L_materialRank(name) {
    if (name.includes('netherite')) return 0;
    if (name.includes('diamond')) return 1;
    if (name.includes('iron')) return 2;
    if (name.includes('stone')) return 3;
    if (name.includes('golden')) return 4;
    if (name.includes('wooden')) return 5;
    return 9;
  }

  async function L_equipBest(bot, kind) {
    const prefs =
      kind === 'combat' ? ['sword', 'axe'] :
      kind === 'pickaxe' ? ['pickaxe'] :
      kind === 'axe' ? ['axe'] :
      kind === 'shovel' ? ['shovel'] :
      [kind];

    const candidates = L_items(bot)
      .filter(i => prefs.some(p => i.name.includes(p)))
      .sort((a, b) => {
        const pa = prefs.findIndex(p => a.name.includes(p));
        const pb = prefs.findIndex(p => b.name.includes(p));
        return (pa - pb) || (L_materialRank(a.name) - L_materialRank(b.name));
      });

    if (!candidates.length) return false;
    try {
      await bot.equip(candidates[0], 'hand');
      return true;
    } catch {
      return false;
    }
  }

  function L_foodScore(name) {
    if (FOOD_SCORE[name]) return FOOD_SCORE[name];
    if (name.includes('cooked')) return 7;
    return 0;
  }

  function L_findFood(bot, allowRisky = false) {
    const risky = new Set(['rotten_flesh', 'spider_eye', 'pufferfish', 'poisonous_potato']);
    return L_items(bot)
      .filter(i => L_foodScore(i.name) > 0)
      .filter(i => allowRisky || !risky.has(i.name))
      .sort((a, b) => L_foodScore(b.name) - L_foodScore(a.name))[0] || null;
  }

  async function L_eat(bot, threshold = 14, allowRisky = false) {
    if (!bot.entity || bot.food >= threshold) return null;

    const food = L_findFood(bot, allowRisky || bot.food <= 6);
    if (!food) return null;

    L_stopWork(bot);

    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      return `배고픔 ${bot.food}/20 상태라 ${food.name}을 먹었다.`;
    } catch (e) {
      return `먹으려 했지만 실패했다: ${e.message}`;
    }
  }

  function L_nearestHostile(bot, radius = 8) {
    if (!bot.entity) return null;
    const pos = bot.entity.position;
    return bot.nearestEntity(e =>
      e.position &&
      HOSTILES.includes(e.name) &&
      pos.distanceTo(e.position) <= radius
    );
  }

  async function L_gotoNear(bot, obj, radius = 2, timeoutMs = 8000) {
    if (!bot.entity || !obj?.position) return false;
    const p = obj.position;

    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, radius)),
        L_sleep(timeoutMs).then(() => { throw new Error('path timeout'); })
      ]);
      return true;
    } catch {
      try { bot.pathfinder.setGoal(null); } catch {}
      return false;
    }
  }

  async function L_fleeFrom(bot, entity, distance = 14) {
    if (!bot.entity || !entity?.position) return false;
    const p = bot.entity.position;
    const e = entity.position;

    let dx = p.x - e.x;
    let dz = p.z - e.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= len;
    dz /= len;

    L_stopWork(bot);

    try {
      bot.pathfinder.setGoal(new goals.GoalXZ(p.x + dx * distance, p.z + dz * distance));
      await L_sleep(1200);
      return true;
    } catch {
      return false;
    }
  }

  async function L_fightOrFlee(bot, self, hostile) {
    if (!hostile || !bot.entity) return null;
    if (self.__stableCombat) return null;

    self.__stableCombat = true;
    L_stopWork(bot);

    try {
      console.log(`⚔️ [생존본능] ${hostile.name} 감지 → 작업 중단 후 대응`);
      if (bot.food < 12) await L_eat(bot, 12, false);
      await L_equipBest(bot, 'combat');

      for (let i = 0; i < 24; i++) {
        if (!bot.entity || !self.isAlive) break;

        const current = bot.entities[hostile.id] || L_nearestHostile(bot, 10);
        if (!current) {
          return `${hostile.name} 위협이 사라졌다.`;
        }

        const dist = bot.entity.position.distanceTo(current.position);

        if (current.name === 'creeper') {
          await L_fleeFrom(bot, current, 16);
          return `크리퍼가 가까워 폭발을 피하려고 물러났다.`;
        }

        if (current.name === 'enderman' && bot.health < 16) {
          await L_fleeFrom(bot, current, 14);
          return `엔더맨과 정면으로 싸우기엔 위험해서 거리를 벌렸다.`;
        }

        if (bot.health <= 8) {
          await L_fleeFrom(bot, current, 16);
          await L_remember(self, `[도주] 체력 ${bot.health}/20 상태라 ${current.name}에게서 물러났다.`);
          return `체력이 낮아 ${current.name}에게서 도망쳤다.`;
        }

        if (dist > 3.2) {
          await L_gotoNear(bot, current, 2, 1800);
        }

        try {
          await L_equipBest(bot, 'combat');
          bot.attack(current);
        } catch {}

        if (Math.random() < 0.25) {
          try {
            bot.setControlState('back', true);
            setTimeout(() => {
              try { bot.setControlState('back', false); } catch {}
            }, 300);
          } catch {}
        }

        await L_sleep(550);
      }

      return `${hostile.name}에게 대응했지만 주변을 더 확인해야 한다.`;
    } finally {
      self.__stableCombat = false;
    }
  }

  async function L_huntFood(bot, self) {
    if (!bot.entity) return '사냥할 수 없는 상태다.';

    const danger = L_nearestHostile(bot, 8);
    if (danger) return await L_fightOrFlee(bot, self, danger);

    const animal = bot.nearestEntity(e =>
      e.position &&
      PASSIVES.includes(e.name) &&
      bot.entity.position.distanceTo(e.position) < 32
    );

    if (!animal) {
      const p = bot.entity.position;
      try {
        bot.pathfinder.setGoal(new goals.GoalXZ(
          p.x + (Math.random() - 0.5) * 30,
          p.z + (Math.random() - 0.5) * 30
        ));
      } catch {}
      return '먹을 것이 없어 동물을 찾으러 이동한다.';
    }

    console.log(`🏹 [생존본능] 배고픔 해결을 위해 ${animal.name} 사냥`);
    await L_equipBest(bot, 'combat');

    for (let i = 0; i < 18; i++) {
      const cur = bot.entities[animal.id];
      if (!cur) break;

      const dangerNow = L_nearestHostile(bot, 8);
      if (dangerNow) return await L_fightOrFlee(bot, self, dangerNow);

      if (bot.entity.position.distanceTo(cur.position) > 3) {
        await L_gotoNear(bot, cur, 2, 1800);
      }

      try { bot.attack(cur); } catch {}
      await L_sleep(500);
    }

    await L_sleep(700);
    if (bot.food < 12) await L_eat(bot, 12, false);

    return `${animal.name} 사냥을 시도했다.`;
  }

  async function L_emergencyOnly(bot, self) {
    if (!bot.entity || !self?.isAlive) return null;
    if (self.__stableCombat) return null;

    const hostile = L_nearestHostile(bot, 8);
    if (hostile) return await L_fightOrFlee(bot, self, hostile);

    if (bot.health <= 8) {
      const eaten = await L_eat(bot, 18, true);
      if (eaten) return eaten;

      L_stopWork(bot);

      // 마인크래프트는 허기가 18 이상일 때만 체력이 자연 회복된다.
      // 먹을 게 없어서 못 먹었는데 허기까지 낮으면, 가만히 기다려봐야
      // 체력이 절대 차지 않는다. 그럴 땐 기다리지 말고 바로 음식을 찾는다.
      if (bot.food < 18) {
        return await L_huntFood(bot, self);
      }

      return `체력 ${bot.health}/20 상태지만 허기는 충분해서(${bot.food}/20) 위험 행동을 멈추고 자연 회복을 기다린다.`;
    }

    if (bot.food <= 6) {
      const eaten = await L_eat(bot, 14, true);
      if (eaten) return eaten;
      return await L_huntFood(bot, self);
    }

    return null;
  }

  async function L_preThinkSurvival(bot, self) {
    const emergency = await L_emergencyOnly(bot, self);
    if (emergency) return emergency;

    if (bot.food < 14) {
      const eaten = await L_eat(bot, 14, false);
      if (eaten) return eaten;
    }

    return null;
  }

  function L_pickaxeTier(bot) {
    let tier = 0;
    for (const i of L_items(bot)) {
      if (!i.name.includes('pickaxe')) continue;
      if (i.name.includes('wooden')) tier = Math.max(tier, 1);
      else if (i.name.includes('stone')) tier = Math.max(tier, 2);
      else if (i.name.includes('iron')) tier = Math.max(tier, 3);
      else if (i.name.includes('diamond')) tier = Math.max(tier, 4);
      else if (i.name.includes('netherite')) tier = Math.max(tier, 5);
    }
    return tier;
  }

  function L_requiredPickaxeTier(blockName) {
    if (!blockName) return 0;

    if (/obsidian|ancient_debris/.test(blockName)) return 4;

    if (/diamond_ore|deepslate_diamond_ore|gold_ore|deepslate_gold_ore|redstone_ore|deepslate_redstone_ore|emerald_ore|deepslate_emerald_ore/.test(blockName)) {
      return 3;
    }

    if (/iron_ore|deepslate_iron_ore|copper_ore|deepslate_copper_ore|lapis_ore|deepslate_lapis_ore/.test(blockName)) {
      return 2;
    }

    if (/stone|deepslate|cobblestone|coal_ore|deepslate_coal_ore|andesite|diorite|granite|tuff|basalt|blackstone|nether_quartz_ore|nether_gold_ore/.test(blockName)) {
      return 1;
    }

    return 0;
  }

  async function L_craftOne(bot, itemName, applications = 1, table = null) {
    const mcData = L_mcData(bot);
    const itemType = mcData.itemsByName[itemName];
    if (!itemType) return { ok: false, msg: `'${itemName}'은 존재하지 않는 아이템이다.` };

    let recipes = [];
    try {
      recipes = bot.recipesFor(itemType.id, null, applications, table);
    } catch {}

    if (!recipes.length) {
      return { ok: false, msg: `'${itemName}' 제작법을 현재 재료로 사용할 수 없다.` };
    }

    try {
      await bot.craft(recipes[0], applications, table || null);
      await L_sleep(150);
      return { ok: true, msg: `'${itemName}'을 만들었다.` };
    } catch (e) {
      return { ok: false, msg: `'${itemName}' 제작 실패: ${e.message}` };
    }
  }

  async function L_ensurePlanks(bot, minCount) {
    while (L_count(bot, i => L_isPlanks(i.name)) < minCount) {
      const log = L_items(bot).find(i => L_isLog(i.name));
      if (!log) return false;

      const plankName = log.name.replace(/_(log|wood)$/, '_planks');
      const mcData = L_mcData(bot);
      if (!mcData.itemsByName[plankName]) return false;

      const r = await L_craftOne(bot, plankName, 1, null);
      if (!r.ok) return false;
    }
    return true;
  }

  async function L_ensureSticks(bot, minCount) {
    while (L_count(bot, 'stick') < minCount) {
      if (!(await L_ensurePlanks(bot, 2))) return false;
      const r = await L_craftOne(bot, 'stick', 1, null);
      if (!r.ok) return false;
    }
    return true;
  }

  function L_findTable(bot) {
    try {
      return bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 8 });
    } catch {
      return null;
    }
  }

  async function L_placeNearby(bot, itemName) {
    if (!bot.entity) return false;

    const item = L_items(bot).find(i => i.name === itemName);
    if (!item) return false;

    const base = bot.entity.position.floored();
    const offsets = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1]
    ];

    for (const [x, z] of offsets) {
      const ground = bot.blockAt(base.offset(x, -1, z));
      const target = bot.blockAt(base.offset(x, 0, z));

      if (!ground || AIR_NAMES.has(ground.name) || ground.name === 'water' || ground.name === 'lava') continue;
      if (target && !AIR_NAMES.has(target.name)) continue;

      try {
        await bot.equip(item, 'hand');
        await bot.placeBlock(ground, new Vec3(0, 1, 0));
        await L_sleep(350);
        return true;
      } catch {}
    }

    return false;
  }

  async function L_ensureTable(bot) {
    let table = L_findTable(bot);
    if (table) return table;

    let tableItem = L_items(bot).find(i => i.name === 'crafting_table');

    if (!tableItem) {
      if (!(await L_ensurePlanks(bot, 4))) return null;
      const r = await L_craftOne(bot, 'crafting_table', 1, null);
      if (!r.ok) return null;
    }

    await L_placeNearby(bot, 'crafting_table');
    await L_sleep(400);
    return L_findTable(bot);
  }

  async function L_craftSmart(bot, self, rawTarget) {
    let itemName = L_norm(rawTarget);
    if (!itemName) return '만들 아이템 이름이 없다.';

    if (itemName === 'plank') itemName = 'planks';
    if (itemName === 'bed') itemName = 'white_bed';

    if (itemName === 'planks') {
      const before = L_count(bot, i => L_isPlanks(i.name));
      const ok = await L_ensurePlanks(bot, before + 4);
      return ok
        ? `판자를 만들었다. 현재 판자 ${L_count(bot, i => L_isPlanks(i.name))}개.`
        : '판자를 만들 원목이 없다.';
    }

    if (itemName === 'stick') {
      const before = L_count(bot, 'stick');
      const ok = await L_ensureSticks(bot, before + 4);
      return ok
        ? `막대기를 만들었다. 현재 stick ${L_count(bot, 'stick')}개.`
        : '막대기를 만들 판자가 없다.';
    }

    if (itemName === 'crafting_table') {
      if (!(await L_ensurePlanks(bot, 4))) return '작업대를 만들 판자가 부족하다.';
      const r = await L_craftOne(bot, 'crafting_table', 1, null);
      return r.ok ? `'crafting_table'을 성공적으로 만들었다.` : r.msg;
    }

    if (/^wooden_/.test(itemName)) {
      const table = await L_ensureTable(bot);
      if (!table) return '나무 도구를 만들 작업대를 준비하지 못했다.';
      if (!(await L_ensureSticks(bot, 2))) return '나무 도구에 필요한 막대기가 없다.';
      if (!(await L_ensurePlanks(bot, 3))) return '나무 도구에 필요한 판자가 없다. 원목을 더 모아야 한다.';

      const r = await L_craftOne(bot, itemName, 1, table);
      return r.ok ? `'${itemName}'을 성공적으로 만들었다.` : r.msg;
    }

    if (/^stone_/.test(itemName)) {
      const table = await L_ensureTable(bot);
      if (!table) return '돌 도구를 만들 작업대를 준비하지 못했다.';
      if (!(await L_ensureSticks(bot, 2))) return '돌 도구에 필요한 막대기가 없다.';

      const needStone =
        itemName.includes('shovel') ? 1 :
        itemName.includes('sword') ? 2 :
        itemName.includes('hoe') ? 2 :
        3;

      const stone = L_stoneLikeCount(bot);
      if (stone < needStone) return `돌 도구에 필요한 조약돌류가 부족하다. 현재 ${stone}/${needStone}개.`;

      const r = await L_craftOne(bot, itemName, 1, table);
      return r.ok ? `'${itemName}'을 성공적으로 만들었다.` : r.msg;
    }

    if (/^(iron|diamond|golden|netherite)_/.test(itemName) || ['shield', 'bow', 'white_bed', 'chest', 'furnace'].includes(itemName)) {
      const table = await L_ensureTable(bot);
      if (!table) return `'${itemName}'을 만들 작업대를 준비하지 못했다.`;

      if (/(pickaxe|axe|sword|shovel|hoe)$/.test(itemName) || itemName === 'bow') {
        await L_ensureSticks(bot, 2);
      }

      if (itemName === 'chest') {
        if (!(await L_ensurePlanks(bot, 8))) return '상자를 만들 판자가 부족하다.';
      }

      if (itemName === 'furnace') {
        const stone = L_stoneLikeCount(bot);
        if (stone < 8) return `화로를 만들 조약돌류가 부족하다. 현재 ${stone}/8개.`;
      }

      const r = await L_craftOne(bot, itemName, 1, table);
      return r.ok ? `'${itemName}'을 성공적으로 만들었다.` : r.msg;
    }

    if (itemName === 'torch') {
      if (!(await L_ensureSticks(bot, 1))) return '횃불을 만들 막대기가 없다.';
      const fuel = L_count(bot, i => i.name === 'coal' || i.name === 'charcoal');
      if (fuel < 1) return '횃불을 만들 석탄이나 숯이 없다.';

      const r = await L_craftOne(bot, 'torch', 1, null);
      return r.ok ? `'torch'를 성공적으로 만들었다.` : r.msg;
    }

    let table = L_findTable(bot);
    let r = await L_craftOne(bot, itemName, 1, table);

    if (!r.ok) {
      table = await L_ensureTable(bot);
      if (table) r = await L_craftOne(bot, itemName, 1, table);
    }

    return r.ok ? `'${itemName}'을 성공적으로 만들었다.` : r.msg;
  }

  function L_hasAdjacentAir(bot, block) {
    const dirs = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 1, 0), new Vec3(0, -1, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];

    return dirs.some(d => {
      const b = bot.blockAt(block.position.plus(d));
      return !b || AIR_NAMES.has(b.name) || b.name === 'water';
    });
  }

  function L_findExposedBlock(bot, names, maxDistance = 32, count = 100) {
    if (!bot.entity) return null;

    let positions = [];
    try {
      positions = bot.findBlocks({
        matching: b => names.includes(b.name),
        maxDistance,
        count
      });
    } catch {
      return null;
    }

    return positions
      .map(p => bot.blockAt(p))
      .filter(b => b && names.includes(b.name) && L_hasAdjacentAir(bot, b))
      .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))[0] || null;
  }

  async function L_safeDig(bot, self, block) {
    if (!block || !bot.entity) return { ok: false, msg: '캘 블록이 없다.' };

    const danger = L_nearestHostile(bot, 8);
    if (danger) {
      const r = await L_fightOrFlee(bot, self, danger);
      return { ok: false, msg: `${danger.name}이 가까워 채굴을 중단했다. ${r || ''}` };
    }

    const needTier = L_requiredPickaxeTier(block.name);
    const tier = L_pickaxeTier(bot);

    if (needTier > 0 && tier < needTier) {
      return {
        ok: false,
        msg: `${block.name}은 맨손이나 낮은 도구로 캐면 쓸모가 없다. 필요한 곡괭이 단계 ${needTier}, 현재 ${tier}.`
      };
    }

    if (needTier > 0) await L_equipBest(bot, 'pickaxe');
    else if (block.name.includes('log') || block.name.includes('wood')) await L_equipBest(bot, 'axe');

    try {
      await bot.dig(block, true);
      await L_sleep(220);
      return { ok: true, msg: `${block.name}을 캤다.` };
    } catch (e) {
      return { ok: false, msg: `채굴 중단: ${e.message}` };
    }
  }

  async function L_mineBlockList(bot, self, targetNames, maxCount = 8, maxDistance = 32) {
    let count = 0;
    let lastName = '';
    let stopped = '';

    for (let i = 0; i < maxCount; i++) {
      const emergency = await L_emergencyOnly(bot, self);
      if (emergency) {
        stopped = emergency;
        break;
      }

      const block = L_findExposedBlock(bot, targetNames, maxDistance, 120);
      if (!block) break;

      const dist = bot.entity.position.distanceTo(block.position);
      if (dist > 4.2) {
        const ok = await L_gotoNear(bot, block, 2, 9000);
        if (!ok) {
          stopped = '길을 찾지 못했다.';
          break;
        }
      }

      const fresh = bot.blockAt(block.position);
      if (!fresh || !targetNames.includes(fresh.name)) continue;

      const dug = await L_safeDig(bot, self, fresh);
      if (!dug.ok) {
        stopped = dug.msg;
        break;
      }

      count++;
      lastName = fresh.name;
      await L_sleep(160);
    }

    return { count, name: lastName, stopped };
  }

  function L_mineTargets(bot, target, tier) {
    const t = L_norm(target || '');

    if (bot.game?.dimension === 'minecraft:the_nether') {
      if (t.includes('ancient')) return ['ancient_debris'];
      if (t.includes('quartz')) return ['nether_quartz_ore'];
      if (t.includes('gold')) return ['nether_gold_ore'];
      return ['nether_quartz_ore', 'nether_gold_ore', 'ancient_debris'];
    }

    if (t.includes('diamond')) return ['diamond_ore', 'deepslate_diamond_ore'];
    if (t.includes('iron')) return ['iron_ore', 'deepslate_iron_ore'];
    if (t.includes('coal')) return ['coal_ore', 'deepslate_coal_ore'];
    if (t.includes('copper')) return ['copper_ore', 'deepslate_copper_ore'];

    if (t.includes('stone') || t.includes('cobblestone')) {
      return ['stone', 'deepslate', 'cobblestone', 'andesite', 'diorite', 'granite', 'tuff'];
    }

    if (tier >= 2) {
      return [
        'stone', 'deepslate', 'cobblestone',
        'coal_ore', 'deepslate_coal_ore',
        'iron_ore', 'deepslate_iron_ore',
        'copper_ore', 'deepslate_copper_ore'
      ];
    }

    return ['stone', 'deepslate', 'cobblestone', 'coal_ore', 'deepslate_coal_ore'];
  }

  async function L_gatherWood(bot, self) {
    const emergency = await L_emergencyOnly(bot, self);
    if (emergency) return `생존 우선으로 나무 채집을 미룸: ${emergency}`;

    const woodTypes = [
      'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log'
    ];

    let count = 0;
    let lastName = '';

    for (let i = 0; i < 12; i++) {
      const danger = L_nearestHostile(bot, 8);
      if (danger) {
        const r = await L_fightOrFlee(bot, self, danger);
        return count > 0
          ? `위험 때문에 나무 채집을 중단했다. 지금까지 ${count}개. ${r || ''}`
          : `위험 때문에 나무 채집을 미뤘다. ${r || ''}`;
      }

      if (bot.food < 8) {
        const eaten = await L_eat(bot, 12, false);
        if (!eaten) {
          const r = await L_huntFood(bot, self);
          return count > 0
            ? `배고픔 때문에 나무 채집을 중단했다. 지금까지 ${count}개. ${r}`
            : `배고픔 때문에 나무 채집을 미뤘다. ${r}`;
        }
      }

      const block = L_findExposedBlock(bot, woodTypes, 48, 120);
      if (!block) {
        if (count > 0) return `${lastName} 등 나무를 ${count}개 베어냈다.`;

        const p = bot.entity.position;
        try {
          bot.pathfinder.setGoal(new goals.GoalXZ(
            p.x + (Math.random() - 0.5) * 40,
            p.z + (Math.random() - 0.5) * 40
          ));
        } catch {}

        return '주변에서 드러난 나무를 찾지 못해 숲을 찾으러 이동한다.';
      }

      if (bot.entity.position.distanceTo(block.position) > 4.2) {
        await L_gotoNear(bot, block, 2, 9000);
      }

      const fresh = bot.blockAt(block.position);
      if (!fresh || !woodTypes.includes(fresh.name)) continue;

      const dug = await L_safeDig(bot, self, fresh);
      if (!dug.ok) {
        return count > 0
          ? `${lastName} 등 나무를 ${count}개 베어냈지만 중단했다: ${dug.msg}`
          : `나무를 베려 했지만 중단했다: ${dug.msg}`;
      }

      count++;
      lastName = fresh.name;
      await L_sleep(150);
    }

    return count > 0
      ? `${lastName} 등 나무를 연속으로 ${count}개 베어냈다.`
      : '나무를 베지 못했다.';
  }

  async function L_mine(bot, self, target) {
    const emergency = await L_emergencyOnly(bot, self);
    if (emergency) return `생존 우선으로 채굴을 미룸: ${emergency}`;

    let tier = L_pickaxeTier(bot);
    const t = L_norm(target || '');

    if (tier < 1) {
      const made = await L_craftSmart(bot, self, 'wooden_pickaxe');
      tier = L_pickaxeTier(bot);

      if (tier < 1) {
        return '돌/광물은 맨손으로 캐면 아무것도 얻지 못한다. 먼저 나무를 캐서 작업대와 나무 곡괭이를 만들어야 한다.';
      }

      console.log(`⛏️ [도구상식] ${made}`);
    }

    if ((t.includes('iron') || t.includes('copper') || t.includes('lapis')) && tier < 2) {
      let stone = L_stoneLikeCount(bot);

      if (stone < 3) {
        const need = 3 - stone;
        console.log(`⛏️ [도구상식] 철/구리를 캐기 전에 돌 곡괭이용 돌 ${need}개 확보`);
        await L_mineBlockList(bot, self, ['stone', 'deepslate', 'cobblestone'], need, 32);
        stone = L_stoneLikeCount(bot);
      }

      if (stone >= 3) {
        await L_craftSmart(bot, self, 'stone_pickaxe');
        tier = L_pickaxeTier(bot);
      }

      if (tier < 2) {
        return '철광석은 나무 곡괭이로 캐면 안 된다. 먼저 돌을 캐서 돌 곡괭이를 만들어야 한다.';
      }
    }

    if (t.includes('diamond') && tier < 3) {
      const ironIngots = L_count(bot, 'iron_ingot');

      if (ironIngots >= 3) {
        await L_craftSmart(bot, self, 'iron_pickaxe');
        tier = L_pickaxeTier(bot);
      }

      if (tier < 3) {
        return '다이아몬드는 철 곡괭이 이상이 필요하다. 먼저 철 곡괭이를 만들어야 한다.';
      }
    }

    const targets = L_mineTargets(bot, target, tier);
    const result = await L_mineBlockList(bot, self, targets, 10, 32);

    if (result.count > 0) {
      return `${result.name} 등 자원을 연속으로 ${result.count}개 채굴했다.`;
    }

    return result.stopped || `${target || '자원'}을 캘 수 있게 드러난 곳을 찾지 못했다.`;
  }

  async function L_buildNetherPortalFixed(bot, self) {
    const obsidian = L_items(bot).find(i => i.name === 'obsidian');
    if (!obsidian || obsidian.count < 14) {
      return `현재 포탈 건설 로직은 완전한 프레임 기준이라 흑요석 14개가 필요하다. 지금 ${obsidian?.count || 0}개뿐이다.`;
    }

    const flint = L_items(bot).find(i => i.name === 'flint_and_steel');
    if (!flint) return '점화할 부싯돌과 쇳조각이 없다.';

    const basePos = bot.entity.position.floored();
    const frame = [];

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 4; x++) {
        if (y === 0 || y === 4 || x === 0 || x === 3) {
          frame.push({ x, y, z: 0 });
        }
      }
    }

    let placed = 0;

    for (const off of frame) {
      const p = basePos.offset(off.x, off.y, off.z);
      const existing = bot.blockAt(p);

      if (existing?.name === 'obsidian') {
        placed++;
        continue;
      }

      if (existing && !AIR_NAMES.has(existing.name)) continue;

      const ob = L_items(bot).find(i => i.name === 'obsidian');
      if (!ob) break;

      const refPositions = [
        p.offset(0, -1, 0),
        p.offset(-1, 0, 0),
        p.offset(1, 0, 0),
        p.offset(0, 1, 0),
        p.offset(0, 0, -1),
        p.offset(0, 0, 1)
      ];

      let refBlock = null;
      let faceVec = null;

      for (const rp of refPositions) {
        const rb = bot.blockAt(rp);
        if (rb && !AIR_NAMES.has(rb.name) && rb.name !== 'water' && rb.name !== 'lava') {
          refBlock = rb;
          faceVec = p.minus(rp);
          break;
        }
      }

      if (!refBlock) continue;

      try {
        await bot.equip(ob, 'hand');
        await bot.placeBlock(refBlock, faceVec);
        placed++;
        await L_sleep(300);
      } catch {}
    }

    if (placed < frame.length) {
      return `포탈 프레임이 ${placed}/${frame.length}블록만 완성됐다. 더 평평한 곳에서 다시 시도해야 한다.`;
    }

    try {
      await bot.equip(flint, 'hand');
      const igniteRef = bot.blockAt(basePos.offset(1, 0, 0));
      await bot.activateBlock(igniteRef);

      self.state.poi = self.state.poi || [];
      self.state.poi.push({
        label: 'nether_portal',
        x: basePos.x,
        y: basePos.y,
        z: basePos.z
      });
      if (self.state.poi.length > 8) self.state.poi.shift();

      if (typeof saveJSON === 'function') saveJSON(`state_${self.name}.json`, self.state);
      await L_remember(self, '흑요석 포탈을 짓고 점화했다.');

      return '포탈을 완성하고 점화했다.';
    } catch (e) {
      return `프레임은 완성했지만 점화에 실패했다: ${e.message}`;
    }
  }

  function L_attachDamageInterrupt(bot, self) {
    if (!bot || !self || self.__stableDamageAttached) return;
    self.__stableDamageAttached = true;
    self.__stableLastHealth = bot.health;

    bot.on('health', () => {
      try {
        if (!bot.entity || !self.isAlive) return;

        const before = self.__stableLastHealth ?? bot.health;
        const now = bot.health;
        self.__stableLastHealth = now;

        if (now < before) {
          console.log(`🩸 [생존본능] 피해 감지 ${before} → ${now}, 현재 작업 중단`);
          L_stopWork(bot);

          L_emergencyOnly(bot, self)
            .then(r => {
              if (r) {
                self.lastActionResult = `[피해 대응] ${r}`;
                L_remember(self, self.lastActionResult).catch(() => {});
              }
            })
            .catch(() => {});
        }
      } catch {}
    });
  }

  const OLD_FAIL = looksLikeFailure;
  looksLikeFailure = function (result) {
    const t = String(result || '').toLowerCase();

    return Boolean(OLD_FAIL && OLD_FAIL(result)) || [
      '못했다', '못함', '부족', '없어서', '없었다', '필요한데',
      '실패', '에러', '시간 초과', 'timeout', 'too long', 'took too long',
      'took to long', 'aborted', '놓쳤다', '찾지 못', '중단',
      '위험', '맨손', '낮은 도구', '쓸모가 없다', '필요하다',
      '도망', '미룸'
    ].some(k => t.includes(k.toLowerCase()));
  };

  const NATIVE_DESCS = {
    build_blueprint: 'target에 건물 이름을 넣으면 3D 설계도를 구상해 건설한다. (네이티브)',
    manage_project: 'target에 장기 프로젝트 이름을 넣으면 하위 단계로 쪼개 추적한다. (네이티브)',
    smart_store: '가방의 여분 아이템을 여러 상자에 나눠 보관한다. (네이티브)',
    check_status: '위협도, 자원 부족, 문명 발전 단계를 종합 점검한다. (네이티브)',
    hunt: '근처 동물을 추적해 사냥한다. 배가 고플 때 유용하다. (네이티브)',
    equip_armor: '가진 방어구를 실제로 몸에 착용한다. (네이티브)',
    shoot_bow: '활과 화살로 원거리에서 몬스터를 공격한다. (네이티브)',
    start_farm: '괭이와 씨앗으로 물 근처에 밭을 갈고 심는다. (네이티브)',
    harvest_farm: '다 자란 농작물을 수확한다. (네이티브)',
    breed_animals: '동물에게 먹이를 줘 번식을 유도한다. (네이티브)',
    go_to_poi: '기억해둔 장소(label 또는 target)로 이동한다. (네이티브)',
    build_nether_portal: '흑요석 14개와 부싯돌이 있으면 다른 차원으로 가는 문을 만든다. (네이티브)',
    clean_inventory: '가방의 흔한 잡동사니를 정리한다. (네이티브)',
    toss_item: '특정 아이템(target)을 가방에서 버린다. (네이티브)'
  };

  try {
    if (Array.isArray(BUILTIN_ACTIONS)) {
      for (const a of Object.keys(NATIVE_DESCS)) {
        if (!BUILTIN_ACTIONS.includes(a)) BUILTIN_ACTIONS.push(a);
      }
    }
  } catch {}

  const PREV_ENSURE_NATIVE = typeof ensureNativeActionsDiscoverable === 'function'
    ? ensureNativeActionsDiscoverable
    : null;

  ensureNativeActionsDiscoverable = function (self) {
    try {
      if (PREV_ENSURE_NATIVE) PREV_ENSURE_NATIVE(self);
    } catch {}

    self.skills = self.skills || {};
    let changed = false;

    for (const [name, desc] of Object.entries(NATIVE_DESCS)) {
      if (!self.skills[name] || self.skills[name].isNative || self.skills[name].code === '// native') {
        const old = self.skills[name] || {};
        self.skills[name] = {
          ...old,
          description: old.description || desc,
          code: '// native',
          isNative: true,
          successCount: old.successCount || 0,
          failCount: old.failCount || 0
        };
        changed = true;
      }
    }

    if (changed && typeof saveJSON === 'function') {
      saveJSON(`skills_${self.name}.json`, self.skills);
      console.log('🧩 [네이티브 안정화] 모든 native action 등록/정리 완료');
    }
  };

  const PREV_PERFORM = performBuiltinAction;
  performBuiltinAction = async function (bot, self, action, target, label) {
    if (!bot.entity) return '봇이 아직 스폰되지 않았다.';

    L_attachDamageInterrupt(bot, self);

    if (action === 'eat') {
      const r = await L_eat(bot, 20, true);
      return r || '먹을 수 있는 음식이 없거나 이미 충분히 배부르다.';
    }

    const emergency = await L_emergencyOnly(bot, self);
    if (emergency) return `생존 우선으로 '${action}' 행동을 미룸: ${emergency}`;

    if (action === 'craft_item') return await L_craftSmart(bot, self, target);
    if (action === 'gather_wood') return await L_gatherWood(bot, self);
    if (action === 'mine') return await L_mine(bot, self, target);
    if (action === 'build_nether_portal') return await L_buildNetherPortalFixed(bot, self);

    if (action === 'go_home') {
      if (!self.state.home_location) return '아직 집으로 기억해둔 곳이 없다.';

      const h = self.state.home_location;
      try {
        bot.pathfinder.setGoal(new goals.GoalNear(h.x, h.y, h.z, 2));
        return `집(${h.x}, ${h.z}) 근처로 이동을 시작했다.`;
      } catch (e) {
        return `집으로 이동하려 했지만 실패했다: ${e.message}`;
      }
    }

    if (action === 'go_to_poi') {
      const key = String(label || target || '').toLowerCase();
      if (!key || key === 'null') return '이동할 장소 이름이 필요하다.';

      const poi = (self.state.poi || []).find(p =>
        String(p.label || '').toLowerCase() === key ||
        String(p.label || '').toLowerCase().includes(key)
      );

      if (!poi) return `'${label || target}'이라는 장소를 기억하지 못한다.`;

      try {
        bot.pathfinder.setGoal(new goals.GoalNear(poi.x, poi.y, poi.z, 2));
        return `'${poi.label}'(${poi.x}, ${poi.z}) 근처로 이동을 시작했다.`;
      } catch (e) {
        return `장소 이동 실패: ${e.message}`;
      }
    }

    if (action === 'build_shelter') {
      const buildPos = bot.entity.position.floored();
      const result = await PREV_PERFORM(bot, self, action, target, label);

      if (!looksLikeFailure(result) && /블록\s*\d+개|대피소|지붕형/.test(String(result))) {
        self.state.home_location = {
          x: Math.round(buildPos.x),
          y: Math.round(buildPos.y),
          z: Math.round(buildPos.z)
        };

        if (typeof saveJSON === 'function') saveJSON(`state_${self.name}.json`, self.state);
        console.log(`🏠 [자동 집 등록] 대피소 위치를 집으로 저장: (${self.state.home_location.x}, ${self.state.home_location.z})`);
      }

      return result;
    }

    return await PREV_PERFORM(bot, self, action, target, label);
  };

  const PREV_EXECUTE = executeDecision;
  const OLD_NATIVE_WRAPPER_ACTIONS = new Set([
    'build_blueprint',
    'manage_project',
    'smart_store',
    'check_status'
  ]);

  executeDecision = async function (bot, self, item = {}) {
    L_attachDamageInterrupt(bot, self);

    try {
      if (typeof ensureNativeActionsDiscoverable === 'function') ensureNativeActionsDiscoverable(self);
      if (typeof attachEnvironmentListenersOnce === 'function') attachEnvironmentListenersOnce(bot, self);
    } catch {}

    const action = item.action;
    if (!action) return '행동 이름이 없다.';

    if (action === 'learn_skill') {
      return await PREV_EXECUTE(bot, self, item);
    }

    if (self.skills?.[action]?.isNative && !OLD_NATIVE_WRAPPER_ACTIONS.has(action)) {
      try {
        return await performBuiltinAction(bot, self, action, item.target, item.label);
      } catch (e) {
        return `'${action}' 네이티브 행동 중 에러: ${e.message}`;
      }
    }

    return await PREV_EXECUTE(bot, self, item);
  };

  const PREV_THINK = thinkAndAct;
  thinkAndAct = async function (bot, self) {
    if (!bot.entity || !self.isAlive) return;

    L_attachDamageInterrupt(bot, self);

    try {
      if (typeof ensureNativeActionsDiscoverable === 'function') ensureNativeActionsDiscoverable(self);
    } catch {}

    const survival = await L_preThinkSurvival(bot, self);
    if (survival) {
      self.lastActionResult = `[생존본능] ${survival}`;
      console.log(`🛡️ [생존본능] GPT/큐 판단 전 우선 처리: ${survival}`);
      await L_remember(self, self.lastActionResult);
      return;
    }

    return await PREV_THINK(bot, self);
  };

  const PREV_REFLEX = reflexLoop;
  reflexLoop = async function (bot, self) {
    if (!bot.entity || !self.isAlive) return;

    L_attachDamageInterrupt(bot, self);

    const emergency = await L_emergencyOnly(bot, self);
    if (emergency) {
      self.lastActionResult = `[반사신경] ${emergency}`;
      return;
    }

    return await PREV_REFLEX(bot, self);
  };
})();

// ════════════════════════════════════════════════════════════════════════
// [SELF-DEV PICKUP PATCH V1]
// - 캔 아이템/사냥 드랍을 그냥 두고 가는 문제 수정
// - bot.dig() 후 자동 드랍 회수
// - gather_wood/mine/hunt/harvest_farm 후 자동 회수
// - 배고픔 낮을 때 추가 자동 섭취
// - 이상 행동 기록: selfdev_Adam.json
// - 반복 이상 발생 시 회수 반경/시도 횟수 자동 조정
// - 코드 자동수정 대신 patch_proposals/에 제안서 생성
// ════════════════════════════════════════════════════════════════════════

;(() => {
  if (globalThis.__ADAM_SELF_DEV_PICKUP_PATCH_V1__) {
    console.log('🧠 [SELF-DEV PICKUP V1] 이미 로드됨');
    return;
  }

  globalThis.__ADAM_SELF_DEV_PICKUP_PATCH_V1__ = true;
  console.log('🧠 [SELF-DEV PICKUP V1] 드랍 회수/자기점검/정책자가개선 로드');

  const SD_fs = (() => {
    try { return fs; } catch { return require('fs'); }
  })();

  const SD_goals = (() => {
    try { return goals; } catch { return require('mineflayer-pathfinder').goals; }
  })();

  const SD_RESOURCE_ACTIONS = new Set([
    'gather_wood',
    'mine',
    'hunt',
    'harvest_farm',
    'collect_drops'
  ]);

  const SD_NATIVE_ACTIONS = {
    collect_drops: '근처에 떨어진 아이템을 찾아 실제 인벤토리에 들어올 때까지 회수한다. (네이티브)',
    self_review: '최근 실패/비효율/위험 행동을 점검하고 자기개선 정책을 요약한다. (네이티브)',
    propose_patch: '반복되는 이상 행동을 바탕으로 patch_proposals 폴더에 패치 제안서를 만든다. (네이티브)'
  };

  const SD_HOSTILES = new Set([
    'zombie', 'husk', 'drowned',
    'skeleton', 'stray',
    'creeper', 'spider', 'witch', 'phantom',
    'slime', 'pillager', 'vindicator',
    'enderman'
  ]);

  const SD_FOOD_SCORE = {
    cooked_beef: 10,
    cooked_porkchop: 10,
    cooked_mutton: 8,
    bread: 7,
    cooked_chicken: 7,
    baked_potato: 7,
    apple: 5,
    carrot: 5,
    beef: 4,
    porkchop: 4,
    mutton: 4,
    chicken: 3,
    potato: 2,
    rotten_flesh: 1
  };

  function SD_sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function SD_safeName(self) {
    return String(self?.name || 'Adam').replace(/[^\w.-]/g, '_');
  }

  function SD_selfdevFile(self) {
    return `selfdev_${SD_safeName(self)}.json`;
  }

  function SD_defaultSelfDev() {
    return {
      version: 1,
      rules: {
        dropSweepMaxDistance: 12,
        dropSweepRounds: 8,
        digPickupRadius: 6,
        digPickupRounds: 2,
        quickPickupRadius: 4,
        quickPickupCooldownMs: 6000,
        dangerRadius: 8,
        eatBeforeLongWorkFoodBelow: 14,
        eatAfterWorkFoodBelow: 10
      },
      counters: {},
      observations: [],
      proposals: []
    };
  }

  function SD_load(self) {
    const def = SD_defaultSelfDev();
    const file = SD_selfdevFile(self);

    try {
      if (!SD_fs.existsSync(file)) return def;

      const raw = JSON.parse(SD_fs.readFileSync(file, 'utf8'));

      return {
        ...def,
        ...raw,
        rules: {
          ...def.rules,
          ...(raw.rules || {})
        },
        counters: raw.counters || {},
        observations: Array.isArray(raw.observations) ? raw.observations : [],
        proposals: Array.isArray(raw.proposals) ? raw.proposals : []
      };
    } catch (e) {
      console.log(`⚠️ [SELF-DEV] ${file} 읽기 실패, 기본값 사용: ${e.message}`);
      return def;
    }
  }

  function SD_save(self, data) {
    try {
      SD_fs.writeFileSync(SD_selfdevFile(self), JSON.stringify(data, null, 2));
    } catch (e) {
      console.log(`⚠️ [SELF-DEV] 저장 실패: ${e.message}`);
    }
  }

  function SD_writeProposal(self, type, data, details) {
    try {
      SD_fs.mkdirSync('patch_proposals', { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeType = String(type || 'review').replace(/[^\w.-]/g, '_').slice(0, 60);
      const file = `patch_proposals/${stamp}_${SD_safeName(self)}_${safeType}.md`;

      const content = [
        `# Adam Self-Improvement Proposal`,
        ``,
        `- Citizen: ${self?.name || 'Adam'}`,
        `- Type: ${type}`,
        `- Created: ${new Date().toISOString()}`,
        ``,
        `## Symptom`,
        ``,
        `Adam detected repeated abnormal or inefficient behavior.`,
        ``,
        `## Details`,
        ``,
        '```json',
        JSON.stringify(details || {}, null, 2),
        '```',
        ``,
        `## Current Adaptive Rules`,
        ``,
        '```json',
        JSON.stringify(data.rules || {}, null, 2),
        '```',
        ``,
        `## Suggestion`,
        ``,
        `Do not directly auto-edit citizen.cjs yet.`,
        `Review the logs and this proposal. If the pattern is valid, convert it into a stable patch.`,
        ``,
        `Typical fixes may include:`,
        ``,
        `1. Add a stronger postcondition check after the action.`,
        `2. Verify inventory delta instead of trusting action text.`,
        `3. Increase recovery attempts only when danger is absent.`,
        `4. Add a native action instead of relying on generated skill code.`,
        ``
      ].join('\n');

      SD_fs.writeFileSync(file, content);

      data.proposals = data.proposals || [];
      data.proposals.push({
        at: new Date().toISOString(),
        type,
        file
      });

      while (data.proposals.length > 20) data.proposals.shift();

      console.log(`🧠 [SELF-DEV] 패치 제안 생성: ${file}`);
      return file;
    } catch (e) {
      console.log(`⚠️ [SELF-DEV] 패치 제안 생성 실패: ${e.message}`);
      return null;
    }
  }

  function SD_record(self, type, rawDetails = {}) {
    const data = SD_load(self);

    const details =
      rawDetails && typeof rawDetails === 'object'
        ? rawDetails
        : { message: String(rawDetails ?? '') };

    data.counters[type] = (data.counters[type] || 0) + 1;

    data.observations.push({
      at: new Date().toISOString(),
      type,
      details
    });

    while (data.observations.length > 100) data.observations.shift();

    if (type === 'drops_left_after_work' || type === 'dig_drop_not_collected') {
      const oldDistance = data.rules.dropSweepMaxDistance;
      const oldRounds = data.rules.dropSweepRounds;

      data.rules.dropSweepMaxDistance = Math.min(24, oldDistance + 2);
      data.rules.dropSweepRounds = Math.min(16, oldRounds + 1);
      data.rules.digPickupRadius = Math.min(10, data.rules.digPickupRadius + 1);

      details.adjustedRules = {
        dropSweepMaxDistance: [oldDistance, data.rules.dropSweepMaxDistance],
        dropSweepRounds: [oldRounds, data.rules.dropSweepRounds]
      };
    }

    if (type === 'hungry_while_working') {
      const oldFood = data.rules.eatBeforeLongWorkFoodBelow;
      data.rules.eatBeforeLongWorkFoodBelow = Math.min(18, oldFood + 1);

      details.adjustedRules = {
        eatBeforeLongWorkFoodBelow: [oldFood, data.rules.eatBeforeLongWorkFoodBelow]
      };
    }

    if (data.counters[type] % 3 === 0) {
      SD_writeProposal(self, type, data, details);
    }

    SD_save(self, data);
    return data;
  }

  function SD_items(bot) {
    try {
      return bot.inventory?.items?.() || [];
    } catch {
      return [];
    }
  }

  function SD_inv(bot) {
    const out = {};

    for (const item of SD_items(bot)) {
      out[item.name] = (out[item.name] || 0) + item.count;
    }

    return out;
  }

  function SD_positiveDiff(before, after) {
    const diff = {};

    for (const [name, count] of Object.entries(after || {})) {
      const gained = count - (before?.[name] || 0);
      if (gained > 0) diff[name] = gained;
    }

    return diff;
  }

  function SD_total(diff) {
    return Object.values(diff || {}).reduce((a, b) => a + b, 0);
  }

  function SD_diffText(diff) {
    return Object.entries(diff || {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `${name}×${count}`)
      .join(', ') || '없음';
  }

  function SD_isDropEntity(entity) {
    if (!entity?.position) return false;

    const name = String(entity.name || '').toLowerCase();
    const objectType = String(entity.displayName || '').toLowerCase();
    const displayName = String(entity.displayName || '').toLowerCase();

    return (
      name === 'item' ||
      objectType === 'item' ||
      displayName === 'item'
    );
  }

  function SD_dropEntities(bot, maxDistance = 12) {
    if (!bot?.entity) return [];

    const base = bot.entity.position;

    return Object.values(bot.entities || {})
      .filter(SD_isDropEntity)
      .filter(entity => {
        try {
          return base.distanceTo(entity.position) <= maxDistance;
        } catch {
          return false;
        }
      })
      .sort((a, b) => base.distanceTo(a.position) - base.distanceTo(b.position));
  }

  function SD_nearestHostile(bot, radius = 8) {
    if (!bot?.entity) return null;

    try {
      const base = bot.entity.position;

      return bot.nearestEntity(entity =>
        entity?.position &&
        SD_HOSTILES.has(entity.name) &&
        base.distanceTo(entity.position) <= radius
      );
    } catch {
      return null;
    }
  }

  function SD_foodScore(name) {
    if (SD_FOOD_SCORE[name]) return SD_FOOD_SCORE[name];
    if (String(name).includes('cooked')) return 7;
    return 0;
  }

  function SD_findFood(bot, allowRisky = false) {
    const risky = new Set([
      'rotten_flesh',
      'spider_eye',
      'pufferfish',
      'poisonous_potato'
    ]);

    return SD_items(bot)
      .filter(item => SD_foodScore(item.name) > 0)
      .filter(item => allowRisky || !risky.has(item.name))
      .sort((a, b) => SD_foodScore(b.name) - SD_foodScore(a.name))[0] || null;
  }

  async function SD_eatIfNeeded(bot, self, threshold = 14, allowRisky = false) {
    if (!bot?.entity) return null;
    if (typeof bot.food !== 'number') return null;
    if (bot.food >= threshold) return null;

    const food = SD_findFood(bot, allowRisky || bot.food <= 6);

    if (!food) {
      SD_record(self, 'hungry_no_food', {
        food: bot.food,
        threshold
      });
      return null;
    }

    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      return `배고픔 ${bot.food}/20 상태라 ${food.name}을 먹었다.`;
    } catch (e) {
      SD_record(self, 'eat_failed', {
        food: food.name,
        error: e.message
      });
      return `먹으려 했지만 실패했다: ${e.message}`;
    }
  }

  async function SD_gotoNearPos(bot, pos, radius = 1, timeoutMs = 2500) {
    if (!bot?.entity || !bot.pathfinder || !pos) return false;
    if (!SD_goals?.GoalNear) return false;

    const p = typeof pos.floored === 'function' ? pos.floored() : pos;

    try {
      await Promise.race([
        bot.pathfinder.goto(new SD_goals.GoalNear(p.x, p.y, p.z, radius)),
        SD_sleep(timeoutMs).then(() => {
          throw new Error('pickup timeout');
        })
      ]);

      return true;
    } catch {
      try { bot.pathfinder.setGoal(null); } catch {}
      return false;
    }
  }

  async function SD_collectNearbyDrops(bot, self, options = {}) {
    if (!bot?.entity) {
      return {
        pickedTotal: 0,
        remaining: 0,
        text: '봇 위치가 없어 드랍 회수를 못했다.'
      };
    }

    const data = SD_load(self);
    const rules = data.rules || {};

    const maxDistance = Number(options.maxDistance ?? rules.dropSweepMaxDistance ?? 12);
    const rounds = Number(options.rounds ?? rules.dropSweepRounds ?? 8);
    const dangerRadius = Number(rules.dangerRadius ?? 8);

    const before = SD_inv(bot);

    let visited = 0;
    let noDropRounds = 0;
    let blockedByDanger = null;
    const tried = new Set();

    for (let round = 0; round < rounds; round++) {
      const hostile = SD_nearestHostile(bot, dangerRadius);

      if (hostile) {
        blockedByDanger = hostile.name;
        break;
      }

      const drops = SD_dropEntities(bot, maxDistance)
        .filter(entity => !tried.has(entity.id));

      if (!drops.length) {
        noDropRounds++;
        if (noDropRounds >= 2) break;
        await SD_sleep(200);
        continue;
      }

      noDropRounds = 0;

      for (const drop of drops.slice(0, 3)) {
        const live = (bot.entities || {})[drop.id] || drop;
        tried.add(drop.id);

        if (!live?.position || !bot.entity) continue;

        const dist = bot.entity.position.distanceTo(live.position);
        if (dist > maxDistance) continue;

        await SD_gotoNearPos(bot, live.position, 1, 2500);
        await SD_sleep(350);
        visited++;

        const dangerNow = SD_nearestHostile(bot, dangerRadius);
        if (dangerNow) {
          blockedByDanger = dangerNow.name;
          break;
        }
      }

      if (blockedByDanger) break;
    }

    const after = SD_inv(bot);
    const diff = SD_positiveDiff(before, after);
    const pickedTotal = SD_total(diff);
    const remaining = SD_dropEntities(bot, Math.min(maxDistance, 12)).length;

    let text;

    if (pickedTotal > 0) {
      text = `떨어진 아이템 회수: ${SD_diffText(diff)}`;
    } else if (blockedByDanger) {
      text = `${blockedByDanger} 위험 때문에 드랍 회수를 중단했다.`;
    } else if (remaining > 0) {
      text = `근처 드랍 ${remaining}개가 아직 남아 있다.`;
    } else {
      text = '근처에 회수할 드랍이 없다.';
    }

    if (pickedTotal === 0 && remaining > 0 && !blockedByDanger && visited > 0) {
      SD_record(self, 'drops_left_after_work', {
        reason: options.reason || 'collectNearbyDrops',
        maxDistance,
        rounds,
        remaining,
        visited
      });
    }

    return {
      pickedTotal,
      diff,
      remaining,
      visited,
      blockedByDanger,
      text
    };
  }

  function SD_looksProductive(result) {
    const text = String(result || '').toLowerCase();

    return /베어냈|캤|채굴|사냥|수확|주웠|얻었다|gathered|mined|chopped|collected|dug|killed/.test(text);
  }

  function SD_shouldSweep(action, result) {
    const act = String(action || '');

    return (
      SD_RESOURCE_ACTIONS.has(act) ||
      SD_looksProductive(result)
    );
  }

  function SD_blockMayDrop(name) {
    if (!name) return false;

    return ![
      'air',
      'cave_air',
      'void_air',
      'water',
      'lava',
      'fire',
      'soul_fire'
    ].includes(name);
  }

  function SD_installNativeSkills(self) {
    if (!self) return;

    self.skills = self.skills || {};

    let changed = false;

    for (const [name, description] of Object.entries(SD_NATIVE_ACTIONS)) {
      if (!self.skills[name] || self.skills[name].isNative || self.skills[name].code === '// native') {
        const old = self.skills[name] || {};

        self.skills[name] = {
          ...old,
          description: old.description || description,
          code: '// native',
          isNative: true,
          successCount: old.successCount || 0,
          failCount: old.failCount || 0
        };

        changed = true;
      }
    }

    if (changed) {
      try {
        if (typeof saveJSON === 'function') {
          saveJSON(`skills_${self.name}.json`, self.skills);
        }
      } catch {}
    }
  }

  function SD_selfReview(bot, self) {
    const data = SD_load(self);
    const rules = data.rules || {};
    const counters = Object.entries(data.counters || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `${name}:${count}`)
      .join(', ') || '없음';

    const closeDrops = SD_dropEntities(bot, rules.dropSweepMaxDistance || 12).length;
    const hostile = SD_nearestHostile(bot, rules.dangerRadius || 8);

    const suggestions = [];

    if (closeDrops > 0) {
      suggestions.push('근처 드랍템이 있으므로 collect_drops 우선 실행');
    }

    if (typeof bot?.food === 'number' && bot.food < rules.eatBeforeLongWorkFoodBelow) {
      suggestions.push('배고픔이 낮으므로 장시간 작업 전 섭취 필요');
    }

    if (hostile) {
      suggestions.push(`${hostile.name} 위험 감지, 자원 작업보다 전투/도주 우선`);
    }

    if (!suggestions.length) {
      suggestions.push('즉시 수정할 이상 징후 없음');
    }

    return [
      '[자기점검]',
      `- 체력: ${bot?.health ?? '?'} / 20`,
      `- 배고픔: ${bot?.food ?? '?'} / 20`,
      `- 근처 드랍템: ${closeDrops}개`,
      `- 근처 적대몹: ${hostile ? hostile.name : '없음'}`,
      `- 반복 이상 카운터: ${counters}`,
      `- 현재 자기개선 규칙: ${JSON.stringify(rules)}`,
      `- 제안: ${suggestions.join(' / ')}`
    ].join('\n');
  }

  function SD_forceProposal(bot, self, target) {
    const data = SD_load(self);
    const type = String(target || 'manual_review')
      .replace(/[^\w.-]/g, '_')
      .slice(0, 60) || 'manual_review';

    const file = SD_writeProposal(self, type, data, {
      manual: true,
      health: bot?.health,
      food: bot?.food,
      nearbyDrops: SD_dropEntities(bot, data.rules.dropSweepMaxDistance || 12).length,
      recentCounters: data.counters
    });

    SD_save(self, data);

    return file
      ? `패치 제안서를 만들었다: ${file}`
      : '패치 제안서를 만들지 못했다.';
  }

  function SD_attach(bot, self) {
    if (!bot) return;

    SD_installNativeSkills(self);

    if (bot.__adamSelfDevPickupAttached) return;
    bot.__adamSelfDevPickupAttached = true;

    try {
      bot.on('playerCollect', (collector, collected) => {
        try {
          if (collector?.id === bot.entity?.id) {
            self.__sdLastCollectAt = Date.now();
          }
        } catch {}
      });
    } catch {}

    if (typeof bot.dig === 'function' && !bot.__adamDigAutoCollectWrapped) {
      bot.__adamDigAutoCollectWrapped = true;

      const originalDig = bot.dig.bind(bot);
      bot.__adamOriginalDigForPickup = originalDig;

      bot.dig = async function adamPatchedDig(block, ...args) {
        const blockName = block?.name;
        const beforeInv = SD_inv(bot);

        let result;
        let error;

        try {
          result = await originalDig(block, ...args);
        } catch (e) {
          error = e;
        }

        if (!error && SD_blockMayDrop(blockName)) {
          await SD_sleep(220);

          const data = SD_load(self);
          const rules = data.rules || {};
          const danger = SD_nearestHostile(bot, rules.dangerRadius || 8);

          if (!danger) {
            const sweep = await SD_collectNearbyDrops(bot, self, {
              reason: `dig:${blockName}`,
              maxDistance: rules.digPickupRadius || 6,
              rounds: rules.digPickupRounds || 2
            });

            const gainedAfterWholeDig = SD_total(SD_positiveDiff(beforeInv, SD_inv(bot)));

            if (
              gainedAfterWholeDig === 0 &&
              SD_dropEntities(bot, Math.min(rules.digPickupRadius || 6, 6)).length > 0
            ) {
              SD_record(self, 'dig_drop_not_collected', {
                blockName,
                sweepText: sweep.text,
                nearbyDrops: SD_dropEntities(bot, 6).length
              });
            }

            if (sweep.pickedTotal > 0 && self) {
              self.lastActionResult = `[자동회수] ${sweep.text}`;
            }
          }
        }

        if (error) throw error;
        return result;
      };
    }
  }

  try {
    if (Array.isArray(BUILTIN_ACTIONS)) {
      for (const action of Object.keys(SD_NATIVE_ACTIONS)) {
        if (!BUILTIN_ACTIONS.includes(action)) {
          BUILTIN_ACTIONS.push(action);
        }
      }
    }
  } catch {}

  try {
    const PREV_ENSURE_NATIVE_SD =
      typeof ensureNativeActionsDiscoverable === 'function'
        ? ensureNativeActionsDiscoverable
        : null;

    if (PREV_ENSURE_NATIVE_SD) {
      ensureNativeActionsDiscoverable = function selfDevEnsureNative(self) {
        try {
          PREV_ENSURE_NATIVE_SD(self);
        } catch {}

        SD_installNativeSkills(self);
      };
    }
  } catch {}

  try {
    const PREV_PERFORM_SD = performBuiltinAction;

    performBuiltinAction = async function selfDevPerformBuiltinAction(bot, self, action, target, label) {
      SD_installNativeSkills(self);
      SD_attach(bot, self);

      const act = String(action || '');

      if (act === 'collect_drops') {
        const sweep = await SD_collectNearbyDrops(bot, self, {
          reason: 'manual_collect_drops',
          maxDistance: SD_load(self).rules.dropSweepMaxDistance,
          rounds: SD_load(self).rules.dropSweepRounds
        });

        return sweep.text;
      }

      if (act === 'self_review') {
        return SD_selfReview(bot, self);
      }

      if (act === 'propose_patch') {
        return SD_forceProposal(bot, self, target);
      }

      const beforeInv = SD_inv(bot);
      const rulesBefore = SD_load(self).rules || {};
      let prefix = '';

      if (
        SD_RESOURCE_ACTIONS.has(act) &&
        typeof bot?.food === 'number' &&
        bot.food < (rulesBefore.eatBeforeLongWorkFoodBelow || 14)
      ) {
        const eaten = await SD_eatIfNeeded(
          bot,
          self,
          rulesBefore.eatBeforeLongWorkFoodBelow || 14,
          false
        );

        if (eaten) {
          prefix = `[자동섭취] ${eaten}\n`;
        } else {
          SD_record(self, 'hungry_while_working', {
            action: act,
            food: bot.food,
            threshold: rulesBefore.eatBeforeLongWorkFoodBelow || 14
          });
        }
      }

      const result = await PREV_PERFORM_SD(bot, self, action, target, label);
      let text = prefix + String(result ?? '');

      const rulesAfter = SD_load(self).rules || {};

      if (SD_shouldSweep(act, text)) {
        await SD_sleep(250);

        const sweep = await SD_collectNearbyDrops(bot, self, {
          reason: `after_action:${act}`,
          maxDistance: rulesAfter.dropSweepMaxDistance || 12,
          rounds: rulesAfter.dropSweepRounds || 8
        });

        if (sweep.pickedTotal > 0) {
          text += `\n[자동회수] ${sweep.text}`;
        }

        const gained = SD_total(SD_positiveDiff(beforeInv, SD_inv(bot)));

        if (
          SD_looksProductive(text) &&
          gained === 0 &&
          SD_dropEntities(bot, Math.min(rulesAfter.dropSweepMaxDistance || 12, 12)).length > 0
        ) {
          SD_record(self, 'drops_left_after_work', {
            action: act,
            result: __adamSafeTextForMemory(text).slice(0, 500),
            nearbyDrops: SD_dropEntities(bot, 12).length
          });
        }
      }

      if (
        SD_RESOURCE_ACTIONS.has(act) &&
        typeof bot?.food === 'number' &&
        bot.food <= (rulesAfter.eatAfterWorkFoodBelow || 10)
      ) {
        const eaten = await SD_eatIfNeeded(
          bot,
          self,
          Math.max(14, rulesAfter.eatBeforeLongWorkFoodBelow || 14),
          true
        );

        if (eaten) {
          text += `\n[작업후 섭취] ${eaten}`;
        }
      }

      return text;
    };
  } catch (e) {
    console.log(`⚠️ [SELF-DEV] performBuiltinAction 래핑 실패: ${e.message}`);
  }

  try {
    const PREV_THINK_SD = thinkAndAct;

    thinkAndAct = async function selfDevThinkAndAct(bot, self) {
      SD_installNativeSkills(self);
      SD_attach(bot, self);

      const data = SD_load(self);
      const rules = data.rules || {};
      const danger = SD_nearestHostile(bot, rules.dangerRadius || 8);

      if (!danger) {
        if (
          typeof bot?.food === 'number' &&
          bot.food < (rules.eatBeforeLongWorkFoodBelow || 14)
        ) {
          const eaten = await SD_eatIfNeeded(
            bot,
            self,
            rules.eatBeforeLongWorkFoodBelow || 14,
            false
          );

          if (eaten) {
            self.lastActionResult = `[자기관리] ${eaten}`;
            return;
          }
        }

        const now = Date.now();
        const lastPickup = self.__sdQuickPickupAt || 0;

        if (now - lastPickup > (rules.quickPickupCooldownMs || 6000)) {
          const closeDrops = SD_dropEntities(bot, rules.quickPickupRadius || 4);

          if (closeDrops.length > 0) {
            self.__sdQuickPickupAt = now;

            const sweep = await SD_collectNearbyDrops(bot, self, {
              reason: 'quick_pickup_before_think',
              maxDistance: rules.quickPickupRadius || 4,
              rounds: 2
            });

            if (sweep.pickedTotal > 0) {
              self.lastActionResult = `[자동회수] ${sweep.text}`;
              return;
            }
          }
        }
      }

      return await PREV_THINK_SD(bot, self);
    };
  } catch (e) {
    console.log(`⚠️ [SELF-DEV] thinkAndAct 래핑 실패: ${e.message}`);
  }

  try {
    const PREV_EXECUTE_SD = executeDecision;

    executeDecision = async function selfDevExecuteDecision(bot, self, item = {}) {
      SD_installNativeSkills(self);
      SD_attach(bot, self);

      const act = String(item.action || '');

      if (Object.prototype.hasOwnProperty.call(SD_NATIVE_ACTIONS, act)) {
        return await performBuiltinAction(bot, self, act, item.target, item.label);
      }

      return await PREV_EXECUTE_SD(bot, self, item);
    };
  } catch (e) {
    console.log(`⚠️ [SELF-DEV] executeDecision 래핑 실패: ${e.message}`);
  }
})();




// ============================================================================
// ADAM EMERGENCY FOOD V6
// - Fixes low-health + no-food infinite waiting.
// - Avoids dangerous normal work while starving.
// - Tries to eat inventory food, collect nearby drops, or hunt passive food mobs.
// ============================================================================
try {
  if (!global.__ADAM_EMERGENCY_FOOD_V6__) {
    global.__ADAM_EMERGENCY_FOOD_V6__ = true;

    const EF_wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const EF_BAD_FOOD = new Set([
      'poisonous_potato',
      'pufferfish',
      'spider_eye'
    ]);

    const EF_LAST_RESORT_FOOD = new Set([
      'rotten_flesh'
    ]);

    const EF_FOOD_SCORE = {
      enchanted_golden_apple: 130,
      golden_apple: 120,
      cooked_beef: 100,
      cooked_porkchop: 98,
      rabbit_stew: 96,
      golden_carrot: 95,
      cooked_mutton: 92,
      cooked_chicken: 90,
      cooked_salmon: 88,
      cooked_cod: 86,
      bread: 80,
      baked_potato: 76,
      pumpkin_pie: 74,
      mushroom_stew: 70,
      beetroot_soup: 68,
      apple: 58,
      beef: 55,
      porkchop: 55,
      mutton: 52,
      rabbit: 45,
      chicken: 42,
      salmon: 40,
      cod: 38,
      carrot: 35,
      beetroot: 30,
      sweet_berries: 28,
      glow_berries: 28,
      melon_slice: 25,
      cookie: 20,
      potato: 18,
      rotten_flesh: 2
    };

    const EF_HOSTILE_MOBS = new Set([
      'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
      'witch', 'drowned', 'husk', 'stray', 'phantom',
      'slime', 'magma_cube', 'silverfish', 'endermite',
      'pillager', 'vindicator', 'evoker', 'ravager',
      'guardian', 'elder_guardian', 'blaze', 'ghast',
      'hoglin', 'zoglin', 'piglin_brute', 'warden'
    ]);

    const EF_FOOD_MOBS = new Set([
      'cow', 'pig', 'sheep', 'chicken', 'rabbit',
      'cod', 'salmon',
      'mooshroom', 'mushroom_cow'
    ]);

    function EF_botReady() {
      return typeof bot !== 'undefined' && bot && bot.entity && bot.inventory;
    }

    function EF_entityName(entity) {
      return String((entity && (entity.name || entity.displayName)) || '')
        .toLowerCase()
        .replace(/\s+/g, '_');
    }

    function EF_isFoodItem(item, allowLastResort = false) {
      if (!item || !item.name) return false;

      const name = item.name;

      if (EF_BAD_FOOD.has(name)) return false;

      if (EF_LAST_RESORT_FOOD.has(name)) {
        return !!allowLastResort;
      }

      if (Object.prototype.hasOwnProperty.call(EF_FOOD_SCORE, name)) {
        return true;
      }

      return /(apple|bread|carrot|potato|beetroot|beef|porkchop|chicken|mutton|rabbit|cod|salmon|berries|melon_slice|pumpkin_pie|stew|soup|cookie)/.test(name);
    }

    function EF_foodScore(item) {
      if (!item || !item.name) return 0;

      const name = item.name;
      let score = Object.prototype.hasOwnProperty.call(EF_FOOD_SCORE, name)
        ? EF_FOOD_SCORE[name]
        : 30;

      if (name.startsWith('cooked_')) score += 15;
      if (name.includes('golden')) score += 20;
      if (EF_LAST_RESORT_FOOD.has(name)) score = 1;

      return score;
    }

    async function EF_eatBestFood(allowLastResort = false) {
      if (!EF_botReady()) return false;

      const foods = bot.inventory.items()
        .filter(item => EF_isFoodItem(item, allowLastResort))
        .sort((a, b) => EF_foodScore(b) - EF_foodScore(a));

      if (!foods.length) return false;

      for (const item of foods) {
        try {
          try {
            if (bot.pathfinder) bot.pathfinder.setGoal(null);
          } catch {}

          try {
            if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
          } catch {}

          await bot.equip(item, 'hand');
          await bot.consume();

          console.log('🍗 [비상식량] ' + item.name + ' 섭취 완료. health=' + bot.health + ', food=' + bot.food);
          await EF_wait(600);
          return true;
        } catch (err) {
          console.warn('⚠️ [비상식량] ' + item.name + ' 먹기 실패:', err && err.message ? err.message : err);
        }
      }

      return false;
    }

    function EF_hostiles(radius = 10) {
      if (!EF_botReady()) return [];

      const origin = bot.entity.position;

      return Object.values(bot.entities || {})
        .filter(entity => {
          if (!entity || !entity.position || entity === bot.entity) return false;
          const name = EF_entityName(entity);
          if (!EF_HOSTILE_MOBS.has(name)) return false;

          try {
            return entity.position.distanceTo(origin) <= radius;
          } catch {
            return false;
          }
        })
        .sort((a, b) => a.position.distanceTo(origin) - b.position.distanceTo(origin));
    }

    function EF_isDropEntity(entity) {
      if (!entity || !entity.position) return false;

      const type = String(entity.type || '').toLowerCase();
      const name = EF_entityName(entity);
      const display = String(entity.displayName || '').toLowerCase().replace(/\s+/g, '_');

      // New prismarine-entity style: use displayName/name, not objectType.
      return (
        name === 'item' ||
        name === 'dropped_item' ||
        display === 'item' ||
        display === 'dropped_item' ||
        (type === 'object' && (name === 'item' || display === 'item'))
      );
    }

    function EF_dropEntities(radius = 8) {
      if (!EF_botReady()) return [];

      const origin = bot.entity.position;

      return Object.values(bot.entities || {})
        .filter(EF_isDropEntity)
        .filter(entity => {
          try {
            return entity.position.distanceTo(origin) <= radius;
          } catch {
            return false;
          }
        })
        .sort((a, b) => a.position.distanceTo(origin) - b.position.distanceTo(origin));
    }

    function EF_nearestFoodMob(radius = 14) {
      if (!EF_botReady()) return null;

      const origin = bot.entity.position;

      const mobs = Object.values(bot.entities || {})
        .filter(entity => {
          if (!entity || !entity.position || entity === bot.entity) return false;

          const name = EF_entityName(entity);
          if (!EF_FOOD_MOBS.has(name)) return false;

          try {
            return entity.position.distanceTo(origin) <= radius;
          } catch {
            return false;
          }
        })
        .sort((a, b) => a.position.distanceTo(origin) - b.position.distanceTo(origin));

      return mobs[0] || null;
    }

    async function EF_walkNear(pos, range = 1.5, timeoutMs = 7000) {
      if (!EF_botReady() || !pos || !bot.pathfinder || typeof goals === 'undefined' || !goals.GoalNear) {
        return false;
      }

      try {
        const gx = Math.floor(pos.x);
        const gy = Math.floor(pos.y);
        const gz = Math.floor(pos.z);
        const gr = Math.max(1, Math.ceil(range));

        bot.pathfinder.setGoal(new goals.GoalNear(gx, gy, gz, gr), false);

        const started = Date.now();

        while (Date.now() - started < timeoutMs) {
          if (!bot.entity) break;

          try {
            if (bot.entity.position.distanceTo(pos) <= range + 0.7) {
              try {
                bot.pathfinder.setGoal(null);
              } catch {}
              return true;
            }
          } catch {}

          await EF_wait(250);
        }
      } catch (err) {
        console.warn('⚠️ [비상식량] 이동 실패:', err && err.message ? err.message : err);
      }

      try {
        if (bot.pathfinder) bot.pathfinder.setGoal(null);
      } catch {}

      return false;
    }

    async function EF_collectNearbyDrops(radius = 10, limit = 6) {
      if (!EF_botReady()) return false;

      const drops = EF_dropEntities(radius).slice(0, limit);

      if (!drops.length) return false;

      console.log('�� [비상식량] 근처 드랍 ' + drops.length + '개 회수 시도');

      let attempted = false;

      for (const drop of drops) {
        if (!drop || !drop.position) continue;

        attempted = true;
        await EF_walkNear(drop.position, 1.2, 6000);
        await EF_wait(600);
      }

      return attempted;
    }

    async function EF_huntPassiveFoodMob(radius = 14) {
      if (!EF_botReady()) return false;

      if (EF_hostiles(9).length > 0) {
        console.warn('⚠️ [비상식량] 근처 적대몹 때문에 사냥 보류');
        return false;
      }

      const target = EF_nearestFoodMob(radius);
      if (!target) return false;

      console.log('🐄 [비상식량] 음식 확보를 위해 ' + EF_entityName(target) + ' 사냥 시도');

      for (let i = 0; i < 18; i++) {
        if (!target || target.isValid === false) break;
        if (!bot.entities || !bot.entities[target.id]) break;

        if (EF_hostiles(8).length > 0) {
          console.warn('⚠️ [비상식량] 사냥 중 적대몹 접근, 중단');
          return false;
        }

        try {
          const dist = bot.entity.position.distanceTo(target.position);

          if (dist > 3) {
            await EF_walkNear(target.position, 2.2, 5000);
          }

          try {
            const lookPos = target.position.offset(0, Math.min(target.height || 1, 1.5), 0);
            await bot.lookAt(lookPos, true);
          } catch {}

          try {
            bot.attack(target);
          } catch {}

          await EF_wait(650);
        } catch {
          break;
        }
      }

      await EF_wait(800);
      await EF_collectNearbyDrops(8, 5);

      // Raw meat / emergency food allowed after hunting.
      return await EF_eatBestFood(true);
    }

    let EF_lastHelpAt = 0;

    async function EF_handleEmergencyFood() {
      if (!EF_botReady()) return false;

      const health = Number(bot.health || 20);
      const food = Number(bot.food || 20);

      if (health > 6 || food >= 18) return false;

      try {
        if (bot.pathfinder) bot.pathfinder.setGoal(null);
      } catch {}

      try {
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch {}

      const allowLastResort = health <= 2 || food <= 6;

      // 1. Inventory food first.
      if (await EF_eatBestFood(allowLastResort)) return true;

      // 2. If safe, collect nearby dropped items.
      if (EF_hostiles(9).length === 0) {
        if (await EF_collectNearbyDrops(10, 6)) {
          if (await EF_eatBestFood(allowLastResort || food <= 8)) return true;
        }

        // 3. If still no food, hunt passive food mob.
        if (await EF_huntPassiveFoodMob(14)) return true;
      }

      // 4. Still no food. Do not enter infinite silent wait; request help with cooldown.
      if (Date.now() - EF_lastHelpAt > 30000) {
        EF_lastHelpAt = Date.now();

        console.warn('🆘 [비상식량] 체력 ' + bot.health + '/20, 허기 ' + bot.food + '/20, 먹을 것 없음. 음식/안전 필요.');

        try {
          bot.chat('SOS: 체력/허기 위험. 먹을 음식이 없습니다.');
        } catch {}
      }

      await EF_wait(1800);
      return true;
    }

    const EF_prevThinkAndAct = (typeof thinkAndAct === 'function') ? thinkAndAct : null;

    if (EF_prevThinkAndAct) {
      thinkAndAct = async function emergencyFoodThinkAndAct(...args) {
        try {
          if (EF_botReady() && Number(bot.health || 20) <= 6 && Number(bot.food || 20) < 18) {
            const handled = await EF_handleEmergencyFood();
            if (handled) return true;
          }
        } catch (err) {
          console.warn('⚠️ [EMERGENCY FOOD V6] 처리 오류:', err && err.message ? err.message : err);
        }

        return EF_prevThinkAndAct.apply(this, args);
      };

      console.log('🍗 [EMERGENCY FOOD V6] 저체력+굶주림 무한대기 방지 로드');
    } else {
      console.log('🍗 [EMERGENCY FOOD V6] thinkAndAct를 찾지 못해서 자동 개입 스킵됨');
    }
  }
} catch (err) {
  console.warn('⚠️ [EMERGENCY FOOD V6] 설치 실패:', err && err.message ? err.message : err);
}




// ============================================================================
// ADAM PROBLEM SOLVING CORE V1
// 1. 반복 루프 방지기
// 2. 월드맵/POI 기억
// 3. 목표별 다중 전략
// 4. 전략 성공률 학습
// 5. 큐보다 욕구/문제해결 우선
// 6. 안전한 자기개발 제안 시스템
// ============================================================================
try {
  if (!global.__ADAM_PROBLEM_SOLVING_CORE_V1__) {
    global.__ADAM_PROBLEM_SOLVING_CORE_V1__ = true;

    const PSC_fs = require('fs');
    const PSC_path = require('path');

    const PSC_wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const PSC_AIR = new Set(['air', 'cave_air', 'void_air']);
    const PSC_LIQUID = new Set(['water', 'lava']);

    const PSC_LOGS = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log',
      'stripped_oak_log', 'stripped_spruce_log', 'stripped_birch_log',
      'stripped_jungle_log', 'stripped_acacia_log', 'stripped_dark_oak_log',
      'stripped_mangrove_log', 'stripped_cherry_log'
    ];

    const PSC_STONES = [
      'stone', 'deepslate', 'cobblestone', 'cobbled_deepslate', 'blackstone',
      'andesite', 'diorite', 'granite', 'tuff',
      'coal_ore', 'deepslate_coal_ore'
    ];

    const PSC_COBBLE_DROPS = [
      'cobblestone', 'cobbled_deepslate', 'blackstone'
    ];

    const PSC_PICKAXES = [
      'netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe',
      'stone_pickaxe', 'wooden_pickaxe', 'golden_pickaxe'
    ];

    const PSC_STONE_TOOLS = [
      'stone_pickaxe', 'stone_sword', 'stone_axe'
    ];

    const PSC_HOSTILES = new Set([
      'zombie', 'husk', 'drowned',
      'skeleton', 'stray',
      'creeper',
      'spider', 'cave_spider',
      'witch',
      'enderman',
      'slime', 'magma_cube',
      'pillager', 'vindicator', 'evoker', 'ravager',
      'phantom',
      'blaze', 'ghast',
      'hoglin', 'zoglin', 'piglin_brute',
      'guardian', 'elder_guardian',
      'warden'
    ]);

    const PSC_Vec3 = (() => {
      try {
        if (typeof Vec3 !== 'undefined') return Vec3;
      } catch {}
      try {
        return require('vec3').Vec3;
      } catch {
        return null;
      }
    })();

    let PSC_state = null;
    let PSC_lastSaveAt = 0;
    let PSC_lastScanAt = 0;
    let PSC_smartBusy = false;
    let PSC_lastNeedLogAt = 0;

    function PSC_botReady() {
      try {
        return typeof bot !== 'undefined' && bot && bot.entity && bot.inventory;
      } catch {
        return false;
      }
    }

    function PSC_botName() {
      try {
        if (PSC_botReady() && bot.username) return String(bot.username);
      } catch {}
      try {
        if (typeof self !== 'undefined' && self && self.name) return String(self.name);
      } catch {}
      return 'Adam';
    }

    function PSC_safeName(name) {
      return String(name || 'Adam').replace(/[^a-zA-Z0-9_.-]/g, '_');
    }

    function PSC_statePath() {
      return PSC_path.join(process.cwd(), 'problem_solver_' + PSC_safeName(PSC_botName()) + '.json');
    }

    function PSC_worldMapPath() {
      return PSC_path.join(process.cwd(), 'worldmap_' + PSC_safeName(PSC_botName()) + '.json');
    }

    function PSC_defaultState() {
      return {
        version: 'problem-solving-core-v1',
        updatedAt: new Date().toISOString(),
        loop: {
          failures: {},
          cooldowns: {},
          goalCooldowns: {}
        },
        strategies: {
          obtain_stone: {}
        },
        pois: {
          resources: [],
          craftingTables: [],
          deaths: [],
          dangerZones: [],
          bases: []
        },
        events: [],
        proposals: []
      };
    }

    function PSC_loadState() {
      if (PSC_state) return PSC_state;

      const file = PSC_statePath();

      try {
        if (PSC_fs.existsSync(file)) {
          const parsed = JSON.parse(PSC_fs.readFileSync(file, 'utf8'));
          PSC_state = Object.assign(PSC_defaultState(), parsed || {});
          PSC_state.loop = PSC_state.loop || { failures: {}, cooldowns: {}, goalCooldowns: {} };
          PSC_state.loop.failures = PSC_state.loop.failures || {};
          PSC_state.loop.cooldowns = PSC_state.loop.cooldowns || {};
          PSC_state.loop.goalCooldowns = PSC_state.loop.goalCooldowns || {};
          PSC_state.strategies = PSC_state.strategies || { obtain_stone: {} };
          PSC_state.strategies.obtain_stone = PSC_state.strategies.obtain_stone || {};
          PSC_state.pois = PSC_state.pois || {};
          PSC_state.pois.resources = PSC_state.pois.resources || [];
          PSC_state.pois.craftingTables = PSC_state.pois.craftingTables || [];
          PSC_state.pois.deaths = PSC_state.pois.deaths || [];
          PSC_state.pois.dangerZones = PSC_state.pois.dangerZones || [];
          PSC_state.pois.bases = PSC_state.pois.bases || [];
          PSC_state.events = PSC_state.events || [];
          PSC_state.proposals = PSC_state.proposals || [];
        } else {
          PSC_state = PSC_defaultState();
        }
      } catch (err) {
        console.warn('⚠️ [PSC] problem_solver 상태 로드 실패:', err && err.message ? err.message : err);
        PSC_state = PSC_defaultState();
      }

      return PSC_state;
    }

    function PSC_saveState(force = false) {
      const now = Date.now();
      if (!force && now - PSC_lastSaveAt < 1200) return;

      PSC_lastSaveAt = now;

      try {
        const st = PSC_loadState();
        st.updatedAt = new Date().toISOString();

        PSC_fs.writeFileSync(PSC_statePath(), JSON.stringify(st, null, 2));

        const worldMap = {
          version: st.version,
          updatedAt: st.updatedAt,
          bot: PSC_botName(),
          pois: st.pois,
          strategies: st.strategies,
          loop: st.loop
        };

        PSC_fs.writeFileSync(PSC_worldMapPath(), JSON.stringify(worldMap, null, 2));
      } catch (err) {
        console.warn('⚠️ [PSC] 상태 저장 실패:', err && err.message ? err.message : err);
      }
    }

    function PSC_remember(text, importance = 5) {
      const msg = String(text || '');

      try {
        if (typeof remember === 'function') {
          remember(msg, importance);
          return;
        }
      } catch {}  

      try {
        if (typeof self !== 'undefined' && self && typeof self.remember === 'function') {
          self.remember(msg, importance);
          return;
        }
      } catch {}

      console.log('🧠 [PSC-기억] ' + msg);
    }

    function PSC_event(type, data) {
      const st = PSC_loadState();

      st.events.push({
        type,
        at: new Date().toISOString(),
        data: data || {}
      });

      if (st.events.length > 200) {
        st.events = st.events.slice(st.events.length - 200);
      }

      PSC_saveState();
    }

    function PSC_reg() {
      try {
        if (PSC_botReady() && bot.registry) return bot.registry;
      } catch {}

      try {
        if (PSC_botReady() && bot.version) {
          return require('minecraft-data')(bot.version);
        }
      } catch {}

      return null;
    }

    function PSC_goalNearClass() {
      try {
        if (typeof goals !== 'undefined' && goals && goals.GoalNear) return goals.GoalNear;
      } catch {}

      try {
        return require('mineflayer-pathfinder').goals.GoalNear;
      } catch {}

      return null;
    }

    function PSC_posObj(pos) {
      if (!pos) return null;

      return {
        x: Math.floor(pos.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z)
      };
    }

    function PSC_dist(a, b) {
      if (!a || !b) return Infinity;

      const ax = Number(a.x);
      const ay = Number(a.y || 0);
      const az = Number(a.z);
      const bx = Number(b.x);
      const by = Number(b.y || 0);
      const bz = Number(b.z);

      const dx = ax - bx;
      const dy = ay - by;
      const dz = az - bz;

      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function PSC_currentPosObj() {
      try {
        if (!PSC_botReady()) return null;
        return PSC_posObj(bot.entity.position);
      } catch {
        return null;
      }
    }

    function PSC_keyPos(pos) {
      const p = PSC_posObj(pos);
      if (!p) return 'unknown';
      return p.x + ',' + p.y + ',' + p.z;
    }

    function PSC_entityName(entity) {
      return String((entity && (entity.name || entity.displayName)) || '')
        .toLowerCase()
        .replace(/\s+/g, '_');
    }

    function PSC_invItems() {
      try {
        if (!PSC_botReady()) return [];
        return bot.inventory.items() || [];
      } catch {
        return [];
      }
    }

    function PSC_countItems(names) {
      const list = Array.isArray(names) ? names : [names];
      const set = new Set(list);

      return PSC_invItems()
        .filter(item => item && set.has(item.name))
        .reduce((sum, item) => sum + (item.count || 0), 0);
    }

    function PSC_findItem(names) {
      const list = Array.isArray(names) ? names : [names];
      const set = new Set(list);

      return PSC_invItems().find(item => item && set.has(item.name)) || null;
    }

    function PSC_pickaxeTier(name) {
      name = String(name || '');

      if (name === 'netherite_pickaxe') return 5;
      if (name === 'diamond_pickaxe') return 4;
      if (name === 'iron_pickaxe') return 3;
      if (name === 'stone_pickaxe') return 2;
      if (name === 'wooden_pickaxe') return 1;
      if (name === 'golden_pickaxe') return 1;

      return 0;
    }

    function PSC_bestPickaxe(minTier = 1) {
      let best = null;
      let bestTier = 0;

      for (const item of PSC_invItems()) {
        const tier = PSC_pickaxeTier(item.name);
        if (tier >= minTier && tier > bestTier) {
          best = item;
          bestTier = tier;
        }
      }

      return best;
    }

    function PSC_hasPickaxe(minTier = 1) {
      return !!PSC_bestPickaxe(minTier);
    }

    function PSC_hasStoneTool() {
      return !!PSC_findItem(PSC_STONE_TOOLS);
    }

    async function PSC_equipBestPickaxe(minTier = 1) {
      if (!PSC_botReady()) return false;

      const item = PSC_bestPickaxe(minTier);
      if (!item) return false;

      try {
        if (bot.heldItem && PSC_pickaxeTier(bot.heldItem.name) >= minTier) {
          return true;
        }

        await bot.equip(item, 'hand');
        await PSC_wait(120);
        return true;
      } catch {
        return false;
      }
    }

    function PSC_blockIds(names) {
      const reg = PSC_reg();
      if (!reg || !reg.blocksByName) return [];

      const list = Array.isArray(names) ? names : [names];

      return list
        .map(name => reg.blocksByName[name] && reg.blocksByName[name].id)
        .filter(id => Number.isFinite(id));
    }

    function PSC_blockAt(pos) {
      try {
        if (!PSC_botReady() || !pos) return null;
        return bot.blockAt(pos);
      } catch {
        return null;
      }
    }

    function PSC_isAirBlock(block) {
      return !block || PSC_AIR.has(block.name);
    }

    function PSC_isLiquidBlock(block) {
      return !!block && PSC_LIQUID.has(block.name);
    }

    function PSC_isBlockExposed(block) {
      if (!PSC_botReady() || !block || !block.position || !PSC_Vec3) return false;

      const dirs = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
      ];

      for (const d of dirs) {
        const b = PSC_blockAt(block.position.offset(d[0], d[1], d[2]));
        if (!b) continue;
        if (PSC_AIR.has(b.name)) return true;
      }

      return false;
    }

    function PSC_isDangerousToDig(block) {
      if (!PSC_botReady() || !block || !block.position) return true;

      try {
        const p = block.position;
        const botPos = bot.entity.position;

        if (
          Math.floor(p.x) === Math.floor(botPos.x) &&
          Math.floor(p.z) === Math.floor(botPos.z) &&
          Math.floor(p.y) >= Math.floor(botPos.y) - 1 &&
          Math.floor(p.y) <= Math.floor(botPos.y) + 2
        ) {
          return true;
        }

        const above = PSC_blockAt(p.offset(0, 1, 0));
        const below = PSC_blockAt(p.offset(0, -1, 0));

        if (above && above.name === 'lava') return true;
        if (below && below.name === 'lava') return true;
      } catch {
        return true;
      }

      return false;
    }

    function PSC_findLocalBlocks(names, maxDistance = 40, count = 80, exposedOnly = false) {
      if (!PSC_botReady() || !bot.findBlocks) return [];

      const ids = PSC_blockIds(names);
      if (!ids.length) return [];

      const idSet = new Set(ids);
      let positions = [];

      try {
        positions = bot.findBlocks({
          matching: function(block) {
            return block && idSet.has(block.type);
          },
          maxDistance,
          count
        }) || [];
      } catch {
        positions = [];
      }

      const blocks = positions
        .map(pos => PSC_blockAt(pos))
        .filter(block => block && block.position && block.name && !PSC_isDangerousToDig(block))
        .filter(block => !exposedOnly || PSC_isBlockExposed(block))
        .sort((a, b) => {
          try {
            return a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position);
          } catch {
            return 0;
          }
        });

      return blocks;
    }

    function PSC_addPoi(kind, name, pos, meta) {
      const st = PSC_loadState();
      const p = PSC_posObj(pos);
      if (!p) return;

      meta = meta || {};

      let arr;

      if (kind === 'resource') arr = st.pois.resources;
      else if (kind === 'crafting_table') arr = st.pois.craftingTables;
      else if (kind === 'danger') arr = st.pois.dangerZones;
      else if (kind === 'death') arr = st.pois.deaths;
      else if (kind === 'base') arr = st.pois.bases;
      else arr = st.pois.resources;

      const existing = arr.find(item => {
        if (!item || item.name !== name) return false;
        return PSC_dist(item, p) <= (kind === 'danger' ? 12 : 5);
      });

      if (existing) {
        existing.x = p.x;
        existing.y = p.y;
        existing.z = p.z;
        existing.lastSeen = new Date().toISOString();
        existing.count = (existing.count || 1) + 1;
        existing.confidence = Math.max(Number(existing.confidence || 0), Number(meta.confidence || 0.5));
        existing.meta = Object.assign(existing.meta || {}, meta);
      } else {
        arr.push(Object.assign({
          kind,
          name,
          x: p.x,
          y: p.y,
          z: p.z,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          count: 1,
          confidence: Number(meta.confidence || 0.5),
          meta
        }, p));
      }

      if (arr.length > 300) {
        arr.sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
        arr.length = 300;
      }

      PSC_saveState();
    }

    function PSC_nearHostiles(radius = 10) {
      if (!PSC_botReady()) return [];

      const origin = bot.entity.position;

      return Object.values(bot.entities || {})
        .filter(entity => {
          if (!entity || !entity.position || entity === bot.entity) return false;

          const name = PSC_entityName(entity);
          if (!PSC_HOSTILES.has(name)) return false;

          try {
            return entity.position.distanceTo(origin) <= radius;
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          try {
            return a.position.distanceTo(origin) - b.position.distanceTo(origin);
          } catch {
            return 0;
          }
        });
    }

    function PSC_safeToWork() {
      if (!PSC_botReady()) return false;

      try {
        if (Number(bot.health || 20) <= 7) return false;
        if (Number(bot.food || 20) <= 5) return false;
        if (PSC_nearHostiles(8).length > 0) return false;
      } catch {
        return false;
      }

      return true;
    }

    function PSC_scanWorld(reason = 'periodic') {
      if (!PSC_botReady()) return;

      const now = Date.now();

      if (reason === 'periodic' && now - PSC_lastScanAt < 8000) return;
      PSC_lastScanAt = now;

      try {
        const stoneBlocks = PSC_findLocalBlocks(PSC_STONES, 48, 140, false);
        for (const block of stoneBlocks.slice(0, 50)) {
          const exposed = PSC_isBlockExposed(block);
          PSC_addPoi('resource', 'stone', block.position, {
            block: block.name,
            exposed,
            confidence: exposed ? 0.9 : 0.35,
            source: reason
          });
        }
      } catch {}

      try {
        const logs = PSC_findLocalBlocks(PSC_LOGS, 48, 80, false);
        for (const block of logs.slice(0, 30)) {
          PSC_addPoi('resource', 'wood', block.position, {
            block: block.name,
            confidence: 0.85,
            source: reason
          });
        }
      } catch {}

      try {
        const tables = PSC_findLocalBlocks(['crafting_table'], 32, 20, false);
        for (const block of tables.slice(0, 10)) {
          PSC_addPoi('crafting_table', 'crafting_table', block.position, {
            confidence: 0.95,
            source: reason
          });
        }
      } catch {}

      try {
        for (const hostile of PSC_nearHostiles(16).slice(0, 5)) {
          PSC_addPoi('danger', PSC_entityName(hostile), hostile.position, {
            confidence: 0.8,
            source: reason
          });
        }
      } catch {}
    }

    function PSC_installHooks() {
      if (!PSC_botReady()) return;

      try {
        if (bot.__pscHooksInstalled) return;
        bot.__pscHooksInstalled = true;

        bot.on('death', () => {
          try {
            const p = PSC_currentPosObj();

            if (p) {
              PSC_addPoi('death', 'death_location', p, {
                confidence: 1,
                source: 'death_event'
              });

              PSC_remember('[월드맵] 사망 위치를 위험 POI로 저장했다: (' + p.x + ',' + p.y + ',' + p.z + ')', 8);
            }
          } catch {}
        });

        bot.on('entityHurt', entity => {
          try {
            if (!entity || entity !== bot.entity) return;

            const hostile = PSC_nearHostiles(12)[0];
            if (hostile) {
              PSC_addPoi('danger', PSC_entityName(hostile), hostile.position, {
                confidence: 0.95,
                source: 'hurt_event'
              });
            }
          } catch {}
        });

        console.log('🗺️ [PSC] 월드맵/위험/사망 POI 훅 설치 완료');
      } catch {}
    }

    function PSC_resultInfo(result) {
      const text = String(result || '');
      const lower = text.toLowerCase();

      const failure =
        /실패|못|찾지 못|없다|없음|중단|포기|위험 때문에|aborted|failed|cannot|could not|not found|no /.test(lower);

      let reason = 'unknown';

      if (/stone.*찾지 못|돌.*찾지 못|드러난.*찾지 못|no exposed stone|not found/.test(lower)) {
        reason = 'no_exposed_stone';
      } else if (/위험|hostile|mob|몬스터|공격/.test(lower)) {
        reason = 'danger';
      } else if (/aborted|중단/.test(lower)) {
        reason = 'aborted';
      } else if (/도구|tool|pickaxe|곡괭이/.test(lower)) {
        reason = 'missing_tool';
      } else if (failure) {
        reason = 'generic_failure';
      } else {
        reason = 'success';
      }

      return {
        text,
        failure,
        reason
      };
    }

    function PSC_parseAction(action, args) {
      args = Array.isArray(args) ? args : [];

      let name = '';
      let target = '';
      const parts = [];

      try {
        if (typeof action === 'string') {
          name = action;
          parts.push(action);
        } else if (action && typeof action === 'object') {
          name = String(action.action || action.name || action.type || action.skill || '');
          target = String(action.target || action.item || action.block || action.resource || action.goal || '');

          try {
            parts.push(JSON.stringify(action).slice(0, 600));
          } catch {}
        }

        for (const arg of args) {
          if (typeof arg === 'string') {
            if (!target) target = arg;
            parts.push(arg);
          } else if (arg && typeof arg === 'object') {
            if (!target) {
              target = String(arg.target || arg.item || arg.block || arg.resource || arg.name || '');
            }

            try {
              parts.push(JSON.stringify(arg).slice(0, 600));
            } catch {}
          }
        }
      } catch {}

      name = String(name || '').toLowerCase().trim();
      target = String(target || '').toLowerCase().trim();

      const text = (name + ' ' + target + ' ' + parts.join(' ')).toLowerCase();

      if (!name && /mine|dig|채굴|캐/.test(text)) name = 'mine';
      if (!target && /stone|cobble|deepslate|돌|조약돌/.test(text)) target = 'stone';

      if (/stone|cobble|deepslate|돌|조약돌/.test(target)) target = 'stone';

      return {
        name: name || 'unknown',
        target: target || 'none',
        text
      };
    }

    function PSC_actionKey(parsed) {
      return String(parsed.name || 'unknown') + ':' + String(parsed.target || 'none');
    }

    function PSC_isMineStoneAction(parsed) {
      const t = String((parsed && parsed.text) || '');
      return /(mine|dig|채굴|캐)/.test(t) && /(stone|cobble|deepslate|돌|조약돌)/.test(t);
    }

    function PSC_setActionCooldown(key, ms, reason) {
      const st = PSC_loadState();
      st.loop.cooldowns[key] = {
        until: Date.now() + ms,
        reason: reason || 'repeated_failure',
        at: new Date().toISOString()
      };
      PSC_saveState(true);
    }

    function PSC_actionCooling(key) {
      const st = PSC_loadState();
      const c = st.loop.cooldowns[key];
      return !!(c && Number(c.until || 0) > Date.now());
    }

    function PSC_setGoalCooldown(goal, ms, reason) {
      const st = PSC_loadState();
      st.loop.goalCooldowns[goal] = {
        until: Date.now() + ms,
        reason: reason || 'goal_failed',
        at: new Date().toISOString()
      };
      PSC_saveState(true);
    }

    function PSC_goalCooling(goal) {
      const st = PSC_loadState();
      const c = st.loop.goalCooldowns[goal];
      return !!(c && Number(c.until || 0) > Date.now());
    }

    function PSC_createProposal(problem, analysis, suggestion) {
      try {
        PSC_fs.mkdirSync('patch_proposals', { recursive: true });

        const file = PSC_path.join(
          'patch_proposals',
          new Date().toISOString().replace(/[:.]/g, '-') + '_' + PSC_safeName(PSC_botName()) + '_psc_' + problem + '.md'
        );

        const body = [
          '# Adam Problem Solving Proposal',
          '',
          '- problem: ' + problem,
          '- bot: ' + PSC_botName(),
          '- time: ' + new Date().toISOString(),
          '',
          '## Analysis',
          analysis || '',
          '',
          '## Suggested change',
          suggestion || '',
          '',
          '## Safety',
          'This proposal was generated only as a suggestion. Adam did not modify source code automatically.'
        ].join('\n');

        PSC_fs.writeFileSync(file, body);

        const st = PSC_loadState();
        st.proposals.push({
          file,
          problem,
          at: new Date().toISOString()
        });

        if (st.proposals.length > 100) {
          st.proposals = st.proposals.slice(st.proposals.length - 100);
        }

        PSC_saveState(true);

        console.log('🧠 [PSC-SELFDEV] 안전 패치 제안 생성:', file);
      } catch (err) {
        console.warn('⚠️ [PSC-SELFDEV] 제안 생성 실패:', err && err.message ? err.message : err);
      }
    }

    function PSC_recordActionResult(key, result) {
      const info = PSC_resultInfo(result);
      const st = PSC_loadState();

      if (!info.failure) {
        for (const fkey of Object.keys(st.loop.failures)) {
          if (fkey.startsWith(key + '|')) {
            delete st.loop.failures[fkey];
          }
        }

        PSC_saveState();
        return;
      }

      const fkey = key + '|' + info.reason;
      const rec = st.loop.failures[fkey] || {
        key,
        reason: info.reason,
        count: 0,
        examples: [],
        firstAt: new Date().toISOString()
      };

      rec.count += 1;
      rec.lastAt = new Date().toISOString();
      rec.examples.push(String(result || '').slice(0, 300));

      if (rec.examples.length > 5) {
        rec.examples = rec.examples.slice(rec.examples.length - 5);
      }

      st.loop.failures[fkey] = rec;

      if (rec.count >= 3) {
        PSC_setActionCooldown(key, 5 * 60 * 1000, info.reason);

        PSC_remember('[루프방지] ' + key + '가 같은 이유(' + info.reason + ')로 ' + rec.count + '회 실패해서 5분간 같은 행동을 금지한다.', 8);

        if (rec.count === 3 || rec.count % 5 === 0) {
          PSC_createProposal(
            'loop_' + key.replace(/[^a-zA-Z0-9_.-]/g, '_') + '_' + info.reason,
            'Action ' + key + ' repeatedly failed with reason ' + info.reason + '. Examples: ' + rec.examples.join(' / '),
            'Do not retry the same action directly. Keep the goal, but switch to alternate strategies and POI-based navigation.'
          );
        }
      }

      PSC_saveState();
    }

    function PSC_strategyRecord(goal, strategy, ok, message) {
      const st = PSC_loadState();

      st.strategies[goal] = st.strategies[goal] || {};

      const rec = st.strategies[goal][strategy] || {
        attempts: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
        examples: []
      };

      rec.attempts += 1;
      rec.lastAt = new Date().toISOString();

      if (ok) {
        rec.successes += 1;
        rec.consecutiveFailures = 0;
      } else {
        rec.failures += 1;
        rec.consecutiveFailures += 1;

        if (rec.consecutiveFailures >= 2) {
          rec.cooldownUntil = Date.now() + 90 * 1000;
        }
      }

      rec.examples.push(String(message || '').slice(0, 250));
      if (rec.examples.length > 5) {
        rec.examples = rec.examples.slice(rec.examples.length - 5);
      }

      st.strategies[goal][strategy] = rec;
      PSC_saveState();
    }

    function PSC_strategyScore(goal, strategy) {
      const st = PSC_loadState();
      const rec = (st.strategies[goal] && st.strategies[goal][strategy]) || null;

      const base = {
        local_exposed_stone: 80,
        known_stone_poi: 75,
        explore_surface_stone: 60,
        safe_staircase_mine: 70
      }[strategy] || 50;

      if (!rec) return base + 10;

      if (Number(rec.cooldownUntil || 0) > Date.now()) return -999;

      const attempts = Number(rec.attempts || 0);
      const successes = Number(rec.successes || 0);
      const failures = Number(rec.failures || 0);
      const rate = attempts > 0 ? successes / attempts : 0.5;

      return base + rate * 35 - failures * 3 - Number(rec.consecutiveFailures || 0) * 8;
    }

    function PSC_orderStrategies(goal, strategies) {
      return strategies
        .slice()
        .sort((a, b) => PSC_strategyScore(goal, b) - PSC_strategyScore(goal, a));
    }

    function PSC_isDropEntity(entity) {
      if (!entity || !entity.position) return false;

      const name = String(entity.name || '').toLowerCase();
      const display = String(entity.displayName || '').toLowerCase().replace(/\s+/g, '_');
      const type = String(entity.type || '').toLowerCase();

      return (
        name === 'item' ||
        name === 'dropped_item' ||
        display === 'item' ||
        display === 'dropped_item' ||
        (type === 'object' && (name === 'item' || display === 'item'))
      );
    }

    async function PSC_collectDropsNearby(radius = 6, limit = 6) {
      if (!PSC_botReady()) return false;

      const origin = bot.entity.position;

      const drops = Object.values(bot.entities || {})
        .filter(PSC_isDropEntity)
        .filter(entity => {
          try {
            return entity.position.distanceTo(origin) <= radius;
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          try {
            return a.position.distanceTo(origin) - b.position.distanceTo(origin);
          } catch {
            return 0;
          }
        })
        .slice(0, limit);

      if (!drops.length) return false;

      for (const drop of drops) {
        try {
          await PSC_walkNear(drop.position, 1.2, 4000);
          await PSC_wait(250);
        } catch {}
      }

      return true;
    }

    async function PSC_walkNear(pos, range = 2.5, timeoutMs = 8000) {
      if (!PSC_botReady() || !pos) return false;

      try {
        if (bot.entity.position.distanceTo(pos) <= range) return true;
      } catch {}

      const GoalNear = PSC_goalNearClass();
      if (!GoalNear || !bot.pathfinder) return false;

      try {
        bot.pathfinder.setGoal(
          new GoalNear(
            Math.floor(pos.x),
            Math.floor(pos.y),
            Math.floor(pos.z),
            Math.max(1, Math.ceil(range))
          ),
          false
        );

        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
          try {
            if (bot.entity.position.distanceTo(pos) <= range + 0.5) {
              try {
                bot.pathfinder.setGoal(null);
              } catch {}
              return true;
            }
          } catch {}

          await PSC_wait(250);
        }
      } catch {}

      try {
        bot.pathfinder.setGoal(null);
      } catch {}

      return false;
    }

    async function PSC_mineOneStoneBlock(block) {
      if (!PSC_botReady() || !block || !block.position) {
        return { ok: false, msg: 'invalid block' };
      }

      if (!PSC_safeToWork()) {
        return { ok: false, msg: 'unsafe to work' };
      }

      const before = PSC_countItems(PSC_COBBLE_DROPS);

      try {
        const fresh = PSC_blockAt(block.position);

        if (!fresh || !PSC_STONES.includes(fresh.name)) {
          return { ok: false, msg: 'block disappeared or is not stone' };
        }

        if (PSC_isDangerousToDig(fresh)) {
          return { ok: false, msg: 'dangerous block position' };
        }

        const equipped = await PSC_equipBestPickaxe(1);
        if (!equipped) {
          return { ok: false, msg: 'no wooden_pickaxe_or_better' };
        }

        await PSC_walkNear(fresh.position, 3.2, 8000);

        const fresh2 = PSC_blockAt(fresh.position);
        if (!fresh2 || !PSC_STONES.includes(fresh2.name)) {
          return { ok: false, msg: 'block changed before digging' };
        }

        if (typeof bot.canDigBlock === 'function') {
          try {
            if (!bot.canDigBlock(fresh2)) {
              return { ok: false, msg: 'cannot dig block from current position' };
            }
          } catch {}
        }

        await bot.dig(fresh2);
        await PSC_wait(450);
        await PSC_collectDropsNearby(6, 6);
        await PSC_wait(250);

        PSC_scanWorld('after_stone_dig');

        const after = PSC_countItems(PSC_COBBLE_DROPS);
        const gained = after - before;

        return {
          ok: true,
          msg: 'mined ' + fresh2.name + ', cobble gained=' + gained,
          gained
        };
      } catch (err) {
        return {
          ok: false,
          msg: 'dig failed: ' + (err && err.message ? err.message : err)
        };
      }
    }

    async function PSC_mineStoneBlocks(blocks, targetCobbleCount) {
      if (!Array.isArray(blocks) || !blocks.length) {
        return { ok: false, msg: 'no candidate blocks' };
      }

      const before = PSC_countItems(PSC_COBBLE_DROPS);
      let mined = 0;
      let lastMsg = '';

      for (const block of blocks) {
        if (!PSC_safeToWork()) break;

        if (PSC_countItems(PSC_COBBLE_DROPS) >= targetCobbleCount) {
          break;
        }

        const fresh = PSC_blockAt(block.position);
        if (!fresh || !PSC_STONES.includes(fresh.name)) continue;

        const res = await PSC_mineOneStoneBlock(fresh);
        lastMsg = res.msg;

        if (res.ok) {
          mined += 1;
        }

        await PSC_wait(250);
      }

      const after = PSC_countItems(PSC_COBBLE_DROPS);
      const gained = after - before;

      if (after >= targetCobbleCount || gained > 0 || mined > 0) {
        return {
          ok: true,
          msg: 'stone mining ok. mined=' + mined + ', gained=' + gained + ', cobble=' + after
        };
      }

      return {
        ok: false,
        msg: 'stone mining failed. ' + lastMsg
      };
    }

    async function PSC_strategyLocalExposedStone(targetCobbleCount) {
      PSC_scanWorld('strategy_local_exposed');

      const blocks = PSC_findLocalBlocks(PSC_STONES, 48, 120, true)
        .filter(block => PSC_isBlockExposed(block))
        .filter(block => !PSC_isDangerousToDig(block));

      if (!blocks.length) {
        return { ok: false, msg: 'local exposed stone not found' };
      }

      return await PSC_mineStoneBlocks(blocks, targetCobbleCount);
    }

    async function PSC_strategyKnownStonePoi(targetCobbleCount) {
      const st = PSC_loadState();
      const me = PSC_currentPosObj();

      const pois = (st.pois.resources || [])
        .filter(p => p && p.name === 'stone')
        .filter(p => p.meta && p.meta.exposed)
        .sort((a, b) => {
          const da = PSC_dist(a, me);
          const db = PSC_dist(b, me);
          const sa = Number(a.confidence || 0);
          const sb = Number(b.confidence || 0);
          return (da - sa * 8) - (db - sb * 8);
        })
        .slice(0, 6);

      if (!pois.length) {
        return { ok: false, msg: 'no known exposed stone POI' };
      }

      for (const poi of pois) {
        if (!PSC_safeToWork()) {
          return { ok: false, msg: 'unsafe while moving to stone POI' };
        }

        const pos = PSC_Vec3 ? new PSC_Vec3(poi.x, poi.y, poi.z) : null;
        if (!pos) break;

        await PSC_walkNear(pos, 4, 12000);
        PSC_scanWorld('arrived_known_stone_poi');

        const res = await PSC_strategyLocalExposedStone(targetCobbleCount);
        if (res.ok || PSC_countItems(PSC_COBBLE_DROPS) >= targetCobbleCount) {
          return {
            ok: true,
            msg: 'used known stone POI at (' + poi.x + ',' + poi.y + ',' + poi.z + '): ' + res.msg
          };
        }
      }

      return { ok: false, msg: 'known stone POIs were unreachable or not mineable' };
    }

    async function PSC_strategyExploreSurfaceStone(targetCobbleCount) {
      if (!PSC_botReady() || !PSC_Vec3) {
        return { ok: false, msg: 'bot or Vec3 unavailable' };
      }

      const origin = bot.entity.position.clone ? bot.entity.position.clone() : bot.entity.position;
      const directions = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1]
      ];

      let idx = 0;

      for (const distance of [16, 28, 40]) {
        for (let k = 0; k < directions.length; k++) {
          if (!PSC_safeToWork()) {
            return { ok: false, msg: 'unsafe during surface exploration' };
          }

          const d = directions[(idx++) % directions.length];
          const target = new PSC_Vec3(
            Math.floor(origin.x + d[0] * distance),
            Math.floor(origin.y),
            Math.floor(origin.z + d[1] * distance)
          );

          await PSC_walkNear(target, 5, 10000);
          PSC_scanWorld('explore_surface_stone');

          const res = await PSC_strategyLocalExposedStone(targetCobbleCount);
          if (res.ok || PSC_countItems(PSC_COBBLE_DROPS) >= targetCobbleCount) {
            return {
              ok: true,
              msg: 'surface exploration found stone: ' + res.msg
            };
          }
        }
      }

      return { ok: false, msg: 'surface exploration did not find mineable stone' };
    }

    async function PSC_digClearBlockAt(pos) {
      if (!PSC_botReady() || !pos) return { ok: false, msg: 'invalid position' };

      const block = PSC_blockAt(pos);
      if (!block) return { ok: false, msg: 'block not loaded' };

      if (PSC_AIR.has(block.name)) return { ok: true, msg: 'already air' };
      if (PSC_LIQUID.has(block.name)) return { ok: false, msg: 'liquid block' };
      if (block.name === 'bedrock') return { ok: false, msg: 'bedrock' };

      try {
        if (PSC_STONES.includes(block.name)) {
          const equipped = await PSC_equipBestPickaxe(1);
          if (!equipped) {
            return { ok: false, msg: 'no pickaxe for stone' };
          }
        }

        await PSC_walkNear(block.position, 4, 5000);

        const fresh = PSC_blockAt(pos);
        if (!fresh || PSC_AIR.has(fresh.name)) {
          return { ok: true, msg: 'became air' };
        }

        if (PSC_LIQUID.has(fresh.name) || fresh.name === 'bedrock') {
          return { ok: false, msg: 'unsafe fresh block ' + fresh.name };
        }

        if (typeof bot.canDigBlock === 'function') {
          try {
            if (!bot.canDigBlock(fresh)) {
              return { ok: false, msg: 'cannot dig ' + fresh.name };
            }
          } catch {}
        }

        await bot.dig(fresh);
        await PSC_wait(350);
        await PSC_collectDropsNearby(5, 4);

        return { ok: true, msg: 'cleared ' + fresh.name };
      } catch (err) {
        return { ok: false, msg: 'clear failed: ' + (err && err.message ? err.message : err) };
      }
    }

    async function PSC_makeStairStep(dx, dz) {
      if (!PSC_botReady() || !PSC_Vec3) return { ok: false, msg: 'no bot or Vec3' };

      const p = bot.entity.position;
      const x = Math.floor(p.x) + dx;
      const y = Math.floor(p.y);
      const z = Math.floor(p.z) + dz;

      const foot = new PSC_Vec3(x, y - 1, z);
      const head = new PSC_Vec3(x, y, z);
      const floor = new PSC_Vec3(x, y - 2, z);

      const floorBlock = PSC_blockAt(floor);
      if (!floorBlock || PSC_LIQUID.has(floorBlock.name) || floorBlock.name === 'air') {
        return { ok: false, msg: 'unsafe stair floor' };
      }

      const headRes = await PSC_digClearBlockAt(head);
      if (!headRes.ok) return headRes;

      const footRes = await PSC_digClearBlockAt(foot);
      if (!footRes.ok) return footRes;

      await PSC_walkNear(foot, 1.4, 5000);

      return { ok: true, msg: 'stair step made' };
    }

    async function PSC_strategySafeStaircaseMine(targetCobbleCount) {
      if (!PSC_botReady() || !PSC_Vec3) {
        return { ok: false, msg: 'bot or Vec3 unavailable' };
      }

      if (!PSC_hasPickaxe(1)) {
        return { ok: false, msg: 'no wooden pickaxe for staircase mine' };
      }

      const entrance = PSC_currentPosObj();
      if (entrance) {
        PSC_addPoi('base', 'temporary_mine_entrance', entrance, {
          confidence: 0.6,
          source: 'safe_staircase_mine'
        });
      }

      const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1]
      ];

      const before = PSC_countItems(PSC_COBBLE_DROPS);

      for (const dir of dirs) {
        for (let step = 0; step < 14; step++) {
          if (!PSC_safeToWork()) {
            return { ok: false, msg: 'unsafe during staircase mine' };
          }

          const stepRes = await PSC_makeStairStep(dir[0], dir[1]);

          if (!stepRes.ok) {
            break;
          }

          PSC_scanWorld('staircase_step');

          const local = PSC_findLocalBlocks(PSC_STONES, 12, 30, true);
          if (local.length) {
            await PSC_mineStoneBlocks(local, targetCobbleCount);
          }

          if (PSC_countItems(PSC_COBBLE_DROPS) >= targetCobbleCount) {
            return {
              ok: true,
              msg: 'safe staircase mine reached target cobble=' + PSC_countItems(PSC_COBBLE_DROPS)
            };
          }
        }
      }

      const after = PSC_countItems(PSC_COBBLE_DROPS);

      if (after > before) {
        return {
          ok: true,
          msg: 'safe staircase mined some stone. gained=' + (after - before) + ', cobble=' + after
        };
      }

      return { ok: false, msg: 'safe staircase did not reach stone' };
    }

    async function PSC_obtainStoneSmart(options) {
      options = options || {};

      if (!PSC_botReady()) {
        return { ok: false, msg: 'bot not ready' };
      }

      if (PSC_smartBusy) {
        return { ok: false, msg: 'smart stone already running' };
      }

      const targetCobbleCount = Number(options.count || 8);

      if (PSC_countItems(PSC_COBBLE_DROPS) >= targetCobbleCount) {
        return {
          ok: true,
          msg: '이미 조약돌류가 충분하다: ' + PSC_countItems(PSC_COBBLE_DROPS) + '개'
        };
      }

      if (!PSC_hasPickaxe(1)) {
        return {
          ok: false,
          msg: '돌을 캐려면 wooden_pickaxe 이상이 필요하다. 먼저 나무 곡괭이를 만들어야 한다.'
        };
      }

      if (!PSC_safeToWork()) {
        return {
          ok: false,
          msg: '현재 체력/허기/위협 때문에 돌 확보 작업을 미룬다.'
        };
      }

      PSC_smartBusy = true;

      try {
        PSC_installHooks();
        PSC_scanWorld('obtain_stone_smart_start');

        const strategies = PSC_orderStrategies('obtain_stone', [
          'local_exposed_stone',
          'known_stone_poi',
          'explore_surface_stone',
          'safe_staircase_mine'
        ]);

        console.log('🧩 [PSC] 돌 확보 스마트 전략 순서:', strategies.join(' → '));

        const messages = [];

        for (const strategy of strategies) {
          if (!PSC_safeToWork()) {
            messages.push(strategy + ': unsafe');
            break;
          }

          let res;

          console.log('🪨 [PSC] 전략 시도:', strategy);

          if (strategy === 'local_exposed_stone') {
            res = await PSC_strategyLocalExposedStone(targetCobbleCount);
          } else if (strategy === 'known_stone_poi') {
            res = await PSC_strategyKnownStonePoi(targetCobbleCount);
          } else if (strategy === 'explore_surface_stone') {
            res = await PSC_strategyExploreSurfaceStone(targetCobbleCount);
          } else if (strategy === 'safe_staircase_mine') {
            res = await PSC_strategySafeStaircaseMine(targetCobbleCount);
          } else {
            res = { ok: false, msg: 'unknown strategy' };
          }

          PSC_strategyRecord('obtain_stone', strategy, !!res.ok, res.msg);
          messages.push(strategy + ': ' + res.msg);

          PSC_scanWorld('after_strategy_' + strategy);

          if (res.ok || PSC_countItems(PSC_COBBLE_DROPS) >= targetCobbleCount) {
            const count = PSC_countItems(PSC_COBBLE_DROPS);

            PSC_remember('[문제해결] 돌 확보 목표를 ' + strategy + ' 전략으로 해결했다. 현재 조약돌류 ' + count + '개.', 8);

            return {
              ok: true,
              msg: strategy + ' 성공. 현재 조약돌류 ' + count + '개.'
            };
          }
        }

        PSC_setGoalCooldown('obtain_stone', 30 * 1000, 'all_strategies_failed');

        PSC_createProposal(
          'obtain_stone_all_strategies_failed',
          'All smart stone strategies failed. Messages: ' + messages.join(' / '),
          'Improve navigation to exposed stone, add better cave/river/cliff detection, or add a more reliable staircase mining primitive.'
        );

        return {
          ok: false,
          msg: '돌 확보 스마트 전략이 모두 실패했다. 잠시 다른 목표를 하거나 위치를 바꿔야 한다. ' + messages.join(' / ')
        };
      } finally {
        PSC_smartBusy = false;
        PSC_saveState(true);
      }
    }

    function PSC_topNeed() {
      if (!PSC_botReady()) return { name: 'none', score: 0 };

      const hostile = PSC_nearHostiles(7)[0];
      const health = Number(bot.health || 20);
      const food = Number(bot.food || 20);
      const cobble = PSC_countItems(PSC_COBBLE_DROPS);

      if (hostile) {
        return {
          name: 'safety',
          score: 100,
          reason: PSC_entityName(hostile) + ' near'
        };
      }

      if (health <= 7) {
        return {
          name: 'recover',
          score: 95,
          reason: 'low health ' + health
        };
      }

      if (food <= 6) {
        return {
          name: 'food',
          score: 90,
          reason: 'low food ' + food
        };
      }

      if (PSC_hasPickaxe(1) && !PSC_hasStoneTool() && cobble < 8) {
        return {
          name: 'stone_progress',
          score: 78,
          reason: 'wooden pickaxe exists but no stone kit, cobble=' + cobble
        };
      }

      return {
        name: 'normal',
        score: 10,
        reason: 'no urgent need'
      };
    }

    function PSC_softClearQueue(reason) {
      try {
        if (typeof taskQueue !== 'undefined' && Array.isArray(taskQueue)) {
          taskQueue.length = 0;
          console.warn('🧹 [PSC] taskQueue 초기화:', reason);
          return true;
        }
      } catch {}

      try {
        if (typeof self !== 'undefined' && self && Array.isArray(self.taskQueue)) {
          self.taskQueue.length = 0;
          console.warn('🧹 [PSC] self.taskQueue 초기화:', reason);
          return true;
        }
      } catch {}

      return false;
    }

    async function PSC_nativeObtainStoneSmart(args) {
      const count = args && Number(args.count || args.amount || args.target || 8);
      const res = await PSC_obtainStoneSmart({ count: count || 8, reason: 'native_action' });

      return res.ok
        ? '[문제해결] ' + res.msg
        : '[문제해결 실패] ' + res.msg;
    }

    function PSC_registerNativeActions() {
      try {
        if (typeof self !== 'undefined' && self) {
          self.skills = self.skills || {};

          self.skills.obtain_stone_smart = self.skills.obtain_stone_smart || {
            name: 'obtain_stone_smart',
            description: '조약돌/돌을 얻기 위해 노출 돌, 기억한 POI, 탐색, 안전 계단굴을 순서대로 시도하는 native 문제해결 행동',
            code: '// native'
          };

          self.skills.scan_world_map = self.skills.scan_world_map || {
            name: 'scan_world_map',
            description: '주변 자원/위험/제작대/죽은 위치를 월드맵 POI로 저장하는 native 행동',
            code: '// native'
          };
        }
      } catch {}

      try {
        if (typeof BUILTIN_ACTIONS !== 'undefined') {
          if (Array.isArray(BUILTIN_ACTIONS)) {
            if (!BUILTIN_ACTIONS.includes('obtain_stone_smart')) BUILTIN_ACTIONS.push('obtain_stone_smart');
            if (!BUILTIN_ACTIONS.includes('scan_world_map')) BUILTIN_ACTIONS.push('scan_world_map');
          } else if (BUILTIN_ACTIONS && typeof BUILTIN_ACTIONS === 'object') {
            BUILTIN_ACTIONS.obtain_stone_smart = BUILTIN_ACTIONS.obtain_stone_smart || true;
            BUILTIN_ACTIONS.scan_world_map = BUILTIN_ACTIONS.scan_world_map || true;
          }
        }
      } catch {}
    }

    
function PSC_installWrappers() {
      /* __ADAM_PSC_INSTALL_WRAPPERS_FIXED_V2__ */
      PSC_registerNativeActions();

      function PSC_normalizePerformArgs(botArg, selfArg, actionArg, targetArg, labelArg) {
        let realBot =
          botArg && botArg.entity && botArg.inventory
            ? botArg
            : (globalThis.__ADAM_LAST_BOT__ || globalThis.bot || null);

        let realSelf =
          selfArg && selfArg.name
            ? selfArg
            : (globalThis.__ADAM_LAST_SELF__ || globalThis.self || null);

        let action = actionArg;
        let target = targetArg;
        let label = labelArg;
        let rawAction = actionArg;

        if (
          (!actionArg || typeof actionArg === 'undefined') &&
          botArg &&
          typeof botArg === 'object' &&
          !(botArg.entity && botArg.inventory)
        ) {
          const obj = botArg;
          rawAction = obj;
          action = obj.action || obj.type || obj.name || obj.skill || '';
          target = obj.target || obj.item || obj.block || obj.resource || obj.goal || targetArg || null;
          label = obj.label || obj.poi || labelArg || null;
        }

        return { bot: realBot, self: realSelf, action, target, label, rawAction };
      }

      function PSC_bindGlobals(realBot, realSelf) {
        try {
          if (realBot) {
            globalThis.bot = realBot;
            globalThis.__ADAM_LAST_BOT__ = realBot;
            if (realBot.version) {
              try { globalThis.mcData = require('minecraft-data')(realBot.version); } catch {}
            }
          }
          if (realSelf) {
            globalThis.self = realSelf;
            globalThis.__ADAM_LAST_SELF__ = realSelf;
          }
        } catch {}
      }

      function PSC_clearStateQueue(realSelf, reason) {
        try {
          if (realSelf && realSelf.state && Array.isArray(realSelf.state.taskQueue)) {
            realSelf.state.taskQueue = [];
            realSelf.state.taskQueueMeta = {
              goalName: null,
              clearedBy: 'psc_fixed_wrapper',
              reason: reason || 'blocked',
              at: new Date().toISOString()
            };
            if (typeof saveJSON === 'function') saveJSON('state_' + realSelf.name + '.json', realSelf.state);
            console.warn('🧹 [PSC] self.state.taskQueue 초기화:', reason);
            return true;
          }
        } catch {}
        return PSC_softClearQueue(reason);
      }

      try {
        if (typeof performBuiltinAction === 'function' && !performBuiltinAction.__pscWrappedFixedV2) {
          const prevPerformBuiltinAction = performBuiltinAction;

          const wrappedPerformBuiltinAction = async function problemSolvingPerformBuiltinActionFixed(botArg, selfArg, actionArg, targetArg, labelArg) {
            const n = PSC_normalizePerformArgs(botArg, selfArg, actionArg, targetArg, labelArg);
            PSC_bindGlobals(n.bot, n.self);

            const parsed = PSC_parseAction(n.rawAction || n.action, [n.target, n.label]);
            const key = PSC_actionKey(parsed);

            try {
              PSC_installHooks();
              PSC_scanWorld('periodic');
            } catch {}

            try {
              if (parsed.name === 'obtain_stone_smart') {
                if (!PSC_botReady()) return '[준비대기] bot not ready: 돌 확보는 스폰/브릿지 준비 후 다시 시도한다.';
                return await PSC_nativeObtainStoneSmart({ count: n.target });
              }

              if (parsed.name === 'scan_world_map') {
                if (!PSC_botReady()) return '[준비대기] bot not ready: 월드맵 스캔은 잠시 뒤 다시 한다.';
                PSC_scanWorld('manual_action');
                return '[월드맵] 주변 자원/위험/제작대 POI를 스캔했다.';
              }

              if (PSC_isMineStoneAction(parsed)) {
                if (!PSC_botReady()) {
                  return '[준비대기] bot not ready: mine(stone)을 실패로 기록하지 않고 이번 사이클은 건너뛴다.';
                }

                if (PSC_actionCooling(key)) {
                  PSC_clearStateQueue(n.self, key + ' cooldown');
                  return '[루프방지] ' + key + '는 반복 실패 쿨다운 중이라 기술 큐를 비우고 다른 목표를 먼저 선택한다.';
                }

                console.log('🧩 [PSC] mine(stone) 요청을 스마트 돌 확보 목표로 변환한다.');

                const res = await PSC_obtainStoneSmart({
                  count: 8,
                  reason: 'intercepted_' + key
                });

                const msg = res.ok
                  ? '[문제해결] mine(stone)을 직접 반복하지 않고 대체 전략으로 해결: ' + res.msg
                  : '[문제해결 실패] mine(stone) 직접 반복 대신 대체 전략을 시도했지만 실패: ' + res.msg;

                if (!/bot not ready|not spawned|준비대기/i.test(msg)) {
                  PSC_recordActionResult(key, msg);
                }

                if (!res.ok) {
                  PSC_clearStateQueue(n.self, 'mine(stone) smart strategies failed');
                }

                return msg;
              }

              if (PSC_actionCooling(key)) {
                PSC_clearStateQueue(n.self, key + ' cooldown');
                const msg = '[루프방지] ' + key + '는 같은 이유로 반복 실패해서 잠시 금지한다. 같은 목표를 다른 전략으로 해결해야 한다.';
                console.warn('🛑 ' + msg);
                PSC_remember(msg, 8);
                return msg;
              }
            } catch (err) {
              console.warn('⚠️ [PSC] pre-action 문제해결 오류:', err && err.message ? err.message : err);
            }

            const result = await prevPerformBuiltinAction.call(this, n.bot, n.self, n.action, n.target, n.label);

            try {
              if (!/bot not ready|not spawned|준비대기/i.test(String(result || ''))) {
                PSC_recordActionResult(key, result);
              }
            } catch {}

            return result;
          };

          wrappedPerformBuiltinAction.__pscWrapped = true;
          wrappedPerformBuiltinAction.__pscWrappedFixedV2 = true;
          performBuiltinAction = wrappedPerformBuiltinAction;

          console.log('🧩 [PSC] performBuiltinAction 문제해결 래퍼 설치 완료(FIXED V2)');
        }
      } catch (err) {
        console.warn('⚠️ [PSC] performBuiltinAction 래핑 실패:', err && err.message ? err.message : err);
      }

      try {
        if (typeof thinkAndAct === 'function' && !thinkAndAct.__pscWrapped) {
          const prevThinkAndAct = thinkAndAct;

          const wrappedThinkAndAct = async function problemSolvingThinkAndAct(...args) {
            try {
              const realBot = args[0] || globalThis.__ADAM_LAST_BOT__ || globalThis.bot || null;
              const realSelf = args[1] || globalThis.__ADAM_LAST_SELF__ || globalThis.self || null;
              PSC_bindGlobals(realBot, realSelf);

              PSC_installHooks();
              PSC_scanWorld('periodic');

              const need = PSC_topNeed();

              if (Date.now() - PSC_lastNeedLogAt > 12000 && need.score >= 70) {
                PSC_lastNeedLogAt = Date.now();
                console.log('🧭 [욕구/문제해결] 최우선 욕구:', need.name, '-', need.reason);
              }

              if (need.name === 'stone_progress' && !PSC_goalCooling('obtain_stone') && !PSC_smartBusy && PSC_botReady()) {
                const res = await PSC_obtainStoneSmart({
                  count: 8,
                  reason: 'need_system_preempt'
                });

                if (res.ok) return true;
              }

              if (need.name === 'stone_progress' && PSC_goalCooling('obtain_stone')) {
                PSC_softClearQueue('obtain_stone goal cooldown - 큐 반복 방지');
              }
            } catch (err) {
              console.warn('⚠️ [PSC] think 우선순위 처리 오류:', err && err.message ? err.message : err);
            }

            return await prevThinkAndAct.apply(this, args);
          };

          wrappedThinkAndAct.__pscWrapped = true;
          thinkAndAct = wrappedThinkAndAct;

          console.log('🧭 [PSC] thinkAndAct 욕구/문제해결 우선 래퍼 설치 완료');
        }
      } catch (err) {
        console.warn('⚠️ [PSC] thinkAndAct 래핑 실패:', err && err.message ? err.message : err);
      }
    }

    try {
      PSC_loadState();
      PSC_installWrappers();
      PSC_installHooks();
      PSC_scanWorld('startup');

      const timer = setInterval(() => {
        try {
          PSC_installWrappers();
          PSC_installHooks();
          PSC_scanWorld('periodic');
        } catch {}
      }, 5000);

      if (timer && typeof timer.unref === 'function') timer.unref();
    } catch {}

    console.log('🧠 [PROBLEM SOLVING CORE V1] 반복루프 방지/월드맵/다중전략/전략학습/욕구우선/안전자가개발 로드 완료');
  }
} catch (err) {
  console.warn('⚠️ [PROBLEM SOLVING CORE V1] 설치 실패:', err && err.message ? err.message : err);
}



/* __ADAM_PLANNER_CORE_V1__ */
(function ADAM_PLANNER_CORE_V1() {
  if (globalThis.__ADAM_PLANNER_CORE_V1_INSTALLED__) return;
  globalThis.__ADAM_PLANNER_CORE_V1_INSTALLED__ = true;

  const fs = require("fs");
  const path = require("path");

  const AP_VERSION = "1.0.0";
  const AP_STATE_FILE = path.join(process.cwd(), "planner_Adam.json");

  let AP_busy = false;
  let AP_originalPerformBuiltinAction = null;

  function AP_log(message) {
    console.log("🧭 [PLANNER V1] " + message);
  }

  function AP_safeText(value) {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    try {
      if (value instanceof Error) return value.stack || value.message || String(value);
    } catch (_) {}
    try {
      return JSON.stringify(value);
    } catch (_) {
      try {
        return String(value);
      } catch (_) {
        return "";
      }
    }
  }

  function AP_now() {
    return Date.now();
  }

  function AP_sleep(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  function AP_defaultState() {
    return {
      version: AP_VERSION,
      activeGoal: null,
      activePlan: null,
      forcedGoal: null,
      failures: {},
      strategyStats: {},
      planHistory: [],
      lastPlanAt: 0,
      lastTickAt: 0,
      lastCooldownLogAt: 0,
      config: {
        tickMinIntervalMs: 1200,
        planTtlMs: 90000,
        maxFailuresBeforeCooldown: 2,
        stepCooldownMs: 300000,
        minLogBatch: 4,
        cobblestoneBatch: 16,
        autoIron: process.env.ADAM_PLANNER_AUTO_IRON === "1"
      }
    };
  }

  function AP_loadState() {
    try {
      if (fs.existsSync(AP_STATE_FILE)) {
        const raw = fs.readFileSync(AP_STATE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Object.assign(AP_defaultState(), parsed || {});
      }
    } catch (err) {
      AP_log("planner state 로드 실패, 새로 시작: " + AP_safeText(err.message || err));
    }
    return AP_defaultState();
  }

  let AP_state = AP_loadState();

  function AP_saveState() {
    try {
      fs.writeFileSync(AP_STATE_FILE, JSON.stringify(AP_state, null, 2));
    } catch (err) {
      AP_log("planner state 저장 실패: " + AP_safeText(err.message || err));
    }
  }

  function AP_getBot() {
    try {
      if (typeof bot !== "undefined" && bot) return bot;
    } catch (_) {}
    try {
      if (globalThis.bot) return globalThis.bot;
    } catch (_) {}
    return null;
  }

  function AP_getMcData() {
    try {
      if (typeof mcData !== "undefined" && mcData && mcData.itemsByName) return mcData;
    } catch (_) {}
    const b = AP_getBot();
    if (!b || !b.version) throw new Error("mcData unavailable because bot/version is not ready");
    return require("minecraft-data")(b.version);
  }

  function AP_botReady(b) {
    if (!b) return false;
    if (!b.entity) return false;
    if (!b.inventory) return false;
    if (!b.version) return false;
    if (b.isDead) return false;
    return true;
  }

  const AP_LOGS = [
    "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log",
    "dark_oak_log", "mangrove_log", "cherry_log",
    "crimson_stem", "warped_stem",
    "stripped_oak_log", "stripped_spruce_log", "stripped_birch_log",
    "stripped_jungle_log", "stripped_acacia_log", "stripped_dark_oak_log",
    "stripped_mangrove_log", "stripped_cherry_log",
    "stripped_crimson_stem", "stripped_warped_stem"
  ];

  const AP_PLANKS = [
    "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks",
    "cherry_planks", "crimson_planks", "warped_planks"
  ];

  const AP_STONE_MATERIALS = [
    "cobblestone",
    "cobbled_deepslate",
    "blackstone"
  ];

  const AP_STONE_BLOCKS = [
    "stone",
    "deepslate",
    "andesite",
    "diorite",
    "granite"
  ];

  const AP_FUELS = [
    "coal", "charcoal",
    "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log",
    "dark_oak_log", "mangrove_log", "cherry_log",
    "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"
  ];

  const AP_HOSTILES = [
    "zombie", "skeleton", "stray", "creeper", "spider", "cave_spider",
    "enderman", "witch", "drowned", "husk", "pillager", "slime"
  ];

  const AP_LOG_TO_PLANKS = {
    oak_log: "oak_planks",
    spruce_log: "spruce_planks",
    birch_log: "birch_planks",
    jungle_log: "jungle_planks",
    acacia_log: "acacia_planks",
    dark_oak_log: "dark_oak_planks",
    mangrove_log: "mangrove_planks",
    cherry_log: "cherry_planks",
    crimson_stem: "crimson_planks",
    warped_stem: "warped_planks",
    stripped_oak_log: "oak_planks",
    stripped_spruce_log: "spruce_planks",
    stripped_birch_log: "birch_planks",
    stripped_jungle_log: "jungle_planks",
    stripped_acacia_log: "acacia_planks",
    stripped_dark_oak_log: "dark_oak_planks",
    stripped_mangrove_log: "mangrove_planks",
    stripped_cherry_log: "cherry_planks",
    stripped_crimson_stem: "crimson_planks",
    stripped_warped_stem: "warped_planks"
  };

  function AP_inventoryItems() {
    const b = AP_getBot();
    if (!b || !b.inventory || typeof b.inventory.items !== "function") return [];
    try {
      return b.inventory.items() || [];
    } catch (_) {
      return [];
    }
  }

  function AP_countItem(name) {
    let total = 0;
    const items = AP_inventoryItems();
    for (const it of items) {
      if (it && it.name === name) total += it.count || 0;
    }
    return total;
  }

  function AP_countAny(names) {
    let total = 0;
    const set = new Set(names);
    const items = AP_inventoryItems();
    for (const it of items) {
      if (it && set.has(it.name)) total += it.count || 0;
    }
    return total;
  }

  function AP_getCount(key) {
    if (key === "logs") return AP_countAny(AP_LOGS);
    if (key === "planks") return AP_countAny(AP_PLANKS);
    if (key === "cobblestone") return AP_countAny(AP_STONE_MATERIALS);
    if (key === "fuel") return AP_countAny(AP_FUELS);
    return AP_countItem(key);
  }

  function AP_makeCtx() {
    return {
      logs: AP_getCount("logs"),
      planks: AP_getCount("planks"),
      stick: AP_getCount("stick"),
      crafting_table: AP_getCount("crafting_table"),
      wooden_pickaxe: AP_getCount("wooden_pickaxe"),
      stone_pickaxe: AP_getCount("stone_pickaxe"),
      iron_pickaxe: AP_getCount("iron_pickaxe"),
      diamond_pickaxe: AP_getCount("diamond_pickaxe"),
      netherite_pickaxe: AP_getCount("netherite_pickaxe"),
      stone_sword: AP_getCount("stone_sword"),
      stone_axe: AP_getCount("stone_axe"),
      furnace: AP_getCount("furnace"),
      cobblestone: AP_getCount("cobblestone"),
      raw_iron: AP_getCount("raw_iron"),
      iron_ingot: AP_getCount("iron_ingot"),
      fuel: AP_getCount("fuel")
    };
  }

  function AP_add(ctx, key, amount) {
    if (!ctx[key]) ctx[key] = 0;
    ctx[key] += amount;
  }

  function AP_consume(ctx, key, amount) {
    if (!ctx[key]) ctx[key] = 0;
    ctx[key] -= amount;
    if (ctx[key] < 0) ctx[key] = 0;
  }

  function AP_bestPickaxeTier(ctx) {
    if ((ctx.netherite_pickaxe || 0) > 0) return 5;
    if ((ctx.diamond_pickaxe || 0) > 0) return 4;
    if ((ctx.iron_pickaxe || 0) > 0) return 3;
    if ((ctx.stone_pickaxe || 0) > 0) return 2;
    if ((ctx.wooden_pickaxe || 0) > 0) return 1;
    return 0;
  }

  const AP_RECIPES = {
    planks: {
      outputKey: "planks",
      outputCount: 4,
      craftItem: "planks",
      ingredients: { logs: 1 }
    },
    stick: {
      outputKey: "stick",
      outputCount: 4,
      craftItem: "stick",
      ingredients: { planks: 2 }
    },
    crafting_table: {
      outputKey: "crafting_table",
      outputCount: 1,
      craftItem: "crafting_table",
      ingredients: { planks: 4 }
    },
    wooden_pickaxe: {
      outputKey: "wooden_pickaxe",
      outputCount: 1,
      craftItem: "wooden_pickaxe",
      station: "crafting_table",
      ingredients: { stick: 2, planks: 3 }
    },
    stone_pickaxe: {
      outputKey: "stone_pickaxe",
      outputCount: 1,
      craftItem: "stone_pickaxe",
      station: "crafting_table",
      ingredients: { stick: 2, cobblestone: 3 }
    },
    stone_sword: {
      outputKey: "stone_sword",
      outputCount: 1,
      craftItem: "stone_sword",
      station: "crafting_table",
      ingredients: { stick: 1, cobblestone: 2 }
    },
    stone_axe: {
      outputKey: "stone_axe",
      outputCount: 1,
      craftItem: "stone_axe",
      station: "crafting_table",
      ingredients: { stick: 2, cobblestone: 3 }
    },
    furnace: {
      outputKey: "furnace",
      outputCount: 1,
      craftItem: "furnace",
      station: "crafting_table",
      ingredients: { cobblestone: 8 }
    },
    iron_pickaxe: {
      outputKey: "iron_pickaxe",
      outputCount: 1,
      craftItem: "iron_pickaxe",
      station: "crafting_table",
      ingredients: { stick: 2, iron_ingot: 3 }
    }
  };

  function AP_keyDepth(key) {
    const depth = {
      logs: 0,
      planks: 1,
      stick: 2,
      crafting_table: 2,
      wooden_pickaxe: 3,
      cobblestone: 4,
      stone_pickaxe: 5,
      stone_sword: 5,
      stone_axe: 5,
      furnace: 5,
      raw_iron: 6,
      iron_ingot: 7,
      iron_pickaxe: 8,
      fuel: 1
    };
    return depth[key] || 0;
  }

  function AP_pushStep(steps, step) {
    step.id = "plan_step_" + String(steps.length + 1);
    step.createdAt = AP_now();
    steps.push(step);
  }

  function AP_require(ctx, steps, key, qty, stack) {
    qty = Math.ceil(Number(qty) || 0);
    if (qty <= 0) return;
    if (!stack) stack = [];

    if (!ctx[key]) ctx[key] = 0;
    if (ctx[key] >= qty) return;

    if (stack.indexOf(key) >= 0) {
      throw new Error("planner circular dependency: " + stack.concat([key]).join(" > "));
    }

    if (key === "logs") {
      const missing = qty - ctx.logs;
      const batch = Math.max(missing, AP_state.config.minLogBatch || 4);
      AP_pushStep(steps, {
        type: "gather",
        target: "logs",
        count: batch,
        reason: "나무 계열 재료가 부족해서 logs 확보"
      });
      AP_add(ctx, "logs", batch);
      return;
    }

    if (key === "cobblestone") {
      if (AP_bestPickaxeTier(ctx) < 1) {
        AP_require(ctx, steps, "wooden_pickaxe", 1, stack.concat([key]));
      }

      const missing = qty - ctx.cobblestone;
      const batch = Math.max(missing, AP_state.config.cobblestoneBatch || 16);

      AP_pushStep(steps, {
        type: "obtain",
        item: "cobblestone",
        target: "stone",
        count: batch,
        strategies: [
          "known_stone_poi",
          "local_exposed_stone",
          "hillside_or_riverbank_search",
          "safe_staircase_mine"
        ],
        reason: "돌 도구와 화로 제작을 위해 stone material 확보"
      });

      AP_add(ctx, "cobblestone", batch);
      return;
    }

    if (key === "raw_iron") {
      if (AP_bestPickaxeTier(ctx) < 2) {
        AP_require(ctx, steps, "stone_pickaxe", 1, stack.concat([key]));
      }

      const missing = qty - ctx.raw_iron;
      AP_pushStep(steps, {
        type: "mine",
        item: "raw_iron",
        target: "iron_ore",
        count: missing,
        strategies: [
          "known_iron_poi",
          "cave_iron",
          "y_level_branch_search"
        ],
        reason: "iron_ingot 제작을 위해 raw_iron 확보"
      });

      AP_add(ctx, "raw_iron", missing);
      return;
    }

    if (key === "fuel") {
      if (ctx.fuel >= qty) return;
      const missingFuel = qty - ctx.fuel;
      AP_require(ctx, steps, "logs", missingFuel, stack.concat([key]));
      AP_add(ctx, "fuel", missingFuel);
      return;
    }

    if (key === "iron_ingot") {
      const missingIngots = qty - ctx.iron_ingot;
      AP_require(ctx, steps, "furnace", 1, stack.concat([key]));
      AP_require(ctx, steps, "raw_iron", missingIngots, stack.concat([key]));
      AP_require(ctx, steps, "fuel", 1, stack.concat([key]));

      AP_pushStep(steps, {
        type: "smelt",
        item: "iron_ingot",
        input: "raw_iron",
        fuel: "fuel",
        count: missingIngots,
        reason: "iron_pickaxe 제작을 위해 raw_iron 제련"
      });

      AP_consume(ctx, "raw_iron", missingIngots);
      AP_consume(ctx, "fuel", 1);
      AP_add(ctx, "iron_ingot", missingIngots);
      return;
    }

    const recipe = AP_RECIPES[key];
    if (!recipe) {
      throw new Error("planner has no recipe or gather rule for " + key);
    }

    const missing = qty - ctx[key];
    const batches = Math.ceil(missing / recipe.outputCount);

    if (recipe.station) {
      AP_require(ctx, steps, recipe.station, 1, stack.concat([key]));
    }

    const ingredientKeys = Object.keys(recipe.ingredients || {}).sort(function(a, b) {
      return AP_keyDepth(b) - AP_keyDepth(a);
    });

    for (const ing of ingredientKeys) {
      const need = recipe.ingredients[ing] * batches;
      AP_require(ctx, steps, ing, need, stack.concat([key]));
    }

    for (const ing of ingredientKeys) {
      const need = recipe.ingredients[ing] * batches;
      AP_consume(ctx, ing, need);
    }

    AP_pushStep(steps, {
      type: "craft",
      item: key,
      craftItem: recipe.craftItem,
      count: recipe.outputCount * batches,
      batches: batches,
      station: recipe.station || null,
      reason: key + " 제작"
    });

    AP_add(ctx, recipe.outputKey, recipe.outputCount * batches);
  }

  function AP_planForGoal(goal) {
    const ctx = AP_makeCtx();
    const steps = [];

    if (!goal) return steps;

    if (typeof goal === "string") {
      goal = { type: "obtain_item", item: goal, count: 1 };
    }

    if (goal.item === "stone") {
      goal.item = "cobblestone";
    }

    if (goal.type === "bootstrap_stone_age") {
      AP_require(ctx, steps, "crafting_table", 1, []);
      AP_require(ctx, steps, "wooden_pickaxe", 1, []);
      AP_require(ctx, steps, "cobblestone", 16, []);
      AP_require(ctx, steps, "stone_pickaxe", 1, []);
      AP_require(ctx, steps, "stone_sword", 1, []);
      AP_require(ctx, steps, "stone_axe", 1, []);
      AP_require(ctx, steps, "furnace", 1, []);
      return steps;
    }

    if (goal.type === "obtain_item") {
      AP_require(ctx, steps, goal.item, goal.count || 1, []);
      return steps;
    }

    throw new Error("unknown planning goal: " + AP_safeText(goal));
  }

  function AP_goalKey(goal) {
    if (!goal) return "none";
    return AP_safeText(goal);
  }

  function AP_chooseGoal() {
    const b = AP_getBot();
    if (!AP_botReady(b)) return null;

    if (typeof b.health === "number" && b.health <= 10) {
      return null;
    }

    if (typeof b.food === "number" && b.food <= 8) {
      return null;
    }

    if (AP_state.forcedGoal) return AP_state.forcedGoal;

    const ctx = AP_makeCtx();

    if (
      ctx.crafting_table < 1 ||
      ctx.wooden_pickaxe < 1 ||
      ctx.stone_pickaxe < 1 ||
      ctx.stone_sword < 1 ||
      ctx.stone_axe < 1 ||
      ctx.furnace < 1
    ) {
      return {
        type: "bootstrap_stone_age",
        reason: "wood age에서 stone age로 넘어가기 위한 기본 계획"
      };
    }

    if (AP_state.config.autoIron && ctx.iron_pickaxe < 1) {
      return {
        type: "obtain_item",
        item: "iron_pickaxe",
        count: 1,
        reason: "iron age 진입 계획"
      };
    }

    return null;
  }

  function AP_makePlan(goal) {
    const steps = AP_planForGoal(goal);
    return {
      id: "plan_" + String(AP_now()),
      goal: goal,
      goalKey: AP_goalKey(goal),
      createdAt: AP_now(),
      steps: steps,
      status: steps.length > 0 ? "active" : "empty"
    };
  }

  function AP_stepSignature(step) {
    if (!step) return "unknown";
    if (step.type === "gather") return "gather:" + step.target;
    if (step.type === "craft") return "craft:" + step.item;
    if (step.type === "obtain") return "obtain:" + step.item;
    if (step.type === "mine") return "mine:" + step.target;
    if (step.type === "smelt") return "smelt:" + step.item;
    return step.type + ":" + AP_safeText(step.target || step.item || "unknown");
  }

  function AP_externalActionSignature(action) {
    const text = AP_safeText(action).toLowerCase();

    if (
      text.indexOf("mine") >= 0 &&
      (text.indexOf("stone") >= 0 || text.indexOf("cobblestone") >= 0)
    ) {
      return "obtain:cobblestone";
    }

    if (
      text.indexOf("gather_wood") >= 0 ||
      text.indexOf("gather wood") >= 0 ||
      text.indexOf("logs") >= 0
    ) {
      return "gather:logs";
    }

    if (text.indexOf("craft") >= 0 && text.indexOf("wooden_pickaxe") >= 0) {
      return "craft:wooden_pickaxe";
    }

    if (text.indexOf("craft") >= 0 && text.indexOf("stone_pickaxe") >= 0) {
      return "craft:stone_pickaxe";
    }

    return null;
  }

  function AP_isCooling(signature) {
    const f = AP_state.failures[signature];
    if (!f) return false;
    if (!f.cooldownUntil) return false;
    return f.cooldownUntil > AP_now();
  }

  function AP_isTransientFailure(errorText) {
    const text = AP_safeText(errorText).toLowerCase();
    if (text.indexOf("bot not ready") >= 0) return true;
    if (text.indexOf("not spawned") >= 0) return true;
    if (text.indexOf("cannot read") >= 0 && text.indexOf("entity") >= 0) return true;
    if (text.indexOf("immediate threat") >= 0) return true;
    return false;
  }

  function AP_recordStepResult(step, ok, errorText) {
    const signature = AP_stepSignature(step);

    if (ok) {
      delete AP_state.failures[signature];
      AP_saveState();
      return;
    }

    if (AP_isTransientFailure(errorText)) {
      AP_log("일시 실패라 cooldown에 넣지 않음: " + signature + " / " + AP_safeText(errorText));
      return;
    }

    if (!AP_state.failures[signature]) {
      AP_state.failures[signature] = {
        count: 0,
        lastError: "",
        lastAt: 0,
        cooldownUntil: 0
      };
    }

    const f = AP_state.failures[signature];
    f.count += 1;
    f.lastError = AP_safeText(errorText);
    f.lastAt = AP_now();

    if (f.count >= AP_state.config.maxFailuresBeforeCooldown) {
      f.cooldownUntil = AP_now() + AP_state.config.stepCooldownMs;
      AP_log("반복 실패로 step cooldown: " + signature + " / " + Math.round(AP_state.config.stepCooldownMs / 1000) + "초");
    }

    AP_saveState();
  }

  function AP_relevantCount(step) {
    if (!step) return 0;
    if (step.type === "gather") return AP_getCount("logs");
    if (step.type === "craft") return AP_getCount(step.item);
    if (step.type === "obtain") return AP_getCount(step.item);
    if (step.type === "mine") return AP_getCount(step.item || step.target);
    if (step.type === "smelt") return AP_getCount(step.item);
    return 0;
  }

  function AP_hasImmediateThreat() {
    const b = AP_getBot();
    if (!AP_botReady(b)) return false;
    if (!b.entities || !b.entity || !b.entity.position) return false;

    const pos = b.entity.position;

    for (const id of Object.keys(b.entities)) {
      const e = b.entities[id];
      if (!e || !e.position) continue;

      const rawName = String(e.name || e.displayName || e.mobType || "").toLowerCase();
      if (!rawName) continue;

      let hostile = false;
      for (const h of AP_HOSTILES) {
        if (rawName.indexOf(h) >= 0) {
          hostile = true;
          break;
        }
      }

      if (!hostile) continue;

      const d = e.position.distanceTo(pos);
      if (rawName.indexOf("creeper") >= 0 && d <= 8) return true;
      if (rawName.indexOf("skeleton") >= 0 && d <= 10) return true;
      if (rawName.indexOf("stray") >= 0 && d <= 10) return true;
      if (rawName.indexOf("enderman") >= 0 && d <= 6) return true;
      if (d <= 5) return true;
    }

    return false;
  }

  function AP_preferredPlanksName() {
    for (const p of AP_PLANKS) {
      if (AP_countItem(p) > 0) return p;
    }

    for (const l of AP_LOGS) {
      if (AP_countItem(l) > 0 && AP_LOG_TO_PLANKS[l]) {
        return AP_LOG_TO_PLANKS[l];
      }
    }

    return "oak_planks";
  }

  function AP_resolveCraftItem(key) {
    if (key === "planks") return AP_preferredPlanksName();

    const direct = {
      stick: "stick",
      crafting_table: "crafting_table",
      wooden_pickaxe: "wooden_pickaxe",
      stone_pickaxe: "stone_pickaxe",
      stone_sword: "stone_sword",
      stone_axe: "stone_axe",
      furnace: "furnace",
      iron_pickaxe: "iron_pickaxe"
    };

    return direct[key] || key;
  }

  function AP_itemNeedsTable(itemName) {
    if (AP_PLANKS.indexOf(itemName) >= 0) return false;
    if (itemName === "stick") return false;
    if (itemName === "crafting_table") return false;
    return true;
  }

  function AP_findNearbyBlockByName(name, maxDistance) {
    const b = AP_getBot();
    if (!AP_botReady(b) || typeof b.findBlock !== "function") return null;

    try {
      return b.findBlock({
        matching: function(block) {
          return block && block.name === name;
        },
        maxDistance: maxDistance || 6
      });
    } catch (_) {
      return null;
    }
  }

  function AP_getVec3() {
    const v = require("vec3");
    return v.Vec3 || v;
  }

  async function AP_placeCraftingTable() {
    const b = AP_getBot();
    if (!AP_botReady(b)) return false;

    const item = AP_inventoryItems().find(function(it) {
      return it && it.name === "crafting_table";
    });

    if (!item) return false;

    const Vec3 = AP_getVec3();
    const base = b.entity.position.floored();

    const dirs = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1)
    ];

    await b.equip(item, "hand");

    for (const dir of dirs) {
      const targetPos = base.plus(dir);
      const belowPos = targetPos.offset(0, -1, 0);
      const target = b.blockAt(targetPos);
      const below = b.blockAt(belowPos);

      if (!target || !below) continue;
      if (target.name !== "air" && target.boundingBox !== "empty") continue;
      if (below.boundingBox !== "block") continue;

      try {
        await b.placeBlock(below, new Vec3(0, 1, 0));
        AP_log("crafting_table 배치 완료");
        return true;
      } catch (_) {}
    }

    return false;
  }

  async function AP_directCraft(step) {
    const b = AP_getBot();
    if (!AP_botReady(b)) throw new Error("bot not ready");

    const data = AP_getMcData();
    const itemName = AP_resolveCraftItem(step.item || step.craftItem);
    const itemDef = data.itemsByName[itemName];

    if (!itemDef) {
      throw new Error("unknown craft item: " + itemName);
    }

    let table = null;

    if (AP_itemNeedsTable(itemName)) {
      table = AP_findNearbyBlockByName("crafting_table", 5);

      if (!table && AP_countItem("crafting_table") > 0) {
        await AP_placeCraftingTable();
        await AP_sleep(300);
        table = AP_findNearbyBlockByName("crafting_table", 6);
      }

      if (!table) {
        throw new Error("crafting_table not accessible for " + itemName);
      }
    }

    const recipes = b.recipesFor(itemDef.id, null, 1, table);
    if (!recipes || recipes.length === 0) {
      throw new Error("no recipe available for " + itemName);
    }

    const recipe = recipes[0];
    let outCount = 1;

    try {
      if (recipe.result && recipe.result.count) outCount = recipe.result.count;
    } catch (_) {}

    if (AP_PLANKS.indexOf(itemName) >= 0) outCount = 4;
    if (itemName === "stick") outCount = 4;

    const desiredOutput = Math.max(1, Number(step.count) || 1);
    const craftTimes = Math.max(1, Math.ceil(desiredOutput / outCount));

    await b.craft(recipe, craftTimes, table);
    AP_log("제작 성공: " + itemName + " x" + desiredOutput);
    return true;
  }

  async function AP_gotoNear(pos, range) {
    const b = AP_getBot();
    if (!AP_botReady(b)) throw new Error("bot not ready");
    if (!b.pathfinder) return false;

    const data = AP_getMcData();
    const pf = require("mineflayer-pathfinder");
    const Movements = pf.Movements;
    const GoalNear = pf.goals.GoalNear;

    const movements = new Movements(b, data);
    b.pathfinder.setMovements(movements);
    await b.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, range || 1));
    return true;
  }

  async function AP_equipBestPickaxe() {
    const b = AP_getBot();
    if (!AP_botReady(b)) return false;

    const order = [
      "netherite_pickaxe",
      "diamond_pickaxe",
      "iron_pickaxe",
      "stone_pickaxe",
      "wooden_pickaxe"
    ];

    const items = AP_inventoryItems();

    for (const name of order) {
      const item = items.find(function(it) {
        return it && it.name === name;
      });

      if (item) {
        await b.equip(item, "hand");
        return true;
      }
    }

    return false;
  }

  function AP_isAirLike(block) {
    if (!block) return true;
    if (block.name === "air") return true;
    if (block.boundingBox === "empty") return true;
    return false;
  }

  function AP_blockExposed(block) {
    const b = AP_getBot();
    if (!AP_botReady(b) || !block || !block.position) return false;

    const p = block.position;
    const checks = [
      p.offset(1, 0, 0),
      p.offset(-1, 0, 0),
      p.offset(0, 1, 0),
      p.offset(0, -1, 0),
      p.offset(0, 0, 1),
      p.offset(0, 0, -1)
    ];

    for (const pos of checks) {
      const adj = b.blockAt(pos);
      if (AP_isAirLike(adj)) return true;
    }

    return false;
  }

  async function AP_directGatherLogs(count) {
    const b = AP_getBot();
    if (!AP_botReady(b)) throw new Error("bot not ready");
    if (typeof b.findBlock !== "function") return false;

    let dug = 0;
    const limit = Math.max(1, Math.min(Number(count) || 1, 6));

    for (let i = 0; i < limit; i++) {
      const block = b.findBlock({
        matching: function(candidate) {
          return candidate && AP_LOGS.indexOf(candidate.name) >= 0;
        },
        maxDistance: 40
      });

      if (!block) break;

      await AP_gotoNear(block.position, 1);

      const fresh = b.blockAt(block.position);
      if (!fresh || AP_LOGS.indexOf(fresh.name) < 0) continue;

      if (typeof b.canDigBlock === "function" && !b.canDigBlock(fresh)) continue;

      await b.dig(fresh);
      dug += 1;
      await AP_sleep(250);
    }

    if (dug > 0) {
      AP_log("직접 logs 확보 성공: " + dug + "개 블록");
    }

    return dug > 0;
  }

  async function AP_directObtainCobblestone(count) {
    const b = AP_getBot();
    if (!AP_botReady(b)) throw new Error("bot not ready");
    if (typeof b.findBlock !== "function") return false;

    await AP_equipBestPickaxe();

    let dug = 0;
    const limit = Math.max(1, Math.min(Number(count) || 1, 6));

    for (let i = 0; i < limit; i++) {
      const block = b.findBlock({
        matching: function(candidate) {
          return candidate &&
            AP_STONE_BLOCKS.indexOf(candidate.name) >= 0 &&
            AP_blockExposed(candidate);
        },
        maxDistance: 48
      });

      if (!block) break;

      await AP_gotoNear(block.position, 1);

      const fresh = b.blockAt(block.position);
      if (!fresh || AP_STONE_BLOCKS.indexOf(fresh.name) < 0) continue;

      if (typeof b.canDigBlock === "function" && !b.canDigBlock(fresh)) continue;

      await b.dig(fresh);
      dug += 1;
      await AP_sleep(250);
    }

    if (dug > 0) {
      AP_log("직접 stone material 확보 성공: " + dug + "개 블록");
    }

    return dug > 0;
  }

  function AP_builtinCandidates(step) {
    if (!step) return [];

    if (step.type === "gather" && step.target === "logs") {
      return [
        { type: "gather_wood", target: "logs", count: step.count, reason: "planner" },
        { action: "gather_wood", target: "logs", count: step.count, reason: "planner" },
        { type: "gather", item: "log", count: step.count, reason: "planner" }
      ];
    }

    if (step.type === "craft") {
      const itemName = AP_resolveCraftItem(step.item || step.craftItem);
      return [
        { type: "craft", item: itemName, count: step.count, reason: "planner" },
        { action: "craft", item: itemName, count: step.count, reason: "planner" },
        { type: "craft_item", item: itemName, count: step.count, reason: "planner" }
      ];
    }

    if (step.type === "obtain" && step.item === "cobblestone") {
      return [
        {
          type: "obtain_cobblestone",
          item: "cobblestone",
          target: "stone",
          count: step.count,
          strategies: step.strategies || [],
          reason: "planner"
        },
        { type: "mine", target: "stone", item: "stone", count: step.count, reason: "planner" },
        { action: "mine", target: "stone", item: "stone", count: step.count, reason: "planner" }
      ];
    }

    if (step.type === "mine") {
      return [
        { type: "mine", target: step.target, item: step.item, count: step.count, reason: "planner" },
        { action: "mine", target: step.target, item: step.item, count: step.count, reason: "planner" }
      ];
    }

    if (step.type === "smelt") {
      return [
        { type: "smelt", item: step.item, input: step.input, fuel: step.fuel, count: step.count, reason: "planner" },
        { action: "smelt", item: step.item, input: step.input, fuel: step.fuel, count: step.count, reason: "planner" }
      ];
    }

    return [];
  }

  function AP_captureOriginalPerform() {
    if (AP_originalPerformBuiltinAction) return;
    try {
      const fn = eval("typeof performBuiltinAction !== \"undefined\" ? performBuiltinAction : undefined");
      if (typeof fn === "function") AP_originalPerformBuiltinAction = fn;
    } catch (_) {}
  }

  async function AP_callOriginal(step) {
    AP_captureOriginalPerform();

    if (!AP_originalPerformBuiltinAction) return false;

    const candidates = AP_builtinCandidates(step);
    if (!candidates.length) return false;

    for (const candidate of candidates) {
      const before = AP_relevantCount(step);

      try {
        const result = await AP_originalPerformBuiltinAction(candidate);
        await AP_sleep(250);

        const after = AP_relevantCount(step);
        if (after > before) return true;
        if (result === true) return true;
        if (result && result.ok === true) return true;
      } catch (_) {}
    }

    return false;
  }

  async function AP_executeStep(step) {
    const b = AP_getBot();

    if (!AP_botReady(b)) {
      return { ok: false, error: "bot not ready" };
    }

    if (AP_hasImmediateThreat()) {
      return { ok: false, error: "immediate threat near bot" };
    }

    const before = AP_relevantCount(step);
    let ok = false;
    let lastError = "";

    async function tryRun(fn) {
      try {
        const result = await fn();
        return result === true;
      } catch (err) {
        lastError = AP_safeText(err.message || err);
        return false;
      }
    }

    if (step.type === "craft") {
      ok = await tryRun(function() { return AP_directCraft(step); });
      if (!ok) ok = await tryRun(function() { return AP_callOriginal(step); });
    } else if (step.type === "gather" && step.target === "logs") {
      ok = await tryRun(function() { return AP_callOriginal(step); });
      if (!ok) ok = await tryRun(function() { return AP_directGatherLogs(step.count); });
    } else if (step.type === "obtain" && step.item === "cobblestone") {
      ok = await tryRun(function() { return AP_callOriginal(step); });
      if (!ok) ok = await tryRun(function() { return AP_directObtainCobblestone(step.count); });
    } else {
      ok = await tryRun(function() { return AP_callOriginal(step); });
    }

    await AP_sleep(300);

    const after = AP_relevantCount(step);
    if (!ok && after > before) ok = true;

    return {
      ok: ok,
      error: ok ? "" : (lastError || "step returned false without inventory progress")
    };
  }

  async function AP_plannerTick(reason) {
    if (process.env.ADAM_PLANNER_DISABLED === "1") return false;

    const now = AP_now();

    if (AP_busy) return false;
    if (now - (AP_state.lastTickAt || 0) < AP_state.config.tickMinIntervalMs) return false;

    AP_state.lastTickAt = now;

    const b = AP_getBot();
    if (!AP_botReady(b)) return false;

    if (AP_hasImmediateThreat()) return false;

    if (typeof b.health === "number" && b.health <= 10) return false;
    if (typeof b.food === "number" && b.food <= 8) return false;

    let goal = AP_chooseGoal();
    if (!goal) return false;

    const goalKey = AP_goalKey(goal);
    const needNewPlan =
      !AP_state.activePlan ||
      AP_state.activePlan.goalKey !== goalKey ||
      now - (AP_state.activePlan.createdAt || 0) > AP_state.config.planTtlMs;

    if (needNewPlan) {
      try {
        const plan = AP_makePlan(goal);
        AP_state.activeGoal = goal;
        AP_state.activePlan = plan;
        AP_state.lastPlanAt = now;

        AP_log("새 계획 생성: " + goalKey + " / steps=" + plan.steps.length);

        AP_state.planHistory.push({
          at: now,
          goal: goal,
          steps: plan.steps.map(function(s) {
            return {
              type: s.type,
              item: s.item,
              target: s.target,
              count: s.count,
              reason: s.reason
            };
          })
        });

        if (AP_state.planHistory.length > 30) {
          AP_state.planHistory = AP_state.planHistory.slice(-30);
        }

        AP_saveState();
      } catch (err) {
        AP_log("계획 생성 실패: " + AP_safeText(err.message || err));
        AP_state.activePlan = null;
        AP_saveState();
        return false;
      }
    }

    const plan = AP_state.activePlan;
    if (!plan || !plan.steps || plan.steps.length === 0) return false;

    const step = plan.steps[0];
    const signature = AP_stepSignature(step);

    if (AP_isCooling(signature)) {
      if (now - (AP_state.lastCooldownLogAt || 0) > 5000) {
        AP_log("cooldown 중이라 step 보류: " + signature);
        AP_state.lastCooldownLogAt = now;
        AP_saveState();
      }
      return false;
    }

    AP_busy = true;

    try {
      AP_log("실행 step: " + signature + " / " + (step.reason || ""));

      const result = await AP_executeStep(step);

      AP_recordStepResult(step, result.ok, result.error);

      AP_state.activePlan = null;
      AP_saveState();

      if (result.ok) {
        AP_log("step 성공, 실제 인벤토리 기준으로 다음 tick에서 재계획");
      } else {
        AP_log("step 실패: " + signature + " / " + result.error);
      }

      return true;
    } finally {
      AP_busy = false;
    }
  }

  function AP_wrapFunctionByName(name, wrapperFactory) {
    try {
      const oldFn = eval("typeof " + name + " !== \"undefined\" ? " + name + " : undefined");
      if (typeof oldFn !== "function") return false;
      if (oldFn.__adamPlannerWrapped) return true;

      const newFn = wrapperFactory(oldFn, name);
      Object.defineProperty(newFn, "__adamPlannerWrapped", { value: true });

      eval(name + " = newFn");
      AP_log("wrapper 설치: " + name);
      return true;
    } catch (err) {
      AP_log("wrapper 설치 실패: " + name + " / " + AP_safeText(err.message || err));
      return false;
    }
  }

  function AP_wrapTextFunction(name, argIndexes) {
    try {
      const oldFn = eval("typeof " + name + " !== \"undefined\" ? " + name + " : undefined");
      if (typeof oldFn !== "function") return false;
      if (oldFn.__adamSafeTextWrapped) return true;

      const newFn = function() {
        const args = Array.prototype.slice.call(arguments);
        for (const idx of argIndexes) {
          if (idx < args.length) args[idx] = AP_safeText(args[idx]);
        }
        return oldFn.apply(this, args);
      };

      Object.defineProperty(newFn, "__adamSafeTextWrapped", { value: true });
      eval(name + " = newFn");
      AP_log("memory text safety wrapper 설치: " + name);
      return true;
    } catch (err) {
      AP_log("memory text safety wrapper 실패: " + name + " / " + AP_safeText(err.message || err));
      return false;
    }
  }

  AP_wrapTextFunction("estimateImportanceHeuristic", [0]);
  AP_wrapTextFunction("addMemory", [0]);
  AP_wrapTextFunction("getEmbedding", [0]);
  AP_wrapTextFunction("embedText", [0]);
  AP_wrapTextFunction("generateEmbedding", [0]);
  AP_wrapTextFunction("createEmbedding", [0]);

  AP_wrapFunctionByName("performBuiltinAction", function(oldFn) {
    AP_originalPerformBuiltinAction = oldFn;

    return async function(action) {
      const sig = AP_externalActionSignature(action);

      if (sig && AP_isCooling(sig)) {
        AP_log("기존 action 차단. 반복 실패 cooldown: " + sig);
        return false;
      }

      if (
        action &&
        typeof action === "object" &&
        (action.type === "planner_goal" || action.action === "planner_goal")
      ) {
        AP_state.forcedGoal = action.goal || null;
        AP_state.activePlan = null;
        AP_saveState();
        AP_log("forced planner goal 설정: " + AP_safeText(AP_state.forcedGoal));
        return true;
      }

      return oldFn.apply(this, arguments);
    };
  });

  let AP_thinkWrapped = false;

  const thinkTargets = [
    "thinkAndAct",
    "selfDevThinkAndAct"
  ];

  for (const name of thinkTargets) {
    const wrapped = AP_wrapFunctionByName(name, function(oldFn, fnName) {
      return async function() {
        try {
          const didPlannerAct = await AP_plannerTick(fnName);
          if (didPlannerAct) return;
        } catch (err) {
          AP_log("planner tick 오류: " + AP_safeText(err.message || err));
        }

        return oldFn.apply(this, arguments);
      };
    });

    if (wrapped) AP_thinkWrapped = true;
  }

  if (!AP_thinkWrapped && process.env.ADAM_PLANNER_FALLBACK_LOOP !== "0") {
    AP_log("think wrapper를 못 찾아 fallback planner loop 사용");
    setInterval(function() {
      AP_plannerTick("fallback_loop").catch(function(err) {
        AP_log("fallback planner 오류: " + AP_safeText(err.message || err));
      });
    }, 6000);
  }

  globalThis.AdamPlanner = {
    version: AP_VERSION,
    stateFile: AP_STATE_FILE,
    status: function() {
      return {
        version: AP_VERSION,
        activeGoal: AP_state.activeGoal,
        activePlan: AP_state.activePlan,
        failures: AP_state.failures,
        config: AP_state.config
      };
    },
    clearCooldowns: function() {
      AP_state.failures = {};
      AP_saveState();
      return true;
    },
    forceGoal: function(goal) {
      if (typeof goal === "string") {
        goal = { type: "obtain_item", item: goal, count: 1 };
      }
      AP_state.forcedGoal = goal;
      AP_state.activePlan = null;
      AP_saveState();
      return goal;
    },
    clearForcedGoal: function() {
      AP_state.forcedGoal = null;
      AP_state.activePlan = null;
      AP_saveState();
      return true;
    },
    planFor: function(goal) {
      return AP_makePlan(goal);
    },
    tick: AP_plannerTick
  };

  AP_log("로드 완료. 목표 분해형 Planning Core 활성화. state=" + AP_STATE_FILE);
})();


// ════════════════════════════════════════════════════════════════════════
// [AUTONOMOUS GROWTH V1] 자율 성장 모듈
// - PSC의 '돌 확보' 전략처럼 특정 아이템 하나에만 붙어있던 학습 로직을
//   모든 native action에 범용으로 적용한다.
// - 행동별 성공/실패를 기록하고, 반복 실패하면:
//    1) patch_proposals에 제안서를 쓴다 (기존 방식, 사람이 검토용)
//    2) 그 교훈을 addMemory로 '[통찰]' 기억에도 남긴다 — 이게 핵심 차이.
//       예전엔 제안서 파일만 쌓이고 아무도 안 읽었지만, 이제는 GPT가
//       reflectAndPlan/의사결정 시 보는 기억 스트림에 직접 들어가서
//       "이 행동은 잘 안 통한다"는 걸 실제로 다음 판단에 반영한다.
// - 5분마다 가장 실패율 높은 행동 top3를 정기적으로 요약해 통찰로 저장한다.
// ════════════════════════════════════════════════════════════════════════
try {
  if (!globalThis.__ADAM_AUTO_GROWTH_V1__) {
    globalThis.__ADAM_AUTO_GROWTH_V1__ = true;

    const AG_STATS_FILE = (name) => `growth_stats_${name}.json`;
    const AG_WINDOW = 20;             // 행동별 최근 N회만 보고 판단
    const AG_FAIL_RATIO_ALERT = 0.7;  // 70% 이상 실패하면 경고
    const AG_MIN_SAMPLES = 6;         // 최소 이만큼 쌓여야 판단
    const AG_COOLDOWN_MS = 10 * 60 * 1000; // 같은 교훈 반복 저장 방지

    function AG_loadStats(name) {
      return loadJSON(AG_STATS_FILE(name), { actions: {}, lastDigestAt: 0 });
    }
    function AG_saveStats(name, stats) {
      try { saveJSON(AG_STATS_FILE(name), stats); }
      catch (e) { console.warn('⚠️ [AUTO-GROWTH] 통계 저장 실패:', e.message); }
    }
    function AG_keyFor(action, target) {
      return target && target !== 'null' ? `${action}:${target}` : action;
    }

    function AG_onRepeatedFailure(self, key, ratio, lastResult) {
      const pct = Math.round(ratio * 100);
      const lesson = `[통찰] '${key}' 행동이 최근 ${pct}% 실패했다 (마지막 이유: ${lastResult}). 같은 방식을 반복하지 말고 다른 접근을 시도해야 한다.`;

      console.warn(`🌱 [AUTO-GROWTH] 반복 실패 감지: ${key} (${pct}%)`);

      try {
        if (typeof addMemory === 'function') addMemory(self, lesson).catch(() => {});
      } catch (e) {}

      try {
        const dir = 'patch_proposals';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = String(self?.name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        const file = `${dir}/${stamp}_${safeName}_auto_growth_${safeKey}.md`;
        fs.writeFileSync(file,
          `# 자동 성장 관찰 - ${key}\n\n` +
          `- 최근 실패율: ${pct}%\n` +
          `- 마지막 실패 사유: ${lastResult}\n\n` +
          `## 제안\n` +
          `'${key}' 행동에 대해 대체 전략(다른 도구/경로/목표 분해)을 추가하거나, ` +
          `실패 사유를 더 세분화해 원인을 구분할 필요가 있다.\n`
        );
        console.log(`🌱 [AUTO-GROWTH] 패치 제안 기록: ${file}`);
      } catch (e) {
        console.warn('⚠️ [AUTO-GROWTH] 패치 제안 기록 실패:', e.message);
      }
    }

    function AG_record(self, action, target, ok, resultText) {
      if (!self || !self.name) return;
      const stats = AG_loadStats(self.name);
      const key = AG_keyFor(action, target);
      const rec = stats.actions[key] || { history: [], lastAlertAt: 0, lastResult: '' };

      rec.history.push(ok ? 1 : 0);
      if (rec.history.length > AG_WINDOW) rec.history.shift();
      rec.lastResult = __adamSafeTextForMemory(resultText).slice(0, 200);
      stats.actions[key] = rec;
      AG_saveStats(self.name, stats);

      if (!ok && rec.history.length >= AG_MIN_SAMPLES) {
        const failCount = rec.history.filter(v => v === 0).length;
        const ratio = failCount / rec.history.length;

        if (ratio >= AG_FAIL_RATIO_ALERT && Date.now() - (rec.lastAlertAt || 0) > AG_COOLDOWN_MS) {
          rec.lastAlertAt = Date.now();
          stats.actions[key] = rec;
          AG_saveStats(self.name, stats);
          AG_onRepeatedFailure(self, key, ratio, rec.lastResult);
        }
      }
    }

    // performBuiltinAction을 감싸서, 액션 종류에 상관없이 성공/실패를 자동 기록한다.
    if (typeof performBuiltinAction === 'function' && !performBuiltinAction.__agWrapped) {
      const AG_prevPerform = performBuiltinAction;
      const AG_wrappedPerform = async function (bot, self, action, target, label) {
        const result = await AG_prevPerform(bot, self, action, target, label);
        try {
          const ok = !looksLikeFailure(result);
          AG_record(self, action, target, ok, result);
        } catch (e) {
          console.warn('⚠️ [AUTO-GROWTH] 기록 오류:', e.message);
        }
        return result;
      };
      AG_wrappedPerform.__agWrapped = true;
      performBuiltinAction = AG_wrappedPerform;
      console.log('🌱 [AUTO-GROWTH] performBuiltinAction 성과 기록 래퍼 설치 완료');
    }

    // 주기적 요약: 가장 약한(실패율 높은) 행동 top3를 통찰로 압축해 저장한다.
    setInterval(() => {
      try {
        const self = globalThis.__ADAM_LAST_SELF__;
        if (!self || !self.name) return;

        const stats = AG_loadStats(self.name);
        if (Date.now() - (stats.lastDigestAt || 0) < 20 * 60 * 1000) return;

        const entries = Object.entries(stats.actions || {});
        if (!entries.length) return;

        const ranked = entries
          .map(([key, rec]) => {
            const total = rec.history.length;
            const fails = rec.history.filter(v => v === 0).length;
            return { key, total, failRatio: total ? fails / total : 0 };
          })
          .filter(e => e.total >= AG_MIN_SAMPLES && e.failRatio > 0)
          .sort((a, b) => b.failRatio - a.failRatio)
          .slice(0, 3);

        if (ranked.length) {
          const summary = ranked.map(e => `${e.key}(실패율 ${Math.round(e.failRatio * 100)}%)`).join(', ');
          const digest = `[통찰] 최근 가장 약한 행동들: ${summary}. 이 부분을 개선하거나 대체 전략을 준비하자.`;
          if (typeof addMemory === 'function') addMemory(self, digest).catch(() => {});
          console.log(`🌱 [AUTO-GROWTH] 정기 성장 요약 저장: ${summary}`);
        }

        stats.lastDigestAt = Date.now();
        AG_saveStats(self.name, stats);
      } catch (e) {
        console.warn('⚠️ [AUTO-GROWTH] 정기 요약 오류:', e.message);
      }
    }, 5 * 60 * 1000);

    console.log('🌱 [AUTO-GROWTH V1] 자율 성장(행동별 성과 기록 + 실패 학습 + 정기 요약) 로드 완료');
  }
} catch (err) {
  console.warn('⚠️ [AUTO-GROWTH V1] 설치 실패:', err && err.message ? err.message : err);
}


/* __ADAM_LONG_TERM_MEMORY_BOOTSTRAP_V1__ */
(function ADAM_LONG_TERM_MEMORY_BOOTSTRAP_V1() {
  if (globalThis.__ADAM_LONG_TERM_MEMORY_BOOTSTRAPPED__) return;
  globalThis.__ADAM_LONG_TERM_MEMORY_BOOTSTRAPPED__ = true;

  try {
    const memoryCore = require("./adam_memory_core.cjs");

    memoryCore.install({
      getBot: function() {
        try {
          if (typeof bot !== "undefined" && bot) return bot;
        } catch (_) {}

        try {
          if (globalThis.bot) return globalThis.bot;
        } catch (_) {}

        return null;
      },

      getMcData: function() {
        try {
          if (typeof mcData !== "undefined" && mcData) return mcData;
        } catch (_) {}

        try {
          const b = (typeof bot !== "undefined" && bot) ? bot : globalThis.bot;
          if (b && b.version) return require("minecraft-data")(b.version);
        } catch (_) {}

        return null;
      },

      evalInCitizen: function(code, value) {
        return eval(code);
      }
    });
  } catch (err) {
    console.error("❌ [MEMORY V1] bootstrap 실패:", err && err.stack ? err.stack : err);
  }
})();



/* __ADAM_PRIORITY_CORE_V1__ */
(function ADAM_PRIORITY_CORE_V1() {
  if (globalThis.__ADAM_PRIORITY_CORE_V1_INSTALLED__) return;
  globalThis.__ADAM_PRIORITY_CORE_V1_INSTALLED__ = true;

  const fs = require('fs');
  const path = require('path');

  const PC_VERSION = '1.0.0';
  const PC_STATE_FILE = path.join(process.cwd(), 'priority_Adam.json');

  function PC_log(msg) {
    console.log('🧭 [PRIORITY V1] ' + msg);
  }

  function PC_safeText(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try {
      if (value instanceof Error) return value.stack || value.message || String(value);
    } catch {}
    try {
      return JSON.stringify(value);
    } catch {
      try { return String(value); } catch { return ''; }
    }
  }

  function PC_sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function PC_now() {
    return Date.now();
  }

  function PC_readJSON(file, fallback) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
  }

  function PC_writeJSON(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('⚠️ [PRIORITY V1] JSON 저장 실패:', file, e.message);
    }
  }

  function PC_loadState() {
    return PC_readJSON(PC_STATE_FILE, {
      version: PC_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cooldowns: {},
      lastLogAt: {},
      decisions: []
    });
  }

  function PC_saveState(st) {
    st.version = PC_VERSION;
    st.updatedAt = new Date().toISOString();
    PC_writeJSON(PC_STATE_FILE, st);
  }

  let PC_state = PC_loadState();

  function PC_attach(bot, self) {
    try {
      if (bot) {
        globalThis.bot = bot;
        globalThis.__ADAM_LAST_BOT__ = bot;
        if (bot.version) {
          try { globalThis.mcData = require('minecraft-data')(bot.version); } catch {}
        }
      }

      if (self) {
        globalThis.self = self;
        globalThis.__ADAM_LAST_SELF__ = self;
        self.state = self.state || {};
        self.state.priorityCore = self.state.priorityCore || {};
        if (!self.__priorityCoreFirstSeenAt) self.__priorityCoreFirstSeenAt = Date.now();
      }
    } catch {}
  }

  function PC_getBot(botArg) {
    return botArg || globalThis.__ADAM_LAST_BOT__ || globalThis.bot || null;
  }

  function PC_getSelf(selfArg) {
    return selfArg || globalThis.__ADAM_LAST_SELF__ || globalThis.self || null;
  }

  function PC_botUsable(bot, self) {
    if (!bot) return false;
    if (self && self.isAlive === false) return false;
    if (!bot.entity || !bot.entity.position) return false;
    if (!bot.inventory || typeof bot.inventory.items !== 'function') return false;
    if (!bot.pathfinder) return false;

    try {
      if (bot._client && bot._client.socket && bot._client.socket.destroyed) return false;
      if (bot._client && bot._client.ended) return false;
    } catch {}

    return true;
  }

  function PC_spawnStable(bot, self) {
    if (!PC_botUsable(bot, self)) return false;

    const first = self && self.__priorityCoreFirstSeenAt ? self.__priorityCoreFirstSeenAt : 0;
    if (first && Date.now() - first < 2500) return false;

    return true;
  }

  function PC_items(bot) {
    try { return bot.inventory.items() || []; } catch { return []; }
  }

  function PC_count(bot, pred) {
    return PC_items(bot)
      .filter(i => typeof pred === 'string' ? i.name === pred : pred(i))
      .reduce((a, i) => a + (i.count || 0), 0);
  }

  function PC_hasFood(bot) {
    return !!PC_bestFood(bot, true);
  }

  const PC_FOOD_SCORE = {
    enchanted_golden_apple: 130,
    golden_apple: 120,
    cooked_beef: 100,
    cooked_porkchop: 98,
    rabbit_stew: 96,
    golden_carrot: 95,
    cooked_mutton: 92,
    cooked_chicken: 90,
    cooked_salmon: 88,
    cooked_cod: 86,
    bread: 80,
    baked_potato: 76,
    pumpkin_pie: 74,
    mushroom_stew: 70,
    beetroot_soup: 68,
    apple: 58,
    beef: 55,
    porkchop: 55,
    mutton: 52,
    rabbit: 45,
    chicken: 42,
    salmon: 40,
    cod: 38,
    carrot: 35,
    beetroot: 30,
    sweet_berries: 28,
    glow_berries: 28,
    melon_slice: 25,
    potato: 18,
    rotten_flesh: 2
  };

  const PC_BAD_FOOD = new Set(['poisonous_potato', 'pufferfish', 'spider_eye']);
  const PC_RISKY_FOOD = new Set(['rotten_flesh']);

  function PC_foodScore(item) {
    if (!item || !item.name) return 0;
    if (PC_BAD_FOOD.has(item.name)) return -999;
    if (Object.prototype.hasOwnProperty.call(PC_FOOD_SCORE, item.name)) return PC_FOOD_SCORE[item.name];
    if (/apple|bread|carrot|potato|beetroot|beef|porkchop|chicken|mutton|rabbit|cod|salmon|berries|melon|stew|soup|pie|cookie/.test(item.name)) return 30;
    return 0;
  }

  function PC_bestFood(bot, allowRisky) {
    return PC_items(bot)
      .filter(i => PC_foodScore(i) > 0)
      .filter(i => allowRisky || !PC_RISKY_FOOD.has(i.name))
      .sort((a, b) => PC_foodScore(b) - PC_foodScore(a))[0] || null;
  }

  async function PC_eatBest(bot, self, targetFood, allowRisky) {
    if (!PC_botUsable(bot, self)) return '아직 먹을 수 있는 상태가 아니다.';
    if (typeof bot.food === 'number' && bot.food >= targetFood) {
      return '허기가 이미 충분하다.';
    }

    const food = PC_bestFood(bot, allowRisky || bot.food <= 6);
    if (!food) return '가방에 먹을 것이 없다.';

    try {
      try { bot.pathfinder.setGoal(null); } catch {}
      try { bot.clearControlStates && bot.clearControlStates(); } catch {}

      await bot.equip(food, 'hand');
      await bot.consume();
      await PC_sleep(350);

      return food.name + '을 먹었다. 현재 허기 ' + bot.food + '/20.';
    } catch (e) {
      return food.name + '을 먹으려 했지만 실패했다: ' + e.message;
    }
  }

  const PC_HOSTILES = new Set([
    'zombie','husk','drowned','skeleton','stray','creeper','spider','cave_spider',
    'witch','phantom','slime','magma_cube','pillager','vindicator','evoker','ravager',
    'enderman','blaze','ghast','hoglin','zoglin','piglin_brute','guardian','elder_guardian','warden'
  ]);

  const PC_PASSIVES = new Set(['cow','pig','sheep','chicken','rabbit','cod','salmon','mooshroom','mushroom_cow']);

  function PC_entityName(e) {
    return String((e && (e.name || e.displayName || e.mobType)) || '').toLowerCase().replace(/\s+/g, '_');
  }

  function PC_nearestHostile(bot, radius) {
    if (!bot || !bot.entity || !bot.entities) return null;
    const pos = bot.entity.position;

    let best = null;
    let bestD = Infinity;

    for (const e of Object.values(bot.entities)) {
      if (!e || !e.position || e === bot.entity) continue;
      const name = PC_entityName(e);
      if (!PC_HOSTILES.has(name)) continue;
      let d = Infinity;
      try { d = pos.distanceTo(e.position); } catch {}
      if (d <= radius && d < bestD) {
        best = e;
        bestD = d;
      }
    }

    return best ? { entity: best, name: PC_entityName(best), distance: bestD } : null;
  }

  function PC_nearestPassive(bot, radius) {
    if (!bot || !bot.entity || !bot.entities) return null;
    const pos = bot.entity.position;

    let best = null;
    let bestD = Infinity;

    for (const e of Object.values(bot.entities)) {
      if (!e || !e.position || e === bot.entity) continue;
      const name = PC_entityName(e);
      if (!PC_PASSIVES.has(name)) continue;
      let d = Infinity;
      try { d = pos.distanceTo(e.position); } catch {}
      if (d <= radius && d < bestD) {
        best = e;
        bestD = d;
      }
    }

    return best ? { entity: best, name: PC_entityName(best), distance: bestD } : null;
  }

  function PC_taskSig(task) {
    if (!task) return 'none';
    const a = String(task.action || task.type || '').toLowerCase();
    const t = String(task.target || task.item || '').toLowerCase();

    if (a === 'mine' && /stone|cobble|돌|조약돌/.test(t)) return 'mine:stone';
    if (a === 'craft_item') return 'craft:' + t;
    if (a === 'gather_wood') return 'gather:wood';

    return a + ':' + (t || 'none');
  }

  function PC_isMineStoneTask(task) {
    return PC_taskSig(task) === 'mine:stone';
  }

  function PC_externalMineStoneCooldown() {
    const solverFiles = [
      path.join(process.cwd(), 'problem_solver_Adam.json'),
      path.join(process.cwd(), 'planner_Adam.json')
    ];

    const now = Date.now();

    for (const f of solverFiles) {
      const j = PC_readJSON(f, null);
      if (!j) continue;

      try {
        const c = j.loop && j.loop.cooldowns && j.loop.cooldowns['mine:stone'];
        if (c && Number(c.until || 0) > now) return true;
      } catch {}

      try {
        const c2 = j.failures && (j.failures['obtain:cobblestone'] || j.failures['mine:stone']);
        if (c2 && Number(c2.cooldownUntil || 0) > now) return true;
      } catch {}
    }

    return false;
  }

  function PC_setCooldown(key, ms, reason) {
    PC_state.cooldowns[key] = {
      until: Date.now() + ms,
      reason: reason || 'cooldown',
      at: new Date().toISOString()
    };
    PC_saveState(PC_state);
  }

  function PC_isCooling(key) {
    const c = PC_state.cooldowns[key];
    return !!(c && Number(c.until || 0) > Date.now());
  }

  function PC_rememberDecision(self, text) {
    try {
      PC_state.decisions.push({
        at: new Date().toISOString(),
        text: PC_safeText(text).slice(0, 500)
      });
      if (PC_state.decisions.length > 80) PC_state.decisions = PC_state.decisions.slice(-80);
      PC_saveState(PC_state);
    } catch {}

    try {
      if (typeof addMemory === 'function' && self) addMemory(self, '[우선순위] ' + text).catch(() => {});
    } catch {}
  }

  function PC_clearQueue(self, reason, cooldownMs) {
    if (!self || !self.state) return false;

    try {
      if (Array.isArray(self.state.taskQueue) && self.state.taskQueue.length) {
        const old = self.state.taskQueue.map(t => PC_taskSig(t)).join(' → ');
        self.state.taskQueue = [];
        self.state.taskQueueMeta = {
          goalName: null,
          clearedBy: 'priority_core_v1',
          reason: reason || 'priority',
          old,
          at: new Date().toISOString()
        };

        if (typeof saveJSON === 'function') saveJSON('state_' + self.name + '.json', self.state);

        if (cooldownMs) PC_setCooldown('tech_injection', cooldownMs, reason);

        PC_log('큐 제거: ' + old + ' / 이유=' + reason);
        PC_rememberDecision(self, '기술 큐를 잠시 비웠다. 이유: ' + reason + '. 이전 큐: ' + old);
        return true;
      }
    } catch {}

    return false;
  }

  function PC_inventoryShortage(bot) {
    const food = PC_items(bot).filter(i => PC_foodScore(i) > 0 && !PC_RISKY_FOOD.has(i.name)).reduce((a, i) => a + i.count, 0);
    const logs = PC_count(bot, i => /_(log|wood)$/.test(i.name) && !i.name.startsWith('stripped_'));
    const stone = PC_count(bot, i => ['cobblestone','cobbled_deepslate','blackstone'].includes(i.name));
    const fuel = PC_count(bot, i => ['coal','charcoal'].includes(i.name));

    const out = [];
    if (food < 2) out.push('food');
    if (logs < 4) out.push('wood');
    if (stone < 8) out.push('stone');
    if (fuel < 2) out.push('fuel');
    return out;
  }

  function PC_computeNeed(botArg, selfArg) {
    const bot = PC_getBot(botArg);
    const self = PC_getSelf(selfArg);
    PC_attach(bot, self);

    if (!PC_botUsable(bot, self)) {
      return {
        level: 'BOOT',
        score: 1000,
        action: 'wait_ready',
        takeover: true,
        blockTech: true,
        reason: 'bot/entity/inventory/pathfinder 준비 대기'
      };
    }

    if (!PC_spawnStable(bot, self)) {
      return {
        level: 'BOOT',
        score: 990,
        action: 'wait_ready',
        takeover: true,
        blockTech: true,
        reason: '스폰 직후 안정화 대기'
      };
    }

    const health = Number(bot.health ?? 20);
    const food = Number(bot.food ?? 20);
    const hostileClose = PC_nearestHostile(bot, 7);
    const hostileFar = PC_nearestHostile(bot, 12);
    const queued = self && self.state && Array.isArray(self.state.taskQueue) ? self.state.taskQueue[0] : null;
    const queuedSig = PC_taskSig(queued);
    const hasFood = PC_hasFood(bot);

    if (hostileClose) {
      return {
        level: 'EMERGENCY',
        score: 960,
        action: 'danger_wait',
        takeover: true,
        blockTech: true,
        clearQueue: true,
        reason: hostileClose.name + ' 근접(' + Math.round(hostileClose.distance) + '블록)'
      };
    }

    if (health <= 6 && food < 18) {
      return {
        level: 'CRITICAL',
        score: hasFood ? 940 : 930,
        action: hasFood ? 'eat_for_regen' : 'find_food_for_regen',
        takeover: true,
        blockTech: true,
        clearQueue: true,
        reason: '체력 위기인데 허기 ' + food + '/20이라 자연회복 불가'
      };
    }

    if (food <= 6) {
      return {
        level: 'URGENT',
        score: hasFood ? 910 : 900,
        action: hasFood ? 'eat' : 'find_food',
        takeover: true,
        blockTech: true,
        clearQueue: true,
        reason: '굶주림: 허기 ' + food + '/20'
      };
    }

    if (health < 20 && food < 18) {
      return {
        level: 'HIGH',
        score: hasFood ? 820 : 790,
        action: hasFood ? 'eat_for_regen' : 'find_food_for_regen',
        takeover: true,
        blockTech: true,
        clearQueue: health <= 12,
        reason: '체력 회복을 원하지만 허기 ' + food + '/20이라 회복 효율이 낮음'
      };
    }

    if (PC_isMineStoneTask(queued) && (PC_externalMineStoneCooldown() || PC_isCooling('mine:stone'))) {
      return {
        level: 'HIGH',
        score: 760,
        action: 'clear_blocked_queue',
        takeover: true,
        blockTech: true,
        clearQueue: true,
        reason: 'mine(stone)이 쿨다운 중인데 기술 큐가 같은 행동을 반복하려 함'
      };
    }

    if (PC_isCooling('tech_injection')) {
      return {
        level: 'HIGH',
        score: 700,
        action: 'tech_backoff',
        takeover: false,
        blockTech: true,
        reason: '최근 기술 큐가 실패해서 잠시 자유 판단 우선'
      };
    }

    if (hostileFar && health <= 12) {
      return {
        level: 'HIGH',
        score: 690,
        action: 'danger_wait',
        takeover: true,
        blockTech: true,
        clearQueue: true,
        reason: '체력이 낮은데 ' + hostileFar.name + '가 근처에 있음'
      };
    }

    if (!hasFood && food < 14) {
      return {
        level: 'HIGH',
        score: 670,
        action: 'find_food',
        takeover: true,
        blockTech: true,
        clearQueue: false,
        reason: '음식 재고 없음 + 허기 감소 중'
      };
    }

    if (health < 20 && food >= 18) {
      return {
        level: 'RECOVER',
        score: 620,
        action: 'efficient_rest',
        takeover: health <= 14,
        blockTech: health <= 14,
        clearQueue: false,
        reason: '허기가 충분하므로 짧은 자연회복 대기 가능'
      };
    }

    const shortages = PC_inventoryShortage(bot);
    if (shortages.includes('food') && food < 18) {
      return {
        level: 'HIGH',
        score: 590,
        action: 'find_food',
        takeover: false,
        blockTech: false,
        reason: '음식 재고 부족'
      };
    }

    return {
      level: 'NORMAL',
      score: 100,
      action: 'normal',
      takeover: false,
      blockTech: false,
      reason: '기술/탐험/건설 진행 가능'
    };
  }

  let PC_prevPerformRef = null;

  async function PC_callPrevPerform(bot, self, action, target, label) {
    if (typeof PC_prevPerformRef === 'function') {
      return await PC_prevPerformRef.call(null, bot, self, action, target, label);
    }
    return 'performBuiltinAction 원본을 찾지 못했다.';
  }

  async function PC_findFoodAction(bot, self, reason) {
    if (!PC_botUsable(bot, self)) return '아직 음식 확보 행동을 할 수 있는 상태가 아니다.';

    const eaten = await PC_eatBest(bot, self, 18, bot.health <= 6 || bot.food <= 6);
    if (!/가방에 먹을 것이 없다|이미 충분/.test(eaten)) return eaten;

    try {
      const drops = Object.values(bot.entities || {}).filter(e => {
        if (!e || !e.position) return false;
        const name = PC_entityName(e);
        const type = String(e.type || '').toLowerCase();
        return (name === 'item' || name === 'dropped_item' || type === 'object') &&
          bot.entity.position.distanceTo(e.position) <= 10;
      });

      if (drops.length && typeof PC_prevPerformRef === 'function') {
        const r = await PC_callPrevPerform(bot, self, 'collect_drops', null, null);
        const eaten2 = await PC_eatBest(bot, self, 18, bot.health <= 6 || bot.food <= 6);
        return '[음식우선] 드랍 회수 시도: ' + r + ' / ' + eaten2;
      }
    } catch {}

    const animal = PC_nearestPassive(bot, 28);
    const hostile = PC_nearestHostile(bot, 9);

    if (animal && !hostile) {
      const r = await PC_callPrevPerform(bot, self, 'hunt', null, null);
      const eaten3 = await PC_eatBest(bot, self, 18, true);
      return '[음식우선] ' + animal.name + ' 사냥 시도: ' + r + ' / ' + eaten3;
    }

    if (bot.health > 8 && !hostile) {
      try {
        const p = bot.entity.position;
        bot.pathfinder.setGoal(new goals.GoalXZ(
          p.x + (Math.random() - 0.5) * 36,
          p.z + (Math.random() - 0.5) * 36
        ));
        return '[음식우선] 먹을 것이 없어 동물/식량을 찾으러 짧게 이동한다. 이유: ' + reason;
      } catch (e) {
        return '[음식우선] 식량 탐색 이동 실패: ' + e.message;
      }
    }

    return '[음식우선] 먹을 것이 없고 이동도 위험하다. 회복 대기는 하지 않고 주변 위험이 줄 때까지 짧게 대기한다.';
  }

  async function PC_smartRest(bot, self) {
    if (!PC_botUsable(bot, self)) return '아직 쉴 수 있는 상태가 아니다.';

    const health = Number(bot.health ?? 20);
    const food = Number(bot.food ?? 20);

    if (health >= 20) return '체력이 이미 충분하다. 굳이 오래 쉴 필요가 없다.';

    if (food < 18) {
      if (PC_hasFood(bot)) {
        const eaten = await PC_eatBest(bot, self, 18, health <= 6 || food <= 6);
        return '체력 회복 전 허기 보충: ' + eaten;
      }

      return await PC_findFoodAction(bot, self, '허기 ' + food + '/20이라 쉬어도 체력이 회복되지 않음');
    }

    const hostile = PC_nearestHostile(bot, 10);
    if (hostile) {
      return '근처에 ' + hostile.name + '가 있어 회복 대기보다 안전 확보가 먼저다.';
    }

    try {
      bot.pathfinder.setGoal(null);
      if (bot.clearControlStates) bot.clearControlStates();
    } catch {}

    const before = bot.health;
    await PC_sleep(4500);

    return '허기 ' + bot.food + '/20 상태라 짧게 쉬었다. 체력 ' + before + ' → ' + bot.health + '/20.';
  }

  async function PC_executeNeed(bot, self, need) {
    if (!need || !need.action || need.action === 'normal') return null;

    if (need.clearQueue) {
      PC_clearQueue(self, need.reason, need.action === 'clear_blocked_queue' ? 120000 : 45000);
    }

    if (need.action === 'wait_ready') {
      return '[준비대기] ' + need.reason;
    }

    if (need.action === 'danger_wait') {
      try {
        bot.pathfinder && bot.pathfinder.setGoal(null);
        bot.clearControlStates && bot.clearControlStates();
      } catch {}
      return '[안전우선] ' + need.reason + '. 기존 작업은 잠시 멈추고 반사/전투 루프가 처리하게 한다.';
    }

    if (need.action === 'eat' || need.action === 'eat_for_regen') {
      return await PC_eatBest(bot, self, need.action === 'eat_for_regen' ? 18 : 14, bot.health <= 6 || bot.food <= 6);
    }

    if (need.action === 'find_food' || need.action === 'find_food_for_regen') {
      return await PC_findFoodAction(bot, self, need.reason);
    }

    if (need.action === 'efficient_rest') {
      return await PC_smartRest(bot, self);
    }

    if (need.action === 'clear_blocked_queue') {
      PC_setCooldown('mine:stone', 120000, need.reason);
      PC_setCooldown('tech_injection', 120000, need.reason);
      return '[큐차단] ' + need.reason + '. 기술 큐를 비우고 잠시 다른 판단을 우선한다.';
    }

    if (need.action === 'tech_backoff') {
      return null;
    }

    return null;
  }

  function PC_normalizePerformArgs(botArg, selfArg, actionArg, targetArg, labelArg) {
    let realBot =
      botArg && botArg.entity && botArg.inventory
        ? botArg
        : PC_getBot(null);

    let realSelf =
      selfArg && selfArg.name
        ? selfArg
        : PC_getSelf(null);

    let action = actionArg;
    let target = targetArg;
    let label = labelArg;

    if (
      (!actionArg || typeof actionArg === 'undefined') &&
      botArg &&
      typeof botArg === 'object' &&
      !(botArg.entity && botArg.inventory)
    ) {
      const obj = botArg;
      action = obj.action || obj.type || obj.name || obj.skill || '';
      target = obj.target || obj.item || obj.block || obj.resource || obj.goal || targetArg || null;
      label = obj.label || obj.poi || labelArg || null;
    }

    return { bot: realBot, self: realSelf, action, target, label };
  }

  // addMemory 최종 호환 레이어.
  // 이전 wrapper들이 self를 문자열화해서 기존 기억 저장이 계속 실패하던 문제를 여기서 끝낸다.
  try {
    const PC_oldAddMemory = typeof addMemory === 'function' ? addMemory : null;

    addMemory = async function priorityCompatibleAddMemory(a, b) {
      let self = null;
      let description = null;

      if (a && typeof a === 'object' && Array.isArray(a.memories)) {
        self = a;
        description = b;
      } else {
        self = PC_getSelf(null);
        description = a;
      }

      description = PC_safeText(description);

      try {
        if (globalThis.AdamMemory && typeof globalThis.AdamMemory.rememberEvent === 'function') {
          globalThis.AdamMemory.rememberEvent('legacy_memory', description, {
            source: 'priority_compatible_addMemory',
            hasSelf: !!self
          }, 0.5);
        }
      } catch {}

      if (!self || !Array.isArray(self.memories)) {
        console.warn('⚠️ [MEMORY COMPAT] self가 없어 legacy memory는 생략, 장기기억에는 저장 시도: ' + description.slice(0, 90));
        return null;
      }

      let embedding = null;
      try {
        if (typeof getEmbedding === 'function') embedding = await getEmbedding(description);
      } catch {}

      let importance = 5;
      try {
        if (typeof estimateImportanceHeuristic === 'function') {
          importance = estimateImportanceHeuristic(description);
        }
      } catch {}

      const entry = {
        id: Date.now() + Math.random(),
        description,
        importance,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        embedding
      };

      self.memories.push(entry);
      if (self.memories.length > 300) self.memories.shift();

      try {
        if (typeof saveJSON === 'function') saveJSON('memories_' + self.name + '.json', self.memories);
      } catch {}

      console.log('🧠 [기억:COMPAT] (중요도 ' + importance + ') ' + description.slice(0, 160));
      return entry;
    };

    addMemory.__priorityCompatible = true;
    PC_log('addMemory self-signature 호환 레이어 설치 완료');
  } catch (e) {
    console.warn('⚠️ [PRIORITY V1] addMemory 호환 레이어 실패:', e.message);
  }

  try {
    const PC_prevComputePriority = typeof computePriority === 'function' ? computePriority : null;

    computePriority = function priorityComputePriority(bot, self) {
      PC_attach(bot, self);
      const need = PC_computeNeed(bot, self);

      return {
        level: need.level,
        reason: need.reason,
        score: need.score,
        action: need.action,
        blockTech: !!need.blockTech
      };
    };

    computePriority.__priorityCore = true;
    PC_log('computePriority 교체 완료');
  } catch (e) {
    console.warn('⚠️ [PRIORITY V1] computePriority 교체 실패:', e.message);
  }

  try {
    if (typeof maybeInjectTechTasks === 'function' && !maybeInjectTechTasks.__priorityWrapped) {
      const PC_prevMaybeInjectTechTasks = maybeInjectTechTasks;

      maybeInjectTechTasks = function priorityMaybeInjectTechTasks(bot, self) {
        PC_attach(bot, self);

        const need = PC_computeNeed(bot, self);

        if (need.blockTech || PC_isCooling('tech_injection')) {
          if (!PC_state.lastLogAt.techBlock || Date.now() - PC_state.lastLogAt.techBlock > 8000) {
            PC_state.lastLogAt.techBlock = Date.now();
            PC_saveState(PC_state);
            PC_log('기술 큐 주입 보류: ' + need.reason);
          }
          return;
        }

        if (PC_externalMineStoneCooldown()) {
          PC_setCooldown('tech_injection', 120000, 'external mine:stone cooldown');
          PC_log('mine(stone) 외부 쿨다운 감지 → 기술 큐 주입 2분 보류');
          return;
        }

        return PC_prevMaybeInjectTechTasks(bot, self);
      };

      maybeInjectTechTasks.__priorityWrapped = true;
      PC_log('maybeInjectTechTasks 우선순위 wrapper 설치 완료');
    }
  } catch (e) {
    console.warn('⚠️ [PRIORITY V1] maybeInjectTechTasks wrapper 실패:', e.message);
  }

  try {
    if (typeof performBuiltinAction === 'function' && !performBuiltinAction.__priorityWrapped) {
      const PC_prevPerform = performBuiltinAction;
      PC_prevPerformRef = PC_prevPerform;

      performBuiltinAction = async function priorityPerformBuiltinAction(botArg, selfArg, actionArg, targetArg, labelArg) {
        const n = PC_normalizePerformArgs(botArg, selfArg, actionArg, targetArg, labelArg);
        PC_attach(n.bot, n.self);

        const action = String(n.action || '').toLowerCase();

        if (!PC_botUsable(n.bot, n.self)) {
          return '[준비대기] bot not ready: 행동을 실패로 세지 않고 기다린다.';
        }

        if (action === 'rest') {
          return await PC_smartRest(n.bot, n.self);
        }

        const need = PC_computeNeed(n.bot, n.self);

        const survivalAllowed = new Set([
          'eat',
          'hunt',
          'collect_drops',
          'go_home',
          'check_status',
          'self_review',
          'follow'
        ]);

        if (need.takeover && !survivalAllowed.has(action)) {
          const handled = await PC_executeNeed(n.bot, n.self, need);
          if (handled) {
            PC_rememberDecision(n.self, handled);
            return '[우선순위 개입] ' + handled;
          }
        }

        return await PC_prevPerform.call(this, n.bot, n.self, n.action, n.target, n.label);
      };

      performBuiltinAction.__priorityWrapped = true;
      PC_log('performBuiltinAction 우선순위 wrapper 설치 완료');
    }
  } catch (e) {
    console.warn('⚠️ [PRIORITY V1] performBuiltinAction wrapper 실패:', e.message);
  }

  try {
    if (typeof thinkAndAct === 'function' && !thinkAndAct.__priorityWrapped) {
      const PC_prevThinkAndAct = thinkAndAct;

      thinkAndAct = async function priorityThinkAndAct(bot, self) {
        PC_attach(bot, self);

        const need = PC_computeNeed(bot, self);

        if (!PC_state.lastLogAt.need || Date.now() - PC_state.lastLogAt.need > 8000) {
          PC_state.lastLogAt.need = Date.now();
          PC_saveState(PC_state);
          PC_log('최우선 판단: ' + need.level + ' / ' + need.reason + ' / action=' + need.action);
        }

        if (need.clearQueue) {
          PC_clearQueue(self, need.reason, need.action === 'clear_blocked_queue' ? 120000 : 45000);
        }

        if (need.takeover) {
          const handled = await PC_executeNeed(bot, self, need);

          if (handled) {
            if (self) self.lastActionResult = '[우선순위] ' + handled;
            PC_rememberDecision(self, handled);
            return true;
          }
        }

        return await PC_prevThinkAndAct.apply(this, arguments);
      };

      thinkAndAct.__priorityWrapped = true;
      PC_log('thinkAndAct 우선순위 wrapper 설치 완료');
    }
  } catch (e) {
    console.warn('⚠️ [PRIORITY V1] thinkAndAct wrapper 실패:', e.message);
  }

  try {
    if (!globalThis.__ADAM_PRIORITY_EPIPE_HANDLER__) {
      globalThis.__ADAM_PRIORITY_EPIPE_HANDLER__ = true;

      process.on('uncaughtException', function(err) {
        if (err && err.code === 'EPIPE') {
          console.warn('⚠️ [PRIORITY V1] EPIPE 감지: 서버 연결이 끊어진 상태라 남은 작업을 중단한다.');
          try {
            const self = PC_getSelf(null);
            if (self) self.isAlive = false;
          } catch {}
          return;
        }

        throw err;
      });
    }
  } catch {}

  globalThis.AdamPriority = {
    version: PC_VERSION,
    status: function() {
      const bot = PC_getBot(null);
      const self = PC_getSelf(null);
      return {
        version: PC_VERSION,
        need: PC_computeNeed(bot, self),
        state: PC_state
      };
    },
    clearCooldowns: function() {
      PC_state.cooldowns = {};
      PC_saveState(PC_state);
      return true;
    },
    smartRest: PC_smartRest
  };

  PC_log('로드 완료. 큐보다 생존/회복/쿨다운 판단을 우선한다.');
})();


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






/* __ADAM_PIANO_V36_EXPORT_BRIDGE__ */
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
