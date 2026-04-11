class ReverbProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._channels = [];
  }

  _initChannel() {
    const sr = sampleRate;
    return {
      combs: [
        this._makeComb(Math.round(sr * 0.0557), 0.90),
        this._makeComb(Math.round(sr * 0.0693), 0.88),
        this._makeComb(Math.round(sr * 0.0812), 0.86),
        this._makeComb(Math.round(sr * 0.0907), 0.84),
      ],
      allpasses: [
        this._makeAllpass(Math.round(sr * 0.012)),
        this._makeAllpass(Math.round(sr * 0.004)),
      ],
    };
  }

  _makeComb(size, feedback) {
    return { buf: new Float32Array(size), idx: 0, feedback };
  }

  _makeAllpass(size) {
    return { buf: new Float32Array(size), idx: 0 };
  }

  static get parameterDescriptors() {
    return [
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const mix = parameters.mix[0];
    const dry = 1.0 - mix;

    for (let ch = 0; ch < output.length; ch++) {
      if (!this._channels[ch]) this._channels[ch] = this._initChannel();
      const state = this._channels[ch];
      const inp = input[ch] || input[0];
      const out = output[ch];

      for (let i = 0; i < out.length; i++) {
        const sample = inp[i];
        let wet = 0;

        for (const comb of state.combs) {
          const delayed = comb.buf[comb.idx];
          comb.buf[comb.idx] = sample + delayed * comb.feedback;
          comb.idx = (comb.idx + 1) % comb.buf.length;
          wet += delayed;
        }
        wet *= 0.25;

        for (const ap of state.allpasses) {
          const delayed = ap.buf[ap.idx];
          ap.buf[ap.idx] = wet + delayed * 0.5;
          ap.idx = (ap.idx + 1) % ap.buf.length;
          wet = delayed - wet * 0.5;
        }

        out[i] = sample * dry + wet * mix;
      }
    }
    return true;
  }
}

registerProcessor('reverb-processor', ReverbProcessor);
