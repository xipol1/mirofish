#!/usr/bin/env bash
# Dataset download script for Synthetic Users Hospitality pack.
# Requires: kaggle CLI (pip install kaggle) + Kaggle credentials.
#
#   export KAGGLE_USERNAME=your_username
#   export KAGGLE_KEY=your_api_key
#
# Then from repo root:  bash backend/scripts/download_datasets.sh

set -e

DATASETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../data/datasets" && pwd)"
echo "[download] Target directory: $DATASETS_DIR"

# ── 1. TripAdvisor reviews (Kaggle) ──
if command -v kaggle >/dev/null 2>&1; then
  echo "[download] Fetching TripAdvisor hotel reviews..."
  kaggle datasets download -d andrewmvd/trip-advisor-hotel-reviews -p "$DATASETS_DIR/tripadvisor_reviews" --unzip || echo "[warn] andrewmvd TA failed"
  kaggle datasets download -d jiashenliu/515k-hotel-reviews-data-in-europe -p "$DATASETS_DIR/tripadvisor_reviews" --unzip || echo "[warn] 515k failed"

  # ── 2. Booking demand ──
  echo "[download] Fetching Hotel Booking Demand dataset..."
  kaggle datasets download -d jessemostipak/hotel-booking-demand -p "$DATASETS_DIR/booking_hotels" --unzip || echo "[warn] booking demand failed"
else
  echo "[warn] kaggle CLI not found. Install with: pip install kaggle"
  echo "[warn] TripAdvisor + Booking datasets will use bundled samples only."
fi

# ── 3. GoEmotions ──
echo "[download] Fetching GoEmotions..."
GOEMO_DIR="$DATASETS_DIR/goemotions"
for f in goemotions_1.csv goemotions_2.csv goemotions_3.csv emotions.txt; do
  if [ ! -f "$GOEMO_DIR/$f" ]; then
    echo "  -> $f"
    curl -fsSL "https://raw.githubusercontent.com/google-research/google-research/master/goemotions/data/full_dataset/$f" -o "$GOEMO_DIR/$f" || echo "[warn] $f download failed"
  fi
done

# ── 4. Inside Airbnb (compact samples) ──
echo "[download] Fetching Inside Airbnb listings..."
AIRBNB_DIR="$DATASETS_DIR/airbnb_listings"
# Inside Airbnb provides gz csvs per city. Example: Madrid, Barcelona.
for city_url in \
  "http://data.insideairbnb.com/spain/comunidad-de-madrid/madrid/2024-12-30/visualisations/listings.csv" \
  "http://data.insideairbnb.com/spain/catalonia/barcelona/2024-12-13/visualisations/listings.csv" \
  "http://data.insideairbnb.com/france/ile-de-france/paris/2024-12-12/visualisations/listings.csv"; do
  filename=$(echo "$city_url" | awk -F'/' '{print $(NF-3)"_listings.csv"}')
  if [ ! -f "$AIRBNB_DIR/$filename" ]; then
    echo "  -> $filename"
    curl -fsSL "$city_url" -o "$AIRBNB_DIR/$filename" || echo "[warn] $filename failed"
  fi
done

echo ""
echo "[download] Done. Synthetic Users will auto-discover these files next time backend boots."
echo "[download] To reload without restart: curl -X POST http://localhost:5001/api/enterprise/datasets/reload"
