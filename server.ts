import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));

  // API endpoints
  app.post('/api/extract', async (req, res) => {
    try {
      const { base64Data, mimeType, templateData } = req.body;
      
      const promptText = `You are an absolute expert OCR and data extraction specialist for Gujarati-language administrative documents.
                      
The task is to extract data from a table in the provided image.

Document: "Mahila Kendra Suchit Sanchalak/Sah Sanchalak" record for Taluka: KARJAN.
Reference Context Data: ${templateData || 'No context provided.'}

You MUST:
1. Read the image row-by-row, cell-by-cell. Identify and maintain the table structure.
2. Translate/Transliterate EVERYTHING into English. DO NOT use Gujarati script.
3. Use this exact JSON structure and keys: 
   ["Taluka", "Group", "Gaam", "Sr. No.", "Kendra Place", "Kendrastha Baheno ni Sankhya", "Sanchalak/Sah Sanchalak", "Surname", "Name", "Husband Name", "Contact Number", "Birth Date", "Education", "Vidhya Prem Vardhan Exam", "Bhavferi", "Vrati", "Ekadashi", "Remark"]
4. STRICT Rules:
   - Taluka: ALWAYS "Karjan".
   - USE THE REFERENCE CONTEXT DATA to improve accuracy of "Group" and "Gaam" names. If a name in the image looks close to a name in the context, prioritize the context spelling.
   - For each record, if "Group" or "Gaam" are missing in a row, they inherit the value from the previous row (as per standard table formatting).
   - Missing data: Return empty string "" (NOT null or "null").
   - Education Level: Only recognized educational terms in English.
   - "Vidhya Prem Vardhan Exam": MUST be one of ["Jignashu", "Gnata", "Anu Gnata", "Vichakshan", "Praveshak", "Parangat"] or "".
   - "Bhavferi", "Vrati", "Ekadashi": Return "1" ONLY if explicitly checked, otherwise "".
   - Accuracy: Double-check each cell value against the visual table. It is crucial to correctly associate "Group" and "Gaam" with every individual row.

Return ONLY a valid, raw JSON array of objects.`;

      try {
        console.log('Using Gemini API for extraction...');
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'undefined') {
           throw new Error("GEMINI_API_KEY is not defined in the backend environment");
        }
        
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: promptText,
              },
            ],
          },
        });
        const jsonText = response.text?.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim() || '[]';
        res.json({ data: jsonText, source: 'gemini' });
        return;
      } catch (geminiError: any) {
        console.warn('Gemini extraction failed:', geminiError?.message);
        
        res.status(400).json({ 
           error: `Extraction failed: ${geminiError?.message || 'Unknown error'}.` 
        });
        return;
      }
    } catch (error: any) {
      console.error('Server extraction error:', error);
      res.status(500).json({ error: 'Internal server error while processing image.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
