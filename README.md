Web Application URL: https://bstakelum.github.io/Waveform-Synthesizer/

# TU821-Final-Year-Project----Waveform-Synthesizer
Browser-based waveform synthesizer. Developed in partial fulfilment of the requirements of the Honours Degree in Electrical and Electronic Engineering (TU821) at Technological University Dublin.

## Project Notes

- `index.html`: App UI layout (camera panel, ROI controls, waveform panel, processed-frame preview).
- `style.css`: Layout/styling for desktop/mobile and debug panels.
- `app.js`: Main orchestrator for camera capture, preprocessing, extraction, waveform drawing, and audio updates.
- `cameraController.js`: Camera lifecycle, facing toggle, ROI controls/overlay, and clean ROI frame capture.
- `imageProcessing.js`: Custom preprocessing pipeline (grayscale, denoise, illumination flatten, contrast, adaptive threshold, mask cleanup).
- `waveformExtractor.js`: Center-of-mass waveform extraction with confidence trimming and post-processing
- `audioEngine.js`: Web Audio scaffold with play/stop transport and a short confirmation beep on Play.

## Current Pipeline

1. Start camera and define ROI using Top/Bottom/Left/Right sliders.
2. Capture ROI from the clean video frame.
3. Preprocess ROI in `imageProcessing.js`:
	- grayscale conversion
	- 3x3 denoise blur
	- one-sided dark-response illumination flattening
	- percentile contrast normalization
	- adaptive percentile thresholding (always enabled)
	- binary mask cleanup (isolated-pixel suppression + dilate/erode)
4. Render the processed ROI in the preview panel.
5. Extract waveform in `waveformExtractor.js`:
	- center-of-mass column tracking with continuity banding
	- confidence-based prefix/suffix trimming
	- short-gap interpolation
	- centering/anchoring/zero-cross alignment post-processing
6. Draw waveform in the synth panel.
7. Press Play to verify Web Audio output (confirmation beep), while custom synthesis hooks remain available for future logic.

## Tuning Guide

### Image Processing (`imageProcessing.js`)
- `flattenKernelRadius`: background estimation scale.
- `flattenBias`: baseline offset after flattening.
- `contrastLowPercentile` / `contrastHighPercentile`: contrast stretch bounds.
- `ADAPTIVE_THRESHOLD_PERCENTILE`: adaptive threshold aggressiveness.
- `minIsolatedNeighborCount`: speckle suppression strength.
- `erodeMinForegroundCount`: mask thinning/robustness balance.

### Extraction (`waveformExtractor.js`)
- `DEFAULT_FOREGROUND_CUTOFF`: foreground acceptance threshold.
- `CENTER_OF_MASS_CONFIG.bandHalfWidth`: search band size around predicted y.
- `CENTER_OF_MASS_CONFIG.maxJumpPx`: continuity rejection threshold.
- `TRIM_CONFIDENCE_CONFIG` values: span entry/exit and trim strictness.
- `WAVEFORM_POSTPROCESSING_CONFIG.interpolationMaxGap`: max gap filled during interpolation.

## Notes

- OpenCV has been removed from the runtime pipeline.
- ROI values are normalized percentages (`0..1`) so selection scales with camera resolution.
- Frequency slider UI is currently removed; audio play is used as a Web Audio readiness check while synthesis logic is being rebuilt.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
