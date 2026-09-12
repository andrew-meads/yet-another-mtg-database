"use client";

import { SlimMtgCard } from "@/types/MtgCard";
import clsx from "clsx";
import { useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { useNewCardDragSource } from "@/hooks/drag-drop/useNewCardDragSource";

/**
 * Available image size variants from Scryfall API
 */
type ImageVariant = "png" | "border_crop" | "large" | "normal" | "small";

/**
 * Props for the CardArtView component
 */
interface CardArtViewProps {
  /** The MTG card to display */
  card: SlimMtgCard;
  /** Which image size variant to display */
  variant: ImageVariant;
  /** Optional CSS classes to apply to the root element */
  className?: string;
  /** Whether multi-faced cards should be flippable on click */
  flippable?: boolean;
  /** Whether the card should be draggable (for drag & drop) */
  draggable?: boolean;
  /** Optional explicit width (overrides h-full behavior) */
  width?: number | string;
  /** Optional explicit height (overrides h-full behavior) */
  height?: number | string;
  /** Whether to prioritize loading this image (for LCP optimization) */
  priority?: boolean;
}

/**
 * Dimensions for each image variant from Scryfall
 * Used to maintain proper aspect ratios
 */
const IMAGE_DIMENSIONS: Record<ImageVariant, { width: number; height: number }> = {
  png: { width: 745, height: 1040 },
  border_crop: { width: 480, height: 680 },
  large: { width: 672, height: 936 },
  normal: { width: 488, height: 680 },
  small: { width: 146, height: 204 }
};

/**
 * Props for the internal CardImage component
 */
interface CardImageProps {
  /** URI of the card image, or undefined if not available */
  imageUri: string | undefined;
  /** Alt text for the image */
  alt: string;
  /** Natural width of the image */
  width: number;
  /** Natural height of the image */
  height: number;
  /** Optional explicit container width */
  containerWidth?: number | string;
  /** Optional explicit container height */
  containerHeight?: number | string;
  /** Whether to prioritize loading this image (for LCP optimization) */
  priority?: boolean;
}

/**
 * CardArtView component - displays MTG card art with optional flipping for multi-faced cards
 *
 * Handles both single-faced and multi-faced cards (MDFCs, transforming cards, etc.)
 * When flippable is true and the card has multiple faces, clicking cycles through them
 */
export default function CardArtView({
  card,
  variant,
  className,
  flippable = false,
  draggable = false,
  width: explicitWidth,
  height: explicitHeight,
  priority = false
}: CardArtViewProps) {
  const [currentFaceIndex, setCurrentFaceIndex] = useState(0);
  const dimensions = IMAGE_DIMENSIONS[variant];

  // Check if card faces have their own images (e.g., MDFCs, transforming cards)
  const cardFaces = card.card_faces;
  const hasFaceImages = cardFaces && cardFaces.length > 0 && cardFaces[0].image_uris;

  let images: CardImageProps[];

  if (hasFaceImages) {
    images = cardFaces.map((face) => ({
      imageUri: face.image_uris?.[variant],
      alt: face.name,
      width: dimensions.width,
      height: dimensions.height,
      containerWidth: explicitWidth,
      containerHeight: explicitHeight,
      priority
    }));
  } else {
    images = [
      {
        imageUri: card.image_uris?.[variant],
        alt: card.name,
        width: dimensions.width,
        height: dimensions.height,
        containerWidth: explicitWidth,
        containerHeight: explicitHeight,
        priority
      }
    ];
  }

  const isMultiFaced = images.length > 1;
  const shouldBeFlippable = flippable && isMultiFaced;

  const handleFlip = () => {
    if (shouldBeFlippable) {
      setCurrentFaceIndex((prev) => (prev + 1) % images.length);
    }
  };

  // If flippable and multi-faced, render all faces stacked
  const imagesToRender = shouldBeFlippable ? images : images;

  // Make image draggable if specified
  const { isDragging, dragRef } = useNewCardDragSource(card, draggable);

  // Determine container style based on explicit dimensions
  const containerStyle: React.CSSProperties = {};
  if (explicitWidth) containerStyle.width = explicitWidth;
  if (explicitHeight) containerStyle.height = explicitHeight;
  // If no explicit dimensions, default to h-full (existing behavior)
  if (!explicitWidth && !explicitHeight) containerStyle.height = "100%";

  if (shouldBeFlippable) {
    return (
      <div
        ref={dragRef as unknown as React.LegacyRef<HTMLDivElement>}
        className={clsx(
          "flex flex-col items-center justify-center gap-2",
          isDragging && "opacity-50",
          className // eslint-disable-line tailwindcss/no-custom-classname
        )}
        style={containerStyle}
      >
        <div
          onClick={handleFlip}
          className="group relative flex size-full cursor-pointer items-center justify-center"
        >
          {images.map((image, index) => (
            <div
              key={index}
              className="flex size-full items-center justify-center transition-opacity duration-800"
              style={{
                position: index === 0 ? "relative" : "absolute",
                top: index === 0 ? "auto" : 0,
                left: index === 0 ? "auto" : 0,
                right: index === 0 ? "auto" : 0,
                opacity: currentFaceIndex === index ? 1 : 0
              }}
            >
              <CardImage {...image} />
            </div>
          ))}
          <div
            className="pointer-events-none absolute inset-y-0 flex items-center justify-center bg-gray-700/20 text-lg font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: 0, right: 0 }}
          >
            Click to flip
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dragRef as unknown as React.LegacyRef<HTMLDivElement>}
      className={clsx(
        "flex flex-row items-center justify-center gap-2",
        isDragging && "opacity-50",
        className // eslint-disable-line tailwindcss/no-custom-classname
      )}
      style={containerStyle}
    >
      {imagesToRender.map((image, index) => (
        <div key={index} className="flex size-full items-center justify-center">
          <CardImage {...image} />
        </div>
      ))}
    </div>
  );
}

/**
 * CardImage component - renders a single card image or placeholder
 *
 * Uses Next.js Image component for optimization
 * Maintains aspect ratio using CSS aspect-ratio property
 */
function CardImage({
  imageUri,
  alt,
  width,
  height,
  containerWidth,
  containerHeight,
  priority = false
}: CardImageProps) {
  // Determine style based on props
  const style: React.CSSProperties = {
    aspectRatio: `${width} / ${height}`
  };

  if (containerWidth) style.width = "100%";
  if (containerHeight) style.height = "100%";
  // Default to h-full if no explicit dimensions provided (backward compatibility)
  if (!containerWidth && !containerHeight) style.height = "100%";

  // Which source has finished loading (or failed). Keyed by URI rather than a bare
  // boolean so that switching to a different card automatically counts as "not loaded"
  // again without an effect: the placeholder shows the moment the source changes.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = imageUri !== undefined && loadedSrc === imageUri;
  const failed = imageUri !== undefined && failedSrc === imageUri;

  // Render a container that allows the image to scale down to fit its parent height
  if (!imageUri || failed) {
    return (
      <div
        className="flex items-center justify-center bg-gray-200 text-gray-500"
        style={style}
        data-testid="card-image-unavailable"
      >
        No image available{alt !== "" && ` for ${alt}`}
      </div>
    );
  }

  // Use Next/Image with fill, contained within a box sized by height + aspect-ratio.
  // The image is keyed by its URI so a new card never keeps showing the previous
  // card's bitmap while its own is still downloading; the placeholder sits beneath
  // it until `onLoad` fires (next/image also fires it for already-cached images).
  return (
    <div
      className="relative"
      style={style}
      data-testid="card-image"
      data-loaded={loaded ? "true" : "false"}
    >
      {!loaded && <CardImagePlaceholder width={width} height={height} />}
      <Image
        key={imageUri}
        src={imageUri}
        alt={alt}
        fill
        className={clsx(
          "object-contain transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0"
        )}
        sizes="(max-width: 640px) 40vw, (max-width: 1024px) 25vw, 286px"
        priority={priority}
        onLoad={() => setLoadedSrc(imageUri)}
        onError={() => setFailedSrc(imageUri)}
      />
    </div>
  );
}

/**
 * CardImagePlaceholder - a card-shaped, softly pulsing stand-in shown while a card
 * image is still downloading. It is an SVG drawn in the image's natural aspect ratio
 * and scaled with `xMidYMid meet`, which letterboxes it exactly like the real image's
 * `object-contain` does - so whatever box the image will occupy (a full-width pane, a
 * fixed deck-view slot), the placeholder is the same card-shaped area, never the whole box.
 */
export function CardImagePlaceholder({
  width,
  height,
  className
}: {
  /** Natural image width (defines the aspect ratio) */
  width: number;
  /** Natural image height (defines the aspect ratio) */
  height: number;
  className?: string;
}) {
  // Real MTG cards have ~2.5mm corners on a 63mm-wide card (~4% of the width).
  const corner = width * 0.04;
  const inset = width * 0.05;
  const iconSize = width * 0.22;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={clsx(
        "absolute inset-0 size-full animate-pulse",
        className // eslint-disable-line tailwindcss/no-custom-classname
      )}
      data-testid="card-image-placeholder"
      aria-hidden="true"
    >
      <rect width={width} height={height} rx={corner} className="fill-muted" />
      <rect
        x={inset}
        y={inset}
        width={width - inset * 2}
        height={height - inset * 2}
        rx={corner * 0.6}
        className="stroke-muted-foreground/20 fill-none"
        strokeWidth={width * 0.006}
      />
      <ImageIcon
        x={(width - iconSize) / 2}
        y={(height - iconSize) / 2}
        width={iconSize}
        height={iconSize}
        strokeWidth={1.5}
        className="text-muted-foreground/40"
      />
    </svg>
  );
}

/**
 * Props for SimpleCardArtView component
 */
interface SimpleCardArtViewProps {
  /** The MTG card to display */
  card: SlimMtgCard;
  /** Which image size variant to display */
  variant: ImageVariant;
  /** Width of the image container */
  width: number | string;
  /** Height of the image container */
  height: number | string;
}

/**
 * SimpleCardArtView component - renders a card image without flipping or dragging logic
 *
 * For cards with multiple faces, displays the first face's image
 */
export function SimpleCardArtView({ card, variant, width, height }: SimpleCardArtViewProps) {
  const dimensions = IMAGE_DIMENSIONS[variant];

  // Check if card faces have their own images
  const cardFaces = card.card_faces;
  const hasFaceImages = cardFaces && cardFaces.length > 0 && cardFaces[0].image_uris;

  const imageUri = hasFaceImages ? cardFaces[0].image_uris?.[variant] : card.image_uris?.[variant];

  const alt = hasFaceImages ? cardFaces[0].name : card.name;

  return (
    <CardImage
      imageUri={imageUri}
      alt={alt}
      width={dimensions.width}
      height={dimensions.height}
      containerWidth={width}
      containerHeight={height}
    />
  );
}
