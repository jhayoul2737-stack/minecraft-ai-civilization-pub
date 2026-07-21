const fs = require('fs');

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function defaultConfig() {
  return {
    version: 3,

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
      highPressureIntervalMs: 12000,
      normalIntervalMs: 35000,
      lowPressureIntervalMs: 80000,
      maxIntervalMs: 120000,
      maxActions: 2,
      maxPromptChars: 5200,
      maxTokens: 420,
      temperature: 0.45,
      apiRetries: 2,
      apiInitialBackoffMs: 1200,
      jsonRepair: true,
      fallbackOldThink: false
    },

    modelPolicy: {
      cheapModel: process.env.ADAM_CHEAP_MODEL || 'gpt-4o-mini',
      smartModel: process.env.ADAM_SMART_MODEL || 'gpt-4o',
      forceCheap: process.env.ADAM_FORCE_CHEAP === '1',
      allowSmart: process.env.ADAM_ALLOW_SMART_IN_MAX === '1',
      smartWhenSurvivalAbove: 0.75,
      smartWhenSocialAbove: 0.80,
      smartWhenFailureAbove: 0.55
    },

    pressure: {
      survival: {
        healthStart: 12,
        hungerStart: 14,
        threatBase: 0.25
      },
      queue: {
        baseWhenQueued: 0.38,
        diligence: 0.034,
        pragmatism: 0.018,
        failurePenalty: 0.45,
        surprisePenalty: 0.12,
        survivalPenalty: 0.28
      },
      selfDirection: {
        base: 0.18,
        idle: 0.24,
        observation: 0.09,
        surprise: 0.18,
        curiosity: 0.035,
        creativity: 0.025,
        survivalPenalty: 0.52,
        failurePenalty: 0.10
      },
      social: {
        recentSocial: 0.20,
        observation: 0.08,
        sociability: 0.035
      },
      exploration: {
        idle: 0.30,
        curiosity: 0.04,
        survivalPenalty: 0.55,
        cautionPenalty: 0.015
      },
      craft: {
        pragmatism: 0.05,
        shortage: 0.12,
        survivalPenalty: 0.25
      }
    },

    logging: {
      level: process.env.ADAM_PIANO_LOG_LEVEL || 'info',
      console: true,
      dir: 'logs'
    }
  };
}

function loadConfig(file, options = {}) {
  const base = defaultConfig();
  const createIfMissing = !!options.createIfMissing;

  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return deepMerge(base, raw || {});
    }

    if (createIfMissing) {
      fs.writeFileSync(file, JSON.stringify(base, null, 2));
    }
  } catch (e) {
    console.warn('⚠️ [PIANO V3] config load failed, using defaults:', e.message);
  }

  return base;
}

function initConfig(file, options = {}) {
  const overwrite = !!options.overwrite;
  const cfg = defaultConfig();

  if (fs.existsSync(file) && !overwrite) {
    return { created: false, file };
  }

  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return { created: true, file };
}

module.exports = { loadConfig, initConfig, defaultConfig, deepMerge };
