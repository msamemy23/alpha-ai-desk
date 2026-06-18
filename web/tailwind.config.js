/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#101114',
          card: '#181a20',
          hover: '#242730',
          input: '#111318',
        },
        border: '#303540',
        blue: {
          DEFAULT: '#22c7d8',
          dim: 'rgba(34,199,216,0.15)',
        },
        green: {
          DEFAULT: '#34d399',
          dim: 'rgba(52,211,153,0.15)',
        },
        amber: { DEFAULT: '#f59e0b' },
        red: { DEFAULT: '#fb7185' },
        text: {
          primary: '#f5f7fb',
          secondary: '#b6beca',
          muted: '#717a88',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
