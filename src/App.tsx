/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileDown, Loader2, AlertCircle } from 'lucide-react';

interface ExtractedData {
  [key: string]: string | number | null;
}

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [templateData, setTemplateData] = useState<string>('');
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [extractedData, setExtractedData] = useState<ExtractedData[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [apiKey, setApiKey] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles(selectedFiles);
      setImagePreviews(selectedFiles.map((file: File) => URL.createObjectURL(file)));
      setExtractedData([]);
      setError(null);
    }
  };

  const handleTemplateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);
        setTemplateData(JSON.stringify(jsonData));
    };
    reader.readAsArrayBuffer(file);
  };

  const handleCellChange = (rowIndex: number, key: string, value: string) => {
    const newData = [...extractedData];
    newData[rowIndex] = { ...newData[rowIndex], [key]: value };
    setExtractedData(newData);
  };

  const processImages = async () => {
    if (files.length === 0) return;

    setLoading(true);
    setProgress(0);
    setError(null);
    let allData: ExtractedData[] = [];
    
    try {
      if (!apiKey.trim()) {
        throw new Error("Please enter your Gemini API Key.");
      }

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

      for (let i = 0; i < files.length; i++) {
        if (i > 0) {
          // Delay to respect rate limits (e.g. 15 RPM free tier -> wait 5s between requests to be safe)
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        const file = files[i];
        const reader = new FileReader();
        const base64String = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        
        const response = await (async () => {
          let retries = 3;
          while (retries > 0) {
            try {
              const { GoogleGenAI } = await import('@google/genai');
              const genAI = new GoogleGenAI({ apiKey: apiKey.trim() });
              
              const res = await genAI.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: [{
                  parts: [
                    { inlineData: { mimeType: file.type, data: base64String } },
                    { text: promptText },
                  ]
                }]
              });
              
              const jsonText = res.text?.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim() || '[]';
              return { data: jsonText };
            } catch (err: any) {
              console.warn(`Extraction attempt failed (${4 - retries}/3). Retrying in 15 seconds...`, err);
              if (retries > 1) {
                retries--;
                // Wait 15 seconds regardless of error type to be absolutely certain quota buckets refresh
                await new Promise(resolve => setTimeout(resolve, 15000));
                continue;
              }
              throw err;
            }
          }
        })();

        const jsonText = response?.data;
        if (jsonText) {
          try {
            const data = JSON.parse(jsonText);
            allData = [...allData, ...data];
          } catch (e) {
            console.error('Failed to parse json on client:', e, jsonText);
          }
        }
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setExtractedData(allData);
    } catch (err: any) {
      console.error('Final processing error:', err);
      setError(err.message || JSON.stringify(err) || 'Failed to process images. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    if (extractedData.length === 0) return;
    
    // Convert null/undefined to empty string for Excel
    const sanitizedData = extractedData.map(row => {
      const sanitizedRow: any = {};
      Object.keys(row).forEach(key => {
        sanitizedRow[key] = row[key] === null || row[key] === undefined ? "" : row[key];
      });
      return sanitizedRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(sanitizedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    XLSX.writeFile(workbook, 'extracted_data.xlsx');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-12 font-sans text-gray-900">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 mb-2">Gujarati Text to Excel</h1>
        <p className="text-lg text-gray-600">Scan Gujarati documents and convert them to structured Excel data.</p>
      </header>

      <div className="max-w-4xl mx-auto space-y-8">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Google Gemini API Key</label>
            <input 
              type="password"
              placeholder="Paste your API key here..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
            <p className="text-xs text-gray-500 mt-2">Required. Your key is only used locally in your browser and is never stored.</p>
          </div>

          <label className="block w-full cursor-pointer mb-4">
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-6 hover:border-indigo-400 transition-colors">
              <span className="text-sm font-medium text-gray-700">
                {templateData ? 'Reference File Selected' : 'Upload Reference Excel (Templates/Village Names)'}
              </span>
              <input type="file" onChange={handleTemplateFileChange} className="hidden" accept=".xlsx, .xls" />
            </div>
          </label>
          <label className="block w-full cursor-pointer">
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-10 hover:border-indigo-400 transition-colors">
              <Upload className="w-12 h-12 text-gray-400 mb-4" />
              <span className="text-lg font-medium text-gray-700">
                {files.length > 0 ? `${files.length} images selected` : 'Click to upload images'}
              </span>
              <span className="text-sm text-gray-500 mt-1">Select multiple Gujarati document images</span>
              <input type="file" multiple onChange={handleFileChange} className="hidden" accept="image/*" />
            </div>
          </label>
          
          {imagePreviews.length > 0 && (
            <div className="mt-6">
              <div className="grid grid-cols-3 gap-2">
                {imagePreviews.map((src, i) => (
                  <img key={i} src={src} alt={`Preview ${i}`} className="h-32 object-cover rounded-lg" />
                ))}
              </div>
              <button 
                onClick={processImages} 
                disabled={loading}
                className="mt-6 w-full py-3 px-6 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {loading ? (
                  <div className="flex flex-col items-center">
                    <Loader2 className="w-5 h-5 animate-spin mb-2" />
                    <span>Processing ({progress}%)</span>
                    <div className="w-full bg-indigo-800 rounded-full h-2 mt-2">
                       <div className="bg-white h-2 rounded-full" style={{width: `${progress}%`}}></div>
                    </div>
                  </div>
                ) : 'Process Images'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
            <AlertCircle className="w-5 h-5 mr-3" />
            {error}
          </div>
        )}

        {extractedData.length > 0 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 overflow-x-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Extracted Data ({extractedData.length} records)</h2>
              <button 
                onClick={exportToExcel}
                className="flex items-center gap-2 py-2 px-4 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
              >
                <FileDown className="w-5 h-5" />
                Download Excel
              </button>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 text-gray-700 uppercase">
                <tr>
                  {Object.keys(extractedData[0]).map(key => (
                    <th key={key} className="px-4 py-3">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extractedData.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    {Object.keys(extractedData[0]).map((key, j) => (
                      <td key={j} className="px-2 py-2">
                        <input
                          type="text"
                          value={String(row[key] || "")}
                          onChange={(e) => handleCellChange(i, key, e.target.value)}
                          className="w-full bg-transparent border-b border-gray-300 focus:border-indigo-600 focus:outline-none p-1"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
