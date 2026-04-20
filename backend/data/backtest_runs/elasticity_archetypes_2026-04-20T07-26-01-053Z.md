# Archetype Price Elasticity Backtest — Gran Meliá Villa Le Blanc

**Verdict:** `STRONG_MATCH` · pass rate **87.5%** (7/8 archetypes)

Generated 2026-04-20T07:26:01.052Z · seed `villa-elast-v8` · 120 agents × 2 rate levels × 8 archetypes · elapsed 71.6s

## Methodology

For each archetype, a homogeneous cohort (single-archetype override) was exposed to two rate levels straddling the archetype's sweet-spot — low = 0.75× sweet, high = 1.25× sweet. The empirical own-price elasticity was computed as:

```
ε = ln(q₂/q₁) / ln(p₂/p₁)
    q = acceptance_rate, p = rate_eur
```

Each archetype's simulated elasticity is compared against a published range (compiled from peer-reviewed research + industry references). Tolerance band: ±0.35.

**Verdict codes:**
- `in_range` — empirical ε falls within the published range (strict match)
- `within_tolerance` — empirical ε outside range but within ±tolerance of midpoint (accepted match)
- `fail` — outside both
- `no_anchor` — no benchmark available for this archetype

## Summary

| Metric | Value |
|---|---|
| Archetypes with benchmark anchor | 8 |
| Strict in-range matches | 7 (87.5%) |
| Passes (in-range + within-tolerance) | 7 (87.5%) |
| Mean absolute error (ε units) | 0.166 |
| **Composite verdict** | **STRONG_MATCH** |

## Per-archetype results

| Archetype | Low rate | High rate | Accept@low | Accept@high | Sim ε | Benchmark ε | Range | Δ | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| luxury_seeker | €900 | €1500 | 76.7% | 61.7% | -0.426 | -0.45 | [-0.6, -0.3] | 0.024 | ✅ in_range |
| honeymooner | €750 | €1250 | 75.8% | 44.2% | -1.056 | -0.85 | [-1.1, -0.6] | 0.206 | ✅ in_range |
| family_vacationer | €525 | €875 | 65% | 36.7% | -1.119 | -1.008 | [-1.25, -0.8] | 0.111 | ✅ in_range |
| business_traveler | €375 | €625 | 71.7% | 48.3% | -0.773 | -0.7 | [-0.9, -0.5] | 0.073 | ✅ in_range |
| digital_nomad | €225 | €375 | 71.7% | 32.5% | -1.549 | -1.3 | [-1.55, -1.05] | 0.249 | ✅ in_range |
| budget_optimizer | €150 | €250 | 70.8% | 35.8% | -1.335 | -1.57 | [-1.85, -1.3] | 0.235 | ✅ in_range |
| loyalty_maximizer | €450 | €750 | 68.3% | 64.2% | -0.121 | -0.55 | [-0.75, -0.35] | 0.429 | ❌ fail |
| event_attendee | €338 | €563 | 80% | 43.3% | -1.203 | -1.2 | [-1.45, -0.95] | 0.003 | ✅ in_range |

## Benchmark provenance

- **Vives & Jacob (2023) — Sources of price elasticity variability among Spanish resort hotels. Emerald JHTT.** · confidence A
  - https://www.emerald.com/insight/content/doi/10.1108/jhtt-11-2020-0298/full/html
- **Vives & Jacob (2021) — Dynamic pricing in Spanish resort hotels. SAGE Tourism Economics.** · confidence A
  - https://journals.sagepub.com/doi/10.1177/1354816619870652
- **Garín-Muñoz — German demand for tourism in Spain. Academia.edu pre-print.** · confidence B
  - https://www.academia.edu/49864208/German_demand_for_tourism_in_Spain
  - Finding: German short-run price elasticity to Spain = -1.06; long-run = -2.16
- **Singh & Corsun (2023) — Price elasticity of demand and its impact on hotel revenue performance during COVID-19. Cornell Hospitality Quarterly.** · confidence B
  - https://journals.sagepub.com/doi/10.1177/19389655231184475
- **Xuan Tran (2011) — Price Sensitivity of Customers in Luxurious Hotels in U.S. e-Review of Tourism Research.** · confidence B
  - https://ertr.tamu.edu/files/2012/11/eRTR_ARN_Xuan-Tran.pdf
  - Finding: Luxury hotel demand is price-inelastic; income-elastic
- **Rateboard industry review — hotel price elasticity by segment.** · confidence C
  - https://www.rateboard.io/en/blog/details/price-elasticity-in-the-hotel-industry
  - Finding: Leisure traveler average PED ≈ -1.23; business ≈ -0.7; luxury ≈ -0.4 to -0.6
- **Hotel Tech Report (2024) — Price elasticity in the hotel industry.** · confidence C
  - https://hoteltechreport.com/news/price-elasticity-in-the-hotel-industry

## Interpretation

The simulation's per-archetype elasticity coefficients are consistent with the published academic/industry consensus. The model responds to price changes with the expected segment-specific sensitivity — luxury archetypes remain price-inelastic, solo/budget archetypes show the highest elasticity, families sit in the middle.

## Reproducibility

```bash
USE_SYNTH=true SEED=villa-elast-v8 N_PER_RATE=120 \
  node scripts/elasticity_backtest_archetypes.js
```

Machine-readable: `backend\data\backtest_runs\elasticity_archetypes_2026-04-20T07-26-01-053Z.json`
