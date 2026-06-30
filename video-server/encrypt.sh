#!/bin/sh
# Runs at Docker build time to generate and encrypt the HLS demo stream.
# Called from the video-server Dockerfile RUN step.
set -e

OUTPUT_DIR=/usr/share/nginx/html/hls
mkdir -p "$OUTPUT_DIR"

KEY_FILE=/tmp/enc.key
KEYINFO_FILE=/tmp/keyinfo.txt

AES_KEY_HEX="${AES_KEY_HEX:-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6}"
KEY_SERVER_URL="${KEY_SERVER_URL:-http://localhost:8000/key}"

# Convert hex string → 16 raw bytes
python3 -c "import binascii; open('$KEY_FILE', 'wb').write(binascii.unhexlify('$AES_KEY_HEX'))"

# ffmpeg hls_key_info_file format:
#   line 1 — URI embedded in EXT-X-KEY (what the player fetches for the key)
#   line 2 — local path to the key file used during encryption
printf '%s\n%s\n' "$KEY_SERVER_URL" "$KEY_FILE" > "$KEYINFO_FILE"

# Generate a synthetic 30-second test video (no external file needed)
# and package it as AES-128 encrypted HLS
ffmpeg -y \
  -f lavfi -i "testsrc=duration=30:size=640x480:rate=24" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset fast -crf 28 \
  -c:a aac -b:a 64k \
  -hls_time 6 \
  -hls_key_info_file "$KEYINFO_FILE" \
  -hls_playlist_type vod \
  -hls_segment_filename "$OUTPUT_DIR/segment%03d.ts" \
  "$OUTPUT_DIR/stream.m3u8"

echo "HLS encryption complete:"
ls -lh "$OUTPUT_DIR"
