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

// This implementation adds:
// 1. Caching of processed videos in a local folder (cache by video ID and quality)
// 2. If a direct video URL is available, redirect the browser to it for instant download
// 3. If not cached and no direct link, process with yt-dlp, cache, and then serve

const CACHE_DIR = path.join(__dirname, "video_cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// Helper: get cache file path by videoId and quality
function getCacheFilePath(videoId, quality) {
  return path.join(CACHE_DIR, `${videoId}_${quality || "best"}.mp4`);
}

// Helper: try to extract direct video URL (for instant redirect)
async function getDirectVideoUrl(url, quality, cookiesFile) {
  try {
    const infoArgs = ["--no-playlist", "--dump-json"];
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);
    const info = await ytDlpWrap.getVideoInfo(infoArgs);
    // Try to find a direct video URL for the requested quality
    let format = null;
    if (quality) {
      format = info.formats.find((f) => f.format_id === quality && f.url);
    }
    if (!format) {
      // fallback to best
      format = info.formats.find(
        (f) => f.url && f.vcodec !== "none" && f.acodec !== "none"
      );
    }
    if (format && format.url) {
      return format.url;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// API: download video (GET for direct browser download, stream instantly)
app.get("/api/downloads", async (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality;

  if (!isValidVideoUrl(url)) {
    return res.status(400).json({ error: "Invalid or unsupported video URL." });
  }

  try {
    const cookiesFile = getCookiesFile(url);
    const infoArgs = ["--no-playlist"];
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);

    const info = await ytDlpWrap.getVideoInfo(infoArgs);
    const safeFilename = sanitizeFilename(info.title || "video") + ".mp4";

    const args = ["--no-playlist", "-f"];
    if (url.includes("facebook.com")) {
      args.push("bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
    } else if (url.includes("instagram.com")) {
      args.push("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best");
    } else if (quality) {
      args.push(quality);
    } else {
      args.push("bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
    }

    args.push("--merge-output-format", "mp4");
    args.push("--recode-video", "mp4");
    args.push("-o", "-", url); // Output to stdout

    const ytProcess = spawn(ytDlpPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stream = new PassThrough();
    let responseEnded = false;

    // Set headers immediately
    res.setHeader("Content-Disposition", contentDisposition(safeFilename));
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Transfer-Encoding", "chunked");

    // Pipe the yt-dlp output directly to client
    stream.pipe(res);
    ytProcess.stdout.pipe(stream);

    ytProcess.stderr.on("data", (data) => {
      console.error("[yt-dlp stderr]", data.toString());
    });

    ytProcess.on("error", (err) => {
      console.error("yt-dlp error (stream):", err);
      if (!responseEnded) {
        responseEnded = true;
        if (!res.headersSent) {
          res.status(500).end("yt-dlp error");
        } else {
          stream.end();
        }
      }
    });

    ytProcess.on("close", (code) => {
      if (!responseEnded) {
        responseEnded = true;
        stream.end();
      }
      if (code !== 0) {
        console.error("yt-dlp exited with code", code);
      }
    });
  } catch (err) {
    console.error("Download failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed", details: err.message });
    } else {
      res.end();
    }
  }
});

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
    const infoArgs = ["--no-playlist"];
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);
    const info = await ytDlpWrap.getVideoInfo(infoArgs);

    // Start background caching for single video (not playlist)
    if (!info.entries) {
      const videoId = info.id || uuidv4();
      const cacheFile = getCacheFilePath(videoId, null);
      if (!fs.existsSync(cacheFile)) {
        // Download in background
        const args = [
          "--no-playlist",
          "-f", "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best",
          "--merge-output-format", "mp4",
          "--recode-video", "mp4",
          "-o", cacheFile,
          url
        ];
        const ytProcess = spawn(ytDlpPath, args, {
          stdio: ["ignore", "ignore", "ignore"]
        });
        ytProcess.on("close", (code) => {
          if (code === 0) {
            console.log("Background cache complete:", cacheFile);
          } else {
            console.error("Background cache failed for", url);
          }
        });
      }
    }

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

    // In /api/info, after fetching info:
    if (!info.entries && info.formats) {
      // Cache all available formats (or just the most popular ones)
      const formatsToCache = info.formats
        .filter(
          (f) => f.ext === "mp4" && f.vcodec !== "none" && f.acodec !== "none"
        )
        .slice(0, 3); // Limit to top 3 formats for disk space

      formatsToCache.forEach((format) => {
        const videoId = info.id || uuidv4();
        const cacheFile = getCacheFilePath(videoId, format.format_id);
        if (!fs.existsSync(cacheFile)) {
          const args = [
            "--no-playlist",
            "-f",
            format.format_id,
            "--merge-output-format",
            "mp4",
            "--recode-video",
            "mp4",
            "-o",
            cacheFile,
            url,
          ];
          const ytProcess = spawn(ytDlpPath, args, {
            stdio: ["ignore", "ignore", "ignore"],
          });
          ytProcess.on("close", (code) => {
            if (code === 0) {
              console.log("Background cache complete:", cacheFile);
            } else {
              console.error(
                "Background cache failed for",
                url,
                "format",
                format.format_id
              );
            }
          });
        }
      });
    }
  } catch (err) {
    console.error("Failed at POST /api/info:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch video info", details: err.message });
  }
});

// GET /api/download - improved: cache, direct link, or process
app.get("/api/download", async (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality;
  if (!isValidVideoUrl(url)) {
    return res.status(400).json({ error: "Invalid or unsupported video URL." });
  }
  try {
    const cookiesFile = getCookiesFile(url);
    const infoArgs = ["--no-playlist"];
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);
    const info = await ytDlpWrap.getVideoInfo(infoArgs);
    const videoId = info.id || uuidv4();
    const safeFilename = sanitizeFilename(info.title || videoId) + ".mp4";
    const cacheFile = getCacheFilePath(videoId, quality || "best");

    // Serve cached file instantly if exists
    if (fs.existsSync(cacheFile)) {
      res.setHeader("Content-Disposition", contentDisposition(safeFilename));
      res.setHeader("Content-Type", "video/mp4");
      const readStream = fs.createReadStream(cacheFile);
      return readStream.pipe(res);
    }

    // 2. Try to get a direct video URL and redirect
    const directUrl = await getDirectVideoUrl(url, quality, cookiesFile);

    // Only redirect for YouTube (and maybe others), NOT TikTok, Facebook, Instagram
    const isTikTok =
      url.includes("tiktok.com") || url.includes("vt.tiktok.com");
    const isFacebook = url.includes("facebook.com") || url.includes("fb.watch");
    const isInstagram = url.includes("instagram.com");

    if (directUrl && !isTikTok && !isFacebook && !isInstagram) {
      return res.redirect(directUrl);
    }

    // 3. Not cached and no direct link: process and cache
    const args = ["--no-playlist", "-f"];
    if (url.includes("facebook.com")) {
      args.push("bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
    } else if (url.includes("instagram.com")) {
      args.push("bestvideo[ext=mp4]+bestaudio[ext=m4a]/best");
    } else if (quality) {
      args.push(quality);
    } else {
      args.push("bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
    }
    args.push("--merge-output-format", "mp4");
    args.push("--recode-video", "mp4");
    args.push("-o", cacheFile, url); // Output to cache file

    // Run yt-dlp to process and cache
    await new Promise((resolve, reject) => {
      const ytProcess = spawn(ytDlpPath, args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      ytProcess.stderr.on("data", (data) => {
        console.error("[yt-dlp stderr]", data.toString());
      });
      ytProcess.on("error", reject);
      ytProcess.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("yt-dlp exited with code " + code));
      });
    });

    // Serve the cached file
    res.setHeader("Content-Disposition", contentDisposition(safeFilename));
    res.setHeader("Content-Type", "video/mp4");
    const readStream = fs.createReadStream(cacheFile);
    readStream.pipe(res);
  } catch (err) {
    console.error("Download failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed", details: err.message });
    } else {
      res.end();
    }
  }
});

// Cache cleanup: Remove files older than MAX_CACHE_AGE_MS (e.g. 7 days)
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cleanupCache() {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return console.error("Cache cleanup error:", err);
    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > MAX_CACHE_AGE_MS) {
          fs.unlink(filePath, (err) => {
            if (!err) {
              console.log("Deleted old cache file:", filePath);
            }
          });
        }
      });
    });
  });
}

// Run cache cleanup every 12 hours
setInterval(cleanupCache, 12 * 60 * 60 * 1000);
// Also run on server start
cleanupCache();

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
