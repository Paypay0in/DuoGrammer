import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Upload, Image as ImageIcon, Loader2, BookOpen, History, Trash2, ChevronRight, ChevronDown, Sparkles, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AnalysisResult {
  id: string;
  image: string;
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
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'study' | 'practice' | 'summary'>('study');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [isSlowMode, setIsSlowMode] = useState(false);
  const [globalSummary, setGlobalSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

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
    setIsGeneratingSummary(true);
    setActiveTab('summary');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const allData = history.map((item, i) => 
        `Unit ${i + 1}: ${item.title}\nText: ${item.lessonText}\nGrammar: ${item.grammar}\nVocab: ${item.vocabulary.join(', ')}`
      ).join('\n\n---\n\n');

      const prompt = `
        你是一個專業的法文老師。學生目前已經學習了多個碎片化的 Duolingo 單元。
        請幫學生將以下所有單元的語法知識進行「系統化統整」：
        1. 建立一個綜合語法表格（例如：人稱代名詞表、動詞變位表等），將不同單元學到的知識點合併在一起。
        2. 總結核心句型結構。
        3. 整理出一份系統化的複習筆記。
        請使用繁體中文，並使用 Markdown 格式（包含表格）讓排版清晰美觀。
        
        學習內容如下：
        ${allData}
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
      });

      setGlobalSummary(response.text || "無法生成總結。");
    } catch (error) {
      console.error("Summary generation failed:", error);
      setGlobalSummary("生成總結時發生錯誤。");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisProgress({ current: 0, total: fileArray.length });
    setActiveTab('study');

    try {
      const base64List: string[] = [];
      for (let i = 0; i < fileArray.length; i++) {
        setAnalysisProgress({ current: i + 1, total: fileArray.length });
        const file = fileArray[i];
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        base64List.push(base64);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";
      
      const imageParts = base64List.map(base64 => ({
        inlineData: {
          mimeType: "image/png",
          data: base64.split(',')[1],
        },
      }));

      // Provide existing units for context and potential merging
      const existingUnitsInfo = history.map(h => `- ${h.title}: ${h.lessonText.substring(0, 100)}...`).join('\n');

      const prompt = `
        你是一個專業的法文老師。這些是來自 Duolingo 的學習截圖。
        
        任務：
        1. 判斷截圖的連貫性。如果多張截圖屬於同一個連貫的對話、課文或主題（例如：餐廳點餐），請將它們合併為一個單元。
        2. 判別主題類別。如果截圖與現有的單元主題高度相似，請建議合併。
        3. **精確提取課文**：請逐字逐句地從圖片中提取出所有的法文句子、對話或題目內容，並整理在 "lessonText" 欄位中。
        
        現有的單元列表：
        ${existingUnitsInfo || "尚無現有單元"}
        
        請以 JSON 陣列格式回傳，每個元素代表一個「建議」的單元：
        [
          {
            "title": "單元標題",
            "lessonText": "完整課文內容（請逐字提取圖片中的法文原文，若有多句請換行排列）",
            "vocabulary": ["單字1 (解釋)", "單字2 (解釋)"],
            "grammar": "詳細語法解說",
            "practicePrompt": "口語練習開場白",
            "fullMarkdown": "完整學習筆記",
            "mergeWithExistingTitle": "如果此內容應合併至現有單元，請填寫該單元的精確標題，否則留空"
          }
        ]
        
        注意：
        - 如果是合併至現有單元，請將「新內容」與「舊內容」進行有機整合，產生一份更完整的筆記。
        - 標題要簡短有力。
        - 請使用繁體中文進行解說。
      `;

      const response: GenerateContentResponse = await ai.models.generateContent({
        model,
        contents: { parts: [...imageParts, { text: prompt }] },
        config: { responseMimeType: "application/json" }
      });

      const results = JSON.parse(response.text || "[]");
      
      setHistory(prev => {
        let newHistory = [...prev];
        results.forEach((res: any) => {
          const existingIndex = newHistory.findIndex(h => h.title === res.mergeWithExistingTitle);
          
          const newResult: AnalysisResult = {
            id: existingIndex !== -1 ? newHistory[existingIndex].id : crypto.randomUUID(),
            image: base64List[0], 
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
          image: base64List[0],
          title: firstRes.title,
          explanation: firstRes.fullMarkdown,
          lessonText: firstRes.lessonText,
          vocabulary: firstRes.vocabulary,
          grammar: firstRes.grammar,
          practicePrompt: firstRes.practicePrompt,
          timestamp: Date.now(),
        };
        setCurrentAnalysis(displayResult);
        setImage(displayResult.image);
        setChatMessages([{ role: 'model', text: displayResult.practicePrompt }]);
        speakText(displayResult.practicePrompt);
      }

    } catch (error) {
      console.error("Batch analysis failed:", error);
      alert("分析失敗，請重試。");
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
    setImage(item.image);
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
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-duo-green rounded-2xl flex items-center justify-center shadow-lg shadow-duo-green/20">
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
                  onClick={() => generateGlobalSummary()}
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
            {!currentAnalysis ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative aspect-[9/16] max-h-[600px] w-full bg-white border-4 border-dashed border-duo-border rounded-[40px] flex flex-col items-center justify-center cursor-pointer transition-all hover:border-duo-blue group overflow-hidden shadow-sm hover:shadow-xl hover:shadow-duo-blue/5",
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
                    <div className="w-20 h-20 bg-duo-light rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 group-hover:bg-duo-blue/10 transition-all duration-500">
                      <ImageIcon className="w-10 h-10 text-duo-gray group-hover:text-duo-blue transition-colors" />
                    </div>
                    <h3 className="font-extrabold text-xl mb-2 font-display">批次上傳截圖</h3>
                    <p className="text-sm text-duo-gray font-medium">可一次選取多張圖片拖放或點擊</p>
                    <div className="mt-8 px-6 py-3 bg-duo-blue text-white rounded-2xl font-bold shadow-lg shadow-duo-blue/20 opacity-0 group-hover:opacity-100 transition-all duration-300">
                      立即開始
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="duo-card p-6 border-duo-blue shadow-lg shadow-duo-blue/5 space-y-6"
              >
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-duo-border bg-duo-light shadow-inner">
                    <img src={currentAnalysis.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-duo-dark truncate text-xl font-display">{currentAnalysis.title}</h3>
                    <p className="text-xs font-bold text-duo-gray mt-1">{new Date(currentAnalysis.timestamp).toLocaleString()}</p>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="text-sm font-bold text-duo-blue mt-3 hover:text-duo-blue/80 flex items-center gap-1.5 transition-colors"
                    >
                      <Upload className="w-4 h-4" /> 繼續上傳新單元
                    </button>
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
                  onClick={() => generateGlobalSummary()}
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
                      <h2 className="text-3xl font-extrabold text-duo-dark font-display">語法知識庫統整</h2>
                    </div>
                    <button 
                      onClick={generateGlobalSummary}
                      className="text-sm font-bold text-duo-blue hover:text-duo-blue/80 transition-colors bg-duo-blue/5 px-4 py-2 rounded-xl"
                    >
                      重新整理
                    </button>
                  </div>
                  <div className="markdown-body prose prose-slate max-w-none prose-table:table-auto">
                    {globalSummary ? (
                      <Markdown
                        components={{
                          table: ({node, ...props}) => (
                            <div className="w-full overflow-x-auto my-8 border-2 border-duo-border rounded-[32px] shadow-sm bg-white">
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
                        {globalSummary}
                      </Markdown>
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
                              <img src={item.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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

                                <div className="markdown-body prose prose-slate max-w-none prose-table:table-auto">
                                  <Markdown
                                    components={{
                                      table: ({node, ...props}) => (
                                        <div className="w-full overflow-x-auto my-8 border-2 border-duo-border rounded-[32px] shadow-sm bg-white">
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
                            <span className="leading-relaxed">{msg.text}</span>
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
                  <h3 className="text-3xl font-extrabold mb-4 text-duo-dark font-display">開始你的專屬課程</h3>
                  <p className="text-duo-gray max-w-sm mx-auto font-medium text-lg leading-relaxed">
                    上傳 Duolingo 的課文截圖，我會為你整理成完整的學習單元，並陪你練習口語！
                  </p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-12 duo-button-primary px-10 py-4 text-lg"
                  >
                    立即上傳截圖
                  </button>
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
              <div className="p-8 border-b border-duo-border flex items-center justify-between bg-white">
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

              <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-duo-light/20">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-10">
                    <div className="w-20 h-20 bg-duo-light rounded-[32px] flex items-center justify-center mb-6">
                      <History className="w-10 h-10 text-duo-border" />
                    </div>
                    <p className="text-duo-gray font-bold">尚無學習紀錄</p>
                  </div>
                ) : (
                  history.map((item) => (
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
                        <div className="w-14 h-14 rounded-xl overflow-hidden border-2 border-duo-border flex-shrink-0 group-hover:scale-105 transition-transform">
                          <img src={item.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                          deleteHistoryItem(item.id);
                        }}
                        className="absolute -top-2 -right-2 w-8 h-8 bg-white border-2 border-duo-border text-duo-red rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:bg-duo-red hover:text-white hover:border-duo-red z-10"
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
