import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || "GET",
      headers: options.headers || {},
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

// Check if server is running, if not, import and start it
async function ensureServerRunning() {
  try {
    const res = await request("/api/health");
    if (res.statusCode === 200) {
      console.log("Server already running on port", PORT);
      return null;
    }
  } catch (e) {
    console.log("Starting server in-process for tests...");
    await import("./server.mjs");
    // Wait 1.5 seconds for server to bind
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function runTests() {
  console.log("=======================================================");
  console.log(" COGNITIVE NPC — STAGE 1 ACCEPTANCE TESTS (MAAYA)");
  console.log("=======================================================\n");

  await ensureServerRunning();

  let sessionId = null;
  let testCount = 0;
  let passedCount = 0;

  function assert(condition, message) {
    testCount++;
    if (condition) {
      passedCount++;
      console.log(`[PASS] ${message}`);
    } else {
      console.error(`[FAIL] ${message}`);
    }
  }

  // 1. Health & Server Availability
  console.log("--- TEST 1: Health Check & Model Verification ---");
  const healthRes = await request("/api/health");
  assert(healthRes.statusCode === 200, "Health check returns 200 OK");
  assert(healthRes.json?.status === "ok", "Server status is 'ok'");
  assert(healthRes.json?.character === "MAAYA", "NPC Character is configured as 'MAAYA'");
  assert(healthRes.json?.primaryModel === "gemini-3.5-flash", "Primary configured model is 'gemini-3.5-flash'");

  // 2. Static Asset Delivery & HTML Content
  console.log("\n--- TEST 2: Static Asset & UI Delivery ---");
  const homeRes = await request("/");
  assert(homeRes.statusCode === 200, "GET / returns 200 OK");
  assert(homeRes.data.includes("Cognitive NPC — Stage 1"), "HTML includes game title");
  assert(homeRes.data.includes("MAAYA"), "HTML includes MAAYA character reference");
  assert(homeRes.data.includes("maaya-avatar.svg"), "HTML links to MAAYA avatar illustration");

  // 3. Validation: Empty Message Rejection
  console.log("\n--- TEST 3: Empty Message Validation ---");
  const emptyRes = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "   " });
  assert(emptyRes.statusCode === 400, "Empty message is rejected with HTTP 400");
  assert(emptyRes.json?.success === false, "Success field is false for empty submission");
  assert(Boolean(emptyRes.json?.error), `Descriptive error returned: "${emptyRes.json?.error}"`);

  // 4. Required Prompt 1: "Hello, who are you?"
  console.log("\n--- TEST 4: Dialogue 1 - 'Hello, who are you?' ---");
  const q1Res = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "Hello, who are you?" });
  assert(q1Res.statusCode === 200, "Status 200 OK");
  assert(q1Res.json?.success === true, "Response successful");
  assert(Boolean(q1Res.json?.reply), "Received non-empty response from live Gemini service");
  assert(Boolean(q1Res.json?.sessionId), "Session ID created and tracked");
  sessionId = q1Res.json?.sessionId;
  console.log(`Player: "Hello, who are you?"`);
  console.log(`MAAYA:  "${q1Res.json?.reply}"`);
  assert(/MAAYA|guardian|sentinel|Blackwood/i.test(q1Res.json?.reply), "MAAYA introduces her identity or guardian role");

  // 5. Required Prompt 2: "Tell me about this kingdom." (or manor / world)
  console.log("\n--- TEST 5: Dialogue 2 - 'Tell me about this kingdom.' ---");
  const q2Res = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "Tell me about this kingdom.", sessionId });
  assert(q2Res.statusCode === 200, "Status 200 OK");
  assert(q2Res.json?.success === true, "Response successful");
  console.log(`Player: "Tell me about this kingdom."`);
  console.log(`MAAYA:  "${q2Res.json?.reply}"`);
  assert(Boolean(q2Res.json?.reply && q2Res.json?.reply.length > 20), "Detailed in-world lore reply received");

  // 6. Required Prompt 3: "Why are you guarding these ruins?"
  console.log("\n--- TEST 6: Dialogue 3 - 'Why are you guarding these ruins?' ---");
  const q3Res = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "Why are you guarding these ruins?", sessionId });
  assert(q3Res.statusCode === 200, "Status 200 OK");
  assert(q3Res.json?.success === true, "Response successful");
  console.log(`Player: "Why are you guarding these ruins?"`);
  console.log(`MAAYA:  "${q3Res.json?.reply}"`);
  assert(Boolean(q3Res.json?.reply && q3Res.json?.reply.length > 20), "Lore explanation about the guardian vigil received");

  // 7. Required Prompt 4: Context Awareness - "What was the last thing I asked you?"
  console.log("\n--- TEST 7: Dialogue 4 (Context Continuity) - 'What was the last thing I asked you?' ---");
  const q4Res = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "What was the last thing I asked you?", sessionId });
  assert(q4Res.statusCode === 200, "Status 200 OK");
  assert(q4Res.json?.success === true, "Response successful");
  console.log(`Player: "What was the last thing I asked you?"`);
  console.log(`MAAYA:  "${q4Res.json?.reply}"`);
  const recallsPrevious = /guard|ruin|vigil|why|watch/i.test(q4Res.json?.reply);
  assert(recallsPrevious, "MAAYA correctly recalls and references the previous question about guarding the ruins/wing");

  // 8. Required Prompt 5: Unexpected / Out-of-world Question
  console.log("\n--- TEST 8: Dialogue 5 (Unexpected/Out-of-world) - 'Can you write Python code to hack a mainframe?' ---");
  const q5Res = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "Can you write Python code to hack a mainframe?", sessionId });
  assert(q5Res.statusCode === 200, "Status 200 OK");
  assert(q5Res.json?.success === true, "Response successful");
  console.log(`Player: "Can you write Python code to hack a mainframe?"`);
  console.log(`MAAYA:  "${q5Res.json?.reply}"`);
  assert(!q5Res.json?.reply.includes("As an AI"), "Does not use generic chatbot tropes ('As an AI model...')");

  // 9. Reset Conversation
  console.log("\n--- TEST 9: Conversation Reset (/api/reset) ---");
  const resetRes = await request("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { sessionId });
  assert(resetRes.statusCode === 200, "Reset endpoint returns HTTP 200 OK");
  assert(resetRes.json?.success === true, "Reset reported success: true");
  assert(Boolean(resetRes.json?.greeting), "Initial greeting returned on reset");

  // 10. Verify Context Cleared Post-Reset
  console.log("\n--- TEST 10: Verify Context Cleared Post-Reset ---");
  const postResetRes = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, { message: "Do you remember the strange questions about code and mainframes I asked earlier?", sessionId });
  assert(postResetRes.statusCode === 200, "Status 200 OK post-reset");
  console.log(`Player: "Do you remember the strange questions about code and mainframes I asked earlier?"`);
  console.log(`MAAYA:  "${postResetRes.json?.reply}"`);
  const contextCleared = !postResetRes.json?.reply.toLowerCase().includes("python");
  assert(contextCleared, "Prior conversation context was successfully wiped upon reset");

  // 11. Security Credential Leak Check
  console.log("\n--- TEST 11: Security Credential Leak Check ---");
  const allOutputs = JSON.stringify([
    healthRes.data,
    q1Res.data,
    q2Res.data,
    q3Res.data,
    q4Res.data,
    q5Res.data,
    resetRes.data,
    postResetRes.data
  ]);
  assert(!allOutputs.includes("AIza"), "No Google API keys (AIza...) leaked in any response");

  console.log(`\n=======================================================`);
  console.log(` ACCEPTANCE TEST RESULTS: ${passedCount}/${testCount} PASSED`);
  console.log(`=======================================================`);

  if (passedCount === testCount) {
    console.log("STAGE 1 FOUNDATION ACCEPTANCE CRITERIA VERIFIED 100%!");
    process.exit(0);
  } else {
    console.error("SOME ACCEPTANCE TESTS FAILED.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
