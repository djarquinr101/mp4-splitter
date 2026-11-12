const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../detect.js');

test('parseProbeLog reads duration and tracks', () => {
  const log = '  Duration: 00:01:02.50, start: 0.0\n  Stream #0:0: Video: h264\n  Stream #0:1: Audio: aac';
  assert.deepEqual(D.parseProbeLog(log), { duration: 62.5, hasAudio: true, hasVideo: true });
});

test('parseProbeLog reports missing video track', () => {
  const log = '  Duration: 00:00:10.00, start: 0.0\n  Stream #0:0: Audio: aac';
  assert.deepEqual(D.parseProbeLog(log), { duration: 10, hasAudio: true, hasVideo: false });
});

test('parseSilenceLog pairs start and end', () => {
  const log = '[silencedetect @ 0x1] silence_start: 10.5\n[silencedetect @ 0x1] silence_end: 12 | silence_duration: 1.5';
  assert.deepEqual(D.parseSilenceLog(log, 60), [{ start: 10.5, end: 12 }]);
});

test('parseSilenceLog runs an unterminated silence to the duration', () => {
  assert.deepEqual(D.parseSilenceLog('[silencedetect @ 0x1] silence_start: 55', 60), [{ start: 55, end: 60 }]);
});

test('parseBlackLog reads black intervals', () => {
  const log = '[blackdetect @ 0x2] black_start:10 black_end:12.04 black_duration:2.04';
  assert.deepEqual(D.parseBlackLog(log), [{ start: 10, end: 12.04 }]);
});

test('intersectIntervals returns sorted overlaps', () => {
  const r = D.intersectIntervals([{ start: 10, end: 20 }], [{ start: 15, end: 30 }, { start: 2, end: 11 }]);
  assert.deepEqual(r, [{ start: 10, end: 11 }, { start: 15, end: 20 }]);
});

test('intersectIntervals of disjoint inputs is empty', () => {
  assert.deepEqual(D.intersectIntervals([{ start: 0, end: 1 }], [{ start: 2, end: 3 }]), []);
});

const probe = { duration: 30, hasAudio: true, hasVideo: true };

test('buildGaps keeps silence overlapping black', () => {
  const s = { minGap: 1, minSegment: 2, useBlack: true };
  assert.deepEqual(D.buildGaps([{ start: 10, end: 13 }], [{ start: 11, end: 14 }], probe, s), [{ start: 11, end: 13 }]);
});

test('buildGaps drops overlaps shorter than minGap', () => {
  const s = { minGap: 3, minSegment: 2, useBlack: true };
  assert.deepEqual(D.buildGaps([{ start: 10, end: 13 }], [{ start: 11, end: 14 }], probe, s), []);
});

test('buildGaps uses silence alone when black confirmation is off', () => {
  const s = { minGap: 1, minSegment: 2, useBlack: false };
  assert.deepEqual(D.buildGaps([{ start: 10, end: 13 }], [], probe, s), [{ start: 10, end: 13 }]);
});

test('buildGaps uses black intervals when there is no audio track', () => {
  const s = { minGap: 1, minSegment: 2, useBlack: true };
  const p = { duration: 30, hasAudio: false, hasVideo: true };
  assert.deepEqual(D.buildGaps([], [{ start: 5, end: 8 }, { start: 9, end: 9.5 }], p, s), [{ start: 5, end: 8 }]);
});

test('buildGaps uses silence alone when there is no video track', () => {
  const s = { minGap: 1, minSegment: 2, useBlack: true };
  const p = { duration: 30, hasAudio: true, hasVideo: false };
  assert.deepEqual(D.buildGaps([{ start: 10, end: 13 }], [], p, s), [{ start: 10, end: 13 }]);
});

test('buildSegments cuts at gap midpoints', () => {
  const r = D.buildSegments([{ start: 10, end: 12 }, { start: 20, end: 22 }], 30, 2);
  assert.deepEqual(r, [{ start: 0, end: 11 }, { start: 11, end: 21 }, { start: 21, end: 30 }]);
});

test('buildSegments has no leading segment when a gap starts at 0', () => {
  const r = D.buildSegments([{ start: 0, end: 2 }, { start: 10, end: 12 }], 30, 2);
  assert.deepEqual(r, [{ start: 1, end: 11 }, { start: 11, end: 30 }]);
});

test('buildSegments has no trailing segment when a gap reaches the end', () => {
  const r = D.buildSegments([{ start: 10, end: 12 }, { start: 28, end: 30 }], 30, 2);
  assert.deepEqual(r, [{ start: 0, end: 11 }, { start: 11, end: 29 }]);
});

test('buildSegments with no gaps is the whole video', () => {
  assert.deepEqual(D.buildSegments([], 30, 2), [{ start: 0, end: 30 }]);
});

test('buildSegments drops segments shorter than minSegment', () => {
  const r = D.buildSegments([{ start: 10, end: 12 }, { start: 12.5, end: 13 }], 30, 2);
  assert.deepEqual(r, [{ start: 0, end: 11 }, { start: 12.75, end: 30 }]);
});

test('sanitizeName replaces unsafe characters and falls back when empty', () => {
  assert.equal(D.sanitizeName('a/b: c?', 'Part 1'), 'a_b_ c_');
  assert.equal(D.sanitizeName('   ', 'Part 3'), 'Part 3');
});

test('uniqueNames numbers case-insensitive duplicates', () => {
  assert.deepEqual(D.uniqueNames(['a', 'A', 'b', 'a']), ['a', 'A (2)', 'b', 'a (3)']);
});

// ---- Final review fixes ----

test('uniqueNames never produces a name that already exists', () => {
  assert.deepEqual(D.uniqueNames(['a', 'a', 'a (2)']), ['a', 'a (2)', 'a (2) (2)']);
  const r = D.uniqueNames(['a', 'A', 'a (2)']);
  assert.equal(new Set(r.map((x) => x.toLowerCase())).size, 3);
});

test('buildSegments falls back to the whole video when a gap covers everything', () => {
  assert.deepEqual(D.buildSegments([{ start: 0, end: 30 }], 30, 2), [{ start: 0, end: 30 }]);
});

test('buildSegments falls back to the whole video when every segment is too short', () => {
  assert.deepEqual(D.buildSegments([{ start: 1, end: 2 }], 4, 5), [{ start: 0, end: 4 }]);
});

test('sanitizeName keeps letters from any script', () => {
  assert.equal(D.sanitizeName('Глава 1', 'Part 1'), 'Глава 1');
  assert.equal(D.sanitizeName('Café', 'Part 1'), 'Café');
  assert.equal(D.sanitizeName('a/b', 'Part 1'), 'a_b');
});

test('formatTimeFine rounds before splitting into fields', () => {
  assert.equal(D.formatTimeFine(119.996), '00:02:00.00');
  assert.equal(D.formatTimeFine(9.52), '00:00:09.52');
  assert.equal(D.formatTimeFine(3661.5), '01:01:01.50');
});

test('normalizeSettings replaces blank or invalid values and clamps ranges', () => {
  const r = D.normalizeSettings({ noiseDb: NaN, minGap: 0, minSegment: -4, useBlack: true });
  assert.deepEqual(r, { noiseDb: -35, minGap: 0.3, minSegment: 0.5, useBlack: true });
  assert.equal(D.normalizeSettings({ noiseDb: 0, minGap: 1, minSegment: 2, useBlack: false }).noiseDb, -10);
  assert.equal(D.normalizeSettings({ noiseDb: -200, minGap: 1, minSegment: 2, useBlack: false }).noiseDb, -90);
});
