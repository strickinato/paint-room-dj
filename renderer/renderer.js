// === DATA MODEL ===

const NUM_GRIDS = 4;
const GRID_SIZE = 16; // 4x4
const TOTAL_SLOTS = NUM_GRIDS * GRID_SIZE;

// Each slot: { mode: 'song'|'oneshot'|'stop', file: null | { path, onDisk, buffer } }
// At runtime, file.path is always absolute.
// In data.json, file.path is relative to the project directory.
const slots = Array.from({ length: TOTAL_SLOTS }, () => ({
  mode: 'song',
  file: null
}));

let projectDir = null;

// === AUDIO ===

const audioCtx = new AudioContext();
const activeSources = new Map(); // slotIndex -> AudioBufferSourceNode

// === RENDERING ===

const gridsContainer = document.getElementById('grids');
const slotElements = []; // parallel array of DOM elements
const projectDirName = document.getElementById('project-dir-name');

function basename(p) {
  return p.split('/').pop().split('\\').pop();
}

function updateProjectUI() {
  if (projectDir) {
    projectDirName.textContent = basename(projectDir);
    projectDirName.title = projectDir;
  } else {
    projectDirName.textContent = '(none)';
    projectDirName.title = '';
  }
}

async function refreshMediaList() {
  const list = document.getElementById('media-list');
  list.innerHTML = '';
  if (!projectDir) return;
  const files = await window.electronAPI.listAudioFiles(projectDir);
  for (const filename of files) {
    const div = document.createElement('div');
    div.className = 'media-item';
    div.textContent = filename;
    div.draggable = true;
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/media-filename', filename);
    });
    list.appendChild(div);
  }
}

async function loadSlotAudio(i) {
  const slot = slots[i];
  if (!slot.file || !slot.file.onDisk) return;
  try {
    const data = await window.electronAPI.readFile(slot.file.path);
    // IPC may return Uint8Array instead of ArrayBuffer; decodeAudioData needs ArrayBuffer
    const arrayBuffer = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    slot.file.buffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.error(`Failed to load slot ${i}: ${err.message}`);
    slot.file.buffer = null;
  }
  renderSlot(i);
  sendColors();
}

async function relocateSlotFile(i) {
  const filePath = await window.electronAPI.openFileDialog({
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac'] }]
  });
  if (!filePath) return;
  // copy into project dir
  const relPath = await window.electronAPI.copyIntoProject(projectDir, filePath);
  const absPath = await window.electronAPI.resolvePath(projectDir, relPath);
  const exists = await window.electronAPI.fileExists(absPath);
  slots[i].file = { path: absPath, onDisk: exists, buffer: null };
  renderSlot(i);
  autosave();
}

function renderSlot(i) {
  const el = slotElements[i];
  const slot = slots[i];
  const select = el.querySelector('select');

  // remove old content except the select
  const info = el.querySelector('.slot-info');
  if (info) info.remove();

  const div = document.createElement('div');
  div.className = 'slot-info';

  if (!slot.file) {
    // not associated
    div.innerHTML = '<span class="slot-label empty">&lt;empty&gt;</span>';
  } else if (!slot.file.onDisk) {
    // associated but file missing
    const dot = document.createElement('span');
    dot.className = 'slot-dot red';
    const label = document.createElement('span');
    label.className = 'slot-label missing';
    label.textContent = 'cannot find file';
    label.addEventListener('click', () => relocateSlotFile(i));
    div.appendChild(dot);
    div.appendChild(label);
  } else if (!slot.file.buffer) {
    // on disk, not loaded
    const dot = document.createElement('span');
    dot.className = 'slot-dot yellow';
    const label = document.createElement('span');
    label.className = 'slot-label';
    label.textContent = basename(slot.file.path);
    const btn = document.createElement('button');
    btn.className = 'slot-load-btn';
    btn.textContent = 'load';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadSlotAudio(i);
    });
    div.appendChild(dot);
    div.appendChild(label);
    div.appendChild(btn);
  } else {
    // loaded and ready
    const dot = document.createElement('span');
    dot.className = 'slot-dot green';
    const label = document.createElement('span');
    label.className = 'slot-label';
    label.textContent = basename(slot.file.path);
    div.appendChild(dot);
    div.appendChild(label);
  }

  // remove old X button
  const oldRemove = el.querySelector('.slot-remove');
  if (oldRemove) oldRemove.remove();

  el.appendChild(div);

  if (slot.file) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'slot-remove';
    removeBtn.textContent = 'x';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopSlot(i);
      slots[i].file = null;
      renderSlot(i);
      autosave();
    });
    el.appendChild(removeBtn);
  }

  el.title = slot.file ? slot.file.path : 'empty';
  select.value = slot.mode;
}

function buildUI() {
  for (let g = 0; g < NUM_GRIDS; g++) {
    const grid = document.createElement('div');
    grid.className = 'grid';

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const i = g * GRID_SIZE + r * 4 + c;
        const el = document.createElement('div');
        el.className = 'slot';

        const select = document.createElement('select');
        const opt1 = document.createElement('option');
        opt1.value = 'song';
        opt1.textContent = 'song';
        const opt2 = document.createElement('option');
        opt2.value = 'oneshot';
        opt2.textContent = 'oneshot';
        const opt3 = document.createElement('option');
        opt3.value = 'stop';
        opt3.textContent = 'stop';
        select.appendChild(opt1);
        select.appendChild(opt2);
        select.appendChild(opt3);
        select.addEventListener('change', () => {
          slots[i].mode = select.value;
          autosave();
        });
        select.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        el.appendChild(select);

        el.addEventListener('click', () => {
          triggerSlot(i);
        });

        // make slot draggable for slot-to-slot drag
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          if (!slots[i].file) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/slot-index', String(i));
          e.dataTransfer.effectAllowed = 'move';
        });

        // drag and drop
        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          el.classList.add('dragover');
        });
        el.addEventListener('dragleave', () => {
          el.classList.remove('dragover');
        });
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          el.classList.remove('dragover');

          // 1) slot-to-slot drag
          const sourceSlotStr = e.dataTransfer.getData('text/slot-index');
          if (sourceSlotStr !== '') {
            const srcIdx = parseInt(sourceSlotStr, 10);
            if (srcIdx === i) return;
            // swap slot data
            const srcFile = slots[srcIdx].file;
            const srcMode = slots[srcIdx].mode;
            slots[srcIdx].file = slots[i].file;
            slots[srcIdx].mode = slots[i].mode;
            slots[i].file = srcFile;
            slots[i].mode = srcMode;
            renderSlot(srcIdx);
            renderSlot(i);
            autosave();
            return;
          }

          // 2) media list drag
          const mediaFilename = e.dataTransfer.getData('text/media-filename');
          if (mediaFilename) {
            const absPath = await window.electronAPI.resolvePath(projectDir, mediaFilename);
            const exists = await window.electronAPI.fileExists(absPath);
            slots[i].file = { path: absPath, onDisk: exists, buffer: null };
            renderSlot(i);
            autosave();
            loadSlotAudio(i);
            return;
          }

          // 3) external file drop
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const sourcePath = window.electronAPI.getFilePath(file);
          if (!sourcePath) return;

          // copy file into project directory
          const relPath = await window.electronAPI.copyIntoProject(projectDir, sourcePath);
          const absPath = await window.electronAPI.resolvePath(projectDir, relPath);
          slots[i].file = {
            path: absPath,
            onDisk: true,
            buffer: null
          };
          renderSlot(i);
          autosave();
          loadSlotAudio(i);
          refreshMediaList();
        });

        slotElements.push(el);
        grid.appendChild(el);
        renderSlot(i);
      }
    }

    gridsContainer.appendChild(grid);
  }
}

// === MIDI NOTE -> SLOT MAPPING (MidiFighter 3D) ===
// MF3D Bank 1: notes 36-51, Bank 2: 52-67, Bank 3: 68-83, Bank 4: 84-99
// Bottom-left of each bank starts at the lowest note.
// Our grid: row 0 = top, row 3 = bottom. MF3D: lowest notes = bottom row.
// So for grid g, row r, col c: note = (g*16) + 36 + (3-r)*4 + c

const NOTE_OFFSET = 36;
const noteToSlot = new Map();
const slotToNote = new Map();

function buildNoteMap() {
  for (let g = 0; g < NUM_GRIDS; g++) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const slotIndex = g * GRID_SIZE + r * 4 + c;
        const note = (g * 16) + NOTE_OFFSET + (3 - r) * 4 + c;
        noteToSlot.set(note, slotIndex);
        slotToNote.set(slotIndex, note);
      }
    }
  }
}

// === PLAYBACK ===

let currentSongSlot = null; // index of currently playing song slot

function stopSlot(i) {
  const source = activeSources.get(i);
  if (source) {
    source.onended = null;
    try { source.stop(); } catch (e) { /* already stopped */ }
    activeSources.delete(i);
    slotElements[i].classList.remove('playing', 'playing-oneshot');
  }
  if (currentSongSlot === i) {
    currentSongSlot = null;
  }
}

function getReadySongSlots(excludeIndex) {
  const result = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (i === excludeIndex) continue;
    const s = slots[i];
    if (s.mode === 'song' && s.file && s.file.buffer) {
      result.push(i);
    }
  }
  return result;
}

function playNextSong(finishedIndex) {
  const candidates = getReadySongSlots(finishedIndex);
  if (candidates.length === 0) return;
  const next = candidates[Math.floor(Math.random() * candidates.length)];
  playSong(next);
}

function playSong(i) {
  const slot = slots[i];
  if (!slot.file || !slot.file.buffer) return;

  // stop any currently playing song
  if (currentSongSlot !== null) {
    stopSlot(currentSongSlot);
  }

  const source = audioCtx.createBufferSource();
  source.buffer = slot.file.buffer;
  source.connect(audioCtx.destination);
  source.onended = () => {
    activeSources.delete(i);
    slotElements[i].classList.remove('playing');
    if (currentSongSlot === i) {
      currentSongSlot = null;
      playNextSong(i);
    }
  };
  source.start();
  activeSources.set(i, source);
  slotElements[i].classList.add('playing');
  currentSongSlot = i;
}

function playOneshot(i) {
  const slot = slots[i];
  if (!slot.file || !slot.file.buffer) return;

  // stop if this specific oneshot is already playing
  stopSlot(i);

  const source = audioCtx.createBufferSource();
  source.buffer = slot.file.buffer;
  source.connect(audioCtx.destination);
  source.onended = () => {
    activeSources.delete(i);
    slotElements[i].classList.remove('playing-oneshot');
  };
  source.start();
  activeSources.set(i, source);
  slotElements[i].classList.add('playing-oneshot');
}

function killAllAudio() {
  for (const i of Array.from(activeSources.keys())) {
    stopSlot(i);
  }
  currentSongSlot = null;
}

// === SLOT COMMANDS ===

function triggerSlot(i) {
  const slot = slots[i];
  if (slot.mode === 'song') {
    playSong(i);
  } else if (slot.mode === 'oneshot') {
    playOneshot(i);
  } else if (slot.mode === 'stop') {
    killAllAudio();
  }
}

function releaseSlot(i) {
  const slot = slots[i];
  if (slot.mode === 'oneshot') {
    stopSlot(i);
  }
}

function handleMidiNoteOn(note) {
  const i = noteToSlot.get(note);
  if (i === undefined) return;
  triggerSlot(i);
}

function handleMidiNoteOff(note) {
  const i = noteToSlot.get(note);
  if (i === undefined) return;
  releaseSlot(i);
}

// === STATE PERSISTENCE ===

async function serializeState() {
  const result = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const slot = slots[i];
    if (!slot.file) {
      result.push({ mode: slot.mode, file: null });
    } else {
      const relPath = await window.electronAPI.relativePath(projectDir, slot.file.path);
      result.push({ mode: slot.mode, file: { path: relPath } });
    }
  }
  return result;
}

async function saveState() {
  if (!projectDir) return;
  const state = await serializeState();
  await window.electronAPI.saveState(projectDir, state);
}

async function restoreState() {
  if (!projectDir) return;
  const saved = await window.electronAPI.loadState(projectDir);
  if (!saved || !Array.isArray(saved)) return;

  for (let i = 0; i < Math.min(saved.length, TOTAL_SLOTS); i++) {
    const entry = saved[i];
    if (!entry) continue;
    slots[i].mode = entry.mode || 'song';
    if (entry.file && entry.file.path) {
      const absPath = await window.electronAPI.resolvePath(projectDir, entry.file.path);
      const exists = await window.electronAPI.fileExists(absPath);
      slots[i].file = { path: absPath, onDisk: exists, buffer: null };
    }
    renderSlot(i);
  }
  sendColors();
}

function autosave() {
  saveState();
  sendColors();
}

// === PROJECT DIRECTORY ===

async function pickProjectDir() {
  const dir = await window.electronAPI.openDirectoryDialog();
  if (!dir) return null;
  await window.electronAPI.setProjectDir(dir);
  return dir;
}

function clearAllSlots() {
  killAllAudio();
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    slots[i].mode = 'song';
    slots[i].file = null;
    renderSlot(i);
  }
  sendColors();
}

async function switchProject(dir) {
  clearAllSlots();
  projectDir = dir;
  updateProjectUI();
  await restoreState();
  refreshMediaList();
}

document.getElementById('btn-change-project').addEventListener('click', async () => {
  const dir = await pickProjectDir();
  if (dir) {
    await switchProject(dir);
  }
});

// === RELOAD ALL ===

document.getElementById('btn-reload-all').addEventListener('click', async () => {
  const promises = slots.map((slot, i) => {
    if (!slot.file || !slot.file.onDisk) return;
    return loadSlotAudio(i);
  });
  await Promise.all(promises);
});

document.getElementById('btn-kill-audio').addEventListener('click', () => {
  killAllAudio();
});

document.getElementById('btn-send-colors').addEventListener('click', () => {
  sendColors();
});

// === MIDI ===

const midiStatusDot = document.getElementById('midi-status-dot');
const midiDeviceSelect = document.getElementById('midi-device-select');
const midiDeviceName = document.getElementById('midi-device-name');
const midiLog = document.getElementById('midi-log');

let midiAccess = null;
let activeInput = null;
let activeOutput = null;
const MAX_LOG_LINES = 50;

// MF3D LED color velocities (note-on channel 1)
const COLOR_GREEN = 66;  // song
const COLOR_BLUE = 78;   // oneshot
const COLOR_RED = 13;    // stop

function sendColors() {
  if (!activeOutput) {
    midiLogAppend('no MIDI output connected');
    return;
  }
  let count = 0;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const note = slotToNote.get(i);
    if (note === undefined) continue;
    const slot = slots[i];
    let velocity;
    if (slot.mode === 'stop') {
      velocity = COLOR_RED;
    } else if (!slot.file) {
      velocity = 0;
    } else if (slot.mode === 'song') {
      velocity = COLOR_GREEN;
    } else {
      velocity = COLOR_BLUE;
    }
    // note-on on channel 1 (status 0x90)
    activeOutput.send([0x90, note, velocity]);
    count++;
  }
  midiLogAppend('sent ' + count + ' LED colors');
}

function midiLogAppend(text) {
  midiLog.textContent += text + '\n';
  const lines = midiLog.textContent.split('\n');
  if (lines.length > MAX_LOG_LINES) {
    midiLog.textContent = lines.slice(-MAX_LOG_LINES).join('\n');
  }
  midiLog.scrollTop = midiLog.scrollHeight;
}

function disconnectMidi() {
  if (activeInput) {
    activeInput.onmidimessage = null;
    activeInput = null;
  }
  activeOutput = null;
  midiStatusDot.classList.remove('connected');
  midiDeviceName.textContent = '';
}

function connectToInput(input) {
  disconnectMidi();
  activeInput = input;
  midiStatusDot.classList.add('connected');
  midiDeviceName.textContent = input.name;
  midiLogAppend('connected: ' + input.name);

  input.onmidimessage = (msg) => {
    const hex = Array.from(msg.data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    midiLogAppend(hex);

    const [status, note, velocity] = msg.data;
    const command = status & 0xf0;
    if (command === 0x90 && velocity > 0) {
      handleMidiNoteOn(note);
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      handleMidiNoteOff(note);
    }
  };
}

const MIDI_AUTO_CONNECT_NAME = 'Midi Fighter 3D';

function populateMidiDevices() {
  if (!midiAccess) return;

  // remember current selection
  const currentValue = midiDeviceSelect.value;

  // clear all options except the placeholder
  while (midiDeviceSelect.options.length > 1) {
    midiDeviceSelect.remove(1);
  }

  for (const input of midiAccess.inputs.values()) {
    const opt = document.createElement('option');
    opt.value = input.id;
    opt.textContent = input.name || input.id;
    midiDeviceSelect.appendChild(opt);
  }

  // restore selection if still available
  if (currentValue) {
    midiDeviceSelect.value = currentValue;
  }
}

function tryAutoConnect() {
  if (activeInput) return;
  if (!midiAccess) return;
  for (const input of midiAccess.inputs.values()) {
    if (input.name && input.name.includes(MIDI_AUTO_CONNECT_NAME)) {
      connectToInput(input);
      midiDeviceSelect.value = input.id;
      // also grab the matching output
      for (const output of midiAccess.outputs.values()) {
        if (output.name && output.name.includes(MIDI_AUTO_CONNECT_NAME)) {
          activeOutput = output;
          break;
        }
      }
      return;
    }
  }
}

midiDeviceSelect.addEventListener('change', () => {
  const id = midiDeviceSelect.value;
  if (!id || !midiAccess) {
    disconnectMidi();
    return;
  }
  const input = midiAccess.inputs.get(id);
  if (input) {
    connectToInput(input);
    // try to find a matching output by name
    activeOutput = null;
    for (const output of midiAccess.outputs.values()) {
      if (output.name && input.name && output.name.includes(input.name)) {
        activeOutput = output;
        break;
      }
    }
  }
});

async function initMidi() {
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    populateMidiDevices();
    tryAutoConnect();

    midiAccess.onstatechange = () => {
      populateMidiDevices();
      // if our active device disappeared, disconnect
      if (activeInput && activeInput.state !== 'connected') {
        midiLogAppend('disconnected: ' + activeInput.name);
        disconnectMidi();
        midiDeviceSelect.value = '';
      }
      // try auto-connect if not connected
      tryAutoConnect();
    };
  } catch (err) {
    midiLogAppend('MIDI error: ' + err.message);
  }
}

// === AUDIO OUTPUT DEVICE ===

const audioDeviceSelect = document.getElementById('audio-device-select');

async function populateAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter(d => d.kind === 'audiooutput');

  const currentValue = audioDeviceSelect.value;
  while (audioDeviceSelect.options.length > 1) {
    audioDeviceSelect.remove(1);
  }

  for (const device of outputs) {
    const opt = document.createElement('option');
    opt.value = device.deviceId;
    opt.textContent = device.label || device.deviceId;
    audioDeviceSelect.appendChild(opt);
  }

  if (currentValue) {
    audioDeviceSelect.value = currentValue;
  }
}

audioDeviceSelect.addEventListener('change', async () => {
  const deviceId = audioDeviceSelect.value;
  try {
    await audioCtx.setSinkId(deviceId || '');
  } catch (err) {
    console.error('Failed to set audio output:', err);
  }
});

// === INIT ===

async function init() {
  buildUI();
  buildNoteMap();

  // load or pick project directory
  projectDir = await window.electronAPI.getProjectDir();
  if (!projectDir) {
    projectDir = await pickProjectDir();
  }
  updateProjectUI();

  if (projectDir) {
    await restoreState();
    refreshMediaList();
  }

  initMidi();
  populateAudioDevices();
  navigator.mediaDevices.addEventListener('devicechange', populateAudioDevices);
}

init();
