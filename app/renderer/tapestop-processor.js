class TapeStopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Circular buffer for ~4 seconds of audio
    const maxLen = Math.round(sampleRate * 4);
    this._maxLen = maxLen;
    this._buf = [];
    this._writeIdx = 0;
    this._active = false;
    this._readPos = 0; // fractional read position
    this._speed = 1.0; // current playback speed, slows toward 0

    this.port.onmessage = (e) => {
      if (e.data.type === 'activate') {
        this._active = true;
        this._speed = 1.0;
        // Start reading from where we just wrote
        this._readPos = this._writeIdx;
      } else if (e.data.type === 'deactivate') {
        this._active = false;
        this._speed = 1.0;
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

    if (!this._active) {
      // Bypass: pass through and keep capturing
      let wr = this._writeIdx;
      for (let i = 0; i < input[0].length; i++) {
        for (let ch = 0; ch < input.length; ch++) {
          this._buf[ch][wr] = input[ch][i];
          output[ch][i] = input[ch][i];
        }
        wr = (wr + 1) % max;
      }
      this._writeIdx = wr;
    } else {
      // Tape stop: read from buffer at decelerating speed
      // Deceleration: speed drops from 1.0 toward 0 over ~2 seconds
      const decelRate = 0.5 / sampleRate; // reaches ~0 in ~2s

      let readPos = this._readPos;
      let speed = this._speed;

      for (let i = 0; i < output[0].length; i++) {
        // Integer and fractional parts for linear interpolation
        const idx0 = Math.floor(readPos) % max;
        const idx1 = (idx0 + 1) % max;
        const frac = readPos - Math.floor(readPos);

        for (let ch = 0; ch < output.length; ch++) {
          const buf = this._buf[ch];
          output[ch][i] = buf[idx0 < 0 ? idx0 + max : idx0] * (1 - frac)
                        + buf[idx1] * frac;
        }

        readPos += speed;
        if (readPos >= max) readPos -= max;

        speed -= decelRate;
        if (speed < 0) speed = 0;
      }

      this._readPos = readPos;
      this._speed = speed;
    }
    return true;
  }
}

registerProcessor('tapestop-processor', TapeStopProcessor);
