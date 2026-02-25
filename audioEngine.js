// Audio engine module (scaled back):
// - keeps Web Audio API setup and UI wiring
// - removes oscillator/synthesis logic
// - preserves public API for future custom synthesis implementation
export function createSynthAudioEngine({
  playButton,
  statusEl,
}) {
  let audioContext = null;
  let masterGainNode = null;
  let latestAudioWaveform = null;
  let isActive = false;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

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

  function playConfirmationBeep() {
    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const beepGainNode = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);

    beepGainNode.gain.setValueAtTime(0.0001, now);
    beepGainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    beepGainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    oscillator.connect(beepGainNode);
    beepGainNode.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.17);
    oscillator.onended = () => {
      oscillator.disconnect();
      beepGainNode.disconnect();
    };
  }

  function prepareWaveformForSynthesis() {
  }

  async function startCustomSynthesis() {
  }

  async function stopCustomSynthesis() {
  }

  function updateWaveform(waveform) {
    latestAudioWaveform = waveform || null;
    prepareWaveformForSynthesis(latestAudioWaveform);

    if (!latestAudioWaveform) {
      setStatus('Audio: no waveform loaded');
      return;
    }

    if (!isActive) {
      setStatus('Audio: waveform ready');
    }
  }

  async function startAudio() {
    ensureAudioEngine();

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    playConfirmationBeep();
    await startCustomSynthesis();

    isActive = true;
    if (playButton) playButton.textContent = 'Stop';
    setStatus('Audio: context active (synthesis logic removed)');
  }

  async function stopAudio() {
    if (!audioContext) return;

    if (audioContext.state === 'running') {
      await audioContext.suspend();
    }

    await stopCustomSynthesis();

    isActive = false;
    if (playButton) playButton.textContent = 'Play';
    setStatus('Audio: idle');
  }

  async function toggleAudio() {
    if (isActive) {
      await stopAudio();
      return;
    }

    await startAudio();
  }

  if (playButton) {
    playButton.addEventListener('click', () => {
      toggleAudio().catch((err) => {
        console.error('Audio toggle error:', err);
        setStatus('Audio: failed to start');
      });
    });
  }

  return {
    updateWaveform,
    setStatus,
  };
}
