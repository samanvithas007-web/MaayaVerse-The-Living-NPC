// MaayaVerse: The Living NPC — Stage 2/3 Full 3D Game Engine
// Built with Three.js: 3D World, Controllable Player, MAAYA NPC, Crypt, Gate & Quests

import * as THREE from './lib/three.module.js';

(function () {
  'use strict';

  // --- AUDIO SYNTHESIS (Zero external dependencies) ---
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioContextClass ? new AudioContextClass() : null;
  let audioEnabled = true;

  function playSound(type) {
    if (!audioEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    const now = audioCtx.currentTime;

    try {
      if (type === 'step') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(25, now + 0.07);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.07);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
      } else if (type === 'chirp') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(460, now);
        osc.frequency.exponentialRampToValueAtTime(920, now + 0.06);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.06);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === 'chest') {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.09);
          gain.gain.setValueAtTime(0.12, now + i * 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.35);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + i * 0.09);
          osc.stop(now + i * 0.09 + 0.35);
        });
      } else if (type === 'gate') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(70, now);
        osc.frequency.linearRampToValueAtTime(130, now + 1.8);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.8);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.8);
      } else if (type === 'fanfare') {
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.12);
          gain.gain.setValueAtTime(0.18, now + i * 0.12);
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

  // --- 3D GAME STATE & CONFIGURATION ---
  const Game = {
    canvas: null,
    renderer: null,
    scene: null,
    camera: null,
    cameraOffset: { x: 0, y: 7.5, z: 11.5 },
    clock: new THREE.Clock(),

    // Movement Controller
    controller: null,

    // 3D Entities
    playerMesh: null,
    playerLegL: null,
    playerLegR: null,
    maayaMesh: null,
    maayaAura: null,
    maayaLeftArm: null,
    maayaRightArm: null,
    gateGroup: null,
    gateDoorLeft: null,
    gateDoorRight: null,
    gateRunicBarrier: null,
    chestGroup: null,
    chestLid: null,
    chestLockLight: null,
    relicCrystal: null,
    ghosts: [],
    torches: [],
    magicParticles: [],

    // Game Progression
    questStatus: 'NOT_STARTED', // NOT_STARTED, ACTIVE, TREASURE_COLLECTED, READY_TO_COMPLETE, COMPLETED
    hasTreasure: false,
    treasureChestOpened: false,
    gateState: 'LOCKED', // LOCKED, OPENING, OPEN
    gold: 0,
    xp: 0,
    rewardClaimed: false,

    // Dialogue & Prompt
    dialogueOpen: false,
    promptText: null,
    promptTarget: null,
    notificationTimer: 0,
    sessionId: null,

    // Animation & Waypoints
    maayaState: 'IDLE', // IDLE, TALKING, THINKING, WALKING_TO_GATE, OPENING_GATE, CELEBRATING, RETURNING
    maayaHome: { x: 0.5, y: 0, z: -1.0 },
    maayaGatePedestal: { x: 2.2, y: 0, z: -2.4 },
    maayaTarget: null,
    maayaSpeed: 2.6,
    gateOpenProgress: 0,

    loopStarted: false
  };

  // --- 3D COLLISION MAP (AABB Obstacles) ---
  function getObstacles() {
    const list = [
      // Outer Perimeter Castle Walls
      { minX: -26, maxX: -24, minZ: -18, maxZ: 26 }, // West wall
      { minX: 25, maxX: 27, minZ: -18, maxZ: 26 },   // East wall
      { minX: -26, maxX: 27, minZ: -19, maxZ: -17 }, // North wall
      { minX: -26, maxX: 27, minZ: 25, maxZ: 27 },   // South wall

      // Divider Wall between Courtyard and Sanctuary (x ~ 4)
      { minX: 3.5, maxX: 4.5, minZ: -17, maxZ: -2.4 }, // North section of divider wall
      { minX: 3.5, maxX: 4.5, minZ: 2.4, maxZ: 8.0 },   // South section of divider wall

      // Crypt Partition Wall (z ~ 8, x > 4)
      { minX: 4.0, maxX: 25.0, minZ: 7.5, maxZ: 8.5 },

      // Courtyard Pillars
      { minX: -14.8, maxX: -13.2, minZ: -8.8, maxZ: -7.2 },
      { minX: -14.8, maxX: -13.2, minZ: 7.2, maxZ: 8.8 },
      { minX: -6.8, maxX: -5.2, minZ: -8.8, maxZ: -7.2 },
      { minX: -6.8, maxX: -5.2, minZ: 7.2, maxZ: 8.8 },

      // Celestial Sanctuary Altar
      { minX: 13.5, maxX: 18.5, minZ: -7.5, maxZ: -2.5 },

      // Crypt Tombstones
      { minX: 8.2, maxX: 9.8, minZ: 12.2, maxZ: 13.8 },
      { minX: 13.2, maxX: 14.8, minZ: 17.2, maxZ: 18.8 },
      { minX: 19.2, maxX: 20.8, minZ: 11.2, maxZ: 12.8 }
    ];

    // Gate Barrier (blocks passage when LOCKED or OPENING)
    if (Game.gateState !== 'OPEN') {
      list.push({ minX: 3.4, maxX: 4.6, minZ: -2.4, maxZ: 2.4 });
    }

    return list;
  }

  // --- PROCEDURAL TEXTURES (Self-Contained) ---
  function createCobbleTexture(baseHex, lineHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = lineHex;
    ctx.lineWidth = 3;
    const tileSize = 32;

    for (let x = 0; x < 256; x += tileSize) {
      for (let y = 0; y < 256; y += tileSize) {
        ctx.strokeRect(x, y, tileSize, tileSize);
        // Stone grain
        if ((x + y) % 64 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // --- BUILD 3D SCENE & ENVIRONMENT ---
  function buildWorld(scene) {
    // 1. Ground Slabs
    // West Courtyard Ground
    const courtTex = createCobbleTexture('#161329', 'rgba(168, 85, 247, 0.15)');
    courtTex.repeat.set(10, 14);
    const courtGeo = new THREE.PlaneGeometry(30, 42);
    const courtMat = new THREE.MeshStandardMaterial({
      map: courtTex,
      roughness: 0.85,
      metalness: 0.15
    });
    const courtMesh = new THREE.Mesh(courtGeo, courtMat);
    courtMesh.rotation.x = -Math.PI / 2;
    courtMesh.position.set(-10, 0, 4);
    courtMesh.receiveShadow = true;
    scene.add(courtMesh);

    // East Sanctuary Ground (Elevated, Dark Marble)
    const sancGeo = new THREE.PlaneGeometry(22, 26);
    const sancMat = new THREE.MeshStandardMaterial({
      color: 0x1a0f35,
      roughness: 0.35,
      metalness: 0.4
    });
    const sancMesh = new THREE.Mesh(sancGeo, sancMat);
    sancMesh.rotation.x = -Math.PI / 2;
    sancMesh.position.set(15, 0.1, -5);
    sancMesh.receiveShadow = true;
    scene.add(sancMesh);

    // Glowing Arcane Rings in Sanctuary
    const ringGeo = new THREE.RingGeometry(3.5, 4.0, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(16, 0.12, -5);
    scene.add(ringMesh);

    // East Ghost Crypt Ground (Sunken Dark Dirt)
    const cryptGeo = new THREE.PlaneGeometry(22, 17);
    const cryptMat = new THREE.MeshStandardMaterial({
      color: 0x070d14,
      roughness: 0.95,
      metalness: 0.05
    });
    const cryptMesh = new THREE.Mesh(cryptGeo, cryptMat);
    cryptMesh.rotation.x = -Math.PI / 2;
    cryptMesh.position.set(15, -0.05, 16.5);
    cryptMesh.receiveShadow = true;
    scene.add(cryptMesh);

    // 2. Castle Perimeter Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1f1938,
      roughness: 0.8,
      metalness: 0.2
    });

    function createWall(x, y, z, w, h, d) {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    }

    // Outer perimeter
    createWall(-25, 0, 4, 1.5, 5, 44);   // West
    createWall(26, 0, 4, 1.5, 5, 44);    // East
    createWall(0.5, 0, -18, 52, 5, 1.5); // North
    createWall(0.5, 0, 25, 52, 5, 1.5);  // South

    // Castle Divider Walls (at x = 4)
    createWall(4, 0, -10.2, 1.2, 5, 15.6); // North divider
    createWall(4, 0, 5.2, 1.2, 5, 5.6);    // South divider
    createWall(14.5, 0, 8, 21, 4.5, 1.2);   // Crypt divider wall

    // 3. Ancient Stone Pillars in Courtyard
    const pillarPositions = [
      [-14, -8], [-14, 8],
      [-6, -8], [-6, 8]
    ];
    pillarPositions.forEach(([px, pz]) => {
      const pGeo = new THREE.CylinderGeometry(0.7, 0.85, 5.5, 12);
      const pMesh = new THREE.Mesh(pGeo, wallMat);
      pMesh.position.set(px, 2.75, pz);
      pMesh.castShadow = true;
      pMesh.receiveShadow = true;
      scene.add(pMesh);

      // Torch Sconce on Pillar
      addTorch(px, 3.2, pz + 0.8, 0xf59e0b);
    });

    // 4. The Grand Sealed Gate (at x = 4, z = 0)
    Game.gateGroup = new THREE.Group();
    Game.gateGroup.position.set(4, 0, 0);

    // Archway Pillars
    const archMat = new THREE.MeshStandardMaterial({ color: 0x3b1c6e, roughness: 0.6, metalness: 0.3 });
    const postGeo = new THREE.BoxGeometry(1.4, 6.5, 1.2);
    const postL = new THREE.Mesh(postGeo, archMat);
    postL.position.set(0, 3.25, -2.6);
    postL.castShadow = true;
    Game.gateGroup.add(postL);

    const postR = new THREE.Mesh(postGeo, archMat);
    postR.position.set(0, 3.25, 2.6);
    postR.castShadow = true;
    Game.gateGroup.add(postR);

    // Archway Top Beam
    const lintelGeo = new THREE.BoxGeometry(1.6, 1.4, 6.4);
    const lintel = new THREE.Mesh(lintelGeo, archMat);
    lintel.position.set(0, 6.2, 0);
    lintel.castShadow = true;
    Game.gateGroup.add(lintel);

    // Torches on Gate posts
    addTorch(3.3, 3.8, -2.6, 0xa855f7);
    addTorch(3.3, 3.8, 2.6, 0xa855f7);

    // Iron Gate Doors (Left and Right Wings on Hinges)
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x1e1e24,
      metalness: 0.85,
      roughness: 0.3
    });

    // Left Door Pivot at z = -2.0
    Game.gateDoorLeft = new THREE.Group();
    Game.gateDoorLeft.position.set(0, 0, -2.0);
    const doorLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.0, 2.0), doorMat);
    doorLMesh.position.set(0, 2.5, 1.0);
    doorLMesh.castShadow = true;
    Game.gateDoorLeft.add(doorLMesh);
    Game.gateGroup.add(Game.gateDoorLeft);

    // Right Door Pivot at z = 2.0
    Game.gateDoorRight = new THREE.Group();
    Game.gateDoorRight.position.set(0, 0, 2.0);
    const doorRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.0, 2.0), doorMat);
    doorRMesh.position.set(0, 2.5, -1.0);
    doorRMesh.castShadow = true;
    Game.gateDoorRight.add(doorRMesh);
    Game.gateGroup.add(Game.gateDoorRight);

    // Glowing Purple Runic Barrier (Active when LOCKED)
    const runeGeo = new THREE.PlaneGeometry(0.1, 4.8);
    const runeBarrierGeo = new THREE.PlaneGeometry(4.0, 4.8);
    const runeMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide
    });
    Game.gateRunicBarrier = new THREE.Mesh(runeBarrierGeo, runeMat);
    Game.gateRunicBarrier.rotation.y = Math.PI / 2;
    Game.gateRunicBarrier.position.set(0, 2.5, 0);
    Game.gateGroup.add(Game.gateRunicBarrier);

    scene.add(Game.gateGroup);

    // 5. Celestial Sanctuary Altar & Floating Crystal (x: 16, z: -5)
    const altarDaisGeo = new THREE.CylinderGeometry(3.0, 3.5, 0.8, 16);
    const altarMat = new THREE.MeshStandardMaterial({ color: 0x311b92, roughness: 0.4, metalness: 0.3 });
    const dais = new THREE.Mesh(altarDaisGeo, altarMat);
    dais.position.set(16, 0.4, -5);
    dais.receiveShadow = true;
    scene.add(dais);

    // Levitating Sacred Crystal
    const crystalGeo = new THREE.OctahedronGeometry(1.2, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xe879f9,
      emissive: 0xa855f7,
      emissiveIntensity: 0.7,
      roughness: 0.2,
      metalness: 0.8
    });
    Game.relicCrystal = new THREE.Mesh(crystalGeo, crystalMat);
    Game.relicCrystal.position.set(16, 2.6, -5);
    Game.relicCrystal.castShadow = true;
    scene.add(Game.relicCrystal);

    // Crystal Point Light
    const crystalLight = new THREE.PointLight(0xc084fc, 3.2, 16);
    crystalLight.position.set(16, 2.6, -5);
    scene.add(crystalLight);

    // 6. Ghost Crypt: Tombs & Treasure Chest (x: 18, z: 16)
    const tombMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
    const tombs = [
      [9, 13], [14, 18], [20, 12], [11, 21], [22, 20]
    ];
    tombs.forEach(([tx, tz]) => {
      const tGeo = new THREE.BoxGeometry(0.8, 1.4, 0.4);
      const tMesh = new THREE.Mesh(tGeo, tombMat);
      tMesh.position.set(tx, 0.7, tz);
      tMesh.rotation.y = (Math.random() - 0.5) * 0.4;
      tMesh.castShadow = true;
      scene.add(tMesh);
    });

    // 3D Ancient Treasure Chest (x: 18, z: 16)
    Game.chestGroup = new THREE.Group();
    Game.chestGroup.position.set(18, 0, 16);

    // Chest Base
    const chestBodyMat = new THREE.MeshStandardMaterial({ color: 0x5c2b0c, roughness: 0.65, metalness: 0.2 });
    const chestBody = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.2), chestBodyMat);
    chestBody.position.set(0, 0.45, 0);
    chestBody.castShadow = true;
    Game.chestGroup.add(chestBody);

    // Chest Lid Pivot (hinge along rear at y = 0.9, z = -0.6)
    Game.chestLid = new THREE.Group();
    Game.chestLid.position.set(0, 0.9, -0.6);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.4, 1.24), chestBodyMat);
    lidMesh.position.set(0, 0.2, 0.6);
    lidMesh.castShadow = true;
    Game.chestLid.add(lidMesh);
    Game.chestGroup.add(Game.chestLid);

    // Chest Glowing Gold Lock
    const lockMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.1
    });
    const lockMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.15), lockMat);
    lockMesh.position.set(0, 0.7, 0.62);
    Game.chestGroup.add(lockMesh);

    Game.chestLockLight = new THREE.PointLight(0xfbbf24, 2.0, 4);
    Game.chestLockLight.position.set(0, 0.8, 0.8);
    Game.chestGroup.add(Game.chestLockLight);

    scene.add(Game.chestGroup);

    // 7. Spectral Patrolling Ghosts
    createGhosts(scene);
  }

  // Add Dynamic Torchlight
  function addTorch(x, y, z, colorHex) {
    const pLight = new THREE.PointLight(colorHex, 2.2, 12);
    pLight.position.set(x, y, z);
    Game.scene.add(pLight);
    Game.torches.push({ light: pLight, baseIntensity: 2.2, flickerOffset: Math.random() * 10 });
  }

  // Create Patrolling Ghosts
  function createGhosts(scene) {
    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.7,
      roughness: 0.2
    });

    const ghostConfigs = [
      { cx: 14, cz: 15, rx: 4.5, rz: 3.5, speed: 0.6, angle: 0 },
      { cx: 18, cz: 19, rx: 3.5, rz: 4.0, speed: 0.5, angle: Math.PI },
      { cx: 21, cz: 14, rx: 4.0, rz: 3.0, speed: 0.7, angle: Math.PI / 2 }
    ];

    ghostConfigs.forEach((cfg) => {
      const gGroup = new THREE.Group();

      // Ghost Head & Body
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12), ghostMat);
      head.position.y = 1.2;
      gGroup.add(head);

      const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 12), ghostMat);
      body.rotation.x = Math.PI;
      body.position.y = 0.6;
      gGroup.add(body);

      // Glowing Eyes
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), eyeMat);
      eyeL.position.set(-0.18, 1.25, 0.48);
      gGroup.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), eyeMat);
      eyeR.position.set(0.18, 1.25, 0.48);
      gGroup.add(eyeR);

      gGroup.position.set(cfg.cx, 1.2, cfg.cz);
      scene.add(gGroup);

      Game.ghosts.push({ group: gGroup, cfg });
    });
  }

  // --- BUILD 3D PLAYER MODEL ---
  function buildPlayer(scene) {
    const pGroup = new THREE.Group();

    // Torso / Navy Tunic
    const tunicMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.6 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.0, 10), tunicMat);
    torso.position.y = 1.1;
    torso.castShadow = true;
    pGroup.add(torso);

    // Adventurer Cloak & Hood
    const capeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.2, 0.2), capeMat);
    cape.position.set(0, 1.05, -0.32);
    cape.castShadow = true;
    pGroup.add(cape);

    // Head
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfed7aa, roughness: 0.5 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), headMat);
    head.position.y = 1.82;
    head.castShadow = true;
    pGroup.add(head);

    // Adventurer Hood
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 12), capeMat);
    hood.position.set(0, 1.85, -0.06);
    hood.castShadow = true;
    pGroup.add(hood);

    // Left & Right Legs for walk animation
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
    const legGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.7, 8);

    Game.playerLegL = new THREE.Mesh(legGeo, bootMat);
    Game.playerLegL.position.set(-0.22, 0.35, 0);
    Game.playerLegL.castShadow = true;
    pGroup.add(Game.playerLegL);

    Game.playerLegR = new THREE.Mesh(legGeo, bootMat);
    Game.playerLegR.position.set(0.22, 0.35, 0);
    Game.playerLegR.castShadow = true;
    pGroup.add(Game.playerLegR);

    // Glowing Adventurer Amulet / Handheld lantern
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6
    });
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lanternMat);
    lantern.position.set(0.48, 1.1, 0.3);
    pGroup.add(lantern);

    pGroup.position.set(-10, 0, 0);
    scene.add(pGroup);
    Game.playerMesh = pGroup;
  }

  // --- BUILD 3D MAAYA NPC MODEL ---
  function buildMaaya(scene) {
    const mGroup = new THREE.Group();

    // Flowing Gothic Gown (Midnight Violet)
    const gownMat = new THREE.MeshStandardMaterial({
      color: 0x180e2b,
      roughness: 0.6,
      metalness: 0.2
    });
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 14), gownMat);
    skirt.position.y = 0.9;
    skirt.castShadow = true;
    mGroup.add(skirt);

    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.7, 12), gownMat);
    bodice.position.y = 1.85;
    bodice.castShadow = true;
    mGroup.add(bodice);

    // Porcelain Head
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfdf4ff, roughness: 0.4 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 14), skinMat);
    head.position.y = 2.38;
    head.castShadow = true;
    mGroup.add(head);

    // Raven Hair
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x090312, roughness: 0.3 });
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 14), hairMat);
    hair.position.set(0, 2.42, -0.06);
    mGroup.add(hair);

    // Hair flowing back strands
    const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 1.3, 8), hairMat);
    strand.position.set(0, 1.85, -0.22);
    mGroup.add(strand);

    // Silver Diadem / Crescent
    const diademMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.1 });
    const diadem = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 6, 16, Math.PI), diademMat);
    diadem.rotation.x = Math.PI / 2;
    diadem.position.set(0, 2.52, 0.08);
    mGroup.add(diadem);

    // Glowing Amethyst Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
    eyeL.position.set(-0.11, 2.41, 0.25);
    mGroup.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
    eyeR.position.set(0.11, 2.41, 0.25);
    mGroup.add(eyeR);

    // Arms for spellcasting animation
    const armGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.75, 8);
    Game.maayaLeftArm = new THREE.Mesh(armGeo, gownMat);
    Game.maayaLeftArm.position.set(-0.45, 1.7, 0);
    mGroup.add(Game.maayaLeftArm);

    Game.maayaRightArm = new THREE.Mesh(armGeo, gownMat);
    Game.maayaRightArm.position.set(0.45, 1.7, 0);
    mGroup.add(Game.maayaRightArm);

    // Mystical Aura Disc beneath MAAYA
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    Game.maayaAura = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.25, 24), auraMat);
    Game.maayaAura.rotation.x = -Math.PI / 2;
    Game.maayaAura.position.y = 0.03;
    mGroup.add(Game.maayaAura);

    mGroup.position.set(Game.maayaHome.x, Game.maayaHome.y, Game.maayaHome.z);
    mGroup.rotation.y = -Math.PI / 2; // Facing the player courtyard
    scene.add(mGroup);
    Game.maayaMesh = mGroup;
  }

  // --- NOTIFICATION BANNER ---
  function showNotification(text, duration = 3500) {
    const banner = document.getElementById('inGameNotification');
    if (banner) {
      banner.textContent = text;
      banner.style.display = 'block';
      Game.notificationTimer = Date.now() + duration;
    }
  }

  function updateNotification() {
    if (Game.notificationTimer > 0 && Date.now() > Game.notificationTimer) {
      Game.notificationTimer = 0;
      const banner = document.getElementById('inGameNotification');
      if (banner) banner.style.display = 'none';
    }
  }

  // --- MAAYA 3D ACTION SEQUENCES ---
  function executeGateOpeningSequence() {
    if (Game.gateState === 'OPEN') return;

    showNotification("✦ MAAYA: 'Step back... the seal shall be broken.'");
    Game.maayaState = 'WALKING_TO_GATE';
    Game.maayaTarget = { ...Game.maayaGatePedestal };
  }

  function updateMaaya(delta) {
    if (!Game.maayaMesh) return;
    const time = Date.now() / 1000;

    // Idle floating bob
    const bob = Math.sin(time * 2.5) * 0.08;
    Game.maayaMesh.position.y = (Game.maayaTarget ? 0 : 0) + bob;

    // Pulse Aura
    if (Game.maayaAura) {
      Game.maayaAura.rotation.z += delta * 0.8;
      const scale = 1 + Math.sin(time * 3) * 0.12;
      Game.maayaAura.scale.set(scale, scale, 1);
    }

    // Walking to gate pedestal
    if (Game.maayaState === 'WALKING_TO_GATE') {
      const dx = Game.maayaTarget.x - Game.maayaMesh.position.x;
      const dz = Game.maayaTarget.z - Game.maayaMesh.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.2) {
        Game.maayaMesh.position.x = Game.maayaTarget.x;
        Game.maayaMesh.position.z = Game.maayaTarget.z;
        Game.maayaTarget = null;
        Game.maayaState = 'OPENING_GATE';
        Game.maayaMesh.rotation.y = 0; // Face the gate (East/+X)

        playSound('gate');
        showNotification("✦ The ancient iron gears groan and grind open...");
      } else {
        const step = Math.min(Game.maayaSpeed * delta, dist);
        Game.maayaMesh.position.x += (dx / dist) * step;
        Game.maayaMesh.position.z += (dz / dist) * step;
        Game.maayaMesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Opening Spell Animation
    if (Game.maayaState === 'OPENING_GATE') {
      // Arms raised
      if (Game.maayaLeftArm && Game.maayaRightArm) {
        Game.maayaLeftArm.rotation.x = -Math.PI / 2.5;
        Game.maayaRightArm.rotation.x = -Math.PI / 2.5;
      }

      // Animate gate doors opening over 2.4 seconds
      Game.gateOpenProgress += delta / 2.4;

      if (Game.gateDoorLeft && Game.gateDoorRight) {
        const angle = Math.min(Math.PI / 2, Game.gateOpenProgress * (Math.PI / 2));
        Game.gateDoorLeft.rotation.y = angle;
        Game.gateDoorRight.rotation.y = -angle;
      }

      // Fade rune barrier
      if (Game.gateRunicBarrier) {
        Game.gateRunicBarrier.material.opacity = Math.max(0, 0.55 * (1 - Game.gateOpenProgress));
        if (Game.gateOpenProgress >= 1) {
          Game.gateRunicBarrier.visible = false;
        }
      }

      if (Game.gateOpenProgress >= 1) {
        Game.gateState = 'OPEN';
        Game.maayaState = 'CELEBRATING';

        // Notify backend server of completion
        fetch('/api/game/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'COMPLETE_GATE_OPEN', sessionId: Game.sessionId })
        }).catch(() => {});

        playSound('fanfare');
        showNotification("🏆 The Sanctuary Gate is OPEN! Walk through to claim your destiny!");

        // Return to vigil post after 3 seconds
        setTimeout(() => {
          Game.maayaState = 'RETURNING';
          Game.maayaTarget = { ...Game.maayaHome };
        }, 3000);
      }
    }

    // Returning to home post
    if (Game.maayaState === 'RETURNING') {
      if (Game.maayaLeftArm && Game.maayaRightArm) {
        Game.maayaLeftArm.rotation.x = 0;
        Game.maayaRightArm.rotation.x = 0;
      }

      const dx = Game.maayaTarget.x - Game.maayaMesh.position.x;
      const dz = Game.maayaTarget.z - Game.maayaMesh.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.2) {
        Game.maayaMesh.position.x = Game.maayaTarget.x;
        Game.maayaMesh.position.z = Game.maayaTarget.z;
        Game.maayaTarget = null;
        Game.maayaState = 'IDLE';
        Game.maayaMesh.rotation.y = -Math.PI / 2;
      } else {
        const step = Math.min(Game.maayaSpeed * delta, dist);
        Game.maayaMesh.position.x += (dx / dist) * step;
        Game.maayaMesh.position.z += (dz / dist) * step;
        Game.maayaMesh.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  // --- GHOST PATROL ANIMATION ---
  function updateGhosts(delta) {
    const time = Date.now() / 1000;
    Game.ghosts.forEach(({ group, cfg }) => {
      cfg.angle += cfg.speed * delta;
      group.position.x = cfg.cx + Math.cos(cfg.angle) * cfg.rx;
      group.position.z = cfg.cz + Math.sin(cfg.angle) * cfg.rz;
      group.position.y = 1.2 + Math.sin(time * 3 + cfg.angle) * 0.25;
      group.rotation.y = -cfg.angle + Math.PI / 2;
    });
  }

  // --- CELESTIAL CRYSTAL & TORCH FLICKER ---
  function updateEnvironment(delta) {
    // Spin celestial crystal
    if (Game.relicCrystal) {
      Game.relicCrystal.rotation.y += delta * 0.8;
      Game.relicCrystal.rotation.x += delta * 0.4;
      Game.relicCrystal.position.y = 2.6 + Math.sin(Date.now() / 350) * 0.15;
    }

    // Torch light flicker
    const t = Date.now() / 120;
    Game.torches.forEach(({ light, baseIntensity, flickerOffset }) => {
      light.intensity = baseIntensity + Math.sin(t + flickerOffset) * 0.35 + (Math.random() - 0.5) * 0.15;
    });
  }

  // --- PROXIMITY & INTERACTION CHECKS ---
  function updateInteractions() {
    Game.promptText = null;
    Game.promptTarget = null;

    if (Game.dialogueOpen || !Game.playerMesh || !Game.maayaMesh) return;

    const px = Game.playerMesh.position.x;
    const pz = Game.playerMesh.position.z;

    // Check MAAYA proximity
    const mx = Game.maayaMesh.position.x;
    const mz = Game.maayaMesh.position.z;
    const distToMaaya = Math.hypot(px - mx, pz - mz);

    if (distToMaaya < 3.8) {
      Game.promptText = "Press [E] to Speak with MAAYA";
      Game.promptTarget = 'MAAYA';
      updatePromptUI();
      return;
    }

    // Check Treasure Chest proximity (at x: 18, z: 16)
    const distToChest = Math.hypot(px - 18, pz - 16);
    if (distToChest < 3.2) {
      if (!Game.treasureChestOpened) {
        Game.promptText = "Press [E] to Open Ancient Chest";
        Game.promptTarget = 'CHEST';
      } else {
        Game.promptText = "Empty Ancient Chest";
        Game.promptTarget = 'CHEST_EMPTY';
      }
      updatePromptUI();
      return;
    }

    // Check Gate proximity
    const distToGate = Math.hypot(px - 4, pz - 0);
    if (distToGate < 3.5 && Game.gateState === 'LOCKED') {
      Game.promptText = "Sealed Sanctuary Gate (Converse with MAAYA)";
      Game.promptTarget = 'GATE';
      updatePromptUI();
      return;
    }

    updatePromptUI();
  }

  function updatePromptUI() {
    let promptEl = document.getElementById('inGame3DPrompt');
    if (!promptEl) {
      promptEl = document.createElement('div');
      promptEl.id = 'inGame3DPrompt';
      promptEl.className = 'in-game-3d-prompt';
      const wrapper = document.getElementById('canvasWrapper');
      if (wrapper) wrapper.appendChild(promptEl);
    }

    if (Game.promptText && !Game.dialogueOpen) {
      promptEl.textContent = Game.promptText;
      promptEl.style.display = 'block';
    } else {
      promptEl.style.display = 'none';
    }
  }

  // Handle [E] Interaction
  async function interact() {
    if (!Game.promptTarget) return;

    if (Game.promptTarget === 'MAAYA') {
      openDialogue();
    } else if (Game.promptTarget === 'CHEST' && !Game.treasureChestOpened) {
      await collectTreasure();
    }
  }

  // Collect Treasure
  async function collectTreasure() {
    if (Game.treasureChestOpened || Game.hasTreasure) return;

    try {
      const res = await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'COLLECT_TREASURE', sessionId: Game.sessionId })
      });
      const data = await res.json();
      if (data.success) {
        Game.treasureChestOpened = true;
        Game.hasTreasure = true;
        if (Game.questStatus === 'ACTIVE') {
          Game.questStatus = 'TREASURE_COLLECTED';
        }

        // Open 3D Chest Lid
        if (Game.chestLid) {
          Game.chestLid.rotation.x = -Math.PI / 2.2; // Swing lid back
        }
        if (Game.chestLockLight) {
          Game.chestLockLight.color.setHex(0x38bdf8); // Turn blue
        }

        playSound('chest');
        showNotification("★ Acquired: Amulet of the Sunken Veil!");
        updateHUD();
      }
    } catch (e) {
      console.error("Failed to collect treasure:", e);
    }
  }

  // Enter Sanctuary Trigger
  async function checkSanctuaryEntrance() {
    if (Game.gateState !== 'OPEN' || Game.rewardClaimed || !Game.playerMesh) return;

    const px = Game.playerMesh.position.x;
    const pz = Game.playerMesh.position.z;

    // Check if player entered the Inner Sanctuary Altar Chamber (x > 10, z < 3)
    if (px > 11 && pz < 4 && pz > -12) {
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
  }

  // --- DIALOGUE UI INTERFACE ---
  function openDialogue() {
    Game.dialogueOpen = true;
    if (Game.controller) Game.controller.resetKeys();
    Game.maayaState = 'TALKING';
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
    if (Game.maayaState === 'TALKING') {
      Game.maayaState = 'IDLE';
    }
    const modal = document.getElementById('inGameDialogueModal');
    if (modal) {
      modal.style.display = 'none';
    }
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
    }
    if (Game.canvas) {
      Game.canvas.focus();
    }
    if (Game.controller) Game.controller.resetKeys();
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
    } else if (Game.questStatus === 'READY_TO_COMPLETE' || Game.gateState === 'OPENING') {
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

  // Reset Game Demo (for judges)
  async function resetGame() {
    try {
      const res = await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RESET_GAME', sessionId: Game.sessionId })
      });
      const data = await res.json();
      if (data.success) {
        // Reset player 3D position
        if (Game.controller) {
          Game.controller.position = { x: -10, y: 0, z: 0 };
          Game.controller.resetKeys();
        }
        if (Game.playerMesh) {
          Game.playerMesh.position.set(-10, 0, 0);
          Game.playerMesh.rotation.y = 0;
        }

        // Reset MAAYA
        if (Game.maayaMesh) {
          Game.maayaMesh.position.set(Game.maayaHome.x, Game.maayaHome.y, Game.maayaHome.z);
          Game.maayaMesh.rotation.y = -Math.PI / 2;
        }
        Game.maayaState = 'IDLE';
        Game.maayaTarget = null;

        // Reset Gate
        Game.gateState = 'LOCKED';
        Game.gateOpenProgress = 0;
        if (Game.gateDoorLeft) Game.gateDoorLeft.rotation.y = 0;
        if (Game.gateDoorRight) Game.gateDoorRight.rotation.y = 0;
        if (Game.gateRunicBarrier) {
          Game.gateRunicBarrier.visible = true;
          Game.gateRunicBarrier.material.opacity = 0.55;
        }

        // Reset Chest
        Game.treasureChestOpened = false;
        if (Game.chestLid) Game.chestLid.rotation.x = 0;
        if (Game.chestLockLight) Game.chestLockLight.color.setHex(0xfbbf24);

        // Reset Progress
        Game.questStatus = 'NOT_STARTED';
        Game.hasTreasure = false;
        Game.gold = 0;
        Game.xp = 0;
        Game.rewardClaimed = false;

        closeDialogue();
        updateHUD();
        showNotification("↺ Demo Reset: Pristine 3D state restored for judges!");
        playSound('chirp');

        if (window.resetDialogueUI) {
          window.resetDialogueUI(data.greeting);
        }
      }
    } catch (e) {
      console.error("Failed to reset game:", e);
    }
  }

  // --- KEYBOARD INPUT HANDLERS ---
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

  function handleKeyDown(e) {
    if (isTypingInInput()) {
      if (e.key === 'Escape') {
        closeDialogue();
        e.preventDefault();
      }
      return;
    }

    activateGameFocus();

    const code = e.code || '';
    const key = (e.key || '').toLowerCase();

    // Prevent default browser scrolling on arrow keys and space
    if (
      key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright' ||
      code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight' ||
      key === ' ' || code === 'Space'
    ) {
      e.preventDefault();
    }

    if (Game.controller) {
      Game.controller.setKey(code, true);
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
    if (isTypingInInput()) return;

    const code = e.code || '';
    const key = (e.key || '').toLowerCase();

    if (
      key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright' ||
      code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (Game.controller) {
      Game.controller.setKey(code, false);
    }
  }

  function handleWindowBlur() {
    if (Game.controller) {
      Game.controller.resetKeys();
    }
  }

  let inputListenersAttached = false;
  function registerInputListeners() {
    if (inputListenersAttached) return;
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp, { passive: false });
    window.addEventListener('blur', handleWindowBlur);
    inputListenersAttached = true;
  }

  // --- MAIN 3D ANIMATION & RENDER LOOP ---
  function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(Game.clock.getDelta(), 0.08); // Cap delta to prevent teleports

    // 1. Update Player Movement & Camera
    if (!Game.dialogueOpen && Game.controller) {
      // Keep obstacle list updated (e.g. when gate opens)
      Game.controller.obstacles = getObstacles();
      Game.controller.update(delta);

      if (Game.playerMesh) {
        Game.playerMesh.position.x = Game.controller.position.x;
        Game.playerMesh.position.z = Game.controller.position.z;

        if (Game.controller.moving) {
          // Smooth rotation to direction
          Game.playerMesh.rotation.y = Game.controller.rotation;

          // Animate leg swings
          const legSwing = Math.sin(Game.controller.stepTimer * 12) * 0.45;
          if (Game.playerLegL) Game.playerLegL.rotation.x = legSwing;
          if (Game.playerLegR) Game.playerLegR.rotation.x = -legSwing;

          // Step sound effects
          if (Math.floor(Game.controller.stepTimer * 5) % 2 === 0) {
            playSound('step');
          }
        } else {
          if (Game.playerLegL) Game.playerLegL.rotation.x = 0;
          if (Game.playerLegR) Game.playerLegR.rotation.x = 0;
        }

        // Smooth camera following (Third-person chase camera)
        const targetCamX = Game.playerMesh.position.x + Game.cameraOffset.x;
        const targetCamY = Game.playerMesh.position.y + Game.cameraOffset.y;
        const targetCamZ = Game.playerMesh.position.z + Game.cameraOffset.z;

        Game.camera.position.x += (targetCamX - Game.camera.position.x) * 0.12;
        Game.camera.position.y += (targetCamY - Game.camera.position.y) * 0.12;
        Game.camera.position.z += (targetCamZ - Game.camera.position.z) * 0.12;

        Game.camera.lookAt(
          Game.playerMesh.position.x,
          Game.playerMesh.position.y + 1.2,
          Game.playerMesh.position.z
        );
      }
    }

    // 2. Update MAAYA, Ghosts, and Environment
    updateMaaya(delta);
    updateGhosts(delta);
    updateEnvironment(delta);
    updateInteractions();
    checkSanctuaryEntrance();
    updateNotification();

    // 3. Render 3D Scene
    if (Game.renderer && Game.scene && Game.camera) {
      Game.renderer.render(Game.scene, Game.camera);
    }
  }

  // --- INITIALIZATION ---
  window.initGameEngine = function (sessionId) {
    if (Game.initialized) return;
    Game.canvas = document.getElementById('gameCanvas');
    if (!Game.canvas) return;
    Game.initialized = true;

    Game.sessionId = sessionId || sessionStorage.getItem('cognitive_npc_session_id') || crypto.randomUUID();

    // Setup Three.js Scene
    Game.scene = new THREE.Scene();
    Game.scene.background = new THREE.Color(0x0c0a1a);
    Game.scene.fog = new THREE.FogExp2(0x0c0a1a, 0.022);

    // Camera
    Game.camera = new THREE.PerspectiveCamera(50, 1000 / 620, 0.1, 100);
    Game.camera.position.set(-10, 7.5, 11.5);

    // Renderer
    Game.renderer = new THREE.WebGLRenderer({
      canvas: Game.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    Game.renderer.setSize(1000, 620, false);
    Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    Game.renderer.shadowMap.enabled = true;
    Game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Atmospheric Lights
    const ambientLight = new THREE.AmbientLight(0x2e1065, 0.65);
    Game.scene.add(ambientLight);

    const moonLight = new THREE.DirectionalLight(0x93c5fd, 1.1);
    moonLight.position.set(-15, 20, 10);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = 1024;
    moonLight.shadow.mapSize.height = 1024;
    moonLight.shadow.camera.near = 0.5;
    moonLight.shadow.camera.far = 50;
    moonLight.shadow.camera.left = -25;
    moonLight.shadow.camera.right = 25;
    moonLight.shadow.camera.top = 25;
    moonLight.shadow.camera.bottom = -25;
    Game.scene.add(moonLight);

    // Movement Controller Instance
    const Obstacles = getObstacles();
    const ControllerClass = window.PlayerMovementController;
    if (ControllerClass) {
      Game.controller = new ControllerClass({
        x: -10,
        y: 0,
        z: 0,
        speed: 7.2,
        obstacles: Obstacles
      });
    }

    // Build 3D World Entities
    buildWorld(Game.scene);
    buildPlayer(Game.scene);
    buildMaaya(Game.scene);

    // Register Input Listeners
    registerInputListeners();

    // Hook overlay & buttons
    const overlay = document.getElementById('gameFocusOverlay');
    const startBtn = document.getElementById('startGameBtn');
    if (overlay) overlay.addEventListener('click', activateGameFocus);
    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activateGameFocus();
      });
    }

    Game.canvas.addEventListener('click', activateGameFocus);
    const wrapper = document.getElementById('canvasWrapper');
    if (wrapper) wrapper.addEventListener('click', activateGameFocus);

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

    // Initial HUD Sync
    updateHUD();

    // Focus canvas automatically
    try {
      Game.canvas.focus();
    } catch (e) {}

    // Start 3D Loop
    if (!Game.loopStarted) {
      Game.loopStarted = true;
      requestAnimationFrame(animate);
    }
  };

  // Export global API for app.js
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
      Game.maayaState = thinking ? 'THINKING' : (Game.dialogueOpen ? 'TALKING' : 'IDLE');
    },
    syncServerState: (state) => {
      if (!state) return;
      Game.questStatus = state.questStatus;
      Game.hasTreasure = state.hasTreasure;
      Game.gold = state.gold;
      Game.xp = state.xp;
      Game.rewardClaimed = state.rewardClaimed;

      if (state.gateState === 'OPEN') {
        Game.gateState = 'OPEN';
        Game.gateOpenProgress = 1;
        if (Game.gateDoorLeft) Game.gateDoorLeft.rotation.y = Math.PI / 2;
        if (Game.gateDoorRight) Game.gateDoorRight.rotation.y = -Math.PI / 2;
        if (Game.gateRunicBarrier) Game.gateRunicBarrier.visible = false;
      }
      if (state.treasureChestOpened) {
        Game.treasureChestOpened = true;
        if (Game.chestLid) Game.chestLid.rotation.x = -Math.PI / 2.2;
        if (Game.chestLockLight) Game.chestLockLight.color.setHex(0x38bdf8);
      }
      updateHUD();
    }
  };

  // Auto-initialize 3D engine if DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => {
      if (!Game.initialized && window.initGameEngine) {
        window.initGameEngine();
      }
    }, 10);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      if (!Game.initialized && window.initGameEngine) {
        window.initGameEngine();
      }
    });
  }

})();
