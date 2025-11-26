# Neurona Financiera Docs

Documentación completa de Neurona Financiera construida con Nextra.

## Desarrollo Local

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
pnpm start
```

## Despliegue en Vercel

Este proyecto está configurado para desplegarse automáticamente en Vercel. La configuración está en `vercel.json` en la raíz del repositorio.

### Configuración de Vercel

- **Root Directory**: `src/nextra`
- **Framework**: Next.js
- **Build Command**: `pnpm install && pnpm build`
- **Output Directory**: `.next` (automático)

### Pasos para desplegar

1. Conecta tu repositorio a Vercel
2. Vercel detectará automáticamente la configuración desde `vercel.json`
3. El despliegue se realizará automáticamente en cada push a la rama principal
