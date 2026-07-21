# Adam Problem Solving Proposal

- problem: loop_unknown_adam_missing_tool
- bot: Adam
- time: 2026-07-17T01:36:38.323Z

## Analysis
Action unknown:adam repeatedly failed with reason missing_tool. Examples: 'wooden_pickaxe' 제작 실패: Error: Event windowOpen did not fire within timeout of 20000ms / 'wooden_pickaxe' 제작 실패: Error: Event windowOpen did not fire within timeout of 20000ms / 'wooden_pickaxe' 제작 실패: Error: Event windowOpen did not fire within timeout of 20000ms

## Suggested change
Do not retry the same action directly. Keep the goal, but switch to alternate strategies and POI-based navigation.

## Safety
This proposal was generated only as a suggestion. Adam did not modify source code automatically.