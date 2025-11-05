# 📊 Gemini API Cost Analysis - Audio Transcription

## Overview

This document provides a comprehensive analysis of costs for using the Google Gemini API to transcribe audio files, specifically with the **Google AI Pro** subscription plan.

---

## 1. Google AI Pro Pricing Structure

### Plan Details

- **Cost**: $20 USD/month
- **Rate Limits**: 2 RPM (Requests Per Minute) for video/audio
- **Include**: All Gemini models access

### Key Models Available

- `gemini-2.0-flash-exp` - Recommended for audio transcription (latest)
- `gemini-2.0-flash` - Production-ready alternative
- `gemini-1.5-pro` - Enterprise-grade model
- `gemini-1.5-flash` - Lightweight alternative

---

## 2. Audio Transcription Pricing

### Token-Based Pricing (Pay-as-you-go)

The Gemini API charges for audio files based on **audio duration**, not file size:

#### Gemini 2.0 Flash Models

- **Input Audio**: $0.075 per minute
- **Output Text**: $0.30 per 1M tokens (typically ~4 tokens per word)

#### Gemini 1.5 Pro

- **Input Audio**: $1.50 per minute
- **Output Text**: $6.00 per 1M tokens

#### Gemini 1.5 Flash

- **Input Audio**: $0.075 per minute
- **Output Text**: $0.30 per 1M tokens

### Cost Calculation Example

**Scenario**: Transcribing podcast episodes

#### Episode Details

- **Average Duration**: 45 minutes
- **Estimated Output**: ~3,000 words (12,000 tokens)

#### Cost Per Episode (Using Gemini 2.0 Flash)

```
Input Audio:  45 min × $0.075/min = $3.375
Output Text:  12,000 tokens × ($0.30 / 1,000,000) = $0.0036
─────────────────────────────────────────────
Total Cost:   ~$3.38 per episode
```

---

## 3. Your Current Project Context

### Existing Data

Based on your project structure:

- **Total Episodes**: 383 podcast episodes (in `output/01 - Transcripts/`)
- **Average Duration**: ~45 minutes per episode (estimated)
- **Total Audio Duration**: ~17,235 minutes (~287 hours)

### Cost Scenarios

#### Scenario A: Transcribe All Episodes (One-time)

```
Total Audio Duration: 287 hours = 17,235 minutes
Cost = 17,235 min × $0.075/min = $1,292.63

Plus output tokens (assuming 3M words total):
Output = 12M tokens × ($0.30 / 1M) = $3.60

Total: ~$1,296.23
```

#### Scenario B: Monthly Maintenance (New Episodes)

```
Assuming 4-6 new episodes per month:
- 5 episodes × 45 min = 225 minutes
- Cost: 225 × $0.075 = $16.88/month

Google AI Pro: $20/month
Combined: ~$37/month for continuous transcription
```

#### Scenario C: Batch Processing (Optimized)

```
Process 10 episodes weekly:
- 10 × 45 min = 450 min/week
- Cost: 450 × $0.075 = $33.75/week
- Monthly: ~$135/month

Google AI Pro: $20/month
Combined: ~$155/month
```

---

## 4. Comparison with Alternatives

### Whisper (Current Solution - Open Source)

- **Cost**: FREE (self-hosted)
- **Quality**: Good for Spanish audio
- **Speed**: Depends on hardware (slower than cloud)
- **Resource**: Requires GPU/CPU (already in vendor/)

### AWS Transcribe

- **Cost**: $0.0001 per second = $0.36 per minute
- **For 45-min episode**: ~$16.20
- **Monthly (5 episodes)**: ~$81/month

### Google Cloud Speech-to-Text

- **Cost**: $0.024 per 15 seconds = $0.096 per minute
- **For 45-min episode**: ~$4.32
- **Monthly (5 episodes)**: ~$21.60/month

### Azure Transcription Services

- **Cost**: $0.06 per minute (standard tier)
- **For 45-min episode**: ~$2.70
- **Monthly (5 episodes)**: ~$13.50/month

---

## 5. Cost Optimization Strategies

### 1. **Batch Processing**

- Transcribe multiple files in one session
- Utilize the 2 RPM limit efficiently
- Estimated savings: 15-20%

### 2. **Use Cheaper Models**

- Use Gemini 2.0 Flash instead of 1.5 Pro
- Savings: ~50% per episode

### 3. **Hybrid Approach**

- Use Whisper (free) for initial transcription
- Use Gemini API only for:
  - Language detection/confirmation
  - Formatting/cleanup
  - Post-processing
- Estimated savings: 60-70%

### 4. **Caching Strategy**

- Store results to avoid re-transcription
- Implement deduplication logic
- Estimated savings: Eliminates duplicate processing

### 5. **Rate Limiting**

- Spread transcription across the month
- Avoid hitting RPM limits
- Better for monthly budget planning

---

## 6. Financial Projection (Annual)

### Scenario: Hybrid Approach (Recommended)

**Monthly Metrics**:

- New episodes: 5 per month
- Cost per episode: $3.38
- Additional Gemini processing: ~$5/month
- Google AI Pro subscription: $20/month

**Monthly Total**: $20 + $16.90 + $5 = **$41.90/month**

**Annual Cost**: **~$503/year**

### Scenario: Full Gemini Transcription

**Monthly Metrics**:

- New episodes: 5 per month
- Cost per episode: $3.38
- Google AI Pro subscription: $20/month

**Monthly Total**: $20 + $16.90 = **$36.90/month**

**Annual Cost**: **~$443/year**

---

## 7. Breakdown of Gemini API Advantages

### ✅ Pros

- **Accurate Spanish transcription** (native support)
- **Automatic language detection** (supports 100+ languages)
- **No GPU required** (cloud-based)
- **Fast processing** (seconds vs minutes)
- **Integrated with Google Workspace** (useful for collaboration)
- **No maintenance** (fully managed service)

### ⚠️ Cons

- **Recurring monthly cost** (vs one-time Whisper setup)
- **Rate limits** (2 RPM with AI Pro)
- **Internet dependency** (requires connectivity)
- **Cost per episode** ($3-4 each, vs free with Whisper)

---

## 8. Implementation Recommendations

### For Your Use Case

Given you already have 383 transcripts via Whisper.cpp:

#### Option A: Use Existing Whisper Solution

- **Cost**: $0/month (already invested in setup)
- **Best for**: Maintaining current workflow
- **Action**: Continue using `npm run transcribe`

#### Option B: Migrate to Gemini (Selective)

- **Cost**: $20/month (Google AI Pro) + usage
- **Best for**: Testing, new episodes, quality assurance
- **Action**: Use provided `gemini-transcriber.ts` script

#### Option C: Hybrid Approach (Recommended)

- **Cost**: $20/month + $10-20 for processing
- **Best for**: Highest accuracy + manageable cost
- **Action**:
  1. Keep Whisper for fast initial pass
  2. Use Gemini for validation/cleanup
  3. Scale based on needs

---

## 9. Cost Monitoring Script

To track API usage, implement the following Node.js script:

```typescript
// src/track-api-costs.ts
interface TranscriptionMetrics {
  episodeName: string;
  durationMinutes: number;
  outputTokens: number;
  costUSD: number;
  timestamp: Date;
}

const metrics: TranscriptionMetrics[] = [];

function calculateCost(durationMinutes: number, outputTokens: number): number {
  const inputCost = durationMinutes * 0.075;
  const outputCost = (outputTokens / 1000000) * 0.3;
  return inputCost + outputCost;
}

function logTranscription(data: TranscriptionMetrics): void {
  metrics.push(data);
  console.log(
    `[COST TRACKING] ${data.episodeName}: $${data.costUSD.toFixed(4)}`
  );

  const totalCost = metrics.reduce((sum, m) => sum + m.costUSD, 0);
  console.log(`[MONTHLY TOTAL] $${totalCost.toFixed(2)}`);
}

export { calculateCost, logTranscription };
```

---

## 10. Quick Decision Matrix

| Factor          | Whisper   | Gemini    | Cloud Speech-to-Text |
| --------------- | --------- | --------- | -------------------- |
| **Cost**        | $0/mo     | $20/mo    | $24/mo (5 eps)       |
| **Setup**       | Complex   | Simple    | Simple               |
| **Speed**       | Slow      | Fast      | Fast                 |
| **Spanish**     | Excellent | Excellent | Good                 |
| **Maintenance** | High      | None      | None                 |
| **Accuracy**    | High      | Very High | High                 |

---

## Conclusion

### Recommended Action Plan

1. **For Current Project**: Continue with Whisper (cost-effective for batch)
2. **For New Episodes**: Adopt Gemini API ($20/mo subscription + $3.38/episode)
3. **For Quality**: Use both (Whisper → Gemini verification)
4. **Budget**: Allocate $40-60/month for hybrid approach

### Next Steps

1. Verify API key setup (`.env` file)
2. Run initial test: `npm run transcribe:gemini path/to/audio.mp3`
3. Monitor costs via Google Cloud console
4. Adjust strategy based on actual usage

---

## Resources

- [Gemini API Pricing](https://ai.google.dev/pricing)
- [Google AI Pro Subscription](https://ai.google.dev/pricing)
- [Gemini Audio Transcription Docs](https://ai.google.dev/docs/audio)
- [Token Counting Guide](https://ai.google.dev/docs/token-counter)

---

**Last Updated**: November 2025
**Version**: 1.0
