# Adam Self-Improvement Proposal

- Citizen: Adam
- Type: dig_drop_not_collected
- Created: 2026-07-17T00:56:18.399Z

## Symptom

Adam detected repeated abnormal or inefficient behavior.

## Details

```json
{
  "blockName": "spruce_log",
  "sweepText": "근처 드랍 4개가 아직 남아 있다.",
  "nearbyDrops": 2,
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
  "eatBeforeLongWorkFoodBelow": 18,
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
