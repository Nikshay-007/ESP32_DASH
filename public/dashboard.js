// ============================================================
//  FLORA-OS — dashboard.js (UPDATED for your new HTML)
// ============================================================

const CAMERA_STREAM_URL = 'http://192.168.0.118:81/stream';
const ML_SERVER_URL = 'http://localhost:5002';

// ── State ──────────────────────────────────────────────────
let historyA     = [];
let historyB     = [];
let captureCount = 0;
let alertCount   = 0;
let readingCount = 0;
let startTime    = Date.now();
let logEntries   = 2;
let frames       = 0;

// ── DOM refs ───────────────────────────────────────────────
const cam         = document.getElementById('cam');
const termLog     = document.getElementById('terminalLog');

// ============================================================
//  LOGGING
// ============================================================
function log(msg, type = 'info') {
    if (!termLog) return;
    const ts  = new Date().toLocaleTimeString('en-GB');
    const el  = document.createElement('div');
    el.className  = 'log-entry ' + type;
    el.textContent = `[${ts}] > ${msg}`;
    termLog.appendChild(el);
    termLog.scrollTop = termLog.scrollHeight;
    logEntries++;
    const logCount = document.getElementById('logCount');
    if (logCount) logCount.textContent = logEntries + ' ENTRIES';
    if (termLog.children.length > 50) termLog.removeChild(termLog.firstChild);
}

// ============================================================
//  TOAST
// ============================================================
function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className   = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

// ============================================================
//  GAUGE  (SVG stroke-dashoffset)
// ============================================================
const CIRCUMFERENCE = 263.9;

function setGauge(el, pct) {
    if (el) el.style.strokeDashoffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
}

// ============================================================
//  MOISTURE HELPERS
// ============================================================
function moistureLabel(v) {
    if (v < 30) return '🌵 DRY — NEEDS WATER';
    if (v < 60) return '🌿 MODERATE — OK';
    return '🌱 WET — OPTIMAL';
}
function moistureColor(v) {
    if (v < 30) return '#c62828';
    if (v < 60) return '#e65100';
    return '#2e7d32';
}

// ============================================================
//  UPDATE ZONE  (zone = 'A' or 'B')
// ============================================================
function updateZone(zone, value) {
    const pct = Math.min(100, Math.max(0, parseInt(value) || 0));

    const zoneValue = document.getElementById('zone' + zone + 'Value');
    const zoneValMini = document.getElementById('zone' + zone + 'ValMini');
    const bar = document.getElementById('bar' + zone);
    const gauge = document.getElementById('gauge' + zone);
    const statusEl = document.getElementById('zone' + zone + 'Status');
    const badge = document.getElementById('zone' + zone + 'Badge');
    const lastUpdate = document.getElementById('zone' + zone + 'LastUpdate');
    const sensor = document.getElementById('sSensor' + zone);

    if (zoneValue) zoneValue.textContent = pct;
    if (zoneValMini) zoneValMini.textContent = pct + '%';
    if (bar) bar.style.width = pct + '%';
    if (gauge) setGauge(gauge, pct);

    if (statusEl) {
        statusEl.textContent = moistureLabel(pct);
        statusEl.style.color = moistureColor(pct);
    }

    if (badge) {
        badge.textContent = pct < 30 ? '⚠ DRY' : pct < 60 ? '◆ MODERATE' : '✓ OPTIMAL';
    }

    if (lastUpdate) {
        lastUpdate.textContent = 'LAST: ' + new Date().toLocaleTimeString('en-GB');
    }

    const hist = zone === 'A' ? historyA : historyB;
    hist.push(pct);
    if (hist.length > 30) hist.shift();

    if (sensor) {
        sensor.textContent = 'ACTIVE';
        sensor.className = 'sval';
    }
}

// ============================================================
//  FETCH MOISTURE  (every 1 s)
// ============================================================
async function fetchMoistureData() {
    try {
        const res  = await fetch('/data');
        const data = await res.json();

        if (data.moisture !== undefined) {
            const mA = parseInt(data.moisture) || 0;
            updateZone('A', mA);

            // Zone B simulation
            const mB = Math.max(0, Math.min(100, mA + Math.round((Math.random() - 0.5) * 6)));
            updateZone('B', mB);

            readingCount++;
            const qReadings = document.getElementById('qReadings');
            if (qReadings) qReadings.textContent = readingCount;

            if (mA < 30) {
                alertCount++;
                const qAlerts = document.getElementById('qAlerts');
                if (qAlerts) qAlerts.textContent = alertCount;
            }
        }
    } catch (e) {
        const sSensorA = document.getElementById('sSensorA');
        if (sSensorA) {
            sSensorA.textContent = 'OFFLINE';
            sSensorA.className = 'sval err';
        }
    }
}

// ============================================================
//  ML SERVER CONNECTION
// ============================================================
async function checkMLServer() {
    try {
        const response = await fetch(`${ML_SERVER_URL}/api/health-status`);
        if (response.ok) {
            console.log('✅ ML Server connected');
            log('ML SERVER CONNECTED', 'success');
            return true;
        }
    } catch (error) {
        console.log('❌ ML Server not reachable');
        log('ML SERVER OFFLINE - Start python plant_health_pure.py', 'error');
        return false;
    }
}

// ============================================================
//  ANALYZE IMAGE WITH ML
// ============================================================
async function analyzeWithML(filename, zone) {
    log(`🔬 Analyzing ${filename} for zone ${zone}...`, 'info');
    
    try {
        // Get the image file
        const imgResponse = await fetch(`/captures/${filename}`);
        const imgBlob = await imgResponse.blob();
        
        // Create form data
        const formData = new FormData();
        formData.append('image', imgBlob, filename);
        formData.append('zone', zone);
        
        // Send to ML server
        const mlResponse = await fetch(`${ML_SERVER_URL}/api/analyze`, {
            method: 'POST',
            body: formData
        });
        
        if (!mlResponse.ok) {
            throw new Error('ML server error');
        }
        
        const mlResult = await mlResponse.json();
        
        // Update UI with result
        if (mlResult.success) {
            const zoneNum = zone === 'zoneA' ? 'A' : 'B';
            const health = mlResult.health;
            const confidence = mlResult.confidence;
            
            log(`✅ Zone ${zoneNum}: ${health} (${Math.round(confidence*100)}% confidence)`, 'success');
            showToast(`Zone ${zoneNum}: ${health}`, 'success');
            
            // Update the zone display
            updateZoneHealth(zone, health, confidence);
        }
        
    } catch (error) {
        console.error('ML Error:', error);
        log('❌ ML analysis failed - Server not reachable', 'error');
        showToast('ML server offline', 'error');
    }
}

// ============================================================
//  UPDATE ZONE HEALTH DISPLAY
// ============================================================
function updateZoneHealth(zone, health, confidence) {
    const zoneNum = zone === 'zoneA' ? 'A' : 'B';
    const zoneCard = document.querySelector(`.zone-${zoneNum === 'A' ? 'a' : 'b'}`);
    if (!zoneCard) return;
    
    const zoneInfo = zoneCard.querySelector('.zone-info');
    if (!zoneInfo) return;
    
    // Check if health display exists
    let healthDisplay = document.getElementById(`zone${zoneNum}Health`);
    
    if (!healthDisplay) {
        // Create health display
        healthDisplay = document.createElement('div');
        healthDisplay.id = `zone${zoneNum}Health`;
        healthDisplay.style.marginTop = '12px';
        healthDisplay.style.padding = '10px';
        healthDisplay.style.border = '1px solid var(--border)';
        healthDisplay.style.borderRadius = '4px';
        healthDisplay.style.background = zoneNum === 'A' ? 'var(--green-pale)' : '#e3f2fd';
        
        healthDisplay.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.75em; color: var(--text-mid); font-weight: 600;">🌿 PLANT HEALTH</span>
                <span class="health-value" style="font-size: 0.95em; font-weight: bold;"></span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                <span style="font-size: 0.65em; color: var(--text-dim);">confidence</span>
                <span class="health-confidence" style="font-size: 0.65em;"></span>
            </div>
        `;
        
        zoneInfo.appendChild(healthDisplay);
    }
    
    // Update values
    const healthValue = healthDisplay.querySelector('.health-value');
    const healthConfidence = healthDisplay.querySelector('.health-confidence');
    
    if (healthValue) healthValue.textContent = health;
    if (healthConfidence) healthConfidence.textContent = `${Math.round(confidence * 100)}%`;
    
    // Set color based on health
    if (health === 'Healthy') {
        if (healthValue) healthValue.style.color = '#2e7d32';
    } else if (health === 'Needs Water') {
        if (healthValue) healthValue.style.color = '#e65100';
    } else if (health === 'Unhealthy') {
        if (healthValue) healthValue.style.color = '#c62828';
    }
}

// ============================================================
//  CAPTURE IMAGE
// ============================================================
async function captureImage() {
    const btn = document.getElementById('captureBtn');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>CAPTURING</span>';
    log('CAPTURE REQUEST SENT...', 'info');

    try {
        const res = await fetch('/capture');
        const result = await res.json();

        if (result.success) {
            captureCount++;
            const sCaps = document.getElementById('sCaps');
            const qCapture = document.getElementById('qCapture');
            
            if (sCaps) sCaps.textContent = captureCount;
            if (qCapture) qCapture.textContent = new Date().toLocaleTimeString('en-GB');
            
            showToast('✅ ' + result.message, 'success');
            log('IMAGE SAVED: ' + (result.filename || 'unknown'), 'success');
            
            // Ask if user wants to analyze with ML
            if (confirm('Analyze this image?')) {
                const zone = prompt('Which zone? (A or B)', 'A');
                if (zone && (zone.toUpperCase() === 'A' || zone.toUpperCase() === 'B')) {
                    await analyzeWithML(result.filename, `zone${zone.toUpperCase()}`);
                }
            }
        } else {
            showToast('❌ ' + result.message, 'error');
            log('CAPTURE FAILED: ' + result.message, 'error');
        }
    } catch (e) {
        console.error('Capture error:', e);
        showToast('❌ CAPTURE ERROR', 'error');
        log('CAPTURE EXCEPTION: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">📸</span><span>CAPTURE</span>';
    }
}

// ============================================================
//  ADD ML BUTTONS
// ============================================================
function addMLButtons() {
    const btnGrid = document.querySelector('.btn-grid');
    if (!btnGrid) return;
    
    // Check if buttons already exist
    if (document.getElementById('analyzeABtn')) return;
    
    // Zone A analyze button
    const analyzeABtn = document.createElement('button');
    analyzeABtn.id = 'analyzeABtn';
    analyzeABtn.className = 'cmd-btn';
    analyzeABtn.innerHTML = '<span class="btn-icon">🌿</span><span>ANALYZE A</span>';
    analyzeABtn.onclick = async () => {
        const zone = 'zoneA';
        log(`🔬 Manual analyze for Zone A`, 'info');
        
        // First capture image
        const captureRes = await fetch('/capture');
        const captureData = await captureRes.json();
        
        if (captureData.success) {
            await analyzeWithML(captureData.filename, zone);
        }
    };
    
    // Zone B analyze button
    const analyzeBBtn = document.createElement('button');
    analyzeBBtn.id = 'analyzeBBtn';
    analyzeBBtn.className = 'cmd-btn';
    analyzeBBtn.innerHTML = '<span class="btn-icon">🌱</span><span>ANALYZE B</span>';
    analyzeBBtn.onclick = async () => {
        const zone = 'zoneB';
        log(`🔬 Manual analyze for Zone B`, 'info');
        
        // First capture image
        const captureRes = await fetch('/capture');
        const captureData = await captureRes.json();
        
        if (captureData.success) {
            await analyzeWithML(captureData.filename, zone);
        }
    };
    
    btnGrid.appendChild(analyzeABtn);
    btnGrid.appendChild(analyzeBBtn);
    
    log('🌿 ML buttons added', 'success');
}

// ============================================================
//  TEST CAMERA
// ============================================================
async function testCamera() {
    const btn = document.getElementById('testBtn');
    if (!btn) return;
    
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>PINGING</span>';
    log('CAMERA PING INITIATED...', 'info');

    try {
        const res = await fetch('/test-camera');
        const result = await res.json();

        const cameraStatus = document.getElementById('cameraStatus');
        const camDot = document.getElementById('camDot');
        const sCam = document.getElementById('sCam');
        const liveDot = document.getElementById('liveDot');
        const liveText = document.getElementById('liveText');

        if (result.success) {
            if (cameraStatus) cameraStatus.textContent = 'STREAM ACTIVE';
            if (camDot) camDot.style.background = '#2e7d32';
            if (sCam) {
                sCam.textContent = 'ONLINE';
                sCam.className = 'sval';
            }
            if (liveDot) liveDot.style.background = '#2e7d32';
            if (liveText) liveText.textContent = 'STREAMING';
            
            showToast('✅ CAMERA ONLINE', 'success');
            log('CAM-01 PING OK — ' + result.message, 'success');
        } else {
            if (cameraStatus) cameraStatus.textContent = 'OFFLINE';
            if (camDot) camDot.style.background = '#c62828';
            if (sCam) {
                sCam.textContent = 'OFFLINE';
                sCam.className = 'sval err';
            }
            if (liveText) liveText.textContent = 'OFFLINE';
            
            showToast('❌ CAMERA UNREACHABLE', 'error');
            log('CAM-01 PING FAIL', 'error');
        }
    } catch (e) {
        showToast('❌ CAMERA TEST ERROR', 'error');
        log('CAM TEST EXCEPTION: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">🔍</span><span>PING CAM</span>';
    }
}

// ============================================================
//  REFRESH STREAM
// ============================================================
function refreshStream() {
    if (cam) {
        cam.src = CAMERA_STREAM_URL + '?t=' + Date.now();
    }
    log('STREAM REFRESHED', 'info');
    showToast('🔄 REFRESHING STREAM...', 'info');
}

// ============================================================
//  FORCE SYNC
// ============================================================
function forceSync() {
    fetchMoistureData();
    checkMLServer();
    log('MANUAL SYNC TRIGGERED', 'info');
    showToast('📡 SYNCING ALL DATA', 'info');
}

// ============================================================
//  CAMERA EVENTS
// ============================================================
if (cam) {
    cam.onload = function () {
        frames++;
        const frameCount = document.getElementById('frameCount');
        const cameraStatus = document.getElementById('cameraStatus');
        const camDot = document.getElementById('camDot');
        
        if (frameCount) frameCount.textContent = 'FRAMES: ' + frames;
        if (cameraStatus) cameraStatus.textContent = 'STREAM ACTIVE';
        if (camDot) camDot.style.background = '#2e7d32';
    };
    
    cam.onerror = function () {
        const cameraStatus = document.getElementById('cameraStatus');
        const camDot = document.getElementById('camDot');
        
        if (cameraStatus) cameraStatus.textContent = 'STREAM ERROR';
        if (camDot) camDot.style.background = '#c62828';
    };
}

// ============================================================
//  CLOCK & UPTIME
// ============================================================
function updateClock() {
    const systemTime = document.getElementById('systemTime');
    const uptimeStat = document.getElementById('uptimeStat');
    
    if (systemTime) {
        systemTime.textContent = new Date().toLocaleTimeString('en-GB');
    }
    
    const up = Math.floor((Date.now() - startTime) / 1000);
    const h  = Math.floor(up / 3600);
    const m  = Math.floor((up % 3600) / 60);
    const s  = up % 60;
    
    if (uptimeStat) {
        uptimeStat.textContent = 'UPTIME: ' + (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm ' : '') + s + 's';
    }
}

// ============================================================
//  BOOT
// ============================================================
refreshStream();
fetchMoistureData();
setTimeout(testCamera, 800);

setInterval(fetchMoistureData, 1000);
setInterval(updateClock, 1000);

log('SENSOR POLLING STARTED — 1Hz', 'success');
log('ZONES A & B INITIALIZED', 'info');

// Check ML server and add buttons after page loads
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        checkMLServer();
        addMLButtons();
    }, 2000);
});