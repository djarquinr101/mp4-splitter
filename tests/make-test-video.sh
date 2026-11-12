#!/usr/bin/env bash
# Builds test videos in tests/fixtures/ (git-ignored):
#   gaps.mp4      30 s: three 8 s tone+colour parts, two 3 s silent+black gaps (8-11 s and 19-22 s).
#                 Expected parts: about 0-8 s, 11-19 s and 22-30 s.
#   gaps-noaudio.mp4  same picture, no audio track (black frames only).
#   nogaps.mp4    8 s of tone+colour, no gaps.
#   longgop.mp4   same layout as gaps.mp4 but one continuous encode with keyframes only at
#                 0/10/20 s (inside the gaps): worst case for lossless cuts leaking a gap.
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
ffmpeg -y -v error   -f lavfi -i "testsrc=duration=30:size=320x240:rate=25,drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,8,11)+between(t,19,22)'"   -f lavfi -i "sine=frequency=440:duration=30,volume=enable='between(t,8,11)+between(t,19,22)':volume=0"   -c:v libx264 -g 250 -sc_threshold 0 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 longgop.mp4
rm -f part.mp4 gap.mp4 list.txt
ls -la
