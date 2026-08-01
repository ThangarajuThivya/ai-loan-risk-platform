/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#0F4C81",
          secondary: "#2E8BC0",
          accent: "#00A86B",
          bg: "#F8FAFC",
          card: "#FFFFFF",
          text: "#1E293B",
        },
      },
      fontFamily: {
        // Inter has no Sinhala/Tamil glyphs, so the browser falls through to
        // the next font in the stack per-character — no per-script classes
        // needed anywhere in the app.
        sans: ["Inter", "Noto Sans Sinhala", "Noto Sans Tamil", "sans-serif"],
        display: ["Space Grotesk", "Noto Sans Sinhala", "Noto Sans Tamil", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

