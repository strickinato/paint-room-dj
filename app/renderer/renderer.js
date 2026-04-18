// === THEME ===

const THEME_CYCLE = ['auto', 'dark', 'light'];
const THEME_LABELS = { auto: 'Auto', dark: 'Dark', light: 'Light' };
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(pref) {
  let resolved;
  if (pref === 'auto') {
    resolved = darkMQ.matches ? 'dark' : 'light';
  } else {
    resolved = pref;
  }
  document.documentElement.setAttribute('data-theme', resolved);
}

let themePref = localStorage.getItem('theme') || 'auto';
applyTheme(themePref);

darkMQ.addEventListener('change', () => {
  if (themePref === 'auto') applyTheme('auto');
});

const btnTheme = document.getElementById('btn-theme');
btnTheme.textContent = THEME_LABELS[themePref];
btnTheme.addEventListener('click', () => {
  const idx = THEME_CYCLE.indexOf(themePref);
  themePref = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  localStorage.setItem('theme', themePref);
  applyTheme(themePref);
  btnTheme.textContent = THEME_LABELS[themePref];
});

// === VIEW MODE ===

let viewMode = localStorage.getItem('viewMode') || 'all';
let activeBank = 0;

const bankTabsContainer = document.getElementById('bank-tabs');
const bankTabs = bankTabsContainer.querySelectorAll('.bank-tab');
const btnViewMode = document.getElementById('btn-view-mode');
const gridsContainer = document.getElementById('grids');

function applyViewMode() {
  if (viewMode === 'single') {
    bankTabsContainer.style.display = '';
    gridsContainer.classList.add('single-bank');
    const grids = gridsContainer.querySelectorAll('.grid');
    grids.forEach((g, idx) => {
      g.classList.toggle('active', idx === activeBank);
    });
    bankTabs.forEach(tab => {
      tab.classList.toggle('active', parseInt(tab.dataset.bank) === activeBank);
    });
    btnViewMode.textContent = 'Single Bank';
  } else {
    bankTabsContainer.style.display = 'none';
    gridsContainer.classList.remove('single-bank');
    const grids = gridsContainer.querySelectorAll('.grid');
    grids.forEach(g => g.classList.remove('active'));
    btnViewMode.textContent = 'All Banks';
  }
}

bankTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    activeBank = parseInt(tab.dataset.bank);
    applyViewMode();
  });
});

btnViewMode.addEventListener('click', () => {
  viewMode = viewMode === 'all' ? 'single' : 'all';
  localStorage.setItem('viewMode', viewMode);
  applyViewMode();
});

applyViewMode();

// === DATA MODEL ===

const NUM_GRIDS = 4;
const GRID_SIZE = 16; // 4x4
const TOTAL_SLOTS = NUM_GRIDS * GRID_SIZE;

// Each slot: { mode: 'song'|'oneshot'|'stop'|'effect', file: null | { path, onDisk, buffer }, effect: null | string }
// At runtime, file.path is always absolute.
// In data.json, file.path is relative to the project directory.
const slots = Array.from({ length: TOTAL_SLOTS }, () => ({
  mode: 'song',
  file: null,
  effect: null,
  includeInShuffle: false,
  preserveTimestamp: false,
  onFinish: 'stop'
}));

let projectDir = null;
let presets = {};

// === AUDIO ===

const audioCtx = new AudioContext();
const activeSources = new Map(); // slotIndex -> AudioBufferSourceNode

// Master audio graph: source → masterInput → [effects] → masterOutput → destination
const masterInput = audioCtx.createGain();
const masterOutput = audioCtx.createGain();
masterOutput.connect(audioCtx.destination);
masterInput.connect(masterOutput);

const activeEffects = new Map(); // slotIndex -> AudioWorkletNode
const persistentEffects = new Map(); // slotIndex -> AudioWorkletNode (always in chain)

// === EFFECTS ===


const EFFECTS = {
  bitcrusher: {
    label: 'Bitcrusher',
    create: () => new AudioWorkletNode(audioCtx, 'bitcrusher-processor'),
  },
  delay: {
    label: 'Delay',
    create: () => new AudioWorkletNode(audioCtx, 'delay-processor'),
  },
  distortion: {
    label: 'Distortion',
    create: () => new AudioWorkletNode(audioCtx, 'distortion-processor'),
  },
  doublespeed: {
    label: 'Double Speed',
    playbackRate: 2.0,
  },
  highpass: {
    label: 'EQ High Pass',
    create: () => new AudioWorkletNode(audioCtx, 'highpass-processor'),
  },
  lowpass: {
    label: 'EQ Low Pass',
    create: () => new AudioWorkletNode(audioCtx, 'lowpass-processor'),
  },
  sweepdown: {
    label: 'EQ Sweep Down',
    persistent: true,
    create: () => new AudioWorkletNode(audioCtx, 'filtersweep-processor', {
      processorOptions: { direction: 'down' },
    }),
  },
  sweepup: {
    label: 'EQ Sweep Up',
    persistent: true,
    create: () => new AudioWorkletNode(audioCtx, 'filtersweep-processor', {
      processorOptions: { direction: 'up' },
    }),
  },
  flanger: {
    label: 'Flanger',
    create: () => new AudioWorkletNode(audioCtx, 'flanger-processor'),
  },
  halfspeed: {
    label: 'Half Speed',
    playbackRate: 0.5,
  },
  reverb: {
    label: 'Reverb',
    create: () => new AudioWorkletNode(audioCtx, 'reverb-processor'),
  },
  reverse: {
    label: 'Reverse',
    persistent: true,
    create: () => new AudioWorkletNode(audioCtx, 'reverse-processor'),
  },
  ringmod: {
    label: 'Ring Mod',
    create: () => new AudioWorkletNode(audioCtx, 'ringmod-processor'),
  },
  stutter: {
    label: 'Stutter',
    persistent: true,
    create: () => new AudioWorkletNode(audioCtx, 'stutter-processor'),
  },
  tapestop: {
    label: 'Tape Stop',
    persistent: true,
    create: () => new AudioWorkletNode(audioCtx, 'tapestop-processor'),
  },
};

function rebuildEffectChain() {
  masterInput.disconnect();
  for (const node of activeEffects.values()) {
    try { node.disconnect(); } catch {}
  }
  for (const node of persistentEffects.values()) {
    try { node.disconnect(); } catch {}
  }

  // Collect all nodes: persistent (always in chain) + active
  const allNodes = [...persistentEffects.values(), ...activeEffects.values()];

  if (allNodes.length === 0) {
    masterInput.connect(masterOutput);
    return;
  }

  // chain: masterInput → node1 → node2 → ... → masterOutput
  let prev = masterInput;
  for (const node of allNodes) {
    prev.connect(node);
    prev = node;
  }
  prev.connect(masterOutput);
}

function ensurePersistentEffect(i) {
  const slot = slots[i];
  if (!slot.effect) return;
  const def = EFFECTS[slot.effect];
  if (!def || !def.persistent) return;
  if (persistentEffects.has(i)) return;
  const node = def.create();
  persistentEffects.set(i, node);
  rebuildEffectChain();
}

function removePersistentEffect(i) {
  const node = persistentEffects.get(i);
  if (!node) return;
  persistentEffects.delete(i);
  try { node.disconnect(); } catch {}
  rebuildEffectChain();
}

// Track active playback rate overrides (slotIndex -> rate)
const activePlaybackRates = new Map();

function applyPlaybackRate() {
  // If any speed effects are active, use the last one activated; otherwise 1.0
  let rate = 1.0;
  for (const r of activePlaybackRates.values()) {
    rate = r;
  }
  for (const source of activeSources.values()) {
    source.playbackRate.value = rate;
  }
}

function activateEffect(i) {
  const slot = slots[i];
  if (!slot.effect || !EFFECTS[slot.effect]) return;
  const def = EFFECTS[slot.effect];

  if (def.playbackRate) {
    activePlaybackRates.set(i, def.playbackRate);
    applyPlaybackRate();
  } else if (def.persistent) {
    ensurePersistentEffect(i);
    const node = persistentEffects.get(i);
    if (node) node.port.postMessage({ type: 'activate', rate: 0.1 });
  } else {
    if (activeEffects.has(i)) return;
    const node = def.create();
    activeEffects.set(i, node);
    rebuildEffectChain();
  }
  slotElements[i].classList.add('playing-effect');
}

function deactivateEffect(i) {
  const slot = slots[i];
  const def = slot.effect && EFFECTS[slot.effect];

  if (def && def.playbackRate) {
    activePlaybackRates.delete(i);
    applyPlaybackRate();
  } else if (def && def.persistent) {
    const node = persistentEffects.get(i);
    if (node) node.port.postMessage({ type: 'deactivate' });
  } else {
    const node = activeEffects.get(i);
    if (!node) return;
    activeEffects.delete(i);
    try { node.disconnect(); } catch {}
    rebuildEffectChain();
  }
  slotElements[i].classList.remove('playing-effect');
}

// === RENDERING ===

const slotElements = []; // parallel array of DOM elements
const projectDirName = document.getElementById('project-dir-name');

function basename(p) {
  return p.split('/').pop().split('\\').pop();
}

const projectDirSummary = document.getElementById('project-dir-summary');

function updateProjectUI() {
  if (projectDir) {
    projectDirSummary.textContent = '(' + basename(projectDir) + ')';
    projectDirName.textContent = projectDir;
  } else {
    projectDirSummary.textContent = '(none)';
    projectDirName.textContent = '';
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

function refreshShuffleList() {
  const list = document.getElementById('shuffle-list');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const s = slots[i];
    if (s.mode === 'song' && s.includeInShuffle && s.file) {
      const div = document.createElement('div');
      div.className = 'shuffle-item';
      const basename = s.file.path.split('/').pop() || s.file.path.split('\\').pop();
      div.textContent = basename;
      list.appendChild(div);
    }
  }
  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'shuffle-item shuffle-empty';
    empty.textContent = 'No songs in shuffle';
    list.appendChild(empty);
  }
}

function buildEffectsList() {
  const list = document.getElementById('effects-list');
  for (const [id, def] of Object.entries(EFFECTS)) {
    const div = document.createElement('div');
    div.className = 'effect-item';
    div.textContent = def.label;
    div.draggable = true;
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/effect-id', id);
    });
    list.appendChild(div);
  }
}

function autoloadEffects() {
  // Fill bank 4 (grid 3, slots 48-63) with all effects + a kill button
  const bankStart = 3 * GRID_SIZE; // slot 48
  const effectKeys = Object.keys(EFFECTS); // already alphabetized

  // Bottom-left of grid = row 3, col 0 = bankStart + 12
  const killSlotIndex = bankStart + 12;

  let effectIdx = 0;
  for (let pos = 0; pos < GRID_SIZE; pos++) {
    const i = bankStart + pos;
    // Clear existing effect/audio state
    if (slots[i].mode === 'effect') deactivateEffect(i);
    if (activeSources.has(i)) stopSlot(i);

    if (i === killSlotIndex) {
      // Kill button
      slots[i].mode = 'stop';
      slots[i].file = null;
      slots[i].effect = null;
    } else if (effectIdx < effectKeys.length) {
      slots[i].mode = 'effect';
      slots[i].effect = effectKeys[effectIdx];
      slots[i].file = null;
      effectIdx++;
    } else {
      slots[i].mode = 'song';
      slots[i].file = null;
      slots[i].effect = null;
    }
    renderSlot(i);
  }
  autosave();
}

document.getElementById('btn-autoload-effects').addEventListener('click', autoloadEffects);

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
  updatePlayStopButton();
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

function setupMarquee(label, wrap) {
  if (label.scrollWidth > wrap.clientWidth) {
    label.classList.add('overflowing');
    const overflow = label.scrollWidth - wrap.clientWidth;
    label.style.setProperty('--marquee-offset', -overflow + 'px');
    // ~30px per second scroll speed, minimum 4s, plus 2s for pauses at each end
    const duration = Math.max(4, (overflow / 30) + 2);
    label.style.setProperty('--marquee-duration', duration + 's');
  } else {
    label.classList.remove('overflowing');
  }
}

function clearSlot(i) {
  if (slots[i].mode === 'effect') deactivateEffect(i);
  if (activeSources.has(i)) stopSlot(i);
  slots[i].mode = 'song';
  slots[i].file = null;
  slots[i].effect = null;
  slots[i].includeInShuffle = false;
  slots[i].preserveTimestamp = false;
  slots[i].onFinish = 'stop';
  savedTimestamps.delete(i);
  startContextTimes.delete(i);
  renderSlot(i);
  autosave();
}

function convertToStop(i) {
  if (slots[i].mode === 'effect') deactivateEffect(i);
  if (activeSources.has(i)) stopSlot(i);
  slots[i].mode = 'stop';
  slots[i].file = null;
  slots[i].effect = null;
  slots[i].includeInShuffle = false;
  slots[i].preserveTimestamp = false;
  slots[i].onFinish = 'stop';
  savedTimestamps.delete(i);
  startContextTimes.delete(i);
  renderSlot(i);
  autosave();
}

function convertToEffect(i) {
  if (activeSources.has(i)) stopSlot(i);
  slots[i].mode = 'effect';
  slots[i].file = null;
  slots[i].effect = Object.keys(EFFECTS)[0];
  renderSlot(i);
  autosave();
}

function renderSlot(i) {
  const el = slotElements[i];
  const slot = slots[i];
  const controlsEl = el.querySelector('.slot-controls');

  // manage persistent effect nodes (e.g. stutter needs to always be in the chain)
  const def = slot.effect && EFFECTS[slot.effect];
  if (def && def.persistent && slot.mode === 'effect') {
    ensurePersistentEffect(i);
  } else {
    removePersistentEffect(i);
  }

  // update mode class — only show border if slot has content or is stop/effect
  el.classList.remove('mode-song', 'mode-oneshot', 'mode-stop', 'mode-effect');
  if (slot.file || slot.mode === 'stop' || (slot.mode === 'effect' && slot.effect)) {
    el.classList.add('mode-' + slot.mode);
  }

  // remove old content
  const info = el.querySelector('.slot-info');
  if (info) info.remove();

  const div = document.createElement('div');
  div.className = 'slot-info';

  // rebuild controls
  controlsEl.innerHTML = '';

  const isEmpty = !slot.file && slot.mode !== 'stop' && !(slot.mode === 'effect' && slot.effect);

  if (isEmpty) {
    // EMPTY: "stop" and "effect" buttons
    div.innerHTML = '<span class="slot-label empty">&lt;empty&gt;</span>';
    const stopBtn = document.createElement('button');
    stopBtn.className = 'slot-ctrl-btn';
    stopBtn.textContent = 'stop';
    stopBtn.addEventListener('click', (e) => { e.stopPropagation(); convertToStop(i); });
    stopBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    controlsEl.appendChild(stopBtn);

    const effectBtn = document.createElement('button');
    effectBtn.className = 'slot-ctrl-btn';
    effectBtn.textContent = 'effect';
    effectBtn.addEventListener('click', (e) => { e.stopPropagation(); convertToEffect(i); });
    effectBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    controlsEl.appendChild(effectBtn);

  } else if (slot.mode === 'stop') {
    // STOP: show label, clear button
    div.innerHTML = '<span class="slot-label stop-label">STOP</span>';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'slot-ctrl-btn';
    clearBtn.textContent = 'clear';
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearSlot(i); });
    clearBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    controlsEl.appendChild(clearBtn);

  } else if (slot.mode === 'effect') {
    // EFFECT: effect dropdown, clear, stop
    if (slot.effect && EFFECTS[slot.effect]) {
      const status = document.createElement('div');
      status.className = 'slot-status';
      const dot = document.createElement('span');
      dot.className = 'slot-dot yellow';
      const statusText = document.createElement('span');
      statusText.className = 'slot-status-text';
      statusText.textContent = 'effect';
      status.appendChild(dot);
      status.appendChild(statusText);
      const wrap = document.createElement('div');
      wrap.className = 'slot-label-wrap';
      const label = document.createElement('span');
      label.className = 'slot-label';
      label.textContent = EFFECTS[slot.effect].label;
      div.title = EFFECTS[slot.effect].label;
      wrap.appendChild(label);
      div.appendChild(wrap);
      div.appendChild(status);
      requestAnimationFrame(() => setupMarquee(label, wrap));
    }

    // effect picker dropdown
    const select = document.createElement('select');
    select.className = 'slot-effect-select';
    for (const [id, fx] of Object.entries(EFFECTS)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = fx.label;
      if (id === slot.effect) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      deactivateEffect(i);
      slots[i].effect = select.value;
      renderSlot(i);
      autosave();
    });
    select.addEventListener('click', (e) => e.stopPropagation());
    select.addEventListener('pointerdown', (e) => e.stopPropagation());
    controlsEl.appendChild(select);

    const btnRow = document.createElement('div');
    btnRow.className = 'slot-btn-row';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'slot-ctrl-btn';
    clearBtn.textContent = 'clear';
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearSlot(i); });
    clearBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btnRow.appendChild(clearBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'slot-ctrl-btn';
    stopBtn.textContent = 'stop';
    stopBtn.addEventListener('click', (e) => { e.stopPropagation(); convertToStop(i); });
    stopBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btnRow.appendChild(stopBtn);
    controlsEl.appendChild(btnRow);

  } else {
    // SONG or ONESHOT: file info, mode dropdown, clear, stop
    if (!slot.file) {
      // shouldn't happen, but safety
      div.innerHTML = '<span class="slot-label empty">&lt;empty&gt;</span>';
    } else if (!slot.file.onDisk) {
      const status = document.createElement('div');
      status.className = 'slot-status';
      const dot = document.createElement('span');
      dot.className = 'slot-dot red';
      const statusText = document.createElement('span');
      statusText.className = 'slot-status-text';
      statusText.textContent = 'missing';
      statusText.classList.add('missing');
      statusText.style.cursor = 'pointer';
      statusText.style.textDecoration = 'underline';
      statusText.style.color = 'var(--dot-red)';
      statusText.addEventListener('click', () => relocateSlotFile(i));
      status.appendChild(dot);
      status.appendChild(statusText);
      const wrap = document.createElement('div');
      wrap.className = 'slot-label-wrap';
      const label = document.createElement('span');
      label.className = 'slot-label';
      label.textContent = basename(slot.file.path);
      div.title = basename(slot.file.path);
      wrap.appendChild(label);
      div.appendChild(wrap);
      div.appendChild(status);
      requestAnimationFrame(() => setupMarquee(label, wrap));
    } else if (!slot.file.buffer) {
      const status = document.createElement('div');
      status.className = 'slot-status';
      const dot = document.createElement('span');
      dot.className = 'slot-dot yellow';
      const btn = document.createElement('button');
      btn.className = 'slot-load-btn';
      btn.textContent = 'load';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadSlotAudio(i);
      });
      status.appendChild(dot);
      status.appendChild(btn);
      const wrap = document.createElement('div');
      wrap.className = 'slot-label-wrap';
      const label = document.createElement('span');
      label.className = 'slot-label';
      label.textContent = basename(slot.file.path);
      div.title = basename(slot.file.path);
      wrap.appendChild(label);
      div.appendChild(wrap);
      div.appendChild(status);
      requestAnimationFrame(() => setupMarquee(label, wrap));
    } else {
      const status = document.createElement('div');
      status.className = 'slot-status';
      const dot = document.createElement('span');
      dot.className = 'slot-dot green';
      const statusText = document.createElement('span');
      statusText.className = 'slot-status-text';
      statusText.textContent = 'ready';
      status.appendChild(dot);
      status.appendChild(statusText);
      const wrap = document.createElement('div');
      wrap.className = 'slot-label-wrap';
      const label = document.createElement('span');
      label.className = 'slot-label';
      label.textContent = basename(slot.file.path);
      div.title = basename(slot.file.path);
      wrap.appendChild(label);
      div.appendChild(wrap);
      div.appendChild(status);
      requestAnimationFrame(() => setupMarquee(label, wrap));
    }

    // song/oneshot mode toggle
    const select = document.createElement('select');
    select.className = 'slot-mode-select';
    const opt1 = document.createElement('option');
    opt1.value = 'song'; opt1.textContent = 'song';
    const opt2 = document.createElement('option');
    opt2.value = 'oneshot'; opt2.textContent = 'oneshot';
    select.appendChild(opt1);
    select.appendChild(opt2);
    select.value = slot.mode;
    select.addEventListener('change', () => {
      slots[i].mode = select.value;
      renderSlot(i);
      autosave();
    });
    select.addEventListener('click', (e) => e.stopPropagation());
    select.addEventListener('pointerdown', (e) => e.stopPropagation());
    controlsEl.appendChild(select);

    if (slot.mode === 'song') {
      const shuffleLabel = document.createElement('label');
      shuffleLabel.className = 'shuffle-checkbox-label';
      const shuffleCheck = document.createElement('input');
      shuffleCheck.type = 'checkbox';
      shuffleCheck.checked = slot.includeInShuffle;
      shuffleCheck.addEventListener('change', () => {
        slots[i].includeInShuffle = shuffleCheck.checked;
        autosave();
        refreshShuffleList();
      });
      shuffleCheck.addEventListener('click', (e) => e.stopPropagation());
      shuffleCheck.addEventListener('pointerdown', (e) => e.stopPropagation());
      shuffleLabel.appendChild(shuffleCheck);
      shuffleLabel.appendChild(document.createTextNode(' Include in shuffle?'));
      shuffleLabel.addEventListener('click', (e) => e.stopPropagation());
      shuffleLabel.addEventListener('pointerdown', (e) => e.stopPropagation());
      controlsEl.appendChild(shuffleLabel);

      const tsLabel = document.createElement('label');
      tsLabel.className = 'shuffle-checkbox-label';
      const tsCheck = document.createElement('input');
      tsCheck.type = 'checkbox';
      tsCheck.checked = slot.preserveTimestamp;
      tsCheck.addEventListener('change', () => {
        slots[i].preserveTimestamp = tsCheck.checked;
        if (!tsCheck.checked) savedTimestamps.delete(i);
        autosave();
      });
      tsCheck.addEventListener('click', (e) => e.stopPropagation());
      tsCheck.addEventListener('pointerdown', (e) => e.stopPropagation());
      tsLabel.appendChild(tsCheck);
      tsLabel.appendChild(document.createTextNode(' Preserve timestamp?'));
      tsLabel.addEventListener('click', (e) => e.stopPropagation());
      tsLabel.addEventListener('pointerdown', (e) => e.stopPropagation());
      controlsEl.appendChild(tsLabel);

      const onFinishWrap = document.createElement('label');
      onFinishWrap.className = 'shuffle-checkbox-label';
      onFinishWrap.appendChild(document.createTextNode('On finish: '));
      const onFinishSelect = document.createElement('select');
      onFinishSelect.className = 'slot-onfinish-select';
      for (const val of ['stop', 'shuffle', 'loop']) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        onFinishSelect.appendChild(opt);
      }
      onFinishSelect.value = slot.onFinish || 'stop';
      onFinishSelect.addEventListener('change', () => {
        slots[i].onFinish = onFinishSelect.value;
        autosave();
      });
      onFinishSelect.addEventListener('click', (e) => e.stopPropagation());
      onFinishSelect.addEventListener('pointerdown', (e) => e.stopPropagation());
      onFinishWrap.appendChild(onFinishSelect);
      onFinishWrap.addEventListener('click', (e) => e.stopPropagation());
      onFinishWrap.addEventListener('pointerdown', (e) => e.stopPropagation());
      controlsEl.appendChild(onFinishWrap);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'slot-btn-row';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'slot-ctrl-btn';
    clearBtn.textContent = 'clear';
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearSlot(i); });
    clearBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btnRow.appendChild(clearBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'slot-ctrl-btn';
    stopBtn.textContent = 'stop';
    stopBtn.addEventListener('click', (e) => { e.stopPropagation(); convertToStop(i); });
    stopBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btnRow.appendChild(stopBtn);
    controlsEl.appendChild(btnRow);
  }

  el.appendChild(div);

  if (slot.mode === 'effect' && slot.effect) {
    el.title = EFFECTS[slot.effect]?.label || slot.effect;
  } else {
    el.title = slot.file ? slot.file.path : 'empty';
  }

  refreshShuffleList();
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

        const controls = document.createElement('div');
        controls.className = 'slot-controls';
        el.appendChild(controls);

        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          triggerSlot(i);
        });
        el.addEventListener('pointerup', (e) => {
          if (e.button !== 0) return;
          releaseSlot(i);
        });
        el.addEventListener('pointerleave', () => {
          releaseSlot(i);
        });

        // make slot draggable for slot-to-slot drag
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          if (!slots[i].file && !(slots[i].mode === 'effect' && slots[i].effect)) {
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
            const srcEffect = slots[srcIdx].effect;
            slots[srcIdx].file = slots[i].file;
            slots[srcIdx].mode = slots[i].mode;
            slots[srcIdx].effect = slots[i].effect;
            slots[i].file = srcFile;
            slots[i].mode = srcMode;
            slots[i].effect = srcEffect;
            renderSlot(srcIdx);
            renderSlot(i);
            autosave();
            return;
          }

          // 2) effect drag
          const effectId = e.dataTransfer.getData('text/effect-id');
          if (effectId) {
            slots[i].mode = 'effect';
            slots[i].effect = effectId;
            slots[i].file = null;
            renderSlot(i);
            autosave();
            return;
          }

          // 3) media list drag
          const mediaFilename = e.dataTransfer.getData('text/media-filename');
          if (mediaFilename) {
            const absPath = await window.electronAPI.resolvePath(projectDir, mediaFilename);
            const exists = await window.electronAPI.fileExists(absPath);
            if (slots[i].mode === 'effect' || slots[i].mode === 'stop') {
              slots[i].mode = 'song';
              slots[i].effect = null;
            }
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
          if (slots[i].mode === 'effect' || slots[i].mode === 'stop') {
            slots[i].mode = 'song';
            slots[i].effect = null;
          }
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

// Per-slot saved playback position (seconds into the audio buffer)
const savedTimestamps = new Map(); // slotIndex -> seconds
// Per-slot context time when playback started (for computing elapsed time)
const startContextTimes = new Map(); // slotIndex -> { contextTime, offset }

function stopSlot(i) {
  const source = activeSources.get(i);
  if (source) {
    // Save timestamp if preserveTimestamp is enabled
    if (slots[i].preserveTimestamp && startContextTimes.has(i)) {
      const info = startContextTimes.get(i);
      const elapsed = (audioCtx.currentTime - info.contextTime) * (source.playbackRate?.value || 1);
      const position = info.offset + elapsed;
      const duration = source.buffer ? source.buffer.duration : Infinity;
      if (position < duration) {
        savedTimestamps.set(i, position);
      } else {
        savedTimestamps.delete(i);
      }
    }
    startContextTimes.delete(i);
    source.onended = null;
    try { source.stop(); } catch (e) { /* already stopped */ }
    activeSources.delete(i);
    slotElements[i].classList.remove('playing', 'playing-oneshot');
  }
  if (currentSongSlot === i) {
    sendAnimation(i, 0);
    currentSongSlot = null;
    updatePlayStopButton();
  }
}

function getReadySongSlots(excludeIndex) {
  const result = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (i === excludeIndex) continue;
    const s = slots[i];
    if (s.mode === 'song' && s.file && s.file.buffer && s.includeInShuffle) {
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

  // If directly triggered on the same slot that's playing, restart from beginning
  const isRetrigger = currentSongSlot === i;

  // stop any currently playing song (this saves timestamp if preserveTimestamp is on)
  if (currentSongSlot !== null) {
    stopSlot(currentSongSlot);
  }

  // Determine start offset: resume from saved position unless retriggering the same slot
  let offset = 0;
  if (slot.preserveTimestamp && !isRetrigger && savedTimestamps.has(i)) {
    offset = savedTimestamps.get(i);
  }
  // Clear saved timestamp once we use it (or on fresh start)
  savedTimestamps.delete(i);

  const duration = slot.file.buffer.duration;
  if (offset >= duration) offset = 0;

  const source = audioCtx.createBufferSource();
  source.buffer = slot.file.buffer;
  source.connect(masterInput);
  source.onended = () => {
    startContextTimes.delete(i);
    activeSources.delete(i);
    slotElements[i].classList.remove('playing');
    if (currentSongSlot === i) {
      const finishBehavior = slot.onFinish || 'stop';
      if (finishBehavior === 'loop') {
        currentSongSlot = null;
        playSong(i);
      } else if (finishBehavior === 'shuffle') {
        currentSongSlot = null;
        playNextSong(i);
      } else {
        // 'stop' — just stop
        currentSongSlot = null;
        sendAnimation(i, 0);
      }
      updatePlayStopButton();
    }
  };
  source.start(0, offset);
  startContextTimes.set(i, { contextTime: audioCtx.currentTime, offset });
  activeSources.set(i, source);
  applyPlaybackRate();
  slotElements[i].classList.add('playing');
  currentSongSlot = i;
  sendAnimation(i, ANIM_PULSE);
  updatePlayStopButton();
}

function playOneshot(i) {
  const slot = slots[i];
  if (!slot.file || !slot.file.buffer) return;

  // stop if this specific oneshot is already playing
  stopSlot(i);

  const source = audioCtx.createBufferSource();
  source.buffer = slot.file.buffer;
  source.connect(masterInput);
  source.onended = () => {
    activeSources.delete(i);
    slotElements[i].classList.remove('playing-oneshot');
  };
  source.start();
  activeSources.set(i, source);
  applyPlaybackRate();
  slotElements[i].classList.add('playing-oneshot');
}

function killAllAudio() {
  for (const i of Array.from(activeSources.keys())) {
    stopSlot(i);
  }
  for (const i of Array.from(activeEffects.keys())) {
    deactivateEffect(i);
  }
  currentSongSlot = null;
  updatePlayStopButton();
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
  } else if (slot.mode === 'effect') {
    activateEffect(i);
  }
}

function releaseSlot(i) {
  const slot = slots[i];
  if (slot.mode === 'oneshot') {
    stopSlot(i);
  } else if (slot.mode === 'effect') {
    deactivateEffect(i);
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
    const entry = { mode: slot.mode, file: null, effect: slot.effect || null, includeInShuffle: slot.includeInShuffle || false, preserveTimestamp: slot.preserveTimestamp || false, onFinish: slot.onFinish || 'stop' };
    if (slot.file) {
      const relPath = await window.electronAPI.relativePath(projectDir, slot.file.path);
      entry.file = { path: relPath };
    }
    result.push(entry);
  }
  return result;
}

async function saveState() {
  if (!projectDir) return;
  const slotData = await serializeState();
  const blob = { slots: slotData, presets: presets };
  await window.electronAPI.saveState(projectDir, blob);
}

async function restoreState() {
  if (!projectDir) return;
  const raw = await window.electronAPI.loadState(projectDir);
  if (!raw) return;

  let saved;
  if (Array.isArray(raw)) {
    // migrate old format (bare array)
    saved = raw;
    presets = {};
  } else if (raw.slots) {
    saved = raw.slots;
    presets = raw.presets || {};
  } else {
    return;
  }

  await applySlotData(saved);
  renderPresets();
  sendColors();
}

async function applySlotData(saved) {
  if (!saved || !Array.isArray(saved)) return;
  for (let i = 0; i < Math.min(saved.length, TOTAL_SLOTS); i++) {
    const entry = saved[i];
    if (!entry) continue;
    // deactivate any active effect before overwriting
    if (slots[i].mode === 'effect') deactivateEffect(i);
    if (activeSources.has(i)) stopSlot(i);
    slots[i].mode = entry.mode || 'song';
    slots[i].effect = entry.effect || null;
    slots[i].includeInShuffle = entry.includeInShuffle || false;
    slots[i].preserveTimestamp = entry.preserveTimestamp || false;
    slots[i].onFinish = entry.onFinish || 'stop';
    slots[i].file = null;
    if (entry.file && entry.file.path) {
      const absPath = await window.electronAPI.resolvePath(projectDir, entry.file.path);
      const exists = await window.electronAPI.fileExists(absPath);
      slots[i].file = { path: absPath, onDisk: exists, buffer: null };
    }
    renderSlot(i);
  }
}

function autosave() {
  saveState();
  sendColors();
}

// === PRESETS ===

async function savePreset(name) {
  presets[name] = await serializeState();
  autosave();
  renderPresets();
}

async function loadPreset(name) {
  const data = presets[name];
  if (!data) return;
  await applySlotData(data);
  autosave();
}

function deletePreset(name) {
  delete presets[name];
  autosave();
  renderPresets();
}

function renderPresets() {
  const list = document.getElementById('preset-list');
  if (!list) return;
  list.innerHTML = '';
  for (const name of Object.keys(presets)) {
    const item = document.createElement('div');
    item.className = 'preset-item';

    const label = document.createElement('span');
    label.className = 'preset-name';
    label.textContent = name;
    label.addEventListener('click', () => loadPreset(name));

    const overwriteBtn = document.createElement('button');
    overwriteBtn.textContent = '<<';
    overwriteBtn.title = 'Overwrite with current';
    overwriteBtn.addEventListener('click', () => {
      if (confirm(`Overwrite preset "${name}" with current configuration?`)) savePreset(name);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'x';
    deleteBtn.title = 'Delete preset';
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete preset "${name}"?`)) deletePreset(name);
    });

    item.appendChild(label);
    item.appendChild(overwriteBtn);
    item.appendChild(deleteBtn);
    list.appendChild(item);
  }
}

document.getElementById('btn-add-preset').addEventListener('click', () => {
  const input = document.getElementById('preset-name-input');
  const name = input.value.trim();
  if (!name) return;
  savePreset(name);
  input.value = '';
});

document.getElementById('preset-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-add-preset').click();
  }
});

// === PROJECT DIRECTORY ===

async function pickProjectDir() {
  const dir = await window.electronAPI.openDirectoryDialog();
  if (!dir) return null;
  await window.electronAPI.setProjectDir(dir);
  return dir;
}

function clearAllSlots() {
  killAllAudio();
  // deactivate all active effects
  for (const i of Array.from(activeEffects.keys())) {
    deactivateEffect(i);
  }
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    slots[i].mode = 'song';
    slots[i].file = null;
    slots[i].effect = null;
    renderSlot(i);
  }
  sendColors();
}

async function switchProject(dir) {
  clearAllSlots();
  presets = {};
  renderPresets();
  projectDir = dir;
  updateProjectUI();
  await restoreState();
  refreshMediaList();
  window.electronAPI.watchDir(projectDir);
}

document.getElementById('btn-change-project').addEventListener('click', async () => {
  const dir = await pickProjectDir();
  if (dir) {
    await switchProject(dir);
  }
});

// === CONTROLS ===

const btnPlayStop = document.getElementById('btn-play-stop');

function updatePlayStopButton() {
  const isPlaying = currentSongSlot !== null;
  btnPlayStop.textContent = isPlaying ? 'Stop' : 'Play';
  btnPlayStop.disabled = !isPlaying && getReadySongSlots(-1).length === 0;
}

btnPlayStop.addEventListener('click', () => {
  if (currentSongSlot !== null) {
    killAllAudio();
  } else {
    playNextSong(-1);
  }
  updatePlayStopButton();
});

document.getElementById('btn-reload-all').addEventListener('click', async () => {
  const promises = slots.map((slot, i) => {
    if (!slot.file || !slot.file.onDisk) return;
    return loadSlotAudio(i);
  });
  await Promise.all(promises);
});

// === MIDI ===

const midiStatusDot = document.getElementById('midi-status-dot');
const midiActivityDot = document.getElementById('midi-activity-dot');
const midiDeviceSelect = document.getElementById('midi-device-select');
const midiDeviceName = document.getElementById('midi-device-name');
const midiLog = document.getElementById('midi-log');

let midiActivityTimeout = null;
function pulseMidiActivity() {
  midiActivityDot.classList.add('pulse');
  clearTimeout(midiActivityTimeout);
  midiActivityTimeout = setTimeout(() => midiActivityDot.classList.remove('pulse'), 80);
}

let midiAccess = null;
let activeInput = null;
let activeOutput = null;
const MAX_LOG_LINES = 50;

// MF3D LED color velocities (note-on channel 3, 0x92)
const COLOR_OFF = 0;     // empty (off)
const COLOR_RED = 13;    // stop
const COLOR_YELLOW = 37; // effect
const COLOR_GREEN = 49;  // song
const COLOR_BLUE = 85;   // oneshot

// MF3D LED animation (note-on channel 4, 0x93)
const ANIM_PULSE = 45;

function sendAnimation(slotIndex, velocity) {
  if (!activeOutput) return;
  const note = slotToNote.get(slotIndex);
  if (note === undefined) return;
  activeOutput.send([0x93, note, velocity]);
}

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
    } else if (slot.mode === 'effect' && slot.effect) {
      velocity = COLOR_YELLOW;
    } else if (!slot.file) {
      velocity = COLOR_OFF;
    } else if (slot.mode === 'song') {
      velocity = COLOR_GREEN;
    } else {
      velocity = COLOR_BLUE;
    }
    activeOutput.send([0x92, note, velocity]);
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

const MIDI_AUTO_CONNECT_NAME = 'Midi Fighter 3D';

function updateMidiDot() {
  midiStatusDot.classList.remove('connected-mf3d', 'connected-other');
  if (activeInput) {
    if (activeInput.name && activeInput.name.includes(MIDI_AUTO_CONNECT_NAME)) {
      midiStatusDot.classList.add('connected-mf3d');
    } else {
      midiStatusDot.classList.add('connected-other');
    }
  }
}

function disconnectMidi() {
  if (activeInput) {
    activeInput.onmidimessage = null;
    activeInput = null;
  }
  activeOutput = null;
  updateMidiDot();
  midiDeviceName.textContent = '';
}

function connectToInput(input) {
  disconnectMidi();
  activeInput = input;
  updateMidiDot();
  midiDeviceName.textContent = input.name;
  midiLogAppend('connected: ' + input.name);

  input.onmidimessage = (msg) => {
    pulseMidiActivity();
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
const audioDeviceSummary = document.getElementById('audio-device-summary');

function updateAudioSummary() {
  const selected = audioDeviceSelect.options[audioDeviceSelect.selectedIndex];
  const label = selected ? selected.textContent : 'default';
  audioDeviceSummary.textContent = '(' + label + ')';
}

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
  updateAudioSummary();
}

audioDeviceSelect.addEventListener('change', async () => {
  const deviceId = audioDeviceSelect.value;
  try {
    await audioCtx.setSinkId(deviceId || '');
  } catch (err) {
    console.error('Failed to set audio output:', err);
  }
  updateAudioSummary();
});

// === INIT ===

async function init() {
  // register audio worklets
  const worklets = [
    'highpass-processor.js',
    'lowpass-processor.js',
    'reverb-processor.js',
    'distortion-processor.js',
    'delay-processor.js',
    'bitcrusher-processor.js',
    'stutter-processor.js',
    'filtersweep-processor.js',
    'tapestop-processor.js',
    'flanger-processor.js',
    'ringmod-processor.js',
    'reverse-processor.js',
  ];
  for (const file of worklets) {
    try {
      await audioCtx.audioWorklet.addModule(file);
    } catch (err) {
      console.error(`Failed to load worklet ${file}:`, err);
    }
  }

  buildUI();
  applyViewMode();
  buildNoteMap();
  buildEffectsList();

  // listen for directory changes from file watcher
  window.electronAPI.onDirChanged(() => refreshMediaList());

  // load or pick project directory
  projectDir = await window.electronAPI.getProjectDir();
  if (!projectDir) {
    projectDir = await pickProjectDir();
  }
  updateProjectUI();

  if (projectDir) {
    await restoreState();
    refreshMediaList();
    window.electronAPI.watchDir(projectDir);
    // auto-load all slots that have files on disk
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (slots[i].file && slots[i].file.onDisk && !slots[i].file.buffer) {
        loadSlotAudio(i);
      }
    }
  }

  initMidi();
  populateAudioDevices();
  navigator.mediaDevices.addEventListener('devicechange', populateAudioDevices);
}

init();
