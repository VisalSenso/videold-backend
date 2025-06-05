import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faYoutube, faFacebook, faInstagram, faTiktok, faXTwitter } from "@fortawesome/free-brands-svg-icons";
import { faCheckCircle, faExclamationTriangle, faClockRotateLeft, faRedo, faGlobe } from "@fortawesome/free-solid-svg-icons";

function Help() {
  return (
    <div className="max-w-2xl mx-auto py-10 px-4 text-gray-800 mt-24 ">
      <h1 className="text-2xl font-bold mb-4 text-primary">Help &amp; FAQ</h1>
      <h2 className="text-lg font-semibold mt-6 mb-3">How to Download Videos</h2>
      <ol className="space-y-3 mb-8">
        <li className="flex items-start gap-3">
          <span className="bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">1</span>
          <span>
            <b>Copy the video or playlist URL</b> from YouTube, Facebook, Instagram, TikTok, or X (Twitter).
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="bg-green-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">2</span>
          <span>
            <b>Paste the URL</b> into the input box on the Home page.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="bg-indigo-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">3</span>
          <span>
            Click <b>Fetch</b> to load available formats and video info.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="bg-pink-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">4</span>
          <span>
            <b>For single videos:</b> Select your preferred quality/format and click <b>Download</b>.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="bg-emerald-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">5</span>
          <span>
            <b>For playlists:</b> Select the videos you want, choose formats if needed, and click <b>Download Selected Videos as ZIP</b>.
          </span>
        </li>
      </ol>
      <h2 className="text-lg font-semibold mt-6 mb-3">Supported Platforms</h2>
      <ul className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <li className="flex flex-col items-center gap-1">
          <FontAwesomeIcon icon={faYoutube} className="text-red-500 w-6 h-6" />
          <span className="text-xs">YouTube</span>
        </li>
        <li className="flex flex-col items-center gap-1">
          <FontAwesomeIcon icon={faFacebook} className="text-blue-600 w-6 h-6" />
          <span className="text-xs">Facebook</span>
        </li>
        <li className="flex flex-col items-center gap-1">
          <FontAwesomeIcon icon={faInstagram} className="text-pink-400 w-6 h-6" />
          <span className="text-xs">Instagram</span>
        </li>
        <li className="flex flex-col items-center gap-1">
          <FontAwesomeIcon icon={faTiktok} className="text-black w-6 h-6" />
          <span className="text-xs">TikTok</span>
        </li>
        <li className="flex flex-col items-center gap-1">
          <FontAwesomeIcon icon={faXTwitter} className="text-gray-700 w-6 h-6" />
          <span className="text-xs">X (Twitter)</span>
        </li>
      </ul>
      <h2 className="text-lg font-semibold mt-6 mb-3">Tips &amp; Troubleshooting</h2>
      <ul className="space-y-3 mb-6">
        <li className="flex items-start gap-2">
          <FontAwesomeIcon icon={faCheckCircle} className="text-emerald-500 w-5 h-5 mt-0.5" />
          <span>If a download fails, make sure the video is public and the URL is correct.</span>
        </li>
        <li className="flex items-start gap-2">
          <FontAwesomeIcon icon={faExclamationTriangle} className="text-yellow-500 w-5 h-5 mt-0.5" />
          <span>Some platforms may restrict downloads for private or age-restricted content.</span>
        </li>
        <li className="flex items-start gap-2">
          <FontAwesomeIcon icon={faGlobe} className="text-blue-400 w-5 h-5 mt-0.5" />
          <span>For best results, use the latest version of Chrome, Edge, or Firefox.</span>
        </li>
        <li className="flex items-start gap-2">
          <FontAwesomeIcon icon={faClockRotateLeft} className="text-indigo-400 w-5 h-5 mt-0.5" />
          <span>ZIP downloads may take longer for large playlists.</span>
        </li>
        <li className="flex items-start gap-2">
          <FontAwesomeIcon icon={faRedo} className="text-pink-400 w-5 h-5 mt-0.5" />
          <span>If you encounter issues, try refreshing the page or restarting the app.</span>
        </li>
      </ul>
      <div className="mt-8 text-center text-xs text-gray-400">
        Need more help? Contact support or check for updates.
      </div>
    </div>
  );
}

export default Help;