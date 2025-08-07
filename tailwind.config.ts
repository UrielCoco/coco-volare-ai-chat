/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class', // Permite usar modo oscuro con clase 'dark'
  theme: {
    extend: {
      colors: {
        volare: {
          blue: '#0c4a6e',       // Azul profundo, elegante
          light: '#e8f1f5',      // Azul clarito
          beige: '#f8f5f0',      // Fondo claro cálido
          gold: '#d4af37',       // Dorado fino
          black: '#1a1a1a',      // Negro estilizado
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],  // Títulos
        body: ['"Inter"', 'sans-serif'],           // Texto general
      },
      boxShadow: {
        volare: '0 4px 12px rgba(0, 0, 0, 0.06)', // Sombra elegante
      },
    },
  },
  plugins: [],
};
