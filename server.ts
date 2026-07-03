import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

// Custom type declarations for ES Module compatibility if needed
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SharedFile {
  id: string;
  code: string;
  name: string;
  size: number;
  mimeType: string;
  filePath?: string; // Stored on disk instead of buffer to handle up to 10GB effortlessly
  createdAt: number;
  downloadsCount: number;
  status: "waiting_for_receiver" | "receiver_ready" | "file_ready" | "downloaded";
}

// In-memory store for shared file metadata
const sharedFiles = new Map<string, SharedFile>();

// Ensure secure temporary upload directory exists
const UPLOAD_DIR = path.join(os.tmpdir(), "aadan_pradan_uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Clean up expired files (older than 15 minutes) every 1 minute
setInterval(() => {
  const now = Date.now();
  const EXPIRY_TIME = 15 * 60 * 1000; // 15 minutes
  for (const [code, file] of sharedFiles.entries()) {
    if (now - file.createdAt > EXPIRY_TIME) {
      if (file.filePath && fs.existsSync(file.filePath)) {
        fs.unlink(file.filePath, (err) => {
          if (err) console.error(`[Aadan Pradan Server] Error deleting expired file ${file.filePath}:`, err);
        });
      }
      sharedFiles.delete(code);
      console.log(`[Aadan Pradan Server] Cleaned up expired file ${file.name} (Code: ${code})`);
    }
  }
}, 60 * 1000);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Setup Multer for disk storage instead of memory storage to handle large files (up to 10GB)
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    }
  });

  const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // Supports up to 10GB transfers!
  });

  app.use(express.json());

  // API Route: Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeShares: sharedFiles.size });
  });

  // API Route: Register a share session (metadata only - file is NOT uploaded yet)
  app.post("/api/shares/register", (req, res) => {
    const { name, size, mimeType } = req.body;
    if (!name || size === undefined) {
      return res.status(400).json({ error: "कृपया मान्य फाइलको नाम र साइज प्रदान गर्नुहोस्।" });
    }

    // Generate a unique 6-digit PIN code
    let code = "";
    let attempts = 0;
    while (attempts < 20) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      if (!sharedFiles.has(pin)) {
        code = pin;
        break;
      }
      attempts++;
    }

    if (!code) {
      return res.status(500).json({ error: "PIN कोड उत्पन्न गर्न असफल भयो। कृपया पुन: प्रयास गर्नुहोस्।" });
    }

    const id = Math.random().toString(36).substring(2, 15);
    const newSession: SharedFile = {
      id,
      code,
      name,
      size,
      mimeType: mimeType || "application/octet-stream",
      createdAt: Date.now(),
      downloadsCount: 0,
      status: "waiting_for_receiver",
    };

    sharedFiles.set(code, newSession);

    console.log(`[Aadan Pradan Server] Share registered: ${newSession.name} (${newSession.size} bytes) with PIN ${code}. Waiting for receiver.`);

    res.json({
      success: true,
      code,
      name: newSession.name,
      size: newSession.size,
      createdAt: newSession.createdAt,
      status: newSession.status,
    });
  });

  // API Route: Poll share session status
  app.get("/api/shares/status/:code", (req, res) => {
    const code = req.params.code;
    const session = sharedFiles.get(code);

    if (!session) {
      return res.status(404).json({ error: "फाइल फेला परेन वा यो म्याद सकियो।" });
    }

    res.json({
      code: session.code,
      name: session.name,
      size: session.size,
      status: session.status,
      downloadsCount: session.downloadsCount,
    });
  });

  // API Route: JIT File Upload (triggered automatically when receiver is ready)
  app.post(
    "/api/shares/upload/:code",
    (req, res, next) => {
      upload.single("file")(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "फाइल आकार सीमा (10GB) भन्दा बढी भयो।" });
          }
          return res.status(500).json({ error: "फाइल अपलोड गर्दा त्रुटि भयो: " + err.message });
        }
        next();
      });
    },
    (req, res) => {
      const code = req.params.code;
      const session = sharedFiles.get(code);

      if (!session) {
        // Clean up file immediately to avoid leak
        if (req.file && req.file.path) {
          fs.unlink(req.file.path, () => {});
        }
        return res.status(404).json({ error: "स्थानान्तरण सेसन फेला परेन वा म्याद सकियो।" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "कृपया एउटा फाइल चयन गर्नुहोस्।" });
      }

      session.filePath = req.file.path;
      session.status = "file_ready";

      console.log(`[Aadan Pradan Server] File uploaded JIT for PIN ${code}: ${session.name} (${session.size} bytes) saved to disk temp path.`);

      res.json({
        success: true,
        code,
        name: session.name,
        size: session.size,
        status: session.status,
      });
    }
  );

  // API Route: Fetch File Metadata (also transitions waiting_for_receiver -> receiver_ready)
  app.get("/api/files/:code", (req, res) => {
    const code = req.params.code;
    const file = sharedFiles.get(code);

    if (!file) {
      return res.status(404).json({ error: "फाइल फेला परेन वा यो म्याद सकियो।" });
    }

    // Transition status to receiver_ready if it was waiting_for_receiver
    if (file.status === "waiting_for_receiver") {
      file.status = "receiver_ready";
      console.log(`[Aadan Pradan Server] Receiver matched PIN ${code}. Status changed to receiver_ready.`);
    }

    res.json({
      code: file.code,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      downloadsCount: file.downloadsCount,
      status: file.status,
    });
  });

  // API Route: Download File
  app.get("/api/download/:code", (req, res) => {
    const code = req.params.code;
    const file = sharedFiles.get(code);

    if (!file) {
      return res.status(404).send("<h2>फाइल फेला परेन वा म्याद सकियो।</h2><p>कृपया पठाउने व्यक्तिलाई नयाँ कोड सिर्जना गर्न भन्नुहोस्।</p>");
    }

    if (!file.filePath || !fs.existsSync(file.filePath)) {
      return res.status(400).send("<h2>फाइल अझै अपलोड भएको छैन।</h2><p>कृपया पठाउने व्यक्तिलाई अपलोड पुरा गर्न भन्नुहोस्।</p>");
    }

    file.downloadsCount += 1;
    file.status = "downloaded";
    console.log(`[Aadan Pradan Server] File ${file.name} downloaded. Total downloads: ${file.downloadsCount}`);

    // Stream download directly from disk with precise preservation of name, mimeType and size (Lossless transfer)
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    const encodedName = encodeURIComponent(file.name);
    res.setHeader("Content-Disposition", `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader("Content-Length", file.size.toString());

    const readStream = fs.createReadStream(file.filePath);
    readStream.pipe(res);
  });

  // API Route: Delete File (explicit manual cleanup)
  app.delete("/api/files/:code", (req, res) => {
    const code = req.params.code;
    const file = sharedFiles.get(code);
    if (file) {
      if (file.filePath && fs.existsSync(file.filePath)) {
        fs.unlink(file.filePath, (err) => {
          if (err) console.error(`[Aadan Pradan Server] Error deleting file ${file.filePath}:`, err);
        });
      }
      sharedFiles.delete(code);
      return res.json({ success: true, message: "फाइल सफलतापूर्वक मेटाइयो।" });
    }
    res.status(404).json({ error: "फाइल फेला परेन।" });
  });

  // Integration with Vite
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Aadan Pradan Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
