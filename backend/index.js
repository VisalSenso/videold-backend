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
const { body, validationResult } = require("express-validator");
const os = require("os");
const { PassThrough } = require("stream");
const { spawn } = require("child_process");
const archiver = require("archiver"); // npm install archiver

const isWindows = os.platform() === "win32";
const ytDlpPath = isWindows
  ? path.resolve(__dirname, "bin", "yt-dlp.exe")
  : path.resolve(__dirname, "bin", "yt-dlp");
const ytDlpWrap = new YtDlpWrap(ytDlpPath);

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

app.use(
  cors({
    origin: ["https://videodl.netlify.app", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "../video-downloader/dist")));

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
  return name
    .replace(/[^a-zA-Z0-9-_\.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);
}

// Helper: validate URL is a valid video link
function isValidVideoUrl(url) {
  return (
    typeof url === "string" &&
    /^(https?:)?\/\/([a-zA-Z0-9-]+\.)?(youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|vt\.tiktok\.com|twitter\.com|x\.com)\//.test(
      url
    )
  );
}

// Helper: check if Instagram URL
function isInstagramUrl(url) {
  return /instagram\.com/i.test(url);
}

// Proxy thumbnail image fetching
app.get("/api/proxy-thumbnail", async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).send("Invalid URL");
  }
  try {
    let fetch;
    try {
      fetch = require("node-fetch").default;
    } catch (e) {
      fetch = (...args) =>
        import("node-fetch").then(({ default: fetch }) => fetch(...args));
    }
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

// POST /api/info - fetch video info (for frontend)
app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!isValidVideoUrl(url)) {
    return res.status(400).json({ error: "Invalid or unsupported video URL." });
  }
  try {
    const cookiesFile = getCookiesFile(url);
    const infoArgs = [];
    if (!isInstagramUrl(url)) infoArgs.push("--no-playlist");
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);
    const info = await ytDlpWrap.getVideoInfo(infoArgs);

    // If playlist
    if (info.entries && Array.isArray(info.entries)) {
      res.json({
        isPlaylist: true,
        playlistTitle: info.title,
        videos: info.entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          url: entry.url || entry.webpage_url,
          thumbnail: entry.thumbnail,
          formats: entry.formats,
        })),
      });
    } else {
      // Single video
      res.json(info);
    }
  } catch (err) {
    console.error("Failed at POST /api/info:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch video info", details: err.message });
  }
});

// GET /api/download - stream video to browser
app.post(
  "/api/download",
  [
    body("url")
      .custom(isValidVideoUrl)
      .withMessage("Invalid or unsupported video URL."),
    body("quality").optional().isString().isLength({ max: 50 }), // Allow longer format_id
    body("downloadId").optional().isString().isLength({ max: 64 }),
  ],
  async (req, res) => {
    // Log request body for debugging
    console.log("/api/downloads request body:", req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Log validation errors for debugging
      console.error("/api/downloads validation errors:", errors.array());
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { url, quality, downloadId } = req.body;

    try {
      const cookiesFile = getCookiesFile(url);

      // REMOVED cookies check to allow fetching without cookies for public videos

      // If quality not specified, return metadata (playlist or single)
      if (!quality) {
        const args = cookiesFile
          ? [
              "--cookies",
              cookiesFile,
              "--dump-single-json",
              "--flat-playlist",
              url,
            ]
          : ["--dump-single-json", "--flat-playlist", url];

        const infoJson = await ytDlpWrap.execPromise(args);
        const info = JSON.parse(infoJson);

        if (Array.isArray(info.entries)) {
          // Playlist detected: fetch full info per video
          const videos = await Promise.all(
            info.entries.map(async (v) => {
              // Use url from entry or build youtube url fallback
              const videoUrl =
                v.url || `https://www.youtube.com/watch?v=${v.id}`;

              const fullInfoArgs = cookiesFile
                ? ["--cookies", cookiesFile, "--dump-single-json", videoUrl]
                : ["--dump-single-json", videoUrl];

              const fullInfoJson = await ytDlpWrap.execPromise(fullInfoArgs);
              const fullInfo = JSON.parse(fullInfoJson);

              // --- Thumbnail robust extraction ---
              let thumbnail = fullInfo.thumbnail || null;
              // Fallback: use first HTTPS thumbnail from thumbnails array
              if (
                (!thumbnail || !/^https:/.test(thumbnail)) &&
                Array.isArray(fullInfo.thumbnails)
              ) {
                const httpsThumb = fullInfo.thumbnails.find(
                  (t) => t.url && t.url.startsWith("https:")
                );
                if (httpsThumb) thumbnail = httpsThumb.url;
              }

              return {
                id: fullInfo.id,
                title: fullInfo.title || `Video ${fullInfo.id}`,
                url: fullInfo.webpage_url || videoUrl,
                thumbnail,
                formats: fullInfo.formats || [],
              };
            })
          );

          return res.json({
            isPlaylist: true,
            playlistTitle: info.title || "Untitled Playlist",
            videos,
          });
        } else {
          // Single video metadata
          // --- Thumbnail robust extraction for single video ---
          let singleInfo = info;
          let thumbnail = singleInfo.thumbnail || null;
          if (
            (!thumbnail || !/^https:/.test(thumbnail)) &&
            Array.isArray(singleInfo.thumbnails)
          ) {
            const httpsThumb = singleInfo.thumbnails.find(
              (t) => t.url && t.url.startsWith("https:")
            );
            if (httpsThumb) thumbnail = httpsThumb.url;
          }
          singleInfo.thumbnail = thumbnail;
          return res.json(singleInfo);
        }
      }

      // Download with progress emitting
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
      let bytesSent = 0;
      let lastEmit = Date.now();
      let lastBytes = 0;
      const totalSize = stat.size;

      stream.on("data", (chunk) => {
        bytesSent += chunk.length;
        const percent = (bytesSent / totalSize) * 100;
        if (downloadId) {
          io.to(downloadId).emit("progress", {
            percent,
          });
        }
      });
      // Emit final progress with last speed and percent=100 when stream ends
      stream.on("end", () => {
        if (downloadId) {
          io.to(downloadId).emit("progress", {
            percent: 100,
          });
        }
      });
      stream.pipe(res);

      stream.on("close", cleanup);
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        cleanup();
        res.status(500).send("Failed to stream file");
      });
    } catch (err) {
      console.error("Failed at /api/downloads with URL:", req.body.url);
      console.error("Error details:", err.stderr || err.message || err);
      // Platform-specific error handling
      const errMsg = (err && (err.stderr || err.message || "")).toString();
      // Instagram
      if (
        /instagram/i.test(errMsg) &&
        /login required|rate-limit reached|not available|use --cookies|Main webpage is locked behind the login page|unable to extract shared data/i.test(
          errMsg
        )
      ) {
        // Log the full yt-dlp error for debugging
        console.error("[Instagram 403] yt-dlp error details:", errMsg);
        return res.status(403).json({
          error:
            "Instagram requires login/cookies to download this video. Please log in and provide cookies, or try a different public video.",
          details: errMsg,
        });
      }
      // Facebook
      if (
        /facebook/i.test(errMsg) &&
        /login required|not available|cookies/i.test(errMsg)
      ) {
        return res.status(403).json({
          error:
            "Facebook requires login/cookies to download this video. Please log in and provide cookies, or try a different public video.",
          details: errMsg,
        });
      }
      // TikTok
      if (
        /tiktok/i.test(errMsg) &&
        /login required|not available|cookies|forbidden|403/i.test(errMsg)
      ) {
        return res.status(403).json({
          error:
            "TikTok requires login/cookies to download this video. Please log in and provide cookies, or try a different public video.",
          details: errMsg,
        });
      }
      // YouTube
      if (
        /youtube|youtu\.be/i.test(errMsg) &&
        (/login required|not available|cookies|This video is private|sign in|429|Too Many Requests|quota exceeded|rate limit/i.test(
          errMsg
        ) ||
          /HTTP Error 429|Too Many Requests|quota/i.test(errMsg))
      ) {
        return res.status(429).json({
          error:
            "YouTube is temporarily blocking downloads from this server due to too many requests (HTTP 429 / rate limit). Please try again later, or use a different server or your local machine.",
          details: errMsg,
        });
      }
      res.status(500).json({ error: "Download failed", details: err.message });
    }
  }
);

// POST /api/download-playlist - download multiple videos as zip
app.post("/api/download-playlist", async (req, res) => {
  const { videos } = req.body; // [{url, quality, title}]
  if (!Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: "No videos provided" });
  }

  res.setHeader("Content-Disposition", contentDisposition("playlist.zip"));
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  for (const video of videos) {
    try {
      const infoArgs = [];
      if (!isInstagramUrl(video.url)) infoArgs.push("--no-playlist");
      const cookiesFile = getCookiesFile(video.url);
      if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
      infoArgs.push(video.url);

      const info = await ytDlpWrap.getVideoInfo(infoArgs);
      let selectedFormat = null;
      if (video.quality && info.formats) {
        selectedFormat = info.formats.find(
          (f) => f.format_id === video.quality
        );
      }
      const args = [];
      if (!isInstagramUrl(video.url)) args.push("--no-playlist");
      args.push("-f");
      if (
        selectedFormat &&
        selectedFormat.acodec !== "none" &&
        selectedFormat.vcodec !== "none"
      ) {
        args.push(video.quality);
      } else if (video.quality) {
        args.push(video.quality);
        args.push("--merge-output-format", "mp4");
      } else {
        args.push("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best");
        args.push("--merge-output-format", "mp4");
      }
      args.push("-o", "-", video.url);

      const ytProcess = spawn(ytDlpPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      archive.append(ytProcess.stdout, {
        name: sanitizeFilename(video.title || "video") + ".mp4",
      });
    } catch (err) {
      // Optionally: add a text file with error info
      archive.append(`Failed to download: ${video.title || video.url}\n`, {
        name: `error_${Date.now()}.txt`,
      });
    }
  }

  archive.finalize();
});

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
