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
// Use node-fetch import compatible with most Node.js environments
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
// Keep only if you're behind a proxy like Render or NGINX
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://videodl.netlify.app",
      "http://localhost:5173",
      "*", // Allow all origins for maximum compatibility
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

// ✅ Fix for rate-limit trust proxy validation
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Serve frontend static files
app.use(express.static(path.join(__dirname, "../video-downloader/dist")));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../video-downloader/dist/index.html"));
});

// Utility to get cookies file based on URL domain
function getCookiesFile(url) {
  // Always use instagram.com_cookies.txt for any Instagram URL
  if (/instagram\.com/i.test(url)) {
    const file = path.join(__dirname, "instagram.com_cookies.txt");
    console.log("[Instagram] __dirname:", __dirname);
    console.log("[Instagram] process.cwd():", process.cwd());
    console.log("[Instagram] Checking for cookies file at:", file);
    if (fs.existsSync(file)) {
      console.log("[Instagram] Using cookies file:", file);
      return file;
    } else {
      console.warn("[Instagram] instagram.com_cookies.txt not found at:", file);
      return null;
    }
  }
  // Other platforms as before
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

// Sanitize filename for safety
function sanitizeFilename(name) {
  // Remove non-ASCII and special characters for ffmpeg compatibility
  return name
    .replace(/[^a-zA-Z0-9-_\.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);
}

// Helper: validate URL is a valid video link
function isValidVideoUrl(url) {
  // Accept YouTube, Facebook, Instagram, TikTok, X/Twitter, TikTok short links
  // Allow both http and https, and also protocol-relative URLs
  return (
    typeof url === "string" &&
    /^(https?:)?\/\/([a-zA-Z0-9-]+\.)?(youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|vt\.tiktok\.com|twitter\.com|x\.com)\//.test(
      url
    )
  );
}

// Download helper with socket.io progress emit
async function downloadWithProgress({ url, quality, downloadId, io }) {
  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const cookiesFile = getCookiesFile(url);
  const info = await ytDlpWrap.getVideoInfo(["--no-playlist", ...(cookiesFile ? ["--cookies", cookiesFile] : []), url]);
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
            if (idx !== -1) fallbackArgs[idx + 1] = "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best";
            return runYtDlp(fallbackArgs);
          }
          tmpDir.removeCallback();
          reject(err);
        })
        .on("close", () => {
          const downloadedFile = fs.readdirSync(tmpDir.name).find((f) => f.endsWith(".mp4"));
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

// API: initialize download, return formats + downloadId + filename
app.post(
  "/api/init-download",
  body("url")
    .custom(isValidVideoUrl)
    .withMessage("Invalid or unsupported video URL."),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const { url } = req.body;
      const cookiesFile = getCookiesFile(url);

      // REMOVED cookies check to allow fetching without cookies for public videos

      // Fetch video info with cookies if available
      const args = cookiesFile
        ? ["--no-playlist", "--cookies", cookiesFile, url]
        : ["--no-playlist", url];

      const info = await ytDlpWrap.getVideoInfo(args);
      const filename = sanitizeFilename(info.title || "video");

      // Filter formats with URLs (exclude dash, live etc. if desired)
      // Filter formats with playable video and exclude AV1
      const formats = (info.formats || []).filter(
        (f) => f.url && (!f.vcodec || !f.vcodec.includes("av01"))
      );

      res.json({
        downloadId: uuidv4(),
        filename,
        formats,
      });
    } catch (err) {
      console.error("Init download error:", err);
      res.status(500).json({ error: "Failed to get video info" });
    }
  }
);

app.get("/api/ping", (req, res) => {
  res.send("Backend is alive!");
});

// API: download video (or metadata if no quality specified)
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
      const { filePath, filename, cleanup } = await downloadWithProgress({ url, quality, downloadId, io });

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
          error: "Facebook requires login/cookies. Please upload cookies.txt or try a public video.",
          details: msg,
        });
      }
      res.status(500).json({ error: "Download failed", details: msg });
    }
  }
);

// API: multi-downloads (playlist ZIP)
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

    const { videos } = req.body; // expect: [{ url, quality, title }, ...]

    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ error: "No videos provided." });
    }

    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const archiveFilename = `${uuidv4()}.zip`;
    const archivePath = path.join(tmpDir.name, archiveFilename);

    const output = fs.createWriteStream(archivePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    try {
      let totalVideos = videos.length;
      let completedVideos = 0;
      for (const video of videos) {
        const { url, quality, title } = video;
        const cookiesFile = getCookiesFile(url);

        // REMOVED cookies check to allow fetching without cookies for public videos

        const baseArgs = cookiesFile
          ? ["--cookies", cookiesFile, "--no-playlist", url]
          : ["--no-playlist", url];
        const info = await ytDlpWrap.getVideoInfo(baseArgs);

        let formatArg;
        if (url.includes("facebook.com")) {
          formatArg = "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best";
        } else if (url.includes("instagram.com")) {
          formatArg = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best";
        } else if (quality) {
          if (url.includes("youtube.com") || url.includes("youtu.be")) {
            const selectedFormat = (info.formats || []).find(
              (f) => f.format_id === quality
            );
            if (
              selectedFormat &&
              selectedFormat.vcodec &&
              selectedFormat.acodec === "none"
            ) {
              formatArg =
                "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best";
            } else {
              formatArg = quality;
            }
          } else {
            formatArg = quality;
          }
        } else {
          formatArg = "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best";
        }

        // Use provided title sanitized or fallback
        const safeTitle = title
          ? sanitizeFilename(title)
          : info.title
          ? sanitizeFilename(info.title)
          : uuidv4();

        const filename = `${safeTitle}.mp4`;
        const filePath = path.join(tmpDir.name, filename);

        await ytDlpWrap.execPromise(
          [
            ...baseArgs,
            "-f",
            formatArg,
            "--merge-output-format",
            "mp4",
            "--recode-video",
            "mp4",
            "-o",
            filename,
          ],
          { cwd: tmpDir.name }
        );

        if (!fs.existsSync(filePath)) {
          tmpDir.removeCallback();
          return res.status(500).json({ error: `File not found for ${url}` });
        }

        archive.file(filePath, { name: filename });
        completedVideos++;
        // Emit progress after each video is added to the archive
        io.emit("progress", {
          percent: Math.round((completedVideos / totalVideos) * 100),
          isZip: true,
        });
      }

      await archive.finalize();

      output.on("close", () => {
        // Emit 100% progress when zip is done
        io.emit("progress", {
          percent: 100,
          isZip: true,
        });
        res.setHeader("Content-Disposition", contentDisposition("videos.zip"));
        res.setHeader("Content-Type", "application/zip");

        const stream = fs.createReadStream(archivePath);
        stream.pipe(res);

        stream.on("close", () => tmpDir.removeCallback());
        stream.on("error", (err) => {
          console.error("Stream error:", err);
          tmpDir.removeCallback();
          res.status(500).send("Failed to stream archive");
        });
      });
    } catch (err) {
      console.error("Failed at /api/multi-downloads", err);
      tmpDir.removeCallback();
      res.status(500).send("Multi-download error occurred");
    }
  }
);

// Proxy thumbnail image fetching
app.get("/api/proxy-thumbnail", async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).send("Invalid URL");
  }
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      res.set("Access-Control-Allow-Origin", "*");
      return res
        .status(502)
        .send(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
    }
    res.set(
      "Content-Type",
      response.headers.get("content-type") || "image/jpeg"
    );
    res.set("Access-Control-Allow-Origin", "*");
    response.body.pipe(res);
  } catch (e) {
    console.error("Proxy thumbnail error:", e);
    res.set("Access-Control-Allow-Origin", "*");
    res
      .status(500)
      .send("Error proxying image: " + (e && e.message ? e.message : e));
  }
});

// Serve frontend for all non-API, non-static routes (must be last!)
app.use(express.static(path.join(__dirname, "../video-downloader/dist")));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../video-downloader/dist/index.html"));
});

// Start the server
server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
