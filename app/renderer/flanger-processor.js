class FlangerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Delay buffer: max ~20ms
    const maxDelay = Math.round(sampleRate * 0.02);
    this._maxDelay = maxDelay;
    this._buf = [];
    this._writeIdx = [];
    this._lfoPhase = 0;
  }

  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.3, minValue: 0.05, maxValue: 5.0 },
      { name: 'depth', defaultValue: 0.7, minValue: 0, maxValue: 1.0 },
      { name: 'feedback', defaultValue: 0.5, minValue: 0, maxValue: 0.9 },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const rate = parameters.rate[0];
    const depth = parameters.depth[0];
    const feedback = parameters.feedback[0];
    const mix = parameters.mix[0];
    const max = this._maxDelay;
    const lfoInc = rate / sampleRate;

    // Delay range: 1ms to 10ms
    const minDelay = sampleRate * 0.001;
    const maxDelayTime = sampleRate * 0.01;

    for (let ch = 0; ch < input.length; ch++) {
      if (!this._buf[ch]) {
        this._buf[ch] = new Float32Array(max);
        this._writeIdx[ch] = 0;
      }
      const buf = this._buf[ch];
      let wr = this._writeIdx[ch];
      const inp = input[ch];
      const out = output[ch];

      let lfoPhase = this._lfoPhase;

      for (let i = 0; i < inp.length; i++) {
        // LFO: triangle wave for smooth sweep
        const lfoVal = 1 - 4 * Math.abs((lfoPhase % 1) - 0.5); // -1 to 1
        const delaySamples = minDelay + (maxDelayTime - minDelay) * depth * (lfoVal * 0.5 + 0.5);

        // Read with linear interpolation
        let readPos = wr - delaySamples;
        if (readPos < 0) readPos += max;
        const idx0 = Math.floor(readPos);
        const idx1 = (idx0 + 1) % max;
        const frac = readPos - idx0;
        const delayed = buf[idx0] * (1 - frac) + buf[idx1] * frac;

        // Write input + feedback into buffer
        buf[wr] = inp[i] + delayed * feedback;
        wr = (wr + 1) % max;

        out[i] = inp[i] * (1 - mix) + delayed * mix;

        if (ch === 0) lfoPhase += lfoInc;
      }
      this._writeIdx[ch] = wr;
    }

    this._lfoPhase += lfoInc * input[0].length;
    return true;
  }
}

registerProcessor('flanger-processor', FlangerProcessor);
