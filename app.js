// DOM Elements
const video = document.getElementById("video");
const startButton = document.getElementById("startCamera");
const captureButton = document.getElementById("captureFrame");

const processingCanvas = document.getElementById("processingCanvas");
const waveformCanvas = document.getElementById("waveformCanvas");

const pctx = processingCanvas.getContext("2d");
const wctx = waveformCanvas.getContext("2d");

let currentStream = null;
const cameraControls = document.getElementById('cameraControls');

// ROI percentages (0..1)
let roiTopPct = 0.0;
let roiBottomPct = 1.0;
let roiLeftPct = 0.0;
let roiRightPct = 1.0;

// DOM references for ROI controls (populated in bindROIControls)
let roiTopInput, roiBottomInput, roiLeftInput, roiRightInput;
let roiTopValSpan, roiBottomValSpan, roiLeftValSpan, roiRightValSpan;

// Bind ROI sliders when DOM is ready
function bindROIControls() {
  roiTopInput = document.getElementById('roiTop');
  roiBottomInput = document.getElementById('roiBottom');
  roiLeftInput = document.getElementById('roiLeft');
  roiRightInput = document.getElementById('roiRight');
  roiTopValSpan = document.getElementById('roiTopVal');
  roiBottomValSpan = document.getElementById('roiBottomVal');
  roiLeftValSpan = document.getElementById('roiLeftVal');
  roiRightValSpan = document.getElementById('roiRightVal');

  function updateDisplays() {
    if (roiTopValSpan) roiTopValSpan.textContent = Math.round(roiTopPct * 100) + '%';
    if (roiBottomValSpan) roiBottomValSpan.textContent = Math.round(roiBottomPct * 100) + '%';
    if (roiLeftValSpan) roiLeftValSpan.textContent = Math.round(roiLeftPct * 100) + '%';
    if (roiRightValSpan) roiRightValSpan.textContent = Math.round(roiRightPct * 100) + '%';
    if (roiTopInput) roiTopInput.value = Math.round(roiTopPct * 100);
    if (roiBottomInput) roiBottomInput.value = Math.round(roiBottomPct * 100);
    if (roiLeftInput) roiLeftInput.value = Math.round(roiLeftPct * 100);
    if (roiRightInput) roiRightInput.value = Math.round(roiRightPct * 100);
  }

  if (roiTopInput && roiBottomInput && roiLeftInput && roiRightInput) {
    roiTopInput.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100;
      roiTopPct = Math.min(val, roiBottomPct - 0.01);
      updateDisplays();
    });

    roiBottomInput.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100;
      roiBottomPct = Math.max(val, roiTopPct + 0.01);
      updateDisplays();
    });

    roiLeftInput.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100;
      // clamp so left < right - allow tiny separation
      roiLeftPct = Math.min(val, roiRightPct - 0.01);
      updateDisplays();
    });

    roiRightInput.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100;
      roiRightPct = Math.max(val, roiLeftPct + 0.01);
      updateDisplays();
    });

    // Reset button
    const resetBtn = document.getElementById('resetROI');
    if (resetBtn) resetBtn.addEventListener('click', resetROI);

    updateDisplays();
  }
}

function updateROIDisplayOnly() {
  if (roiTopValSpan) roiTopValSpan.textContent = Math.round(roiTopPct * 100) + '%';
  if (roiBottomValSpan) roiBottomValSpan.textContent = Math.round(roiBottomPct * 100) + '%';
  if (roiLeftValSpan) roiLeftValSpan.textContent = Math.round(roiLeftPct * 100) + '%';
  if (roiRightValSpan) roiRightValSpan.textContent = Math.round(roiRightPct * 100) + '%';
  if (roiTopInput) roiTopInput.value = Math.round(roiTopPct * 100);
  if (roiBottomInput) roiBottomInput.value = Math.round(roiBottomPct * 100);
  if (roiLeftInput) roiLeftInput.value = Math.round(roiLeftPct * 100);
  if (roiRightInput) roiRightInput.value = Math.round(roiRightPct * 100);
}

function resetROI() {
  // default ROI values
  roiTopPct = 0.0;
  roiBottomPct = 1.0;
  roiLeftPct = 0.0;
  roiRightPct = 1.0;
  updateROIDisplayOnly();
}

// Camera Setup (start/stop toggle)
// Prefer front-facing camera helper
async function getFrontCameraStream() {
  // Use the preferred facing mode (front/back)
  const facing = preferredFacing || 'user';
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false });
  } catch (e) {}

  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
  } catch (e) {}

  // Fallback: request any camera
  return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

startButton.addEventListener("click", async () => {
  if (!currentStream) {
    await startCamera();
  } else {
    stopCamera();
  }
});

// Start camera helper (uses preferred facing)
async function startCamera() {
  if (currentStream) return;
  try {
    const stream = await getPreferredCameraStream();
    currentStream = stream;
    video.srcObject = stream;
    startOverlayLoop();
    if (cameraControls) cameraControls.classList.remove('hidden');
    startButton.textContent = 'Stop Camera';
  } catch (err) {
    console.error('Camera access error:', err);
  }
}

// Stop camera helper
function stopCamera() {
  if (currentStream) {
    try { currentStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  currentStream = null;
  video.srcObject = null;
  stopOverlayLoop();
  if (cameraControls) cameraControls.classList.add('hidden');
  startButton.textContent = 'Start Camera';
  pctx.clearRect(0, 0, processingCanvas.width, processingCanvas.height);
}

// Once video data is available 
video.addEventListener("loadedmetadata", () => {
  processingCanvas.width = video.videoWidth;
  processingCanvas.height = video.videoHeight;

  waveformCanvas.width = 512;
  waveformCanvas.height = 256;
  bindROIControls();
  // initialize camera toggle UI
  updateCameraToggleUI();
});

// Capture Frame (process current ROI from the live overlay)
captureButton.addEventListener("click", () => {
  processImage();
});

// Compute ROI rectangle (full width, centered vertical region)
function computeROI() {
  const x = Math.floor(processingCanvas.width * roiLeftPct);
  const y = Math.floor(processingCanvas.height * roiTopPct);
  const w = Math.floor(processingCanvas.width * (roiRightPct - roiLeftPct));
  const h = Math.floor(processingCanvas.height * (roiBottomPct - roiTopPct));
  return { x, y, width: w, height: h };
}

// Draw dashed ROI overlay on the processing canvas
function drawOverlay() {
  const roi = computeROI();

  // dim outside area
  pctx.save();
  pctx.fillStyle = 'rgba(0,0,0,0.25)';
  pctx.fillRect(0, 0, processingCanvas.width, roi.y);
  pctx.fillRect(0, roi.y + roi.height, processingCanvas.width, processingCanvas.height - (roi.y + roi.height));
  pctx.restore();

  // dashed rectangle
  pctx.save();
  pctx.strokeStyle = '#ffcc00';
  pctx.lineWidth = 2;
  pctx.setLineDash([6, 4]);
  pctx.strokeRect(roi.x + 1, roi.y + 1, roi.width - 2, roi.height - 2);
  pctx.restore();
}

let overlayAnimationId = null;
function startOverlayLoop() {
  function loop() {
    // draw current video frame into processing canvas
    pctx.drawImage(video, 0, 0, processingCanvas.width, processingCanvas.height);
    drawOverlay();
    overlayAnimationId = requestAnimationFrame(loop);
  }
  if (overlayAnimationId == null) loop();
}

function stopOverlayLoop() {
  if (overlayAnimationId != null) {
    cancelAnimationFrame(overlayAnimationId);
    overlayAnimationId = null;
  }
}

// OpenCV integration
let hasOpenCV = false;
let useOpenCVExtraction = false;

function setOpenCVStatus(text) {
  const el = document.getElementById('opencvStatus');
  if (el) el.textContent = text;
}

function waitForCV(timeout = 8000) {
  const start = performance.now();
  return new Promise((resolve) => {
    (function poll() {
      if (typeof cv !== 'undefined') {
        // If runtime already initialized, accept immediately
        if (cv && cv.getBuildInformation) {
          resolve(true);
          return;
        }

        // Otherwise wait for onRuntimeInitialized
        cv['onRuntimeInitialized'] = () => resolve(true);
        return;
      }
      if (performance.now() - start > timeout) {
        resolve(false);
        return;
      }
      setTimeout(poll, 200);
    })();
  });
}

async function initOpenCV() {
  setOpenCVStatus('OpenCV: checking…');

  const scriptPresent = Array.from(document.scripts).some(s => s.src && s.src.includes('opencv.js'));
  if (!scriptPresent) {
    console.warn('OpenCV.js script tag not found — continuing without OpenCV');
    setOpenCVStatus('OpenCV: not included');
    hasOpenCV = false;
    return;
  }

  const ok = await waitForCV(8000);
  if (ok) {
    hasOpenCV = true;
    setOpenCVStatus('OpenCV: ready');
    console.log('OpenCV.js ready');
  } else {
    hasOpenCV = false;
    setOpenCVStatus('OpenCV: not available');
    console.warn('OpenCV.js did not initialize in time — continuing with fallback pipeline');
  }
}

initOpenCV();

// Camera preference toggle (front/back)
let preferredFacing = 'user'; // 'user' (front) or 'environment' (back)

function updateCameraToggleUI() {
  const btn = document.getElementById('cameraToggle');
  if (!btn) return;
  btn.textContent = preferredFacing === 'user' ? 'Front' : 'Back';
}

// Toggle camera preference and restart camera if already active
const cameraToggleBtn = document.getElementById('cameraToggle');
if (cameraToggleBtn) {
  cameraToggleBtn.addEventListener('click', async () => {
    preferredFacing = preferredFacing === 'user' ? 'environment' : 'user';
    updateCameraToggleUI();
    if (currentStream) {
      // restart camera with new facing preference
      stopCamera();
      await startCamera();
    }
  });
}

function extractWaveformOpenCV(imageData) {
  return null;
}

// --- end OpenCV enhancements ---

// Image Processing
function processImage() {
  const roi = computeROI();
  const imageData = pctx.getImageData(roi.x, roi.y, roi.width, roi.height);
  const data = imageData.data;

  // Convert to grayscale with contrast enhancement
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Grayscale conversion
    let gray = 0.299 * r + 0.587 * g + 0.114 * b;

    data[i] = data[i + 1] = data[i + 2] = gray;
  }

  extractWaveform(imageData);
}

// Waveform Extraction
function extractWaveform(imageData) {
  // Optional OpenCV path (disabled by default)
  if (useOpenCVExtraction && hasOpenCV) {
    const wf = extractWaveformOpenCV(imageData);
    if (wf) {
      // still run lightweight interpolation to fill small NaN gaps
      interpolateWaveform(wf);
      drawWaveform(wf);
      return;
    }
    // fall through to loop pipeline on failure
  }
  // Main extraction loop
  extractWaveformLoop(imageData);
}

// Main extraction loop (simple per-column darkest-pixel method)
function extractWaveformLoop(imageData) {
  const { width, height, data } = imageData;
  // One normalized amplitude value per x-column.
  const waveform = new Float32Array(width);

  const threshold = 120; // pick a value between 0 (black) and 255 (white)
  const maxYDelta = 50; // max allowed vertical jump (pixels) from previous column when valid
  let lastValidYPos = null;

  // Scan each column independently to choose one y position.
  for (let x = 0; x < width; x++) {
    let minBrightness = 255;
    let yPos = -1; // -1 means "no valid pixel found"

    // Search top->bottom for the darkest candidate that also stays near the last valid y.
    for (let y = 0; y < height; y++) {
      const index = (y * width + x) * 4;
      const brightness = data[index];
      const withinContinuity = lastValidYPos === null || Math.abs(lastValidYPos - y) <= maxYDelta;

      // Update best candidate only if it is darker and passes continuity.
      if (brightness < minBrightness && withinContinuity) {
        minBrightness = brightness;
        yPos = y;
      }
    }

    // Accept this column only when darkest valid candidate is dark enough.
    if (minBrightness < threshold && yPos > 0) {
      // Convert pixel y (0..height) to normalized amplitude (+1..-1).
      waveform[x] = 1 - (yPos / height) * 2;
      // Track continuity anchor for the next column.
      lastValidYPos = yPos;
    } else {
      waveform[x] = NaN; // set column as NaN to be skipped
    }
  }

  interpolateWaveform(waveform);
  drawWaveform(waveform);
}

// Draw Waveform
function drawWaveform(waveform) {
  wctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

  wctx.strokeStyle = "#ffffff";
  wctx.lineWidth = 2;

  let isDrawing = false;

  for (let i = 0; i < waveform.length; i++) {
    const value = waveform[i];
    
    if (isNaN(value)) {
      if (isDrawing) {
        wctx.stroke();
        isDrawing = false;
      }
      continue;
    }

    const x = (i / waveform.length) * waveformCanvas.width;
    const y = (1 - (value + 1) / 2) * waveformCanvas.height;

    if (!isDrawing) {
      wctx.beginPath();
      wctx.moveTo(x, y);
      isDrawing = true;
    } else {
      wctx.lineTo(x, y);
    }
  }

  if (isDrawing) {
    wctx.stroke();
  }
}

function interpolateWaveform(waveform) {
  // - only fill gaps up to `maxGap` columns wide
  const maxGap = 20; // horizontal gap (columns)
  let i = 0;
  while (i < waveform.length) {
    // Skip columns that already have a valid waveform point.
    if (!isNaN(waveform[i])) {
      i++;
      continue;
    }

    // We found a NaN run. `start` is the last valid index before the gap.
    const start = i - 1;

    // Move `i` to the first valid index after this NaN run.
    while (i < waveform.length && isNaN(waveform[i])) {
      i++;
    }

    // `end` is first valid index after gap; `gap` is number of NaN slots between start/end.
    const end = i;
    const gap = end - start - 1;

    // Interpolate only when both endpoints exist and the gap is small enough.
    if (start >= 0 && end < waveform.length && gap <= maxGap) {
      const startValue = waveform[start];
      const endValue = waveform[end];
      for (let j = 1; j <= gap; j++) {
        // j/(gap+1) gives evenly spaced positions between the two endpoints.
        waveform[start + j] = startValue + (endValue - startValue) * (j / (gap + 1));
      }
    }
  }
}

// Backwards-compatible alias used by the toggle handler
async function getPreferredCameraStream() {
  return await getFrontCameraStream();
}