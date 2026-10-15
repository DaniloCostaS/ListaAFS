export interface GeminiVisionResult {
  title: string;
  original_title?: string;
  media_type: 'anime' | 'movie' | 'tv';
  characters?: string[];
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}

const CANDIDATE_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-flash-latest',
];

/**
 * Identifies a movie, series, or anime from an image using Google Gemini Vision.
 * Automatically tries fallback models if one experiences high demand (503) or rate limits.
 * Free tier provides 1,500 requests per day via Google AI Studio.
 */
export async function identifyMediaWithGemini(
  base64Data: string,
  mimeType: string = 'image/jpeg',
  customApiKey?: string
): Promise<GeminiVisionResult> {
  const apiKey = customApiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    throw new Error('Chave da API do Google Gemini não encontrada. Configure EXPO_PUBLIC_GEMINI_API_KEY no arquivo .env ou informe a chave no app.');
  }

  const prompt = `Você é um especialista em identificar filmes, séries e animes a partir de imagens e capturas de tela (screenshots).
Analise a imagem enviada. Pode ser uma cena de anime, uma luta, um filme ou uma série ocidental/asiática, mesmo com barras pretas, player de vídeo, legendas ou textos por cima.
Identifique com a máxima precisão qual é a obra (filme, série ou anime) e os personagens visíveis.

Responda ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "title": "Nome da obra mais conhecido em inglês ou português (ex: Goblin Slayer, Attack on Titan, Solo Leveling, Breaking Bad, Vingadores)",
  "original_title": "Título original se diferente (ex: ゴブリンスレイヤー ou Shingeki no Kyojin)",
  "media_type": "anime" ou "movie" ou "tv",
  "characters": ["Nome do Personagem 1", "Nome do Personagem 2"],
  "confidence": "high" ou "medium" ou "low",
  "explanation": "Explicação concisa de 1 frase em português explicando por que esta cena/personagens correspondem a essa obra"
}`;

  const cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

  let lastError = '';

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: mimeType || 'image/jpeg',
                      data: cleanBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        }
      );

      if (response.status === 503 || response.status === 429) {
        console.warn(`Model ${model} returned ${response.status} (high demand/rate limit), trying next candidate model...`);
        lastError = `Modelo ${model} temporariamente ocupado (${response.status})`;
        continue;
      }

      if (!response.ok) {
        let errDetail = `Status ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson?.error?.message) {
            errDetail = errJson.error.message;
          }
        } catch {
          const text = await response.text().catch(() => '');
          if (text) errDetail = text;
        }
        lastError = `Erro na API (${response.status}): ${errDetail}`;
        // If 404 model not found, try next model
        if (response.status === 404) {
          continue;
        }
        throw new Error(lastError);
      }

      const json = await response.json();
      const textContent = json?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        continue;
      }

      const parsed: GeminiVisionResult = JSON.parse(textContent);
      return parsed;
    } catch (err: any) {
      console.warn(`Error trying Gemini model ${model}:`, err?.message || err);
      lastError = err?.message || String(err);
      // If it wasn't a 503/429/404, we still try the next candidate model
    }
  }

  throw new Error(`Não foi possível analisar a imagem após tentar os modelos disponíveis: ${lastError}`);
}
