import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faMusic,
  faBoxOpen,
  faMobileAlt,
  faBolt,
  faFilm,
  faLock,
} from "@fortawesome/free-solid-svg-icons";

function Footer() {
  return (
    <footer className="w-full py-8 mt-10 border-t border-gray-200   text-center text-xs text-gray-600">
      <div className="mt-6 flex flex-col items-center">
        <span className="font-semibold text-primary mb-2 tracking-wide uppercase text-[13px]">
          You can
        </span>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-left text-[13px]">
          <li className="flex items-center gap-2">
            <FontAwesomeIcon
              icon={faDownload}
              className="text-blue-400 w-4 h-4"
            />
            Download from YouTube, Facebook, Instagram, TikTok, and X (Twitter)
          </li>
          <li className="flex items-center gap-2">
            <FontAwesomeIcon
              icon={faMusic}
              className="text-green-400 w-4 h-4"
            />
            Choose video or audio quality and format
          </li>
          <li className="flex items-center gap-2">
            <FontAwesomeIcon
              icon={faBoxOpen}
              className="text-pink-400 w-4 h-4"
            />
            Batch/playlist downloads as ZIP
          </li>
         
          <li className="flex items-center gap-2">
            <FontAwesomeIcon
              icon={faFilm}
              className="text-purple-400 w-4 h-4"
            />
            Video preview overlays
          </li>
          <li className="flex items-center gap-2">
            <FontAwesomeIcon
              icon={faLock}
              className="text-emerald-400 w-4 h-4"
            />
            Fast and secure downloads
          </li>
        </ul>
      </div>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-2">
        <span>
          &copy; {new Date().getFullYear()}{" "}
          <span className="font-bold text-primary">Video Downloader</span>. All
          rights reserved.
        </span>
      </div>
      <div className="mt-2">
        <a
          href="/help"
          className="text-primary underline font-semibold"
        >
          Help &amp; FAQ
        </a>
      </div>
    </footer>
  );
}

export default Footer;
