// ============================================
// MEME SOUNDBOARD — FIREBASE EDITION (Firestore-Only)
// Audio stored as base64 data URLs in Firestore docs
// Supports video upload with audio extraction + waveform trimming
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, addDoc, onSnapshot, doc, deleteDoc, updateDoc,
  query, orderBy, serverTimestamp, getDoc, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================
// 🔑 FIREBASE CONFIGURATION
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyCQMeT5Qv3mJLFryqzHUN0XDSFbuoCz5fc",
  authDomain: "university-blog-site.firebaseapp.com",
  projectId: "university-blog-site",
  storageBucket: "university-blog-site.firebasestorage.app",
  messagingSenderId: "228884205086",
  appId: "1:228884205086:web:f5a84dc315f6ab948ba80f",
  measurementId: "G-SJKM044GJQ"
};

const ADMIN_UID = "Db3uryElkEdX90GlEHsyhOMugD43";

// ============================================
// CONSTANTS
// ============================================
const MAX_AUDIO_FILE_SIZE = 700 * 1024;    // 700 KB for direct audio
const MAX_VIDEO_FILE_SIZE = 50 * 1024 * 1024; // 50 MB for video (audio will be extracted & trimmed)
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.flac'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.3gp', '.m4v'];
const ALL_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS];

const GRADIENTS = [
  { colors: ['#a855f7', '#ec4899'], rgb: [168, 85, 247] },
  { colors: ['#06b6d4', '#3b82f6'], rgb: [6, 182, 212] },
  { colors: ['#22c55e', '#06b6d4'], rgb: [34, 197, 94] },
  { colors: ['#f59e0b', '#ef4444'], rgb: [245, 158, 11] },
  { colors: ['#ec4899', '#f43f5e'], rgb: [236, 72, 153] },
  { colors: ['#8b5cf6', '#6366f1'], rgb: [139, 92, 246] },
  { colors: ['#14b8a6', '#0ea5e9'], rgb: [20, 184, 166] },
  { colors: ['#f97316', '#eab308'], rgb: [249, 115, 22] },
  { colors: ['#e11d48', '#be185d'], rgb: [225, 29, 72] },
  { colors: ['#7c3aed', '#2563eb'], rgb: [124, 58, 237] },
];

// ============================================
// STATE
// ============================================
const state = {
  sounds: [],
  activeAudios: new Map(),
  selectedFile: null,
  selectedThumbFile: null,
  editSelectedThumbFile: null,
  isUploading: false,
  currentUser: null,
  isAdmin: false,
  // Waveform state
  audioBuffer: null,
  audioContext: null,
  trimStart: 0,       // 0.0 - 1.0 (fraction of total duration)
  trimEnd: 1,         // 0.0 - 1.0
  previewSource: null, // currently playing AudioBufferSourceNode
  isPlaying: false,
  playheadRAF: null,
  currentFilter: 'all',
};

// ============================================
// FIREBASE INITIALIZATION
// ============================================
let db, auth, firebaseReady = false;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;
} catch (err) {
  console.warn('Firebase init:', err.message);
}

const $ = (s) => document.querySelector(s);

// ============================================
// AUTHENTICATION
// ============================================
async function handleLogin() {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    if (result.user) showToast("Signed in as " + (result.user.displayName || result.user.email), "success");
    const loginPage = $('#loginPage');
    if (loginPage) loginPage.classList.remove('show');
  } catch (error) {
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
    console.error("Login failed:", error);
    showToast("Login failed: " + error.message, "error");
  }
}

async function handleLogout() {
  try { await signOut(auth); showToast("Signed out", "info"); } catch (e) { console.error(e); }
}

function initAuthListener() {
  if (!firebaseReady) return;
  onAuthStateChanged(auth, (user) => {
    state.currentUser = user;
    state.isAdmin = user && user.uid === ADMIN_UID;
    const loginBtn = $('#loginBtn'), userProfile = $('#userProfile'),
      userAvatar = $('#userAvatar'), userNameEl = $('#userName'),
      uploadBtn = $('#openUpload'), loginPage = $('#loginPage');
    if (user) {
      if (loginPage) loginPage.classList.remove('show');
      if (loginBtn) loginBtn.style.display = 'none';
      if (userProfile) userProfile.style.display = 'flex';
      const name = user.displayName || user.email.split('@')[0];
      if (userAvatar) userAvatar.textContent = name.charAt(0).toUpperCase();
      if (userNameEl) userNameEl.textContent = name;
      if (uploadBtn) { uploadBtn.style.opacity = '1'; uploadBtn.style.pointerEvents = 'auto'; uploadBtn.title = "Upload a new sound"; }
      if ($('#filterFavorites')) $('#filterFavorites').style.display = 'flex';
      if ($('#filterMyUploads')) $('#filterMyUploads').style.display = 'flex';
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (userProfile) userProfile.style.display = 'none';
      if (uploadBtn) { uploadBtn.style.opacity = '0.5'; uploadBtn.style.pointerEvents = 'none'; uploadBtn.title = "Login to upload"; }
      if ($('#filterFavorites')) $('#filterFavorites').style.display = 'none';
      if ($('#filterMyUploads')) $('#filterMyUploads').style.display = 'none';
      if (['favorites', 'my_uploads'].includes(state.currentFilter)) window.setFilter('all');
    }
    renderSounds();
  });
}

// ============================================
// TOAST
// ============================================
function showToast(message, type = 'success', duration = 4000) {
  const container = $('#toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const iconMap = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  toast.innerHTML = `<i class="fa-solid ${iconMap[type] || iconMap.info}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  const timer = setTimeout(() => dismissToast(toast), duration);
  toast.addEventListener('click', () => { clearTimeout(timer); dismissToast(toast); });
}
function dismissToast(toast) {
  toast.classList.remove('show');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 500);
}

// ============================================
// UTILITIES
// ============================================
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function hashString(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return Math.abs(h); }
function formatFileSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / 1048576).toFixed(1) + ' MB'; }
function getGradient(id) { return GRADIENTS[hashString(id) % GRADIENTS.length]; }
function fileToBase64(file) { return new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => j(new Error('Read failed')); fr.readAsDataURL(file); }); }
function getFileExt(name) { return '.' + name.split('.').pop().toLowerCase(); }
function isVideoFile(file) { return file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(getFileExt(file.name)); }
function isAudioFile(file) { return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(getFileExt(file.name)); }
function isMediaFile(file) { return isVideoFile(file) || isAudioFile(file); }

// ============================================
// AUDIO ENGINE (Playback)
// ============================================
function playSound(docId, dataUrl) {
  if (state.activeAudios.has(docId)) {
    const existing = state.activeAudios.get(docId);
    existing.pause(); existing.currentTime = 0; existing.play().catch(() => {});
    pulseCard(docId); return;
  }
  const audio = new Audio(dataUrl);
  audio.volume = 0.8;
  state.activeAudios.set(docId, audio);
  setCardPlaying(docId, true);
  audio.play().catch((e) => { state.activeAudios.delete(docId); setCardPlaying(docId, false); showToast('Could not play sound', 'error'); });
  audio.addEventListener('ended', () => { state.activeAudios.delete(docId); setCardPlaying(docId, false); }, { once: true });
  audio.addEventListener('error', () => { state.activeAudios.delete(docId); setCardPlaying(docId, false); }, { once: true });
}
function stopAll() { state.activeAudios.forEach((a, id) => { a.pause(); a.currentTime = 0; setCardPlaying(id, false); }); state.activeAudios.clear(); }
function setCardPlaying(docId, playing) { const c = document.querySelector(`.sound-card[data-id="${docId}"]`); if (c) c.classList.toggle('playing', playing); }
function pulseCard(docId) { const c = document.querySelector(`.sound-card[data-id="${docId}"]`); if (!c) return; c.style.transform = 'scale(0.93)'; setTimeout(() => { c.style.transform = ''; }, 120); }

// ============================================
// WAVEFORM ENGINE (Web Audio API)
// ============================================
function getAudioContext() {
  if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return state.audioContext;
}

async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  return await ctx.decodeAudioData(arrayBuffer);
}

async function extractAudioFromVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(file);
    video.src = url;

    video.addEventListener('loadedmetadata', async () => {
      try {
        const ctx = getAudioContext();
        const duration = video.duration;
        if (duration > 600) { // 10 min max
          URL.revokeObjectURL(url);
          reject(new Error('Video too long (max 10 minutes)'));
          return;
        }

        // Use OfflineAudioContext to extract audio
        const sampleRate = 44100;
        const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
        
        // Create a MediaElementSourceNode from the video
        // We need to use a different approach: read the file as ArrayBuffer and decode
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        URL.revokeObjectURL(url);
        resolve(audioBuffer);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    });
  });
}

function drawWaveform(audioBuffer, canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const mid = height / 2;

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Draw dimmed regions (outside trim)
  const trimStartPx = state.trimStart * width;
  const trimEndPx = state.trimEnd * width;

  // Draw full waveform first (dimmed)
  ctx.fillStyle = 'rgba(100, 100, 120, 0.3)';
  for (let i = 0; i < width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const val = data[(i * step) + j] || 0;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const barHeight = Math.max((max - min) * mid, 1);
    const y = mid + min * mid;
    ctx.fillRect(i, y, 1, barHeight);
  }

  // Draw selected region (bright gradient)
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#a855f7');
  gradient.addColorStop(0.5, '#ec4899');
  gradient.addColorStop(1, '#a855f7');
  ctx.fillStyle = gradient;

  for (let i = Math.floor(trimStartPx); i < Math.ceil(trimEndPx); i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const val = data[(i * step) + j] || 0;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const barHeight = Math.max((max - min) * mid, 1);
    const y = mid + min * mid;
    ctx.fillRect(i, y, 1, barHeight);
  }

  // Draw center line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  // Update trim region overlay
  updateTrimRegion();
}

function updateTrimRegion() {
  const container = document.querySelector('.waveform-container');
  const region = $('#trimRegion');
  if (!container || !region) return;
  const width = container.offsetWidth;
  const left = state.trimStart * width;
  const right = state.trimEnd * width;
  region.style.left = left + 'px';
  region.style.width = (right - left) + 'px';

  // Update time display
  if (state.audioBuffer) {
    const dur = state.audioBuffer.duration;
    const startTime = state.trimStart * dur;
    const endTime = state.trimEnd * dur;
    const trimDur = endTime - startTime;
    const startEl = $('#trimStartTime'), endEl = $('#trimEndTime'), durEl = $('#trimDuration');
    if (startEl) startEl.textContent = startTime.toFixed(1) + 's';
    if (endEl) endEl.textContent = endTime.toFixed(1) + 's';
    if (durEl) durEl.textContent = trimDur.toFixed(1);
  }
}

// ============================================
// TRIM HANDLE DRAGGING
// ============================================
function initTrimHandles() {
  const container = document.querySelector('.waveform-container');
  const leftHandle = $('#trimHandleLeft');
  const rightHandle = $('#trimHandleRight');
  if (!container || !leftHandle || !rightHandle) return;

  function startDrag(handle, isLeft) {
    return function onDown(e) {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const width = rect.width;

      function onMove(ev) {
        const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
        let fraction = (clientX - rect.left) / width;
        fraction = Math.max(0, Math.min(1, fraction));

        if (isLeft) {
          state.trimStart = Math.min(fraction, state.trimEnd - 0.01);
        } else {
          state.trimEnd = Math.max(fraction, state.trimStart + 0.01);
        }

        // Redraw waveform
        const canvas = $('#waveformCanvas');
        if (canvas && state.audioBuffer) drawWaveform(state.audioBuffer, canvas);
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
  }

  leftHandle.addEventListener('mousedown', startDrag(leftHandle, true));
  leftHandle.addEventListener('touchstart', startDrag(leftHandle, true), { passive: false });
  rightHandle.addEventListener('mousedown', startDrag(rightHandle, false));
  rightHandle.addEventListener('touchstart', startDrag(rightHandle, false), { passive: false });
}

// ============================================
// PREVIEW PLAYBACK (trimmed region)
// ============================================
function playPreview() {
  if (!state.audioBuffer) return;
  
  // If already playing, stop
  if (state.isPlaying) {
    stopPreview();
    return;
  }

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();

  const source = ctx.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(ctx.destination);

  const dur = state.audioBuffer.duration;
  const startTime = state.trimStart * dur;
  const endTime = state.trimEnd * dur;
  const playDuration = endTime - startTime;

  state.previewSource = source;
  state.isPlaying = true;

  // Update button icon
  const icon = $('#previewIcon');
  if (icon) { icon.classList.remove('fa-play'); icon.classList.add('fa-stop'); }

  // Animate playhead
  const playhead = $('#playhead');
  const container = document.querySelector('.waveform-container');
  if (playhead && container) {
    playhead.style.display = 'block';
    const containerWidth = container.offsetWidth;
    const playStartPx = state.trimStart * containerWidth;
    const playEndPx = state.trimEnd * containerWidth;
    const startMs = performance.now();

    function animatePlayhead() {
      const elapsed = (performance.now() - startMs) / 1000;
      const fraction = elapsed / playDuration;
      if (fraction >= 1) {
        playhead.style.display = 'none';
        return;
      }
      const pxPos = playStartPx + (playEndPx - playStartPx) * fraction;
      playhead.style.left = pxPos + 'px';
      state.playheadRAF = requestAnimationFrame(animatePlayhead);
    }
    animatePlayhead();
  }

  source.start(0, startTime, playDuration);
  source.addEventListener('ended', () => stopPreview(), { once: true });
}

function stopPreview() {
  if (state.previewSource) {
    try { state.previewSource.stop(); } catch (e) { /* already stopped */ }
    state.previewSource = null;
  }
  state.isPlaying = false;
  if (state.playheadRAF) cancelAnimationFrame(state.playheadRAF);
  const playhead = $('#playhead');
  if (playhead) playhead.style.display = 'none';
  const icon = $('#previewIcon');
  if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-play'); }
}

// ============================================
// EXPORT TRIMMED AUDIO AS WAV BASE64
// ============================================
function exportTrimmedWav(audioBuffer, trimStartFrac, trimEndFrac) {
  const originalSampleRate = audioBuffer.sampleRate;
  const targetSampleRate = 16000; // Downsample to 16 kHz for much smaller files
  const ratio = originalSampleRate / targetSampleRate;
  const startSample = Math.floor(trimStartFrac * audioBuffer.length);
  const endSample = Math.floor(trimEndFrac * audioBuffer.length);
  const originalNumSamples = endSample - startSample;
  const numSamples = Math.floor(originalNumSamples / ratio);
  const numChannels = 1; // mono
  const bitsPerSample = 16;
  const byteRate = targetSampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write samples (mix all channels to mono)
  const channelData = [];
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    // Map output sample index back to original buffer position (linear interpolation)
    const srcPos = startSample + i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;
    let sample = 0;
    for (let ch = 0; ch < channelData.length; ch++) {
      const s0 = channelData[ch][srcIndex] || 0;
      const s1 = channelData[ch][Math.min(srcIndex + 1, channelData[ch].length - 1)] || 0;
      sample += s0 + (s1 - s0) * frac; // Linear interpolation
    }
    sample /= channelData.length;
    // Clamp
    sample = Math.max(-1, Math.min(1, sample));
    const s16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, s16, true);
    offset += 2;
  }

  // Convert to base64 data URL
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ============================================
// IMAGE RESIZING
// ============================================
function resizeImage(file, maxSize = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
        else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================
// FILE VALIDATION
// ============================================
function validateMediaFile(file) {
  if (!file) return { valid: false, error: 'No file selected.' };
  // Check MIME type first (works better on mobile), then fall back to extension
  if (!isMediaFile(file)) {
    const ext = getFileExt(file.name);
    return { valid: false, error: `Unsupported file type. Please select an audio or video file.` };
  }
  const maxSize = isVideoFile(file) ? MAX_VIDEO_FILE_SIZE : MAX_AUDIO_FILE_SIZE;
  if (!isVideoFile(file) && file.size > maxSize) {
    return { valid: false, error: `Audio file too large (${formatFileSize(file.size)}). Max is 700 KB. Try a video file instead — audio will be extracted and trimmed.` };
  }
  if (isVideoFile(file) && file.size > maxSize) {
    return { valid: false, error: `Video too large (${formatFileSize(file.size)}). Max is 50 MB.` };
  }
  return { valid: true };
}
function validateImageFile(file) { if (!file) return { valid: false, error: 'No image.' }; if (!file.type.startsWith('image/')) return { valid: false, error: 'Must be an image.' }; return { valid: true }; }

// ============================================
// UPLOAD SYSTEM
// ============================================
async function uploadSound() {
  if (state.isUploading) return;
  if (!state.currentUser) { showToast('Please login first', 'warning'); return; }
  const name = $('#soundName').value.trim();
  if (!name) { showToast('Please enter a sound name', 'warning'); return; }
  if (!state.audioBuffer && !state.selectedFile) { showToast('Please select a file', 'warning'); return; }

  state.isUploading = true;
  setUploadLoadingState(true);
  showProgress(true);
  try {
    updateProgress(20);
    let audioBase64;

    if (state.audioBuffer) {
      // We have a decoded audio buffer — export the trimmed region as WAV
      showToast('Encoding trimmed audio...', 'info');
      audioBase64 = await exportTrimmedWav(state.audioBuffer, state.trimStart, state.trimEnd);
    } else {
      // Direct audio file
      audioBase64 = await fileToBase64(state.selectedFile);
    }

    updateProgress(50);
    
    // Check final size (base64 is ~1.33x raw, Firestore limit is 1MB per doc)
    const estimatedSize = audioBase64.length;
    if (estimatedSize > 900000) {
      showToast('Trimmed audio too large. Please trim a shorter section.', 'warning');
      return;
    }

    let thumbnailBase64 = null;
    if (state.selectedThumbFile) {
      thumbnailBase64 = await resizeImage(state.selectedThumbFile, 400);
    }
    updateProgress(80);
    const docData = { name, audioData: audioBase64, userId: state.currentUser.uid, createdAt: serverTimestamp() };
    if (thumbnailBase64) docData.thumbnailData = thumbnailBase64;
    await addDoc(collection(db, 'sounds'), docData);
    updateProgress(100);
    showToast(`"${name}" uploaded!`, 'success');
    closeModal();
  } catch (error) {
    console.error('Upload failed:', error);
    showToast('Upload failed: ' + error.message, 'error');
  } finally {
    state.isUploading = false;
    setUploadLoadingState(false);
    showProgress(false);
  }
}

function setUploadLoadingState(loading) { const btn = $('#submitUpload'); if (btn) { btn.disabled = loading; btn.classList.toggle('loading', loading); } }
function showProgress(show) { const el = $('#progressContainer'); if (el) el.style.display = show ? 'block' : 'none'; }
function updateProgress(pct) { const bar = $('#progressBar'); const text = $('#progressText'); if (bar) bar.style.width = pct + '%'; if (text) text.textContent = pct + '%'; }

// ============================================
// MODALS
// ============================================
function openModal() {
  if (!state.currentUser) { showToast('Please login first', 'warning'); const p = $('#loginPage'); if (p) p.classList.add('show'); return; }
  resetModalForm();
  $('#uploadModal').classList.add('show');
}
function closeModal() {
  stopPreview();
  const modal = $('#uploadModal');
  if (modal) modal.classList.remove('show');
}

function resetModalForm() {
  const nameInput = $('#soundName');
  if (nameInput) nameInput.value = '';
  const charCount = $('#charCount');
  if (charCount) charCount.textContent = '0';
  state.selectedFile = null;
  state.selectedThumbFile = null;
  state.audioBuffer = null;
  state.trimStart = 0;
  state.trimEnd = 1;
  stopPreview();
  const fileInfo = $('#fileInfo'), dropZone = $('#dropZone'), thumbInfo = $('#thumbInfo'),
    thumbDropZone = $('#thumbDropZone'), waveformEditor = $('#waveformEditor');
  if (fileInfo) fileInfo.style.display = 'none';
  if (dropZone) dropZone.style.display = 'flex';
  if (thumbInfo) thumbInfo.style.display = 'none';
  if (thumbDropZone) thumbDropZone.style.display = 'flex';
  if (waveformEditor) waveformEditor.style.display = 'none';
}

async function handleFileSelect(file) {
  if (!file) return;
  const validation = validateMediaFile(file);
  if (!validation.valid) { showToast(validation.error, 'warning'); return; }

  state.selectedFile = file;
  const dropZone = $('#dropZone'), fileInfo = $('#fileInfo'),
    fileName = $('#fileName'), fileSize = $('#fileSize');
  if (dropZone) dropZone.style.display = 'none';
  if (fileInfo) fileInfo.style.display = 'flex';
  if (fileName) fileName.textContent = file.name;
  if (fileSize) fileSize.textContent = formatFileSize(file.size);

  // Decode audio for waveform
  try {
    showToast('Decoding audio...', 'info');
    let audioBuffer;
    if (isVideoFile(file)) {
      audioBuffer = await extractAudioFromVideo(file);
    } else {
      audioBuffer = await decodeAudioFile(file);
    }
    state.audioBuffer = audioBuffer;
    state.trimStart = 0;
    state.trimEnd = Math.min(1, 30 / audioBuffer.duration); // Default: first 30 seconds or full
    if (audioBuffer.duration <= 30) state.trimEnd = 1;

    // Show waveform editor
    const editor = $('#waveformEditor');
    if (editor) editor.style.display = 'block';
    const canvas = $('#waveformCanvas');
    if (canvas) {
      // Small delay to let CSS render
      requestAnimationFrame(() => {
        drawWaveform(audioBuffer, canvas);
      });
    }
    const dur = audioBuffer.duration;
    showToast(`Audio loaded: ${dur.toFixed(1)}s`, 'success');
  } catch (err) {
    console.error('Decode error:', err);
    showToast('Failed to decode audio: ' + err.message, 'error');
    // Still allow upload if it's a small audio file
    if (!isVideoFile(file)) {
      state.audioBuffer = null;
      const editor = $('#waveformEditor');
      if (editor) editor.style.display = 'none';
    }
  }
}

function handleThumbSelect(file) {
  if (!file) return;
  const validation = validateImageFile(file);
  if (!validation.valid) { showToast(validation.error, 'warning'); return; }
  state.selectedThumbFile = file;
  const thumbDropZone = $('#thumbDropZone'), thumbInfo = $('#thumbInfo'),
    thumbName = $('#thumbName'), thumbSize = $('#thumbSize');
  if (thumbDropZone) thumbDropZone.style.display = 'none';
  if (thumbInfo) thumbInfo.style.display = 'flex';
  if (thumbName) thumbName.textContent = file.name;
  if (thumbSize) thumbSize.textContent = formatFileSize(file.size);
  const reader = new FileReader();
  reader.onload = (e) => { const p = $('#thumbPreview'); if (p) p.src = e.target.result; };
  reader.readAsDataURL(file);
}

// ============================================
// EDIT SYSTEM
// ============================================
function openEditModal(soundId) {
  const sound = state.sounds.find(s => s.id === soundId);
  if (!sound) return;
  const nameInput = $('#editSoundName'), idInput = $('#editSoundId');
  if (nameInput) nameInput.value = sound.name;
  if (idInput) idInput.value = soundId;
  state.editSelectedThumbFile = null;
  const editThumbInfo = $('#editThumbInfo'), editThumbDropZone = $('#editThumbDropZone');
  if (editThumbInfo) editThumbInfo.style.display = 'none';
  if (editThumbDropZone) editThumbDropZone.style.display = 'flex';
  $('#editModal').classList.add('show');
}

async function submitEdit() {
  const soundId = $('#editSoundId').value;
  const newName = $('#editSoundName').value.trim();
  if (!soundId || !newName) { showToast('Name is required', 'warning'); return; }
  const btn = $('#submitEdit');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  const progressEl = $('#editProgressContainer');
  if (progressEl) progressEl.style.display = 'block';
  try {
    const updateData = { name: newName };
    if (state.editSelectedThumbFile) { updateData.thumbnailData = await resizeImage(state.editSelectedThumbFile, 400); }
    await updateDoc(doc(db, 'sounds', soundId), updateData);
    showToast('Sound updated!', 'success');
    closeEditModal();
  } catch (error) { console.error('Edit failed:', error); showToast('Update failed: ' + error.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } if (progressEl) progressEl.style.display = 'none'; }
}
function closeEditModal() { const m = $('#editModal'); if (m) m.classList.remove('show'); }

function handleEditThumbSelect(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Must be an image', 'warning'); return; }
  state.editSelectedThumbFile = file;
  const dz = $('#editThumbDropZone'), info = $('#editThumbInfo'), name = $('#editThumbName');
  if (dz) dz.style.display = 'none';
  if (info) info.style.display = 'flex';
  if (name) name.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => { const p = $('#editThumbPreview'); if (p) p.src = e.target.result; };
  reader.readAsDataURL(file);
}

// ============================================
// LISTENER & RENDERING
// ============================================
function initRealtimeListener() {
  if (!firebaseReady) return;
  const q = query(collection(db, 'sounds'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snapshot) => {
    state.sounds = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSounds();
  });
}

// ============================================
// LOCAL ORDER (localStorage per-user)
// ============================================
function getLocalOrderKey() {
  return 'memeboard_order' + (state.currentUser ? '_' + state.currentUser.uid : '_anon');
}
function loadLocalOrder() {
  try { return JSON.parse(localStorage.getItem(getLocalOrderKey())) || []; } catch { return []; }
}
function saveLocalOrder(ids) {
  try { localStorage.setItem(getLocalOrderKey(), JSON.stringify(ids)); } catch {}
}

function renderSounds() {
  const grid = $('#soundGrid'), loadingState = $('#loadingState'), emptyState = $('#emptyState');
  if (!grid) return;
  if (loadingState) loadingState.style.display = 'none';
  if (state.sounds.length === 0) { grid.style.display = 'none'; if (emptyState) emptyState.style.display = 'flex'; return; }
  if (emptyState) emptyState.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  // Filter sounds
  let displaySounds = [...state.sounds];
  if (state.currentFilter === 'my_uploads' && state.currentUser) {
    displaySounds = displaySounds.filter(s => s.userId === state.currentUser.uid);
  } else if (state.currentFilter === 'favorites' && state.currentUser) {
    displaySounds = displaySounds.filter(s => (s.likes || []).includes(state.currentUser.uid));
  }

  let sorted;

  if (state.currentFilter === 'all') {
    // Use saved local order; new sounds go to top, removed sounds are pruned
    const savedOrder = loadLocalOrder();
    const soundMap = new Map(displaySounds.map(s => [s.id, s]));
    const ordered = [];
    savedOrder.forEach(id => { if (soundMap.has(id)) { ordered.push(soundMap.get(id)); soundMap.delete(id); } });
    // Add any remaining sounds that weren't in the saved order
    const newSounds = [...soundMap.values()].sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.seconds : 0;
      const bTime = b.createdAt ? b.createdAt.seconds : 0;
      return bTime - aTime;
    });
    sorted = [...newSounds, ...ordered];
    saveLocalOrder(sorted.map(s => s.id));
  } else if (state.currentFilter === 'new' || state.currentFilter === 'my_uploads' || state.currentFilter === 'favorites') {
    sorted = displaySounds.sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.seconds : 0;
      const bTime = b.createdAt ? b.createdAt.seconds : 0;
      return bTime - aTime;
    });
  } else if (state.currentFilter === 'most_liked') {
    sorted = displaySounds.sort((a, b) => (b.likes || []).length - (a.likes || []).length);
  } else if (state.currentFilter === 'trending') {
    const now = Date.now() / 1000;
    sorted = displaySounds.sort((a, b) => {
      const getScore = (s) => {
        const likes = (s.likes || []).length;
        const ageDays = Math.max(1, (now - (s.createdAt ? s.createdAt.seconds : now)) / 86400);
        return likes / ageDays;
      };
      return getScore(b) - getScore(a);
    });
  }

  // Update count indicator based on active filter list
  const countEl = $('#soundCount');
  if (countEl) countEl.innerHTML = `<i class="fa-solid fa-music"></i> ${sorted.length} sound${sorted.length === 1 ? '' : 's'}`;

  sorted.forEach(sound => {
    const gradient = getGradient(sound.id);
    const canEdit = state.isAdmin || (state.currentUser && state.currentUser.uid === sound.userId);
    const likeCount = (sound.likes || []).length;
    const isLiked = state.currentUser && (sound.likes || []).includes(state.currentUser.uid);
    const card = document.createElement('div');
    card.className = 'sound-card'; card.dataset.id = sound.id;
    if (state.currentFilter === 'all') card.setAttribute('draggable', 'true');
    card.style.setProperty('--card-color-1', gradient.colors[0]);
    card.style.setProperty('--card-color-2', gradient.colors[1]);
    let visual = `<div class="card-icon" style="background:linear-gradient(135deg,${gradient.colors[0]},${gradient.colors[1]})"><i class="fa-solid fa-play"></i></div>`;
    if (sound.thumbnailData) visual = `<img src="${sound.thumbnailData}" class="card-thumbnail">`;
    card.innerHTML = `
      <div class="card-actions">
        <button class="btn-like ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation(); toggleLike('${sound.id}');" title="Like">
          <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
          ${likeCount > 0 ? `<span class="like-count">${likeCount}</span>` : ''}
        </button>
        ${canEdit ? `<button onclick="event.stopPropagation(); editSound('${sound.id}');" title="Edit"><i class="fa-solid fa-pencil"></i></button>
        <button onclick="event.stopPropagation(); deleteSound('${sound.id}');" title="Delete"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
      ${visual}
      <div class="card-title">${escapeHtml(sound.name)}</div>
    `;
    card.addEventListener('click', () => playSound(sound.id, sound.audioData));
    grid.appendChild(card);
  });

  // Attach drag-and-drop handlers ONLY if in 'all' view
  if (state.currentFilter === 'all') {
    initGridDragAndDrop(grid);
  }
}

// ============================================
// DRAG & DROP REORDERING
// ============================================
function initGridDragAndDrop(grid) {
  let dragCard = null;
  let dragGhost = null;
  let longPressTimer = null;
  let touchDragging = false;
  let placeholder = null;

  // --- MOUSE DRAG (HTML5 Drag API) ---
  grid.querySelectorAll('.sound-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragCard = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
      // Make drag image semi-transparent
      setTimeout(() => card.style.opacity = '0.4', 0);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '';
      removePlaceholder();
      dragCard = null;
      saveGridOrder(grid);
    });

    // --- TOUCH DRAG (long-press to start) ---
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      longPressTimer = setTimeout(() => {
        e.preventDefault();
        touchDragging = true;
        dragCard = card;
        card.classList.add('dragging');

        // Create floating ghost
        const rect = card.getBoundingClientRect();
        dragGhost = card.cloneNode(true);
        dragGhost.classList.add('drag-ghost');
        dragGhost.style.width = rect.width + 'px';
        dragGhost.style.height = rect.height + 'px';
        dragGhost.style.left = rect.left + 'px';
        dragGhost.style.top = rect.top + 'px';
        document.body.appendChild(dragGhost);

        // Vibrate feedback on mobile
        if (navigator.vibrate) navigator.vibrate(30);
      }, 400);
    }, { passive: false });

    card.addEventListener('touchmove', (e) => {
      if (longPressTimer && !touchDragging) { clearTimeout(longPressTimer); longPressTimer = null; return; }
      if (!touchDragging || !dragCard) return;
      e.preventDefault();
      const touch = e.touches[0];

      // Move ghost
      if (dragGhost) {
        dragGhost.style.left = (touch.clientX - dragGhost.offsetWidth / 2) + 'px';
        dragGhost.style.top = (touch.clientY - dragGhost.offsetHeight / 2) + 'px';
      }

      // Find card under finger
      const target = getCardUnderPoint(grid, touch.clientX, touch.clientY);
      if (target && target !== dragCard) {
        const targetRect = target.getBoundingClientRect();
        const midX = targetRect.left + targetRect.width / 2;
        if (touch.clientX < midX) {
          grid.insertBefore(dragCard, target);
        } else {
          grid.insertBefore(dragCard, target.nextSibling);
        }
      }
    }, { passive: false });

    card.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      if (touchDragging) {
        dragCard.classList.remove('dragging');
        if (dragGhost) { dragGhost.remove(); dragGhost = null; }
        saveGridOrder(grid);
        touchDragging = false;
        dragCard = null;
      }
    });

    card.addEventListener('touchcancel', () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      if (touchDragging) {
        dragCard.classList.remove('dragging');
        if (dragGhost) { dragGhost.remove(); dragGhost = null; }
        touchDragging = false;
        dragCard = null;
      }
    });
  });

  // --- MOUSE: dragover on grid for reordering ---
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = getCardUnderPoint(grid, e.clientX, e.clientY);
    if (target && target !== dragCard) {
      const targetRect = target.getBoundingClientRect();
      const midX = targetRect.left + targetRect.width / 2;
      if (e.clientX < midX) {
        grid.insertBefore(dragCard, target);
      } else {
        grid.insertBefore(dragCard, target.nextSibling);
      }
    }
  });

  grid.addEventListener('drop', (e) => {
    e.preventDefault();
  });

  function removePlaceholder() {
    if (placeholder) { placeholder.remove(); placeholder = null; }
  }
}

function getCardUnderPoint(grid, x, y) {
  const cards = grid.querySelectorAll('.sound-card:not(.dragging):not(.drag-ghost)');
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return card;
    }
  }
  return null;
}

function saveGridOrder(grid) {
  const ids = [...grid.querySelectorAll('.sound-card')].map(c => c.dataset.id);
  saveLocalOrder(ids);
}

window.deleteSound = async function(docId) {
  if (!confirm('Delete this sound?')) return;
  try { await deleteDoc(doc(db, 'sounds', docId)); showToast('Deleted', 'success'); }
  catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
};
window.editSound = function(docId) { openEditModal(docId); };
window.toggleLike = async function(docId) {
  if (!state.currentUser) { showToast('Login to like sounds', 'warning'); return; }
  const uid = state.currentUser.uid;
  const sound = state.sounds.find(s => s.id === docId);
  if (!sound) return;
  const isLiked = (sound.likes || []).includes(uid);
  try {
    await updateDoc(doc(db, 'sounds', docId), {
      likes: isLiked ? arrayRemove(uid) : arrayUnion(uid)
    });
  } catch (e) {
    console.error('Like failed:', e);
    showToast('Like failed: ' + e.message, 'error');
  }
};

window.setFilter = function(filter) {
  state.currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderSounds();
};

// ============================================
// BIND EVENTS
// ============================================
function bindEvents() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => window.setFilter(btn.dataset.filter));
  });

  const loginBtn = $('#loginBtn'), loginGoogleBtn = $('#loginGoogleBtn'), logoutBtn = $('#logoutBtn');
  if (loginBtn) loginBtn.addEventListener('click', () => { const p = $('#loginPage'); if (p) p.classList.add('show'); });
  if (loginGoogleBtn) loginGoogleBtn.addEventListener('click', handleLogin);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const openUploadBtn = $('#openUpload'), closeModalBtn = $('#closeModal'),
    submitUploadBtn = $('#submitUpload'), cancelUploadBtn = $('#cancelUpload'),
    audioInput = $('#audioInput'), thumbInput = $('#thumbInput'),
    dropZone = $('#dropZone'), thumbDropZone = $('#thumbDropZone'),
    stopAllBtn = $('#stopAll'), emptyUploadBtn = $('#emptyUploadBtn'),
    removeFileBtn = $('#removeFile'), removeThumbBtn = $('#removeThumb'),
    soundNameInput = $('#soundName'), charCount = $('#charCount');

  if (openUploadBtn) openUploadBtn.addEventListener('click', openModal);
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (submitUploadBtn) submitUploadBtn.addEventListener('click', uploadSound);
  if (cancelUploadBtn) cancelUploadBtn.addEventListener('click', closeModal);
  if (audioInput) audioInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
  if (thumbInput) thumbInput.addEventListener('change', (e) => handleThumbSelect(e.target.files[0]));
  if (dropZone) dropZone.addEventListener('click', () => audioInput && audioInput.click());
  if (thumbDropZone) thumbDropZone.addEventListener('click', () => thumbInput && thumbInput.click());
  if (stopAllBtn) stopAllBtn.addEventListener('click', stopAll);
  if (emptyUploadBtn) emptyUploadBtn.addEventListener('click', openModal);

  if (removeFileBtn) removeFileBtn.addEventListener('click', () => {
    state.selectedFile = null; state.audioBuffer = null; stopPreview();
    if ($('#fileInfo')) $('#fileInfo').style.display = 'none';
    if ($('#dropZone')) $('#dropZone').style.display = 'flex';
    if ($('#waveformEditor')) $('#waveformEditor').style.display = 'none';
    if (audioInput) audioInput.value = '';
  });
  if (removeThumbBtn) removeThumbBtn.addEventListener('click', () => {
    state.selectedThumbFile = null;
    if ($('#thumbInfo')) $('#thumbInfo').style.display = 'none';
    if ($('#thumbDropZone')) $('#thumbDropZone').style.display = 'flex';
    if (thumbInput) thumbInput.value = '';
  });

  if (soundNameInput && charCount) soundNameInput.addEventListener('input', () => { charCount.textContent = soundNameInput.value.length; });

  // Preview button
  const playSelBtn = $('#playSelection');
  if (playSelBtn) playSelBtn.addEventListener('click', (e) => { e.preventDefault(); playPreview(); });

  // Edit modal
  const closeEditModalBtn = $('#closeEditModal'), cancelEditBtn = $('#cancelEdit'),
    submitEditBtn = $('#submitEdit'), editThumbInput = $('#editThumbInput'),
    editThumbDropZone = $('#editThumbDropZone'), editSoundNameInput = $('#editSoundName'),
    editCharCount = $('#editCharCount'), removeEditThumbBtn = $('#removeEditThumb');

  if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);
  if (submitEditBtn) submitEditBtn.addEventListener('click', submitEdit);
  if (editThumbInput) editThumbInput.addEventListener('change', (e) => handleEditThumbSelect(e.target.files[0]));
  if (editThumbDropZone) editThumbDropZone.addEventListener('click', () => editThumbInput && editThumbInput.click());
  if (removeEditThumbBtn) removeEditThumbBtn.addEventListener('click', () => {
    state.editSelectedThumbFile = null;
    if ($('#editThumbInfo')) $('#editThumbInfo').style.display = 'none';
    if ($('#editThumbDropZone')) $('#editThumbDropZone').style.display = 'flex';
    if (editThumbInput) editThumbInput.value = '';
  });
  if (editSoundNameInput && editCharCount) editSoundNameInput.addEventListener('input', () => { editCharCount.textContent = editSoundNameInput.value.length; });

  // Close login overlay on backdrop
  const loginPage = $('#loginPage');
  if (loginPage) loginPage.addEventListener('click', (e) => { if (e.target === loginPage) loginPage.classList.remove('show'); });

  // Init trim handle dragging
  initTrimHandles();

  // Handle window resize -> redraw waveform
  window.addEventListener('resize', () => {
    if (state.audioBuffer) {
      const canvas = $('#waveformCanvas');
      if (canvas) drawWaveform(state.audioBuffer, canvas);
    }
  });
}

// ============================================
// INIT
// ============================================
function init() {
  bindEvents();
  if (firebaseReady) { initAuthListener(); initRealtimeListener(); }
}
document.addEventListener('DOMContentLoaded', init);
