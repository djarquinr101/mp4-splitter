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

ffmpeg.setLogger(({ type, message }) => {
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
    });
}

function addSegmentRow(start = "", end = "") {
    const row = document.createElement('div');
    row.className = "segment-row flex items-center space-x-3 bg-slate-800/50 p-2 rounded border border-slate-700/50";

    const label = document.createElement('span');
    label.className = "part-label text-xs text-slate-400 font-bold whitespace-nowrap";

    const startInput = document.createElement('input');
    startInput.type = "text";
    startInput.placeholder = "Start (e.g. 00:01:20)";
    startInput.value = start;
    startInput.setAttribute('aria-label', 'Start time');
    startInput.className = "start-time bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm w-full focus:outline-none focus:border-emerald-500";

    const endInput = document.createElement('input');
    endInput.type = "text";
    endInput.placeholder = "End (e.g. 00:02:05)";
    endInput.value = end;
    endInput.setAttribute('aria-label', 'End time');
    endInput.className = "end-time bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm w-full focus:outline-none focus:border-emerald-500";

    const removeBtn = document.createElement('button');
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute('aria-label', 'Remove part');
    removeBtn.className = "text-red-400 hover:text-red-300 text-sm font-bold px-2 cursor-pointer";
    removeBtn.addEventListener('click', () => { row.remove(); renumberRows(); });

    row.append(label, startInput, endInput, removeBtn);
    segmentsContainer.appendChild(row);
    renumberRows();
}

addSegmentRow("00:00:00", "00:00:10");
addSegmentRow("00:00:10", "00:00:25");
addSegmentBtn.addEventListener('click', () => addSegmentRow());

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

videoInput.addEventListener('change', async () => {
    const file = videoInput.files[0];
    videoDuration = null;
    fileInfo.textContent = "";
    if (!file) return;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    if (file.size > MAX_INPUT_BYTES) {
        fileInfo.textContent = `⚠ ${sizeMB} MB is too large for in-browser processing (limit ≈ ${MAX_INPUT_BYTES / 1024 / 1024 / 1024} GB).`;
        return;
    }
    videoDuration = await readDuration(file);
    fileInfo.textContent = videoDuration === null
        ? `${file.name} — ${sizeMB} MB`
        : `${file.name} — ${sizeMB} MB — duration ${formatTime(videoDuration)}`;
});

// Returns [{start, end, label}] or throws an Error with a user-facing message.
function collectSegments() {
    const rows = segmentsContainer.querySelectorAll('.segment-row');
    if (rows.length === 0) throw new Error("Add at least one part.");
    return Array.from(rows).map((row, i) => {
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
        return { start: startText.trim(), end: endText.trim(), n };
    });
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
    let inputWritten = false;

    try {
        setStatus("Loading video into memory...");
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(file));
        inputWritten = true;

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
                results.push({ name: `part_${seg.n}_${base}.mp4`, data: new Uint8Array(data) });
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
        if (inputWritten) {
            try { ffmpeg.FS('unlink', 'input.mp4'); } catch (_) { /* already gone */ }
        }
        processBtn.disabled = false;
        videoInput.disabled = false;
    }
});
