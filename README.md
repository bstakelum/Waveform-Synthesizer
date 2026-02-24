# TU821-Final-Year-Project----Waveform-Synthesizer
Browser-based waveform synthesizer. Developed in partial fulfilment of the requirements of the Honours Degree  in Electrical and Electronic Engineering (TU821) of  Technological University Dublin

## Project Notes

- `index.html`: Declares the UI structure (camera panel, ROI controls, waveform panel).
- `style.css`: Provides layout, overlay behavior, and styling.
- `app.js`: App-level manager/orchestrator for camera capture, ROI, extraction pipeline, and waveform drawing.
- `cameraController.js`: Camera module for start/stop, facing toggle, ROI controls/overlay, and clean ROI frame capture.
- `audioEngine.js`: Web Audio module for waveform-to-`PeriodicWave` conversion, synth play/stop, and frequency control.
- `imageProcessing.js`: OpenCV module for runtime readiness checks, ROI preprocessing, and processed-frame preview rendering.
- `waveformExtractor.js`: Contains waveform extraction logic (trace finding + waveform post-processing) and exports `extractWaveformFromImageData`.

## Code Documentation

- Newly modularized files now include inline comments for responsibilities and processing stages:
	- `cameraController.js`: camera lifecycle, ROI interaction, and overlay/capture flow
	- `imageProcessing.js`: OpenCV readiness and preprocessing pipeline
	- `waveformExtractor.js`: extraction strategies and waveform post-processing
	- `audioEngine.js`: waveform-to-audio conversion and synth transport handling

## Tuning Guide

- Extraction tuning is centralized in `waveformExtractor.js` (see `TUNING GUIDE (extraction)` at the top).
	- Start with: `DEFAULT_FOREGROUND_CUTOFF`, `CENTER_OF_MASS_CONFIG.maxJumpPx`, `TRIM_CONFIDENCE_CONFIG` thresholds.
	- If fallback behavior is unstable, tune: `BEST_PATH_CONFIG.jumpPenalty` and `FALLBACK_GREEDY_CONFIG.maxYDelta`.

- Image preprocessing tuning is centralized in `imageProcessing.js` (see `TUNING GUIDE (image preprocessing)` at the top).
	- Start with: `denoiseKernelSize`, `backgroundKernelSize`, `claheClipLimit`, `morphologyKernelSize`.
	- Adaptive threshold tuning remains via module options: `cvAdaptiveBlockSize` and `cvAdaptiveC`.

## Current Process Flow

1. Start camera and define ROI using Top/Bottom/Left/Right sliders.
2. On capture, ROI pixels are read from a clean offscreen video frame (not the overlay canvas).
3. OpenCV preprocessing is applied in this order:
	- grayscale conversion
	- light denoise (`GaussianBlur`, 3x3)
	- illumination flattening (subtract blurred background)
	- local contrast enhancement (CLAHE)
	- adaptive thresholding (when `useCVthreshold = true`)
	- binary cleanup (`MORPH_OPEN` then `MORPH_CLOSE`, 3x3)
4. The processed ROI is shown in the OpenCV processed-frame preview panel.
5. Extraction scans one y-position per x-column with continuity constraints.
	- Primary extractor uses a center-of-mass tracker with confidence trimming.
	- Dynamic-path and greedy continuity fallbacks are used when needed.
	- `waveformForegroundCutoff` is used as the foreground acceptance threshold.
6. Extracted waveform is analyzed for debug metrics, then post-processed:
	- interpolation across small gaps
	- zero-fill for unresolved points + DC centering
7. Final waveform is drawn in the synthesis panel and sent to Web Audio (`PeriodicWave` oscillator path).

## Notes

- ROI values are normalized percentages (`0..1`) so selection scales with camera resolution.
- OpenCV is required for the current capture pipeline; if preprocessing fails, capture is aborted and status/debug are updated.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
