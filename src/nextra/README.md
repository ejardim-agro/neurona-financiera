# Neurona Financiera - Documentación con Nextra

Este es el sitio de documentación construido con Nextra para Neurona Financiera.

## Desarrollo

Para ejecutar el servidor de desarrollo:

```bash
cd src/nextra
pnpm install
pnpm dev
```

El sitio estará disponible en [http://localhost:3000](http://localhost:3000).

## Construcción

Para construir el sitio para producción:

```bash
pnpm build
```

## Estructura

- `pages/` - Contiene las páginas MDX de la documentación
- `theme.config.tsx` - Configuración del tema
- `next.config.mjs` - Configuración de Next.js y Nextra
