(function () {
  'use strict';

  /* ====== CONFIG ====== */
  const CW = 800, CH = 600, GROUND = 540;
  const GRAV = 0.65, JVEL = -13.5;
  const PX = 100, PW = 60, PH = 80, PCH = 40;
  const OR = 22;
  const OBJ_GY = GROUND - PH + 12;
  const OBJ_AY = GROUND - PH - 75;
  const PHASES = [
    { n: 3, spd: 4.5, dst: 5800 },
    { n: 4, spd: 5.5, dst: 6200 },
    { n: 5, spd: 6.5, dst: 6600 },
  ];
  const MEM_SEC = 6;
  const POOL = [
    { e: '🍎', n: 'Maçã' }, { e: '🎂', n: 'Bolo' },
    { e: '🧶', n: 'Novelo' }, { e: '📻', n: 'Rádio' },
    { e: '👓', n: 'Óculos' }, { e: '💊', n: 'Remédio' },
    { e: '☕', n: 'Café' }, { e: '📖', n: 'Livro' },
    { e: '🎩', n: 'Chapéu' }, { e: '🧣', n: 'Cachecol' },
    { e: '🍪', n: 'Biscoito' }, { e: '🌻', n: 'Girassol' },
    { e: '🍰', n: 'Torta' }, { e: '🧤', n: 'Luvas' },
    { e: '🎵', n: 'Música' },
  ];

  /* ====== DOM ====== */
  const cv = document.getElementById('gameCanvas');
  const cx = cv.getContext('2d');
  cv.width = CW; cv.height = CH;
  const $start = document.getElementById('start-screen');
  const $sel = document.getElementById('select-screen');
  const $intro = document.getElementById('phase-intro-screen');
  const $over = document.getElementById('gameover-screen');
  const $hud = document.getElementById('hud');
  const $gc = document.getElementById('game-container');

  /* ====== PLAYER GIF OVERLAYS ====== */
  /* Use real <img> elements so the browser animates GIFs natively */
  const _pg = {};  // { run: imgEl, jump: imgEl, crouch: imgEl }
  ['run', 'jump', 'crouch'].forEach(k => {
    const el = document.createElement('img');
    el.className = 'player-gif';
    el.style.cssText = 'position:absolute;pointer-events:none;z-index:2;display:none;object-fit:fill;';
    $gc.appendChild(el);
    _pg[k] = el;
  });
  function hidePlayerGifs() { _pg.run.style.display = _pg.jump.style.display = _pg.crouch.style.display = 'none'; }

  /* ====== STATE ====== */
  let st = 'START', char = null, phase = 0;
  let memo = [], coll, hits, errs, score;
  let tHits = 0, tErrs = 0, tScore = 0;
  let spd = 0, dist = 0;
  let py, pvy, jmp, crch, gnd;
  let items = [], spawnCd = 0, guarQ = [];
  let gOff = 0, clouds = [], pops = [], parts = [];
  let bobT = 0;
  let introIv = null;

  /* ====== HELPERS ====== */
  function shuf(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = 0 | Math.random() * (i + 1);[b[i], b[j]] = [b[j], b[i]] } return b; }
  function ov(ax, ay, aw, ah, bx, by, bw, bh) { return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by; }

  /* ====== SFX (Web Audio API) ====== */
  const _actx = new (window.AudioContext || window.webkitAudioContext)();

  function sfxJump() {
    const o = _actx.createOscillator();
    const g = _actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, _actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(600, _actx.currentTime + 0.15);
    g.gain.setValueAtTime(0.18, _actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + 0.2);
    o.connect(g).connect(_actx.destination);
    o.start(); o.stop(_actx.currentTime + 0.2);
  }

  function sfxCrouch() {
    const o = _actx.createOscillator();
    const g = _actx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(400, _actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(150, _actx.currentTime + 0.12);
    g.gain.setValueAtTime(0.15, _actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + 0.15);
    o.connect(g).connect(_actx.destination);
    o.start(); o.stop(_actx.currentTime + 0.15);
  }

  /* ====== MUSIC ====== */
  const MELODIES = [
    [261.63, 329.63, 392.00, 523.25, 392.00, 329.63], // Fase 1: C Major Arpeggio
    [293.66, 349.23, 440.00, 587.33, 440.00, 349.23, 261.63, 329.63, 392.00, 523.25], // Fase 2: Dm -> C
    [329.63, 392.00, 493.88, 659.25, 493.88, 392.00, 293.66, 349.23, 440.00, 587.33]  // Fase 3: Em -> Dm
  ];
  const TEMPOS = [220, 180, 140];
  let _bgmIv = null, _bgmPlay = false, _bgmEl = null;

  function playMusic(ph) {
    stopMusic();
    const url = `audio/fase${ph + 1}.mp3`;

    // Tenta carregar o arquivo externo primeiro
    const audio = new Audio(url);
    audio.loop = true;

    // Tentativa de reprodução do arquivo (se o navegador suportar o formato)
    audio.play()
      .then(() => {
        _bgmEl = audio;
        console.log(`Reproduzindo arquivo: ${url}`);
      })
      .catch(() => {
        // Se falhar (não existe ou formato não suportado), cai no fallback de osciladores
        console.log(`Usando síntese de osciladores para fase ${ph + 1}`);
        playSynthMusic(ph);
      });
  }

  function playSynthMusic(ph) {
    _bgmPlay = true;
    if (_actx.state === 'suspended') _actx.resume();

    const notes = MELODIES[ph % MELODIES.length];
    const spd = TEMPOS[ph % TEMPOS.length];
    let step = 0;

    function nextNote() {
      if (!_bgmPlay) return;
      const o = _actx.createOscillator();
      const g = _actx.createGain();
      o.type = 'square';
      o.frequency.value = notes[step];
      g.gain.setValueAtTime(0.04, _actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + (spd / 1000) * 0.9);
      o.connect(g).connect(_actx.destination);
      o.start(); o.stop(_actx.currentTime + (spd / 1000));
      step = (step + 1) % notes.length;
      _bgmIv = setTimeout(nextNote, spd);
    }
    nextNote();
  }

  function stopMusic() {
    _bgmPlay = false;
    if (_bgmIv) clearTimeout(_bgmIv);
    if (_bgmEl) { _bgmEl.pause(); _bgmEl = null; }
  }

  /* ====== SPRITES ====== */
  function ldChar(c) {
    const p = c === 'vovo' ? 'VOVO' : 'VOVOH';
    _pg.run.src = 'images/' + p + '.GIF';
    _pg.jump.src = 'images/' + p + '_PULA.png';
    _pg.crouch.src = 'images/' + p + '_AGACHA.png';
  }

  /* ====== SCREENS ====== */
  function hideAll() { [$start, $sel, $intro, $over, $hud].forEach(e => e.classList.add('hidden')); hidePlayerGifs(); }

  function showStart() { hideAll(); $start.classList.remove('hidden'); st = 'START'; }
  function showSelect() { hideAll(); $sel.classList.remove('hidden'); st = 'SELECT'; }

  function showIntro() {
    hideAll(); $intro.classList.remove('hidden'); st = 'INTRO';
    stopMusic();
    const cfg = PHASES[phase];
    document.getElementById('phase-number').textContent = phase + 1;
    const pool = shuf(POOL);
    memo = pool.slice(0, cfg.n);
    coll = new Set(); hits = 0; errs = 0; score = 0;
    const el = document.getElementById('memorize-list');
    el.innerHTML = '';
    memo.forEach(o => {
      const d = document.createElement('div'); d.className = 'memo-item';
      d.innerHTML = '<span class="memo-emoji">' + o.e + '</span><span class="memo-name">' + o.n + '</span>';
      el.appendChild(d);
    });
    let t = MEM_SEC;
    const ce = document.getElementById('countdown');
    const bar = document.getElementById('countdown-bar');
    ce.textContent = t; bar.style.width = '100%';
    if (introIv) clearInterval(introIv);
    introIv = setInterval(() => {
      t--; ce.textContent = t;
      bar.style.width = ((t / MEM_SEC) * 100) + '%';
      if (t <= 0) { clearInterval(introIv); introIv = null; beginPlay(); }
    }, 1000);
  }

  function beginPlay() {
    hideAll(); $hud.classList.remove('hidden'); st = 'PLAYING';
    spd = PHASES[phase].spd; dist = 0;
    py = GROUND - PH; pvy = 0; jmp = false; crch = false; gnd = true;
    items = []; spawnCd = 80; pops = []; parts = []; bobT = 0;
    guarQ = shuf([...memo]);
    updHUD();
    playMusic(phase);
  }

  function endPhase() {
    tHits += hits; tErrs += errs; tScore += score;
    phase++;
    if (phase >= PHASES.length) showOver(); else showIntro();
  }

  function showOver() {
    hideAll(); $over.classList.remove('hidden'); st = 'OVER';
    stopMusic();
    document.getElementById('final-hits').textContent = tHits;
    document.getElementById('final-errors').textContent = tErrs;
    document.getElementById('final-score').textContent = tScore;
  }

  function resetGame() { phase = 0; tHits = 0; tErrs = 0; tScore = 0; showSelect(); }

  /* ====== HUD ====== */
  function updHUD() {
    document.getElementById('hud-phase').textContent = 'Fase ' + (phase + 1);
    document.getElementById('hud-score').textContent = 'Pontos: ' + score;
    const el = document.getElementById('hud-collected');
    el.innerHTML = memo.map(m => '<span class="hud-obj' + (coll.has(m.n) ? ' done' : '') + '">' + m.e + '</span>').join('');
  }

  /* ====== SPAWN ====== */
  function spawn() {
    let o;
    if (guarQ.length > 0) { o = guarQ.pop(); }
    else {
      const dis = POOL.filter(i => !memo.some(m => m.n === i.n));
      o = Math.random() < 0.4
        ? memo[0 | Math.random() * memo.length]
        : dis[0 | Math.random() * dis.length];
    }
    const isAir = Math.random() < 0.45;
    items.push({
      x: CW + OR, y: isAir ? OBJ_AY : OBJ_GY,
      e: o.e, n: o.n,
      isMemo: memo.some(m => m.n === o.n),
      alive: true,
    });
  }

  /* ====== COLLECT ====== */
  function collect(it) {
    it.alive = false;
    let d = 0;
    if (it.isMemo && !coll.has(it.n)) { coll.add(it.n); score++; hits++; d = 1; mkPart(it.x, it.y, '#4ade80'); }
    else { score--; errs++; d = -1; mkPart(it.x, it.y, '#f87171'); }
    pops.push({ x: it.x, y: it.y, t: d > 0 ? '+1' : '-1', c: d > 0 ? '#4ade80' : '#f87171', l: 50 });
    updHUD();
  }

  function mkPart(x, y, c) {
    for (let i = 0; i < 8; i++) parts.push({ x, y, vx: (Math.random() - .5) * 6, vy: (Math.random() - .5) * 6 - 2, l: 30 + Math.random() * 20, c, r: 2 + Math.random() * 3 });
  }

  /* ====== UPDATE ====== */
  function update(dt) {
    bobT += dt;
    /* player */
    if (jmp) { pvy += GRAV * dt; py += pvy * dt; if (py >= GROUND - PH) { py = GROUND - PH; pvy = 0; jmp = false; gnd = true; } }
    const ph = crch && !jmp ? PCH : PH;
    const ptop = crch && !jmp ? GROUND - PCH : py;
    /* distance */
    dist += spd * dt;
    gOff = (gOff + spd * dt) % 40;
    /* spawn */
    spawnCd -= dt;
    if (spawnCd <= 0) { spawn(); spawnCd = 70 + Math.random() * 50; }
    /* items */
    for (const it of items) {
      if (!it.alive) continue;
      it.x -= spd * dt;
      if (ov(PX, ptop, PW, ph, it.x - OR, it.y - OR, OR * 2, OR * 2)) collect(it);
    }
    items = items.filter(i => i.alive && i.x > -50);
    /* clouds */
    for (const c of clouds) { c.x -= c.s * dt; if (c.x < -80) { c.x = CW + 80; c.y = 30 + Math.random() * 80; } }
    /* pops */
    for (const p of pops) { p.y -= 1.5 * dt; p.l -= dt; } pops = pops.filter(p => p.l > 0);
    /* parts */
    for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.l -= dt; } parts = parts.filter(p => p.l > 0);
    /* phase end */
    if (dist >= PHASES[phase].dst) endPhase();
  }

  /* ====== RENDER ====== */
  function render() {
    cx.clearRect(0, 0, CW, CH);
    drawBg();
    if (st !== 'PLAYING') { hidePlayerGifs(); return; }
    drawGnd();
    drawItems();
    positionPlayer();
    drawPops();
    drawParts();
    drawProg();
  }

  function drawBg() {
    const g = cx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#87CEEB'); g.addColorStop(1, '#E0F7FA');
    cx.fillStyle = g; cx.fillRect(0, 0, CW, GROUND);
    cx.fillStyle = '#92B57A'; cx.fillRect(0, GROUND, CW, CH - GROUND);
    // clouds
    cx.fillStyle = 'rgba(255,255,255,.7)';
    for (const c of clouds) {
      cx.beginPath(); cx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      cx.arc(c.x + c.r * .6, c.y - c.r * .3, c.r * .7, 0, Math.PI * 2);
      cx.arc(c.x - c.r * .5, c.y - c.r * .15, c.r * .55, 0, Math.PI * 2); cx.fill();
    }
    // hills
    cx.fillStyle = '#A8D08D';
    cx.beginPath(); cx.moveTo(0, GROUND);
    for (let x = 0; x <= CW; x += 80) cx.quadraticCurveTo(x + 40, GROUND - 15 - Math.sin(x * .01) * 10, x + 80, GROUND);
    cx.lineTo(CW, GROUND); cx.fill();
  }

  function drawGnd() {
    cx.strokeStyle = '#6B8F4E'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(0, GROUND); cx.lineTo(CW, GROUND); cx.stroke();
    cx.strokeStyle = '#7FA85F'; cx.lineWidth = 1;
    for (let x = -gOff; x < CW; x += 40) { cx.beginPath(); cx.moveTo(x, GROUND + 10); cx.lineTo(x + 18, GROUND + 10); cx.stroke(); }
    for (let x = -gOff + 20; x < CW; x += 40) { cx.beginPath(); cx.moveTo(x, GROUND + 24); cx.lineTo(x + 12, GROUND + 24); cx.stroke(); }
  }

  /* Position real <img> elements over the canvas so GIF animation works */
  function positionPlayer() {
    const key = jmp ? 'jump' : (crch ? 'crouch' : 'run');
    const h = crch && !jmp ? PCH : PH;
    const dy = crch && !jmp ? GROUND - PCH : py;
    const bob = (!jmp && !crch) ? Math.sin(bobT * 0.3) * 3 : 0;

    /* Scale canvas coords → container pixel coords */
    const scX = $gc.offsetWidth / CW;
    const scY = $gc.offsetHeight / CH;

    /* Show only the active sprite, hide others */
    for (const k in _pg) {
      if (k === key) {
        const el = _pg[k];
        el.style.display = 'block';
        el.style.left = (PX * scX) + 'px';
        el.style.top = ((dy + bob) * scY) + 'px';
        el.style.width = (PW * scX) + 'px';
        el.style.height = (h * scY) + 'px';
      } else {
        _pg[k].style.display = 'none';
      }
    }
  }

  function drawItems() {
    for (const it of items) {
      if (!it.alive) continue;
      // bg circle
      cx.fillStyle = it.isMemo ? 'rgba(74,222,128,.18)' : 'rgba(248,113,113,.12)';
      cx.beginPath(); cx.arc(it.x, it.y, OR + 4, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = it.isMemo ? 'rgba(74,222,128,.4)' : 'rgba(248,113,113,.3)';
      cx.lineWidth = 2; cx.stroke();
      // emoji
      cx.font = '28px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillStyle = '#fff';
      cx.fillText(it.e, it.x, it.y);
    }
  }

  function drawPops() {
    for (const p of pops) {
      cx.globalAlpha = Math.min(1, p.l / 20);
      cx.font = 'bold 22px Outfit'; cx.textAlign = 'center'; cx.fillStyle = p.c;
      cx.fillText(p.t, p.x, p.y);
    }
    cx.globalAlpha = 1;
  }

  function drawParts() {
    for (const p of parts) {
      cx.globalAlpha = Math.min(1, p.l / 15);
      cx.fillStyle = p.c;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, Math.PI * 2); cx.fill();
    }
    cx.globalAlpha = 1;
  }

  function drawProg() {
    const pct = Math.min(1, dist / PHASES[phase].dst);
    cx.fillStyle = 'rgba(0,0,0,.3)'; cx.fillRect(20, CH - 16, CW - 40, 8);
    cx.fillStyle = '#ffd200'; cx.fillRect(20, CH - 16, (CW - 40) * pct, 8);
    cx.strokeStyle = 'rgba(255,255,255,.2)'; cx.lineWidth = 1;
    cx.strokeRect(20, CH - 16, CW - 40, 8);
  }

  /* ====== INPUT ====== */
  const keys = {};
  let _crchSfxPlayed = false;
  document.addEventListener('keydown', e => {
    if (st !== 'PLAYING') return;
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); doJump(); }
    if (e.code === 'ArrowDown') { e.preventDefault(); if (!crch) { crch = true; sfxCrouch(); } }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'ArrowDown') crch = false;
  });

  function doJump() { if (gnd && !jmp) { jmp = true; gnd = false; pvy = JVEL; crch = false; sfxJump(); } }

  /* touch */
  let tsy = 0;
  cv.addEventListener('touchstart', e => {
    e.preventDefault(); tsy = e.touches[0].clientY;
  }, { passive: false });
  cv.addEventListener('touchmove', e => {
    e.preventDefault();
    if (st !== 'PLAYING') return;
    const dy = e.touches[0].clientY - tsy;
    if (dy > 40 && !crch) { crch = true; sfxCrouch(); }
  }, { passive: false });
  cv.addEventListener('touchend', e => {
    e.preventDefault();
    if (st !== 'PLAYING') return;
    const endY = e.changedTouches[0].clientY;
    const dy = endY - tsy;
    if (dy > 40) { /* was swipe down, already handled */ }
    else { doJump(); }
    crch = false;
  }, { passive: false });

  /* ====== BUTTONS ====== */
  document.getElementById('start-btn').addEventListener('click', showSelect);
  document.getElementById('restart-btn').addEventListener('click', resetGame);
  document.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => {
      char = card.dataset.character;
      ldChar(char);
      showIntro();
    });
  });

  /* ====== CLOUDS INIT ====== */
  for (let i = 0; i < 5; i++) clouds.push({ x: Math.random() * CW, y: 30 + Math.random() * 80, r: 20 + Math.random() * 20, s: 0.3 + Math.random() * 0.4 });

  /* ====== GAME LOOP ====== */
  let last = 0;
  function loop(t) {
    const dt = Math.min((t - last) / 16.67, 3);
    last = t;
    if (st === 'PLAYING') update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

})();
