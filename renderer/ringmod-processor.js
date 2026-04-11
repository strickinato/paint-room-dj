class RingModProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._phase = 0;
  }

  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 200, minValue: 20, maxValue: 2000 },
      { name: 'mix', defaultValue: 0.7, minValue: 0, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const freq = parameters.frequency[0];
    const mix = parameters.mix[0];
    const dry = 1.0 - mix;
    const phaseInc = freq / sampleRate;

    let phase = this._phase;

    for (let i = 0; i < input[0].length; i++) {
      const mod = Math.sin(2 * Math.PI * phase);
      for (let ch = 0; ch < input.length; ch++) {
        output[ch][i] = input[ch][i] * dry + input[ch][i] * mod * mix;
      }
      phase += phaseInc;
    }

    this._phase = phase % 1;
    return true;
  }
}

registerProcessor('ringmod-processor', RingModProcessor);
