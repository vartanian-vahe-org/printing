'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { svgDataUrl } from '../../lib/design-state';

const PX_PER_INCH = 300;

/**
 * Rasterizes an SVG face into a texture. Keeps showing the previous texture until the new
 * one is ready, so typing does not flicker. Returns null while there is nothing to show.
 */
export function useSvgTexture(svg: string | null, widthIn: number, heightIn: number): Texture | null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [texture, setTexture] = useState<Texture | null>(null);
  const current = useRef<Texture | null>(null);

  useEffect(() => {
    if (!svg) {
      current.current?.dispose();
      current.current = null;
      setTexture(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.src = svgDataUrl(svg);
    image
      .decode()
      .then(() => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(widthIn * PX_PER_INCH);
        canvas.height = Math.round(heightIn * PX_PER_INCH);
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        const next = new CanvasTexture(canvas);
        next.colorSpace = SRGBColorSpace;
        next.anisotropy = gl.capabilities.getMaxAnisotropy();
        current.current?.dispose();
        current.current = next;
        setTexture(next);
        invalidate();
      })
      .catch(() => {
        // Keep the previous texture if this SVG cannot be decoded.
      });
    return () => {
      cancelled = true;
    };
  }, [svg, widthIn, heightIn, gl, invalidate]);

  useEffect(() => () => current.current?.dispose(), []);

  return texture;
}
