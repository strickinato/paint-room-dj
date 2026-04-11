class HighPassProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Simple one-pole high-pass filter state per channel
    this._prev = [];
    this._out = [];
  }

  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 1000, minValue: 20, maxValue: 20000 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const freq = parameters.frequency[0];
    const rc = 1.0 / (2.0 * Math.PI * freq);
    const dt = 1.0 / sampleRate;
    const alpha = rc / (rc + dt);

    for (let ch = 0; ch < input.length; ch++) {
      if (this._prev[ch] === undefined) {
        this._prev[ch] = 0;
        this._out[ch] = 0;
      }
      const inp = input[ch];
      const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        this._out[ch] = alpha * (this._out[ch] + inp[i] - this._prev[ch]);
        this._prev[ch] = inp[i];
        out[i] = this._out[ch];
      }
    }
    return true;
  }
}

registerProcessor('highpass-processor', HighPassProcessor);
