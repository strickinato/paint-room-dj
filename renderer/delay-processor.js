class DelayProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Max 2 seconds of delay at sample rate
    this._maxSamples = Math.round(sampleRate * 2);
    this._buf = [];
    this._writeIdx = [];
  }

  static get parameterDescriptors() {
    return [
      { name: 'time', defaultValue: 0.3, minValue: 0.01, maxValue: 2.0 },
      { name: 'feedback', defaultValue: 0.35, minValue: 0, maxValue: 0.9 },
      { name: 'mix', defaultValue: 0.4, minValue: 0, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const max = this._maxSamples;
    let delaySamples = Math.round(parameters.time[0] * sampleRate);
    if (delaySamples >= max) delaySamples = max - 1;
    const feedback = parameters.feedback[0];
    const mix = parameters.mix[0];
    const dry = 1.0 - mix;

    for (let ch = 0; ch < input.length; ch++) {
      if (!this._buf[ch]) {
        this._buf[ch] = new Float32Array(max);
        this._writeIdx[ch] = 0;
      }
      const buf = this._buf[ch];
      let wr = this._writeIdx[ch];
      const inp = input[ch];
      const out = output[ch];

      for (let i = 0; i < inp.length; i++) {
        let rd = wr - delaySamples;
        if (rd < 0) rd += max;
        const delayed = buf[rd];
        buf[wr] = inp[i] + delayed * feedback;
        wr = (wr + 1) % max;
        out[i] = inp[i] * dry + delayed * mix;
      }
      this._writeIdx[ch] = wr;
    }
    return true;
  }
}

registerProcessor('delay-processor', DelayProcessor);
