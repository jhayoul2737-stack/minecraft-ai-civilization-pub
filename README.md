An experimental Mineflayer-based Minecraft agent ("Adam") built around a parallel-cognition architecture (PIANO-style: shared working memory + competing pressures + a central LLM executive).
This is an actively evolving system, for this README is written as a living plan. 
What this is
A Minecraft bot that:
* Perceives its environment (health, hunger, nearby threats/animals/players) on a fast loop
* Computes competing internal "pressures" (survival, queue/task, self-direction, social, exploration, craft) instead of hard-coded modes
* Periodically calls an LLM (currently OpenAI models) to make a judgment call given all of that state
* Falls back to local reflexes (eat, flee, etc.) when survival is urgent, without waiting on the LLM
* Treats chat commands from players as social input to weigh, not direct control switches

Version             What it addressed
V1                  (legacy Agency)Original mode-switch based agent logic
V2                  First PIANO-style rewrite: shared working memory, pressure model, monolithic patch
V3                  Split into modules (config.cjs, pressure.cjs, logger.cjs, index.cjs), added tests, adaptive executive scheduling, retry/backoff
V3.1                AST-based patching instead of fragile string anchors, per-instance runtime refs instead of ambiguous globals
V3.2–V3.5           Repeated fixes for anchor-finding failures, bot-only createCitizen returns, synthetic self handling, live-loop double-execution
V3.6 (current)      Dependency injection actually reaches the runtime; synthetic-self → real-self upgrade happens on every tick instead of being short-circuited

Architecture (subject to change)
citizen.cjs              — main bot entrypoint (mineflayer createCitizen, liveLoop, native actions)
piano_v3/
  index.cjs               — PianoRuntime: perception/needs/affordance/memory loops + executive
  bridge.cjs              — connects citizen.cjs's local functions/deps into the runtime
  pressure.cjs            — pure function: computes competing pressures from state
  config.cjs              — tunable coefficients, intervals, model policy
  logger.cjs               — structured JSONL logging
  tests/                  — unit tests for pressure calc + bridge behavior
logs/
  piano_Adam.jsonl         — structured event log (info/warn/error)
  piano_decisions_Adam.jsonl — every executive decision the LLM made
piano_status_Adam.json     — latest snapshot of mood/pressures/needs
piano_config_Adam.json     — per-bot tunable config (generated via init-config.cjs, not auto-created)

This project doesn't have a fixed version target — it develops in steps as issues surface. 
Rough phase plan:
Phase: Stabilize the runtime attach path (current)

* Confirm openai / action executor / memory deps actually reach PianoRuntime on every code path (export-time and liveLoop-time)
* Diagnose and fix the runaway re-initialization loop / [object global] memory corruption
* Unify the two separate dependency-collection lists (export bridge vs liveLoop hook) into one source of truth
* Replace eval()-based dependency lookup with plain typeof checks

Phase 2: Consolidate patch history into a clean base
* Once the runtime is stable for N hours without manual restarts, stop patching citizen.cjs at runtime
* Refactor the accumulated V1→V3.6 bridge logic directly into citizen.cjs as normal code, remove dead disabled blocks
* Retire the apply_piano_*.cjs patcher scripts once their job is done; keep them in git history, not in the active repo root

Phase 3: Observability
* piano_v3/tools/stats.cjs — CLI tool summarizing recent executive_decision / executive_failed counts and most common actions from the logs (in progress)
* Lightweight dashboard/view for pressures over time, to make coefficient tuning less guesswork-driven

Phase 4: Cost & model policy
* Validate cheap/smart model switching actually triggers under real survival/social/failure conditions
* Track real OpenAI usage against the intended cost-optimization design

Phase: Multi-agent
* Confirm multiple bots on the same process don't cross-contaminate runtime state
* Formalize AdamPianoV3 manager API once single-agent behavior is fully trusted

Running it
* npm install
* node piano_v3/init-config.cjs Adam   # generates piano_config_Adam.json if missing
* ADAM_PIANO_LIVELOOP_MODE=replace node index.cjs

 Useful env vars while debugging:
* ADAM_PIANO_LOG_DEPS=1         # log which dependencies were found on each attach
* ADAM_PIANO_STRICT_DEPS=1      # hard-fail instead of warn if openai/executor deps are missing
* ADAM_PIANO_STRICT_LIVELOOP=1  # hard-fail if the liveLoop runtime hook can't attach/tick
* ADAM_PIANO_LIVELOOP_MODE=parallel  # run legacy think/react loop alongside PIANO (not recommended, doubles LLM calls)

Run tests:
* npm run test:piano


