#!/bin/bash
curl -s -X POST http://localhost:5001/api/stay-simulate-direct \
  -H "Content-Type: application/json" \
  -d '{
    "property": {
      "name": "Gran Meliá Villa Le Blanc",
      "brand": "Gran Meliá",
      "slug": "villa-le-blanc",
      "tier": "luxury",
      "data_json": { "identity": { "tier": "luxury" } }
    },
    "audience": "European leisure couples and honeymooners aged 30-55, mid-income to affluent, visiting Menorca in shoulder season, looking for a quiet luxury beach escape with spa and sea views",
    "agent_count": 5,
    "stay_length_nights": 3,
    "property_country": "ES",
    "season": "mid",
    "occupancy_pct": 70
  }'
