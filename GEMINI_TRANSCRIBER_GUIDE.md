# 🎙️ Gemini Audio Transcriber - Complete Guide

A collection of scripts to transcribe audio files using the Google Gemini API with automatic language detection, cost tracking, and batch processing capabilities.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Usage](#usage)
5. [Advanced Features](#advanced-features)
6. [Cost Tracking](#cost-tracking)
7. [Troubleshooting](#troubleshooting)
8. [API Reference](#api-reference)

---

## Quick Start

### Single File Transcription

```bash
# Transcribe a single MP3 file
npm run transcribe:gemini "./output/00 - Audio files/podcast_episode.mp3"
```

### Batch Processing

```bash
# Transcribe all files in a directory
npm run transcribe:gemini:batch "./output/00 - Audio files"
```

---

## Prerequisites

### Required

- **Node.js** 16+ installed
- **Google Gemini API key** (with Google AI Pro subscription)
- **TypeScript** support

### Optional (for better duration detection)

- **ffprobe** - For accurate audio duration detection

  ```bash
  # macOS
  brew install ffmpeg

  # Ubuntu/Debian
  sudo apt-get install ffmpeg

  # Windows (with Chocolatey)
  choco install ffmpeg
  ```

---

## Installation

### 1. Install Dependencies

```bash
# Using pnpm (recommended)
pnpm install

# Or using npm
npm install

# Or using yarn
yarn install
```

### 2. Configure API Key

Create a `.env` file in the project root:

```bash
# Option 1: Using GEMINI_API_KEY
GEMINI_API_KEY=your-api-key-here

# Option 2: Using API_KEY (legacy support)
API_KEY=your-api-key-here
```

**How to get your API key:**

1. Visit [Google AI Studio](https://aistudio.google.com)
2. Click "Get API Key" or navigate to [google.ai/tokens](https://aistudio.google.com/app/apikey)
3. Choose "Create API Key in new Google Cloud project"
4. Copy the API key to your `.env` file

### 3. Verify Setup

```bash
# Check if environment is configured
echo $GEMINI_API_KEY

# Should output your API key (or be set in .env)
```

---

## Usage

### Basic Single File Transcription

```bash
npm run transcribe:gemini "./path/to/audio.mp3"
```

**Supported Formats:**

- `.mp3` (MPEG Audio)
- `.wav` (WAV)
- `.m4a` (MPEG-4 Audio)
- `.ogg` (Ogg Vorbis)

**Output Example:**

```
═══════════════════════════════════════════════════════
  🎙️  Gemini Audio Transcriber
═══════════════════════════════════════════════════════

📁 Reading file: ./audio.mp3
✓ File loaded (2.45 MB)
🎵 MIME Type: audio/mpeg

🔄 Sending to Gemini API for transcription...

✅ Transcription Complete!

───────────────────────────────────────────────────────

📝 TRANSCRIPTION:

[Complete transcript appears here]

───────────────────────────────────────────────────────
```

### Batch Directory Processing

```bash
npm run transcribe:gemini:batch "./output/00 - Audio files"
```

**Advanced Options:**

```bash
# Process directory and save report to specific location
npm run transcribe:gemini:batch "./output/00 - Audio files" "./my-report.json"
```

**Output Example:**

```
═══════════════════════════════════════════════════════
  🎙️  Gemini Batch Audio Transcriber
═══════════════════════════════════════════════════════

🎙️  Found 5 audio files to process
⏱️  Estimated time: 150s (respecting rate limits)

📄 Processing: episode_001.mp3
  └─ Duration: 45.23 min (98.5 MB)
  └─ Sending to API...
  └─ ✅ Success | Cost: $3.39 | Words: 12456

[... more files ...]

═══════════════════════════════════════════════════════
  📊 Transcription Report
═══════════════════════════════════════════════════════

✅ Successful:  5/5
❌ Failed:      0/5
⏱️  Total Duration: 225.45 minutes
💰 Total Cost: $17.95
📊 Average Cost/Episode: $3.59

📁 Report saved to: ./transcription-batch-report.json
```

---

## Advanced Features

### 1. Rate Limiting

The batch transcriber automatically respects Google AI Pro's 2 RPM (Requests Per Minute) limit:

```
⏳ Rate limiting: waiting 29.5s...
```

This ensures:

- ✅ No API rate limit errors
- ✅ Predictable processing time
- ✅ Compatible with AI Pro tier

### 2. Cost Tracking

Every transcription includes real-time cost calculation:

```typescript
Input Audio:  45 min × $0.075/min = $3.375
Output Text:  12,000 tokens × ($0.30 / 1M) = $0.0036
─────────────────────────────────────────────
Total Cost:   ~$3.38 per episode
```

### 3. Automatic Language Detection

The API automatically detects the language:

```
Language: Spanish (auto-detected)
Confidence: 99.2%
```

### 4. Error Handling

Comprehensive error reporting:

```json
{
  "success": false,
  "fileName": "corrupted.mp3",
  "error": "Failed to decode audio format"
}
```

### 5. Batch Report Export

Detailed JSON report with metrics:

```json
{
  "timestamp": "2025-11-05T10:30:00.000Z",
  "summary": {
    "total": 10,
    "successful": 9,
    "failed": 1,
    "totalDurationMinutes": 450.5,
    "totalCostUSD": 33.75
  },
  "results": [
    {
      "fileName": "episode_001.mp3",
      "durationMinutes": 45.23,
      "costUSD": 3.39,
      "success": true,
      "timestamp": "2025-11-05T10:30:15.000Z"
    }
    // ... more results
  ]
}
```

---

## Cost Tracking

### Real-Time Cost Calculation

Each transcription shows:

- **Input cost**: Based on audio duration
- **Output cost**: Based on transcript length
- **Total cost**: Sum of both

### Monthly Budget Estimation

Based on current pricing (Gemini 2.0 Flash):

```
5 episodes/month × $3.38 = $16.90
Google AI Pro subscription = $20.00
────────────────────────
Monthly total = $36.90/month

Annual cost = ~$443
```

### Cost Optimization Tips

1. **Use Gemini 2.0 Flash** (cheaper than 1.5 Pro)
2. **Batch process** during off-peak hours
3. **Hybrid approach**: Whisper for draft → Gemini for refinement
4. **Monitor monthly usage** via Google Cloud Console

For detailed analysis, see: [GEMINI_COST_ANALYSIS.md](./GEMINI_COST_ANALYSIS.md)

---

## Troubleshooting

### ❌ Error: `GEMINI_API_KEY is not set`

**Solution:**

```bash
# Set environment variable directly
export GEMINI_API_KEY="your-api-key"

# Or create .env file
echo "GEMINI_API_KEY=your-api-key" > .env
```

### ❌ Error: `File not found`

**Solution:**

```bash
# Use correct file path
npm run transcribe:gemini "./output/00 - Audio files/episode.mp3"

# Check file exists
ls "./output/00 - Audio files/episode.mp3"
```

### ❌ Error: `API rate limit exceeded`

**Solution:**

- Batch transcriber automatically respects 2 RPM limit
- Wait before making new requests
- Check Google Cloud Console for quota details

### ❌ Error: `No response received from Gemini API`

**Solution:**

1. Verify API key is valid
2. Check internet connection
3. Verify audio file is not corrupted
4. Try with a smaller file first

### ❌ Slow Processing

**Optimization:**

1. Process files sequentially (already implemented)
2. Check network speed
3. Use smaller audio files for testing
4. Monitor API response times

---

## API Reference

### Single File Transcriber

**File:** `src/gemini-transcriber.ts`

**Function:** `transcribeAudioFile(filePath: string): Promise<string>`

**Parameters:**

- `filePath`: Full path to audio file

**Returns:**

- Transcription text as string

**Example:**

```typescript
const transcript = await transcribeAudioFile("./audio.mp3");
console.log(transcript);
```

### Batch Transcriber

**File:** `src/gemini-batch-transcriber.ts`

**Class:** `GeminiBatchTranscriber`

**Methods:**

- `transcribeSingleFile(filePath: string)`: Process one file
- `transcribeDirectory(dirPath: string)`: Process entire directory
- `printReport()`: Display summary
- `saveResults(outputPath: string)`: Export JSON report

**Example:**

```typescript
const transcriber = new GeminiBatchTranscriber();
await transcriber.transcribeDirectory("./output/00 - Audio files");
transcriber.printReport();
transcriber.saveResults("./report.json");
```

---

## NPM Scripts

### Available Commands

| Command                                          | Purpose                    |
| ------------------------------------------------ | -------------------------- |
| `npm run transcribe:gemini <file>`               | Transcribe single file     |
| `npm run transcribe:gemini:batch <dir>`          | Batch process directory    |
| `npm run transcribe:gemini:batch <dir> <report>` | Batch + custom report path |

### Example Workflows

**One-off transcription:**

```bash
npm run transcribe:gemini "./podcast.mp3"
```

**Weekly batch processing:**

```bash
npm run transcribe:gemini:batch "./new-episodes" "./weekly-report.json"
```

**Save results with timestamp:**

```bash
npm run transcribe:gemini:batch "./episodes" "./reports/$(date +%Y-%m-%d).json"
```

---

## Integration with Existing Pipeline

### Current Setup

- **Transcribe Tool:** `npm run transcribe` (uses Whisper.cpp)
- **New Tool:** `npm run transcribe:gemini` (uses Gemini API)

### Migration Options

1. **Keep Parallel:** Use Whisper for speed, Gemini for quality
2. **Gradual Migration:** New episodes with Gemini, old with Whisper
3. **Full Migration:** Replace Whisper with Gemini entirely

---

## Support & Resources

- [Google Gemini Documentation](https://ai.google.dev/docs)
- [Audio File Support](https://ai.google.dev/docs/audio)
- [Pricing & Billing](https://ai.google.dev/pricing)
- [API Status](https://status.ai.google.dev)

---

## Security Notes

### API Key Safety

✅ **DO:**

- Store API key in `.env` file
- Add `.env` to `.gitignore`
- Use environment variables
- Rotate keys periodically

❌ **DON'T:**

- Commit API key to git
- Share API key in logs
- Hardcode in source code
- Store in version control

### Rate Limiting

The batch transcriber respects:

- **2 RPM** for Google AI Pro users
- **15 RPM** for paid plans
- **60 RPM** for enterprise

---

## Performance Metrics

### Typical Processing Times

- **Single 45-min file**: 20-30 seconds
- **Batch of 5 files**: 2-3 minutes (respecting rate limits)
- **Batch of 10 files**: 5-6 minutes

### Cost Examples

| Duration | Cost (Gemini 2.0) |
| -------- | ----------------- |
| 15 min   | $1.13             |
| 30 min   | $2.26             |
| 45 min   | $3.38             |
| 60 min   | $4.50             |
| 100 min  | $7.51             |

---

## Version History

| Version | Date     | Changes         |
| ------- | -------- | --------------- |
| 1.0     | Nov 2025 | Initial release |

---

**Last Updated:** November 2025
**Maintainer:** Your Name
