// === FILE ACCESS ===

const btnOpenFile = document.getElementById('btn-open-file');
const fileOutput = document.getElementById('file-output');

btnOpenFile.addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog({
    filters: [{ name: 'All Files', extensions: ['*'] }]
  });
  if (!filePath) return;

  const buffer = await window.electronAPI.readFile(filePath);
  const text = new TextDecoder().decode(buffer.slice(0, 500));
  fileOutput.textContent = `Path: ${filePath}\n\n${text}`;
});

// === MIDI ===

const btnMidiConnect = document.getElementById('btn-midi-connect');
const midiOutput = document.getElementById('midi-output');

btnMidiConnect.addEventListener('click', async () => {
  try {
    const midiAccess = await navigator.requestMIDIAccess({ sysex: false });

    const inputs = Array.from(midiAccess.inputs.values());
    const outputs = Array.from(midiAccess.outputs.values());

    let info = `Inputs (${inputs.length}):\n`;
    inputs.forEach(input => {
      info += `  - ${input.name} (${input.manufacturer})\n`;
      input.onmidimessage = (msg) => {
        const hex = Array.from(msg.data).map(b => b.toString(16).padStart(2, '0')).join(' ');
        midiOutput.textContent = info + `\nLast message: [${hex}]`;
      };
    });

    info += `Outputs (${outputs.length}):\n`;
    outputs.forEach(output => {
      info += `  - ${output.name} (${output.manufacturer})\n`;
    });

    midiOutput.textContent = info || 'No MIDI devices found.';

    midiAccess.onstatechange = (event) => {
      midiOutput.textContent += `\nDevice ${event.port.state}: ${event.port.name}`;
    };
  } catch (err) {
    midiOutput.textContent = `MIDI Error: ${err.message}`;
  }
});

// === AUDIO PLAYBACK ===

const btnLoadAudio = document.getElementById('btn-load-audio');
const btnPlayAudio = document.getElementById('btn-play-audio');
const btnStopAudio = document.getElementById('btn-stop-audio');
const audioStatus = document.getElementById('audio-status');

const audioCtx = new AudioContext();
let currentAudioBuffer = null;
let currentSource = null;

btnLoadAudio.addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog({
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac'] }]
  });
  if (!filePath) return;

  audioStatus.textContent = 'Loading...';
  const arrayBuffer = await window.electronAPI.readFile(filePath);
  try {
    currentAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioStatus.textContent = `Loaded (${currentAudioBuffer.duration.toFixed(1)}s, ${currentAudioBuffer.sampleRate}Hz)`;
    btnPlayAudio.disabled = false;
  } catch (err) {
    audioStatus.textContent = `Decode error: ${err.message}`;
  }
});

btnPlayAudio.addEventListener('click', () => {
  if (!currentAudioBuffer) return;
  if (currentSource) {
    try { currentSource.stop(); } catch (e) { /* already stopped */ }
  }
  currentSource = audioCtx.createBufferSource();
  currentSource.buffer = currentAudioBuffer;
  currentSource.connect(audioCtx.destination);
  currentSource.onended = () => {
    btnStopAudio.disabled = true;
  };
  currentSource.start();
  btnStopAudio.disabled = false;
});

btnStopAudio.addEventListener('click', () => {
  if (currentSource) {
    currentSource.stop();
    currentSource = null;
    btnStopAudio.disabled = true;
  }
});
