import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

console.log("1. Test program started");

const key = process.env.GEMINI_API_KEY;

if (!key) {
  console.error("ERROR: API key missing from .env");
  process.exit(1);
}

console.log("2. API key found");

const ai = new GoogleGenAI({ apiKey: key });

async function main() {
  console.log("3. Sending request to Gemini Interactions API...");

  const response = await ai.interactions.create({
    model: "gemini-3.5-flash",
    input: "Reply with exactly: Hello, NPC test successful!"
  });

  console.log("4. Response received");
  console.log(response.output_text);
}

main().catch((error) => {
  console.error("API ERROR:", error.message || error);
});
