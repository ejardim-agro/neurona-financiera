# 📋 Quick Reference Card

## Commands

### Single File

```bash
npm run transcribe:gemini "./path/to/audio.mp3"
```

### Batch Processing

```bash
npm run transcribe:gemini:batch "./directory"
npm run transcribe:gemini:batch "./dir" "./report.json"  # With custom report
```

### Whisper (Existing)

```bash
npm run transcribe
```

---

## Setup (First Time)

1. Get API Key: https://aistudio.google.com
2. Create .env: `echo 'GEMINI_API_KEY=your-key' > .env`
3. Install: `pnpm install`
4. Test: `npm run transcribe:gemini`

---

## Pricing

| Item                 | Cost       |
| -------------------- | ---------- |
| Google AI Pro/month  | $20        |
| Per episode (45 min) | $3.38      |
| 5 episodes/month     | $16.88     |
| **Total/month**      | **$36.88** |
| **Total/year**       | **~$443**  |

---

## File Formats

✅ MP3  
✅ WAV  
✅ M4A  
✅ OGG

---

## Supported Languages

🌍 100+ languages with automatic detection

---

## Documentation

| Document                    | Use For           |
| --------------------------- | ----------------- |
| SETUP.md                    | First-time setup  |
| GEMINI_TRANSCRIBER_GUIDE.md | Daily usage       |
| GEMINI_COST_ANALYSIS.md     | Budget decisions  |
| GEMINI_PROJECT_SUMMARY.md   | Technical details |
| README.md                   | Quick overview    |
| IMPLEMENTATION_INDEX.md     | Navigation        |

---

## Rate Limits

- **Google AI Pro**: 2 RPM (auto-handled)
- **Processing**: Sequential (respects limits)
- **Batch Estimate**: 30s per file

---

## Environment

```bash
# Required
GEMINI_API_KEY=your-key-here

# Optional
API_KEY=your-key-here  # Legacy support
NODE_ENV=development
```

---

## Output

### Single File

- Console transcription
- Automatic language detection
- Error handling

### Batch

- Per-file cost calculation
- Total cost summary
- JSON report (optional)
- Success/failure stats

---

## Troubleshooting

| Error            | Solution           |
| ---------------- | ------------------ |
| API key not set  | Check .env file    |
| Module not found | Run `pnpm install` |
| File not found   | Check file path    |
| Rate limited     | Batch handles this |

---

## Cost Examples

| Duration | Cost  |
| -------- | ----- |
| 15 min   | $1.13 |
| 30 min   | $2.26 |
| 45 min   | $3.38 |
| 60 min   | $4.50 |
| 100 min  | $7.51 |

---

## Recommendation

**Hybrid Approach** (Best balance)

- Keep Whisper for existing episodes (383) → $0
- Use Gemini for new episodes only → ~$3.38 each
- Monthly budget: $20 + $16.88 = $36.88
- Annual budget: ~$443

---

## Security

✅ Store API key in `.env`  
✅ Add `.env` to `.gitignore`  
✅ Rotate keys periodically  
✅ Monitor usage in Google Cloud Console

---

## Workflows

### Weekly Processing

```bash
npm run transcribe:gemini:batch "./new-episodes" "./reports/$(date +%Y-W%V).json"
```

### Single Episode

```bash
npm run transcribe:gemini "./podcast_episode_123.mp3" | tee transcript.txt
```

### With Custom Report

```bash
npm run transcribe:gemini:batch "./batch" "./my-report.json"
```

---

## Resources

- [Gemini API Docs](https://ai.google.dev/docs)
- [Get API Key](https://aistudio.google.com)
- [Cloud Console](https://console.cloud.google.com)

---

**Version**: 1.0  
**Last Updated**: November 2025
