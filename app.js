const { createFFmpeg, fetchFile } = FFmpeg;

// ffmpeg.wasm keeps the whole input + outputs in WebAssembly memory (~2 GB cap).
const MAX_INPUT_BYTES = 1.5 * 1024 * 1024 * 1024;

const ffmpeg = createFFmpeg({
    log: true,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

const statusDiv = document.getElementById('status');
const videoInput = document.getElementById('video-input');
const fileInfo = document.getElementById('file-info');
const segmentsContainer = document.getElementById('segments-container');
const addSegmentBtn = document.getElementById('add-segment-btn');
const processBtn = document.getElementById('process-btn');
const logOutput = document.getElementById('log-output');
const optNoise = document.getElementById('opt-noise');
const optMinGap = document.getElementById('opt-mingap');
const optMinSeg = document.getElementById('opt-minseg');
const optBlack = document.getElementById('opt-black');
const detectProgress = document.getElementById('detect-progress');
const detectNote = document.getElementById('detect-note');

const STATUS_CLASSES = {
    info: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    ok: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    error: "bg-red-500/20 text-red-300 border-red-500/30"
};

function setStatus(text, kind = "info") {
    statusDiv.className = `text-center p-2 mb-4 rounded border text-sm ${STATUS_CLASSES[kind]}`;
    statusDiv.textContent = text;
}

let videoDuration = null; // seconds, null if unknown

async function initFFmpeg() {
    try {
        await ffmpeg.load();
        setStatus("🚀 FFmpeg ready locally in your browser! Nothing is uploaded.", "ok");
        videoInput.disabled = false;
        processBtn.disabled = false;
    } catch (e) {
        setStatus("Error loading browser FFmpeg engine. Try reloading.", "error");
        console.error(e);
    }
}
initFFmpeg();

let logSink = null; // when set, ffmpeg log messages are also collected here (detection passes)

ffmpeg.setLogger(({ type, message }) => {
    if (logSink !== null) logSink.push(message);
    logOutput.classList.remove('hidden');
    const logLine = document.createElement('div');
    logLine.textContent = `[${type}] ${message}`;
    logOutput.appendChild(logLine);
    logOutput.scrollTop = logOutput.scrollHeight;
});

// ---- Segment rows -------------------------------------------------

function renumberRows() {
    segmentsContainer.querySelectorAll('.segment-row').forEach((row, i) => {
        row.querySelector('.part-label').textContent = `Part ${i + 1}:`;
        row.querySelector('.segment-name').placeholder = `Part ${i + 1}`;
    });
}

function addSegmentRow(start = "", end = "", name = "") {
    const row = document.createElement('div');
    row.className = "segment-row flex items-center gap-2 bg-slate-800/50 p-2 rounded border border-slate-700/50";
    const inputClass = "bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-emerald-500";

    const label = document.createElement('span');
    label.className = "part-label text-xs text-slate-400 font-bold whitespace-nowrap";

    const nameInput = document.createElement('input');
    nameInput.type = "text";
    nameInput.value = name;
    nameInput.setAttribute('aria-label', 'Segment name');
    nameInput.className = `segment-name ${inputClass} w-full min-w-0`;

    const startInput = document.createElement('input');
    startInput.type = "text";
    startInput.placeholder = "Start";
    startInput.value = start;
    startInput.setAttribute('aria-label', 'Start time');
    startInput.className = `start-time ${inputClass} w-28`;

    const endInput = document.createElement('input');
    endInput.type = "text";
    endInput.placeholder = "End";
    endInput.value = end;
    endInput.setAttribute('aria-label', 'End time');
    endInput.className = `end-time ${inputClass} w-28`;

    const playBtn = document.createElement('button');
    playBtn.type = "button";
    playBtn.textContent = "▶";
    playBtn.setAttribute('aria-label', 'Preview this part');
    playBtn.className = "play-btn text-emerald-400 hover:text-emerald-300 text-sm px-2 cursor-pointer";
    playBtn.addEventListener('click', () => playSegment(startInput.value, endInput.value));

    const removeBtn = document.createElement('button');
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute('aria-label', 'Remove part');
    removeBtn.className = "remove-btn text-red-400 hover:text-red-300 text-sm font-bold px-2 cursor-pointer";
    removeBtn.addEventListener('click', () => { row.remove(); renumberRows(); });

    row.append(label, nameInput, startInput, endInput, playBtn, removeBtn);
    segmentsContainer.appendChild(row);
    renumberRows();
}

// ---- Preview player -----------------------------------------------

const preview = document.getElementById('preview');
let previewUrl = null;
let previewStopAt = null;

preview.addEventListener('timeupdate', () => {
    if (previewStopAt !== null && preview.currentTime >= previewStopAt) {
        preview.pause();
        previewStopAt = null;
    }
});

function setPreviewFile(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : null;
    previewStopAt = null;
    if (previewUrl) { preview.src = previewUrl; preview.classList.remove('hidden'); }
    else { preview.removeAttribute('src'); preview.classList.add('hidden'); }
}

function playSegment(startText, endText) {
    const start = parseTime(startText);
    const end = parseTime(endText);
    if (start === null || end === null || end <= start) return;
    preview.currentTime = start;
    previewStopAt = end;
    preview.play();
}

let listEdited = false; // true once the user has changed the segment list by hand
addSegmentBtn.addEventListener('click', () => { addSegmentRow(); listEdited = true; });
segmentsContainer.addEventListener('input', () => { listEdited = true; });
segmentsContainer.addEventListener('click', (e) => { if (e.target.closest('.remove-btn')) listEdited = true; });

// ---- Input handling -----------------------------------------------

function formatTime(sec) {
    const s = Math.floor(sec);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const r = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${r}`;
}

// Accepts "90", "90.5", "1:30", "01:30:00" (optionally with fractional seconds). Returns seconds or null.
function parseTime(text) {
    const parts = text.trim().split(':');
    if (parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
    return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

function readDuration(file) {
    return new Promise(resolve => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : null); };
        v.onloadedmetadata = () => done(v.duration);
        v.onerror = () => done(null);
        v.src = url;
    });
}

// ---- Detection ----------------------------------------------------

const RAW_MIN_SILENCE = 0.3; // seconds; ffmpeg reports silences this short so minGap can be changed without re-running
const BLACK_ARGS = 'scale=160:-2,blackdetect=d=0.5:pic_th=0.98:pix_th=0.10';

let currentRunId = 0;       // bumped on every file pick; stale runs discard their results
let lastRun = Promise.resolve(); // ffmpeg.wasm runs one command at a time, so runs are chained
let probe = null;           // { duration, hasAudio, hasVideo } for the loaded file
let rawSilence = [];
let rawBlack = null;        // null = black pass not run yet
let rawSilenceDb = null;    // threshold the stored silence intervals were computed with
let progressBase = 0;
let progressSpan = 1;

ffmpeg.setProgress(({ ratio }) => {
    if (Number.isFinite(ratio)) detectProgress.value = Math.min(1, progressBase + ratio * progressSpan);
});

function readSettings() {
    return {
        noiseDb: Number(optNoise.value),
        minGap: Number(optMinGap.value),
        minSegment: Number(optMinSeg.value),
        useBlack: optBlack.checked,
    };
}

function formatTimeFine(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = (sec % 60).toFixed(2).padStart(5, '0');
    return `${h}:${m}:${s}`;
}

// Runs one ffmpeg command and returns the log text it produced.
async function runCollecting(args, base, span) {
    const lines = [];
    logSink = lines;
    progressBase = base;
    progressSpan = span;
    try { await ffmpeg.run(...args); }
    finally { logSink = null; }
    return lines.join('\n');
}

async function silencePass(base, span) {
    const db = readSettings().noiseDb;
    const text = await runCollecting(
        ['-i', 'input.mp4', '-vn', '-af', `silencedetect=noise=${db}dB:d=${RAW_MIN_SILENCE}`, '-f', 'null', '-'], base, span);
    rawSilence = Detect.parseSilenceLog(text, probe.duration);
    rawSilenceDb = db;
}

async function blackPass(base, span) {
    const text = await runCollecting(['-i', 'input.mp4', '-an', '-vf', BLACK_ARGS, '-f', 'null', '-'], base, span);
    rawBlack = Detect.parseBlackLog(text);
}

function renderSegments(segments) {
    segmentsContainer.innerHTML = '';
    segments.forEach(seg => addSegmentRow(formatTimeFine(seg.start), formatTimeFine(seg.end)));
    listEdited = false;
}

// Rebuilds the segment list from stored raw intervals and the current settings (no ffmpeg work).
function rebuildSegments() {
    if (!probe) return;
    const s = readSettings();
    const gaps = Detect.buildGaps(rawSilence, rawBlack || [], probe, s);
    const segments = Detect.buildSegments(gaps, probe.duration, s.minSegment);
    detectNote.textContent = gaps.length === 0 ? "No gaps found — showing the whole video. Add parts by hand if needed." : "";
    renderSegments(segments);
}

function setDetecting(on) {
    detectProgress.classList.toggle('hidden', !on);
    processBtn.disabled = on;
    [optNoise, optMinGap, optMinSeg, optBlack].forEach(el => { el.disabled = on; });
}

function ffmpegHasInput() {
    try { ffmpeg.FS('stat', 'input.mp4'); return true; } catch (_) { return false; }
}

function clearInputFile() {
    try { ffmpeg.FS('unlink', 'input.mp4'); } catch (_) { /* not there */ }
}

async function runDetection(file, runId) {
    const stale = () => runId !== currentRunId;
    if (stale()) return;
    setDetecting(true);
    detectProgress.value = 0;
    probe = null; rawSilence = []; rawBlack = null; rawSilenceDb = null;
    try {
        setStatus("Loading video for analysis...");
        clearInputFile();
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(file));
        if (stale()) return;

        const probeText = await runCollecting(['-i', 'input.mp4', '-t', '0', '-f', 'null', '-'], 0, 0);
        const info = Detect.parseProbeLog(probeText);
        if (stale()) return;
        const duration = info.duration ?? videoDuration;
        if (duration === null || (!info.hasAudio && !info.hasVideo)) throw new Error("could not read this video");
        probe = { duration, hasAudio: info.hasAudio, hasVideo: info.hasVideo };

        const s = readSettings();
        const needBlack = probe.hasVideo && (s.useBlack || !probe.hasAudio);
        const passes = (probe.hasAudio ? 1 : 0) + (needBlack ? 1 : 0);
        let done = 0;
        if (probe.hasAudio) {
            setStatus("Looking for silence...");
            await silencePass(done / passes, 1 / passes); done++;
            if (stale()) return;
        }
        if (needBlack) {
            setStatus("Looking for black frames...");
            await blackPass(done / passes, 1 / passes);
            if (stale()) return;
        }
        rebuildSegments();
        setStatus("Segments detected — review the list, rename, then export.", "ok");
    } catch (err) {
        if (stale()) return;
        console.error(err);
        const dur = probe ? probe.duration : videoDuration;
        detectNote.textContent = "";
        renderSegments(dur ? [{ start: 0, end: dur }] : []);
        setStatus(`Automatic detection failed (${err.message || err}). Add parts by hand.`, "error");
    } finally {
        setDetecting(false); // a queued newer run switches it back on immediately
    }
}

videoInput.addEventListener('change', async () => {
    const file = videoInput.files[0];
    const runId = ++currentRunId;
    videoDuration = null;
    probe = null;
    fileInfo.textContent = "";
    detectNote.textContent = "";
    segmentsContainer.innerHTML = '';
    setPreviewFile(file || null);
    if (!file) return;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    if (file.size > MAX_INPUT_BYTES) {
        fileInfo.textContent = `⚠ ${sizeMB} MB is too large for in-browser processing (limit ≈ ${MAX_INPUT_BYTES / 1024 / 1024 / 1024} GB).`;
        return;
    }
    videoDuration = await readDuration(file);
    if (runId !== currentRunId) return;
    fileInfo.textContent = videoDuration === null
        ? `${file.name} — ${sizeMB} MB`
        : `${file.name} — ${sizeMB} MB — duration ${formatTime(videoDuration)}`;
    lastRun = lastRun.then(() => runDetection(file, runId));
});

// Settings changes: gap/segment lengths only rebuild; threshold and black toggle may need a pass.
async function onSettingsChange() {
    if (!probe) return;
    if (listEdited && !confirm("Changing detection settings replaces the segments you edited. Continue?")) return;
    const runId = currentRunId;
    const s = readSettings();
    const needSilence = probe.hasAudio && rawSilenceDb !== s.noiseDb;
    const needBlack = probe.hasVideo && (s.useBlack || !probe.hasAudio) && rawBlack === null;
    if (needSilence || needBlack) {
        lastRun = lastRun.then(async () => {
            if (runId !== currentRunId) return;
            setDetecting(true);
            detectProgress.value = 0;
            try {
                if (needSilence) { setStatus("Re-checking silence..."); await silencePass(0, needBlack ? 0.5 : 1); }
                if (needBlack && runId === currentRunId) { setStatus("Looking for black frames..."); await blackPass(needSilence ? 0.5 : 0, needSilence ? 0.5 : 1); }
                if (runId === currentRunId) { rebuildSegments(); setStatus("Segments updated.", "ok"); }
            } catch (err) {
                console.error(err);
                setStatus(`Detection failed (${err.message || err}).`, "error");
            } finally {
                setDetecting(false);
            }
        });
    } else {
        rebuildSegments();
    }
}
[optNoise, optMinGap, optMinSeg, optBlack].forEach(el => el.addEventListener('change', onSettingsChange));

// Returns [{start, end, n, name}] or throws an Error with a user-facing message.
function collectSegments() {
    const rows = segmentsContainer.querySelectorAll('.segment-row');
    if (rows.length === 0) throw new Error("Add at least one part.");
    const segments = Array.from(rows).map((row, i) => {
        const n = i + 1;
        const startText = row.querySelector('.start-time').value;
        const endText = row.querySelector('.end-time').value;
        if (!startText.trim() || !endText.trim()) throw new Error(`Part ${n}: fill in both start and end.`);
        const start = parseTime(startText);
        const end = parseTime(endText);
        if (start === null) throw new Error(`Part ${n}: "${startText}" is not a valid time.`);
        if (end === null) throw new Error(`Part ${n}: "${endText}" is not a valid time.`);
        if (end <= start) throw new Error(`Part ${n}: end must be after start.`);
        if (videoDuration !== null && start >= videoDuration) {
            throw new Error(`Part ${n}: start is beyond the video length (${formatTime(videoDuration)}).`);
        }
        const name = Detect.sanitizeName(row.querySelector('.segment-name').value, `Part ${n}`);
        return { start: startText.trim(), end: endText.trim(), n, name };
    });
    const unique = Detect.uniqueNames(segments.map(seg => seg.name));
    segments.forEach((seg, i) => { seg.name = unique[i]; });
    return segments;
}

function safeBaseName(name) {
    return name.replace(/\.mp4$/i, '').replace(/[^\w.\- ]+/g, '_') || 'video';
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
}

// ---- Split & export -----------------------------------------------

processBtn.addEventListener('click', async () => {
    const file = videoInput.files[0];
    if (!file) { alert("Please select an MP4 video file first!"); return; }
    if (file.size > MAX_INPUT_BYTES) { alert("This file is too large to process in the browser."); return; }

    let segments;
    try { segments = collectSegments(); }
    catch (err) { setStatus(err.message, "error"); return; }

    processBtn.disabled = true;
    videoInput.disabled = true;
    const base = safeBaseName(file.name);
    const results = [];

    try {
        await lastRun; // wait for any detection still using ffmpeg
        if (!ffmpegHasInput()) {
            setStatus("Loading video into memory...");
            ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(file));
        }

        // ffmpeg.wasm 0.11 runs one command at a time, so parts are processed sequentially.
        for (const seg of segments) {
            setStatus(`Cutting part ${seg.n} of ${segments.length} losslessly...`);
            const tmpName = `part_${seg.n}.mp4`;
            try {
                await ffmpeg.run(
                    '-ss', seg.start, '-to', seg.end, '-i', 'input.mp4',
                    '-map', '0:v?', '-map', '0:a?', '-map', '0:s?',
                    '-c', 'copy',
                    '-avoid_negative_ts', 'make_zero',
                    tmpName
                );
                const data = ffmpeg.FS('readFile', tmpName);
                results.push({ name: `${seg.name}.mp4`, data: new Uint8Array(data) });
            } finally {
                try { ffmpeg.FS('unlink', tmpName); } catch (_) { /* never created */ }
            }
        }

        if (results.length === 1) {
            triggerDownload(new Blob([results[0].data], { type: 'video/mp4' }), results[0].name);
        } else {
            setStatus("Packing parts into a zip...");
            const zip = new JSZip();
            // MP4 is already compressed; store without re-deflating.
            results.forEach(r => zip.file(r.name, r.data, { compression: 'STORE' }));
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            triggerDownload(zipBlob, `${base}_parts.zip`);
        }
        setStatus(`🎉 Exported ${results.length} part${results.length > 1 ? 's' : ''}.`, "ok");
    } catch (err) {
        console.error(err);
        setStatus(`Something went wrong: ${err.message || err}. Try a smaller file or reload the page.`, "error");
    } finally {
        processBtn.disabled = false;
        videoInput.disabled = false;
    }
});
