import "nextra-theme-docs/style.css";
import type { AppProps } from "next/app";

// Nextra 4.x handles layout automatically through the loader
// The theme.config.tsx is used automatically by Nextra
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
