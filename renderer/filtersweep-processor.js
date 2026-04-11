class FilterSweepProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._channels = [];
    this._active = false;
    this._phase = 0; // 0 to 1, represents sweep progress
    // Direction: 'up' or 'down', passed via processorOptions
    this._direction = (options.processorOptions && options.processorOptions.direction) || 'up';

    this.port.onmessage = (e) => {
      if (e.data.type === 'activate') {
        this._active = true;
        this._phase = 0;
      } else if (e.data.type === 'deactivate') {
        this._active = false;
        this._phase = 0;
      }
    };
  }

  static get parameterDescriptors() {
    return [
      { name: 'speed', defaultValue: 0.5, minValue: 0.05, maxValue: 5.0 },
      { name: 'resonance', defaultValue: 12, minValue: 1, maxValue: 30 },
      { name: 'minFreq', defaultValue: 80, minValue: 20, maxValue: 2000 },
      { name: 'maxFreq', defaultValue: 12000, minValue: 2000, maxValue: 20000 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    if (!this._active) {
      // Bypass
      for (let ch = 0; ch < input.length; ch++) {
        output[ch].set(input[ch]);
      }
      return true;
    }

    const speed = parameters.speed[0];
    const Q = parameters.resonance[0];
    const minFreq = parameters.minFreq[0];
    const maxFreq = parameters.maxFreq[0];
    const blockSize = input[0].length;

    // Advance phase: sweep completes in (1/speed) seconds
    const phaseInc = speed / sampleRate;

    for (let ch = 0; ch < input.length; ch++) {
      if (!this._channels[ch]) {
        this._channels[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      }
      const s = this._channels[ch];
      const inp = input[ch];
      const out = output[ch];

      let phase = this._phase;
      for (let i = 0; i < blockSize; i++) {
        // Clamp phase to [0, 1]
        const t = Math.min(phase, 1.0);

        // Exponential frequency sweep
        let freq;
        if (this._direction === 'up') {
          freq = minFreq * Math.pow(maxFreq / minFreq, t);
        } else {
          freq = maxFreq * Math.pow(minFreq / maxFreq, t);
        }

        // Biquad bandpass coefficients
        const w0 = 2 * Math.PI * freq / sampleRate;
        const sinW0 = Math.sin(w0);
        const cosW0 = Math.cos(w0);
        const alpha = sinW0 / (2 * Q);

        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * cosW0;
        const a2 = 1 - alpha;

        // Normalize
        const nb0 = b0 / a0;
        const nb1 = b1 / a0;
        const nb2 = b2 / a0;
        const na1 = a1 / a0;
        const na2 = a2 / a0;

        // Apply filter
        const x = inp[i];
        const y = nb0 * x + nb1 * s.x1 + nb2 * s.x2 - na1 * s.y1 - na2 * s.y2;
        s.x2 = s.x1;
        s.x1 = x;
        s.y2 = s.y1;
        s.y1 = y;

        // Mix: as sweep progresses, increase wet amount for dramatic effect
        const wetAmount = 0.5 + t * 0.5;
        out[i] = inp[i] * (1 - wetAmount) + y * Q * 0.15 * wetAmount;

        if (ch === 0) phase += phaseInc;
      }
    }
    // Only advance phase once (channel 0 already did it)
    this._phase += phaseInc * blockSize;
    if (this._phase > 1.0) this._phase = 1.0;

    return true;
  }
}

registerProcessor('filtersweep-processor', FilterSweepProcessor);
