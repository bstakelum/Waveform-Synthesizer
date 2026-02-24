// Image-processing module:
// - waits for OpenCV runtime readiness
// - preprocesses captured ROI frames for robust trace extraction
// - renders optional processed-frame preview canvas

// TUNING GUIDE (image preprocessing)
// 1) Sensor noise cleanup
//    - Increase `denoiseKernelSize` if image grain causes false trace pixels.
//    - Keep it small to preserve thin line detail.
// 2) Uneven lighting compensation
//    - Increase `backgroundKernelSize` when shadows/gradients dominate the ROI.
//    - Adjust `flattenBias` if flattened image appears too dark/bright overall.
// 3) Local contrast strength
//    - Raise `claheClipLimit` to make faint traces pop more.
//    - Lower it if micro-noise becomes too prominent.
// 4) Binary mask cleanup
//    - Increase `morphologyKernelSize` for stronger speckle removal and gap closing.
//    - Decrease it if thin traces get eroded/broken.
// 5) Adaptive threshold behavior
//    - `cvAdaptiveBlockSize` and `cvAdaptiveC` are passed from module creation options.
//    - Larger block sizes follow broader illumination trends; `cvAdaptiveC` shifts sensitivity.
//
// Tunable preprocessing parameters (centralized for easier tuning).
// - Increase denoise/background blur sizes for noisier cameras.
// - Raise/lower flattenBias to shift midtone baseline before thresholding.
// - Adjust CLAHE values for local contrast aggressiveness.
// - Morph kernel controls speckle cleanup vs thin-trace preservation.
const PREPROCESSING_CONFIG = {
  denoiseKernelSize: 3,
  backgroundKernelSize: 31,
  flattenBias: 128,
  claheClipLimit: 2.5,
  claheTileSize: 8,
  morphologyKernelSize: 3,
};

export function createImageProcessor({
  statusEl,
  previewCanvas,
  useCVthreshold = true,
  cvAdaptiveBlockSize = 31,
  cvAdaptiveC = 13,
} = {}) {
  let hasOpenCV = false;
  const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;

  // Update optional OpenCV status text in the UI.
  function setOpenCVStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // Poll until OpenCV runtime is available, or timeout.
  function waitForCV(timeout = 8000) {
    const start = performance.now();
    return new Promise((resolve) => {
      (function poll() {
        if (typeof cv !== 'undefined') {
          if (cv && cv.getBuildInformation) {
            resolve(true);
            return;
          }

          cv.onRuntimeInitialized = () => resolve(true);
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

  // Initialize OpenCV availability and expose user-friendly status.
  async function initOpenCV() {
    setOpenCVStatus('OpenCV: checking…');

    const scriptPresent = Array.from(document.scripts).some((scriptTag) => scriptTag.src && scriptTag.src.includes('opencv.js'));
    if (!scriptPresent) {
      console.warn('OpenCV.js script tag not found.');
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
      console.warn('OpenCV.js did not initialize in time.');
    }
  }

  // Draw processed ROI to preview panel for debugging/inspection.
  function renderProcessedPreview(imageData) {
    if (!previewCanvas || !previewCtx || !imageData) return;

    if (previewCanvas.width !== imageData.width || previewCanvas.height !== imageData.height) {
      previewCanvas.width = imageData.width;
      previewCanvas.height = imageData.height;
    }

    previewCtx.putImageData(imageData, 0, 0);
  }

  // Preprocess ROI frame using grayscale -> denoise -> flatten -> contrast -> threshold/morph.
  function preprocessImageOpenCV(imageData) {
    if (!hasOpenCV || typeof cv === 'undefined') return null;

    let src = null;
    let gray = null;
    let denoised = null;
    let background = null;
    let flattened = null;
    let contrastEnhanced = null;
    let thresholded = null;
    let opened = null;
    let closed = null;
    let rgba = null;
    let clahe = null;
    let openKernel = null;
    let closeKernel = null;

    try {
      src = cv.matFromImageData(imageData);
      gray = new cv.Mat();
      denoised = new cv.Mat();
      background = new cv.Mat();
      flattened = new cv.Mat();
      contrastEnhanced = new cv.Mat();
      thresholded = new cv.Mat();
      opened = new cv.Mat();
      closed = new cv.Mat();
      rgba = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(
        gray,
        denoised,
        new cv.Size(PREPROCESSING_CONFIG.denoiseKernelSize, PREPROCESSING_CONFIG.denoiseKernelSize),
        0,
        0,
        cv.BORDER_DEFAULT
      );
      cv.GaussianBlur(
        denoised,
        background,
        new cv.Size(PREPROCESSING_CONFIG.backgroundKernelSize, PREPROCESSING_CONFIG.backgroundKernelSize),
        0,
        0,
        cv.BORDER_DEFAULT
      );
      cv.addWeighted(denoised, 1.0, background, -1.0, PREPROCESSING_CONFIG.flattenBias, flattened);

      clahe = new cv.CLAHE(
        PREPROCESSING_CONFIG.claheClipLimit,
        new cv.Size(PREPROCESSING_CONFIG.claheTileSize, PREPROCESSING_CONFIG.claheTileSize)
      );
      clahe.apply(flattened, contrastEnhanced);

      if (useCVthreshold) {
        cv.adaptiveThreshold(
          contrastEnhanced,
          thresholded,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY_INV,
          cvAdaptiveBlockSize,
          cvAdaptiveC
        );
        openKernel = cv.getStructuringElement(
          cv.MORPH_RECT,
          new cv.Size(PREPROCESSING_CONFIG.morphologyKernelSize, PREPROCESSING_CONFIG.morphologyKernelSize)
        );
        cv.morphologyEx(thresholded, opened, cv.MORPH_OPEN, openKernel);
        closeKernel = cv.getStructuringElement(
          cv.MORPH_RECT,
          new cv.Size(PREPROCESSING_CONFIG.morphologyKernelSize, PREPROCESSING_CONFIG.morphologyKernelSize)
        );
        cv.morphologyEx(opened, closed, cv.MORPH_CLOSE, closeKernel);
        cv.cvtColor(closed, rgba, cv.COLOR_GRAY2RGBA);
      } else {
        cv.cvtColor(contrastEnhanced, rgba, cv.COLOR_GRAY2RGBA);
      }

      return new ImageData(
        new Uint8ClampedArray(rgba.data),
        imageData.width,
        imageData.height
      );
    } catch (err) {
      console.warn('OpenCV preprocessing failed.', err);
      return null;
    } finally {
      // Always release OpenCV heap allocations to avoid memory growth.
      if (closeKernel) closeKernel.delete();
      if (openKernel) openKernel.delete();
      if (clahe) clahe.delete();
      if (rgba) rgba.delete();
      if (closed) closed.delete();
      if (opened) opened.delete();
      if (thresholded) thresholded.delete();
      if (contrastEnhanced) contrastEnhanced.delete();
      if (flattened) flattened.delete();
      if (background) background.delete();
      if (denoised) denoised.delete();
      if (gray) gray.delete();
      if (src) src.delete();
    }
  }

  return {
    initOpenCV,
    preprocessImageOpenCV,
    renderProcessedPreview,
    setOpenCVStatus,
  };
}
