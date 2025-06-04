import { useState } from "react";
import { Link } from "react-router-dom";

function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="bg-white text-primary shadow-b-lg fixed top-0 left-0 w-full z-50 border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 select-none">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 border border-indigo-100 mr-2">
            <svg
              width="24"
              height="24"
              fill="none"
              viewBox="0 0 24 24"
              className="text-indigo-400"
            >
              <path d="M7 6v12l10-6-10-6z" fill="currentColor" />
            </svg>
          </span>
          <span className="text-2xl font-extrabold tracking-tight text-primary">
            Video<span className="text-text-color">DL</span>
          </span>
        </div>

        <nav className="hidden md:flex space-x-8">
          <Link
            to="/"
            className="relative font-semibold px-2 py-1 text-primary transition duration-200 nav-link"
          >
            Home
            <span className="absolute left-0 -bottom-1 w-full h-0.5 bg-text-color scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-200" />
          </Link>
          <Link
            to="/help"
            className="relative font-semibold px-2 py-1 text-primary transition duration-200 nav-link"
          >
            Help
            <span className="absolute left-0 -bottom-1 w-full h-0.5 bg-text-color scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-200" />
          </Link>
        </nav>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden focus:outline-none text-primary p-2 rounded-lg hover:bg-gray-100 transition"
          aria-label="Open menu"
        >
          <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
            <path
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M4 7h16M4 12h16M4 17h16"
            />
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 px-6 pb-4 pt-2 shadow-b-lg animate-fade-in">
          <Link
            to="/"
            className="block text-primary font-semibold py-2 px-2 rounded-md hover:bg-gray-100 transition"
            onClick={() => setIsOpen(false)}
          >
            Home
          </Link>
          <Link
            to="/help"
            className="block text-primary font-semibold py-2 px-2 rounded-md hover:bg-gray-100 transition"
            onClick={() => setIsOpen(false)}
          >
            Help
          </Link>
        </div>
      )}
    </header>
  );
}

export default Header;

// Add nav-link underline effect
// Add this to your index.css or App.css:
// .nav-link { position: relative; }
// .nav-link::after {
//   content: "";
//   position: absolute;
//   left: 0;
//   bottom: -2px;
//   width: 100%;
//   height: 2px;
//   background: #6366f1; /* texbg-text-color */
//   transform: scaleX(0);
//   transition: transform 0.2s;
//   transform-origin: left;
// }
// .nav-link:hover::after, .nav-link.active::after {
//   transform: scaleX(1);
// }
