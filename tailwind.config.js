/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        background: "#1A2326", // Main background
        foreground: "#FFFFFF",
        primary: {
          DEFAULT: "#A6A267", // Contrast 1 (Gold/Greenish)
          foreground: "#FFFFFF",
          hover: "#8E8A54",
        },
        secondary: {
          DEFAULT: "#61747A", // Secondary (Grayish Blue)
          foreground: "#FFFFFF",
          hover: "#4F5F64",
        },
        accent: {
          DEFAULT: "#A66777", // Contrast 2 (Pinkish)
          foreground: "#FFFFFF",
          hover: "#8C5563",
        },
        surface: {
          DEFAULT: "#26251A", // Additional dark
          alt: "#261A1D", // Additional dark 2
        },
        card: {
          DEFAULT: "#FFFFFF",
          foreground: "#1e293b", // slate-800
        },
        muted: {
          DEFAULT: "#61747A",
          foreground: "#C0C0C0",
        }
      },
      fontFamily: {
        sans: ["Manrope", "sans-serif"],
      },
    },
  },
  plugins: [],
};
