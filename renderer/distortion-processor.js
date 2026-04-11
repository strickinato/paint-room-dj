class DistortionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._prevIn = [];
    this._prevOut = [];
  }

  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 40, minValue: 1, maxValue: 100 },
      { name: 'mix', defaultValue: 1.0, minValue: 0, maxValue: 1 },
      { name: 'outputGain', defaultValue: 0.15, minValue: 0.01, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const drive = parameters.drive[0];
    const mix = parameters.mix[0];
    const dry = 1.0 - mix;
    const outputGain = parameters.outputGain[0];

    for (let ch = 0; ch < input.length; ch++) {
      if (this._prevIn[ch] === undefined) {
        this._prevIn[ch] = 0;
        this._prevOut[ch] = 0;
      }
      const inp = input[ch];
      const out = output[ch];

      for (let i = 0; i < inp.length; i++) {
        const x = inp[i] * drive;

        // Asymmetric hard clipping
        let shaped;
        if (x >= 0) {
          shaped = Math.min(x, 1.0);
        } else {
          shaped = Math.max(x, -0.8);
        }

        // DC blocker
        const dcAlpha = 0.995;
        const filtered = shaped - this._prevIn[ch] + dcAlpha * this._prevOut[ch];
        this._prevIn[ch] = shaped;
        this._prevOut[ch] = filtered;

        out[i] = inp[i] * dry + filtered * outputGain * mix;
      }
    }
    return true;
  }
}

registerProcessor('distortion-processor', DistortionProcessor);
