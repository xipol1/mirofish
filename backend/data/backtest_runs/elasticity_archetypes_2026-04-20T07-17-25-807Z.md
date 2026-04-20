# Archetype Price Elasticity Backtest — Gran Meliá Villa Le Blanc

**Verdict:** `DRIFT` · pass rate **0%** (0/7 archetypes)

Generated 2026-04-20T07:17:25.806Z · seed `debug-fam-decision` · 10 agents × 2 rate levels × 8 archetypes · elapsed 6.9s

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
| Archetypes with benchmark anchor | 7 |
| Strict in-range matches | 0 (0%) |
| Passes (in-range + within-tolerance) | 0 (0%) |
| Mean absolute error (ε units) | 1.541 |
| **Composite verdict** | **DRIFT** |

## Per-archetype results

| Archetype | Low rate | High rate | Accept@low | Accept@high | Sim ε | Benchmark ε | Range | Δ | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| luxury_seeker | €900 | €1500 | 70% | 10% | -3.809 | -0.45 | [-0.6, -0.3] | 3.359 | ❌ fail |
| honeymooner | €750 | €1250 | 100% | 30% | -2.357 | -0.85 | [-1.1, -0.6] | 1.507 | ❌ fail |
| family_vacationer | €525 | €875 | 0% | 0% | n/a | -1.008 | [-1.25, -0.8] | n/a | — no_anchor |
| business_traveler | €375 | €625 | 90% | 90% | 0 | -0.7 | [-0.9, -0.5] | 0.7 | ❌ fail |
| digital_nomad | €225 | €375 | 100% | 20% | -3.151 | -1.3 | [-1.55, -1.05] | 1.851 | ❌ fail |
| budget_optimizer | €150 | €250 | 100% | 60% | -1 | -1.57 | [-1.85, -1.3] | 0.57 | ❌ fail |
| loyalty_maximizer | €450 | €750 | 90% | 30% | -2.151 | -0.55 | [-0.75, -0.35] | 1.601 | ❌ fail |
| event_attendee | €338 | €563 | 20% | 20% | 0 | -1.2 | [-1.45, -0.95] | 1.2 | ❌ fail |

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

The simulation's elasticity profile does not match the published consensus. This indicates systematic miscalibration of the rate-stage model and should be addressed before using for revenue-management decisions.

## Reproducibility

```bash
USE_SYNTH=true SEED=debug-fam-decision N_PER_RATE=10 \
  node scripts/elasticity_backtest_archetypes.js
```

Machine-readable: `backend\data\backtest_runs\elasticity_archetypes_2026-04-20T07-17-25-807Z.json`
