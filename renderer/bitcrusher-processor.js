class BitcrusherProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._phase = 0;
    this._lastSample = 0;
  }

  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 4, minValue: 1, maxValue: 16 },
      { name: 'frequencyReduction', defaultValue: 0.1, minValue: 0.01, maxValue: 1 },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const bitDepth = parameters.bitDepth[0];
    const freqReduction = parameters.frequencyReduction[0];
    const step = Math.pow(0.5, bitDepth);

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let i = 0; i < inputChannel.length; i++) {
        this._phase += freqReduction;
        if (this._phase >= 1.0) {
          this._phase -= 1.0;
          this._lastSample = step * Math.floor(inputChannel[i] / step + 0.5);
        }
        outputChannel[i] = this._lastSample;
      }
    }
    return true;
  }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
