import { GoogleGenAI, Type } from "@google/genai";

export async function generateFinancialInsights(data: any): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    return [
      "שים לב: הוצאות המזון חרגו ב-20% מהתקציב.",
      "טיפ: מעבר לחברת ביטוח אחרת יכול לחסוך לך 100 ש״ח בחודש.",
      "הכנסות החודש גבוהות ב-5% מהחודש שעבר, כל הכבוד!"
    ];
  }

  try {
    const prompt = `
    אתה יועץ פיננסי חכם למשפחות.
    להלן נתונים פיננסיים של משפחה לחודש הנוכחי:
    ${JSON.stringify(data, null, 2)}
    
    אנא ספק 3 תובנות קצרות וברורות בעברית בלבד (RTL).
    התובנות צריכות להיות מעשיות, למשל: "שים לב: הוצאות ה... חרגו ב-...", "טיפ: ...".
    החזר את התשובה כמערך JSON של מחרוזות (strings).
    `;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
          },
        },
      },
    });

    let text = response.text || "[]";
    // Clean up markdown code blocks if present
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating insights:", error);
    return [
      "שים לב: הוצאות המזון חרגו ב-20% מהתקציב.",
      "טיפ: מעבר לחברת ביטוח אחרת יכול לחסוך לך 100 ש״ח בחודש.",
      "הכנסות החודש גבוהות ב-5% מהחודש שעבר, כל הכבוד!"
    ];
  }
}

export function getFinancialChatSession(data: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "undefined" || apiKey === "") return null;
  
  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `אתה יועץ פיננסי חכם למשפחות, הפועל כעוזר אישי בתוך אפליקציית ניהול תקציב (בסגנון NotebookLM). 
      להלן הנתונים הפיננסיים של המשפחה לחודש הנוכחי:
      ${JSON.stringify(data)}
      
      עליך לענות על שאלות המשתמש לגבי התקציב, ההוצאות, וההכנסות שלו.
      ענה תמיד בעברית. היה מקצועי, אדיב, ותן עצות פרקטיות לחיסכון וניהול נכון.
      התשובות שלך צריכות להיות קצרות וקולעות, מותאמות לתצוגת צ'אט.`,
    }
  });
}
