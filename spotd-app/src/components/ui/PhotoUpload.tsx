import { useState, useRef } from 'react';
import { Button } from './Button';
import { uploadPhoto, uploadVideo, extractVideoFrames } from '../../lib/media';
import styles from './PhotoUpload.module.css';

interface Props {
  userId: string;
  onUpload: (result: { url: string; storagePath: string; type: 'photo' | 'video'; posterUrl?: string }) => void;
  onCancel: () => void;
}

export function PhotoUpload({ userId, onUpload, onCancel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'photo' | 'video'>('photo');
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoFrames, setVideoFrames] = useState<string[]>([]);
  const [selectedPoster, setSelectedPoster] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    const isVideo = file.type.startsWith('video/');
    setFileType(isVideo ? 'video' : 'photo');

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    if (isVideo) {
      setStatus('Extracting frames...');
      const frames = await extractVideoFrames(objectUrl);
      setVideoFrames(frames);
      if (frames.length > 0) setSelectedPoster(frames[0]);
      setStatus('');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);

    let result;
    if (fileType === 'video') {
      result = await uploadVideo(selectedFile, userId, setStatus);
    } else {
      setStatus('Uploading...');
      result = await uploadPhoto(selectedFile, userId);
    }

    setUploading(false);
    setStatus('');

    if (result) {
      onUpload({
        ...result,
        type: fileType,
        posterUrl: selectedPoster || undefined,
      });
    }
  };

  return (
    <div className={styles.container}>
      {!preview ? (
        <>
          <button className={styles.trigger} onClick={() => fileRef.current?.click()}>
            <span className={styles.triggerIcon}>📸</span>
            <span>Add photo or video</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            onChange={handleFileSelect}
            className={styles.hidden}
          />
        </>
      ) : (
        <div className={styles.previewWrap}>
          {fileType === 'photo' ? (
            <img src={preview} alt="Preview" className={styles.preview} />
          ) : (
            <video src={preview} className={styles.preview} controls muted />
          )}

          {videoFrames.length > 0 && (
            <div className={styles.filmstrip}>
              <span className={styles.filmLabel}>Cover frame</span>
              <div className={styles.frames}>
                {videoFrames.map((frame, i) => (
                  <button
                    key={i}
                    className={[styles.frame, selectedPoster === frame && styles.frameActive].filter(Boolean).join(' ')}
                    onClick={() => setSelectedPoster(frame)}
                  >
                    <img src={frame} alt={`Frame ${i + 1}`} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <input
            className={styles.caption}
            placeholder="Add a caption..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />

          {status && <p className={styles.status}>{status}</p>}

          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={() => {
              setPreview(null);
              setSelectedFile(null);
              setVideoFrames([]);
              setSelectedPoster(null);
              onCancel();
            }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleUpload} loading={uploading}>
              Upload
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
