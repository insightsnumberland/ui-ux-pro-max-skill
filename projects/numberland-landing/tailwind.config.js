/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        deep: '#05060B',
        bg: '#0A0E1A',
        surface: '#0F1526',
        elevated: '#141B2E',
        primary: '#4B9EFF',
        'primary-dim': '#3B82F6',
        'primary-glow': '#60A5FA',
        violet: '#8B5CF6',
        'violet-dim': '#7C3AED',
        cyan: '#22D3EE',
        gold: '#F5B840',
        text: '#E7ECF7',
        muted: '#8B99B8',
        faint: '#3D4A66',
      },
      fontFamily: {
        fa: ['Vazirmatn', 'sans-serif'],
        game: ['Orbitron', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [],
};
