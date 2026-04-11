class LowPassProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._out = [];
  }

  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 800, minValue: 20, maxValue: 20000 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const freq = parameters.frequency[0];
    const rc = 1.0 / (2.0 * Math.PI * freq);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);

    for (let ch = 0; ch < input.length; ch++) {
      if (this._out[ch] === undefined) this._out[ch] = 0;
      const inp = input[ch];
      const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        this._out[ch] += alpha * (inp[i] - this._out[ch]);
        out[i] = this._out[ch];
      }
    }
    return true;
  }
}

registerProcessor('lowpass-processor', LowPassProcessor);
