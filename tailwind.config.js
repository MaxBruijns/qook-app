// Tailwind wordt nu bij het bouwen omgezet naar één klein CSS-bestand,
// in plaats van in de browser via een los script. Sneller en geen externe bron.
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        kooq: {
          sage: '#94B79D', sand: '#D9C9A3', white: '#F5F7F4',
          slate: '#5D6E76', clementine: '#F3A567', dark: '#2A3338',
        },
      },
      fontFamily: { sans: ['DM Sans', 'sans-serif'], body: ['Inter', 'sans-serif'] },
    },
  },
  plugins: [],
};
