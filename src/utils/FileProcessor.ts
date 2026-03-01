import { GoogleGenAI, Type } from "@google/genai";

async function getOrCreateFolder(token: string, folderName: string, parentId?: string): Promise<string> {
  const query = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!searchRes.ok) {
    throw new Error(`Failed to search folder: ${folderName}`);
  }
  
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const metadata: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  
  if (!createRes.ok) {
    throw new Error(`Failed to create folder: ${folderName}`);
  }
  
  const createData = await createRes.json();
  return createData.id;
}

async function ensureFolderPath(token: string, assetCategory: string, rootFolderId: string | null): Promise<string> {
  const date = new Date();
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  let currentParentId = rootFolderId;
  
  if (!currentParentId) {
    // If no root folder ID is provided, create/find a default one
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='Family_Finance_Root' and trashed=false")}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        currentParentId = searchData.files[0].id;
      } else {
        currentParentId = await getOrCreateFolder(token, 'Family_Finance_Root');
      }
    } else {
      currentParentId = await getOrCreateFolder(token, 'Family_Finance_Root');
    }
  }

  const yearFolderId = await getOrCreateFolder(token, year, currentParentId);
  const monthFolderId = await getOrCreateFolder(token, month, yearFolderId);
  const categoryFolderId = await getOrCreateFolder(token, assetCategory, monthFolderId);

  return categoryFolderId;
}

async function uploadFile(token: string, file: File, fileName: string, parentId: string) {
  const metadata = {
    name: fileName,
    parents: [parentId]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch('https://upload.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  if (!res.ok) {
    throw new Error('Failed to upload file to Google Drive');
  }
  return res.json();
}

export interface ProcessedData {
  currentBalance: number;
  monthlyContribution: number;
  yieldPercentage: number;
}

export async function parseFinancialReport(file: File, asset: { name: string, type: string }): Promise<ProcessedData> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is missing");
  }
  
  const ai = new GoogleGenAI({ apiKey });
  
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: file.type || 'application/pdf'
        }
      },
      {
        text: `Extract the following financial data from this document for the asset named "${asset.name}" (Category: ${asset.type}).
        If you cannot find the exact value, estimate based on the context or return 0.
        Return ONLY a JSON object with these keys:
        - currentBalance (number): The total current value or balance (שווי נוכחי).
        - monthlyContribution (number): The monthly deposit or contribution amount (הפקדה חודשית).
        - yieldPercentage (number): The yield or return percentage (תשואה).`
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          currentBalance: { type: Type.NUMBER, description: "Current balance / שווי נוכחי" },
          monthlyContribution: { type: Type.NUMBER, description: "Monthly contribution / הפקדה חודשית" },
          yieldPercentage: { type: Type.NUMBER, description: "Yield percentage / תשואה" }
        },
        required: ["currentBalance", "monthlyContribution", "yieldPercentage"]
      }
    }
  });

  const text = response.text;
  if (text) {
    return JSON.parse(text);
  }
  throw new Error("Failed to extract data from document");
}

export async function autoFileAndSync(
  file: File, 
  asset: { name: string, type: string }, 
  token: string, 
  rootFolderId: string | null
): Promise<void> {
  const categoryFolderId = await ensureFolderPath(token, asset.type, rootFolderId);
  
  const date = new Date();
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const extension = file.name.split('.').pop() || 'pdf';
  const newFileName = `${asset.name}_Report_${dd}-${mm}-${yyyy}.${extension}`;
  
  await uploadFile(token, file, newFileName, categoryFolderId);
}
