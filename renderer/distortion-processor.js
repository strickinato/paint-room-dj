class DistortionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // One-pole high-pass DC blocker state per channel
    this._prevIn = [];
    this._prevOut = [];
  }

  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 12, minValue: 1, maxValue: 50 },
      { name: 'mix', defaultValue: 0.8, minValue: 0, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const drive = parameters.drive[0];
    const mix = parameters.mix[0];
    const dry = 1.0 - mix;

    for (let ch = 0; ch < input.length; ch++) {
      if (this._prevIn[ch] === undefined) {
        this._prevIn[ch] = 0;
        this._prevOut[ch] = 0;
      }
      const inp = input[ch];
      const out = output[ch];

      for (let i = 0; i < inp.length; i++) {
        const x = inp[i] * drive;

        // Asymmetric waveshaping: different curves for positive/negative
        // Creates even harmonics (tube-like character)
        let shaped;
        if (x >= 0) {
          // Hard clip positive with cubic soft-knee
          const t = Math.min(x, 1.5);
          shaped = t - (t * t * t) / 6.75;
        } else {
          // Sharper negative clip via tanh — adds grit
          shaped = -Math.tanh(-x * 1.5) * 0.8;
        }

        // DC blocker (asymmetric clipping introduces DC offset)
        const dcAlpha = 0.995;
        const filtered = shaped - this._prevIn[ch] + dcAlpha * this._prevOut[ch];
        this._prevIn[ch] = shaped;
        this._prevOut[ch] = filtered;

        // RMS-matched output: normalize so clipped signal roughly matches input level
        // The shaper peaks around 0.67 for positive, 0.8 for negative,
        // so scale up slightly to match input amplitude
        out[i] = inp[i] * dry + filtered * 0.5 * mix;
      }
    }
    return true;
  }
}

registerProcessor('distortion-processor', DistortionProcessor);
