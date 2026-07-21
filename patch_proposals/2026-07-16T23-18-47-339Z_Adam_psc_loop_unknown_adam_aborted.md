# Adam Problem Solving Proposal

- problem: loop_unknown_adam_aborted
- bot: Adam
- time: 2026-07-16T23:18:47.339Z

## Analysis
Action unknown:adam repeatedly failed with reason aborted. Examples: spruce_log 등 나무를 4개 베어냈지만 중단했다: 채굴 중단: Digging aborted / spruce_log 등 나무를 11개 베어냈지만 중단했다: 채굴 중단: Digging aborted
[자동회수] 떨어진 아이템 회수: stick×3 / spruce_log 등 나무를 6개 베어냈지만 중단했다: 채굴 중단: Digging aborted
[자동회수] 떨어진 아이템 회수: spruce_sapling×1, spruce_log×1

## Suggested change
Do not retry the same action directly. Keep the goal, but switch to alternate strategies and POI-based navigation.

## Safety
This proposal was generated only as a suggestion. Adam did not modify source code automatically.