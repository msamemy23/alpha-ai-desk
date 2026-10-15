/** @type {import('tailwindcss').Config} */
// Every color is a CSS variable (space-separated RGB channels) so one set of
// tokens in globals.css drives the light theme, the dark theme, and every page,
// including opacity utilities like bg-blue/15.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: token('base'),
          card: token('card'),
          hover: token('hover'),
          input: token('input'),
          chrome: token('chrome'),
        },
        border: token('border'),
        line: token('line'),
        // "blue" is the interactive color (links, focus, selected, Ask Alpha).
        blue: { DEFAULT: token('blue'), dim: 'rgb(var(--c-blue) / 0.12)' },
        // Status lamps. DEFAULT is the text-safe shade; fills use the --lamp-* variables.
        green: { DEFAULT: token('green'), dim: 'rgb(var(--c-green) / 0.14)' },
        amber: { DEFAULT: token('amber') },
        red: { DEFAULT: token('red') },
        text: {
          primary: token('text'),
          secondary: token('text-2'),
          muted: token('text-3'),
        },
      },
      fontFamily: {
        sans: ['"Atkinson Hyperlegible Next"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['"Overpass Variable"', '"Arial Narrow"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
