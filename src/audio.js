// All sound is synthesised with Web Audio: a low drone, short effects, and a six-voice "choir"
// whose loudness follows where the wave is, so you can hear the wavefunction move.
//
// Browsers only allow audio after a user gesture, so start() is called from the first click or key.
// A sound failure must never stop the game: every path catches, and warns a few times.

const SCALE = [587.33, 523.25, 440, 392, 349.23, 293.66];   // D minor pentatonic, high to low
const MASTER_LEVEL = 0.8;

export function createAudio() {
  let context = null, master = null, echo = null, noiseBuffer = null;
  let ready = false, muted = false, warnings = 0;
  const voices = [];

  const warn = error => { if (warnings++ < 3) console.warn('psi sound:', error); };

  function start() {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();

      master = context.createGain();
      master.gain.value = MASTER_LEVEL;
      const compressor = context.createDynamicsCompressor();
      master.connect(compressor);
      compressor.connect(context.destination);

      // a feedback echo gives the effects some room
      const delay = context.createDelay(1);
      delay.delayTime.value = 0.31;
      const feedback = context.createGain();
      feedback.gain.value = 0.4;
      const damp = context.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2200;
      echo = context.createGain();
      echo.gain.value = 0.4;
      echo.connect(delay); delay.connect(damp); damp.connect(feedback); feedback.connect(delay); damp.connect(master);

      // drone: detuned low oscillators through a slowly breathing filter
      const droneLevel = context.createGain();
      droneLevel.gain.value = 0;
      droneLevel.gain.setTargetAtTime(0.10, context.currentTime, 2.5);
      const droneFilter = context.createBiquadFilter();
      droneFilter.type = 'lowpass';
      droneFilter.frequency.value = 210;
      droneFilter.Q.value = 1.2;
      for (const [frequency, type, detune] of [[73.42, 'sawtooth', -6], [73.42, 'sawtooth', 7], [110, 'sine', 0], [146.83, 'triangle', 3]]) {
        const osc = context.createOscillator();
        osc.type = type; osc.frequency.value = frequency; osc.detune.value = detune;
        osc.connect(droneFilter);
        osc.start();
      }
      droneFilter.connect(droneLevel);
      droneLevel.connect(master);
      const breath = context.createOscillator();
      breath.frequency.value = 0.07;
      const breathDepth = context.createGain();
      breathDepth.gain.value = 70;
      breath.connect(breathDepth); breathDepth.connect(droneFilter.frequency);
      breath.start();

      // the choir: one voice per horizontal band of the room
      for (const frequency of SCALE) {
        const high = context.createOscillator();
        high.type = 'sine'; high.frequency.value = frequency;
        const low = context.createOscillator();
        low.type = 'triangle'; low.frequency.value = frequency / 2; low.detune.value = 6;
        const gain = context.createGain();
        gain.gain.value = 0;
        const pan = context.createStereoPanner ? context.createStereoPanner() : null;
        high.connect(gain); low.connect(gain);
        const out = pan || gain;
        if (pan) gain.connect(pan);
        out.connect(master); out.connect(echo);
        high.start(); low.start();
        voices.push({ gain, pan });
      }

      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      ready = true;
    } catch (error) {
      warn(error);
      context = null;
      ready = false;
    }
  }

  function envelope(gain, at, attack, decay, peak) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  /** A pitched blip that glides from one frequency to another. */
  function tone(from, to, duration, peak, type = 'sine', delay = 0, withEcho = true) {
    if (!ready || muted) return;
    try {
      const at = context.currentTime + delay;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, at);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + duration);
      envelope(gain, at, 0.008, duration, peak);
      osc.connect(gain);
      gain.connect(master);
      if (withEcho) gain.connect(echo);
      osc.start(at);
      osc.stop(at + duration + 0.1);
    } catch (error) { warn(error); }
  }

  /** A burst of filtered noise whose colour sweeps between two frequencies. */
  function noise(duration, peak, from, to, q = 1, delay = 0) {
    if (!ready || muted) return;
    try {
      const at = context.currentTime + delay;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = noiseBuffer; source.loop = true;
      filter.type = 'bandpass'; filter.Q.value = q;
      filter.frequency.setValueAtTime(from, at);
      filter.frequency.exponentialRampToValueAtTime(to, at + duration);
      envelope(gain, at, 0.01, duration, peak);
      source.connect(filter); filter.connect(gain); gain.connect(master); gain.connect(echo);
      source.start(at);
      source.stop(at + duration + 0.1);
    } catch (error) { warn(error); }
  }

  return {
    start,

    launch(charge) {
      noise(0.5, 0.22, 300, 2400 + 2600 * charge, 2);
      tone(146.83, 293.66 * (1 + charge), 0.45, 0.10, 'triangle');
    },
    /** height is 0 at the top of the room and 1 at the bottom; higher up sounds higher. */
    found(height) {
      const note = SCALE[Math.max(0, Math.min(5, Math.floor(height * 6)))];
      tone(note, note, 0.6, 0.22, 'triangle');
      tone(note * 2, note * 2, 0.9, 0.10, 'sine', 0.03);
      noise(0.08, 0.12, 5000, 2000, 1);
    },
    miss() {
      tone(110, 62, 0.22, 0.28, 'sine', 0, false);
      noise(0.1, 0.10, 900, 300, 1.5);
    },
    dead() {
      tone(330, 41, 0.7, 0.26, 'sawtooth');
      noise(0.5, 0.30, 2600, 120, 0.8);
    },
    decohere() {
      for (let i = 0; i < 4; i++) tone(SCALE[i + 1], SCALE[i + 1] * 0.97, 0.3, 0.07, 'sine', i * 0.05);
    },
    key() {
      tone(880, 880, 0.3, 0.16, 'triangle');
      tone(1318.5, 1318.5, 0.6, 0.14, 'triangle', 0.09);
    },
    win() {
      [293.66, 349.23, 440, 587.33, 880].forEach((note, i) => tone(note, note, 0.7, 0.16, 'triangle', i * 0.085));
      noise(0.9, 0.08, 800, 6000, 1.2);
    },
    click() {
      tone(660, 660, 0.06, 0.05, 'sine', 0, false);
    },

    /** Set the choir from the share of the wave in each of six horizontal bands, and its left-right position. */
    wave(bands, pan, on) {
      if (!ready) return;
      try {
        const now = context.currentTime;
        for (let i = 0; i < voices.length; i++) {
          const level = on && !muted ? Math.min(0.075, Math.sqrt(bands[i]) * 0.11) : 0;
          voices[i].gain.gain.setTargetAtTime(level, now, 0.09);
          if (voices[i].pan) voices[i].pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.15);
        }
      } catch (error) { warn(error); }
    },

    toggleMute() {
      muted = !muted;
      if (ready) master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, context.currentTime, 0.05);
      return muted;
    },
    get muted() { return muted; },
    /** For tests: whether the audio graph is up, and how many failures were swallowed. */
    info() { return { ready, state: context ? context.state : 'none', voices: voices.length, warnings }; },
  };
}
