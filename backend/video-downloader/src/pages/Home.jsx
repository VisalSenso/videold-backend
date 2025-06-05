import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faPlay } from "@fortawesome/free-solid-svg-icons";
import Howto from "../components/Howto";

function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [selectedFormats, setSelectedFormats] = useState({}); // For playlist videos
  const [selectedVideos, setSelectedVideos] = useState(new Set()); // Track selected videos for batch download
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState({});
  const lastProgressUpdateRef = useRef({});
  const lastLoadedRef = useRef({});
  const [downloadId, setDownloadId] = useState(null);
  const [formatFilter, setFormatFilter] = useState("all"); // 1. Add format filter tabs state

  const socketRef = useRef();

  useEffect(() => {
    // Initialize socket only once
    socketRef.current = io("http://localhost:3000");

    // When connected, emit join with downloadId if available
    socketRef.current.on("connect", () => {
      if (downloadId) {
        socketRef.current.emit("join", downloadId);
      }
    });

    socketRef.current.on("progress", ({ percent }) => {
      setDownloadProgress(percent);
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [downloadId]); // Will re-run whenever downloadId changes

  const handleFetchInfo = async () => {
    if (!url) return alert("Please enter a URL");
    setLoading(true);
    setVideoInfo(null);
    setIsPlaylist(false);
    setSelectedFormat(null);
    setSelectedFormats({});
    setSelectedVideos(new Set());

    try {
      const res = await axios.post("http://localhost:3000/api/downloads", {
        url,
      });

      if (res.data.isPlaylist) {
        setIsPlaylist(true);
        setVideoInfo({
          title: res.data.playlistTitle,
          videos: res.data.videos || [],
        });

        // 🟨 Add this log here to inspect playlist structure
        console.log("Playlist videoInfo:", {
          title: res.data.playlistTitle,
          videos: res.data.videos || [],
        });

        // Initialize selected formats for each video to first available format
        const initialFormats = {};
        res.data.videos?.forEach((v) => {
          if (v.formats?.length > 0)
            initialFormats[v.id] = v.formats[0].format_id;
        });
        setSelectedFormats(initialFormats);
      } else {
        setVideoInfo(res.data);
        // 🟨 Log for single video
        console.log("Single videoInfo:", res.data);

        if (res.data.formats?.length > 0) {
          setSelectedFormat(res.data.formats[0].format_id);
        }
      }
    } catch {
      alert("Failed to fetch video or playlist info.");
    }

    setLoading(false);
  };

  const THROTTLE_INTERVAL = 500; // ms

  const handleDownload = async () => {
    if (!url || !selectedFormat) {
      alert("Please fetch a video and select a format.");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    let socketProgressHandler;
    try {
      // Always get a fresh downloadId and filename
      const initRes = await axios.post(
        "http://localhost:3000/api/init-download",
        {
          url,
        }
      );
      const downloadIdToUse = initRes.data.downloadId;
      const filename = initRes.data.filename;
      // Join the socket room for this downloadId immediately
      socketRef.current.emit("join", downloadIdToUse);
      setDownloadId(downloadIdToUse); // still set for UI, but don't rely on useEffect for join

      // Listen for progress events for this download
      socketProgressHandler = ({ percent }) => {
        setDownloadProgress(percent || 0);
      };
      socketRef.current.on("progress", socketProgressHandler);

      const res = await axios.post(
        "http://localhost:3000/api/downloads",
        {
          url,
          quality:
            isFacebookUrl(url) &&
            !["m4a", "mp3"].includes((selectedFormatExt() || "").toLowerCase())
              ? undefined
              : selectedFormat,
          downloadId: downloadIdToUse,
        },
        { responseType: "blob" }
      );

      let contentDisposition = res.headers["content-disposition"];
      let ext = ".mp4";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?.*\.(\w+)"?/);
        if (match && match[1]) {
          ext = "." + match[1];
        }
      }
      const blob = new Blob([res.data]);
      triggerDownload(blob, `${filename}${ext}`);
    } catch (err) {
      alert("Download failed");
      console.error(err);
    }

    // Clean up socket listener after download
    if (socketProgressHandler) {
      socketRef.current.off("progress", socketProgressHandler);
    }
    setIsDownloading(false);
    setDownloadProgress(0);
    setDownloadId(null); // clear after download
  };

  // Helper to get selected format extension
  function selectedFormatExt() {
    if (!videoInfo || !videoInfo.formats) return null;
    const fmt = videoInfo.formats.find((f) => f.format_id === selectedFormat);
    return fmt?.ext || null;
  }

  function triggerDownload(blob, filename) {
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const toggleVideoSelection = (videoId) => {
    setSelectedVideos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(videoId)) {
        newSet.delete(videoId);
      } else {
        newSet.add(videoId);
      }
      return newSet;
    });
  };

  const handleMultiDownload = async () => {
    if (selectedVideos.size === 0) {
      alert("Please select videos to download.");
      return;
    }

    const videosToDownload = Array.from(selectedVideos)
      .map((videoId) => {
        const video = videoInfo.videos.find((v) => v.id === videoId);
        if (!video) return null;
        const quality =
          selectedFormats[videoId] || video.formats?.[0]?.format_id;
        if (!quality) return null;
        return { url: video.url, quality, title: video.title };
      })
      .filter(Boolean);

    if (videosToDownload.length === 0) {
      alert("No valid videos to download.");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    let downloadIdToUse = null;
    let filename = "videos";
    try {
      // 1. Get a downloadId for this multi-download
      const initRes = await axios.post(
        "http://localhost:3000/api/init-download",
        {
          url: url, // pass the playlist url for context
          isZip: true,
        }
      );
      downloadIdToUse = initRes.data.downloadId;
      filename = initRes.data.filename || "videos";
      // 2. Join the socket room for this downloadId
      socketRef.current.emit("join", downloadIdToUse);
      setDownloadId(downloadIdToUse);

      // 3. Listen for progress events for this downloadId (ZIP)
      // (Already handled in useEffect)

      // 4. Start the download request
      const res = await axios.post(
        "http://localhost:3000/api/multi-downloads",
        { videos: videosToDownload, downloadId: downloadIdToUse },
        {
          responseType: "blob",
        }
      );

      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", `${filename}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert("Failed to download selected videos as ZIP.");
      console.error(err);
    }

    setIsDownloading(false);
    setDownloadProgress(0);
    setDownloadId(null);
  };

  // Helper to check if a URL is a Facebook link
  const isFacebookUrl = (url) => url && url.includes("facebook.com");

  // 2. Helper to filter formats
  const filterFormats = (formats) => {
    if (formatFilter === "all") return formats;
    return formats.filter((f) => f.ext && f.ext.toLowerCase() === formatFilter);
  };

  useEffect(() => {
    // Load the AdSense script only once
    const script = document.createElement("script");
    script.async = true;
    script.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
    script.setAttribute("data-ad-client", "ca-pub-XXXXXXXXXXXXXXXX"); // <-- Replace this
    document.head.appendChild(script);

    // Trigger ad load
    const interval = setInterval(() => {
      try {
        // Inject ads manually (required in React)
        if (window.adsbygoogle && window.adsbygoogle.push) {
          window.adsbygoogle.push({});
          clearInterval(interval); // success
        }
      } catch (e) {}
    }, 1000); // retry every second until adsbygoogle is ready

    return () => {
      document.head.removeChild(script);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#ffffff] text-text-color p-6 flex items-center justify-center">
      <div className="w-full max-w-3xl  p-8 space-y-6">
        {/* Google AdSense ad unit */}
        <div className="flex justify-center my-4">
          <ins
            className="adsbygoogle"
            style={{ display: "block", width: "100%", minHeight: 90 }}
            data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" // <-- Replace this
            data-ad-slot="1234567890" // <-- Replace this
            data-ad-format="auto"
            data-full-width-responsive="true"
          ></ins>
        </div>
        <h1 className="text-3xl font-bold text-center text-text-color">
          Video <span className="text-primary ">Downloader</span>
        </h1>
        <p className="text-center text-sm text-gray-400">
          Enter a video or playlist URL to fetch available formats and download
          options. Supports YouTube, Facebook, Instagram Tik Tok and X
          (Twitter).
        </p>

        <div className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Paste video or playlist URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 border-2 border-[#eae9e9] px-4 py-3 rounded-lg text-text-color active:border-prbg-primary focus:border-prbg-primary focus:outline-none transition-colors duration-200"
          />
          <button
            onClick={handleFetchInfo}
            className="bg-primary cursor-pointer text-[#ffffff] px-6 py-3 rounded-lg"
          >
            {loading ? "Loading..." : "Fetch"}
          </button>
        </div>

        {isPlaylist && videoInfo?.videos?.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-center">
              {videoInfo.title}
            </h2>
            {isFacebookUrl(url) && (
              <div className="text-yellow-400 text-center text-sm font-semibold">
                For Facebook videos, only the best quality will be downloaded
                for compatibility. Quality selection is disabled.
              </div>
            )}
            <p className="text-sm text-center text-gray-400">
              Select videos to download
            </p>

            {/* Format filter tabs for playlist videos */}
            {isPlaylist && videoInfo?.videos?.length > 0 && (
              <div className="flex gap-2 mt-2 mb-2 justify-center">
                {["all", "mp4", "mkv", "webm", "mp3", "m4a"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setFormatFilter(type)}
                    className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors duration-150 ${
                      formatFilter === type
                        ? "bg-primary text-white border-primary shadow"
                        : "bg-white text-primary border-gray-200 hover:bg-blue-50"
                    }`}
                  >
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            <ul className="space-y-4 max-h-[600px] overflow-y-auto">
              {videoInfo.videos.map((video) => (
                <li
                  key={video.id}
                  className="flex flex-col sm:flex-row  rounded-xl p-4 gap-4 items-center"
                >
                  <input
                    type="checkbox"
                    checked={selectedVideos.has(video.id)}
                    onChange={() => toggleVideoSelection(video.id)}
                    className="w-5 h-5"
                  />

                  {/* Video preview with play icon overlay for playlist videos */}
                  {video.thumbnail ? (
                    <div className="relative w-48 h-28 rounded-md overflow-hidden group">
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        className="w-48 h-28 object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                        <FontAwesomeIcon
                          icon={faPlay}
                          className="text-primary drop-shadow-lg text-3xl bg-white/70 rounded-full p-2"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="w-48 h-28 bg-gray-700 flex items-center justify-center text-sm text-gray-400 rounded-md">
                      No thumbnail
                    </div>
                  )}

                  <div className="flex-1 space-y-2">
                    <h3 className="text-lg font-semibold">{video.title}</h3>

                    {/* Format filter tabs for single video */}
                    {videoInfo && !isPlaylist && videoInfo.formats && (
                      <div className="flex gap-2 mt-4 mb-2">
                        {["all", "mp4", "mkv", "webm", "mp3", "m4a"].map(
                          (type) => (
                            <button
                              key={type}
                              onClick={() => setFormatFilter(type)}
                              className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors duration-150 ${
                                formatFilter === type
                                  ? "bg-primary text-white border-primary shadow"
                                  : "bg-white text-primary border-gray-200 hover:bg-blue-50"
                              }`}
                            >
                              {type.toUpperCase()}
                            </button>
                          )
                        )}
                      </div>
                    )}

                    {isFacebookUrl(url) ? (
                      <div className="mt-3 w-full border border-[#eae9e9] px-4 py-2 rounded-md text-text-color bg-gray-100 text-center font-semibold">
                        Best available video+audio (auto-selected for
                        compatibility)
                      </div>
                    ) : (
                      <select
                        className="mt-3 w-full border border-[#eae9e9] px-4 py-2 rounded-md text-text-color focus:ring-2 focus:ring-primary focus:border-primary transition"
                        value={selectedFormat || ""}
                        onChange={(e) => setSelectedFormat(e.target.value)}
                        disabled={isFacebookUrl(url)}
                      >
                        {filterFormats(videoInfo.formats)?.map((format) => (
                          <option
                            key={format.format_id}
                            value={format.format_id}
                          >
                            {format.format_note || "Unknown"} • {format.ext} •{" "}
                            {format.filesize
                              ? (format.filesize / (1024 * 1024)).toFixed(1) +
                                " MB"
                              : "N/A"}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const formatId =
                            selectedFormats[video.id] ||
                            video.formats?.[0]?.format_id;

                          if (!formatId) {
                            alert("Please select a format first.");
                            return;
                          }

                          // Set initial download state
                          setDownloadStatus((prev) => ({
                            ...prev,
                            [video.id]: {
                              ...prev[video.id],
                              progress: 0,
                              isDownloading: true,
                            },
                          }));

                          lastLoadedRef.current[video.id] = 0;
                          lastProgressUpdateRef.current[video.id] = Date.now();

                          try {
                            const res = await axios.post(
                              "http://localhost:3000/api/downloads",
                              { url: video.url, quality: formatId },
                              {
                                responseType: "blob",
                                onDownloadProgress: (progressEvent) => {
                                  const total =
                                    progressEvent.total ?? progressEvent.loaded;
                                  const loaded = progressEvent.loaded;
                                  const percent = (loaded / total) * 100;

                                  const now = Date.now();
                                  const elapsed =
                                    (now -
                                      (lastProgressUpdateRef.current[
                                        video.id
                                      ] || now)) /
                                    1000;

                                  const deltaLoaded =
                                    loaded -
                                    (lastLoadedRef.current[video.id] || 0);

                                  const speedBytesPerSec =
                                    deltaLoaded / (elapsed || 1);
                                  const estimatedTimeSec = speedBytesPerSec
                                    ? (total - loaded) / speedBytesPerSec
                                    : 0;

                                  setDownloadStatus((prev) => ({
                                    ...prev,
                                    [video.id]: {
                                      progress: percent,
                                      isDownloading: true,
                                    },
                                  }));

                                  lastLoadedRef.current[video.id] = loaded;
                                  lastProgressUpdateRef.current[video.id] = now;
                                },
                              }
                            );

                            const blobUrl = window.URL.createObjectURL(
                              new Blob([res.data])
                            );
                            const link = document.createElement("a");
                            link.href = blobUrl;
                            link.setAttribute("download", `${video.title}.mp4`);
                            document.body.appendChild(link);
                            link.click();
                            link.remove();
                            window.URL.revokeObjectURL(blobUrl);
                          } catch (err) {
                            console.error(err);
                            alert("Failed to download video.");
                          }

                          // Mark download as complete
                          setDownloadStatus((prev) => ({
                            ...prev,
                            [video.id]: {
                              ...prev[video.id],
                              isDownloading: false,
                              progress: 100,
                            },
                          }));
                        }}
                        className="bg-primary cursor-pointer text-text-btn px-4 py-2 rounded-md flex items-center gap-2 shadow hover:bg-blue-700 focus:ring-2 focus:ring-blue-400 transition"
                      >
                        <FontAwesomeIcon
                          icon={faDownload}
                          className="w-5 h-5"
                        />
                        Download
                      </button>

                      {downloadStatus[video.id] && (
                        <div className="w-full space-y-2 mt-4">
                          <div className="relative w-full h-5 bg-gray-200 rounded-full overflow-hidden shadow-md">
                            <div
                              className={`absolute left-0 top-0 h-full transition-all duration-300 ease-out animate-gradient-x`}
                              style={{
                                width: `${
                                  downloadStatus[video.id].progress || 0
                                }%`,
                                background:
                                  "linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #2563eb 100%)",
                                borderRadius: "9999px",
                              }}
                            >
                              {/* Animated dot at the end */}
                              <div
                                className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-blue-400 rounded-full shadow-lg animate-bounce"
                                style={{
                                  display:
                                    (downloadStatus[video.id].progress || 0) > 2
                                      ? "block"
                                      : "none",
                                  boxShadow: "0 0 8px 2px #60a5fa55",
                                }}
                              ></div>
                            </div>
                            {/* Overlayed percentage */}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="font-bold text-blue-900 text-sm drop-shadow-sm">
                                {(
                                  downloadStatus[video.id].progress || 0
                                ).toFixed(0)}
                                %
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <button
              disabled={selectedVideos.size === 0}
              onClick={handleMultiDownload}
              className={`mt-4 w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 shadow ${
                selectedVideos.size === 0
                  ? "bg-[#eae9e9] cursor-not-allowed"
                  : "bg-primary text-text-btn hover:bg-blue-700 focus:ring-2 focus:ring-blue-400 transition"
              }`}
            >
              <FontAwesomeIcon icon={faDownload} className="w-5 h-5" />
              Download Selected Videos as ZIP
            </button>
            {isDownloading && (
              <div className="space-y-2 mt-4">
                <div className="w-full flex flex-col items-center">
                  <span className="mb-1 text-xs font-semibold text-primary tracking-wide uppercase">
                    Download Progress
                  </span>
                  <div className="relative w-full h-6 bg-gray-200 rounded-full overflow-hidden shadow-md border border-gray-300">
                    <div
                      className="absolute left-0 top-0 h-full transition-all duration-300 ease-out animate-gradient-x"
                      style={{
                        width: `${downloadProgress.toFixed(0)}%`,
                        background:
                          "repeating-linear-gradient(90deg, #3b82f6 0%, #60a5fa 40%, #2563eb 100%)",
                        borderRadius: "9999px",
                        minWidth:
                          downloadProgress > 0 && downloadProgress < 8
                            ? "2.5rem"
                            : undefined,
                        boxShadow:
                          downloadProgress > 0
                            ? "0 0 12px 2px #60a5fa55"
                            : undefined,
                        opacity: downloadProgress > 0 ? 1 : 0.5,
                      }}
                    >
                      {/* Animated dot at the end */}
                      <div
                        className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-blue-400 rounded-full shadow-lg animate-bounce"
                        style={{
                          display: downloadProgress > 2 ? "block" : "none",
                          boxShadow: "0 0 12px 2px #60a5fa55",
                        }}
                      ></div>
                    </div>
                    {/* Overlayed percentage */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-extrabold text-blue-900 text-base drop-shadow-sm tracking-wider">
                        {downloadProgress.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {videoInfo && !isPlaylist && (
          <div className=" p-5 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {videoInfo.thumbnail && (
                <div className="relative w-64 rounded-xl shadow-md overflow-hidden group">
                  <img
                    src={videoInfo.thumbnail}
                    alt="Thumbnail"
                    className="w-64 rounded-xl"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                    <FontAwesomeIcon
                      icon={faPlay}
                      className="text-primary drop-shadow-lg text-4xl bg-white/70 rounded-full p-3"
                    />
                  </div>
                </div>
              )}
              <div className="flex-1">
                <h2 className="text-xl font-semibold">{videoInfo.title}</h2>
                {isFacebookUrl(url) && (
                  <div className="text-yellow-400 text-sm font-semibold mb-2">
                    For Facebook videos, only the best quality will be
                    downloaded for compatibility. Quality selection is disabled.
                  </div>
                )}

                {/* Format filter tabs for single video */}
                {videoInfo && !isPlaylist && videoInfo.formats && (
                  <div className="flex gap-2 mt-4 mb-2">
                    {["all", "mp4", "mkv", "webm", "mp3", "m4a"].map((type) => (
                      <button
                        key={type}
                        onClick={() => setFormatFilter(type)}
                        className={`px-3 py-1 rounded-full border text-xs font-semibold transition-colors duration-150 ${
                          formatFilter === type
                            ? "bg-primary text-white border-primary shadow"
                            : "bg-white text-primary border-gray-200 hover:bg-blue-50"
                        }`}
                      >
                        {type.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}

                {isFacebookUrl(url) ? (
                  <div className="mt-3 w-full border border-[#eae9e9] px-4 py-2 rounded-md text-text-color bg-gray-100 text-center font-semibold">
                    Best available video+audio (auto-selected for compatibility)
                  </div>
                ) : (
                  <select
                    className="mt-3 w-full border border-[#eae9e9] px-4 py-2 rounded-md text-text-color focus:ring-2 focus:ring-primary focus:border-primary transition"
                    value={selectedFormat || ""}
                    onChange={(e) => setSelectedFormat(e.target.value)}
                    disabled={isFacebookUrl(url)}
                  >
                    {filterFormats(videoInfo.formats)?.map((format) => (
                      <option key={format.format_id} value={format.format_id}>
                        {format.resolution || format.format_note || "Unknown"} •{" "}
                        {format.ext} •{" "}
                        {format.filesize
                          ? (format.filesize / (1024 * 1024)).toFixed(1) + " MB"
                          : "N/A"}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleDownload}
                  className="mt-4 w-full bg-primary cursor-pointer text-text-btn py-3 rounded-lg font-semibold"
                >
                  ⬇️ Download
                </button>
                {isDownloading && (
                  <div className="space-y-2 mt-4">
                    <div className="w-full flex flex-col items-center">
                      <span className="mb-1 text-xs font-semibold text-primary tracking-wide uppercase">
                        Download Progress
                      </span>
                      <div className="relative w-full h-6 bg-gray-200 rounded-full overflow-hidden shadow-md border border-gray-300">
                        <div
                          className="absolute left-0 top-0 h-full transition-all duration-300 ease-out animate-gradient-x"
                          style={{
                            width: `${downloadProgress}%`,
                            background:
                              "repeating-linear-gradient(90deg, #3b82f6 0%, #60a5fa 40%, #2563eb 100%)",
                            borderRadius: "9999px",
                            minWidth:
                              downloadProgress > 0 && downloadProgress < 8
                                ? "2.5rem"
                                : undefined,
                            boxShadow:
                              downloadProgress > 0
                                ? "0 0 12px 2px #60a5fa55"
                                : undefined,
                            opacity: downloadProgress > 0 ? 1 : 0.5,
                          }}
                        >
                          {/* Animated dot at the end */}
                          <div
                            className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-blue-400 rounded-full shadow-lg animate-bounce"
                            style={{
                              display: downloadProgress > 2 ? "block" : "none",
                              boxShadow: "0 0 12px 2px #60a5fa55",
                            }}
                          ></div>
                        </div>
                        {/* Overlayed percentage */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="font-extrabold text-blue-900 text-base drop-shadow-sm tracking-wider">
                            {downloadProgress.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <Howto />
      </div>
    </div>
  );
}

export default Home;
