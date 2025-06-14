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
    origin: ["https://videodl.netlify.app", "http://localhost:5173", "*"],
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

  if (/youtube\.com/i.test(url) || /youtu\.be/i.test(url)) {
    const file = path.join(__dirname, "youtube.com_cookies.txt");
    console.log("[YouTube] Checking for cookies file at:", file);
    if (fs.existsSync(file)) {
      console.log("[YouTube] Using cookies file:", file);
      return file;
    } else {
      console.warn("[YouTube] youtube.com_cookies.txt not found at:", file);
      return null;
    }
  }
  // Other platforms as before
  const domainCookiesMap = {
    "facebook.com": "facebook.com_cookies.txt",
    "tiktok.com": "tiktok.com_cookies.txt",
    "vt.tiktok.com": "tiktok.com_cookies.txt",
    // "youtube.com": "youtube.com_cookies.txt",
    // "youtu.be": "youtube.com_cookies.txt",
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

  try {
    // Detect cookies.txt file if needed for private videos
    const cookiesFile = getCookiesFile(url);

    // Get video info for filename
    const infoArgs = ["--no-playlist"];
    if (cookiesFile) infoArgs.push("--cookies", cookiesFile);
    infoArgs.push(url);

    const info = await ytDlpWrap.getVideoInfo(infoArgs);
    const safeFilename = sanitizeFilename(info.title || uuidv4());
    const outputPath = path.join(tmpDir.name, `${safeFilename}.mp4`);

    return new Promise((resolve, reject) => {
      const args = ["--no-playlist", "--newline"];

      // Add cookies if available
      if (cookiesFile) {
        args.push("--cookies", cookiesFile);
      }

      // Handle format
      if (url.includes("facebook.com")) {
        // Always use best H.264 video + AAC audio for Facebook for compatibility
        args.push("-f", "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
        args.push("--merge-output-format", "mp4");
        args.push("--recode-video", "mp4");
      } else if (url.includes("x.com") || url.includes("twitter.com")) {
        // For X (Twitter), let yt-dlp pick and merge best video+audio (no recode)
        args.push("-f", "bestvideo*+bestaudio/best");
        args.push("--merge-output-format", "mp4");
        // Do NOT add --recode-video for X
      } else if (url.includes("instagram.com")) {
        // For Instagram: allow user to select any available format (audio or video)
        if (quality) {
          args.push("-f", quality);
        } else {
          // Default: best MP4 video+audio for compatibility
          args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best");
        }
        args.push("--merge-output-format", "mp4");
        args.push("--recode-video", "mp4");
        // Add browser-like headers for Instagram
        args.push(
          "--user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );
        args.push("--add-header", "Accept-Language: en-US,en;q=0.9");
        if (!cookiesFile) {
          console.warn(
            "[Instagram] No cookies file found. Some public videos may require login. If you see errors, please provide an up-to-date cookies file from your browser."
          );
        }
      } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
        // For YouTube: always use the user-selected format, merging with bestaudio if video-only
        if (quality) {
          const selectedFormat = (info.formats || []).find(
            (f) => f.format_id === quality
          );
          if (
            selectedFormat &&
            selectedFormat.vcodec === "none" &&
            selectedFormat.acodec &&
            selectedFormat.acodec !== "none"
          ) {
            // Audio-only: use the selected format as-is (no mp4 merge/recode)
            args.push("-f", quality);
            // Remove mp4 merge/recode flags later
          } else if (
            selectedFormat &&
            selectedFormat.vcodec &&
            selectedFormat.acodec === "none"
          ) {
            // Video-only: merge with best audio
            args.push("-f", `${quality}+bestaudio[acodec^=mp4a]/best`);
            args.push("--merge-output-format", "mp4");
            args.push("--recode-video", "mp4");
          } else {
            // Use the exact user-selected format
            args.push("-f", quality);
            args.push("--merge-output-format", "mp4");
            args.push("--recode-video", "mp4");
          }
        } else {
          args.push("-f", quality);
          args.push("--merge-output-format", "mp4");
          args.push("--recode-video", "mp4");
        }
        // Add browser-like user-agent for YouTube
        args.push(
          "--user-agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );
      } else {
        // Default: best H.264 video + AAC audio, fallback to best
        args.push("-f", "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best");
        args.push("--merge-output-format", "mp4");
        args.push("--recode-video", "mp4");
      }

      // Merge into MP4 using ffmpeg
      // Only add these if not audio-only
      const isAudioOnly =
        url.includes("youtube.com") || url.includes("youtu.be")
          ? (() => {
              const selectedFormat =
                quality &&
                (info.formats || []).find((f) => f.format_id === quality);
              return (
                selectedFormat &&
                selectedFormat.vcodec === "none" &&
                selectedFormat.acodec &&
                selectedFormat.acodec !== "none"
              );
            })()
          : false;
      if (!isAudioOnly) {
        args.push("--merge-output-format", "mp4");
        args.push("--recode-video", "mp4");
      }

      // Safe output file pattern
      args.push("-o", `${safeFilename}.%(ext)s`);

      // Add verbose for debugging (optional)
      // args.push("--verbose");

      args.push(url);

      let triedFallback = false;

      function runYtDlp(currentArgs) {
        const ytProcess = ytDlpWrap.exec(currentArgs, { cwd: tmpDir.name });
        ytProcess
          .on("progress", (progress) => {
            if (downloadId) {
              io.to(downloadId).emit("progress", {
                percent: progress.percent,
              });
            }
          })
          .on("stdout", (data) => {
            console.log(`[yt-dlp stdout] ${data}`);
          })
          .on("stderr", (data) => {
            console.error(`[yt-dlp stderr] ${data}`);
          })
          .on("error", (err) => {
            // Improved error logging
            console.error("yt-dlp error:", err);
            if (err && err.stderr) {
              console.error("yt-dlp stderr output:", err.stderr);
            }
            if (
              !triedFallback &&
              !url.includes("facebook.com") &&
              quality &&
              err &&
              (err.message?.includes("Requested format is not available") ||
                err.stderr?.includes("Requested format is not available"))
            ) {
              triedFallback = true;
              const fallbackArgs = [...args];
              // Replace the format argument with best compatible
              const formatIndex = fallbackArgs.findIndex(
                (a, i) => a === "-f" && fallbackArgs[i + 1] === quality
              );
              if (formatIndex !== -1) {
                fallbackArgs[formatIndex + 1] =
                  "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best";
              }
              return runYtDlp(fallbackArgs);
            }
            tmpDir.removeCallback();
            reject(err);
          })
          .on("close", () => {
            // Check for output
            // Find the merged .mp4 file (not .f*.mp4, not .txt, not .m4a)
            const mergedFile = fs.readdirSync(tmpDir.name).find(
              (file) =>
                file.endsWith(".mp4") &&
                !file.includes(".f") && // not a fragment
                !file.includes(".temp") &&
                !file.endsWith(".part.mp4")
            );

            if (!mergedFile) {
              // Check for .txt error file
              const txtFile = fs
                .readdirSync(tmpDir.name)
                .find((file) => file.endsWith(".txt"));
              if (txtFile) {
                const errorContent = fs.readFileSync(
                  path.join(tmpDir.name, txtFile),
                  "utf8"
                );
                tmpDir.removeCallback();
                return reject(
                  new Error(
                    `Download failed: Platform returned a .txt file instead of video.\n\nError content:\n${errorContent.substring(
                      0,
                      500
                    )}`
                  )
                );
              }
              tmpDir.removeCallback();
              return reject(
                new Error("Download failed: No merged .mp4 file found.")
              );
            }

            const fullPath = path.join(tmpDir.name, mergedFile);
            resolve({
              filePath: fullPath,
              filename: mergedFile,
              cleanup: tmpDir.removeCallback,
            });
          });
      }
      runYtDlp(args);
    });
  } catch (err) {
    tmpDir.removeCallback();
    throw err;
  }
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

      // Add these debug logs:
      console.log("yt-dlp path:", ytDlpPath);
      console.log(
        "yt-dlp args:",
        cookiesFile
          ? ["--no-playlist", "--cookies", cookiesFile, url]
          : ["--no-playlist", url]
      );
      console.log("process.cwd():", process.cwd());
      console.log("__dirname:", __dirname);
      console.log(
        "cookies file exists:",
        cookiesFile ? fs.existsSync(cookiesFile) : false
      );

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
        /youtube/i.test(errMsg) &&
        (/cookies/i.test(errMsg) ||
          /sign in/i.test(errMsg) ||
          /429/i.test(errMsg) ||
          /confirm you’re not a bot/i.test(errMsg))
      ) {
        return res.status(403).json({
          error:
            "YouTube requires valid cookies or is rate-limiting you. Please update your cookies file or try again later. See https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies for help.",
          details: errMsg,
        });
      }

      res.status(500).json({ error: "Download failed", details: err.message });
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

// Add this to your backend for a quick test
app.get("/api/yt-test", async (req, res) => {
  const url = "https://www.youtube.com/shorts/B1VBk-DRJik";
  const cookiesFile = getCookiesFile(url);
  const args = cookiesFile
    ? ["--cookies", cookiesFile, url]
    : [url];
  console.log("yt-dlp test args:", args);
  try {
    const result = await ytDlpWrap.execPromise(args);
    res.send(result);
  } catch (err) {
    res.status(500).send(err.stderr || err.message || "yt-dlp failed");
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
