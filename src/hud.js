// Everything drawn on top of the room: the particle, the lens, effects, text.
// The 2D context is scaled so that one unit is one grid cell; all positions here are in cells.

import { W, H, PARTICLE_RADIUS } from './physics.js';
import { SIM } from './config.js';
import { RING, SPARK } from './effects.js';
import { cardRect, cardAt } from './rooms.js';

const TAU = Math.PI * 2;
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const percent = p => (p < 0.005 ? '<1%' : p > 0.995 ? '>99%' : Math.round(p * 100) + '%');
const pad2 = n => String(n).padStart(2, '0');

export function createHud(canvas, game, audio) {
  const ui = canvas.getContext('2d');
  const { S, pointer, effects, levels, progress } = game;
  let textScale = 1;   // text grows a little when the game is shown small, so it stays readable

  // ---------------------------------------------------------------- drawing helpers

  function text(string, x, y, size, color, { align = 'left', weight = 400, spacing = 0, maxWidth = 0 } = {}) {
    ui.font = `${weight} ${size * textScale}px ${FONT}`;
    ui.textAlign = align;
    ui.textBaseline = 'middle';
    if ('letterSpacing' in ui) ui.letterSpacing = spacing + 'px';
    ui.fillStyle = color;
    if (maxWidth) ui.fillText(string, x, y, maxWidth); else ui.fillText(string, x, y);
  }

  function panel(x, y, w, h, radius, color) {
    ui.fillStyle = color;
    ui.beginPath();
    if (ui.roundRect) ui.roundRect(x, y, w, h, radius); else ui.rect(x, y, w, h);
    ui.fill();
  }

  function circle(x, y, radius) {
    ui.beginPath();
    ui.arc(x, y, radius, 0, TAU);
  }

  function dashed(pattern, offset, draw) {
    ui.setLineDash(pattern);
    ui.lineDashOffset = offset;
    draw();
    ui.setLineDash([]);
  }

  // ---------------------------------------------------------------- things in the room

  function drawEffects() {
    for (const e of effects.list) {
      if (e.t < 0) continue;
      const u = e.t / e.life;
      if (e.type === RING) {
        ui.strokeStyle = e.color + (1 - u) * 0.9 + ')';
        ui.lineWidth = e.lineWidth;
        circle(e.x, e.y, e.r0 + (e.r1 - e.r0) * (1 - (1 - u) * (1 - u)));
        ui.stroke();
      } else if (e.type === SPARK) {
        ui.fillStyle = e.color + (1 - u) + ')';
        ui.fillRect(e.x - 0.4, e.y - 0.4, 0.9, 0.9);
      } else {
        text(e.text, e.x, e.y - u * 6, 3.6, e.color + Math.min(1, (1 - u) * 2.2) + ')', { align: 'center', weight: 700, spacing: 0.5 });
      }
    }
  }

  function drawKeys() {
    for (const key of S.keys) {
      if (key.got) continue;
      ui.save();
      ui.translate(key.x, key.y + Math.sin(S.clock * 3) * 0.8);
      ui.rotate(S.clock * 1.2);
      ui.strokeStyle = 'rgba(255,220,120,0.95)';
      ui.lineWidth = 0.7;
      ui.strokeRect(-2.2, -2.2, 4.4, 4.4);
      ui.rotate(-S.clock * 2.4);
      ui.fillStyle = 'rgba(255,235,170,0.95)';
      ui.fillRect(-1, -1, 2, 2);
      ui.restore();
      ui.strokeStyle = 'rgba(255,220,120,0.25)';
      ui.lineWidth = 0.4;
      circle(key.x, key.y, 6 + Math.sin(S.clock * 2) * 0.6);
      ui.stroke();
    }
    if (S.exit && !game.exitOpen()) {
      text('ASLEEP', Math.max(16, Math.min(W - 16, S.exit.x)), S.exit.y, 3.2, 'rgba(200,205,220,0.55)', { align: 'center', weight: 700, spacing: 0.8 });
    }
  }

  /** For a player who has struggled in this room: the intended shot, drawn on the floor. */
  function drawGuide(level) {
    const guide = level.guide;
    if (!guide || S.mode === 'won') return;
    const after = guide.after || { deaths: 2, seconds: 40 };
    if (S.levelStats.deaths < after.deaths && S.levelStats.t < after.seconds) return;

    const alpha = 0.45 + 0.25 * Math.sin(S.clock * 3);
    ui.strokeStyle = `rgba(255,230,150,${alpha})`;
    ui.lineWidth = 0.5;
    dashed([1.4, 1.2], 0, () => {
      for (const { from, at } of guide.shots) {
        circle(from[0], from[1], PARTICLE_RADIUS + 2.5);
        ui.moveTo(from[0], from[1]);
        ui.lineTo(at[0], at[1]);
        ui.stroke();
      }
    });
    const [x, y] = guide.shots[0].from;
    const noteY = y - 10 < 22 ? y + 10 : y - 10;
    text(guide.note, Math.max(x, 4), noteY, 2.6, `rgba(255,230,150,${alpha + 0.25})`, { align: x < 70 ? 'left' : 'center', weight: 700 });
  }

  /** Where and how the last wave was launched, so a shot can be repeated or nudged. */
  function drawLastLaunch() {
    const mark = S.mark;
    if (!mark || S.mode === 'won') return;
    ui.strokeStyle = 'rgba(190,210,255,0.32)';
    ui.lineWidth = 0.35;
    dashed([0.9, 1.3], 0, () => {
      circle(mark.x, mark.y, PARTICLE_RADIUS + 1.2);
      const reach = 12 + 10 * mark.charge;
      ui.moveTo(mark.x + Math.cos(mark.aim) * 6, mark.y + Math.sin(mark.aim) * 6);
      ui.lineTo(mark.x + Math.cos(mark.aim) * reach, mark.y + Math.sin(mark.aim) * reach);
      ui.stroke();
    });
  }

  function drawParticle() {
    const aim = Math.atan2(pointer.y - S.py, pointer.x - S.px);
    const charge = game.charge();
    const reach = 18 + 22 * (S.charging ? charge : 0);

    ui.strokeStyle = `rgba(190,225,255,${S.charging ? 0.75 : 0.3})`;
    ui.lineWidth = 0.45;
    dashed([1.2, 1.6], -S.clock * 6, () => {
      ui.beginPath();
      ui.moveTo(S.px + Math.cos(aim) * 6, S.py + Math.sin(aim) * 6);
      ui.lineTo(S.px + Math.cos(aim) * reach, S.py + Math.sin(aim) * reach);
      ui.stroke();
    });

    ui.fillStyle = 'rgba(255,255,255,0.95)';
    circle(S.px, S.py, 1.5);
    ui.fill();
    ui.strokeStyle = 'rgba(210,235,255,0.55)';
    ui.lineWidth = 0.4;
    circle(S.px, S.py, PARTICLE_RADIUS);
    ui.stroke();

    if (S.charging) {
      const full = charge >= 1;
      ui.lineWidth = 1.1;
      ui.strokeStyle = 'rgba(255,255,255,0.18)';
      circle(S.px, S.py, 13);
      ui.stroke();
      ui.strokeStyle = full ? `rgba(255,240,170,${0.75 + 0.25 * Math.sin(S.clock * 18)})` : 'rgba(150,225,255,0.95)';
      ui.beginPath();
      ui.arc(S.px, S.py, 13, -Math.PI / 2, -Math.PI / 2 + TAU * charge);
      ui.stroke();
      text(full ? 'FULL' : 'CHARGE', S.px, S.py - 18, 3, full ? 'rgba(255,240,170,0.95)' : 'rgba(190,225,255,0.8)', { align: 'center', weight: 700, spacing: 0.6 });
    }

    // crosshair
    const { x, y } = pointer;
    ui.strokeStyle = 'rgba(220,235,255,0.7)';
    ui.lineWidth = 0.4;
    ui.beginPath();
    ui.moveTo(x - 3, y); ui.lineTo(x - 1, y); ui.moveTo(x + 1, y); ui.lineTo(x + 3, y);
    ui.moveTo(x, y - 3); ui.lineTo(x, y - 1); ui.moveTo(x, y + 1); ui.lineTo(x, y + 3);
    ui.stroke();
  }

  /** The lens, drawn exactly where and how the odds were computed. */
  function drawLens() {
    const { x, y, r, p } = S.lens;
    const hot = Math.min(1, p * 2.2);
    ui.strokeStyle = `rgba(${Math.floor(200 + 55 * hot)},${Math.floor(225 + 20 * hot)},255,${0.45 + 0.5 * hot})`;
    ui.lineWidth = S.lensOn ? 0.8 : 0.5;
    circle(x, y, r);
    ui.stroke();
    ui.strokeStyle = 'rgba(220,235,255,0.35)';
    dashed([0.8, 2.2], S.clock * 5, () => { circle(x, y, r + 2.2); ui.stroke(); });

    const above = y - r - 5 >= 10;
    const labelY = above ? y - r - 5 : y + r + 5;
    text(percent(p), x, labelY, 4.4, `rgba(255,255,255,${0.6 + 0.4 * hot})`, { align: 'center', weight: 700 });
    if (S.waveT < 2.2 && S.lvl >= 2 && S.stats.looks < 3 && !S.lensOn) {
      text('click to look · hold to widen', x, labelY + (above ? -5 : 5), 2.7, 'rgba(200,215,240,0.6)', { align: 'center' });
    }
  }

  // ---------------------------------------------------------------- text around the room

  function drawHeader(level) {
    text(`${pad2(S.lvl + 1)}/${pad2(levels.length)}`, 8, 9, 3.4, 'rgba(160,175,210,0.8)', { weight: 700, spacing: 0.4 });
    text(level.name, 27, 9, 3.4, 'rgba(235,240,255,0.95)', { weight: 700, spacing: 1.2 });

    let stats = `looks ${S.stats.looks}   deaths ${S.stats.deaths}`;
    if (S.keys.length) stats = `keys ${S.keys.filter(k => k.got).length}/${S.keys.length}   ` + stats;
    text(stats, W - 8, 9, 3, 'rgba(160,175,210,0.8)', { align: 'right', spacing: 0.2 });

    // nobody should be stranded in one room: after a while, say that it can be skipped
    const stuck = S.levelStats.deaths >= 4 || S.levelStats.t > 75;
    const controls = `H help · Esc rooms · R restart · M ${audio.muted ? 'sound on' : 'mute'}` + (stuck ? ' · ] skip this room' : '');
    text(controls, 8, 14.6, 2.4, stuck ? 'rgba(190,205,240,0.85)' : 'rgba(130,145,180,0.6)');
  }

  /** How much of this flight each colour has claimed so far, and how long the wave has left. */
  function drawFate(level) {
    if (S.mode !== 'wave' && S.fateShow <= 0) return;
    const alpha = S.mode === 'wave' ? 1 : Math.min(1, S.fateShow);
    const width = 92, x0 = W / 2 - width / 2, y0 = 7.6;
    const green = Math.min(1, S.fateGreen), red = Math.min(1, S.fateRed);

    panel(x0 - 1, y0 - 1, width + 2, 4.2, 2.1, `rgba(10,12,24,${0.7 * alpha})`);
    ui.fillStyle = `rgba(90,100,130,${0.5 * alpha})`;
    ui.fillRect(x0, y0, width, 2.2);
    ui.fillStyle = `rgba(90,255,170,${0.95 * alpha})`;
    ui.fillRect(x0, y0, width * green, 2.2);
    ui.fillStyle = `rgba(255,80,105,${0.95 * alpha})`;
    ui.fillRect(x0 + width * (1 - red), y0, width * red, 2.2);
    text('exit ' + percent(S.fateGreen), x0, y0 + 6.2, 2.7, `rgba(140,255,195,${0.9 * alpha})`, { weight: 700 });
    text(percent(S.fateRed) + ' caught', x0 + width, y0 + 6.2, 2.7, `rgba(255,130,150,${0.9 * alpha})`, { align: 'right', weight: 700 });

    if (S.mode === 'wave') {
      const left = Math.max(0, 1 - S.waveT / (level.coherence || SIM.coherence));
      ui.fillStyle = `rgba(200,210,255,${left < 0.25 ? 0.5 + 0.4 * Math.sin(S.clock * 14) : 0.55})`;
      ui.fillRect(W / 2 - (width / 2) * left, y0 + 3.2, width * left, 0.5);
      text('coherence', W / 2, y0 + 6.2, 2.4, 'rgba(180,190,225,0.6)', { align: 'center' });
    }
  }

  /** The two lines at the bottom: a fresh explanation if there is one, else what fits the moment. */
  function hintLines(level) {
    if (S.toast) return S.toast.lines;
    if (S.mode === 'wave' && level.flight) return level.flight;
    return level.hint;
  }

  function drawHint(lines) {
    const alpha = Math.min(1, S.intro);
    const lineHeight = 5.2 * textScale;
    ui.font = `700 ${3.3 * textScale}px ${FONT}`;
    if ('letterSpacing' in ui) ui.letterSpacing = '0.15px';
    const width = Math.min(W - 16, Math.max(...lines.map(line => ui.measureText(line).width)));
    const height = lines.length * lineHeight + 3;
    panel(W / 2 - width / 2 - 5, H - 8.5 - lines.length * lineHeight, width + 10, height, height / 2, `rgba(6,8,18,${0.72 * alpha})`);
    lines.forEach((line, i) => {
      const y = H - 9.4 - (lines.length - 1 - i) * lineHeight;
      const first = i === 0;
      text(line, W / 2, y, 3.3, first ? `rgba(240,244,255,${0.95 * alpha})` : `rgba(170,185,220,${0.9 * alpha})`,
        { align: 'center', weight: first ? 700 : 400, spacing: 0.15, maxWidth: W - 16 });
    });
  }

  function drawRoomCard(level) {
    if (S.intro >= 1.9) return;
    const alpha = Math.min(1, S.intro * 3) * Math.min(1, (1.9 - S.intro) * 1.8);
    text(pad2(S.lvl + 1), W / 2, H / 2 - 13, 5, `rgba(150,170,215,${0.8 * alpha})`, { align: 'center', spacing: 2 });
    text(level.name, W / 2 + 2, H / 2 - 2, 13, `rgba(255,255,255,${0.92 * alpha})`, { align: 'center', weight: 700, spacing: 4 });
  }

  function drawPlay() {
    const level = game.level();
    drawKeys();
    drawGuide(level);
    drawLastLaunch();
    if (S.mode === 'particle') drawParticle();
    else if (S.mode === 'wave') drawLens();
    drawEffects();

    drawHeader(level);
    drawFate(level);
    drawHint(hintLines(level));
    drawRoomCard(level);
    if (S.mode === 'won') {
      const stats = S.levelStats;
      text(`${stats.t.toFixed(1)}s   ${stats.looks} looks   ${stats.deaths} deaths`, W / 2, H / 2 + 12, 3.6,
        `rgba(190,255,220,${0.9 * Math.min(1, S.modeT * 3)})`, { align: 'center', spacing: 0.4 });
    }
  }

  // ---------------------------------------------------------------- title and ending

  const blink = () => 0.55 + 0.45 * Math.sin(S.clock * 2.4);

  function drawTitle() {
    drawEffects();
    panel(W / 2 - 74, 110, 148, 28, 14, 'rgba(5,7,16,0.62)');
    text('a game about being found', W / 2, 116, 5.2, 'rgba(240,244,255,0.95)', { align: 'center', weight: 700, spacing: 1.4 });
    text('You are a particle until you choose to be a wave.', W / 2, 124, 3.1, 'rgba(175,190,225,0.9)', { align: 'center', spacing: 0.2 });
    text(progress.reached > 0 ? 'click to continue' : 'click to begin', W / 2, 132, 3.4, `rgba(150,225,255,${blink()})`, { align: 'center', weight: 700, spacing: 1.2 });
    text('a real Schrödinger equation is running behind this text', W / 2, 7, 2.6, 'rgba(165,180,215,0.8)', { align: 'center', spacing: 0.3 });
    text('mouse and keyboard · H for how it works', W / 2, H - 5, 2.4, 'rgba(150,165,205,0.7)', { align: 'center', spacing: 0.3 });
  }

  // ---------------------------------------------------------------- room select

  function drawRooms() {
    drawEffects();
    text('ROOMS', W / 2 + 1, 13, 7, 'rgba(255,255,255,0.95)', { align: 'center', weight: 700, spacing: 3 });
    text('click a room to enter · Esc for the title', W / 2, 21.5, 2.6, 'rgba(165,180,215,0.8)', { align: 'center', spacing: 0.2 });

    const hovered = cardAt(pointer.x, pointer.y, levels.length);
    levels.forEach((level, i) => {
      const { x, y, w, h } = cardRect(i);
      const open = i <= progress.reached;
      const best = progress.cleared[level.name];
      const hot = open && i === hovered;

      panel(x, y, w, h, 3, hot ? 'rgba(28,40,78,0.92)' : open ? 'rgba(10,14,30,0.86)' : 'rgba(8,10,20,0.6)');
      ui.strokeStyle = hot ? 'rgba(150,225,255,0.95)' : best ? 'rgba(120,255,190,0.55)' : open ? 'rgba(150,170,230,0.4)' : 'rgba(110,120,150,0.18)';
      ui.lineWidth = hot ? 0.7 : 0.4;
      ui.stroke();

      const ink = open ? 1 : 0.35;
      text(pad2(i + 1), x + 4, y + 6.5, 3, `rgba(150,170,215,${0.9 * ink})`, { weight: 700, spacing: 0.4 });
      text(level.name, x + w / 2, y + 14.5, 3.5, `rgba(240,244,255,${0.96 * ink})`, { align: 'center', weight: 700, spacing: 0.6, maxWidth: w - 5 });
      const status = best ? `cleared · ${best.seconds}s` : open ? 'open' : 'locked';
      const statusColor = best ? 'rgba(140,255,195,0.9)' : open ? 'rgba(150,225,255,0.85)' : 'rgba(140,150,180,0.4)';
      text(status, x + w / 2, y + 23.5, 2.5, statusColor, { align: 'center', spacing: 0.2 });
    });
  }

  // ---------------------------------------------------------------- how it works

  const HELP = [
    ['head', 'HOW ψ WORKS'],
    ['body', 'You are a particle. You walk, and walls stop you.'],
    ['body', 'Hold the mouse button to charge, release to become a wave.'],
    ['body', 'A wave moves by itself and slips through gaps a walker cannot.'],
    ['gap'],
    ['sub', 'A WAVE BECOMES A PARTICLE AGAIN IN THREE WAYS'],
    ['green', '1   Green catches it. You win the room. You do nothing.'],
    ['white', '2   You click on it. You appear there, with the odds shown.'],
    ['soft', '3   Time runs out. You appear somewhere the wave was.'],
    ['gap'],
    ['red', 'Red catches waves too, and that kills you.'],
    ['body', 'The bar at the top shows how much of you each colour has taken.'],
    ['body', 'A longer charge is a faster wave: it leaks through thin barriers.'],
    ['gap'],
    ['keys', 'WASD walk · mouse aim · hold and release to fire · click to look'],
    ['keys', 'R restart · Esc rooms · M mute · ] skip a room'],
  ];
  const HELP_STYLE = {
    head: { size: 6.5, color: 'rgba(255,255,255,0.97)', weight: 700, spacing: 2.2, step: 10 },
    sub: { size: 2.9, color: 'rgba(150,170,215,0.95)', weight: 700, spacing: 0.9, step: 6.4 },
    body: { size: 3.2, color: 'rgba(205,215,240,0.95)', weight: 400, spacing: 0.15, step: 5.6 },
    green: { size: 3.2, color: 'rgba(140,255,195,0.98)', weight: 700, spacing: 0.15, step: 5.6 },
    white: { size: 3.2, color: 'rgba(240,246,255,0.98)', weight: 700, spacing: 0.15, step: 5.6 },
    soft: { size: 3.2, color: 'rgba(200,205,255,0.95)', weight: 700, spacing: 0.15, step: 5.6 },
    red: { size: 3.2, color: 'rgba(255,140,155,0.98)', weight: 700, spacing: 0.15, step: 5.6 },
    keys: { size: 2.7, color: 'rgba(160,175,215,0.9)', weight: 400, spacing: 0.2, step: 5 },
  };

  function drawHelp() {
    ui.fillStyle = 'rgba(3,4,10,0.72)';
    ui.fillRect(0, 0, W, H);
    const width = 178, height = 112, x = (W - width) / 2, y = (H - height) / 2;
    panel(x, y, width, height, 4, 'rgba(8,11,24,0.96)');
    ui.strokeStyle = 'rgba(150,170,230,0.35)';
    ui.lineWidth = 0.4;
    ui.stroke();

    let lineY = y + 12;
    for (const [kind, line] of HELP) {
      if (kind === 'gap') { lineY += 3; continue; }
      const style = HELP_STYLE[kind];
      text(line, W / 2, lineY, style.size, style.color, { align: 'center', weight: style.weight, spacing: style.spacing, maxWidth: width - 12 });
      lineY += style.step;
    }
    text('click or press H to close', W / 2, y + height - 6, 2.6, `rgba(150,225,255,${blink()})`, { align: 'center', weight: 700, spacing: 0.6 });
  }

  /** The whole run as one branch of the wavefunction: the product of every outcome's odds. */
  function worlds() {
    const exponent = -S.stats.logw;
    if (exponent < 0.05) return 'every world';
    if (exponent < 6) return '1 in ' + Math.round(Math.pow(10, exponent)).toLocaleString('en-US') + ' worlds';
    return '1 in 10^' + exponent.toFixed(1) + ' worlds';
  }

  function drawEnding() {
    drawEffects();
    const stats = S.stats;
    const minutes = Math.floor(stats.time / 60), seconds = Math.floor(stats.time % 60);
    panel(W / 2 - 88, 34, 176, 80, 5, 'rgba(5,7,16,0.84)');
    ui.strokeStyle = 'rgba(150,170,230,0.25)';
    ui.lineWidth = 0.4;
    ui.stroke();
    text('YOU WERE FOUND', W / 2 + 2, 48, 10, 'rgba(255,255,255,0.96)', { align: 'center', weight: 700, spacing: 3 });
    text(`${minutes}:${pad2(seconds)}    ${stats.waves} waves    ${stats.looks} looks    ${stats.deaths} deaths`, W / 2, 62, 3.6, 'rgba(190,255,220,0.92)', { align: 'center', spacing: 0.4 });
    text('This exact run happens in', W / 2, 75, 3.2, 'rgba(175,190,225,0.9)', { align: 'center' });
    text(worlds(), W / 2, 83, 6, 'rgba(150,225,255,0.98)', { align: 'center', weight: 700, spacing: 0.8 });
    text('Every other you is still out there, somewhere in the wave.', W / 2, 92, 3.2, 'rgba(175,190,225,0.9)', { align: 'center' });
    text('click for the rooms', W / 2, 104, 3.4, `rgba(150,225,255,${blink()})`, { align: 'center', weight: 700, spacing: 1.2 });
  }

  // ---------------------------------------------------------------- frame

  function draw() {
    const scale = canvas.width / W;
    ui.setTransform(1, 0, 0, 1, 0, 0);
    ui.clearRect(0, 0, canvas.width, canvas.height);

    // screen shake is decoration, so it uses Math.random and leaves the seeded rolls alone
    const shake = S.shake * S.shake * 1.6 * scale;
    ui.setTransform(scale, 0, 0, scale, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    if (S.scene === 'play') drawPlay();
    else if (S.scene === 'title') drawTitle();
    else if (S.scene === 'rooms') drawRooms();
    else drawEnding();

    if (S.help) {
      ui.setTransform(scale, 0, 0, scale, 0, 0);
      drawHelp();
    }

    const fade = game.fade();
    if (fade > 0) {
      ui.setTransform(1, 0, 0, 1, 0, 0);
      ui.fillStyle = `rgba(4,5,10,${fade})`;
      ui.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function resize(width, height, cssWidth) {
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    textScale = Math.max(1, Math.min(1.3, 1000 / Math.max(1, cssWidth)));
  }

  return { draw, resize };
}
