(() => {
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const MAX_WORKING_SIDE = 1400;
  const MAX_OUTPUT_CHARS = 620000;
  const FINAL_MAX_WIDTH = 900;
  const FINAL_MAX_HEIGHT = 320;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function colorDistance(r, g, b, bg) {
    const dr = r - bg.r;
    const dg = g - bg.g;
    const db = b - bg.b;
    return Math.sqrt(dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11);
  }

  async function decodeImage(file) {
    if (!file) throw new Error('Keine Bilddatei ausgewählt.');
    if (file.size > MAX_SOURCE_BYTES) throw new Error('Das Bild ist zu groß. Bitte eine Datei unter 12 MB auswählen.');

    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (_) {}
    }

    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Dieses Bildformat konnte auf diesem Gerät nicht gelesen werden.'));
      };
      img.src = url;
    });
  }

  function makeWorkingCanvas(image) {
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('Das Bild konnte nicht gelesen werden.');

    const scale = Math.min(1, MAX_WORKING_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return { canvas, ctx, width, height };
  }

  function estimateBackground(data, width, height) {
    const buckets = new Map();
    const samples = [];
    const step = Math.max(1, Math.round(Math.min(width, height) / 180));

    function add(x, y) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 220) return;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, r: 0, g: 0, b: 0, values: [] };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.values.push([r, g, b]);
      samples.push([r, g, b]);
    }

    for (let x = 0; x < width; x += step) {
      add(x, 0);
      if (height > 1) add(x, height - 1);
    }
    for (let y = step; y < height - step; y += step) {
      add(0, y);
      if (width > 1) add(width - 1, y);
    }

    if (!samples.length) return { color: { r: 255, g: 255, b: 255 }, confidence: 0, threshold: 34 };

    const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    const color = {
      r: dominant.r / dominant.count,
      g: dominant.g / dominant.count,
      b: dominant.b / dominant.count
    };
    const confidence = dominant.count / samples.length;

    let variance = 0;
    for (const [r, g, b] of dominant.values) {
      const d = colorDistance(r, g, b, color);
      variance += d * d;
    }
    const std = Math.sqrt(variance / Math.max(1, dominant.values.length));
    const threshold = clamp(24 + std * 2.6, 26, 64);

    return { color, confidence, threshold };
  }

  function transparencyRatio(data) {
    let transparent = 0;
    const pixels = data.length / 4;
    const step = Math.max(1, Math.floor(pixels / 120000));
    let sampled = 0;
    for (let p = 0; p < pixels; p += step) {
      sampled += 1;
      if (data[p * 4 + 3] < 220) transparent += 1;
    }
    return transparent / Math.max(1, sampled);
  }

  function removeConnectedBackground(imageData, width, height, estimate) {
    const data = imageData.data;
    const pixels = width * height;
    const visited = new Uint8Array(pixels);
    const queue = new Int32Array(pixels);
    let head = 0;
    let tail = 0;
    const bg = estimate.color;
    const threshold = estimate.threshold;
    const edgeThreshold = threshold * 1.35;

    function eligible(index) {
      const i = index * 4;
      if (data[i + 3] < 16) return true;
      return colorDistance(data[i], data[i + 1], data[i + 2], bg) <= edgeThreshold;
    }

    function push(index) {
      if (visited[index] || !eligible(index)) return;
      visited[index] = 1;
      queue[tail++] = index;
    }

    for (let x = 0; x < width; x++) {
      push(x);
      if (height > 1) push((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y++) {
      push(y * width);
      if (width > 1) push(y * width + width - 1);
    }

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) push(index - 1);
      if (x + 1 < width) push(index + 1);
      if (y > 0) push(index - width);
      if (y + 1 < height) push(index + width);
    }

    for (let index = 0; index < pixels; index++) {
      if (!visited[index]) continue;
      const i = index * 4;
      const d = colorDistance(data[i], data[i + 1], data[i + 2], bg);
      const fadeStart = threshold * 0.62;
      const fadeEnd = edgeThreshold;
      const keep = clamp((d - fadeStart) / Math.max(1, fadeEnd - fadeStart), 0, 1);
      data[i + 3] = Math.round(data[i + 3] * keep);
    }

    // Bei einem sehr eindeutigen, neutralen Hintergrund auch geschlossene weiße/schwarze Inseln entfernen.
    const spread = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
    const neutral = spread < 22;
    const veryLightOrDark = (bg.r + bg.g + bg.b) / 3 > 205 || (bg.r + bg.g + bg.b) / 3 < 45;
    if (estimate.confidence > 0.68 && neutral && veryLightOrDark) {
      const globalThreshold = threshold * 0.42;
      for (let index = 0; index < pixels; index++) {
        const i = index * 4;
        if (data[i + 3] < 8) continue;
        const d = colorDistance(data[i], data[i + 1], data[i + 2], bg);
        if (d <= globalThreshold) data[i + 3] = 0;
      }
    }

    return tail / Math.max(1, pixels);
  }

  function alphaBounds(data, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= 10) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return { x: 0, y: 0, width, height };

    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    const pad = Math.max(3, Math.round(Math.max(contentWidth, contentHeight) * 0.025));
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    const right = Math.min(width - 1, maxX + pad);
    const bottom = Math.min(height - 1, maxY + pad);
    return { x, y, width: right - x + 1, height: bottom - y + 1 };
  }

  function renderOutput(sourceCanvas, bounds, scaleFactor = 1) {
    const baseScale = Math.min(
      1,
      FINAL_MAX_WIDTH / bounds.width,
      FINAL_MAX_HEIGHT / bounds.height
    ) * scaleFactor;
    const width = Math.max(1, Math.round(bounds.width * baseScale));
    const height = Math.max(1, Math.round(bounds.height * baseScale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      width,
      height
    );
    return canvas;
  }

  function pngWithinLimit(sourceCanvas, bounds) {
    let scale = 1;
    let output;
    let dataUrl;
    do {
      output = renderOutput(sourceCanvas, bounds, scale);
      dataUrl = output.toDataURL('image/png');
      scale *= 0.82;
    } while (dataUrl.length > MAX_OUTPUT_CHARS && scale > 0.24);

    if (dataUrl.length > MAX_OUTPUT_CHARS) {
      throw new Error('Das Logo ist nach der Verarbeitung noch zu groß. Bitte ein kleineres Bild auswählen.');
    }

    return { dataUrl, width: output.width, height: output.height };
  }

  async function process(file) {
    const image = await decodeImage(file);
    const working = makeWorkingCanvas(image);
    if (typeof image.close === 'function') image.close();

    const imageData = working.ctx.getImageData(0, 0, working.width, working.height);
    const existingTransparency = transparencyRatio(imageData.data);
    const estimate = estimateBackground(imageData.data, working.width, working.height);
    let removedBackground = false;

    // Bereits transparente Logos werden nur optimiert und zugeschnitten.
    if (existingTransparency < 0.025 && estimate.confidence >= 0.30) {
      const removedRatio = removeConnectedBackground(imageData, working.width, working.height, estimate);
      removedBackground = removedRatio > 0.015;
      working.ctx.putImageData(imageData, 0, 0);
    }

    const finalData = working.ctx.getImageData(0, 0, working.width, working.height);
    const bounds = alphaBounds(finalData.data, working.width, working.height);
    const output = pngWithinLimit(working.canvas, bounds);

    return {
      ...output,
      removedBackground,
      sourceType: file.type || '',
      backgroundConfidence: estimate.confidence
    };
  }

  window.QRPassLogoProcessor = { process };
})();