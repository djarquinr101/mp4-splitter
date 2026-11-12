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
