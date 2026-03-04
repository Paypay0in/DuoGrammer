import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Upload, Image as ImageIcon, Loader2, BookOpen, History, Trash2, ChevronRight, ChevronDown, Sparkles, Mic, MicOff, Volume2, VolumeX, Search, X, ClipboardCheck, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Type } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AnalysisResult {
  id: string;
  image?: string; // Optional to avoid retention
  title: string;
  explanation: string;
  lessonText: string;
  vocabulary: string[];
  grammar: string;
  practicePrompt: string;
  timestamp: number;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface WorksheetQuestion {
  question: string;
  type: 'multiple-choice' | 'fill-in-the-blank' | 'translation';
  options?: string[];
  correctAnswer: string;
}

interface GlobalSummaryData {
  content: string;
  timestamp: number;
  worksheet: WorksheetQuestion[];
  userAnswers?: string[];
  feedback?: string;
  score?: number;
}

// Extend Window interface for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>(() => {
    const saved = localStorage.getItem('duo_grammar_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'study' | 'practice' | 'summary'>('study');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [isSlowMode, setIsSlowMode] = useState(false);
  const [globalSummary, setGlobalSummary] = useState<GlobalSummaryData | null>(() => {
    const saved = localStorage.getItem('duo_grammar_summary_v2');
    return saved ? JSON.parse(saved) : null;
  });
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [worksheetAnswers, setWorksheetAnswers] = useState<string[]>([]);
  const [worksheetHistory, setWorksheetHistory] = useState<any[]>(() => {
    const saved = localStorage.getItem('duo_worksheet_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [unitChatMessages, setUnitChatMessages] = useState<Record<string, ChatMessage[]>>(() => {
    const saved = localStorage.getItem('duo_grammar_unit_chats');
    return saved ? JSON.parse(saved) : {};
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isUnitChatting, setIsUnitChatting] = useState<Record<string, boolean>>({});
  const [unitInput, setUnitInput] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('duo_grammar_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('duo_grammar_unit_chats', JSON.stringify(unitChatMessages));
  }, [unitChatMessages]);

  useEffect(() => {
    if (globalSummary) {
      localStorage.setItem('duo_grammar_summary_v2', JSON.stringify(globalSummary));
    } else {
      localStorage.removeItem('duo_grammar_summary_v2');
    }
  }, [globalSummary]);

  useEffect(() => {
    localStorage.setItem('duo_worksheet_history', JSON.stringify(worksheetHistory));
  }, [worksheetHistory]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'fr-FR';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setUserInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setUserInput('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const speakText = (text: string, force = false) => {
    if (!isAutoSpeak && !force) return;
    
    console.log("Speaking text:", text.substring(0, 50));
    
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = isSlowMode ? 0.6 : 0.95; 
      utterance.pitch = 1.0;
      
      // Try to find a nice French voice
      const voices = window.speechSynthesis.getVoices();
      const frenchVoice = voices.find(v => v.lang.startsWith('fr') && v.name.includes('Google')) 
                        || voices.find(v => v.lang.startsWith('fr'))
                        || voices[0];
      
      if (frenchVoice) {
        utterance.voice = frenchVoice;
      }
      
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Speech synthesis failed:", error);
    }
  };

  const generateGlobalSummary = async () => {
    if (history.length === 0) return;
    setGlobalSummary(null);
    setWorksheetAnswers([]);
    setIsGeneratingSummary(true);
    setActiveTab('summary');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const allData = history.map((item, i) => 
        `Unit ${i + 1}: ${item.title}\nText: ${item.lessonText}\nGrammar: ${item.grammar}\nVocab: ${item.vocabulary.join(', ')}`
      ).join('\n\n---\n\n');

      const historyContext = worksheetHistory.length > 0 
        ? `學生之前的學習單表現：\n${worksheetHistory.map(h => `- 分數: ${h.score}/100, 反饋: ${h.feedback}`).join('\n')}\n請特別針對學生之前答錯或不熟悉的觀念進行加強。`
        : "";

      const prompt = `
        你是一個頂尖的法文教學專家，專門輔導學生通過 TCF Canada 考試。
        學生目前已經學習了多個 Duolingo 單元，目標是將這些基礎知識轉化為 TCF Canada 考試所需的實戰能力。
        
        請幫學生將以下所有單元的知識進行「深度系統化統整」，並出一份「TCF Canada 模擬練習學習單」。
        
        ${historyContext}

        學習內容如下：
        ${allData}

        請回傳 JSON 格式，包含以下欄位：
        1. "content": 深度系統化複習筆記（Markdown 格式）。
           要求：
           - 內容必須豐富詳盡，不能過於簡略。
           - 包含「核心文法表格」、「高頻單字與 TCF 常考語境」、「易混淆點深度解析」。
           - 增加「TCF Canada 備考建議」章節，針對目前學習的內容提供考試技巧。
           - 使用豐富的 Markdown 格式（粗體、列表、引用、表格）。
        2. "worksheet": 包含 8 題練習題的陣列。
           要求：
           - 題目設計必須參考 TCF Canada 的題型（例如：Structure de la langue 語法結構、Compréhension écrite 閱讀理解）。
           - 難度應涵蓋 A1 到 B2（視學習內容而定）。
           - 每題包含 "question" (題目), "type" (multiple-choice, fill-in-the-blank, translation), "options" (如果是選擇題), "correctAnswer" (正確答案)。
        
        注意：
        - 筆記要包含產出時間：${new Date().toLocaleString()}。
        - 務必回傳純 JSON。
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              content: { type: Type.STRING },
              worksheet: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    type: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING }
                  },
                  required: ["question", "type", "correctAnswer"]
                }
              }
            },
            required: ["content", "worksheet"]
          }
        }
      });

      const data = JSON.parse(response.text || "{}");
      setGlobalSummary({
        content: data.content,
        timestamp: Date.now(),
        worksheet: data.worksheet
      });
      setWorksheetAnswers(new Array(data.worksheet.length).fill(''));
    } catch (error) {
      console.error("Summary generation failed:", error);
      alert("生成總結時發生錯誤，請稍後再試。");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const gradeWorksheet = async () => {
    if (!globalSummary || worksheetAnswers.some(a => !a.trim())) {
      alert("請完成所有題目後再送出。");
      return;
    }

    setIsGrading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const prompt = `
        你是一個資深的 TCF Canada 考官與法文老師。請批改學生的學習單。
        
        題目與正確答案：
        ${globalSummary.worksheet.map((q, i) => `${i+1}. ${q.question}\n正確答案: ${q.correctAnswer}`).join('\n')}
        
        學生的回答：
        ${worksheetAnswers.map((a, i) => `${i+1}. ${a}`).join('\n')}
        
        請給出：
        1. 總分 (0-100)。
        2. 每題的詳細批改建議與解析，並指出該題對應的 TCF Canada 考點。
        3. 針對 TCF Canada 考試的整體學習建議與弱點加強方案。
        
        請回傳 JSON 格式：
        {
          "score": 80,
          "feedback": "Markdown 格式的詳細批改與建議"
        }
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              feedback: { type: Type.STRING }
            },
            required: ["score", "feedback"]
          }
        }
      });

      const data = JSON.parse(response.text || "{}");
      
      const updatedSummary = {
        ...globalSummary,
        userAnswers: worksheetAnswers,
        feedback: data.feedback,
        score: data.score
      };
      
      setGlobalSummary(updatedSummary);
      setWorksheetHistory(prev => [{
        timestamp: Date.now(),
        score: data.score,
        feedback: data.feedback
      }, ...prev].slice(0, 10)); // Keep last 10
      
    } catch (error) {
      console.error("Grading failed:", error);
      alert("批改失敗，請稍後再試。");
    } finally {
      setIsGrading(false);
    }
  };

  const resizeImage = (file: File, maxWidth = 640, maxHeight = 640): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const safeJsonParse = (str: string, fallback: any = []) => {
    if (!str) return fallback;
    
    try {
      // 1. Try to find JSON content between markdown blocks or just the first { and last }
      let jsonStr = str.trim();
      
      // Remove markdown code blocks if present
      jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      
      const firstBrace = jsonStr.indexOf('{');
      const firstBracket = jsonStr.indexOf('[');
      const lastBrace = jsonStr.lastIndexOf('}');
      const lastBracket = jsonStr.lastIndexOf(']');
      
      let start = -1;
      let end = -1;
      
      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        start = firstBrace;
        end = lastBrace;
      } else if (firstBracket !== -1) {
        start = firstBracket;
        end = lastBracket;
      }
      
      if (start !== -1 && end !== -1 && end > start) {
        jsonStr = jsonStr.substring(start, end + 1);
      }

      // 2. Clean up common AI formatting issues
      // Replace unescaped newlines in strings
      const cleaned = jsonStr
        .replace(/\n/g, " ") 
        .replace(/\\n/g, "\\n")
        .replace(/\\'/g, "'")
        .trim();
        
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn("Standard JSON parse failed, attempting recovery...", e);
      
      try {
        // More aggressive: strip everything that's not a valid JSON character or escape
        let jsonStr = str.trim();
        const start = Math.min(
          jsonStr.indexOf('{') === -1 ? Infinity : jsonStr.indexOf('{'),
          jsonStr.indexOf('[') === -1 ? Infinity : jsonStr.indexOf('[')
        );
        const end = Math.max(jsonStr.lastIndexOf('}'), jsonStr.lastIndexOf(']'));
        
        if (start !== Infinity && end !== -1 && end > start) {
          jsonStr = jsonStr.substring(start, end + 1);
        }
        
        // Remove control characters and fix common escape issues
        const sanitized = jsonStr
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") 
          .replace(/\\(?![bfnrtu"\\\/]|u[0-9a-fA-F]{4})/g, '');
        
        return JSON.parse(sanitized);
      } catch (e2) {
        console.error("JSON Recovery failed:", e2);
        return fallback;
      }
    }
  };

  const updateHistoryWithResults = (results: any[], firstImage: string) => {
    setHistory(prev => {
      let newHistory = [...prev];
      results.forEach((res: any) => {
        const existingIndex = newHistory.findIndex(h => h.title === res.mergeWithExistingTitle);
        
        const newResult: AnalysisResult = {
          id: existingIndex !== -1 ? newHistory[existingIndex].id : crypto.randomUUID(),
          title: res.title,
          explanation: res.fullMarkdown,
          lessonText: res.lessonText,
          vocabulary: res.vocabulary,
          grammar: res.grammar,
          practicePrompt: res.practicePrompt,
          timestamp: Date.now(),
        };

        if (existingIndex !== -1) {
          newHistory[existingIndex] = newResult;
        } else {
          newHistory = [newResult, ...newHistory];
        }
      });
      return newHistory;
    });

    if (results.length > 0) {
      const firstRes = results[0];
      const displayResult: AnalysisResult = {
        id: crypto.randomUUID(),
        image: firstImage,
        title: firstRes.title,
        explanation: firstRes.fullMarkdown,
        lessonText: firstRes.lessonText,
        vocabulary: firstRes.vocabulary,
        grammar: firstRes.grammar,
        practicePrompt: firstRes.practicePrompt,
        timestamp: Date.now(),
      };
      setCurrentAnalysis(displayResult);
      setImage(displayResult.image || null);
      setChatMessages([{ role: 'model', text: displayResult.practicePrompt }]);
      speakText(displayResult.practicePrompt);
    }
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisProgress({ current: 0, total: fileArray.length });
    setActiveTab('study');

    const callWithRetry = async (fn: () => Promise<any>, retries = 4, delay = 3000) => {
      for (let i = 0; i < retries; i++) {
        try {
          return await fn();
        } catch (err: any) {
          const isRateLimit = err?.message?.includes('429') || err?.status === 429 || err?.message?.includes('quota');
          if (i === retries - 1) throw err;
          
          // If it's a rate limit error, wait significantly longer
          const waitTime = isRateLimit ? (i + 1) * 10000 : delay * (i + 1);
          console.warn(`API call failed (${isRateLimit ? 'Rate Limit' : 'Error'}), retrying in ${waitTime}ms (${i + 1}/${retries})...`, err);
          await new Promise(r => setTimeout(r, waitTime));
        }
      }
    };

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      
      // Use gemini-2.5-flash for extraction as it might have different quota limits
      const extractionModel = "gemini-2.5-flash";
      const consolidationModel = "gemini-3-flash-preview";
      
      const allExtractedResults: any[] = [];
      const base64List: string[] = [];

      // If 20 or fewer images, do it in ONE SINGLE PASS to save API calls and avoid rate limits
      if (fileArray.length <= 20) {
        const chunkBase64: string[] = [];
        for (let j = 0; j < fileArray.length; j++) {
          setAnalysisProgress({ current: j + 1, total: fileArray.length + 1 });
          const resized = await resizeImage(fileArray[j]);
          chunkBase64.push(resized);
          if (j === 0) base64List.push(resized);
        }

        const imageParts = chunkBase64.map(base64 => ({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64.split(',')[1],
          },
        }));

        const singlePassPrompt = `
          你是一個頂尖的法文教學專家。請分析這組 Duolingo 截圖（共 ${fileArray.length} 張）並整理成一個系統化的學習單元。
          
          任務：
          1. **深度提取**：請仔細掃描所有圖片，提取所有對話、句子、生字與語法點。
          2. **專業解析**：提供詳細的文法解釋（包含 Markdown 表格）。
          3. **格式要求**：務必回傳純 JSON 陣列，不要有 Markdown 區塊。
          
          回傳格式：
          [
            {
              "title": "單元標題",
              "lessonText": "完整法文原文",
              "vocabulary": ["單字 - 解釋 - 例句"],
              "grammar": "核心文法摘要",
              "practicePrompt": "口語練習開場白",
              "fullMarkdown": "# 學習筆記\\n\\n## 📝 課文原文\\n...\\n\\n## 💡 文法解析\\n...",
              "mergeWithExistingTitle": ""
            }
          ]
        `;

        const response = await callWithRetry(() => ai.models.generateContent({
          model: consolidationModel,
          contents: { parts: [...imageParts, { text: singlePassPrompt }] },
          config: { responseMimeType: "application/json" }
        }));

        setAnalysisProgress({ current: fileArray.length + 1, total: fileArray.length + 1 });
        const results = safeJsonParse(response.text || "[]", []);
        
        if (results.length > 0) {
          updateHistoryWithResults(results, base64List[0]);
        }
        return;
      }

      // For extremely large batches (> 20), use chunking
      const CHUNK_SIZE = 10;
      for (let i = 0; i < fileArray.length; i += CHUNK_SIZE) {
        if (i > 0) await new Promise(r => setTimeout(r, 4000));
        
        const chunk = fileArray.slice(i, i + CHUNK_SIZE);
        const chunkBase64: string[] = [];
        
        for (let j = 0; j < chunk.length; j++) {
          const currentIdx = i + j;
          setAnalysisProgress({ current: currentIdx + 1, total: fileArray.length + 1 });
          const resized = await resizeImage(chunk[j]);
          chunkBase64.push(resized);
          if (i === 0 && j === 0) base64List.push(resized);
        }

        const imageParts = chunkBase64.map(base64 => ({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64.split(',')[1],
          },
        }));

        const chunkPrompt = `
          你是一個專業的法文老師。請精確提取這些圖片中的教學內容。
          務必回傳純 JSON 格式。
          
          格式：
          {
            "lessonText": "法文內容",
            "vocabulary": ["單字 - 解釋"],
            "grammar": "簡短解釋"
          }
        `;

        const response = await callWithRetry(() => ai.models.generateContent({
          model: extractionModel,
          contents: { parts: [...imageParts, { text: chunkPrompt }] },
          config: { responseMimeType: "application/json" }
        }));

        allExtractedResults.push(safeJsonParse(response.text || "{}", {}));
      }

      // Final consolidation step
      setAnalysisProgress({ current: fileArray.length, total: fileArray.length + 1 });
      const combinedData = JSON.stringify(allExtractedResults);
      
      const consolidationPrompt = `
        你是一個頂尖的法文教學專家。請將以下多組提取到的內容整合為系統化的學習單元。
        務必回傳純 JSON 陣列。
        
        數據：${combinedData}
        
        回傳格式：
        [
          {
            "title": "單元標題",
            "lessonText": "完整法文原文",
            "vocabulary": ["單字 - 解釋 - 例句"],
            "grammar": "核心文法摘要",
            "practicePrompt": "口語練習開場白",
            "fullMarkdown": "# 學習筆記\\n\\n## 📝 課文原文\\n...\\n\\n## 💡 文法解析\\n...",
            "mergeWithExistingTitle": ""
          }
        ]
      `;

      const finalResponse = await callWithRetry(() => ai.models.generateContent({
        model: consolidationModel,
        contents: [{ parts: [{ text: consolidationPrompt }] }],
        config: { responseMimeType: "application/json" }
      }));

      setAnalysisProgress({ current: fileArray.length + 1, total: fileArray.length + 1 });
      const results = safeJsonParse(finalResponse.text || "[]", []);
      updateHistoryWithResults(results, base64List[0]);

    } catch (error: any) {
      console.error("Batch analysis failed:", error);
      const isRateLimit = error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('quota');
      
      if (isRateLimit) {
        alert("分析失敗：觸發了 AI 的使用頻率限制 (Rate Limit)。\n\n這通常是因為短時間內上傳了過多圖片。請等待約 1 分鐘後再試，或嘗試減少單次上傳的圖片數量。");
      } else {
        const errorMsg = error?.message || "未知錯誤";
        alert(`分析失敗：${errorMsg}\n\n這可能是因為網路不穩定。請嘗試分次上傳。`);
      }
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const userMsg: ChatMessage = { role: 'user', text: userInput };
    setChatMessages(prev => [...prev, userMsg]);
    setUserInput('');
    setIsChatting(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const chatHistory = chatMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      // Aggregate context from all history items
      const allLessonsContext = history.map((item, index) => 
        `Unit ${index + 1}: ${item.title}\nText: ${item.lessonText}\nGrammar: ${item.grammar}\nVocab: ${item.vocabulary.join(', ')}`
      ).join('\n\n');

      const systemInstruction = `
        你是一個友善的法文老師。學生已經學習了以下多個單元的內容：
        ${allLessonsContext}
        
        請與學生進行口語模擬對話。
        你的目標是：
        1. 綜合運用這些單元中出現過的單字與語法。
        2. 隨機切換話題或複習舊的單元內容，確保學生真的掌握了。
        3. 糾正他們的錯誤，並鼓勵他們多使用學過的表達方式。
        4. 保持對話簡短、自然且有趣。
        請主要使用法文對話，但在解釋複雜語法時可以使用繁體中文輔助。
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [
          ...chatHistory,
          { role: 'user', parts: [{ text: userInput }] }
        ],
        config: {
          systemInstruction: systemInstruction
        }
      });

      const responseText = response.text || "I'm sorry, I couldn't understand that.";
      const modelMsg: ChatMessage = { role: 'model', text: responseText };
      setChatMessages(prev => [...prev, modelMsg]);
      speakText(responseText);
    } catch (error) {
      console.error("Chat failed:", error);
    } finally {
      setIsChatting(false);
    }
  };

  const handleAskUnitQuestion = async (unit: AnalysisResult) => {
    const question = unitInput[unit.id]?.trim();
    if (!question) return;

    const userMsg: ChatMessage = { role: 'user', text: question };
    setUnitChatMessages(prev => ({
      ...prev,
      [unit.id]: [...(prev[unit.id] || []), userMsg]
    }));
    setUnitInput(prev => ({ ...prev, [unit.id]: '' }));
    setIsUnitChatting(prev => ({ ...prev, [unit.id]: true }));

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const history = unitChatMessages[unit.id] || [];
      const chatHistory = history.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const systemInstruction = `
        你是一個專業的法文老師。現在學生正在閱讀以下單元的文法筆記，並對內容有疑問：
        單元標題：${unit.title}
        課文內容：${unit.lessonText}
        文法重點：${unit.grammar}
        
        請針對學生的問題進行詳細且易懂的解答。
        1. 優先解釋該單元相關的知識。
        2. 如果學生問到延伸問題，也可以適度擴展。
        3. 使用繁體中文回答，法文範例請附上翻譯。
        4. 語氣要鼓勵且專業。
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [
          ...chatHistory,
          { role: 'user', parts: [{ text: question }] }
        ],
        config: {
          systemInstruction: systemInstruction
        }
      });

      const responseText = response.text || "抱歉，我暫時無法回答這個問題。";
      const modelMsg: ChatMessage = { role: 'model', text: responseText };
      setUnitChatMessages(prev => ({
        ...prev,
        [unit.id]: [...(prev[unit.id] || []), modelMsg]
      }));
      speakText(responseText);
    } catch (error) {
      console.error("Unit chat failed:", error);
    } finally {
      setIsUnitChatting(prev => ({ ...prev, [unit.id]: false }));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    processFiles(e.dataTransfer.files);
  }, []);

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const selectHistoryItem = (item: AnalysisResult) => {
    setImage(item.image || null);
    setCurrentAnalysis(item);
    setChatMessages([{ role: 'model', text: item.practicePrompt }]);
    speakText(item.practicePrompt);
    setActiveTab('study');
    setShowHistory(false);
  };

  return (
    <div className="min-h-screen bg-duo-light text-duo-dark font-sans selection:bg-duo-green selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-duo-border px-4 py-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div 
            onClick={() => {
              setCurrentAnalysis(null);
              setImage(null);
              setActiveTab('study');
            }}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-12 h-12 bg-duo-green rounded-2xl flex items-center justify-center shadow-lg shadow-duo-green/20 group-hover:scale-110 transition-transform">
              <BookOpen className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-duo-blue tracking-tight font-display">DuoGrammar</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-duo-gray">Companion Pro</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            {(currentAnalysis || history.length > 0) && (
              <div className="hidden md:flex bg-duo-light p-1.5 rounded-2xl border border-duo-border">
                <button 
                  onClick={() => setActiveTab('study')}
                  disabled={!currentAnalysis}
                  className={cn(
                    "px-6 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'study' ? "bg-white text-duo-blue shadow-sm" : "text-duo-gray hover:text-duo-dark",
                    !currentAnalysis && "opacity-50 cursor-not-allowed"
                  )}
                >
                  單元筆記
                </button>
                <button 
                  onClick={() => {
                    if (!globalSummary) {
                      generateGlobalSummary();
                    } else {
                      setActiveTab('summary');
                    }
                  }}
                  className={cn(
                    "px-6 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'summary' ? "bg-white text-duo-yellow shadow-sm" : "text-duo-gray hover:text-duo-dark"
                  )}
                >
                  知識庫統整
                </button>
                <button 
                  onClick={() => {
                    setActiveTab('practice');
                    if (chatMessages.length === 0 && history.length > 0) {
                      const welcome = "Salut ! J'ai parcouru toutes les unités que vous avez apprises jusqu'à présent. Prêt à tout pratiquer ensemble ? De quoi aimeriez-vous parler aujourd'hui ?";
                      setChatMessages([{ role: 'model', text: welcome }]);
                      speakText(welcome);
                    }
                  }}
                  className={cn(
                    "px-6 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'practice' ? "bg-white text-duo-green shadow-sm" : "text-duo-gray hover:text-duo-dark"
                  )}
                >
                  綜合口語練習
                </button>
              </div>
            )}
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className="p-3 hover:bg-duo-light rounded-2xl transition-all relative group"
            >
              <History className="w-6 h-6 text-duo-gray group-hover:text-duo-blue transition-colors" />
              {history.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 bg-duo-red text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  {history.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Upload & Image */}
          <div className="lg:col-span-4 space-y-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative aspect-[9/16] max-h-[400px] w-full bg-white border-4 border-dashed border-duo-border rounded-[40px] flex flex-col items-center justify-center cursor-pointer transition-all hover:border-duo-blue group overflow-hidden shadow-sm hover:shadow-xl hover:shadow-duo-blue/5",
                image && "border-solid border-duo-blue"
              )}
            >
              {image ? (
                <>
                  <img src={image} alt="Duolingo Screenshot" className="w-full h-full object-contain p-4" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-duo-blue/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                    <div className="bg-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform">
                      <Upload className="w-5 h-5 text-duo-blue" /> 
                      <span className="font-bold text-duo-blue">更換圖片</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center p-8">
                  <div className="w-16 h-16 bg-duo-light rounded-3xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 group-hover:bg-duo-blue/10 transition-all duration-500">
                    <ImageIcon className="w-8 h-8 text-duo-gray group-hover:text-duo-blue transition-colors" />
                  </div>
                  <h3 className="font-extrabold text-lg mb-1 font-display">上傳截圖</h3>
                  <p className="text-xs text-duo-gray font-medium">拖放或點擊選取圖片</p>
                </div>
              )}
            </motion.div>

            {currentAnalysis && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="duo-card p-6 border-duo-blue shadow-lg shadow-duo-blue/5 space-y-6"
              >
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-duo-border bg-duo-light shadow-inner flex items-center justify-center">
                    {currentAnalysis.image ? (
                      <img src={currentAnalysis.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-duo-gray" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button 
                      onClick={() => {
                        setCurrentAnalysis(null);
                        setImage(null);
                      }}
                      className="text-[10px] font-black text-duo-gray hover:text-duo-blue uppercase tracking-widest flex items-center gap-1 mb-2 transition-colors"
                    >
                      <ChevronRight className="w-3 h-3 rotate-180" /> 返回主頁
                    </button>
                    <h3 className="font-extrabold text-duo-dark truncate text-xl font-display">{currentAnalysis.title}</h3>
                    <p className="text-xs font-bold text-duo-gray mt-1">{new Date(currentAnalysis.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="pt-6 border-t border-duo-border/50">
                  <h4 className="text-xs font-black text-duo-gray uppercase tracking-[0.15em] mb-4">本課重點單字</h4>
                  <div className="flex flex-wrap gap-2.5">
                    {currentAnalysis.vocabulary.map((v, i) => (
                      <span key={i} className="bg-duo-light px-4 py-2 rounded-xl text-sm font-bold text-duo-dark border border-duo-border/50 hover:border-duo-blue/30 transition-colors">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              multiple
              className="hidden" 
            />
          </div>

          {/* Right Column: Content */}
          <div className="lg:col-span-8 space-y-6">
            {/* Mobile Tabs */}
            {(currentAnalysis || history.length > 0) && (
              <div className="flex md:hidden bg-duo-border/30 p-1.5 rounded-2xl mb-6 overflow-x-auto no-scrollbar border border-duo-border">
                <button 
                  onClick={() => setActiveTab('study')}
                  disabled={!currentAnalysis}
                  className={cn(
                    "flex-shrink-0 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                    activeTab === 'study' ? "bg-white text-duo-blue shadow-md" : "text-duo-gray",
                    !currentAnalysis && "opacity-50"
                  )}
                >
                  筆記
                </button>
                <button 
                  onClick={() => {
                    if (!globalSummary) {
                      generateGlobalSummary();
                    } else {
                      setActiveTab('summary');
                    }
                  }}
                  className={cn(
                    "flex-shrink-0 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                    activeTab === 'summary' ? "bg-white text-duo-yellow shadow-md" : "text-duo-gray"
                  )}
                >
                  總結
                </button>
                <button 
                  onClick={() => setActiveTab('practice')}
                  className={cn(
                    "flex-shrink-0 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                    activeTab === 'practice' ? "bg-white text-duo-green shadow-md" : "text-duo-gray"
                  )}
                >
                  對話
                </button>
              </div>
            )}

            <AnimatePresence mode="wait">
              {isAnalyzing || isGeneratingSummary ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="duo-card p-12 flex flex-col items-center justify-center min-h-[600px] border-duo-blue/20"
                >
                  <div className="relative mb-10">
                    <div className="w-24 h-24 border-4 border-duo-blue/10 border-t-duo-blue rounded-full animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-duo-yellow animate-pulse" />
                    </div>
                  </div>
                  <h3 className="text-3xl font-extrabold mb-4 font-display text-center">
                    {isGeneratingSummary 
                      ? "正在統整知識庫..." 
                      : analysisProgress 
                        ? `正在整理課程單元 (${analysisProgress.current}/${analysisProgress.total})`
                        : "正在整理課程單元..."}
                  </h3>
                  <p className="text-duo-gray text-center max-w-sm font-medium leading-relaxed">
                    {isGeneratingSummary 
                      ? "我們正在合併所有單元的語法點，為您建立系統化的複習表格。"
                      : analysisProgress
                        ? "我們正在為您提取課文、單字與語法重點，請稍候。"
                        : "我們正在為您提取課文、單字與語法重點。"}
                  </p>
                  {analysisProgress && (
                    <div className="w-full max-w-xs bg-duo-light h-3 rounded-full mt-10 overflow-hidden border border-duo-border">
                      <motion.div 
                        className="bg-duo-blue h-full shadow-[0_0_10px_rgba(28,176,246,0.3)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                        transition={{ type: 'spring', bounce: 0 }}
                      />
                    </div>
                  )}
                </motion.div>
              ) : activeTab === 'summary' ? (
                <motion.div 
                  key="summary"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="duo-card p-8 sm:p-12 shadow-xl shadow-duo-yellow/5 min-h-[600px]"
                >
                  <div className="flex items-center justify-between mb-10 pb-6 border-b-2 border-duo-border/50">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-duo-yellow rounded-2xl flex items-center justify-center shadow-lg shadow-duo-yellow/20">
                        <Sparkles className="text-white w-7 h-7" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-extrabold text-duo-dark font-display">語法知識庫統整</h2>
                        {globalSummary && (
                          <p className="text-xs font-bold text-duo-gray mt-1 uppercase tracking-wider">
                            產出時間：{new Date(globalSummary.timestamp).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <button 
                      onClick={generateGlobalSummary}
                      disabled={isGeneratingSummary}
                      className="text-sm font-bold text-duo-blue hover:text-duo-blue/80 transition-colors bg-duo-blue/5 px-4 py-2 rounded-xl flex items-center gap-2"
                    >
                      <RefreshCw className={cn("w-4 h-4", isGeneratingSummary && "animate-spin")} />
                      重新整理
                    </button>
                  </div>
                  <div className="space-y-12">
                    {globalSummary ? (
                      <>
                        <div className="markdown-body">
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({node, ...props}) => (
                                <div className="w-full overflow-x-auto my-8 border-2 border-duo-border rounded-[32px] shadow-sm bg-white no-scrollbar">
                                  <table className="w-full border-collapse min-w-[600px]" {...props} />
                                </div>
                              ),
                              th: ({node, ...props}) => (
                                <th className="p-5 text-left text-xs font-black text-duo-gray uppercase tracking-widest border-b-2 border-duo-border bg-duo-light whitespace-nowrap" {...props} />
                              ),
                              td: ({node, ...props}) => (
                                <td className="p-5 text-sm text-duo-dark border-b border-duo-border bg-white break-words font-medium" {...props} />
                              )
                            }}
                          >
                            {globalSummary.content}
                          </Markdown>
                        </div>

                        {/* Worksheet Section */}
                        <div className="mt-16 pt-12 border-t-4 border-duo-border/30">
                          <div className="flex items-center justify-between mb-10">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-duo-blue rounded-2xl flex items-center justify-center shadow-lg shadow-duo-blue/20">
                                <ClipboardCheck className="text-white w-7 h-7" />
                              </div>
                              <div>
                                <h3 className="text-2xl font-extrabold text-duo-dark font-display">今日複習學習單</h3>
                                <p className="text-sm font-bold text-duo-gray">根據你學過的內容自動生成的練習題</p>
                              </div>
                            </div>
                            {globalSummary.score !== undefined && (
                              <div className="flex items-center gap-3 bg-duo-green/10 px-6 py-3 rounded-2xl border-2 border-duo-green/20">
                                <CheckCircle2 className="w-6 h-6 text-duo-green" />
                                <span className="text-2xl font-black text-duo-green">{globalSummary.score} / 100</span>
                              </div>
                            )}
                          </div>

                          <div className="space-y-8">
                            {globalSummary.worksheet.map((q, idx) => (
                              <div key={idx} className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-duo-border shadow-sm">
                                <div className="flex items-start gap-3 sm:gap-4 mb-6">
                                  <span className="w-8 h-8 sm:w-10 sm:h-10 bg-duo-light rounded-xl flex items-center justify-center font-black text-duo-gray flex-shrink-0 text-sm sm:text-base">
                                    {idx + 1}
                                  </span>
                                  <p className="text-lg sm:text-xl font-bold text-duo-dark pt-1">{q.question}</p>
                                </div>

                                {q.type === 'multiple-choice' ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 ml-0 sm:ml-14">
                                    {q.options?.map((opt, optIdx) => (
                                      <button
                                        key={optIdx}
                                        disabled={globalSummary.score !== undefined}
                                        onClick={() => {
                                          const newAnswers = [...worksheetAnswers];
                                          newAnswers[idx] = opt;
                                          setWorksheetAnswers(newAnswers);
                                        }}
                                        className={cn(
                                          "p-4 rounded-2xl border-2 font-bold text-left transition-all text-sm sm:text-base",
                                          worksheetAnswers[idx] === opt
                                            ? "bg-duo-blue border-duo-blue text-white shadow-lg shadow-duo-blue/20"
                                            : "bg-white border-duo-border text-duo-dark hover:border-duo-blue/40",
                                          globalSummary.score !== undefined && q.correctAnswer === opt && "border-duo-green bg-duo-green/10 text-duo-green",
                                          globalSummary.score !== undefined && worksheetAnswers[idx] === opt && q.correctAnswer !== opt && "border-duo-red bg-duo-red/10 text-duo-red"
                                        )}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="ml-0 sm:ml-14">
                                    <input
                                      type="text"
                                      disabled={globalSummary.score !== undefined}
                                      value={worksheetAnswers[idx] || ''}
                                      onChange={(e) => {
                                        const newAnswers = [...worksheetAnswers];
                                        newAnswers[idx] = e.target.value;
                                        setWorksheetAnswers(newAnswers);
                                      }}
                                      placeholder="請輸入答案..."
                                      className={cn(
                                        "w-full bg-duo-light border-2 border-duo-border rounded-2xl px-6 py-4 font-bold focus:outline-none focus:border-duo-blue transition-all text-sm sm:text-base",
                                        globalSummary.score !== undefined && worksheetAnswers[idx].toLowerCase().trim() === q.correctAnswer.toLowerCase().trim() && "border-duo-green bg-duo-green/5",
                                        globalSummary.score !== undefined && worksheetAnswers[idx].toLowerCase().trim() !== q.correctAnswer.toLowerCase().trim() && "border-duo-red bg-duo-red/5"
                                      )}
                                    />
                                    {globalSummary.score !== undefined && worksheetAnswers[idx].toLowerCase().trim() !== q.correctAnswer.toLowerCase().trim() && (
                                      <p className="mt-3 text-sm font-bold text-duo-green flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4" />
                                        正確答案：{q.correctAnswer}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {globalSummary.score === undefined ? (
                            <div className="mt-12 flex justify-center">
                              <button
                                onClick={gradeWorksheet}
                                disabled={isGrading || worksheetAnswers.some(a => !a.trim())}
                                className="duo-button-green px-12 py-5 text-xl flex items-center gap-3 shadow-xl shadow-duo-green/20"
                              >
                                {isGrading ? (
                                  <>
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    老師批改中...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-6 h-6" />
                                    送出學習單
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            <motion.div
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="mt-16 bg-white rounded-[40px] p-10 border-4 border-duo-green/30 shadow-2xl shadow-duo-green/5 relative overflow-hidden"
                            >
                              <div className="absolute top-0 right-0 p-8 opacity-10">
                                <CheckCircle2 className="w-32 h-32 text-duo-green" />
                              </div>
                              <div className="relative z-10">
                                <div className="flex items-center gap-4 mb-8">
                                  <div className="w-14 h-14 bg-duo-green rounded-2xl flex items-center justify-center">
                                    <Sparkles className="text-white w-8 h-8" />
                                  </div>
                                  <h4 className="text-3xl font-extrabold text-duo-dark font-display">老師的批改與建議</h4>
                                </div>
                                <div className="markdown-body">
                                  <Markdown remarkPlugins={[remarkGfm]}>
                                    {globalSummary.feedback}
                                  </Markdown>
                                </div>
                                <div className="mt-10 pt-8 border-t-2 border-duo-border/50 flex flex-col sm:flex-row items-center justify-between gap-6">
                                  <div className="flex items-center gap-3 text-duo-gray">
                                    <AlertCircle className="w-5 h-5" />
                                    <p className="text-sm font-bold">下次統整時，我會特別加強你這次答錯的部分。</p>
                                  </div>
                                  <button
                                    onClick={generateGlobalSummary}
                                    className="text-duo-blue font-black uppercase tracking-widest text-xs hover:underline flex items-center gap-2"
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                    產出新的複習內容
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-32 text-duo-gray">
                        <div className="w-20 h-20 bg-duo-light rounded-full flex items-center justify-center mx-auto mb-6">
                          <Sparkles className="w-10 h-10 text-duo-border" />
                        </div>
                        <p className="font-bold text-lg">點擊「知識庫統整」來合併所有學過的單元筆記。</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : history.length > 0 ? (
                activeTab === 'study' ? (
                  <motion.div 
                    key="study-list"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="space-y-6"
                  >
                    {history.map((item) => (
                      <motion.div
                        key={item.id}
                        layout
                        className={cn(
                          "duo-card border-2 transition-all duration-500 overflow-hidden",
                          currentAnalysis?.id === item.id ? "border-duo-blue shadow-2xl shadow-duo-blue/10" : "border-duo-border hover:border-duo-blue/40 hover:shadow-lg hover:shadow-duo-blue/5"
                        )}
                      >
                        <button 
                          onClick={() => setCurrentAnalysis(currentAnalysis?.id === item.id ? null : item)}
                          className="w-full p-6 sm:p-8 flex items-center justify-between text-left group"
                        >
                          <div className="flex items-center gap-6">
                            <div className="w-16 h-16 bg-duo-light rounded-2xl flex items-center justify-center border-2 border-duo-border overflow-hidden flex-shrink-0 shadow-inner group-hover:scale-105 transition-transform duration-300">
                              {item.image ? (
                                <img src={item.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <ImageIcon className="w-6 h-6 text-duo-gray" />
                              )}
                            </div>
                            <div>
                              <h3 className="font-extrabold text-duo-dark text-xl font-display group-hover:text-duo-blue transition-colors">{item.title}</h3>
                              <p className="text-xs font-bold text-duo-gray mt-1 uppercase tracking-wider">{new Date(item.timestamp).toLocaleString()}</p>
                            </div>
                          </div>
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                            currentAnalysis?.id === item.id ? "bg-duo-blue text-white shadow-lg shadow-duo-blue/30" : "bg-duo-light text-duo-gray group-hover:bg-duo-blue/10 group-hover:text-duo-blue"
                          )}>
                            <ChevronDown className={cn("w-7 h-7 transition-transform duration-500", currentAnalysis?.id === item.id && "rotate-180")} />
                          </div>
                        </button>
                        
                        <AnimatePresence>
                          {currentAnalysis?.id === item.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                              className="border-t-2 border-duo-border/30"
                            >
                              <div className="p-6 sm:p-12 space-y-10 bg-gradient-to-b from-white to-duo-light/30">
                                {/* Original Text Section */}
                                {item.lessonText && (
                                  <div className="bg-white rounded-[32px] p-8 border-2 border-duo-border relative group shadow-sm hover:shadow-md transition-shadow">
                                    <div className="flex items-center justify-between mb-6">
                                      <h4 className="text-xs font-black text-duo-gray uppercase tracking-[0.2em] flex items-center gap-2.5">
                                        <div className="w-2 h-2 bg-duo-blue rounded-full animate-pulse" />
                                        課文原文
                                      </h4>
                                      <button 
                                        onClick={() => speakText(item.lessonText, true)}
                                        className="p-3 bg-duo-light rounded-2xl shadow-sm hover:bg-duo-blue hover:text-white transition-all text-duo-blue hover:scale-110 active:scale-95"
                                        title="朗讀課文"
                                      >
                                        <Volume2 className="w-5 h-5" />
                                      </button>
                                    </div>
                                    <p className="text-2xl font-bold text-duo-dark leading-relaxed italic font-display">
                                      "{item.lessonText}"
                                    </p>
                                  </div>
                                )}

                                  <div className="markdown-body">
                                    <Markdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        table: ({node, ...props}) => (
                                          <div className="w-full overflow-x-auto my-8 border-2 border-duo-border rounded-[32px] shadow-sm bg-white no-scrollbar">
                                            <table className="w-full border-collapse min-w-[500px]" {...props} />
                                          </div>
                                        ),
                                        th: ({node, ...props}) => (
                                          <th className="p-5 text-left text-xs font-black text-duo-gray uppercase tracking-widest border-b-2 border-duo-border bg-duo-light whitespace-nowrap" {...props} />
                                        ),
                                        td: ({node, ...props}) => (
                                          <td className="p-5 text-sm text-duo-dark border-b border-duo-border bg-white break-words font-medium" {...props} />
                                        )
                                      }}
                                    >
                                      {item.explanation}
                                    </Markdown>
                                  </div>

                                  {/* Unit Specific Q&A */}
                                  <div className="mt-12 pt-10 border-t-2 border-duo-border/30">
                                    <div className="flex items-center gap-3 mb-6">
                                      <div className="w-10 h-10 bg-duo-blue/10 rounded-xl flex items-center justify-center">
                                        <Sparkles className="w-5 h-5 text-duo-blue" />
                                      </div>
                                      <h4 className="font-extrabold text-lg font-display">針對此單元提問</h4>
                                    </div>

                                    <div className="space-y-4 mb-6">
                                      {unitChatMessages[item.id]?.map((msg, idx) => (
                                        <div key={idx} className={cn(
                                          "flex flex-col",
                                          msg.role === 'user' ? "items-end" : "items-start"
                                        )}>
                                          <div className={cn(
                                            "max-w-[85%] p-4 rounded-2xl text-sm font-medium shadow-sm",
                                            msg.role === 'user' 
                                              ? "bg-duo-blue text-white rounded-tr-none" 
                                              : "bg-white border border-duo-border text-duo-dark rounded-tl-none"
                                          )}>
                                            <div className={cn("markdown-body", msg.role === 'user' ? "text-white prose-invert" : "text-duo-dark")}>
                                              <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                      {isUnitChatting[item.id] && (
                                        <div className="flex items-center gap-2 text-duo-gray">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          <span className="text-xs font-bold">老師正在思考中...</span>
                                        </div>
                                      )}
                                    </div>

                                    <div className="relative">
                                      <input 
                                        type="text"
                                        value={unitInput[item.id] || ''}
                                        onChange={(e) => setUnitInput(prev => ({ ...prev, [item.id]: e.target.value }))}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAskUnitQuestion(item)}
                                        placeholder="對這個文法點有疑問嗎？直接問老師吧！"
                                        className="w-full bg-white border-2 border-duo-border rounded-2xl py-4 pl-6 pr-14 font-bold text-sm focus:border-duo-blue focus:outline-none transition-all shadow-sm"
                                      />
                                      <button 
                                        onClick={() => handleAskUnitQuestion(item)}
                                        disabled={isUnitChatting[item.id] || !unitInput[item.id]?.trim()}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-duo-blue text-white rounded-xl shadow-md hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                                      >
                                        <ChevronRight className="w-5 h-5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div 
                    key="practice"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="duo-card border-duo-green/30 flex flex-col h-[700px] overflow-hidden shadow-2xl shadow-duo-green/5"
                  >
                    <div className="p-6 border-b-2 border-duo-border/50 bg-white flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-duo-green rounded-2xl flex items-center justify-center shadow-lg shadow-duo-green/20">
                          <Sparkles className="text-white w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-extrabold text-lg font-display">AI 綜合對話老師</h3>
                          <p className="text-[10px] text-duo-green font-black uppercase tracking-[0.15em]">Reviewing {history.length} Units</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => setIsSlowMode(!isSlowMode)}
                          className={cn(
                            "p-3 rounded-2xl transition-all duration-300 flex items-center gap-2",
                            isSlowMode ? "bg-duo-yellow/10 text-duo-yellow" : "bg-duo-light text-duo-gray"
                          )}
                          title={isSlowMode ? "慢速模式" : "正常速度"}
                        >
                          <span className="text-[10px] font-black">0.6x</span>
                        </button>
                        <button 
                          onClick={() => setIsAutoSpeak(!isAutoSpeak)}
                          className={cn(
                            "p-3 rounded-2xl transition-all duration-300",
                            isAutoSpeak ? "bg-duo-green/10 text-duo-green" : "bg-duo-light text-duo-gray"
                          )}
                          title={isAutoSpeak ? "語音開啟" : "語音關閉"}
                        >
                          {isAutoSpeak ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-duo-light/30 no-scrollbar">
                      {chatMessages.map((msg, i) => (
                        <motion.div 
                          key={i} 
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          className={cn(
                            "flex",
                            msg.role === 'user' ? "justify-end" : "justify-start"
                          )}
                        >
                          <div className={cn(
                            "max-w-[85%] p-5 rounded-[24px] text-base font-bold shadow-sm flex items-start gap-4",
                            msg.role === 'user' 
                              ? "bg-duo-blue text-white rounded-tr-none shadow-lg shadow-duo-blue/20" 
                              : "bg-white text-duo-dark rounded-tl-none border-2 border-duo-border/50"
                          )}>
                            <div className={cn("markdown-body", msg.role === 'user' ? "text-white prose-invert" : "text-duo-dark")}>
                              <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                            </div>
                            {msg.role === 'model' && (
                              <button 
                                onClick={() => speakText(msg.text, true)}
                                className="mt-0.5 p-1.5 hover:bg-duo-light rounded-xl transition-colors text-duo-blue"
                              >
                                <Volume2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ))}
                      {isChatting && (
                        <div className="flex justify-start">
                          <div className="bg-white border-2 border-duo-border/50 p-5 rounded-[24px] rounded-tl-none flex gap-1.5">
                            <span className="w-2 h-2 bg-duo-blue rounded-full animate-bounce" />
                            <span className="w-2 h-2 bg-duo-blue rounded-full animate-bounce [animation-delay:0.2s]" />
                            <span className="w-2 h-2 bg-duo-blue rounded-full animate-bounce [animation-delay:0.4s]" />
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    <div className="p-6 bg-white border-t-2 border-duo-border/50">
                      <div className="flex gap-3">
                        <button 
                          onClick={toggleListening}
                          className={cn(
                            "p-4 rounded-2xl transition-all shadow-sm active:scale-95",
                            isListening 
                              ? "bg-duo-red text-white animate-pulse shadow-lg shadow-duo-red/30" 
                              : "bg-duo-light text-duo-gray hover:bg-duo-border/50"
                          )}
                        >
                          {isListening ? <Mic className="w-7 h-7" /> : <MicOff className="w-7 h-7" />}
                        </button>
                        <input 
                          type="text"
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                          placeholder={isListening ? "正在聆聽..." : "用法文回答老師..."}
                          className="flex-1 bg-duo-light border-2 border-duo-border rounded-2xl px-6 py-4 text-base font-bold focus:outline-none focus:border-duo-blue transition-all placeholder:text-duo-gray/60"
                        />
                        <button 
                          onClick={handleSendMessage}
                          disabled={!userInput.trim() || isChatting}
                          className="duo-button-green p-4 flex items-center justify-center min-w-[64px]"
                        >
                          <ChevronRight className="w-8 h-8" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              ) : (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="duo-card p-16 border-dashed border-4 flex flex-col items-center justify-center min-h-[600px] text-center bg-white/50"
                >
                  <div className="w-32 h-32 bg-duo-light rounded-[40px] flex items-center justify-center mb-10 shadow-inner group hover:scale-110 transition-transform duration-500">
                    <BookOpen className="w-16 h-16 text-duo-border group-hover:text-duo-blue transition-colors" />
                  </div>
                  <h3 className="text-3xl font-extrabold mb-4 text-duo-dark font-display">
                    {history.length > 0 ? "選擇一個單元開始學習" : "開始你的專屬課程"}
                  </h3>
                  <p className="text-duo-gray max-w-sm mx-auto font-medium text-lg leading-relaxed">
                    {history.length > 0 
                      ? "從左側選擇已上傳的單元，或繼續上傳新截圖來擴充你的知識庫。"
                      : "上傳 Duolingo 的課文截圖，我會為你整理成完整的學習單元，並陪你練習口語！"}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* History Sidebar */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-duo-dark/30 backdrop-blur-md z-20"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-30 shadow-2xl flex flex-col border-l border-duo-border"
            >
              <div className="p-8 border-b border-duo-border flex flex-col gap-6 bg-white">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <h2 className="text-2xl font-extrabold flex items-center gap-3 font-display">
                      <History className="w-6 h-6 text-duo-blue" /> 學習紀錄
                    </h2>
                    {history.length > 0 && (
                      <button 
                        onClick={() => {
                          if (confirm("確定要清除所有學習紀錄嗎？")) {
                            setHistory([]);
                            setCurrentAnalysis(null);
                            setGlobalSummary(null);
                          }
                        }}
                        className="text-[10px] font-black text-duo-red hover:underline flex items-center gap-1.5 mt-2 uppercase tracking-widest"
                      >
                        <Trash2 className="w-3 h-3" /> 清除全部紀錄
                      </button>
                    )}
                  </div>
                  <button 
                    onClick={() => setShowHistory(false)}
                    className="p-3 hover:bg-duo-light rounded-2xl transition-all"
                  >
                    <ChevronRight className="w-7 h-7" />
                  </button>
                </div>

                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-duo-gray" />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜尋標題或內容..."
                    className="w-full bg-duo-light border-2 border-duo-border rounded-2xl pl-12 pr-10 py-3 text-sm font-bold focus:outline-none focus:border-duo-blue transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-duo-border/50 rounded-full transition-all"
                    >
                      <X className="w-4 h-4 text-duo-gray" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-duo-light/20">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-10">
                    <div className="w-20 h-20 bg-duo-light rounded-[32px] flex items-center justify-center mb-6">
                      <History className="w-10 h-10 text-duo-border" />
                    </div>
                    <p className="text-duo-gray font-bold">尚無學習紀錄</p>
                  </div>
                ) : history.filter(item => 
                    item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                    item.lessonText.toLowerCase().includes(searchQuery.toLowerCase())
                  ).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-10">
                    <p className="text-duo-gray font-bold">找不到符合的結果</p>
                  </div>
                ) : (
                  history
                    .filter(item => 
                      item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                      item.lessonText.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="relative group"
                    >
                      <button
                        onClick={() => selectHistoryItem(item)}
                        className={cn(
                          "w-full p-5 rounded-[24px] border-2 text-left transition-all flex items-center gap-4",
                          currentAnalysis?.id === item.id 
                            ? "bg-duo-blue/5 border-duo-blue shadow-md" 
                            : "bg-white border-duo-border hover:border-duo-blue/40"
                        )}
                      >
                        <div className="w-14 h-14 rounded-xl overflow-hidden border-2 border-duo-border flex-shrink-0 group-hover:scale-105 transition-transform flex items-center justify-center bg-duo-light">
                          {item.image ? (
                            <img src={item.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <ImageIcon className="w-6 h-6 text-duo-gray" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-extrabold text-duo-dark truncate font-display group-hover:text-duo-blue transition-colors">{item.title}</h4>
                          <p className="text-[10px] font-bold text-duo-gray mt-1 uppercase tracking-wider">{new Date(item.timestamp).toLocaleString()}</p>
                        </div>
                        <ChevronRight className={cn(
                          "w-5 h-5 transition-all",
                          currentAnalysis?.id === item.id ? "text-duo-blue translate-x-1" : "text-duo-border group-hover:text-duo-blue"
                        )} />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`確定要刪除「${item.title}」嗎？`)) {
                            deleteHistoryItem(item.id);
                          }
                        }}
                        className="absolute -top-2 -right-2 w-8 h-8 bg-white border-2 border-duo-border text-duo-red rounded-full flex items-center justify-center transition-all shadow-lg hover:bg-duo-red hover:text-white hover:border-duo-red z-10"
                        title="刪除此紀錄"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-duo-border p-4 sm:hidden z-10">
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="duo-button-green w-full flex items-center justify-center gap-3 py-4"
        >
          <Upload className="w-6 h-6" /> 
          <span className="text-lg">上傳截圖</span>
        </button>
      </footer>
    </div>
  );
}
