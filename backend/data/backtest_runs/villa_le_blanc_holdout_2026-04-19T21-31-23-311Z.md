# Blind Holdout Backtest — Gran Meliá Villa Le Blanc

**Verdict:** `PARTIAL_MATCH` (composite accuracy **50.9%**)

Generated 2026-04-19T21:31:23.309Z · seed `smoketest` · elapsed 2.5s

## Methodology

This is a **cross-validation style holdout test**, not a temporal forecast. The review corpus (49 reviews) was deterministically split 60/40 stratified by source (TripAdvisor / Booking / Google). The simulation was then run using calibration signals derived **only from the training split** (29 reviews). The predicted review distribution was compared against the held-out test split (20 reviews) on five axes.

**What this proves:** given partial evidence, the simulation reconstructs the same guest-experience shape as the held-out reviews.

**What this does not prove:** forward temporal prediction (reviews lack timestamps) nor cross-property transfer (separate module).

## Headline metrics

| Axis | Accuracy | Detail |
|---|---|---|
| Star distribution | **68.4%** | L1 distance 63.3 pp |
| Average rating | **78.5%** | predicted 3.58 vs actual 4.44 (Δ 0.86) |
| Top positive themes F1 | **33.3%** | P=33% R=33% |
| Top negative themes F1 | **0.0%** | P=0% R=0% |
| Sentiment distribution | **80.0%** | L1 40 pp |
| **Composite** | **50.9%** | weighted (star .30, rating .20, +themes .20, −themes .20, sentiment .10) |

## Star distribution — predicted vs held-out

| Stars | Predicted % | Actual % | Δ |
|---|---|---|---|
| 5★ | 33.3% | 65% | 31.7 pp |
| 4★ | 33.3% | 25% | 8.3 pp |
| 3★ | 8.3% | 5% | 3.3 pp |
| 2★ | 8.3% | 5% | 3.3 pp |
| 1★ | 16.7% | 0% | 16.7 pp |

## Top positive themes

- **Matched (correctly predicted):** `view`, `food`
- **Missed (in test, not predicted):** `service`, `pool`, `spa`, `romantic`
- **Extra (predicted, not in test):** `room_size`, `breakfast`, `hidden_fees`, `wifi`

## Top negative themes

- **Matched (complaints we correctly predicted):** _(none)_
- **Missed (complaints in test, not predicted):** `cleanliness`, `parking`
- **Extra (predicted complaints not in test):** `service`, `spa`

## Sentiment distribution

| Bucket | Predicted % | Actual % |
|---|---|---|
| positive | 66.7% | 85% |
| mixed | 8.3% | 10% |
| negative | 25% | 5% |

## Split audit

| Source | Total | Train | Test |
|---|---|---|---|
| tripadvisor | 20 | 12 | 8 |
| booking | 19 | 11 | 8 |
| google | 10 | 6 | 4 |

## Simulation summary

- Provider: `synth`
- Total stays: 20
- Review writers: 12 (write rate 60%)
- Avg predicted stars: 3.5
- Avg predicted NPS: 11

## Reproducibility

```bash
USE_SYNTH=true SEED=smoketest TRAIN_RATIO=0.6 AGENT_COUNT=20 \
  node scripts/backtest_holdout_villa_le_blanc.js
```

Machine-readable report: `backend\data\backtest_runs\villa_le_blanc_holdout_2026-04-19T21-31-23-311Z.json`
