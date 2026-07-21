'use strict';

const assert = require('assert');

process.env.ADAM_PIANO_ALLOW_SYNTHETIC_SELF = '1';
process.env.ADAM_PIANO_STRICT_ATTACH = '0';
process.env.ADAM_ENABLE_LEGACY_GLOBAL = '0';

const {
  inferSelfAndBot,
  attachPianoRuntime,
  wrapCreateCitizenExport,
  cleanupLegacyGlobal,
  depSummary,
} = require('../bridge.cjs');

function fakeOpenAI() {
  return {
    chat: {
      completions: {
        create() {},
      },
    },
  };
}

function fakeDeps(extra) {
  return Object.assign({
    openai: fakeOpenAI(),
    performBuiltinAction() {},
  }, extra || {});
}

let installCount = 0;

const mockPiano = {
  install(opts) {
    assert.strictEqual(arguments.length, 1, 'object install signature should be tried first');
    assert.ok(opts.bot, 'install opts.bot required');
    assert.ok(opts.self, 'install opts.self required');
    assert.ok(opts.deps, 'install opts.deps required');
    assert.ok(opts.deps.openai, 'install deps.openai required');

    installCount++;

    const rt = {
      name: opts.name || opts.self.name || opts.bot.username,
      bot: opts.bot,
      self: opts.self,
      source: opts.source,
      deps: Object.assign({}, opts.deps),
      tickCalls: [],
      tick(reason) {
        this.tickCalls.push(reason);
      },
    };

    return rt;
  },
};

(function testDepSummary() {
  const s = depSummary(fakeDeps());
  assert.strictEqual(s.hasOpenAI, true);
  assert.strictEqual(s.hasExecutor, true);
  assert.strictEqual(s.critical, true);
})();

(function testNoGlobalFallback() {
  const badBot = { username: 'BADBOT', emit() {}, once() {} };
  const badSelf = { name: 'BAD', bot: badBot };
  globalThis.__ADAM_LAST_SELF__ = badSelf;

  const bot = { username: 'A', emit() {}, once() {} };
  const self = { name: 'A', bot };

  const found = inferSelfAndBot(self, [], { allowSyntheticSelf: true });
  assert.strictEqual(found.self, self);
  assert.strictEqual(found.bot, bot);
  assert.strictEqual(badSelf.__pianoRuntime, undefined);
})();

(function testBotOnlyCreateCitizenWithDepsInstalls() {
  installCount = 0;

  const bot = { username: 'BOTONLY', emit() {}, once() {} };
  const wrapped = wrapCreateCitizenExport(() => bot, {
    piano: mockPiano,
    source: 'botOnlyTest',
    logger: { log() {}, warn() {} },
    getDeps: () => fakeDeps(),
  });

  const out = wrapped();

  assert.strictEqual(out, bot);
  assert.ok(bot.__pianoSyntheticSelf, 'synthetic self should be attached to bot');
  assert.ok(bot.__pianoRuntime, 'runtime should be attached to bot');
  assert.ok(bot.__pianoSyntheticSelf.__pianoRuntime, 'runtime should be attached to synthetic self');
  assert.strictEqual(installCount, 1);
})();

(function testCreateCitizenNoDepsDefersInsteadOfDeadInstall() {
  installCount = 0;

  const bot = { username: 'DEFER', emit() {}, once() {} };
  const wrapped = wrapCreateCitizenExport(() => bot, {
    piano: mockPiano,
    source: 'deferTest',
    logger: { log() {}, warn() {} },
    getDeps: () => ({}),
    deferIfDepsMissing: true,
  });

  const out = wrapped();

  assert.strictEqual(out, bot);
  assert.strictEqual(bot.__pianoRuntime, undefined, 'runtime should defer when deps incomplete');
  assert.strictEqual(installCount, 0);
})();

(function testSyntheticSelfUpgradesToRealSelfAndMergesDeps() {
  installCount = 0;

  const bot = { username: 'UPGRADE', emit() {}, once() {} };

  const rt1 = attachPianoRuntime({
    result: bot,
    args: [bot],
    piano: mockPiano,
    source: 'initialSynthetic',
    logger: { log() {}, warn() {} },
    deps: fakeDeps({ addMemory() {} }),
    allowSyntheticSelf: true,
  });

  assert.ok(rt1);
  assert.ok(rt1.self.__pianoSyntheticSelf);

  const realSelf = {
    name: 'UPGRADE',
    bot,
    state: { taskQueue: ['wood'] },
    actionHistory: [{ ok: true }],
  };

  const rt2 = attachPianoRuntime({
    result: realSelf,
    args: [realSelf, bot],
    piano: mockPiano,
    source: 'realSelfLiveLoop',
    logger: { log() {}, warn() {} },
    deps: fakeDeps({ executeDecision() {}, retrieveMemories() {} }),
    allowSyntheticSelf: true,
  });

  assert.strictEqual(rt2, rt1, 'same runtime should be reused');
  assert.strictEqual(rt1.self, realSelf, 'runtime self should upgrade to real self');
  assert.strictEqual(realSelf.__pianoRuntime, rt1);
  assert.strictEqual(bot.__pianoRuntime, rt1);
  assert.ok(rt1.deps.executeDecision, 'new deps should merge into runtime');
  assert.ok(rt1.deps.retrieveMemories, 'memory deps should merge into runtime');
})();

(function testUndefinedCreateCitizenDoesNotThrow() {
  installCount = 0;

  const wrapped = wrapCreateCitizenExport(() => undefined, {
    piano: mockPiano,
    source: 'undefinedTest',
    logger: { log() {}, warn() {} },
    getDeps: () => fakeDeps(),
  });

  assert.doesNotThrow(() => wrapped());
})();

(function testLegacyGlobalCleanup() {
  globalThis.AdamPiano = { legacy: true };
  cleanupLegacyGlobal();
  assert.strictEqual(globalThis.AdamPiano, undefined);
})();

console.log('bridge tests passed');
