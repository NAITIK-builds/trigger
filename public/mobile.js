// CamLens Mobile Streamer - WebRTC Hardware-Accelerated Engine

const videoPreview = document.getElementById('videoPreview');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const btnFlip = document.getElementById('btnFlip');
const btnTorch = document.getElementById('btnTorch');
const btnStart = document.getElementById('btnStart');
const permissionModal = document.getElementById('permissionModal');
const qualitySelect = document.getElementById('qualitySelect');

let currentStream = null;
let currentTrack = null;
let currentFacingMode = 'environment'; // Rear camera default
let isTorchOn = false;
let ws = null;
let pc = null;
let targetHeight = 720;
let iceCandidateQueue = [];

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ----------------------------------------------------
// Quality Selector
// ----------------------------------------------------
qualitySelect.addEventListener('change', async () => {
  targetHeight = parseInt(qualitySelect.value, 10);
  await startCamera();
  if (pc && pc.connectionState === 'connected') {
    renegotiateStream();
  }
});

// ----------------------------------------------------
// Camera Setup
// ----------------------------------------------------
async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
  }

  const idealWidth = Math.round((targetHeight * 16) / 9);

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: currentFacingMode },
      width: { ideal: idealWidth },
      height: { ideal: targetHeight },
      frameRate: { ideal: 60, min: 30 }
    }
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoPreview.srcObject = currentStream;
    currentTrack = currentStream.getVideoTracks()[0];

    await new Promise(resolve => {
      videoPreview.onloadedmetadata = () => {
        videoPreview.play();
        resolve();
      };
    });

    checkTorchCapabilities();
  } catch (err) {
    alert('Failed to access camera: ' + err.message);
    console.error(err);
  }
}

// ----------------------------------------------------
// Torch / Flashlight Control
// ----------------------------------------------------
function checkTorchCapabilities() {
  if (!currentTrack) return;
  const capabilities = currentTrack.getCapabilities ? currentTrack.getCapabilities() : {};
  btnTorch.style.display = capabilities.torch ? 'flex' : 'none';
}

async function toggleTorch(forceState) {
  if (!currentTrack) return;
  const capabilities = currentTrack.getCapabilities ? currentTrack.getCapabilities() : {};
  if (!capabilities.torch) return;

  isTorchOn = forceState !== undefined ? forceState : !isTorchOn;

  try {
    await currentTrack.applyConstraints({
      advanced: [{ torch: isTorchOn }]
    });
    btnTorch.classList.toggle('active', isTorchOn);
  } catch (e) {
    console.warn('Torch constraint error', e);
  }
}

btnTorch.addEventListener('click', () => toggleTorch());

// ----------------------------------------------------
// Flip Camera (Front / Rear)
// ----------------------------------------------------
async function flipCamera() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  isTorchOn = false;
  btnTorch.classList.remove('active');
  await startCamera();
  renegotiateStream();
}

btnFlip.addEventListener('click', flipCamera);

// ----------------------------------------------------
// WebRTC Hardware Sender
// ----------------------------------------------------
function createPeerConnection() {
  if (pc) {
    pc.close();
  }

  pc = new RTCPeerConnection(rtcConfig);
  iceCandidateQueue = [];

  // Add native camera track to WebRTC pipeline (hardware H.264 encoder)
  if (currentStream) {
    currentStream.getTracks().forEach(track => {
      pc.addTrack(track, currentStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'webrtc_ice',
        candidate: event.candidate
      }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Mobile WebRTC state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      statusBadge.classList.add('live');
      statusText.textContent = 'Hardware Live (60FPS)';
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      statusBadge.classList.remove('live');
      statusText.textContent = 'Reconnecting...';
      setTimeout(startWebRtcOffer, 1500);
    }
  };
}

async function startWebRtcOffer() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  createPeerConnection();

  const offer = await pc.createOffer({
    offerToReceiveAudio: false,
    offerToReceiveVideo: false
  });
  await pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: 'webrtc_offer',
    sdp: pc.localDescription
  }));
}

async function handleWebRtcAnswer(answerSdp) {
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));

  // Flush queued ICE candidates
  while (iceCandidateQueue.length > 0) {
    const cand = iceCandidateQueue.shift();
    await pc.addIceCandidate(cand).catch(console.warn);
  }
}

async function handleWebRtcIce(candidate) {
  if (pc && pc.remoteDescription) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
  } else {
    iceCandidateQueue.push(new RTCIceCandidate(candidate));
  }
}

function renegotiateStream() {
  if (!pc) return;
  const senders = pc.getSenders();
  const videoSender = senders.find(s => s.track && s.track.kind === 'video');
  if (videoSender && currentTrack) {
    videoSender.replaceTrack(currentTrack);
  } else {
    startWebRtcOffer();
  }
}

// ----------------------------------------------------
// WebSocket Signaling
// ----------------------------------------------------
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    statusBadge.classList.add('live');
    statusText.textContent = 'Connected (Starting WebRTC...)';
    ws.send(JSON.stringify({ type: 'register', role: 'sender' }));

    // Start WebRTC handshake with laptop
    startWebRtcOffer();
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'webrtc_answer') {
        await handleWebRtcAnswer(msg.sdp);
      } else if (msg.type === 'webrtc_ice') {
        await handleWebRtcIce(msg.candidate);
      } else if (msg.type === 'control') {
        if (msg.action === 'flip') {
          flipCamera();
        } else if (msg.action === 'torch') {
          toggleTorch(msg.state);
        }
      }
    } catch (e) {
      console.warn('WS message error', e);
    }
  };

  ws.onclose = () => {
    statusBadge.classList.remove('live');
    statusText.textContent = 'Disconnected';
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ----------------------------------------------------
// User Start Trigger
// ----------------------------------------------------
btnStart.addEventListener('click', async () => {
  permissionModal.style.display = 'none';
  await startCamera();
  connectWebSocket();
});
