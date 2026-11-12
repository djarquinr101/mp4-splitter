# Auto segment detection and naming — design

## Purpose

The user loads a short video (under about 15 minutes, under about 500 MB) that contains
several pieces of wanted content separated by gaps. A gap is a stretch that is both
silent and black. Today the user plays the video, notes times and types them in. The
app should find the gaps itself, turn the stretches between them into segments, let the
user name each segment, and export them losslessly as it does now.

## Goals and non-goals

Goals
- Detect gaps automatically after a video is loaded and build the segment list from them.
- Let the user review and correct segments (name, start, end, remove, add) before export.
- Name exported files from the segment names.
- Keep lossless export (`-c copy`), sequential cuts, one download or a zip.

Non-goals
- Videos over 1.5 GB (existing limit stays).
- Frame-accurate cutting or re-encoding.
- Persisting segments between page loads.
- Other gap types (static image, title cards).

## Flow

1. User picks a file. The file is written to ffmpeg's virtual file system once and stays
   there until export finishes or a new file is picked.
2. Detection starts automatically and shows a progress bar:
   1. Silence pass: `silencedetect` on the audio only.
   2. Black pass (only if "Confirm with black frames" is on, default on): `blackdetect`
      on video scaled down to 160 px wide.
3. The app builds gaps, then segments, and renders the segment list.
4. The user edits the list, then exports.

If the video has no audio track, only the black pass can find gaps, so the black pass is
forced on and used alone. If it has no video track, the black pass is skipped and
silence alone is used.

## Detection settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Silence threshold | -35 dB | Audio below this level is silent |
| Minimum gap length | 1.0 s | Shorter silences are ignored |
| Confirm with black frames | on | A gap must also overlap a black stretch |
| Minimum segment length | 2.0 s | Shorter segments are dropped |

Black pass parameters are fixed: minimum black duration 0.5 s, picture threshold 0.98,
pixel threshold 0.10. Changing a setting re-runs only the interval-to-segment logic on
the stored raw intervals, not the ffmpeg passes: this applies to minimum gap length and
minimum segment length. Changing the silence threshold re-runs the silence pass, and
turning black confirmation on for the first time runs the black pass; its result is then
kept. If the user has edited the segment list, the app asks for confirmation before
replacing it.

## Gap and segment rules

- Raw silence intervals come from `silence_start` / `silence_end` lines in the ffmpeg log.
  A `silence_start` with no `silence_end` runs to the end of the video.
- Raw black intervals come from `black_start` / `black_end` in `blackdetect` summary lines.
- With black confirmation on, a gap is the intersection of each silence interval with the
  black intervals; intersections shorter than the minimum gap length are discarded.
  With it off (or no video track), gaps are the silence intervals of at least the minimum
  gap length. With no audio track, gaps are the black intervals.
- Segments are the spans between consecutive gaps. A leading segment exists if the first
  gap does not start at 0 and a trailing segment exists if the last gap does not reach the
  end of the video. A video with no gaps yields one segment covering the whole video.
- Segments shorter than the minimum segment length are dropped.
- Cut points: each segment start is placed at the midpoint of the gap before it and each
  segment end at the midpoint of the gap after it. Midpoints keep the cut inside the gap,
  so a keyframe snap-back lands in the gap and does not pull in the previous segment's
  content. The first start is 0 and the last end is the video duration.

## Segment list UI

Each row: name box, start box, end box, a play button, a remove button.
- Name defaults to "Part N" (renumbered when rows are removed unless the user typed a name).
- Times use the existing parser (`seconds`, `MM:SS`, `HH:MM:SS`, fractions) and the
  existing validation (end after start, start inside the video).
- Play seeks a small preview player (the loaded file played through an object URL) to the
  segment start and pauses at the segment end.
- "+ Add" appends a manual row.
- If there are no gaps, a note says so and the list shows one whole-video segment.

## Export

Unchanged from the current behavior, with one change: output file name is
`<sanitized segment name>.mp4`. Names are sanitized to word characters, dots, hyphens and
spaces; empty names fall back to "Part N"; duplicates get ` (2)`, ` (3)` suffixes. The zip
name stays `<video name>_parts.zip`.

## Code layout

- `index.html` — markup and wiring.
- `detect.js` — pure functions, no DOM and no ffmpeg: `parseSilenceLog`, `parseBlackLog`,
  `intersectIntervals`, `buildGaps`, `buildSegments`, `uniqueNames`. Loaded as a classic
  script and also usable from Node for tests (`module.exports` guarded by `typeof module`).
- `app.js` — DOM, ffmpeg calls, preview player and export.
- `tests/detect.test.js` — Node tests using `node --test`, no dependencies.

## Errors

- Detection failure shows a message and falls back to the manual single-row list, so the
  tool remains usable.
- Existing export error handling (try/finally cleanup, visible error) stays.
- A new file picked mid-detection cancels the old run by ignoring its results.

## Testing

- Unit tests for the pure functions on sample ffmpeg log text, including: no gaps, gap at
  the start, gap at the end, unterminated silence, silence without black, overlapping
  intervals, dropped short segments, duplicate names.
- Manual check in a browser using a generated test video with known silent, black gaps.
  Expected result: the detected segments match the known ones within about 0.5 s, and the
  exported files play.

## Open limits

- Cut points still depend on keyframes. Midpoint placement reduces the effect but does not
  remove it for gaps shorter than a keyframe interval.
- `blackdetect` speed in ffmpeg.wasm is unmeasured; the 160 px downscale is the mitigation.
  If it proves too slow, the black pass stays optional and off by default.
