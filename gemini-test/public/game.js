// MaayaVerse: The Living NPC — Stage 2 Canvas Game Engine
// Comprehensive 2D RPG World with Player, MAAYA NPC, Quest, Gate & Audio

(function () {
  'use strict';

  // --- AUDIO SYNTHESIS (Self-contained, Zero external dependencies) ---
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioEnabled = true;

  function playSound(type) {
    if (!audioEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    try {
      if (type === 'step') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(90, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.08);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'chirp') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.05);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'chest') {
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.08);
          gain.gain.setValueAtTime(0.12, now + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + i * 0.08);
          osc.stop(now + i * 0.08 + 0.35);
        });
      } else if (type === 'gate') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.linearRampToValueAtTime(140, now + 1.2);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.2);
      } else if (type === 'fanfare') {
        const notes = [440, 554.37, 659.25, 880]; // A, C#, E, A
        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.12);
          gain.gain.setValueAtTime(0.2, now + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.5);
        });
      }
    } catch (e) {
      // Audio fallback silent
    }
  }

  // --- GAME STATE ---
  const Game = {
    canvas: null,
    ctx: null,
    width: 1000,
    height: 620,
    scale: 1,

    // Keys state (normalized direction flags + key aliases)
    keys: {
      up: false,
      down: false,
      left: false,
      right: false,
      w: false, a: false, s: false, d: false,
      ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
      e: false
    },

    // Player
    player: {
      x: 180,
      y: 340,
      width: 28,
      height: 42,
      speed: 3.5,
      direction: 'right', // 'up', 'down', 'left', 'right'
      moving: false,
      animTimer: 0,
      stepTimer: 0
    },

    // MAAYA NPC
    maaya: {
      homeX: 430,
      homeY: 340,
      gateActionX: 430,
      gateActionY: 260,
      x: 430,
      y: 340,
      width: 30,
      height: 44,
      state: 'IDLE', // IDLE, TALKING, THINKING, WALKING, OPENING_GATE, CELEBRATING
      direction: 'left',
      animTimer: 0,
      targetX: null,
      targetY: null,
      speed: 1.8,
      pathCallback: null,
      magicBeamTimer: 0
    },

    // Gate
    gate: {
      x: 480,
      y: 200,
      width: 40,
      height: 160,
      state: 'LOCKED', // LOCKED, OPENING, OPEN
      openProgress: 0 // 0 to 1
    },

    // Treasure Chest
    chest: {
      x: 820,
      y: 530,
      width: 38,
      height: 30,
      opened: false
    },

    // Ghost Patrols in Crypt
    ghosts: [
      { cx: 740, cy: 520, rx: 60, ry: 40, angle: 0, speed: 0.025, size: 22 },
      { cx: 860, cy: 530, rx: 50, ry: 45, angle: Math.PI, speed: 0.02, size: 24 },
      { cx: 800, cy: 470, rx: 70, ry: 35, angle: Math.PI / 2, speed: 0.018, size: 20 }
    ],

    // Particles & Torchlights
    torches: [
      { x: 120, y: 180, color: '#f59e0b' },
      { x: 120, y: 480, color: '#f59e0b' },
      { x: 450, y: 160, color: '#a855f7' },
      { x: 450, y: 390, color: '#a855f7' },
      { x: 580, y: 160, color: '#38bdf8' },
      { x: 920, y: 160, color: '#38bdf8' },
      { x: 670, y: 450, color: '#9333ea' },
      { x: 930, y: 450, color: '#9333ea' }
    ],
    particles: [],

    // Game Progression / Inventory
    questStatus: 'NOT_STARTED', // NOT_STARTED, ACTIVE, TREASURE_COLLECTED, READY_TO_COMPLETE, COMPLETED
    hasTreasure: false,
    gold: 0,
    xp: 0,
    rewardClaimed: false,

    // UI & Dialogue states
    dialogueOpen: false,
    promptText: null,
    promptTarget: null,
    notification: null,
    notificationTimer: 0,

    sessionId: null
  };

  // --- COLLISION MAP DEFINITION ---
  // Boundary boxes and environmental obstacles
  function getObstacles() {
    const list = [
      // Outer World Boundaries
      { x: 0, y: 0, w: 1000, h: 50 },         // North perimeter wall
      { x: 0, y: 590, w: 1000, h: 30 },       // South perimeter wall
      { x: 0, y: 0, w: 30, h: 620 },          // West perimeter wall
      { x: 970, y: 0, w: 30, h: 620 },        // East perimeter wall

      // Castle Divider Wall (separating West Courtyard from Sanctuary)
      { x: 480, y: 50, w: 30, h: 150 },       // Upper castle wall
      { x: 480, y: 360, w: 30, h: 60 },       // Lower divider buttress

      // Wall separating Sanctuary from Ghost Crypt
      { x: 510, y: 410, w: 460, h: 25 },

      // Courtyard internal decorative pillars
      { x: 260, y: 180, w: 32, h: 48 },
      { x: 260, y: 440, w: 32, h: 48 },

      // Sanctuary celestial altar
      { x: 740, y: 260, w: 50, h: 50 },

      // Ghost crypt ancient headstones & crypt arch
      { x: 660, y: 490, w: 26, h: 36 },
      { x: 740, y: 560, w: 26, h: 36 },
      { x: 900, y: 510, w: 26, h: 36 }
    ];

    // Gate collision: blocks passage when LOCKED or OPENING
    if (Game.gate.state !== 'OPEN') {
      list.push({ x: 480, y: 200, w: 30, h: 160 });
    }

    return list;
  }

  function checkCollision(x, y, w, h) {
    // Collision box for player base/feet (smoother navigation around walls)
    const feetX = x + 4;
    const feetY = y + h * 0.45;
    const feetW = w - 8;
    const feetH = h * 0.55;

    const obstacles = getObstacles();
    for (const b of obstacles) {
      if (feetX < b.x + b.w && feetX + feetW > b.x && feetY < b.y + b.h && feetY + feetH > b.y) {
        return true;
      }
    }
    return false;
  }

  // --- NOTIFICATION SYSTEM ---
  function showNotification(text, duration = 3200) {
    Game.notification = text;
    Game.notificationTimer = Date.now() + duration;
    const banner = document.getElementById('inGameNotification');
    if (banner) {
      banner.textContent = text;
      banner.style.display = 'block';
      banner.classList.add('fade-in');
    }
  }

  function updateNotification() {
    if (Game.notification && Date.now() > Game.notificationTimer) {
      Game.notification = null;
      const banner = document.getElementById('inGameNotification');
      if (banner) banner.style.display = 'none';
    }
  }

  // --- PARTICLES ENGINE ---
  function spawnParticle(x, y, color, vx, vy, size = 3, life = 40) {
    Game.particles.push({
      x, y, color, vx, vy, size, life, maxLife: life
    });
  }

  function updateParticles() {
    // Torch particle generation
    Game.torches.forEach((t) => {
      if (Math.random() < 0.35) {
        spawnParticle(
          t.x + (Math.random() - 0.5) * 8,
          t.y - 10 + (Math.random() - 0.5) * 6,
          t.color,
          (Math.random() - 0.5) * 0.4,
          -0.6 - Math.random() * 0.7,
          2.5 + Math.random() * 2,
          35 + Math.random() * 20
        );
      }
    });

    // MAAYA aura / magic beam particles
    if (Game.maaya.state === 'OPENING_GATE') {
      for (let i = 0; i < 4; i++) {
        const t = Math.random();
        const bx = Game.maaya.x + 20 + t * (Game.gate.x - (Game.maaya.x + 20));
        const by = Game.maaya.y - 10 + t * ((Game.gate.y + 80) - (Game.maaya.y - 10)) + (Math.random() - 0.5) * 12;
        spawnParticle(bx, by, '#c084fc', (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 3, 20);
      }
    }

    // Gate opening sparkling dust
    if (Game.gate.state === 'OPENING') {
      for (let i = 0; i < 2; i++) {
        spawnParticle(
          Game.gate.x + Math.random() * Game.gate.width,
          Game.gate.y + Math.random() * Game.gate.height,
          '#d8b4fe',
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 1.5,
          3.5,
          30
        );
      }
    }

    // Update existing particles
    for (let i = Game.particles.length - 1; i >= 0; i--) {
      const p = Game.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) {
        Game.particles.splice(i, 1);
      }
    }
  }

  // --- MAAYA MOVEMENT & PATHFINDING ---
  function moveMaayaTo(targetX, targetY, callback) {
    Game.maaya.targetX = targetX;
    Game.maaya.targetY = targetY;
    Game.maaya.state = 'WALKING';
    Game.maaya.pathCallback = callback;
  }

  function updateMaayaMovement() {
    const m = Game.maaya;
    if (m.targetX !== null && m.targetY !== null) {
      const dx = m.targetX - m.x;
      const dy = m.targetY - m.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 3) {
        m.x = m.targetX;
        m.y = m.targetY;
        m.targetX = null;
        m.targetY = null;
        m.state = 'IDLE';
        if (m.pathCallback) {
          const cb = m.pathCallback;
          m.pathCallback = null;
          cb();
        }
      } else {
        const step = Math.min(m.speed, dist);
        m.x += (dx / dist) * step;
        m.y += (dy / dist) * step;
        m.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        m.animTimer += 0.2;
      }
    }
  }

  // --- PLAYER CONTROLS & MOVEMENT ---
  function updatePlayer() {
    // Freeze movement while in conversation
    if (Game.dialogueOpen) {
      Game.player.moving = false;
      return;
    }

    const p = Game.player;
    let dx = 0;
    let dy = 0;

    if (Game.keys.up || Game.keys.w || Game.keys.ArrowUp) dy -= 1;
    if (Game.keys.down || Game.keys.s || Game.keys.ArrowDown) dy += 1;
    if (Game.keys.left || Game.keys.a || Game.keys.ArrowLeft) dx -= 1;
    if (Game.keys.right || Game.keys.d || Game.keys.ArrowRight) dx += 1;

    if (dx !== 0 && dy !== 0) {
      // Normalize diagonal movement
      dx *= 0.7071;
      dy *= 0.7071;
    }

    const speed = p.speed;
    const nextX = p.x + dx * speed;
    const nextY = p.y + dy * speed;

    p.moving = (dx !== 0 || dy !== 0);

    if (p.moving) {
      p.animTimer += 0.2;
      p.stepTimer++;
      if (p.stepTimer % 18 === 0) {
        playSound('step');
      }

      // Update player facing direction
      if (Math.abs(dx) >= Math.abs(dy)) {
        p.direction = dx > 0 ? 'right' : 'left';
      } else {
        p.direction = dy > 0 ? 'down' : 'up';
      }

      // Collision checks with separate horizontal/vertical resolution
      if (!checkCollision(nextX, p.y, p.width, p.height)) {
        p.x = nextX;
      }
      if (!checkCollision(p.x, nextY, p.width, p.height)) {
        p.y = nextY;
      }
    }

    // Check Sanctuary Entrance Trigger
    if (Game.gate.state === 'OPEN' && p.x > 530 && p.y > 180 && p.y < 380 && !Game.rewardClaimed) {
      triggerSanctuaryDiscovery();
    }
  }

  // --- GHOST PATROLS ---
  function updateGhosts() {
    Game.ghosts.forEach((g) => {
      g.angle += g.speed;
      g.x = g.cx + Math.cos(g.angle) * g.rx;
      g.y = g.cy + Math.sin(g.angle) * g.ry;
    });
  }

  // --- PROXIMITY & INTERACTION CHECKS ---
  function updateInteractionPrompts() {
    Game.promptText = null;
    Game.promptTarget = null;

    if (Game.dialogueOpen) return;

    const px = Game.player.x + Game.player.width / 2;
    const py = Game.player.y + Game.player.height / 2;

    // Check MAAYA proximity
    const maayaDist = Math.hypot(px - (Game.maaya.x + Game.maaya.width / 2), py - (Game.maaya.y + Game.maaya.height / 2));
    if (maayaDist < 70) {
      Game.promptText = "Press [E] to Speak with MAAYA";
      Game.promptTarget = 'MAAYA';
      return;
    }

    // Check Chest proximity
    const chestDist = Math.hypot(px - (Game.chest.x + Game.chest.width / 2), py - (Game.chest.y + Game.chest.height / 2));
    if (chestDist < 65) {
      if (!Game.chest.opened) {
        Game.promptText = "Press [E] to Open Ancient Chest";
        Game.promptTarget = 'CHEST';
      } else {
        Game.promptText = "Empty Ancient Chest";
        Game.promptTarget = 'CHEST_EMPTY';
      }
      return;
    }

    // Check Gate proximity
    const gateDist = Math.hypot(px - (Game.gate.x + Game.gate.width / 2), py - (Game.gate.y + Game.gate.height / 2));
    if (gateDist < 75 && Game.gate.state === 'LOCKED') {
      Game.promptText = "Sealed Sanctuary Gate (Speak to MAAYA)";
      Game.promptTarget = 'GATE';
    }
  }

  // --- GAME EVENTS & BACKEND SYNC ---
  async function interact() {
    if (!Game.promptTarget) return;

    if (Game.promptTarget === 'MAAYA') {
      openDialogue();
    } else if (Game.promptTarget === 'CHEST' && !Game.chest.opened) {
      await collectTreasure();
    }
  }

  // Collect Treasure from World Chest
  async function collectTreasure() {
    if (Game.chest.opened || Game.hasTreasure) return;

    try {
      const res = await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'COLLECT_TREASURE', sessionId: Game.sessionId })
      });
      const data = await res.json();
      if (data.success) {
        Game.chest.opened = true;
        Game.hasTreasure = true;
        if (Game.questStatus === 'ACTIVE') {
          Game.questStatus = 'TREASURE_COLLECTED';
        }
        playSound('chest');
        showNotification("★ Acquired: Amulet of the Sunken Veil!");
        updateHUD();
      }
    } catch (e) {
      console.error("Failed to collect treasure:", e);
    }
  }

  // Trigger Gate Opening Sequence
  function executeGateOpeningSequence() {
    if (Game.gate.state === 'OPEN') return;

    showNotification("✦ MAAYA: 'Step back... the seal shall be broken.'");
    Game.maaya.state = 'WALKING';

    // 1. MAAYA walks to gate pedestal
    moveMaayaTo(Game.maaya.gateActionX, Game.maaya.gateActionY, () => {
      // 2. Perform opening magic
      Game.maaya.state = 'OPENING_GATE';
      playSound('gate');
      showNotification("✦ The ancient iron gears groan and grind open...");

      // 3. Animate gate open over 2.4 seconds
      const startTime = Date.now();
      const animDuration = 2400;

      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        Game.gate.openProgress = Math.min(1, elapsed / animDuration);

        if (Game.gate.openProgress >= 1) {
          clearInterval(interval);
          Game.gate.state = 'OPEN';

          // Notify server
          fetch('/api/game/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'COMPLETE_GATE_OPEN', sessionId: Game.sessionId })
          });

          // MAAYA celebrates then returns to guard post
          Game.maaya.state = 'CELEBRATING';
          playSound('fanfare');
          showNotification("🏆 The Sanctuary Gate is OPEN! Walk through to claim your destiny!");

          setTimeout(() => {
            moveMaayaTo(Game.maaya.homeX, Game.maaya.homeY, () => {
              Game.maaya.state = 'IDLE';
            });
          }, 2000);
        }
      }, 30);
    });
  }

  // Enter Sanctuary & Claim Defined Reward
  async function triggerSanctuaryDiscovery() {
    if (Game.rewardClaimed) return;
    try {
      const res = await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ENTER_SANCTUARY', sessionId: Game.sessionId })
      });
      const data = await res.json();
      if (data.success && data.reward) {
        Game.rewardClaimed = true;
        Game.gold += data.reward.gold;
        Game.xp += data.reward.xp;
        Game.questStatus = 'COMPLETED';
        playSound('fanfare');
        showNotification(`🏆 Quest Completed! Awarded: +${data.reward.gold} Gold, +${data.reward.xp} XP!`);
        updateHUD();
      }
    } catch (e) {
      console.error("Sanctuary trigger error:", e);
    }
  }

  // Reset entire game session (for judges repeat demonstration)
  async function resetGame() {
    try {
      const res = await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RESET_GAME', sessionId: Game.sessionId })
      });
      const data = await res.json();
      if (data.success) {
        // Reset player
        Game.player.x = 180;
        Game.player.y = 340;
        Game.player.direction = 'right';

        // Reset MAAYA
        Game.maaya.x = Game.maaya.homeX;
        Game.maaya.y = Game.maaya.homeY;
        Game.maaya.state = 'IDLE';
        Game.maaya.targetX = null;
        Game.maaya.targetY = null;

        // Reset Gate & Chest
        Game.gate.state = 'LOCKED';
        Game.gate.openProgress = 0;
        Game.chest.opened = false;

        // Reset Inventory & Quests
        Game.questStatus = 'NOT_STARTED';
        Game.hasTreasure = false;
        Game.gold = 0;
        Game.xp = 0;
        Game.rewardClaimed = false;

        closeDialogue();
        updateHUD();
        showNotification("↺ Demo Reset: Pristine state restored for judges!");
        playSound('chirp');

        // Reset Chat UI messages
        if (window.resetDialogueUI) {
          window.resetDialogueUI(data.greeting);
        }
      }
    } catch (e) {
      console.error("Failed to reset game:", e);
    }
  }

  // --- DIALOGUE UI INTERFACE ---
  function openDialogue() {
    Game.dialogueOpen = true;
    resetAllKeys();
    Game.player.moving = false;
    Game.maaya.state = 'TALKING';
    playSound('chirp');

    const modal = document.getElementById('inGameDialogueModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('fade-in');
      const input = document.getElementById('messageInput');
      if (input) {
        setTimeout(() => input.focus(), 60);
      }
    }
  }

  function closeDialogue() {
    Game.dialogueOpen = false;
    if (Game.maaya.state === 'TALKING') {
      Game.maaya.state = 'IDLE';
    }
    const modal = document.getElementById('inGameDialogueModal');
    if (modal) {
      modal.style.display = 'none';
    }
    // Blur any active text inputs to instantly restore game controls
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
    }
    // Return focus to game canvas
    if (Game.canvas) {
      Game.canvas.focus();
    }
    resetAllKeys();
  }

  // Synchronize HUD
  function updateHUD() {
    const goldElem = document.getElementById('hudGold');
    const xpElem = document.getElementById('hudXp');
    const questElem = document.getElementById('hudQuestTitle');
    const questBadge = document.getElementById('hudQuestBadge');
    const itemSlot = document.getElementById('inventorySlot');

    if (goldElem) goldElem.textContent = Game.gold;
    if (xpElem) xpElem.textContent = Game.xp;

    let objective = "Explore the courtyard & speak to MAAYA";
    let badgeText = "Not Started";
    let badgeClass = "badge-neutral";

    if (Game.questStatus === 'ACTIVE') {
      objective = "Brave the east ghost crypt & find the ancient Amulet";
      badgeText = "Active Quest";
      badgeClass = "badge-active";
    } else if (Game.questStatus === 'TREASURE_COLLECTED') {
      objective = "Return the Amulet of the Sunken Veil to MAAYA";
      badgeText = "Treasure Held";
      badgeClass = "badge-alert";
    } else if (Game.questStatus === 'READY_TO_COMPLETE' || Game.gate.state === 'OPENING') {
      objective = "MAAYA is unlocking the Sanctuary Gate";
      badgeText = "Unlocking";
      badgeClass = "badge-gold";
    } else if (Game.questStatus === 'COMPLETED') {
      objective = "Sanctuary Discovered! You walk among legends.";
      badgeText = "Completed";
      badgeClass = "badge-success";
    }

    if (questElem) questElem.textContent = objective;
    if (questBadge) {
      questBadge.textContent = badgeText;
      questBadge.className = `status-tag ${badgeClass}`;
    }

    if (itemSlot) {
      if (Game.hasTreasure) {
        itemSlot.innerHTML = `<span class="inv-item" title="Amulet of the Sunken Veil">🔮 Amulet of the Veil</span>`;
      } else {
        itemSlot.innerHTML = `<span class="inv-empty">(Empty)</span>`;
      }
    }
  }

  // --- RENDERING PIPELINE (Canvas 2D) ---
  function render() {
    const ctx = Game.ctx;
    const w = Game.width;
    const h = Game.height;

    // 1. Clear & Background
    ctx.fillStyle = '#0a0914';
    ctx.fillRect(0, 0, w, h);

    // 2. Draw Floor Tile Textures
    // Courtyard (West)
    const courtGrad = ctx.createLinearGradient(0, 0, 500, 600);
    courtGrad.addColorStop(0, '#151329');
    courtGrad.addColorStop(1, '#0e0c1a');
    ctx.fillStyle = courtGrad;
    ctx.fillRect(30, 50, 450, 540);

    // Cobblestone grid pattern in courtyard
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 60; x < 480; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 50);
      ctx.lineTo(x, 590);
      ctx.stroke();
    }
    for (let y = 80; y < 590; y += 30) {
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(480, y);
      ctx.stroke();
    }

    // Sanctuary Floor (East-North, beyond gate)
    const sancGrad = ctx.createRadialGradient(740, 270, 30, 740, 270, 200);
    sancGrad.addColorStop(0, '#2e1065');
    sancGrad.addColorStop(0.5, '#1e1b4b');
    sancGrad.addColorStop(1, '#0b091a');
    ctx.fillStyle = sancGrad;
    ctx.fillRect(510, 50, 460, 360);

    // Celestial sanctuary mosaic rings
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(740, 270, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(740, 270, 110, 0, Math.PI * 2);
    ctx.stroke();

    // Ghost Crypt Floor (East-South)
    const cryptGrad = ctx.createLinearGradient(510, 410, 970, 600);
    cryptGrad.addColorStop(0, '#0c151c');
    cryptGrad.addColorStop(1, '#060a0f');
    ctx.fillStyle = cryptGrad;
    ctx.fillRect(510, 410, 460, 180);

    // 3. Environmental Obstacles & Walls
    const obstacles = getObstacles();
    ctx.fillStyle = '#1e1b2e';
    ctx.strokeStyle = '#4c1d95';
    ctx.lineWidth = 2;
    for (const b of obstacles) {
      // Don't render dynamic gate here (rendered with dedicated sprite)
      if (b.y === 200 && b.h === 160) continue;

      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);

      // Stone brick detailing
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);
      ctx.fillStyle = '#1e1b2e';
    }

    // 4. Sanctuary Altar & Floating Relic (x: 740, y: 260)
    ctx.fillStyle = '#3b0764';
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(765, 285, 28, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Floating Celestial Crystal on Altar
    const hoverY = Math.sin(Date.now() / 300) * 5;
    ctx.fillStyle = '#c084fc';
    ctx.shadowColor = '#c084fc';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(765, 260 + hoverY);
    ctx.lineTo(775, 272 + hoverY);
    ctx.lineTo(765, 284 + hoverY);
    ctx.lineTo(755, 272 + hoverY);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // 5. Draw The Grand Gate (x: 480, y: 200, w: 30, h: 160)
    drawGate(ctx);

    // 6. Draw Treasure Chest (x: 820, y: 530)
    drawChest(ctx);

    // 7. Draw Spectral Ghosts in Crypt
    drawGhosts(ctx);

    // 8. Draw MAAYA NPC
    drawMaaya(ctx);

    // 9. Draw Player Character
    drawPlayer(ctx);

    // 10. Draw Torch Lights & Dynamic Particles
    drawTorchesAndParticles(ctx);

    // 11. Draw Interaction Prompts (On Canvas)
    if (Game.promptText && !Game.dialogueOpen) {
      drawPromptBubble(ctx);
    }
  }

  // --- DRAWING ENTITIES ---
  function drawGate(ctx) {
    const g = Game.gate;
    const isLocked = g.state === 'LOCKED';
    const isOpen = g.state === 'OPEN';
    const isOpening = g.state === 'OPENING';

    // Gate pillars
    ctx.fillStyle = '#2e1065';
    ctx.strokeStyle = '#7e22ce';
    ctx.lineWidth = 3;
    ctx.fillRect(g.x - 12, g.y - 15, 24, g.height + 30);
    ctx.strokeRect(g.x - 12, g.y - 15, 24, g.height + 30);
    ctx.fillRect(g.x + g.width - 12, g.y - 15, 24, g.height + 30);
    ctx.strokeRect(g.x + g.width - 12, g.y - 15, 24, g.height + 30);

    // Gate passage opening
    if (isOpen) {
      // Light flowing through open gate
      const openGrad = ctx.createLinearGradient(g.x - 20, 0, g.x + g.width + 20, 0);
      openGrad.addColorStop(0, 'rgba(192, 132, 252, 0.05)');
      openGrad.addColorStop(0.5, 'rgba(192, 132, 252, 0.35)');
      openGrad.addColorStop(1, 'rgba(192, 132, 252, 0.05)');
      ctx.fillStyle = openGrad;
      ctx.fillRect(g.x - 10, g.y, g.width + 20, g.height);
      return;
    }

    // Door panels sliding if opening
    const slideOffset = (g.openProgress || 0) * (g.height / 2);

    // Top gate half
    ctx.fillStyle = '#1c1917';
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 3;
    ctx.fillRect(g.x, g.y - slideOffset, g.width, g.height / 2);
    ctx.strokeRect(g.x, g.y - slideOffset, g.width, g.height / 2);

    // Bottom gate half
    ctx.fillRect(g.x, g.y + g.height / 2 + slideOffset, g.width, g.height / 2);
    ctx.strokeRect(g.x, g.y + g.height / 2 + slideOffset, g.width, g.height / 2);

    // Iron crossbars
    ctx.strokeStyle = '#78716c';
    ctx.lineWidth = 2;
    for (let y = g.y + 15; y < g.y + g.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(g.x + 4, y);
      ctx.lineTo(g.x + g.width - 4, y);
      ctx.stroke();
    }

    // Central Runic Sigil Lock
    if (isLocked || isOpening) {
      const pulse = Math.sin(Date.now() / 250) * 0.2 + 0.8;
      ctx.fillStyle = isOpening ? '#ec4899' : '#9333ea';
      ctx.shadowColor = isOpening ? '#ec4899' : '#a855f7';
      ctx.shadowBlur = 14 * pulse;
      ctx.beginPath();
      ctx.arc(g.x + g.width / 2, g.y + g.height / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Lock rune glyph
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', g.x + g.width / 2, g.y + g.height / 2);
    }
  }

  function drawChest(ctx) {
    const c = Game.chest;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(c.x + c.width / 2, c.y + c.height - 2, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Chest Body
    ctx.fillStyle = '#78350f'; // Dark polished wood
    ctx.strokeStyle = '#d97706'; // Gold lining
    ctx.lineWidth = 2;
    ctx.fillRect(c.x, c.y + 10, c.width, c.height - 10);
    ctx.strokeRect(c.x, c.y + 10, c.width, c.height - 10);

    if (c.opened) {
      // Opened Lid
      ctx.fillStyle = '#92400e';
      ctx.fillRect(c.x - 2, c.y, c.width + 4, 10);
      ctx.strokeRect(c.x - 2, c.y, c.width + 4, 10);

      // Empty velvet interior
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(c.x + 4, c.y + 11, c.width - 8, 8);
    } else {
      // Closed Lid with glowing latch
      ctx.fillStyle = '#92400e';
      ctx.fillRect(c.x, c.y + 2, c.width, 10);
      ctx.strokeRect(c.x, c.y + 2, c.width, 10);

      // Pulsing latch
      const glow = Math.sin(Date.now() / 200) * 0.3 + 0.7;
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 8 * glow;
      ctx.fillRect(c.x + c.width / 2 - 4, c.y + 9, 8, 7);
      ctx.shadowBlur = 0;
    }
  }

  function drawGhosts(ctx) {
    Game.ghosts.forEach((g) => {
      const bob = Math.sin(Date.now() / 220 + g.angle) * 4;
      const gx = g.x;
      const gy = g.y + bob;

      // Spectral body glow
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';

      // Floating ghost silhouette
      ctx.beginPath();
      ctx.arc(gx, gy, g.size / 2, Math.PI, 0, false);
      ctx.lineTo(gx + g.size / 2, gy + g.size);
      ctx.quadraticCurveTo(gx, gy + g.size - 6, gx - g.size / 2, gy + g.size);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Spectral eyes
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(gx - 4, gy + 1, 2, 0, Math.PI * 2);
      ctx.arc(gx + 4, gy + 1, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawMaaya(ctx) {
    const m = Game.maaya;
    const x = m.x;
    const y = m.y;
    const bob = Math.sin(Date.now() / 250) * 2;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + m.width / 2, y + m.height - 2, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Thinking Runic Circle
    if (m.state === 'THINKING') {
      const rot = Date.now() / 400;
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x + m.width / 2, y + m.height - 2, 26, rot, rot + Math.PI * 1.5);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Gothic Gown
    ctx.fillStyle = '#180e2b';
    ctx.strokeStyle = '#581c87';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + m.width / 2, y + 14 + bob);
    ctx.lineTo(x + 2, y + m.height - 2);
    ctx.lineTo(x + m.width - 2, y + m.height - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Porcelain Head
    ctx.fillStyle = '#fdf4ff';
    ctx.beginPath();
    ctx.arc(x + m.width / 2, y + 10 + bob, 9, 0, Math.PI * 2);
    ctx.fill();

    // Raven/Violet Hair
    ctx.fillStyle = '#0f051d';
    ctx.beginPath();
    ctx.arc(x + m.width / 2, y + 8 + bob, 10.5, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    // Flowing hair strands
    ctx.fillRect(x + 3, y + 10 + bob, 4, 18);
    ctx.fillRect(x + m.width - 7, y + 10 + bob, 4, 18);

    // Silver Diadem / Crescent
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(x + m.width / 2, y + 5 + bob, 3, 0, Math.PI * 2);
    ctx.fill();

    // Luminous Amethyst Eyes
    ctx.fillStyle = '#a855f7';
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 6;
    if (m.direction === 'left') {
      ctx.fillRect(x + m.width / 2 - 5, y + 9 + bob, 2, 2.5);
    } else {
      ctx.fillRect(x + m.width / 2 + 3, y + 9 + bob, 2, 2.5);
    }
    ctx.shadowBlur = 0;

    // Magic Staff / Hands during opening gesture
    if (m.state === 'OPENING_GATE') {
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + m.width, y + 18 + bob);
      ctx.lineTo(x + m.width + 15, y - 4 + bob);
      ctx.stroke();

      ctx.fillStyle = '#f0abfc';
      ctx.shadowColor = '#f0abfc';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x + m.width + 15, y - 4 + bob, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Talking Speech Indicator
    if (m.state === 'TALKING') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.roundRect(x + m.width / 2 - 14, y - 22 + bob, 28, 16, 6);
      ctx.fill();

      ctx.fillStyle = '#9333ea';
      for (let i = 0; i < 3; i++) {
        const dotBob = Math.sin(Date.now() / 150 + i) * 1.5;
        ctx.beginPath();
        ctx.arc(x + m.width / 2 - 7 + i * 7, y - 14 + bob + dotBob, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPlayer(ctx) {
    const p = Game.player;
    const x = p.x;
    const y = p.y;
    const bob = p.moving ? Math.sin(p.animTimer) * 3 : 0;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + p.width / 2, y + p.height - 2, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cloak / Tunic
    ctx.fillStyle = '#1e3a5f'; // Deep adventurer navy
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x + 4, y + 14 + bob, p.width - 8, p.height - 22);
    ctx.strokeRect(x + 4, y + 14 + bob, p.width - 8, p.height - 22);

    // Boots
    ctx.fillStyle = '#334155';
    if (p.moving) {
      const legOffset = Math.sin(p.animTimer) * 4;
      ctx.fillRect(x + 5, y + p.height - 8 + legOffset, 7, 7);
      ctx.fillRect(x + p.width - 12, y + p.height - 8 - legOffset, 7, 7);
    } else {
      ctx.fillRect(x + 5, y + p.height - 8, 7, 7);
      ctx.fillRect(x + p.width - 12, y + p.height - 8, 7, 7);
    }

    // Head
    ctx.fillStyle = '#fed7aa'; // Skin tone
    ctx.beginPath();
    ctx.arc(x + p.width / 2, y + 10 + bob, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Adventurer Hood / Hair
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(x + p.width / 2, y + 7 + bob, 9.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();

    // Eyes direction
    ctx.fillStyle = '#0284c7';
    if (p.direction === 'right') {
      ctx.fillRect(x + p.width / 2 + 1, y + 9 + bob, 2.5, 2.5);
    } else if (p.direction === 'left') {
      ctx.fillRect(x + p.width / 2 - 3.5, y + 9 + bob, 2.5, 2.5);
    } else if (p.direction === 'up') {
      // Facing back
    } else {
      ctx.fillRect(x + p.width / 2 - 3, y + 9 + bob, 2, 2.5);
      ctx.fillRect(x + p.width / 2 + 1, y + 9 + bob, 2, 2.5);
    }
  }

  function drawTorchesAndParticles(ctx) {
    // Torches
    Game.torches.forEach((t) => {
      // Torch wall sconce
      ctx.fillStyle = '#44403c';
      ctx.fillRect(t.x - 3, t.y, 6, 14);

      // Light Radial Glow
      const glow = ctx.createRadialGradient(t.x, t.y - 6, 4, t.x, t.y - 6, 65);
      glow.addColorStop(0, t.color.replace(')', ', 0.28)').replace('rgb', 'rgba').replace('#', 'rgba('));
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(t.x, t.y - 6, 65, 0, Math.PI * 2);
      ctx.fill();
    });

    // Dynamic Particles
    Game.particles.forEach((p) => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });
  }

  function drawPromptBubble(ctx) {
    const px = Game.player.x + Game.player.width / 2;
    const py = Game.player.y - 18;

    ctx.font = 'bold 12px sans-serif';
    const textWidth = ctx.measureText(Game.promptText).width;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(px - textWidth / 2 - 10, py - 14, textWidth + 20, 24, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Game.promptText, px, py - 2);
  }

  // --- MAIN LOOP ---
  function gameLoop() {
    updatePlayer();
    updateMaayaMovement();
    updateGhosts();
    updateParticles();
    updateInteractionPrompts();
    updateNotification();

    render();
    requestAnimationFrame(gameLoop);
  }

  // --- FOCUS & INPUT HELPERS ---
  function resetAllKeys() {
    Game.keys.up = false;
    Game.keys.down = false;
    Game.keys.left = false;
    Game.keys.right = false;
    Game.keys.w = false;
    Game.keys.a = false;
    Game.keys.s = false;
    Game.keys.d = false;
    Game.keys.ArrowUp = false;
    Game.keys.ArrowDown = false;
    Game.keys.ArrowLeft = false;
    Game.keys.ArrowRight = false;
    Game.keys.e = false;
    Game.player.moving = false;
  }

  function isTypingInInput(el) {
    const active = el || document.activeElement;
    if (!active) return false;
    const tag = active.tagName ? active.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || active.isContentEditable;
  }

  function activateGameFocus() {
    const overlay = document.getElementById('gameFocusOverlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    if (Game.canvas && document.activeElement !== Game.canvas && !isTypingInInput()) {
      Game.canvas.focus();
    }
  }

  // --- KEYBOARD EVENT HANDLERS ---
  function handleKeyDown(e) {
    // If typing in dialogue input or textarea, let normal text entry happen
    if (isTypingInInput()) {
      if (e.key === 'Escape') {
        closeDialogue();
        e.preventDefault();
      }
      return;
    }

    // Dismiss focus overlay on any key press
    activateGameFocus();

    const code = e.code || '';
    const key = (e.key || '').toLowerCase();

    // Prevent default browser scrolling on arrow keys and space when active in game
    if (
      key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright' ||
      code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight' ||
      key === ' ' || code === 'Space'
    ) {
      e.preventDefault();
    }

    // Map UP
    if (code === 'KeyW' || key === 'w' || code === 'ArrowUp' || key === 'arrowup') {
      Game.keys.up = true;
      Game.keys.w = true;
      Game.keys.ArrowUp = true;
    }
    // Map DOWN
    if (code === 'KeyS' || key === 's' || code === 'ArrowDown' || key === 'arrowdown') {
      Game.keys.down = true;
      Game.keys.s = true;
      Game.keys.ArrowDown = true;
    }
    // Map LEFT
    if (code === 'KeyA' || key === 'a' || code === 'ArrowLeft' || key === 'arrowleft') {
      Game.keys.left = true;
      Game.keys.a = true;
      Game.keys.ArrowLeft = true;
    }
    // Map RIGHT
    if (code === 'KeyD' || key === 'd' || code === 'ArrowRight' || key === 'arrowright') {
      Game.keys.right = true;
      Game.keys.d = true;
      Game.keys.ArrowRight = true;
    }

    // Interact [E]
    if (code === 'KeyE' || key === 'e') {
      interact();
      e.preventDefault();
    }

    // Close Dialogue [Escape]
    if (e.key === 'Escape' && Game.dialogueOpen) {
      closeDialogue();
      e.preventDefault();
    }
  }

  function handleKeyUp(e) {
    if (isTypingInInput()) {
      return;
    }

    const code = e.code || '';
    const key = (e.key || '').toLowerCase();

    if (
      key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright' ||
      code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (code === 'KeyW' || key === 'w' || code === 'ArrowUp' || key === 'arrowup') {
      Game.keys.up = false;
      Game.keys.w = false;
      Game.keys.ArrowUp = false;
    }
    if (code === 'KeyS' || key === 's' || code === 'ArrowDown' || key === 'arrowdown') {
      Game.keys.down = false;
      Game.keys.s = false;
      Game.keys.ArrowDown = false;
    }
    if (code === 'KeyA' || key === 'a' || code === 'ArrowLeft' || key === 'arrowleft') {
      Game.keys.left = false;
      Game.keys.a = false;
      Game.keys.ArrowLeft = false;
    }
    if (code === 'KeyD' || key === 'd' || code === 'ArrowRight' || key === 'arrowright') {
      Game.keys.right = false;
      Game.keys.d = false;
      Game.keys.ArrowRight = false;
    }
  }

  function handleWindowBlur() {
    resetAllKeys();
  }

  let inputListenersAttached = false;
  function registerInputListeners() {
    if (inputListenersAttached) return;
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp, { passive: false });
    window.addEventListener('blur', handleWindowBlur);
    inputListenersAttached = true;
  }

  // --- INITIALIZATION ---
  window.initGameEngine = function (sessionId) {
    Game.canvas = document.getElementById('gameCanvas');
    if (!Game.canvas) return;

    Game.ctx = Game.canvas.getContext('2d');
    Game.sessionId = sessionId || sessionStorage.getItem('cognitive_npc_session_id') || crypto.randomUUID();

    // High DPI Canvas Scaling
    const dpr = window.devicePixelRatio || 1;
    Game.canvas.width = Game.width * dpr;
    Game.canvas.height = Game.height * dpr;
    Game.ctx.scale(dpr, dpr);

    // Initial HUD sync
    updateHUD();

    // Register input listeners exactly once
    registerInputListeners();

    // Focus / Start Game overlay handlers
    const overlay = document.getElementById('gameFocusOverlay');
    const startBtn = document.getElementById('startGameBtn');
    if (overlay) {
      overlay.addEventListener('click', activateGameFocus);
    }
    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activateGameFocus();
      });
    }

    // Canvas click restores focus
    Game.canvas.addEventListener('click', () => {
      activateGameFocus();
    });

    const wrapper = document.getElementById('canvasWrapper');
    if (wrapper) {
      wrapper.addEventListener('click', () => {
        activateGameFocus();
      });
    }

    // Hook buttons
    const closeBtn = document.getElementById('closeDialogueBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeDialogue);

    const resetGameBtn = document.getElementById('resetGameBtn');
    if (resetGameBtn) resetGameBtn.addEventListener('click', resetGame);

    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        audioEnabled = !audioEnabled;
        soundBtn.textContent = audioEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
      });
    }

    // Attempt canvas focus on load
    try {
      Game.canvas.focus();
    } catch (e) {}

    // Start loop if not already running
    if (!Game.loopStarted) {
      Game.loopStarted = true;
      requestAnimationFrame(gameLoop);
    }
  };

  // Export game actions to global scope for app.js interaction
  window.MaayaGame = {
    openDialogue,
    closeDialogue,
    isDialogueOpen: () => Game.dialogueOpen,
    executeGateOpeningSequence,
    updateHUD,
    showNotification,
    resetGame,
    playSound,
    setMaayaThinking: (thinking) => {
      Game.maaya.state = thinking ? 'THINKING' : (Game.dialogueOpen ? 'TALKING' : 'IDLE');
    },
    syncServerState: (state) => {
      if (!state) return;
      Game.questStatus = state.questStatus;
      Game.hasTreasure = state.hasTreasure;
      Game.gold = state.gold;
      Game.xp = state.xp;
      Game.rewardClaimed = state.rewardClaimed;
      if (state.gateState === 'OPEN') {
        Game.gate.state = 'OPEN';
        Game.gate.openProgress = 1;
      }
      if (state.treasureChestOpened) {
        Game.chest.opened = true;
      }
      updateHUD();
    }
  };

})();
