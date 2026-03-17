/**
 * OWLGEBRA AI — PIXEL ART HERO ANIMATION  (v9)
 *
 * Two owl variants: left-facing (toward frog) and right-facing (toward prince).
 *
 * Sequence:
 *   1. IDLE_LEFT   — left-owl + frog shown
 *   2. CAST_LEFT   — magic shower toward frog
 *   3. MORPH_FROG  — frog disappears (checkered)
 *   4. SWAP_OWL    — left-owl fades, right-owl fades in
 *   5. CAST_RIGHT  — magic shower toward prince
 *   6. MORPH_PRINCE— prince appears (checkered)
 *   7. HOLD        — right-owl + prince shown
 *   8. RESET       — fade all out, loop
 */
(function () {
  'use strict';

  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const CW = 960;
  const CH = 320;
  canvas.width  = CW;
  canvas.height = CH;

  const INK = '#0d0d0d';
  const BG  = '#ffffff';

  /* ── Sizes ───────────────────────────────────────────────── */
  const OWL_SIZE    = 210;   // owl images are square
  const FROG_H      = 180;
  const FROG_W      = Math.round(FROG_H * 682 / 1024);  // ~120 (preserve ratio)
  const PRINCE_SIZE = 180;

  /* ── Layout ──────────────────────────────────────────────── */
  const OWL_RX  = Math.round(CW * 0.5 - OWL_SIZE / 2);
  const OWL_RY  = Math.round((CH - OWL_SIZE) / 2);

  const FROG_RX = OWL_RX - FROG_W - 70;
  const FROG_RY = Math.round((CH - FROG_H) / 2);

  const PRINCE_RX = OWL_RX + OWL_SIZE + 70;
  const PRINCE_RY = Math.round((CH - PRINCE_SIZE) / 2);

  /* Magic origins — left wand tip (upper-left area of left-owl)
                     right wand tip (upper-right area of right-owl) */
  const MAGIC_LEFT_X  = OWL_RX + OWL_SIZE * 0.15;
  const MAGIC_LEFT_Y  = OWL_RY + OWL_SIZE * 0.22;
  const MAGIC_RIGHT_X = OWL_RX + OWL_SIZE * 0.85;
  const MAGIC_RIGHT_Y = OWL_RY + OWL_SIZE * 0.22;

  /* ── Load images ─────────────────────────────────────────── */
  let owlLReady = false, owlRReady = false, frogReady = false, princeReady = false;

  const owlLImg   = new Image();
  const owlRImg   = new Image();
  const frogImg   = new Image();
  const princeImg = new Image();

  owlLImg.onload   = () => { owlLReady   = true; };
  owlRImg.onload   = () => { owlRReady   = true; };
  frogImg.onload   = () => { frogReady   = true; };
  princeImg.onload = () => { princeReady = true; };

  owlLImg.src   = 'assets/owl-left.png';
  owlRImg.src   = 'assets/owl-right.png';
  frogImg.src   = 'assets/frog-pixel.png';
  princeImg.src = 'assets/prince-pixel.png';

  function drawImg(img, ready, rx, ry, w, h, alpha) {
    if (!ready || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha           = Math.max(0, alpha);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, rx, ry, w, h);
    ctx.restore();
  }

  /* ── Checkerboard dissolve / assemble ────────────────────── */
  const TILE = 12;

  function buildTileOrder(w, h) {
    const tilesX = Math.ceil(w / TILE);
    const tilesY = Math.ceil(h / TILE);
    const order = [];
    for (let phase = 0; phase <= 1; phase++) {
      const batch = [];
      for (let r = 0; r < tilesY; r++)
        for (let c = 0; c < tilesX; c++)
          if ((r + c) % 2 === phase) batch.push([r, c]);
      for (let i = batch.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [batch[i], batch[j]] = [batch[j], batch[i]];
      }
      order.push(...batch);
    }
    return order;
  }

  let frogTiles   = buildTileOrder(FROG_W, FROG_H);
  let princeTiles = buildTileOrder(PRINCE_SIZE, PRINCE_SIZE);

  function initOrders() {
    frogTiles   = buildTileOrder(FROG_W, FROG_H);
    princeTiles = buildTileOrder(PRINCE_SIZE, PRINCE_SIZE);
  }

  function drawCheckerboard(img, ready, rx, ry, w, h, visibility, tiles) {
    if (!ready || visibility <= 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, rx, ry, w, h);
    ctx.restore();
    if (visibility >= 1) return;
    const gone = Math.floor((1 - visibility) * tiles.length);
    ctx.fillStyle = BG;
    for (let i = 0; i < gone; i++) {
      const [r, c] = tiles[i];
      ctx.fillRect(rx + c * TILE, ry + r * TILE, TILE, TILE);
    }
  }

  /* ── Particles ───────────────────────────────────────────── */
  const particles = [];

  function spawnToward(srcX, srcY, dstX, dstY, count) {
    const angle = Math.atan2(dstY - srcY, dstX - srcX);
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      const speed  = 2.0 + Math.random() * 3.0;
      particles.push({
        x: srcX + (Math.random() - 0.5) * 16,
        y: srcY + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle + spread) * speed,
        vy: Math.sin(angle + spread) * speed,
        life: 1.0,
        decay: 0.022 + Math.random() * 0.025,
        size: Math.random() < 0.4 ? 5 : 3,
      });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = INK;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function clear() { ctx.fillStyle = BG; ctx.fillRect(0, 0, CW, CH); }

  function drawGround() {
    const y = Math.max(FROG_RY + FROG_H, OWL_RY + OWL_SIZE, PRINCE_RY + PRINCE_SIZE) + 12;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.06;
    ctx.lineWidth   = 1;
    ctx.setLineDash([8, 16]);
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(CW - 8, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /* Frog & Prince destination centres (for particle targeting) */
  const FROG_CX   = FROG_RX + FROG_W / 2;
  const FROG_CY   = FROG_RY + FROG_H / 2;
  const PRINCE_CX = PRINCE_RX + PRINCE_SIZE / 2;
  const PRINCE_CY = PRINCE_RY + PRINCE_SIZE / 2;

  /* ── State machine ───────────────────────────────────────── */
  const FPS = 60;
  const S = {
    IDLE_LEFT:    { dur: FPS * 1.5 },
    CAST_LEFT:    { dur: FPS * 1.0 },
    MORPH_FROG:   { dur: FPS * 2.0 },
    SWAP_OWL:     { dur: FPS * 0.7 },
    CAST_RIGHT:   { dur: FPS * 1.0 },
    MORPH_PRINCE: { dur: FPS * 2.0 },
    HOLD:         { dur: FPS * 2.0 },
    RESET:        { dur: FPS * 0.8 },
  };

  const SEQUENCE = [
    S.IDLE_LEFT, S.CAST_LEFT, S.MORPH_FROG, S.SWAP_OWL,
    S.CAST_RIGHT, S.MORPH_PRINCE, S.HOLD, S.RESET,
  ];

  let stateIdx  = 0;
  let state     = SEQUENCE[0];
  let stateTime = 0;

  function nextState() {
    stateTime = 0;
    stateIdx  = (stateIdx + 1) % SEQUENCE.length;
    state     = SEQUENCE[stateIdx];
    if (state === S.IDLE_LEFT) initOrders();
  }

  /* ── Main loop ───────────────────────────────────────────── */
  function tick() {
    requestAnimationFrame(tick);
    stateTime++;
    if (stateTime >= state.dur) nextState();
    const t = Math.min(stateTime / state.dur, 1);

    clear();

    /* ── 1. IDLE_LEFT: left-owl + frog ── */
    if (state === S.IDLE_LEFT) {
      drawCheckerboard(frogImg, frogReady, FROG_RX, FROG_RY, FROG_W, FROG_H, 1, frogTiles);
      drawImg(owlLImg, owlLReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, 1);
    }

    /* ── 2. CAST_LEFT: magic shower toward frog ── */
    else if (state === S.CAST_LEFT) {
      drawCheckerboard(frogImg, frogReady, FROG_RX, FROG_RY, FROG_W, FROG_H, 1, frogTiles);
      drawImg(owlLImg, owlLReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, 1);
      spawnToward(MAGIC_LEFT_X, MAGIC_LEFT_Y, FROG_CX, FROG_CY, 5);
      updateParticles(); drawParticles();
    }

    /* ── 3. MORPH_FROG: frog dissolves ── */
    else if (state === S.MORPH_FROG) {
      drawCheckerboard(frogImg, frogReady, FROG_RX, FROG_RY, FROG_W, FROG_H, 1 - t, frogTiles);
      drawImg(owlLImg, owlLReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, 1);
      if (Math.random() < 0.4) spawnToward(MAGIC_LEFT_X, MAGIC_LEFT_Y, FROG_CX, FROG_CY, 2);
      updateParticles(); drawParticles();
    }

    /* ── 4. SWAP_OWL: left-owl fades out, right-owl fades in ── */
    else if (state === S.SWAP_OWL) {
      const fadeOut = 1 - t;
      const fadeIn  = t;
      drawImg(owlLImg, owlLReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, fadeOut);
      drawImg(owlRImg, owlRReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, fadeIn);
      updateParticles(); drawParticles();
    }

    /* ── 5. CAST_RIGHT: magic shower toward prince ── */
    else if (state === S.CAST_RIGHT) {
      drawImg(owlRImg, owlRReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, 1);
      spawnToward(MAGIC_RIGHT_X, MAGIC_RIGHT_Y, PRINCE_CX, PRINCE_CY, 5);
      updateParticles(); drawParticles();
    }

    /* ── 6. MORPH_PRINCE: prince assembles ── */
    else if (state === S.MORPH_PRINCE) {
      drawImg(owlRImg, owlRReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, 1);
      drawCheckerboard(princeImg, princeReady, PRINCE_RX, PRINCE_RY, PRINCE_SIZE, PRINCE_SIZE, t, princeTiles);
      if (Math.random() < 0.4) spawnToward(MAGIC_RIGHT_X, MAGIC_RIGHT_Y, PRINCE_CX, PRINCE_CY, 2);
      updateParticles(); drawParticles();
    }

    /* ── 7. HOLD: right-owl + prince ── */
    else if (state === S.HOLD) {
      drawImg(owlRImg, owlRReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, 1);
      drawCheckerboard(princeImg, princeReady, PRINCE_RX, PRINCE_RY, PRINCE_SIZE, PRINCE_SIZE, 1, princeTiles);
      updateParticles(); drawParticles();
    }

    /* ── 8. RESET: fade everything out then loop ── */
    else if (state === S.RESET) {
      const a = 1 - t;
      drawImg(owlRImg, owlRReady, OWL_RX, OWL_RY, OWL_SIZE, OWL_SIZE, a);
      drawCheckerboard(princeImg, princeReady, PRINCE_RX, PRINCE_RY, PRINCE_SIZE, PRINCE_SIZE, a, princeTiles);
      updateParticles(); drawParticles();
    }

    drawGround();
  }

  tick();
})();
