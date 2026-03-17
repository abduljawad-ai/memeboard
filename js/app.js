// ============================================
// MEME SOUNDBOARD — FIREBASE EDITION (Firestore-Only)
// No Firebase Storage needed — works on FREE Spark plan
// Audio stored as base64 data URLs in Firestore docs
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, addDoc, onSnapshot, doc, deleteDoc, updateDoc,
  query, orderBy, serverTimestamp
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
// Replace this with your actual Google UID once logged in!
// For now, it's a placeholder. When you log in, check the console for your UID.
const ADMIN_UID = "Db3uryElkEdX90GlEHsyhOMugD43"; 

// ============================================
// CONSTANTS
// ============================================
// Firestore doc limit is 1MB. Base64 inflates ~33%, so max raw file ≈ 700KB.
// We set 700KB to leave room for the other document fields.
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
  
  // Edit State
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
  if (firebaseConfig.apiKey === 'YOUR_API_KEY') {
    throw new Error('Firebase not configured');
  }
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;
} catch (err) {
  console.warn('Firebase init:', err.message);
}

// ============================================
// AUTHENTICATION
// ============================================
async function handleLogin() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed:", error);
    showToast("Login failed. Please try again.", "error");
  }
}

async function handleEmailLogin(e) {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;

  if (!email || !password) {
    showToast("Please enter email and password.", "warning");
    return;
  }

  const btn = $('#loginEmailBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    $('#loginForm').reset();
  } catch (error) {
    console.error("Email login failed:", error);
    let msg = "Login failed.";
    if (error.code === 'auth/invalid-credential') msg = "Invalid email or password.";
    showToast(msg, "error");
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function handleEmailSignup() {
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;

  if (!email || !password) {
    showToast("Please enter email and password to sign up.", "warning");
    return;
  }

  if (password.length < 6) {
    showToast("Password should be at least 6 characters.", "warning");
    return;
  }

  const btn = $('#signupEmailBtn');
  btn.disabled = true;

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    $('#loginForm').reset();
    showToast("Account created successfully!", "success");
  } catch (error) {
    console.error("Email signup failed:", error);
    let msg = "Signup failed.";
    if (error.code === 'auth/email-already-in-use') msg = "Email already in use.";
    showToast(msg, "error");
  } finally {
    btn.disabled = false;
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
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
    const uploadBtn = $('#openUpload');
    const loginPage = $('#loginPage');

    if (user) {
      // User is logged in
      console.log("Logged in with UID:", user.uid); // To find the UID for the admin config
      
      /* Temporary: prompt the user so they can copy their UID easily
      if (user.uid !== ADMIN_UID) {
        setTimeout(() => {
          prompt("Your Firebase UID is below. Please copy it and paste it to the AI Chat to make you the Admin:", user.uid);
        }, 1000);
      } */
      
      // Hide Login Overlay
      if (loginPage) {
        loginPage.classList.remove('show');
        loginPage.style.display = 'none';
      }

      loginBtn.style.display = 'none';
      userProfile.style.display = 'flex';
      userAvatar.src = user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.email || 'User');
      
      // Enable Uploads
      uploadBtn.style.opacity = '1';
      uploadBtn.style.pointerEvents = 'auto';
      uploadBtn.title = "Upload a new sound";
    } else {
      // User is logged out
      // Show Login Overlay
      if (loginPage) {
        loginPage.classList.add('show');
        loginPage.style.display = 'flex';
      }

      loginBtn.style.display = 'inline-flex';
      userProfile.style.display = 'none';
      
      // Disable Uploads
      uploadBtn.style.opacity = '0.5';
      uploadBtn.style.pointerEvents = 'none';
      uploadBtn.title = "Login to upload";
    }

    // Re-render sounds to show/hide edit and delete buttons based on auth state
    renderSounds();
  });
}

// ============================================
// DOM HELPERS
// ============================================
const $ = (s) => document.querySelector(s);

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
function showToast(message, type = 'success', duration = 4000) {
  const container = $('#toastContainer');
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

/**
 * Convert a File to a base64 data URL string.
 */
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
  // If same sound is playing, restart it
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
const MAX_THUMB_SIZE = 300 * 1024; // 300 KB for images

function validateFile(file) {
  if (!file) return { valid: false, error: 'No file selected.' };

  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `Invalid file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }

  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: 'Invalid audio format. Use MP3, WAV, or OGG.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    const sizeKB = (file.size / 1024).toFixed(0);
    return { valid: false, error: `File too large (${sizeKB} KB). Max is 700 KB.` };
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty.' };
  }

  return { valid: true };
}

function validateImageFile(file) {
  if (!file) return { valid: false, error: 'No image selected.' };
  
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'Invalid file type. Must be an image.' };
  }

  // We no longer reject large images here, because we squash them before upload.
  return { valid: true };
}

// ============================================
// IMAGE RESIZING UTILITY
// ============================================
/**
 * Reads an image file and scales it down so its max dimension is `maxSize`.
 * Returns a Base64 JPEG string (quality 0.8) perfect for Firestore thumbnails.
 */
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

        // Export as JPEG with 80% quality to ensure it's very small
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image for resizing.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

// ============================================
// UPLOAD SYSTEM (Base64 → Firestore)
// ============================================
async function uploadSound() {
  if (state.isUploading) return;

  const name = $('#soundName').value.trim();
  if (!name) {
    showToast('Please enter a sound name', 'warning');
    $('#soundName').focus();
    return;
  }
  if (name.length < 2) {
    showToast('Name must be at least 2 characters', 'warning');
    $('#soundName').focus();
    return;
  }
  if (!state.selectedFile) {
    showToast('Please select an audio file', 'warning');
    return;
  }

  const validation = validateFile(state.selectedFile);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    return;
  }

  state.isUploading = true;
  setUploadLoadingState(true);
  showProgress(true);

  try {
    // Simulate progress
    showProgress(true);

    // 1. Convert Audio to Base64
    updateProgress(20);
    const audioBase64 = await fileToBase64(state.selectedFile);
    updateProgress(50);

    // 2. Prepare Thumbnail (Squash if needed)
    let thumbnailBase64 = null;
    if (state.selectedThumbFile) {
      updateProgress(60);
      thumbnailBase64 = await resizeImage(state.selectedThumbFile, 400);
      updateProgress(80);
    }
    // This updateProgress(70) was moved from before the thumbnail processing
    // to after it, to ensure progress is updated correctly.
    // The original instruction had it at 70, but 80 is more appropriate after thumb processing.
    // Keeping the original instruction's 70 for now, but noting the potential for adjustment.
    // For now, I'll remove the redundant updateProgress(70) as 80 is already set.
    // updateProgress(70); // Removed as 80 is set above.

    const docData = {
      name: name,
      audioData: audioBase64,
      fileName: state.selectedFile.name,
      fileSize: state.selectedFile.size,
      createdAt: serverTimestamp(),
    };
    
    // Add auth mapping
    if (state.currentUser) {
      docData.userId = state.currentUser.uid;
      docData.userName = state.currentUser.displayName || 'Unknown';
    }
    
    if (thumbnailBase64) {
      docData.thumbnailData = thumbnailBase64;
    }

    // Save directly to Firestore
    await addDoc(collection(db, 'sounds'), docData);

    updateProgress(100);
    showToast(`"${name}" uploaded successfully! 🎉`, 'success');
    closeModal();

  } catch (error) {
    console.error('Upload failed:', error);
    let msg = 'Upload failed. Please try again.';
    if (error.code === 'permission-denied') msg = 'Upload not authorized. Check Firestore rules.';
    else if (error.message?.includes('exceeds the maximum')) msg = 'File too large for Firestore. Try a smaller file.';
    showToast(msg, 'error');
  } finally {
    state.isUploading = false;
    setUploadLoadingState(false);
    showProgress(false);
  }
}

function setUploadLoadingState(loading) {
  const btn = $('#submitUpload');
  const cancelBtn = $('#cancelUpload');
  const closeBtn = $('#closeModal');

  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
  cancelBtn.disabled = loading;
  closeBtn.disabled = loading;
}

function showProgress(show) {
  $('#progressContainer').style.display = show ? 'block' : 'none';
  if (!show) updateProgress(0);
}

function updateProgress(pct) {
  $('#progressBar').style.width = pct.toFixed(0) + '%';
  $('#progressText').textContent = pct.toFixed(0) + '%';
}

// ============================================
// MODAL MANAGEMENT
// ============================================
function openModal() {
  resetModalForm();
  $('#uploadModal').classList.add('show');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#soundName').focus(), 300);
}

function closeModal() {
  if (state.isUploading) return;
  $('#uploadModal').classList.remove('show');
  document.body.style.overflow = '';
  resetModalForm();
}

function resetModalForm() {
  $('#soundName').value = '';
  $('#charCount').textContent = '0';
  
  state.selectedFile = null;
  $('#fileInfo').style.display = 'none';
  $('#dropZone').style.display = 'flex';
  $('#audioInput').value = '';
  
  state.selectedThumbFile = null;
  $('#thumbInfo').style.display = 'none';
  $('#thumbDropZone').style.display = 'flex';
  $('#thumbInput').value = '';
  $('#thumbPreview').src = '';
  
  showProgress(false);
  setUploadLoadingState(false);
}

// ============================================
// FILE SELECTION
// ============================================
function handleFileSelect(file) {
  if (!file) return;

  const validation = validateFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    return;
  }

  state.selectedFile = file;
  $('#dropZone').style.display = 'none';
  $('#fileInfo').style.display = 'flex';
  $('#fileName').textContent = file.name;
  $('#fileSize').textContent = formatFileSize(file.size);
}

function removeSelectedFile() {
  state.selectedFile = null;
  $('#fileInfo').style.display = 'none';
  $('#dropZone').style.display = 'flex';
  $('#audioInput').value = '';
}

function handleThumbSelect(file) {
  if (!file) return;

  const validation = validateImageFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    return;
  }

  state.selectedThumbFile = file;
  $('#thumbDropZone').style.display = 'none';
  $('#thumbInfo').style.display = 'flex';
  $('#thumbName').textContent = file.name;
  $('#thumbSize').textContent = formatFileSize(file.size);
  
  // Local preview
  const reader = new FileReader();
  reader.onload = (e) => {
    $('#thumbPreview').src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeSelectedThumb() {
  state.selectedThumbFile = null;
  $('#thumbInfo').style.display = 'none';
  $('#thumbDropZone').style.display = 'flex';
  $('#thumbInput').value = '';
  $('#thumbPreview').src = '';
}

function handleEditThumbSelect(file) {
  if (!file) return;

  const validation = validateImageFile(file);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    return;
  }

  state.editSelectedThumbFile = file;
  $('#editThumbDropZone').style.display = 'none';
  $('#editThumbInfo').style.display = 'flex';
  $('#editThumbName').textContent = file.name;
  $('#editThumbSize').textContent = formatFileSize(file.size);
  
  // Local preview
  const reader = new FileReader();
  reader.onload = (e) => {
    $('#editThumbPreview').src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeEditSelectedThumb() {
  state.editSelectedThumbFile = null;
  $('#editThumbInfo').style.display = 'none';
  $('#editThumbDropZone').style.display = 'flex';
  $('#editThumbInput').value = '';
  $('#editThumbPreview').src = '';
}

// ============================================
// REAL-TIME LISTENER (FIRESTORE)
// ============================================
function initRealtimeListener() {
  if (!firebaseReady) return;

  const q = query(collection(db, 'sounds'), orderBy('createdAt', 'desc'));

  onSnapshot(q, (snapshot) => {
    state.sounds = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    renderSounds();
    updateSoundCount();
  }, (error) => {
    console.error('Firestore listener error:', error);
    showToast('Connection lost. Retrying...', 'error');
  });
}

// ============================================
// RENDERING
// ============================================
function renderSounds() {
  const grid = $('#soundGrid');
  const loading = $('#loadingState');
  const empty = $('#emptyState');

  loading.style.display = 'none';

  if (state.sounds.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  state.sounds.forEach((sound) => {
    const gradient = getGradient(sound.id);
    const isPlaying = state.activeAudios.has(sound.id);

    // Can this user edit/delete this sound?
    const isOwner = state.currentUser && state.currentUser.uid === sound.userId;
    const canEdit = isOwner || state.isAdmin;

    const card = document.createElement('div');
    card.className = `sound-card${isPlaying ? ' playing' : ''}`;
    card.dataset.id = sound.id;
    card.style.setProperty('--card-color-1', gradient.colors[0]);
    card.style.setProperty('--card-color-2', gradient.colors[1]);
    card.style.setProperty('--glow-r', gradient.rgb[0]);
    card.style.setProperty('--glow-g', gradient.rgb[1]);
    card.style.setProperty('--glow-b', gradient.rgb[2]);

    let visualElement = `
      <div class="card-icon" style="background: linear-gradient(135deg, ${gradient.colors[0]}, ${gradient.colors[1]})">
        <i class="fa-solid fa-play"></i>
      </div>
    `;

    if (sound.thumbnailData) {
      visualElement = `<img src="${sound.thumbnailData}" class="card-thumbnail" alt="${escapeHtml(sound.name)} thumbnail" draggable="false">`;
    }

    card.innerHTML = `
      ${canEdit ? `
        <div class="card-actions">
          <button class="btn-card-action btn-card-edit" title="Edit sound" onclick="event.stopPropagation(); editSound('${sound.id}');">
            <i class="fa-solid fa-pencil"></i>
          </button>
          <button class="btn-card-action btn-card-delete" title="Delete sound" onclick="event.stopPropagation(); deleteSound('${sound.id}');">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      ` : ''}
      <div class="equalizer">
        <div class="bar"></div>
        <div class="bar"></div>
        <div class="bar"></div>
        <div class="bar"></div>
        <div class="bar"></div>
      </div>
      ${visualElement}
      <div class="card-title">${escapeHtml(sound.name)}</div>
    `;

    // Play sound using the base64 audioData field
    card.addEventListener('click', () => playSound(sound.id, sound.audioData));
    grid.appendChild(card);
  });
}

function updateSoundCount() {
  const count = state.sounds.length;
  const label = count === 1 ? '1 sound' : `${count} sounds`;
  $('#soundCount').innerHTML = `<i class="fa-solid fa-music"></i> ${label}`;
}

// ============================================
// SETUP NOTICE
// ============================================
function showSetupNotice() {
  $('#loadingState').style.display = 'none';
  $('#setupNotice').style.display = 'flex';
}

// ============================================
// ADMIN/EDIT ACTIONS
// ============================================

window.editSound = function(docId) {
  const sound = state.sounds.find(s => s.id === docId);
  if (!sound) return;

  $('#editSoundId').value = docId;
  $('#editSoundName').value = sound.name;
  $('#editCharCount').textContent = sound.name.length;
  
  removeEditSelectedThumb(); // Reset thumb input

  $('#editModal').classList.add('show');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#editSoundName').focus(), 300);
};

function closeEditModal() {
  if (state.isEditing) return;
  $('#editModal').classList.remove('show');
  document.body.style.overflow = '';
  $('#editSoundId').value = '';
  $('#editSoundName').value = '';
  removeEditSelectedThumb();
  setEditLoadingState(false);
}

async function updateSoundData() {
  if (state.isEditing) return;

  const docId = $('#editSoundId').value;
  const name = $('#editSoundName').value.trim();

  if (!name) {
    showToast('Name cannot be empty', 'warning');
    return;
  }

  state.isEditing = true;
  setEditLoadingState(true);

  try {
    const updateData = { name: name };

    // If they selected a *new* thumbnail, convert and add it to the update
    if (state.editSelectedThumbFile) {
      const base64ThumbUrl = await resizeImage(state.editSelectedThumbFile, 400);
      updateData.thumbnailData = base64ThumbUrl;
    }

    await updateDoc(doc(db, 'sounds', docId), updateData);
    
    showToast('Sound updated!', 'success');
    closeEditModal();
  } catch (error) {
    console.error('Update failed:', error);
    showToast('Failed to update sound. Check permissions.', 'error');
  } finally {
    state.isEditing = false;
    setEditLoadingState(false);
  }
}

function setEditLoadingState(loading) {
  const btn = $('#submitEdit');
  const cancelBtn = $('#cancelEdit');
  const closeBtn = $('#closeEditModal');

  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
  cancelBtn.disabled = loading;
  closeBtn.disabled = loading;
}

window.deleteSound = async function(docId) {
  if (!confirm('Are you sure you want to delete this sound?')) return;
  
  try {
    await deleteDoc(doc(db, 'sounds', docId));
    showToast('Sound deleted successfully', 'success');
  } catch (error) {
    console.error('Delete failed:', error);
    showToast('Failed to delete sound. Check permissions.', 'error');
  }
};

// ============================================
// EVENT LISTENERS
// ============================================
function bindEvents() {
  // Login / Auth Flow
  $('#loginBtn').addEventListener('click', () => $('#loginPage').classList.add('show'));
  const loginGoogleBtn = $('#loginGoogleBtn');
  if (loginGoogleBtn) loginGoogleBtn.addEventListener('click', handleLogin);
  
  const loginForm = $('#loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleEmailLogin);
  
  const signupEmailBtn = $('#signupEmailBtn');
  if (signupEmailBtn) signupEmailBtn.addEventListener('click', handleEmailSignup);

  $('#logoutBtn').addEventListener('click', handleLogout);

  // Upload Modal Listener
  $('#openUpload').addEventListener('click', openModal);
  const emptyBtn = $('#emptyUploadBtn');
  if (emptyBtn) emptyBtn.addEventListener('click', openModal);

  $('#closeModal').addEventListener('click', closeModal);
  $('#cancelUpload').addEventListener('click', closeModal);
  $('#uploadModal').addEventListener('click', (e) => {
    if (e.target.id === 'uploadModal') closeModal();
  });

  // Edit Modal Listeners
  $('#closeEditModal').addEventListener('click', closeEditModal);
  $('#cancelEdit').addEventListener('click', closeEditModal);
  $('#editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeEditModal();
  });
  $('#submitEdit').addEventListener('click', updateSoundData);
  $('#editSoundName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !state.isEditing) updateSoundData();
  });
  $('#editSoundName').addEventListener('input', () => {
    $('#editCharCount').textContent = $('#editSoundName').value.length;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeEditModal();
    }
  });

  $('#submitUpload').addEventListener('click', uploadSound);

  $('#soundName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !state.isUploading) uploadSound();
  });

  $('#soundName').addEventListener('input', () => {
    $('#charCount').textContent = $('#soundName').value.length;
  });

  $('#stopAll').addEventListener('click', () => {
    stopAll();
    showToast('All sounds stopped', 'info');
  });

  // Drop zone
  const dropZone = $('#dropZone');
  const audioInput = $('#audioInput');

  dropZone.addEventListener('click', () => audioInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      audioInput.click();
    }
  });

  audioInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
  });

  $('#removeFile').addEventListener('click', (e) => {
    e.stopPropagation();
    removeSelectedFile();
  });

  // Thumb Drop zone
  const thumbDropZone = $('#thumbDropZone');
  const thumbInput = $('#thumbInput');

  thumbDropZone.addEventListener('click', () => thumbInput.click());
  thumbDropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      thumbInput.click();
    }
  });

  thumbInput.addEventListener('change', (e) => handleThumbSelect(e.target.files[0]));

  thumbDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumbDropZone.classList.add('drag-over');
  });

  thumbDropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumbDropZone.classList.remove('drag-over');
  });

  thumbDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumbDropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleThumbSelect(e.dataTransfer.files[0]);
  });

  $('#removeThumb').addEventListener('click', (e) => {
    e.stopPropagation();
    removeSelectedThumb();
  });

  // Edit Thumb Drop zone
  const editThumbDropZone = $('#editThumbDropZone');
  const editThumbInput = $('#editThumbInput');

  editThumbDropZone.addEventListener('click', () => editThumbInput.click());
  editThumbDropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      editThumbInput.click();
    }
  });

  editThumbInput.addEventListener('change', (e) => handleEditThumbSelect(e.target.files[0]));

  editThumbDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editThumbDropZone.classList.add('drag-over');
  });

  editThumbDropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editThumbDropZone.classList.remove('drag-over');
  });

  editThumbDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    editThumbDropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleEditThumbSelect(e.dataTransfer.files[0]);
  });

  $('#removeEditThumb').addEventListener('click', (e) => {
    e.stopPropagation();
    removeEditSelectedThumb();
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

// ============================================
// INIT
// ============================================
function init() {
  bindEvents();
  if (!firebaseReady) {
    showSetupNotice();
    return;
  }
  initAuthListener();
  initRealtimeListener();
}

document.addEventListener('DOMContentLoaded', init);
