# 🚀 Gemini Transcriber Setup Guide

## Step-by-Step Setup Instructions

### 1. Get Your Gemini API Key

Follow these steps to obtain your API key:

#### Option A: Using Google AI Studio (Quickest)

1. Visit [Google AI Studio](https://aistudio.google.com)
2. Click on "Get API Key" in the top right corner
3. Select "Create API Key in new Google Cloud project"
4. Copy the generated API key

#### Option B: Using Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select an existing project
3. Enable the Generative Language API
4. Go to Credentials → Create Credentials → API Key
5. Copy the API key

### 2. Configure Environment Variables

#### Method 1: Using `.env` File (Recommended)

```bash
# Create a .env file in the project root
cat > .env << EOF
GEMINI_API_KEY=your-api-key-here
EOF
```

Replace `your-api-key-here` with your actual API key.

#### Method 2: Export in Terminal

```bash
# Temporary (current session only)
export GEMINI_API_KEY="your-api-key-here"

# Permanent (macOS/Linux - add to ~/.zshrc or ~/.bashrc)
echo 'export GEMINI_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

#### Method 3: Windows PowerShell

```powershell
# Temporary
$env:GEMINI_API_KEY = "your-api-key-here"

# Permanent (System settings)
[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "your-api-key-here", "User")
```

### 3. Install Dependencies

```bash
# Using pnpm (recommended)
pnpm install

# Or using npm
npm install

# Or using yarn
yarn install
```

### 4. Verify Setup

```bash
# Check if API key is set
echo $GEMINI_API_KEY

# Should output your API key

# Test with a simple command (optional)
npm run transcribe:gemini

# Should show usage instructions
```

---

## Environment Variables Reference

### Required

| Variable         | Purpose               | Example      |
| ---------------- | --------------------- | ------------ |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSyD...` |

### Optional

| Variable    | Purpose                | Default                  |
| ----------- | ---------------------- | ------------------------ |
| `API_KEY`   | Legacy API key support | (same as GEMINI_API_KEY) |
| `NODE_ENV`  | Environment            | `development`            |
| `LOG_LEVEL` | Logging level          | `info`                   |

---

## Verify Configuration

Run this command to test your setup:

```bash
npm run transcribe:gemini

# Expected output:
# Usage: ts-node src/gemini-transcriber.ts <path-to-audio-file>
```

---

## Troubleshooting Setup

### ❌ Error: `Cannot find module '@google/genai'`

**Solution:**

```bash
pnpm install @google/genai
# or
npm install @google/genai
```

### ❌ Error: `GEMINI_API_KEY is not set`

**Solution:**

```bash
# Check if .env file exists
ls -la .env

# If not, create it
echo 'GEMINI_API_KEY=your-key' > .env

# Verify
echo $GEMINI_API_KEY
```

### ❌ Error: `Invalid API Key`

**Solution:**

1. Check if API key is correct in Google AI Studio
2. Verify there are no extra spaces in `.env` file
3. Regenerate API key and try again

---

## Security Best Practices

✅ **DO:**

- Store API key in `.env` file (not in git)
- Keep `.env` in `.gitignore`
- Use different keys for dev/prod
- Rotate keys periodically

❌ **DON'T:**

- Commit `.env` to version control
- Share API key in logs or error messages
- Hardcode API key in source files
- Expose API key in documentation

---

## Next Steps

Once setup is complete:

1. **Test single file transcription:**

   ```bash
   npm run transcribe:gemini "./output/00 - Audio files/episode_001.mp3"
   ```

2. **Test batch processing:**

   ```bash
   npm run transcribe:gemini:batch "./output/00 - Audio files"
   ```

3. **Review cost analysis:**
   - Check `GEMINI_COST_ANALYSIS.md` for pricing details
   - Monitor usage in Google Cloud Console

---

## Additional Resources

- [Google Gemini API Docs](https://ai.google.dev/docs)
- [API Key Management](https://aistudio.google.com/app/apikey)
- [Pricing Information](https://ai.google.dev/pricing)

---

**Last Updated:** November 2025
