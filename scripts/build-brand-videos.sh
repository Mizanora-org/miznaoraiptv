#!/usr/bin/env bash
# Install pillow + imageio-ffmpeg, or provide FFMPEG and Pillow.
set -euo pipefail
cd "$(dirname "$0")/.."
exec "${PYTHON:-python3}" scripts/build-brand-videos.py
