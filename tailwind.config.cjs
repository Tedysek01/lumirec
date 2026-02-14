/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			display: ['"Clash Display"', 'sans-serif'],
  			sans: ['Outfit', 'sans-serif'],
  			mono: ['"JetBrains Mono"', 'monospace'],
  		},
  		keyframes: {
  			"accordion-down": {
  				from: { height: "0" },
  				to: { height: "var(--radix-accordion-content-height)" },
  			},
  			"accordion-up": {
  				from: { height: "var(--radix-accordion-content-height)" },
  				to: { height: "0" },
  			},
  			"fade-in-up": {
  				"0%": { transform: "translateY(8px)", opacity: "0" },
  				"100%": { transform: "translateY(0)", opacity: "1" },
  			},
  			"scale-in": {
  				"0%": { transform: "scale(0.95)", opacity: "0" },
  				"100%": { transform: "scale(1)", opacity: "1" },
  			},
  			"glow-pulse": {
  				"0%, 100%": { boxShadow: "0 0 8px 2px hsl(210 100% 60% / 0.3)" },
  				"50%": { boxShadow: "0 0 16px 4px hsl(210 100% 60% / 0.5)" },
  			},
  		},
  		animation: {
  			"accordion-down": "accordion-down 0.2s ease-out",
  			"accordion-up": "accordion-up 0.2s ease-out",
  			"fade-in-up": "fade-in-up 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  			"scale-in": "scale-in 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
  			"glow-pulse": "glow-pulse 2s ease-in-out infinite",
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))',
  				glow: 'hsl(var(--primary) / 0.3)',
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))',
  				glow: 'hsl(var(--accent) / 0.3)',
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))',
  				glow: 'hsl(var(--destructive) / 0.3)',
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			surface: {
  				'0': 'hsl(var(--surface-0))',
  				'1': 'hsl(var(--surface-1))',
  				'2': 'hsl(var(--surface-2))',
  				'3': 'hsl(var(--surface-3))',
  			},
  		},
  		boxShadow: {
  			'cinematic': '0 4px 24px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)',
  			'cinematic-lg': '0 8px 40px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03)',
  			'glow-primary': '0 0 12px 2px hsl(210 100% 60% / 0.25)',
  			'glow-accent': '0 0 12px 2px hsl(40 100% 60% / 0.25)',
  			'glow-destructive': '0 0 12px 2px hsl(0 84% 62% / 0.25)',
  		},
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
