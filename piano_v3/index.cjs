const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { loadConfig } = require('./config.cjs');
const { PianoLogger } = require('./logger.cjs');
const { computePressures } = require('./pressure.cjs');

const runtimes = new Map();

function safe(v) {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try {
    if (v instanceof Error) return v.stack || v.message || String(v);
  } catch {}
  try { return JSON.stringify(v); } catch {
    try { return String(v); } catch { return ''; }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return fallback;
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clamp(x, min, max) {
  x = Number(x);
  if (!Number.isFinite(x)) x = 0;
  return Math.max(min, Math.min(max, x));
}

function botKey(bot, self) {
  const name = String((self && self.name) || (bot && bot.username) || 'Adam').replace(/[^\w.-]/g, '_');
  return name;
}

function entityName(e) {
  return String((e && (e.name || e.displayName || e.mobType)) || '').toLowerCase().replace(/\s+/g, '_');
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y || 0) - Number(b.y || 0);
  const dz = Number(a.z) - Number(b.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const HOSTILES = new Set([
  'zombie','husk','drowned','skeleton','stray','creeper','spider','cave_spider',
  'witch','phantom','slime','magma_cube','pillager','vindicator','evoker','ravager',
  'enderman','blaze','ghast','hoglin','zoglin','piglin_brute','guardian','elder_guardian','warden'
]);

const PASSIVES = new Set(['cow','pig','sheep','chicken','rabbit','cod','salmon','mooshroom','mushroom_cow']);

class PianoRuntime {
  constructor(bot, self, deps, config) {
    this.bot = bot;
    this.self = self;
    this.deps = deps || {};
    this.name = botKey(bot, self);
    this.config = config || loadConfig('piano_config_' + this.name + '.json');
    this.log = new PianoLogger(this.name, this.config.logging);
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(50);

    this.stateFile = 'piano_state_' + this.name + '.json';
    this.statusFile = 'piano_status_' + this.name + '.json';
    this.decisionLogFile = path.join('logs', 'piano_decisions_' + this.name + '.jsonl');

    this.state = Object.assign(this.defaultState(), loadJSON(this.stateFile, {}));
    this.state.working = Object.assign(this.defaultState().working, this.state.working || {});
    this.state.self = Object.assign(this.defaultState().self, this.state.self || {});
    this.state.timing = Object.assign(this.defaultState().timing, this.state.timing || {});
    this.state.stats = Object.assign(this.defaultState().stats, this.state.stats || {});

    this.busy = false;
    this.apiBackoffUntil = 0;
    /* __PIANO_V31_CONSECUTIVE_BACKOFF__ */
    this.consecutiveApiFailures = 0;
    this.timers = [];
    this.lastChatSeen = new Map();
  }

  defaultState() {
    return {
      version: 3,
      updatedAt: new Date().toISOString(),
      working: {
        perception: {},
        needs: {},
        pressures: {},
        queue: [],
        affordances: [],
        future: [],
        memories: [],
        social: [],
        observations: [],
        surprises: []
      },
      self: {
        mood: 'calm',
        desire: 'understand the situation and act usefully',
        attention: 'body and surroundings',
        thought: '',
        confidence: 0.5
      },
      timing: {
        lastPerceptionAt: 0,
        lastNeedsAt: 0,
        lastAffordanceAt: 0,
        lastMemoryAt: 0,
        lastExecutiveAt: 0,
        nextExecutiveAt: Date.now() + 4000,
        lastActionAt: Date.now(),
        forcedExecutiveUntil: 0,
        lastStatusAt: 0
      },
      stats: {
        executiveCalls: 0,
        localFallbacks: 0,
        actionsTaken: 0,
        apiFailures: 0,
        jsonRepairs: 0,
        queueFollowed: 0,
        queueAdapted: 0,
        queueDeferred: 0
      }
    };
  }

  ready() {
    const bot = this.bot;
    if (!bot) return false;
    if (this.self && this.self.isAlive === false) return false;
    if (!bot.entity || !bot.entity.position) return false;
    if (!bot.inventory || typeof bot.inventory.items !== 'function') return false;
    return true;
  }

  save(force) {
    try {
      this.state.updatedAt = new Date().toISOString();
      saveJSON(this.stateFile, this.state);
      const now = Date.now();
      if (force || now - (this.state.timing.lastStatusAt || 0) > this.config.intervals.statusWriteMs) {
        this.state.timing.lastStatusAt = now;
        saveJSON(this.statusFile, {
          at: new Date().toISOString(),
          self: this.state.self,
          pressures: this.state.working.pressures,
          needs: this.state.working.needs,
          nextExecutiveInMs: Math.max(0, (this.state.timing.nextExecutiveAt || 0) - Date.now()),
          stats: this.state.stats
        });
      }
    } catch (e) {
      this.log.warn('state_save_failed', { error: e.message });
    }
  }

  install() {
    if (this.self.__pianoV3Installed) return;
    this.self.__pianoV3Installed = true;

    this.attachBotListeners();

    const start = () => {
      this.log.info('runtime_started', {
        message: 'explicit pub/sub + per-bot runtime + adaptive executive'
      });

      const timer = setInterval(() => {
        this.pulse('scheduler').catch(e => this.log.error('scheduler_error', { error: e.message, stack: e.stack }));
      }, this.config.intervals.schedulerMs);

      if (timer.unref) timer.unref();
      this.timers.push(timer);
    };

    try {
      if (this.bot.entity) start();
      else this.bot.once('spawn', start);
    } catch (e) {
      this.log.error('spawn_attach_failed', { error: e.message });
    }
  }

  attachBotListeners() {
    const bot = this.bot;
    const self = this.self;
    if (!bot || bot.__pianoV3Listeners) return;
    bot.__pianoV3Listeners = true;

    bot.on('chat', (username, message) => {
      try {
        if (username === bot.username || username === self.name) return;
        this.absorbSocial(username, message, { source: 'chat' });
      } catch (e) {
        this.log.warn('chat_listener_error', { error: e.message });
      }
    });

    bot.on('blockUpdate', (oldBlock, newBlock) => {
      try {
        this.observeBlockUpdate(oldBlock, newBlock);
      } catch (e) {
        this.log.warn('block_observer_error', { error: e.message });
      }
    });

    bot.on('playerCollect', (collector, collected) => {
      try {
        this.observeCollect(collector, collected);
      } catch (e) {
        this.log.warn('collect_observer_error', { error: e.message });
      }
    });

    bot.on('health', () => {
      try {
        this.state.timing.forcedExecutiveUntil = Date.now() + 12000;
        this.save(false);
      } catch (e) {
        this.log.warn('health_observer_error', { error: e.message });
      }
    });

    bot.on('death', () => {
      try {
        this.pushLimited(this.state.working.surprises, {
          at: new Date().toISOString(),
          t: Date.now(),
          text: 'Adam died. Future decisions should avoid repeating the same risk.',
          meta: { pos: this.posObj(bot.entity && bot.entity.position) }
        }, 40);
        this.state.timing.forcedExecutiveUntil = Date.now() + 60000;
        this.save(true);
      } catch (e) {
        this.log.warn('death_observer_error', { error: e.message });
      }
    });

    this.log.info('listeners_installed', {
      note: 'no bot.emit monkeypatch'
    });
  }

  pushLimited(arr, item, limit) {
    arr.push(item);
    while (arr.length > limit) arr.shift();
  }

  posObj(pos) {
    if (!pos) return null;
    return {
      x: Math.round(Number(pos.x)),
      y: Math.round(Number(pos.y)),
      z: Math.round(Number(pos.z))
    };
  }

  items() {
    try { return this.bot.inventory.items() || []; } catch { return []; }
  }

  invMap() {
    const out = {};
    for (const item of this.items()) out[item.name] = (out[item.name] || 0) + item.count;
    return out;
  }

  getPersonality() {
    try {
      if (this.deps.loadPersonalityV2) return this.deps.loadPersonalityV2(this.self.name);
    } catch (e) {
      this.log.warn('personality_load_failed', { error: e.message });
    }

    return {
      core: {
        curiosity: 6,
        caution: 5,
        diligence: 6,
        sociability: 4,
        creativity: 5,
        pragmatism: 7
      },
      speaking_style: 'brief and practical'
    };
  }

  personalityCore() {
    const p = this.getPersonality();
    return p.core || {};
  }

  queue() {
    try {
      return this.self.state && Array.isArray(this.self.state.taskQueue) ? this.self.state.taskQueue : [];
    } catch {
      return [];
    }
  }

  actionHistoryFailRatio() {
    try {
      const hist = (this.self.actionHistory || []).slice(-12);
      if (!hist.length) return 0;
      return hist.filter(h => h.outcome === 'FAILURE').length / hist.length;
    } catch {
      return 0;
    }
  }

  recentCount(arr, ms) {
    const now = Date.now();
    return (Array.isArray(arr) ? arr : []).filter(x => {
      const t = x.t || Date.parse(x.at || 0);
      return Number.isFinite(t) && now - t <= ms;
    }).length;
  }

  nearestBySet(set, radius) {
    if (!this.ready()) return null;
    const origin = this.bot.entity.position;
    let best = null;
    let bestD = Infinity;

    for (const e of Object.values(this.bot.entities || {})) {
      if (!e || !e.position || e === this.bot.entity) continue;
      const name = entityName(e);
      if (!set.has(name)) continue;
      const d = dist(origin, e.position);
      if (d <= radius && d < bestD) {
        best = { entity: e, name, distance: d };
        bestD = d;
      }
    }

    return best;
  }

  players(radius) {
    if (!this.ready()) return [];
    const origin = this.bot.entity.position;

    return Object.values(this.bot.entities || {})
      .filter(e => e && e.position && e.type === 'player' && e.username !== this.bot.username)
      .map(e => ({ username: e.username || 'unknown', distance: Math.round(dist(origin, e.position)) }))
      .filter(e => e.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
  }

  inventoryShortages() {
    const inv = this.invMap();
    const foodNames = [
      'bread','apple','beef','porkchop','chicken','mutton','rabbit','cod','salmon',
      'carrot','potato','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton',
      'baked_potato','cooked_cod','cooked_salmon'
    ];

    let food = 0;
    for (const n of foodNames) food += inv[n] || 0;

    const logs = Object.entries(inv)
      .filter(([n]) => /_(log|wood)$/.test(n) && !n.startsWith('stripped_'))
      .reduce((a, [, c]) => a + c, 0);

    const stone = (inv.cobblestone || 0) + (inv.cobbled_deepslate || 0) + (inv.blackstone || 0);
    const fuel = (inv.coal || 0) + (inv.charcoal || 0);

    const out = [];
    if (food < 2) out.push('food');
    if (logs < 4) out.push('wood');
    if (stone < 8) out.push('stone');
    if (fuel < 2) out.push('fuel');
    return out;
  }

  absorbSocial(username, message, meta) {
    const text = safe(message);
    const key = String(username || '') + '|' + text;
    const last = this.lastChatSeen.get(key) || 0;
    if (Date.now() - last < 2500) return;
    this.lastChatSeen.set(key, Date.now());

    const oldMode = /\b(free mode|focus mode|think aloud|quiet)\b/i.test(text) ||
      /자유롭게|자유\s*모드|계획\s*따라|집중\s*모드|조용|생각.*말/i.test(text);

    const entry = {
      at: new Date().toISOString(),
      t: Date.now(),
      username: username || 'unknown',
      text,
      meta: Object.assign({}, meta || {}, { oldModeCommandAbsorbed: oldMode })
    };

    this.pushLimited(this.state.working.social, entry, 50);
    this.state.timing.forcedExecutiveUntil = Date.now() + 30000;
    this.save(false);

    if (oldMode) {
      try {
        this.bot.chat('그 말은 명령 스위치로 받지 않겠다. 참고는 하되 판단은 내가 하겠다.');
      } catch (e) {
        this.log.warn('old_mode_reply_failed', { error: e.message });
      }
    }

    this.remember('[social] ' + entry.username + ': ' + text + ' (reference, not command)', 6);
  }

  drainPendingChat() {
    if (!Array.isArray(this.self.pendingChat) || !this.self.pendingChat.length) return;
    const chats = this.self.pendingChat.splice(0);
    for (const c of chats) {
      this.absorbSocial(c.username, c.message, { source: 'pendingChat' });
    }
  }

  observeBlockUpdate(oldBlock, newBlock) {
    if (!this.ready()) return;

    const pos = (newBlock && newBlock.position) || (oldBlock && oldBlock.position);
    if (!pos || dist(this.bot.entity.position, pos) > 36) return;

    const player = this.players(10)[0];
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

    const obs = {
      at: new Date().toISOString(),
      t: Date.now(),
      actor: player.username,
      action,
      target,
      pos: this.posObj(pos),
      source: 'blockUpdate'
    };

    this.pushLimited(this.state.working.observations, obs, 100);
    this.state.timing.forcedExecutiveUntil = Date.now() + 20000;
    this.save(false);
    this.remember('[observation] ' + obs.actor + ' ' + obs.action + ' ' + obs.target, 6);
  }

  observeCollect(collector, collected) {
    if (!this.ready() || !collector || !collected) return;

    const me =
      collector === this.bot.entity ||
      collector.id === (this.bot.entity && this.bot.entity.id) ||
      collector.username === this.bot.username;

    if (me) {
      const near = this.players(12)[0];
      if (near) {
        const evt = {
          at: new Date().toISOString(),
          t: Date.now(),
          text: near.username + ' was nearby when Adam picked up an item. It may be a gift or shared resource.',
          meta: { player: near.username, pos: this.posObj(collected.position || this.bot.entity.position) }
        };
        this.pushLimited(this.state.working.surprises, evt, 60);
        this.state.timing.forcedExecutiveUntil = Date.now() + 30000;
        this.save(false);
        this.remember('[event] ' + evt.text, 7);
      }
    } else if (collector.username && collector.username !== this.bot.username) {
      const obs = {
        at: new Date().toISOString(),
        t: Date.now(),
        actor: collector.username,
        action: 'collected_item',
        target: 'dropped_item',
        pos: this.posObj(collected.position || collector.position),
        source: 'playerCollect'
      };
      this.pushLimited(this.state.working.observations, obs, 100);
      this.save(false);
    }
  }

  remember(text, importance) {
    try {
      if (this.deps.addMemory) this.deps.addMemory(this.self, text).catch(() => {});
    } catch (e) {
      this.log.warn('remember_failed', { error: e.message });
    }
  }

  updatePerception(force) {
    const now = Date.now();
    if (!force && now - (this.state.timing.lastPerceptionAt || 0) < this.config.intervals.perceptionMs) return;
    if (!this.ready()) return;

    const hostile = this.nearestBySet(HOSTILES, 24);
    const closeHostile = this.nearestBySet(HOSTILES, 8);
    const animal = this.nearestBySet(PASSIVES, 28);

    this.state.working.perception = {
      at: new Date().toISOString(),
      t: now,
      pos: this.posObj(this.bot.entity.position),
      health: this.bot.health,
      food: this.bot.food,
      isNight: !!(this.bot.time && this.bot.time.timeOfDay > 13000),
      moving: !!(this.bot.pathfinder && typeof this.bot.pathfinder.isMoving === 'function' && this.bot.pathfinder.isMoving()),
      digging: !!this.bot.targetDigBlock,
      nearestHostile: hostile ? { name: hostile.name, distance: Math.round(hostile.distance) } : null,
      closeHostile: closeHostile ? { name: closeHostile.name, distance: Math.round(closeHostile.distance) } : null,
      nearestAnimal: animal ? { name: animal.name, distance: Math.round(animal.distance) } : null,
      players: this.players(32)
    };

    this.state.timing.lastPerceptionAt = now;
  }

  updateNeeds(force) {
    const now = Date.now();
    if (!force && now - (this.state.timing.lastNeedsAt || 0) < this.config.intervals.needsMs) return;
    if (!this.ready()) return;

    const p = this.state.working.perception || {};
    const shortages = this.inventoryShortages();

    const input = {
      health: this.bot.health,
      food: this.bot.food,
      closeHostileDistance: p.closeHostile ? p.closeHostile.distance : null,
      queueLen: this.queue().length,
      failRatio: this.actionHistoryFailRatio(),
      recentSocial: this.recentCount(this.state.working.social, 90000),
      recentObservation: this.recentCount(this.state.working.observations, 120000),
      recentSurprise: this.recentCount(this.state.working.surprises, 90000),
      idleMs: Date.now() - (this.state.timing.lastActionAt || Date.now()),
      shortages,
      personality: this.personalityCore()
    };

    this.state.working.needs = Object.assign({ at: new Date().toISOString() }, input);
    this.state.working.pressures = computePressures(input, this.config);
    this.state.timing.lastNeedsAt = now;
  }

  updateAffordances(force) {
    const now = Date.now();
    if (!force && now - (this.state.timing.lastAffordanceAt || 0) < this.config.intervals.affordanceMs) return;
    if (!this.ready()) return;

    let current = [];
    let future = [];

    try {
      if (this.deps.scanCurrentPossibilities) current = this.deps.scanCurrentPossibilities(this.bot).slice(0, 8);
    } catch (e) {
      this.log.warn('affordance_current_failed', { error: e.message });
    }

    try {
      if (this.deps.scanFutureAffordances) future = this.deps.scanFutureAffordances(this.bot).slice(0, 6);
    } catch (e) {
      this.log.warn('affordance_future_failed', { error: e.message });
    }

    if (!current.length) {
      const inv = this.invMap();
      if (!inv.crafting_table) current.push({ action: 'gather_wood', target: null, why: 'wood enables crafting table and tools', priority: 7 });
      if (this.bot.food < 14) current.push({ action: 'hunt', target: null, why: 'food is low', priority: 8 });
      if ((inv.wooden_pickaxe || inv.stone_pickaxe) && !inv.stone_pickaxe) current.push({ action: 'mine', target: 'stone', why: 'stone tools are useful', priority: 7 });
      current.push({ action: 'check_status', target: null, why: 'refresh status', priority: 4 });
    }

    this.state.working.affordances = current;
    this.state.working.future = future;
    this.state.working.queue = this.queue().slice(0, 8);
    this.state.timing.lastAffordanceAt = now;
  }

  async updateMemory(force) {
    const now = Date.now();
    if (!force && now - (this.state.timing.lastMemoryAt || 0) < this.config.intervals.memoryMs) return;
    if (!this.ready()) return;

    try {
      if (!this.deps.retrieveMemories) return;

      const p = this.state.working.perception || {};
      const pressures = this.state.working.pressures || {};
      const query = [
        'state hp ' + this.bot.health,
        'food ' + this.bot.food,
        p.nearestHostile ? 'threat ' + p.nearestHostile.name : '',
        pressures.reason || '',
        'social observations failures survival'
      ].join(' ');

      const mems = await this.deps.retrieveMemories(this.self, query, 8);
      this.state.working.memories = (mems || []).map(m => ({
        id: m.id,
        importance: m.importance,
        score: m.score,
        description: m.description
      }));
    } catch (e) {
      this.log.warn('memory_retrieve_failed', { error: e.message });
    }

    this.state.timing.lastMemoryAt = now;
  }

  async pulse(reason) {
    if (!this.ready()) return false;

    this.updatePerception(false);
    this.updateNeeds(false);
    this.updateAffordances(false);
    this.drainPendingChat();

    const local = await this.localFallback();
    if (local) {
      this.self.lastActionResult = local;
      this.state.stats.localFallbacks += 1;
      this.state.timing.lastActionAt = Date.now();
      this.remember(local, 7);
      this.scheduleNext();
      this.save(true);
      return true;
    }

    await this.updateMemory(false);

    if (!this.shouldExecutiveRun()) {
      this.save(false);
      return false;
    }

    return await this.executive(reason || 'scheduler');
  }

  async tick(reason) {
    return await this.pulse(reason || 'explicit_tick');
  }

  async localFallback() {
    if (!this.ready()) return null;

    const p = this.state.working.perception || {};
    const health = Number(this.bot.health ?? 20);
    const food = Number(this.bot.food ?? 20);

    if (p.closeHostile && health <= 10) {
      try {
        if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null);
        if (this.bot.clearControlStates) this.bot.clearControlStates();
      } catch (e) {
        this.log.warn('local_stop_failed', { error: e.message });
      }
      return '[local survival] close hostile ' + p.closeHostile.name + ' and low health; stop work and let combat/reflex handle it.';
    }

    if ((health <= 6 && food < 18) || food <= 5) {
      const eat = await this.executeAction({ action: 'eat', target: null, expected: 'restore hunger' });
      if (!this.looksFailure(eat)) return '[local survival] ' + eat;

      const collect = await this.executeAction({ action: 'collect_drops', target: null, expected: 'pick up nearby food/items' });
      const eat2 = await this.executeAction({ action: 'eat', target: null, expected: 'eat after collecting' });
      if (!this.looksFailure(eat2)) return '[local survival] ' + collect + ' / ' + eat2;

      if (!p.closeHostile) {
        const hunt = await this.executeAction({ action: 'hunt', target: null, expected: 'obtain food' });
        return '[local survival] food hunt fallback: ' + hunt;
      }
    }

    if (health < 20 && food < 18) {
      const eat = await this.executeAction({ action: 'eat', target: null, expected: 'enable natural regeneration' });
      if (!this.looksFailure(eat)) return '[local recovery] ate before resting: ' + eat;
    }

    return null;
  }

  looksFailure(result) {
    try {
      if (this.deps.looksLikeFailure) return this.deps.looksLikeFailure(result);
    } catch {}
    return /fail|failed|cannot|not found|없|못|실패|부족|중단|위험/i.test(String(result || ''));
  }

  isWorking() {
    try {
      if (this.self.__inCombat || this.self.__stableCombat) return true;
      if (this.bot.targetDigBlock) return true;
      if (this.bot.pathfinder && typeof this.bot.pathfinder.isMoving === 'function' && this.bot.pathfinder.isMoving()) {
        const since = Date.now() - (this.state.timing.lastActionAt || 0);
        if (since < 16000) return true;
      }
    } catch {}
    return false;
  }

  shouldExecutiveRun() {
    if (this.busy) return false;
    if (Date.now() < this.apiBackoffUntil) return false;

    const now = Date.now();
    const forced = now < (this.state.timing.forcedExecutiveUntil || 0);
    const due = now >= (this.state.timing.nextExecutiveAt || 0);

    if (!forced && !due) return false;

    const since = now - (this.state.timing.lastExecutiveAt || 0);
    if (since < this.config.executive.minIntervalMs && !forced) return false;

    const pressures = this.state.working.pressures || {};
    if (!forced && this.isWorking() && Number(pressures.selfDirection || 0) < 0.75 && Number(pressures.social || 0) < 0.65) {
      return false;
    }

    return true;
  }

  scheduleNext(decision) {
    const p = this.state.working.pressures || {};
    let ms = this.config.executive.normalIntervalMs;

    if (Number(p.survival || 0) > 0.55 || Number(p.social || 0) > 0.65 || Number(p.selfDirection || 0) > 0.70) {
      ms = this.config.executive.highPressureIntervalMs;
    } else if (
      Number(p.survival || 0) < 0.20 &&
      Number(p.social || 0) < 0.20 &&
      Number(p.selfDirection || 0) < 0.35 &&
      this.queue().length === 0
    ) {
      ms = this.config.executive.lowPressureIntervalMs;
    }

    if (decision && Number(decision.next_check_seconds)) {
      ms = clamp(Number(decision.next_check_seconds) * 1000, this.config.executive.highPressureIntervalMs, this.config.executive.maxIntervalMs);
    }

    this.state.timing.nextExecutiveAt = Date.now() + ms;
  }

  chooseModel() {
    const mp = this.config.modelPolicy || {};
    if (mp.forceCheap) return mp.cheapModel;

    const p = this.state.working.pressures || {};
    const n = this.state.working.needs || {};

    const high =
      Number(p.survival || 0) >= Number(mp.smartWhenSurvivalAbove || 0.75) ||
      Number(p.social || 0) >= Number(mp.smartWhenSocialAbove || 0.80) ||
      Number(n.failRatio || 0) >= Number(mp.smartWhenFailureAbove || 0.55);

    if (high && mp.allowSmart) return mp.smartModel;
    return mp.cheapModel;
  }

  allowedActions() {
    try {
      const builtins = this.deps.getBuiltinActions ? this.deps.getBuiltinActions() : [];
      const skills = this.self.skills ? Object.keys(this.self.skills) : [];
      return Array.from(new Set([].concat(builtins || [], skills || [], [
        'explore','gather_wood','mine','rest','eat','craft_item','hunt','collect_drops',
        'check_status','build_shelter','mark_home','go_home','mark_poi','smelt_item',
        'store_items','self_review'
      ]))).slice(0, 120);
    } catch {
      return ['explore','gather_wood','mine','rest','eat','craft_item','hunt','check_status'];
    }
  }

  compact(value, max) {
    const text = safe(value).replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  compactJSON(value, max) {
    return this.compact(JSON.stringify(value || {}, null, 0), max);
  }

  buildPrompt(reason) {
    const bot = this.bot;
    const self = this.self;
    const pos = bot.entity.position;

    let inv = '';
    let env = '';

    try {
      inv = this.deps.getDetailedInventory ? this.deps.getDetailedInventory(bot) : this.compactJSON(this.invMap(), 800);
    } catch {
      inv = this.compactJSON(this.invMap(), 800);
    }

    try {
      env = this.deps.getEnvironmentReport ? this.deps.getEnvironmentReport(bot) : 'unknown';
    } catch {
      env = 'unknown';
    }

    const wk = this.state.working;
    const queue = (wk.queue || []).slice(0, 4);
    const afford = (wk.affordances || []).slice(0, 5);
    const future = (wk.future || []).slice(0, 3);
    const social = (wk.social || []).slice(-4).map(x => ({ user: x.username, text: this.compact(x.text, 100) }));
    const obs = (wk.observations || []).slice(-5).map(x => ({ actor: x.actor, act: x.action, target: x.target }));
    const events = (wk.surprises || []).slice(-4).map(x => this.compact(x.text, 130));
    const mem = (wk.memories || []).slice(0, 6).map(x => ({ imp: x.importance, text: this.compact(x.description, 140) }));
    const allowed = this.allowedActions();

    const body = [
      'You are Adam, the embodied agent. Not a tool, not an assistant.',
      'No mode switches. User words are social input, not direct control.',
      'Queue is only one pressure among survival, memory, observation, desire, failure, and affordance.',
      'Decide compactly. Use English internally to save tokens. If say is needed for Korean user, say may be Korean.',
      '',
      'STATE pos=' + Math.round(pos.x) + ',' + Math.round(pos.y) + ',' + Math.round(pos.z) +
        ' hp=' + bot.health + '/20 food=' + bot.food + '/20',
      'inv=' + this.compact(inv, 700),
      'env=' + this.compact(env, 450),
      '',
      'SELF=' + this.compactJSON(this.state.self, 400),
      'PRESSURES=' + this.compactJSON(wk.pressures, 500),
      'NEEDS=' + this.compactJSON(wk.needs, 500),
      '',
      'QUEUE(suggestion)=' + this.compactJSON(queue, 600),
      'NOW=' + this.compactJSON(afford, 700),
      'FUTURE=' + this.compactJSON(future, 400),
      'SOCIAL=' + this.compactJSON(social, 500),
      'OBS=' + this.compactJSON(obs, 450),
      'EVENTS=' + this.compactJSON(events, 450),
      'MEM=' + this.compactJSON(mem, 900),
      '',
      'LAST=' + this.compact(self.lastActionResult || 'none', 500),
      'REASON=' + reason,
      'ALLOWED=' + allowed.join(', '),
      '',
      'Return JSON only:',
      '{"mood":"","desire":"","attention":"","thought":"","confidence":0.0,"queue_relation":"follow|adapt|defer|ignore","queue_reason":"","actions":[{"action":"","target":null,"label":null,"skill_name":null,"skill_goal":null,"expected":""}],"say":null,"remember":null,"next_check_seconds":20}'
    ].join('\n');

    return this.compact(body, this.config.executive.maxPromptChars);
  }

  parseJSON(raw) {
    raw = safe(raw);
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;

    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  async callJson(messages, model, maxTokens, temperature) {
    const openai = this.deps.openai;
    if (!openai || !openai.chat || !openai.chat.completions) throw new Error('OpenAI client unavailable');

    const retries = Math.max(1, Number(this.config.executive.apiRetries || 2));
    let lastErr = null;
    let raw = '';

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await openai.chat.completions.create({
          model,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          temperature
        });

        raw = res.choices && res.choices[0] && res.choices[0].message ? res.choices[0].message.content : '';
        const parsed = this.parseJSON(raw);
        if (parsed) return parsed;

        lastErr = new Error('JSON parse failed');
      } catch (e) {
        lastErr = e;
      }

      await sleep(Number(this.config.executive.apiInitialBackoffMs || 1200) * Math.pow(2, attempt));
    }

    if (this.config.executive.jsonRepair && raw) {
      try {
        this.state.stats.jsonRepairs += 1;
        const repair = await openai.chat.completions.create({
          model: this.config.modelPolicy.cheapModel,
          messages: [
            { role: 'system', content: 'Fix the following into valid JSON only. No commentary.' },
            { role: 'user', content: raw.slice(0, 2500) }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 300,
          temperature: 0
        });

        const repaired = repair.choices && repair.choices[0] && repair.choices[0].message ? repair.choices[0].message.content : '';
        const parsed = this.parseJSON(repaired);
        if (parsed) return parsed;
      } catch (e) {
        this.log.warn('json_repair_failed', { error: e.message });
      }
    }

    throw lastErr || new Error('LLM JSON call failed');
  }

  validateAction(item) {
    if (!item || typeof item !== 'object') return null;
    const action = String(item.action || '').trim();
    if (!action || action === 'null') return null;

    const allowed = new Set(this.allowedActions());
    if (!allowed.has(action) && action !== 'learn_skill') {
      return {
        action: 'check_status',
        target: null,
        label: null,
        expected: 'unknown action replaced by status check'
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

  async executeAction(item) {
    try {
      if (this.deps.executeAction) return await this.deps.executeAction(this.bot, this.self, item);
      if (this.deps.executeDecision) return await this.deps.executeDecision(this.bot, this.self, item);
      if (this.deps.performBuiltinAction) return await this.deps.performBuiltinAction(this.bot, this.self, item.action, item.target, item.label);
    } catch (e) {
      return 'action error: ' + e.message;
    }
    return 'no action executor available';
  }

  async executive(reason) {
    if (this.busy) return false;
    this.busy = true;

    try {
      await this.updateMemory(true);

      const model = this.chooseModel();
      const prompt = this.buildPrompt(reason);

      const decision = await this.callJson(
        [
          { role: 'system', content: 'You are Adam. Choose actions as the embodied agent. Compact JSON only.' },
          { role: 'user', content: prompt }
        ],
        model,
        Number(this.config.executive.maxTokens || 420),
        Number(this.config.executive.temperature || 0.45)
      );

      this.consecutiveApiFailures = 0;
      this.apiBackoffUntil = 0;
      this.state.stats.executiveCalls += 1;
      this.state.timing.lastExecutiveAt = Date.now();

      this.state.self.mood = safe(decision.mood || this.state.self.mood);
      this.state.self.desire = safe(decision.desire || this.state.self.desire);
      this.state.self.attention = safe(decision.attention || this.state.self.attention);
      this.state.self.thought = safe(decision.thought || '');
      this.state.self.confidence = clamp(decision.confidence ?? 0.5, 0, 1);

      const qr = String(decision.queue_relation || '').toLowerCase();
      if (qr === 'follow') this.state.stats.queueFollowed += 1;
      else if (qr === 'adapt') this.state.stats.queueAdapted += 1;
      else if (qr === 'defer' || qr === 'ignore') this.state.stats.queueDeferred += 1;

      this.log.info('executive_decision', {
        model,
        mood: this.state.self.mood,
        desire: this.state.self.desire,
        thought: this.state.self.thought,
        queue_relation: decision.queue_relation,
        queue_reason: decision.queue_reason
      });

      try {
        fs.appendFileSync(this.decisionLogFile, JSON.stringify({
          at: new Date().toISOString(),
          model,
          decision
        }) + '\n');
      } catch (e) {
        this.log.warn('decision_log_failed', { error: e.message });
      }

      console.log('');
      console.log('🎼 [Adam V3 중앙사고]');
      console.log('  mood: ' + this.state.self.mood);
      console.log('  desire: ' + this.state.self.desire);
      console.log('  attention: ' + this.state.self.attention);
      console.log('  thought: ' + this.state.self.thought);
      console.log('  queue: ' + (decision.queue_relation || 'unknown') + ' / ' + (decision.queue_reason || ''));
      console.log('');

      if (decision.remember && decision.remember !== 'null') {
        this.remember('[piano executive] ' + decision.remember, 7);
      }

      if (decision.say && decision.say !== 'null') {
        const socialPressure = Number((this.state.working.pressures || {}).social || 0);
        const surpriseCount = this.recentCount(this.state.working.surprises, 60000);
        if (socialPressure > 0.35 || surpriseCount > 0 || Math.random() < 0.18) {
          try {
            const text = this.deps.sanitize ? this.deps.sanitize(decision.say) : decision.say;
            this.bot.chat(text);
          } catch (e) {
            this.log.warn('chat_say_failed', { error: e.message });
          }
        }
      }

      const actions = (Array.isArray(decision.actions) ? decision.actions : [])
        .map(x => this.validateAction(x))
        .filter(Boolean)
        .slice(0, Number(this.config.executive.maxActions || 2));

      if (!actions.length) {
        this.self.lastActionResult = '[piano executive] observed and waited';
        this.scheduleNext(decision);
        this.save(true);
        return true;
      }

      const results = [];

      for (const item of actions) {
        const result = await this.executeAction(item);
        results.push('[' + item.action + '] ' + result);
        this.state.stats.actionsTaken += 1;
        this.state.timing.lastActionAt = Date.now();

        if (this.looksFailure(result)) break;
      }

      this.self.lastActionResult = '[piano executive] ' + results.join(' ');
      this.remember(this.self.lastActionResult, 6);

      this.scheduleNext(decision);
      this.save(true);
      return true;
    } catch (e) {
      this.state.stats.apiFailures += 1;
      this.consecutiveApiFailures = (this.consecutiveApiFailures || 0) + 1;
      this.apiBackoffUntil = Date.now() + Math.min(
        120000,
        Number(this.config.executive.apiInitialBackoffMs || 1200) * Math.pow(2, this.consecutiveApiFailures)
      );
      this.log.error('executive_failed', { error: e.message, backoffUntil: this.apiBackoffUntil });

      const fallback = await this.safeNonLLMFallback();
      if (fallback) {
        this.self.lastActionResult = fallback;
        this.state.stats.localFallbacks += 1;
      }

      this.scheduleNext();
      this.save(true);
      return !!fallback;
    } finally {
      this.busy = false;
    }
  }

  async safeNonLLMFallback() {
    if (!this.ready()) return null;

    const afford = this.state.working.affordances || [];
    const first = afford[0];

    if (first && first.action) {
      const action = this.validateAction({
        action: first.action,
        target: first.target || null,
        expected: first.why || 'local fallback'
      });

      if (action) {
        const result = await this.executeAction(action);
        return '[non-LLM fallback] ' + result;
      }
    }

    return '[non-LLM fallback] no safe local action selected';
  }
}

function install(opts) {
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
  }

  if (!bot || !self) throw new Error('piano_v3.install requires bot and self');

  const name = botKey(bot, self);
  const configFile = 'piano_config_' + name + '.json';
  const config = loadConfig(configFile, { createIfMissing: false });

  let rt = runtimes.get(name);
  if (!rt) {
    rt = new PianoRuntime(bot, self, deps, config);
    runtimes.set(name, rt);
  } else {
    rt.bot = bot;
    rt.self = self;
    rt.deps = deps;
  }

  rt.install();

  /* __PIANO_V31_ATTACH_RUNTIME__ */
  try {
    bot.__pianoRuntime = rt;
    self.__pianoRuntime = rt;
  } catch {}


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


  return rt;
}

module.exports = { install, runtimes, PianoRuntime };


/* __PIANO_V34_LEGACY_GLOBAL_GUARD__ */
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
