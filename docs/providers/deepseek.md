# DeepSeek API Reference

**Base URL:** https://api.deepseek.com
**Auth:** Authorization: Bearer {deepseek_paid}
**Key:** sk-247be918850a45e194a07ff6178f27e8

## Chat Completion (OpenAI-compatible)
POST /v1/chat/completions
{"model":"deepseek-chat","messages":[{"role":"user","content":"..."}],"max_tokens":8192}

## Models
| Model | Context | Notes |
|-------|---------|-------|
| deepseek-chat | 1M | V4 Flash. Built-in web search. |
| deepseek-reasoner | 64K | R1 reasoning. Slower. |

## Web Search
DeepSeek V4 Flash has built-in web search. No tool call needed.
It searches automatically for time-sensitive queries.
