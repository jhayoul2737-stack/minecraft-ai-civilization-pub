# Adam Self-Improvement Proposal

- Citizen: Adam
- Type: dig_drop_not_collected
- Created: 2026-07-16T15:05:44.035Z

## Symptom

Adam detected repeated abnormal or inefficient behavior.

## Details

```json
{
  "blockName": "spruce_leaves",
  "sweepText": "zombie 위험 때문에 드랍 회수를 중단했다.",
  "nearbyDrops": 5,
  "adjustedRules": {
    "dropSweepMaxDistance": [
      24,
      24
    ],
    "dropSweepRounds": [
      16,
      16
    ]
  }
}
```

## Current Adaptive Rules

```json
{
  "dropSweepMaxDistance": 24,
  "dropSweepRounds": 16,
  "digPickupRadius": 10,
  "digPickupRounds": 2,
  "quickPickupRadius": 4,
  "quickPickupCooldownMs": 6000,
  "dangerRadius": 8,
  "eatBeforeLongWorkFoodBelow": 14,
  "eatAfterWorkFoodBelow": 10
}
```

## Suggestion

Do not directly auto-edit citizen.cjs yet.
Review the logs and this proposal. If the pattern is valid, convert it into a stable patch.

Typical fixes may include:

1. Add a stronger postcondition check after the action.
2. Verify inventory delta instead of trusting action text.
3. Increase recovery attempts only when danger is absent.
4. Add a native action instead of relying on generated skill code.
