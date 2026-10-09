import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as SplashScreen from 'expo-splash-screen';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { markIntroDone } from '../lib/intro';

/**
 * The motion opening: Sweam's brand animation plays once on cold start, full
 * screen on brand blue, then dissolves into the app. The native splash is the
 * same solid blue with no icon, so the first frame of the animation is
 * indistinguishable from the launch screen and the S appears to grow out of it.
 *
 * The video is 9:16 and is shown "contain" on the same blue, so taller phones
 * get invisible blue bands instead of a cropped wordmark.
 *
 * Timing: the approved 6 s animation at 1.25x, handed off as "NOW STREAMING"
 * lands (video time 4.2 s = about 3.4 s on the clock) with a 350 ms dissolve.
 * Tap anywhere to skip. With Reduce Motion on, the still closing frame shows
 * for a second instead. A hard timer guarantees the overlay never traps anyone
 * if the player stalls.
 */

/** Sweam royal blue, the animation's background. */
const BRAND_BLUE = '#1759F5';
/** Hand off at this point of the animation (seconds of video time). */
const HANDOFF_AT_S = 4.2;
const PLAYBACK_RATE = 1.25;
const DISSOLVE_MS = 350;
/** Whatever happens, the overlay is gone by then. */
const HARD_LIMIT_MS = 5500;
/** How long the still frame stays with Reduce Motion on. */
const STILL_MS = 1100;

const INTRO_VIDEO = require('../../assets/intro/sweam-intro.mp4');
const INTRO_POSTER = require('../../assets/intro/sweam-intro-poster.png');

export function IntroOverlay() {
  const [done, setDone] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const opacity = useSharedValue(1);
  const dismissed = useRef(false);

  const player = useVideoPlayer(INTRO_VIDEO, (p) => {
    p.loop = false;
    p.muted = true;
    p.playbackRate = PLAYBACK_RATE;
    p.timeUpdateEventInterval = 0.1;
  });

  const finish = useCallback(() => setDone(true), []);

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    // Let the feed start under the dissolve, so the hand-off lands on motion.
    markIntroDone();
    try {
      player.pause();
    } catch {
      /* already released */
    }
    opacity.value = withTiming(0, { duration: DISSOLVE_MS }, (finished) => {
      if (finished) runOnJS(finish)();
    });
  }, [player, opacity, finish]);

  // Reduce Motion: no animation, a still frame, then the same dissolve.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => alive && setReduceMotion(enabled))
      .catch(() => alive && setReduceMotion(false));
    return () => {
      alive = false;
    };
  }, []);

  // Drive playback and the hand-off from the player's own clock.
  useEffect(() => {
    if (reduceMotion !== false) return;
    const status = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        // First frame is solid blue: safe to drop the native splash now.
        SplashScreen.hideAsync().catch(() => undefined);
        player.play();
      } else if (status === 'error') {
        SplashScreen.hideAsync().catch(() => undefined);
        dismiss();
      }
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= HANDOFF_AT_S) dismiss();
    });
    const end = player.addListener('playToEnd', () => dismiss());
    return () => {
      status.remove();
      time.remove();
      end.remove();
    };
  }, [player, reduceMotion, dismiss]);

  useEffect(() => {
    if (reduceMotion !== true) return;
    SplashScreen.hideAsync().catch(() => undefined);
    const t = setTimeout(dismiss, STILL_MS);
    return () => clearTimeout(t);
  }, [reduceMotion, dismiss]);

  // Safety nets: the splash never stays up, and the overlay always leaves.
  useEffect(() => {
    const splash = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 1500);
    const limit = setTimeout(dismiss, HARD_LIMIT_MS);
    return () => {
      clearTimeout(splash);
      clearTimeout(limit);
    };
  }, [dismiss]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (done) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, fade]} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Sweam. Opening animation. Tap to skip."
      >
        {reduceMotion === false ? (
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
            // A texture, not a surface: stays above the feed's video surface and
            // fades with the overlay instead of punching a hole through it.
            surfaceType="textureView"
          />
        ) : (
          <Image
            source={INTRO_POSTER}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: BRAND_BLUE, zIndex: 1000, elevation: 1000 },
});
