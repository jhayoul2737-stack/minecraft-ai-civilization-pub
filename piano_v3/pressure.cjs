function clamp(x, min, max) {
  x = Number(x);
  if (!Number.isFinite(x)) x = 0;
  return Math.max(min, Math.min(max, x));
}

function computePressures(input, config) {
  input = input || {};
  config = config || {};
  const c = config.pressure || {};

  const health = Number(input.health ?? 20);
  const food = Number(input.food ?? 20);
  const closeHostileDistance = input.closeHostileDistance;
  const queueLen = Number(input.queueLen || 0);
  const failRatio = clamp(input.failRatio || 0, 0, 1);
  const recentSocial = Number(input.recentSocial || 0);
  const recentObservation = Number(input.recentObservation || 0);
  const recentSurprise = Number(input.recentSurprise || 0);
  const idleMs = Number(input.idleMs || 0);
  const shortages = Array.isArray(input.shortages) ? input.shortages : [];

  const personality = input.personality || {};
  const curiosity = Number(personality.curiosity ?? 6);
  const caution = Number(personality.caution ?? 5);
  const diligence = Number(personality.diligence ?? 6);
  const sociability = Number(personality.sociability ?? 4);
  const creativity = Number(personality.creativity ?? 5);
  const pragmatism = Number(personality.pragmatism ?? 7);

  const sc = c.survival || {};
  const healthPressure = clamp(((sc.healthStart ?? 12) - health) / (sc.healthStart ?? 12), 0, 1);
  const hungerPressure = clamp(((sc.hungerStart ?? 14) - food) / (sc.hungerStart ?? 14), 0, 1);
  const regenPressure = health < 20 && food < 18 ? clamp((20 - health) / 20, 0, 1) : 0;

  let threatPressure = 0;
  if (Number.isFinite(Number(closeHostileDistance))) {
    threatPressure = clamp((9 - Number(closeHostileDistance)) / 9, sc.threatBase ?? 0.25, 1);
  }

  const survival = Math.max(healthPressure, hungerPressure, regenPressure, threatPressure);
  const idlePressure = clamp(idleMs / 150000, 0, 1);

  const qc = c.queue || {};
  const queue = clamp(
    (queueLen ? (qc.baseWhenQueued ?? 0.38) : 0) +
    diligence * (qc.diligence ?? 0.034) +
    pragmatism * (qc.pragmatism ?? 0.018) -
    failRatio * (qc.failurePenalty ?? 0.45) -
    recentSurprise * (qc.surprisePenalty ?? 0.12) -
    survival * (qc.survivalPenalty ?? 0.28),
    0,
    1
  );

  const sd = c.selfDirection || {};
  const selfDirection = clamp(
    (sd.base ?? 0.18) +
    idlePressure * (sd.idle ?? 0.24) +
    recentObservation * (sd.observation ?? 0.09) +
    recentSurprise * (sd.surprise ?? 0.18) +
    (curiosity - 5) * (sd.curiosity ?? 0.035) +
    (creativity - 5) * (sd.creativity ?? 0.025) -
    survival * (sd.survivalPenalty ?? 0.52) -
    failRatio * (sd.failurePenalty ?? 0.10),
    0,
    1
  );

  const soc = c.social || {};
  const social = clamp(
    recentSocial * (soc.recentSocial ?? 0.20) +
    recentObservation * (soc.observation ?? 0.08) +
    sociability * (soc.sociability ?? 0.035),
    0,
    1
  );

  const ex = c.exploration || {};
  const exploration = clamp(
    idlePressure * (ex.idle ?? 0.30) +
    (curiosity - 5) * (ex.curiosity ?? 0.04) -
    survival * (ex.survivalPenalty ?? 0.55) -
    caution * (ex.cautionPenalty ?? 0.015),
    0,
    1
  );

  const cr = c.craft || {};
  const craft = clamp(
    pragmatism * (cr.pragmatism ?? 0.05) +
    shortages.length * (cr.shortage ?? 0.12) -
    survival * (cr.survivalPenalty ?? 0.25),
    0,
    1
  );

  const reasons = [];
  if (survival > 0.65) reasons.push('survival pressure high');
  if (queue > 0.55) reasons.push('queue proposal is useful');
  if (selfDirection > 0.55) reasons.push('self-direction high');
  if (social > 0.50) reasons.push('social/observation pressure');
  if (failRatio > 0.40) reasons.push('recent failures require adaptation');

  return {
    survival: Number(survival.toFixed(2)),
    queue: Number(queue.toFixed(2)),
    selfDirection: Number(selfDirection.toFixed(2)),
    social: Number(social.toFixed(2)),
    exploration: Number(exploration.toFixed(2)),
    craft: Number(craft.toFixed(2)),
    idle: Number(idlePressure.toFixed(2)),
    failRatio: Number(failRatio.toFixed(2)),
    reason: reasons.join(' / ') || 'balanced'
  };
}

module.exports = { computePressures, clamp };
