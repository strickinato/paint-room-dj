class LowPassProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._channels = [];
  }

  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 400, minValue: 20, maxValue: 20000 },
      { name: 'Q', defaultValue: 1.5, minValue: 0.5, maxValue: 10 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const freq = parameters.frequency[0];
    const Q = parameters.Q[0];

    // Biquad lowpass coefficients
    const w0 = 2 * Math.PI * freq / sampleRate;
    const sinW0 = Math.sin(w0);
    const cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * Q);
    const a0 = 1 + alpha;
    const b0 = ((1 - cosW0) / 2) / a0;
    const b1 = (1 - cosW0) / a0;
    const b2 = ((1 - cosW0) / 2) / a0;
    const a1 = (-2 * cosW0) / a0;
    const a2 = (1 - alpha) / a0;

    for (let ch = 0; ch < input.length; ch++) {
      if (!this._channels[ch]) {
        this._channels[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      }
      const s = this._channels[ch];
      const inp = input[ch];
      const out = output[ch];

      for (let i = 0; i < inp.length; i++) {
        const x = inp[i];
        const y = b0 * x + b1 * s.x1 + b2 * s.x2 - a1 * s.y1 - a2 * s.y2;
        s.x2 = s.x1;
        s.x1 = x;
        s.y2 = s.y1;
        s.y1 = y;
        out[i] = y;
      }
    }
    return true;
  }
}

registerProcessor('lowpass-processor', LowPassProcessor);
