/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./sidepanel.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        handoff: {
          primary: '#6366f1',
          secondary: '#8b5cf6',
          accent: '#22c55e',
          dark: '#0f172a',
          surface: '#1e293b',
          muted: '#64748b',
        }
      }
    },
  },
  plugins: [],
}
