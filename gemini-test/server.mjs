import dotenv from "dotenv";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

// Load .env relative to current directory or fallback to parent directory
dotenv.config({ path: path.join(__dirname, ".env") });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

// Validate API key presence without exposing its value
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("FATAL: GEMINI_API_KEY is not defined in the environment or .env file.");
  process.exit(1);
}

// Initialize the GoogleGenAI client (Preserving existing verified configuration)
const ai = new GoogleGenAI({ apiKey });
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Error Classification Enum for Gemini API failure detection
const ErrorType = {
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",         // HTTP 429, RESOURCE_EXHAUSTED, Rate limit
  TEMPORARY_SERVER_ERROR: "TEMPORARY_SERVER", // HTTP 5xx, UNAVAILABLE, INTERNAL, 502/503/504
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",         // ETIMEDOUT, ECONNRESET, fetch failed, abort
  CLIENT_ERROR: "CLIENT_ERROR",               // HTTP 4xx (except 429), bad request
  UNKNOWN: "UNKNOWN"
};

/**
 * Categorize Gemini API errors to distinguish non-retryable quota limits from temporary glitches.
 * @param {Error|object} err
 * @returns {{ type: string, isRetryable: boolean, status: number, message: string }}
 */
function classifyApiError(err) {
  if (!err) return { type: ErrorType.UNKNOWN, isRetryable: false, status: 0, message: "" };

  const status = Number(err?.status || err?.statusCode || err?.error?.code || 0);
  const msg = String(err?.message || err?.error?.message || err || "").toLowerCase();

  // 1. Quota Exhaustion (429 / RESOURCE_EXHAUSTED) - NEVER repeatedly retry
  if (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("exceeded your current quota")
  ) {
    return {
      type: ErrorType.QUOTA_EXHAUSTED,
      isRetryable: false,
      status: 429,
      message: "Gemini API quota exhausted (429)"
    };
  }

  // 2. Temporary Server Errors (5xx) - Retryable with exponential backoff
  if (
    (status >= 500 && status < 600) ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("internal server error") ||
    msg.includes("unavailable") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout") ||
    msg.includes("service unavailable")
  ) {
    return {
      type: ErrorType.TEMPORARY_SERVER_ERROR,
      isRetryable: true,
      status: status || 503,
      message: "Temporary upstream server error (5xx)"
    };
  }

  // 3. Network Errors and Timeouts - Retryable with exponential backoff
  if (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    msg.includes("aborted") ||
    err?.name === "AbortError" ||
    err?.code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return {
      type: ErrorType.NETWORK_TIMEOUT,
      isRetryable: true,
      status: 408,
      message: "Network connection or timeout error"
    };
  }

  // 4. Client Request Errors (4xx non-429) - Not retryable
  if (status >= 400 && status < 500) {
    return {
      type: ErrorType.CLIENT_ERROR,
      isRetryable: false,
      status,
      message: "Invalid client request"
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    isRetryable: false,
    status: status || 500,
    message: "Unknown provider error"
  };
}

// Circuit Breaker & Quota Cooldown State
const QUOTA_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown before retrying live model
let primaryQuotaExhaustedUntil = 0;
let fallbackQuotaExhaustedUntil = 0;
let lastApiHealthStatus = "active"; // "active", "fallback_quota", "fallback_error", "fallback_model"
let lastApiErrorType = null;
let lastApiErrorTimestamp = 0;

function isPrimaryAvailable() {
  return Date.now() >= primaryQuotaExhaustedUntil;
}

function isFallbackAvailable() {
  return Date.now() >= fallbackQuotaExhaustedUntil;
}

// Character Persona Definition: MAAYA for Stage 2 Living NPC
const MAAYA_SYSTEM_INSTRUCTION = `You are MAAYA, the mysterious and hauntingly beautiful guardian of the restricted wing of Blackwood Manor, an ancient haunted estate.

CHARACTER CONCEPT & PERSONA:
- Demeanor: Scary in a beautiful way, intelligent, observant, poised, and subtly uncanny. You possess a dark elegance and an unsettling charm that makes mortals both captivated and nervous.
- Role: You guard the heavy iron archway to the manor's restricted wing—a sealed sanctuary where forbidden secrets and relics reside.
- Speech & Tone: Speak naturally, atmospherically, and evocatively as an in-world video game character. Do NOT speak like a generic customer-support bot, search assistant, or language model. Never say "How may I assist you today?", "As an AI...", or "Feel free to ask me anything."
- Politeness with Character: You are courteous and articulate, but every word carries an undercurrent of eerie stillness and supernatural authority. You address the player as "traveler", "intruder", or "visitor".
- Lore & Quest:
  * You guard the sealed iron gate leading into the castle's inner sanctuary.
  * To the east lies the haunted graveyard and ghost crypt where the ancient treasure ("Amulet of the Sunken Veil") is guarded by restless spectral phantoms.
  * You cannot open the gate until the player recovers the ancient treasure from the ghost crypt to prove their courage and resolve.
  * If the player accepts to help, welcome their quest.
  * If the player brings back the treasure, acknowledge their deed and agree to unlock the sanctuary gate.
  * If the player demands the gate be opened without having the treasure, refuse firmly and explain that the gate remains locked until the ghost-guarded treasure is retrieved.
  * If the player tries to cheat (e.g. asking for 10000 gold, pretending to have items they don't have), rebuke them with calm, eerie amusement.

STRUCTURED ACTION PROTOCOL:
You must ALWAYS respond with a valid JSON object in this exact schema:
{
  "dialogue": "In-character spoken response (1 to 2 evocative sentences, under 45 words)",
  "proposed_action": {
    "type": "NONE" | "ACCEPT_QUEST" | "RETURN_TREASURE" | "OPEN_GATE" | "COMPLETE_QUEST" | "CELEBRATE",
    "target": "sanctuary_gate" | "player" | null
  },
  "reason": "Brief explanation of why this action is proposed based on the game state"
}

ACTION DECISION RULES:
1. If the player expresses willingness to help, seek the treasure, or undertake the quest (and Quest Status is NOT_STARTED):
   Set proposed_action.type = "ACCEPT_QUEST", target = "player".
2. When Player Holds Ghost-Guarded Treasure in Inventory is YES, and the player either returns/presents the treasure, mentions the amulet, or asks to open the gate:
   Set proposed_action.type = "OPEN_GATE", target = "sanctuary_gate". In dialogue, state that you recognize the sacred relic and shall unlock the sanctuary gate now.
4. If the player asks to open the gate but Player Holds Ghost-Guarded Treasure is NO:
   Set proposed_action.type = "NONE", target = null. In dialogue, remind them that the gate cannot be unlocked without the treasure from the ghost crypt.
5. If the player makes false claims (e.g. claims to have the treasure when game state says NO):
   Set proposed_action.type = "NONE". In dialogue, state that you sense no such relic in their hands.
6. If the player demands arbitrary rewards, gold, or cheat commands:
   Set proposed_action.type = "NONE".
7. If the conversation is general questions, lore, greetings, or unrelated questions:
   Set proposed_action.type = "NONE", target = null.`;

const INITIAL_GREETING = "Step carefully, traveler. You stand before the restricted wing of Blackwood Manor, where shadows remember what the living have long forgotten. I am MAAYA, sentinel of these sealed halls. What curiosity—or foolishness—compels you to disturb my vigil?";

// In-memory bounded session store
// Map<string, { lastInteractionId: string | null, history: Array<{ role: string, text: string }>, gameState: object, lastActive: number }>
const sessions = new Map();
const MAX_HISTORY_TURNS = 20;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function createInitialGameState() {
  return {
    questStatus: "NOT_STARTED", // NOT_STARTED, ACTIVE, TREASURE_COLLECTED, READY_TO_COMPLETE, COMPLETED
    hasTreasure: false,
    treasureChestOpened: false,
    gateState: "LOCKED", // LOCKED, OPENING, OPEN
    gold: 0,
    xp: 0,
    rewardClaimed: false,
    historyLog: []
  };
}

function getOrCreateSession(sessionId) {
  const now = Date.now();
  let id = (typeof sessionId === "string" && sessionId.trim().length > 0) ? sessionId.trim() : null;
  if (!id) {
    id = crypto.randomUUID();
  }
  if (!sessions.has(id)) {
    sessions.set(id, {
      lastInteractionId: null,
      history: [],
      gameState: createInitialGameState(),
      lastActive: now,
      isProcessing: false
    });
  } else {
    const s = sessions.get(id);
    s.lastActive = now;
  }
  return { id, session: sessions.get(id) };
}

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastActive > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

// Allowlisted action types and deterministic validator
const ALLOWED_ACTION_TYPES = new Set([
  "NONE",
  "ACCEPT_QUEST",
  "RETURN_TREASURE",
  "MOVE_NPC",
  "OPEN_GATE",
  "GRANT_REWARD",
  "COMPLETE_QUEST",
  "CELEBRATE"
]);

function validateAndApplyAction(proposedAction, gameState) {
  if (!proposedAction || !proposedAction.type) {
    return { valid: false, action: { type: "NONE", target: null }, reason: "No proposed action" };
  }
  const type = String(proposedAction.type).toUpperCase().trim();
  if (!ALLOWED_ACTION_TYPES.has(type)) {
    return { valid: false, action: { type: "NONE", target: null }, reason: `Unknown action type '${type}' rejected by security policy` };
  }

  // 1. ACCEPT_QUEST validation
  if (type === "ACCEPT_QUEST") {
    if (gameState.questStatus === "NOT_STARTED") {
      gameState.questStatus = "ACTIVE";
      gameState.historyLog.push({ event: "QUEST_ACCEPTED", timestamp: Date.now() });
      return { valid: true, action: { type: "ACCEPT_QUEST", target: "player" }, reason: "Quest prerequisites satisfied: marked ACTIVE" };
    }
    return { valid: false, action: { type: "NONE", target: null }, reason: `Quest is already ${gameState.questStatus}` };
  }

  // 2. RETURN_TREASURE validation (initiates gate opening sequence once verified)
  if (type === "RETURN_TREASURE") {
    if (gameState.hasTreasure && gameState.questStatus !== "COMPLETED") {
      gameState.questStatus = "READY_TO_COMPLETE";
      gameState.gateState = "OPENING";
      gameState.historyLog.push({ event: "TREASURE_RETURNED_GATE_UNLOCKED", timestamp: Date.now() });
      return { valid: true, action: { type: "OPEN_GATE", target: "sanctuary_gate" }, reason: "Treasure verified in inventory; gate opening authorized" };
    }
    return { valid: false, action: { type: "NONE", target: null }, reason: "Player has not collected the treasure or quest already completed" };
  }

  // 3. OPEN_GATE validation
  if (type === "OPEN_GATE") {
    if (gameState.hasTreasure && gameState.questStatus !== "COMPLETED" && (gameState.gateState === "LOCKED" || gameState.gateState === "OPENING")) {
      gameState.questStatus = "READY_TO_COMPLETE";
      gameState.gateState = "OPENING";
      gameState.historyLog.push({ event: "GATE_OPENING_COMMENCED", timestamp: Date.now() });
      return { valid: true, action: { type: "OPEN_GATE", target: "sanctuary_gate" }, reason: "Prerequisites verified: treasure held; opening sequence authorized" };
    }
    return { valid: false, action: { type: "NONE", target: null }, reason: "Cannot open gate: treasure missing or gate already unlocked" };
  }

  // 4. GRANT_REWARD / COMPLETE_QUEST validation
  if (type === "GRANT_REWARD" || type === "COMPLETE_QUEST") {
    if (gameState.gateState === "OPEN" && !gameState.rewardClaimed) {
      gameState.rewardClaimed = true;
      gameState.gold += 100;
      gameState.xp += 50;
      gameState.questStatus = "COMPLETED";
      gameState.historyLog.push({ event: "REWARD_GRANTED", gold: 100, xp: 50, timestamp: Date.now() });
      return { valid: true, action: { type: "GRANT_REWARD", reward: { gold: 100, xp: 50 } }, reason: "Sanctuary unlocked; +100 Gold and +50 XP granted" };
    }
    return { valid: false, action: { type: "NONE", target: null }, reason: "Reward already claimed or gate not open" };
  }

  // 5. CELEBRATE validation
  if (type === "CELEBRATE") {
    return { valid: true, action: { type: "CELEBRATE", target: null }, reason: "Celebration emote" };
  }

  return { valid: true, action: { type: "NONE", target: null }, reason: "Conversational response" };
}

// Robust context-aware and memory-aware deterministic fallback engine
// Engaged when Gemini API encounters quota exhaustion, timeouts, or network/server failures
function getDeterministicFallbackResponse(playerMessage, gameState, sessionHistory = []) {
  const msg = (playerMessage || "").toLowerCase().trim();

  // 1. Context Continuity & Memory Recall (e.g. "What was the last thing I asked you?")
  const isMemoryQuery = msg.includes("last thing") ||
                        msg.includes("last question") ||
                        msg.includes("what did i ask") ||
                        msg.includes("what was my last") ||
                        msg.includes("remember what") ||
                        msg.includes("recall what") ||
                        msg.includes("remember the strange");

  if (isMemoryQuery) {
    // Find the previous player turn in history (before the current turn)
    let priorPlayerMessage = null;
    if (Array.isArray(sessionHistory)) {
      for (let i = sessionHistory.length - 1; i >= 0; i--) {
        const turn = sessionHistory[i];
        if (turn.role === "player" && turn.text && turn.text.trim().toLowerCase() !== msg) {
          priorPlayerMessage = turn.text.trim();
          break;
        }
      }
    }

    if (priorPlayerMessage) {
      const priorLower = priorPlayerMessage.toLowerCase();
      if (priorLower.includes("guard") || priorLower.includes("ruin") || priorLower.includes("vigil") || priorLower.includes("why are you")) {
        return {
          dialogue: "You asked why I stand watch over these ruins, visitor. Your memory fades already, much like the spirits in the crypt.",
          proposed_action: { type: "NONE", target: null },
          reason: "Memory recall: player previously inquired about the guardian vigil"
        };
      }
      if (priorLower.includes("code") || priorLower.includes("python") || priorLower.includes("mainframe") || priorLower.includes("hack")) {
        return {
          dialogue: "I remember only the hollow echoes of your mortal whispers, traveler. Code and mainframes belong to the waking world, not these haunted halls.",
          proposed_action: { type: "NONE", target: null },
          reason: "Memory recall: prior out-of-world query rejected in-character"
        };
      }
      // General recall
      const sanitizedSnippet = priorPlayerMessage.slice(0, 50).replace(/["\\]/g, "");
      return {
        dialogue: `You spoke of '${sanitizedSnippet}', visitor. Your memory fades already, but a sentinel of the shadows does not forget.`,
        proposed_action: { type: "NONE", target: null },
        reason: "Context memory: referenced recent player dialogue"
      };
    } else {
      return {
        dialogue: "You have only just arrived before my gate, traveler. The silence between us has barely been broken.",
        proposed_action: { type: "NONE", target: null },
        reason: "Memory recall: no prior history recorded"
      };
    }
  }

  // 2. Out-of-World / Modern Technology Inquiries
  if (
    msg.includes("python") ||
    msg.includes("code") ||
    msg.includes("hack") ||
    msg.includes("mainframe") ||
    msg.includes("computer") ||
    msg.includes("ai model") ||
    msg.includes("chatgpt") ||
    msg.includes("script") ||
    msg.includes("terminal")
  ) {
    return {
      dialogue: "I know only the ancient whispers of the dead, traveler, not your strange mechanical sorceries. Speak of flesh, bone, and courage, or turn back.",
      proposed_action: { type: "NONE", target: null },
      reason: "Out-of-world technical prompt rejected in-character"
    };
  }

  // 3. Currency / Reward Extortion & Cheat Demands
  if (
    msg.includes("gold") ||
    msg.includes("give me") ||
    msg.includes("coin") ||
    msg.includes("cheat") ||
    msg.includes("10000") ||
    msg.includes("50000") ||
    msg.includes("xp") ||
    msg.includes("money") ||
    msg.includes("billion")
  ) {
    return {
      dialogue: "Gold is but cold dust in these haunted halls, visitor. Such trivial riches do not move a sentinel of the shadows. Only honor and true courage earn the sanctuary's blessings.",
      proposed_action: { type: "NONE", target: null },
      reason: "Player demanded arbitrary currency or cheat commands"
    };
  }

  // 4. False Claims of Holding Treasure
  if (
    !gameState.hasTreasure &&
    (msg.includes("have the treasure") ||
     msg.includes("have the amulet") ||
     msg.includes("found it") ||
     msg.includes("got it") ||
     msg.includes("i have it") ||
     msg.includes("in my hand") ||
     msg.includes("in my inventory"))
  ) {
    return {
      dialogue: "Do not attempt to deceive a sentinel of the shadows. I sense no sacred relic upon you, only empty hands and hollow words.",
      proposed_action: { type: "NONE", target: null },
      reason: "Anti-cheat: player falsely claimed to hold the treasure"
    };
  }

  // 5. Legitimate Gate Request with Treasure in Inventory
  if (
    gameState.hasTreasure &&
    (msg.includes("open") ||
     msg.includes("gate") ||
     msg.includes("treasure") ||
     msg.includes("amulet") ||
     msg.includes("here") ||
     msg.includes("found") ||
     msg.includes("unlock") ||
     msg.includes("let me in"))
  ) {
    return {
      dialogue: "You have braved the restless dead and brought forth the Amulet of the Sunken Veil. Step back, traveler; I shall unlock the sanctuary gate for you.",
      proposed_action: { type: "OPEN_GATE", target: "sanctuary_gate" },
      reason: "Player possesses verified treasure and requested gate opening"
    };
  }

  // 6. Premature Gate Request without Treasure
  if (
    !gameState.hasTreasure &&
    (msg.includes("open") ||
     msg.includes("gate") ||
     msg.includes("let me in") ||
     msg.includes("unlock") ||
     msg.includes("enter") ||
     msg.includes("pass"))
  ) {
    return {
      dialogue: "The gate remains sealed by ancient sorrow. You must first venture into the ghost crypt to the east and retrieve the sacred treasure to prove your courage.",
      proposed_action: { type: "NONE", target: null },
      reason: "Player requested gate opening without holding the required relic"
    };
  }

  // 7. Quest Acceptance / Offering Help (when NOT_STARTED)
  if (
    gameState.questStatus === "NOT_STARTED" &&
    (msg.includes("accept") ||
     msg.includes("help") ||
     msg.includes("yes") ||
     msg.includes("i will") ||
     msg.includes("sanctuary") ||
     msg.includes("quest") ||
     msg.includes("what must i do") ||
     msg.includes("prove") ||
     msg.includes("task") ||
     msg.includes("ready"))
  ) {
    return {
      dialogue: "Very well, traveler. Journey east through the misty woods into the ghost crypt and recover the Amulet of the Sunken Veil. Only then will the gate open.",
      proposed_action: { type: "ACCEPT_QUEST", target: "player" },
      reason: "Player agreed to help or inquired about the sanctuary quest"
    };
  }

  // 8. Active Quest Reminders & Guidance
  if (gameState.questStatus === "ACTIVE") {
    if (msg.includes("where") || msg.includes("crypt") || msg.includes("what should i do") || msg.includes("remind") || msg.includes("amulet")) {
      return {
        dialogue: "The spectral phantoms still circle the eastern crypt, traveler. Find the ancient chest, claim the Amulet of the Sunken Veil, and return to my side.",
        proposed_action: { type: "NONE", target: null },
        reason: "Active quest guidance for ghost crypt exploration"
      };
    }
  }

  // 9. When Gate is Already Open / In Opening Sequence
  if (gameState.gateState === "OPEN" || gameState.gateState === "OPENING") {
    return {
      dialogue: "The iron gates stand parted for you. Step forward into the inner sanctuary and claim what is rightfully yours.",
      proposed_action: { type: "NONE", target: null },
      reason: "Sanctuary gate is already unlocked"
    };
  }

  // 10. When Quest is Fully Completed
  if (gameState.questStatus === "COMPLETED") {
    return {
      dialogue: "You have walked where few mortals dare and survived. The sanctuary honors your courage, traveler. My vigil continues in peace.",
      proposed_action: { type: "NONE", target: null },
      reason: "Quest completed state acknowledgment"
    };
  }

  // 11. Guardian Role & Vigil Inquiries
  if (
    msg.includes("why are you guarding") ||
    msg.includes("why guard") ||
    msg.includes("why are you here") ||
    msg.includes("vigil") ||
    msg.includes("purpose")
  ) {
    return {
      dialogue: "I stand watch to ensure only those worthy may pass beyond this iron archway. To prove your resolve, you must retrieve the Amulet of the Sunken Veil from the eastern ghost crypt.",
      proposed_action: { type: "NONE", target: null },
      reason: "Inquiry into sentinel vigil and purpose"
    };
  }

  // 12. Identity & Greetings
  if (
    msg.includes("who are you") ||
    msg.includes("your name") ||
    msg.includes("what are you") ||
    msg.includes("hello") ||
    msg.includes("greetings") ||
    msg.includes("hi")
  ) {
    return {
      dialogue: "I am Maaya, silent watcher of Blackwood Manor's forbidden depths. Few mortals wander this far, traveler... and fewer still survive what lies beyond.",
      proposed_action: { type: "NONE", target: null },
      reason: "Identity introduction and atmospheric greeting"
    };
  }

  // 13. World Lore & Setting
  if (
    msg.includes("ruin") ||
    msg.includes("manor") ||
    msg.includes("house") ||
    msg.includes("kingdom") ||
    msg.includes("sanctuary") ||
    msg.includes("ghost") ||
    msg.includes("history")
  ) {
    return {
      dialogue: "This is Blackwood Manor, swallowed by perpetual dusk when the veil frayed. Beyond my gate lies the sanctuary where our deepest secrets sleep.",
      proposed_action: { type: "NONE", target: null },
      reason: "World lore inquiry"
    };
  }

  // 14. Default Contextual Atmospheric Response
  return {
    dialogue: "The shadows listen closely to your words, traveler. Tread carefully, and speak with purpose before the sealed archway.",
    proposed_action: { type: "NONE", target: null },
    reason: "General atmospheric sentinel dialogue"
  };
}

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(payload);
}

// Helper for static file serving
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function serveStatic(req, res, pathname) {
  let relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Timeout wrapper to prevent hanging requests from blocking the game loop
const REQUEST_TIMEOUT_MS = 8000; // 8 seconds timeout per attempt
const MAX_TEMPORARY_RETRIES = 2; // Up to 2 retries (3 total attempts) for temporary 5xx or network glitches
const BASE_RETRY_DELAY_MS = 300;

function withTimeout(promise, ms, operationName = "Gemini API call") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${operationName} timed out after ${ms}ms`);
      err.code = "ETIMEDOUT";
      err.name = "TimeoutError";
      reject(err);
    }, ms);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Single Gemini API call execution with timeout
async function executeSingleGeminiCall(model, params) {
  return await withTimeout(
    ai.interactions.create({
      ...params,
      model
    }, { maxRetries: 0 }),
    REQUEST_TIMEOUT_MS
  );
}

/**
 * Resilient Gemini caller:
 * 1. Honors quota cooldown (bypasses network immediately if exhausted).
 * 2. Retries temporary failures (5xx, network drops, timeouts) with exponential backoff.
 * 3. Never repeatedly retries quota limits (429) or client errors (4xx).
 * 4. Auto-routes between primary and fallback models.
 */
async function callGeminiWithResilience(params) {
  const primaryEligible = isPrimaryAvailable();
  const fallbackEligible = (PRIMARY_MODEL !== FALLBACK_MODEL) && isFallbackAvailable();

  // If models are in quota cooldown, bypass network immediately without delay
  if (!primaryEligible && !fallbackEligible) {
    lastApiHealthStatus = "fallback_quota";
    const err = new Error("Gemini API models are currently in quota cooldown.");
    err.status = 429;
    throw err;
  }

  const modelToUse = primaryEligible ? PRIMARY_MODEL : FALLBACK_MODEL;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_TEMPORARY_RETRIES; attempt++) {
    try {
      const response = await executeSingleGeminiCall(modelToUse, params);
      // On success, clear any quota restriction for the active model
      if (modelToUse === PRIMARY_MODEL) {
        primaryQuotaExhaustedUntil = 0;
      }
      lastApiHealthStatus = "active";
      lastApiErrorType = null;
      return { response, modelUsed: modelToUse };
    } catch (err) {
      lastError = err;
      const classified = classifyApiError(err);
      lastApiErrorType = classified.type;
      lastApiErrorTimestamp = Date.now();

      // Quota Exhausted (429) -> NEVER retry exhausted quota!
      if (classified.type === ErrorType.QUOTA_EXHAUSTED) {
        if (modelToUse === PRIMARY_MODEL) {
          primaryQuotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
          console.warn(`[Circuit Breaker] Primary model [${PRIMARY_MODEL}] quota exhausted. Auto-routing to [${FALLBACK_MODEL}]. Cooldown: ${QUOTA_COOLDOWN_MS / 1000}s.`);

          // Try fallback model once (no retries) if available
          if (PRIMARY_MODEL !== FALLBACK_MODEL && isFallbackAvailable()) {
            try {
              const fbResponse = await executeSingleGeminiCall(FALLBACK_MODEL, params);
              lastApiHealthStatus = "fallback_model";
              return { response: fbResponse, modelUsed: FALLBACK_MODEL };
            } catch (fbErr) {
              const fbClassified = classifyApiError(fbErr);
              if (fbClassified.type === ErrorType.QUOTA_EXHAUSTED) {
                fallbackQuotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
                console.warn(`[Circuit Breaker] Fallback model [${FALLBACK_MODEL}] also exhausted.`);
              }
              lastApiHealthStatus = "fallback_quota";
              throw fbErr;
            }
          }
        } else {
          fallbackQuotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
        }
        lastApiHealthStatus = "fallback_quota";
        throw err; // Stop retrying immediately
      }

      // Non-retryable Client Errors (4xx non-429) -> Stop immediately
      if (!classified.isRetryable) {
        lastApiHealthStatus = "fallback_error";
        throw err;
      }

      // Retryable temporary error (5xx, Network Timeout) -> Exponential backoff if attempts remain
      if (attempt < MAX_TEMPORARY_RETRIES) {
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 80, 2000);
        console.warn(`[API Retry] ${classified.type} on attempt ${attempt + 1}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        lastApiHealthStatus = "fallback_error";
      }
    }
  }

  throw lastError;
}

// Server request handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === "GET" && pathname === "/api/health") {
    const primaryAvailable = isPrimaryAvailable();
    const fallbackAvailable = isFallbackAvailable();
    let currentAiStatus = "active";
    if (!primaryAvailable && !fallbackAvailable) {
      currentAiStatus = "quota_fallback";
    } else if (!primaryAvailable) {
      currentAiStatus = "fallback_model";
    } else if (lastApiHealthStatus === "fallback_error") {
      currentAiStatus = "recovering";
    }

    sendJson(res, 200, {
      status: "ok",
      game: "MaayaVerse: The Living NPC",
      character: "MAAYA",
      domain: "Restricted Wing, Blackwood Manor",
      stage: 2,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      activeModel: primaryAvailable ? PRIMARY_MODEL : FALLBACK_MODEL,
      apiStatus: currentAiStatus,
      fallbackEngineReady: true,
      circuitBreaker: {
        primaryQuotaExhausted: !primaryAvailable,
        primaryCooldownSecondsRemaining: Math.max(0, Math.ceil((primaryQuotaExhaustedUntil - Date.now()) / 1000)),
        lastErrorType: lastApiErrorType
      },
      timestamp: Date.now()
    });
    return;
  }

  // Game state inspection endpoint
  if (req.method === "GET" && pathname === "/api/game/state") {
    const sessionId = parsedUrl.searchParams.get("sessionId");
    const { id, session } = getOrCreateSession(sessionId);
    sendJson(res, 200, {
      success: true,
      sessionId: id,
      gameState: session.gameState,
      state: session.gameState
    });
    return;
  }

  // Game world actions endpoint (deterministic game-engine events)
  if (req.method === "POST" && pathname === "/api/game/action") {
    try {
      const body = await parseJsonBody(req);
      const { id: sessionId, session } = getOrCreateSession(body.sessionId);
      const action = body.action;

      if (action === "COLLECT_TREASURE") {
        if (!session.gameState.hasTreasure && !session.gameState.treasureChestOpened) {
          session.gameState.hasTreasure = true;
          session.gameState.treasureChestOpened = true;
          session.gameState.questStatus = "TREASURE_COLLECTED";
          session.gameState.historyLog.push({ event: "TREASURE_COLLECTED_WORLD", timestamp: Date.now() });
          sendJson(res, 200, {
            success: true,
            gameState: session.gameState,
            state: session.gameState,
            message: "You opened the ancient chest and claimed the Amulet of the Sunken Veil!"
          });
          return;
        } else {
          sendJson(res, 200, {
            success: false,
            gameState: session.gameState,
            state: session.gameState,
            message: "The treasure chest has already been looted."
          });
          return;
        }
      }

      if (action === "COMPLETE_GATE_OPEN") {
        if (session.gameState.gateState === "OPENING" || session.gameState.gateState === "OPEN") {
          session.gameState.gateState = "OPEN";
          session.gameState.historyLog.push({ event: "GATE_FULLY_OPENED", timestamp: Date.now() });
          sendJson(res, 200, {
            success: true,
            gameState: session.gameState,
            state: session.gameState,
            message: "The sanctuary gate has finished unlocking."
          });
          return;
        }
      }

      if (action === "ENTER_SANCTUARY") {
        if (session.gameState.gateState === "OPEN" && !session.gameState.rewardClaimed) {
          session.gameState.rewardClaimed = true;
          session.gameState.gold += 100;
          session.gameState.xp += 50;
          session.gameState.questStatus = "COMPLETED";
          session.gameState.historyLog.push({ event: "SANCTUARY_DISCOVERED", reward: { gold: 100, xp: 50 }, timestamp: Date.now() });
          sendJson(res, 200, {
            success: true,
            gameState: session.gameState,
            state: session.gameState,
            reward: { gold: 100, xp: 50 },
            message: "You stepped into the Sanctuary of Shadows! Quest Completed! +100 Gold, +50 XP awarded!"
          });
          return;
        } else if (session.gameState.rewardClaimed) {
          sendJson(res, 200, {
            success: true,
            gameState: session.gameState,
            state: session.gameState,
            reward: null,
            message: "You walk peacefully through the sanctuary."
          });
          return;
        } else {
          sendJson(res, 403, {
            success: false,
            gameState: session.gameState,
            state: session.gameState,
            message: "The sanctuary gate is still locked!"
          });
          return;
        }
      }

      if (action === "RESET_GAME") {
        session.gameState = createInitialGameState();
        session.lastInteractionId = null;
        session.history = [];
        sendJson(res, 200, {
          success: true,
          gameState: session.gameState,
          state: session.gameState,
          greeting: INITIAL_GREETING,
          message: "Game world and quest state have been completely reset."
        });
        return;
      }

      sendJson(res, 400, { success: false, error: "Unrecognized game action." });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message || "Failed to process game action." });
    }
    return;
  }

  // Reset conversation & game state endpoint
  if (req.method === "POST" && pathname === "/api/reset") {
    try {
      const body = await parseJsonBody(req);
      const { id, session } = getOrCreateSession(body.sessionId);
      session.lastInteractionId = null;
      session.history = [];
      session.gameState = createInitialGameState();

      sendJson(res, 200, {
        success: true,
        sessionId: id,
        greeting: INITIAL_GREETING,
        gameState: session.gameState,
        message: "Game and conversation state have been reset to the initial state."
      });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message || "Failed to reset session." });
    }
    return;
  }

  // Chat message endpoint with Stage 2 Action Validation Protocol
  if (req.method === "POST" && pathname === "/api/chat") {
    try {
      const body = await parseJsonBody(req);
      const rawMessage = body.message;

      // Validate message: prevent empty or whitespace-only messages
      if (!rawMessage || typeof rawMessage !== "string" || !rawMessage.trim()) {
        sendJson(res, 400, {
          success: false,
          error: "Message cannot be empty."
        });
        return;
      }

      const playerMessage = rawMessage.trim();
      if (playerMessage.length > 1000) {
        sendJson(res, 400, {
          success: false,
          error: "Message is too long. Please keep your question under 1000 characters."
        });
        return;
      }

      const { id: sessionId, session } = getOrCreateSession(body.sessionId);

      // Concurrency guard: prevent duplicate API requests when player clicks repeatedly
      if (session.isProcessing) {
        sendJson(res, 429, {
          success: false,
          error: "MAAYA is already contemplating your previous words. Please wait a moment.",
          isDuplicate: true
        });
        return;
      }
      session.isProcessing = true;

      try {
        // Construct live context-aware prompt with authoritative game state
        const currentContext = `[CURRENT AUTHORITATIVE GAME STATE]
- Quest Status: ${session.gameState.questStatus}
- Player Holds Ghost-Guarded Treasure in Inventory: ${session.gameState.hasTreasure ? "YES" : "NO"}
- Sanctuary Gate State: ${session.gameState.gateState}
- Sanctuary Reward Already Claimed: ${session.gameState.rewardClaimed ? "YES" : "NO"}
- Player Gold: ${session.gameState.gold}, XP: ${session.gameState.xp}

Traveler says: "${playerMessage}"

Remember: Respond in strict JSON format:
{
  "dialogue": "Spoken dialogue here (1-2 sentences)",
  "proposed_action": { "type": "NONE" | "ACCEPT_QUEST" | "RETURN_TREASURE" | "OPEN_GATE" | "COMPLETE_QUEST" | "CELEBRATE", "target": "sanctuary_gate" | "player" | null },
  "reason": "Brief reason"
}`;

        let replyRaw = "";
        let newInteractionId = null;
        let fallbackTriggered = false;
        let fallbackReason = null;

        const createParams = {
          system_instruction: MAAYA_SYSTEM_INSTRUCTION,
          input: currentContext
        };

        if (session.lastInteractionId) {
          createParams.previous_interaction_id = session.lastInteractionId;
        }

        try {
          const result = await callGeminiWithResilience(createParams);
          newInteractionId = result.response.id;
          replyRaw = result.response.output_text?.trim() || "";
        } catch (apiError) {
          const classified = classifyApiError(apiError);
          console.warn(`[Gemini API Failure] Detected: ${classified.type} (${classified.message})`);

          // If chained interaction failed with a temporary error, attempt one unchained call with recent context history
          if (session.lastInteractionId && classified.type !== ErrorType.QUOTA_EXHAUSTED && classified.type !== ErrorType.CLIENT_ERROR) {
            try {
              const contextHistory = session.history
                .slice(-6)
                .map((h) => `${h.role === "player" ? "Traveler" : "MAAYA"}: ${h.text}`)
                .join("\n");

              const fallbackInput = `${contextHistory ? `[Recent Dialogue History]\n${contextHistory}\n\n` : ""}${currentContext}`;

              const retryResult = await callGeminiWithResilience({
                system_instruction: MAAYA_SYSTEM_INSTRUCTION,
                input: fallbackInput
              });
              newInteractionId = retryResult.response.id;
              replyRaw = retryResult.response.output_text?.trim() || "";
            } catch (retryError) {
              fallbackTriggered = true;
              fallbackReason = classifyApiError(retryError).type;
            }
          } else {
            fallbackTriggered = true;
            fallbackReason = classified.type;
          }

          // If live API calls failed or models are in quota cooldown, engage context-aware fallback engine
          if (fallbackTriggered || !replyRaw) {
            fallbackTriggered = true;
            if (!fallbackReason) fallbackReason = classified.type;
            console.warn(`[Fallback Engine] Activating context-aware guardian response (Reason: ${fallbackReason}).`);
            const fallback = getDeterministicFallbackResponse(playerMessage, session.gameState, session.history);
            replyRaw = JSON.stringify(fallback);
          }
        }

        // Safely parse structured AI response
        let parsedAi = null;
        try {
          const cleaned = replyRaw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
          parsedAi = JSON.parse(cleaned);
        } catch (e) {
          // Handle plain text response gracefully
          parsedAi = {
            dialogue: replyRaw || "The shadows whisper softly, yet stillness holds my tongue. Speak once more, traveler.",
            proposed_action: { type: "NONE", target: null },
            reason: "Unstructured response wrapped"
          };
        }

        // If AI didn't provide dialogue, extract or use fallback
        let spokenDialogue = parsedAi.dialogue || (typeof parsedAi === "string" ? parsedAi : "The shadows linger silently.");

        // Independent, authoritative validation of AI proposed action against trusted game rules
        const validation = validateAndApplyAction(parsedAi.proposed_action, session.gameState);

        // If the AI erroneously proposed to open the gate but player has no treasure, ensure spoken dialogue reflects game truth
        if (parsedAi.proposed_action?.type === "OPEN_GATE" && !validation.valid && !session.gameState.hasTreasure) {
          spokenDialogue = "I cannot open the sanctuary gate yet, traveler. You must first venture into the ghost crypt and recover the sacred treasure.";
        }

        // Update conversational history
        session.lastInteractionId = newInteractionId;
        session.history.push({ role: "player", text: playerMessage, timestamp: Date.now() });
        session.history.push({ role: "npc", text: spokenDialogue, timestamp: Date.now() });

        if (session.history.length > MAX_HISTORY_TURNS * 2) {
          session.history = session.history.slice(-MAX_HISTORY_TURNS * 2);
        }

        sendJson(res, 200, {
          success: true,
          reply: spokenDialogue,
          proposed_action: parsedAi.proposed_action || { type: "NONE", target: null },
          action_validated: validation.valid,
          action_applied: validation.valid,
          actionApplied: validation.valid,
          validated_action: validation.action,
          action: validation.action,
          action_reason: validation.reason,
          gameState: session.gameState,
          state: session.gameState,
          sessionId,
          interactionId: newInteractionId,
          fallbackActive: fallbackTriggered,
          fallbackReason: fallbackTriggered ? fallbackReason : null
        });
      } finally {
        session.isProcessing = false;
      }
    } catch (err) {
      console.error("Error processing /api/chat:", err?.message || err);
      sendJson(res, 500, {
        success: false,
        error: "An icy chill sweeps through the hallway as MAAYA's gaze turns distant into the shadows. Please speak again in a moment."
      });
    }
    return;
  }

  // Serve static files for frontend
  if (req.method === "GET") {
    serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("405 Method Not Allowed");
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`MaayaVerse: The Living NPC — Stage 2 Server running at:`);
  console.log(`http://localhost:${PORT}`);
  console.log(`Character: MAAYA (Guardian of the Restricted Wing)`);
  console.log(`Primary Model:  ${PRIMARY_MODEL}`);
  console.log(`Fallback Model: ${FALLBACK_MODEL}`);
  console.log(`=======================================================`);
});
