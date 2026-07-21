# Adam Problem Solving Proposal

- problem: loop_collect_drops_none_generic_failure
- bot: Adam
- time: 2026-07-21T05:20:00.280Z

## Analysis
Action collect_drops:none repeatedly failed with reason generic_failure. Examples: 근처에 회수할 드랍이 없다. / 근처에 회수할 드랍이 없다. / 근처에 회수할 드랍이 없다. / 근처에 회수할 드랍이 없다. / 근처에 회수할 드랍이 없다.

## Suggested change
Do not retry the same action directly. Keep the goal, but switch to alternate strategies and POI-based navigation.

## Safety
This proposal was generated only as a suggestion. Adam did not modify source code automatically.