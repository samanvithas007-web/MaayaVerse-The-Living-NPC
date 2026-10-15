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
        sessionId: sessionId
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
        }
      }
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

  window.resetDialogueUI(INITIAL_GREETING);
  checkHealth();

  // Periodic health check to seamlessly detect when Gemini recovers without restarting
  setInterval(checkHealth, 25000);

  // Start 2D / 3D Game Engine
  if (window.initGameEngine) {
    window.initGameEngine(sessionId);
  }
}

window.addEventListener("DOMContentLoaded", init);
