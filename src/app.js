import './style.css';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const video = $('#video');
const liveCanvas = $('#captureCanvas');
const resultCanvas = $('#resultCanvas');
const placeholder = $('#cameraPlaceholder');
const shutter = $('#shutter');
const countdownEl = $('#countdown');
const flash = $('#flash');
const contactSheet = $('#contactSheet');
const studio = $('#studio');
const publicAsset = path => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
const canvasFilterSupported = 'filter' in document.createElement('canvas').getContext('2d');
let previewFrame = null;

const filters = {
  c41: {
    css: 'sepia(.12) saturate(.86) contrast(1) brightness(.95)',
    grade: { sepia: .12, saturation: .86, contrast: 1, brightness: .95, warmth: .14, fade: .012 },
    grain: 20, chroma: .1, leak: .13, halation: .07, flash: .72
  },
  fade: {
    css: 'sepia(.34) saturate(.62) contrast(.84) brightness(1.03) hue-rotate(-7deg)',
    grade: { sepia: .34, saturation: .62, contrast: .84, brightness: 1.03, hue: -7, warmth: .32, fade: .08 },
    grain: 18, chroma: .13, leak: .2, halation: .1, flash: .68
  },
  mono: {
    css: 'grayscale(1) contrast(1.22) brightness(.92)',
    grade: { grayscale: 1, contrast: 1.22, brightness: .92, fade: .015 },
    grain: 27, chroma: 0, leak: .01, halation: .035, flash: .7
  },
  raw: {
    css: 'saturate(.86) contrast(1.08) brightness(.95)',
    grade: { saturation: .86, contrast: 1.08, brightness: .95, cool: .55, fade: .004 },
    grain: 12, chroma: .08, leak: .035, halation: .025, flash: .6
  }
};

const state = {
  stream: null,
  facingMode: 'user',
  photos: [],
  filter: 'c41',
  frame: 'contact',
  eyes: 40,
  nose: 40,
  jaw: 8,
  face: 30,
  skin: 20,
  sound: true,
  busy: false,
  faceLandmarker: null,
  faceReady: false
};

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function initFaceModel() {
  const status = $('#faceStatus');
  try {
    const vision = await FilesetResolver.forVisionTasks(publicAsset('wasm'));
    state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: publicAsset('models/face_landmarker.task'), delegate: 'GPU' },
      runningMode: 'IMAGE',
      numFaces: 4,
      minFaceDetectionConfidence: .45,
      minFacePresenceConfidence: .45,
      minTrackingConfidence: .45
    });
    state.faceReady = true;
    status.textContent = 'READY';
    status.className = 'ready';
  } catch (error) {
    console.warn('Face model unavailable', error);
    status.textContent = 'OFFLINE';
    status.className = 'error';
  }
}

function updateLiveFilter() {
  const cssFilter = filters[state.filter].css;
  video.style.filter = cssFilter;
  liveCanvas.style.filter = cssFilter;
  $('#viewfinder').dataset.film = state.filter;
}

function stopCanvasPreview() {
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = null;
  liveCanvas.hidden = true;
  liveCanvas.classList.remove('live-preview', 'ready', 'mirrored');
  $('#viewfinder').classList.remove('canvas-preview');
}

function startCanvasPreview() {
  stopCanvasPreview();
  if (canvasFilterSupported) return;

  const ctx = liveCanvas.getContext('2d');
  liveCanvas.width = 640;
  liveCanvas.height = 480;
  liveCanvas.hidden = false;
  liveCanvas.classList.add('live-preview', 'ready');
  liveCanvas.classList.toggle('mirrored', state.facingMode === 'user');
  $('#viewfinder').classList.add('canvas-preview');
  updateLiveFilter();

  const drawPreview = () => {
    if (!state.stream) return;
    if (video.readyState >= 2) {
      const crop = cropSquare(video.videoWidth, video.videoHeight);
      ctx.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, liveCanvas.width, liveCanvas.height);
    }
    previewFrame = requestAnimationFrame(drawPreview);
  };
  drawPreview();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('CAMERA UNAVAILABLE');
    $('#photoUpload').click();
    return;
  }
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1440 }, height: { ideal: 1440 } },
      audio: false
    });
    video.srcObject = state.stream;
    await video.play();
    placeholder.classList.add('hidden');
    video.classList.add('ready');
    video.classList.toggle('mirrored', state.facingMode === 'user');
    startCanvasPreview();
    shutter.disabled = false;
  } catch {
    placeholder.classList.remove('hidden');
    shutter.disabled = true;
    toast('ALLOW CAMERA OR IMPORT');
  }
}

function stopCamera() {
  stopCanvasPreview();
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
}

function playShutterSound() {
  if (!state.sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioCtx();
    const buffer = audio.createBuffer(1, audio.sampleRate * .09, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    gain.gain.value = .2;
    source.connect(gain).connect(audio.destination);
    source.start();
  } catch { /* sound is optional */ }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runCountdown() {
  for (let number = 3; number > 0; number -= 1) {
    countdownEl.textContent = number;
    countdownEl.classList.remove('pop');
    void countdownEl.offsetWidth;
    countdownEl.classList.add('pop');
    await wait(760);
  }
  countdownEl.textContent = '';
}

function cropSquare(width, height) {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

function samplePixel(source, width, height, x, y, output, index) {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = (y0 * width + x0) * 4;
  const b = (y0 * width + x1) * 4;
  const c = (y1 * width + x0) * 4;
  const d = (y1 * width + x1) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    const top = source[a + channel] * (1 - fx) + source[b + channel] * fx;
    const bottom = source[c + channel] * (1 - fx) + source[d + channel] * fx;
    output[index + channel] = top * (1 - fy) + bottom * fy;
  }
}

function radialWarp(canvas, cx, cy, rx, ry, scaleX, scaleY, lowerOnly = false, angle = 0) {
  if (rx < 2 || ry < 2 || (scaleX === 1 && scaleY === 1)) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const source = new Uint8ClampedArray(image.data);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const boundsX = Math.abs(rx * cosine) + Math.abs(ry * sine);
  const boundsY = Math.abs(rx * sine) + Math.abs(ry * cosine);
  const minX = Math.max(0, Math.floor(cx - boundsX));
  const maxX = Math.min(canvas.width - 1, Math.ceil(cx + boundsX));
  const minY = Math.max(0, Math.floor(cy - boundsY));
  const maxY = Math.min(canvas.height - 1, Math.ceil(cy + boundsY));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const rotatedX = dx * cosine + dy * sine;
      const rotatedY = -dx * sine + dy * cosine;
      const nx = rotatedX / rx;
      const ny = rotatedY / ry;
      const distance = nx * nx + ny * ny;
      if (distance >= 1 || (lowerOnly && rotatedY < -ry * .35)) continue;
      // Smoothstep keeps a soft edge without losing most of the effect before
      // it reaches the eye corners or nose wings.
      const edgeDistance = 1 - distance;
      const falloff = edgeDistance * edgeDistance * (3 - 2 * edgeDistance);
      const localX = 1 + (scaleX - 1) * falloff;
      const localY = 1 + (scaleY - 1) * falloff;
      const sourceLocalX = rotatedX / localX;
      const sourceLocalY = rotatedY / localY;
      const sourceX = cx + sourceLocalX * cosine - sourceLocalY * sine;
      const sourceY = cy + sourceLocalX * sine + sourceLocalY * cosine;
      samplePixel(source, canvas.width, canvas.height, sourceX, sourceY, image.data, (y * canvas.width + x) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function localizedTranslate(canvas, cx, cy, rx, ry, shiftX, shiftY) {
  if (rx < 2 || ry < 2 || (!shiftX && !shiftY)) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const source = new Uint8ClampedArray(image.data);
  const minX = Math.max(0, Math.floor(cx - rx));
  const maxX = Math.min(canvas.width - 1, Math.ceil(cx + rx));
  const minY = Math.max(0, Math.floor(cy - ry));
  const maxY = Math.min(canvas.height - 1, Math.ceil(cy + ry));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const distance = nx * nx + ny * ny;
      if (distance >= 1) continue;
      const edgeDistance = 1 - distance;
      const falloff = edgeDistance * edgeDistance * (3 - 2 * edgeDistance);
      samplePixel(
        source,
        canvas.width,
        canvas.height,
        x - shiftX * falloff,
        y - shiftY * falloff,
        image.data,
        (y * canvas.width + x) * 4
      );
    }
  }
  ctx.putImageData(image, 0, 0);
}

function affineFromTriangles(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < .0001) return null;
  const coefficients = values => ({
    x: (values[0] * (s1.y - s2.y) + values[1] * (s2.y - s0.y) + values[2] * (s0.y - s1.y)) / denominator,
    y: (values[0] * (s2.x - s1.x) + values[1] * (s0.x - s2.x) + values[2] * (s1.x - s0.x)) / denominator,
    offset: (values[0] * (s1.x * s2.y - s2.x * s1.y) + values[1] * (s2.x * s0.y - s0.x * s2.y) + values[2] * (s0.x * s1.y - s1.x * s0.y)) / denominator
  });
  const horizontal = coefficients([d0.x, d1.x, d2.x]);
  const vertical = coefficients([d0.y, d1.y, d2.y]);
  return [horizontal.x, vertical.x, horizontal.y, vertical.y, horizontal.offset, vertical.offset];
}

function expandTriangle(points, pixels = .7) {
  const center = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3
  };
  return points.map(point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + dx / length * pixels, y: point.y + dy / length * pixels };
  });
}

function drawWarpedTriangle(ctx, sourceCanvas, source, destination) {
  const matrix = affineFromTriangles(source, destination);
  if (!matrix) return;
  const clip = expandTriangle(destination);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clip[0].x, clip[0].y);
  ctx.lineTo(clip[1].x, clip[1].y);
  ctx.lineTo(clip[2].x, clip[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(...matrix);
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}

function renderFaceMesh(canvas, landmarks, destinationPoints, includeOuterRing = false) {
  const width = canvas.width;
  const height = canvas.height;
  const sourcePoints = landmarks.map(point => ({ x: point.x * width, y: point.y * height }));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCanvas.getContext('2d').drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const tessellation = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  for (let index = 0; index < tessellation.length; index += 3) {
    const edges = tessellation.slice(index, index + 3);
    if (edges.length < 3) continue;
    const indices = [...new Set(edges.flatMap(edge => [edge.start, edge.end]))];
    if (indices.length !== 3) continue;
    drawWarpedTriangle(
      ctx,
      sourceCanvas,
      indices.map(vertex => sourcePoints[vertex]),
      indices.map(vertex => destinationPoints[vertex])
    );
  }

  if (!includeOuterRing) return;
  const oval = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
  const ovalIndices = [...new Set(oval.flatMap(edge => [edge.start, edge.end]))];
  const center = {
    x: ovalIndices.reduce((sum, index) => sum + sourcePoints[index].x, 0) / ovalIndices.length,
    y: ovalIndices.reduce((sum, index) => sum + sourcePoints[index].y, 0) / ovalIndices.length
  };
  const outer = sourcePoints.map(point => ({
    x: center.x + (point.x - center.x) * 1.22,
    y: center.y + (point.y - center.y) * 1.18
  }));
  oval.forEach(edge => {
    const a = edge.start;
    const b = edge.end;
    drawWarpedTriangle(ctx, sourceCanvas, [sourcePoints[a], sourcePoints[b], outer[a]], [destinationPoints[a], destinationPoints[b], outer[a]]);
    drawWarpedTriangle(ctx, sourceCanvas, [outer[a], sourcePoints[b], outer[b]], [outer[a], destinationPoints[b], outer[b]]);
  });
}

function makeFaceBasis(landmarks, width, height) {
  const firstEye = averagePoint(landmarks, [33, 133, 159, 145], width, height);
  const secondEye = averagePoint(landmarks, [362, 263, 386, 374], width, height);
  const imageLeftEye = firstEye.x < secondEye.x ? firstEye : secondEye;
  const imageRightEye = firstEye.x < secondEye.x ? secondEye : firstEye;
  const length = Math.max(1, distance(imageLeftEye, imageRightEye));
  const ux = (imageRightEye.x - imageLeftEye.x) / length;
  const uy = (imageRightEye.y - imageLeftEye.y) / length;
  return {
    ux,
    uy,
    vx: -uy,
    vy: ux,
    angle: Math.atan2(uy, ux)
  };
}

function projectPoint(point, origin, basis) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: dx * basis.ux + dy * basis.uy,
    y: dx * basis.vx + dy * basis.vy
  };
}

function unprojectPoint(point, origin, basis) {
  return {
    x: origin.x + point.x * basis.ux + point.y * basis.vx,
    y: origin.y + point.x * basis.uy + point.y * basis.vy
  };
}

function applyNoseMeshWarp(canvas, landmarks, faceWidth, faceHeight, amount, basis) {
  if (!amount) return;
  const width = canvas.width;
  const height = canvas.height;
  const tip = averagePoint(landmarks, [1, 4], width, height);
  const leftWing = averagePoint(landmarks, [49, 64, 98, 129], width, height);
  const rightWing = averagePoint(landmarks, [279, 294, 327, 358], width, height);
  const base = { x: (leftWing.x + rightWing.x) / 2, y: (leftWing.y + rightWing.y) / 2 };
  const firstWing = projectPoint(leftWing, base, basis);
  const secondWing = projectPoint(rightWing, base, basis);
  const localLeftWing = firstWing.x < secondWing.x ? firstWing : secondWing;
  const localRightWing = firstWing.x < secondWing.x ? secondWing : firstWing;
  const localTip = projectPoint(tip, base, basis);
  const wingDistance = Math.max(1, localRightWing.x - localLeftWing.x);
  const strength = amount / 100;
  const yawEstimate = Math.min(1, Math.abs(localTip.x) / Math.max(1, wingDistance * .65));
  const poseStability = 1 - yawEstimate * .22;
  const wingShift = wingDistance * .115 * strength * poseStability;
  const wingRadiusX = wingDistance * .9;
  const wingRadiusY = Math.max(wingDistance * .7, faceHeight * .045);

  const sourcePoints = landmarks.map(point => ({ x: point.x * width, y: point.y * height }));
  const destinationPoints = sourcePoints.map(point => {
    const localPoint = projectPoint(point, base, basis);
    const leftDistance = ((localPoint.x - localLeftWing.x) / wingRadiusX) ** 2 + ((localPoint.y - localLeftWing.y) / wingRadiusY) ** 2;
    const rightDistance = ((localPoint.x - localRightWing.x) / wingRadiusX) ** 2 + ((localPoint.y - localRightWing.y) / wingRadiusY) ** 2;
    const leftEdge = Math.max(0, 1 - leftDistance);
    const rightEdge = Math.max(0, 1 - rightDistance);
    const leftWeight = leftEdge * leftEdge * (3 - 2 * leftEdge);
    const rightWeight = rightEdge * rightEdge * (3 - 2 * rightEdge);
    if (!leftWeight && !rightWeight) return { ...point };
    return unprojectPoint({
      x: localPoint.x + wingShift * leftWeight - wingShift * rightWeight,
      y: localPoint.y
    }, base, basis);
  });

  renderFaceMesh(canvas, landmarks, destinationPoints);
}

function applyFaceSlimMesh(canvas, landmarks, faceWidth, faceHeight, amount, basis) {
  if (!amount) return;
  const width = canvas.width;
  const height = canvas.height;
  const leftCheek = averagePoint(landmarks, [234], width, height);
  const rightCheek = averagePoint(landmarks, [454], width, height);
  const nose = averagePoint(landmarks, [1, 4], width, height);
  const chin = averagePoint(landmarks, [152], width, height);
  const center = { x: (leftCheek.x + rightCheek.x) / 2, y: (leftCheek.y + rightCheek.y) / 2 };
  const localNose = projectPoint(nose, center, basis);
  const localChin = projectPoint(chin, center, basis);
  const sourcePoints = landmarks.map(point => ({ x: point.x * width, y: point.y * height }));
  const strength = amount / 100;
  const maxReduction = .16 * strength;

  const destinationPoints = sourcePoints.map(point => {
    const localPoint = projectPoint(point, center, basis);
    const horizontalPosition = Math.min(1, Math.abs(localPoint.x) / Math.max(1, faceWidth * .52));
    const edgeProgress = Math.max(0, Math.min(1, (horizontalPosition - .23) / .77));
    const edgeWeight = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
    const verticalProgress = Math.max(0, Math.min(1, (localPoint.y - (localNose.y - faceHeight * .18)) / Math.max(1, localChin.y - localNose.y + faceHeight * .18)));
    const verticalWeight = .32 + verticalProgress * .68;
    const reduction = maxReduction * edgeWeight * verticalWeight;
    return unprojectPoint({ x: localPoint.x * (1 - reduction), y: localPoint.y }, center, basis);
  });

  renderFaceMesh(canvas, landmarks, destinationPoints, true);
}

function averagePoint(landmarks, indices, width, height) {
  const points = indices.map(index => landmarks[index]);
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length * width,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length * height
  };
}

function restoreFeatheredPatch(sourceCanvas, targetCanvas, cx, cy, radius) {
  const size = Math.max(8, Math.round(radius * 2));
  const patch = document.createElement('canvas');
  patch.width = size;
  patch.height = size;
  const pctx = patch.getContext('2d');
  pctx.drawImage(sourceCanvas, cx - radius, cy - radius, radius * 2, radius * 2, 0, 0, size, size);
  pctx.globalCompositeOperation = 'destination-in';
  const mask = pctx.createRadialGradient(size / 2, size / 2, size * .27, size / 2, size / 2, size * .5);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(.72, 'rgba(0,0,0,.96)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  pctx.fillStyle = mask;
  pctx.fillRect(0, 0, size, size);
  targetCanvas.getContext('2d').drawImage(patch, cx - radius, cy - radius, radius * 2, radius * 2);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function applyFaceShape(canvas, landmarks) {
  const w = canvas.width;
  const h = canvas.height;
  const leftCheek = averagePoint(landmarks, [234], w, h);
  const rightCheek = averagePoint(landmarks, [454], w, h);
  const forehead = averagePoint(landmarks, [10], w, h);
  const chin = averagePoint(landmarks, [152], w, h);
  const faceWidth = distance(leftCheek, rightCheek);
  const faceHeight = distance(forehead, chin);
  if (faceWidth < 35) return;
  const basis = makeFaceBasis(landmarks, w, h);

  const originalFace = document.createElement('canvas');
  originalFace.width = w;
  originalFace.height = h;
  originalFace.getContext('2d').drawImage(canvas, 0, 0);

  const leftEye = averagePoint(landmarks, [33, 133, 159, 145], w, h);
  const rightEye = averagePoint(landmarks, [362, 263, 386, 374], w, h);
  const eyeAmount = state.eyes / 100;
  const eyeScaleX = 1 + eyeAmount * .24;
  const eyeScaleY = 1 + eyeAmount * .1;
  radialWarp(canvas, leftEye.x, leftEye.y, faceWidth * .16, faceHeight * .082, eyeScaleX, eyeScaleY, false, basis.angle);
  radialWarp(canvas, rightEye.x, rightEye.y, faceWidth * .16, faceHeight * .082, eyeScaleX, eyeScaleY, false, basis.angle);

  // The eye contour opens, but the original irises are composited back at
  // their natural size to avoid the doll-eye effect.
  const leftIris = averagePoint(landmarks, [468, 469, 470, 471, 472], w, h);
  const rightIris = averagePoint(landmarks, [473, 474, 475, 476, 477], w, h);
  restoreFeatheredPatch(originalFace, canvas, leftIris.x, leftIris.y, faceWidth * .04);
  restoreFeatheredPatch(originalFace, canvas, rightIris.x, rightIris.y, faceWidth * .04);

  const nose = averagePoint(landmarks, [1, 2, 4, 5], w, h);
  applyNoseMeshWarp(canvas, landmarks, faceWidth, faceHeight, state.nose, basis);

  const cheekCenter = { x: (leftCheek.x + rightCheek.x) / 2, y: (leftCheek.y + rightCheek.y) / 2 };
  const jawCenter = {
    x: (cheekCenter.x + nose.x) / 2 + basis.vx * faceHeight * .25,
    y: (cheekCenter.y + nose.y) / 2 + basis.vy * faceHeight * .25
  };
  const jawScale = 1 - state.jaw * .0019;
  radialWarp(canvas, jawCenter.x, jawCenter.y, faceWidth * .53, faceHeight * .45, jawScale, 1, true, basis.angle);

  applyFaceSlimMesh(canvas, landmarks, faceWidth, faceHeight, state.face, basis);
}

function softenSkin(canvas) {
  if (!state.skin) return;
  const ctx = canvas.getContext('2d');
  const small = document.createElement('canvas');
  small.width = 180;
  small.height = 180;
  const sctx = small.getContext('2d');
  sctx.filter = `blur(${1.3 + state.skin / 38}px) brightness(${1 + state.skin / 1400})`;
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  ctx.save();
  ctx.globalAlpha = state.skin / 520;
  ctx.globalCompositeOperation = 'screen';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function applyColorGrade(canvas, preset) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const {
    sepia = 0,
    grayscale = 0,
    saturation = 1,
    contrast = 1,
    brightness = 1,
    hue = 0,
    warmth = 0,
    cool = 0,
    fade = 0
  } = preset.grade;
  const radians = hue * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const hueMatrix = [
    .213 + cosine * .787 - sine * .213, .715 - cosine * .715 - sine * .715, .072 - cosine * .072 + sine * .928,
    .213 - cosine * .213 + sine * .143, .715 + cosine * .285 + sine * .14, .072 - cosine * .072 - sine * .283,
    .213 - cosine * .213 - sine * .787, .715 - cosine * .715 + sine * .715, .072 + cosine * .928 + sine * .072
  ];

  for (let index = 0; index < data.length; index += 4) {
    let red = data[index];
    let green = data[index + 1];
    let blue = data[index + 2];

    if (sepia) {
      const sr = red * .393 + green * .769 + blue * .189;
      const sg = red * .349 + green * .686 + blue * .168;
      const sb = red * .272 + green * .534 + blue * .131;
      red += (sr - red) * sepia;
      green += (sg - green) * sepia;
      blue += (sb - blue) * sepia;
    }

    if (grayscale) {
      const luminance = red * .213 + green * .715 + blue * .072;
      red += (luminance - red) * grayscale;
      green += (luminance - green) * grayscale;
      blue += (luminance - blue) * grayscale;
    }

    if (saturation !== 1) {
      const luminance = red * .213 + green * .715 + blue * .072;
      red = luminance + (red - luminance) * saturation;
      green = luminance + (green - luminance) * saturation;
      blue = luminance + (blue - luminance) * saturation;
    }

    if (hue) {
      const sourceRed = red;
      const sourceGreen = green;
      const sourceBlue = blue;
      red = sourceRed * hueMatrix[0] + sourceGreen * hueMatrix[1] + sourceBlue * hueMatrix[2];
      green = sourceRed * hueMatrix[3] + sourceGreen * hueMatrix[4] + sourceBlue * hueMatrix[5];
      blue = sourceRed * hueMatrix[6] + sourceGreen * hueMatrix[7] + sourceBlue * hueMatrix[8];
    }

    red = ((red - 127.5) * contrast + 127.5) * brightness;
    green = ((green - 127.5) * contrast + 127.5) * brightness;
    blue = ((blue - 127.5) * contrast + 127.5) * brightness;
    red += warmth * 18;
    green += warmth * 3;
    blue -= warmth * 12;
    if (cool) {
      const luminance = red * .213 + green * .715 + blue * .072;
      const shadowBias = .42 + Math.max(0, 1 - luminance / 255) * .58;
      red -= cool * 14 * shadowBias;
      green += cool * 4 * shadowBias;
      blue += cool * 22 * shadowBias;
    }
    red = red * (1 - fade) + 28 * fade;
    green = green * (1 - fade) + 25 * fade;
    blue = blue * (1 - fade) + 22 * fade;

    data[index] = Math.max(0, Math.min(255, red));
    data[index + 1] = Math.max(0, Math.min(255, green));
    data[index + 2] = Math.max(0, Math.min(255, blue));
  }
  ctx.putImageData(image, 0, 0);
}

function applyCoolFaceTone(canvas, faces) {
  if (!faces.length) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const w = canvas.width;
  const h = canvas.height;

  faces.forEach(landmarks => {
    const left = averagePoint(landmarks, [234, 93, 132, 58], w, h);
    const right = averagePoint(landmarks, [454, 323, 361, 288], w, h);
    const forehead = averagePoint(landmarks, [10, 338, 109], w, h);
    const chin = averagePoint(landmarks, [152, 175, 199], w, h);
    const center = { x: (left.x + right.x) / 2, y: (forehead.y + chin.y) / 2 };
    const faceWidth = Math.hypot(right.x - left.x, right.y - left.y) * 1.08;
    const faceHeight = Math.hypot(chin.x - forehead.x, chin.y - forehead.y) * 1.04;
    const angle = Math.atan2(right.y - left.y, right.x - left.x);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const minX = Math.max(0, Math.floor(center.x - faceWidth * .62));
    const maxX = Math.min(w - 1, Math.ceil(center.x + faceWidth * .62));
    const minY = Math.max(0, Math.floor(center.y - faceHeight * .58));
    const maxY = Math.min(h - 1, Math.ceil(center.y + faceHeight * .58));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - center.x;
        const dy = y - center.y;
        const localX = dx * cosine + dy * sine;
        const localY = -dx * sine + dy * cosine;
        const distance = Math.sqrt((localX / (faceWidth * .54)) ** 2 + (localY / (faceHeight * .54)) ** 2);
        if (distance >= 1) continue;

        const feather = Math.min(1, (1 - distance) / .22);
        const index = (y * w + x) * 4;
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const cb = 128 - red * .1687 - green * .3313 + blue * .5;
        const cr = 128 + red * .5 - green * .4187 - blue * .0813;
        const skin = cb > 72 && cb < 145 && cr > 124 && cr < 192 && red > 38 && green > 30 && blue > 22;
        if (!skin) continue;

        const luminance = red * .213 + green * .715 + blue * .072;
        const shadowGuard = Math.min(1, Math.max(0, (luminance - 36) / 76));
        const strength = feather * shadowGuard;
        data[index] = red + (239 - red) * .04 * strength;
        data[index + 1] = green + (248 - green) * .06 * strength;
        data[index + 2] = blue + (255 - blue) * .09 * strength;
      }
    }
  });
  ctx.putImageData(image, 0, 0);
}

function applyDirectFlash(canvas, faces, amount) {
  if (!amount) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const w = canvas.width;
  const h = canvas.height;
  const faceZones = faces.map(landmarks => {
    const left = averagePoint(landmarks, [234, 93, 132, 58], w, h);
    const right = averagePoint(landmarks, [454, 323, 361, 288], w, h);
    const forehead = averagePoint(landmarks, [10, 338, 109], w, h);
    const chin = averagePoint(landmarks, [152, 175, 199], w, h);
    const center = { x: (left.x + right.x) / 2, y: (forehead.y + chin.y) / 2 };
    const angle = Math.atan2(right.y - left.y, right.x - left.x);
    return {
      center,
      radiusX: Math.hypot(right.x - left.x, right.y - left.y) * .56,
      radiusY: Math.hypot(chin.x - forehead.x, chin.y - forehead.y) * .56,
      cosine: Math.cos(angle),
      sine: Math.sin(angle)
    };
  });

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = (y * w + x) * 4;
      let red = data[index];
      let green = data[index + 1];
      let blue = data[index + 2];
      const luminance = red * .213 + green * .715 + blue * .072;
      const shadowWeight = Math.max(0, 1 - luminance / 155);
      const ambientScale = 1 - amount * .055 * shadowWeight;
      const sceneContrast = 1 + amount * .045;
      const baseLift = amount * 2.4;
      let faceMask = 0;

      for (const zone of faceZones) {
        const dx = x - zone.center.x;
        const dy = y - zone.center.y;
        const localX = dx * zone.cosine + dy * zone.sine;
        const localY = -dx * zone.sine + dy * zone.cosine;
        const distance = Math.sqrt((localX / zone.radiusX) ** 2 + (localY / zone.radiusY) ** 2);
        if (distance < 1) faceMask = Math.max(faceMask, Math.min(1, (1 - distance) / .2));
      }

      red = ((red * ambientScale - 127.5) * sceneContrast + 127.5) + baseLift * .96;
      green = ((green * ambientScale - 127.5) * sceneContrast + 127.5) + baseLift;
      blue = ((blue * ambientScale - 127.5) * sceneContrast + 127.5) + baseLift * 1.04;

      if (faceMask) {
        const cb = 128 - red * .1687 - green * .3313 + blue * .5;
        const cr = 128 + red * .5 - green * .4187 - blue * .0813;
        const skin = cb > 72 && cb < 145 && cr > 124 && cr < 192 && red > 38 && green > 30 && blue > 22;
        if (skin) {
          const flash = amount * faceMask;
          const lift = flash * (10 + (1 - luminance / 255) * 28);
          const specular = Math.max(0, (luminance - 145) / 110) * flash * 14;
          red += lift * .95 + specular;
          green += lift + specular;
          blue += lift * 1.045 + specular * 1.02;
        }
      }
      data[index] = Math.max(0, Math.min(255, red));
      data[index + 1] = Math.max(0, Math.min(255, green));
      data[index + 2] = Math.max(0, Math.min(255, blue));
    }
  }
  ctx.putImageData(image, 0, 0);
}

function addHalation(canvas, amount) {
  if (!amount) return;
  const sample = document.createElement('canvas');
  sample.width = 90;
  sample.height = 90;
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  sampleCtx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const image = sampleCtx.getImageData(0, 0, sample.width, sample.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = image.data[index] * .213 + image.data[index + 1] * .715 + image.data[index + 2] * .072;
    const glow = Math.max(0, (luminance - 168) / 87);
    image.data[index] = 255;
    image.data[index + 1] = 78;
    image.data[index + 2] = 34;
    image.data[index + 3] = glow * 170;
  }
  sampleCtx.putImageData(image, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = amount;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sample, -8, -5, canvas.width + 16, canvas.height + 10);
  ctx.restore();
}

function addFilmGrain(canvas, preset) {
  const size = Math.max(420, Math.round(canvas.width * .78));
  const grainCanvas = document.createElement('canvas');
  grainCanvas.width = size;
  grainCanvas.height = size;
  const grainCtx = grainCanvas.getContext('2d');
  const grainImage = grainCtx.createImageData(size, size);
  const monochrome = state.filter === 'mono';

  for (let index = 0; index < grainImage.data.length; index += 4) {
    const base = 128 + (Math.random() - .5) * preset.grain * 2.8;
    const colorNoise = preset.chroma * preset.grain;
    grainImage.data[index] = base + (monochrome ? 0 : (Math.random() - .5) * colorNoise);
    grainImage.data[index + 1] = base + (monochrome ? 0 : (Math.random() - .5) * colorNoise * .7);
    grainImage.data[index + 2] = base + (monochrome ? 0 : (Math.random() - .5) * colorNoise * 1.2);
    grainImage.data[index + 3] = 110 + Math.random() * 90;
  }
  grainCtx.putImageData(grainImage, 0, 0);

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = .25 + preset.grain / 230;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(grainCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let index = 0; index < Math.round(preset.grain * 2.1); index += 1) {
    const radius = Math.random() * 1.35 + .2;
    ctx.globalAlpha = Math.random() * .12;
    ctx.fillStyle = monochrome ? '#f4f1e7' : (Math.random() > .5 ? '#f0c0a0' : '#b5cad0');
    ctx.beginPath();
    ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function applyFilmTexture(canvas) {
  const ctx = canvas.getContext('2d');
  const preset = filters[state.filter];
  const { grain, leak, halation } = preset;

  addHalation(canvas, halation);

  ctx.save();
  const vignette = ctx.createRadialGradient(canvas.width * .5, canvas.height * .46, canvas.width * .16, canvas.width * .5, canvas.height * .5, canvas.width * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(.72, 'rgba(0,0,0,.04)');
  vignette.addColorStop(1, 'rgba(0,0,0,.24)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.filter !== 'mono') {
    const fromLeft = Math.random() > .5;
    const x = fromLeft ? 0 : canvas.width;
    const light = ctx.createRadialGradient(x, canvas.height * (.2 + Math.random() * .6), 0, x, canvas.height * .5, canvas.width * .55);
    light.addColorStop(0, `rgba(232,96,56,${leak})`);
    light.addColorStop(.42, `rgba(255,178,92,${leak * .45})`);
    light.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();

  addFilmGrain(canvas, preset);

  ctx.save();
  ctx.globalAlpha = grain / 360;
  ctx.strokeStyle = 'rgba(255,248,228,.24)';
  ctx.lineWidth = .6;
  const scratches = 1 + Math.floor(Math.random() * 3);
  for (let index = 0; index < scratches; index += 1) {
    const x = Math.random() * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, Math.random() * canvas.height * .3);
    ctx.bezierCurveTo(x + Math.random() * 2, canvas.height * .35, x - Math.random() * 2, canvas.height * .7, x + Math.random() * 2, canvas.height * (.72 + Math.random() * .28));
    ctx.stroke();
  }
  ctx.restore();
}

async function createProcessedPhoto(source) {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const crop = cropSquare(sw, sh);

  ctx.save();
  if (source === video && state.facingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  let detectedFaces = [];
  if (state.faceReady) {
    try {
      const result = state.faceLandmarker.detect(canvas);
      detectedFaces = result.faceLandmarks || [];
      if (state.eyes || state.nose || state.jaw || state.face) {
        detectedFaces.forEach(landmarks => applyFaceShape(canvas, landmarks));
      }
    } catch (error) {
      console.warn('Face retouch skipped', error);
    }
  }

  softenSkin(canvas);
  const filtered = document.createElement('canvas');
  filtered.width = canvas.width;
  filtered.height = canvas.height;
  const fctx = filtered.getContext('2d');
  fctx.drawImage(canvas, 0, 0);
  applyColorGrade(filtered, filters[state.filter]);
  applyDirectFlash(filtered, detectedFaces, filters[state.filter].flash);
  applyCoolFaceTone(filtered, detectedFaces);
  applyFilmTexture(filtered);
  return filtered.toDataURL('image/jpeg', .94);
}

async function capturePhoto() {
  if (state.busy || !state.stream || state.photos.length >= 4) return;
  state.busy = true;
  shutter.disabled = true;
  await runCountdown();
  flash.classList.add('active');
  playShutterSound();
  const photo = await createProcessedPhoto(video);
  await wait(120);
  flash.classList.remove('active');
  state.photos.push(photo);
  updateContactSheet();
  state.busy = false;
  shutter.disabled = state.photos.length >= 4;
  if (state.photos.length === 4) finishCapture();
}

function updateContactSheet() {
  $$('.thumb', contactSheet).forEach((thumb, index) => {
    thumb.innerHTML = '';
    if (state.photos[index]) {
      const img = new Image();
      img.src = state.photos[index];
      img.alt = `Shot ${index + 1}`;
      thumb.append(img);
      thumb.classList.remove('empty');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'thumb-remove';
      remove.ariaLabel = `Remove shot ${index + 1}`;
      remove.textContent = '×';
      remove.addEventListener('click', () => removePhoto(index));
      thumb.append(remove);
    } else {
      thumb.classList.add('empty');
      thumb.innerHTML = `<span>0${index + 1}</span>`;
    }
  });
  $('#shotNumber').textContent = String(Math.min(state.photos.length + 1, 4)).padStart(2, '0');
}

function removePhoto(index) {
  state.photos.splice(index, 1);
  updateContactSheet();
  studio.hidden = true;
  shutter.disabled = !state.stream;
  $('#cameraHint').textContent = `${4 - state.photos.length} LEFT`;
}

function finishCapture() {
  $('#cameraHint').textContent = 'DONE';
  studio.hidden = false;
  renderResult();
  setTimeout(() => studio.scrollIntoView({ behavior: 'smooth', block: 'start' }), 160);
}

async function loadFiles(files) {
  const selected = [...files].filter(file => file.type.startsWith('image/')).slice(0, 4 - state.photos.length);
  if (!selected.length) return;
  state.busy = true;
  for (const file of selected) {
    const url = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    state.photos.push(await createProcessedPhoto(image));
    URL.revokeObjectURL(url);
  }
  state.busy = false;
  updateContactSheet();
  $('#photoUpload').value = '';
  if (state.photos.length === 4) finishCapture();
  else toast(`${4 - state.photos.length} MORE`);
}

function drawCover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sw = width / scale;
  const sh = height / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, width, height);
}

function roughEdge(ctx, x, y, width, height, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.globalAlpha = .8;
  for (let pass = 0; pass < 4; pass += 1) {
    const jitter = () => (Math.random() - .5) * 5;
    ctx.strokeRect(x + jitter(), y + jitter(), width + jitter(), height + jitter());
  }
  ctx.restore();
}

async function renderResult() {
  if (state.photos.length < 4) return;
  const images = await Promise.all(state.photos.map(src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = src;
  })));
  const ctx = resultCanvas.getContext('2d');

  if (state.frame === 'strip') {
    resultCanvas.width = 620;
    resultCanvas.height = 1720;
    ctx.fillStyle = '#e5e1d6';
    ctx.fillRect(0, 0, 620, 1720);
    images.forEach((image, index) => drawCover(ctx, image, 45, 44 + index * 392, 530, 382));
    roughEdge(ctx, 42, 41, 536, 1574, '#292927');
    ctx.fillStyle = '#1a1a19';
    ctx.font = '500 27px Arial';
    ctx.fillText('45', 45, 1662);
    ctx.font = '12px monospace';
    ctx.fillText('ID / 04 EXP', 92, 1661);
  } else if (state.frame === 'noir') {
    resultCanvas.width = 1000;
    resultCanvas.height = 1180;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, 1000, 1180);
    const gap = 7;
    const pad = 36;
    const width = (1000 - pad * 2 - gap) / 2;
    images.forEach((image, index) => drawCover(ctx, image, pad + (index % 2) * (width + gap), pad + Math.floor(index / 2) * (548 + gap), width, 548));
    ctx.fillStyle = '#ddd8cc';
    ctx.font = '10px monospace';
    ctx.fillText('04 / 45 ID', 36, 1161);
  } else {
    resultCanvas.width = 1000;
    resultCanvas.height = 1320;
    ctx.fillStyle = '#dedad0';
    ctx.fillRect(0, 0, 1000, 1320);
    const pad = 72;
    const gap = 10;
    const width = (1000 - pad * 2 - gap) / 2;
    images.forEach((image, index) => drawCover(ctx, image, pad + (index % 2) * (width + gap), 82 + Math.floor(index / 2) * (500 + gap), width, 500));
    roughEdge(ctx, 65, 75, 870, 1018, '#252422');
    ctx.fillStyle = '#22211f';
    ctx.font = '900 76px Arial';
    ctx.fillText('45', 735, 1240);
    ctx.font = '500 21px monospace';
    ctx.fillText('ID', 846, 1210);
    ctx.font = '11px monospace';
    ctx.fillText('04 EXP / PROCESS C-41', 72, 1261);
  }
}

function resetAll() {
  state.photos = [];
  updateContactSheet();
  studio.hidden = true;
  shutter.disabled = !state.stream;
  $('#cameraHint').textContent = '3 SEC';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function shareResult() {
  resultCanvas.toBlob(async blob => {
    const file = new File([blob], `45-id-${Date.now()}.png`, { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) return toast('SAVE FIRST');
    try { await navigator.share({ title: '45 ID', files: [file] }); }
    catch (error) { if (error.name !== 'AbortError') toast('SHARE FAILED'); }
  }, 'image/png');
}

$('#startCamera').addEventListener('click', startCamera);
shutter.addEventListener('click', capturePhoto);
$('#flipCamera').addEventListener('click', async () => {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  await startCamera();
});
$('#uploadButton').addEventListener('click', () => $('#photoUpload').click());
$('#photoUpload').addEventListener('change', event => loadFiles(event.target.files));
$('#soundButton').addEventListener('click', event => {
  state.sound = !state.sound;
  event.currentTarget.setAttribute('aria-pressed', state.sound);
  event.currentTarget.classList.toggle('muted', !state.sound);
});

$$('.film').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  $$('.film').forEach(item => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', item === button);
  });
  updateLiveFilter();
}));

[
  ['eyeRange', 'eyeValue', 'eyes'],
  ['noseRange', 'noseValue', 'nose'],
  ['jawRange', 'jawValue', 'jaw'],
  ['faceRange', 'faceValue', 'face'],
  ['skinRange', 'skinValue', 'skin']
].forEach(([rangeId, outputId, key]) => {
  $(`#${rangeId}`).addEventListener('input', event => {
    state[key] = Number(event.target.value);
    $(`#${outputId}`).value = state[key];
  });
});

$$('.frame').forEach(button => button.addEventListener('click', () => {
  state.frame = button.dataset.frame;
  $$('.frame').forEach(item => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', item === button);
  });
  renderResult();
}));

$('#restartButton').addEventListener('click', resetAll);
$('#shareButton').addEventListener('click', shareResult);
$('#downloadButton').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `45-id-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
  toast('SAVED');
});

updateLiveFilter();
window.addEventListener('beforeunload', stopCamera);
initFaceModel();
