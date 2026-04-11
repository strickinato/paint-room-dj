class StutterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Capture buffer: stores recent audio (~200ms max)
    const maxLen = Math.round(sampleRate * 0.2);
    this._maxLen = maxLen;
    this._buf = [];
    this._writeIdx = 0;
    this._active = false;
    this._playIdx = 0;
    // Length of the stutter slice in samples
    this._sliceLen = Math.round(sampleRate * 0.1);

    this.port.onmessage = (e) => {
      if (e.data.type === 'activate') {
        this._active = true;
        this._playIdx = 0;
        // Snapshot the slice length at activation time
        this._sliceLen = Math.round(sampleRate * e.data.rate);
        if (this._sliceLen < 64) this._sliceLen = 64;
        if (this._sliceLen > this._maxLen) this._sliceLen = this._maxLen;
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

    // Ensure per-channel capture buffers exist
    for (let ch = 0; ch < input.length; ch++) {
      if (!this._buf[ch]) this._buf[ch] = new Float32Array(max);
    }

    if (!this._active) {
      // Bypass mode: pass audio through and keep capturing
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
      // Stutter mode: loop the captured slice
      const len = this._sliceLen;
      // The slice ends at wherever we stopped writing
      const sliceEnd = this._writeIdx;
      let sliceStart = sliceEnd - len;
      if (sliceStart < 0) sliceStart += max;

      let pi = this._playIdx;
      for (let i = 0; i < output[0].length; i++) {
        const readPos = (sliceStart + (pi % len)) % max;
        for (let ch = 0; ch < output.length; ch++) {
          output[ch][i] = this._buf[ch] ? this._buf[ch][readPos] : 0;
        }
        pi++;
      }
      this._playIdx = pi;
    }
    return true;
  }
}

registerProcessor('stutter-processor', StutterProcessor);
