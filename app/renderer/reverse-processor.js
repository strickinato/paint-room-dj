class ReverseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Circular buffer: ~4 seconds
    const maxLen = Math.round(sampleRate * 4);
    this._maxLen = maxLen;
    this._buf = [];
    this._writeIdx = 0;
    this._active = false;
    this._readPos = 0; // reads backwards from activation point

    this.port.onmessage = (e) => {
      if (e.data.type === 'activate') {
        this._active = true;
        // Start reading backwards from current write position
        this._readPos = this._writeIdx;
      } else if (e.data.type === 'deactivate') {
        this._active = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const max = this._maxLen;

    // Ensure per-channel buffers
    for (let ch = 0; ch < input.length; ch++) {
      if (!this._buf[ch]) this._buf[ch] = new Float32Array(max);
    }

    // Always capture incoming audio
    let wr = this._writeIdx;
    for (let i = 0; i < input[0].length; i++) {
      for (let ch = 0; ch < input.length; ch++) {
        this._buf[ch][wr] = input[ch][i];
      }
      wr = (wr + 1) % max;
    }
    this._writeIdx = wr;

    if (!this._active) {
      // Bypass
      for (let ch = 0; ch < input.length; ch++) {
        output[ch].set(input[ch]);
      }
      return true;
    }

    // Play backwards from the captured buffer
    let readPos = this._readPos;

    for (let i = 0; i < output[0].length; i++) {
      let rp = readPos;
      if (rp < 0) rp += max;
      const idx = Math.floor(rp) % max;

      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = this._buf[ch][idx];
      }

      readPos--;
      if (readPos < 0) readPos += max;
    }

    this._readPos = readPos;
    return true;
  }
}

registerProcessor('reverse-processor', ReverseProcessor);
