const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const tmp = require("tmp");
const { v4: uuidv4 } = require("uuid");
const YtDlpWrap = require("yt-dlp-wrap").default;
const contentDisposition = require("content-disposition");
const http = require("http");
const { Server } = require("socket.io");
const archiver = require("archiver");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const os = require("os");

let fetch;
try {
  fetch = require("node-fetch").default;
} catch (e) {
  fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
}

const isWindows = os.platform() === "win32";

const ytDlpPath = isWindows
  ? path.resolve(__dirname, "bin", "yt-dlp.exe")
  : path.resolve(__dirname, "bin", "yt-dlp");

const ytDlpWrap = new YtDlpWrap(ytDlpPath);

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://videodl.netlify.app",
      "http://localhost:5173",
      "*",
    ],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("Client connected");
  socket.on("join", (downloadId) => {
    socket.join(downloadId);
    console.log(`Client joined download room: ${downloadId}`);
  });
});

app.use(
  cors({
    origin: ["https://videodl.netlify.app", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(bodyParser.json());

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: "Too many requests from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.static(path.join(__dirname, "../video-downloader/dist")));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../video-downloader/dist/index.html"));
});

function getCookiesFile(url) {
  if (/instagram\.com/i.test(url)) {
    const file = path.join(__dirname, "instagram.com_cookies.txt");
    if (fs.existsSync(file)) return file;
    return null;
  }
  const domainCookiesMap = {
    "facebook.com": "facebook.com_cookies.txt",
    "tiktok.com": "tiktok.com_cookies.txt",
    "vt.tiktok.com": "tiktok.com_cookies.txt",
    "youtube.com": "youtube.com_cookies.txt",
    "youtu.be": "youtube.com_cookies.txt",
    "twitter.com": "x.com_cookies.txt",
    "x.com": "x.com_cookies.txt",
  };
  for (const domain in domainCookiesMap) {
    if (url.includes(domain)) {
      const file = path.join(__dirname, domainCookiesMap[domain]);
      return fs.existsSync(file) ? file : null;
    }
  }
  return null;
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9-_\.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);
}

function isValidVideoUrl(url) {
  return (
    typeof url === "string" &&
    /^(https?:)?\/\/([a-zA-Z0-9-]+\.)?(youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|vt\.tiktok\.com|twitter\.com|x\.com)\//.test(
      url
    )
  );
}

async function downloadWithProgress({ url, quality, downloadId, io }) {
  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const cookiesFile = getCookiesFile(url);
  const info = await ytDlpWrap.getVideoInfo([
    "--no-playlist",
    ...(cookiesFile ? ["--cookies", cookiesFile] : []),
    url,
  ]);
  const safeFilename = sanitizeFilename(info.title || uuidv4());
  const outputPath = path.join(tmpDir.name, `${safeFilename}.mp4`);

  return new Promise((resolve, reject) => {
    const args = [
      ...(cookiesFile ? ["--cookies", cookiesFile] : []),
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "-f",
      quality || "best",
      "-o",
      outputPath,
      url,
    ];

    if (url.includes("facebook.com")) {
      args.push("-f", "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
      args.push("--merge-output-format", "mp4");
      args.push("--recode-video", "mp4");
    }

    let triedFallback = false;
    function runYtDlp(currentArgs) {
      const process = ytDlpWrap.exec(currentArgs, { cwd: tmpDir.name });

      process
        .on("progress", (progress) => {
          if (downloadId) {
            io.to(downloadId).emit("progress", progress);
          }
        })
        .on("error", (err) => {
          if (!triedFallback && quality) {
            triedFallback = true;
            const fallbackArgs = [...currentArgs];
            const idx = fallbackArgs.indexOf("-f");
            if (idx !== -1)
              fallbackArgs[idx + 1] =
                "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best";
            return runYtDlp(fallbackArgs);
          }
          tmpDir.removeCallback();
          reject(err);
        })
        .on("close", () => {
          const downloadedFile = fs
            .readdirSync(tmpDir.name)
            .find((f) => f.endsWith(".mp4"));
          if (!downloadedFile) {
            tmpDir.removeCallback();
            return reject(new Error("Download failed or file not found"));
          }
          resolve({
            filePath: path.join(tmpDir.name, downloadedFile),
            filename: downloadedFile,
            cleanup: tmpDir.removeCallback,
          });
        });
    }

    runYtDlp(args);
  });
}

app.get("/api/ping", (req, res) => {
  res.send("Backend is alive!");
});

app.post(
  "/api/downloads",
  [
    body("url").custom(isValidVideoUrl).withMessage("Invalid or unsupported video URL."),
    body("quality").optional().isString().isLength({ max: 50 }),
    body("downloadId").optional().isString().isLength({ max: 64 }),
  ],
  async (req, res) => {
    console.log("/api/downloads request body:", req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error("/api/downloads validation errors:", errors.array());
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { url, quality, downloadId } = req.body;

    try {
      const { filePath, filename, cleanup } = await downloadWithProgress({
        url,
        quality,
        downloadId,
        io,
      });

      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size,
        "Content-Disposition": contentDisposition(filename),
      });

      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => {
        if (downloadId) {
          io.to(downloadId).emit("progress", {
            percent: (chunk.length / stat.size) * 100,
          });
        }
      });
      stream.on("end", () => {
        if (downloadId) io.to(downloadId).emit("progress", { percent: 100 });
      });
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        cleanup();
        res.status(500).send("Failed to stream file");
      });
      stream.pipe(res);
      stream.on("close", cleanup);
    } catch (err) {
      console.error("Download error:", err);
      const msg = (err.stderr || err.message || "").toString();
      if (/facebook/i.test(msg) && /login required|cookies|not available/i.test(msg)) {
        return res.status(403).json({
          error:
            "Facebook requires login/cookies. Please upload cookies.txt or try a public video.",
          details: msg,
        });
      }
      res.status(500).json({ error: "Download failed", details: msg });
    }
  }
);

app.post(
  "/api/multi-downloads",
  [
    body("videos").isArray({ min: 1, max: 20 }),
    body("videos.*.url")
      .custom(isValidVideoUrl)
      .withMessage("Invalid or unsupported video URL in playlist."),
    body("videos.*.quality").optional().isString().isLength({ max: 20 }),
    body("videos.*.title").optional().isString().isLength({ max: 200 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { videos } = req.body;

    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ error: "No videos provided." });
    }

    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const archiveFilename = `${uuidv4()}.zip`;
    const archivePath = path.join(tmpDir.name, archiveFilename);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="videos-${Date.now()}.zip"`
    );

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    archive.on("error", (err) => {
      console.error("Archiver error:", err);
      tmpDir.removeCallback();
      res.status(500).end();
    });

    archive.on("end", () => {
      tmpDir.removeCallback();
    });

    archive.pipe(res);

    try {
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        try {
          const { filePath, filename, cleanup } = await downloadWithProgress({
            url: video.url,
            quality: video.quality,
            io,
          });

          // Sanitize and rename to avoid collisions
          const safeName = sanitizeFilename(video.title || filename || `video_${i}`);
          archive.file(filePath, { name: `${safeName}.mp4` });
          cleanup();
        } catch (e) {
          console.error(`Failed to download video ${video.url}:`, e);
          // Skip failed video or add a text file describing the failure
          archive.append(
            `Failed to download ${video.url}\nError: ${e.message || e}`,
            { name: `failed_${i}.txt` }
          );
        }
      }

      await archive.finalize();
    } catch (err) {
      console.error("Multi-download error:", err);
      res.status(500).json({ error: "Failed to create ZIP archive." });
      tmpDir.removeCallback();
    }
  }
);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
