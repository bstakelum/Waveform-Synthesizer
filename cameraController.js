// Camera controller module:
// - manages camera lifecycle and facing selection
// - maintains ROI sliders and overlay drawing
// - captures clean ROI ImageData for downstream processing
export function createCameraController({
  video,
  processingCanvas,
  startButton,
  captureButton,
  cameraControls,
  cameraToggleButton,
  resetROIButton,
  roiElements,
  onCapture,
  onVideoSize,
}) {
  const pctx = processingCanvas.getContext('2d');
  const captureCanvas = document.createElement('canvas');
  const cctx = captureCanvas.getContext('2d');

  let currentStream = null;
  let overlayAnimationId = null;
  let preferredFacing = 'user';

  let roiTopPct = 0.0;
  let roiBottomPct = 1.0;
  let roiLeftPct = 0.0;
  let roiRightPct = 1.0;

  const {
    topInput,
    bottomInput,
    leftInput,
    rightInput,
    topVal,
    bottomVal,
    leftVal,
    rightVal,
  } = roiElements;

  // Mirror internal ROI state to slider values + text labels.
  function updateROIDisplayOnly() {
    if (topVal) topVal.textContent = Math.round(roiTopPct * 100) + '%';
    if (bottomVal) bottomVal.textContent = Math.round(roiBottomPct * 100) + '%';
    if (leftVal) leftVal.textContent = Math.round(roiLeftPct * 100) + '%';
    if (rightVal) rightVal.textContent = Math.round(roiRightPct * 100) + '%';

    if (topInput) topInput.value = Math.round(roiTopPct * 100);
    if (bottomInput) bottomInput.value = Math.round(roiBottomPct * 100);
    if (leftInput) leftInput.value = Math.round(roiLeftPct * 100);
    if (rightInput) rightInput.value = Math.round(roiRightPct * 100);
  }

  // Reset ROI to full frame.
  function resetROI() {
    roiTopPct = 0.0;
    roiBottomPct = 1.0;
    roiLeftPct = 0.0;
    roiRightPct = 1.0;
    updateROIDisplayOnly();
  }

  // Bind ROI slider interactions and keep ranges consistent.
  function bindROIControls() {
    function updateDisplays() {
      if (topVal) topVal.textContent = Math.round(roiTopPct * 100) + '%';
      if (bottomVal) bottomVal.textContent = Math.round(roiBottomPct * 100) + '%';
      if (leftVal) leftVal.textContent = Math.round(roiLeftPct * 100) + '%';
      if (rightVal) rightVal.textContent = Math.round(roiRightPct * 100) + '%';
      if (topInput) topInput.value = Math.round(roiTopPct * 100);
      if (bottomInput) bottomInput.value = Math.round(roiBottomPct * 100);
      if (leftInput) leftInput.value = Math.round(roiLeftPct * 100);
      if (rightInput) rightInput.value = Math.round(roiRightPct * 100);
    }

    if (topInput && bottomInput && leftInput && rightInput) {
      topInput.addEventListener('input', (event) => {
        const val = Number(event.target.value) / 100;
        roiTopPct = Math.min(val, roiBottomPct - 0.01);
        updateDisplays();
      });

      bottomInput.addEventListener('input', (event) => {
        const val = Number(event.target.value) / 100;
        roiBottomPct = Math.max(val, roiTopPct + 0.01);
        updateDisplays();
      });

      leftInput.addEventListener('input', (event) => {
        const val = Number(event.target.value) / 100;
        roiLeftPct = Math.min(val, roiRightPct - 0.01);
        updateDisplays();
      });

      rightInput.addEventListener('input', (event) => {
        const val = Number(event.target.value) / 100;
        roiRightPct = Math.max(val, roiLeftPct + 0.01);
        updateDisplays();
      });

      updateDisplays();
    }

    if (resetROIButton) {
      resetROIButton.addEventListener('click', resetROI);
    }
  }

  // Compute pixel ROI rectangle from normalized percentages.
  function computeROI() {
    const x = Math.floor(processingCanvas.width * roiLeftPct);
    const y = Math.floor(processingCanvas.height * roiTopPct);
    const w = Math.floor(processingCanvas.width * (roiRightPct - roiLeftPct));
    const h = Math.max(2, Math.floor(processingCanvas.height * (roiBottomPct - roiTopPct)));
    return { x, y, width: w, height: h };
  }

  // Draw dimmed mask + ROI rectangle over the live video frame.
  function drawOverlay() {
    const roi = computeROI();

    pctx.save();
    pctx.fillStyle = 'rgba(0,0,0,0.25)';
    pctx.fillRect(0, 0, processingCanvas.width, roi.y);
    pctx.fillRect(0, roi.y + roi.height, processingCanvas.width, processingCanvas.height - (roi.y + roi.height));
    pctx.restore();

    pctx.save();
    pctx.strokeStyle = '#ffcc00';
    pctx.lineWidth = 2;
    pctx.setLineDash([6, 4]);
    pctx.strokeRect(roi.x + 1, roi.y + 1, roi.width - 2, roi.height - 2);
    pctx.restore();
  }

  // Start requestAnimationFrame loop for live overlay rendering.
  function startOverlayLoop() {
    function loop() {
      pctx.drawImage(video, 0, 0, processingCanvas.width, processingCanvas.height);
      drawOverlay();
      overlayAnimationId = requestAnimationFrame(loop);
    }

    if (overlayAnimationId == null) loop();
  }

  // Stop overlay rendering loop.
  function stopOverlayLoop() {
    if (overlayAnimationId != null) {
      cancelAnimationFrame(overlayAnimationId);
      overlayAnimationId = null;
    }
  }

  // Keep toggle button text synchronized with preferred facing mode.
  function updateCameraToggleUI() {
    if (!cameraToggleButton) return;
    cameraToggleButton.textContent = preferredFacing === 'user' ? 'Front' : 'Back';
  }

  // Try preferred facing mode first, then fall back to any available camera.
  async function getFrontCameraStream() {
    const facing = preferredFacing || 'user';

    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false });
    } catch (e) {}

    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
    } catch (e) {}

    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  // Start camera stream and overlay.
  async function startCamera() {
    if (currentStream) return;

    try {
      const stream = await getPreferredCameraStream();
      currentStream = stream;
      video.srcObject = stream;
      startOverlayLoop();
      if (cameraControls) cameraControls.classList.remove('hidden');
      if (startButton) startButton.textContent = 'Stop Camera';
    } catch (err) {
      console.error('Camera access error:', err);
    }
  }

  // Stop camera stream and clear overlay canvas.
  function stopCamera() {
    if (currentStream) {
      try {
        currentStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
    }

    currentStream = null;
    video.srcObject = null;
    stopOverlayLoop();
    if (cameraControls) cameraControls.classList.add('hidden');
    if (startButton) startButton.textContent = 'Start Camera';
    pctx.clearRect(0, 0, processingCanvas.width, processingCanvas.height);
  }

  // Capture ROI pixels from a clean offscreen frame (no overlay graphics).
  function captureCurrentROIImageData() {
    const roi = computeROI();
    if (roi.width <= 0 || roi.height <= 0) return null;

    cctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    return cctx.getImageData(roi.x, roi.y, roi.width, roi.height);
  }

  // Backwards-compatible wrapper name used internally.
  async function getPreferredCameraStream() {
    return await getFrontCameraStream();
  }

  // One-time event binding and metadata setup.
  function init() {
    if (startButton) {
      startButton.addEventListener('click', async () => {
        if (!currentStream) {
          await startCamera();
        } else {
          stopCamera();
        }
      });
    }

    if (captureButton) {
      captureButton.addEventListener('click', () => {
        const imageData = captureCurrentROIImageData();
        if (!imageData) return;
        if (typeof onCapture === 'function') onCapture(imageData);
      });
    }

    if (cameraToggleButton) {
      cameraToggleButton.addEventListener('click', async () => {
        preferredFacing = preferredFacing === 'user' ? 'environment' : 'user';
        updateCameraToggleUI();
        if (currentStream) {
          stopCamera();
          await startCamera();
        }
      });
    }

    video.addEventListener('loadedmetadata', () => {
      processingCanvas.width = video.videoWidth;
      processingCanvas.height = video.videoHeight;
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      bindROIControls();
      updateCameraToggleUI();

      if (typeof onVideoSize === 'function') {
        onVideoSize({ width: video.videoWidth, height: video.videoHeight });
      }
    });
  }

  return {
    init,
    startCamera,
    stopCamera,
  };
}
