#!/bin/bash
# Standalone script to (re)generate the encrypted HLS stream locally.
# Prerequisites: ffmpeg, python3
# Usage: AES_KEY_HEX=... KEY_SERVER_URL=... ./scripts/encrypt-video.sh
set -e

OUTPUT_DIR="${OUTPUT_DIR:-./video-server/assets/hls}"
mkdir -p "$OUTPUT_DIR"

KEY_FILE=/tmp/enc.key
KEYINFO_FILE=/tmp/keyinfo.txt

AES_KEY_HEX="${AES_KEY_HEX:-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6}"
KEY_SERVER_URL="${KEY_SERVER_URL:-http://localhost:8000/key}"

python3 -c "import binascii; open('$KEY_FILE', 'wb').write(binascii.unhexlify('$AES_KEY_HEX'))"

printf '%s\n%s\n' "$KEY_SERVER_URL" "$KEY_FILE" > "$KEYINFO_FILE"

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

echo "Done. Output:"
ls -lh "$OUTPUT_DIR"
