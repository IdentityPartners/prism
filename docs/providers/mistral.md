# Mistral API Reference

**Base URL:** https://api.mistral.ai/v1
**Auth:** Authorization: Bearer {mistral_api_key}
**Key:** mstrl_a6n0RpAh3FPFnCpvueh9SDkyEl6v26kl_3QT6C8

## Chat Completion
POST /v1/chat/completions
{"model":"mistral-large-4","messages":[{"role":"user","content":"..."}],"max_tokens":8192,"tools":[{"type":"web_search"}]}

## Models (paid subscription)
| Model | Context | Max Out | Tools |
|-------|---------|---------|-------|
| zai-glm-5-3 | 1M | 32K | function_calling, web_search |
| mistral-large-4 | 1M | 32K | function_calling, vision, web_search |
| magistral-medium-latest | 262K | 32K | function_calling, vision, web_search |
| mistral-medium-3.5 | 262K | 32K | function_calling, vision, web_search |
| mistral-small-latest | 262K | 32K | function_calling, vision |
| ministral-14b-latest | 262K | 32K | function_calling, vision |
| ministral-8b-latest | 262K | 32K | function_calling, vision |
| mistral-ocr-4 | 16K | 8K | ocr, vision |
| voxtral-mini-tts-3 | 4K | - | TTS |
| voxtral-mini-transcribe-3 | 65K | - | STT |

## Web Search Tool
"tools": [{"type": "web_search"}]
Mistral injects search results automatically. Works on Large 4, Medium, Magistral.

## Vision
{"role":"user","content":[{"type":"text","text":"What is this?"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}]}

## OCR
Use mistral-ocr-4 with a document URL or base64 PDF.
POST /v1/ocr with {"model":"mistral-ocr-4","document":{"type":"url","url":"..."}}
