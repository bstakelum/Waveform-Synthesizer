// Main client script:
// App manager that orchestrates camera capture, preprocessing, extraction, drawing, and audio updates.
import { createCameraController } from './cameraController.js';
import { createImageProcessor } from './imageProcessing.js';
import { extractWaveformFromImageData } from './waveformExtractor.js';
import { createSynthAudioEngine } from './audioEngine.js';

const waveformCanvas = document.getElementById('waveformCanvas');
const wctx = waveformCanvas.getContext('2d');

const useCVthreshold = true;
const waveformForegroundCutoff = 200;
const cvAdaptiveBlockSize = 31;
const cvAdaptiveC = 13;

const synthEngine = createSynthAudioEngine({
  playButton: document.getElementById('playSynth'),
  freqInput: document.getElementById('synthFreq'),
  freqValueEl: document.getElementById('synthFreqVal'),
  statusEl: document.getElementById('audioStatus'),
});

const imageProcessor = createImageProcessor({
  statusEl: document.getElementById('opencvStatus'),
  previewCanvas: document.getElementById('processedPreviewCanvas'),
  useCVthreshold,
  cvAdaptiveBlockSize,
  cvAdaptiveC,
});

const cameraController = createCameraController({
  video: document.getElementById('video'),
  processingCanvas: document.getElementById('processingCanvas'),
  startButton: document.getElementById('startCamera'),
  captureButton: document.getElementById('captureFrame'),
  cameraControls: document.getElementById('cameraControls'),
  cameraToggleButton: document.getElementById('cameraToggle'),
  resetROIButton: document.getElementById('resetROI'),
  roiElements: {
    topInput: document.getElementById('roiTop'),
    bottomInput: document.getElementById('roiBottom'),
    leftInput: document.getElementById('roiLeft'),
    rightInput: document.getElementById('roiRight'),
    topVal: document.getElementById('roiTopVal'),
    bottomVal: document.getElementById('roiBottomVal'),
    leftVal: document.getElementById('roiLeftVal'),
    rightVal: document.getElementById('roiRightVal'),
  },
  onVideoSize: ({ width }) => {
    waveformCanvas.width = width;
    waveformCanvas.height = 256;
  },
  onCapture: (imageData) => {
    processCapturedImage(imageData);
  },
});

imageProcessor.initOpenCV();
cameraController.init();

function processCapturedImage(imageData) {
  const processedImageData = imageProcessor.preprocessImageOpenCV(imageData);
  if (!processedImageData) {
    imageProcessor.setOpenCVStatus('OpenCV: preprocessing failed');
    return;
  }

  imageProcessor.renderProcessedPreview(processedImageData);

  const waveform = extractWaveformFromImageData(processedImageData, {
    foregroundCutoff: waveformForegroundCutoff,
  });

  if (!waveform || waveform.length === 0) {
    synthEngine.setStatus('Audio: no usable waveform');
    return;
  }

  synthEngine.updateWaveform(waveform);
  drawWaveform(waveform);
}

function drawWaveform(waveform) {
  wctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  wctx.strokeStyle = '#ffffff';
  wctx.lineWidth = 2;

  let isDrawing = false;

  for (let i = 0; i < waveform.length; i++) {
    const value = waveform[i];
    if (Number.isNaN(value)) {
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