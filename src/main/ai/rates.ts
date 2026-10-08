/**
 * Where the AI steps remember how fast they ran on this computer (settings
 * keys, in ms per megapixel): AI denoise per model, Enhance per step kind.
 * Their estimates read them, and so does Settings → AI models.
 */
export const DENOISE_RATE_KEY = 'ai.denoise.msPerMp'
/** `.2` since engine 0.18: the old rates timed Real-ESRGAN's ×2, which SPAN replaced (~20× faster). */
export const ENHANCE_RATE_KEY = 'ai.enhance.rates.2'
