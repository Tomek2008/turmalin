/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                plntr: {
                    900: '#0F172A',
                    800: '#1E293B',
                    glow: '#38BDF8',
                    accent: '#818CF8'
                }
            },
            backgroundImage: {
                'grid-pattern': "linear-gradient(to right, #1f2937 1px, transparent 1px), linear-gradient(to bottom, #1f2937 1px, transparent 1px)",
            }
        },
    },
    plugins: [],
}
