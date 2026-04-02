// === DATA MODEL ===

const NUM_GRIDS = 4;
const GRID_SIZE = 16; // 4x4
const TOTAL_SLOTS = NUM_GRIDS * GRID_SIZE;

// Each slot: { mode: 'song'|'oneshot', file: null | { path, onDisk, buffer } }
const slots = Array.from({ length: TOTAL_SLOTS }, () => ({
  mode: 'song',
  file: null
}));

// === AUDIO ===

const audioCtx = new AudioContext();
const activeSources = new Map(); // slotIndex -> AudioBufferSourceNode

// === RENDERING ===

const gridsContainer = document.getElementById('grids');
const slotElements = []; // parallel array of DOM elements

function basename(p) {
  return p.split('/').pop().split('\\').pop();
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
}

async function relocateSlotFile(i) {
  const filePath = await window.electronAPI.openFileDialog({
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac'] }]
  });
  if (!filePath) return;
  const exists = await window.electronAPI.fileExists(filePath);
  slots[i].file = { path: filePath, onDisk: exists, buffer: null };
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

  el.appendChild(div);
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
        select.appendChild(opt1);
        select.appendChild(opt2);
        select.addEventListener('change', () => {
          slots[i].mode = select.value;
          autosave();
        });

        el.appendChild(select);

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

          const file = e.dataTransfer.files[0];
          if (!file) return;
          const filePath = window.electronAPI.getFilePath(file);
          if (!filePath) return;

          const exists = await window.electronAPI.fileExists(filePath);
          slots[i].file = {
            path: filePath,
            onDisk: exists,
            buffer: null
          };
          renderSlot(i);
          autosave();
          if (exists) loadSlotAudio(i);
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

function buildNoteMap() {
  for (let g = 0; g < NUM_GRIDS; g++) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const slotIndex = g * GRID_SIZE + r * 4 + c;
        const note = (g * 16) + NOTE_OFFSET + (3 - r) * 4 + c;
        noteToSlot.set(note, slotIndex);
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
    slotElements[i].classList.remove('playing');
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
    slotElements[i].classList.remove('playing');
  };
  source.start();
  activeSources.set(i, source);
  slotElements[i].classList.add('playing');
}

function killAllAudio() {
  for (const i of Array.from(activeSources.keys())) {
    stopSlot(i);
  }
  currentSongSlot = null;
}

function handleMidiNoteOn(note) {
  const slotIndex = noteToSlot.get(note);
  if (slotIndex === undefined) return;
  const slot = slots[slotIndex];
  if (slot.mode === 'song') {
    playSong(slotIndex);
  } else {
    playOneshot(slotIndex);
  }
}

function handleMidiNoteOff(note) {
  const slotIndex = noteToSlot.get(note);
  if (slotIndex === undefined) return;
  const slot = slots[slotIndex];
  // oneshot stops on note off; songs play to completion
  if (slot.mode === 'oneshot') {
    stopSlot(slotIndex);
  }
}

// === STATE PERSISTENCE ===

function serializeState() {
  return slots.map((slot, i) => {
    if (!slot.file) return { mode: slot.mode, file: null };
    return { mode: slot.mode, file: { path: slot.file.path } };
  });
}

async function saveState() {
  await window.electronAPI.saveState(serializeState());
}

async function restoreState() {
  const saved = await window.electronAPI.loadState();
  if (!saved || !Array.isArray(saved)) return;

  for (let i = 0; i < Math.min(saved.length, TOTAL_SLOTS); i++) {
    const entry = saved[i];
    if (!entry) continue;
    slots[i].mode = entry.mode || 'song';
    if (entry.file && entry.file.path) {
      const exists = await window.electronAPI.fileExists(entry.file.path);
      slots[i].file = { path: entry.file.path, onDisk: exists, buffer: null };
    }
    renderSlot(i);
  }
}

function autosave() {
  saveState();
}

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

// === MIDI ===

const midiStatusDot = document.getElementById('midi-status-dot');
const midiDeviceSelect = document.getElementById('midi-device-select');
const midiDeviceName = document.getElementById('midi-device-name');
const midiLog = document.getElementById('midi-log');

let midiAccess = null;
let activeInput = null;
const MAX_LOG_LINES = 50;

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

// === INIT ===

async function init() {
  buildUI();
  buildNoteMap();
  await restoreState();
  initMidi();
}

init();
