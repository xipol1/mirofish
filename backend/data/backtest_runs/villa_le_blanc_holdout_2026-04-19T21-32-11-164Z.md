# Blind Holdout Backtest — Gran Meliá Villa Le Blanc

**Verdict:** `PARTIAL_MATCH` (composite accuracy **59.1%**)

Generated 2026-04-19T21:32:11.163Z · seed `villa-le-blanc-2026-04-19` · elapsed 7.4s

## Methodology

This is a **cross-validation style holdout test**, not a temporal forecast. The review corpus (49 reviews) was deterministically split 60/40 stratified by source (TripAdvisor / Booking / Google). The simulation was then run using calibration signals derived **only from the training split** (29 reviews). The predicted review distribution was compared against the held-out test split (20 reviews) on five axes.

**What this proves:** given partial evidence, the simulation reconstructs the same guest-experience shape as the held-out reviews.

**What this does not prove:** forward temporal prediction (reviews lack timestamps) nor cross-property transfer (separate module).

## Headline metrics

| Axis | Accuracy | Detail |
|---|---|---|
| Star distribution | **90.0%** | L1 distance 20 pp |
| Average rating | **96.8%** | predicted 4.19 vs actual 4.32 (Δ 0.13) |
| Top positive themes F1 | **18.2%** | P=20% R=17% |
| Top negative themes F1 | **0.0%** | P=0% R=0% |
| Sentiment distribution | **91.1%** | L1 17.8 pp |
| **Composite** | **59.1%** | weighted (star .30, rating .20, +themes .20, −themes .20, sentiment .10) |

## Star distribution — predicted vs held-out

| Stars | Predicted % | Actual % | Δ |
|---|---|---|---|
| 5★ | 61.1% | 60% | 1.1 pp |
| 4★ | 25% | 30% | 5 pp |
| 3★ | 0% | 5% | 5 pp |
| 2★ | 0% | 0% | 0 pp |
| 1★ | 13.9% | 5% | 8.9 pp |

## Top positive themes

- **Matched (correctly predicted):** `food`
- **Missed (in test, not predicted):** `service`, `pool`, `value`, `wifi`, `check_out`
- **Extra (predicted, not in test):** `view`, `room_size`, `breakfast`, `hidden_fees`

## Top negative themes

- **Matched (complaints we correctly predicted):** _(none)_
- **Missed (complaints in test, not predicted):** `cleanliness`, `bed_comfort`
- **Extra (predicted complaints not in test):** `service`, `spa`

## Sentiment distribution

| Bucket | Predicted % | Actual % |
|---|---|---|
| positive | 86.1% | 90% |
| mixed | 0% | 5% |
| negative | 13.9% | 5% |

## Split audit

| Source | Total | Train | Test |
|---|---|---|---|
| tripadvisor | 20 | 12 | 8 |
| booking | 19 | 11 | 8 |
| google | 10 | 6 | 4 |

## Simulation summary

- Provider: `synth`
- Total stays: 60
- Review writers: 36 (write rate 60%)
- Avg predicted stars: 4.2
- Avg predicted NPS: 52

## Reproducibility

```bash
USE_SYNTH=true SEED=villa-le-blanc-2026-04-19 TRAIN_RATIO=0.6 AGENT_COUNT=60 \
  node scripts/backtest_holdout_villa_le_blanc.js
```

Machine-readable report: `backend\data\backtest_runs\villa_le_blanc_holdout_2026-04-19T21-32-11-164Z.json`
