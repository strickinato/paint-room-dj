class DistortionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 6, minValue: 1, maxValue: 50 },
      { name: 'mix', defaultValue: 0.7, minValue: 0, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const drive = parameters.drive[0];
    const mix = parameters.mix[0];
    const dry = 1.0 - mix;
    // Compensate for volume boost: tanh(drive*x) is louder than x,
    // so scale output down by roughly 1/drive (clamped)
    const compensation = 1.0 / Math.sqrt(drive);

    for (let ch = 0; ch < input.length; ch++) {
      const inp = input[ch];
      const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        const distorted = Math.tanh(inp[i] * drive) * compensation;
        out[i] = inp[i] * dry + distorted * mix;
      }
    }
    return true;
  }
}

registerProcessor('distortion-processor', DistortionProcessor);
