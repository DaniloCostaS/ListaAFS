import { File, UploadTask, UploadType } from 'expo-file-system';

export interface TraceMoeTitle {
  native?: string;
  romaji?: string;
  english?: string;
}

export interface TraceMoeAnilist {
  id: number;
  idMal?: number;
  title?: TraceMoeTitle;
  synonyms?: string[];
  isAdult?: boolean;
}

export interface TraceMoeMatch {
  anilist: number | TraceMoeAnilist;
  filename: string;
  episode: number | string | null;
  from: number;
  to: number;
  similarity: number;
  video: string;
  image: string;
}

export interface TraceMoeResponse {
  frameCount: number;
  error: string;
  result: TraceMoeMatch[];
}

/**
 * Searches trace.moe using an image URI from the device.
 * Uses native expo-file-system UploadTask (streaming multipart directly from device storage),
 * with cutBorders and anilistInfo to get rich AniList metadata and black border removal.
 */
export async function searchAnimeByImage(
  imageUri: string,
  _base64?: string | null,
  mimeType: string = 'image/jpeg',
  fileName: string = 'screenshot.jpg'
): Promise<TraceMoeMatch[]> {
  const url = 'https://api.trace.moe/search?anilistInfo&cutBorders';

  try {
    const file = new File(imageUri);
    const task = new UploadTask(file, url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'image',
      headers: {
        Accept: 'application/json',
      },
    });

    const uploadResult = await task.uploadAsync();

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      let msg = `Status ${uploadResult.status}`;
      try {
        const errJson = JSON.parse(uploadResult.body);
        if (errJson?.error) msg = errJson.error;
      } catch {
        if (uploadResult.body) msg = uploadResult.body;
      }
      throw new Error(msg);
    }

    const data: TraceMoeResponse = JSON.parse(uploadResult.body);

    if (data.error) {
      throw new Error(data.error);
    }

    return data.result || [];
  } catch (err: any) {
    console.warn('UploadTask failed, attempting XMLHttpRequest fallback:', err);
    return uploadWithXHR(url, imageUri, mimeType, fileName);
  }
}

function uploadWithXHR(
  url: string,
  uri: string,
  mimeType: string,
  fileName: string
): Promise<TraceMoeMatch[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data: TraceMoeResponse = JSON.parse(xhr.responseText);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result || []);
          }
        } catch {
          reject(new Error('Erro ao processar resposta do servidor.'));
        }
      } else {
        let msg = `Status ${xhr.status}`;
        try {
          const errJson = JSON.parse(xhr.responseText);
          if (errJson?.error) msg = errJson.error;
        } catch {
          if (xhr.responseText) msg = xhr.responseText;
        }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Falha de conexão ao enviar imagem para análise.'));
    };

    const formData = new FormData();
    formData.append('image', {
      uri,
      type: mimeType || 'image/jpeg',
      name: fileName || 'screenshot.jpg',
    } as any);

    xhr.send(formData);
  });
}

/**
 * Formats seconds into MM:SS format.
 */
export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Extracts a readable title and subtitle from a trace.moe match.
 */
export function getAnilistTitle(item: TraceMoeMatch): { title: string; romaji?: string; native?: string } {
  if (typeof item.anilist === 'object' && item.anilist?.title) {
    const t = item.anilist.title;
    const title = t.english || t.romaji || t.native || item.filename;
    const romaji = t.romaji && t.romaji !== title ? t.romaji : undefined;
    const native = t.native && t.native !== title ? t.native : undefined;
    return { title, romaji, native };
  }
  return { title: item.filename };
}
