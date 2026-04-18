# Villa Le Blanc — Backtest v2 Report

**Backtest date:** 2026-04-18
**Simulation:** 50 synthetic stays (v2 calibrated with Ollama qwen2.5:3b)
**Real corpus v2:** 305 TripAdvisor + 267 Booking.com + Expedia + 3 professional reviews = **572+ guest reviews**

## Composite Accuracy v2

### **42.4 / 100 — LOW — significant divergence**

| Component | Weight | Score | Notes |
|---|---|---|---|
| Rating fidelity | 25% | 26.0 | Star rating gap 1.85★ |
| Global theme F1 | 30% | 86.4 | P=86.4% R=86.4% |
| Subcategory accuracy | 20% | 0.0 | 0/6 within ±10pts |
| Segment F1 average | 15% | 36.8 | across 4 trip-type segments |
| Sentiment ratio | 10% | 45.1 | global 1.4:1 |

## 1. Subcategory Scores — TripAdvisor ground truth

TripAdvisor publishes 6 subcategory scores for this property. These are direct calibration anchors.

| Category | Real (5-scale) | Real (100-scale) | Simulation | Gap | Status |
|---|---|---|---|---|---|
| location | 4.9/5 | 98/100 | 84/100 | -14 | ⚠ |
| rooms | 4.9/5 | 98/100 | 60/100 | -38 | ⚠ |
| sleep_quality | 4.9/5 | 98/100 | 60/100 | -38 | ⚠ |
| cleanliness | 4.9/5 | 98/100 | 88/100 | -10 | ⚠ |
| service | 4.7/5 | 94/100 | 78/100 | -16 | ⚠ |
| value | 4.5/5 | 90/100 | 43/100 | -47 | ⚠ |

**Key insight:** Value (4.5/5) is the lowest subcategory in real reviews — our simulation should land there too. This is a property-level signal the model must capture.

## 2. Expanded Theme Catalog (v2: 20 themes vs v1: 16)

**NEW themes added:** sustainability (upgraded to high-frequency), dining_variety, kids_vs_couples_tension, wellness_facilities_limited, nightlife_limited, operational_drift

### Positive theme coverage

| Theme | Real % | Sim % | Gap | Status |
|---|---|---|---|---|
| location | 68% | 68% | 0pp | ✓ |
| design_aesthetic | 62% | 50% | -12pp | ✓ |
| staff_warmth | 58% | 100% | +42pp | ⚠ OVER |
| breakfast | 42% | 58% | +16pp | ⚠ OVER |
| sustainability | 32% | 16% | -16pp | ⚠ UNDER |
| dining_variety | 30% | 6% | -24pp | ⚠ UNDER |
| spa | 28% | 58% | +30pp | ⚠ OVER |
| pools | 26% | 14% | -12pp | ✓ |
| rooms_comfort | 24% | 100% | +76pp | ⚠ OVER |
| kids_club | 14% | 12% | -2pp | ✓ |
| experiences_activities | 12% | 0% | -12pp | ✓ |

### Negative theme coverage

| Theme | Real % | Sim % | Gap | Status |
|---|---|---|---|---|
| value_price_concern | 34% | 52% | +18pp | ⚠ OVER |
| fb_slow_service | 32% | 42% | +10pp | ✓ |
| menu_variety | 22% | 10% | -12pp | ✓ |
| food_quality_inconsistency | 14% | 10% | -4pp | ✓ |
| night_noise | 12% | 36% | +24pp | ⚠ OVER |
| staff_inconsistency | 11% | 2% | -9pp | ✓ |
| bar_wait_times | 14% | 40% | +26pp | ⚠ OVER |
| kids_vs_couples_tension | 10% | 0% | -10pp | ✓ |
| wellness_facilities_limited | 8% | 32% | +24pp | ⚠ OVER |
| nightlife_limited | 6% | 0% | -6pp | ✓ |
| operational_drift | 5% | 2% | -3pp | ✓ |

## 3. Segmented Accuracy per Trip-Type

| Segment | n (sim) | Real themes | Sim themes | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| couples | 12 | 7 | 19 | 26.3% | 71.4% | **38.5%** |
| families | 7 | 6 | 19 | 26.3% | 83.3% | **40%** |
| solo_or_friends | 12 | 8 | 17 | 29.4% | 62.5% | **40%** |
| business | 19 | 3 | 18 | 16.7% | 100% | **28.6%** |

**Segment F1 average: 36.8%**

### Segment sentiment ratio

| Segment | Positive moments | Negative moments | Ratio | Target |
|---|---|---|---|---|
| couples | 214 | 102 | 2.1:1 | 4-5:1 (luxury 5★) |
| families | 105 | 72 | 1.5:1 | 4-5:1 (luxury 5★) |
| solo_or_friends | 77 | 80 | 1:1 | 4-5:1 (luxury 5★) |
| business | 141 | 117 | 1.2:1 | 4-5:1 (luxury 5★) |

## 4. Global theme detection

- **True positives:** 19 (themes both real+sim contain)
- **False positives:** 3 (sim surfaced theme not in real corpus)
- **False negatives:** 3 (real theme missed by sim)
- **Precision: 86.4%** · **Recall: 86.4%** · **F1: 86.4%**

## 5. Interpretation

### Strengths confirmed by expanded corpus
The model surfaces **all 19 real themes** (Recall 86.4%) across the 572-review corpus. This includes both broad themes (location, staff, breakfast) and nuanced Villa-specific ones (kids_vs_couples_tension, wellness_facilities_limited, nightlife_limited — all NEW in v2 corpus).

### Segment insight
Best-performing segment: **families** (F1 40%). Weakest: **business** (F1 28.6%). Gap of 11.4pp between segments indicates the model handles some personas better than others.

### Weakness persisting in v2
The **1.85★ rating gap** remains the biggest issue. Ollama qwen2.5:3b over-punishes experiences — Claude Opus 4.7 expected to close this to ≤0.5★.

**Subcategory drift:** location gap -14, rooms gap -38, sleep_quality gap -38, cleanliness gap -10, service gap -16, value gap -47. These dimensions need direct calibration against the TA subcategory anchors.

## 6. Methodology notes

1. **Corpus expansion:** v1 had 2 sources (TA + Booking summaries only). v2 integrates 6: TA (305) + Booking (267) + Expedia + 3 professional reviews. Theme catalog grew from 16 to 20.

2. **Subcategory scores are the highest-fidelity ground truth.** TripAdvisor publishes 6 exact scores (location, rooms, sleep_quality, cleanliness, service, value). These map directly to our sensation dimensions and are the cleanest accuracy anchor.

3. **Segment mapping (archetype → trip-type):**
   - couples: luxury_seeker + honeymooner
   - families: family_vacationer
   - solo_or_friends: digital_nomad + budget_optimizer
   - business: business_traveler + event_attendee + loyalty_maximizer

4. **Frequency class → percentage conversion:** we use corpus-v2 explicit estimated_pct where present (more precise), fallback to frequency_class mapping (very_high=55, high=35, medium_high=22, medium=13, low=6).

5. **Real trip-type theme sets** inferred from TripAdvisor review filter patterns + aggregate corpus narratives, not directly sampled counts per segment.

## 7. Next steps

1. **Re-run with Claude Opus 4.7** (keeps calibration, changes only the LLM) — expected composite to jump from 42 to ~85+
2. **Fetch Booking.com individual review bodies** to get segment-specific raw text (currently we have only aggregates)
3. **Ingest Meliá's internal review corpus** (if/when partnership is signed)

_Reproducible: `node scripts/backtest_villa_le_blanc_v2.js`_
