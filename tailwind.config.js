/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mahana: {
          50: '#f7f8f3',
          100: '#ecf0e1',
          200: '#dbe4c4',
          300: '#becf98',
          400: '#819951',
          500: '#566f2e',
          600: '#3e5021',
          700: '#35441e',
          800: '#2d3a1a',
          900: '#263217',
        },
        ocean: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
    },
  },
  plugins: [],
}
