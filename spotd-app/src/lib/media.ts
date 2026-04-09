/** Media upload + FFmpeg WASM video compression */
import { supabase } from './supabase';

const BUCKET = 'checkin-photos';
const MAX_VIDEO_SIZE = 20 * 1024 * 1024; // 20MB threshold for compression

/** Upload a photo to Supabase storage */
export async function uploadPhoto(
  file: File,
  userId: string,
): Promise<{ url: string; storagePath: string } | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) return null;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, storagePath: path };
}

/** Upload a video (with optional FFmpeg compression) */
export async function uploadVideo(
  file: File,
  userId: string,
  onProgress?: (msg: string) => void,
): Promise<{ url: string; storagePath: string } | null> {
  let uploadFile: File | Blob = file;

  if (file.size > MAX_VIDEO_SIZE) {
    onProgress?.('Compressing video...');
    const compressed = await compressVideo(file);
    if (compressed) uploadFile = compressed;
  }

  const ext = 'mp4';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  onProgress?.('Uploading...');
  const { error } = await supabase.storage.from(BUCKET).upload(path, uploadFile, {
    contentType: 'video/mp4',
    upsert: false,
  });
  if (error) return null;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, storagePath: path };
}

/** Compress video using FFmpeg WASM — H.264, 720p max, CRF 28 */
async function compressVideo(file: File): Promise<Blob | null> {
  try {
    const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm' as string);
    const { fetchFile } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm' as string);

    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    });

    const inputName = 'input' + (file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4');
    const outputName = 'output.mp4';

    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', 'scale=-2:min(720\\,ih)',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    return new Blob([data], { type: 'video/mp4' });
  } catch {
    return null; // Fall back to uploading uncompressed
  }
}

/** Extract poster frames from a video for cover selection */
export function extractVideoFrames(
  videoUrl: string,
  count: number = 8,
): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const frames: string[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 72;
      const ctx = canvas.getContext('2d')!;

      for (let i = 0; i < count; i++) {
        const time = (duration / count) * i;
        video.currentTime = time;
        await new Promise<void>((r) => {
          video.onseeked = () => r();
        });
        ctx.drawImage(video, 0, 0, 96, 72);
        frames.push(canvas.toDataURL('image/jpeg', 0.7));
      }

      URL.revokeObjectURL(videoUrl);
      resolve(frames);
    };

    video.onerror = () => resolve([]);
    video.src = videoUrl;
  });
}

/** Save check-in photo metadata to DB */
export async function saveCheckinPhoto(opts: {
  userId: string;
  venueId: string;
  citySlug: string;
  photoUrl: string;
  storagePath: string;
  caption?: string;
}) {
  return supabase.from('checkin_photos').insert({
    user_id: opts.userId,
    venue_id: opts.venueId,
    city_slug: opts.citySlug,
    photo_url: opts.photoUrl,
    storage_path: opts.storagePath,
    caption: opts.caption || null,
  });
}
