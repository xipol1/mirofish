# Archetype Price Elasticity Backtest — Gran Meliá Villa Le Blanc

**Verdict:** `PARTIAL_MATCH` · pass rate **50%** (3/6 archetypes)

Generated 2026-04-20T07:16:03.745Z · seed `debug-arch` · 5 agents × 2 rate levels × 8 archetypes · elapsed 4.1s

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
| Archetypes with benchmark anchor | 6 |
| Strict in-range matches | 3 (50%) |
| Passes (in-range + within-tolerance) | 3 (50%) |
| Mean absolute error (ε units) | 0.855 |
| **Composite verdict** | **PARTIAL_MATCH** |

## Per-archetype results

| Archetype | Low rate | High rate | Accept@low | Accept@high | Sim ε | Benchmark ε | Range | Δ | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| luxury_seeker | €900 | €1500 | 60% | 20% | -2.151 | -0.45 | [-0.6, -0.3] | 1.701 | ❌ fail |
| honeymooner | €750 | €1250 | 60% | 0% | n/a | -0.85 | [-1.1, -0.6] | n/a | — no_anchor |
| family_vacationer | €525 | €875 | 80% | 0% | n/a | -1.008 | [-1.25, -0.8] | n/a | — no_anchor |
| business_traveler | €375 | €625 | 80% | 60% | -0.563 | -0.7 | [-0.9, -0.5] | 0.137 | ✅ in_range |
| digital_nomad | €225 | €375 | 40% | 20% | -1.357 | -1.3 | [-1.55, -1.05] | 0.057 | ✅ in_range |
| budget_optimizer | €150 | €250 | 100% | 40% | -1.794 | -1.57 | [-1.85, -1.3] | 0.224 | ✅ in_range |
| loyalty_maximizer | €450 | €750 | 100% | 60% | -1 | -0.55 | [-0.75, -0.35] | 0.45 | ❌ fail |
| event_attendee | €338 | €563 | 20% | 40% | 1.358 | -1.2 | [-1.45, -0.95] | 2.558 | ❌ fail |

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

The simulation partially matches the published consensus. Most archetypes are directionally correct but some need tighter calibration. Review the `fail` rows above.

## Reproducibility

```bash
USE_SYNTH=true SEED=debug-arch N_PER_RATE=5 \
  node scripts/elasticity_backtest_archetypes.js
```

Machine-readable: `backend\data\backtest_runs\elasticity_archetypes_2026-04-20T07-16-03-746Z.json`
