// CamLens Fullscreen Minimal Receiver & Unified Wi-Fi Auto-Pairing Client

const streamImg = document.getElementById('streamImg');
const remoteVideo = document.getElementById('remoteVideo');
const captureCanvas = document.getElementById('captureCanvas');
const statusPill = document.getElementById('statusPill');
const statusLabel = document.getElementById('statusLabel');
const btnTrigger = document.getElementById('btnTrigger');
const btnRotate = document.getElementById('btnRotate');
const btnFlipCamera = document.getElementById('btnFlipCamera');
const btnTorch = document.getElementById('btnTorch');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnQrCode = document.getElementById('btnQrCode');
const qrModal = document.getElementById('qrModal');
const btnCloseQrModal = document.getElementById('btnCloseQrModal');
const cardStatusPill = document.getElementById('cardStatusPill');
const cardStatusText = document.getElementById('cardStatusText');
const btnQuickUsb = document.getElementById('btnQuickUsb');
const btnConnectWifi = document.getElementById('btnConnectWifi');
const btnAutoScan = document.getElementById('btnAutoScan');
const phoneIpInput = document.getElementById('phoneIpInput');
const shutterFlash = document.getElementById('shutterFlash');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const googleLensForm = document.getElementById('googleLensForm');
const lensFileInput = document.getElementById('lensFileInput');
const qrCanvas = document.getElementById('qrCanvas');

let activeHost = 'http://localhost:8080'; // Default to USB ADB forward
let currentRotation = 0; // 0, 90, 180, 270
let isConnected = false;
let isTorchOn = false;
let currentConnectUrl = '';
let ws = null;

// ----------------------------------------------------
// UI Notification Toast
// ----------------------------------------------------
function showToast(text, duration = 3000) {
  toastMsg.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ----------------------------------------------------
// Fetch System Info & Setup Unified QR Code
// ----------------------------------------------------
async function loadServerInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    const port = data.port || 3000;

    let targetIp = 'localhost';
    if (data.ips && data.ips.length > 0) {
      const lan = data.ips.find(i => i.ip.startsWith('192.168.') || i.ip.startsWith('10.')) || data.ips[0];
      targetIp = lan.ip;
      if (phoneIpInput) {
        const parts = lan.ip.split('.');
        if (parts.length === 4) {
          phoneIpInput.value = `http://${parts[0]}.${parts[1]}.${parts[2]}.`;
        }
      }
    }

    currentConnectUrl = `http://${targetIp}:${port}/connect.html`;

    if (qrCanvas && window.QRCode) {
      QRCode.drawCanvas(qrCanvas, currentConnectUrl, {
        size: 200,
        colorDark: '#0a0e14',
        colorLight: '#ffffff'
      });
    }

  } catch (e) {
    console.error('Failed to load server info', e);
  }
}

// ----------------------------------------------------
// Wi-Fi Connect & Auto-Scan Handlers
// ----------------------------------------------------
if (btnConnectWifi) {
  btnConnectWifi.addEventListener('click', () => {
    let val = phoneIpInput.value.trim();
    if (!val) {
      showToast('Enter the IP shown on your phone');
      return;
    }
    if (!val.startsWith('http://') && !val.startsWith('https://')) {
      val = 'http://' + val;
    }
    if (!val.slice(7).includes(':')) {
      val = val + ':8080';
    }
    handlePhonePaired(val, 'wifi');
  });
}

if (btnAutoScan) {
  btnAutoScan.addEventListener('click', async () => {
    showToast('Scanning Wi-Fi network for phone running CamLens...');
    btnAutoScan.disabled = true;
    try {
      const res = await fetch('/api/scan-phone', { method: 'POST' });
      const data = await res.json();
      if (data.found && data.host) {
        handlePhonePaired(data.host, 'wifi');
      } else {
        showToast('Phone not found yet. Make sure CamLens is open on phone');
      }
    } catch (e) {
      showToast('Scan error. You can enter phone IP or connect USB');
    } finally {
      btnAutoScan.disabled = false;
    }
  });
}

// ----------------------------------------------------
// WebSocket Connection & Auto-Pairing Listener
// ----------------------------------------------------
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'register', role: 'receiver' }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.phonePaired && msg.host) {
        handlePhonePaired(msg.host, msg.mode || 'wifi');
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };
}

// ----------------------------------------------------
// Auto-Pairing Event: Updates Card Status & Connects
// ----------------------------------------------------
function handlePhonePaired(hostUrl, mode = 'wifi') {
  if (cardStatusPill && cardStatusText) {
    cardStatusPill.classList.add('connected');
    cardStatusText.textContent = mode === 'wifi' ? 'Connected via Wi-Fi' : 'Connected via USB';
  }

  showToast(mode === 'wifi' ? 'Phone paired: Smooth 60 FPS Wi-Fi Stream!' : 'Phone connected via USB (60 FPS)!');
  
  // Start stream from phone
  connectStream(hostUrl, mode);

  // Smoothly dismiss the QR dialog after 1.2 seconds so full video takes over
  setTimeout(() => {
    if (qrModal) {
      qrModal.style.display = 'none';
    }
  }, 1200);
}

// Check if phone was already announced
async function pollPairedPhone() {
  if (isConnected) return;
  try {
    const res = await fetch('/api/paired-phone');
    const json = await res.json();
    if (json.paired && json.data && json.data.host) {
      handlePhonePaired(json.data.host, json.data.mode || 'wifi');
    }
  } catch (e) {}
}

setInterval(pollPairedPhone, 2000);

let streamInterval = null;
let isStreamActive = false;

// ----------------------------------------------------
// Connect to Native Android App Stream (Robust Auto-Probe)
// ----------------------------------------------------
function connectStream(hostUrl, mode = 'wifi') {
  activeHost = hostUrl.replace(/\/+$/, '');
  isStreamActive = false;
  if (streamInterval) clearInterval(streamInterval);

  statusLabel.textContent = 'Connecting to Phone...';
  if (cardStatusText) cardStatusText.textContent = `Connecting to ${activeHost}...`;

  function checkAndAttach() {
    if (isStreamActive) return;

    // Use a lightweight probe to see if phone camera is up
    const probe = new Image();
    probe.onload = () => {
      if (!isStreamActive) {
        isStreamActive = true;
        clearInterval(streamInterval);
        streamInterval = null;
        streamImg.style.display = 'block';
        remoteVideo.style.display = 'none';
        streamImg.src = `${activeHost}/stream?t=${Date.now()}`;
        setConnected(true, mode);
        showToast(mode === 'wifi' ? 'Connected via Wi-Fi (60 FPS)' : 'Connected via USB (60 FPS)');
        if (qrModal) qrModal.style.display = 'none';
      }
    };
    probe.onerror = () => {
      setConnected(false, mode);
    };
    probe.src = `${activeHost}/photo.jpg?t=${Date.now()}`;
  }

  checkAndAttach();
  // Continuously probe every 1.5 seconds until phone app responds!
  streamInterval = setInterval(checkAndAttach, 1500);

  streamImg.onerror = () => {
    if (isStreamActive) {
      console.warn('Stream disconnected, reconnecting...');
      isStreamActive = false;
      setConnected(false, mode);
      connectStream(activeHost, mode);
    }
  };
}

function setConnected(connected, mode = 'wifi') {
  isConnected = connected;
  const label = mode === 'wifi' ? 'Connected via Wi-Fi (60 FPS)' : 'Connected via USB (60 FPS)';
  if (connected) {
    statusPill.classList.add('connected');
    statusLabel.textContent = label;
    if (cardStatusPill && cardStatusText) {
      cardStatusPill.classList.add('connected');
      cardStatusText.textContent = label;
    }
  } else {
    statusPill.classList.remove('connected');
    statusLabel.textContent = 'Waiting for Phone...';
    if (cardStatusPill && cardStatusText) {
      cardStatusPill.classList.remove('connected');
      cardStatusText.textContent = 'Scan QR code with your phone camera';
    }
  }
}

// ----------------------------------------------------
// USB 1-Click Connect
// ----------------------------------------------------
btnQuickUsb.addEventListener('click', async () => {
  showToast('Connecting via USB cable on port 8080...');
  try {
    const res = await fetch('/api/usb-forward', { method: 'POST' });
    await res.json();
    handlePhonePaired('http://localhost:8080', 'usb');
  } catch (err) {
    handlePhonePaired('http://localhost:8080', 'usb');
  }
});

// QR Code Modal Toggle
btnQrCode.addEventListener('click', () => {
  qrModal.style.display = qrModal.style.display === 'none' ? 'flex' : 'none';
});

btnCloseQrModal.addEventListener('click', () => {
  qrModal.style.display = 'none';
});

// ----------------------------------------------------
// Rotate 90 Degrees Button
// ----------------------------------------------------
btnRotate.addEventListener('click', () => {
  currentRotation = (currentRotation + 90) % 360;
  streamImg.className = '';
  if (currentRotation > 0) {
    streamImg.classList.add(`rot-${currentRotation}`);
  }
  showToast(`Rotated to ${currentRotation} degrees`);
});

// ----------------------------------------------------
// Remote Controls (Flip Camera & Torch)
// ----------------------------------------------------
btnFlipCamera.addEventListener('click', async () => {
  try {
    await fetch(`${activeHost}/flip`);
    showToast('Flipping phone camera...');
  } catch (e) {
    showToast('Flip command sent');
  }
});

btnTorch.addEventListener('click', async () => {
  isTorchOn = !isTorchOn;
  try {
    await fetch(`${activeHost}/torch`);
    btnTorch.classList.toggle('active', isTorchOn);
    showToast(isTorchOn ? 'Torch turned on' : 'Torch turned off');
  } catch (e) {
    btnTorch.classList.toggle('active', isTorchOn);
  }
});

// Fullscreen Toggle
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

// ----------------------------------------------------
// ----------------------------------------------------
// Tab Visibility Handler: Prevent background buffer bloat when switching tabs
// ----------------------------------------------------
let wasConnectedBeforeHide = false;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // When switching tabs, disconnect stream so Chrome never buffers unrendered frames in background
    if (isConnected) {
      wasConnectedBeforeHide = true;
      streamImg.src = '';
    }
  } else if (document.visibilityState === 'visible') {
    // When returning to tab, immediately connect fresh to the live stream with 0 lag
    if (wasConnectedBeforeHide && activeHost) {
      wasConnectedBeforeHide = false;
      streamImg.src = `${activeHost}/stream?t=${Date.now()}`;
      setConnected(true);
    }
  }
});

// ----------------------------------------------------
// THE "TRIGGER" BUTTON & GOOGLE LENS AUTOMATION
// ----------------------------------------------------
async function triggerCapture() {
  shutterFlash.classList.add('flash');
  setTimeout(() => shutterFlash.classList.remove('flash'), 100);

  showToast('Capturing crystal-clear frame for Google Lens...');

  // Open placeholder tab immediately inside the user click/hotkey event to avoid popup blockers
  const lensTab = window.open('about:blank', '_blank');

  try {
    let capturedBlob = null;
    try {
      const photoRes = await fetch(`${activeHost}/photo.jpg?t=${Date.now()}`);
      if (photoRes.ok) {
        capturedBlob = await photoRes.blob();
      }
    } catch (e) {}

    if (!capturedBlob && streamImg.naturalWidth > 0) {
      const ctx = captureCanvas.getContext('2d');
      const w = streamImg.naturalWidth;
      const h = streamImg.naturalHeight;
      if (currentRotation === 90 || currentRotation === 270) {
        captureCanvas.width = h;
        captureCanvas.height = w;
      } else {
        captureCanvas.width = w;
        captureCanvas.height = h;
      }
      ctx.save();
      ctx.translate(captureCanvas.width / 2, captureCanvas.height / 2);
      ctx.rotate((currentRotation * Math.PI) / 180);
      ctx.drawImage(streamImg, -w / 2, -h / 2, w, h);
      ctx.restore();

      capturedBlob = await new Promise(res => captureCanvas.toBlob(res, 'image/jpeg', 0.98));
    }

    if (!capturedBlob) {
      if (lensTab) lensTab.close();
      showToast('No active video frame to capture');
      return;
    }

    // Process image rotation if taken from raw photo
    if (currentRotation !== 0) {
      const imgBitmap = await createImageBitmap(capturedBlob);
      const ctx = captureCanvas.getContext('2d');
      if (currentRotation === 90 || currentRotation === 270) {
        captureCanvas.width = imgBitmap.height;
        captureCanvas.height = imgBitmap.width;
      } else {
        captureCanvas.width = imgBitmap.width;
        captureCanvas.height = imgBitmap.height;
      }
      ctx.save();
      ctx.translate(captureCanvas.width / 2, captureCanvas.height / 2);
      ctx.rotate((currentRotation * Math.PI) / 180);
      ctx.drawImage(imgBitmap, -imgBitmap.width / 2, -imgBitmap.height / 2);
      ctx.restore();
      capturedBlob = await new Promise(res => captureCanvas.toBlob(res, 'image/jpeg', 0.98));
    }

    // Copy to browser clipboard directly if supported
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const pngBlob = await new Promise(res => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const cx = c.getContext('2d');
            cx.drawImage(img, 0, 0);
            c.toBlob(res, 'image/png');
          };
          img.src = URL.createObjectURL(capturedBlob);
        });
        if (pngBlob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        }
      }
    } catch (clipErr) {}

    // Dispatch to server for cloud Google Lens resolution and Windows PowerShell clipboard copy
    const activeQuery = (aiPromptInput && aiPromptInput.value.trim()) 
      ? aiPromptInput.value.trim() 
      : 'What is in my screen? Explain in detail';

    dispatchToGoogleLens(capturedBlob, lensTab, activeQuery);

  } catch (err) {
    if (lensTab) lensTab.location.href = 'https://lens.google.com';
    showToast('Capture error. Opening Google Lens...');
  }
}

// UI Elements: Prompts, Drawer & Lens actions
const aiPromptInput = document.getElementById('aiPromptInput');
const pillBtns = document.querySelectorAll('.pill-btn');
const resultsDrawer = document.getElementById('resultsDrawer');
const resultsPreviewImg = document.getElementById('resultsPreviewImg');
const resultsStatusText = document.getElementById('resultsStatusText');
const btnLensResult = document.getElementById('btnLensResult');
const btnGeminiResult = document.getElementById('btnGeminiResult');
const btnBingResult = document.getElementById('btnBingResult');
const btnCloseResults = document.getElementById('btnCloseResults');

if (pillBtns && pillBtns.length > 0) {
  pillBtns.forEach(pill => {
    pill.addEventListener('click', () => {
      pillBtns.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      if (aiPromptInput && pill.dataset.q) {
        aiPromptInput.value = pill.dataset.q;
        showToast(`AI prompt set: ${pill.textContent.trim()}`);
      }
    });
  });
}

if (btnCloseResults) {
  btnCloseResults.addEventListener('click', () => {
    if (resultsDrawer) resultsDrawer.style.display = 'none';
  });
}

function dispatchToGoogleLens(blob, lensTab, query = 'What is in my screen? Explain in detail') {
  // Show Instant Results Drawer immediately on the laptop screen!
  const previewUrl = URL.createObjectURL(blob);
  if (resultsDrawer && resultsPreviewImg) {
    resultsPreviewImg.src = previewUrl;
    resultsDrawer.style.display = 'flex';
  }
  if (resultsStatusText) {
    resultsStatusText.textContent = 'Processing Google AI overview...';
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      showToast('Visual AI analysis in progress...');
      const res = await fetch('/api/trigger-lens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: reader.result, query: query })
      });
      const data = await res.json();
      const lensUrl = data.lensUrl || `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const bingUrl = data.bingUrl || 'https://www.bing.com/visualsearch';
      const geminiUrl = data.geminiUrl || 'https://gemini.google.com';

      if (btnLensResult) btnLensResult.href = lensUrl;
      if (btnBingResult) btnBingResult.href = bingUrl;
      if (btnGeminiResult) btnGeminiResult.href = geminiUrl;

      if (resultsStatusText) {
        resultsStatusText.textContent = 'Copied to Clipboard (Ctrl+V)';
      }

      if (lensTab) {
        lensTab.location.href = lensUrl;
      }
      showToast(data.message || 'Google Lens AI answer ready!');
    } catch (e) {
      if (lensTab) {
        lensTab.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
      showToast('Frame copied! Press Ctrl+V in Google or Gemini.');
    }
  };
  reader.readAsDataURL(blob);
}

btnTrigger.addEventListener('click', triggerCapture);

// Global Keyboard Shortcut: Spacebar triggers capture
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    triggerCapture();
  }
});

// Initialization
loadServerInfo();
connectWebSocket();
