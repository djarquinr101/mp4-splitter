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

  const api = { parseProbeLog, parseSilenceLog, parseBlackLog, intersectIntervals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detect = api;
})(typeof window !== 'undefined' ? window : globalThis);
