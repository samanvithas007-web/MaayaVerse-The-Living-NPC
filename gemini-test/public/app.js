// MaayaVerse: The Living NPC — Stage 2 Client Application (app.js)
const INITIAL_GREETING = "Step carefully, traveler. You stand before the restricted wing of Blackwood Manor, where shadows remember what the living have long forgotten. I am MAAYA, sentinel of these sealed halls. What curiosity—or foolishness—compels you to disturb my vigil?";

// DOM Elements
const messagesContainer = document.getElementById("messagesContainer");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const charCount = document.getElementById("charCount");
const resetBtn = document.getElementById("resetBtn");
const thinkingIndicator = document.getElementById("thinkingIndicator");
const errorBanner = document.getElementById("errorBanner");
const errorMessage = document.getElementById("errorMessage");
const dismissErrorBtn = document.getElementById("dismissErrorBtn");
const interactionCounter = document.getElementById("interactionCounter");
const promptChips = document.querySelectorAll(".prompt-chip");
const statusPill = document.getElementById("statusPill");

// State
let sessionId = sessionStorage.getItem("cognitive_npc_session_id") || null;
let isSubmitting = false;
let turnCount = 0;
let activeProfileId = sessionStorage.getItem("cognitive_npc_profile_id") || "player1";

// Format timestamp helper
function getTimestamp() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Format message text with safe paragraph breaks
function formatMessageText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/\n\n+/g, "<br><br>").replace(/\n/g, "<br>");
}

// Append a message to the chat container
function appendMessage(role, text, animated = false) {
  const isNpc = role === "npc";
  const row = document.createElement("div");
  row.className = `message-row ${isNpc ? "npc" : "player"}`;

  const avatar = document.createElement("div");
  avatar.className = `msg-avatar ${isNpc ? "npc-avatar" : "player-avatar"}`;
  
  if (isNpc) {
    const img = document.createElement("img");
    img.src = "maaya-avatar.svg";
    img.alt = "MAAYA";
    avatar.appendChild(img);
  } else {
    avatar.textContent = "YOU";
  }

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg-content-wrapper";

  const authorBar = document.createElement("div");
  authorBar.className = "msg-author-bar";

  const authorName = document.createElement("span");
  authorName.className = "msg-author";
  authorName.textContent = isNpc ? "MAAYA" : "Traveler";

  const timeSpan = document.createElement("span");
  timeSpan.className = "msg-timestamp";
  timeSpan.textContent = getTimestamp();

  authorBar.appendChild(authorName);
  authorBar.appendChild(timeSpan);

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  contentWrap.appendChild(authorBar);
  contentWrap.appendChild(bubble);

  row.appendChild(avatar);
  row.appendChild(contentWrap);

  messagesContainer.appendChild(row);
  scrollToBottom();

  if (animated && isNpc) {
    let index = 0;
    const speed = 12; // Fast, responsive typewriter
    const interval = setInterval(() => {
      index += 2;
      bubble.innerHTML = formatMessageText(text.slice(0, index));
      scrollToBottom();
      if (index >= text.length) {
        clearInterval(interval);
        bubble.innerHTML = formatMessageText(text);
      }
    }, speed);
  } else {
    bubble.innerHTML = formatMessageText(text);
  }
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setSubmitting(submitting) {
  isSubmitting = submitting;
  messageInput.disabled = submitting;
  sendBtn.disabled = submitting;

  if (submitting) {
    sendBtn.classList.add("btn-loading");
    sendBtn.setAttribute("aria-busy", "true");
    promptChips.forEach((chip) => {
      chip.setAttribute("disabled", "true");
      chip.classList.add("disabled");
    });
    thinkingIndicator.style.display = "flex";
    if (window.MaayaGame) window.MaayaGame.setMaayaThinking(true);
    scrollToBottom();
  } else {
    sendBtn.classList.remove("btn-loading");
    sendBtn.removeAttribute("aria-busy");
    promptChips.forEach((chip) => {
      chip.removeAttribute("disabled");
      chip.classList.remove("disabled");
    });
    thinkingIndicator.style.display = "none";
    if (window.MaayaGame && window.MaayaGame.isDialogueOpen && window.MaayaGame.isDialogueOpen()) {
      messageInput.focus();
    }
  }
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.style.display = "flex";
  scrollToBottom();
}

function hideError() {
  errorBanner.style.display = "none";
}

function updateCharCount() {
  const len = messageInput.value.length;
  charCount.textContent = `${len}/1000`;
}

function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + "px";
}

// Reset UI helper
window.resetDialogueUI = function (greetingText) {
  messagesContainer.innerHTML = "";
  turnCount = 0;
  if (interactionCounter) interactionCounter.textContent = `Turn: ${turnCount}`;
  appendMessage("npc", greetingText || INITIAL_GREETING, false);
  messageInput.value = "";
  updateCharCount();
  autoResizeTextarea();
};

// Reset conversation & game state
async function resetConversation() {
  hideError();
  const confirmed = confirm("Are you sure you wish to restart your game session with MAAYA? This will restore the world and clear quest memory.");
  if (!confirmed) return;

  if (window.MaayaGame && window.MaayaGame.resetGame) {
    await window.MaayaGame.resetGame();
  } else {
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      if (data.sessionId) {
        sessionId = data.sessionId;
        sessionStorage.setItem("cognitive_npc_session_id", sessionId);
      }
      window.resetDialogueUI(data.greeting);
    } catch (err) {
      console.error("Failed to reset conversation:", err);
      showError("Could not reset the vigil. Please check connection.");
    }
  }
}

// Send message to backend with Stage 2 Action Integration
async function sendMessage(textToSend) {
  const text = (textToSend || messageInput.value).trim();
  if (!text || isSubmitting) return;

  hideError();

  // Add player message immediately
  appendMessage("player", text, false);
  messageInput.value = "";
  updateCharCount();
  autoResizeTextarea();
  setSubmitting(true);

  turnCount++;
  if (interactionCounter) interactionCounter.textContent = `Turn: ${turnCount}`;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: sessionId,
        profileId: activeProfileId
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to receive guardian's response.");
    }

    if (data.sessionId) {
      sessionId = data.sessionId;
      sessionStorage.setItem("cognitive_npc_session_id", sessionId);
    }

    // Add NPC response with dynamic typewriter rendering
    appendMessage("npc", data.reply, true);

    // Update Profile and Trust UI
    if (data.profile) {
      updateProfileUI(data.profile);
    }

    // Synchronize and execute validated game actions
    if (window.MaayaGame) {
      if (data.gameState) {
        window.MaayaGame.syncServerState(data.gameState);
      }

      if (data.action_applied && data.validated_action) {
        const actionType = data.validated_action.type;
        if (actionType === "OPEN_GATE") {
          window.MaayaGame.executeGateOpeningSequence();
        } else if (actionType === "ACCEPT_QUEST") {
          window.MaayaGame.showNotification("✦ Quest Accepted: Brave the east crypt and retrieve the Amulet!");
          window.MaayaGame.playSound("fanfare");
        } else if (actionType === "RETURN_TREASURE") {
          window.MaayaGame.showNotification("✦ Sacred Amulet presented to MAAYA! The seal may now be opened.");
          window.MaayaGame.playSound("fanfare");
        } else if (actionType === "CONFIDE_FEAR") {
          window.MaayaGame.showNotification("✦ Confided fears to MAAYA: +3 Trust! Her tone softens with empathy.");
          window.MaayaGame.playSound("chime");
        } else if (actionType === "RECORD_HAZARD") {
          window.MaayaGame.showNotification("✦ Hazard noted by MAAYA in memory.");
        }
      }
    }

    // Refresh Inspector
    if (window.updateInspectorPanel) {
      window.updateInspectorPanel();
    }

    // Reflect fallback or live Gemini AI status on the UI indicator
    if (statusPill) {
      const label = statusPill.querySelector(".status-label");
      if (data.fallbackActive) {
        statusPill.classList.add("status-fallback");
        if (label) label.textContent = "Living NPC Active (Guardian Vigil)";
        statusPill.title = `Guardian Vigil Engine Active (Fallback mode: ${data.fallbackReason || "resilient"})`;
      } else {
        statusPill.classList.remove("status-fallback");
        if (label) label.textContent = "Living NPC Active (Gemini)";
        statusPill.title = "Living Cognitive NPC Active (Gemini API)";
      }
    }
  } catch (err) {
    console.error("Error communicating with NPC:", err);
    // Display friendly, in-world error message without exposing technical details or secrets
    showError("MAAYA's voice was momentarily lost to the shadows. Speak again, traveler.");
  } finally {
    setSubmitting(false);
  }
}

// Event Listeners
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (isSubmitting) return;
  sendMessage();
});

messageInput.addEventListener("input", () => {
  updateCharCount();
  autoResizeTextarea();
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isSubmitting) {
      sendMessage();
    }
  }
});

if (resetBtn) resetBtn.addEventListener("click", resetConversation);

if (dismissErrorBtn) dismissErrorBtn.addEventListener("click", hideError);

promptChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (isSubmitting) return;
    const text = chip.getAttribute("data-text");
    if (text) {
      sendMessage(text);
    }
  });
});

// --- STAGE 3: PROFILE SWITCHING, DYNAMIC TRUST & INSPECTOR PANEL ---
function updateProfileUI(profile) {
  if (!profile) return;
  activeProfileId = profile.id;
  sessionStorage.setItem("cognitive_npc_profile_id", activeProfileId);

  // Update profile buttons in top header
  document.querySelectorAll(".btn-profile").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-profile-id") === profile.id);
  });

  // Update HUD elements
  const hudBadge = document.getElementById("hudProfileBadge");
  const hudTrustScore = document.getElementById("hudTrustScore");
  const hudTrustLevel = document.getElementById("hudTrustLevel");
  const dialogueTrustLabel = document.getElementById("dialogueTrustLabel");

  if (hudBadge) hudBadge.textContent = `${profile.name} (${profile.archetype})`;
  if (hudTrustScore) hudTrustScore.textContent = `${profile.trustScore}/100`;
  if (hudTrustLevel) {
    hudTrustLevel.textContent = profile.trustLevel;
    hudTrustLevel.className = `status-tag badge-trust-${(profile.trustLevel || 'neutral').toLowerCase()}`;
  }
  if (dialogueTrustLabel) {
    dialogueTrustLabel.textContent = `${profile.trustLevel} (${profile.trustScore}/100)`;
  }
}

async function selectProfile(profileId) {
  if (isSubmitting) return;
  activeProfileId = profileId;
  sessionStorage.setItem("cognitive_npc_profile_id", profileId);

  document.querySelectorAll(".btn-profile").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-profile-id") === profileId);
  });

  if (window.MaayaGame && window.MaayaGame.selectProfile) {
    const data = await window.MaayaGame.selectProfile(profileId);
    if (data && data.profile) {
      updateProfileUI(data.profile);
    }
  } else {
    try {
      const res = await fetch("/api/profile/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, sessionId })
      });
      const data = await res.json();
      if (data.profile) {
        updateProfileUI(data.profile);
        window.resetDialogueUI(data.greeting);
      }
    } catch (e) {
      console.error("Profile selection failed:", e);
    }
  }
  window.updateInspectorPanel();
}

async function resetActiveProfile() {
  const confirmed = confirm("Reset active profile memory, trust, and interactions back to pristine default?");
  if (!confirmed) return;
  try {
    const res = await fetch("/api/profile/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: activeProfileId, sessionId })
    });
    const data = await res.json();
    if (data.success && data.profile) {
      updateProfileUI(data.profile);
      window.resetDialogueUI(data.greeting);
      if (window.MaayaGame && window.MaayaGame.showNotification) {
        window.MaayaGame.showNotification(`↺ Reset Profile ${data.profile.name} to default state.`);
      }
      window.updateInspectorPanel();
    }
  } catch (e) {
    console.error("Failed to reset profile:", e);
  }
}

function toggleInspector(open) {
  const drawer = document.getElementById("inspectorDrawer");
  if (!drawer) return;
  if (open === undefined) {
    drawer.classList.toggle("open");
  } else if (open) {
    drawer.classList.add("open");
  } else {
    drawer.classList.remove("open");
  }
  if (drawer.classList.contains("open")) {
    window.updateInspectorPanel();
  }
}

window.updateInspectorPanel = async function () {
  try {
    const res = await fetch("/api/profiles");
    if (!res.ok) return;
    const data = await res.json();
    const active = data.profiles ? data.profiles[data.activeProfileId || activeProfileId] : null;

    if (active) {
      updateProfileUI(active);

      // Inspector Profile & Trust
      const inspBadge = document.getElementById("inspectorProfileBadge");
      const inspName = document.getElementById("inspectorProfileName");
      const inspArchetype = document.getElementById("inspectorProfileArchetype");
      const inspScoreText = document.getElementById("inspectorTrustScoreText");
      const inspFill = document.getElementById("inspectorTrustFill");

      if (inspBadge) {
        inspBadge.textContent = `${active.trustLevel} (${active.trustScore}/100)`;
        inspBadge.className = `status-tag badge-trust-${(active.trustLevel || 'neutral').toLowerCase()}`;
      }
      if (inspName) inspName.textContent = active.name;
      if (inspArchetype) inspArchetype.textContent = active.archetype;
      if (inspScoreText) inspScoreText.textContent = `${active.trustScore} / 100`;
      if (inspFill) {
        inspFill.style.width = `${Math.max(0, Math.min(100, active.trustScore))}%`;
        inspFill.className = `trust-meter-fill fill-${(active.trustLevel || 'neutral').toLowerCase()}`;
      }

      // Memory Logs
      const memList = document.getElementById("inspectorMemoriesList");
      const memCount = document.getElementById("inspectorMemoryCount");
      if (memCount) memCount.textContent = `${(active.memories || []).length} Stored`;

      if (memList && active.memories) {
        memList.innerHTML = active.memories.slice().reverse().map(m => {
          const typeClass = (m.type || 'event').toLowerCase();
          const d = new Date(m.timestamp);
          const timeStr = !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
          return `
            <div class="memory-log-card">
              <div class="mem-meta">
                <span class="mem-tag mem-tag-${typeClass}">[${m.type || 'EVENT'}]</span>
                <span class="mem-time">${timeStr}</span>
              </div>
              <div class="mem-content">${m.content || m.summary || ''}</div>
            </div>
          `;
        }).join('');
      }
    }

    // Puzzle & Game State
    const gameState = window.MaayaGame && window.MaayaGame.getGameState ? window.MaayaGame.getGameState() : null;
    if (gameState) {
      const runes = gameState.runesActivated || [];
      const ignisPill = document.getElementById("runePillIgnis");
      const glaciesPill = document.getElementById("runePillGlacies");
      const aetherPill = document.getElementById("runePillAether");
      const barrierBadge = document.getElementById("inspectorBarrierBadge");

      if (ignisPill) {
        const has = runes.includes("ignis");
        ignisPill.textContent = has ? "Awakened (1)" : "Inactive";
        ignisPill.className = `rune-pill ${has ? 'active' : ''}`;
      }
      if (glaciesPill) {
        const has = runes.includes("glacies");
        glaciesPill.textContent = has ? "Awakened (2)" : "Inactive";
        glaciesPill.className = `rune-pill ${has ? 'active' : ''}`;
      }
      if (aetherPill) {
        const has = runes.includes("aether");
        aetherPill.textContent = has ? "Awakened (3)" : "Inactive";
        aetherPill.className = `rune-pill ${has ? 'active' : ''}`;
      }
      if (barrierBadge) {
        if (gameState.puzzleSolved) {
          barrierBadge.textContent = "Barrier Dissolved";
          barrierBadge.className = "status-tag badge-completed";
        } else {
          barrierBadge.textContent = "Barrier Locked";
          barrierBadge.className = "status-tag badge-alert";
        }
      }

      const inspZone = document.getElementById("inspectorCurrentZone");
      if (inspZone) inspZone.textContent = gameState.currentZone || "Courtyard of the Gate";
    }
  } catch (err) {
    console.warn("Inspector sync error:", err);
  }
};

// Check Server Health on Load and detect when API becomes available again
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      if (statusPill) {
        const label = statusPill.querySelector(".status-label");
        if (data.apiStatus === "active") {
          statusPill.classList.remove("status-fallback");
          if (label) label.textContent = "Living NPC Active (Gemini)";
          statusPill.title = `Model: ${data.activeModel || data.primaryModel} | Character: ${data.character} | AI Online`;
        } else {
          statusPill.classList.add("status-fallback");
          if (label) label.textContent = "Living NPC Active (Guardian Vigil)";
          statusPill.title = `Character: ${data.character} | Vigil Fallback Active (${data.apiStatus})`;
        }
      }
    }
  } catch (e) {
    console.warn("Health check unreachable:", e);
  }
}

// Initialize
function init() {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem("cognitive_npc_session_id", sessionId);
  }

  // Bind profile switcher buttons
  document.querySelectorAll(".btn-profile").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-profile-id");
      if (pid) selectProfile(pid);
    });
  });

  // Bind Inspector toggle buttons
  const toggleInspectorBtn = document.getElementById("toggleInspectorBtn");
  const closeInspectorBtn = document.getElementById("closeInspectorBtn");
  if (toggleInspectorBtn) toggleInspectorBtn.addEventListener("click", () => toggleInspector());
  if (closeInspectorBtn) closeInspectorBtn.addEventListener("click", () => toggleInspector(false));

  const resetActiveProfileBtn = document.getElementById("resetActiveProfileBtn");
  if (resetActiveProfileBtn) resetActiveProfileBtn.addEventListener("click", resetActiveProfile);

  window.resetDialogueUI(INITIAL_GREETING);
  checkHealth();

  // Periodic health check to seamlessly detect when Gemini recovers without restarting
  setInterval(checkHealth, 25000);

  // Initial fetch of profiles to sync UI
  fetch("/api/profiles").then(r => r.json()).then(data => {
    if (data.profiles && data.activeProfileId) {
      activeProfileId = data.activeProfileId;
      updateProfileUI(data.profiles[activeProfileId]);
      window.updateInspectorPanel();
    }
  }).catch(() => {});

  // Start 2D / 3D Game Engine
  if (window.initGameEngine) {
    window.initGameEngine(sessionId);
  }
}

window.addEventListener("DOMContentLoaded", init);
