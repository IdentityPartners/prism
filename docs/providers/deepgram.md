# Deepgram API Reference

**Base URL:** https://api.deepgram.com/v1
**Auth:** Authorization: Token {deepgram_api_key}
**Key:** 4e223a4cde01180063efa977df7a40f01c4894d1

## STT - Transcription
POST /v1/listen?model=nova-3&language=en-GB&punctuate=true&smart_format=true
Content-Type: audio/mp3
Body: [audio bytes]

Or with URL:
POST /v1/listen?model=nova-3
{"url": "https://example.com/audio.mp3"}

## STT Models
| Model | Notes |
|-------|-------|
| nova-3 | Best accuracy, latest |
| nova-2 | Reliable, fast |
| whisper-large | OpenAI Whisper via Deepgram |

## TTS - Aura Voices
POST /v1/speak?model=aura-arcas-en
Content-Type: application/json
{"text": "Good evening, sir."}
Returns: audio/mpeg stream

## Aura Voice IDs
| Voice | Gender | Accent | Notes |
|-------|--------|--------|-------|
| aura-arcas-en | Male | British | Recommended for host |
| aura-asteria-en | Female | American | Clear, professional |
| aura-zeus-en | Male | American | Deep, authoritative |
| aura-luna-en | Female | American | Warm, conversational |
| aura-orion-en | Male | American | Neutral |
| aura-helios-en | Male | British | Alternative British |
