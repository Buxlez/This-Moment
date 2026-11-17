# Product

## Register

product

## Users

Primary users are drivers and passengers who want music that fits their immediate environment, activity, energy, and emotional constraints without repeatedly searching or building a playlist. The MVP is also used by an internal product team running a local desktop demo, so the interface must remain understandable without setup knowledge and must clearly distinguish simulated context from live service results.

## Product Purpose

`this moment` translates one natural-language sentence plus time, weather, and city into an explainable music direction and a persistent card of up to 20 confirmed playable tracks. Success means a user can express an imprecise need, understand how the system interpreted it, start listening with one action, and refine or refresh the result without losing earlier cards. External service failures must degrade honestly rather than produce invented success.

## Brand Personality

Calm, perceptive, and quietly confident. The product should feel attentive to the current moment without sounding sentimental, clinical, or algorithmic. Its voice is warm and concise, like a thoughtful music editor who knows when to step back and let the music lead.

## Anti-references

- Not a dense streaming-service catalog full of rankings, badges, promotional banners, and competing navigation.
- Not an AI chatbot transcript with generic assistant bubbles, model terminology, or exposed chain-of-thought.
- Not a neon automotive dashboard or dark sci-fi control panel.
- Not a decorative lifestyle landing page that makes the core input and playback workflow secondary.
- Not a fake live service: simulated catalog, browser speech, and unavailable integrations must be labeled accurately.

## Design Principles

1. Start with the moment: environment and natural-language intent should be visible before music metadata.
2. One clear next action: composing, generating, refining, and playing should each have an obvious primary control.
3. Explain without over-explaining: show atmosphere, energy, rhythm, and a two-sentence recommendation, never internal model reasoning.
4. Preserve continuity: new cards accumulate newest-first while old cards keep their original order and remain playable.
5. Degrade honestly: every missing credential, unavailable track, failed TTS request, or demo source is named in plain language.

## Accessibility & Inclusion

Target WCAG 2.1 AA for contrast, keyboard operation, visible focus, semantic controls, and status announcements. Respect reduced-motion preferences, never rely on color alone for state, keep touch targets at least 44 pixels where possible, and ensure the full recommendation and playback flow works on narrow mobile screens. Chinese is the primary interface language, with original-language song and artist names preserved.
