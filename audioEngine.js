// Audio engine module:
// - receives extracted waveform samples
// - converts them into a Web Audio PeriodicWave
// - controls synth transport and frequency UI
export function createSynthAudioEngine({
  playButton,
  freqInput,
  freqValueEl,
  statusEl,
}) {
  let audioContext = null;
  let masterGainNode = null;
  let synthOscillator = null;
  let currentPeriodicWave = null;
  let latestAudioWaveform = null;

  // Update optional status text in the UI.
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // Read current synth frequency from the slider.
  function getSynthFrequency() {
    if (!freqInput) return 220;
    return Number(freqInput.value) || 220;
  }

  // Keep the frequency readout text in sync with slider position.
  function updateSynthFreqDisplay() {
    if (freqValueEl) freqValueEl.textContent = `${Math.round(getSynthFrequency())} Hz`;
  }

  // Lazy-create AudioContext and output gain stage on first use.
  function ensureAudioEngine() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (!masterGainNode) {
      masterGainNode = audioContext.createGain();
      masterGainNode.gain.value = 0;
      masterGainNode.connect(audioContext.destination);
    }
  }

  // Convert one-cycle waveform samples into Fourier coefficients for Web Audio.
  function buildPeriodicWaveFromSamples(samples) {
    if (!audioContext || !samples || samples.length < 4) return null;

    const sampleCount = samples.length;
    const harmonicCount = Math.min(128, Math.floor(sampleCount / 2));
    if (harmonicCount < 1) return null;

    const real = new Float32Array(harmonicCount + 1);
    const imag = new Float32Array(harmonicCount + 1);
    const norm = 2 / sampleCount;

    for (let harmonic = 1; harmonic <= harmonicCount; harmonic++) {
      let cosineSum = 0;
      let sineSum = 0;
      for (let i = 0; i < sampleCount; i++) {
        const phase = (2 * Math.PI * harmonic * i) / sampleCount;
        const sample = samples[i];
        cosineSum += sample * Math.cos(phase);
        sineSum += sample * Math.sin(phase);
      }
      real[harmonic] = norm * cosineSum;
      imag[harmonic] = norm * sineSum;
    }

    return audioContext.createPeriodicWave(real, imag);
  }

  // Sanitize incoming waveform and normalize to safe playback amplitude.
  function prepareWaveformForAudio(sourceWaveform) {
    if (!sourceWaveform || sourceWaveform.length === 0) return null;

    const prepared = new Float32Array(sourceWaveform.length);
    let peak = 0;
    for (let i = 0; i < sourceWaveform.length; i++) {
      const value = Number.isFinite(sourceWaveform[i]) ? sourceWaveform[i] : 0;
      prepared[i] = value;
      const absValue = Math.abs(value);
      if (absValue > peak) peak = absValue;
    }

    if (peak < 1e-6) return null;

    if (peak > 1) {
      const invPeak = 1 / peak;
      for (let i = 0; i < prepared.length; i++) {
        prepared[i] *= invPeak;
      }
    }

    return prepared;
  }

  // Receive latest extracted waveform and refresh active oscillator shape if needed.
  function updateWaveform(waveform) {
    latestAudioWaveform = prepareWaveformForAudio(waveform);
    if (!latestAudioWaveform) {
      currentPeriodicWave = null;
      if (!synthOscillator) setStatus('Audio: no usable waveform');
      return;
    }

    if (audioContext) {
      currentPeriodicWave = buildPeriodicWaveFromSamples(latestAudioWaveform);
      if (synthOscillator && currentPeriodicWave) {
        synthOscillator.setPeriodicWave(currentPeriodicWave);
      }
    }

    if (!synthOscillator) setStatus('Audio: waveform ready');
  }

  // Start synth playback with a short fade-in to avoid clicks.
  async function startSynth() {
    if (synthOscillator) return;
    if (!latestAudioWaveform) {
      setStatus('Audio: capture a waveform first');
      return;
    }

    ensureAudioEngine();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (!currentPeriodicWave) {
      currentPeriodicWave = buildPeriodicWaveFromSamples(latestAudioWaveform);
    }

    synthOscillator = audioContext.createOscillator();
    synthOscillator.frequency.value = getSynthFrequency();
    if (currentPeriodicWave) {
      synthOscillator.setPeriodicWave(currentPeriodicWave);
    }
    synthOscillator.connect(masterGainNode);

    const now = audioContext.currentTime;
    masterGainNode.gain.cancelScheduledValues(now);
    masterGainNode.gain.setValueAtTime(masterGainNode.gain.value, now);
    masterGainNode.gain.linearRampToValueAtTime(0.08, now + 0.03);

    synthOscillator.start();
    synthOscillator.onended = () => {
      if (synthOscillator) return;
      setStatus('Audio: idle');
    };

    if (playButton) playButton.textContent = 'Stop';
    setStatus('Audio: playing');
  }

  // Stop synth playback with a short fade-out to avoid clicks.
  function stopSynth() {
    if (!audioContext || !synthOscillator) return;

    const osc = synthOscillator;
    synthOscillator = null;

    const now = audioContext.currentTime;
    masterGainNode.gain.cancelScheduledValues(now);
    masterGainNode.gain.setValueAtTime(masterGainNode.gain.value, now);
    masterGainNode.gain.linearRampToValueAtTime(0, now + 0.03);

    osc.stop(now + 0.04);
    osc.disconnect();
    if (playButton) playButton.textContent = 'Play';
    setStatus('Audio: idle');
  }

  // Toggle between playing and stopped synth states.
  async function toggleSynth() {
    if (synthOscillator) {
      stopSynth();
      return;
    }
    await startSynth();
  }

  // Bind UI events once during module creation.
  if (playButton) {
    playButton.addEventListener('click', () => {
      toggleSynth().catch((err) => {
        console.error('Audio start error:', err);
        setStatus('Audio: failed to start');
      });
    });
  }

  if (freqInput) {
    freqInput.addEventListener('input', () => {
      updateSynthFreqDisplay();
      if (synthOscillator && audioContext) {
        synthOscillator.frequency.setTargetAtTime(getSynthFrequency(), audioContext.currentTime, 0.01);
      }
    });
  }

  updateSynthFreqDisplay();

  return {
    updateWaveform,
    setStatus,
  };
}
