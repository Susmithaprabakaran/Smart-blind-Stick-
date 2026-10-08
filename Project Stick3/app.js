/* ============================================================================
   VISION-OPS · app.js
   Features:
     · Webcam & ESP32-CAM detection (COCO-SSD TF.js)
     · Commands: MOVE / STOP / DANGER (type + size logic)
     · Person safety analysis (real-time)
     · Live video recording + download
     · Command history (searchable, filterable, CSV export)
     · Data analytics: charts (donut, line, bar, scatter) + table + PNG export
     · Voice announcements (Web Speech API)
============================================================================ */
(() => {
  'use strict';

  // ── DOM ──────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const video       = $('video');
  const esp32Img    = $('esp32Img');
  const overlay     = $('overlay');
  const ctx         = overlay.getContext('2d');

  // controls
  const startBtn          = $('startBtn');
  const stopBtn           = $('stopBtn');
  const connectEspBtn     = $('connectEspBtn');
  const esp32Url          = $('esp32Url');
  const esp32Panel        = $('esp32Panel');
  const webcamPanel       = $('webcamPanel');
  const facingMode        = $('facingMode');
  const downloadVideoBtn  = $('downloadVideoBtn');
  const useTypeLogic      = $('useTypeLogic');
  const useSizeLogic      = $('useSizeLogic');
  const useSpeech         = $('useSpeech');
  const confSlider        = $('confSlider');
  const confVal           = $('confVal');

  // hud / status
  const modelStatus = $('modelStatus');
  const fpsBadge    = $('fpsBadge');
  const srcBadge    = $('srcBadge');
  const objBadge    = $('objBadge');
  const liveDot     = $('liveDot');
  const resBadge    = $('resBadge');
  const timeBadge   = $('timeBadge');
  const srcHud      = $('srcHud');
  const recHud      = $('recHud');
  const statusOv    = $('statusOverlay');

  // command
  const cmdBanner   = $('commandBanner');
  const cmdText     = $('cmdText');
  const cmdIcon     = $('cmdIcon');
  const cmdReason   = $('cmdReason');
  const bccValue    = $('bccValue');
  const bccMeta     = $('bccMeta');
  const bccIndicator= $('bccIndicator');
  const bccConfFill = $('bccConfFill');
  const mcMove      = $('mcMove');
  const mcStop      = $('mcStop');
  const mcDanger    = $('mcDanger');
  const mcMoveVal   = $('mcMoveVal');
  const mcStopVal   = $('mcStopVal');
  const mcDangerVal = $('mcDangerVal');
  const objList     = $('objectsList');
  const logFeed     = $('logFeed');
  const personSafety= $('personSafety');
  const psStatus    = $('psStatus');
  const psReason    = $('psReason');

  // stats
  const statTotal  = $('statTotal');
  const statDanger = $('statDanger');
  const statStop   = $('statStop');
  const statMove   = $('statMove');

  // history
  const historyBody   = $('historyBody');
  const historyCount  = $('historyCount');
  const historySearch = $('historySearch');
  const historyFilter = $('historyFilter');
  const downloadHistBtn  = $('downloadHistoryBtn');
  const clearHistBtn     = $('clearHistoryBtn');

  // analytics
  const analyticsBody     = $('analyticsBody');
  const downloadAnalBtn   = $('downloadAnalyticsBtn');
  const downloadChartsBtn = $('downloadChartsBtn');
  const anTotalDanger  = $('anTotalDanger');
  const anTotalStop    = $('anTotalStop');
  const anTotalMove    = $('anTotalMove');
  const anPersonSafe   = $('anPersonSafe');
  const anPersonUnsafe = $('anPersonUnsafe');

  // ── Config ───────────────────────────────────────────────────────────────
  const TYPE_DANGER = new Set(['car','truck','bus','motorcycle','bicycle','train','airplane']);
  const TYPE_STOP   = new Set(['person','dog','cat','horse','sheep','cow','bear','elephant']);
  const SIZE_DANGER  = 0.30;
  const SIZE_STOP    = 0.10;
  const SEVERITY     = { MOVE: 0, STOP: 1, DANGER: 2 };
  const COLORS = {
    MOVE:   { stroke: '#00e87a', fill: 'rgba(0,232,122,0.12)' },
    STOP:   { stroke: '#ffc940', fill: 'rgba(255,201,64,0.15)' },
    DANGER: { stroke: '#ff3c5a', fill: 'rgba(255,60,90,0.18)' },
  };
  const ICONS = { MOVE: '●', STOP: '■', DANGER: '⚠' };

  // ── State ────────────────────────────────────────────────────────────────
  let model         = null;
  let activeSource  = 'webcam';
  let stream        = null;
  let mediaRecorder = null;
  let recordChunks  = [];
  let running       = false;
  let rafId         = null;
  let esp32Canvas   = null;

  let lastCommand   = null;
  let lastSpoken    = { cmd: null, t: 0 };
  let frameTimes    = [];
  let sessionStart  = null;
  let timerInterval = null;

  // session counters
  let counts = { MOVE: 0, STOP: 0, DANGER: 0 };

  // command history (full records)
  let history = [];     // {id, time, timestamp, cmd, obj, conf, proximity, personSafety, duration, direction}
  let lastCmdStart = null;
  let lastCmdRecord = null;

  // analytics chart instances
  let charts = {};

  // ── Boot ─────────────────────────────────────────────────────────────────
  (async function boot() {
    try {
      modelStatus.textContent = '⟳ LOADING MODEL…';
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      modelStatus.textContent = '✓ MODEL READY';
      modelStatus.style.color = 'var(--green)';
      log('info', 'COCO-SSD lite_mobilenet_v2 loaded.');
    } catch (e) {
      modelStatus.textContent = '✗ MODEL FAILED';
      modelStatus.style.color = 'var(--red)';
      log('danger', 'Model load error: ' + e.message);
    }
  })();

  // ── Tab system ───────────────────────────────────────────────────────────
  document.querySelectorAll('.mtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mtab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'analytics') refreshAnalytics();
    });
  });

  // ── Source tabs ──────────────────────────────────────────────────────────
  document.querySelectorAll('.stab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (running) return;
      document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSource = btn.dataset.source;
      if (activeSource === 'esp32') {
        esp32Panel.classList.remove('hidden');
        webcamPanel.classList.add('hidden');
      } else {
        esp32Panel.classList.add('hidden');
        webcamPanel.classList.remove('hidden');
      }
    });
  });

  connectEspBtn.addEventListener('click', () => {
    const urlRaw = esp32Url.value.trim();
    if (!urlRaw) { alert('Enter ESP32-CAM stream URL'); return; }
    const url = normalizeEsp32Url(urlRaw);
    esp32Url.value = url;
    setupESP32Image(url).catch(e => {
      alert('ESP32 connect failed: ' + e.message);
    });
  });

  // ── Confidence slider ────────────────────────────────────────────────────
  confSlider.addEventListener('input', () => {
    confVal.textContent = confSlider.value + '%';
  });

  // ── Start / Stop ─────────────────────────────────────────────────────────
  startBtn.addEventListener('click', startDetection);
  stopBtn.addEventListener('click', stopDetection);

  async function startDetection() {
    if (!model) { log('danger', 'Model not ready.'); return; }
    try {
      if (activeSource === 'webcam') await startWebcam();
      else await startESP32();
      running = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      statusOv.classList.add('hidden');
      liveDot.classList.add('on');
      recHud.textContent = '⏺ REC';
      sessionStart = Date.now();
      timerInterval = setInterval(updateTimer, 1000);
      counts = { MOVE: 0, STOP: 0, DANGER: 0 };
      log('info', 'Detection started — ' + activeSource.toUpperCase());
      detectLoop();
    } catch (e) {
      log('danger', 'Start failed: ' + e.message);
      alert('Could not start: ' + e.message);
    }
  }

  function stopDetection() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(timerInterval);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    video.srcObject = null;
    esp32Img.src = ''; esp32Img.style.display = 'none';
    video.style.display = 'block';
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    cmdBanner.classList.add('hidden');
    statusOv.classList.remove('hidden');
    liveDot.classList.remove('on');
    recHud.textContent = '⏹ STOPPED';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setCommandCard('IDLE', 'session ended', 'idle');
    personSafety.style.display = 'none';
    fpsBadge.textContent = '-- FPS';
    srcBadge.textContent = 'SRC: --';
    objBadge.textContent = '0 OBJ';
    log('info', 'Detection stopped.');
  }

  async function startWebcam() {
    esp32Img.style.display = 'none';
    video.style.display = 'block';
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width:{ideal:1280}, height:{ideal:720}, facingMode: facingMode.value },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise(res => { video.onloadedmetadata = res; });
    overlay.width  = video.videoWidth;
    overlay.height = video.videoHeight;
    resBadge.textContent = `${video.videoWidth} × ${video.videoHeight}`;
    srcBadge.textContent = 'SRC: WEBCAM';
    srcHud.textContent   = 'WEBCAM';
    startRecording(stream);
  }

  async function startESP32() {
    const urlRaw = esp32Url.value.trim();
    if (!urlRaw) throw new Error('ESP32-CAM URL is required');
    const url = normalizeEsp32Url(urlRaw);
    esp32Url.value = url;
    esp32Canvas = document.createElement('canvas');
    await setupESP32Image(url);
    srcBadge.textContent = 'SRC: ESP32';
    srcHud.textContent   = 'ESP32-CAM';
  }

  function normalizeEsp32Url(url) {
    try {
      const trimmed = url.trim();
      if (!trimmed) return trimmed;
      const hasProto = /^https?:\/\//i.test(trimmed);
      const normalized = hasProto ? trimmed : 'http://' + trimmed;
      const parsed = new URL(normalized);
      if (parsed.pathname === '' || parsed.pathname === '/') {
        parsed.pathname = '/stream';
      }
      return parsed.toString();
    } catch (_e) {
      return url;
    }
  }

  function setupESP32Image(url) {
    return new Promise((resolve, reject) => {
      video.style.display = 'none';
      esp32Img.style.display = 'block';
      const onLoad = () => {
        const w = esp32Img.naturalWidth  || 640;
        const h = esp32Img.naturalHeight || 480;
        overlay.width = w; overlay.height = h;
        if (esp32Canvas) { esp32Canvas.width = w; esp32Canvas.height = h; }
        resBadge.textContent = `${w} × ${h}`;
        esp32Img.removeEventListener('load', onLoad);
        esp32Img.removeEventListener('error', onErr);
        log('info', 'ESP32-CAM connected: ' + url);
        resolve();
      };
      const onErr = () => {
        esp32Img.removeEventListener('load', onLoad);
        esp32Img.removeEventListener('error', onErr);
        reject(new Error('Cannot load ESP32-CAM stream. Check URL, stream path, and CORS headers.'));
      };
      esp32Img.addEventListener('load', onLoad);
      esp32Img.addEventListener('error', onErr);
      esp32Img.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    });
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  function startRecording(str) {
    recordChunks = [];
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      mediaRecorder = new MediaRecorder(str, { mimeType });
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordChunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'visionops_recording_' + Date.now() + '.webm';
        a.click(); URL.revokeObjectURL(url);
        downloadVideoBtn.disabled = true;
      };
      mediaRecorder.start(1000);
      downloadVideoBtn.disabled = false;
      downloadVideoBtn.onclick = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      };
    } catch (e) {
      log('info', 'Recording unavailable: ' + e.message);
    }
  }

  // ── Timer ─────────────────────────────────────────────────────────────────
  function updateTimer() {
    if (!sessionStart) return;
    const sec = Math.floor((Date.now() - sessionStart) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    timeBadge.textContent = m + ':' + s;
  }

  // ── Detection loop ────────────────────────────────────────────────────────
  async function detectLoop() {
    if (!running) return;
    const t0 = performance.now();
    try {
      const threshold = parseInt(confSlider.value) / 100;
      let preds = [];
      if (activeSource === 'webcam') {
        if (video.readyState >= 2) preds = await model.detect(video, 20);
      } else {
        if (esp32Canvas && esp32Img.complete && esp32Img.naturalWidth > 0) {
          const c = esp32Canvas;
          c.getContext('2d').drawImage(esp32Img, 0, 0, c.width, c.height);
          preds = await model.detect(c, 20);
        }
      }
      // filter by conf
      preds = preds.filter(p => p.score >= threshold);

      const cmd = computeCommand(preds, overlay.width, overlay.height);
      drawDetections(preds);
      updateTelemetry(preds, cmd);
      handleCommand(cmd);

    } catch (_) {}

    // FPS
    const t1 = performance.now();
    frameTimes.push(t1 - t0);
    if (frameTimes.length > 20) frameTimes.shift();
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    fpsBadge.textContent = (1000 / avg).toFixed(1) + ' FPS';

    rafId = requestAnimationFrame(detectLoop);
  }

  // ── Command computation ───────────────────────────────────────────────────
  function computeCommand(preds, W, H) {
    const area = W * H;
    let best = { level: 'MOVE', reason: 'path clear', obj: null, conf: 1, ratio: 0, direction: 'center' };

    for (const p of preds) {
      const [x, y, w, h] = p.bbox;
      const ratio = (w * h) / area;
      const cx    = x + w / 2;
      const dir   = cx < W / 3 ? 'left' : cx > 2 * W / 3 ? 'right' : 'center';
      let level   = 'MOVE';
      let reason  = '';

      if (useTypeLogic.checked) {
        if (TYPE_DANGER.has(p.class))      { level = 'DANGER'; reason = p.class + ' detected ' + dir; }
        else if (TYPE_STOP.has(p.class))   { level = 'STOP';   reason = p.class + ' ahead ' + dir; }
      }
      if (useSizeLogic.checked) {
        if (ratio >= SIZE_DANGER && SEVERITY['DANGER'] > SEVERITY[level]) {
          level = 'DANGER'; reason = p.class + ' very close (' + (ratio*100).toFixed(0) + '%)';
        } else if (ratio >= SIZE_STOP && SEVERITY['STOP'] > SEVERITY[level]) {
          level = 'STOP'; reason = p.class + ' approaching (' + (ratio*100).toFixed(0) + '%)';
        }
      }
      p._level = level;
      p._ratio = ratio;
      p._dir   = dir;

      if (SEVERITY[level] > SEVERITY[best.level]) {
        best = { level, reason, obj: p.class, conf: p.score, ratio, direction: dir };
      }
    }
    return best;
  }

  // ── Draw detections ───────────────────────────────────────────────────────
  function drawDetections(preds) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.font = 'bold 13px "DM Mono", monospace';
    ctx.lineWidth = 2;
    for (const p of preds) {
      const [x, y, w, h] = p.bbox;
      const lvl = p._level || 'MOVE';
      const c   = COLORS[lvl];

      // fill + stroke
      ctx.strokeStyle = c.stroke;
      ctx.fillStyle   = c.fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      // corner ticks
      const tk = 12;
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y+tk); ctx.lineTo(x,y); ctx.lineTo(x+tk,y);
      ctx.moveTo(x+w-tk,y); ctx.lineTo(x+w,y); ctx.lineTo(x+w,y+tk);
      ctx.moveTo(x,y+h-tk); ctx.lineTo(x,y+h); ctx.lineTo(x+tk,y+h);
      ctx.moveTo(x+w-tk,y+h); ctx.lineTo(x+w,y+h); ctx.lineTo(x+w,y+h-tk);
      ctx.stroke();
      ctx.lineWidth = 2;

      // label
      const label = p.class.toUpperCase() + '  ' + (p.score*100).toFixed(0) + '%  [' + lvl + ']';
      const tw = ctx.measureText(label).width;
      const ly = y > 24 ? y - 24 : y + h + 4;
      ctx.fillStyle = c.stroke;
      ctx.fillRect(x, ly, tw + 14, 22);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 7, ly + 15);

      // direction badge
      ctx.font = '10px "DM Mono", monospace';
      ctx.fillStyle = c.stroke + 'cc';
      ctx.fillText('◀ ' + (p._dir || '').toUpperCase() + ' ▶', x + 4, y + h - 6);
      ctx.font = 'bold 13px "DM Mono", monospace';
    }
  }

  // ── Telemetry update ──────────────────────────────────────────────────────
  function updateTelemetry(preds, cmd) {
    objBadge.textContent = preds.length + ' OBJ';

    if (!preds.length) {
      objList.innerHTML = '<li class="muted-li">— none —</li>';
    } else {
      objList.innerHTML = preds
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(p => `<li>
          <span class="obj-cls">${esc(p.class)}</span>
          <span class="obj-meta">${(p.score*100).toFixed(0)}% · ${((p._ratio||0)*100).toFixed(1)}% · ${p._dir||''}</span>
        </li>`).join('');
    }

    // Person safety
    const personPreds = preds.filter(p => p.class === 'person');
    if (personPreds.length > 0) {
      personSafety.style.display = 'flex';
      const dangerPerson = personPreds.find(p => p._level === 'DANGER');
      const stopPerson   = personPreds.find(p => p._level === 'STOP');
      if (dangerPerson) {
        psStatus.textContent = 'UNSAFE';
        psStatus.className   = 'ps-status unsafe';
        psReason.textContent = 'person in danger zone (' + (dangerPerson._ratio*100).toFixed(0) + '% of frame)';
      } else if (stopPerson) {
        psStatus.textContent = 'CAUTION';
        psStatus.className   = 'ps-status unsafe';
        psReason.textContent = 'person approaching (' + (stopPerson._ratio*100).toFixed(0) + '% of frame)';
      } else {
        psStatus.textContent = 'SAFE';
        psStatus.className   = 'ps-status safe';
        psReason.textContent = 'person at safe distance';
      }
    } else {
      personSafety.style.display = 'none';
    }
  }

  // ── Command side effects ──────────────────────────────────────────────────
  function handleCommand(cmd) {
    const { level, reason } = cmd;
    const now = performance.now();
    const isTransition = level !== lastCommand;
    const dangerRepeat = level === 'DANGER' && (now - lastSpoken.t) > 4000;

    // Update banner
    cmdBanner.classList.remove('hidden', 'cmd-move', 'cmd-stop', 'cmd-danger');
    cmdBanner.classList.add('cmd-' + level.toLowerCase());
    cmdText.textContent   = level;
    cmdIcon.textContent   = ICONS[level];
    cmdReason.textContent = reason || '';

    // Card
    setCommandCard(level, reason, level.toLowerCase());

    // Mini cards
    mcMove.classList.remove('mc-active-move');
    mcStop.classList.remove('mc-active-stop');
    mcDanger.classList.remove('mc-active-danger');
    if (level === 'MOVE')   { mcMove.classList.add('mc-active-move');     mcMoveVal.textContent   = (cmd.conf*100).toFixed(0)+'%'; }
    if (level === 'STOP')   { mcStop.classList.add('mc-active-stop');     mcStopVal.textContent   = (cmd.conf*100).toFixed(0)+'%'; }
    if (level === 'DANGER') { mcDanger.classList.add('mc-active-danger'); mcDangerVal.textContent = (cmd.conf*100).toFixed(0)+'%'; }

    // Transition
    if (isTransition || dangerRepeat) {
      if (isTransition) {
        counts[level]++;
        updateStats();

        // finalize previous record duration
        if (lastCmdRecord && lastCmdStart) {
          lastCmdRecord.duration = ((Date.now() - lastCmdStart) / 1000).toFixed(1);
        }

        // person safety status
        let personSafetyStatus = 'N/A';
        if (psStatus.textContent === 'SAFE')    personSafetyStatus = 'SAFE';
        if (psStatus.textContent === 'CAUTION') personSafetyStatus = 'CAUTION';
        if (psStatus.textContent === 'UNSAFE')  personSafetyStatus = 'UNSAFE';

        const record = {
          id:           history.length + 1,
          time:         new Date().toLocaleTimeString(),
          timestamp:    Date.now(),
          cmd:          level,
          obj:          cmd.obj || 'none',
          conf:         (cmd.conf * 100).toFixed(1),
          proximity:    (cmd.ratio * 100).toFixed(1),
          personSafety: personSafetyStatus,
          duration:     '—',
          direction:    cmd.direction || 'center',
        };
        history.push(record);
        lastCmdRecord = record;
        lastCmdStart  = Date.now();

        log(level.toLowerCase(), level + ' — ' + (reason || 'path clear'));
        renderHistory();
      }

      if (useSpeech.checked && (now - lastSpoken.t) > 1500) {
        speak(
          level === 'DANGER' ? 'Danger! ' + (reason || '') :
          level === 'STOP'   ? 'Stop. '   + (reason || '') : 'Move.'
        );
        lastSpoken = { cmd: level, t: now };
      }
    }

    lastCommand = level;
  }

  function setCommandCard(value, meta, klass) {
    bccValue.textContent = value;
    bccMeta.textContent  = meta || '—';
    bccValue.className   = 'bcc-value' + (klass !== 'idle' ? ' v-' + klass : '');
    bccIndicator.className = 'bcc-indicator' + (klass !== 'idle' ? ' ind-' + klass : '');
    const colors = { move: 'var(--green)', stop: 'var(--yellow)', danger: 'var(--red)', idle: 'var(--muted)' };
    bccConfFill.style.background = colors[klass] || 'var(--muted)';
    bccConfFill.style.width = klass !== 'idle' ? '80%' : '0%';
  }

  function updateStats() {
    const total = counts.MOVE + counts.STOP + counts.DANGER;
    statTotal.textContent  = total;
    statDanger.textContent = counts.DANGER;
    statStop.textContent   = counts.STOP;
    statMove.textContent   = counts.MOVE;
  }

  // ── Speech ────────────────────────────────────────────────────────────────
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1.0; u.volume = 1.0;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  // ── Log ───────────────────────────────────────────────────────────────────
  function log(level, msg) {
    const ts   = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'll ll-' + level;
    line.innerHTML = `<span class="ts">${ts}</span>${esc(msg)}`;
    logFeed.prepend(line);
    while (logFeed.childNodes.length > 100) logFeed.removeChild(logFeed.lastChild);
  }

  // ── History rendering ─────────────────────────────────────────────────────
  function renderHistory() {
    const search  = (historySearch.value || '').toLowerCase();
    const filter  = historyFilter.value;

    const filtered = history.filter(r => {
      const matchFilter = filter === 'all' || r.cmd === filter;
      const matchSearch = !search ||
        r.obj.toLowerCase().includes(search) ||
        r.cmd.toLowerCase().includes(search) ||
        r.time.toLowerCase().includes(search);
      return matchFilter && matchSearch;
    }).slice().reverse();

    historyCount.textContent = filtered.length + ' records';

    if (!filtered.length) {
      historyBody.innerHTML = '<tr class="empty-row"><td colspan="9">No matching records.</td></tr>';
      return;
    }

    const safetyBadge = s => {
      if (s === 'SAFE')    return '<span class="safe-badge">✓ SAFE</span>';
      if (s === 'CAUTION') return '<span class="unsafe-badge">⚠ CAUTION</span>';
      if (s === 'UNSAFE')  return '<span class="unsafe-badge">✗ UNSAFE</span>';
      return '<span class="na-badge">—</span>';
    };

    historyBody.innerHTML = filtered.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.time}</td>
        <td><span class="cmd-badge b-${r.cmd.toLowerCase()}">${r.cmd}</span></td>
        <td>${esc(r.obj)}</td>
        <td>${r.conf}%</td>
        <td>${r.proximity}%</td>
        <td>${safetyBadge(r.personSafety)}</td>
        <td>${r.duration}</td>
        <td>${r.direction}</td>
      </tr>
    `).join('');
  }

  historySearch.addEventListener('input', renderHistory);
  historyFilter.addEventListener('change', renderHistory);

  clearHistBtn.addEventListener('click', () => {
    if (!confirm('Clear all history?')) return;
    history = []; counts = { MOVE:0, STOP:0, DANGER:0 };
    updateStats(); renderHistory();
    log('info', 'History cleared.');
  });

  downloadHistBtn.addEventListener('click', () => {
    if (!history.length) { alert('No history to export.'); return; }
    const header = ['#','Time','Command','Object','Confidence%','Proximity%','PersonSafety','Duration(s)','Direction'];
    const rows   = history.map(r => [r.id, r.time, r.cmd, r.obj, r.conf, r.proximity, r.personSafety, r.duration, r.direction]);
    downloadCSV([header, ...rows], 'visionops_history_' + Date.now() + '.csv');
  });

  // ── Analytics ─────────────────────────────────────────────────────────────
  function refreshAnalytics() {
    const danger = history.filter(r => r.cmd === 'DANGER').length;
    const stop   = history.filter(r => r.cmd === 'STOP').length;
    const move   = history.filter(r => r.cmd === 'MOVE').length;
    const psafe  = history.filter(r => r.personSafety === 'SAFE').length;
    const punsafe= history.filter(r => r.personSafety === 'UNSAFE' || r.personSafety === 'CAUTION').length;

    anTotalDanger.textContent  = danger;
    anTotalStop.textContent    = stop;
    anTotalMove.textContent    = move;
    anPersonSafe.textContent   = psafe;
    anPersonUnsafe.textContent = punsafe;

    buildDonut(danger, stop, move);
    buildLine();
    buildBar();
    buildSafety(psafe, punsafe);
    buildConfScatter();
    buildAnalyticsTable();
  }

  const CHART_DEFAULTS = {
    color: '#d4e8f5',
    grid:  'rgba(30,42,58,0.8)',
  };

  function buildDonut(danger, stop, move) {
    const id = 'chartDonut';
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), {
      type: 'doughnut',
      data: {
        labels: ['DANGER', 'STOP', 'MOVE'],
        datasets: [{
          data: [danger, stop, move],
          backgroundColor: ['rgba(255,60,90,0.8)', 'rgba(255,201,64,0.8)', 'rgba(0,232,122,0.8)'],
          borderColor: ['#ff3c5a','#ffc940','#00e87a'],
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: CHART_DEFAULTS.color, font: { family: 'DM Mono' } } },
        }
      }
    });
  }

  function buildLine() {
    const id = 'chartLine';
    if (charts[id]) charts[id].destroy();
    // bucket by minute
    const buckets = {};
    history.forEach(r => {
      const d = new Date(r.timestamp);
      const key = d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0');
      if (!buckets[key]) buckets[key] = { DANGER:0, STOP:0, MOVE:0 };
      buckets[key][r.cmd]++;
    });
    const labels = Object.keys(buckets);
    const mkData = cmd => labels.map(l => buckets[l][cmd] || 0);
    charts[id] = new Chart($(id), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label:'DANGER', data: mkData('DANGER'), borderColor:'#ff3c5a', backgroundColor:'rgba(255,60,90,0.1)', tension:0.4, fill:true },
          { label:'STOP',   data: mkData('STOP'),   borderColor:'#ffc940', backgroundColor:'rgba(255,201,64,0.1)', tension:0.4, fill:true },
          { label:'MOVE',   data: mkData('MOVE'),   borderColor:'#00e87a', backgroundColor:'rgba(0,232,122,0.1)', tension:0.4, fill:true },
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend: { labels: { color:CHART_DEFAULTS.color, font:{family:'DM Mono'} } } },
        scales: {
          x: { ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}}, grid:{color:CHART_DEFAULTS.grid} },
          y: { ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}}, grid:{color:CHART_DEFAULTS.grid}, beginAtZero:true },
        }
      }
    });
  }

  function buildBar() {
    const id = 'chartBar';
    if (charts[id]) charts[id].destroy();
    const objCount = {};
    history.forEach(r => { if (r.obj !== 'none') objCount[r.obj] = (objCount[r.obj]||0) + 1; });
    const sorted = Object.entries(objCount).sort((a,b)=>b[1]-a[1]).slice(0,10);
    charts[id] = new Chart($(id), {
      type: 'bar',
      data: {
        labels: sorted.map(([k])=>k),
        datasets: [{
          label: 'Detection Count',
          data: sorted.map(([,v])=>v),
          backgroundColor: sorted.map(([k])=>
            TYPE_DANGER.has(k) ? 'rgba(255,60,90,0.7)' :
            TYPE_STOP.has(k)   ? 'rgba(255,201,64,0.7)' :
                                  'rgba(0,232,122,0.7)'),
          borderColor: sorted.map(([k])=>
            TYPE_DANGER.has(k) ? '#ff3c5a' :
            TYPE_STOP.has(k)   ? '#ffc940' : '#00e87a'),
          borderWidth: 1,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins: { legend: { display:false } },
        scales: {
          x: { ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}}, grid:{color:CHART_DEFAULTS.grid}, beginAtZero:true },
          y: { ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}}, grid:{color:CHART_DEFAULTS.grid} },
        }
      }
    });
  }

  function buildSafety(safe, unsafe) {
    const id = 'chartSafety';
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), {
      type: 'bar',
      data: {
        labels: ['SAFE', 'CAUTION / UNSAFE'],
        datasets: [{
          label: 'Person Events',
          data: [safe, unsafe],
          backgroundColor: ['rgba(0,232,122,0.7)', 'rgba(255,60,90,0.7)'],
          borderColor: ['#00e87a', '#ff3c5a'],
          borderWidth: 1,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false} },
        scales: {
          x: { ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:11}}, grid:{color:CHART_DEFAULTS.grid} },
          y: { ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}}, grid:{color:CHART_DEFAULTS.grid}, beginAtZero:true },
        }
      }
    });
  }

  function buildConfScatter() {
    const id = 'chartConf';
    if (charts[id]) charts[id].destroy();
    const colorOf = cmd => cmd === 'DANGER' ? '#ff3c5a' : cmd === 'STOP' ? '#ffc940' : '#00e87a';
    charts[id] = new Chart($(id), {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Detections',
          data: history.map((r,i) => ({ x: i+1, y: parseFloat(r.conf) })),
          backgroundColor: history.map(r => colorOf(r.cmd) + 'cc'),
          pointRadius: 5,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend:{display:false} },
        scales: {
          x: { title:{display:true,text:'Event #',color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}},
               ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:9}}, grid:{color:CHART_DEFAULTS.grid} },
          y: { title:{display:true,text:'Confidence %',color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:10}},
               ticks:{color:CHART_DEFAULTS.color,font:{family:'DM Mono',size:9}}, grid:{color:CHART_DEFAULTS.grid}, min:0, max:100 },
        }
      }
    });
  }

  function buildAnalyticsTable() {
    const objStats = {};
    history.forEach(r => {
      if (!objStats[r.obj]) objStats[r.obj] = { count:0, danger:0, stop:0, move:0, confSum:0, proxSum:0, unsafe:0 };
      const s = objStats[r.obj];
      s.count++; s[r.cmd.toLowerCase()]++;
      s.confSum  += parseFloat(r.conf);
      s.proxSum  += parseFloat(r.proximity);
      if (r.personSafety === 'UNSAFE' || r.personSafety === 'CAUTION') s.unsafe++;
    });

    const rows = Object.entries(objStats).sort((a,b)=>b[1].count-a[1].count);
    if (!rows.length) {
      analyticsBody.innerHTML = '<tr class="empty-row"><td colspan="8">No data yet.</td></tr>';
      return;
    }
    analyticsBody.innerHTML = rows.map(([obj, s]) => `
      <tr>
        <td>${esc(obj)}</td>
        <td>${s.count}</td>
        <td style="color:var(--red)">${s.danger}</td>
        <td style="color:var(--yellow)">${s.stop}</td>
        <td style="color:var(--green)">${s.move}</td>
        <td>${(s.confSum/s.count).toFixed(1)}%</td>
        <td>${(s.proxSum/s.count).toFixed(1)}%</td>
        <td style="color:${s.unsafe>0?'var(--red)':'var(--green)'}">${s.count>0?((s.unsafe/s.count)*100).toFixed(0)+'%':'—'}</td>
      </tr>
    `).join('');
  }

  // ── Analytics export ──────────────────────────────────────────────────────
  downloadAnalBtn.addEventListener('click', () => {
    if (!history.length) { alert('No data to export.'); return; }
    const objStats = {};
    history.forEach(r => {
      if (!objStats[r.obj]) objStats[r.obj] = { count:0, danger:0, stop:0, move:0, confSum:0, proxSum:0, unsafe:0 };
      const s = objStats[r.obj];
      s.count++; s[r.cmd.toLowerCase()]++;
      s.confSum  += parseFloat(r.conf);
      s.proxSum  += parseFloat(r.proximity);
      if (r.personSafety === 'UNSAFE' || r.personSafety === 'CAUTION') s.unsafe++;
    });

    const danger = history.filter(r=>r.cmd==='DANGER').length;
    const stop   = history.filter(r=>r.cmd==='STOP').length;
    const move   = history.filter(r=>r.cmd==='MOVE').length;

    const summaryCSV = [
      ['VISION-OPS Analytics Report', new Date().toLocaleString()],
      [],
      ['SUMMARY'],
      ['Total Events', history.length],
      ['DANGER Events', danger],
      ['STOP Events', stop],
      ['MOVE Events', move],
      ['Person SAFE', history.filter(r=>r.personSafety==='SAFE').length],
      ['Person UNSAFE/CAUTION', history.filter(r=>r.personSafety==='UNSAFE'||r.personSafety==='CAUTION').length],
      [],
      ['PER-OBJECT ANALYTICS'],
      ['Object','Count','Danger','Stop','Move','Avg Confidence%','Avg Proximity%','Risk%'],
      ...Object.entries(objStats).map(([obj,s])=>[
        obj, s.count, s.danger, s.stop, s.move,
        (s.confSum/s.count).toFixed(1),
        (s.proxSum/s.count).toFixed(1),
        ((s.unsafe/s.count)*100).toFixed(0)+'%',
      ]),
    ];
    downloadCSV(summaryCSV, 'visionops_analytics_' + Date.now() + '.csv');
  });

  downloadChartsBtn.addEventListener('click', async () => {
    const ids = ['chartDonut','chartLine','chartBar','chartSafety','chartConf'];
    for (const id of ids) {
      const canvas = $(id);
      if (!canvas) continue;
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = id + '_' + Date.now() + '.png';
      a.click();
      await new Promise(r => setTimeout(r, 200));
    }
  });

  // ── Utility ───────────────────────────────────────────────────────────────
  function downloadCSV(rows, filename) {
    const csv  = rows.map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

})();
