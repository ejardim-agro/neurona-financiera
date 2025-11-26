import { Layout } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import themeConfig from "../theme.config";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pageMap = await getPageMap();

  return (
    <html lang="es">
      <body>
        <Layout
          pageMap={pageMap}
          darkMode={themeConfig.darkMode}
          docsRepositoryBase={themeConfig.docsRepositoryBase}
          navigation={
            themeConfig.nextLinks && themeConfig.prevLinks
              ? { next: true, prev: true }
              : themeConfig.nextLinks || themeConfig.prevLinks
              ? {
                  next: themeConfig.nextLinks || false,
                  prev: themeConfig.prevLinks || false,
                }
              : true
          }
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
