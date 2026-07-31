#!/bin/bash

set -euo pipefail
ffmpeg_binary="${1:-resources/bin/ffmpeg}"
ffprobe_binary="${2:-resources/bin/ffprobe}"
smoke_root="$(mktemp -d /tmp/short-editor-ffmpeg-smoke.XXXXXX)"
trap 'rm -rf "${smoke_root}"' EXIT

"${ffmpeg_binary}" -hide_banner -nostdin \
  -f lavfi -i "color=c=0x223344:s=320x568:r=30:d=1" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1" \
  -filter_complex \
  "[0:v]drawtext=fontfile='resources/fonts/Inter-Regular.otf':text='caption':x=20:y=20:fontcolor=white,split=2[a][b];[a]crop=300:500:10:20,scale=160:284,format=rgba[p];[b][p]overlay=80:142,format=yuv420p[v];[1:a]asplit=2[a1][a2];[a1]volume=0.5[a1v];[a1v][a2]amix=inputs=2:normalize=0[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -c:a aac -pix_fmt yuv420p -movflags +faststart \
  -y "${smoke_root}/composition.mp4"

probe_output="$("${ffprobe_binary}" -v error -show_entries \
  stream=codec_name,codec_type -of csv=p=0 "${smoke_root}/composition.mp4")"
grep -q 'h264,video' <<<"${probe_output}"
grep -q 'aac,audio' <<<"${probe_output}"

"${ffmpeg_binary}" -hide_banner -filters | grep -q ' drawtext '
"${ffmpeg_binary}" -hide_banner -encoders | grep -q ' libx264 '
echo "FFmpeg probe, libx264, caption, audio-mix, and composition smoke tests passed."
