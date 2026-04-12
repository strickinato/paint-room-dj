class FilterSweepProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._channels = [];
    this._active = false;
    this._deactivating = false;
    this._fadeIn = 0; // samples into fade-in
    this._fadeOut = 0; // samples remaining in fade-out
    this._phase = 0; // 0 to 1 and back, ping-pong sweep
    this._sweepDir = 1; // 1 = forward, -1 = reverse
    // Direction: 'up' or 'down', passed via processorOptions
    this._direction = (options.processorOptions && options.processorOptions.direction) || 'up';
    this._fadeSamples = Math.round(sampleRate * 0.03); // 30ms fade

    this.port.onmessage = (e) => {
      if (e.data.type === 'activate') {
        this._active = true;
        this._deactivating = false;
        this._phase = 0;
        this._sweepDir = 1;
        this._fadeIn = 0;
        this._fadeOut = 0;
      } else if (e.data.type === 'deactivate') {
        this._deactivating = true;
        this._fadeOut = this._fadeSamples;
      }
    };
  }

  static get parameterDescriptors() {
    return [
      { name: 'speed', defaultValue: 0.5, minValue: 0.05, maxValue: 5.0 },
      { name: 'resonance', defaultValue: 3, minValue: 0.5, maxValue: 30 },
      { name: 'minFreq', defaultValue: 200, minValue: 20, maxValue: 2000 },
      { name: 'maxFreq', defaultValue: 8000, minValue: 2000, maxValue: 20000 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    if (!this._active && !this._deactivating) {
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
    const phaseInc = speed / sampleRate;
    const fadeSamples = this._fadeSamples;

    // Sweep up uses highpass (cuts lows as freq rises)
    // Sweep down uses lowpass (cuts highs as freq drops)
    const useHighpass = this._direction === 'up';

    for (let ch = 0; ch < input.length; ch++) {
      if (!this._channels[ch]) {
        this._channels[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 };
      }
      const s = this._channels[ch];
      const inp = input[ch];
      const out = output[ch];

      let phase = this._phase;
      let sweepDir = this._sweepDir;
      let fadeOut = this._fadeOut;
      let fadeIn = this._fadeIn;

      for (let i = 0; i < blockSize; i++) {
        const t = phase;

        // Exponential frequency sweep
        let freq;
        if (this._direction === 'up') {
          freq = minFreq * Math.pow(maxFreq / minFreq, t);
        } else {
          freq = maxFreq * Math.pow(minFreq / maxFreq, t);
        }

        // Biquad coefficients
        const w0 = 2 * Math.PI * freq / sampleRate;
        const sinW0 = Math.sin(w0);
        const cosW0 = Math.cos(w0);
        const alpha = sinW0 / (2 * Q);
        const a0 = 1 + alpha;

        let nb0, nb1, nb2;
        if (useHighpass) {
          // Highpass coefficients
          nb0 = ((1 + cosW0) / 2) / a0;
          nb1 = (-(1 + cosW0)) / a0;
          nb2 = ((1 + cosW0) / 2) / a0;
        } else {
          // Lowpass coefficients
          nb0 = ((1 - cosW0) / 2) / a0;
          nb1 = (1 - cosW0) / a0;
          nb2 = ((1 - cosW0) / 2) / a0;
        }
        const na1 = (-2 * cosW0) / a0;
        const na2 = (1 - alpha) / a0;

        // Apply filter
        const x = inp[i];
        const y = nb0 * x + nb1 * s.x1 + nb2 * s.x2 - na1 * s.y1 - na2 * s.y2;
        s.x2 = s.x1;
        s.x1 = x;
        s.y2 = s.y1;
        s.y1 = y;

        // Crossfade between dry and filtered
        let blend = 1.0; // 1.0 = fully filtered

        // Fade in on activation
        if (fadeIn < fadeSamples) {
          blend = fadeIn / fadeSamples;
          if (ch === 0) fadeIn++;
        }

        // Fade out on deactivation (overrides fade-in)
        if (this._deactivating && fadeOut > 0) {
          blend = fadeOut / fadeSamples;
          if (ch === 0) fadeOut--;
        }

        out[i] = inp[i] * (1 - blend) + y * blend;

        if (ch === 0) {
          phase += phaseInc * sweepDir;
          if (phase >= 1.0) {
            phase = 1.0;
            sweepDir = -1;
          } else if (phase <= 0.0) {
            phase = 0.0;
            sweepDir = 1;
          }
        }
      }

      if (ch === 0) {
        this._fadeOut = fadeOut;
        this._fadeIn = fadeIn;
      }
    }

    this._phase = Math.max(0, Math.min(1, this._phase + phaseInc * this._sweepDir * blockSize));
    if (this._phase >= 1.0) {
      this._phase = 1.0;
      this._sweepDir = -1;
    } else if (this._phase <= 0.0) {
      this._phase = 0.0;
      this._sweepDir = 1;
    }

    if (this._deactivating && this._fadeOut <= 0) {
      this._active = false;
      this._deactivating = false;
      this._channels = [];
    }

    return true;
  }
}

registerProcessor('filtersweep-processor', FilterSweepProcessor);
