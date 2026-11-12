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

  function buildSegments(gaps, duration, minSegment) {
    if (gaps.length === 0) return [{ start: 0, end: duration }];
    const mid = (g) => (g.start + g.end) / 2;
    const cuts = gaps.map(mid);
    const first = gaps[0];
    const last = gaps[gaps.length - 1];
    const points = [];
    if (first.start > 0) points.push(0);
    points.push(...cuts);
    if (last.end < duration) points.push(duration);
    const segments = [];
    for (let i = 0; i + 1 < points.length; i++) {
      if (points[i + 1] - points[i] >= minSegment) segments.push({ start: points[i], end: points[i + 1] });
    }
    return segments;
  }

  function sanitizeName(name, fallback) {
    const cleaned = name.trim().replace(/[^\w.\- ]+/g, '_');
    return cleaned === '' ? fallback : cleaned;
  }

  function uniqueNames(names) {
    const seen = new Map();
    return names.map((name) => {
      const key = name.toLowerCase();
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      return count === 1 ? name : `${name} (${count})`;
    });
  }

  const api = { parseProbeLog, parseSilenceLog, parseBlackLog, intersectIntervals, buildGaps, buildSegments, sanitizeName, uniqueNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detect = api;
})(typeof window !== 'undefined' ? window : globalThis);
