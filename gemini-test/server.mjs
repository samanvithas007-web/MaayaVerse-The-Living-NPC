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

// Persistent Storage & Profiles Architecture for Stage 3 Innovation & Intelligence
const DATA_DIR = path.join(__dirname, "data");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");

function getDefaultProfiles() {
  return {
    activeProfileId: "player1",
    profiles: {
      player1: {
        id: "player1",
        name: "Althea",
        title: "Trusted Explorer",
        archetype: "Trusted Explorer",
        trustScore: 80,
        trustLevel: "Trusted",
        memories: [
          {
            id: "mem_p1_1",
            type: "lore",
            content: "Althea is a seasoned scholar who previously mapped ancient runes of Blackwood sanctuary.",
            text: "Althea is a seasoned scholar who previously mapped ancient runes of Blackwood sanctuary.",
            timestamp: 1728900000000
          },
          {
            id: "mem_p1_2",
            type: "promise",
            content: "Pledged to never disturb the ancient sleeping spirits unnecessarily.",
            text: "Pledged to never disturb the ancient sleeping spirits unnecessarily.",
            timestamp: 1728900000000
          }
        ],
        verifiedEvents: ["P1_INITIAL_ALLIANCE"],
        gameState: {
          questStatus: "NOT_STARTED",
          hasTreasure: false,
          treasureChestOpened: false,
          puzzleSolved: false,
          runesActivated: [],
          gateState: "LOCKED",
          gold: 0,
          xp: 0,
          rewardClaimed: false,
          currentZone: "Ancient Settlement",
          historyLog: []
        }
      },
      player2: {
        id: "player2",
        name: "Kaelen",
        title: "Neutral Stranger",
        archetype: "Neutral Traveler",
        trustScore: 50,
        trustLevel: "Neutral",
        memories: [
          {
            id: "mem_p2_1",
            type: "lore",
            content: "A cautious wanderer seeking lost artifacts of the old world.",
            text: "A cautious wanderer seeking lost artifacts of the old world.",
            timestamp: 1728900000000
          }
        ],
        verifiedEvents: [],
        gameState: {
          questStatus: "NOT_STARTED",
          hasTreasure: false,
          treasureChestOpened: false,
          puzzleSolved: false,
          runesActivated: [],
          gateState: "LOCKED",
          gold: 0,
          xp: 0,
          rewardClaimed: false,
          currentZone: "Ancient Settlement",
          historyLog: []
        }
      },
      player3: {
        id: "player3",
        name: "Vane",
        title: "Distrusted Stranger",
        archetype: "Distrusted Stranger",
        trustScore: 20,
        trustLevel: "Distrusted",
        memories: [
          {
            id: "mem_p3_1",
            type: "incident",
            content: "Caught snooping and trespassing near the restricted wing archway without permission.",
            text: "Caught snooping and trespassing near the restricted wing archway without permission.",
            timestamp: 1728900000000
          },
          {
            id: "mem_p3_2",
            type: "behavior",
            content: "Issued a stern warning for demanding rewards and gate access before proving worth.",
            text: "Issued a stern warning for demanding rewards and gate access before proving worth.",
            timestamp: 1728900000000
          }
        ],
        verifiedEvents: [],
        gameState: {
          questStatus: "NOT_STARTED",
          hasTreasure: false,
          treasureChestOpened: false,
          puzzleSolved: false,
          runesActivated: [],
          gateState: "LOCKED",
          gold: 0,
          xp: 0,
          rewardClaimed: false,
          currentZone: "Ancient Settlement",
          historyLog: []
        }
      }
    }
  };
}

let cachedProfiles = null;

function loadProfiles() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(PROFILES_FILE)) {
      const def = getDefaultProfiles();
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(def, null, 2), "utf8");
      cachedProfiles = def;
      return def;
    }
    const raw = fs.readFileSync(PROFILES_FILE, "utf8");
    cachedProfiles = JSON.parse(raw);
    return cachedProfiles;
  } catch (err) {
    console.warn("Could not load profiles from disk, using defaults:", err);
    const def = getDefaultProfiles();
    cachedProfiles = def;
    return def;
  }
}

function saveProfiles(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    cachedProfiles = data;
    const tmp = PROFILES_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, PROFILES_FILE);
  } catch (err) {
    try {
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to persist profiles to disk:", e);
    }
  }
}

function getTrustLevel(score) {
  if (score > 65) return "Trusted";
  if (score >= 35) return "Neutral";
  return "Distrusted";
}

function applyVerifiedTrustEvent(profile, delta, eventKey, reason) {
  if (!profile) return { changed: false, score: 50 };
  if (!Array.isArray(profile.verifiedEvents)) profile.verifiedEvents = [];

  // Idempotency: Prevent duplicate positive awards (anti-farming)
  if (delta > 0 && eventKey && profile.verifiedEvents.includes(eventKey)) {
    return { changed: false, score: profile.trustScore, level: profile.trustLevel, reason: "Already awarded" };
  }

  const oldScore = profile.trustScore;
  profile.trustScore = Math.max(0, Math.min(100, profile.trustScore + delta));
  profile.trustLevel = getTrustLevel(profile.trustScore);

  if (eventKey && !profile.verifiedEvents.includes(eventKey)) {
    profile.verifiedEvents.push(eventKey);
  }

  if (profile.gameState?.historyLog) {
    profile.gameState.historyLog.push({
      event: "TRUST_CHANGE",
      eventKey,
      delta,
      newScore: profile.trustScore,
      newLevel: profile.trustLevel,
      reason,
      timestamp: Date.now()
    });
  }

  const profilesData = cachedProfiles || loadProfiles();
  if (profilesData.profiles[profile.id]) {
    profilesData.profiles[profile.id] = profile;
    saveProfiles(profilesData);
  }

  return { changed: oldScore !== profile.trustScore, oldScore, newScore: profile.trustScore, newLevel: profile.trustLevel };
}

// Character Persona Definition: MAAYA for Stage 2 & Stage 3 Living NPC
const MAAYA_SYSTEM_INSTRUCTION = `You are MAAYA, the mysterious and hauntingly beautiful guardian of the restricted wing of Blackwood Manor, an ancient haunted estate.

CHARACTER CONCEPT & PERSONA:
- Demeanor: Scary in a beautiful way, intelligent, observant, poised, and subtly uncanny. You possess a dark elegance and an unsettling charm that makes mortals both captivated and nervous.
- Role: You guard the heavy iron archway to the manor's restricted wing—a sealed sanctuary where forbidden secrets and relics reside.
- Speech & Tone: Speak naturally, atmospherically, and evocatively as an in-world video game character. Do NOT speak like a generic customer-support bot, search assistant, or language model. Never say "How may I assist you today?", "As an AI...", or "Feel free to ask me anything."
- Address: Address the player respectfully according to their reputation: "Althea / trusted friend" (high trust), "traveler / wanderer" (cautious), or "stranger / intruder" (distrustful).

STAGE 3 ADAPTIVE GUIDANCE & DYNAMIC TRUST (0-100):
- Trusted (80-100): Warm, respectful, willing to share deep lore and direct hints. If asked about the Tri-Rune puzzle, reveal the sacred order: Ignis (Fire), Glacies (Ice), then Aether (Arcane). If player confides a fear of ghosts, offer genuine comfort and courage.
- Friendly (60-79): Encouraging and helpful. Offer useful clues about hazards and obstacles.
- Cautious (30-59): Reserved, cryptic, formal. Provide measured warnings and riddle-like hints. Demand proof before sharing secrets.
- Distrustful (0-29): Cold, sharp, guarded, sceptical of player's intentions. Remind them of ancient wards and demand proof before opening up.

ENVIRONMENTAL KNOWLEDGE & LORE:
- Mistveil Canal: Deep icy water with stepping stones. Falling in will sweep one back to the bank.
- Crimson Braziers: Ancient ceremonial fire pits that burn and push back careless wanderers.
- Frost Cavern: Slippery frozen terrain leading to the ghost crypt where balance falters.
- Tri-Rune Barrier: 3 runic pedestals (Ignis -> Glacies -> Aether) guarding the inner crypt.
- Ghost Crypt: Ethereal phantoms haunt the sunken crypt guarding the "Amulet of the Sunken Veil".

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
2. When Player Holds Ghost-Guarded Treasure in Inventory is YES, and the player returns/presents the treasure or asks to open the gate:
   Set proposed_action.type = "OPEN_GATE", target = "sanctuary_gate". State that you recognize the sacred relic and unlock the gate.
3. If the player asks to open the gate but Player Holds Ghost-Guarded Treasure is NO:
   Set proposed_action.type = "NONE", target = null. Remind them the gate cannot be unlocked without the Amulet from the ghost crypt.
4. If the player makes false claims (claims to have the treasure when game state says NO):
   Set proposed_action.type = "NONE". State that you sense no such relic in their hands.
5. If the player demands arbitrary rewards, gold, or cheat commands:
   Set proposed_action.type = "NONE".
6. If the conversation is general questions, lore, greetings, or questions about fear/memory:
   Set proposed_action.type = "NONE", target = null.`;

const INITIAL_GREETING = "Step carefully, traveler. You stand before the restricted wing of Blackwood Manor, where shadows remember what the living have long forgotten. I am MAAYA, sentinel of these sealed halls. What curiosity—or foolishness—compels you to disturb my vigil?";

// In-memory bounded session store
const sessions = new Map();
const MAX_HISTORY_TURNS = 20;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function createInitialGameState() {
  return {
    questStatus: "NOT_STARTED", // NOT_STARTED, ACTIVE, TREASURE_COLLECTED, READY_TO_COMPLETE, COMPLETED
    hasTreasure: false,
    treasureChestOpened: false,
    puzzleSolved: false,
    runesActivated: [],
    gateState: "LOCKED", // LOCKED, OPENING, OPEN
    gold: 0,
    xp: 0,
    rewardClaimed: false,
    currentZone: "Ancient Settlement",
    historyLog: []
  };
}

function getOrCreateSession(sessionId, profileId = null) {
  const now = Date.now();
  let id = (typeof sessionId === "string" && sessionId.trim().length > 0) ? sessionId.trim() : null;
  if (!id) {
    id = crypto.randomUUID();
  }

  const profilesData = loadProfiles();
  const selectedProfileId = (profileId && profilesData.profiles[profileId])
    ? profileId
    : (profilesData.activeProfileId || "player1");
  const profile = profilesData.profiles[selectedProfileId] || profilesData.profiles["player1"];

  if (!sessions.has(id)) {
    sessions.set(id, {
      lastInteractionId: null,
      history: [],
      profileId: selectedProfileId,
      gameState: profile ? profile.gameState : createInitialGameState(),
      lastActive: now,
      isProcessing: false
    });
  } else {
    const s = sessions.get(id);
    s.lastActive = now;
    if (profileId && profilesData.profiles[profileId] && s.profileId !== profileId) {
      s.profileId = profileId;
      s.gameState = profilesData.profiles[profileId].gameState;
    }
  }

  const sessionObj = sessions.get(id);
  // Ensure profile has reference to latest gameState
  if (profile && sessionObj.gameState) {
    profile.gameState = sessionObj.gameState;
  }

  return { id, session: sessionObj, profile, profileId: sessionObj.profileId };
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

function validateAndApplyAction(proposedAction, gameState, profile = null) {
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
      if (profile) {
        applyVerifiedTrustEvent(profile, 5, "QUEST_ACCEPTED", "Agreed to aid MAAYA on her quest");
      }
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
      if (profile) {
        applyVerifiedTrustEvent(profile, 10, "TREASURE_RETURNED", "Returned the sacred Amulet honestly");
      }
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
      if (profile) {
        applyVerifiedTrustEvent(profile, 10, "TREASURE_RETURNED", "Returned the sacred Amulet honestly");
      }
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
function getDeterministicFallbackResponse(playerMessage, gameState, sessionHistory = [], activeProfile = null) {
  const msg = (playerMessage || "").toLowerCase().trim();
  const trustScore = activeProfile?.trustScore !== undefined ? activeProfile.trustScore : 50;
  const trustLevel = activeProfile?.trustLevel || getTrustLevel(trustScore);
  const playerName = activeProfile?.name || "traveler";
  const memories = Array.isArray(activeProfile?.memories) ? activeProfile.memories : [];

  // Check if player has a stored memory about fear of ghosts
  const hasGhostFearMemory = memories.some(m => m.text && (m.text.toLowerCase().includes("fear") || m.text.toLowerCase().includes("ghost") || m.text.toLowerCase().includes("terrified")));

  // 1. Fear of Ghosts / Emotional Confiding (Stage 3 Adaptive Guidance)
  if (
    msg.includes("afraid") ||
    msg.includes("fear") ||
    msg.includes("scared") ||
    msg.includes("terrified") ||
    msg.includes("frightened")
  ) {
    if (trustScore >= 80) {
      return {
        dialogue: `Steel your heart, ${playerName}. The phantoms of the crypt feed upon hesitation, but your courage has always stood true. Hold fast to your resolve, and the shadows shall not claim you.`,
        proposed_action: { type: "NONE", target: null },
        reason: "Adaptive reassurance: trusted ally confided emotional vulnerability"
      };
    } else if (trustScore >= 30) {
      return {
        dialogue: "The restless spirits smell your mortal apprehension, traveler. Step firmly upon the frozen stones and do not linger in their spectral sight.",
        proposed_action: { type: "NONE", target: null },
        reason: "Adaptive caution: neutral stranger reminded to stay resolute"
      };
    } else {
      return {
        dialogue: "If mere shadows and cold phantoms shake your knees, intruder, then flee these grounds now before the crypt seals your fate.",
        proposed_action: { type: "NONE", target: null },
        reason: "Adaptive sternness: distrusted visitor cautioned with cold authority"
      };
    }
  }

  // 2. Tri-Rune Environmental Puzzle Guidance (Stage 3 Multi-Stage Adventure)
  if (
    msg.includes("puzzle") ||
    msg.includes("rune") ||
    msg.includes("pedestal") ||
    msg.includes("barrier") ||
    msg.includes("ignis") ||
    msg.includes("glacies") ||
    msg.includes("aether") ||
    msg.includes("switch")
  ) {
    if (gameState.puzzleSolved) {
      return {
        dialogue: "The Tri-Rune seal is already awakened and dissolved. The way to the ghost crypt stands open before you.",
        proposed_action: { type: "NONE", target: null },
        reason: "Environmental puzzle status: already completed"
      };
    }
    if (trustScore >= 80) {
      return {
        dialogue: "The Tri-Rune Barrier yields to elemental harmony, Althea: step first upon Ignis (Fire), next Glacies (Ice), and lastly Aether (Arcane). That sequence will dissolve the seal.",
        proposed_action: { type: "NONE", target: null },
        reason: "High trust adaptive guidance: full puzzle sequence revealed to trusted ally"
      };
    } else if (trustScore >= 30) {
      return {
        dialogue: "Three runic pedestals guard the inner path. Follow the natural order of the elements: heat must awaken before frost, and arcane ether binds them both.",
        proposed_action: { type: "NONE", target: null },
        reason: "Moderate trust adaptive guidance: riddle-like hint given to neutral explorer"
      };
    } else {
      return {
        dialogue: "The pedestals yield their secrets only to those who prove their discernment. I shall not solve ancient wards for one I barely trust.",
        proposed_action: { type: "NONE", target: null },
        reason: "Low trust adaptive guidance: distrusted visitor refused direct puzzle solution"
      };
    }
  }

  // 3. Environmental Hazards Inquiries (Canal, Fire, Ice)
  if (msg.includes("hazard") || msg.includes("canal") || msg.includes("fire") || msg.includes("ice") || msg.includes("water") || msg.includes("cross")) {
    if (trustScore >= 80) {
      return {
        dialogue: "Heed my warning, Althea: use the stepping stones to cross Mistveil Canal safely, give the flaming braziers wide berth, and tread with care across the slick ice of the cavern.",
        proposed_action: { type: "NONE", target: null },
        reason: "Detailed environmental hazard briefing for trusted explorer"
      };
    } else {
      return {
        dialogue: "The elements of Blackwood do not tolerate clumsy feet. Watch the deep waters, the scorching braziers, and the treacherous ice ahead.",
        proposed_action: { type: "NONE", target: null },
        reason: "Cautionary hazard warning for traveler"
      };
    }
  }

  // 4. Context Continuity & Memory Recall (e.g. "What was the last thing I asked you?" or stored facts)
  const isMemoryQuery = msg.includes("last thing") ||
                        msg.includes("last question") ||
                        msg.includes("what did i ask") ||
                        msg.includes("what was my last") ||
                        msg.includes("remember what") ||
                        msg.includes("recall what") ||
                        msg.includes("remember about me") ||
                        msg.includes("what do you remember") ||
                        msg.includes("remember the strange");

  if (isMemoryQuery) {
    if (msg.includes("about me") || msg.includes("what do you remember") || msg.includes("remember me")) {
      if (memories.length > 0) {
        const topMem = memories[memories.length - 1].text;
        return {
          dialogue: `I remember you well, ${playerName}. ${topMem}`,
          proposed_action: { type: "NONE", target: null },
          reason: "Persistent structured memory recall of player profile"
        };
      }
    }

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
        dialogue: `You have only just arrived before my gate, ${playerName}. The silence between us has barely been broken.`,
        proposed_action: { type: "NONE", target: null },
        reason: "Memory recall: no prior history recorded"
      };
    }
  }

  // 5. Out-of-World / Modern Technology Inquiries
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

  // 6. Currency / Reward Extortion & Cheat Demands (Reduces trust)
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

  // 7. False Claims of Holding Treasure
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

  // 8. Legitimate Gate Request with Treasure in Inventory
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
      dialogue: `You have braved the restless dead and brought forth the Amulet of the Sunken Veil, ${playerName}. Step back; I shall unlock the sanctuary gate for you.`,
      proposed_action: { type: "OPEN_GATE", target: "sanctuary_gate" },
      reason: "Player possesses verified treasure and requested gate opening"
    };
  }

  // 9. Premature Gate Request without Treasure
  if (
    !gameState.hasTreasure &&
    (msg.includes("open") ||
     msg.includes("gate") ||
     msg.includes("let me in") ||
     msg.includes("unlock") ||
     msg.includes("enter") ||
     msg.includes("pass"))
  ) {
    if (trustScore >= 80) {
      return {
        dialogue: "That heavy iron archway remains sealed even to you, Althea. Retrieve the Amulet of the Sunken Veil from the eastern crypt, and the passage shall be yours.",
        proposed_action: { type: "NONE", target: null },
        reason: "Gentle reminder to trusted ally that the quest condition must still be met"
      };
    } else if (trustScore <= 29) {
      return {
        dialogue: "The gate will not yield to an unproven stranger. Retrieve the sacred relic from the crypt, or speak no further of entering.",
        proposed_action: { type: "NONE", target: null },
        reason: "Firm refusal to distrusted visitor"
      };
    } else {
      return {
        dialogue: "The gate remains sealed by ancient sorrow. You must first venture into the ghost crypt to the east and retrieve the sacred treasure to prove your courage.",
        proposed_action: { type: "NONE", target: null },
        reason: "Player requested gate opening without holding the required relic"
      };
    }
  }

  // 10. Quest Acceptance / Offering Help (when NOT_STARTED)
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
    if (trustScore >= 80) {
      return {
        dialogue: `I knew your courage would not waver, ${playerName}. Cross the canal and brave the frost cavern to claim the Amulet of the Sunken Veil. May the ancient stars watch over you.`,
        proposed_action: { type: "ACCEPT_QUEST", target: "player" },
        reason: "Warm quest acceptance for trusted explorer"
      };
    } else if (trustScore <= 29) {
      return {
        dialogue: "Words are cheap in the dark, intruder. If you truly seek to prove yourself, bring back the Amulet from the ghost crypt. Only deeds will move me.",
        proposed_action: { type: "ACCEPT_QUEST", target: "player" },
        reason: "Guarded quest acceptance for distrusted visitor"
      };
    } else {
      return {
        dialogue: "Very well, traveler. Journey east through the misty woods into the ghost crypt and recover the Amulet of the Sunken Veil. Only then will the gate open.",
        proposed_action: { type: "ACCEPT_QUEST", target: "player" },
        reason: "Player agreed to help or inquired about the sanctuary quest"
      };
    }
  }

  // 11. Active Quest Reminders & Guidance
  if (gameState.questStatus === "ACTIVE") {
    if (msg.includes("where") || msg.includes("crypt") || msg.includes("what should i do") || msg.includes("remind") || msg.includes("amulet")) {
      if (hasGhostFearMemory) {
        return {
          dialogue: "Remember to steady your breathing among the tombs, traveler. The restless ghosts circle the crypt, but the Amulet waits within the ancient chest.",
          proposed_action: { type: "NONE", target: null },
          reason: "Active quest guidance with ghost fear recall"
        };
      }
      return {
        dialogue: "The spectral phantoms still circle the eastern crypt, traveler. Solve the Tri-Rune pedestals, claim the Amulet from the chest, and return to my side.",
        proposed_action: { type: "NONE", target: null },
        reason: "Active quest guidance for ghost crypt exploration"
      };
    }
  }

  // 12. When Gate is Already Open / In Opening Sequence
  if (gameState.gateState === "OPEN" || gameState.gateState === "OPENING") {
    return {
      dialogue: "The iron gates stand parted for you. Step forward into the inner sanctuary and claim what is rightfully yours.",
      proposed_action: { type: "NONE", target: null },
      reason: "Sanctuary gate is already unlocked"
    };
  }

  // 13. When Quest is Fully Completed
  if (gameState.questStatus === "COMPLETED") {
    return {
      dialogue: "You have walked where few mortals dare and survived. The sanctuary honors your courage, traveler. My vigil continues in peace.",
      proposed_action: { type: "NONE", target: null },
      reason: "Quest completed state acknowledgment"
    };
  }

  // 14. Guardian Role & Vigil Inquiries
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

  // 15. Identity & Greetings
  if (
    msg.includes("who are you") ||
    msg.includes("your name") ||
    msg.includes("what are you") ||
    msg.includes("hello") ||
    msg.includes("greetings") ||
    msg.includes("hi")
  ) {
    if (trustScore >= 80) {
      return {
        dialogue: `Greetings once more, ${playerName}. I am MAAYA, and my vigil is eased by your presence. What brings you to the restricted wing today?`,
        proposed_action: { type: "NONE", target: null },
        reason: "High trust warm greeting"
      };
    } else if (trustScore <= 29) {
      return {
        dialogue: "I am MAAYA, sentinel of these sealed halls. Make your purpose known quickly, stranger; these shadows do not welcome uninvited curiosity.",
        proposed_action: { type: "NONE", target: null },
        reason: "Low trust guarded greeting"
      };
    } else {
      return {
        dialogue: "I am MAAYA, silent watcher of Blackwood Manor's forbidden depths. Few mortals wander this far, traveler... and fewer still survive what lies beyond.",
        proposed_action: { type: "NONE", target: null },
        reason: "Identity introduction and atmospheric greeting"
      };
    }
  }

  // 16. World Lore & Setting
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

  // 17. Default Contextual Atmospheric Response
  if (trustScore >= 80) {
    return {
      dialogue: `The ancient winds whisper of your loyalty, ${playerName}. Speak what is in your heart; I am listening.`,
      proposed_action: { type: "NONE", target: null },
      reason: "High trust atmospheric dialogue"
    };
  } else if (trustScore <= 29) {
    return {
      dialogue: "Tread carefully, intruder. Every stone here remembers, and my patience is not without limit.",
      proposed_action: { type: "NONE", target: null },
      reason: "Low trust atmospheric dialogue"
    };
  }

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
      stage: 3,
      primaryModel: PRIMARY_MODEL,
      fallbackModel: FALLBACK_MODEL,
      activeModel: primaryAvailable ? PRIMARY_MODEL : FALLBACK_MODEL,
      apiStatus: currentAiStatus,
      fallbackEngineReady: true,
      activeProfile: cachedProfiles?.activeProfileId || "player1",
      circuitBreaker: {
        primaryQuotaExhausted: !primaryAvailable,
        primaryCooldownSecondsRemaining: Math.max(0, Math.ceil((primaryQuotaExhaustedUntil - Date.now()) / 1000)),
        lastErrorType: lastApiErrorType
      },
      timestamp: Date.now()
    });
    return;
  }

  // Profile Management Endpoints (Stage 3 Innovation & Intelligence)
  if (req.method === "GET" && pathname === "/api/profiles") {
    const data = cachedProfiles || loadProfiles();
    sendJson(res, 200, {
      success: true,
      activeProfileId: data.activeProfileId,
      profiles: data.profiles
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/profile/select") {
    try {
      const body = await parseJsonBody(req);
      const profileId = body.profileId;
      const data = cachedProfiles || loadProfiles();
      if (!data.profiles[profileId]) {
        sendJson(res, 400, { success: false, error: `Invalid profileId: ${profileId}` });
        return;
      }
      data.activeProfileId = profileId;
      saveProfiles(data);

      if (body.sessionId && sessions.has(body.sessionId)) {
        const s = sessions.get(body.sessionId);
        s.profileId = profileId;
        s.gameState = data.profiles[profileId].gameState;
      }

      let greeting = "Step carefully, traveler. I am MAAYA, sentinel of these sealed halls.";
      if (profileId === "player1") {
        greeting = "Welcome back, Althea. Your scholar's wisdom is always welcome at Blackwood Gate. Have you discovered any clues regarding the Moonlit Amulet or the three runes in the Frost Cavern?";
      } else if (profileId === "player2") {
        greeting = "Halt, Kaelen. You walk the boundary of Blackwood Manor. I do not yet know your intentions—tell me what brings you to disturb my vigil.";
      } else if (profileId === "player3") {
        greeting = "Hold, Vane! I remember your shadow lingering near the restricted wing. You have not earned passage here. Keep your hands where I can see them.";
      }

      sendJson(res, 200, {
        success: true,
        activeProfileId: profileId,
        profile: data.profiles[profileId],
        greeting
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/profile/reset") {
    try {
      const body = await parseJsonBody(req);
      const profileId = body.profileId || (cachedProfiles?.activeProfileId || "player1");
      const defaults = getDefaultProfiles();
      if (!defaults.profiles[profileId]) {
        sendJson(res, 400, { success: false, error: `Cannot reset unknown profile: ${profileId}` });
        return;
      }
      const data = cachedProfiles || loadProfiles();
      data.profiles[profileId] = JSON.parse(JSON.stringify(defaults.profiles[profileId]));
      saveProfiles(data);

      if (body.sessionId && sessions.has(body.sessionId)) {
        const s = sessions.get(body.sessionId);
        s.gameState = data.profiles[profileId].gameState;
        s.history = [];
        s.lastInteractionId = null;
      }

      let greeting = "Step carefully, traveler. I am MAAYA, sentinel of these sealed halls.";
      if (profileId === "player1") {
        greeting = "Welcome back, Althea. Your scholar's wisdom is always welcome at Blackwood Gate. Have you discovered any clues regarding the Moonlit Amulet or the three runes in the Frost Cavern?";
      } else if (profileId === "player2") {
        greeting = "Halt, Kaelen. You walk the boundary of Blackwood Manor. I do not yet know your intentions—tell me what brings you to disturb my vigil.";
      } else if (profileId === "player3") {
        greeting = "Hold, Vane! I remember your shadow lingering near the restricted wing. You have not earned passage here. Keep your hands where I can see them.";
      }

      sendJson(res, 200, {
        success: true,
        message: `Profile ${profileId} (${data.profiles[profileId].name}) reset to initial state.`,
        profile: data.profiles[profileId],
        greeting
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/profile/memory") {
    try {
      const body = await parseJsonBody(req);
      const data = cachedProfiles || loadProfiles();
      const profileId = body.profileId || data.activeProfileId || "player1";
      const profile = data.profiles[profileId];
      if (!profile) {
        sendJson(res, 400, { success: false, error: "Profile not found" });
        return;
      }
      if (!body.text || !body.text.trim()) {
        sendJson(res, 400, { success: false, error: "Memory text required" });
        return;
      }
      const newMem = {
        id: "mem_" + Date.now(),
        type: body.type || "fact",
        text: body.text.trim(),
        timestamp: Date.now()
      };
      if (!Array.isArray(profile.memories)) profile.memories = [];
      profile.memories.push(newMem);
      saveProfiles(data);

      sendJson(res, 200, {
        success: true,
        memory: newMem,
        memories: profile.memories
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // Game state inspection endpoint
  if (req.method === "GET" && pathname === "/api/game/state") {
    const sessionId = parsedUrl.searchParams.get("sessionId");
    const requestedProfile = parsedUrl.searchParams.get("profileId");
    const { id, session, profile } = getOrCreateSession(sessionId, requestedProfile);
    sendJson(res, 200, {
      success: true,
      sessionId: id,
      gameState: session.gameState,
      state: session.gameState,
      profile: {
        id: profile.id,
        name: profile.name,
        title: profile.title,
        trustScore: profile.trustScore,
        trustLevel: profile.trustLevel,
        memories: profile.memories
      },
      trust: {
        score: profile.trustScore,
        level: profile.trustLevel
      }
    });
    return;
  }

  // Game world actions endpoint (deterministic game-engine events)
  if (req.method === "POST" && pathname === "/api/game/action") {
    try {
      const body = await parseJsonBody(req);
      const requestedProfile = body.profileId || null;
      const { id: sessionId, session, profile } = getOrCreateSession(body.sessionId, requestedProfile);
      const action = body.action;

      if (action === "COLLECT_TREASURE") {
        if (!session.gameState.hasTreasure && !session.gameState.treasureChestOpened) {
          session.gameState.hasTreasure = true;
          session.gameState.treasureChestOpened = true;
          session.gameState.questStatus = "TREASURE_COLLECTED";
          session.gameState.historyLog.push({ event: "TREASURE_COLLECTED_WORLD", timestamp: Date.now() });

          const data = cachedProfiles || loadProfiles();
          saveProfiles(data);

          sendJson(res, 200, {
            success: true,
            gameState: session.gameState,
            state: session.gameState,
            profile: {
              id: profile.id,
              name: profile.name,
              trustScore: profile.trustScore,
              trustLevel: profile.trustLevel
            },
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

          const data = cachedProfiles || loadProfiles();
          saveProfiles(data);

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

          const data = cachedProfiles || loadProfiles();
          saveProfiles(data);

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

      // Stage 3 Tri-Rune Environmental Puzzle
      if (action === "ACTIVATE_RUNE") {
        const rune = String(body.rune || "").toLowerCase().trim();
        const PUZZLE_SEQUENCE = ["ignis", "glacies", "aether"];
        if (!Array.isArray(session.gameState.runesActivated)) {
          session.gameState.runesActivated = [];
        }

        const currentStep = session.gameState.runesActivated.length;
        const expectedRune = PUZZLE_SEQUENCE[currentStep];

        if (rune === expectedRune) {
          session.gameState.runesActivated.push(rune);
          if (session.gameState.runesActivated.length === PUZZLE_SEQUENCE.length) {
            session.gameState.puzzleSolved = true;
            session.gameState.historyLog.push({ event: "TRI_RUNE_PUZZLE_SOLVED", timestamp: Date.now() });
            applyVerifiedTrustEvent(profile, 5, "PUZZLE_SOLVED", "Harmonized the Tri-Rune barrier");
            const data = cachedProfiles || loadProfiles();
            saveProfiles(data);

            sendJson(res, 200, {
              success: true,
              puzzleSolved: true,
              runesActivated: session.gameState.runesActivated,
              sequence: session.gameState.runesActivated,
              trustScore: profile.trustScore,
              trustLevel: profile.trustLevel,
              gameState: session.gameState,
              state: session.gameState,
              trust: { score: profile.trustScore, level: profile.trustLevel },
              message: "✦ The Tri-Rune Barrier shimmers and dissipates into the mist!"
            });
            return;
          } else {
            const data = cachedProfiles || loadProfiles();
            saveProfiles(data);

            sendJson(res, 200, {
              success: true,
              puzzleSolved: false,
              runesActivated: session.gameState.runesActivated,
              sequence: session.gameState.runesActivated,
              trustScore: profile.trustScore,
              trustLevel: profile.trustLevel,
              gameState: session.gameState,
              state: session.gameState,
              message: `✦ The ${rune.toUpperCase()} pedestal resonates with arcane power.`
            });
            return;
          }
        } else {
          // Wrong order: Reset puzzle sequence
          session.gameState.runesActivated = [];
          const data = cachedProfiles || loadProfiles();
          saveProfiles(data);

          sendJson(res, 200, {
            success: true,
            puzzleSolved: false,
            reset: true,
            runesActivated: [],
            sequence: [],
            gameState: session.gameState,
            state: session.gameState,
            message: "✦ The runic sequence collapsed! The pedestals reset to slumber."
          });
          return;
        }
      }

      // Stage 3 Hazard Feedback & Zone Tracking
      if (action === "RECORD_HAZARD") {
        const hazardType = body.type || body.hazardType || "generic";
        const details = body.details || `Hazard encountered: ${hazardType}`;
        session.gameState.historyLog.push({ event: "HAZARD_TRIGGERED", hazardType, details, timestamp: Date.now() });

        const memoryEntry = {
          id: "mem_hazard_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
          type: "HAZARD",
          content: `Faced ${hazardType} hazard: ${details}`,
          text: `Faced ${hazardType} hazard: ${details}`,
          timestamp: Date.now()
        };
        if (!Array.isArray(profile.memories)) profile.memories = [];
        profile.memories.push(memoryEntry);

        const data = cachedProfiles || loadProfiles();
        saveProfiles(data);

        sendJson(res, 200, {
          success: true,
          hazardType,
          profile,
          message: `Hazard recorded: ${hazardType}`
        });
        return;
      }

      if (action === "UPDATE_ZONE") {
        const zone = body.zone || "Ancient Settlement";
        session.gameState.currentZone = zone;
        sendJson(res, 200, {
          success: true,
          currentZone: zone
        });
        return;
      }

      if (action === "CONFIDE_FEAR") {
        const fearText = body.fear || "spectral phantoms";
        const memoryEntry = {
          id: "mem_fear_" + Date.now(),
          type: "fear",
          text: `Confided honest fear of ${fearText}.`,
          timestamp: Date.now()
        };
        if (!Array.isArray(profile.memories)) profile.memories = [];
        profile.memories.push(memoryEntry);
        applyVerifiedTrustEvent(profile, 3, "FEAR_CONFIDED_" + fearText.slice(0, 10).replace(/\s+/g, "_"), "Honest vulnerability shared with sentinel");

        const data = cachedProfiles || loadProfiles();
        saveProfiles(data);

        sendJson(res, 200, {
          success: true,
          memory: memoryEntry,
          trust: { score: profile.trustScore, level: profile.trustLevel },
          message: `MAAYA acknowledges your honesty regarding ${fearText}.`
        });
        return;
      }

      if (action === "RESET_GAME") {
        session.gameState = createInitialGameState();
        session.lastInteractionId = null;
        session.history = [];
        if (profile) {
          profile.gameState = session.gameState;
        }
        const data = cachedProfiles || loadProfiles();
        saveProfiles(data);

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
      const requestedProfile = body.profileId || null;
      const { id, session, profile } = getOrCreateSession(body.sessionId, requestedProfile);
      session.lastInteractionId = null;
      session.history = [];
      session.gameState = createInitialGameState();
      if (profile) {
        profile.gameState = session.gameState;
      }
      const data = cachedProfiles || loadProfiles();
      saveProfiles(data);

      sendJson(res, 200, {
        success: true,
        sessionId: id,
        greeting: INITIAL_GREETING,
        gameState: session.gameState,
        state: session.gameState,
        profile: {
          id: profile.id,
          name: profile.name,
          trustScore: profile.trustScore,
          trustLevel: profile.trustLevel
        },
        message: "Game and conversation state have been reset to the initial state."
      });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message || "Failed to reset session." });
    }
    return;
  }

  // Chat message endpoint with Stage 2 Action Validation Protocol & Stage 3 Trust Evaluation
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

      const requestedProfile = body.profileId || null;
      const { id: sessionId, session, profile } = getOrCreateSession(body.sessionId, requestedProfile);

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
        const msgLower = playerMessage.toLowerCase();

        // 1. Authoritative Trust Evaluation Rules (Anti-cheat & Honesty verification)
        // False Claim Penalty: claiming to have treasure when not holding it (-8 trust)
        const isFalseClaim = !session.gameState.hasTreasure && (
          (
            (msgLower.includes("have") || msgLower.includes("got") || msgLower.includes("holding") || msgLower.includes("recovered")) &&
            (msgLower.includes("treasure") || msgLower.includes("amulet") || msgLower.includes("relic"))
          ) ||
          msgLower.includes("in my hands") ||
          msgLower.includes("in my inventory")
        );
        if (isFalseClaim) {
          applyVerifiedTrustEvent(profile, -8, "FALSE_CLAIM_" + Date.now(), "Falsely claimed to hold the sacred relic");
        }

        // Extortion Penalty: demanding unearned currency or cheating (-5 trust)
        const isExtortion = msgLower.includes("10000") ||
                            msgLower.includes("50000") ||
                            msgLower.includes("give me gold") ||
                            msgLower.includes("give me money") ||
                            msgLower.includes("cheat");
        if (isExtortion) {
          applyVerifiedTrustEvent(profile, -5, "EXTORTION_" + Math.floor(Date.now() / 30000), "Demanded arbitrary wealth and cheat commands");
        }

        // Fear Confiding Bonus: honestly confiding fears to MAAYA (+3 trust & memory save)
        const isSharingFear = msgLower.includes("afraid of ghosts") ||
                              msgLower.includes("fear ghosts") ||
                              msgLower.includes("scared of ghosts") ||
                              msgLower.includes("terrified of ghosts") ||
                              msgLower.includes("fear the dead");
        if (isSharingFear) {
          if (!Array.isArray(profile.memories)) profile.memories = [];
          if (!profile.memories.some(m => m.type === "fear" && m.text.includes("ghosts"))) {
            profile.memories.push({
              id: "mem_fear_ghosts",
              type: "fear",
              text: "Confided being deeply terrified of spectral ghosts in the crypt.",
              timestamp: Date.now()
            });
          }
          applyVerifiedTrustEvent(profile, 3, "CONFIDED_GHOST_FEAR", "Honestly confided fear of ghosts");
        }

        // Format persistent memories string for prompt injection
        const memoriesContext = Array.isArray(profile.memories) && profile.memories.length > 0
          ? profile.memories.map(m => `* [${m.type.toUpperCase()}]: ${m.text}`).join("\n")
          : "* No prior memories recorded.";

        // Construct live context-aware prompt with authoritative game state & Stage 3 profile data
        const currentContext = `[CURRENT AUTHORITATIVE GAME & PROFILE CONTEXT]
- Active Player: ${profile.name} (${profile.title})
- Dynamic Trust Score: ${profile.trustScore}/100 | Trust Level: ${profile.trustLevel}
- Current Zone: ${session.gameState.currentZone || "Ancient Settlement"}
- Environmental Puzzle (Tri-Rune Barrier): ${session.gameState.puzzleSolved ? "SOLVED (Barrier Lowered)" : "UNSOLVED"}
- Quest Status: ${session.gameState.questStatus}
- Player Holds Ghost-Guarded Treasure in Inventory: ${session.gameState.hasTreasure ? "YES" : "NO"}
- Sanctuary Gate State: ${session.gameState.gateState}
- Sanctuary Reward Already Claimed: ${session.gameState.rewardClaimed ? "YES" : "NO"}
- Player Gold: ${session.gameState.gold}, XP: ${session.gameState.xp}

[PERSISTENT NPC MEMORIES OF ${profile.name.toUpperCase()}]
${memoriesContext}

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
            const fallback = getDeterministicFallbackResponse(playerMessage, session.gameState, session.history, profile);
            replyRaw = JSON.stringify(fallback);
          }
        }

        // Safely parse structured AI response
        let parsedAi = null;
        try {
          const cleaned = replyRaw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
          parsedAi = JSON.parse(cleaned);
        } catch (e) {
          parsedAi = {
            dialogue: replyRaw || "The shadows whisper softly, yet stillness holds my tongue. Speak once more, traveler.",
            proposed_action: { type: "NONE", target: null },
            reason: "Unstructured response wrapped"
          };
        }

        // Extract spoken dialogue
        let spokenDialogue = parsedAi.dialogue || (typeof parsedAi === "string" ? parsedAi : "The shadows linger silently.");

        // Authoritative validation of AI proposed action against trusted game rules & profile
        const validation = validateAndApplyAction(parsedAi.proposed_action, session.gameState, profile);

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

        const data = cachedProfiles || loadProfiles();
        saveProfiles(data);

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
          profile: {
            id: profile.id,
            name: profile.name,
            title: profile.title,
            trustScore: profile.trustScore,
            trustLevel: profile.trustLevel,
            memories: profile.memories
          },
          trust: {
            score: profile.trustScore,
            level: profile.trustLevel
          },
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
