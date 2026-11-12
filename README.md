# mp4-splitter

Split an MP4 into parts **without re-encoding** (no quality loss). Everything runs in your
browser with ffmpeg.wasm — the video is never uploaded.

## How it works

1. Pick an MP4. The page looks for **gaps** (stretches that are both silent and black) and
   turns the stretches between them into segments.
2. Review the list: rename segments, adjust start/end times, remove or add parts, and press ▶
   to preview a part in the player.
3. Export. One part downloads as an `.mp4`; several download as a `.zip`. Files are named
   after the segment names.

### Detection settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Silence threshold | -35 dB | Audio below this level counts as silent |
| Minimum gap | 1.0 s | Shorter gaps are ignored |
| Minimum segment | 2.0 s | Shorter segments are dropped |
| Confirm gaps with black frames | on | A gap must also be black (turn off to use silence alone) |

If the video has no audio, black frames alone are used; if it has no video track, silence alone.

### Good to know

- Lossless cuts can only start on keyframes, so a part may begin slightly before the time shown.
  Cut points are placed in the middle of each gap to keep this from pulling in neighbouring content.
- Everything is held in browser memory: files over 1.5 GB are refused.
- ffmpeg.wasm 0.11 needs `SharedArrayBuffer`, which is why `vercel.json` sends the COOP/COEP headers.

## Development

No build step. Serve the folder with the required headers and open it:

```bash
python tests/serve.py        # http://127.0.0.1:8765
```

Unit tests (pure detection logic, no dependencies):

```bash
node --test tests/*.test.js
```

Generate test videos with known gaps (needs ffmpeg), written to `tests/fixtures/`:

```bash
bash tests/make-test-video.sh
```

`gaps.mp4` has gaps at 8-11 s and 19-22 s, so expect cuts near 9.5 s and 20.5 s.

## Layout

- `index.html` — markup
- `detect.js` — pure functions: log parsing, gap/segment building, name helpers
- `app.js` — DOM, ffmpeg calls, preview player, export
- `docs/superpowers/` — design spec and implementation plan
