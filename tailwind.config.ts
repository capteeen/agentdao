import type { Config } from "tailwindcss";

// Colours are CSS variables so the night-mode toggle can swap the palette.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: v("base"),
        panel: v("panel"),
        panel2: v("panel2"),
        line: v("line"),
        ink: v("ink"),
        dim: v("dim"),
        office: v("office"),
        memo: v("memo"),
        stamp: v("stamp"),
        ok: v("ok"),
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', "monospace"],
        body: ["VT323", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
