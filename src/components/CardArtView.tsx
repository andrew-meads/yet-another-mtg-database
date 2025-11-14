"use client";

import { MtgCard } from "@/types/MtgCard";
import clsx from "clsx";
import { useState } from "react";
import Image from "next/image";
import { useCardDragSource } from "@/hooks/drag-drop/useCardDragSource";

/**
 * Available image size variants from Scryfall API
 */
type ImageVariant = "png" | "border_crop" | "large" | "normal" | "small";

/**
 * Props for the CardArtView component
 */
interface CardArtViewProps {
  /** The MTG card to display */
  card: MtgCard;
  /** Which image size variant to display */
  variant: ImageVariant;
  /** Optional CSS classes to apply to the root element */
  className?: string;
  /** Whether multi-faced cards should be flippable on click */
  flippable?: boolean;
  /** Whether the card should be draggable (for drag & drop) */
  draggable?: boolean;
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
  draggable = false
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
      height: dimensions.height
    }));
  } else {
    images = [
      {
        imageUri: card.image_uris?.[variant],
        alt: card.name,
        width: dimensions.width,
        height: dimensions.height
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
  const { isDragging, dragRef } = useCardDragSource(card, draggable);

  if (shouldBeFlippable) {
    return (
      <div
        ref={dragRef as unknown as React.LegacyRef<HTMLDivElement>}
        className={clsx(
          "flex flex-col gap-2 h-full items-center justify-center",
          isDragging && "opacity-50",
          className
        )}
      >
        <div
          onClick={handleFlip}
          className="cursor-pointer relative group h-full flex items-center justify-center"
        >
          {images.map((image, index) => (
            <div
              key={index}
              className="transition-opacity duration-800 h-full flex items-center justify-center"
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
            className="absolute top-0 bottom-0 bg-gray-700/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-semibold text-lg pointer-events-none"
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
        "flex flex-row gap-2 h-full items-center justify-center",
        isDragging && "opacity-50",
        className
      )}
    >
      {imagesToRender.map((image, index) => (
        <div key={index} className="inline-block h-full">
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
function CardImage({ imageUri, alt, width, height }: CardImageProps) {
  // Render a container that allows the image to scale down to fit its parent height
  if (!imageUri) {
    return (
      <div
        className="bg-gray-200 flex items-center justify-center text-gray-500 h-full"
        style={{ height: "100%", aspectRatio: `${width} / ${height}` }}
      >
        No image available{alt !== "" && ` for ${alt}`}
      </div>
    );
  }

  // Use Next/Image with fill, contained within a box sized by height + aspect-ratio
  return (
    <div className="relative h-full" style={{ aspectRatio: `${width} / ${height}` }}>
      <Image
        src={imageUri}
        alt={alt}
        fill
        className="object-contain"
        sizes="(max-width: 640px) 40vw, (max-width: 1024px) 25vw, 286px"
        priority={false}
      />
    </div>
  );
}
