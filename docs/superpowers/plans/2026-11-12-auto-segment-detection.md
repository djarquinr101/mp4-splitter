# Auto Segment Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a video is loaded, find silent+black gaps automatically, build a named, editable segment list from them, and export each segment losslessly.

**Architecture:** Pure detection logic lives in `detect.js` (no DOM, no ffmpeg, Node-testable). `app.js` holds the DOM, the ffmpeg.wasm calls, the preview player and export. `index.html` is markup only. No build step; classic `<script>` tags.

**Tech Stack:** Plain JS, ffmpeg.wasm 0.11.6 (core 0.11.0), JSZip 3.10.1, Tailwind browser CDN, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-12-auto-segment-detection-design.md`

## Global Constraints

- Defaults: silence threshold `-35` dB, minimum gap `1.0` s, minimum segment `2.0` s, black confirmation on.
- Black pass fixed parameters: `d=0.5`, `pic_th=0.98`, `pix_th=0.10`, video scaled to `160` px wide first.
- Export stays lossless: `-c copy`, sequential cuts, single download or zip named `<video name>_parts.zip`.
- Input size limit stays 1.5 GB. ffmpeg.wasm 0.11 runs one command at a time.
- No build step and no runtime dependencies beyond the CDN scripts already used.
- Cut points: segment start/end sit at the midpoint of the neighbouring gap; first start is 0, last end is the video duration.
- File names: sanitize to word characters, dots, hyphens, spaces; empty falls back to "Part N"; duplicates get ` (2)`, ` (3)`.
- Not in the spec but required by it: `parseProbeLog` reads duration and audio/video track presence from ffmpeg's log, which the "no audio / no video track" rules need.

## Review Focus

- Silence that never ends before the video ends (truncated tail): it must run to the video duration, not be dropped.
- Video with no audio track (or no video track): detection must still produce segments, not error out.
- Video with no gaps at all: one whole-video segment, plus a visible note.
- Segment names that sanitize to the same string or to empty (`"???"`, `"a/b"` and `"a_b"`): exported files must not overwrite each other.
- User picks a second file while detection is running: results of the first run must not appear in the second file's list.

---

### Task 1: Log parsing and interval math

**Files:**
- Create: `detect.js`
- Create: `tests/detect.test.js`

**Interfaces:**
- Produces (all exported via `module.exports` when `typeof module !== 'undefined'`, otherwise as globals on `window.Detect`):
  - `type Interval = { start: number, end: number }` (seconds)
  - `parseProbeLog(text: string): { duration: number | null, hasAudio: boolean, hasVideo: boolean }`
  - `parseSilenceLog(text: string, duration: number): Interval[]`
  - `parseBlackLog(text: string): Interval[]`
  - `intersectIntervals(a: Interval[], b: Interval[]): Interval[]` (sorted, non-empty overlaps only)

- [ ] **Step 1: Write failing tests** in `tests/detect.test.js` using `node:test` and `node:assert`:
  - `parseProbeLog` on `"  Duration: 00:01:02.50, start: 0.0\n  Stream #0:0: Video: h264\n  Stream #0:1: Audio: aac"` returns `{duration: 62.5, hasAudio: true, hasVideo: true}`; a log with only an Audio stream gives `hasVideo: false`.
  - `parseSilenceLog` on lines `[silencedetect @ 0x1] silence_start: 10.5` / `[silencedetect @ 0x1] silence_end: 12 | silence_duration: 1.5` gives `[{start: 10.5, end: 12}]`.
  - `parseSilenceLog` with a `silence_start: 55` and no end, `duration` 60, gives `[{start: 55, end: 60}]`.
  - `parseBlackLog` on `[blackdetect @ 0x2] black_start:10 black_end:12.04 black_duration:2.04` gives `[{start: 10, end: 12.04}]`.
  - `intersectIntervals([{start:10,end:20}],[{start:15,end:30},{start:2,end:11}])` gives `[{start:10,end:11},{start:15,end:20}]`; disjoint inputs give `[]`.
- [ ] **Step 2: Run** `node --test tests/` — expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four functions in `detect.js`. Use regexes over the whole log text; sort outputs by `start`.
- [ ] **Step 4: Run** `node --test tests/` — expected: all PASS.
- [ ] **Step 5: Commit** `git add detect.js tests && git commit -m "feat: ffmpeg log parsing and interval intersection"`

### Task 2: Gaps, segments and names

**Files:**
- Modify: `detect.js`
- Modify: `tests/detect.test.js`

**Interfaces:**
- Consumes: `Interval`, `intersectIntervals` from Task 1.
- Produces:
  - `type Settings = { minGap: number, minSegment: number, useBlack: boolean }`
  - `type Probe = { duration: number, hasAudio: boolean, hasVideo: boolean }`
  - `buildGaps(silence: Interval[], black: Interval[], probe: Probe, s: Settings): Interval[]`
  - `buildSegments(gaps: Interval[], duration: number, minSegment: number): Interval[]`
  - `sanitizeName(name: string, fallback: string): string`
  - `uniqueNames(names: string[]): string[]` (case-insensitive duplicate check; later duplicates get ` (2)`, ` (3)`)

- [ ] **Step 1: Write failing tests:**
  - `buildGaps`: silence `[{10,13}]`, black `[{11,14}]`, `useBlack` true → `[{start:11,end:13}]` with `minGap` 1; with `minGap` 3 → `[]`. `useBlack` false → `[{10,13}]`. `hasAudio` false → gaps are the black intervals of at least `minGap`. `hasVideo` false → silence only regardless of `useBlack`.
  - `buildSegments([{10,12},{20,22}], 30, 2)` → `[{0,11},{11,21},{21,30}]`. Gap starting at 0 → no leading segment: `buildSegments([{0,2},{10,12}], 30, 2)` → `[{1,11},{11,30}]`. Gap reaching the end → no trailing segment. `buildSegments([], 30, 2)` → `[{0,30}]`. A 1.5 s segment between gaps is dropped when `minSegment` is 2.
  - `sanitizeName("a/b: c?", "Part 1")` → `"a_b_ c_"`; `sanitizeName("   ", "Part 3")` → `"Part 3"`.
  - `uniqueNames(["a","A","b","a"])` → `["a","A (2)","b","a (3)"]`.
- [ ] **Step 2: Run** `node --test tests/` — expected: new tests FAIL.
- [ ] **Step 3: Implement** the four functions. Gaps are filtered by `minGap` after any intersection and sorted. Segment cut points use gap midpoints as in Global Constraints.
- [ ] **Step 4: Run** `node --test tests/` — expected: all PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: gap and segment building, name helpers"`

### Task 3: Split the page into index.html + app.js (no behaviour change)

**Files:**
- Modify: `index.html` (markup only, script tags for `detect.js` and `app.js`)
- Create: `app.js` (the current inline script moved over verbatim)

**Interfaces:**
- Produces: `app.js` as a classic script that runs after `detect.js`; `Detect` available as a global (`window.Detect`).

- [ ] **Step 1: Move** the inline `<script>` body into `app.js`; add `<script src="detect.js"></script><script src="app.js"></script>` at the end of `<body>`; make `detect.js` assign `window.Detect` when `module` is undefined.
- [ ] **Step 2: Verify** by opening the page over `http://localhost` (see Task 6 for the test video): FFmpeg loads, a two-part split downloads a zip. Expected: identical to before.
- [ ] **Step 3: Commit** `git commit -am "refactor: move page script into app.js"`

### Task 4: Detection runner with settings and progress

**Files:**
- Modify: `app.js`, `index.html`

**Interfaces:**
- Consumes: all of `Detect` from Tasks 1-2; existing `ffmpeg`, `setStatus`, `videoInput` in `app.js`.
- Produces in `app.js`:
  - `runDetection(file: File, runId: number): Promise<void>` — writes `input.mp4` once, runs the probe pass, silence pass and (if enabled and a video track exists) black pass, stores `rawSilence`, `rawBlack`, `probe`, then calls `rebuildSegments()`.
  - `rebuildSegments(): void` — calls `buildGaps` + `buildSegments` on stored raw data with the current settings and hands the result to `renderSegments(segments)` (Task 5). Clears nothing else.
  - A module-level `currentRunId: number`; each file pick increments it and `runDetection` discards results (and unlinks its files) if its `runId` is stale.
  - Settings controls in `index.html`: dB threshold input (default -35), minimum gap (1.0), minimum segment (2.0), "Confirm with black frames" checkbox (on), and a progress bar element.

- [ ] **Step 1: Add the settings controls and progress bar** to the markup with the defaults from Global Constraints.
- [ ] **Step 2: Implement `runDetection`.** Commands: probe `-i input.mp4 -t 0 -f null -`; silence `-i input.mp4 -vn -af silencedetect=noise=<dB>dB:d=<minGap> -f null -`; black `-i input.mp4 -an -vf scale=160:-2,blackdetect=d=0.5:pic_th=0.98:pix_th=0.10 -f null -`. Collect logger lines per pass into a string; drive the progress bar from `ffmpeg.setProgress`. Wrap in try/catch: on failure show the error and call `renderSegments` with one whole-video row.
- [ ] **Step 3: Wire settings.** Minimum gap / minimum segment change → `rebuildSegments()`. Threshold change → re-run the silence pass then rebuild. Black checkbox turned on for the first time → run the black pass once and keep `rawBlack`. If the list has user edits (Task 5 sets an `edited` flag), `confirm()` before replacing it.
- [ ] **Step 4: Make export reuse `input.mp4`** instead of rewriting it, and unlink it when a new file is picked or after export per the existing cleanup.
- [ ] **Step 5: Verify** in the browser with the Task 6 test video: after picking it, the status shows detection progress and `rebuildSegments` is called (log to console until Task 5 lands).
- [ ] **Step 6: Commit** `git commit -am "feat: automatic gap detection with settings and progress"`

### Task 5: Named segment list, preview player and export naming

**Files:**
- Modify: `app.js`, `index.html`

**Interfaces:**
- Consumes: `rebuildSegments` hook from Task 4; `Detect.sanitizeName`, `Detect.uniqueNames`; existing `parseTime`, `formatTime`, `collectSegments`.
- Produces: `renderSegments(segments: Interval[]): void`; rows now carry a `.segment-name` input (default `Part N`, placeholder the same); `collectSegments()` returns `{start, end, n, name}` with `name` already sanitized and de-duplicated across the list.

- [ ] **Step 1: Extend `addSegmentRow(start, end, name)`** with a name input, a play button, and an `edited` flag that is set on any input change in the list; `renderSegments` clears the list and adds one row per segment (times formatted to `HH:MM:SS.s`).
- [ ] **Step 2: Add the preview player**: one `<video controls>` using an object URL of the picked file (revoked on new pick). The play button sets `currentTime = start`, plays, and pauses when `timeupdate` passes `end`.
- [ ] **Step 3: Zero-gap note.** When detection finds no gaps, show "No gaps found — showing the whole video" above the list.
- [ ] **Step 4: Use names in export.** Output file name is `<name>.mp4`; the temp ffmpeg file names stay `part_N.mp4`. Names come from `collectSegments()`; unique-ification happens there, not per call site.
- [ ] **Step 5: Verify** in the browser with the Task 6 video: rows appear with `Part N` names, renaming one changes the exported file name inside the zip, play buttons seek and stop at the end, a duplicated name exports as `name (2).mp4`.
- [ ] **Step 6: Commit** `git commit -am "feat: named segment list with preview and name-based export"`

### Task 6: Test video, end-to-end check and README

**Files:**
- Create: `tests/make-test-video.sh`
- Modify: `README.md`

- [ ] **Step 1: Write `tests/make-test-video.sh`** — uses ffmpeg `lavfi` to build a 40 s video: three 8 s tone+colour segments separated by two 3 s silent+black gaps (known cut midpoints at about 9.5 s and 20.5 s are adjacent-gap midpoints; compute them in a comment). Concatenate with the `concat` filter and encode with `-g 25` so keyframes are frequent.
- [ ] **Step 2: Run the end-to-end check** over `http://localhost` (any static server; `python -m http.server` is fine): load the video; expected three segments whose starts and ends are within about 0.5 s of the known values; export as a zip; the three files play and are about 8-9 s each.
- [ ] **Step 3: Check the review-focus cases by hand**: a video with no audio (`-an` version of the test video) still yields segments from black frames; a video with no gaps gives one segment and the note; picking a second file during detection leaves only the second file's rows.
- [ ] **Step 4: Update `README.md`**: what the tool does, that processing is local, the detection settings, the keyframe caveat, and how to run the unit tests (`node --test tests/`).
- [ ] **Step 5: Commit** `git add -A && git commit -m "docs: README and test video script"`
