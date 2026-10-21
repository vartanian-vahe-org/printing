'use client';

import type { FaceScene } from '@printing/templates';
import { useEffect, useState } from 'react';
import { sceneToPng } from './canvas-painter';

/** Paints scenes to PNG data URLs; keeps the previous images until the new ones are ready (no flicker). */
export function useScenePngs<K extends string>(scenes: Partial<Record<K, FaceScene | null>>, pxPerPt: number): Partial<Record<K, string>> {
  const [images, setImages] = useState<Partial<Record<K, string>>>({});

  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(scenes) as [K, FaceScene | null | undefined][];
    void Promise.all(entries.map(async ([key, scene]) => [key, scene ? await sceneToPng(scene, pxPerPt) : undefined] as const)).then((painted) => {
      if (!cancelled) setImages(Object.fromEntries(painted.filter(([, url]) => url)) as Partial<Record<K, string>>);
    });
    return () => {
      cancelled = true;
    };
  }, [scenes, pxPerPt]);

  return images;
}
