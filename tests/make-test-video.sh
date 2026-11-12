#!/usr/bin/env bash
# Builds test videos in tests/fixtures/ (git-ignored):
#   gaps.mp4      30 s: three 8 s tone+colour parts, two 3 s silent+black gaps (8-11 s and 19-22 s).
#                 Expected cut points: about 9.5 s and 20.5 s.
#   gaps-noaudio.mp4  same picture, no audio track (black frames only).
#   nogaps.mp4    10 s of tone+colour, no gaps.
# Needs ffmpeg on PATH.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures && cd fixtures

part() { ffmpeg -y -v error -f lavfi -i "testsrc=duration=8:size=320x240:rate=25" -f lavfi -i "sine=frequency=440:duration=8" -c:v libx264 -g 25 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 "$1"; }
gap()  { ffmpeg -y -v error -f lavfi -i "color=black:size=320x240:rate=25:duration=3" -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 3 -c:v libx264 -g 25 -pix_fmt yuv420p -c:a aac "$1"; }

part part.mp4
gap gap.mp4
printf "file part.mp4\nfile gap.mp4\nfile part.mp4\nfile gap.mp4\nfile part.mp4\n" > list.txt
ffmpeg -y -v error -f concat -i list.txt -c copy gaps.mp4
ffmpeg -y -v error -i gaps.mp4 -an -c:v copy gaps-noaudio.mp4
ffmpeg -y -v error -i part.mp4 -t 8 -c copy nogaps.mp4
rm -f part.mp4 gap.mp4 list.txt
ls -la
