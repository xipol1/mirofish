# Sources Catalog — Schema

Every data point cited in a Market Pack references a `source_id` that resolves
to an entry in this catalog. This is the chain of custody: a Meliá RevOps analyst
should be able to trace any number back to an original publication.

## Source entry schema

```json
{
  "id": "frontur_2024_uk_segment",
  "label": "FRONTUR 2024 — UK emitting market segment",
  "publisher": "INE / TourSpain",
  "publication_year": 2024,
  "type": "official_government_statistics",
  "access_url": "https://www.ine.es/dyngs/INEbase/...",
  "access_date": "2025-11-14",
  "licensing": "public_domain_cc_by",
  "confidence_class": "A",
  "sample_size_notes": "Annual survey, n≈220K inbound travelers to Spain, ~18% UK origin",
  "notes": "Used for outbound UK volume, length of stay, segment mix, spending"
}
```

## Confidence classes

| Class | Description | Typical field confidence |
|-------|-------------|--------------------------|
| A     | Official government statistics (INE, Eurostat, ONS, Destatis) with transparent methodology. | 75-90 |
| B     | Peer-reviewed academic research (Cornell HQ, Journal of Hospitality Mgmt). | 65-80 |
| C     | Industry analyst reports (Phocuswright, Skift Research, Statista Premium). | 50-70 |
| D     | Public trade press (Skift free, Hosteltur, industry blogs). | 40-60 |
| E     | Derived / inferred / expert interpretation. | 30-50 |

## Source types

- `official_government_statistics`
- `peer_reviewed_research`
- `industry_analyst_report`
- `consumer_platform_derived` (Booking, TripAdvisor, Despegar aggregated reviews)
- `operator_internal_data` (Meliá / partner PMS — when available under DPA)
- `expert_inferred` (Claude/founder-synthesized from multiple sources; lowest confidence)
