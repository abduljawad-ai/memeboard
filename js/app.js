// ============================================
// MEME SOUNDBOARD — FIREBASE EDITION (Firestore-Only)
// No Firebase Storage needed — works on FREE Spark plan
// Audio stored as base64 data URLs in Firestore docs
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, addDoc, onSnapshot, doc, deleteDoc, updateDoc,
  query, orderBy, serverTimestamp, getDoc
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

// ============================================
// ADMIN CONFIGURATION
// ============================================
const ADMIN_UID = "Db3uryElkEdX90GlEHsyhOMugD43";

// ============================================
// CONSTANTS
// ============================================
const MAX_FILE_SIZE = 700 * 1024; // 700 KB
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg'];
const ALLOWED_MIME_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
  'audio/x-wav', 'audio/ogg', 'audio/vorbis'
];
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
  isEditing: false,
  isUploading: false,
  currentUser: null,
  isAdmin: false
};

// ============================================
// FIREBASE INITIALIZATION
// ============================================
let db;
let auth;
let firebaseReady = false;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;
} catch (err) {
  console.warn('Firebase init:', err.message);
}

// ============================================
// DOM HELPERS
// ============================================
const $ = (s) => document.querySelector(s);

// ============================================
// AUTHENTICATION (Google Popup — works on localhost)
// ============================================
async function handleLogin() {
  try {
    const provider = new GoogleAuthProvider();
    // signInWithPopup works on localhost. The COOP console warning is harmless.
    const result = await signInWithPopup(auth, provider);
    if (result.user) {
      showToast("Signed in as " + (result.user.displayName || result.user.email), "success");
    }
    const loginPage = $('#loginPage');
    if (loginPage) loginPage.classList.remove('show');
  } catch (error) {
    // If popup was closed by user, don't show an error
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      return;
    }
    console.error("Login failed:", error);
    showToast("Login failed: " + error.message, "error");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    showToast("Signed out", "info");
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

function initAuthListener() {
  if (!firebaseReady) return;

  onAuthStateChanged(auth, (user) => {
    state.currentUser = user;
    state.isAdmin = user && user.uid === ADMIN_UID;

    const loginBtn = $('#loginBtn');
    const userProfile = $('#userProfile');
    const userAvatar = $('#userAvatar');
    const userNameEl = $('#userName');
    const uploadBtn = $('#openUpload');
    const loginPage = $('#loginPage');

    if (user) {
      // Hide login overlay
      if (loginPage) {
        loginPage.classList.remove('show');
      }

      // Show user profile, hide login button
      if (loginBtn) loginBtn.style.display = 'none';
      if (userProfile) userProfile.style.display = 'flex';

      const name = user.displayName || user.email.split('@')[0];
      if (userAvatar) userAvatar.textContent = name.charAt(0).toUpperCase();
      if (userNameEl) userNameEl.textContent = name;

      // Enable upload
      if (uploadBtn) {
        uploadBtn.style.opacity = '1';
        uploadBtn.style.pointerEvents = 'auto';
        uploadBtn.title = "Upload a new sound";
      }
    } else {
      // Show login button, hide profile
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (userProfile) userProfile.style.display = 'none';

      // Disable upload
      if (uploadBtn) {
        uploadBtn.style.opacity = '0.5';
        uploadBtn.style.pointerEvents = 'none';
        uploadBtn.title = "Login to upload";
      }
    }
    renderSounds();
  });
}

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
function showToast(message, type = 'success', duration = 4000) {
  const container = $('#toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation',
  };

  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || iconMap.info}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  const timer = setTimeout(() => dismissToast(toast), duration);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(toast);
  });
}

function dismissToast(toast) {
  toast.classList.remove('show');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 500);
}

// ============================================
// UTILITIES
// ============================================
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getGradient(id) {
  return GRADIENTS[hashString(id) % GRADIENTS.length];
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ============================================
// AUDIO ENGINE
// ============================================
function playSound(docId, dataUrl) {
  if (state.activeAudios.has(docId)) {
    const existing = state.activeAudios.get(docId);
    existing.pause();
    existing.currentTime = 0;
    existing.play().catch(() => { });
    pulseCard(docId);
    return;
  }

  const audio = new Audio(dataUrl);
  audio.volume = 0.8;

  state.activeAudios.set(docId, audio);
  setCardPlaying(docId, true);

  audio.play().catch((e) => {
    console.warn('Playback failed:', e);
    showToast('Could not play sound', 'error');
    state.activeAudios.delete(docId);
    setCardPlaying(docId, false);
  });

  audio.addEventListener('ended', () => {
    state.activeAudios.delete(docId);
    setCardPlaying(docId, false);
  }, { once: true });

  audio.addEventListener('error', () => {
    state.activeAudios.delete(docId);
    setCardPlaying(docId, false);
    showToast('Error loading audio', 'error');
  }, { once: true });
}

function stopAll() {
  state.activeAudios.forEach((audio, docId) => {
    audio.pause();
    audio.currentTime = 0;
    setCardPlaying(docId, false);
  });
  state.activeAudios.clear();
}

function setCardPlaying(docId, playing) {
  const card = document.querySelector(`.sound-card[data-id="${docId}"]`);
  if (card) card.classList.toggle('playing', playing);
}

function pulseCard(docId) {
  const card = document.querySelector(`.sound-card[data-id="${docId}"]`);
  if (!card) return;
  card.style.transform = 'scale(0.93)';
  setTimeout(() => { card.style.transform = ''; }, 120);
}

// ============================================
// FILE VALIDATION
// ============================================
function validateFile(file) {
  if (!file) return { valid: false, error: 'No file selected.' };
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `Invalid file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeKB = (file.size / 1024).toFixed(0);
    return { valid: false, error: `File too large (${sizeKB} KB). Max is 700 KB.` };
  }
  return { valid: true };
}

function validateImageFile(file) {
  if (!file) return { valid: false, error: 'No image selected.' };
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'Invalid file type. Must be an image.' };
  }
  return { valid: true };
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
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height *= maxSize / width));
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width *= maxSize / height));
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================
// UPLOAD SYSTEM
// ============================================
async function uploadSound() {
  if (state.isUploading) return;
  if (!state.currentUser) {
    showToast('Please login first', 'warning');
    return;
  }
  const name = $('#soundName').value.trim();
  if (!name) {
    showToast('Please enter a sound name', 'warning');
    return;
  }
  if (!state.selectedFile) {
    showToast('Please select an audio file', 'warning');
    return;
  }

  // Validate audio file
  const validation = validateFile(state.selectedFile);
  if (!validation.valid) {
    showToast(validation.error, 'warning');
    return;
  }

  state.isUploading = true;
  setUploadLoadingState(true);
  showProgress(true);
  try {
    updateProgress(20);
    const audioBase64 = await fileToBase64(state.selectedFile);
    updateProgress(50);
    let thumbnailBase64 = null;
    if (state.selectedThumbFile) {
      thumbnailBase64 = await resizeImage(state.selectedThumbFile, 400);
    }
    updateProgress(80);
    const docData = {
      name: name,
      audioData: audioBase64,
      userId: state.currentUser.uid,
      createdAt: serverTimestamp(),
    };
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

function setUploadLoadingState(loading) {
  const btn = $('#submitUpload');
  if (btn) {
    btn.disabled = loading;
    btn.classList.toggle('loading', loading);
  }
}

function showProgress(show) {
  const el = $('#progressContainer');
  if (el) el.style.display = show ? 'block' : 'none';
}

function updateProgress(pct) {
  const bar = $('#progressBar');
  const text = $('#progressText');
  if (bar) bar.style.width = pct + '%';
  if (text) text.textContent = pct + '%';
}

// ============================================
// MODALS
// ============================================
function openModal() {
  if (!state.currentUser) {
    showToast('Please login first', 'warning');
    $('#loginPage').classList.add('show');
    return;
  }
  resetModalForm();
  $('#uploadModal').classList.add('show');
}

function closeModal() {
  const modal = $('#uploadModal');
  if (modal) modal.classList.remove('show');
}

function resetModalForm() {
  const nameInput = $('#soundName');
  if (nameInput) nameInput.value = '';
  state.selectedFile = null;
  state.selectedThumbFile = null;
  const fileInfo = $('#fileInfo');
  const dropZone = $('#dropZone');
  const thumbInfo = $('#thumbInfo');
  const thumbDropZone = $('#thumbDropZone');
  if (fileInfo) fileInfo.style.display = 'none';
  if (dropZone) dropZone.style.display = 'flex';
  if (thumbInfo) thumbInfo.style.display = 'none';
  if (thumbDropZone) thumbDropZone.style.display = 'flex';
}

function handleFileSelect(file) {
  if (!file) return;
  const validation = validateFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'warning');
    return;
  }
  state.selectedFile = file;
  const dropZone = $('#dropZone');
  const fileInfo = $('#fileInfo');
  const fileName = $('#fileName');
  const fileSize = $('#fileSize');
  if (dropZone) dropZone.style.display = 'none';
  if (fileInfo) fileInfo.style.display = 'flex';
  if (fileName) fileName.textContent = file.name;
  if (fileSize) fileSize.textContent = formatFileSize(file.size);
}

function handleThumbSelect(file) {
  if (!file) return;
  const validation = validateImageFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'warning');
    return;
  }
  state.selectedThumbFile = file;
  const thumbDropZone = $('#thumbDropZone');
  const thumbInfo = $('#thumbInfo');
  const thumbName = $('#thumbName');
  const thumbSize = $('#thumbSize');
  if (thumbDropZone) thumbDropZone.style.display = 'none';
  if (thumbInfo) thumbInfo.style.display = 'flex';
  if (thumbName) thumbName.textContent = file.name;
  if (thumbSize) thumbSize.textContent = formatFileSize(file.size);
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = $('#thumbPreview');
    if (preview) preview.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================
// EDIT SYSTEM
// ============================================
function openEditModal(soundId) {
  const sound = state.sounds.find(s => s.id === soundId);
  if (!sound) return;
  const nameInput = $('#editSoundName');
  const idInput = $('#editSoundId');
  if (nameInput) nameInput.value = sound.name;
  if (idInput) idInput.value = soundId;
  state.editSelectedThumbFile = null;
  const editThumbInfo = $('#editThumbInfo');
  const editThumbDropZone = $('#editThumbDropZone');
  if (editThumbInfo) editThumbInfo.style.display = 'none';
  if (editThumbDropZone) editThumbDropZone.style.display = 'flex';
  $('#editModal').classList.add('show');
}

async function submitEdit() {
  const soundId = $('#editSoundId').value;
  const newName = $('#editSoundName').value.trim();
  if (!soundId || !newName) {
    showToast('Name is required', 'warning');
    return;
  }

  const btn = $('#submitEdit');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  const progressEl = $('#editProgressContainer');
  if (progressEl) progressEl.style.display = 'block';

  try {
    const updateData = { name: newName };
    if (state.editSelectedThumbFile) {
      const thumbBase64 = await resizeImage(state.editSelectedThumbFile, 400);
      updateData.thumbnailData = thumbBase64;
    }
    await updateDoc(doc(db, 'sounds', soundId), updateData);
    showToast('Sound updated!', 'success');
    closeEditModal();
  } catch (error) {
    console.error('Edit failed:', error);
    showToast('Update failed: ' + error.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (progressEl) progressEl.style.display = 'none';
  }
}

function closeEditModal() {
  const modal = $('#editModal');
  if (modal) modal.classList.remove('show');
}

function handleEditThumbSelect(file) {
  if (!file) return;
  const validation = validateImageFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'warning');
    return;
  }
  state.editSelectedThumbFile = file;
  const editThumbDropZone = $('#editThumbDropZone');
  const editThumbInfo = $('#editThumbInfo');
  const editThumbName = $('#editThumbName');
  if (editThumbDropZone) editThumbDropZone.style.display = 'none';
  if (editThumbInfo) editThumbInfo.style.display = 'flex';
  if (editThumbName) editThumbName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = $('#editThumbPreview');
    if (preview) preview.src = e.target.result;
  };
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
    const count = state.sounds.length;
    const countEl = $('#soundCount');
    if (countEl) countEl.innerHTML = `<i class="fa-solid fa-music"></i> ${count} sound${count === 1 ? '' : 's'}`;
  });
}

function renderSounds() {
  const grid = $('#soundGrid');
  const loadingState = $('#loadingState');
  const emptyState = $('#emptyState');
  if (!grid) return;

  if (loadingState) loadingState.style.display = 'none';

  if (state.sounds.length === 0) {
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  state.sounds.forEach(sound => {
    const gradient = getGradient(sound.id);
    const canEdit = state.isAdmin || (state.currentUser && state.currentUser.uid === sound.userId);
    const card = document.createElement('div');
    card.className = 'sound-card';
    card.dataset.id = sound.id;
    card.style.setProperty('--card-color-1', gradient.colors[0]);
    card.style.setProperty('--card-color-2', gradient.colors[1]);

    let visual = `<div class="card-icon" style="background:linear-gradient(135deg,${gradient.colors[0]},${gradient.colors[1]})"><i class="fa-solid fa-play"></i></div>`;
    if (sound.thumbnailData) visual = `<img src="${sound.thumbnailData}" class="card-thumbnail">`;

    card.innerHTML = `
      ${canEdit ? `<div class="card-actions">
        <button onclick="event.stopPropagation(); editSound('${sound.id}');" title="Edit"><i class="fa-solid fa-pencil"></i></button>
        <button onclick="event.stopPropagation(); deleteSound('${sound.id}');" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>` : ''}
      ${visual}
      <div class="card-title">${escapeHtml(sound.name)}</div>
    `;
    card.addEventListener('click', () => playSound(sound.id, sound.audioData));
    grid.appendChild(card);
  });
}

// Global functions for inline onclick handlers
window.deleteSound = async function(docId) {
  if (!confirm('Delete this sound?')) return;
  try {
    await deleteDoc(doc(db, 'sounds', docId));
    showToast('Deleted', 'success');
  } catch (e) {
    console.error('Delete failed:', e);
    showToast('Delete failed: ' + e.message, 'error');
  }
};

window.editSound = function(docId) {
  openEditModal(docId);
};

// ============================================
// BIND EVENTS
// ============================================
function bindEvents() {
  // Login overlay
  const loginBtn = $('#loginBtn');
  const loginGoogleBtn = $('#loginGoogleBtn');
  const logoutBtn = $('#logoutBtn');

  if (loginBtn) loginBtn.addEventListener('click', () => {
    const page = $('#loginPage');
    if (page) page.classList.add('show');
  });
  if (loginGoogleBtn) loginGoogleBtn.addEventListener('click', handleLogin);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Upload modal
  const openUploadBtn = $('#openUpload');
  const closeModalBtn = $('#closeModal');
  const submitUploadBtn = $('#submitUpload');
  const cancelUploadBtn = $('#cancelUpload');
  const audioInput = $('#audioInput');
  const thumbInput = $('#thumbInput');
  const dropZone = $('#dropZone');
  const thumbDropZone = $('#thumbDropZone');
  const stopAllBtn = $('#stopAll');
  const emptyUploadBtn = $('#emptyUploadBtn');
  const removeFileBtn = $('#removeFile');
  const removeThumbBtn = $('#removeThumb');
  const soundNameInput = $('#soundName');
  const charCount = $('#charCount');

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

  // Remove file buttons
  if (removeFileBtn) removeFileBtn.addEventListener('click', () => {
    state.selectedFile = null;
    if ($('#fileInfo')) $('#fileInfo').style.display = 'none';
    if ($('#dropZone')) $('#dropZone').style.display = 'flex';
    if (audioInput) audioInput.value = '';
  });
  if (removeThumbBtn) removeThumbBtn.addEventListener('click', () => {
    state.selectedThumbFile = null;
    if ($('#thumbInfo')) $('#thumbInfo').style.display = 'none';
    if ($('#thumbDropZone')) $('#thumbDropZone').style.display = 'flex';
    if (thumbInput) thumbInput.value = '';
  });

  // Char counter on sound name
  if (soundNameInput && charCount) {
    soundNameInput.addEventListener('input', () => {
      charCount.textContent = soundNameInput.value.length;
    });
  }

  // Edit modal
  const closeEditModalBtn = $('#closeEditModal');
  const cancelEditBtn = $('#cancelEdit');
  const submitEditBtn = $('#submitEdit');
  const editThumbInput = $('#editThumbInput');
  const editThumbDropZone = $('#editThumbDropZone');
  const editSoundNameInput = $('#editSoundName');
  const editCharCount = $('#editCharCount');
  const removeEditThumbBtn = $('#removeEditThumb');

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

  // Edit char counter
  if (editSoundNameInput && editCharCount) {
    editSoundNameInput.addEventListener('input', () => {
      editCharCount.textContent = editSoundNameInput.value.length;
    });
  }

  // Close login overlay when clicking outside
  const loginPage = $('#loginPage');
  if (loginPage) {
    loginPage.addEventListener('click', (e) => {
      if (e.target === loginPage) loginPage.classList.remove('show');
    });
  }
}

// ============================================
// INIT
// ============================================
function init() {
  bindEvents();
  if (firebaseReady) {
    initAuthListener();
    initRealtimeListener();
  }
}

document.addEventListener('DOMContentLoaded', init);
