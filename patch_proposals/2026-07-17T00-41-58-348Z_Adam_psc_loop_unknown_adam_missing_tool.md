# Adam Problem Solving Proposal

- problem: loop_unknown_adam_missing_tool
- bot: Adam
- time: 2026-07-17T00:41:58.348Z

## Analysis
Action unknown:adam repeatedly failed with reason missing_tool. Examples: 나무 도구를 만들 작업대를 준비하지 못했다. / 나무 도구를 만들 작업대를 준비하지 못했다. / 나무 도구를 만들 작업대를 준비하지 못했다.

## Suggested change
Do not retry the same action directly. Keep the goal, but switch to alternate strategies and POI-based navigation.

## Safety
This proposal was generated only as a suggestion. Adam did not modify source code automatically.