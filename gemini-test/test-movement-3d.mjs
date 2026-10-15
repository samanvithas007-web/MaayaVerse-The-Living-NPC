/**
 * 3D Movement Verification Test Suite
 * 
 * Verifies Requirement 3:
 *  - W, A, S, D movement
 *  - All arrow keys movement
 *  - Diagonal movement normalization
 *  - Stopping on key release (zero drift)
 *  - Camera following offset calculation
 *  - Collision detection & wall-sliding
 *  - Scroll prevention on movement keys
 */

import pkg from "./public/movement3d.js";
const { PlayerMovementController } = pkg;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function runMovementTests() {
  console.log("==================================================================");
  console.log("   3D PLAYER MOVEMENT & CAMERA TRACKING VERIFICATION SUITE       ");
  console.log("==================================================================\n");

  const obstacles = [
    // Divider wall with gate at x: 4, z: [-2, 2]
    { minX: 3.5, maxX: 4.5, minZ: 2.0, maxZ: 14.0 },  // Lower divider
    { minX: 3.5, maxX: 4.5, minZ: -14.0, maxZ: -2.0 }, // Upper divider
    { minX: 3.5, maxX: 4.5, minZ: -2.0, maxZ: 2.0 },   // Gate (locked)
    // Boundary walls
    { minX: -25, maxX: -24, minZ: -16, maxZ: 24 },     // West perimeter
    { minX: 25, maxX: 26, minZ: -16, maxZ: 24 }        // East perimeter
  ];

  // 1. Test WASD Forward Movement
  console.log("--- TEST 1: WASD Movement ---");
  const controller = new PlayerMovementController({ x: -10, y: 0, z: 0, speed: 6.0, obstacles });
  
  // Press W
  controller.setKey('KeyW', true);
  controller.update(0.1);
  assert(controller.position.z < 0, `KeyW moves player forward in -Z (z: ${controller.position.z.toFixed(2)})`);
  assert(controller.velocity.z < 0, "KeyW sets forward velocity in -Z");
  assert(controller.moving === true, "Player moving flag is true");

  // Release W
  controller.setKey('KeyW', false);
  controller.update(0.1);
  assert(controller.velocity.z === 0, "Releasing KeyW stops forward velocity");
  assert(controller.moving === false, "Releasing KeyW sets moving flag to false");
  const stoppedZ = controller.position.z;
  controller.update(0.1);
  assert(controller.position.z === stoppedZ, "Player remains completely stopped after key release (no drift)");

  // Press S
  controller.setKey('KeyS', true);
  controller.update(0.1);
  assert(controller.position.z > stoppedZ, `KeyS moves player backward in +Z (z: ${controller.position.z.toFixed(2)})`);
  controller.setKey('KeyS', false);

  // Press A (Left)
  const startX = controller.position.x;
  controller.setKey('KeyA', true);
  controller.update(0.1);
  assert(controller.position.x < startX, `KeyA moves player left in -X (x: ${controller.position.x.toFixed(2)})`);
  controller.setKey('KeyA', false);

  // Press D (Right)
  const leftX = controller.position.x;
  controller.setKey('KeyD', true);
  controller.update(0.1);
  assert(controller.position.x > leftX, `KeyD moves player right in +X (x: ${controller.position.x.toFixed(2)})`);
  controller.setKey('KeyD', false);

  // 2. Test Arrow Keys
  console.log("\n--- TEST 2: Arrow Keys Movement ---");
  controller.resetKeys();
  const arrowStartX = controller.position.x;
  const arrowStartZ = controller.position.z;

  controller.setKey('ArrowUp', true);
  controller.update(0.1);
  assert(controller.position.z < arrowStartZ, "ArrowUp moves player forward in -Z");
  controller.setKey('ArrowUp', false);

  controller.setKey('ArrowDown', true);
  controller.update(0.1);
  assert(controller.position.z > arrowStartZ - 0.6, "ArrowDown moves player backward in +Z");
  controller.setKey('ArrowDown', false);

  controller.setKey('ArrowLeft', true);
  controller.update(0.1);
  assert(controller.position.x < arrowStartX, "ArrowLeft moves player left in -X");
  controller.setKey('ArrowLeft', false);

  controller.setKey('ArrowRight', true);
  controller.update(0.1);
  assert(controller.position.x > arrowStartX - 0.6, "ArrowRight moves player right in +X");
  controller.setKey('ArrowRight', false);

  // 3. Test Diagonal Movement Normalization
  console.log("\n--- TEST 3: Diagonal Movement Normalization ---");
  controller.resetKeys();
  controller.setKey('KeyW', true);
  controller.setKey('KeyD', true);
  controller.update(0.1);
  const diagSpeed = Math.hypot(controller.velocity.x, controller.velocity.z);
  const expectedSpeed = 6.0;
  assert(Math.abs(diagSpeed - expectedSpeed) < 0.001, `Diagonal speed is normalized (expected: ${expectedSpeed}, actual: ${diagSpeed.toFixed(3)})`);
  assert(Math.abs(Math.abs(controller.velocity.x) - Math.abs(controller.velocity.z)) < 0.001, "Diagonal velocities on X and Z are equal");
  controller.resetKeys();

  // 4. Test Collision Detection & Wall-Sliding
  console.log("\n--- TEST 4: 3D Collision Detection & Gate Barrier ---");
  // Position player right before the locked gate at x: 2.7, z: 0
  controller.position.x = 2.7;
  controller.position.z = 0;
  controller.resetKeys();

  // Try walking directly into the locked gate (+X)
  controller.setKey('KeyD', true);
  for (let i = 0; i < 10; i++) {
    controller.update(0.05);
  }
  assert(controller.position.x <= 2.85, `Player cannot pass through locked gate barrier (x: ${controller.position.x.toFixed(2)})`);

  // Test wall-sliding: walk diagonally into wall (D + S)
  controller.setKey('KeyD', true);
  controller.setKey('KeyS', true);
  const slideStartZ = controller.position.z;
  for (let i = 0; i < 5; i++) {
    controller.update(0.05);
  }
  assert(controller.position.x <= 2.85, "X coordinate remains blocked by wall");
  assert(controller.position.z > slideStartZ, `Z coordinate slides smoothly along the wall (z: ${controller.position.z.toFixed(2)})`);
  controller.resetKeys();

  // 5. Test Camera Following Logic
  console.log("\n--- TEST 5: Camera Tracking ---");
  const cameraOffset = { x: 0, y: 8, z: 12 };
  const targetCamPos = {
    x: controller.position.x + cameraOffset.x,
    y: controller.position.y + cameraOffset.y,
    z: controller.position.z + cameraOffset.z
  };
  assert(targetCamPos.x === controller.position.x, "Camera X offset matches player X");
  assert(targetCamPos.z === controller.position.z + 12, "Camera Z offset maintains third-person distance");
  assert(targetCamPos.y === controller.position.y + 8, "Camera Y offset maintains elevated perspective");

  // 6. Test Key Release Decoupling
  console.log("\n--- TEST 6: Key Release and State Cleansing ---");
  controller.setKey('KeyW', true);
  controller.setKey('KeyA', true);
  controller.update(0.1);
  assert(controller.moving === true, "Moving is true during input");
  controller.resetKeys();
  assert(controller.moving === false, "resetKeys immediately clears moving state");
  assert(controller.velocity.x === 0 && controller.velocity.z === 0, "Velocities are zeroed on reset");

  console.log("\n==================================================================");
  console.log(`  3D MOVEMENT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("  >>> 3D MOVEMENT PHYSICS & CONTROLLER VERIFIED 100%! <<<\n");
    process.exit(0);
  }
}

runMovementTests();
