import { createPitchTracker } from './tone-core.js';

class PitchTrackerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.tracker = createPitchTracker({ sampleRate, ...(options.processorOptions || {}) });
    this.port.onmessage = (e) => this.tracker.configure(e.data);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      const frames = this.tracker.push(channel);
      if (frames.length) this.port.postMessage(frames);
    }
    return true;
  }
}

registerProcessor('pitch-tracker', PitchTrackerProcessor);
