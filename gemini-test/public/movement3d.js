/**
 * MaayaVerse: The Living NPC — 3D Player Movement Controller
 * 
 * Implements:
 * - Normalized WASD & Arrow Key velocity calculation
 * - Solid 3D collision detection with separate-axis wall sliding
 * - Camera follower offset calculations
 * - Key release & window blur sanitization
 */

class PlayerMovementController {
  constructor(options = {}) {
    this.speed = options.speed || 7.0; // Units per second
    this.position = {
      x: options.x !== undefined ? options.x : -12,
      y: options.y !== undefined ? options.y : 0,
      z: options.z !== undefined ? options.z : 0
    };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.rotation = 0; // Facing angle in radians
    this.radius = options.radius || 0.65; // Collision radius
    this.height = options.height || 1.8;
    this.moving = false;
    this.stepTimer = 0;
    this.obstacles = options.obstacles || [];
    this.onIce = false; // Stage 3 Slippery Ice Surface dynamics

    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };
  }

  setKey(keyOrCode, isPressed) {
    const k = (keyOrCode || '').toLowerCase();
    const c = keyOrCode || '';

    if (c === 'KeyW' || k === 'w' || c === 'ArrowUp' || k === 'arrowup') {
      this.keys.up = isPressed;
    }
    if (c === 'KeyS' || k === 's' || c === 'ArrowDown' || k === 'arrowdown') {
      this.keys.down = isPressed;
    }
    if (c === 'KeyA' || k === 'a' || c === 'ArrowLeft' || k === 'arrowleft') {
      this.keys.left = isPressed;
    }
    if (c === 'KeyD' || k === 'd' || c === 'ArrowRight' || k === 'arrowright') {
      this.keys.right = isPressed;
    }
  }

  resetKeys() {
    this.keys.up = false;
    this.keys.down = false;
    this.keys.left = false;
    this.keys.right = false;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.moving = false;
  }

  update(deltaTime = 0.016) {
    let moveX = 0;
    let moveZ = 0;

    if (this.keys.up) moveZ -= 1;
    if (this.keys.down) moveZ += 1;
    if (this.keys.left) moveX -= 1;
    if (this.keys.right) moveX += 1;

    // Normalize diagonal movement vector so diagonal speed == straight speed
    if (moveX !== 0 && moveZ !== 0) {
      const invLen = 1 / Math.SQRT2;
      moveX *= invLen;
      moveZ *= invLen;
    }

    const hasInput = (moveX !== 0 || moveZ !== 0);

    if (this.onIce) {
      // Slippery ice surface: reduced friction & sliding momentum
      const targetVx = moveX * this.speed;
      const targetVz = moveZ * this.speed;
      const accel = hasInput ? 4.0 * deltaTime : 1.2 * deltaTime;
      const friction = hasInput ? 0.98 : 0.94; // Slide when keys released

      this.velocity.x = (this.velocity.x + targetVx * accel) * friction;
      this.velocity.z = (this.velocity.z + targetVz * accel) * friction;

      if (Math.abs(this.velocity.x) < 0.05) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.05) this.velocity.z = 0;

      this.moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.1;
      if (this.moving) {
        this.rotation = Math.atan2(this.velocity.x, this.velocity.z);
        this.stepTimer += deltaTime;

        const nextX = this.position.x + this.velocity.x * deltaTime;
        const nextZ = this.position.z + this.velocity.z * deltaTime;

        if (!this.checkCollision(nextX, this.position.z)) {
          this.position.x = nextX;
        } else {
          this.velocity.x *= -0.2; // slight bounce off wall
        }
        if (!this.checkCollision(this.position.x, nextZ)) {
          this.position.z = nextZ;
        } else {
          this.velocity.z *= -0.2;
        }
      }
    } else {
      // Standard responsive movement
      this.moving = hasInput;
      if (this.moving) {
        this.velocity.x = moveX * this.speed;
        this.velocity.z = moveZ * this.speed;
        this.rotation = Math.atan2(moveX, moveZ);
        this.stepTimer += deltaTime;

        const nextX = this.position.x + this.velocity.x * deltaTime;
        const nextZ = this.position.z + this.velocity.z * deltaTime;

        // Check collision with separate X and Z resolution for smooth wall sliding
        if (!this.checkCollision(nextX, this.position.z)) {
          this.position.x = nextX;
        }
        if (!this.checkCollision(this.position.x, nextZ)) {
          this.position.z = nextZ;
        }
      } else {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }
  }

  checkCollision(x, z) {
    const r = this.radius;
    for (const b of this.obstacles) {
      if (
        x + r > b.minX &&
        x - r < b.maxX &&
        z + r > b.minZ &&
        z - r < b.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  getCameraTargetPosition(cameraOffset = { x: 0, y: 7.5, z: 11.5 }) {
    return {
      x: this.position.x + cameraOffset.x,
      y: this.position.y + cameraOffset.y,
      z: this.position.z + cameraOffset.z
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerMovementController };
}
if (typeof window !== 'undefined') {
  window.PlayerMovementController = PlayerMovementController;
}
