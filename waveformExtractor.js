// Waveform extractor module:
// - primary center-of-mass tracker across columns
// - confidence-based trim of weak prefix/suffix regions
// - no fallback paths (best-path/greedy removed)

const DEFAULT_FOREGROUND_CUTOFF = 200;

const TRIM_CONFIDENCE_CONFIG = {
  confWindowRadius: 1,
  smoothRadius: 4,
  highThreshold: 0.45,
  lowThreshold: 0.28,
  enterRun: 6,
  exitRun: 8,
  minSpanColumnsRatio: 0.15,
  minSpanColumnsFloor: 12,
  continuityMaxDelta: 12,
  minKeepValidColumnsRatio: 0.08,
  minKeepValidColumnsFloor: 10,
};

const CENTER_OF_MASS_CONFIG = {
  bandHalfWidth: 20,
  minForegroundCount: 3,
  maxJumpPx: 12,
  medianRadius: 3,
};

const WAVEFORM_POSTPROCESSING_CONFIG = {
  interpolationMaxGap: 30,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getForegroundDensity(imageData, x, y, radiusX, radiusY, cutoff) {
  const { width, height, data } = imageData;
  let foreground = 0;
  let total = 0;

  for (let dy = -radiusY; dy <= radiusY; dy++) {
    const yy = clamp(y + dy, 0, height - 1);
    for (let dx = -radiusX; dx <= radiusX; dx++) {
      const xx = clamp(x + dx, 0, width - 1);
      const idx = (yy * width + xx) * 4;
      if (data[idx] >= cutoff) foreground++;
      total++;
    }
  }

  return total > 0 ? foreground / total : 0;
}

function countValidPathPoints(pathY) {
  let count = 0;
  for (let i = 0; i < pathY.length; i++) {
    if (pathY[i] >= 0) count++;
  }
  return count;
}

function getMedianOfFiniteWindow(values, start, end) {
  const finite = [];
  for (let i = start; i <= end; i++) {
    const value = values[i];
    if (Number.isFinite(value)) finite.push(value);
  }
  if (finite.length === 0) return NaN;
  finite.sort((a, b) => a - b);
  return finite[Math.floor(finite.length / 2)];
}

function medianFilterFinite1D(values, radius) {
  if (radius <= 0) return Float32Array.from(values);
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    const median = getMedianOfFiniteWindow(values, start, end);
    output[i] = Number.isFinite(median) ? median : values[i];
  }
  return output;
}

function movingAverage1D(values, radius) {
  if (radius <= 0) return Float32Array.from(values);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= end; j++) {
      sum += values[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function trimTracePathByConfidence(pathY, imageData, foregroundCutoff) {
  const { width } = imageData;
  if (!pathY || pathY.length === 0) return pathY;

  const settings = {
    ...TRIM_CONFIDENCE_CONFIG,
    minSpanColumns: Math.max(
      TRIM_CONFIDENCE_CONFIG.minSpanColumnsFloor,
      Math.floor(width * TRIM_CONFIDENCE_CONFIG.minSpanColumnsRatio)
    ),
    minKeepValidColumns: Math.max(
      TRIM_CONFIDENCE_CONFIG.minKeepValidColumnsFloor,
      Math.floor(width * TRIM_CONFIDENCE_CONFIG.minKeepValidColumnsRatio)
    ),
  };

  const conf = new Float32Array(width);
  let prevValidY = null;

  for (let x = 0; x < width; x++) {
    const y = pathY[x];
    if (y < 0) {
      conf[x] = 0;
      continue;
    }

    const localDensity = getForegroundDensity(
      imageData,
      x,
      y,
      settings.confWindowRadius,
      settings.confWindowRadius,
      foregroundCutoff
    );

    let continuityScore = 0.7;
    if (prevValidY !== null) {
      const dy = Math.abs(y - prevValidY);
      continuityScore = 1 - Math.min(1, dy / settings.continuityMaxDelta);
    }

    conf[x] = 0.75 * localDensity + 0.25 * continuityScore;
    prevValidY = y;
  }

  const smoothedConf = movingAverage1D(conf, settings.smoothRadius);
  const spans = [];

  let inTrace = false;
  let start = -1;
  let highCount = 0;
  let lowCount = 0;

  for (let x = 0; x < width; x++) {
    const c = smoothedConf[x];

    if (!inTrace) {
      if (c >= settings.highThreshold) {
        highCount++;
      } else {
        highCount = 0;
      }

      if (highCount >= settings.enterRun) {
        inTrace = true;
        start = x - settings.enterRun + 1;
        lowCount = 0;
      }
      continue;
    }

    if (c <= settings.lowThreshold) {
      lowCount++;
    } else {
      lowCount = 0;
    }

    if (lowCount >= settings.exitRun) {
      const end = x - settings.exitRun;
      if (start >= 0 && end >= start) {
        spans.push({ start, end, length: end - start + 1 });
      }
      inTrace = false;
      start = -1;
      highCount = 0;
      lowCount = 0;
    }
  }

  if (inTrace && start >= 0) {
    spans.push({ start, end: width - 1, length: width - start });
  }

  if (spans.length === 0) return pathY;

  let bestSpan = spans[0];
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].length > bestSpan.length) bestSpan = spans[i];
  }

  if (bestSpan.length < settings.minSpanColumns) return pathY;

  const trimmed = new Int16Array(pathY.length);
  for (let x = 0; x < pathY.length; x++) {
    trimmed[x] = x < bestSpan.start || x > bestSpan.end ? -1 : pathY[x];
  }

  if (countValidPathPoints(trimmed) < settings.minKeepValidColumns) {
    return pathY;
  }

  return trimmed;
}

function findCenterOfMassTracePath(imageData, foregroundCutoff) {
  const { width, height, data } = imageData;
  const pathY = new Float32Array(width);
  for (let i = 0; i < width; i++) {
    pathY[i] = NaN;
  }

  const settings = {
    ...CENTER_OF_MASS_CONFIG,
    foregroundCutoff,
  };

  const computeColumnCOM = (x, yMin, yMax) => {
    let weightSum = 0;
    let weightedY = 0;
    let foregroundCount = 0;

    for (let y = yMin; y <= yMax; y++) {
      const idx = (y * width + x) * 4;
      const brightness = data[idx];
      if (brightness < settings.foregroundCutoff) continue;

      const weight = brightness / 255;
      weightSum += weight;
      weightedY += y * weight;
      foregroundCount++;
    }

    if (foregroundCount < settings.minForegroundCount || weightSum <= 0) {
      return NaN;
    }

    return weightedY / weightSum;
  };

  for (let x = 0; x < width; x++) {
    const prev = x > 0 ? pathY[x - 1] : NaN;
    const prev2 = x > 1 ? pathY[x - 2] : NaN;

    let predictedY = height * 0.5;
    if (Number.isFinite(prev) && Number.isFinite(prev2)) {
      predictedY = prev + (prev - prev2);
    } else if (Number.isFinite(prev)) {
      predictedY = prev;
    }

    const yMinBand = clamp(Math.floor(predictedY - settings.bandHalfWidth), 0, height - 1);
    const yMaxBand = clamp(Math.ceil(predictedY + settings.bandHalfWidth), 0, height - 1);

    let yEstimate = computeColumnCOM(x, yMinBand, yMaxBand);
    if (!Number.isFinite(yEstimate)) {
      yEstimate = computeColumnCOM(x, 0, height - 1);
    }

    if (!Number.isFinite(yEstimate)) {
      pathY[x] = NaN;
      continue;
    }

    if (Number.isFinite(prev) && Math.abs(yEstimate - prev) > settings.maxJumpPx) {
      pathY[x] = NaN;
      continue;
    }

    pathY[x] = yEstimate;
  }

  const smoothed = medianFilterFinite1D(pathY, settings.medianRadius);
  const quantized = new Int16Array(width);
  for (let i = 0; i < width; i++) {
    quantized[i] = Number.isFinite(smoothed[i]) ? Math.round(smoothed[i]) : -1;
  }

  return quantized;
}

function interpolateWaveform(waveform) {
  const { interpolationMaxGap: maxGap } = WAVEFORM_POSTPROCESSING_CONFIG;
  let i = 0;

  while (i < waveform.length) {
    if (!Number.isNaN(waveform[i])) {
      i++;
      continue;
    }

    const start = i - 1;

    while (i < waveform.length && Number.isNaN(waveform[i])) {
      i++;
    }

    const end = i;
    const gap = end - start - 1;

    if (start >= 0 && end < waveform.length && gap <= maxGap) {
      const startValue = waveform[start];
      const endValue = waveform[end];
      for (let j = 1; j <= gap; j++) {
        waveform[start + j] = startValue + (endValue - startValue) * (j / (gap + 1));
      }
    }
  }
}

function zeroAndCenterWaveform(waveform) {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < waveform.length; i++) {
    if (Number.isNaN(waveform[i])) {
      waveform[i] = 0;
    }
    sum += waveform[i];
    count++;
  }

  const mean = count > 0 ? sum / count : 0;
  for (let i = 0; i < waveform.length; i++) {
    waveform[i] -= mean;
  }
}

function anchorWaveformEndpointsToZero(waveform) {
  if (!waveform || waveform.length < 2) return;

  const lastIndex = waveform.length - 1;
  const startValue = waveform[0];
  const endValue = waveform[lastIndex];

  for (let i = 0; i <= lastIndex; i++) {
    const t = i / lastIndex;
    const baseline = startValue + (endValue - startValue) * t;
    waveform[i] -= baseline;
  }
}

function rotateWaveformInPlace(waveform, startIndex) {
  const length = waveform.length;
  if (length < 2) return;
  const normalizedStart = ((startIndex % length) + length) % length;
  if (normalizedStart === 0) return;

  const rotated = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    rotated[i] = waveform[(normalizedStart + i) % length];
  }

  for (let i = 0; i < length; i++) {
    waveform[i] = rotated[i];
  }
}

function alignWaveformStartToZeroCrossing(waveform) {
  if (!waveform || waveform.length < 4) return;

  let bestIndex = -1;
  let bestScore = Infinity;

  for (let i = 0; i < waveform.length - 1; i++) {
    const a = waveform[i];
    const b = waveform[i + 1];
    const hasCrossing = (a <= 0 && b >= 0) || (a >= 0 && b <= 0);
    if (!hasCrossing) continue;

    const isRising = a <= 0 && b >= 0;
    if (!isRising) continue;

    const score = Math.abs(a) + Math.abs(b);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = Math.abs(a) <= Math.abs(b) ? i : i + 1;
    }
  }

  if (bestIndex < 0) {
    for (let i = 0; i < waveform.length; i++) {
      const score = Math.abs(waveform[i]);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }

  if (bestIndex > 0) {
    rotateWaveformInPlace(waveform, bestIndex);
  }
}

export function extractWaveformFromImageData(imageData, options = {}) {
  if (!imageData || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) {
    return null;
  }

  const { width, height } = imageData;
  if (width <= 0 || height <= 0) return null;

  const foregroundCutoff = Number.isFinite(options.foregroundCutoff)
    ? options.foregroundCutoff
    : DEFAULT_FOREGROUND_CUTOFF;

  const rawTracePath = findCenterOfMassTracePath(imageData, foregroundCutoff);
  const tracePath = trimTracePathByConfidence(rawTracePath, imageData, foregroundCutoff);

  const waveform = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const yPos = tracePath[x];
    waveform[x] = yPos >= 0 ? 1 - (yPos / height) * 2 : NaN;
  }

  interpolateWaveform(waveform);
  zeroAndCenterWaveform(waveform);
  anchorWaveformEndpointsToZero(waveform);
  alignWaveformStartToZeroCrossing(waveform);
  anchorWaveformEndpointsToZero(waveform);

  return waveform;
}
