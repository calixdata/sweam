import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import type { CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { uploadVideo, UploadError } from '../lib/upload';
import type { UploadProgress } from '../lib/upload';
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  ACCEPTED_VIDEO_TYPES,
  CLIP_SPEC,
  GENRES,
  RATINGS,
} from '../lib/clipspec';
import type { Audience, Genre, Rating } from '../lib/clipspec';
import { colors, radius } from '../lib/theme';

type Phase = 'capture' | 'review';
interface Clip {
  uri: string;
  mime: string;
  name: string;
}

function extensionOf(uri: string): string {
  const path = uri.split('?')[0] ?? uri;
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
}

function mimeForUri(uri: string, fallback = ''): string {
  switch (extensionOf(uri)) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    default:
      return fallback;
  }
}

function filenameForUri(uri: string, fallback: string): string {
  const path = uri.split('?')[0] ?? uri;
  const slash = path.lastIndexOf('/');
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return name || fallback;
}

function isAcceptedVideo(mime: string): boolean {
  return (ACCEPTED_VIDEO_TYPES as readonly string[]).includes(mime);
}

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [phase, setPhase] = useState<Phase>('capture');
  const [clip, setClip] = useState<Clip | null>(null);

  const [caption, setCaption] = useState('');
  const [rating, setRating] = useState<Rating | ''>('');
  const [genre, setGenre] = useState<Genre>(GENRES[0]);
  const [audiences, setAudiences] = useState<Audience[]>([]);

  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
  });

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  // Drive the review preview from the captured clip.
  useEffect(() => {
    if (phase === 'review' && clip) {
      player.replace({ uri: clip.uri });
      player.play();
    } else {
      player.pause();
    }
  }, [phase, clip, player]);

  const stopRecording = useCallback(() => {
    stopTimer();
    cameraRef.current?.stopRecording();
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording || !cameraReady) return;
    setError(null);
    setRecording(true);
    setElapsed(0);
    let seconds = 0;
    timerRef.current = setInterval(() => {
      seconds += 1;
      setElapsed(seconds);
      if (seconds >= CLIP_SPEC.maxSeconds) stopRecording();
    }, 1000);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: CLIP_SPEC.maxSeconds });
      if (video?.uri) {
        setClip({
          uri: video.uri,
          mime: mimeForUri(video.uri, 'video/mp4'),
          name: filenameForUri(video.uri, 'clip.mp4'),
        });
        setPhase('review');
      }
    } catch {
      setError('Recording failed. Try again.');
    } finally {
      setRecording(false);
      stopTimer();
    }
  }, [recording, cameraReady, stopRecording, stopTimer]);

  const pickFromLibrary = useCallback(async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
      videoMaxDuration: CLIP_SPEC.maxSeconds,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setClip({
      uri: asset.uri,
      mime: mimeForUri(asset.uri, asset.mimeType ?? ''),
      name: asset.fileName ?? filenameForUri(asset.uri, 'clip.mp4'),
    });
    setPhase('review');
  }, []);

  const retake = useCallback(() => {
    player.pause();
    setClip(null);
    setProgress(null);
    setError(null);
    setPhase('capture');
  }, [player]);

  const toggleAudience = useCallback((value: Audience) => {
    setAudiences((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value],
    );
  }, []);

  const post = useCallback(async () => {
    if (!clip || posting) return;
    if (!caption.trim()) {
      setError('Add a caption for your clip.');
      return;
    }
    if (!rating) {
      setError('Choose a maturity rating.');
      return;
    }
    if (!isAcceptedVideo(clip.mime)) {
      setError('That video format is not supported yet. Record in the app, or pick an MP4 or WebM file.');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const { url } = await uploadVideo(clip.uri, clip.mime, clip.name, setProgress, CLIP_SPEC.maxBytes);
      const result = await api.post<{ slug: string; titleId: string; episodeId: string }>('/api/clips', {
        caption: caption.trim(),
        rating,
        genre,
        audiences,
        sourceUrl: url,
      });
      player.pause();
      router.replace(`/watch/${result.episodeId}`);
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof UploadError
          ? err.message
          : 'Could not post your clip. Try again.';
      setError(message);
      setPosting(false);
      setProgress(null);
    }
  }, [clip, posting, caption, rating, genre, audiences, player, router]);

  // --- Signed-out gate ---------------------------------------------------
  if (!user) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <CloseButton onPress={() => router.back()} top={insets.top} />
        <Ionicons name="videocam" size={44} color={colors.accent} />
        <Text style={styles.gateTitle}>Record a clip</Text>
        <Text style={styles.gateBody}>Join Sweam free to film something and post it straight to the feed.</Text>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => router.replace('/signup')}
          accessibilityRole="button"
          accessibilityLabel="Join free"
        >
          <Text style={styles.primaryBtnText}>Join free</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/signin')} accessibilityRole="button">
          <Text style={styles.linkText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  // --- Review + details --------------------------------------------------
  if (phase === 'review' && clip) {
    const captionLeft = CLIP_SPEC.captionMax - caption.length;
    return (
      <View style={styles.fill}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 28, paddingTop: insets.top + 8 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.reviewHeader}>
            <Pressable
              onPress={retake}
              disabled={posting}
              accessibilityRole="button"
              accessibilityLabel="Retake clip"
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.reviewTitle}>New clip</Text>
            <View style={{ width: 26 }} />
          </View>

          <VideoView player={player} style={styles.preview} contentFit="contain" nativeControls />

          <View style={styles.form}>
            <Text style={styles.label}>Caption</Text>
            <TextInput
              style={styles.input}
              value={caption}
              onChangeText={setCaption}
              placeholder="Say something about your clip"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={CLIP_SPEC.captionMax}
              editable={!posting}
              accessibilityLabel="Clip caption"
            />
            <Text style={styles.hint}>{captionLeft} characters left. This becomes the clip's title.</Text>

            <Text style={styles.label}>Maturity rating</Text>
            <View style={styles.chipRow}>
              {RATINGS.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  selected={rating === value}
                  disabled={posting}
                  onPress={() => setRating(value)}
                />
              ))}
            </View>

            <Text style={styles.label}>Genre</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRowScroll}
            >
              {GENRES.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  selected={genre === value}
                  disabled={posting}
                  onPress={() => setGenre(value)}
                />
              ))}
            </ScrollView>

            <Text style={styles.label}>Audience</Text>
            <View style={styles.chipRow}>
              {AUDIENCES.map((value) => (
                <Chip
                  key={value}
                  label={AUDIENCE_LABELS[value]}
                  selected={audiences.includes(value)}
                  disabled={posting}
                  onPress={() => toggleAudience(value)}
                />
              ))}
            </View>

            {progress && (
              <Text style={styles.progress} accessibilityLiveRegion="polite">
                {progress.message}
                {progress.partsTotal > 1 ? ` (${progress.partsDone}/${progress.partsTotal})` : ''}
              </Text>
            )}
            {error && (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            )}

            <Pressable
              style={[styles.primaryBtn, posting && styles.btnDisabled]}
              onPress={() => void post()}
              disabled={posting}
              accessibilityRole="button"
              accessibilityLabel="Post clip now"
            >
              {posting ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.primaryBtnText}>Post now</Text>
              )}
            </Pressable>
            <Pressable
              onPress={retake}
              disabled={posting}
              accessibilityRole="button"
              accessibilityLabel="Discard and record again"
            >
              <Text style={styles.linkText}>Discard and redo</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  // --- Capture -----------------------------------------------------------
  const canUseCamera = Boolean(camPerm?.granted && micPerm?.granted);

  if (!canUseCamera) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <CloseButton onPress={() => router.back()} top={insets.top} />
        <Ionicons name="camera" size={44} color={colors.accent} />
        <Text style={styles.gateTitle}>Camera access</Text>
        <Text style={styles.gateBody}>
          Sweam needs your camera and microphone to record a clip. You can also post a video from your
          library instead.
        </Text>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => {
            void requestCam();
            void requestMic();
          }}
          accessibilityRole="button"
          accessibilityLabel="Allow camera and microphone"
        >
          <Text style={styles.primaryBtnText}>Allow camera & mic</Text>
        </Pressable>
        <Pressable onPress={() => void pickFromLibrary()} accessibilityRole="button">
          <Text style={styles.linkText}>Upload from library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        ref={cameraRef}
        style={styles.fill}
        facing={facing}
        mode="video"
        onCameraReady={() => setCameraReady(true)}
      />

      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          style={styles.iconCircle}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        {recording ? (
          <View style={styles.timerPill}>
            <View style={styles.recDot} />
            <Text style={styles.timerText}>
              {elapsed}s / {CLIP_SPEC.maxSeconds}s
            </Text>
          </View>
        ) : (
          <View />
        )}
        <Pressable
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          disabled={recording}
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
          hitSlop={12}
          style={styles.iconCircle}
        >
          <Ionicons name="camera-reverse" size={24} color={colors.text} />
        </Pressable>
      </View>

      {error && (
        <Text style={[styles.error, styles.captureError, { top: insets.top + 56 }]} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <View style={[styles.controls, { bottom: insets.bottom + 28 }]}>
        <Pressable
          onPress={() => void pickFromLibrary()}
          disabled={recording}
          accessibilityRole="button"
          accessibilityLabel="Upload from library"
          style={styles.sideControl}
        >
          <Ionicons name="images" size={26} color={recording ? colors.muted : colors.text} />
          <Text style={styles.sideLabel}>Upload</Text>
        </Pressable>

        <Pressable
          onPress={() => (recording ? stopRecording() : void startRecording())}
          disabled={!cameraReady}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          style={[styles.recordOuter, !cameraReady && styles.btnDisabled]}
        >
          <View style={recording ? styles.recordInnerStop : styles.recordInner} />
        </Pressable>

        <View style={styles.sideControl} />
      </View>
    </View>
  );
}

function CloseButton({ onPress, top }: { onPress: () => void; top: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={12}
      style={[styles.iconCircle, styles.absClose, { top: top + 8 }]}
    >
      <Ionicons name="close" size={24} color={colors.text} />
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  absClose: { position: 'absolute', left: 16 },
  gateTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  gateBody: { color: colors.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,14,25,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(8,14,25,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.like },
  timerText: { color: colors.text, fontWeight: '600' },
  controls: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideControl: { width: 64, alignItems: 'center', gap: 4 },
  sideLabel: { color: colors.text, fontSize: 12 },
  recordOuter: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: 5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.like },
  recordInnerStop: { width: 30, height: 30, borderRadius: 7, backgroundColor: colors.like },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  reviewTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  preview: { width: '100%', aspectRatio: 9 / 16, maxHeight: 420, backgroundColor: '#000' },
  form: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  hint: { color: colors.muted, fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRowScroll: { flexDirection: 'row', gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.bg, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
    marginTop: 14,
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  linkText: { color: colors.accent, fontSize: 15, textAlign: 'center', paddingVertical: 12 },
  progress: { color: colors.muted, fontSize: 13, marginTop: 10 },
  error: { color: colors.danger, fontSize: 14, marginTop: 10 },
  captureError: {
    position: 'absolute',
    left: 16,
    right: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(8,14,25,0.7)',
    padding: 10,
    borderRadius: radius.md,
  },
});
