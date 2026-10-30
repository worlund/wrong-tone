# Tone Lab

Prototype of Mandarin tone detection for *Wrong Tone*. Mic → pitch → tone, all in the browser.

## Run

```sh
npm start          # serves on http://localhost:5173 (the mic needs localhost or https)
npm test           # synthetic voices through the full pipeline
```

Use Chrome or Edge. Wear headphones if you use "Hear it", or the mic may pick up the speaker.

## How it works

| Stage | File | What it does |
|---|---|---|
| Pitch tracking | `tone-core.js` `createPitchTracker` | Low-pass + decimate to ~11 kHz, YIN every 5 ms. Runs inside an AudioWorklet (`pitch-worklet.js`). |
| Segmentation | `createSegmenter` | Starts on 30 ms of voiced sound, ends on 200 ms of silence. Unvoiced frames alone don't end it, because third tones go creaky. |
| Contour | `extractContour` | Keeps the loud nucleus (within 15 dB of the peak) so consonant onsets and fading tails don't bend the tone, then octave-jump repair, smoothing, resampling to 20 points in semitones. |
| Speaker range | `createSpeakerModel` | Learns your pitch range from practice attempts (or a 6 s calibration) so height can be judged on the 1–5 Chao scale. |
| Classification | `classifyTone` | Fits each tone template with a tolerant gain (learners compress pitch movement), adds a height term and a creak bonus for T3, then softmax. |
| Judging | `judge` | Lenient by default: pass if the target is the top guess or ≥ 35%. |

## Tuning loop

1. Practice and press **Detector was wrong** whenever a fail was unfair.
2. **Export attempts** and keep the JSON. Each attempt stores the raw contour, the probabilities and the settings.
3. Tune the `TEMPLATES` and `SIGMA_*` constants against that data, then add the hard cases to the tests.

The synthetic test proves the code works, not that it is accurate on real voices. Real accuracy comes from step 1–3, ideally with native speakers and learners of different voice types.
