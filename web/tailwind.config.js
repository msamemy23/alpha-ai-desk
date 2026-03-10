/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0d1117',
          card: '#161b22',
          hover: '#1c2128',
          input: '#0d1117',
        },
        border: '#30363d',
        blue: {
          DEFAULT: '#4a9eff',
          dim: 'rgba(74,158,255,0.15)',
        },
        green: {
          DEFAULT: '#3fb950',
          dim: 'rgba(63,185,80,0.15)',
        },
        amber: { DEFAULT: '#d29922' },
        red: { DEFAULT: '#f85149' },
        text: {
          primary: '#e6edf3',
          secondary: '#8b949e',
          muted: '#484f58',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
