// Pure detection logic: no DOM, no ffmpeg. Usable from the browser (window.Detect) and Node tests.
(function (root) {
  // Interval = { start: number, end: number } in seconds.

  const sortByStart = (list) => list.slice().sort((a, b) => a.start - b.start);

  function parseProbeLog(text) {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
    return {
      duration,
      hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(text),
      hasVideo: /Stream #\d+:\d+[^\n]*: Video:/.test(text),
    };
  }

  function parseSilenceLog(text, duration) {
    const intervals = [];
    let open = null;
    const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = Math.max(0, Number(m[2]));
      if (m[1] === 'start') {
        open = t;
      } else if (open !== null) {
        intervals.push({ start: open, end: t });
        open = null;
      }
    }
    if (open !== null) intervals.push({ start: open, end: duration });
    return sortByStart(intervals);
  }

  function parseBlackLog(text) {
    const intervals = [];
    const re = /black_start:\s*(-?\d+(?:\.\d+)?)\s+black_end:\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      intervals.push({ start: Math.max(0, Number(m[1])), end: Number(m[2]) });
    }
    return sortByStart(intervals);
  }

  function intersectIntervals(a, b) {
    const out = [];
    for (const x of a) {
      for (const y of b) {
        const start = Math.max(x.start, y.start);
        const end = Math.min(x.end, y.end);
        if (end > start) out.push({ start, end });
      }
    }
    return sortByStart(out);
  }

  function buildGaps(silence, black, probe, s) {
    let gaps;
    if (!probe.hasAudio) gaps = black;
    else if (!probe.hasVideo || !s.useBlack) gaps = silence;
    else gaps = intersectIntervals(silence, black);
    return sortByStart(gaps.filter((g) => g.end - g.start >= s.minGap));
  }

  const EDGE_TOLERANCE = 0.5; // a gap this close to the video's start/end is an intro/outro, not a split point

  // Segments are the spans strictly between gaps, so no gap is ever part of a segment.
  function buildSegments(gaps, duration, minSegment) {
    if (gaps.length === 0) return [{ start: 0, end: duration }];
    const spans = [];
    const first = gaps[0];
    const last = gaps[gaps.length - 1];
    if (first.start > EDGE_TOLERANCE) spans.push({ start: 0, end: first.start });
    for (let i = 0; i + 1 < gaps.length; i++) spans.push({ start: gaps[i].end, end: gaps[i + 1].start });
    if (last.end < duration - EDGE_TOLERANCE) spans.push({ start: last.end, end: duration });
    const segments = spans.filter((seg) => seg.end - seg.start >= minSegment);
    return segments.length > 0 ? segments : [{ start: 0, end: duration }];
  }

  function sanitizeName(name, fallback) {
    const cleaned = name.trim().replace(/[^\p{L}\p{N}_.\- ]+/gu, '_');
    return cleaned === '' ? fallback : cleaned;
  }

  // Sequentially renames later duplicates (case-insensitive) so no output name ever repeats.
  function uniqueNames(names) {
    const taken = new Set();
    return names.map((name) => {
      let candidate = name;
      let k = 2;
      while (taken.has(candidate.toLowerCase())) candidate = `${name} (${k++})`;
      taken.add(candidate.toLowerCase());
      return candidate;
    });
  }

  function formatTimeFine(sec) {
    const t = Math.round(sec * 100) / 100; // round first so seconds can never print as 60.00
    const h = String(Math.floor(t / 3600)).padStart(2, '0');
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const r = (t % 60).toFixed(2).padStart(5, '0');
    return `${h}:${m}:${r}`;
  }

  const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

  function normalizeSettings(s) {
    return {
      noiseDb: clamp(s.noiseDb, -90, -10, -35),
      minGap: clamp(s.minGap, 0.3, 3600, 1),
      minSegment: clamp(s.minSegment, 0.5, 3600, 2),
      useBlack: Boolean(s.useBlack),
    };
  }

  const api = { parseProbeLog, parseSilenceLog, parseBlackLog, intersectIntervals, buildGaps, buildSegments, sanitizeName, uniqueNames, formatTimeFine, normalizeSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detect = api;
})(typeof window !== 'undefined' ? window : globalThis);
