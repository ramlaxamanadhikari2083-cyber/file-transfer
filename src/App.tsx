import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Download,
  QrCode,
  Clipboard,
  Trash2,
  Shield,
  Info,
  HelpCircle,
  HardDrive,
  RefreshCw,
  Volume2,
  VolumeX,
  FileText,
  CheckCircle,
  Clock,
  Laptop,
  Smartphone,
  Check,
  AlertCircle,
  FolderOpen,
  Share2,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import QrScanner from "./components/QrScanner";
import QrCodeDisplay from "./components/QrCodeDisplay";

// API base URL for standard environment variable injection (e.g., via Netlify dashboard)
const API_BASE = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

// Helper: Speak announcements in Nepali, Hindi, and English sequentially or individually
function speakAnnouncements(
  messages: { ne: string; hi: string; en: string },
  isMuted: boolean,
  langMode: "all" | "ne" | "hi" | "en"
) {
  if (isMuted || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel(); // clear currently running speech

    const voices = window.speechSynthesis.getVoices();

    // Helper to find voice with fallback priority
    const findVoice = (langs: string[]) => {
      for (const lang of langs) {
        const found = voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang.toLowerCase()));
        if (found) return found;
      }
      return null;
    };

    const nepaliVoice = findVoice(["ne", "hi"]); // fallback to Hindi if no native Nepali voice
    const hindiVoice = findVoice(["hi", "ne"]); // fallback to Nepali if no native Hindi voice
    const englishVoice = findVoice(["en"]);

    // Create an array of utterances to be played in sequence
    const queue: SpeechSynthesisUtterance[] = [];

    if (langMode === "ne" || langMode === "all") {
      const utterance = new SpeechSynthesisUtterance(messages.ne);
      utterance.lang = "ne-NP";
      utterance.rate = 0.82; // slightly slower for better clarity
      if (nepaliVoice) utterance.voice = nepaliVoice;
      queue.push(utterance);
    }

    if (langMode === "hi" || langMode === "all") {
      const utterance = new SpeechSynthesisUtterance(messages.hi);
      utterance.lang = "hi-IN";
      utterance.rate = 0.85;
      if (hindiVoice) utterance.voice = hindiVoice;
      queue.push(utterance);
    }

    if (langMode === "en" || langMode === "all") {
      const utterance = new SpeechSynthesisUtterance(messages.en);
      utterance.lang = "en-US";
      utterance.rate = 0.90;
      if (englishVoice) utterance.voice = englishVoice;
      queue.push(utterance);
    }

    // Connect the utterances sequentially
    for (let i = 0; i < queue.length - 1; i++) {
      queue[i].onend = () => {
        // Double check that window.speechSynthesis is still active and hasn't been cancelled
        if ("speechSynthesis" in window && !window.speechSynthesis.paused) {
          window.speechSynthesis.speak(queue[i + 1]);
        }
      };
    }

    // Play the first utterance
    if (queue.length > 0) {
      window.speechSynthesis.speak(queue[0]);
    }
  } catch (error) {
    console.error("Speech synthesis failed", error);
  }
}

// Helper: Format bytes cleanly
function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

interface TransferHistoryItem {
  code: string;
  name: string;
  size: number;
  type: "send" | "receive";
  timestamp: number;
}

export default function App() {
  // Navigation / View Tabs
  const [activeTab, setActiveTab] = useState<"send" | "receive" | "history">("send");

  // Global status and preferences
  const [backendStatus, setBackendStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [activeSharesCount, setActiveSharesCount] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [announcementLang, setAnnouncementLang] = useState<"all" | "ne" | "hi" | "en">("all");
  const [timeStr, setTimeStr] = useState<string>("");

  // Wrapper to speak in currently selected language mode
  const announce = (messages: { ne: string; hi: string; en: string }) => {
    speakAnnouncements(messages, isMuted, announcementLang);
  };

  // Sender States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedInfo, setUploadedInfo] = useState<{
    code: string;
    name: string;
    size: number;
    createdAt: number;
  } | null>(null);
  const [receiverDownloaded, setReceiverDownloaded] = useState<boolean>(false);
  const [senderPollCount, setSenderPollCount] = useState<number>(0);

  // Receiver States
  const [pinInput, setPinInput] = useState<string>("");
  const [isScanningQR, setIsScanningQR] = useState<boolean>(false);
  const [receivedFileInfo, setReceivedFileInfo] = useState<{
    code: string;
    name: string;
    size: number;
    mimeType: string;
    createdAt: number;
  } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  // Clipboard copies
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Transfer logs
  const [history, setHistory] = useState<TransferHistoryItem[]>([]);

  // Refs for polling
  const senderPollInterval = useRef<NodeJS.Timeout | null>(null);
  const receiverPollInterval = useRef<NodeJS.Timeout | null>(null);
  const isUploadingActive = useRef<boolean>(false);
  const [senderSessionStatus, setSenderSessionStatus] = useState<"waiting_for_receiver" | "receiver_ready" | "file_ready" | "downloaded">("waiting_for_receiver");

  // Check backend health
  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setBackendStatus("online");
        setActiveSharesCount(data.activeShares || 0);
      } else {
        setBackendStatus("offline");
      }
    } catch {
      setBackendStatus("offline");
    }
  };

  // Run on mount
  useEffect(() => {
    checkHealth();
    const healthTimer = setInterval(checkHealth, 10000);

    // Update time displays
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("ne-NP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " NP");
    };
    updateTime();
    const timeTimer = setInterval(updateTime, 1000);

    // Check if there is a QR code or direct code in URL on launch
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("code");
    if (codeParam && codeParam.length === 6) {
      setActiveTab("receive");
      setPinInput(codeParam);
      fetchFileMetadata(codeParam);
    }

    // Load history from localStorage
    const savedHistory = localStorage.getItem("aadan_pradan_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error(e);
      }
    }

    // Speech voice loading hook for Android/iOS Safari
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }

    return () => {
      clearInterval(healthTimer);
      clearInterval(timeTimer);
      if (senderPollInterval.current) clearInterval(senderPollInterval.current);
      if (receiverPollInterval.current) clearInterval(receiverPollInterval.current);
    };
  }, []);

  // Save history helper
  const addToHistory = (item: Omit<TransferHistoryItem, "timestamp">) => {
    const newItem: TransferHistoryItem = { ...item, timestamp: Date.now() };
    const updatedHistory = [newItem, ...history.filter((h) => h.code !== item.code)].slice(0, 30);
    setHistory(updatedHistory);
    localStorage.setItem("aadan_pradan_history", JSON.stringify(updatedHistory));
  };

  // Speech test
  const triggerSpeechTest = () => {
    announce({
      ne: "आदान-प्रदान सेवामा तपाईंलाई स्वागत छ। फाइल साझेदारी परीक्षण सफल रह्यो।",
      hi: "आदान-प्रदान सेवा में आपका स्वागत है। फाइल साझा करने का परीक्षण सफल रहा।",
      en: "Welcome to Aadan Pradan service. The file sharing test announcement is successful."
    });
  };

  // --- SENDER FLOW ---

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024 * 1024) {
        setUploadError("फाइल आकार १० जीबी (10GB) भन्दा सानो हुनुपर्छ।");
        return;
      }
      setSelectedFile(file);
      setUploadError(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024 * 1024) {
        setUploadError("फाइल आकार १० जीबी (10GB) भन्दा सानो हुनुपर्छ।");
        return;
      }
      setSelectedFile(file);
      setUploadError(null);
    }
  };

  // Register the share session on the server (metadata only, no file upload yet)
  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(false);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const res = await fetch(`${API_BASE}/api/shares/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: selectedFile.name,
          size: selectedFile.size,
          mimeType: selectedFile.type,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUploadedInfo({
            code: data.code,
            name: data.name,
            size: data.size,
            createdAt: data.createdAt,
          });
          setReceiverDownloaded(false);
          setSenderPollCount(0);
          setSenderSessionStatus("waiting_for_receiver");
          isUploadingActive.current = false;

          addToHistory({
            code: data.code,
            name: data.name,
            size: data.size,
            type: "send",
          });
          announce({
            ne: "६-अंकको ट्रान्सफर कोड उत्पन्न भयो। प्रापकले यो प्रविष्ट गर्दा स्वतः ट्रान्सफर सुरु हुनेछ।",
            hi: "६-अंकीय ट्रांसफर कोड जनरेट हो गया है। प्राप्तकर्ता के इसे दर्ज करने पर ट्रांसफर शुरू हो जाएगा।",
            en: "A six-digit transfer PIN has been generated. The file transfer will begin when the receiver enters this code."
          });

          // Start polling to detect when the receiver connects/claims the PIN
          startPollingReceiver(data.code);
        } else {
          setUploadError(data.error || "दर्ता गर्न असफल भयो।");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setUploadError(errData.error || "सर्भरमा समस्या आयो।");
      }
    } catch {
      setUploadError("नेटवर्क त्रुटि: कृपया सर्भर जडान जाँच गर्नुहोस्।");
    }
  };

  // Poll server to check session status
  const startPollingReceiver = (code: string) => {
    if (senderPollInterval.current) clearInterval(senderPollInterval.current);
    isUploadingActive.current = false;

    senderPollInterval.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/shares/status/${code}`);
        if (res.ok) {
          const data = await res.json();
          setSenderSessionStatus(data.status);

          // If receiver matched PIN, trigger the automatic file upload JIT!
          if (data.status === "receiver_ready" && !isUploadingActive.current) {
            isUploadingActive.current = true;
            triggerLateUpload(code);
          }

          // If receiver completed download
          if (data.status === "downloaded" || data.downloadsCount > 0) {
            setReceiverDownloaded(true);
            setSenderSessionStatus("downloaded");
            announce({
              ne: "फाइल सफलतापूर्वक स्थानान्तरण र डाउनलोड भयो।",
              hi: "फ़ाइल सफलतापूर्वक स्थानांतरित और डाउनलोड हो गई है।",
              en: "File transfer has been completed and downloaded successfully."
            });
            if (senderPollInterval.current) {
              clearInterval(senderPollInterval.current);
            }
          }
        } else if (res.status === 404) {
          // File expired or deleted
          if (senderPollInterval.current) {
            clearInterval(senderPollInterval.current);
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
      setSenderPollCount((prev) => prev + 1);
    }, 1500);
  };

  // Perform late (JIT) upload of the file buffer
  const triggerLateUpload = (code: string) => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);
    announce({
      ne: "प्राप्तकर्ता जडान भयो। फाइल स्थानान्तरण हुँदैछ, कृपया यो विन्डो बन्द नगर्नुहोस्।",
      hi: "प्राप्तकर्ता जुड़ गया है। फ़ाइल स्थानांतरित हो रही है, कृपया इस विंडो को बंद न करें।",
      en: "Receiver connected. File is transferring, please do not close this window."
    });

    const formData = new FormData();
    formData.append("file", selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/shares/upload/${code}`, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentage);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          setSenderSessionStatus("file_ready");
          announce({
            ne: "फाइल पूर्ण रूपमा तयार भयो। प्राप्तकर्ताको यन्त्रमा डाउनलोड सुरु हुँदैछ।",
            hi: "फ़ाइल पूरी तरह से तैयार है। प्राप्तकर्ता के डिवाइस पर डाउनलोड शुरू हो रहा है।",
            en: "File is fully prepared. Starting download on the receiver's device."
          });
        } catch (e) {
          setUploadError("सर्भर प्रतिक्रिया प्रशोधन गर्न सकिएन।");
          isUploadingActive.current = false;
        }
      } else {
        setUploadError("फाइल स्थानान्तरण असफल भयो।");
        isUploadingActive.current = false;
      }
    };

    xhr.onerror = () => {
      setUploadError("स्थानान्तरण असफल भयो। कृपया जडान जाँच गर्नुहोस्।");
      setIsUploading(false);
      isUploadingActive.current = false;
    };

    xhr.send(formData);
  };

  // Clear/Cancel active share
  const handleCancelShare = async () => {
    if (senderPollInterval.current) {
      clearInterval(senderPollInterval.current);
    }
    isUploadingActive.current = false;
    if (uploadedInfo) {
      try {
        await fetch(`${API_BASE}/api/files/${uploadedInfo.code}`, { method: "DELETE" });
      } catch (e) {
        console.error("Delete failed:", e);
      }
    }
    setUploadedInfo(null);
    setSelectedFile(null);
    setUploadProgress(0);
    setReceiverDownloaded(false);
    checkHealth();
  };

  // --- RECEIVER FLOW ---

  // Fetch file details by PIN
  const fetchFileMetadata = async (codeToCheck: string) => {
    if (!codeToCheck || codeToCheck.length !== 6) return;

    setIsFetchingMetadata(true);
    setFetchError(null);
    setReceivedFileInfo(null);
    setDownloadSuccess(false);

    if (receiverPollInterval.current) clearInterval(receiverPollInterval.current);

    try {
      const res = await fetch(`${API_BASE}/api/files/${codeToCheck}`);
      if (res.ok) {
        const data = await res.json();
        setReceivedFileInfo(data);

        if (data.status === "file_ready") {
          announce({
            ne: "फाइल फेला पर्यो। डाउनलोड गर्न तयार छ।",
            hi: "फ़ाइल मिल गई है। डाउनलोड के लिए तैयार है।",
            en: "File found. It is ready for download."
          });
        } else {
          announce({
            ne: "फाइल फेला पर्यो। स्थानान्तरणको प्रतीक्षामा, कृपया बने रहनुहोस्।",
            hi: "फ़ाइल मिल गई है। स्थानांतरण की प्रतीक्षा की जा रही है, कृपया बने रहें।",
            en: "File found. Waiting for file transfer, please stay connected."
          });
          startPollingForFileReady(codeToCheck);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setFetchError(errData.error || "गलत PIN कोड वा फाइल म्याद समाप्त भयो।");
      }
    } catch {
      setFetchError("सर्भरमा जडान हुन सकेन।");
    } finally {
      setIsFetchingMetadata(false);
    }
  };

  // Poll for file status to turn "file_ready" (JIT file upload completes)
  const startPollingForFileReady = (code: string) => {
    if (receiverPollInterval.current) clearInterval(receiverPollInterval.current);

    receiverPollInterval.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/shares/status/${code}`);
        if (res.ok) {
          const data = await res.json();
          setReceivedFileInfo((prev) => prev ? { ...prev, status: data.status } : null);

          if (data.status === "file_ready") {
            if (receiverPollInterval.current) {
              clearInterval(receiverPollInterval.current);
            }
            handleDownloadDirect(code, data.name, data.size);
          }
        } else {
          if (receiverPollInterval.current) {
            clearInterval(receiverPollInterval.current);
          }
          setFetchError("सेसन समाप्त भयो वा फाइल हटाइयो।");
        }
      } catch (e) {
        console.error("Receiver polling error:", e);
      }
    }, 1500);
  };

  // Internal helper to perform actual file download
  const handleDownloadDirect = (code: string, name: string, size: number) => {
    setIsDownloading(true);
    announce({
      ne: "फाइल डाउनलोड हुँदैछ, कृपया केही बेर पर्खनुहोस्।",
      hi: "फ़ाइल डाउनलोड हो रही है, कृपया कुछ समय प्रतीक्षा करें।",
      en: "The file is downloading, please wait a moment."
    });

    const downloadUrl = `${API_BASE}/api/download/${code}`;

    addToHistory({
      code,
      name,
      size,
      type: "receive",
    });

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.setAttribute("download", name);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setIsDownloading(false);
      setDownloadSuccess(true);
      announce({
        ne: "बधाई छ, फाइल आदान-प्रदान र ट्रान्सफर पूर्ण रूपमा सफल भयो।",
        hi: "बधाई हो, फ़ाइल स्थानांतरण पूरी तरह से सफल रहा।",
        en: "Congratulations, the file transfer was fully successful."
      });
    }, 1500);
  };

  // Perform Download from express server (manual fallback trigger)
  const handleDownload = () => {
    if (!receivedFileInfo) return;
    handleDownloadDirect(receivedFileInfo.code, receivedFileInfo.name, receivedFileInfo.size);
  };

  // QR Scan Success Callback
  const handleQRScanSuccess = (decodedText: string) => {
    setIsScanningQR(false);

    // Decoded text can be a full URL like 'https://.../receive?code=123456' or just a 6 digit code
    let code = decodedText;
    if (decodedText.includes("code=")) {
      try {
        const parts = decodedText.split("code=");
        if (parts.length > 1) {
          const match = parts[1].match(/^\d{6}/);
          if (match) {
            code = match[0];
          } else {
            // Fallback: try URL parsing
            const queryPart = decodedText.split("?")[1];
            if (queryPart) {
              const urlParams = new URLSearchParams(queryPart);
              code = urlParams.get("code") || decodedText;
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse code from QR link", e);
      }
    }

    // Clean code to 6 digits
    const cleanCode = code.trim().replace(/[^0-9]/g, "");
    if (cleanCode.length === 6) {
      setPinInput(cleanCode);
      fetchFileMetadata(cleanCode);
    } else {
      setFetchError(`क्युआर कोड स्क्यान भयो तर कुनै मान्य ६-अंकको कोड फेला परेन। (पढिएको पाठ: ${decodedText})`);
    }
  };

  const clearReceiveState = () => {
    if (receiverPollInterval.current) {
      clearInterval(receiverPollInterval.current);
    }
    setPinInput("");
    setReceivedFileInfo(null);
    setFetchError(null);
    setDownloadSuccess(false);
  };

  // Auto Clipboard Copy Helpers
  const copyToClipboard = (text: string, type: "code" | "link") => {
    navigator.clipboard.writeText(text);
    if (type === "code") {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  // Formatted direct link
  const getShareLink = () => {
    if (!uploadedInfo) return "";
    return `${window.location.origin}?code=${uploadedInfo.code}`;
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col selection:bg-indigo-600 selection:text-white" id="main-layout">
      {/* Top Ambient Light Flare */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-80 bg-gradient-to-b from-indigo-100/50 to-transparent blur-3xl rounded-full pointer-events-none" />

      {/* Header Bar */}
      <header className="border-b border-slate-200 bg-white shadow-sm relative z-10" id="header-container">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <Share2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                आदान-प्रदान
              </h1>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Aadan Pradan • Instant File Share</p>
            </div>
          </div>

          {/* Quick Stats, Clock & Sound preference */}
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-xs font-sans">
            {/* NP Clock */}
            <div className="flex items-center gap-1.5 bg-slate-100/80 border border-slate-200 py-1.5 px-3 rounded-full text-slate-600 font-mono">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              <span>{timeStr || "समय लोड हुँदैछ..."}</span>
            </div>

            {/* Health Indicators */}
            <div
              onClick={checkHealth}
              className={`flex items-center gap-1.5 border py-1.5 px-3.5 rounded-full cursor-pointer font-semibold transition-all hover:scale-102 ${
                backendStatus === "online"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                  : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
              }`}
              title="Click to refresh status"
              id="status-indicator"
            >
              <span className={`w-2 h-2 rounded-full ${backendStatus === "online" ? "bg-emerald-500 animate-pulse" : "bg-rose-500 animate-ping"}`} />
              <span>{backendStatus === "online" ? "अनलाइन (Server Live)" : "अफलाइन (Offline)"}</span>
              {backendStatus === "online" && activeSharesCount > 0 && (
                <span className="bg-emerald-500/10 text-[10px] px-1.5 py-0.5 rounded-full ml-1 text-emerald-600">
                  {activeSharesCount} सक्रिय
                </span>
              )}
            </div>

            {/* TTS Audio & Language Controls */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-1.5 rounded-2xl shadow-sm" id="tts-controls-container">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`p-2 rounded-xl transition-all cursor-pointer ${
                  isMuted 
                    ? "bg-rose-50 text-rose-500 hover:bg-rose-100" 
                    : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100/80"
                }`}
                title={isMuted ? "आवाज अन-म्युट गर्नुहोस् (Unmute Voice)" : "आवाज म्युट गर्नुहोस् (Mute Voice)"}
                id="btn-toggle-sound"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <div className="flex items-center bg-white border border-slate-100 p-0.5 rounded-lg text-[10px] font-bold text-slate-500">
                <button
                  onClick={() => setAnnouncementLang("all")}
                  className={`px-2 py-1 rounded-md transition-all ${
                    announcementLang === "all"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "hover:text-slate-900 hover:bg-slate-50"
                  }`}
                  title="त्रि-भाषी: नेपाली + हिन्दी + English"
                >
                  🌐 ALL
                </button>
                <button
                  onClick={() => setAnnouncementLang("ne")}
                  className={`px-2 py-1 rounded-md transition-all ${
                    announcementLang === "ne"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "hover:text-slate-900 hover:bg-slate-50"
                  }`}
                  title="नेपाली मात्र (Nepali Only)"
                >
                  🇳🇵 NEP
                </button>
                <button
                  onClick={() => setAnnouncementLang("hi")}
                  className={`px-2 py-1 rounded-md transition-all ${
                    announcementLang === "hi"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "hover:text-slate-900 hover:bg-slate-50"
                  }`}
                  title="हिन्दी मात्र (Hindi Only)"
                >
                  🇮🇳 HIN
                </button>
                <button
                  onClick={() => setAnnouncementLang("en")}
                  className={`px-2 py-1 rounded-md transition-all ${
                    announcementLang === "en"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "hover:text-slate-900 hover:bg-slate-50"
                  }`}
                  title="English Only"
                >
                  🇬🇧 ENG
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 relative z-10" id="main-content">
        {/* Navigation Tabs */}
        <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200/80 mb-8 max-w-lg mx-auto shadow-inner" id="nav-tabs">
          <button
            onClick={() => {
              setActiveTab("send");
              clearReceiveState();
              if (!selectedFile && !uploadedInfo) {
                setTimeout(() => {
                  document.getElementById("file-selector-input")?.click();
                }, 150);
              }
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-extrabold text-xs sm:text-sm transition-all duration-300 cursor-pointer ${
              activeTab === "send"
                ? "bg-amber-500 text-amber-950 shadow-md shadow-amber-300/30 border border-amber-600/20"
                : "text-amber-800 bg-amber-50/30 hover:bg-amber-50 border border-transparent hover:border-amber-200/40"
            }`}
            id="tab-send"
          >
            <Send className="w-4 h-4 text-amber-950" />
            <span>पठाउनुहोस् (Sender • Yellow)</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("receive");
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-extrabold text-xs sm:text-sm transition-all duration-300 cursor-pointer ${
              activeTab === "receive"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20 border border-emerald-700/20"
                : "text-emerald-800 bg-emerald-50/30 hover:bg-emerald-50 border border-transparent hover:border-emerald-200/40"
            }`}
            id="tab-receive"
          >
            <Download className="w-4 h-4 text-emerald-800" />
            <span>प्राप्त गर्नुहोस् (Receiver • Green)</span>
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-extrabold text-xs sm:text-sm transition-all duration-300 cursor-pointer ${
              activeTab === "history"
                ? "bg-slate-700 text-white shadow-md shadow-slate-300 border border-slate-800"
                : "text-slate-500 hover:text-slate-800"
            }`}
            id="tab-history"
          >
            <FolderOpen className="w-4 h-4" />
            <span>इतिहास (History)</span>
          </button>
        </div>

        {/* Content Screens with AnimatePresence */}
        <div className="bg-white border border-slate-200 rounded-[32px] p-6 md:p-10 shadow-xl shadow-slate-100 relative min-h-[400px]">
          <AnimatePresence mode="wait">
            {/* 1. SENDER VIEW */}
            {activeTab === "send" && (
              <motion.div
                key="send-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
                id="send-section"
              >
                {!uploadedInfo ? (
                  // SELECT & UPLOAD FILE VIEW
                  <div className="space-y-6">
                    {!selectedFile ? (
                      // NO FILE SELECTED - YELLOW THEMED INSTRUCTION WITH AUTOPICKER TRIGGER BUTTON
                      <div className="space-y-6 max-w-md mx-auto text-center">
                        <div className="bg-amber-50 border border-amber-100 p-6 rounded-[24px] space-y-4">
                          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-amber-600 shadow-sm">
                            <Send className="w-8 h-8 animate-bounce" />
                          </div>
                          <div className="space-y-2">
                            <h2 className="text-xl font-black text-amber-950">फाइल पठाउनुहोस् (Send File)</h2>
                            <p className="text-xs text-amber-800 font-semibold leading-relaxed">
                              कुनै आकार (Size) र गुणस्तर (Quality) नघटाई सुरक्षित र अल्ट्रा-फास्ट रूपमा सिधै प्रापकको ब्राउजरमा स्थानान्तरण गर्नुहोस्।
                            </p>
                          </div>

                          <input
                            type="file"
                            id="file-selector-input"
                            className="hidden"
                            onChange={handleFileChange}
                          />

                          <button
                            onClick={() => document.getElementById("file-selector-input")?.click()}
                            className="w-full flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-amber-950 font-black rounded-2xl text-sm transition-all shadow-lg shadow-amber-200 border border-amber-400/40 active:scale-98 cursor-pointer"
                            id="btn-choose-file-new"
                          >
                            <FolderOpen className="w-5 h-5 text-amber-950 animate-pulse" />
                            <span>फाइल वा ग्यालरीबाट छान्नुहोस्</span>
                          </button>
                        </div>

                        <div className="bg-slate-50 border border-slate-200/60 p-4.5 rounded-[20px] text-[11px] text-slate-500 font-medium">
                          १००% सुरक्षित र साइज नघट्ने स्थानीय ग्यारेन्टी (Original MB Size Guaranteed)।
                        </div>
                      </div>
                    ) : (
                      // FILE SELECTED - PREVIEW AND SEND ACTION
                      <div className="space-y-6 max-w-md mx-auto text-center">
                        <div className="bg-amber-50/50 border border-amber-200 rounded-[24px] p-6 text-center space-y-4 shadow-sm relative">
                          <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500 rounded-t-[24px]" />
                          
                          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-amber-600 shadow-inner">
                            <FileText className="w-8 h-8 text-amber-600" />
                          </div>

                          <div className="space-y-1">
                            <p className="text-[10px] text-amber-700 font-bold uppercase tracking-wider">पठाउन छानिएको फाइल</p>
                            <p className="font-extrabold text-slate-900 max-w-sm mx-auto truncate text-sm" title={selectedFile.name}>
                              {selectedFile.name}
                            </p>
                            <div className="flex items-center justify-center gap-2 mt-1">
                              <span className="bg-amber-100 border border-amber-200 text-amber-900 font-mono font-black text-xs px-2.5 py-1 rounded-md">
                                {formatBytes(selectedFile.size)}
                              </span>
                              <span className="text-[10px] text-amber-800 font-bold">
                                १००% शुद्ध क्वालिटी सुरक्षित छ (Original Preserved)
                              </span>
                            </div>
                          </div>

                          <input
                            type="file"
                            id="file-selector-input"
                            className="hidden"
                            onChange={handleFileChange}
                          />

                          <div className="pt-2 space-y-2">
                            {isUploading ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-amber-800 font-mono font-bold">
                                  <span>फाइल सुरक्षित रूपमा स्थानान्तरणको लागि दर्ता हुँदैछ...</span>
                                  <span className="text-amber-600 font-black">{uploadProgress}%</span>
                                </div>
                                <div className="w-full bg-amber-100/50 border border-amber-200/60 rounded-full h-3 overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-amber-400 to-amber-500 h-full rounded-full transition-all duration-100"
                                    style={{ width: `${uploadProgress}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <button
                                  onClick={handleUpload}
                                  className="w-full py-4 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-amber-950 font-black rounded-xl text-sm transition-all shadow-lg shadow-amber-200/80 active:scale-98 flex items-center justify-center gap-2 border border-amber-400/40 cursor-pointer"
                                  id="btn-upload-file"
                                >
                                  <Send className="w-4 h-4 text-amber-950" />
                                  <span>फाइल पठाउनुहोस् (Send Securely)</span>
                                </button>

                                <button
                                  onClick={() => document.getElementById("file-selector-input")?.click()}
                                  className="w-full py-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 text-slate-600 rounded-xl font-bold text-xs transition-all active:scale-98 cursor-pointer"
                                  id="btn-change-file"
                                >
                                  अर्को फाइल छान्नुहोस् (Change File)
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Size and info Alert */}
                    {uploadError && (
                      <div className="flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs max-w-lg mx-auto font-medium" id="upload-error-banner">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                        <p>{uploadError}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  // FILE SUCCESSFULLY UPLOADED & CODE GENERATED
                  <div className="space-y-6 max-w-xl mx-auto text-center animate-fade-in">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="bg-amber-50 p-3 rounded-full border border-amber-200 text-amber-600 mb-2 shadow-sm animate-pulse">
                        <CheckCircle className="w-8 h-8 text-amber-500" />
                      </div>
                      <h2 className="text-2xl font-black text-amber-950">फाइल आदान-प्रदान गर्न तयार छ!</h2>
                      <p className="text-xs text-slate-500 max-w-sm mt-1 truncate font-semibold font-mono">
                        {uploadedInfo.name} ({formatBytes(uploadedInfo.size)})
                      </p>
                    </div>

                    {/* Code display boxes */}
                    <div className="bg-amber-50/30 p-6 rounded-[24px] border border-amber-200/80 shadow-sm space-y-4">
                      <p className="text-xs text-amber-800 uppercase tracking-wider font-extrabold">६-अंकको ट्रान्सफर PIN कोड</p>
                      <div className="flex justify-center gap-2">
                        {uploadedInfo.code.split("").map((digit, idx) => (
                          <div
                            key={idx}
                            className="w-12 h-14 bg-white border border-amber-200 rounded-xl flex items-center justify-center text-2xl font-black font-mono text-amber-600 shadow-md shadow-amber-100/30 animate-[bounce_0.4s_ease-out]"
                            style={{ animationDelay: `${idx * 0.05}s` }}
                          >
                            {digit}
                          </div>
                        ))}
                      </div>

                      <div className="pt-2 flex justify-center">
                        <button
                          onClick={() => copyToClipboard(uploadedInfo.code, "code")}
                          className="flex items-center gap-1.5 py-2 px-4 bg-white hover:bg-amber-50 border border-amber-200 text-xs font-bold rounded-lg text-amber-900 shadow-sm transition-colors cursor-pointer"
                          id="btn-copy-code"
                        >
                          {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Clipboard className="w-3.5 h-3.5 text-amber-600" />}
                          <span>{copiedCode ? "PIN कपि गरियो" : "PIN कपि गर्नुहोस्"}</span>
                        </button>
                      </div>
                    </div>

                    {/* QR Code and link sharing */}
                    <div className="flex flex-col md:flex-row items-center justify-center gap-6 p-6 bg-amber-50/10 border border-amber-100 rounded-[24px]">
                      <div className="flex-shrink-0 bg-white p-3 rounded-2xl border border-amber-100 shadow-md">
                        <QrCodeDisplay text={getShareLink()} size={180} />
                      </div>
                      <div className="text-left space-y-3 flex-1">
                        <h4 className="font-extrabold text-amber-950 text-sm flex items-center gap-1.5">
                          <QrCode className="w-5 h-5 text-amber-600" />
                          <span>क्युआर (QR) कोड मार्फत प्राप्त गर्नुहोस्</span>
                        </h4>
                        <p className="text-xs text-amber-900/80 font-semibold leading-relaxed">
                          प्राप्तकर्ता (Receiver) लाई यो क्युआर कोड स्क्यान गर्न भन्नुहोस्। कोड म्याच हुनासाथ कुनै आकार र क्वालिटी नघटाई सुरक्षित रूपमा सिधै डाउनलोड सुरु हुनेछ।
                        </p>

                        <div className="space-y-2 pt-1.5">
                          <p className="text-[10px] text-amber-800 font-extrabold uppercase tracking-wider">लिंक साझेदारी गर्नुहोस्</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              readOnly
                              value={getShareLink()}
                              className="bg-white text-slate-700 text-xs px-3 py-2.5 rounded-lg border border-amber-200/80 shadow-inner flex-1 outline-none font-mono font-medium focus:border-amber-500"
                            />
                            <button
                              onClick={() => copyToClipboard(getShareLink(), "link")}
                              className="p-2 bg-white hover:bg-amber-50 border border-amber-200 text-amber-700 rounded-lg shadow-sm transition-colors flex items-center justify-center cursor-pointer"
                              title="Copy URL Link"
                              id="btn-copy-url"
                            >
                              {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Clipboard className="w-4 h-4 text-amber-500" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Waiting Status / Live downloading state */}
                    <div className="border border-amber-100 bg-amber-50/20 p-5 rounded-[24px] text-xs space-y-3 text-left shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5">
                          <div className="relative flex h-2.5 w-2.5">
                            {senderSessionStatus !== "downloaded" && (
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                            )}
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                              senderSessionStatus === "downloaded" ? "bg-emerald-500" : "bg-amber-500"
                            }`} />
                          </div>
                          <div>
                            <p className="font-extrabold text-amber-950">
                              {senderSessionStatus === "waiting_for_receiver" && "प्राप्तकर्ताको प्रतीक्षामा..."}
                              {senderSessionStatus === "receiver_ready" && "प्राप्तकर्ता जडान भयो! फाइल स्थानान्तरण हुँदैछ..."}
                              {senderSessionStatus === "file_ready" && "फाइल पूर्ण रूपमा तयार भयो। डाउनलोड हुँदैछ..."}
                              {senderSessionStatus === "downloaded" && "फाइल सफलतापूर्वक स्थानान्तरण भयो!"}
                            </p>
                            <p className="text-amber-900/80 text-[10px] mt-0.5 font-semibold">
                              {senderSessionStatus === "waiting_for_receiver" && "प्रापकले ६-अंकको कोड प्रविष्ट गरेपछि वा QR कोड स्क्यान गरेपछि दुबै उपकरण जडान भई फाइल ट्रान्सफर स्वतः सुरु हुनेछ।"}
                              {senderSessionStatus === "receiver_ready" && "फाइल सुरक्षित र सीधा प्रापकको यन्त्रमा बिना कुनै डेटा नोक्सान र पुरा एमबीमा जाँदैछ। यो विन्डो खुला राख्नुहोस्।"}
                              {senderSessionStatus === "file_ready" && "फाइल प्रापकको ब्राउजरमा सफलतापूर्वक डाउनलोड हुँदैछ।"}
                              {senderSessionStatus === "downloaded" && "प्राप्तकर्ताले सफलतापूर्वक फाइल पूर्ण रूपमा प्राप्त गरिसकेका छन्।"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-[10px] text-amber-600 font-bold font-mono flex-shrink-0">
                          <span>अद्यावधिक: {senderPollCount}</span>
                        </div>
                      </div>

                      {senderSessionStatus === "receiver_ready" && (
                        <div className="space-y-1.5 pt-1 border-t border-amber-100">
                          <div className="flex items-center justify-between text-[10px] text-amber-800 font-mono font-bold">
                              <span>प्रगति (Upload Progress)</span>
                            <span className="text-amber-600">{uploadProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                            <div
                              className="bg-amber-500 h-full rounded-full transition-all duration-100"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Error display */}
                    {uploadError && (
                      <div className="flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs text-left font-medium" id="active-share-upload-error">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                        <div>
                          <p className="font-bold">स्थानान्तरणमा समस्या आयो (Transfer Issue)</p>
                          <p className="text-slate-600 text-[10px] mt-0.5">{uploadError}</p>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="pt-2 flex justify-center gap-4">
                      <button
                        onClick={handleCancelShare}
                        className="py-2.5 px-6 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5 active:scale-95 shadow-sm cursor-pointer"
                        id="btn-delete-active-share"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>फाइल मेटाउनुहोस् (Stop Share)</span>
                      </button>

                      <button
                        onClick={() => {
                          if (senderPollInterval.current) clearInterval(senderPollInterval.current);
                          setUploadedInfo(null);
                          setSelectedFile(null);
                          setUploadProgress(0);
                        }}
                        className="py-2.5 px-6 bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-700 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5 active:scale-95 shadow-lg shadow-indigo-100 cursor-pointer"
                        id="btn-new-share"
                      >
                        <Send className="w-4 h-4 text-white" />
                        <span>अर्को फाइल पठाउनुहोस्</span>
                      </button>
                    </div>

                    <p className="text-[10px] text-slate-400 font-semibold text-center">
                      * सुरक्षाको लागि, उत्पन्न यो फाइल १५ मिनेट पछि स्वतः र सधैंको लागि सर्भरबाट मेटिनेछ।
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {/* 2. RECEIVER VIEW */}
            {activeTab === "receive" && (
              <motion.div
                key="receive-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
                id="receive-section"
              >
                {!receivedFileInfo ? (
                  // ENTER CODE OR SCAN VIEW
                  <div className="space-y-6 max-w-md mx-auto animate-fade-in">
                    <div className="text-center">
                      <h2 className="text-2xl font-black text-emerald-950">फाइल प्राप्त गर्नुहोस् (Receive File)</h2>
                      <p className="text-sm text-emerald-800 mt-2 font-semibold">
                        फाइल प्राप्त गर्न ६-अंकको PIN कोड प्रविष्ट गर्नुहोस् वा पठाउने व्यक्तिको QR कोड स्क्यान गर्नुहोस्।
                      </p>
                    </div>

                    {/* PIN Entry Area */}
                    <div className="bg-emerald-50/20 border border-emerald-100 p-6 rounded-[24px] space-y-4 shadow-sm">
                      <label className="block text-xs font-extrabold text-emerald-800 uppercase tracking-wider text-center">
                        ट्रान्सफर PIN कोड प्रविष्ट गर्नुहोस्
                      </label>

                      <div className="relative">
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="दर्ता गर्नुहोस् (उदा: ५९३८२०)"
                          value={pinInput}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, "");
                            setPinInput(val);
                            if (val.length === 6) {
                              fetchFileMetadata(val);
                            }
                          }}
                          className="w-full text-center text-3xl font-black font-mono tracking-[0.25em] py-3 bg-white border border-emerald-200 focus:border-emerald-500 rounded-xl outline-none text-emerald-600 focus:shadow-lg focus:shadow-emerald-500/10 placeholder:text-slate-400 placeholder:text-base placeholder:tracking-normal placeholder:font-sans shadow-inner transition-all"
                          id="pin-code-input"
                        />
                        {isFetchingMetadata && (
                          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                            <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin" />
                          </div>
                        )}
                      </div>

                      {/* Manual lookup trigger button if they pasted */}
                      {pinInput.length > 0 && pinInput.length < 6 && (
                        <p className="text-[10px] text-emerald-700/80 text-center font-extrabold animate-pulse">
                          कृपया पूर्ण ६-अंकको कोड प्रविष्ट गर्नुहोस्...
                        </p>
                      )}

                      {pinInput.length === 6 && !isFetchingMetadata && (
                        <div className="flex justify-center">
                          <button
                            onClick={() => fetchFileMetadata(pinInput)}
                            className="text-xs font-black text-emerald-700 hover:text-emerald-600 flex items-center gap-1.5 cursor-pointer"
                            id="btn-re-fetch"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                            <span>पुनः जाँच गर्नुहोस्</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* QR Code trigger Option */}
                    <div className="relative py-2 flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center pointer-events-none">
                        <div className="w-full border-t border-emerald-100/60" />
                      </div>
                      <span className="relative px-3 bg-white text-xs text-emerald-800 font-extrabold">अथवा</span>
                    </div>

                    {/* Scanner Buttons */}
                    {!isScanningQR ? (
                      <button
                        onClick={() => {
                          setIsScanningQR(true);
                          setFetchError(null);
                        }}
                        className="w-full flex items-center justify-center gap-2.5 py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-black rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/20 active:scale-98 cursor-pointer border border-emerald-500/20"
                        id="btn-open-scanner"
                      >
                        <QrCode className="w-5 h-5 animate-pulse" />
                        <span>क्युआर (QR) कोड स्क्यान गर्नुहोस्</span>
                      </button>
                    ) : (
                      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                        <QrScanner
                          onScanSuccess={handleQRScanSuccess}
                          onClose={() => setIsScanningQR(false)}
                        />
                      </div>
                    )}

                    {/* Search Errors */}
                    {fetchError && (
                      <div className="flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-[18px] text-xs font-medium" id="fetch-error-banner">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                        <div>
                          <p className="font-bold">फाइल फेला परेन</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 font-semibold">{fetchError}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // FILE DETAILS PREVIEW & DOWNLOAD BUTTON
                  <div className="space-y-6 max-w-md mx-auto animate-fade-in">
                    <div className="text-center">
                      <h2 className="text-2xl font-black text-emerald-950">फाइल प्राप्त गर्न तयार!</h2>
                      <p className="text-sm text-emerald-800 mt-1 font-semibold">आदान-प्रदान विवरण तल प्रस्तुत छ।</p>
                    </div>

                    {/* File Receipt Box */}
                    <div className="bg-emerald-50/20 rounded-[24px] border border-emerald-100 p-5 relative overflow-hidden shadow-sm">
                      {/* Decorative top strip */}
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-emerald-500" />

                      <div className="flex items-start gap-4 pt-2">
                        <div className="bg-emerald-100 border border-emerald-200 p-3.5 rounded-xl text-emerald-700 shadow-sm">
                          <FileText className="w-8 h-8" />
                        </div>
                        <div className="space-y-1 flex-1 min-w-0">
                          <h4 className="font-bold text-slate-900 text-sm truncate" title={receivedFileInfo.name}>
                            {receivedFileInfo.name}
                          </h4>
                          <p className="text-xs text-emerald-800 font-extrabold font-mono">फाइल साइज: {formatBytes(receivedFileInfo.size)}</p>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            अपलोड समय: {new Date(receivedFileInfo.createdAt).toLocaleTimeString("ne-NP")}
                          </p>
                        </div>
                      </div>

                      {/* Info warning or Transfer in-progress */}
                      <div className="mt-4 pt-4 border-t border-emerald-100">
                        {receivedFileInfo.status !== "file_ready" && receivedFileInfo.status !== "downloaded" ? (
                          <div className="flex items-center gap-2.5 p-3 bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold animate-pulse">
                            <RefreshCw className="w-4 h-4 shrink-0 text-emerald-600 animate-spin" />
                            <span>पठाउने व्यक्तिबाट फाइल प्राप्त गरिँदैछ... कृपया यो विन्डो खुला राख्नुहोस्।</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-[11px] text-emerald-700 font-semibold">
                            <Shield className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                            <span>सुरक्षित इन-मेमोरी र इन्क्रिप्टेड प्रत्यक्ष स्थानीय स्थानान्तरण।</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action button */}
                    <div className="space-y-3">
                      {downloadSuccess ? (
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center text-emerald-700 space-y-1 animate-[fadeIn_0.3s_ease-out] shadow-sm font-medium">
                          <CheckCircle className="w-6 h-6 mx-auto text-emerald-600 mb-1" />
                          <p className="text-sm font-bold">फाइल सफलतापूर्वक डाउनलोड भयो!</p>
                          <p className="text-xs text-slate-500 font-semibold">स्थानान्तरण पूर्ण भयो।</p>
                        </div>
                      ) : receivedFileInfo.status !== "file_ready" && receivedFileInfo.status !== "downloaded" ? (
                        <div className="w-full py-4 bg-emerald-50/40 border border-emerald-100 text-emerald-800 font-bold rounded-xl text-sm flex items-center justify-center gap-2.5 shadow-inner">
                          <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                          <span>जडान हुँदैछ (फाइल स्थानान्तरणको प्रतीक्षामा)...</span>
                        </div>
                      ) : (
                        <button
                          onClick={handleDownload}
                          disabled={isDownloading}
                          className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-slate-200 disabled:to-slate-300 text-white font-bold rounded-xl text-sm shadow-lg shadow-emerald-200 transition-all active:scale-98 cursor-pointer border border-emerald-500/20"
                          id="btn-perform-download"
                        >
                          {isDownloading ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>डाउनलोड हुँदैछ...</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-4 h-4" />
                              <span>फाइल प्राप्त गर्नुहोस् (Download)</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        onClick={clearReceiveState}
                        className="w-full py-2.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                        id="btn-return-receive-home"
                      >
                        अर्को कोड प्रविष्ट गर्नुहोस्
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* 3. HISTORY VIEW */}
            {activeTab === "history" && (
              <motion.div
                key="history-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
                id="history-section"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Left Column: Local History Log */}
                  <div className="space-y-4 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-amber-500" />
                        <span>हालसालैका स्थानान्तरणहरू (Recent Transfers)</span>
                      </h3>
                      {history.length > 0 && (
                        <button
                          onClick={() => {
                            if (window.confirm("के तपाईं इतिहास खाली गर्न चाहनुहुन्छ?")) {
                              setHistory([]);
                              localStorage.removeItem("aadan_pradan_history");
                            }
                          }}
                          className="text-[10px] text-slate-400 hover:text-rose-600 transition-colors flex items-center gap-1 font-bold cursor-pointer"
                          id="btn-clear-history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>इतिहास मेट्नुहोस्</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                      {history.length === 0 ? (
                        <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 font-medium">
                          <HardDrive className="w-8 h-8 mx-auto text-slate-300 mb-2 animate-bounce" />
                          <p className="text-xs">अहिलेसम्म कुनै फाइल आदान-प्रदान गरिएको छैन।</p>
                        </div>
                      ) : (
                        history.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-4 bg-white border border-slate-200 hover:border-slate-300 rounded-[18px] flex items-center justify-between gap-3 text-xs shadow-sm transition-all"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <p className="font-bold text-slate-800 truncate" title={item.name}>
                                {item.name}
                              </p>
                              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                                <span className="font-mono font-bold">{formatBytes(item.size)}</span>
                                <span>•</span>
                                <span>{new Date(item.timestamp).toLocaleTimeString("ne-NP", { hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span
                                className={`px-2 py-0.5 border rounded text-[9px] font-bold uppercase ${
                                  item.type === "send"
                                    ? "bg-amber-50 border-amber-100 text-amber-700"
                                    : "bg-emerald-50 border-emerald-100 text-emerald-700"
                                }`}
                              >
                                {item.type === "send" ? "पठाएको (Sender)" : "प्राप्त (Receiver)"}
                              </span>

                              <button
                                onClick={() => {
                                  if (item.type === "receive") {
                                    setPinInput(item.code);
                                    setActiveTab("receive");
                                    fetchFileMetadata(item.code);
                                  } else {
                                    copyToClipboard(item.code, "code");
                                  }
                                }}
                                className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-600 transition-colors cursor-pointer"
                                title={item.type === "receive" ? "पुनः डाउनलोड" : "PIN कोड कपी गर्नुहोस्"}
                                id={`btn-history-action-${idx}`}
                              >
                                {item.type === "receive" ? <RefreshCw className="w-3.5 h-3.5 text-emerald-600" /> : <Clipboard className="w-3.5 h-3.5 text-amber-600" />}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right Column: Dynamic Instruction Guide */}
                  <div className="space-y-4 animate-fade-in">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-amber-500 animate-pulse" />
                      <span>निर्देशिका र जानकारी (User Guide)</span>
                    </h3>

                    <div className="bg-slate-50/50 border border-slate-200 p-5 rounded-[24px] space-y-4 text-xs leading-relaxed text-slate-600 font-medium">
                      <div className="space-y-2">
                        <p className="font-extrabold text-amber-700 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block animate-ping" />
                          <span>१. कसरी फाइल पठाउने? (Sender Flow)</span>
                        </p>
                        <p className="text-slate-500 pl-4 font-semibold">
                          पठाउने (Sender - पहेलो) ट्याबमा गई फाइल छान्न बक्समा थिच्नुहोस्। फाइल छनौट भएपछि <strong>सुरक्षित रूपमा पठाउनुहोस्</strong> थिच्नुहोस्। क्युआर (QR) कोड वा ६-अंकको PIN प्राप्तकर्तालाई देखाउनुहोस्।
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="font-extrabold text-emerald-700 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                          <span>२. कसरी फाइल प्राप्त गर्ने? (Receiver Flow)</span>
                        </p>
                        <p className="text-slate-500 pl-4 font-semibold">
                          प्राप्तकर्ता (Receiver - हरियो) ट्याबमा गई पठाउने व्यक्तिको क्युआर कोड स्क्यान गर्नुहोस् वा सिधै ६-अंकको PIN कोड प्रविष्ट गर्नुहोस्। कोड मिलेपछि स्वतः डाउनलोड सुरु हुनेछ।
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-200 space-y-2 text-[11px] text-slate-500">
                        <p className="font-bold text-slate-800">विशेषताहरू (Key Features):</p>
                        <ul className="list-disc list-inside space-y-1 pl-1 font-semibold text-slate-600">
                          <li>१००% निःशुल्क, कुनै आकार वा गुणस्तरमा कमि नआउने (Lossless) स्थानान्तरण।</li>
                          <li>त्रि-भाषी आवाज सूचना प्रणाली (नेपाली, हिन्दी र English TTS)।</li>
                          <li>सुरक्षित इन-मेमोरी स्थानान्तरण र १५ मिनेटमा स्वतः सुरक्षित विनाश।</li>
                        </ul>
                      </div>

                      {/* Interactive voice test widget */}
                      <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3 bg-amber-50/10 p-3.5 rounded-xl border border-amber-200">
                        <div className="space-y-0.5">
                          <p className="font-bold text-[11px] text-amber-950">त्रि-भाषी आवाज परीक्षण (Multi-Lang TTS)</p>
                          <p className="text-[10px] text-slate-500 font-semibold">चुनिएको भाषामा आवाज परीक्षण गर्नुहोस्।</p>
                        </div>
                        <button
                          onClick={triggerSpeechTest}
                          className="py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] rounded-lg shadow-sm shadow-amber-100 flex items-center gap-1.5 transition-all cursor-pointer"
                          id="btn-test-tts"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          <span>परीक्षण गर्नुहोस</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer Info bar */}
      <footer className="mt-auto border-t border-slate-200 bg-white text-center py-8 text-xs text-slate-500 relative z-10" id="footer-container">
        <div className="max-w-4xl mx-auto px-4 space-y-2">
          <p className="font-bold text-slate-700">आदान-प्रदान (Aadan Pradan) • peer-to-peer inspired file distribution</p>
          <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
            यो एप्लिकेसनले तपाईंको फाइलहरूलाई सुरक्षित रूपमा अस्थायी इन-मेमोरीमा राख्छ र १५ मिनेट भित्र वा पठाउने व्यक्तिले रद्द गरेमा तुरुन्तै सुरक्षित तवरले सर्भरबाट हटाउँछ। कुनै स्थायी डाटाबेस भण्डारण हुँदैन।
          </p>
        </div>
      </footer>
    </div>
  );
}
