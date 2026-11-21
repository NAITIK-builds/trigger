const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const CAPTURES_DIR = path.join(__dirname, 'captures');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(CAPTURES_DIR)) {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
}

// ----------------------------------------------------
// Network IP Discovery
// ----------------------------------------------------
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 and non-internal (e.g. 192.168.x.x, 10.x.x.x)
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, ip: net.address });
      }
    }
  }
  return ips;
}

// ----------------------------------------------------
// ADB Detection & Helper
// ----------------------------------------------------
function findAdbPath() {
  const candidatePaths = [
    'adb',
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
    'C:\\Users\\naiti\\AppData\Local\\Android\\Sdk\\platform-tools\\adb.exe'
  ];

  for (const p of candidatePaths) {
    if (p === 'adb') continue; // will check via PATH
    if (fs.existsSync(p)) {
      return `"${p}"`;
    }
  }
  return 'adb';
}

function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim()
      });
    });
  });
}

async function checkAdbStatus() {
  const adb = findAdbPath();
  const res = await runCommand(`${adb} devices`);
  if (!res.success) {
    return { available: false, devices: [], error: res.stderr || 'ADB command failed' };
  }
  const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  const devices = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length >= 2 && parts[1] === 'device') {
      devices.push(parts[0]);
    }
  }
  return { available: true, devices, raw: res.stdout };
}

let lastPairedPhone = null;

function probeIp(ip, timeout = 400) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port: 8080, path: '/', timeout }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        resolve(body.includes('CamLens'));
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ----------------------------------------------------
// High-Speed Public Image Hosting & Google Lens Dispatchers
// ----------------------------------------------------
function uploadToUguu(buffer, filename = 'snapshot.jpg') {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const bodyLength = Buffer.byteLength(header) + buffer.length + Buffer.byteLength(footer);

    const req = https.request({
      hostname: 'uguu.se',
      port: 443,
      path: '/upload.php',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyLength,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CamLens/1.0'
      },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success && json.files && json.files.length > 0 && json.files[0].url) {
            resolve(json.files[0].url);
          } else {
            reject(new Error('Uguu upload failed'));
          }
        } catch (e) {
          reject(new Error('Uguu invalid JSON: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Uguu timeout')); });
    req.write(header);
    req.write(buffer);
    req.write(footer);
    req.end();
  });
}

function uploadToFreeImageHost(base64Data) {
  return new Promise((resolve, reject) => {
    const postData = 'key=6d207e02198a847e53c0a340f472fb3e&action=upload&format=json&source=' + encodeURIComponent(base64Data);

    const req = https.request({
      hostname: 'freeimage.host',
      port: 443,
      path: '/api/1/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status_code === 200 && json.image && json.image.url) {
            resolve(json.image.url);
          } else {
            reject(new Error(json.error ? json.error.message : 'FreeImageHost error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('FreeImageHost timeout')); });
    req.write(postData);
    req.end();
  });
}

function uploadToImgur(base64Data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      image: base64Data,
      type: 'base64'
    });

    const req = https.request({
      hostname: 'api.imgur.com',
      port: 443,
      path: '/3/image',
      method: 'POST',
      headers: {
        'Authorization': 'Client-ID 546c25a59c58ad7',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CamLens/1.0'
      },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success && json.data && json.data.link) {
            resolve(json.data.link);
          } else {
            reject(new Error(json.data ? json.data.error : 'Imgur upload failed'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Imgur timeout')); });
    req.write(postData);
    req.end();
  });
}

function uploadToCatbox(buffer, filename = 'capture.jpg') {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
    const part1 = `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n`;
    const part2 = `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const bodyLength = Buffer.byteLength(part1) + Buffer.byteLength(part2) + buffer.length + Buffer.byteLength(footer);

    const req = https.request({
      hostname: 'catbox.moe',
      port: 443,
      path: '/user/api.php',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyLength,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CamLens/1.0'
      },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data && data.startsWith('http')) {
          resolve(data.trim());
        } else {
          reject(new Error('Catbox error: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Catbox timeout')); });
    req.write(part1);
    req.write(part2);
    req.write(buffer);
    req.write(footer);
    req.end();
  });
}

async function resolveGoogleLensUrl(buffer, base64Data, filename, query = 'what is this image explain in detail') {
  // Strategy: Race high-speed public CDN image hosts (FreeImage.host & Uguu.se).
  // Googlebot downloads the image directly from the public CDN without any session mismatch.
  // This completely eliminates Google's "Expired visual search" error!
  let publicImageUrl = null;

  try {
    publicImageUrl = await new Promise((resolve, reject) => {
      let settled = false;
      let failCount = 0;
      const providers = [
        { name: 'Uguu', promise: uploadToUguu(buffer, filename) },
        { name: 'FreeImage', promise: uploadToFreeImageHost(base64Data) }
      ];

      providers.forEach(p => {
        p.promise.then(url => {
          if (!settled && url) {
            settled = true;
            console.log(`✅ ${p.name} image upload succeeded:`, url);
            resolve(url);
          }
        }).catch(err => {
          console.warn(`${p.name} upload fallback:`, err.message);
          failCount++;
          if (failCount >= providers.length && !settled) {
            // If both primary hosts fail, try Catbox
            uploadToCatbox(buffer, filename).then(catUrl => {
              if (!settled && catUrl) {
                settled = true;
                console.log('✅ Catbox fallback upload succeeded:', catUrl);
                resolve(catUrl);
              } else {
                reject(new Error('All upload providers failed'));
              }
            }).catch(catErr => {
              reject(new Error('All upload providers failed: ' + catErr.message));
            });
          }
        });
      });
    });
  } catch (err) {
    console.warn('Public CDN resolution failed:', err.message);
  }

  if (publicImageUrl) {
    const encodedImg = encodeURIComponent(publicImageUrl);
    const encodedQ = encodeURIComponent(query);
    return {
      url: `https://lens.google.com/uploadbyurl?url=${encodedImg}&hl=en&q=${encodedQ}`,
      bingUrl: `https://www.bing.com/images/search?view=detailv2&iss=sbi&FORM=SBIHMP&sbisrc=UrlPaste&q=imgurl:${encodedImg}`,
      geminiUrl: 'https://gemini.google.com',
      directImageUrl: publicImageUrl,
      mode: 'lens-url',
      message: 'Google Lens AI launched successfully!'
    };
  }

  // Fallback: Opens Google Search with the query pre-filled (Snapshot already copied to Windows Clipboard)
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    bingUrl: 'https://www.bing.com/visualsearch',
    geminiUrl: 'https://gemini.google.com',
    directImageUrl: null,
    mode: 'clipboard',
    message: 'Frame copied to clipboard! Paste in Google Lens or Gemini for instant AI answer.'
  };
}

// ----------------------------------------------------
// Static File Server
// ----------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(data);
  });
}

// ----------------------------------------------------
// HTTP Server & REST API
// ----------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Enable CORS for local testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Phone announces presence (from QR scan or native app)
  if (pathname === '/api/phone-announce' && req.method === 'POST') {
    let cleanIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (cleanIp === '127.0.0.1' || cleanIp === '::1') {
      cleanIp = 'localhost';
    }

    lastPairedPhone = {
      ip: cleanIp,
      host: `http://${cleanIp}:8080`,
      mode: 'wifi',
      timestamp: Date.now()
    };

    console.log(`📱 Phone paired over Wi-Fi! IP: ${cleanIp}`);

    // Notify laptop clients
    broadcastState({
      phoneConnected: true,
      phonePaired: true,
      host: lastPairedPhone.host,
      mode: 'wifi'
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, host: lastPairedPhone.host }));
    return;
  }

  // API: Get latest paired phone status
  if (pathname === '/api/paired-phone' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      paired: lastPairedPhone !== null,
      data: lastPairedPhone
    }));
    return;
  }

  // API: Auto-scan local Wi-Fi subnet for phone running CamLens
  if (pathname === '/api/scan-phone' && req.method === 'POST') {
    const ips = getLocalIPs();
    let foundHost = null;

    for (const item of ips) {
      if (foundHost) break;
      const parts = item.ip.split('.');
      if (parts.length === 4) {
        const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
        const myOctet = parseInt(parts[3], 10);

        const octets = [];
        for (let i = 1; i <= 254; i++) {
          if (i !== myOctet) octets.push(i);
        }

        // Scan in balanced batches of 30 to avoid overwhelming network stack
        const BATCH = 30;
        for (let b = 0; b < octets.length; b += BATCH) {
          if (foundHost) break;
          const slice = octets.slice(b, b + BATCH);
          await Promise.all(slice.map(oct => {
            const testIp = prefix + oct;
            return probeIp(testIp, 800).then(isCam => {
              if (isCam && !foundHost) {
                foundHost = `http://${testIp}:8080`;
              }
            });
          }));
        }
      }
    }

    if (foundHost) {
      lastPairedPhone = { host: foundHost, mode: 'wifi', timestamp: Date.now() };
      broadcastState({ phoneConnected: true, phonePaired: true, host: foundHost, mode: 'wifi' });
      console.log(`🔍 Auto-discovered phone on Wi-Fi at: ${foundHost}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ found: !!foundHost, host: foundHost }));
    return;
  }

  // API: Download CamLens.apk directly to phone
  if (pathname === '/download' || pathname === '/CamLens.apk') {
    const apkPath = path.join(__dirname, 'CamLens.apk');
    if (fs.existsSync(apkPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="CamLens.apk"',
        'Content-Length': fs.statSync(apkPath).size
      });
      fs.createReadStream(apkPath).pipe(res);
      return;
    }
  }

  // API: Get Info (IPs, Ports, ADB status)
  if (pathname === '/api/info' && req.method === 'GET') {
    const ips = getLocalIPs();
    const adb = await checkAdbStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      port: PORT,
      ips,
      adb
    }));
    return;
  }

  // API: Setup USB forward for native Android App
  if (pathname === '/api/usb-forward' && req.method === 'POST') {
    const adb = findAdbPath();
    const forwardRes = await runCommand(`${adb} forward tcp:8080 tcp:8080`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: forwardRes.success,
      output: forwardRes.stdout || forwardRes.stderr
    }));
    return;
  }

  // API: Trigger Lens & Save Snapshot Image (with Clipboard Copy & Direct Lens Search)
  if ((pathname === '/api/trigger-lens' || pathname === '/api/save-capture') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const json = JSON.parse(body);
        if (!json.image) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No image data provided' }));
          return;
        }

        const base64Data = json.image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `snapshot_${Date.now()}.jpg`;
        const filePath = path.join(CAPTURES_DIR, filename);

        fs.writeFile(filePath, buffer, async (writeErr) => {
          if (writeErr) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to write file' }));
            return;
          }

          // Copy both as image bitmap and file path to Windows Clipboard
          const escapedPath = filePath.replace(/'/g, "''");
          const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; try { $img = [System.Drawing.Image]::FromFile('${escapedPath}'); [System.Windows.Forms.Clipboard]::SetImage($img); } catch {}; try { Set-Clipboard -Path '${escapedPath}'; } catch {}"`;
          exec(psCommand, { windowsHide: true }, () => {});

          const query = json.query || 'what is this image explain in detail';
          const lensInfo = await resolveGoogleLensUrl(buffer, base64Data, filename, query);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            filename,
            url: `/captures/${filename}`,
            size: buffer.length,
            lensUrl: lensInfo.url,
            bingUrl: lensInfo.bingUrl,
            geminiUrl: lensInfo.geminiUrl,
            directImageUrl: lensInfo.directImageUrl,
            lensMode: lensInfo.mode,
            message: lensInfo.message
          }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // API: Get Recent Captures
  if (pathname === '/api/captures' && req.method === 'GET') {
    fs.readdir(CAPTURES_DIR, (err, files) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      const jpgFiles = files.filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'));
      const list = jpgFiles.map(file => {
        const stat = fs.statSync(path.join(CAPTURES_DIR, file));
        return {
          filename: file,
          url: `/captures/${file}`,
          time: stat.mtimeMs
        };
      }).sort((a, b) => b.time - a.time);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list.slice(0, 20))); // last 20
    });
    return;
  }

  // Serve Captures folder
  if (pathname.startsWith('/captures/')) {
    const filename = path.basename(pathname);
    const filePath = path.join(CAPTURES_DIR, filename);
    serveStatic(req, res, filePath);
    return;
  }

  // API: Connect portal
  if (pathname === '/connect') {
    serveStatic(req, res, path.join(PUBLIC_DIR, 'connect.html'));
    return;
  }

  // Serve Public static files
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  } else if (safePath === '/connect' || safePath === '\\connect') {
    safePath = '/connect.html';
  }
  const filePath = path.join(PUBLIC_DIR, safePath);
  serveStatic(req, res, filePath);
});

// ----------------------------------------------------
// Pure Node.js RFC 6455 WebSocket Implementation
// ----------------------------------------------------
const clients = new Set();
let senderClient = null; // Mobile phone sender

function encodeWsFrame(data, isBinary = false) {
  let payload = isBinary ? data : Buffer.from(data, 'utf8');
  let length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.alloc(2);
    header[0] = isBinary ? 0x82 : 0x81;
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = isBinary ? 0x82 : 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = isBinary ? 0x82 : 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const digest = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${digest}\r\n\r\n`
  );

  const client = {
    socket,
    role: null,
    alive: true,
    send: function (data, isBinary = false) {
      if (socket.writable) {
        socket.write(encodeWsFrame(data, isBinary));
      }
    }
  };

  clients.add(client);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffer.length < offset + 2) break;
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) break;
        payloadLength = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey = null;
      if (isMasked) {
        if (buffer.length < offset + 4) break;
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLength) break;

      let payload = buffer.slice(offset, offset + payloadLength);
      buffer = buffer.slice(offset + payloadLength);

      if (isMasked && maskKey) {
        const unmasked = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }

      // Handle Opcodes
      if (opcode === 0x08) {
        // Close
        socket.end();
        break;
      } else if (opcode === 0x09) {
        // Ping -> respond Pong
        socket.write(Buffer.from([0x8a, 0x00]));
      } else if (opcode === 0x01) {
        // Text frame
        handleTextMessage(client, payload.toString('utf8'));
      } else if (opcode === 0x02) {
        // Binary frame (Camera JPEG / WebP frame from phone)
        handleBinaryFrame(client, payload);
      }
    }
  });

  socket.on('close', () => {
    clients.delete(client);
    if (client === senderClient) {
      senderClient = null;
      broadcastState({ phoneConnected: false });
      console.log('📱 Phone camera disconnected');
    }
  });

  socket.on('error', () => {
    clients.delete(client);
    if (client === senderClient) {
      senderClient = null;
      broadcastState({ phoneConnected: false });
    }
  });
});

function handleTextMessage(client, text) {
  try {
    const msg = JSON.parse(text);

    if (msg.type === 'register') {
      client.role = msg.role;
      if (msg.role === 'sender') {
        senderClient = client;
        console.log('📱 Phone camera connected (WebRTC Sender)!');
        broadcastState({ phoneConnected: true });
      } else {
        // Receiver (laptop)
        client.send(JSON.stringify({
          type: 'state',
          phoneConnected: senderClient !== null
        }));
      }
    } else if (msg.type === 'control') {
      // Forward camera control (flip, torch, etc.) from laptop to phone
      if (senderClient && senderClient.socket.writable) {
        senderClient.send(text);
      }
    } else if (msg.type.startsWith('webrtc_')) {
      // WebRTC Signaling: offer, answer, ice candidate
      if (client === senderClient) {
        // From phone -> send to all laptop receivers
        for (const c of clients) {
          if (c.role === 'receiver' && c.socket.writable) {
            c.send(text);
          }
        }
      } else {
        // From laptop receiver -> send to phone
        if (senderClient && senderClient.socket.writable) {
          senderClient.send(text);
        }
      }
    }
  } catch (e) {
    // ignore malformed JSON
  }
}

function handleBinaryFrame(client, binaryBuffer) {
  // If frame came from phone, broadcast immediately to all receiver clients
  if (client === senderClient) {
    const frame = encodeWsFrame(binaryBuffer, true);
    for (const c of clients) {
      if (c.role === 'receiver' && c.socket.writable) {
        c.socket.write(frame);
      }
    }
  }
}

function broadcastState(stateObj) {
  const msg = JSON.stringify({ type: 'state', ...stateObj });
  for (const c of clients) {
    if (c.role === 'receiver') {
      c.send(msg);
    }
  }
}

// ----------------------------------------------------
// Start Server with Graceful Port Handling
// ----------------------------------------------------
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`\n⚠️  Port ${PORT} is in use. Trying port ${PORT + 1}...`);
    setTimeout(() => {
      server.listen(PORT + 1, '0.0.0.0');
    }, 1000);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n======================================================');
  console.log('  🎥 CamLens Server Running!');
  console.log('======================================================');
  console.log(`  💻 Laptop Interface : http://localhost:${PORT}`);
  console.log(`  🔌 USB ADB Address  : http://localhost:${PORT}/mobile.html`);
  if (ips.length > 0) {
    console.log('  📶 Wi-Fi Addresses  :');
    ips.forEach(i => console.log(`      -> http://${i.ip}:${PORT}/mobile.html (${i.name})`));
  }
  console.log('======================================================\n');
});
