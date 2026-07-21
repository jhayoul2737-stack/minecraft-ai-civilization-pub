const assert = require('assert');
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
