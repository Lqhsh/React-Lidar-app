/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6',
        'primary-dark': '#2563EB',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        accent: '#0EA5E9',
        dark: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
          200: '#e2e8f0',
          100: '#f1f5f9',
        },
        light: {
          900: '#FFFFFF',
          800: '#F8FAFC',
          700: '#F1F5F9',
          600: '#E2E8F0',
          500: '#CBD5E1',
          400: '#94A3B8',
          300: '#64748B',
          200: '#475569',
          100: '#1E293B',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glass': '0 4px 20px rgba(15, 23, 42, 0.08)',
        'card': '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        'card-hover': '0 4px 12px rgba(15, 23, 42, 0.1)',
        'glow': '0 0 16px rgba(59, 130, 246, 0.2)',
      },
    },
  },
  plugins: [],
}
