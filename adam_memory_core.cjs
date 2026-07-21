
'use strict';

const fs = require('fs');
const path = require('path');

function install(ctx) {
  ctx = ctx || {};

  if (globalThis.__ADAM_LONG_TERM_MEMORY_V1_INSTALLED__) {
    return globalThis.AdamMemory;
  }

  globalThis.__ADAM_LONG_TERM_MEMORY_V1_INSTALLED__ = true;

  const VERSION = "1.0.0";
  const BASE_DIR = process.cwd();
  const DATA_FILE = path.join(BASE_DIR, "memory_Adam.json");
  const BRIEF_FILE = path.join(BASE_DIR, "memory_brief_Adam.txt");
  const LEGACY_WORLD_FILE = path.join(BASE_DIR, "worldmap_Adam.json");

  const installedBots = new WeakSet();
  const blockUpdateThrottle = Object.create(null);
  const entityMemoryThrottle = Object.create(null);

  let saveTimer = null;
  let lastScanAt = 0;

  function log(msg) {
    console.log("🧠 [MEMORY V1] " + msg);
  }

  function now() {
    return Date.now();
  }

  function safeText(value) {
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

  function sanitize(value, depth, seen) {
    if (depth === undefined) depth = 0;
    if (!seen) seen = new WeakSet();

    if (value === null || value === undefined) return value;

    const t = typeof value;

    if (t === "string" || t === "number" || t === "boolean") return value;
    if (t === "bigint") return String(value);
    if (t === "function") return "[Function]";
    if (t !== "object") return safeText(value);

    try {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
    } catch (_) {}

    if (depth > 4) return safeText(value).slice(0, 500);

    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (
      typeof value.x === "number" &&
      typeof value.y === "number" &&
      typeof value.z === "number" &&
      Object.keys(value).length <= 8
    ) {
      return cleanPos(value);
    }

    if (Array.isArray(value)) {
      return value.slice(0, 40).map(function(v) {
        return sanitize(v, depth + 1, seen);
      });
    }

    const out = {};
    const keys = Object.keys(value).slice(0, 60);

    for (const k of keys) {
      if (k === "bot" || k === "client" || k === "socket" || k === "_events") continue;
      try {
        out[k] = sanitize(value[k], depth + 1, seen);
      } catch (_) {
        out[k] = "[Unserializable]";
      }
    }

    return out;
  }

  function defaultState() {
    return {
      version: VERSION,
      createdAt: now(),
      updatedAt: now(),
      botName: null,
      flags: {
        importedLegacyPositions: false
      },
      config: {
        maxEvents: 1500,
        maxPois: 1200,
        scanIntervalMs: 15000,
        scanBlockRadius: 48,
        scanBlockCount: 80,
        scanEntityRadius: 48,
        saveDebounceMs: 1200,
        deathAvoidMs: 3 * 24 * 60 * 60 * 1000,
        hazardMemoryMs: 2 * 24 * 60 * 60 * 1000,
        resourceHalfLifeMs: 4 * 24 * 60 * 60 * 1000,
        eventHalfLifeMs: 2 * 24 * 60 * 60 * 1000,
        avoidDangerThreshold: 0.55,
        embeddingDimensions: 256,
        poiMergeRadius: {
          resource: 10,
          hazard: 16,
          death: 12,
          station: 4,
          storage: 4,
          food_mob: 18,
          terrain: 18,
          base: 6,
          unknown: 8
        }
      },
      counters: {},
      runtime: {
        lastHealth: null,
        lastFood: null,
        lastPos: null,
        lastDimension: null,
        lastSpawnAt: 0,
        lastDeathAt: 0
      },
      facts: {},
      episodic: [],
      pois: []
    };
  }

  function normalizeState(raw) {
    const d = defaultState();
    const s = raw && typeof raw === "object" ? raw : {};

    const out = Object.assign({}, d, s);

    out.config = Object.assign({}, d.config, s.config || {});
    out.config.poiMergeRadius = Object.assign(
      {},
      d.config.poiMergeRadius,
      (s.config && s.config.poiMergeRadius) || {}
    );

    out.flags = Object.assign({}, d.flags, s.flags || {});
    out.counters = Object.assign({}, d.counters, s.counters || {});
    out.runtime = Object.assign({}, d.runtime, s.runtime || {});
    out.facts = Object.assign({}, d.facts, s.facts || {});
    out.episodic = Array.isArray(s.episodic) ? s.episodic : [];
    out.pois = Array.isArray(s.pois) ? s.pois : [];

    return out;
  }

  function loadState() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        return normalizeState(parsed);
      }
    } catch (err) {
      try {
        const badFile = DATA_FILE + ".corrupt-" + now();
        fs.copyFileSync(DATA_FILE, badFile);
        log("손상된 memory_Adam.json 백업: " + badFile);
      } catch (_) {}

      log("memory_Adam.json 로드 실패. 새 기억 파일로 시작: " + safeText(err.message || err));
    }

    return normalizeState(null);
  }

  let state = loadState();

  function incCounter(key, amount) {
    if (!amount) amount = 1;
    if (!state.counters[key]) state.counters[key] = 0;
    state.counters[key] += amount;
  }

  function atomicWrite(file, text) {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }

  function scheduleSave(immediate) {
    if (immediate) {
      saveNow();
      return;
    }

    if (saveTimer) return;

    saveTimer = setTimeout(function() {
      saveTimer = null;
      saveNow();
    }, state.config.saveDebounceMs || 1200);
  }

  function saveNow() {
    try {
      trimAll();
      state.updatedAt = now();
      atomicWrite(DATA_FILE, JSON.stringify(state, null, 2));
      writeBrief();
      globalThis.__ADAM_LONG_TERM_MEMORY_CONTEXT__ = buildBrief();
    } catch (err) {
      log("기억 저장 실패: " + safeText(err.message || err));
    }
  }

  function getBot() {
    try {
      if (ctx.getBot) {
        const b = ctx.getBot();
        if (b) return b;
      }
    } catch (_) {}

    try {
      if (globalThis.bot) return globalThis.bot;
    } catch (_) {}

    return null;
  }

  function getMcData() {
    try {
      if (ctx.getMcData) {
        const data = ctx.getMcData();
        if (data) return data;
      }
    } catch (_) {}

    const b = getBot();
    if (b && b.version) {
      try {
        return require("minecraft-data")(b.version);
      } catch (_) {}
    }

    return null;
  }

  function botReady(b) {
    return !!(b && b.entity && b.entity.position);
  }

  function getDimension(b) {
    try {
      if (b && b.game && b.game.dimension) return safeText(b.game.dimension);
    } catch (_) {}

    return "overworld";
  }

  function cleanPos(p) {
    if (!p) return null;

    const x = Number(p.x);
    const y = Number(p.y);
    const z = Number(p.z);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      z: Math.round(z * 10) / 10
    };
  }

  function getBotPos() {
    const b = getBot();

    if (botReady(b)) {
      return cleanPos(b.entity.position);
    }

    if (state.runtime && state.runtime.lastPos) {
      return cleanPos(state.runtime.lastPos);
    }

    return null;
  }

  function posFromAny(v) {
    if (!v) return null;

    if (v.pos) return posFromAny(v.pos);
    if (v.position) return posFromAny(v.position);

    if (
      typeof v.x !== "undefined" &&
      typeof v.y !== "undefined" &&
      typeof v.z !== "undefined"
    ) {
      return cleanPos(v);
    }

    return null;
  }

  function offsetPos(p, dx, dy, dz) {
    if (p && typeof p.offset === "function") return p.offset(dx, dy, dz);

    return {
      x: Number(p.x) + dx,
      y: Number(p.y) + dy,
      z: Number(p.z) + dz
    };
  }

  function dist(a, b) {
    if (!a || !b) return Infinity;

    const dx = Number(a.x) - Number(b.x);
    const dy = Number(a.y) - Number(b.y);
    const dz = Number(a.z) - Number(b.z);

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function posKey(p) {
    const c = cleanPos(p);
    if (!c) return "unknown";
    return Math.floor(c.x) + "," + Math.floor(c.y) + "," + Math.floor(c.z);
  }

  const LOG_BLOCKS = [
    "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log",
    "dark_oak_log", "mangrove_log", "cherry_log",
    "crimson_stem", "warped_stem",
    "stripped_oak_log", "stripped_spruce_log", "stripped_birch_log",
    "stripped_jungle_log", "stripped_acacia_log", "stripped_dark_oak_log",
    "stripped_mangrove_log", "stripped_cherry_log",
    "stripped_crimson_stem", "stripped_warped_stem"
  ];

  const STONE_BLOCKS = [
    "stone", "deepslate", "andesite", "diorite", "granite",
    "tuff", "calcite", "dripstone_block"
  ];

  const HOSTILES = [
    "zombie", "skeleton", "stray", "creeper", "spider", "cave_spider",
    "enderman", "witch", "drowned", "husk", "pillager", "slime",
    "phantom", "ravager", "vindicator", "evoker", "warden"
  ];

  const FOOD_MOBS = [
    "cow", "pig", "sheep", "chicken", "rabbit", "salmon", "cod"
  ];

  function classifyBlockName(name) {
    name = safeText(name).toLowerCase();

    if (!name) return null;

    if (LOG_BLOCKS.indexOf(name) >= 0) {
      return {
        type: "resource",
        name: "logs",
        subtype: name,
        tags: ["wood", "tree", "logs", "나무"],
        confidence: 0.75,
        danger: 0.0
      };
    }

    if (STONE_BLOCKS.indexOf(name) >= 0) {
      return {
        type: "resource",
        name: "stone",
        subtype: name,
        tags: ["stone", "cobblestone", "돌"],
        confidence: 0.55,
        danger: 0.0
      };
    }

    if (name.indexOf("coal_ore") >= 0) {
      return {
        type: "resource",
        name: "coal_ore",
        subtype: name,
        tags: ["coal", "fuel", "ore", "석탄"],
        confidence: 0.8,
        danger: 0.05
      };
    }

    if (name.indexOf("iron_ore") >= 0) {
      return {
        type: "resource",
        name: "iron_ore",
        subtype: name,
        tags: ["iron", "raw_iron", "ore", "철"],
        confidence: 0.85,
        danger: 0.1
      };
    }

    if (name.indexOf("copper_ore") >= 0) {
      return {
        type: "resource",
        name: "copper_ore",
        subtype: name,
        tags: ["copper", "ore", "구리"],
        confidence: 0.75,
        danger: 0.1
      };
    }

    if (name === "crafting_table") {
      return {
        type: "station",
        name: "crafting_table",
        subtype: name,
        tags: ["crafting", "workbench", "작업대"],
        confidence: 0.95,
        danger: 0.0
      };
    }

    if (name === "furnace" || name === "blast_furnace" || name === "smoker") {
      return {
        type: "station",
        name: name,
        subtype: name,
        tags: ["furnace", "smelt", "화로"],
        confidence: 0.95,
        danger: 0.0
      };
    }

    if (name === "chest" || name === "barrel") {
      return {
        type: "storage",
        name: name,
        subtype: name,
        tags: ["storage", "chest", "상자"],
        confidence: 0.9,
        danger: 0.0
      };
    }

    if (name === "bed" || name.endsWith("_bed")) {
      return {
        type: "base",
        name: "bed",
        subtype: name,
        tags: ["home", "bed", "spawn", "침대"],
        confidence: 0.9,
        danger: 0.0
      };
    }

    return null;
  }

  function entityRawName(e) {
    if (!e) return "";

    return safeText(
      e.name ||
      e.displayName ||
      e.mobType ||
      e.username ||
      e.type ||
      ""
    ).toLowerCase();
  }

  function classifyEntity(e) {
    const n = entityRawName(e);
    if (!n) return null;

    for (const h of HOSTILES) {
      if (n.indexOf(h) >= 0) {
        let danger = 0.75;
        let radius = 18;

        if (h === "creeper") {
          danger = 1.0;
          radius = 24;
        } else if (h === "enderman") {
          danger = 0.95;
          radius = 20;
        } else if (h === "skeleton" || h === "stray") {
          danger = 0.9;
          radius = 22;
        } else if (h === "warden") {
          danger = 1.0;
          radius = 48;
        }

        return {
          type: "hazard",
          name: h,
          subtype: n,
          tags: ["hostile", "danger", h, "위험", "몬스터"],
          confidence: 0.85,
          danger: danger,
          radius: radius
        };
      }
    }

    for (const f of FOOD_MOBS) {
      if (n.indexOf(f) >= 0) {
        return {
          type: "food_mob",
          name: f,
          subtype: n,
          tags: ["food", "animal", f, "음식"],
          confidence: 0.65,
          danger: 0.0,
          radius: 12
        };
      }
    }

    if (n === "item" || n.indexOf("item") >= 0) {
      return {
        type: "drop",
        name: "dropped_item",
        subtype: n,
        tags: ["drop", "item", "드랍"],
        confidence: 0.45,
        danger: 0.0,
        radius: 4
      };
    }

    return null;
  }

  function mergeRadius(type, name) {
    const table = state.config.poiMergeRadius || {};
    return table[type] || table.unknown || 8;
  }

  function makePoiId(type, name, dimension, pos) {
    const c = cleanPos(pos) || { x: 0, y: 0, z: 0 };
    return [
      "poi",
      safeText(type || "unknown"),
      safeText(name || "unknown"),
      safeText(dimension || "overworld"),
      Math.floor(c.x / 4) * 4,
      Math.floor(c.y / 4) * 4,
      Math.floor(c.z / 4) * 4
    ].join("_");
  }

  function decayedConfidence(p) {
    if (!p) return 0;

    let halfLife = state.config.resourceHalfLifeMs;

    if (p.type === "hazard") halfLife = state.config.hazardMemoryMs;
    if (p.type === "death") halfLife = 14 * 24 * 60 * 60 * 1000;
    if (p.type === "station" || p.type === "storage" || p.type === "base") {
      halfLife = 30 * 24 * 60 * 60 * 1000;
    }

    const age = Math.max(0, now() - (p.lastSeen || p.createdAt || now()));
    const decay = Math.pow(0.5, age / Math.max(1, halfLife));

    return Math.max(0, Math.min(1, (p.confidence || 0.5) * decay));
  }

  function findMergeCandidate(input) {
    const pos = cleanPos(input.pos);
    if (!pos) return null;

    const type = input.type || "unknown";
    const name = input.name || "unknown";
    const dimension = input.dimension || "overworld";
    const r = mergeRadius(type, name);

    let best = null;
    let bestD = Infinity;

    for (const p of state.pois) {
      if (!p || p.depleted) continue;
      if (p.type !== type) continue;
      if (p.name !== name) continue;
      if ((p.dimension || "overworld") !== dimension) continue;

      const d = dist(pos, p.pos);
      if (d <= r && d < bestD) {
        best = p;
        bestD = d;
      }
    }

    return best;
  }

  function mergeTags(a, b) {
    const set = new Set();

    for (const x of Array.isArray(a) ? a : []) set.add(safeText(x));
    for (const x of Array.isArray(b) ? b : []) set.add(safeText(x));

    return Array.from(set).filter(Boolean).slice(0, 30);
  }

  function upsertPoi(input) {
    input = input || {};

    const b = getBot();
    const pos = cleanPos(input.pos || getBotPos());

    if (!pos) return null;

    const dimension = safeText(input.dimension || getDimension(b));
    const type = safeText(input.type || "unknown");
    const name = safeText(input.name || "unknown");
    const t = now();

    const cleanInput = {
      type: type,
      name: name,
      subtype: safeText(input.subtype || ""),
      pos: pos,
      dimension: dimension,
      tags: Array.isArray(input.tags) ? input.tags.map(safeText) : [],
      confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.5,
      danger: Number.isFinite(Number(input.danger)) ? Number(input.danger) : 0,
      radius: Number.isFinite(Number(input.radius)) ? Number(input.radius) : mergeRadius(type, name),
      source: safeText(input.source || "unknown"),
      evidence: sanitize(input.evidence || {}, 0)
    };

    if (type === "death") {
      cleanInput.danger = Math.max(cleanInput.danger, 1.0);
      cleanInput.radius = Math.max(cleanInput.radius, 28);
      cleanInput.avoidUntil = t + (state.config.deathAvoidMs || 259200000);
      cleanInput.tags = mergeTags(cleanInput.tags, ["death", "avoid", "사망", "회피"]);
    }

    if (type === "hazard") {
      cleanInput.avoidUntil = t + (state.config.hazardMemoryMs || 172800000);
      cleanInput.tags = mergeTags(cleanInput.tags, ["hazard", "avoid", "위험"]);
    }

    const existing = findMergeCandidate(cleanInput);

    if (existing) {
      const seen = existing.seenCount || 1;

      if (
        type === "resource" ||
        type === "hazard" ||
        type === "food_mob" ||
        type === "terrain"
      ) {
        existing.pos = {
          x: Math.round(((existing.pos.x * seen) + pos.x) / (seen + 1) * 10) / 10,
          y: Math.round(((existing.pos.y * seen) + pos.y) / (seen + 1) * 10) / 10,
          z: Math.round(((existing.pos.z * seen) + pos.z) / (seen + 1) * 10) / 10
        };
      } else {
        existing.pos = pos;
      }

      existing.subtype = cleanInput.subtype || existing.subtype;
      existing.tags = mergeTags(existing.tags, cleanInput.tags);
      existing.confidence = Math.min(1, Math.max(decayedConfidence(existing), existing.confidence || 0) + cleanInput.confidence * 0.18);
      existing.danger = Math.max(existing.danger || 0, cleanInput.danger || 0);
      existing.radius = Math.max(existing.radius || 0, cleanInput.radius || 0);
      existing.lastSeen = t;
      existing.seenCount = seen + 1;
      existing.source = cleanInput.source;
      existing.depleted = false;

      if (cleanInput.avoidUntil) {
        existing.avoidUntil = Math.max(existing.avoidUntil || 0, cleanInput.avoidUntil);
      }

      existing.evidence = cleanInput.evidence;

      scheduleSave(false);
      return existing;
    }

    const poi = {
      id: makePoiId(type, name, dimension, pos),
      type: type,
      name: name,
      subtype: cleanInput.subtype,
      pos: pos,
      dimension: dimension,
      tags: cleanInput.tags,
      confidence: Math.max(0, Math.min(1, cleanInput.confidence)),
      danger: Math.max(0, Math.min(1, cleanInput.danger)),
      radius: cleanInput.radius,
      createdAt: t,
      lastSeen: t,
      seenCount: 1,
      source: cleanInput.source,
      evidence: cleanInput.evidence,
      depleted: false
    };

    if (cleanInput.avoidUntil) poi.avoidUntil = cleanInput.avoidUntil;

    state.pois.push(poi);
    incCounter("poi_created");
    scheduleSave(false);

    return poi;
  }

  function markDepleted(type, name, pos) {
    const c = cleanPos(pos);
    if (!c) return false;

    let best = null;
    let bestD = Infinity;

    for (const p of state.pois) {
      if (!p || p.depleted) continue;
      if (type && p.type !== type) continue;
      if (name && p.name !== name) continue;

      const d = dist(c, p.pos);
      if (d < bestD && d <= mergeRadius(p.type, p.name)) {
        best = p;
        bestD = d;
      }
    }

    if (!best) return false;

    best.confidence = Math.max(0, (best.confidence || 0.5) - 0.25);
    best.lastChecked = now();

    if (best.confidence < 0.2) {
      best.depleted = true;
      best.depletedAt = now();
    }

    scheduleSave(false);
    return true;
  }

  function extractTags(text, meta) {
    const tags = new Set();
    const lower = safeText(text).toLowerCase();

    const words = lower.match(/[a-z0-9_가-힣]+/g) || [];
    for (const w of words) {
      if (w.length >= 2) tags.add(w);
    }

    const m = meta && typeof meta === "object" ? meta : {};

    for (const k of ["type", "kind", "name", "item", "target", "action", "goal", "reason"]) {
      if (m[k]) {
        const ws = safeText(m[k]).toLowerCase().match(/[a-z0-9_가-힣]+/g) || [];
        for (const w of ws) {
          if (w.length >= 2) tags.add(w);
        }
      }
    }

    if (lower.indexOf("죽") >= 0 || lower.indexOf("death") >= 0) tags.add("death");
    if (lower.indexOf("위험") >= 0 || lower.indexOf("danger") >= 0) tags.add("hazard");
    if (lower.indexOf("돌") >= 0) tags.add("stone");
    if (lower.indexOf("나무") >= 0) tags.add("logs");
    if (lower.indexOf("철") >= 0) tags.add("iron_ore");
    if (lower.indexOf("동굴") >= 0) tags.add("cave");

    return Array.from(tags).slice(0, 30);
  }

  function estimateImportance(text, meta) {
    const s = safeText(text).toLowerCase();
    let score = 0.25;

    if (s.indexOf("death") >= 0 || s.indexOf("죽") >= 0 || s.indexOf("사망") >= 0) score += 0.65;
    if (s.indexOf("damage") >= 0 || s.indexOf("공격") >= 0 || s.indexOf("피해") >= 0) score += 0.45;
    if (s.indexOf("creeper") >= 0 || s.indexOf("enderman") >= 0 || s.indexOf("skeleton") >= 0) score += 0.45;
    if (s.indexOf("fail") >= 0 || s.indexOf("실패") >= 0) score += 0.25;
    if (s.indexOf("success") >= 0 || s.indexOf("성공") >= 0) score += 0.15;
    if (s.indexOf("stone") >= 0 || s.indexOf("iron") >= 0 || s.indexOf("돌") >= 0 || s.indexOf("철") >= 0) score += 0.2;
    if (s.indexOf("home") >= 0 || s.indexOf("base") >= 0 || s.indexOf("집") >= 0) score += 0.25;

    if (meta && typeof meta === "object") {
      if (meta.type === "death" || meta.kind === "death") score += 0.5;
      if (meta.type === "hazard") score += 0.4;
      if (meta.pos || meta.position) score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  function rememberEvent(kind, text, meta, importance) {
    const b = getBot();
    const t = now();

    const cleanMeta = sanitize(meta || {}, 0);
    const pos = cleanPos(
      posFromAny(cleanMeta) ||
      getBotPos()
    );

    const dimension = safeText(
      (cleanMeta && cleanMeta.dimension) ||
      getDimension(b)
    );

    const body = safeText(text);
    const imp = Number.isFinite(Number(importance)) ? Number(importance) : estimateImportance(body, cleanMeta);

    const evt = {
      id: "evt_" + t + "_" + Math.random().toString(36).slice(2, 8),
      kind: safeText(kind || "memory"),
      text: body.slice(0, 3000),
      meta: cleanMeta,
      pos: pos,
      dimension: dimension,
      at: t,
      importance: Math.max(0, Math.min(1, imp)),
      tags: extractTags(body, cleanMeta)
    };

    state.episodic.push(evt);
    incCounter("event_" + evt.kind);
    scheduleSave(false);

    return evt;
  }

  function rememberDeath(reason) {
    const b = getBot();
    const p = getBotPos() || cleanPos(state.runtime.lastPos);

    const inv = [];

    try {
      if (b && b.inventory && typeof b.inventory.items === "function") {
        for (const it of b.inventory.items()) {
          inv.push({
            name: it.name,
            count: it.count
          });
        }
      }
    } catch (_) {}

    const meta = {
      type: "death",
      reason: safeText(reason || "unknown"),
      pos: p,
      inventory: inv,
      health: b && typeof b.health === "number" ? b.health : null,
      food: b && typeof b.food === "number" ? b.food : null
    };

    rememberEvent("death", "죽음 기록: 이 위치는 위험하다. 당분간 다시 가지 말 것.", meta, 1.0);

    if (p) {
      upsertPoi({
        type: "death",
        name: "death_site",
        pos: p,
        dimension: getDimension(b),
        confidence: 1.0,
        danger: 1.0,
        radius: 32,
        source: "bot_death",
        tags: ["death", "avoid", "danger", "사망", "회피"],
        evidence: meta
      });
    }

    state.runtime.lastDeathAt = now();
    state.facts.lastDeath = meta;
    scheduleSave(true);
  }

  function queryTokens(query) {
    const q = safeText(query).toLowerCase();
    const set = new Set();

    const words = q.match(/[a-z0-9_가-힣]+/g) || [];
    for (const w of words) {
      if (w.length >= 2) set.add(w);
    }

    if (q.indexOf("돌") >= 0 || q.indexOf("석재") >= 0) {
      set.add("stone");
      set.add("cobblestone");
    }

    if (q.indexOf("나무") >= 0 || q.indexOf("목재") >= 0) {
      set.add("logs");
      set.add("wood");
      set.add("tree");
    }

    if (q.indexOf("죽") >= 0 || q.indexOf("사망") >= 0) {
      set.add("death");
      set.add("avoid");
    }

    if (q.indexOf("위험") >= 0 || q.indexOf("몬스터") >= 0) {
      set.add("hazard");
      set.add("danger");
    }

    if (q.indexOf("동굴") >= 0) {
      set.add("cave");
      set.add("cave_candidate");
    }

    if (q.indexOf("철") >= 0) {
      set.add("iron");
      set.add("iron_ore");
      set.add("raw_iron");
    }

    if (q.indexOf("음식") >= 0 || q.indexOf("배고") >= 0) {
      set.add("food");
      set.add("food_mob");
    }

    return Array.from(set);
  }

  function tokenOverlapScore(tokens, text, tags) {
    if (!tokens || !tokens.length) return 0;

    const hay = safeText(text).toLowerCase();
    const tagSet = new Set((tags || []).map(function(x) {
      return safeText(x).toLowerCase();
    }));

    let hit = 0;

    for (const t of tokens) {
      if (tagSet.has(t) || hay.indexOf(t) >= 0) hit++;
    }

    return hit / tokens.length;
  }

  function recencyScore(at, halfLife) {
    const age = Math.max(0, now() - (at || 0));
    return Math.pow(0.5, age / Math.max(1, halfLife || 1));
  }

  function recall(query, options) {
    options = options || {};

    const tokens = queryTokens(query);
    const limit = Number(options.limit || 8);
    const refPos = cleanPos(options.pos || getBotPos());

    const events = state.episodic.map(function(e) {
      let score = 0;
      score += tokenOverlapScore(tokens, e.text, e.tags) * 1.2;
      score += (e.importance || 0) * 0.8;
      score += recencyScore(e.at, state.config.eventHalfLifeMs) * 0.35;

      if (refPos && e.pos) {
        const d = dist(refPos, e.pos);
        score += Math.max(0, 0.3 - d / 200);
      }

      return { score: score, event: e };
    }).filter(function(x) {
      return x.score > 0.1;
    }).sort(function(a, b) {
      return b.score - a.score;
    }).slice(0, limit).map(function(x) {
      return x.event;
    });

    const pois = state.pois.map(function(p) {
      let score = 0;
      score += tokenOverlapScore(tokens, p.name + " " + p.type + " " + p.subtype, p.tags) * 1.4;
      score += decayedConfidence(p) * 0.8;
      score += recencyScore(p.lastSeen || p.createdAt, state.config.resourceHalfLifeMs) * 0.25;

      if (refPos && p.pos) {
        const d = dist(refPos, p.pos);
        score += Math.max(0, 0.45 - d / 160);
      }

      if (p.depleted) score -= 0.8;

      return { score: score, poi: p };
    }).filter(function(x) {
      return x.score > 0.1;
    }).sort(function(a, b) {
      return b.score - a.score;
    }).slice(0, limit).map(function(x) {
      return x.poi;
    });

    return {
      query: safeText(query),
      tokens: tokens,
      events: events,
      pois: pois
    };
  }

  function dangerAt(pos, options) {
    options = options || {};

    const p = cleanPos(pos);
    if (!p) return { score: 0, reasons: [] };

    const t = now();
    const reasons = [];
    let total = 0;

    for (const poi of state.pois) {
      if (!poi || poi.depleted) continue;
      if (poi.type !== "hazard" && poi.type !== "death") continue;

      const d = dist(p, poi.pos);
      const radius = Math.max(1, Number(poi.radius || 16));

      if (d > radius) continue;

      let danger = Number(poi.danger || 0.6) * decayedConfidence(poi);

      if (poi.type === "death") {
        if (poi.avoidUntil && t <= poi.avoidUntil) {
          danger = Math.max(danger, 0.95);
        } else {
          danger *= 0.45;
        }
      }

      if (poi.type === "hazard" && poi.avoidUntil && t > poi.avoidUntil) {
        danger *= 0.35;
      }

      const proximity = 1 - Math.min(1, d / radius);
      const contribution = danger * proximity;

      if (contribution > 0.03) {
        total += contribution;
        reasons.push({
          type: poi.type,
          name: poi.name,
          pos: poi.pos,
          distance: Math.round(d * 10) / 10,
          contribution: Math.round(contribution * 100) / 100,
          lastSeen: poi.lastSeen,
          avoidUntil: poi.avoidUntil || null
        });
      }
    }

    total = Math.max(0, Math.min(1, total));

    reasons.sort(function(a, b) {
      return b.contribution - a.contribution;
    });

    return {
      score: total,
      reasons: reasons.slice(0, 5)
    };
  }

  function shouldAvoid(pos, options) {
    options = options || {};
    const d = dangerAt(pos, options);
    const threshold = Number(options.threshold || state.config.avoidDangerThreshold || 0.55);

    return {
      avoid: d.score >= threshold,
      score: d.score,
      threshold: threshold,
      reasons: d.reasons
    };
  }

  function normalizeResourceName(name) {
    const n = safeText(name).toLowerCase();

    if (n.indexOf("cobble") >= 0 || n === "stone" || n.indexOf("돌") >= 0) return "stone";
    if (n.indexOf("log") >= 0 || n.indexOf("wood") >= 0 || n.indexOf("tree") >= 0 || n.indexOf("나무") >= 0) return "logs";
    if (n.indexOf("iron") >= 0 || n.indexOf("철") >= 0) return "iron_ore";
    if (n.indexOf("coal") >= 0 || n.indexOf("석탄") >= 0) return "coal_ore";
    if (n.indexOf("food") >= 0 || n.indexOf("음식") >= 0) return "food_mob";

    return n;
  }

  function rankPois(filter, options) {
    options = options || {};
    filter = filter || {};

    const refPos = cleanPos(options.pos || getBotPos());
    const maxDanger = Number.isFinite(Number(options.maxDanger)) ? Number(options.maxDanger) : 0.65;
    const limit = Number(options.limit || 10);

    let type = filter.type ? safeText(filter.type) : null;
    let name = filter.name ? normalizeResourceName(filter.name) : null;

    return state.pois.map(function(p) {
      if (!p || p.depleted) return null;
      if (type && p.type !== type) return null;
      if (name && normalizeResourceName(p.name) !== name) return null;

      const danger = dangerAt(p.pos).score;
      if (options.avoidDanger !== false && danger > maxDanger) return null;

      let score = 0;
      score += decayedConfidence(p) * 1.2;
      score += Math.min(0.4, (p.seenCount || 1) * 0.03);
      score += recencyScore(p.lastSeen || p.createdAt, state.config.resourceHalfLifeMs) * 0.3;
      score -= danger * 0.9;

      if (refPos && p.pos) {
        const d = dist(refPos, p.pos);
        score += Math.max(0, 0.6 - d / 140);
        score -= Math.max(0, d - 80) / 600;
      }

      return {
        score: score,
        danger: danger,
        poi: p
      };
    }).filter(Boolean).sort(function(a, b) {
      return b.score - a.score;
    }).slice(0, limit).map(function(x) {
      const p = Object.assign({}, x.poi);
      p.memoryScore = Math.round(x.score * 100) / 100;
      p.dangerScore = Math.round(x.danger * 100) / 100;
      return p;
    });
  }

  function bestPoiFor(name, options) {
    options = options || {};

    let type = options.type || "resource";

    if (normalizeResourceName(name) === "food_mob") type = "food_mob";
    if (safeText(name).toLowerCase().indexOf("death") >= 0) type = "death";
    if (safeText(name).toLowerCase().indexOf("hazard") >= 0) type = "hazard";

    const list = rankPois({
      type: type,
      name: name
    }, Object.assign({}, options, { limit: 1 }));

    return list[0] || null;
  }

  function trimAll() {
    if (state.episodic.length > state.config.maxEvents) {
      state.episodic.sort(function(a, b) {
        const as = (a.importance || 0) * 2 + recencyScore(a.at, state.config.eventHalfLifeMs);
        const bs = (b.importance || 0) * 2 + recencyScore(b.at, state.config.eventHalfLifeMs);
        return bs - as;
      });

      state.episodic = state.episodic.slice(0, state.config.maxEvents);
      state.episodic.sort(function(a, b) {
        return (a.at || 0) - (b.at || 0);
      });
    }

    if (state.pois.length > state.config.maxPois) {
      state.pois.sort(function(a, b) {
        function s(p) {
          let v = decayedConfidence(p);
          if (p.type === "death") v += 2;
          if (p.type === "hazard") v += 1;
          if (p.type === "station" || p.type === "storage" || p.type === "base") v += 0.8;
          if (p.depleted) v -= 1;
          return v;
        }

        return s(b) - s(a);
      });

      state.pois = state.pois.slice(0, state.config.maxPois);
    }
  }

  function buildBrief() {
    const b = getBot();
    const p = getBotPos();

    const lines = [];

    lines.push("Adam Long-Term Memory Brief");
    lines.push("version: " + VERSION);
    lines.push("updatedAt: " + new Date(state.updatedAt || now()).toISOString());

    if (p) {
      lines.push("currentPos: x=" + p.x + " y=" + p.y + " z=" + p.z + " dim=" + getDimension(b));
      const danger = shouldAvoid(p);
      lines.push("currentDanger: " + Math.round(danger.score * 100) / 100 + " avoid=" + danger.avoid);
    }

    const deaths = state.pois.filter(function(x) {
      return x && x.type === "death" && !x.depleted;
    }).sort(function(a, b) {
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    }).slice(0, 5);

    if (deaths.length) {
      lines.push("");
      lines.push("피해야 할 죽음 위치:");
      for (const d of deaths) {
        lines.push("- " + d.name + " at " + JSON.stringify(d.pos) + " danger=" + d.danger + " avoidUntil=" + (d.avoidUntil ? new Date(d.avoidUntil).toISOString() : "none"));
      }
    }

    const hazards = rankPois({ type: "hazard" }, { limit: 6, avoidDanger: false });
    if (hazards.length) {
      lines.push("");
      lines.push("최근 위험 구역:");
      for (const h of hazards) {
        lines.push("- " + h.name + " at " + JSON.stringify(h.pos) + " score=" + h.memoryScore + " danger=" + h.dangerScore);
      }
    }

    const resources = []
      .concat(rankPois({ type: "resource", name: "stone" }, { limit: 3 }))
      .concat(rankPois({ type: "resource", name: "logs" }, { limit: 3 }))
      .concat(rankPois({ type: "resource", name: "iron_ore" }, { limit: 3 }))
      .concat(rankPois({ type: "resource", name: "coal_ore" }, { limit: 3 }));

    if (resources.length) {
      lines.push("");
      lines.push("사용 가능한 자원 POI:");
      for (const r of resources.slice(0, 12)) {
        lines.push("- " + r.name + "/" + r.subtype + " at " + JSON.stringify(r.pos) + " score=" + r.memoryScore + " danger=" + r.dangerScore);
      }
    }

    const stations = []
      .concat(rankPois({ type: "station" }, { limit: 5 }))
      .concat(rankPois({ type: "storage" }, { limit: 3 }))
      .concat(rankPois({ type: "base" }, { limit: 3 }));

    if (stations.length) {
      lines.push("");
      lines.push("기지/도구 위치:");
      for (const s of stations.slice(0, 10)) {
        lines.push("- " + s.type + ":" + s.name + " at " + JSON.stringify(s.pos));
      }
    }

    const importantEvents = state.episodic.slice(-80).filter(function(e) {
      return e && (e.importance || 0) >= 0.55;
    }).slice(-8);

    if (importantEvents.length) {
      lines.push("");
      lines.push("최근 중요 사건:");
      for (const e of importantEvents) {
        lines.push("- [" + e.kind + "] " + new Date(e.at).toISOString() + " " + e.text.slice(0, 180));
      }
    }

    return lines.join("\n");
  }

  function writeBrief() {
    try {
      atomicWrite(BRIEF_FILE, buildBrief());
    } catch (_) {}
  }

  function isAirLike(block) {
    if (!block) return true;
    if (block.name === "air" || block.name === "cave_air" || block.name === "void_air") return true;
    if (block.boundingBox === "empty") return true;
    return false;
  }

  function airNeighborCount(b, block) {
    if (!b || !block || !block.position) return 0;

    const dirs = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    let count = 0;

    for (const d of dirs) {
      try {
        const adj = b.blockAt(offsetPos(block.position, d[0], d[1], d[2]));
        if (isAirLike(adj)) count++;
      } catch (_) {}
    }

    return count;
  }

  function maybeRememberCaveAt(b, block) {
    if (!b || !block || !block.position) return;

    const name = safeText(block.name);
    if (STONE_BLOCKS.indexOf(name) < 0) return;

    const p = cleanPos(block.position);
    if (!p) return;

    const airCount = airNeighborCount(b, block);

    let lowSky = false;
    try {
      if (typeof block.skyLight === "number") {
        lowSky = block.skyLight < 8;
      } else {
        lowSky = p.y < 62;
      }
    } catch (_) {
      lowSky = p.y < 62;
    }

    if (airCount >= 2 && lowSky) {
      upsertPoi({
        type: "terrain",
        name: "cave_candidate",
        subtype: "stone_air_pocket",
        pos: p,
        dimension: getDimension(b),
        confidence: 0.35,
        danger: 0.25,
        radius: 18,
        source: "visible_block_scan",
        tags: ["cave", "stone", "동굴", "탐험후보"],
        evidence: {
          block: name,
          airNeighborCount: airCount,
          skyLight: block.skyLight
        }
      });
    }
  }

  function scanBlocks(b) {
    if (!b || typeof b.blockAt !== "function") return 0;

    let count = 0;
    let positions = [];

    if (typeof b.findBlocks === "function") {
      try {
        positions = b.findBlocks({
          matching: function(block) {
            return !!(block && classifyBlockName(block.name));
          },
          maxDistance: state.config.scanBlockRadius,
          count: state.config.scanBlockCount
        }) || [];
      } catch (_) {
        positions = [];
      }
    }

    if (!positions.length && b.entity && b.entity.position) {
      const origin = b.entity.position;
      const r = 16;

      outer:
      for (let dx = -r; dx <= r; dx += 2) {
        for (let dy = -8; dy <= 8; dy += 2) {
          for (let dz = -r; dz <= r; dz += 2) {
            if (count >= 40) break outer;

            try {
              const block = b.blockAt(offsetPos(origin, dx, dy, dz));
              const cls = block && classifyBlockName(block.name);
              if (!cls) continue;

              upsertPoi({
                type: cls.type,
                name: cls.name,
                subtype: cls.subtype,
                pos: block.position,
                dimension: getDimension(b),
                confidence: cls.confidence,
                danger: cls.danger,
                source: "fallback_block_scan",
                tags: cls.tags,
                evidence: { block: block.name }
              });

              maybeRememberCaveAt(b, block);
              count++;
            } catch (_) {}
          }
        }
      }

      return count;
    }

    for (const pos of positions) {
      try {
        const block = b.blockAt(pos);
        const cls = block && classifyBlockName(block.name);
        if (!cls) continue;

        upsertPoi({
          type: cls.type,
          name: cls.name,
          subtype: cls.subtype,
          pos: block.position || pos,
          dimension: getDimension(b),
          confidence: cls.confidence,
          danger: cls.danger,
          source: "visible_block_scan",
          tags: cls.tags,
          evidence: { block: block.name }
        });

        maybeRememberCaveAt(b, block);
        count++;
      } catch (_) {}
    }

    return count;
  }

  function scanEntities(b) {
    if (!b || !b.entities || !b.entity || !b.entity.position) return 0;

    let count = 0;
    const t = now();
    const botPos = cleanPos(b.entity.position);

    for (const id of Object.keys(b.entities)) {
      const e = b.entities[id];
      if (!e || !e.position) continue;
      if (e === b.entity) continue;

      const p = cleanPos(e.position);
      if (!p) continue;

      const d = dist(botPos, p);
      if (d > state.config.scanEntityRadius) continue;

      const cls = classifyEntity(e);
      if (!cls) continue;

      const throttleKey = id + ":" + cls.type + ":" + cls.name;
      if (entityMemoryThrottle[throttleKey] && t - entityMemoryThrottle[throttleKey] < 10000) {
        continue;
      }

      entityMemoryThrottle[throttleKey] = t;

      upsertPoi({
        type: cls.type,
        name: cls.name,
        subtype: cls.subtype,
        pos: p,
        dimension: getDimension(b),
        confidence: cls.confidence,
        danger: cls.danger,
        radius: cls.radius,
        source: "entity_scan",
        tags: cls.tags,
        evidence: {
          entityName: entityRawName(e),
          distance: Math.round(d * 10) / 10
        }
      });

      count++;
    }

    return count;
  }

  function scanNow(reason) {
    const b = getBot();

    if (!botReady(b)) {
      return {
        ok: false,
        reason: "bot not ready"
      };
    }

    const t = now();

    if (reason !== "manual" && t - lastScanAt < state.config.scanIntervalMs) {
      return {
        ok: false,
        reason: "scan throttled"
      };
    }

    lastScanAt = t;

    state.runtime.lastPos = cleanPos(b.entity.position);
    state.runtime.lastDimension = getDimension(b);

    const blockCount = scanBlocks(b);
    const entityCount = scanEntities(b);

    incCounter("scan");
    incCounter("scan_blocks_seen", blockCount);
    incCounter("scan_entities_seen", entityCount);

    if (reason === "manual") {
      rememberEvent("scan", "수동 장기기억 스캔 완료", {
        blockCount: blockCount,
        entityCount: entityCount,
        pos: state.runtime.lastPos
      }, 0.35);
    }

    scheduleSave(false);

    return {
      ok: true,
      blockCount: blockCount,
      entityCount: entityCount
    };
  }

  function nearestHostile(b, maxDistance) {
    if (!b || !b.entities || !b.entity || !b.entity.position) return null;

    const botPos = cleanPos(b.entity.position);
    let best = null;
    let bestD = Infinity;

    for (const id of Object.keys(b.entities)) {
      const e = b.entities[id];
      if (!e || !e.position) continue;

      const cls = classifyEntity(e);
      if (!cls || cls.type !== "hazard") continue;

      const d = dist(botPos, e.position);
      if (d < bestD && d <= maxDistance) {
        best = { entity: e, cls: cls, distance: d };
        bestD = d;
      }
    }

    return best;
  }

  function extractDroppedItemName(e) {
    if (!e) return "unknown_item";

    try {
      const data = getMcData();
      const meta = e.metadata || [];

      for (const m of meta) {
        if (!m) continue;

        if (m.itemId && data && data.items && data.items[m.itemId]) {
          return data.items[m.itemId].name || "unknown_item";
        }

        if (m.item && m.item.name) return m.item.name;
        if (m.name) return m.name;
      }
    } catch (_) {}

    return entityRawName(e) || "unknown_item";
  }

  function installHooksForBot(b) {
    if (!b || installedBots.has(b)) return;

    installedBots.add(b);

    state.botName = b.username || state.botName || "Adam";

    rememberEvent("system", "장기기억 훅 설치 완료", {
      botName: state.botName,
      version: b.version || null
    }, 0.45);

    try {
      b.on("spawn", function() {
        state.runtime.lastSpawnAt = now();
        state.runtime.lastHealth = typeof b.health === "number" ? b.health : null;
        state.runtime.lastFood = typeof b.food === "number" ? b.food : null;
        state.runtime.lastPos = getBotPos();
        state.runtime.lastDimension = getDimension(b);

        rememberEvent("spawn", "스폰/리스폰 위치 기록", {
          pos: state.runtime.lastPos,
          health: state.runtime.lastHealth,
          food: state.runtime.lastFood
        }, 0.45);

        if (state.runtime.lastPos) {
          upsertPoi({
            type: "base",
            name: "spawn_or_respawn",
            pos: state.runtime.lastPos,
            dimension: getDimension(b),
            confidence: 0.55,
            danger: 0,
            radius: 8,
            source: "spawn",
            tags: ["spawn", "base_candidate", "리스폰"],
            evidence: {}
          });
        }

        setTimeout(function() {
          try {
            scanNow("spawn");
          } catch (_) {}
        }, 1500);
      });
    } catch (_) {}

    try {
      b.on("death", function() {
        rememberDeath("bot death event");
      });
    } catch (_) {}

    try {
      b.on("health", function() {
        const oldHealth = state.runtime.lastHealth;
        const oldFood = state.runtime.lastFood;

        const h = typeof b.health === "number" ? b.health : null;
        const f = typeof b.food === "number" ? b.food : null;

        state.runtime.lastPos = getBotPos();
        state.runtime.lastHealth = h;
        state.runtime.lastFood = f;

        if (oldHealth !== null && h !== null && h < oldHealth - 0.4) {
          const damage = Math.round((oldHealth - h) * 100) / 100;
          const hostile = nearestHostile(b, 24);

          const meta = {
            type: "damage",
            damage: damage,
            oldHealth: oldHealth,
            newHealth: h,
            food: f,
            pos: state.runtime.lastPos,
            suspectedAttacker: hostile ? {
              name: hostile.cls.name,
              subtype: hostile.cls.subtype,
              distance: Math.round(hostile.distance * 10) / 10,
              pos: cleanPos(hostile.entity.position)
            } : null
          };

          rememberEvent("damage", "피해를 입음: " + damage + ". 주변 위험을 기억한다.", meta, 0.75);

          if (hostile && hostile.entity && hostile.entity.position) {
            upsertPoi({
              type: "hazard",
              name: hostile.cls.name,
              subtype: hostile.cls.subtype,
              pos: hostile.entity.position,
              dimension: getDimension(b),
              confidence: 0.95,
              danger: hostile.cls.danger,
              radius: hostile.cls.radius,
              source: "damage_suspected_attacker",
              tags: hostile.cls.tags,
              evidence: meta
            });
          }

          if (state.runtime.lastPos) {
            upsertPoi({
              type: "hazard",
              name: "recent_damage_area",
              subtype: hostile ? hostile.cls.name : "unknown",
              pos: state.runtime.lastPos,
              dimension: getDimension(b),
              confidence: 0.75,
              danger: hostile ? hostile.cls.danger : 0.65,
              radius: 18,
              source: "damage_location",
              tags: ["damage", "danger", "위험"],
              evidence: meta
            });
          }
        }

        if (oldFood !== null && f !== null && f <= 6 && oldFood > 6) {
          rememberEvent("survival", "배고픔 위험 상태 진입. 다음 의사결정에서 음식 우선.", {
            oldFood: oldFood,
            newFood: f,
            pos: state.runtime.lastPos
          }, 0.7);
        }

        scheduleSave(false);
      });
    } catch (_) {}

    try {
      b.on("playerCollect", function(collector, collected) {
        try {
          if (!collector || collector !== b.entity) return;

          const itemName = extractDroppedItemName(collected);

          rememberEvent("collect", "아이템 획득: " + itemName, {
            item: itemName,
            pos: collected && collected.position ? cleanPos(collected.position) : getBotPos()
          }, 0.35);
        } catch (_) {}
      });
    } catch (_) {}

    try {
      b.on("blockUpdate", function(oldBlock, newBlock) {
        const t = now();
        const p = cleanPos((newBlock && newBlock.position) || (oldBlock && oldBlock.position));
        if (!p) return;

        const key = posKey(p);
        if (blockUpdateThrottle[key] && t - blockUpdateThrottle[key] < 4000) return;
        blockUpdateThrottle[key] = t;

        const oldCls = oldBlock && classifyBlockName(oldBlock.name);
        const newCls = newBlock && classifyBlockName(newBlock.name);

        if (newCls) {
          upsertPoi({
            type: newCls.type,
            name: newCls.name,
            subtype: newCls.subtype,
            pos: p,
            dimension: getDimension(b),
            confidence: newCls.confidence,
            danger: newCls.danger,
            source: "block_update",
            tags: newCls.tags,
            evidence: {
              oldBlock: oldBlock ? oldBlock.name : null,
              newBlock: newBlock ? newBlock.name : null
            }
          });
        }

        if (oldCls && (!newBlock || isAirLike(newBlock))) {
          markDepleted(oldCls.type, oldCls.name, p);
        }
      });
    } catch (_) {}

    try {
      b.on("entitySpawn", function(e) {
        try {
          if (!e || !e.position) return;

          const cls = classifyEntity(e);
          if (!cls) return;

          upsertPoi({
            type: cls.type,
            name: cls.name,
            subtype: cls.subtype,
            pos: e.position,
            dimension: getDimension(b),
            confidence: cls.confidence,
            danger: cls.danger,
            radius: cls.radius,
            source: "entity_spawn",
            tags: cls.tags,
            evidence: {
              entityName: entityRawName(e)
            }
          });
        } catch (_) {}
      });
    } catch (_) {}

    try {
      b.on("kicked", function(reason) {
        rememberEvent("system", "봇이 서버에서 kick됨", {
          reason: safeText(reason)
        }, 0.6);
      });
    } catch (_) {}

    try {
      b.on("end", function(reason) {
        rememberEvent("system", "봇 연결 종료", {
          reason: safeText(reason)
        }, 0.45);
        scheduleSave(true);
      });
    } catch (_) {}

    try {
      b.on("error", function(err) {
        rememberEvent("error", "봇 에러 기록: " + safeText(err && err.message ? err.message : err), {
          error: sanitize(err)
        }, 0.65);
      });
    } catch (_) {}

    log("봇 이벤트 기억 훅 설치 완료: " + (b.username || "unknown"));
  }

  function evalGet(name) {
    if (!ctx.evalInCitizen) return undefined;

    try {
      return ctx.evalInCitizen("typeof " + name + " !== \"undefined\" ? " + name + " : undefined");
    } catch (_) {
      return undefined;
    }
  }

  function evalSet(name, value) {
    if (!ctx.evalInCitizen) return false;

    try {
      ctx.evalInCitizen(name + " = value", value);
      return true;
    } catch (err) {
      log("함수 교체 실패: " + name + " / " + safeText(err.message || err));
      return false;
    }
  }

  function zeroEmbedding() {
    const n = Number(state.config.embeddingDimensions || 256);
    return Array.from({ length: n }, function() {
      return 0;
    });
  }

  function fallbackForFunction(name, firstArg) {
    const lower = safeText(name).toLowerCase();

    if (lower.indexOf("importance") >= 0) {
      return estimateImportance(firstArg, {});
    }

    if (lower.indexOf("embed") >= 0 || lower.indexOf("embedding") >= 0) {
      return zeroEmbedding();
    }

    return null;
  }

  function wrapTextFunction(name) {
    const oldFn = evalGet(name);
    if (typeof oldFn !== "function") return false;
    if (oldFn.__adamMemoryTextWrapped) return true;

    const newFn = function() {
      const args = Array.prototype.slice.call(arguments);
      args[0] = safeText(args[0]);

      try {
        const result = oldFn.apply(this, args);

        if (result && typeof result.then === "function") {
          return result.catch(function(err) {
            rememberEvent("memory_error", name + " 실패. fallback 사용.", {
              error: sanitize(err),
              input: args[0]
            }, 0.55);

            return fallbackForFunction(name, args[0]);
          });
        }

        return result;
      } catch (err) {
        rememberEvent("memory_error", name + " 예외. fallback 사용.", {
          error: sanitize(err),
          input: args[0]
        }, 0.55);

        return fallbackForFunction(name, args[0]);
      }
    };

    Object.defineProperty(newFn, "__adamMemoryTextWrapped", { value: true });

    if (evalSet(name, newFn)) {
      log("문자열 안전 wrapper 설치: " + name);
      return true;
    }

    return false;
  }

  function wrapAddMemory() {
    const oldFn = evalGet("addMemory");
    if (typeof oldFn !== "function") return false;
    if (oldFn.__adamLongTermMemoryWrapped) return true;

    const newFn = function() {
      const args = Array.prototype.slice.call(arguments);

      const desc = safeText(args[0]);
      args[0] = desc;

      if (args.length > 1) {
        args[1] = sanitize(args[1], 0);
      }

      rememberEvent("legacy_memory", desc, {
        originalMeta: args.length > 1 ? args[1] : null
      }, estimateImportance(desc, args[1]));

      try {
        const result = oldFn.apply(this, args);

        if (result && typeof result.then === "function") {
          return result.catch(function(err) {
            rememberEvent("memory_error", "기존 addMemory 실패. 장기기억에는 저장했고 메인 루프는 살린다.", {
              error: sanitize(err),
              description: desc
            }, 0.7);

            log("기존 addMemory 실패를 흡수함: " + safeText(err.message || err));
            return null;
          });
        }

        return result;
      } catch (err) {
        rememberEvent("memory_error", "기존 addMemory 예외. 장기기억에는 저장했고 메인 루프는 살린다.", {
          error: sanitize(err),
          description: desc
        }, 0.7);

        log("기존 addMemory 예외를 흡수함: " + safeText(err.message || err));
        return null;
      }
    };

    Object.defineProperty(newFn, "__adamLongTermMemoryWrapped", { value: true });

    if (evalSet("addMemory", newFn)) {
      log("addMemory 장기기억 bridge 설치 완료");
      return true;
    }

    return false;
  }

  function summarizeAction(action) {
    if (typeof action === "string") return action.slice(0, 300);

    if (!action || typeof action !== "object") return safeText(action).slice(0, 300);

    const parts = [];

    for (const k of ["type", "action", "name", "target", "item", "goal", "count", "reason"]) {
      if (typeof action[k] !== "undefined") {
        parts.push(k + "=" + safeText(action[k]));
      }
    }

    if (!parts.length) return safeText(action).slice(0, 300);

    return parts.join(" ");
  }

  function interestingAction(action) {
    const s = summarizeAction(action).toLowerCase();

    const keys = [
      "mine", "gather", "wood", "log", "stone", "craft",
      "fight", "attack", "flee", "escape", "eat", "food",
      "smelt", "explore", "move", "goto"
    ];

    for (const k of keys) {
      if (s.indexOf(k) >= 0) return true;
    }

    return false;
  }

  function wrapPerformBuiltinAction() {
    const oldFn = evalGet("performBuiltinAction");
    if (typeof oldFn !== "function") return false;
    if (oldFn.__adamMemoryActionWrapped) return true;

    const newFn = async function() {
      const args = Array.prototype.slice.call(arguments);
      const action = args[0];
      const summary = summarizeAction(action);
      const interesting = interestingAction(action);

      const startPos = getBotPos();
      const startedAt = now();

      if (interesting) {
        rememberEvent("action_start", "행동 시작: " + summary, {
          action: sanitize(action),
          pos: startPos
        }, 0.25);
      }

      try {
        const result = await oldFn.apply(this, args);

        if (interesting) {
          rememberEvent("action_result", "행동 결과: " + summary + " => " + safeText(result), {
            action: sanitize(action),
            result: sanitize(result),
            durationMs: now() - startedAt,
            startPos: startPos,
            endPos: getBotPos()
          }, result === false ? 0.55 : 0.35);
        }

        return result;
      } catch (err) {
        if (interesting) {
          rememberEvent("action_error", "행동 실패/예외: " + summary + " / " + safeText(err.message || err), {
            action: sanitize(action),
            error: sanitize(err),
            durationMs: now() - startedAt,
            startPos: startPos,
            endPos: getBotPos()
          }, 0.75);
        }

        throw err;
      }
    };

    Object.defineProperty(newFn, "__adamMemoryActionWrapped", { value: true });

    if (evalSet("performBuiltinAction", newFn)) {
      log("performBuiltinAction 행동 기억 wrapper 설치 완료");
      return true;
    }

    return false;
  }

  function wrapThinkFunction(name) {
    const oldFn = evalGet(name);
    if (typeof oldFn !== "function") return false;
    if (oldFn.__adamMemoryThinkWrapped) return true;

    const newFn = async function() {
      try {
        scanNow("pre_think");
      } catch (_) {}

      return oldFn.apply(this, arguments);
    };

    Object.defineProperty(newFn, "__adamMemoryThinkWrapped", { value: true });

    if (evalSet(name, newFn)) {
      log(name + " pre-think memory scan wrapper 설치 완료");
      return true;
    }

    return false;
  }

  function installFunctionWrappers() {
    wrapAddMemory();

    wrapTextFunction("estimateImportanceHeuristic");
    wrapTextFunction("getEmbedding");
    wrapTextFunction("embedText");
    wrapTextFunction("generateEmbedding");
    wrapTextFunction("createEmbedding");

    wrapPerformBuiltinAction();

    wrapThinkFunction("thinkAndAct");
    wrapThinkFunction("selfDevThinkAndAct");
  }

  function guessTypeFromLegacy(node) {
    const s = safeText(node).toLowerCase();

    if (s.indexOf("death") >= 0 || s.indexOf("죽") >= 0 || s.indexOf("사망") >= 0) return "death";
    if (s.indexOf("hazard") >= 0 || s.indexOf("danger") >= 0 || s.indexOf("위험") >= 0) return "hazard";
    if (s.indexOf("cave") >= 0 || s.indexOf("동굴") >= 0) return "terrain";
    if (s.indexOf("crafting_table") >= 0 || s.indexOf("furnace") >= 0) return "station";
    if (s.indexOf("chest") >= 0) return "storage";

    return "resource";
  }

  function guessNameFromLegacy(node) {
    const s = safeText(node).toLowerCase();

    if (s.indexOf("stone") >= 0 || s.indexOf("돌") >= 0) return "stone";
    if (s.indexOf("log") >= 0 || s.indexOf("wood") >= 0 || s.indexOf("나무") >= 0) return "logs";
    if (s.indexOf("iron") >= 0 || s.indexOf("철") >= 0) return "iron_ore";
    if (s.indexOf("coal") >= 0 || s.indexOf("석탄") >= 0) return "coal_ore";
    if (s.indexOf("death") >= 0 || s.indexOf("죽") >= 0 || s.indexOf("사망") >= 0) return "death_site";
    if (s.indexOf("cave") >= 0 || s.indexOf("동굴") >= 0) return "cave_candidate";
    if (s.indexOf("crafting_table") >= 0) return "crafting_table";
    if (s.indexOf("furnace") >= 0) return "furnace";
    if (s.indexOf("chest") >= 0) return "chest";

    return "unknown";
  }

  function importLegacyPositions() {
    if (state.flags.importedLegacyPositions) return;
    if (!fs.existsSync(LEGACY_WORLD_FILE)) {
      state.flags.importedLegacyPositions = true;
      scheduleSave(false);
      return;
    }

    let parsed = null;

    try {
      parsed = JSON.parse(fs.readFileSync(LEGACY_WORLD_FILE, "utf8"));
    } catch (_) {
      state.flags.importedLegacyPositions = true;
      scheduleSave(false);
      return;
    }

    let imported = 0;

    function walk(node, depth) {
      if (!node || imported >= 200 || depth > 7) return;

      if (Array.isArray(node)) {
        for (const x of node) walk(x, depth + 1);
        return;
      }

      if (typeof node !== "object") return;

      const p = posFromAny(node);

      if (p) {
        const type = guessTypeFromLegacy(node);
        const name = guessNameFromLegacy(node);

        upsertPoi({
          type: type,
          name: name,
          pos: p,
          dimension: node.dimension || "overworld",
          confidence: 0.45,
          danger: type === "death" || type === "hazard" ? 0.8 : 0.05,
          source: "legacy_worldmap_import",
          tags: ["legacy", type, name],
          evidence: sanitize(node, 0)
        });

        imported++;
      }

      for (const k of Object.keys(node)) {
        walk(node[k], depth + 1);
      }
    }

    walk(parsed, 0);

    state.flags.importedLegacyPositions = true;

    if (imported > 0) {
      rememberEvent("system", "기존 worldmap_Adam.json에서 POI 가져옴: " + imported + "개", {
        imported: imported
      }, 0.5);

      log("legacy worldmap POI import 완료: " + imported + "개");
    }

    scheduleSave(false);
  }

  function tryInstallBotHooks() {
    const b = getBot();

    if (!b) return;

    installHooksForBot(b);

    if (botReady(b)) {
      state.runtime.lastPos = getBotPos();
      state.runtime.lastDimension = getDimension(b);

      if (state.runtime.lastHealth === null && typeof b.health === "number") {
        state.runtime.lastHealth = b.health;
      }

      if (state.runtime.lastFood === null && typeof b.food === "number") {
        state.runtime.lastFood = b.food;
      }
    }
  }

  const api = {
    version: VERSION,
    stateFile: DATA_FILE,
    briefFile: BRIEF_FILE,

    status: function() {
      return {
        version: VERSION,
        stateFile: DATA_FILE,
        briefFile: BRIEF_FILE,
        events: state.episodic.length,
        pois: state.pois.length,
        counters: state.counters,
        lastPos: state.runtime.lastPos,
        lastDeath: state.facts.lastDeath || null
      };
    },

    remember: function(text, meta, importance) {
      return rememberEvent("manual", text, meta || {}, importance);
    },

    rememberEvent: rememberEvent,
    rememberDeath: rememberDeath,
    addPOI: upsertPoi,
    markDepleted: markDepleted,
    scanNow: function() {
      return scanNow("manual");
    },
    recall: recall,
    brief: buildBrief,
    dangerAt: dangerAt,
    shouldAvoid: shouldAvoid,
    bestPoiFor: bestPoiFor,

    getResourceTargets: function(name, options) {
      return rankPois({
        type: "resource",
        name: normalizeResourceName(name)
      }, options || {});
    },

    getPOIs: function(filter, options) {
      return rankPois(filter || {}, options || {});
    },

    exportState: function() {
      return state;
    },

    saveNow: saveNow,

    clearRuntimeErrorsOnly: function() {
      state.episodic = state.episodic.filter(function(e) {
        return e.kind !== "memory_error";
      });

      scheduleSave(true);
      return true;
    }
  };

  globalThis.AdamMemory = api;
  globalThis.AdamMemoryContext = function() {
    return buildBrief();
  };

  importLegacyPositions();
  installFunctionWrappers();
  tryInstallBotHooks();

  setInterval(function() {
    try {
      tryInstallBotHooks();
    } catch (_) {}
  }, 2500);

  setInterval(function() {
    try {
      scanNow("interval");
    } catch (_) {}
  }, state.config.scanIntervalMs || 15000);

  saveNow();

  log("로드 완료. 장기기억/POI/죽음위치/위험구역/기존 addMemory 보호 활성화.");
  log("state=" + DATA_FILE);
  log("brief=" + BRIEF_FILE);

  return api;
}

module.exports = {
  install: install
};
