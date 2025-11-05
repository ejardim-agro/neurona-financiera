# Neurona Financiera - Audio Transcription Project

Este proyecto gestiona la transcripción y procesamiento de episodios de podcasts de Neurona Financiera.

## 🚀 Características

### Transcripción con Gemini API (Nuevo ✨)

Transcribe archivos de audio usando Google Gemini con detección automática de idioma.

**Ventajas:**

- ✅ Detección automática de idioma
- ✅ Múltiples formatos de audio (MP3, WAV, M4A, OGG)
- ✅ Procesamiento en lotes
- ✅ Seguimiento de costos en tiempo real
- ✅ Generación de reportes JSON
- ✅ Respetar límites de velocidad de API Pro

**Comandos:**

```bash
# Transcribir un archivo individual
npm run transcribe:gemini "./output/00 - Audio files/podcast.mp3"

# Procesar un directorio completo
npm run transcribe:gemini:batch "./output/00 - Audio files"

# Con ruta de reporte personalizada
npm run transcribe:gemini:batch "./episodes" "./reports/batch-report.json"
```

### Transcripción con Whisper (Existente)

Usa Whisper.cpp para transcripción local sin costos.

```bash
npm run transcribe
```

## 📚 Documentación

| Documento                                                    | Propósito                         |
| ------------------------------------------------------------ | --------------------------------- |
| [GEMINI_PROJECT_SUMMARY.md](./GEMINI_PROJECT_SUMMARY.md)     | Resumen completo del proyecto     |
| [SETUP.md](./SETUP.md)                                       | Configuración paso a paso         |
| [GEMINI_TRANSCRIBER_GUIDE.md](./GEMINI_TRANSCRIBER_GUIDE.md) | Guía de usuario completa          |
| [GEMINI_COST_ANALYSIS.md](./GEMINI_COST_ANALYSIS.md)         | Análisis de costos y comparativas |

## 🔧 Instalación Rápida

### 1. Instalación de Dependencias

```bash
pnpm install
```

### 2. Configuración de API Key

```bash
# Crear archivo .env
echo 'GEMINI_API_KEY=tu-api-key-aqui' > .env
```

[Obtener API Key →](./SETUP.md#1-get-your-gemini-api-key)

### 3. Verificación

```bash
npm run transcribe:gemini
# Debería mostrar instrucciones de uso
```

## 💰 Costos

### Google AI Pro

- **Costo mensual**: $20 USD
- **Costo por episodio** (45 min): ~$3.38
- **Mantenimiento mensual** (5 episodios): ~$37/mes

### Comparativa

| Servicio        | Costo/Min | 5 Episodes/Mes |
| --------------- | --------- | -------------- |
| **Gemini API**  | $0.075    | **$16.88**     |
| AWS Transcribe  | $0.36     | $81            |
| Google Cloud    | $0.096    | $21.60         |
| Azure           | $0.06     | $13.50         |
| Whisper (Local) | $0        | $0             |

[Análisis detallado →](./GEMINI_COST_ANALYSIS.md)

## 📊 Estructura de Scripts

### Scripts Disponibles

```bash
npm run transcribe              # Whisper.cpp transcription (local)
npm run transcribe:gemini       # Gemini transcription (single file)
npm run transcribe:gemini:batch # Gemini transcription (batch)
npm run wording                 # Editar y mejorar transcripción
npm run format                  # Formatear transcripción
npm run pipeline                # Ejecutar pipeline completo
```

## 🎯 Flujos de Trabajo Recomendados

### Opción 1: Mantener Whisper (Costo = $0)

```bash
npm run pipeline  # Usa Whisper para transcribir
```

### Opción 2: Usar Gemini para Nuevos Episodios (Recomendado)

```bash
# Nuevos episodios
npm run transcribe:gemini:batch "./new-episodes"

# Pipeline completo
npm run wording && npm run format
```

### Opción 3: Híbrido (Mejor Calidad + Costo Optimizado)

```bash
# Usar Whisper para primera pasada
npm run transcribe

# Usar Gemini para validación/limpieza
npm run transcribe:gemini "episode-to-verify.mp3"
```

## 📁 Estructura del Proyecto

```
.
├── output/
│   ├── 00 - Audio files/          # Archivos MP3 originales
│   ├── 01 - Transcripts/          # Transcripciones en texto (Whisper)
│   ├── 02 - Wording/              # Transcripciones mejoradas
│   └── 03 - Processed/            # Salida final en Markdown
├── src/
│   ├── gemini-transcriber.ts      # Transcriptor individual
│   ├── gemini-batch-transcriber.ts # Transcriptor en lotes
│   ├── transcriber.ts              # Transcriptor Whisper
│   ├── wording.ts                  # Mejora de transcripción
│   ├── formatter.ts                # Formateador a Markdown
│   └── ...
├── SETUP.md                        # Guía de configuración
├── GEMINI_TRANSCRIBER_GUIDE.md     # Guía de uso completa
├── GEMINI_COST_ANALYSIS.md         # Análisis de costos
├── GEMINI_PROJECT_SUMMARY.md       # Resumen del proyecto
└── package.json
```

## 🔐 Seguridad

### Proteger API Key

✅ Guardar en archivo `.env` (nunca en git)  
✅ Usar `.gitignore` para proteger credenciales  
✅ Rotar claves periódicamente  
✅ Monitorear uso en Google Cloud Console

## 🆘 Solución de Problemas

### Error: `GEMINI_API_KEY is not set`

```bash
# Verificar si .env existe
ls -la .env

# Crear .env si no existe
echo 'GEMINI_API_KEY=tu-key' > .env
```

### Error: `Cannot find module @google/genai`

```bash
# Instalar dependencia
pnpm install @google/genai
```

[Más ayuda →](./GEMINI_TRANSCRIBER_GUIDE.md#troubleshooting)

## 📞 Contacto y Recursos

- [Documentación de Gemini API](https://ai.google.dev/docs)
- [Google AI Studio](https://aistudio.google.com)
- [Google Cloud Console](https://console.cloud.google.com)

---

## 📋 Información del Proyecto

- **Versión**: 1.0.0
- **Estado**: ✅ Producción
- **Última actualización**: Noviembre 2025
- **Licencia**: ISC
