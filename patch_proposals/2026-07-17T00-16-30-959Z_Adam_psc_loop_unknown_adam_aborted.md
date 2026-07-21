# Adam Problem Solving Proposal

- problem: loop_unknown_adam_aborted
- bot: Adam
- time: 2026-07-17T00:16:30.959Z

## Analysis
Action unknown:adam repeatedly failed with reason aborted. Examples: spruce_log 등 나무를 4개 베어냈지만 중단했다: 채굴 중단: Digging aborted / spruce_log 등 나무를 2개 베어냈지만 중단했다: 채굴 중단: Digging aborted
[자동회수] 떨어진 아이템 회수: spruce_log×2 / spruce_log 등 나무를 1개 베어냈지만 중단했다: 채굴 중단: Digging aborted

## Suggested change
Do not retry the same action directly. Keep the goal, but switch to alternate strategies and POI-based navigation.

## Safety
This proposal was generated only as a suggestion. Adam did not modify source code automatically.