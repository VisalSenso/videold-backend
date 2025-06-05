import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faPaste,
  faListOl,
  faCheckCircle,
} from "@fortawesome/free-solid-svg-icons";

function Howto() {
  return (
    <section className="w-full max-w-2xl mx-auto mt-6 mb-2 rounded-lg px-4 py-4 flex flex-col gap-2">
      <h2 className="text-lg font-bold text-primary mb-2 flex items-center gap-2">
        <FontAwesomeIcon icon={faDownload} className="text-primary w-5 h-5" />
        How to Download Videos
      </h2>
      <ol className="space-y-3 text-gray-700 text-sm">
        <li className="flex items-start gap-3">
          <span className="flex-shrink-0 flex flex-col items-center">
            <span className="bg-primary text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">
              1
            </span>
          </span>
          <span className="flex-1">
            <b>Paste the video or playlist URL</b> from YouTube, Facebook,
            Instagram, TikTok, or X (Twitter) into the input box.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex-shrink-0 flex flex-col items-center">
            <span className="bg-green-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">
              2
            </span>
          </span>
          <span className="flex-1">
            <b>Click Fetch</b> to load available formats and video info.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex-shrink-0 flex flex-col items-center">
            <span className="bg-emerald-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">
              3
            </span>
          </span>
          <span className="flex-1">
            <b>Review the video or playlist info and available formats.</b>
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex-shrink-0 flex flex-col items-center">
            <span className="bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">
              4
            </span>
          </span>
          <span className="flex-1">
            <b>For single videos:</b> Select your preferred quality/format and
            click <b>Download</b>.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex-shrink-0 flex flex-col items-center">
            <span className="bg-pink-500 text-white rounded-full w-7 h-7 flex items-center justify-center font-bold text-base">
              5
            </span>
          </span>
          <span className="flex-1">
            <b>For playlists:</b> Select the videos you want, choose formats if
            needed, and click <b>Download Selected Videos as ZIP</b>.
          </span>
        </li>
      </ol>
      <div className="mt-2 text-xs text-gray-500 text-center">
        Need more help? See{" "}
        <a
          href="/help"
          className="text-primary underline font-semibold"
        >
          Help &amp; FAQ
        </a>
        .
      </div>
    </section>
  );
}

export default Howto;
