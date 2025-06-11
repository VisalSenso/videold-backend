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

// API: download video (GET for direct browser download, stream instantly)
app.get("/api/downloads", async (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality;
  if (!isValidVideoUrl(url)) {
    return res.status(400).json({ error: "Invalid or unsupported video URL." });
  }
  try {
    const cookiesFile = getCookiesFile(url);
    // Get video info for filename
    const infoArgs = ["--no-playlist"];
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);
    const info = await ytDlpWrap.getVideoInfo(infoArgs);
    const safeFilename = sanitizeFilename(info.title || uuidv4()) + ".mp4";

    // Build yt-dlp args for streaming
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

    res.setHeader("Content-Disposition", contentDisposition(safeFilename));
    res.setHeader("Content-Type", "video/mp4");

    const { spawn } = require("child_process");
    const ytDlpBin = ytDlpPath;
    const ytArgs = args;
    const ytProcess = spawn(ytDlpBin, ytArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    ytProcess.stdout.pipe(res, { end: true });

    ytProcess.stderr.on("data", (data) => {
      console.error(`[yt-dlp stderr]`, data.toString());
    });
    ytProcess.on("error", (err) => {
      console.error("yt-dlp error (stream):", err);
      res.status(500).end("yt-dlp error");
    });
    ytProcess.on("close", (code) => {
      if (code !== 0) {
        console.error("yt-dlp exited with code", code);
      }
    });
  } catch (err) {
    console.error("Failed at GET /api/downloads (stream) with URL:", url);
    console.error("Error details:", err.stderr || err.message || err);
    res.status(500).json({ error: "Download failed", details: err.message });
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

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
