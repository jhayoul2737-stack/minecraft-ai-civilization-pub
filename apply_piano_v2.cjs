const fs = require('fs');
const path = require('path');

const file = process.argv[2] || 'citizen_8730.cjs';

if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(1);
}

fs.mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join('backups', path.basename(file) + '.bak-piano-v2-' + stamp);
fs.copyFileSync(file, backup);

let src = fs.readFileSync(file, 'utf8');

// 사용자가 대화 내용을 파일 맨 아래에 붙여넣은 경우 JS 문법이 깨지므로 제거.
const proseMarker = '\n4. 자유도를 높이는 명령';
const proseIdx = src.indexOf(proseMarker);
if (proseIdx !== -1) {
  src = src.slice(0, proseIdx).trimEnd() + '\n';
}

// 중앙 판단 모델을 mini에서 기본 gpt-4o로 올림. 더 좋은 모델 쓰고 싶으면 .env에서 ADAM_COGNITION_MODEL 지정.
src = src.replace(
  /const\s+MAIN_MODEL\s*=\s*['"`]gpt-4o-mini['"`]\s*;/,
  "const MAIN_MODEL = process.env.ADAM_MAIN_MODEL || 'gpt-4o';"
);

src = src.replace(
  /const\s+DEEP_MODEL\s*=\s*['"`]gpt-4o['"`]\s*;/,
  "const DEEP_MODEL = process.env.ADAM_DEEP_MODEL || 'gpt-4o';"
);

if (!/const\s+COGNITION_MODEL\b/.test(src)) {
  src = src.replace(
    /(const\s+DEEP_MODEL[^\n]*\n)/,
    "$1const COGNITION_MODEL = process.env.ADAM_COGNITION_MODEL || MAIN_MODEL;\n"
  );
}

const patch = String.raw`

/* __ADAM_PIANO_CORE_V2__ */
(function ADAM_PIANO_CORE_V2() {
  if (globalThis.__ADAM_PIANO_CORE_V2_INSTALLED__) return;
  globalThis.__ADAM_PIANO_CORE_V2_INSTALLED__ = true;

  const fs = require('fs');
  const path = require('path');

  const P_VERSION = '2.0.0';
  const P_STATE_FILE = path.join(process.cwd(), 'piano_Adam.json');

  const P_RUNTIME = {
    busy: false,
    saveAt: 0,
    intervals: []
  };

  function P_log(msg) {
    console.log('🎼 [PIANO V2] ' + msg);
  }

  function P_safe(value) {
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

  function P_sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function P_loadJSON(file, fallback) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
  }

  function P_saveJSON(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('⚠️ [PIANO V2] 저장 실패:', e.message);
    }
  }

  function P_defaultState() {
    return {
      version: P_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // 모드가 아니라 공유 워킹메모리.
      working: {
        perception: {},
        needs: {},
        pressures: {},
        affordances: [],
        future: [],
        memories: [],
        queue: [],
        social: [],
        observations: [],
        surprises: []
      },

      self: {
        mood: '차분함',
        desire: '내가 처한 상황을 이해하고 쓸모 있게 움직이고 싶다',
        attention: '주변과 몸 상태',
        lastThought: '',
        lastDecisionReason: '',
        confidence: 0.5,
        speechPreference: 'situational'
      },

      timing: {
        lastPerceptionAt: 0,
        lastNeedsAt: 0,
        lastAffordanceAt: 0,
        lastMemoryAt: 0,
        lastExecutiveAt: 0,
        nextExecutiveAt: 0,
        lastActionAt: 0,
        forcedExecutiveUntil: 0,
        lastOldCommandReplyAt: 0
      },

      stats: {
        executiveCalls: 0,
        actionsTaken: 0,
        queueFollowed: 0,
        queueAdapted: 0,
        queueDeferred: 0,
        socialRequestsAbsorbed: 0
      },

      config: {
        executiveMinIntervalMs: 11000,
        executiveMaxIntervalMs: 28000,
        memoryIntervalMs: 30000,
        affordanceIntervalMs: 7000,
        perceptionIntervalMs: 2000,
        needsIntervalMs: 3000,
        maxActionsPerDecision: 2,
        fallbackOldThink: false
      }
    };
  }

  let P_state = Object.assign(P_defaultState(), P_loadJSON(P_STATE_FILE, {}));
  P_state.working = Object.assign(P_defaultState().working, P_state.working || {});
  P_state.self = Object.assign(P_defaultState().self, P_state.self || {});
  P_state.timing = Object.assign(P_defaultState().timing, P_state.timing || {});
  P_state.stats = Object.assign(P_defaultState().stats, P_state.stats || {});
  P_state.config = Object.assign(P_defaultState().config, P_state.config || {});

  function P_save(force) {
    const now = Date.now();
    if (!force && now - P_RUNTIME.saveAt < 1000) return;
    P_RUNTIME.saveAt = now;
    P_state.updatedAt = new Date().toISOString();
    P_saveJSON(P_STATE_FILE, P_state);
  }

  function P_getBot(arg) {
    return arg || globalThis.__ADAM_LAST_BOT__ || globalThis.bot || null;
  }

  function P_getSelf(arg) {
    return arg || globalThis.__ADAM_LAST_SELF__ || globalThis.self || null;
  }

  function P_bind(bot, self) {
    try {
      if (bot) {
        globalThis.bot = bot;
        globalThis.__ADAM_LAST_BOT__ = bot;
      }
      if (self) {
        globalThis.self = self;
        globalThis.__ADAM_LAST_SELF__ = self;
      }
    } catch {}
  }

  function P_ready(bot, self) {
    if (!bot) return false;
    if (self && self.isAlive === false) return false;
    if (!bot.entity || !bot.entity.position) return false;
    if (!bot.inventory || typeof bot.inventory.items !== 'function') return false;
    return true;
  }

  function P_items(bot) {
    try { return bot.inventory.items() || []; } catch { return []; }
  }

  function P_invMap(bot) {
    const out = {};
    for (const item of P_items(bot)) out[item.name] = (out[item.name] || 0) + item.count;
    return out;
  }

  function P_posObj(pos) {
    if (!pos) return null;
    return {
      x: Math.round(Number(pos.x)),
      y: Math.round(Number(pos.y)),
      z: Math.round(Number(pos.z))
    };
  }

  function P_dist(a, b) {
    if (!a || !b) return Infinity;
    const dx = Number(a.x) - Number(b.x);
    const dy = Number(a.y || 0) - Number(b.y || 0);
    const dz = Number(a.z) - Number(b.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function P_clamp(x, min, max) {
    x = Number(x);
    if (!Number.isFinite(x)) x = 0;
    return Math.max(min, Math.min(max, x));
  }

  function P_entityName(e) {
    return String((e && (e.name || e.displayName || e.mobType)) || '').toLowerCase().replace(/\s+/g, '_');
  }

  const P_HOSTILES = new Set([
    'zombie','husk','drowned','skeleton','stray','creeper','spider','cave_spider',
    'witch','phantom','slime','magma_cube','pillager','vindicator','evoker','ravager',
    'enderman','blaze','ghast','hoglin','zoglin','piglin_brute','guardian','elder_guardian','warden'
  ]);

  const P_PASSIVES = new Set(['cow','pig','sheep','chicken','rabbit','cod','salmon','mooshroom','mushroom_cow']);

  function P_nearestEntityBySet(bot, set, radius) {
    if (!bot || !bot.entity || !bot.entities) return null;
    const origin = bot.entity.position;
    let best = null;
    let bestD = Infinity;

    for (const e of Object.values(bot.entities)) {
      if (!e || !e.position || e === bot.entity) continue;
      const name = P_entityName(e);
      if (!set.has(name)) continue;
      const d = P_dist(origin, e.position);
      if (d <= radius && d < bestD) {
        best = { entity: e, name, distance: d };
        bestD = d;
      }
    }
    return best;
  }

  function P_players(bot, radius) {
    if (!bot || !bot.entity || !bot.entities) return [];
    const origin = bot.entity.position;
    return Object.values(bot.entities)
      .filter(e => e && e.position && e.type === 'player' && e.username !== bot.username)
      .map(e => ({ username: e.username || 'unknown', distance: Math.round(P_dist(origin, e.position)) }))
      .filter(e => e.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
  }

  function P_personality(self) {
    try {
      if (typeof loadPersonalityV2 === 'function' && self && self.name) return loadPersonalityV2(self.name);
    } catch {}
    return {
      core: { curiosity: 6, caution: 5, diligence: 6, sociability: 4, creativity: 5, pragmatism: 7 },
      speaking_style: '짧고 담백하게 말한다.'
    };
  }

  function P_queue(self) {
    try {
      return self && self.state && Array.isArray(self.state.taskQueue) ? self.state.taskQueue : [];
    } catch {
      return [];
    }
  }

  function P_queueText(self) {
    const q = P_queue(self);
    if (!q.length) return '없음';
    return q.slice(0, 6).map((t, i) => {
      return String(i + 1) + '. ' + String(t.action || t.type || '?') + (t.target ? '(' + t.target + ')' : '') + (t.expected ? ' 기대=' + t.expected : '');
    }).join('\n');
  }

  function P_recentCount(list, ms) {
    const now = Date.now();
    return (list || []).filter(x => {
      const t = x.t || Date.parse(x.at || 0);
      return Number.isFinite(t) && now - t <= ms;
    }).length;
  }

  function P_pushLimited(arr, item, limit) {
    arr.push(item);
    while (arr.length > limit) arr.shift();
  }

  function P_remember(self, text, importance) {
    text = P_safe(text);
    if (!text) return;

    try {
      if (globalThis.AdamMemory && typeof globalThis.AdamMemory.rememberEvent === 'function') {
        globalThis.AdamMemory.rememberEvent('piano', text, { source: 'piano_v2' }, typeof importance === 'number' ? importance / 10 : 0.55);
      }
    } catch {}

    try {
      if (typeof addMemory === 'function' && self) addMemory(self, text).catch(() => {});
    } catch {}
  }

  function P_isOldModeCommand(message) {
    const s = P_safe(message).toLowerCase();
    return /\b(free mode|focus mode|think aloud|quiet)\b/.test(s) ||
      /자유롭게|자유\s*모드|계획\s*따라|집중\s*모드|조용|생각.*말/.test(s);
  }

  function P_absorbSocialInput(self, username, message, meta) {
    const text = P_safe(message);
    const entry = {
      at: new Date().toISOString(),
      t: Date.now(),
      username: username || 'unknown',
      text,
      meta: meta || {}
    };
    P_pushLimited(P_state.working.social, entry, 40);
    P_state.timing.forcedExecutiveUntil = Date.now() + 30000;
    P_state.stats.socialRequestsAbsorbed += 1;
    P_save();

    P_remember(self, '[사회적 입력] ' + entry.username + ': ' + text + ' — 이것은 강제 명령이 아니라 판단에 참고할 말이다.', 6);
  }

  function P_installLegacyModeInterceptor(bot, self) {
    if (!bot || bot.__pianoLegacyModeInterceptor) return;
    bot.__pianoLegacyModeInterceptor = true;

    const oldEmit = bot.emit;

    bot.emit = function patchedPianoEmit(eventName, ...args) {
      if (eventName === 'chat') {
        const username = args[0];
        const message = args[1];

        if (username !== bot.username && username !== (self && self.name) && P_isOldModeCommand(message)) {
          P_absorbSocialInput(self, username, message, { interceptedOldModeCommand: true });

          const lower = P_safe(message).toLowerCase();
          if (/quiet|조용/.test(lower)) P_state.self.speechPreference = 'less';
          else if (/think aloud|생각.*말/.test(lower)) P_state.self.speechPreference = 'more';
          else P_state.self.speechPreference = 'situational';

          P_save(true);

          if (Date.now() - (P_state.timing.lastOldCommandReplyAt || 0) > 30000) {
            P_state.timing.lastOldCommandReplyAt = Date.now();
            try {
              bot.chat('그건 스위치처럼 받지 않겠다. 참고는 하되, 판단은 내가 해보겠다.');
            } catch {}
          }

          // 기존 Agency V1의 free/focus/quiet listener까지 도달하지 못하게 차단.
          return true;
        }
      }

      return oldEmit.call(this, eventName, ...args);
    };

    P_log('old mode command interceptor 설치: free/focus/quiet는 이제 스위치가 아니라 사회적 입력');
  }

  function P_absorbPendingChat(self) {
    if (!self || !Array.isArray(self.pendingChat) || !self.pendingChat.length) return [];
    const chats = self.pendingChat.splice(0);
    for (const c of chats) {
      P_absorbSocialInput(self, c.username, c.message, { fromPendingChat: true });
    }
    return chats;
  }

  function P_perceptionTick(bot, self) {
    if (!P_ready(bot, self)) return;

    const pos = bot.entity.position;
    const hostile = P_nearestEntityBySet(bot, P_HOSTILES, 24);
    const closeHostile = P_nearestEntityBySet(bot, P_HOSTILES, 8);
    const animal = P_nearestEntityBySet(bot, P_PASSIVES, 28);
    const players = P_players(bot, 32);

    P_state.working.perception = {
      at: new Date().toISOString(),
      t: Date.now(),
      pos: P_posObj(pos),
      health: bot.health,
      food: bot.food,
      isNight: !!(bot.time && bot.time.timeOfDay > 13000),
      moving: !!(bot.pathfinder && typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()),
      digging: !!bot.targetDigBlock,
      nearestHostile: hostile ? { name: hostile.name, distance: Math.round(hostile.distance) } : null,
      closeHostile: closeHostile ? { name: closeHostile.name, distance: Math.round(closeHostile.distance) } : null,
      nearestAnimal: animal ? { name: animal.name, distance: Math.round(animal.distance) } : null,
      players
    };

    P_state.timing.lastPerceptionAt = Date.now();
    P_save();
  }

  function P_inventoryShort(bot) {
    const inv = P_invMap(bot);
    const foodNames = ['bread','apple','beef','porkchop','chicken','mutton','rabbit','cod','salmon','carrot','potato','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton','baked_potato'];
    let food = 0;
    for (const n of foodNames) food += inv[n] || 0;

    const logs = Object.entries(inv).filter(([n]) => /_(log|wood)$/.test(n) && !n.startsWith('stripped_')).reduce((a, [, c]) => a + c, 0);
    const stone = (inv.cobblestone || 0) + (inv.cobbled_deepslate || 0) + (inv.blackstone || 0);
    const fuel = (inv.coal || 0) + (inv.charcoal || 0);

    const out = [];
    if (food < 2) out.push('음식');
    if (logs < 4) out.push('나무');
    if (stone < 8) out.push('돌');
    if (fuel < 2) out.push('연료');
    return out;
  }

  function P_failurePressure(self) {
    try {
      const hist = (self.actionHistory || []).slice(-10);
      if (!hist.length) return 0;
      return hist.filter(h => h.outcome === 'FAILURE').length / hist.length;
    } catch {
      return 0;
    }
  }

  function P_needsTick(bot, self) {
    if (!P_ready(bot, self)) return;

    const p = P_state.working.perception || {};
    const personality = P_personality(self);
    const core = personality.core || {};

    const health = Number(bot.health ?? 20);
    const food = Number(bot.food ?? 20);
    const threatDistance = p.closeHostile ? Number(p.closeHostile.distance || 8) : null;

    const healthPressure = P_clamp((12 - health) / 12, 0, 1);
    const hungerPressure = P_clamp((14 - food) / 14, 0, 1);
    const regenPressure = health < 20 && food < 18 ? P_clamp((20 - health) / 20, 0, 1) : 0;
    const threatPressure = p.closeHostile ? P_clamp((9 - threatDistance) / 9, 0.2, 1) : 0;
    const survival = Math.max(healthPressure, hungerPressure, regenPressure, threatPressure);

    const q = P_queue(self);
    const queueLen = q.length;
    const failPressure = P_failurePressure(self);
    const recentSocial = P_recentCount(P_state.working.social, 90000);
    const recentObs = P_recentCount(P_state.working.observations, 120000);
    const recentSurprise = P_recentCount(P_state.working.surprises, 90000);
    const idleMs = Date.now() - (P_state.timing.lastActionAt || Date.now());
    const idlePressure = P_clamp(idleMs / 150000, 0, 1);

    const curiosity = Number(core.curiosity ?? 6);
    const caution = Number(core.caution ?? 5);
    const diligence = Number(core.diligence ?? 6);
    const sociability = Number(core.sociability ?? 4);
    const creativity = Number(core.creativity ?? 5);
    const pragmatism = Number(core.pragmatism ?? 7);

    const selfDirection = P_clamp(
      0.18 +
      idlePressure * 0.25 +
      recentObs * 0.10 +
      recentSurprise * 0.18 +
      (curiosity - 5) * 0.035 +
      (creativity - 5) * 0.025 -
      survival * 0.50 -
      failPressure * 0.10,
      0,
      1
    );

    const queuePressure = P_clamp(
      (queueLen ? 0.42 : 0) +
      diligence * 0.035 +
      pragmatism * 0.018 -
      failPressure * 0.42 -
      recentSurprise * 0.10 -
      survival * 0.25,
      0,
      1
    );

    const socialPressure = P_clamp(recentSocial * 0.20 + recentObs * 0.08 + sociability * 0.035, 0, 1);
    const explorationPressure = P_clamp(idlePressure * 0.30 + (curiosity - 5) * 0.04 - survival * 0.55 - caution * 0.015, 0, 1);
    const craftPressure = P_clamp((pragmatism * 0.05) + (P_inventoryShort(bot).length * 0.12) - survival * 0.25, 0, 1);

    P_state.working.needs = {
      at: new Date().toISOString(),
      health,
      food,
      shortages: P_inventoryShort(bot),
      queueLen,
      failPressure,
      recentSocial,
      recentObs,
      recentSurprise,
      idlePressure
    };

    P_state.working.pressures = {
      survival: Number(survival.toFixed(2)),
      queue: Number(queuePressure.toFixed(2)),
      selfDirection: Number(selfDirection.toFixed(2)),
      social: Number(socialPressure.toFixed(2)),
      exploration: Number(explorationPressure.toFixed(2)),
      craft: Number(craftPressure.toFixed(2)),
      reason: [
        survival > 0.65 ? '몸/위험 압력이 강함' : null,
        queuePressure > 0.55 ? '진행 중인 큐가 설득력 있음' : null,
        selfDirection > 0.55 ? '관찰/호기심/정체 상태 때문에 스스로 판단하고 싶음' : null,
        socialPressure > 0.50 ? '최근 사회적 입력/관찰이 있음' : null,
        failPressure > 0.4 ? '최근 실패가 많아 같은 방식 반복 금물' : null
      ].filter(Boolean).join(' / ') || '압력이 균형적임'
    };

    P_state.timing.lastNeedsAt = Date.now();
    P_save();
  }

  function P_affordanceTick(bot, self) {
    if (!P_ready(bot, self)) return;

    let current = [];
    let future = [];

    try {
      if (typeof scanCurrentPossibilities === 'function') {
        current = scanCurrentPossibilities(bot).slice(0, 8);
      }
    } catch {}

    try {
      if (typeof scanFutureAffordances === 'function') {
        future = scanFutureAffordances(bot).slice(0, 6);
      }
    } catch {}

    if (!current.length) {
      const inv = P_invMap(bot);
      if (!inv.crafting_table) current.push({ action: 'gather_wood', target: null, why: '작업대와 도구 재료가 필요하다', priority: 7 });
      if (bot.food < 14) current.push({ action: 'hunt', target: null, why: '허기가 낮아 음식 확보가 필요하다', priority: 8 });
      if (inv.wooden_pickaxe && !inv.stone_pickaxe) current.push({ action: 'mine', target: 'stone', why: '돌 도구로 발전할 수 있다', priority: 7 });
      current.push({ action: 'check_status', target: null, why: '현재 상태를 다시 점검한다', priority: 4 });
    }

    P_state.working.affordances = current;
    P_state.working.future = future;
    P_state.working.queue = P_queue(self).slice(0, 8);
    P_state.timing.lastAffordanceAt = Date.now();
    P_save();
  }

  async function P_memoryTick(bot, self, force) {
    if (!P_ready(bot, self)) return;
    if (!force && Date.now() - (P_state.timing.lastMemoryAt || 0) < P_state.config.memoryIntervalMs) return;

    const p = P_state.working.perception || {};
    const needs = P_state.working.needs || {};
    const pressures = P_state.working.pressures || {};
    const query = [
      '현재 상황',
      '체력 ' + bot.health,
      '허기 ' + bot.food,
      p.nearestHostile ? '위협 ' + p.nearestHostile.name : '',
      needs.shortages ? '부족 ' + needs.shortages.join(',') : '',
      pressures.reason || '',
      '관찰 사회 입력 자유 판단 실패 교훈'
    ].join(' ');

    try {
      if (typeof retrieveMemories === 'function') {
        const mems = await retrieveMemories(self, query, 10);
        P_state.working.memories = mems.map(m => ({
          id: m.id,
          importance: m.importance,
          score: m.score,
          description: m.description
        }));
      }
    } catch (e) {
      P_state.working.memories = [];
    }

    P_state.timing.lastMemoryAt = Date.now();
    P_save();
  }

  function P_recordObservation(self, obs) {
    obs.at = new Date().toISOString();
    obs.t = Date.now();
    P_pushLimited(P_state.working.observations, obs, 80);
    P_state.timing.forcedExecutiveUntil = Date.now() + 30000;
    P_save();

    P_remember(self, '[관찰] ' + (obs.actor || '누군가') + '이(가) ' + (obs.action || '행동') + ' ' + (obs.target || '') + ' 을/를 했다.', 6);
  }

  function P_recordSurprise(self, text, meta) {
    const evt = {
      at: new Date().toISOString(),
      t: Date.now(),
      text: P_safe(text),
      meta: meta || {}
    };
    P_pushLimited(P_state.working.surprises, evt, 40);
    P_state.timing.forcedExecutiveUntil = Date.now() + 45000;
    P_save();

    P_remember(self, '[사건] ' + evt.text, 7);
  }

  function P_installListeners(bot, self) {
    if (!bot || !self || self.__pianoListenersInstalled) return;
    self.__pianoListenersInstalled = true;

    P_installLegacyModeInterceptor(bot, self);

    try {
      bot.on('blockUpdate', function(oldBlock, newBlock) {
        try {
          if (!bot.entity || !bot.entity.position) return;
          const pos = (newBlock && newBlock.position) || (oldBlock && oldBlock.position);
          if (!pos || P_dist(bot.entity.position, pos) > 36) return;

          const player = P_players(bot, 10)[0];
          if (!player) return;

          const oldName = oldBlock ? oldBlock.name : 'air';
          const newName = newBlock ? newBlock.name : 'air';
          if (oldName === newName) return;

          let action = null;
          let target = null;

          if (oldName !== 'air' && newName === 'air') {
            action = 'broke_block';
            target = oldName;
          } else if (oldName === 'air' && newName !== 'air') {
            action = 'placed_block';
            target = newName;
          } else {
            return;
          }

          P_recordObservation(self, {
            actor: player.username,
            action,
            target,
            pos: P_posObj(pos),
            source: 'piano_blockUpdate'
          });
        } catch {}
      });
    } catch {}

    try {
      bot.on('playerCollect', function(collector, collected) {
        try {
          if (!collector || !collected) return;
          const me =
            collector === bot.entity ||
            collector.id === (bot.entity && bot.entity.id) ||
            collector.username === bot.username;

          if (me) {
            const near = P_players(bot, 12)[0];
            if (near) {
              P_recordSurprise(self, near.username + ' 근처에서 물건을 주웠다. 그냥 드랍이 아니라 건네준 물건일 수도 있다.', {
                player: near.username,
                pos: P_posObj(collected.position || bot.entity.position)
              });
            }
          } else if (collector.username && collector.username !== bot.username) {
            P_recordObservation(self, {
              actor: collector.username,
              action: 'collected_item',
              target: 'dropped_item',
              pos: P_posObj(collected.position || collector.position),
              source: 'piano_playerCollect'
            });
          }
        } catch {}
      });
    } catch {}

    self.__pianoInvSnapshot = P_invMap(bot);

    P_log('관찰/사회/선물/이전 모드명령 인터셉터 설치 완료');
  }

  function P_inventoryDeltaCheck(bot, self) {
    if (!P_ready(bot, self)) return;
    const current = P_invMap(bot);

    if (!self.__pianoInvSnapshot) {
      self.__pianoInvSnapshot = current;
      return;
    }

    const before = self.__pianoInvSnapshot;
    self.__pianoInvSnapshot = current;

    const gained = {};
    for (const [name, count] of Object.entries(current)) {
      const diff = count - (before[name] || 0);
      if (diff > 0) gained[name] = diff;
    }

    const total = Object.values(gained).reduce((a, b) => a + b, 0);
    if (total <= 0) return;

    const text = Object.entries(gained).map(([n, c]) => n + '×' + c).join(', ');
    P_recordSurprise(self, '가방에 새 물건이 들어왔다: ' + text + '. 이 변화는 다음 판단에 반영해야 한다.', { gained });
  }

  async function P_localSurvival(bot, self) {
    if (!P_ready(bot, self)) return null;

    const p = P_state.working.perception || {};
    const health = Number(bot.health ?? 20);
    const food = Number(bot.food ?? 20);

    if (p.closeHostile && health <= 10) {
      try {
        if (bot.pathfinder) bot.pathfinder.setGoal(null);
        if (bot.clearControlStates) bot.clearControlStates();
      } catch {}
      return '[생존압력] ' + p.closeHostile.name + ' 근접 + 체력 낮음. 중앙 사고보다 반사/전투 루프가 먼저 처리하도록 작업을 멈춘다.';
    }

    if ((health <= 6 && food < 18) || food <= 5) {
      try {
        if (typeof performBuiltinAction === 'function') {
          const eat = await performBuiltinAction(bot, self, 'eat', null, null);
          if (!/없|못|실패|not/i.test(String(eat))) return '[생존압력] ' + eat;

          const collect = await performBuiltinAction(bot, self, 'collect_drops', null, null);
          const eat2 = await performBuiltinAction(bot, self, 'eat', null, null);
          if (!/없|못|실패|not/i.test(String(eat2))) return '[생존압력] ' + collect + ' / ' + eat2;

          if (!p.closeHostile) {
            const hunt = await performBuiltinAction(bot, self, 'hunt', null, null);
            return '[생존압력] 음식 확보 시도: ' + hunt;
          }
        }
      } catch (e) {
        return '[생존압력] 음식/회복 처리 중 오류: ' + e.message;
      }
    }

    if (health < 20 && food < 18) {
      try {
        if (typeof performBuiltinAction === 'function') {
          const eat = await performBuiltinAction(bot, self, 'eat', null, null);
          if (!/없|못|실패|not/i.test(String(eat))) return '[회복압력] 쉬기 전에 허기 보충: ' + eat;
        }
      } catch {}
    }

    return null;
  }

  function P_isCurrentlyWorking(bot, self) {
    try {
      if (self && (self.__inCombat || self.__stableCombat)) return true;
      if (bot.targetDigBlock) return true;
      if (bot.pathfinder && typeof bot.pathfinder.isMoving === 'function' && bot.pathfinder.isMoving()) {
        const since = Date.now() - (P_state.timing.lastActionAt || 0);
        if (since < 16000) return true;
      }
    } catch {}
    return false;
  }

  function P_allowedActions(self) {
    const builtins = Array.isArray(BUILTIN_ACTIONS) ? BUILTIN_ACTIONS : [
      'explore','gather_wood','mine','follow','rest','eat','place_block','craft_item',
      'build_shelter','mark_home','go_home','mark_poi','store_items','smelt_item',
      'hunt','collect_drops','check_status','self_review'
    ];

    const skills = self && self.skills ? Object.keys(self.skills) : [];
    return Array.from(new Set(builtins.concat(skills).concat([
      'explore','gather_wood','mine','rest','eat','craft_item','hunt','collect_drops',
      'check_status','build_shelter','mark_home','go_home','mark_poi','smelt_item'
    ]))).slice(0, 120);
  }

  function P_buildPrompt(bot, self, reason) {
    const personality = P_personality(self);
    const personalityText =
      typeof buildPersonalityPrompt === 'function'
        ? buildPersonalityPrompt(personality)
        : JSON.stringify(personality);

    const pos = bot.entity.position;
    const invText =
      typeof getDetailedInventory === 'function'
        ? getDetailedInventory(bot)
        : JSON.stringify(P_invMap(bot));

    const envText =
      typeof getEnvironmentReport === 'function'
        ? getEnvironmentReport(bot)
        : '주변을 살피고 있다.';

    const pressures = P_state.working.pressures || {};
    const needs = P_state.working.needs || {};
    const affordances = P_state.working.affordances || [];
    const future = P_state.working.future || [];
    const memories = P_state.working.memories || [];
    const observations = P_state.working.observations || [];
    const social = P_state.working.social || [];
    const surprises = P_state.working.surprises || [];

    const allowed = P_allowedActions(self);

    return [
      "너는 외부 도구가 아니라 Adam 자신이다.",
      "너는 야생에서 살아가는 한 사람이고, 지금 몸과 기억과 관찰을 바탕으로 직접 판단한다.",
      "",
      "[중요 원칙]",
      "1. 모드는 없다. free/focus/quiet 같은 말은 마음을 켜고 끄는 스위치가 아니다. 그런 말은 사회적 요청일 뿐이다.",
      "2. 기술 큐는 명령이 아니라 여러 압력 중 하나의 제안이다.",
      "3. 생존 압력, 큐 압력, 호기심, 사회적 입력, 최근 실패, 기억이 동시에 작용한다.",
      "4. 최종 선택은 네가 한다. 다만 체력/허기/위험을 무시하면 안 된다.",
      "5. 같은 실패를 반복하지 마라. 실패가 많으면 목표를 버리지 말고 접근 방식을 바꿔라.",
      "6. 말은 필요할 때만 짧게 한다. 스스로 말할 이유가 없으면 null.",
      "",
      personalityText,
      "",
      "[현재 몸/환경]",
      "- 위치: X:" + Math.round(pos.x) + " Y:" + Math.round(pos.y) + " Z:" + Math.round(pos.z),
      "- 체력: " + bot.health + "/20",
      "- 허기: " + bot.food + "/20",
      "- 가방: " + invText,
      "- 환경: " + envText,
      "",
      "[동시에 작용하는 내부 압력]",
      JSON.stringify(pressures, null, 2),
      "",
      "[부족/상태]",
      JSON.stringify(needs, null, 2),
      "",
      "[기술 큐 — 제안일 뿐]",
      P_queueText(self),
      "",
      "[지금 당장 가능해 보이는 행동]",
      affordances.length ? affordances.map(x => "- " + (x.action || x.type) + (x.target ? "(" + x.target + ")" : "") + " → " + (x.why || x.reason || '') + " priority=" + (x.priority || '?')).join("\n") : "없음",
      "",
      "[재료가 없어도 생각해볼 미래 가능성]",
      future.length ? future.map(x => "- " + (x.item || x.action || '?') + " → " + (x.why || '') + (x.missing ? " 부족=" + x.missing.join(',') : '')).join("\n") : "없음",
      "",
      "[최근 사회적 입력]",
      social.slice(-6).map(x => "- " + x.username + ": " + x.text).join("\n") || "없음",
      "",
      "[최근 관찰]",
      observations.slice(-8).map(x => "- " + (x.actor || '누군가') + " " + (x.action || '') + " " + (x.target || '')).join("\n") || "없음",
      "",
      "[최근 사건/놀람]",
      surprises.slice(-6).map(x => "- " + x.text).join("\n") || "없음",
      "",
      "[관련 기억]",
      memories.slice(-10).map(m => "- [중요도 " + m.importance + "] " + m.description).join("\n") || "없음",
      "",
      "[직전 행동 결과]",
      self.lastActionResult || "없음",
      "",
      "[이번 판단이 호출된 이유]",
      reason,
      "",
      "[가능한 행동 이름]",
      allowed.join(', '),
      "",
      "반드시 JSON만 출력:",
      "{",
      "  \"mood\":\"현재 기분\",",
      "  \"desire\":\"지금 네가 스스로 원하는 것\",",
      "  \"attention\":\"지금 가장 주의를 두는 대상\",",
      "  \"thought\":\"짧고 실용적인 속마음\",",
      "  \"confidence\":0.0,",
      "  \"queue_relation\":\"follow | adapt | defer | ignore\",",
      "  \"queue_reason\":\"큐를 따르거나 미루는 이유\",",
      "  \"actions\":[{\"action\":\"행동명\",\"target\":\"대상 또는 null\",\"label\":\"라벨 또는 null\",\"skill_name\":\"스킬명 또는 null\",\"skill_goal\":\"스킬목표 또는 null\",\"expected\":\"기대 결과\"}],",
      "  \"say\":\"말할 내용 또는 null\",",
      "  \"remember\":\"기억할 내용 또는 null\",",
      "  \"next_check_seconds\":12",
      "}"
    ].join("\n");
  }

  function P_modelName() {
    try {
      if (typeof COGNITION_MODEL !== 'undefined' && COGNITION_MODEL) return COGNITION_MODEL;
    } catch {}
    try {
      if (process.env.ADAM_COGNITION_MODEL) return process.env.ADAM_COGNITION_MODEL;
    } catch {}
    try {
      if (typeof MAIN_MODEL !== 'undefined' && MAIN_MODEL) return MAIN_MODEL;
    } catch {}
    return 'gpt-4o';
  }

  function P_parseJSON(raw) {
    try {
      if (typeof extractJSON === 'function') {
        const d = extractJSON(raw);
        if (d) return d;
      }
    } catch {}
    try { return JSON.parse(raw); } catch {}
    return null;
  }

  function P_validateAction(self, item) {
    if (!item || typeof item !== 'object') return null;
    const action = String(item.action || '').trim();
    if (!action || action === 'null') return null;

    const allowed = new Set(P_allowedActions(self));
    if (!allowed.has(action) && action !== 'learn_skill') {
      return {
        action: 'check_status',
        target: null,
        label: null,
        expected: '알 수 없는 행동 대신 상태를 점검한다'
      };
    }

    return {
      action,
      target: item.target === undefined ? null : item.target,
      label: item.label === undefined ? null : item.label,
      skill_name: item.skill_name,
      skill_goal: item.skill_goal,
      expected: item.expected || null
    };
  }

  async function P_execute(bot, self, item) {
    try {
      if (typeof executeWithAwareness === 'function') return await executeWithAwareness(bot, self, item);
      if (typeof executeDecision === 'function') return await executeDecision(bot, self, item);
      if (typeof performBuiltinAction === 'function') return await performBuiltinAction(bot, self, item.action, item.target, item.label);
    } catch (e) {
      return '실행 오류: ' + e.message;
    }
    return '실행 함수를 찾지 못했다.';
  }

  async function P_executiveTick(botArg, selfArg, reason) {
    const bot = P_getBot(botArg);
    const self = P_getSelf(selfArg);
    P_bind(bot, self);

    if (!P_ready(bot, self)) return false;
    if (P_RUNTIME.busy) return false;

    P_perceptionTick(bot, self);
    P_needsTick(bot, self);
    P_affordanceTick(bot, self);
    P_inventoryDeltaCheck(bot, self);

    const survival = await P_localSurvival(bot, self);
    if (survival) {
      self.lastActionResult = survival;
      P_state.timing.lastActionAt = Date.now();
      P_remember(self, survival, 7);
      P_save(true);
      P_log(survival);
      return true;
    }

    const now = Date.now();
    const forced = now < (P_state.timing.forcedExecutiveUntil || 0);
    const due = now >= (P_state.timing.nextExecutiveAt || 0);
    const pressures = P_state.working.pressures || {};

    if (!forced && !due) return false;

    if (
      !forced &&
      P_isCurrentlyWorking(bot, self) &&
      Number(pressures.selfDirection || 0) < 0.75 &&
      Number(pressures.social || 0) < 0.65
    ) {
      return false;
    }

    if (typeof openai === 'undefined' || !openai || !openai.chat || !openai.chat.completions) {
      P_log('OpenAI client 없음 — 중앙 집행부 스킵');
      return false;
    }

    await P_memoryTick(bot, self, true);

    P_RUNTIME.busy = true;
    P_state.timing.lastExecutiveAt = now;
    P_state.stats.executiveCalls += 1;
    P_save();

    let decision = null;

    try {
      const prompt = P_buildPrompt(bot, self, reason || 'parallel_tick');

      const completion = await openai.chat.completions.create({
        model: P_modelName(),
        messages: [
          {
            role: 'system',
            content: 'You are Adam. You are the agent, not an assistant controlling an agent. Decide from embodied state, memory, desire, social observations, and available actions.'
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      });

      decision = P_parseJSON(completion.choices[0].message.content);
    } catch (e) {
      P_log('중앙 집행부 호출 실패: ' + e.message);
      P_RUNTIME.busy = false;
      return false;
    }

    if (!decision) {
      P_RUNTIME.busy = false;
      return false;
    }

    P_state.self.mood = P_safe(decision.mood || P_state.self.mood);
    P_state.self.desire = P_safe(decision.desire || P_state.self.desire);
    P_state.self.attention = P_safe(decision.attention || P_state.self.attention);
    P_state.self.lastThought = P_safe(decision.thought || '');
    P_state.self.lastDecisionReason = P_safe(decision.queue_reason || reason || '');
    P_state.self.confidence = P_clamp(Number(decision.confidence ?? 0.5), 0, 1);

    const qr = String(decision.queue_relation || '').toLowerCase();
    if (qr === 'follow') P_state.stats.queueFollowed += 1;
    else if (qr === 'adapt') P_state.stats.queueAdapted += 1;
    else if (qr === 'defer' || qr === 'ignore') P_state.stats.queueDeferred += 1;

    const nextSec = P_clamp(Number(decision.next_check_seconds || 12), 6, 40);
    P_state.timing.nextExecutiveAt = Date.now() + nextSec * 1000;

    console.log('');
    console.log('🎼 [Adam 중앙사고]');
    console.log('  기분: ' + P_state.self.mood);
    console.log('  욕구: ' + P_state.self.desire);
    console.log('  주의: ' + P_state.self.attention);
    console.log('  생각: ' + P_state.self.lastThought);
    console.log('  큐 관계: ' + (decision.queue_relation || 'unknown') + ' / ' + (decision.queue_reason || ''));
    console.log('');

    if (decision.remember && decision.remember !== 'null') {
      P_remember(self, '[중앙사고] ' + decision.remember, 7);
    }

    const speechPref = P_state.self.speechPreference;
    const shouldSpeak =
      decision.say &&
      decision.say !== 'null' &&
      (
        speechPref === 'more' ||
        Number(P_state.working.pressures.social || 0) > 0.45 ||
        P_recentCount(P_state.working.surprises, 60000) > 0 ||
        Math.random() < 0.25
      ) &&
      speechPref !== 'less';

    if (shouldSpeak) {
      try {
        bot.chat(typeof sanitize === 'function' ? sanitize(decision.say) : decision.say);
      } catch {}
    }

    const rawActions = Array.isArray(decision.actions) ? decision.actions : [];
    const actions = rawActions
      .map(item => P_validateAction(self, item))
      .filter(Boolean)
      .slice(0, P_state.config.maxActionsPerDecision);

    if (!actions.length) {
      self.lastActionResult = '[중앙사고] 지금은 새 행동보다 관찰을 유지하기로 했다.';
      P_save(true);
      P_RUNTIME.busy = false;
      return true;
    }

    const results = [];

    for (const item of actions) {
      const result = await P_execute(bot, self, item);
      results.push('[' + item.action + '] ' + result);
      P_state.stats.actionsTaken += 1;
      P_state.timing.lastActionAt = Date.now();

      if (typeof looksLikeFailure === 'function' && looksLikeFailure(result)) {
        break;
      }
    }

    self.lastActionResult = '[중앙사고] ' + results.join(' ');
    P_remember(self, self.lastActionResult, 6);

    P_save(true);
    P_RUNTIME.busy = false;
    return true;
  }

  function P_startLoops(bot, self) {
    if (!bot || !self || self.__pianoCoreStarted) return;
    self.__pianoCoreStarted = true;

    P_bind(bot, self);
    P_installListeners(bot, self);

    const addInterval = function(fn, ms) {
      const timer = setInterval(() => {
        try {
          const b = P_getBot(bot);
          const s = P_getSelf(self);
          if (!P_ready(b, s)) return;
          fn(b, s);
        } catch (e) {
          console.warn('⚠️ [PIANO V2] loop 오류:', e.message);
        }
      }, ms);
      if (timer.unref) timer.unref();
      P_RUNTIME.intervals.push(timer);
    };

    addInterval(P_perceptionTick, P_state.config.perceptionIntervalMs);
    addInterval(P_needsTick, P_state.config.needsIntervalMs);
    addInterval(P_affordanceTick, P_state.config.affordanceIntervalMs);
    addInterval((b, s) => { P_memoryTick(b, s).catch(() => {}); }, P_state.config.memoryIntervalMs);
    addInterval((b, s) => { P_executiveTick(b, s, 'parallel_information_aggregation').catch(() => {}); }, 6000);

    P_log('병렬 루프 시작: perception/needs/affordance/memory/executive');
  }

  try {
    if (globalThis.AdamAgency) {
      globalThis.AdamAgency.freeMode = function() {
        P_state.self.desire = '누군가 내 자율성을 더 보고 싶어한다. 하지만 이것은 스위치가 아니라 사회적 기대다.';
        P_state.timing.forcedExecutiveUntil = Date.now() + 30000;
        P_save(true);
        return 'absorbed_as_social_request';
      };
      globalThis.AdamAgency.focusedMode = function() {
        P_state.self.desire = '누군가 내가 계획을 더 신중히 고려하길 바란다. 하지만 최종 판단은 상황에 따라 한다.';
        P_state.timing.forcedExecutiveUntil = Date.now() + 30000;
        P_save(true);
        return 'absorbed_as_social_request';
      };
      globalThis.AdamAgency.balancedMode = function() {
        P_state.self.desire = '균형 있게 판단하려 한다.';
        P_save(true);
        return 'absorbed_as_self_state';
      };
    }
  } catch {}

  try {
    if (typeof maybeInjectTechTasks === 'function' && !maybeInjectTechTasks.__pianoWrapped) {
      const prevMaybeInjectTechTasks = maybeInjectTechTasks;

      maybeInjectTechTasks = function pianoMaybeInjectTechTasks(bot, self) {
        P_bind(bot, self);
        P_perceptionTick(bot, self);
        P_needsTick(bot, self);

        const pr = P_state.working.pressures || {};

        if (Number(pr.survival || 0) > 0.45) {
          P_log('기술 큐 주입 보류: 생존 압력이 더 강함');
          return;
        }

        if (Number(pr.selfDirection || 0) > Number(pr.queue || 0) + 0.25) {
          P_log('기술 큐 주입 보류: 현재 Adam의 자기주도 압력이 더 강함');
          return;
        }

        return prevMaybeInjectTechTasks(bot, self);
      };

      maybeInjectTechTasks.__pianoWrapped = true;
      P_log('maybeInjectTechTasks를 제안형 큐로 약화 완료');
    }
  } catch (e) {
    console.warn('⚠️ [PIANO V2] maybeInjectTechTasks wrapper 실패:', e.message);
  }

  try {
    if (typeof reactToChat === 'function' && !reactToChat.__pianoWrapped) {
      const prevReactToChat = reactToChat;

      reactToChat = async function pianoReactToChat(bot, self) {
        P_bind(bot, self);
        P_startLoops(bot, self);
        P_absorbPendingChat(self);
        P_state.timing.forcedExecutiveUntil = Date.now() + 30000;
        P_save(true);

        const acted = await P_executiveTick(bot, self, 'social_chat');
        if (acted) return true;

        if (P_state.config.fallbackOldThink && prevReactToChat) {
          return await prevReactToChat.apply(this, arguments);
        }

        return true;
      };

      reactToChat.__pianoWrapped = true;
      P_log('reactToChat를 PIANO 사회인지로 교체');
    }
  } catch (e) {
    console.warn('⚠️ [PIANO V2] reactToChat wrapper 실패:', e.message);
  }

  try {
    if (typeof thinkAndAct === 'function' && !thinkAndAct.__pianoWrapped) {
      const prevThinkAndAct = thinkAndAct;

      thinkAndAct = async function pianoThinkAndAct(bot, self) {
        P_bind(bot, self);
        P_startLoops(bot, self);

        const acted = await P_executiveTick(bot, self, 'main_life_loop');
        if (acted) return true;

        if (P_state.config.fallbackOldThink && prevThinkAndAct) {
          return await prevThinkAndAct.apply(this, arguments);
        }

        return true;
      };

      thinkAndAct.__pianoWrapped = true;
      P_log('thinkAndAct를 PIANO 중앙 집행부로 교체');
    }
  } catch (e) {
    console.warn('⚠️ [PIANO V2] thinkAndAct wrapper 실패:', e.message);
  }

  try {
    if (typeof liveLoop === 'function' && !liveLoop.__pianoWrapped) {
      const prevLiveLoop = liveLoop;

      liveLoop = async function pianoLiveLoop(bot, self) {
        P_bind(bot, self);
        P_startLoops(bot, self);
        return await prevLiveLoop.apply(this, arguments);
      };

      liveLoop.__pianoWrapped = true;
      P_log('liveLoop 시작 시 PIANO 병렬 루프 부착');
    }
  } catch (e) {
    console.warn('⚠️ [PIANO V2] liveLoop wrapper 실패:', e.message);
  }

  globalThis.AdamPiano = {
    version: P_VERSION,
    state: function() { return P_state; },
    tick: P_executiveTick,
    save: function() { P_save(true); return true; },
    absorb: function(text) {
      P_absorbSocialInput(P_getSelf(null), 'external', text, { manual: true });
      return true;
    }
  };

  P_log('로드 완료. 모드 스위치 제거 + 공유 워킹메모리 + 병렬 압력 + GPT 중앙 집행부 활성화. state=' + P_STATE_FILE);
})();
`;

if (!src.includes('__ADAM_PIANO_CORE_V2__')) {
  src = src.trimEnd() + '\n' + patch + '\n';
} else {
  console.log('PIANO V2 already present; skipping append.');
}

fs.writeFileSync(file, src);
console.log('Backup:', backup);
console.log('Patched:', file);
