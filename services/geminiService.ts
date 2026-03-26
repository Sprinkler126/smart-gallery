import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysisResult } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to convert an image URL to a Base64 string
// Note: This requires the server serving the image to allow CORS
async function urlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const analyzeImage = async (imageUrl: string, title: string): Promise<AIAnalysisResult> => {
  try {
    const base64Data = await urlToBase64(imageUrl);

    const prompt = `
      Analyze this photograph titled "${title}". 
      Please provide:
      1. A poetic description of the visual content and atmosphere.
      2. Technical feedback on composition, lighting, and color grading.
      3. Three words that describe the mood.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg', // Assuming jpeg for simplicity, or detect from url
              data: base64Data
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            technicalFeedback: { type: Type.STRING },
            mood: { type: Type.STRING }
          },
          required: ["description", "technicalFeedback", "mood"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as AIAnalysisResult;

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};