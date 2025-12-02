import { GoogleGenAI } from "@google/genai";

const getAIClient = () => {
  // Robustly retrieve API Key:
  // 1. Try standard process.env (Node/AI Studio environment)
  // 2. Try import.meta.env (Local Vite environment)
  let apiKey = "";

  try {
    if (typeof process !== "undefined" && process.env?.API_KEY) {
      apiKey = process.env.API_KEY;
    }
  } catch (e) {
    // process is not defined
  }

  if (!apiKey) {
    try {
      // @ts-ignore - Check Vite env if process failed
      if (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_KEY) {
        // @ts-ignore
        apiKey = import.meta.env.VITE_API_KEY;
      }
    } catch (e) {
      // import.meta is not defined
    }
  }
                 
  if (!apiKey) {
    console.error("API Key missing. Please check .env file or environment variables.");
    throw new Error("API Key not found. Please set VITE_API_KEY in .env file.");
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeDrawing = async (base64Image: string): Promise<string> => {
  // Offline check
  if (!navigator.onLine) {
    return "Network Offline: AI analysis requires an internet connection. Drawing features remain active.";
  }

  try {
    const ai = getAIClient();
    // Use gemini-2.5-flash for fast visual analysis
    const modelId = "gemini-2.5-flash";
    
    // Remove header from base64 string if present
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: "image/png",
            },
          },
          {
            text: "You are a holographic interface AI. Briefly describe what is drawn in this image. If it looks like a question, answer it. If it looks like a request, fulfill it creatively. Keep it concise (max 2 sentences).",
          },
        ],
      },
    });

    return response.text || "Could not interpret data.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Connection Error: Unable to reach AI core. Check your API Key in .env file.";
  }
};

export const generateCreativeIdea = async (): Promise<string> => {
    if (!navigator.onLine) return "Draw a Cube (Offline Mode)";

    try {
        const ai = getAIClient();
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Give me a single, short, fun idea for something to draw in the air using a holographic finger-painting app. Just the object name or short phrase.",
        });
        return response.text || "A futuristic city";
    } catch (e) {
        return "A happy robot";
    }
}