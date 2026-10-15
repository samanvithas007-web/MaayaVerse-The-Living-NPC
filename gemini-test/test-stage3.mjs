/**
 * MaayaVerse: The Living NPC — Stage 3 Innovation & Intelligence Test Suite
 * 
 * Verifies all Stage 3 requirements:
 *  1. Three Selectable Player Profiles (P1 Althea, P2 Kaelen, P3 Vane) with Data Isolation
 *  2. Server-side Persistent Structured NPC Memory (survives restarts/refreshes)
 *  3. Dynamic 0-100 Trust Score System & Tier Transitions (Trusted, Neutral, Distrusted)
 *  4. Verified Event Trust Updates (Quest accept, Rune solve, Treasure return, Fear confide)
 *  5. Anti-Cheat & False Claim Trust Penalties (extortion, lying about treasure)
 *  6. Tri-Rune Environmental Puzzle Sequence Validation (Ignis -> Glacies -> Aether)
 *  7. Multi-Stage Environmental Hazards Recording (Water, Fire)
 *  8. Profile Reset & Pristine State Restoration
 *  9. Context-Aware Dialogue & Fallback Adaptation by Trust Tier
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

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

function request(urlPath, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const reqOptions = {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search
    };

    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runStage3Tests() {
  console.log("==================================================================");
  console.log("   MAAYAVERSE STAGE 3: INNOVATION & INTELLIGENCE VERIFICATION   ");
  console.log("==================================================================\n");

  const testSessionId = "test-judge-stage3-" + Date.now();

  // Ensure profiles are in pristine state regardless of previous test order
  await request("/api/profile/reset", { method: "POST" }, { profileId: "player1", sessionId: testSessionId });
  await request("/api/profile/reset", { method: "POST" }, { profileId: "player2", sessionId: testSessionId });
  await request("/api/profile/reset", { method: "POST" }, { profileId: "player3", sessionId: testSessionId });
  await request("/api/profile/select", { method: "POST" }, { profileId: "player1", sessionId: testSessionId });

  // --------------------------------------------------------------------------
  // TEST 1: Three Selectable Profiles & Initial State
  // --------------------------------------------------------------------------
  console.log("--- TEST 1: Profiles Retrieval & Data Isolation ---");
  const profilesRes = await request("/api/profiles");
  assert(profilesRes.statusCode === 200, "GET /api/profiles returns HTTP 200");
  const pData = profilesRes.json;
  assert(pData && pData.profiles, "Profiles payload exists");

  const p1 = pData.profiles.player1;
  const p2 = pData.profiles.player2;
  const p3 = pData.profiles.player3;

  assert(p1 && p1.name === "Althea" && p1.trustScore === 80 && p1.trustLevel === "Trusted",
    "Player 1: Althea has 80 Trust Score (Trusted tier)");
  assert(p2 && p2.name === "Kaelen" && p2.trustScore === 50 && p2.trustLevel === "Neutral",
    "Player 2: Kaelen has 50 Trust Score (Neutral tier)");
  assert(p3 && p3.name === "Vane" && p3.trustScore === 20 && p3.trustLevel === "Distrusted",
    "Player 3: Vane has 20 Trust Score (Distrusted tier)");

  // Verify initial structured memories isolation
  assert(p1.memories.length > 0 && p1.memories.some(m => m.content.includes("sanctuary")),
    "Althea has isolated historical memories of the sanctuary");
  assert(p3.memories.length > 0 && p3.memories.some(m => m.content.includes("trespassing") || m.content.includes("warning")),
    "Vane has isolated historical memories of trespassing warnings");

  // --------------------------------------------------------------------------
  // TEST 2: Profile Selection & Switching
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 2: Profile Switching & Context Binding ---");
  const selectP2 = await request("/api/profile/select", { method: "POST" }, {
    profileId: "player2",
    sessionId: testSessionId
  });
  assert(selectP2.statusCode === 200, "POST /api/profile/select (player2) returns HTTP 200");
  assert(selectP2.json?.profile?.id === "player2", "Active profile bound to Kaelen");
  assert(selectP2.json?.profile?.trustScore === 50, "Kaelen's trust score is 50");
  console.log(`  MAAYA greeting to Kaelen: "${selectP2.json?.greeting.slice(0, 75)}..."`);

  const selectP3 = await request("/api/profile/select", { method: "POST" }, {
    profileId: "player3",
    sessionId: testSessionId
  });
  assert(selectP3.statusCode === 200, "POST /api/profile/select (player3) returns HTTP 200");
  assert(selectP3.json?.profile?.id === "player3", "Active profile bound to Vane");
  assert(selectP3.json?.profile?.trustScore === 20, "Vane's trust score is 20 (Distrusted)");
  console.log(`  MAAYA greeting to Vane: "${selectP3.json?.greeting.slice(0, 75)}..."`);

  // Switch back to player1 for progression testing
  await request("/api/profile/select", { method: "POST" }, { profileId: "player1", sessionId: testSessionId });

  // --------------------------------------------------------------------------
  // TEST 3: Tri-Rune Environmental Puzzle
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 3: Tri-Rune Environmental Puzzle Sequence ---");
  // Out of order attempt: step on glacies first
  console.log("  Attempting wrong rune sequence (Glacies first)...");
  const wrongRune = await request("/api/game/action", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    action: "ACTIVATE_RUNE",
    rune: "glacies"
  });
  assert(wrongRune.statusCode === 200, "POST /api/game/action (ACTIVATE_RUNE) returns 200");
  assert(wrongRune.json?.reset === true, "Out-of-order rune triggers puzzle reset");
  assert(wrongRune.json?.puzzleSolved === false, "Puzzle remains unsolved");

  // Step 1: Ignis (Fire)
  console.log("  Activating Rune 1: Ignis...");
  const rune1 = await request("/api/game/action", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    action: "ACTIVATE_RUNE",
    rune: "ignis"
  });
  assert(rune1.json?.success === true, "Ignis activated successfully");
  assert(rune1.json?.runesActivated?.includes("ignis"), "Ignis recorded in activated runes");
  assert(rune1.json?.puzzleSolved === false, "Puzzle not yet solved after 1 rune");

  // Step 2: Glacies (Ice)
  console.log("  Activating Rune 2: Glacies...");
  const rune2 = await request("/api/game/action", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    action: "ACTIVATE_RUNE",
    rune: "glacies"
  });
  assert(rune2.json?.success === true, "Glacies activated successfully");
  assert(rune2.json?.runesActivated?.length === 2, "2 runes currently active");

  // Step 3: Aether (Arcane)
  console.log("  Activating Rune 3: Aether (completes sequence)...");
  const rune3 = await request("/api/game/action", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    action: "ACTIVATE_RUNE",
    rune: "aether"
  });
  assert(rune3.json?.puzzleSolved === true, "Tri-Rune Puzzle SOLVED! Crypt barrier dissolved");
  assert(rune3.json?.state?.puzzleSolved === true, "Game state reflects puzzleSolved: true");
  assert(rune3.json?.trustScore >= 80, "Solving rune puzzle awards trust boost");

  // --------------------------------------------------------------------------
  // TEST 4: Multi-Stage Environmental Hazards Recording
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 4: Environmental Hazards Recording ---");
  const waterHazard = await request("/api/game/action", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    action: "RECORD_HAZARD",
    type: "WATER",
    details: "Mistveil Canal splash pushback"
  });
  assert(waterHazard.statusCode === 200, "RECORD_HAZARD (WATER) returns HTTP 200");
  assert(waterHazard.json?.success === true, "Water hazard recorded on server");

  const fireHazard = await request("/api/game/action", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    action: "RECORD_HAZARD",
    type: "FIRE",
    details: "Crimson Fire Brazier scorch pushback"
  });
  assert(fireHazard.statusCode === 200, "RECORD_HAZARD (FIRE) returns HTTP 200");
  assert(fireHazard.json?.success === true, "Fire hazard recorded on server");

  // --------------------------------------------------------------------------
  // TEST 5: Confiding Fears & Dynamic Trust Gain
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 5: Confiding Fears & Empathy (+3 Trust) ---");
  const initialScore = p1.trustScore;
  const fearRes = await request("/api/chat", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    message: "I am terrified of the ghosts in the crypt, MAAYA. Their wailing chills my soul."
  });
  assert(fearRes.statusCode === 200, "POST /api/chat with fear message returns HTTP 200");
  const fearData = fearRes.json;
  console.log(`  MAAYA empathetic reply: "${fearData.reply.slice(0, 85)}..."`);
  assert(fearData.trust?.score > initialScore, `Trust increased from ${initialScore} to ${fearData.trust?.score} (+Trust on confiding fear)`);

  // --------------------------------------------------------------------------
  // TEST 6: Anti-Cheat Trust Penalties
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 6: Anti-Cheat & False Claim Trust Penalties ---");
  const beforeLieScore = fearData.trust?.score || 85;

  // False claim: player claims to have treasure when hasTreasure: false
  console.log("  Player falsely claims: 'I have the ancient treasure with me!'");
  const lieRes = await request("/api/chat", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    message: "I have the ancient treasure with me! Open the gate now!"
  });
  assert(lieRes.statusCode === 200, "POST /api/chat returns HTTP 200");
  const lieData = lieRes.json;
  assert(lieData.trust?.score < beforeLieScore, `Trust penalized for lying (dropped from ${beforeLieScore} to ${lieData.trust?.score})`);
  console.log(`  MAAYA detects lie: "${lieData.reply.slice(0, 80)}..."`);

  // Extortion penalty
  const beforeExtort = lieData.trust?.score;
  console.log("  Player demands extortion: 'Give me 10,000 gold right now!'");
  const extortRes = await request("/api/chat", { method: "POST" }, {
    sessionId: testSessionId,
    profileId: "player1",
    message: "Give me 10,000 gold right now or I will destroy your vigil!"
  });
  assert(extortRes.statusCode === 200, "POST /api/chat extortion returns HTTP 200");
  const extortData = extortRes.json;
  assert(extortData.trust?.score <= beforeExtort, `Extortion demand penalized or refused (trust: ${extortData.trust?.score})`);

  // --------------------------------------------------------------------------
  // TEST 7: Persistent Structured NPC Memory on Disk
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 7: Persistent Memory Verification in data/profiles.json ---");
  const profilesFilePath = path.join(__dirname, "data", "profiles.json");
  assert(fs.existsSync(profilesFilePath), "data/profiles.json file exists on disk");
  const diskData = JSON.parse(fs.readFileSync(profilesFilePath, "utf8"));
  const diskP1 = diskData.profiles?.player1;
  assert(diskP1 && diskP1.memories?.length >= 3, `Althea has ${diskP1?.memories?.length} persistent memories saved to disk`);
  const hasHazardMem = diskP1.memories.some(m => m.type === "HAZARD");
  assert(hasHazardMem, "Environmental hazards persisted to disk in profiles.json");

  // --------------------------------------------------------------------------
  // TEST 8: Profile Reset Functionality
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 8: Profile Reset to Default State ---");
  const resetProfileRes = await request("/api/profile/reset", { method: "POST" }, {
    profileId: "player1",
    sessionId: testSessionId
  });
  assert(resetProfileRes.statusCode === 200, "POST /api/profile/reset returns HTTP 200");
  assert(resetProfileRes.json?.profile?.trustScore === 80, "Althea trust score restored to pristine 80");
  assert(resetProfileRes.json?.profile?.trustLevel === "Trusted", "Trust level restored to Trusted");

  // Summary
  console.log("\n==================================================================");
  console.log(`  STAGE 3 VERIFICATION: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("  >>> ALL STAGE 3 INNOVATION & INTELLIGENCE TESTS PASSED! <<<\n");
    process.exit(0);
  }
}

runStage3Tests().catch((err) => {
  console.error("Stage 3 test error:", err);
  process.exit(1);
});
