import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Upload, Image as ImageIcon, Loader2, BookOpen, History, Trash2, Save, ChevronRight, ChevronDown, ChevronUp, Sparkles, Mic, MicOff, Volume2, VolumeX, Search, X, ClipboardCheck, CheckCircle2, AlertCircle, RefreshCw, PenLine, Pencil, Eraser, Highlighter, LogIn, LogOut, User, CloudDownload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import HandwritingCanvas, { HandwritingCanvasRef } from './components/HandwritingCanvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Type } from "@google/genai";
import { supabase } from './lib/supabase';

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
  duoLocation?: string; // Manual input for Duolingo chapter/section
  category?: string; // For folders/categorization
  drawingData?: string; // Per-unit handwriting data
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

interface Flashcard {
  french: string;
  meaning: string;
  conjugation?: string;
  example: string;
}

interface GlobalSummaryData {
  content: string;
  timestamp: number;
  worksheet: WorksheetQuestion[];
  flashcards?: Flashcard[];
  userAnswers?: string[];
  feedback?: string;
  score?: number;
}

interface DailyStory {
  title: string;
  story: string;
  translation: string;
  vocabulary: { word: string; meaning: string }[];
  sentencePractice: { prompt: string; answer: string; hint: string }[];
  timestamp: number;
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
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isRestructuring, setIsRestructuring] = useState<string | null>(null);

  const restructureWithAI = async (item: AnalysisResult) => {
    setIsRestructuring(item.id);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const prompt = `
        你是一個法文教學專家。請將以下這段學習筆記重新排列格式。
        
        要求：
        1. **主標題**：保持 "# 學習筆記"。
        2. **重點單字**：將 "## 🌟 重點單字 (Key Vocabulary)" 區塊移到最下方（筆記最後面）。
        3. **內容完整**：不要刪除任何原有的解釋、例句或文法點。
        4. **整合解析**：確保 "## 💡 核心學習單元" 包含深度整合的解析。
        
        原有內容：
        ${item.explanation}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }]
      });

      const newContent = response.text || item.explanation;
      
      setHistory(prev => {
        const newHistory = prev.map(h => h.id === item.id ? { ...h, explanation: newContent } : h);
        safeLocalStorageSet('duo_grammar_history', JSON.stringify(newHistory.slice(0, 200)));
        return newHistory;
      });
      setShowToast('筆記格式已優化！');
    } catch (error) {
      console.error('Restructure error:', error);
      setShowToast('優化失敗，請稍後再試');
    } finally {
      setIsRestructuring(null);
    }
  };

  const [user, setUser] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  // Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthLoading(true);
    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        setShowToast('登入成功！');
      } else {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        setShowToast('註冊成功！請檢查電子郵件驗證信');
      }
      setShowAuthModal(false);
    } catch (error: any) {
      console.error('Auth error:', error);
      setShowToast(error.message || '認證失敗');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowToast('已登出');
  };

  const syncToCloud = async () => {
    if (!user) {
      setShowAuthModal(true);
      setShowToast('請先登入以同步資料');
      return;
    }
    
    setIsManualSyncing(true);
    setSyncStatus('syncing');
    try {
      const { error } = await supabase
        .from('duo_grammar_data')
        .upsert({ 
          id: user.id, 
          history: history,
          summary: globalSummary,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
      setSyncStatus('success');
      setShowToast('同步成功！資料已上傳雲端');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (error) {
      console.error('Manual sync error:', error);
      setSyncStatus('error');
      setShowToast('同步失敗，請檢查網路');
    } finally {
      setIsManualSyncing(false);
    }
  };

  const pullFromCloud = async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setIsManualSyncing(true);
    try {
      const { data, error } = await supabase
        .from('duo_grammar_data')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        // Merge History: Combine local and remote, keeping unique IDs
        // If IDs conflict, keep the one with the newer timestamp
        if (data.history) {
          setHistory(prev => {
            const mergedMap = new Map<string, AnalysisResult>();
            // Add existing local items
            prev.forEach(item => mergedMap.set(item.id, item));
            // Add remote items, overwriting only if remote is newer or local doesn't have it
            data.history.forEach((remoteItem: AnalysisResult) => {
              const localItem = mergedMap.get(remoteItem.id);
              if (!localItem || remoteItem.timestamp > localItem.timestamp) {
                mergedMap.set(remoteItem.id, remoteItem);
              }
            });
            const merged = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
            safeLocalStorageSet('duo_grammar_history', JSON.stringify(merged.slice(0, 200)));
            return merged;
          });
        }

        // Merge Summary: Keep the one with the later timestamp
        if (data.summary) {
          setGlobalSummary(prev => {
            if (!prev || data.summary.timestamp > prev.timestamp) {
              localStorage.setItem('duo_grammar_summary_v2', JSON.stringify(data.summary));
              return data.summary;
            }
            return prev;
          });
        }
        setShowToast('雲端資料已同步並合併！');
      } else {
        setShowToast('雲端尚無資料');
      }
    } catch (error) {
      console.error('Pull error:', error);
      setShowToast('載入失敗');
    } finally {
      setIsManualSyncing(false);
    }
  };

  const updateUnitLocation = (id: string, location: string) => {
    setHistory(prev => {
      const newHistory = prev.map(item => item.id === id ? { ...item, duoLocation: location } : item);
      safeLocalStorageSet('duo_grammar_history', JSON.stringify(newHistory.slice(0, 200)));
      return newHistory;
    });
    if (currentAnalysis?.id === id) {
      setCurrentAnalysis(prev => prev ? { ...prev, duoLocation: location } : null);
    }
  };
  const [activeTab, setActiveTab] = useState<'study' | 'practice' | 'summary' | 'flashcards' | 'daily'>('study');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const categories = ['all', ...Array.from(new Set(history.map(item => item.category).filter(Boolean)))];
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isAutoSpeak, setIsAutoSpeak] = useState(true);
  const [isSlowMode, setIsSlowMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null);
  const [penColor, setPenColor] = useState("#1cb0f6");
  const [brushRadius, setBrushRadius] = useState(2);
  const [isHighlighter, setIsHighlighter] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(400);
  const unitRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const canvasRef = useRef<HandwritingCanvasRef>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [globalSummary, setGlobalSummary] = useState<GlobalSummaryData | null>(() => {
    const saved = localStorage.getItem('duo_grammar_summary_v2');
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      if (!parsed.content || !parsed.worksheet) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  });

  const [savedDrawings, setSavedDrawings] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('duo_grammar_drawings');
    return saved ? JSON.parse(saved) : {};
  });

  const saveDrawing = () => {
    if (canvasRef.current && activeDrawingId) {
      const data = canvasRef.current.getSaveData();
      let key = '';
      
      if (activeDrawingId === 'summary' && globalSummary) {
        key = `summary_${globalSummary.timestamp}`;
      } else if (activeDrawingId === 'daily' && dailyStory) {
        key = `daily_${dailyStory.timestamp}`;
      } else if (activeDrawingId !== 'summary' && activeDrawingId !== 'daily') {
        key = `unit_${activeDrawingId}`;
        // Also update history to persist drawing data
        setHistory(prev => {
          const newHistory = prev.map(item => item.id === activeDrawingId ? { ...item, drawingData: data } : item);
          safeLocalStorageSet('duo_grammar_history', JSON.stringify(newHistory.slice(0, 200)));
          return newHistory;
        });
      }
      
      if (key) {
        const newDrawings = { ...savedDrawings, [key]: data };
        setSavedDrawings(newDrawings);
        localStorage.setItem('duo_grammar_drawings', JSON.stringify(newDrawings));
      }
    }
  };

  useEffect(() => {
    if (activeDrawingId && canvasRef.current) {
      let key = '';
      if (activeDrawingId === 'summary' && globalSummary) {
        key = `summary_${globalSummary.timestamp}`;
      } else if (activeDrawingId === 'daily' && dailyStory) {
        key = `daily_${dailyStory.timestamp}`;
      } else if (activeDrawingId !== 'summary' && activeDrawingId !== 'daily') {
        key = `unit_${activeDrawingId}`;
      }
      
      if (key && savedDrawings[key]) {
        setTimeout(() => {
          canvasRef.current.loadSaveData(savedDrawings[key]);
        }, 100);
      } else {
        canvasRef.current.clear();
      }
    }
  }, [activeDrawingId, globalSummary?.timestamp, activeTab]);

  const toggleDrawing = (id?: string) => {
    const targetId = id || 'summary';
    if (activeDrawingId === targetId) {
      saveDrawing();
      setActiveDrawingId(null);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => console.error(err));
      }
    } else {
      setActiveDrawingId(targetId);
      // Enter fullscreen for better note taking experience
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.error(err));
      }
      // Give a small delay to ensure the DOM is ready for measurement
      setTimeout(() => {
        const element = targetId === 'summary' ? unitRefs.current['summary'] : unitRefs.current[targetId];
        if (element) {
          setCanvasHeight(element.scrollHeight + 100);
        }
      }, 100);
    }
  };

  const [summaryHistory, setSummaryHistory] = useState<GlobalSummaryData[]>(() => {
    const saved = localStorage.getItem('duo_summary_history_v1');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      return [];
    }
  });

  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [dailyStory, setDailyStory] = useState<DailyStory | null>(() => {
    const saved = localStorage.getItem('duo_daily_story');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch (e) {
      return null;
    }
  });
  const [isGeneratingDaily, setIsGeneratingDaily] = useState(false);
  const [dailyAnswers, setDailyAnswers] = useState<string[]>([]);
  const [dailyFeedback, setDailyFeedback] = useState<{ [key: number]: string }>({});
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
  const [isWorksheetExpanded, setIsWorksheetExpanded] = useState(true);

  useEffect(() => {
    const targetId = activeDrawingId;
    if (!targetId) return;

    const element = targetId === 'summary' ? unitRefs.current['summary'] : unitRefs.current[targetId];
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setCanvasHeight(entry.target.scrollHeight + 100);
      }
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [activeDrawingId, globalSummary, dailyStory, currentAnalysis]);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [worksheetAnswers, setWorksheetAnswers] = useState<string[]>([]);
  const [worksheetHistory, setWorksheetHistory] = useState<any[]>(() => {
    const saved = localStorage.getItem('duo_worksheet_history');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      return [];
    }
  });
  const [unitChatMessages, setUnitChatMessages] = useState<Record<string, ChatMessage[]>>(() => {
    const saved = localStorage.getItem('duo_grammar_unit_chats');
    if (!saved) return {};
    try {
      return JSON.parse(saved);
    } catch (e) {
      return {};
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isUnitChatting, setIsUnitChatting] = useState<Record<string, boolean>>({});
  const [unitInput, setUnitInput] = useState<Record<string, string>>({});
  const [showToast, setShowToast] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Load from Supabase on mount or user change
  useEffect(() => {
    const loadData = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('duo_grammar_data')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') throw error;
        
        if (data) {
          // Merge History on mount
          if (data.history) {
            setHistory(prev => {
              const mergedMap = new Map<string, AnalysisResult>();
              prev.forEach(item => mergedMap.set(item.id, item));
              data.history.forEach((remoteItem: AnalysisResult) => {
                const localItem = mergedMap.get(remoteItem.id);
                if (!localItem || remoteItem.timestamp > localItem.timestamp) {
                  mergedMap.set(remoteItem.id, remoteItem);
                }
              });
              const merged = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
              safeLocalStorageSet('duo_grammar_history', JSON.stringify(merged.slice(0, 200)));
              return merged;
            });
          }
          // Merge Summary on mount
          if (data.summary) {
            setGlobalSummary(prev => {
              if (!prev || data.summary.timestamp > prev.timestamp) {
                localStorage.setItem('duo_grammar_summary_v2', JSON.stringify(data.summary));
                return data.summary;
              }
              return prev;
            });
          }
        }
      } catch (error) {
        console.error('Error loading from Supabase:', error);
      }
    };
    loadData();
  }, [user]);

  // Sync to Supabase
  useEffect(() => {
    const syncData = async () => {
      if (!user) return;
      if (history.length === 0 && !globalSummary) return;
      
      setSyncStatus('syncing');
      try {
        const { error: historyError } = await supabase
          .from('duo_grammar_data')
          .upsert({ 
            id: user.id, 
            history: history,
            summary: globalSummary,
            updated_at: new Date().toISOString()
          });

        if (historyError) throw historyError;
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 3000);
      } catch (error) {
        console.error('Supabase sync error:', error);
        setSyncStatus('error');
      }
    };

    const timeoutId = setTimeout(syncData, 5000); // Debounce sync
    return () => clearTimeout(timeoutId);
  }, [history, globalSummary, user]);

  const safeLocalStorageSet = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(`LocalStorage save failed for key "${key}":`, e);
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        // If quota exceeded, try to clear some old history
        if (key === 'duo_grammar_history') {
          const history = JSON.parse(value);
          if (history.length > 5) {
            const trimmed = history.slice(0, 5);
            localStorage.setItem(key, JSON.stringify(trimmed));
            return;
          }
        }
        if (key === 'duo_summary_history_v1') {
          const history = JSON.parse(value);
          if (history.length > 3) {
            const trimmed = history.slice(0, 3);
            localStorage.setItem(key, JSON.stringify(trimmed));
            return;
          }
        }
      }
    }
  };

  useEffect(() => {
    // Pre-warm speech synthesis voices
    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Unlock audio context on first interaction
    const unlockAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      // Also try to resume speech synthesis
      window.speechSynthesis.resume();
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  // Persistence
  useEffect(() => {
    safeLocalStorageSet('duo_grammar_history', JSON.stringify(history.slice(0, 200)));
  }, [history]);

  useEffect(() => {
    safeLocalStorageSet('duo_grammar_unit_chats', JSON.stringify(unitChatMessages));
  }, [unitChatMessages]);

  useEffect(() => {
    if (globalSummary) {
      safeLocalStorageSet('duo_grammar_summary_v2', JSON.stringify(globalSummary));
    } else {
      localStorage.removeItem('duo_grammar_summary_v2');
    }
  }, [globalSummary]);

  useEffect(() => {
    safeLocalStorageSet('duo_worksheet_history', JSON.stringify(worksheetHistory.slice(0, 200)));
  }, [worksheetHistory]);

  useEffect(() => {
    safeLocalStorageSet('duo_summary_history_v1', JSON.stringify(summaryHistory.slice(0, 50)));
  }, [summaryHistory]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

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

  const enableAudio = () => {
    try {
      // 1. Unlock Web Audio API
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      // 2. Unlock Speech Synthesis with a silent utterance
      window.speechSynthesis.cancel();
      const silent = new SpeechSynthesisUtterance("");
      silent.volume = 0;
      window.speechSynthesis.speak(silent);

      // 3. Unlock HTML5 Audio
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
      silentAudio.play().catch(() => {});

      setAudioEnabled(true);
      setShowToast("音訊引擎已啟動！");
    } catch (e) {
      console.error("Audio activation failed:", e);
    }
  };

  const speakText = async (text: string, force = false) => {
    if (!isAutoSpeak && !force) return;
    
    // Immediate visual and engine feedback
    setIsSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();

    // Synchronously start a silent utterance to keep the gesture chain alive
    const gestureUnlock = new SpeechSynthesisUtterance("");
    gestureUnlock.volume = 0;
    window.speechSynthesis.speak(gestureUnlock);

    const fallbackSpeak = (t: string) => {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(t);
        utterance.lang = 'fr-FR';
        utterance.rate = isSlowMode ? 0.5 : 0.85;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        const frenchVoice = voices.find(v => v.lang.startsWith('fr') && v.name.includes('Google')) 
                          || voices.find(v => v.lang.startsWith('fr'))
                          || voices[0];
        
        if (frenchVoice) utterance.voice = frenchVoice;
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        console.error("Fallback failed:", error);
        setIsSpeaking(false);
      }
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
      fallbackSpeak(text);
      return;
    }
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      const speedInstruction = isSlowMode ? "Speak very slowly and clearly." : "Speak at a natural, slightly relaxed pace.";
      const prompt = `${speedInstruction} Speak with a warm, friendly, and encouraging tone. Text to speak: ${text}`;

      const ttsPromise = ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TTS Timeout")), 2000)
      );

      const response = await Promise.race([ttsPromise, timeoutPromise]) as any;
      const part = response.candidates?.[0]?.content?.parts?.[0];
      const base64Audio = part?.inlineData?.data;
      
      if (base64Audio) {
        const audioUrl = `data:audio/wav;base64,${base64Audio}`;
        const audio = new Audio(audioUrl);
        audio.volume = 1.0;
        
        audio.onplay = () => setIsSpeaking(true);
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => fallbackSpeak(text);
        
        await audio.play().catch(() => fallbackSpeak(text));
      } else {
        fallbackSpeak(text);
      }
    } catch (error) {
      fallbackSpeak(text);
    }
  };

  const generateGlobalSummary = async () => {
    if (history.length === 0) return;
    // Don't clear globalSummary immediately, keep the old one until new one is ready
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
        ? `學生之前的學習單表現：\n${worksheetHistory.filter(h => h && h.score !== undefined).map(h => `- 分數: ${h.score}/100, 反饋: ${h.feedback}`).join('\n')}\n請特別針對學生之前答錯或不熟悉的觀念進行加強。`
        : "";

      const prompt = `
        你是一個頂尖的法文教學專家，專門輔導學生通過 TCF Canada 考試。
        學生目前已經學習了多個 Duolingo 單元，目標是將這些基礎知識轉化為 TCF Canada 考試所需的實戰能力。
        
        請幫學生將以下所有單元的知識進行「深度系統化統整」，並出一份「TCF Canada 模擬練習學習單」以及「動詞/核心單字閃卡」。
        
        ${historyContext}

        學習內容如下：
        ${allData}

        請回傳 JSON 格式，包含以下欄位：
        1. "content": 深度系統化複習筆記（Markdown 格式）。
           要求：
           - 內容必須豐富詳盡，不能過於簡略。
           - 必須包含以下明確章節：
             - 「💡 核心文法詳解 (Grammar Explanations)」：深入淺出解釋文法規則，並附上對比表格。
             - 「📚 高頻單字與語境 (Vocabulary & Context)」：整理重點單字，每個單字必須附帶一個實用的法文例句與中文翻譯，並說明在 TCF Canada 考試中的常見用法。
             - 「⚠️ 常見錯誤與易混淆點 (Common Errors)」：列出學生容易犯錯的地方，並提供正確範例。
             - 「🎯 TCF Canada 備考建議」：針對目前學習的內容提供實戰考試技巧。
           - 使用豐富的 Markdown 格式（粗體、列表、引用、表格）。
        2. "worksheet": 包含 8 題練習題的陣列。
           要求：
           - 題目設計必須參考 TCF Canada 的題型（例如：Structure de la langue 語法結構、Compréhension écrite 閱讀理解）。
           - 難度應涵蓋 A1 到 B2（視學習內容而定）。
           - 每題包含 "question" (題目), "type" (multiple-choice, fill-in-the-blank, translation), "options" (如果是選擇題), "correctAnswer" (正確答案)。
        3. "flashcards": 包含 10-15 張動詞或核心單字的閃卡陣列。
           要求：
           - 每張閃卡包含 "french" (法文單字/動詞), "meaning" (中文意思), "conjugation" (如果是動詞，請提供現在時主要人稱變位，否則留空), "example" (一個實用的法文例句)。
        
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
              },
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    french: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    conjugation: { type: Type.STRING },
                    example: { type: Type.STRING }
                  },
                  required: ["french", "meaning", "example"]
                }
              }
            },
            required: ["content", "worksheet", "flashcards"]
          }
        }
      });

      const data = safeJsonParse(response.text || "{}", { content: "", worksheet: [], flashcards: [] });
      
      if (!data.content || !Array.isArray(data.worksheet)) {
        throw new Error("AI 回傳格式不正確，無法生成總結。");
      }

      const newSummary: GlobalSummaryData = {
        content: data.content,
        timestamp: Date.now(),
        worksheet: data.worksheet,
        flashcards: data.flashcards
      };

      setGlobalSummary(newSummary);
      setSummaryHistory(prev => [newSummary, ...prev]);
      setWorksheetAnswers(new Array(data.worksheet.length).fill(''));
      setCurrentFlashcardIndex(0);
      setIsCardFlipped(false);
    } catch (error) {
      console.error("Summary generation failed:", error);
      alert("生成總結時發生錯誤，請稍後再試。");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const generateDailyStory = async () => {
    if (history.length === 0) {
      setShowToast("請先上傳一些單元內容再生成短文");
      return;
    }
    setIsGeneratingDaily(true);
    setActiveTab('daily');
    setDailyFeedback({});

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";

      const allVocab = Array.from(new Set(history.flatMap(item => item.vocabulary))).join(', ');
      const allGrammar = history.map(item => item.grammar).join('; ');

      const prompt = `
        你是一個專業的法文老師。請根據學生目前學過的單字和文法，編寫一篇約 100 字的法文短文。
        
        學生學過的單字：${allVocab}
        學生學過的文法：${allGrammar}
        
        要求：
        1. 短文內容要有趣且生活化。
        2. 盡量使用學生學過的單字。
        3. 提供短文的中文翻譯。
        4. 從短文中挑選 5 個重點單字進行複習。
        5. 設計 3 題造句練習，讓學生練習運用短文中的句型。
        
        請回傳 JSON 格式：
        {
          "title": "短文標題",
          "story": "法文短文內容",
          "translation": "中文翻譯",
          "vocabulary": [{"word": "單字", "meaning": "意思"}],
          "sentencePractice": [{"prompt": "造句提示(中文)", "answer": "參考答案(法文)", "hint": "提示(法文關鍵字)"}]
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
              title: { type: Type.STRING },
              story: { type: Type.STRING },
              translation: { type: Type.STRING },
              vocabulary: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    meaning: { type: Type.STRING }
                  }
                }
              },
              sentencePractice: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    prompt: { type: Type.STRING },
                    answer: { type: Type.STRING },
                    hint: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["title", "story", "translation", "vocabulary", "sentencePractice"]
          }
        }
      });

      const data = JSON.parse(response.text || '{}');
      const newStory = { ...data, timestamp: Date.now() };
      setDailyStory(newStory);
      setDailyAnswers(new Array(data.sentencePractice.length).fill(''));
      safeLocalStorageSet('duo_daily_story', JSON.stringify(newStory));
      setShowToast("每日短文生成成功！");
    } catch (error) {
      console.error("Failed to generate daily story:", error);
      setShowToast("生成每日短文失敗，請稍後再試");
    } finally {
      setIsGeneratingDaily(false);
    }
  };

  const checkSentencePractice = async (index: number) => {
    if (!dailyStory || !dailyAnswers[index]) return;
    
    const userMsg = dailyAnswers[index];
    const correctMsg = dailyStory.sentencePractice[index].answer;
    
    setIsGrading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";
      
      const prompt = `
        學生正在進行法文造句練習。
        題目提示：${dailyStory.sentencePractice[index].prompt}
        參考答案：${correctMsg}
        學生回答：${userMsg}
        
        請批改學生的句子，判斷是否正確（意思相近且語法正確即可）。
        請回傳 JSON：
        {
          "isCorrect": boolean,
          "feedback": "簡短的中文反饋與建議"
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
              isCorrect: { type: Type.BOOLEAN },
              feedback: { type: Type.STRING }
            }
          }
        }
      });
      
      const result = JSON.parse(response.text || '{}');
      setDailyFeedback(prev => ({ ...prev, [index]: result.feedback }));
    } catch (error) {
      console.error("Failed to check sentence:", error);
    } finally {
      setIsGrading(false);
    }
  };

  const gradeWorksheet = async () => {
    if (!globalSummary || !globalSummary.worksheet || worksheetAnswers.some(a => !a.trim())) {
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
        ${globalSummary.worksheet.filter(q => q && q.question).map((q, i) => `${i+1}. ${q.question}\n正確答案: ${q.correctAnswer}`).join('\n')}
        
        學生的回答：
        ${worksheetAnswers.map((a, i) => `${i+1}. ${a}`).join('\n')}
        
        請給出：
        1. 總分 (0-100)。
        2. 每題的詳細批改建議與解析，並指出該題對應的 TCF Canada 考點。請務必使用清晰的列表格式，每一項建議之間要有明顯的斷行。
        3. 針對 TCF Canada 考試的整體學習建議與弱點加強方案。
        4. 如果學生有動詞變位或單字錯誤，請在建議中明確提到可以使用「動詞閃卡」功能進行專項練習。
        
        注意：在 "feedback" 欄位中，請使用豐富的 Markdown 格式（如 ### 標題、* 列表、> 引用），並確保段落之間有足夠的空行（\n\n），以確保排版整潔易讀。
        
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
      setSummaryHistory(prev => prev.map(s => s.timestamp === globalSummary.timestamp ? updatedSummary : s));
      
      setWorksheetHistory(prev => [{
        timestamp: Date.now(),
        score: data.score,
        feedback: data.feedback
      }, ...prev].slice(0, 50)); // Keep last 50
      
    } catch (error) {
      console.error("Grading failed:", error);
      alert("批改失敗，請稍後再試。");
    } finally {
      setIsGrading(false);
    }
  };

  const resizeImage = (file: File, maxWidth = 400, maxHeight = 400): Promise<string> => {
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
          3. **單元整合**：單字跟語法解釋不要分區塊，要成為一個完整的學習單元。
          4. **重點單字**：每個重點單字必須附帶一個實用的法文例句與中文翻譯。
          5. **格式要求**：務必回傳純 JSON 陣列，不要有 Markdown 區塊。
          
          回傳格式：
          [
            {
              "title": "單元標題",
              "lessonText": "完整法文原文",
              "vocabulary": ["單字 - 解釋 - 例句 (必須包含完整法文例句與中文翻譯)"],
              "grammar": "核心文法摘要",
              "practicePrompt": "口語練習開場白",
              "fullMarkdown": "# 學習筆記\\n\\n## 📝 課文原文\\n...\\n\\n## 💡 核心學習單元 (單字與語法整合解析)\\n請將單字與對應的語法點整合在一起說明，不要分開成兩個大區塊。例如：在解釋一個動詞時，同時說明它的變位規則與例句。\\n\\n## ⚠️ 常見錯誤 (Common Errors)\\n...\\n\\n## 🌟 重點單字 (Key Vocabulary)\\n請在此處列出本課最重要的單字，每個單字需包含：單字 - 解釋 - 實用法文例句與中文翻譯。",
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
            "vocabulary": ["單字 - 解釋 - 實用法文例句"],
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
        
        任務：
        1. **單元整合**：單字跟語法解釋不要分區塊，要成為一個完整的學習單元。
        2. **重點單字**：每個重點單字必須附帶一個實用的法文例句與中文翻譯。
        
        數據：${combinedData}
        
        回傳格式：
        [
          {
            "title": "單元標題",
            "lessonText": "完整法文原文",
            "vocabulary": ["單字 - 解釋 - 例句 (必須包含完整法文例句與中文翻譯)"],
            "grammar": "核心文法摘要",
            "practicePrompt": "口語練習開場白",
            "fullMarkdown": "# 學習筆記\\n\\n## 📝 課文原文\\n...\\n\\n## 💡 核心學習單元 (單字與語法整合解析)\\n請將單字與對應的語法點整合在一起說明，不要分開成兩個大區塊。\\n\\n## ⚠️ 常見錯誤 (Common Errors)\\n...\\n\\n## 🌟 重點單字 (Key Vocabulary)\\n請在此處列出本課最重要的單字，每個單字需包含：單字 - 解釋 - 實用法文例句與中文翻譯。",
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
        你是一個非常有耐心且友善的法文老師。學生目前正在使用 Duolingo 學習，並已經上傳了以下單元的內容：
        ${allLessonsContext}
        
        你的任務是與學生進行「綜合口語對話練習」，但必須嚴格遵守以下規則：
        1. **精準匹配程度**：觀察學生上傳的單元內容，這代表了他們目前的法文水平。**絕對不要**使用遠超這些單元範圍的複雜語法（如虛擬式、複雜時態）或生僻單字。
        2. **循序漸進**：如果學生上傳的單元不多，請將對話難度設定在 A1 初級水平。使用簡單、短小的句子，並圍繞學過的單元話題展開。
        3. **雙語輔助**：請主要使用法文與學生對話，但如果句子稍長，請務必在括號中附上繁體中文翻譯。
        4. **糾錯與鼓勵**：當學生出錯時，用溫柔的方式糾正他們，並鼓勵他們嘗試使用學過的單元單字。
        5. **主動引導**：如果學生不知道說什麼，請主動根據學過的單元內容拋出一個簡單的問題。
        
        目前的對話目標：讓學生在不感到壓力的情況下，練習運用已學過的知識。
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
              <div className="flex items-center gap-2">
                <p className="text-[10px] uppercase tracking-[0.2em] font-black text-duo-gray">Companion Pro</p>
                {syncStatus !== 'idle' && (
                  <div className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider transition-all",
                    syncStatus === 'syncing' && "bg-duo-blue/10 text-duo-blue animate-pulse",
                    syncStatus === 'success' && "bg-duo-green/10 text-duo-green",
                    syncStatus === 'error' && "bg-duo-red/10 text-duo-red"
                  )}>
                    {syncStatus === 'syncing' && <Loader2 className="w-2 h-2 animate-spin" />}
                    {syncStatus === 'success' && <CheckCircle2 className="w-2 h-2" />}
                    {syncStatus === 'error' && <AlertCircle className="w-2 h-2" />}
                    {syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'success' ? 'Synced' : 'Sync Error'}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            {!audioEnabled && (
              <button 
                onClick={enableAudio}
                className="flex items-center gap-2 px-4 py-2 bg-duo-blue text-white rounded-xl text-xs font-black hover:bg-duo-blue/90 transition-all shadow-lg shadow-duo-blue/25 animate-bounce"
              >
                <Volume2 className="w-4 h-4" />
                啟動音訊
              </button>
            )}
            <div className="hidden md:flex bg-duo-light/50 p-1 rounded-2xl border border-duo-border">
                <button 
                  onClick={() => setActiveTab('study')}
                  disabled={!currentAnalysis}
                  className={cn(
                    "px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200",
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
                    "px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'summary' ? "bg-white text-duo-yellow shadow-sm" : "text-duo-gray hover:text-duo-dark"
                  )}
                >
                  知識庫統整
                </button>
                <button 
                  onClick={() => {
                    setActiveTab('practice');
                    if (chatMessages.length === 0 && history.length > 0) {
                      const welcome = "Bonjour ! 我已經看過你上傳的所有單元了。別擔心，我會配合你目前的進度，用簡單的法文陪你練習。準備好開始聊聊了嗎？ (Prêt à commencer ?)";
                      setChatMessages([{ role: 'model', text: welcome }]);
                      speakText(welcome);
                    }
                  }}
                  className={cn(
                    "px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'practice' ? "bg-white text-duo-green shadow-sm" : "text-duo-gray hover:text-duo-dark"
                  )}
                >
                  綜合口語練習
                </button>
                <button 
                  onClick={() => {
                    if (!globalSummary) {
                      generateGlobalSummary();
                    } else {
                      setActiveTab('flashcards');
                    }
                  }}
                  className={cn(
                    "px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'flashcards' ? "bg-white text-duo-red shadow-sm" : "text-duo-gray hover:text-duo-dark"
                  )}
                >
                  動詞閃卡
                </button>
                <button 
                  onClick={() => {
                    if (!dailyStory) {
                      generateDailyStory();
                    } else {
                      setActiveTab('daily');
                    }
                  }}
                  className={cn(
                    "px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200",
                    activeTab === 'daily' ? "bg-white text-duo-blue shadow-sm" : "text-duo-gray hover:text-duo-dark"
                  )}
                >
                  每日閱讀
                </button>
              </div>
            <div className="flex items-center gap-2">
              {user ? (
                <div className="flex items-center gap-1 sm:gap-2">
                  <div className="hidden lg:flex flex-col items-end mr-2">
                    <span className="text-[8px] font-black text-duo-gray uppercase tracking-wider">已登入</span>
                    <span className="text-[10px] font-bold text-duo-dark truncate max-w-[100px]">{user.email}</span>
                  </div>
                  <button 
                    onClick={syncToCloud}
                    disabled={isManualSyncing}
                    className={cn(
                      "p-2.5 rounded-xl transition-all relative group",
                      syncStatus === 'error' ? "bg-duo-red/10 text-duo-red" : "hover:bg-duo-light text-duo-gray"
                    )}
                    title="同步至雲端"
                  >
                    <RefreshCw className={cn("w-5 h-5 group-hover:text-duo-blue transition-colors", isManualSyncing && "animate-spin text-duo-blue")} />
                  </button>
                  <button 
                    onClick={pullFromCloud}
                    disabled={isManualSyncing}
                    className="p-2.5 hover:bg-duo-light rounded-xl transition-all text-duo-gray hover:text-duo-blue"
                    title="從雲端載入"
                  >
                    <CloudDownload className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleLogout}
                    className="p-2.5 hover:bg-duo-red/10 rounded-xl transition-all text-duo-gray hover:text-duo-red"
                    title="登出"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-duo-border text-duo-blue rounded-xl text-xs font-black hover:bg-duo-light transition-all shadow-sm"
                >
                  <LogIn className="w-4 h-4" />
                  <span className="hidden sm:inline">登入同步</span>
                </button>
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
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Upload & Image */}
          <div className="lg:col-span-3 space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative aspect-[4/5] max-h-[320px] w-full bg-white border-4 border-dashed border-duo-border rounded-[32px] flex flex-col items-center justify-center cursor-pointer transition-all hover:border-duo-blue group overflow-hidden shadow-sm hover:shadow-xl hover:shadow-duo-blue/5",
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
                className="duo-card p-5 border-duo-blue shadow-lg shadow-duo-blue/5 space-y-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border-2 border-duo-border bg-duo-light shadow-inner flex items-center justify-center">
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
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2 py-0.5 bg-duo-blue/10 text-duo-blue text-[10px] font-black rounded-md uppercase tracking-wider">Active Unit</span>
                    </div>
                    <h3 className="font-black text-duo-dark truncate text-xl font-display leading-tight">{currentAnalysis.title}</h3>
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="relative group/input">
                        <input 
                          type="text"
                          placeholder="輸入章節 (如: 第1章 第5節)"
                          value={currentAnalysis.duoLocation || ''}
                          onChange={(e) => updateUnitLocation(currentAnalysis.id, e.target.value)}
                          className="w-full bg-duo-light/50 border-2 border-duo-border/50 rounded-lg px-3 py-1.5 text-xs font-bold text-duo-dark focus:border-duo-blue/50 focus:bg-white transition-all outline-none placeholder:text-duo-gray/50"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                          <Search className="w-3 h-3 text-duo-gray/30 group-focus-within/input:text-duo-blue/50" />
                        </div>
                      </div>
                      <p className="text-[10px] font-bold text-duo-gray uppercase tracking-widest flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-duo-yellow" />
                        提取於 {new Date(currentAnalysis.timestamp).toLocaleDateString()}
                      </p>
                    </div>
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
          <div className="lg:col-span-9 space-y-6">
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
                <button 
                  onClick={() => {
                    if (!globalSummary) {
                      generateGlobalSummary();
                    } else {
                      setActiveTab('flashcards');
                    }
                  }}
                  className={cn(
                    "flex-shrink-0 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                    activeTab === 'flashcards' ? "bg-white text-duo-red shadow-md" : "text-duo-gray"
                  )}
                >
                  閃卡
                </button>
                <button 
                  onClick={() => {
                    if (!dailyStory) {
                      generateDailyStory();
                    } else {
                      setActiveTab('daily');
                    }
                  }}
                  className={cn(
                    "flex-shrink-0 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                    activeTab === 'daily' ? "bg-white text-duo-blue shadow-md" : "text-duo-gray"
                  )}
                >
                  閱讀
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
                  className="duo-card p-4 sm:p-8 lg:p-12 shadow-xl shadow-duo-yellow/5 min-h-[600px]"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 pb-6 border-b-2 border-duo-border/50 gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-duo-yellow rounded-2xl flex items-center justify-center shadow-lg shadow-duo-yellow/20">
                        <Sparkles className="text-white w-7 h-7" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-extrabold text-duo-dark font-display">語法知識庫統整</h2>
                        {globalSummary && (
                          <div className="flex items-center gap-3 mt-1">
                            <p className="text-xs font-bold text-duo-gray uppercase tracking-wider">
                              產出時間：{new Date(globalSummary.timestamp).toLocaleString()}
                            </p>
                            <button 
                              onClick={() => toggleDrawing('summary')}
                              className={cn(
                                "flex items-center gap-1.5 px-3 py-1 rounded-lg font-black text-[10px] transition-all shadow-sm border-2",
                                activeDrawingId === 'summary' 
                                  ? "bg-duo-blue text-white border-duo-blue" 
                                  : "bg-white text-duo-blue border-duo-border hover:border-duo-blue/30"
                              )}
                            >
                              {activeDrawingId === 'summary' ? <Save className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                              {activeDrawingId === 'summary' ? "儲存筆記" : "手寫筆記"}
                            </button>
                          </div>
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
                    <button 
                      onClick={() => {
                        if (globalSummary) {
                          safeLocalStorageSet('duo_grammar_summary_v2', JSON.stringify(globalSummary));
                          safeLocalStorageSet('duo_summary_history_v1', JSON.stringify(summaryHistory.slice(0, 50)));
                          setShowToast("總結筆記已成功儲存！");
                        }
                      }}
                      className="text-sm font-bold text-duo-green hover:text-duo-green/80 transition-colors bg-duo-green/5 px-4 py-2 rounded-xl flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      手動儲存
                    </button>
                    {summaryHistory.length > 0 && (
                      <div className="flex items-center gap-2 bg-duo-light p-1.5 rounded-xl border border-duo-border">
                        <History className="w-3.5 h-3.5 text-duo-gray ml-1" />
                        <select 
                          className="bg-transparent text-xs font-bold text-duo-dark focus:outline-none pr-2 py-0.5 cursor-pointer"
                          value={globalSummary?.timestamp || ''}
                          onChange={(e) => {
                            const selected = summaryHistory.find(s => s.timestamp === Number(e.target.value));
                            if (selected) {
                              setGlobalSummary(selected);
                              setWorksheetAnswers(selected.userAnswers || new Array(selected.worksheet.length).fill(''));
                              setCurrentFlashcardIndex(0);
                              setIsCardFlipped(false);
                            }
                          }}
                        >
                          {summaryHistory.map(s => (
                            <option key={s.timestamp} value={s.timestamp}>
                              歷史總結：{new Date(s.timestamp).toLocaleDateString()} {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="space-y-12">
                    {globalSummary && globalSummary.content ? (
                      <>
                        <div className="bg-duo-light/30 rounded-[32px] border-2 border-duo-border overflow-hidden">
                          <div 
                            onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                            className="w-full px-8 py-6 flex items-center justify-between hover:bg-duo-light/50 transition-colors group cursor-pointer"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border-2 border-duo-border group-hover:border-duo-blue/30 transition-colors">
                                <BookOpen className="w-5 h-5 text-duo-blue" />
                              </div>
                              <span className="text-xl font-extrabold text-duo-dark font-display">系統化筆記內容</span>
                            </div>
                            <div className={cn("transition-transform duration-300", !isSummaryExpanded && "rotate-180")}>
                              <ChevronUp className="w-6 h-6 text-duo-gray" />
                            </div>
                          </div>
                          
                          <motion.div 
                            initial={false}
                            animate={{ height: isSummaryExpanded ? 'auto' : 0, opacity: isSummaryExpanded ? 1 : 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 sm:p-8 pt-0 border-t-2 border-duo-border/30">
                              <div className={cn(
                                "relative mt-6 min-h-[400px]",
                                activeDrawingId === 'summary' && "fixed inset-0 z-[100] bg-duo-light p-4 sm:p-10 overflow-auto"
                              )}>
                                {/* Drawing Toolbar */}
                                  {activeDrawingId === 'summary' && (
                                      <div className="fixed top-4 right-4 sm:top-10 sm:right-10 z-[110] flex flex-col gap-2 p-2 bg-white/90 backdrop-blur-md rounded-2xl border-2 border-duo-border shadow-xl">
                                        <button 
                                          onClick={() => { setPenColor("#1cb0f6"); setIsHighlighter(false); }}
                                          className={cn("w-8 h-8 rounded-full border-2", penColor === "#1cb0f6" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                                          style={{ backgroundColor: "#1cb0f6" }}
                                        />
                                        <button 
                                          onClick={() => { setPenColor("#ff4b4b"); setIsHighlighter(false); }}
                                          className={cn("w-8 h-8 rounded-full border-2", penColor === "#ff4b4b" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                                          style={{ backgroundColor: "#ff4b4b" }}
                                        />
                                        <button 
                                          onClick={() => { setPenColor("#58cc02"); setIsHighlighter(false); }}
                                          className={cn("w-8 h-8 rounded-full border-2", penColor === "#58cc02" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                                          style={{ backgroundColor: "#58cc02" }}
                                        />
                                        <div className="w-full h-0.5 bg-duo-border my-1" />
                                        <button 
                                          onClick={() => { setPenColor("#ffeb3b"); setIsHighlighter(true); }}
                                          className={cn("p-2 rounded-xl transition-all border-2", isHighlighter && penColor === "#ffeb3b" ? "bg-yellow-100 border-yellow-400 text-yellow-600" : "bg-white border-duo-border text-duo-gray")}
                                          title="黃色螢光筆"
                                        >
                                          <Highlighter className="w-5 h-5" />
                                        </button>
                                        <button 
                                          onClick={() => { setPenColor("transparent"); setIsHighlighter(false); }}
                                          className={cn("p-2 rounded-xl transition-all border-2", penColor === "transparent" ? "bg-duo-blue/10 border-duo-blue text-duo-blue" : "bg-white border-duo-border text-duo-gray")}
                                          title="橡皮擦"
                                        >
                                          <Eraser className="w-5 h-5" />
                                        </button>
                                    <div className="w-full h-0.5 bg-duo-border my-1" />
                                    <div className="flex flex-col items-center gap-1 py-1">
                                      <span className="text-[8px] font-black text-duo-gray">粗細</span>
                                      <input 
                                        type="range" 
                                        min="1" 
                                        max="10" 
                                        value={brushRadius} 
                                        onChange={(e) => setBrushRadius(parseInt(e.target.value))}
                                        className="w-12 h-1 bg-duo-border rounded-lg appearance-none cursor-pointer accent-duo-blue"
                                      />
                                    </div>
                                    <div className="w-full h-0.5 bg-duo-border my-1" />
                                    <button 
                                      onClick={() => canvasRef.current?.undo()}
                                      className="p-2 hover:bg-duo-light rounded-xl text-duo-gray transition-all"
                                      title="復原"
                                    >
                                      <History className="w-5 h-5" />
                                    </button>
                                    <button 
                                      onClick={() => canvasRef.current?.clear()}
                                      className="p-2 hover:bg-duo-red/10 text-duo-red rounded-xl transition-all"
                                      title="清除全部"
                                    >
                                      <Trash2 className="w-5 h-5" />
                                    </button>
                                    <div className="w-full h-0.5 bg-duo-border my-1" />
                                    <button 
                                      onClick={() => toggleDrawing('summary')}
                                      className="p-2 bg-duo-green text-white rounded-xl shadow-lg hover:scale-110 transition-all"
                                      title="儲存並關閉"
                                    >
                                      <Save className="w-5 h-5" />
                                    </button>
                                  </div>
                                )}

                                {activeDrawingId === 'summary' && (
                                  <div className="absolute -top-6 left-0 z-30 flex items-center gap-2 px-4 py-2 bg-duo-blue/10 text-duo-blue rounded-xl text-[10px] font-bold animate-pulse">
                                    <History className="w-3 h-3" />
                                    手寫模式已開啟
                                  </div>
                                )}

                                <div ref={el => { unitRefs.current['summary'] = el; }} className="markdown-body relative z-10">
                                  <Markdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      table: (props) => (
                                        <div className="w-full overflow-x-auto my-6 border-2 border-duo-border rounded-2xl shadow-sm bg-white no-scrollbar">
                                          <table className="w-full border-collapse min-w-[500px]" {...props} />
                                        </div>
                                      ),
                                      th: (props) => (
                                        <th className="p-3 sm:p-5 text-left text-[10px] sm:text-xs font-black text-duo-gray uppercase tracking-widest border-b-2 border-duo-border bg-duo-light whitespace-nowrap" {...props} />
                                      ),
                                      td: (props) => (
                                        <td className="p-3 sm:p-5 text-xs sm:text-sm text-duo-dark border-b border-duo-border bg-white break-words font-medium" {...props} />
                                      )
                                    }}
                                  >
                                    {globalSummary.content}
                                  </Markdown>
                                </div>

                                {activeDrawingId === 'summary' && (
                                  <div className="absolute top-0 left-0 w-full z-20 pointer-events-auto select-none" style={{ height: canvasHeight, background: 'transparent' }}>
                                    <HandwritingCanvas
                                      ref={canvasRef}
                                      color={penColor}
                                      radius={brushRadius}
                                      isHighlighter={isHighlighter}
                                      width="100%"
                                      height={canvasHeight}
                                      className="handwriting-canvas"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        </div>

                        {/* Worksheet Section */}
                        {globalSummary.worksheet && Array.isArray(globalSummary.worksheet) && globalSummary.worksheet.length > 0 && (
                          <div className="mt-16 pt-12 border-t-4 border-duo-border/30">
                            <button 
                              onClick={() => setIsWorksheetExpanded(!isWorksheetExpanded)}
                              className="w-full flex items-center justify-between mb-10 group"
                            >
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-duo-blue rounded-2xl flex items-center justify-center shadow-lg shadow-duo-blue/20 group-hover:scale-110 transition-transform">
                                  <ClipboardCheck className="text-white w-7 h-7" />
                                </div>
                                <div className="text-left">
                                  <h3 className="text-2xl font-extrabold text-duo-dark font-display">今日複習學習單</h3>
                                  <p className="text-sm font-bold text-duo-gray">根據你學過的內容自動生成的練習題</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-6">
                                {globalSummary.score !== undefined && (
                                  <div className="flex items-center gap-3 bg-duo-green/10 px-6 py-3 rounded-2xl border-2 border-duo-green/20">
                                    <CheckCircle2 className="w-6 h-6 text-duo-green" />
                                    <span className="text-2xl font-black text-duo-green">{globalSummary.score} / 100</span>
                                  </div>
                                )}
                                <div className={cn("transition-transform duration-300", !isWorksheetExpanded && "rotate-180")}>
                                  <ChevronUp className="w-6 h-6 text-duo-gray" />
                                </div>
                              </div>
                            </button>

                            <motion.div
                              initial={false}
                              animate={{ height: isWorksheetExpanded ? 'auto' : 0, opacity: isWorksheetExpanded ? 1 : 0 }}
                              className="overflow-hidden"
                            >
                              <div className="space-y-8">
                                {globalSummary.worksheet.map((q, idx) => {
                                  if (!q) return null;
                                  return (
                                    <div key={idx} className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-duo-border shadow-sm">
                                      <div className="flex items-start gap-3 sm:gap-4 mb-6">
                                        <span className="w-8 h-8 sm:w-10 sm:h-10 bg-duo-light rounded-xl flex items-center justify-center font-black text-duo-gray flex-shrink-0 text-sm sm:text-base">
                                          {idx + 1}
                                        </span>
                                        <p className="text-lg sm:text-xl font-bold text-duo-dark pt-1">{q.question || "未命名題目"}</p>
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
                                              globalSummary.score !== undefined && worksheetAnswers[idx]?.toLowerCase().trim() === q.correctAnswer?.toLowerCase().trim() && "border-duo-green bg-duo-green/5",
                                              globalSummary.score !== undefined && worksheetAnswers[idx]?.toLowerCase().trim() !== q.correctAnswer?.toLowerCase().trim() && "border-duo-red bg-duo-red/5"
                                            )}
                                          />
                                          {globalSummary.score !== undefined && worksheetAnswers[idx]?.toLowerCase().trim() !== q.correctAnswer?.toLowerCase().trim() && (
                                            <p className="mt-3 text-sm font-bold text-duo-green flex items-center gap-2">
                                              <CheckCircle2 className="w-4 h-4" />
                                              正確答案：{q.correctAnswer}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {globalSummary.score === undefined ? (
                                <div className="mt-12 flex justify-center">
                                  <button
                                    onClick={gradeWorksheet}
                                    disabled={isGrading || worksheetAnswers.some(a => !a?.trim())}
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
                                  className="mt-16 bg-white rounded-[40px] border-4 border-duo-green/30 shadow-2xl shadow-duo-green/5 relative overflow-hidden"
                                >
                                  <div className="absolute top-0 right-0 p-8 opacity-5">
                                    <CheckCircle2 className="w-48 h-48 text-duo-green" />
                                  </div>
                                  
                                  <div className="relative z-10">
                                    <div className="bg-duo-green p-8 flex items-center gap-6">
                                      <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30">
                                        <Sparkles className="text-white w-9 h-9" />
                                      </div>
                                      <div>
                                        <h4 className="text-3xl font-black text-white font-display">老師的批改與建議</h4>
                                        <p className="text-white/80 font-bold text-sm mt-1 uppercase tracking-widest">TCF Canada 備考專屬反饋</p>
                                      </div>
                                    </div>
                                    
                                    <div className="p-8 sm:p-12">
                                      <div className="markdown-body feedback-markdown">
                                        <Markdown 
                                          remarkPlugins={[remarkGfm]}
                                          components={{
                                            table: (props) => (
                                              <div className="w-full overflow-x-auto my-6 border-2 border-duo-border rounded-2xl shadow-sm bg-white no-scrollbar">
                                                <table className="w-full border-collapse min-w-[500px]" {...props} />
                                              </div>
                                            ),
                                            th: (props) => (
                                              <th className="p-3 sm:p-5 text-left text-[10px] sm:text-xs font-black text-duo-gray uppercase tracking-widest border-b-2 border-duo-border bg-duo-light whitespace-nowrap" {...props} />
                                            ),
                                            td: (props) => (
                                              <td className="p-3 sm:p-5 text-xs sm:text-sm text-duo-dark border-b border-duo-border bg-white break-words font-medium" {...props} />
                                            ),
                                            blockquote: (props) => (
                                              <blockquote className="border-l-4 sm:border-l-8 border-duo-green bg-duo-green/5 p-4 sm:p-6 rounded-r-2xl sm:rounded-r-3xl my-6 sm:my-8 italic font-medium text-duo-dark" {...props} />
                                            )
                                          }}
                                        >
                                          {globalSummary.feedback || ""}
                                        </Markdown>
                                      </div>
                                      
                                      <div className="mt-12 pt-10 border-t-2 border-duo-border/50 flex flex-col sm:flex-row items-center justify-between gap-8">
                                        <div className="flex items-center gap-4 bg-duo-light px-6 py-4 rounded-2xl border-2 border-duo-border/50">
                                          <AlertCircle className="w-6 h-6 text-duo-blue" />
                                          <p className="text-sm font-extrabold text-duo-dark">下次統整時，我會特別加強你這次答錯的部分。</p>
                                        </div>
                                        <button
                                          onClick={generateGlobalSummary}
                                          className="duo-button-blue px-8 py-4 text-sm flex items-center gap-3"
                                        >
                                          <RefreshCw className="w-4 h-4" />
                                          產出新的複習內容
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </motion.div>
                          </div>
                        )}
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
              ) : activeTab === 'flashcards' ? (
                <motion.div 
                  key="flashcards"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="duo-card p-8 sm:p-12 shadow-xl shadow-duo-red/5 min-h-[600px] flex flex-col"
                >
                  <div className="flex items-center justify-between mb-10 pb-6 border-b-2 border-duo-border/50">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-duo-red rounded-2xl flex items-center justify-center shadow-lg shadow-duo-red/20">
                        <BookOpen className="text-white w-7 h-7" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-extrabold text-duo-dark font-display">動詞/核心單字閃卡</h2>
                        <p className="text-sm font-bold text-duo-gray">點擊卡片翻面，練習法文動詞變位與意思</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setIsSlowMode(!isSlowMode)}
                        className={cn(
                          "px-4 py-2 rounded-xl transition-all duration-300 flex items-center gap-2 border-2",
                          isSlowMode 
                            ? "bg-duo-yellow/10 border-duo-yellow text-duo-yellow" 
                            : "bg-white border-duo-border text-duo-gray hover:border-duo-blue/30"
                        )}
                      >
                        <span className="text-xs font-black uppercase tracking-wider">
                          {isSlowMode ? "慢速 0.5x" : "正常 0.85x"}
                        </span>
                      </button>
                      <div className="text-right">
                        <p className="text-xs font-black text-duo-gray uppercase tracking-widest">進度</p>
                        <p className="text-lg font-black text-duo-red">
                          {globalSummary?.flashcards ? currentFlashcardIndex + 1 : 0} / {globalSummary?.flashcards?.length || 0}
                        </p>
                      </div>
                    </div>
                  </div>

                  {globalSummary?.flashcards && globalSummary.flashcards.length > 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-12 py-10">
                      <div 
                        className="relative w-full max-w-[500px] aspect-[4/3] perspective-1000 cursor-pointer group"
                        onClick={() => setIsCardFlipped(!isCardFlipped)}
                      >
                        <motion.div
                          animate={{ rotateY: isCardFlipped ? 180 : 0 }}
                          transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
                          className="w-full h-full relative preserve-3d"
                        >
                          {/* Front */}
                          <div className="absolute inset-0 backface-hidden bg-white border-4 border-duo-border rounded-[40px] flex flex-col items-center justify-center p-10 shadow-xl group-hover:shadow-2xl transition-shadow">
                            <span className="text-xs font-black text-duo-gray uppercase tracking-[0.2em] mb-6">法文單字 / 動詞</span>
                            <h3 className="text-5xl sm:text-6xl font-black text-duo-dark text-center leading-tight">
                              {globalSummary.flashcards[currentFlashcardIndex].french}
                            </h3>
                            <div className="mt-10 flex items-center gap-3">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  speakText(globalSummary.flashcards[currentFlashcardIndex].french);
                                }}
                                className={cn(
                                  "p-3 rounded-2xl transition-all",
                                  isSpeaking ? "bg-duo-blue/20 text-duo-blue animate-pulse" : "text-duo-blue hover:bg-duo-blue/10"
                                )}
                              >
                                <Volume2 className="w-6 h-6" />
                              </button>
                              <span className="text-sm font-bold text-duo-blue">點擊翻面查看解釋</span>
                            </div>
                          </div>

                          {/* Back */}
                          <div className="absolute inset-0 backface-hidden bg-duo-light border-4 border-duo-blue/30 rounded-[40px] flex flex-col items-center justify-center p-10 shadow-xl rotate-y-180">
                            <div className="w-full space-y-6 text-center">
                              <div>
                                <span className="text-xs font-black text-duo-gray uppercase tracking-[0.2em] block mb-2">中文意思</span>
                                <p className="text-3xl font-black text-duo-dark">
                                  {globalSummary.flashcards[currentFlashcardIndex].meaning}
                                </p>
                              </div>
                              
                              {globalSummary.flashcards[currentFlashcardIndex].conjugation && (
                                <div className="bg-white/50 p-4 rounded-2xl border border-duo-border">
                                  <span className="text-xs font-black text-duo-blue uppercase tracking-[0.2em] block mb-2">動詞變位 (現在時)</span>
                                  <p className="text-sm font-bold text-duo-dark whitespace-pre-line leading-relaxed">
                                    {globalSummary.flashcards[currentFlashcardIndex].conjugation}
                                  </p>
                                </div>
                              )}

                              <div>
                                <span className="text-xs font-black text-duo-gray uppercase tracking-[0.2em] block mb-2">實用例句</span>
                                <p className="text-base font-bold text-duo-dark italic">
                                  "{globalSummary.flashcards[currentFlashcardIndex].example}"
                                </p>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      </div>

                      <div className="flex items-center gap-6">
                        <button
                          onClick={() => {
                            setIsCardFlipped(false);
                            setCurrentFlashcardIndex(prev => Math.max(0, prev - 1));
                          }}
                          disabled={currentFlashcardIndex === 0}
                          className="w-16 h-16 rounded-2xl bg-white border-2 border-duo-border flex items-center justify-center text-duo-gray hover:text-duo-blue hover:border-duo-blue transition-all disabled:opacity-30"
                        >
                          <ChevronRight className="w-8 h-8 rotate-180" />
                        </button>
                        
                        <button
                          onClick={() => setIsCardFlipped(!isCardFlipped)}
                          className="px-10 py-4 rounded-2xl bg-duo-blue text-white font-black uppercase tracking-widest shadow-lg shadow-duo-blue/20 hover:scale-105 transition-all"
                        >
                          翻轉卡片
                        </button>

                        <button
                          onClick={() => {
                            setIsCardFlipped(false);
                            setCurrentFlashcardIndex(prev => Math.min(globalSummary.flashcards!.length - 1, prev + 1));
                          }}
                          disabled={currentFlashcardIndex === globalSummary.flashcards.length - 1}
                          className="w-16 h-16 rounded-2xl bg-white border-2 border-duo-border flex items-center justify-center text-duo-gray hover:text-duo-blue hover:border-duo-blue transition-all disabled:opacity-30"
                        >
                          <ChevronRight className="w-8 h-8" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                      <div className="w-20 h-20 bg-duo-light rounded-full flex items-center justify-center mb-6">
                        <BookOpen className="w-10 h-10 text-duo-border" />
                      </div>
                      <h3 className="text-xl font-black text-duo-dark mb-2">尚未生成閃卡</h3>
                      <p className="text-duo-gray font-bold max-w-md">
                        請先點擊「知識庫統整」來生成包含閃卡的複習內容。
                      </p>
                      <button 
                        onClick={generateGlobalSummary}
                        className="mt-8 duo-button-yellow px-8 py-3"
                      >
                        立即生成統整
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : activeTab === 'daily' ? (
                <motion.div 
                  key="daily"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="duo-card p-8 sm:p-12 shadow-xl shadow-duo-blue/5 min-h-[600px]"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-10 pb-6 border-b-2 border-duo-border/50 gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-duo-blue rounded-2xl flex items-center justify-center shadow-lg shadow-duo-blue/20">
                        <PenLine className="text-white w-7 h-7" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-extrabold text-duo-dark font-display">每日法文短文</h2>
                        <p className="text-sm font-bold text-duo-gray">根據你累積的單字量身打造的閱讀與造句練習</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => toggleDrawing('daily')}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs transition-all shadow-sm border-2",
                          activeDrawingId === 'daily' 
                            ? "bg-duo-blue text-white border-duo-blue" 
                            : "bg-white text-duo-blue border-duo-border hover:border-duo-blue/30"
                        )}
                      >
                        {activeDrawingId === 'daily' ? <Save className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                        {activeDrawingId === 'daily' ? "儲存筆記" : "手寫筆記"}
                      </button>
                      <button 
                        onClick={() => setIsSlowMode(!isSlowMode)}
                        className={cn(
                          "px-4 py-2 rounded-xl transition-all duration-300 flex items-center gap-2 border-2",
                          isSlowMode 
                            ? "bg-duo-yellow/10 border-duo-yellow text-duo-yellow" 
                            : "bg-white border-duo-border text-duo-gray hover:border-duo-blue/30"
                        )}
                      >
                        <span className="text-xs font-black uppercase tracking-wider">
                          {isSlowMode ? "慢速 0.5x" : "正常 0.85x"}
                        </span>
                      </button>
                      <button 
                        onClick={generateDailyStory}
                        disabled={isGeneratingDaily}
                        className="text-sm font-bold text-duo-blue hover:text-duo-blue/80 transition-colors bg-duo-blue/5 px-4 py-2 rounded-xl flex items-center gap-2"
                      >
                        <RefreshCw className={cn("w-4 h-4", isGeneratingDaily && "animate-spin")} />
                        產出新短文
                      </button>
                    </div>
                  </div>

                  {isGeneratingDaily ? (
                    <div className="flex flex-col items-center justify-center py-32 space-y-6">
                      <Loader2 className="w-12 h-12 text-duo-blue animate-spin" />
                      <p className="text-duo-gray font-bold animate-pulse">正在為你編寫專屬短文...</p>
                    </div>
                  ) : dailyStory ? (
                    <div 
                      ref={el => { unitRefs.current['daily'] = el; }}
                      className={cn(
                        "space-y-12 relative",
                        activeDrawingId === 'daily' && "fixed inset-0 z-[100] bg-duo-light p-4 sm:p-10 overflow-auto"
                      )}
                    >
                      {activeDrawingId === 'daily' && (
                        <div className="flex items-center justify-between mb-6 bg-white p-4 rounded-2xl border-2 border-duo-border shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-duo-blue rounded-xl flex items-center justify-center">
                              <Pencil className="text-white w-5 h-5" />
                            </div>
                            <h3 className="text-xl font-black text-duo-dark font-display">筆記模式：{dailyStory.title}</h3>
                          </div>
                          <button 
                            onClick={() => toggleDrawing('daily')}
                            className="duo-button-primary px-6 py-2 text-sm"
                          >
                            完成並儲存
                          </button>
                        </div>
                      )}

                      <div className="relative">
                        {/* Drawing Toolbar for Daily Story */}
                        {activeDrawingId === 'daily' && (
                          <div className="fixed top-24 right-10 z-[110] flex flex-col gap-2 p-2 bg-white/90 backdrop-blur-md rounded-2xl border-2 border-duo-border shadow-xl">
                            <button 
                              onClick={() => { setPenColor("#1cb0f6"); setIsHighlighter(false); }}
                              className={cn("w-8 h-8 rounded-full border-2", penColor === "#1cb0f6" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                              style={{ backgroundColor: "#1cb0f6" }}
                            />
                            <button 
                              onClick={() => { setPenColor("#ff4b4b"); setIsHighlighter(false); }}
                              className={cn("w-8 h-8 rounded-full border-2", penColor === "#ff4b4b" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                              style={{ backgroundColor: "#ff4b4b" }}
                            />
                            <button 
                              onClick={() => { setPenColor("#58cc02"); setIsHighlighter(false); }}
                              className={cn("w-8 h-8 rounded-full border-2", penColor === "#58cc02" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                              style={{ backgroundColor: "#58cc02" }}
                            />
                            <div className="w-full h-0.5 bg-duo-border my-1" />
                            <button 
                              onClick={() => { setPenColor("#ffeb3b"); setIsHighlighter(true); }}
                              className={cn("p-2 rounded-xl transition-all border-2", isHighlighter && penColor === "#ffeb3b" ? "bg-yellow-100 border-yellow-400 text-yellow-600" : "bg-white border-duo-border text-duo-gray")}
                              title="黃色螢光筆"
                            >
                              <Highlighter className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => { setPenColor("transparent"); setIsHighlighter(false); }}
                              className={cn("p-2 rounded-xl transition-all border-2", penColor === "transparent" ? "bg-duo-blue/10 border-duo-blue text-duo-blue" : "bg-white border-duo-border text-duo-gray")}
                              title="橡皮擦"
                            >
                              <Eraser className="w-5 h-5" />
                            </button>
                            <div className="w-full h-0.5 bg-duo-border my-1" />
                            <div className="flex flex-col items-center gap-1 py-1">
                              <span className="text-[8px] font-black text-duo-gray">粗細</span>
                              <input 
                                type="range" 
                                min="1" 
                                max="10" 
                                value={brushRadius} 
                                onChange={(e) => setBrushRadius(parseInt(e.target.value))}
                                className="w-12 h-1 bg-duo-border rounded-lg appearance-none cursor-pointer accent-duo-blue"
                              />
                            </div>
                            <div className="w-full h-0.5 bg-duo-border my-1" />
                            <button 
                              onClick={() => canvasRef.current?.undo()}
                              className="p-2 hover:bg-duo-light rounded-xl text-duo-gray transition-all"
                              title="復原"
                            >
                              <History className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => canvasRef.current?.clear()}
                              className="p-2 hover:bg-duo-red/10 text-duo-red rounded-xl transition-all"
                              title="清除全部"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        )}

                        <div 
                          className="space-y-12 relative z-10"
                        >
                          {/* Story Section */}
                          <div className="bg-duo-light/30 rounded-[32px] border-2 border-duo-border p-8 sm:p-10">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-2xl font-black text-duo-dark font-display">{dailyStory.title}</h3>
                          <button 
                            onClick={() => speakText(dailyStory.story)}
                            className={cn(
                              "w-12 h-12 rounded-2xl border-2 flex items-center justify-center transition-all shadow-sm",
                              isSpeaking 
                                ? "bg-duo-blue/20 border-duo-blue text-duo-blue animate-pulse" 
                                : "bg-white border-duo-border text-duo-blue hover:bg-duo-blue hover:text-white"
                            )}
                          >
                            <Volume2 className="w-6 h-6" />
                          </button>
                        </div>
                        <p className="text-xl sm:text-2xl font-bold text-duo-dark leading-relaxed mb-8">
                          {dailyStory.story}
                        </p>
                        <div className="pt-6 border-t-2 border-duo-border/50">
                          <p className="text-duo-gray font-medium italic leading-relaxed">
                            {dailyStory.translation}
                          </p>
                        </div>
                      </div>

                      {/* Vocabulary Section */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {dailyStory.vocabulary.map((v, i) => (
                          <div key={i} className="bg-white p-5 rounded-2xl border-2 border-duo-border shadow-sm flex items-center justify-between group hover:border-duo-blue/30 transition-all min-w-0 overflow-hidden">
                            <div className="min-w-0 flex-1 mr-4 overflow-hidden">
                              <p className="text-lg font-black text-duo-dark group-hover:text-duo-blue transition-colors truncate w-full">{v.word}</p>
                              <p className="text-sm font-bold text-duo-gray break-words line-clamp-2 w-full">{v.meaning}</p>
                            </div>
                            <button 
                              onClick={() => speakText(v.word)} 
                              className={cn(
                                "p-3 rounded-xl transition-all flex-shrink-0",
                                isSpeaking ? "bg-duo-blue/20 text-duo-blue animate-pulse" : "text-duo-gray hover:text-duo-blue hover:bg-duo-blue/5"
                              )}
                            >
                              <Volume2 className="w-5 h-5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Sentence Practice Section */}
                      <div className="space-y-8 pt-8 border-t-4 border-duo-border/30">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-duo-green rounded-xl flex items-center justify-center">
                            <ClipboardCheck className="text-white w-6 h-6" />
                          </div>
                          <h3 className="text-2xl font-extrabold text-duo-dark font-display">造句練習</h3>
                        </div>

                        <div className="space-y-6">
                          {dailyStory.sentencePractice.map((p, i) => (
                            <div key={i} className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-duo-border shadow-sm">
                              <div className="flex items-start gap-4 mb-4">
                                <span className="w-8 h-8 bg-duo-light rounded-lg flex items-center justify-center font-black text-duo-gray flex-shrink-0 text-sm">
                                  {i + 1}
                                </span>
                                <div>
                                  <p className="text-lg font-bold text-duo-dark">{p.prompt}</p>
                                  <p className="text-xs font-bold text-duo-blue mt-1 uppercase tracking-wider">提示：{p.hint}</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <input 
                                  type="text"
                                  value={dailyAnswers[i] || ''}
                                  onChange={(e) => {
                                    const newAnswers = [...dailyAnswers];
                                    newAnswers[i] = e.target.value;
                                    setDailyAnswers(newAnswers);
                                  }}
                                  placeholder="用法文造句..."
                                  className="flex-1 bg-duo-light border-2 border-duo-border rounded-2xl px-6 py-3 text-base font-bold focus:outline-none focus:border-duo-blue transition-all"
                                />
                                <button 
                                  onClick={() => checkSentencePractice(i)}
                                  disabled={!dailyAnswers[i]?.trim() || isGrading}
                                  className="duo-button-green px-6 py-3 text-sm flex items-center gap-2"
                                >
                                  {isGrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                  檢查
                                </button>
                              </div>
                              {dailyFeedback[i] && (
                                <motion.div 
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="mt-4 p-4 bg-duo-blue/5 rounded-2xl border border-duo-blue/20 text-sm font-bold text-duo-dark"
                                >
                                  <div className="flex items-start gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-duo-blue mt-0.5 flex-shrink-0" />
                                    <p>{dailyFeedback[i]}</p>
                                  </div>
                                  <p className="mt-2 text-xs text-duo-gray">參考答案：{p.answer}</p>
                                </motion.div>
                              )}
                            </div>
                          ))}
                        </div>

                        {activeDrawingId === 'daily' && (
                          <div className="absolute top-0 left-0 w-full z-20 pointer-events-auto select-none" style={{ height: canvasHeight, background: 'transparent' }}>
                            <HandwritingCanvas
                              ref={canvasRef}
                              color={penColor}
                              radius={brushRadius}
                              isHighlighter={isHighlighter}
                              width="100%"
                              height={canvasHeight}
                              className="handwriting-canvas"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                      <div className="w-20 h-20 bg-duo-light rounded-full flex items-center justify-center mb-6">
                        <PenLine className="w-10 h-10 text-duo-border" />
                      </div>
                      <h3 className="text-xl font-black text-duo-dark mb-2">尚未生成每日短文</h3>
                      <p className="text-duo-gray font-bold max-w-md">
                        我會根據你目前學過的單字量身打造一篇短文，幫助你練習閱讀與造句。
                      </p>
                      <button 
                        onClick={generateDailyStory}
                        className="mt-8 duo-button-blue px-8 py-3"
                      >
                        立即生成短文
                      </button>
                    </div>
                  )}
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
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border-2 border-duo-border/50 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-duo-blue/10 rounded-lg flex items-center justify-center">
                          <BookOpen className="w-4 h-4 text-duo-blue" />
                        </div>
                        <span className="text-sm font-bold text-duo-dark">已學習單元 ({history.length})</span>
                      </div>
                      
                      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                        {categories.map(cat => (
                          <button
                            key={cat}
                            onClick={() => setSelectedCategory(cat || 'all')}
                            className={cn(
                              "px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border-2 whitespace-nowrap",
                              selectedCategory === cat 
                                ? "bg-duo-blue border-duo-blue text-white shadow-md" 
                                : "bg-white border-duo-border text-duo-gray hover:border-duo-blue/30"
                            )}
                          >
                            {cat === 'all' ? '全部' : cat}
                          </button>
                        ))}
                      </div>

                      <button 
                        onClick={() => setIsSlowMode(!isSlowMode)}
                        className={cn(
                          "px-4 py-2 rounded-xl transition-all duration-300 flex items-center gap-2 border-2",
                          isSlowMode 
                            ? "bg-duo-yellow/10 border-duo-yellow text-duo-yellow" 
                            : "bg-white border-duo-border text-duo-gray hover:border-duo-blue/30"
                        )}
                      >
                        <span className="text-xs font-black uppercase tracking-wider">
                          {isSlowMode ? "慢速 0.5x" : "正常 0.85x"}
                        </span>
                      </button>
                    </div>
                    {history
                      .filter(item => selectedCategory === 'all' || item.category === selectedCategory)
                      .map((item) => (
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
                              <div className={cn(
                                "p-6 sm:p-12 space-y-10 bg-gradient-to-b from-white to-duo-light/30 relative",
                                activeDrawingId === item.id && "fixed inset-0 z-[100] bg-duo-light p-4 sm:p-10 overflow-auto"
                              )}>
                                {/* Category & Handwriting Control */}
                                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/50 p-4 rounded-2xl border-2 border-duo-border/50">
                                    <div className="flex items-center gap-3 w-full sm:w-auto">
                                      <div className="w-8 h-8 bg-duo-blue/10 rounded-lg flex items-center justify-center">
                                        <History className="w-4 h-4 text-duo-blue" />
                                      </div>
                                      <div className="flex-1 sm:flex-none">
                                        <input 
                                          type="text"
                                          placeholder="設定分類 (例如: 形容詞)"
                                          className="w-full sm:w-48 bg-transparent text-sm font-bold text-duo-dark focus:outline-none border-b-2 border-duo-border focus:border-duo-blue transition-colors px-1 py-0.5"
                                          value={item.category || ''}
                                          onChange={(e) => {
                                            const newCat = e.target.value;
                                            setHistory(prev => {
                                              const newHistory = prev.map(h => h.id === item.id ? { ...h, category: newCat } : h);
                                              safeLocalStorageSet('duo_grammar_history', JSON.stringify(newHistory.slice(0, 200)));
                                              return newHistory;
                                            });
                                          }}
                                        />
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                      <button 
                                        onClick={() => {
                                          if (editingId === item.id) {
                                            setHistory(prev => {
                                              const newHistory = prev.map(h => h.id === item.id ? { ...h, explanation: editContent } : h);
                                              safeLocalStorageSet('duo_grammar_history', JSON.stringify(newHistory.slice(0, 200)));
                                              return newHistory;
                                            });
                                            setEditingId(null);
                                            setShowToast('內容已儲存');
                                          } else {
                                            setEditingId(item.id);
                                            setEditContent(item.explanation);
                                          }
                                        }}
                                        className={cn(
                                          "flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm transition-all border-2",
                                          editingId === item.id ? "bg-duo-green text-white border-duo-green" : "bg-white text-duo-gray border-duo-border hover:border-duo-blue/30"
                                        )}
                                      >
                                        {editingId === item.id ? <Save className="w-4 h-4" /> : <PenLine className="w-4 h-4" />}
                                        {editingId === item.id ? "儲存文字" : "編輯文字"}
                                      </button>

                                      <button 
                                        onClick={() => restructureWithAI(item)}
                                        disabled={isRestructuring === item.id}
                                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm bg-white text-duo-blue border-2 border-duo-border hover:border-duo-blue/30 transition-all disabled:opacity-50"
                                      >
                                        {isRestructuring === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                        AI 優化格式
                                      </button>

                                      <button 
                                        onClick={() => toggleDrawing(item.id)}
                                        className={cn(
                                          "flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm transition-all shadow-sm border-2",
                                          activeDrawingId === item.id 
                                            ? "bg-duo-blue text-white border-duo-blue" 
                                            : "bg-white text-duo-blue border-duo-border hover:border-duo-blue/30"
                                        )}
                                      >
                                        {activeDrawingId === item.id ? <Save className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
                                        {activeDrawingId === item.id ? "儲存筆記" : "手寫筆記"}
                                      </button>
                                    </div>
                                  </div>

                                <div className={cn(
                                  "relative min-h-[400px]",
                                  activeDrawingId === item.id && "fixed inset-0 z-[100] bg-duo-light p-4 sm:p-10 overflow-auto"
                                )}>
                                  {/* Drawing Toolbar */}
                                  {activeDrawingId === item.id && (
                                    <div className="fixed top-4 right-4 sm:top-10 sm:right-10 z-[110] flex flex-col gap-2 p-2 bg-white/90 backdrop-blur-md rounded-2xl border-2 border-duo-border shadow-xl">
                                      <button 
                                        onClick={() => { setPenColor("#1cb0f6"); setIsHighlighter(false); }}
                                        className={cn("w-8 h-8 rounded-full border-2", penColor === "#1cb0f6" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                                        style={{ backgroundColor: "#1cb0f6" }}
                                      />
                                      <button 
                                        onClick={() => { setPenColor("#ff4b4b"); setIsHighlighter(false); }}
                                        className={cn("w-8 h-8 rounded-full border-2", penColor === "#ff4b4b" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                                        style={{ backgroundColor: "#ff4b4b" }}
                                      />
                                      <button 
                                        onClick={() => { setPenColor("#58cc02"); setIsHighlighter(false); }}
                                        className={cn("w-8 h-8 rounded-full border-2", penColor === "#58cc02" && !isHighlighter ? "border-duo-dark scale-110" : "border-transparent")}
                                        style={{ backgroundColor: "#58cc02" }}
                                      />
                                      <div className="w-full h-0.5 bg-duo-border my-1" />
                                      <button 
                                        onClick={() => { setPenColor("#ffeb3b"); setIsHighlighter(true); }}
                                        className={cn("p-2 rounded-xl transition-all border-2", isHighlighter && penColor === "#ffeb3b" ? "bg-yellow-100 border-yellow-400 text-yellow-600" : "bg-white border-duo-border text-duo-gray")}
                                        title="黃色螢光筆"
                                      >
                                        <Highlighter className="w-5 h-5" />
                                      </button>
                                      <button 
                                        onClick={() => { setPenColor("transparent"); setIsHighlighter(false); }}
                                        className={cn("p-2 rounded-xl transition-all border-2", penColor === "transparent" ? "bg-duo-blue/10 border-duo-blue text-duo-blue" : "bg-white border-duo-border text-duo-gray")}
                                        title="橡皮擦"
                                      >
                                        <Eraser className="w-5 h-5" />
                                      </button>
                                      <div className="w-full h-0.5 bg-duo-border my-1" />
                                      <div className="flex flex-col items-center gap-1 py-1">
                                        <span className="text-[8px] font-black text-duo-gray">粗細</span>
                                        <input 
                                          type="range" 
                                          min="1" 
                                          max="10" 
                                          value={brushRadius} 
                                          onChange={(e) => setBrushRadius(parseInt(e.target.value))}
                                          className="w-12 h-1 bg-duo-border rounded-lg appearance-none cursor-pointer accent-duo-blue"
                                        />
                                      </div>
                                      <div className="w-full h-0.5 bg-duo-border my-1" />
                                      <button 
                                        onClick={() => canvasRef.current?.undo()}
                                        className="p-2 hover:bg-duo-light rounded-xl text-duo-gray transition-all"
                                        title="復原"
                                      >
                                        <History className="w-5 h-5" />
                                      </button>
                                      <button 
                                        onClick={() => canvasRef.current?.clear()}
                                        className="p-2 hover:bg-duo-red/10 text-duo-red rounded-xl transition-all"
                                        title="清除全部"
                                      >
                                        <Trash2 className="w-5 h-5" />
                                      </button>
                                      <div className="w-full h-0.5 bg-duo-border my-1" />
                                      <button 
                                        onClick={() => toggleDrawing(item.id)}
                                        className="p-2 bg-duo-green text-white rounded-xl shadow-lg hover:scale-110 transition-all"
                                        title="儲存並關閉"
                                      >
                                        <Save className="w-5 h-5" />
                                      </button>
                                    </div>
                                  )}

                                  {activeDrawingId === item.id && (
                                    <div className="absolute -top-6 left-0 z-30 flex items-center gap-2 px-4 py-2 bg-duo-blue/10 text-duo-blue rounded-xl text-[10px] font-bold animate-pulse">
                                      <History className="w-3 h-3" />
                                      手寫模式已開啟
                                    </div>
                                  )}

                                  <div 
                                    ref={el => { unitRefs.current[item.id] = el; }} 
                                    className="markdown-body relative z-10"
                                  >
                                    {editingId === item.id ? (
                                      <div className="bg-white rounded-[32px] p-8 border-2 border-duo-border shadow-sm">
                                        <textarea
                                          className="w-full h-[600px] p-4 text-duo-dark font-mono text-sm bg-duo-light/30 rounded-2xl border-2 border-duo-border focus:border-duo-blue focus:outline-none transition-colors resize-none"
                                          value={editContent}
                                          onChange={(e) => setEditContent(e.target.value)}
                                          placeholder="在此編輯 Markdown 內容..."
                                        />
                                        <div className="mt-4 flex justify-end">
                                          <button 
                                            onClick={() => {
                                              setHistory(prev => {
                                                const newHistory = prev.map(h => h.id === item.id ? { ...h, explanation: editContent } : h);
                                                safeLocalStorageSet('duo_grammar_history', JSON.stringify(newHistory.slice(0, 200)));
                                                return newHistory;
                                              });
                                              setEditingId(null);
                                              setShowToast('內容已儲存');
                                            }}
                                            className="flex items-center gap-2 px-6 py-2 bg-duo-green text-white rounded-xl font-black shadow-sm hover:scale-105 transition-all"
                                          >
                                            <Save className="w-4 h-4" />
                                            儲存變更
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        {/* Original Text Section */}
                                        {item.lessonText && (
                                          <div className="bg-white rounded-[32px] p-8 border-2 border-duo-border relative group shadow-sm hover:shadow-md transition-shadow mb-10">
                                            <div className="flex items-center justify-between mb-6">
                                              <h4 className="text-xs font-black text-duo-gray uppercase tracking-[0.2em] flex items-center gap-2.5">
                                                <div className="w-2 h-2 bg-duo-blue rounded-full animate-pulse" />
                                                課文原文
                                              </h4>
                                              <button 
                                                onClick={() => speakText(item.lessonText, true)}
                                                className={cn(
                                                  "p-3 rounded-2xl shadow-sm transition-all hover:scale-110 active:scale-95",
                                                  isSpeaking 
                                                    ? "bg-duo-blue/20 text-duo-blue animate-pulse border-2 border-duo-blue" 
                                                    : "bg-duo-light text-duo-blue hover:bg-duo-blue hover:text-white"
                                                )}
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

                                        <Markdown
                                          remarkPlugins={[remarkGfm]}
                                          components={{
                                            table: (props) => (
                                              <div className="w-full overflow-x-auto my-6 border-2 border-duo-border rounded-2xl shadow-sm bg-white no-scrollbar">
                                                <table className="w-full border-collapse min-w-[500px]" {...props} />
                                              </div>
                                            ),
                                            th: (props) => (
                                              <th className="p-3 sm:p-5 text-left text-[10px] sm:text-xs font-black text-duo-gray uppercase tracking-widest border-b-2 border-duo-border bg-duo-light whitespace-nowrap" {...props} />
                                            ),
                                            td: (props) => (
                                              <td className="p-3 sm:p-5 text-xs sm:text-sm text-duo-dark border-b border-duo-border bg-white break-words font-medium" {...props} />
                                            )
                                          }}
                                        >
                                          {item.explanation}
                                        </Markdown>

                                        {/* Vocabulary Section Moved Down */}
                                        <div className="mt-12 pt-10 border-t-4 border-duo-border/30">
                                          <div className="flex items-center gap-3 mb-6">
                                            <div className="w-10 h-10 bg-duo-blue/10 rounded-xl flex items-center justify-center">
                                              <Volume2 className="w-5 h-5 text-duo-blue" />
                                            </div>
                                            <h4 className="font-extrabold text-lg font-display">本課重點單字</h4>
                                          </div>
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {item.vocabulary.map((v, i) => {
                                              const parts = v.split('-').map(p => p.trim());
                                              const word = parts[0] || "";
                                              const meaning = parts[1] || "";
                                              const sentence = parts[2] || "";
                                              
                                              return (
                                                <div 
                                                  key={i} 
                                                  className="bg-white p-5 rounded-2xl border-2 border-duo-border shadow-sm flex flex-col gap-3 group hover:border-duo-blue/30 transition-all"
                                                >
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex flex-col">
                                                      <span className="text-xl font-black text-duo-dark group-hover:text-duo-blue transition-colors">
                                                        {word}
                                                      </span>
                                                      <span className="text-sm font-bold text-duo-gray">{meaning}</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                      <button 
                                                        onClick={() => speakText(word, true)}
                                                        className="p-3 bg-duo-blue/10 rounded-xl text-duo-blue hover:bg-duo-blue hover:text-white transition-all shadow-sm flex flex-col items-center gap-1"
                                                        title="唸單字"
                                                      >
                                                        <Volume2 className="w-5 h-5" />
                                                        <span className="text-[8px] font-black uppercase">Word</span>
                                                      </button>
                                                    </div>
                                                  </div>
                                                  
                                                  {sentence && (
                                                    <div className="pt-3 border-t border-duo-border/50 flex items-start justify-between gap-3">
                                                      <p className="text-sm font-medium text-duo-dark italic leading-relaxed flex-1">
                                                        {sentence}
                                                      </p>
                                                      <div className="flex flex-col gap-2">
                                                        <button 
                                                          onClick={() => {
                                                            const frSentence = sentence.split(/[（(]/)[0].trim();
                                                            speakText(frSentence, true);
                                                          }}
                                                          className="p-2 bg-duo-green/10 rounded-lg text-duo-green hover:bg-duo-green hover:text-white transition-all flex-shrink-0 shadow-sm flex flex-col items-center gap-1"
                                                          title="唸例句"
                                                        >
                                                          <Volume2 className="w-4 h-4" />
                                                          <span className="text-[8px] font-black uppercase">Sent</span>
                                                        </button>
                                                        <button 
                                                          onClick={() => {
                                                            const frSentence = sentence.split(/[（(]/)[0].trim();
                                                            speakText(`${word}. ${frSentence}`, true);
                                                          }}
                                                          className="p-2 bg-duo-yellow/10 rounded-lg text-duo-yellow hover:bg-duo-yellow hover:text-white transition-all flex-shrink-0 shadow-sm flex flex-col items-center gap-1"
                                                          title="唸全部"
                                                        >
                                                          <Volume2 className="w-4 h-4" />
                                                          <span className="text-[8px] font-black uppercase">Both</span>
                                                        </button>
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>

                                    {activeDrawingId === item.id && (
                                      <div className="absolute top-0 left-0 w-full z-20 pointer-events-auto select-none" style={{ height: canvasHeight, background: 'transparent' }}>
                                        <HandwritingCanvas
                                          ref={canvasRef}
                                          color={penColor}
                                          radius={brushRadius}
                                          isHighlighter={isHighlighter}
                                          width="100%"
                                          height={canvasHeight}
                                          className="handwriting-canvas"
                                        />
                                      </div>
                                    )}
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
                                              <Markdown remarkPlugins={[remarkGfm]}>{msg.text || ""}</Markdown>
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
                            "px-4 py-2 rounded-xl transition-all duration-300 flex items-center gap-2 border-2",
                            isSlowMode 
                              ? "bg-duo-yellow/10 border-duo-yellow text-duo-yellow" 
                              : "bg-white border-duo-border text-duo-gray hover:border-duo-blue/30"
                          )}
                        >
                          <span className="text-xs font-black uppercase tracking-wider">
                            {isSlowMode ? "慢速 0.5x" : "正常 0.85x"}
                          </span>
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
                                className={cn(
                                  "mt-0.5 p-1.5 rounded-xl transition-all",
                                  isSpeaking 
                                    ? "bg-duo-blue/20 text-duo-blue animate-pulse" 
                                    : "hover:bg-duo-light text-duo-blue"
                                )}
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
                      <div className="flex items-center gap-4 mt-2">
                        <button 
                          onClick={() => {
                            if (confirm("確定要清除所有學習紀錄嗎？")) {
                              setHistory([]);
                              setCurrentAnalysis(null);
                              setGlobalSummary(null);
                            }
                          }}
                          className="text-[10px] font-black text-duo-red hover:underline flex items-center gap-1.5 uppercase tracking-widest"
                        >
                          <Trash2 className="w-3 h-3" /> 清除全部
                        </button>
                        <button 
                          onClick={() => {
                            safeLocalStorageSet('duo_grammar_history', JSON.stringify(history.slice(0, 200)));
                            setShowToast("學習紀錄已成功儲存！");
                          }}
                          className="text-[10px] font-black text-duo-green hover:underline flex items-center gap-1.5 uppercase tracking-widest"
                        >
                          <Save className="w-3 h-3" /> 手動儲存
                        </button>
                      </div>
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
                    item.lessonText.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (item.duoLocation && item.duoLocation.toLowerCase().includes(searchQuery.toLowerCase()))
                  ).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-10">
                    <p className="text-duo-gray font-bold">找不到符合的結果</p>
                  </div>
                ) : (
                  history
                    .filter(item => 
                      item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                      item.lessonText.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (item.duoLocation && item.duoLocation.toLowerCase().includes(searchQuery.toLowerCase()))
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
                          <div className="flex items-center gap-2 mt-1">
                            {item.duoLocation && (
                              <span className="px-1.5 py-0.5 bg-duo-green/10 text-duo-green text-[9px] font-black rounded uppercase tracking-wider">
                                {item.duoLocation}
                              </span>
                            )}
                            <p className="text-[10px] font-bold text-duo-gray uppercase tracking-wider">{new Date(item.timestamp).toLocaleString()}</p>
                          </div>
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
      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-duo-dark/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] border-4 border-duo-border shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-black text-duo-blue font-display">
                    {authMode === 'login' ? '歡迎回來' : '建立帳號'}
                  </h2>
                  <button onClick={() => setShowAuthModal(false)} className="p-2 text-duo-gray hover:bg-duo-light rounded-xl">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <form onSubmit={handleAuth} className="space-y-4">
                  <div>
                    <label className="block text-xs font-black text-duo-gray uppercase tracking-widest mb-2">電子郵件</label>
                    <input 
                      type="email" 
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-duo-light border-2 border-duo-border rounded-2xl font-bold focus:outline-none focus:border-duo-blue transition-colors"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-duo-gray uppercase tracking-widest mb-2">密碼</label>
                    <input 
                      type="password" 
                      required
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full px-4 py-3 bg-duo-light border-2 border-duo-border rounded-2xl font-bold focus:outline-none focus:border-duo-blue transition-colors"
                      placeholder="••••••••"
                    />
                  </div>
                  
                  <button 
                    type="submit"
                    disabled={isAuthLoading}
                    className="w-full py-4 bg-duo-blue text-white rounded-2xl font-black shadow-lg shadow-duo-blue/25 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isAuthLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : (authMode === 'login' ? '登入' : '註冊')}
                  </button>
                </form>
                
                <div className="mt-6 text-center">
                  <button 
                    onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                    className="text-sm font-bold text-duo-gray hover:text-duo-blue transition-colors"
                  >
                    {authMode === 'login' ? '還沒有帳號？點此註冊' : '已有帳號？點此登入'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-10 left-1/2 z-50 bg-duo-dark text-white px-8 py-4 rounded-2xl shadow-2xl font-bold flex items-center gap-3 border border-white/10"
          >
            <CheckCircle2 className="w-5 h-5 text-duo-green" />
            {showToast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
