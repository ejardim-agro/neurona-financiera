import React from "react";

interface DocsThemeConfig {
  logo?: React.ReactNode;
  project?: {
    link?: string;
  };
  docsRepositoryBase?: string;
  footer?: {
    text?: string;
  };
  search?: boolean;
  darkMode?: boolean;
  nextLinks?: boolean;
  prevLinks?: boolean;
}

const config: DocsThemeConfig = {
  logo: <span>Neurona Financiera</span>,
  project: {
    link: "https://github.com/yourusername/neurona-financiera",
  },
  docsRepositoryBase: "https://github.com/yourusername/neurona-financiera",
  footer: {
    text: "Neurona Financiera Docs",
  },
  search: true,
  darkMode: true,
  nextLinks: true,
  prevLinks: true,
};

export default config;
